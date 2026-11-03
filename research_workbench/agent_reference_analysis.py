"""Confirmed descriptive reference analysis on an explicitly permitted owner.

The user must pin a dataset reference with ``allow_analysis`` true in the
current chat.  This module only reads that persisted grant from the captured
turn; it never trusts a model-supplied permission, path or code.  Capabilities
and listings are bounded metadata reads, the proposal is a frozen server-derived
payload, and result reads verify the actual saved summary bytes of the original
owner instead of regenerating or executing anything.
"""
import json
from typing import Literal
from uuid import UUID,uuid4

from pydantic import BaseModel,ConfigDict,Field,field_validator

from .agent_references import owner_kind,verify_dataset
from .agent_store import canonical
from .analysis_models import AnalysisCreate
from .analysis_recipes import recipe
from .image_sources import checked_bytes
from .models import WorkspaceError

MAX_NUMERIC_CAPABILITY_COLUMNS=50
MAX_PROPOSAL_COLUMNS=20
MAX_LISTED_ANALYSES=20
MAX_LIST_CANDIDATES=200
MAX_SUMMARY_BYTES=1024*1024
MAX_STATS=20
MAX_SOURCE_CHARS=24000


class ReferenceAnalysisBase(BaseModel):
    model_config=ConfigDict(extra='forbid')


class ReferenceAnalysisArguments(ReferenceAnalysisBase):
    document_id:UUID
    dataset_id:UUID


class ReferenceAnalysisProposal(ReferenceAnalysisArguments):
    engine:Literal['python','r']
    columns:list[str]=Field(min_length=1,max_length=MAX_PROPOSAL_COLUMNS)

    @field_validator('columns')
    @classmethod
    def unique_columns(cls,value):
        if len(set(value))!=len(value) or any(not c or len(c)>100 for c in value):
            raise ValueError('Invalid columns')
        return value


class ReferenceAnalysisReceipt(ReferenceAnalysisArguments):
    analysis_id:UUID


REFERENCE_ANALYSIS_DEFINITIONS=[
    ('reference_analysis_capabilities','查看参考资料分析能力',
     'Read actual metadata of ONE dataset the user explicitly permitted for analysis: id, hash, row/column counts, '
     'numeric column names/nonempty/missing (at most50) and installed Python/R describe capability. No raw rows, full table, '
     'statistics or job submission. A pin without the explicit analysis grant rejects this tool.',ReferenceAnalysisArguments,'read'),
    ('propose_reference_analysis','建议在原数据位置运行描述统计',
     'Propose a FIXED descriptive method=describe job in Python or R on 1-20 unique actual numeric columns of the explicitly '
     'permitted referenced dataset. The original data owner and result location stay unchanged; full-table calculation runs '
     'in the existing separate worker only after concrete user confirmation. No arbitrary code, script, hash or label.',ReferenceAnalysisProposal,'write'),
    ('list_reference_analyses','查看参考资料分析记录',
     'List bounded actual metadata of the NEWEST 20 confirmed describe-only analyses stored in the original owner for this '
     'explicitly permitted dataset. Queued/running is NOT success. No full result, log, profile, code or file is returned and '
     'no supervisor or worker is contacted.',ReferenceAnalysisArguments,'read'),
    ('read_reference_analysis','读取参考资料已保存结果',
     'Read the verified actual saved summary of ONE succeeded describe analysis stored in the original owner for this '
     'explicitly permitted dataset. The grant, original owner, dataset bytes, recorded summary size/SHA-256 and saved result '
     'are re-checked; at most20 actual stats are returned with total/truncated flags. No saved code, notebook or log.',ReferenceAnalysisReceipt,'read'),
]


def grant_error():
    return WorkspaceError('reference_analysis_not_allowed',
        '这份参考资料未获允许进行 Python/R 全表描述统计，请由用户在资料中明确开启后重试。',409)


def source_changed():
    return WorkspaceError('reference_analysis_changed',
        '参考资料分析记录或结果已发生变化，请重新读取后再引用。',409)


