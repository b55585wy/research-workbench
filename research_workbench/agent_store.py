from datetime import datetime,timezone
import hashlib
import json
from uuid import uuid4

from .models import WorkspaceError
from .conversation_lifecycle import is_cleared,reject_cleared

ACTIVE=('queued','running','waiting_confirmation')
TERMINAL=('completed','failed','cancelled','interrupted')


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def submission_hash(document_id,payload):
    value=payload.model_dump(mode='json')
    if not value.get('continue_task'):value.pop('continue_task',None)
    for key in ('dataset_id','active_analysis_id','active_image','active_chart_id'):
        if value['context'].get(key) is None:value['context'].pop(key,None)
    return digest({'document_id':document_id,'payload':value})


class AgentStore:
    def __init__(self,store):
        self.store=store

    def conversation(self,connection,document_id,identifier,allow_closed=False):
        row=connection.execute('SELECT * FROM agent_conversations WHERE id=? AND document_id=?',(identifier,document_id)).fetchone()
        if row is None:raise WorkspaceError('not_found','找不到这段对话。',404)
        if not allow_closed:reject_cleared(connection,identifier)
        return dict(row)

    def conversations(self,document_id):
        self.store.get_document(document_id)
        with self.store.connection() as connection:
            return [dict(r) for r in connection.execute('''SELECT * FROM agent_conversations
                WHERE document_id=? AND NOT EXISTS(SELECT 1 FROM agent_conversation_clears c
                WHERE c.conversation_id=agent_conversations.id)
                ORDER BY updated_at DESC,id DESC''',(document_id,))]

    def history(self,document_id,identifier):
        with self.store.connection() as connection:
            conversation=self.conversation(connection,document_id,identifier)
            rows=connection.execute('SELECT id FROM agent_turns WHERE conversation_id=? ORDER BY created_at,id',(identifier,)).fetchall()
            turns=[self.read(connection,document_id,row['id']) for row in rows]
        return {'conversation':conversation,'turns':turns}

    def read(self,connection,document_id,identifier):
        row=connection.execute('SELECT * FROM agent_turns WHERE document_id=? AND id=?',(document_id,identifier)).fetchone()
        if row is None:raise WorkspaceError('not_found','找不到这次助手请求。',404)
        reject_cleared(connection,row['conversation_id'])
        result={key:value for key,value in dict(row).items() if key not in ('request_hash','context_json','sources_json','error_json')}
        result.update(context=json.loads(row['context_json']),sources=json.loads(row['sources_json']),error=json.loads(row['error_json']) if row['error_json'] else None)
        result['events']=[dict(r) for r in connection.execute('SELECT id,kind,title,status,summary,created_at FROM agent_events WHERE turn_id=? ORDER BY rowid',(identifier,))]
        from .agent_presentation_tools import plan_record
        plans=[record for event in result['events']
               if (record:=plan_record(document_id,event)) is not None]
        if plans:result['presentation_plans']=plans
        result['proposals']=[self.proposal_record(r) for r in connection.execute('SELECT * FROM agent_proposals WHERE turn_id=? ORDER BY rowid',(identifier,))]
        return result

    def get(self,document_id,identifier):
        with self.store.connection() as connection:
            return self.read(connection,document_id,identifier)

    @staticmethod
    def proposal_record(row):
        result={key:value for key,value in dict(row).items() if key not in ('turn_id','payload_json','result_json','error_json')}
        result.update(payload=json.loads(row['payload_json']),result=json.loads(row['result_json']) if row['result_json'] else None,
                      error=json.loads(row['error_json']) if row['error_json'] else None)
        return result

    def submit(self,document_id,payload,context,connection=None):
        if connection is None:
            with self.store.connection() as owned:
                owned.execute('BEGIN IMMEDIATE')
                return self.submit(document_id,payload,context,owned)
        if not connection.in_transaction:raise ValueError('A transaction is required')
        request_id=str(payload.request_id)
        fingerprint=submission_hash(document_id,payload)
        previous=connection.execute('SELECT * FROM agent_turns WHERE id=?',(request_id,)).fetchone()
        if previous is not None:
            reject_cleared(connection,previous['conversation_id'])
            if previous['request_hash']!=fingerprint:raise WorkspaceError('idempotency_conflict','这次助手请求与已有记录冲突。',409)
            return self.read(connection,document_id,request_id)
        conversation_id=str(payload.conversation_id) if payload.conversation_id else str(uuid4())
        if payload.conversation_id:
            self.conversation(connection,document_id,conversation_id)
        else:
            timestamp=now()
            connection.execute('INSERT INTO agent_conversations VALUES (?,?,?,?,?)',(
                conversation_id,document_id,(payload.message or '图片阅读')[:80],timestamp,timestamp))
        task=connection.execute("SELECT id FROM agent_tasks WHERE conversation_id=? AND status IN ('running','waiting_confirmation','waiting_analysis')",(conversation_id,)).fetchone()
        if task and task['id']!=context.get('task_id'):
            raise WorkspaceError('agent_task_busy','本对话还有接续任务，请先停止接续或打开新对话。',409)
        if connection.execute("SELECT 1 FROM agent_turns WHERE conversation_id=? AND status IN ('queued','running','waiting_confirmation')",(conversation_id,)).fetchone():
            raise WorkspaceError('agent_busy','这段对话还有未完成请求，请先完成或取消。',409)
        if connection.execute("SELECT COUNT(*) FROM agent_turns WHERE status IN ('queued','running')").fetchone()[0]>=10:
            raise WorkspaceError('agent_busy','助手请求较多，请稍后重试。',429)
        timestamp=now()
        connection.execute('''INSERT INTO agent_turns
            (id,document_id,conversation_id,request_hash,message,context_json,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,'queued',?,?)''',(
            request_id,document_id,conversation_id,fingerprint,payload.message,canonical(context),timestamp,timestamp))
        connection.execute('UPDATE agent_conversations SET updated_at=? WHERE id=?',(timestamp,conversation_id))
        return self.read(connection,document_id,request_id)

    def update(self,document_id,identifier,expected_turn=None,**changes):
        allowed={'status','answer','context','sources','error'}
        if set(changes)-allowed:raise ValueError('Unknown turn field')
        fields={({'context':'context_json','sources':'sources_json','error':'error_json'}.get(k,k)):
                (canonical(v) if k in ('context','sources','error') and v is not None else v) for k,v in changes.items()}
        fields['updated_at']=now()
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            current=self.read(connection,document_id,identifier)
            if current['status'] in TERMINAL:return current
            if expected_turn and expected_turn['context'].get('task_id'):
                context=expected_turn['context']
                task=connection.execute('SELECT * FROM agent_tasks WHERE id=?',(context['task_id'],)).fetchone()
                if not task or task['status']!='running' or task['current_turn_id']!=identifier or task['generation']!=context.get('task_generation'):
                    return current
            connection.execute('UPDATE agent_turns SET '+','.join(k+'=?' for k in fields)+' WHERE id=?',(*fields.values(),identifier))
            return self.read(connection,document_id,identifier)

    def event(self,identifier,kind,title,status='completed',summary=''):
        with self.store.connection() as connection:
            connection.execute('INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)',(
                str(uuid4()),identifier,kind,title,status,summary[:2000],now()))

    def publish_presentation_plan(self,document_id,identifier,title,summary,expected_sha):
        """Publish one plan event only while this exact turn may still act.

        PDF extraction already happened outside this method.  Every fence is
        re-read in the same BEGIN IMMEDIATE transaction as the dedupe/insert,
        so a cancel, conversation clear, lost grant or changed source during
        extraction cannot leave an actionable plan.  No model call and no PDF
        text extraction happens here.
        """
        from .agent_presentation_tools import (MAX_SUMMARY,MAX_TITLE,PLAN_KIND,
            presentation_context_granted)
        from .library import read_metadata
        if not isinstance(title,str) or not 1 <= len(title) <= MAX_TITLE:
            return None
        if not isinstance(summary,str) or not 1 <= len(summary) <= MAX_SUMMARY:
            return None
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row=connection.execute('SELECT * FROM agent_turns WHERE id=? AND document_id=?',
                (identifier,document_id)).fetchone()
            if row is None or row['status']!='running':
                return None
            reject_cleared(connection,row['conversation_id'])
            try:context=json.loads(row['context_json'])
            except (TypeError,ValueError):return None
            if not presentation_context_granted(context):
                return None
            document=read_metadata(connection,document_id)
            if document.get('kind')=='study' or document.get('page_count') is None:
                return None
            if document.get('sha256')!=expected_sha:
                raise WorkspaceError('source_changed','原论文已变化，请核对资料后重试。',409)
            duplicate=connection.execute(
                "SELECT id FROM agent_events WHERE turn_id=? AND kind=? AND status='completed' "
                "AND summary=? ORDER BY rowid LIMIT 1",(identifier,PLAN_KIND,summary)).fetchone()
            if duplicate is not None:return duplicate['id']
            event_id=str(uuid4())
            connection.execute('INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)',(
                event_id,identifier,PLAN_KIND,title,'completed',summary,now()))
            return event_id

    def cancel(self,document_id,identifier):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            current=self.read(connection,document_id,identifier)
            if current['status']=='cancelled':return current
            if current['status'] in TERMINAL:
                raise WorkspaceError('agent_invalid_state','这次请求已经结束。',409)
            connection.execute("UPDATE agent_turns SET status='cancelled',updated_at=? WHERE id=?",(now(),identifier))
            return self.read(connection,document_id,identifier)

    def recover(self):
        with self.store.connection() as connection:
            connection.execute("UPDATE agent_turns SET status='interrupted',error_json=?,updated_at=? WHERE status IN ('queued','running')",(
                canonical({'code':'agent_interrupted','message':'服务重启，请检查已有记录后重新发起；不会自动重复执行。'}),now()))

    def next_turn(self):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row=connection.execute("""SELECT id,document_id FROM agent_turns WHERE status='queued'
                AND NOT EXISTS(SELECT 1 FROM agent_conversation_clears c
                WHERE c.conversation_id=agent_turns.conversation_id) ORDER BY rowid LIMIT 1""").fetchone()
            if row is None:return None
            connection.execute("UPDATE agent_turns SET status='running',updated_at=? WHERE id=?",(now(),row['id']))
            return self.read(connection,row['document_id'],row['id'])
