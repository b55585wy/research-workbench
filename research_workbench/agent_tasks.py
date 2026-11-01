"""Opt-in, source-bound analysis/chart/note checkpoints over ordinary Agent turns."""
import json
import sqlite3
from uuid import UUID,uuid5

from .agent_models import AgentSubmission,ReadingContext
from .agent_store import canonical,digest,now
from .studies import verify_owner as verify_source
from .models import WorkspaceError

ACTIVE=('running','waiting_confirmation','waiting_analysis')
WRITES={'analysis':('run_analysis','run_t_test','run_paired_t_test'),'chart':('create_chart',),'note':('create_note',)}
WRITE_TOOLS={'analysis':{'propose_analysis','propose_t_test','propose_paired_t_test'},'chart':{'propose_chart'},'note':{'propose_note'}}
READ_TOOLS={'read_context','read_page','read_dataset','analysis_methods','analysis_status','list_analyses',
            'read_analysis','read_t_test_groups','preview_t_test','chart_capabilities','list_charts',
            'read_chart','preview_chart','list_notes','read_note','complete_task'}
STAGE_MESSAGES={
    'analysis':'继续原始研究目标，提出所需的已安装分析方案；等待具体确认，不直接运行。',
    'chart':'分析已实际成功。读取保存的结果和绘图能力，提出下一步图表提案；不重复分析，不提前保存笔记。',
    'note':'图表已实际保存。读取本任务的分析和图表，提出一条来源笔记；包含真实分析/图表链接和材料限制，等待确认，不标记人工复核。'}


def grant_signature(context):
    return {'document_sha256':context['document']['sha256'],
            'dataset_id':context.get('dataset_id'),'dataset_sha256':(context.get('dataset') or {}).get('sha256'),
            'images':[{k:image.get(k) for k in ('id','sha256','preview_sha256')} for image in sorted(context['images'],key=lambda item:item['id'])]}


def source_signature(context):
    result=grant_signature(context)
    result.update(active_note=context.get('active_note'),active_image=context.get('active_image'))
    if context.get('pinned_notes'):result['pinned_notes']=context['pinned_notes']
    chart=context.get('active_chart')
    if chart:result['chart']={k:chart.get(k) for k in ('id','data_sha256','revision')}
    return result