def analysis_grant(context,document_id,dataset_id):
    """Return the persisted dataset grant with allow_analysis true, or reject.

    The grant is read from the captured TURN snapshot, never from model arguments.
    """
    for reference in context.get('resource_refs',[]):
        if reference.get('kind')!='dataset':
            continue
        if str(reference.get('document_id'))!=str(document_id):
            continue
        if str(reference.get('dataset_id'))!=str(dataset_id):
            continue
        if reference.get('allow_analysis') is not True:
            raise grant_error()
        return reference
    raise grant_error()


def output_item(outputs,name):
    try:
        value=json.loads(outputs or '[]')
    except (TypeError,ValueError):
        raise source_changed() from None
    if not isinstance(value,list):
        raise source_changed()
    items=[item for item in value if isinstance(item,dict) and item.get('name')==name]
    if len(items)!=1:
        raise source_changed()
    return items[0]


def summary_text(row_count,stats,total):
    returned=stats[:MAX_STATS]
    value={'row_count':row_count,'stats':returned,'total_stats':total,
           'returned_stats':len(returned),'stats_truncated':total>len(returned)}
    text=canonical(value)
    if len(text)>MAX_SOURCE_CHARS:
        raise WorkspaceError('reference_analysis_too_large',
            '已保存结果的可用摘要超出本次可引用的长度上限，请缩小列范围后重新运行。',409)
    return text,returned


def checked_reference_analysis(workspace,context,document_id,dataset_id,analysis_id,expected_result_sha=None):
    """Verify and return the actual saved summary of a permitted describe job.

    Only the ORIGINAL owner/dataset scoped job is considered.  The recorded
    summary.json metadata and actual file bytes must match the saved result, and
    the dataset bytes plus original owner are re-verified before and after.  No
    analysis supervisor, saved notebook, log or worker is contacted and no source
    is written here.
    """
    reference=analysis_grant(context,document_id,dataset_id)
    if workspace.analysis is None:
        raise WorkspaceError('agent_tool_unavailable','分析服务尚未安装。',409)
    owner,dataset=verify_dataset(workspace.store,workspace.analysis,
        str(document_id),str(dataset_id),reference['sha256'],reference.get('owner_sha256'))
    with workspace.store.connection() as connection:
        if not connection.in_transaction:
            connection.execute('BEGIN')
        row=connection.execute(
            'SELECT * FROM analysis_jobs WHERE id=? AND document_id=? AND dataset_id=?',
            (str(analysis_id),str(document_id),str(dataset_id))).fetchone()
    if row is None:
        raise WorkspaceError('not_found','找不到原数据位置中的这项分析记录。',404)
    try:
        payload=json.loads(row['payload_json'])
    except (TypeError,ValueError):
        raise source_changed() from None
    if not isinstance(payload,dict):
        raise source_changed()
    if payload.get('method','describe')!='describe':
        raise WorkspaceError('unsupported_method',
            '只有经确认的固定描述统计（describe）结果可以在参考资料中读取。',409)
    if payload.get('engine') not in ('python','r') or str(payload.get('dataset_id'))!=str(dataset_id):
        raise source_changed()
    if payload.get('dataset_sha256')!=reference['sha256']:
        raise source_changed()
    if row['status']!='succeeded':
        raise WorkspaceError('analysis_not_complete',
            '这项分析尚未成功完成，暂无可用结果；排队或运行中不等于成功。',409)
    item=output_item(row['outputs_json'],'summary.json')
    size,digest=item.get('byte_size'),item.get('sha256')
    if (not isinstance(size,int) or isinstance(size,bool) or not 0<size<=MAX_SUMMARY_BYTES
            or not isinstance(digest,str) or len(digest)!=64 or digest.lower()!=digest
            or any(c not in '0123456789abcdef' for c in digest)):
        raise source_changed()
    if expected_result_sha is not None and digest!=expected_result_sha:
        raise source_changed()
    path=workspace.analysis.directory(row['id'])/'summary.json'
    try:
        data=checked_bytes(path,size,digest,MAX_SUMMARY_BYTES)
    except WorkspaceError:
        raise source_changed() from None
    try:
        result=json.loads(row['result_json'])
        actual=json.loads(data)
    except (TypeError,ValueError,UnicodeError):
        raise source_changed() from None
    if actual!=result or not isinstance(result,dict):
        raise source_changed()
    row_count,stats=result.get('row_count'),result.get('stats')
    if (not isinstance(row_count,int) or isinstance(row_count,bool) or row_count<0
            or not isinstance(stats,list)):
        raise source_changed()
    for stat in stats:
        if not isinstance(stat,dict) or not isinstance(stat.get('column'),str):
            raise source_changed()
    owner,dataset=verify_dataset(workspace.store,workspace.analysis,
        str(document_id),str(dataset_id),reference['sha256'],reference.get('owner_sha256'))
    return {'owner':owner,'dataset':dataset,'row':row,'payload':payload,
            'result':result,'summary':item,'data':data}


