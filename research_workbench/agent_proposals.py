import json
from uuid import UUID,uuid4,uuid5,NAMESPACE_URL

from .agent_models import ImageNoteCreate
from .agent_store import canonical,digest,now,TERMINAL
from .studies import verify_owner as verify_source
from .library import read_metadata
from .models import DocumentUpdate,NoteCreate,NoteUpdate,NoteMutation,WorkspaceError
from .note_lifecycle import read_state
from .analysis_models import AnalysisCreate
from .image_annotation_models import ImageAnnotationCreate,ImageAnnotationUpdate,ImageAnnotationMutation
from .chart_models import ChartCreate,ChartMutation


class Proposals:
    def __init__(self,store,agent_store,images,analysis=None):
        self.store,self.agent_store,self.images=store,agent_store,images
        self.analysis=analysis

    def add(self,turn,kind,title,payload,call_id):
        identifier=str(uuid5(UUID(turn['id']),call_id))
        fingerprint=digest({'kind':kind,'payload':payload})
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            current=self.agent_store.read(connection,turn['document_id'],turn['id'])
            if current['status'] not in ('running','queued'):
                raise WorkspaceError('agent_cancelled','助手请求已结束，本次建议未提交。',409)
            previous=connection.execute('SELECT * FROM agent_proposals WHERE id=?',(identifier,)).fetchone()
            if previous is not None:
                if previous['sha256']!=fingerprint:raise WorkspaceError('idempotency_conflict','功能调用编号发生冲突。',409)
                return self.agent_store.proposal_record(previous)
            guard=getattr(self,'task_guard',None)
            if guard:guard(connection,{**current,'context':turn['context']},kind,payload)
            connection.execute('INSERT INTO agent_proposals VALUES (?,?,?,?,?,?,\'pending\',NULL,NULL,?)',(
                identifier,turn['id'],kind,title,canonical(payload),fingerprint,now()))
        return {'proposal_id':identifier,'status':'pending','saved':False,'message':'已生成待确认建议，尚未保存。'}

    def confirm(self,document_id,turn_id,proposal_id,payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            turn=self.agent_store.read(connection,document_id,turn_id)
            row=connection.execute('SELECT * FROM agent_proposals WHERE id=? AND turn_id=?',(proposal_id,turn_id)).fetchone()
            if row is None:raise WorkspaceError('not_found','找不到这项建议。',404)
            self.check_decision(turn,row,payload)
            if row['status'] in ('applied','rejected'):
                return turn
            guard=getattr(self,'task_guard',None)
            if payload.approved and guard:guard(connection,turn,row['kind'],json.loads(row['payload_json']),confirming=True)
            error=self.decide(connection,document_id,row,payload.approved)
            if error is not None:return error
            remaining=connection.execute("SELECT COUNT(*) FROM agent_proposals WHERE turn_id=? AND status IN ('pending','conflict')",(turn_id,)).fetchone()[0]
            if not remaining:
                statuses=[r[0] for r in connection.execute('SELECT status FROM agent_proposals WHERE turn_id=?',(turn_id,))]
                message='已执行并保存确认的操作。' if 'applied' in statuses else '已取消建议，未保存修改。'
                connection.execute("UPDATE agent_turns SET status='completed',answer=?,updated_at=? WHERE id=?",(message,now(),turn_id))
            return self.agent_store.read(connection,document_id,turn_id)

    @staticmethod
    def check_decision(turn,row,payload):
        expected=digest({'kind':row['kind'],'payload':json.loads(row['payload_json'])})
        if row['sha256']!=payload.proposal_sha256 or row['sha256']!=expected:
            raise WorkspaceError('agent_proposal_changed','建议内容已变化，请重新查看。',409)
        if row['status']=='applied' and not payload.approved or row['status']=='rejected' and payload.approved:
            raise WorkspaceError('agent_decision_conflict','这项建议已经处理，不能更改先前决定。',409)
        if row['status'] in ('applied','rejected'):return
        if turn['status']!='waiting_confirmation':
            raise WorkspaceError('agent_invalid_state','这次请求当前不能确认操作。',409)
        if row['status']=='conflict' and payload.approved:
            raise WorkspaceError('revision_conflict','原建议与当前资料冲突，请保留建议并重新生成。',409)

    def decide(self,connection,document_id,row,approved):
        if not approved:
            connection.execute("UPDATE agent_proposals SET status='rejected',error_json=NULL WHERE id=?",(row['id'],))
            return None
        data=json.loads(row['payload_json'])
        # A savepoint prevents a failed business write from leaving half a receipt.
        connection.execute('SAVEPOINT proposed_write')
        try:
            result=self.apply(connection,document_id,row['id'],row['kind'],data)
            connection.execute("UPDATE agent_proposals SET status='applied',result_json=?,error_json=NULL WHERE id=?",(canonical(result),row['id']))
            connection.execute('RELEASE proposed_write')
        except WorkspaceError as error:
            connection.execute('ROLLBACK TO proposed_write');connection.execute('RELEASE proposed_write')
            if error.status!=409:raise
            connection.execute("UPDATE agent_proposals SET status='conflict',error_json=? WHERE id=?",(
                canonical({'code':error.code,'message':error.message}),row['id']))
            # Persist the conflict while returning the intact original proposal.
            return {'conflict':error,'turn':self.agent_store.read(connection,document_id,row['turn_id'])}
        return None

    def apply(self,connection,document_id,proposal_id,kind,data):
        if data.get('document_id')!=document_id:
            raise WorkspaceError('agent_scope','建议不属于当前论文。',409)
        document=self.store.get_document(document_id)
        if data.get('source_sha256')!=document['sha256']:
            raise WorkspaceError('source_changed','原论文发生变化，请重新读取。',409)
        verify_source(self.store,document)
        request_id=str(uuid5(NAMESPACE_URL,'research-agent-proposal:'+proposal_id))
        if kind=='create_dataset_selection':
            from .selection_models import SelectionCreate
            if self.analysis is None:raise WorkspaceError('agent_tool_unavailable','分析服务尚未安装。',409)
            if data.get('request_id')!=request_id:raise WorkspaceError('agent_proposal_changed','筛选请求编号与建议不一致。',409)
            fields={k:data[k] for k in SelectionCreate.model_fields if k!='request_id' and k in data}
            child,_=self.analysis.datasets.selections.create_in(connection,document_id,SelectionCreate(request_id=request_id,**fields))
            return {'dataset_id':child['id'],'parent_dataset_id':str(fields['dataset_id']),'name':child['original_filename'],
                    'sha256':child['sha256'],'row_count':child['row_count'],
                    'url':f"/api/v1/documents/{document_id}/datasets/{child['id']}"}
        if kind in ('create_chart','delete_chart','restore_chart'):
            service=getattr(self,'charts',None)
            if service is None:raise WorkspaceError('agent_tool_unavailable','绘图工具尚未安装。',409)
            if kind=='create_chart':
                if data.get('request_id')!=request_id:raise WorkspaceError('agent_proposal_changed','图表请求编号与建议不一致。',409)
                fields={k:data[k] for k in ChartCreate.model_fields if k!='request_id' and k in data}
                chart,_=service.create_in(connection,document_id,ChartCreate(request_id=request_id,**fields),origin='agent_proposal')
            else:
                payload=ChartMutation(request_id=request_id,expected_revision=data['expected_revision'],data_sha256=data['data_sha256'])
                chart=service.mutate_in(connection,document_id,data['chart_id'],'delete' if kind=='delete_chart' else 'restore',payload)
            return {'chart_id':chart['id'],'dataset_id':chart['dataset_id'],'kind':chart['kind'],'revision':chart['revision'],'url':chart['viewer_url']}
        if kind in ('run_analysis','run_t_test','run_paired_t_test'):
            if self.analysis is None:raise WorkspaceError('agent_tool_unavailable','分析服务尚未安装。',409)
            fields={key:data[key] for key in ('dataset_id','dataset_sha256','engine','columns','recipe_sha256')}
            if kind=='run_t_test':fields.update({key:data[key] for key in ('method','ttest','library_sha256')})
            if kind=='run_paired_t_test':fields.update({key:data[key] for key in ('method','paired','library_sha256')})
            row,_=self.analysis.create_in(connection,document_id,AnalysisCreate(request_id=request_id,**fields))
            return {'analysis_id':row['id'],'status':row['status'],'url':f"/?document={document_id}&analysis={row['id']}"}
        if kind=='cancel_analysis':
            row=self.analysis.row(connection,document_id,data['analysis_id'])
            if row['dataset_id']!=data['dataset_id']:raise WorkspaceError('analysis_scope','分析来源不匹配。',409)
            source=self.analysis.datasets.row(connection,document_id,data['dataset_id']);self.analysis.datasets.checked(source)
            if source['sha256']!=data['dataset_sha256']:raise WorkspaceError('dataset_changed','数据版本已改变。',409)
            connection.execute("UPDATE analysis_jobs SET status='cancelled',finished_at=? WHERE id=? AND status IN ('queued','running')",(now(),row['id']))
            row=self.analysis.row(connection,document_id,row['id'])
            return {'analysis_id':row['id'],'status':row['status'],'url':f"/?document={document_id}&analysis={row['id']}"}
        if kind=='create_note':
            fields={key:data[key] for key in ('page','rect','text')}
            if 'source' in data:fields['source']=data['source']
            if 'rich_content' in data:fields['rich_content']=data['rich_content']
            if data.get('image_ids'):
                for image in data['image_ids']:self.images.path(document_id,image)
                note,_=self.images.create_note(document_id,ImageNoteCreate(request_id=request_id,**fields,image_ids=data['image_ids']),connection)
            else:
                note,_=self.store.save_note_in(connection,document_id,NoteCreate(request_id=request_id,**fields))
            return {'outcome':'created','note_id':note['id'],'document_id':document_id,'url':f"/?document={document_id}&note={note['id']}"}
        if kind in ('create_image_annotation','edit_image_annotation','delete_image_annotation','restore_image_annotation'):
            service=getattr(self,'image_annotations',None)
            if service is None:raise WorkspaceError('agent_tool_unavailable','图片标注服务尚未接入。',409)
            hashes={'source_sha256':data['image_source_sha256'],'frame_sha256':data['frame_sha256']}
            if kind=='create_image_annotation':
                value,_=service.create_in(connection,document_id,data['source_kind'],data['source_id'],
                    ImageAnnotationCreate(request_id=request_id,**hashes,rect=data['rect'],text=data['text']),origin='agent_proposal')
            else:
                action={'edit_image_annotation':'patch','delete_image_annotation':'delete','restore_image_annotation':'restore'}[kind]
                cls=ImageAnnotationUpdate if action=='patch' else ImageAnnotationMutation
                payload=cls(request_id=request_id,expected_revision=data['expected_revision'],**hashes,**(data['changes'] if action=='patch' else {}))
                value=service.mutate_in(connection,document_id,data['source_kind'],data['source_id'],data['annotation_id'],action,payload)
            return {'outcome':kind,'annotation_id':value['id'],'source_kind':value['source_kind'],'source_id':value['source_id'],
                    'document_id':document_id,'revision':value['revision'],'url':value['viewer_url']}
        if kind=='edit_metadata':
            value=self.store.library.update_in(connection,document_id,DocumentUpdate(request_id=request_id,
                expected_revision=data['expected_revision'],**data['changes']))
            return {'outcome':'updated','document_id':document_id,'revision':value['revision']}
        operation={'edit_note':'patch','delete_note':'delete','restore_note':'restore'}.get(kind)
        if operation is None:raise WorkspaceError('agent_tool_unavailable','这项操作尚未接入。',409)
        cls=NoteUpdate if kind=='edit_note' else NoteMutation
        change={'text':data['text']} if kind=='edit_note' else {}
        if kind=='edit_note' and 'rich_content' in data:change['rich_content']=data['rich_content']
        value=self.store.lifecycle.mutate_in(connection,document_id,data['note_id'],operation,
            cls(request_id=request_id,expected_revision=data['expected_revision'],**change))
        return {'outcome':operation,'note_id':value['id'],'document_id':document_id,'revision':value['revision'],
                'url':f"/?document={document_id}&note={value['id']}"}