class AgentTasks:
    def __init__(self,workspace,agent_store):
        self.workspace,self.agent_store=workspace,agent_store
        self.store=workspace.store

    @staticmethod
    def public(row):
        fields=('id','document_id','conversation_id','goal','dataset_id','dataset_sha256','dataset_name',
                'phase','status','revision','generation','current_turn_id','analysis_id','chart_id','note_id','created_at','updated_at')
        result={key:row[key] for key in fields}
        result.update(reading_context=json.loads(row['reading_json']),turn_ids=json.loads(row['turn_ids_json']),
                      error=json.loads(row['error_json']) if row['error_json'] else None)
        result['page']=result['reading_context']['page']
        return result

    @staticmethod
    def row(connection,document_id,identifier):
        row=connection.execute('SELECT * FROM agent_tasks WHERE id=? AND document_id=?',(identifier,document_id)).fetchone()
        if row is None:raise WorkspaceError('not_found','找不到这项接续任务。',404)
        return dict(row)

    def get(self,document_id,identifier):
        with self.store.connection() as connection:return self.public(self.row(connection,document_id,identifier))

    def list(self,document_id,conversation_id=None):
        self.store.get_document(document_id)
        with self.store.connection() as connection:
            if conversation_id:
                self.agent_store.conversation(connection,document_id,conversation_id)
                rows=connection.execute('SELECT * FROM agent_tasks WHERE document_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 20',(document_id,conversation_id))
            else:
                rows=connection.execute('SELECT * FROM agent_tasks WHERE document_id=? ORDER BY updated_at DESC,id DESC LIMIT 20',(document_id,))
            return [self.public(dict(row)) for row in rows]

    @staticmethod
    def change(connection,row,**changes):
        fields={}
        for key,value in changes.items():
            name={'turn_ids':'turn_ids_json','error':'error_json'}.get(key,key)
            fields[name]=canonical(value) if key in ('turn_ids','error') and value is not None else value
        if all(row.get(key)==value for key,value in fields.items()):return
        fields.update(updated_at=now(),revision=row['revision']+1)
        connection.execute('UPDATE agent_tasks SET '+','.join(key+'=?' for key in fields)+' WHERE id=?',(*fields.values(),row['id']))
        row.update(fields)

    def start(self,document_id,payload,captured):
        if not captured.get('dataset'):
            raise WorkspaceError('agent_task_dataset_required','先选择并明确共享本任务的数据。',422)
        if not payload.message.strip():raise WorkspaceError('agent_task_goal_required','请写明本次研究目标。',422)
        identifier=str(payload.request_id)
        context={**captured,'task_id':identifier,'task_stage':'analysis','task_generation':0,'task_goal':payload.message}
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            if connection.execute('SELECT 1 FROM agent_tasks WHERE id=?',(identifier,)).fetchone():
                return self.agent_store.submit(document_id,payload,context,connection)
            if payload.conversation_id and connection.execute("SELECT 1 FROM agent_tasks WHERE conversation_id=? AND status!='completed'",(str(payload.conversation_id),)).fetchone():
                raise WorkspaceError('agent_task_busy','请先完成原任务，或在新对话中开始另一目标。',409)
            if connection.execute("SELECT COUNT(*) FROM agent_tasks WHERE status IN ('running','waiting_confirmation','waiting_analysis')").fetchone()[0]>=5:
                raise WorkspaceError('agent_task_limit','接续任务较多，请先完成或停止已有任务。',429)
            turn=self.agent_store.submit(document_id,payload,context,connection)
            timestamp=now();dataset=captured['dataset']
            connection.execute('''INSERT INTO agent_tasks
                (id,document_id,conversation_id,goal,dataset_id,dataset_sha256,dataset_name,scope_hash,
                 reading_json,phase,status,revision,generation,current_turn_id,turn_ids_json,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,'analysis','running',1,0,?,?,?,?)''',
                (identifier,document_id,turn['conversation_id'],payload.message,dataset['id'],dataset['sha256'],dataset['original_filename'],
                 digest(source_signature(captured)),canonical(payload.context.model_dump(mode='json')),identifier,canonical([identifier]),timestamp,timestamp))
            return turn

    def task_for_turn(self,connection,turn):
        identifier=turn['context'].get('task_id')
        if not identifier:return None
        return self.row(connection,turn['document_id'],identifier)

    @staticmethod
    def matches(row,turn):
        return (row['status'] in ACTIVE and row['current_turn_id']==turn['id'] and
                row['generation']==turn['context'].get('task_generation') and row['phase']==turn['context'].get('task_stage'))

    def active(self,turn):
        if not turn['context'].get('task_id'):return True
        with self.store.connection() as connection:
            row=self.task_for_turn(connection,turn)
            return self.matches(row,turn) and row['status']=='running'

    def functions(self,turn,functions):
        if not turn['context'].get('task_id'):return functions
        allowed=READ_TOOLS|WRITE_TOOLS[turn['context']['task_stage']]
        return [function for function in functions if function['function']['name'] in allowed]

    def check_tool(self,turn,name):
        if not turn['context'].get('task_id'):return
        if not self.active(turn):raise WorkspaceError('agent_task_paused','接续已停止，本次调用不再执行。',409)
        if name not in READ_TOOLS|WRITE_TOOLS[turn['context']['task_stage']]:
            raise WorkspaceError('agent_task_stage','请只完成本任务当前阶段，不修改其他记录。',409)

    @staticmethod
    def instructions(turn):
        context=turn['context']
        if not context.get('task_id'):return None
        phase=context['task_stage']
        return ('This is an explicitly authorized THREE-STAGE research task: analysis, then chart, then a source note. '
                'User confirms EVERY write. Current stage is '+phase+'. Explain the overall plan briefly, then propose only this stage. '
                'When the stage is feasible, you MUST call its installed proposal tool ('+
                {'analysis':'propose_analysis, propose_t_test or propose_paired_t_test','chart':'propose_chart','note':'propose_note'}[phase]+
                ') to create the concrete pending UI proposal. The user confirms that UI proposal; do NOT ask for preliminary '
                'permission in prose or end with only a plan. A proposal call itself does NOT execute or save the business operation. '
                'Do not repeat completed work or treat queued analysis as success. Read actual saved owned records before deriving a chart/note. '
                'A result note must include BOTH persistent analysis and chart links. For a study, propose_note source_ref MUST be an analysis_result or chart_result reference from those saved results. Never infer trial design or significance from labels. '
                'If required information/capability is missing, explain and finish read-only; the task will wait for user input. '
                'Do not say the whole goal is complete before all three server receipts. Original user goal: '+context['task_goal']+
                ('\nAdditional user clarification: '+context['task_input'] if context.get('task_input') else ''))

    def validate_scope(self,connection,row,grant=None):
        reading=ReadingContext.model_validate(json.loads(row['reading_json']))
        current=self.workspace.capture(row['document_id'],reading)
        verify_source(self.store,current['document'])
        self.workspace.analysis.datasets.path(row['document_id'],row['dataset_id'])
        for image in current['images']:
            self.workspace.images.path(row['document_id'],image['id'])
            self.workspace.images.path(row['document_id'],image['id'],True)
        if row['phase'] in ('chart','note'):
            self.workspace.analysis.result(row['document_id'],row['analysis_id'])
        if row['phase']=='note':self.workspace.charts.data_in(connection,row['document_id'],row['chart_id'])
        if digest(source_signature(current))!=row['scope_hash']:
            raise WorkspaceError('agent_task_scope_changed','任务原资料发生变化，请恢复原资料或重新发起任务。',409)
        if grant is not None:
            fresh=self.workspace.capture(row['document_id'],grant)
            same_anchor=grant.page==reading.page and grant.rect==reading.rect
            if not same_anchor or grant_signature(fresh)!=grant_signature(current):
                raise WorkspaceError('agent_task_scope_changed','请明确共享原任务的数据和图片，再从原来源继续。',409)
        return current

    def guard_proposal(self,connection,turn,kind,payload,confirming=False):
        row=self.task_for_turn(connection,turn)
        if row is None:return
        if not self.matches(row,turn):raise WorkspaceError('agent_task_paused','接续已停止，请重新核对资料后继续。',409)
        if kind not in WRITES[row['phase']]:raise WorkspaceError('agent_task_stage','这项操作不属于任务当前阶段。',409)
        if row['phase']!='note' and (payload.get('dataset_id')!=row['dataset_id'] or payload.get('dataset_sha256')!=row['dataset_sha256']):
            raise WorkspaceError('agent_task_scope_changed','建议不属于任务已授权的数据。',409)
        if kind=='create_chart' and payload.get('analysis_id') not in (None,row['analysis_id']):
            raise WorkspaceError('agent_task_stage','图表只能关联本任务实际成功的分析。',409)
        if kind=='create_note':self.check_note_sources(row,turn,payload)
        if confirming:
            self.validate_scope(connection,row)
        elif connection.execute("SELECT 1 FROM agent_proposals WHERE turn_id=? AND status IN ('pending','conflict','applied')",(turn['id'],)).fetchone():
            raise WorkspaceError('agent_task_stage','当前阶段已有一份具体方案，请等待用户确认。',409)

    @staticmethod
    def check_note_sources(row,turn,payload):
        analysis_id,chart_id=row['analysis_id'],row['chart_id']
        sources=turn['sources'];text=payload.get('text','')
        analysis_read=any(s['kind']=='analysis_result' and s.get('analysis_id')==analysis_id and s['url'] in text for s in sources)
        chart_read=any(s['kind']=='chart_result' and s.get('chart_id')==chart_id and s['url'] in text for s in sources)
        if not (analysis_id and chart_id and analysis_id in text and chart_id in text and analysis_read and chart_read):
            raise WorkspaceError('agent_task_sources_required','先读取本任务已保存的分析与图表，并在笔记中保留两条真实记录链接。',409)
        source=payload.get('source')
        if source is not None and (source.get('kind'),source.get('id')) not in (('analysis',analysis_id),('chart',chart_id)):
            raise WorkspaceError('agent_task_sources_required','结果笔记需引用本任务已保存的分析或图表来源。',409)

    def control(self,document_id,identifier,payload):
        fingerprint=digest({'document_id':document_id,'task_id':identifier,'payload':payload.model_dump(mode='json')})
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row=self.row(connection,document_id,identifier)
            previous=connection.execute('SELECT * FROM agent_task_operations WHERE request_id=?',(str(payload.request_id),)).fetchone()
            if previous:
                if previous['task_id']!=identifier or previous['payload_hash']!=fingerprint:
                    raise WorkspaceError('idempotency_conflict','控制请求编号已用于其他内容。',409)
                return json.loads(previous['result_json'])
            if row['generation']!=payload.expected_generation:
                raise WorkspaceError('agent_task_control_conflict','任务控制状态已更新，请刷新后再操作。',409)
            if row['status']=='completed':raise WorkspaceError('agent_task_invalid_state','任务已经完成。',409)
            if payload.action=='stop':self.pause(connection,row,payload.reason)
            else:self.resume(connection,row,payload)
            result=self.public(row)
            connection.execute('INSERT INTO agent_task_operations VALUES (?,?,?,?,?)',
                               (str(payload.request_id),identifier,fingerprint,canonical(result),now()))
            return result

    def pause(self,connection,row,reason):
        connection.execute("UPDATE agent_turns SET status='cancelled',updated_at=? WHERE id=? AND status IN ('queued','running','waiting_confirmation')",(now(),row['current_turn_id']))
        message='数据共享已改变，后续助手调用已停止。' if reason=='sharing_changed' else '已停止接续；已提交的分析可在分析区单独停止。'
        self.change(connection,row,status='paused',generation=row['generation']+1,error={'code':'agent_task_paused','message':message})

    def resume(self,connection,row,payload):
        if row['status'] not in ('paused','failed','needs_input'):
            raise WorkspaceError('agent_task_invalid_state','任务正在推进或等待确认，无需重复继续。',409)
        self.validate_scope(connection,row,payload.context)
        self.change(connection,row,status='running',generation=row['generation']+1,error=None)
        turn=self.agent_store.read(connection,row['document_id'],row['current_turn_id'])
        context=turn['context'];context['task_generation']=row['generation']
        connection.execute('UPDATE agent_turns SET context_json=? WHERE id=?',(canonical(context),turn['id']))
        pending=[p for p in turn['proposals'] if p['status']=='pending']
        if pending:
            connection.execute("UPDATE agent_turns SET status='waiting_confirmation',error_json=NULL,updated_at=? WHERE id=?",(now(),turn['id']))
            self.change(connection,row,status='waiting_confirmation')
            return
        if row['phase']=='analysis' and row['analysis_id']:
            job=self.workspace.analysis.row(connection,row['document_id'],row['analysis_id'])
            if job['status'] not in ('queued','running','succeeded'):
                self.change(connection,row,analysis_id=None)
                return self.queue(connection,row,'analysis',payload.message)
        if turn['status']=='completed' and any(p['status']=='applied' for p in turn['proposals']):
            return self.advance_in(connection,row)
        connection.execute("UPDATE agent_turns SET status='cancelled',updated_at=? WHERE id=? AND status IN ('queued','running','waiting_confirmation')",(now(),turn['id']))
        self.queue(connection,row,row['phase'],payload.message)

    def queue(self,connection,row,phase,clarification=''):
        identifiers=json.loads(row['turn_ids_json'])
        if len(identifiers)>=8:raise WorkspaceError('agent_task_limit','本任务已达接续上限，请检查记录后开启新对话。',409)
        self.validate_scope(connection,row)
        reading=ReadingContext.model_validate(json.loads(row['reading_json']))
        updates={}
        if phase in ('chart','note'):updates['active_analysis_id']=UUID(row['analysis_id'])
        if phase=='note':updates['active_chart_id']=UUID(row['chart_id'])
        reading=reading.model_copy(update=updates)
        captured=self.workspace.capture(row['document_id'],reading)
        captured.update(task_id=row['id'],task_stage=phase,task_generation=row['generation'],task_goal=row['goal'],task_input=clarification)
        identifier=str(uuid5(UUID(row['id']),'research-task-turn:'+str(len(identifiers))))
        payload=AgentSubmission(request_id=identifier,conversation_id=row['conversation_id'],message=STAGE_MESSAGES[phase],context=reading)
        self.agent_store.submit(row['document_id'],payload,captured,connection)
        self.change(connection,row,phase=phase,status='running',current_turn_id=identifier,turn_ids=identifiers+[identifier],error=None)

    def tick(self):
        with self.store.connection() as connection:
            rows=connection.execute("SELECT id,document_id FROM agent_tasks WHERE status IN ('running','waiting_confirmation','waiting_analysis') ORDER BY created_at LIMIT 5").fetchall()
        for row in rows:
            try:self.advance(row['document_id'],row['id'])
            except WorkspaceError as error:self.fail(row['document_id'],row['id'],error)
            except (OSError,sqlite3.Error):continue
            except Exception:self.fail(row['document_id'],row['id'],WorkspaceError('agent_task_error','接续遇到错误，请检查已有记录后继续。',503))

    def advance(self,document_id,identifier):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE');row=self.row(connection,document_id,identifier)
            if row['status'] not in ACTIVE:return
            self.advance_in(connection,row)

    def advance_in(self,connection,row):
        turn=self.agent_store.read(connection,row['document_id'],row['current_turn_id'])
        if turn['status'] in ('queued','running'):return self.change(connection,row,status='running')
        if turn['status']=='waiting_confirmation':return self.change(connection,row,status='waiting_confirmation')
        if turn['status'] in ('failed','cancelled','interrupted'):
            status='paused' if turn['status'] in ('cancelled','interrupted') else 'failed'
            return self.change(connection,row,status=status,error=turn['error'] or {'code':'agent_task_paused','message':'助手请求已停止，可核对资料后继续。'})
        applied=[p for p in turn['proposals'] if p['kind'] in WRITES[row['phase']] and p['status']=='applied']
        if not applied:
            return self.change(connection,row,status='needs_input',error={'code':'agent_task_input','message':turn['answer'][:2000] or '请补充研究问题或所需资料，再继续。'})
        receipt=applied[0]['result']
        if row['phase']=='analysis':return self.after_analysis(connection,row,receipt)
        if row['phase']=='chart':return self.after_chart(connection,row,receipt)
        self.validate_scope(connection,row)
        state=self.store.lifecycle.get(row['document_id'],receipt['note_id'])
        if state.get('deleted_at'):raise WorkspaceError('agent_task_scope_changed','任务笔记已删除，请检查保存记录。',409)
        self.change(connection,row,status='completed',note_id=receipt['note_id'],error=None)

    def after_analysis(self,connection,row,receipt):
        identifier=receipt['analysis_id'];job=self.workspace.analysis.row(connection,row['document_id'],identifier)
        if job['dataset_id']!=row['dataset_id']:raise WorkspaceError('agent_task_scope_changed','分析不属于本任务数据。',409)
        self.change(connection,row,analysis_id=identifier)
        if job['status'] in ('queued','running'):return self.change(connection,row,status='waiting_analysis')
        if job['status']!='succeeded':return self.change(connection,row,status='failed',error={'code':'agent_task_analysis_failed','message':'分析未成功；继续后会重新提出待确认方案，不会直接重跑。'})
        self.workspace.analysis.result(row['document_id'],identifier)
        self.queue(connection,row,'chart')

    def after_chart(self,connection,row,receipt):
        record,_=self.workspace.charts.data_in(connection,row['document_id'],receipt['chart_id'])
        if record['dataset_id']!=row['dataset_id']:raise WorkspaceError('agent_task_scope_changed','图表不属于本任务数据。',409)
        self.change(connection,row,chart_id=record['id'])
        self.queue(connection,row,'note')

    def fail(self,document_id,identifier,error):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE');row=self.row(connection,document_id,identifier)
            if row['status'] not in ACTIVE:return
            connection.execute("UPDATE agent_turns SET status='failed',error_json=?,updated_at=? WHERE id=? AND status IN ('queued','running')",
                               (canonical({'code':error.code,'message':error.message}),now(),row['current_turn_id']))
            self.change(connection,row,status='failed',error={'code':error.code,'message':error.message})

    def recover(self):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            connection.execute("UPDATE agent_tasks SET status='paused',generation=generation+1,revision=revision+1,error_json=?,updated_at=? WHERE status IN ('running','waiting_confirmation','waiting_analysis')",
                               (canonical({'code':'agent_interrupted','message':'服务已重启，核对原数据并共享后可继续；不会自动重跑。'}),now()))