class ReferenceAnalysisTools:
    """Four grant-checked tools; no writer, worker call or supervisor access."""

    def reference_dataset(self,reference):
        return verify_dataset(self.workspace.store,self.workspace.analysis,
            reference['document_id'],reference['dataset_id'],
            reference['sha256'],reference.get('owner_sha256'))

    def reference_analysis(self,document_id,dataset_id):
        reference=analysis_grant(self.turn['context'],str(document_id),str(dataset_id))
        owner,dataset=self.reference_dataset(reference)
        if owner.get('kind')=='study':
            from .studies import verify_owner
            verify_owner(self.workspace.store,owner)
        return reference,owner,dataset

    def tool_reference_analysis_capabilities(self,data,call_id):
        reference,owner,dataset=self.reference_analysis(data.document_id,data.dataset_id)
        record=self.workspace.analysis.datasets.record(dataset)
        numeric=[{'name':column['name'],'nonempty':column['nonempty'],'missing':column['missing']}
                 for column in (record.get('columns') or []) if column.get('numeric')]
        engines=[]
        for engine in self.workspace.analysis.catalog.engines():
            code=recipe(engine['id'],'describe')
            engines.append({'engine':engine['id'],'available':engine['available'],
                            'version':engine['version'],'method':'describe',
                            'recipe_id':code['id'],'recipe_version':code['version'],
                            'recipe_sha256':code['sha256']})
        self.reference_analysis(data.document_id,data.dataset_id)
        return {'document_id':str(data.document_id),'dataset_id':str(data.dataset_id),
                'dataset_sha256':dataset['sha256'],'dataset_name':dataset['original_filename'],
                'owner_title':owner['title'],'owner_kind':owner_kind(owner),
                'row_count':record.get('row_count'),'column_count':record.get('column_count'),
                'numeric_columns':numeric[:MAX_NUMERIC_CAPABILITY_COLUMNS],
                'numeric_columns_truncated':len(numeric)>MAX_NUMERIC_CAPABILITY_COLUMNS,
                'engines':engines,'method':'describe','max_columns':MAX_PROPOSAL_COLUMNS,
                'notice':'Actual metadata only: no raw rows, full table or statistics were read and no job was submitted. '
                         'Only columns marked numeric are accepted; the user must explicitly confirm the proposal.'}

    def tool_propose_reference_analysis(self,data,call_id):
        reference,owner,dataset=self.reference_analysis(data.document_id,data.dataset_id)
        code=recipe(data.engine,'describe')
        payload=AnalysisCreate(request_id=uuid4(),dataset_id=data.dataset_id,dataset_sha256=dataset['sha256'],
            engine=data.engine,columns=list(data.columns),recipe_sha256=code['sha256'])
        with self.workspace.store.connection() as connection:
            self.workspace.analysis.validate(connection,str(data.document_id),payload)
        reference,owner,dataset=self.reference_analysis(data.document_id,data.dataset_id)
        content={**self.base_proposal(),
                 'target_document_id':str(data.document_id),
                 'target_source_sha256':reference['owner_sha256'],
                 'target_title':owner['title'],
                 'dataset_id':str(data.dataset_id),
                 'dataset_sha256':dataset['sha256'],
                 'dataset_name':dataset['original_filename'],
                 'engine':data.engine,'columns':list(data.columns),'method':'describe',
                 'recipe_sha256':code['sha256'],'recipe_id':code['id'],'recipe_version':code['version']}
        return self.proposals.add(self.turn,'run_reference_analysis','在原数据位置运行描述统计',content,call_id)

    def tool_list_reference_analyses(self,data,call_id):
        reference,owner,dataset=self.reference_analysis(data.document_id,data.dataset_id)
        with self.workspace.store.connection() as connection:
            if not connection.in_transaction:
                connection.execute('BEGIN')
            rows=connection.execute(
                'SELECT id,document_id,dataset_id,payload_json,status,created_at,finished_at '
                'FROM analysis_jobs WHERE document_id=? AND dataset_id=? ORDER BY rowid DESC LIMIT ?',
                (str(data.document_id),str(data.dataset_id),MAX_LIST_CANDIDATES)).fetchall()
        items=[];total=0
        for row in rows:
            try:
                payload=json.loads(row['payload_json'])
            except (TypeError,ValueError):
                continue
            if not isinstance(payload,dict) or payload.get('method','describe')!='describe':
                continue
            if payload.get('dataset_sha256')!=reference['sha256']:
                continue
            columns=payload.get('columns')
            if not isinstance(columns,list) or not all(isinstance(c,str) for c in columns):
                continue
            total+=1
            if len(items)>=MAX_LISTED_ANALYSES:
                continue
            items.append({'id':row['id'],'document_id':row['document_id'],'dataset_id':row['dataset_id'],
                          'engine':payload.get('engine'),'columns':columns,'status':row['status'],
                          'created_at':row['created_at'],'finished_at':row['finished_at']})
        self.reference_analysis(data.document_id,data.dataset_id)
        return {'document_id':str(data.document_id),'dataset_id':str(data.dataset_id),
                'dataset_sha256':reference['sha256'],'items':items,
                'truncated':total>MAX_LISTED_ANALYSES,
                'notice':'Bounded actual metadata only; queued or running is not success. '
                         'No result, log, saved code or profile is included and no supervisor was contacted.'}

    def tool_read_reference_analysis(self,data,call_id):
        reference=analysis_grant(self.turn['context'],str(data.document_id),str(data.dataset_id))
        value=checked_reference_analysis(self.workspace,self.turn['context'],
            data.document_id,data.dataset_id,data.analysis_id)
        owner,dataset,row=value['owner'],value['dataset'],value['row']
        payload,result,item=value['payload'],value['result'],value['summary']
        if payload.get('dataset_sha256')!=reference['sha256']:
            raise source_changed()
        text,returned=summary_text(result['row_count'],result['stats'],len(result['stats']))
        engine=payload.get('engine')
        source=self.sources.add('reference_analysis_result',
            (owner['title']+' · '+dataset['original_filename']+' · '+str(engine)),
            page=None,rect=None,document_id=owner['id'],analysis_id=row['id'],
            dataset_id=dataset['id'],dataset_sha256=dataset['sha256'],
            source_sha256=reference['owner_sha256'],result_sha256=item['sha256'],
            title=dataset['original_filename'],
            text=text,url=f"/?document={owner['id']}&analysis={row['id']}")
        return {'analysis':{'id':row['id'],'document_id':row['document_id'],
                            'dataset_id':row['dataset_id'],'engine':engine,
                            'engine_version':row['engine_version'],'method':'describe',
                            'columns':payload.get('columns'),'status':row['status'],
                            'created_at':row['created_at'],'finished_at':row['finished_at']},
                'document_id':owner['id'],'owner_title':owner['title'],'owner_kind':owner_kind(owner),
                'target_document_id':owner['id'],'dataset_id':dataset['id'],
                'dataset_name':dataset['original_filename'],'dataset_sha256':dataset['sha256'],
                'row_count':result['row_count'],'stats':returned,
                'total_stats':len(result['stats']),'returned_stats':len(returned),
                'stats_truncated':len(result['stats'])>len(returned),
                'result_sha256':item['sha256'],'source_ref':source['ref'],
                'notice':'Verified actual saved summary bytes from the original data owner. '
                         'No code was executed by this read; no raw file, log or saved notebook is provided. '
                         'Descriptive output is not scientific or clinical validation.'}
