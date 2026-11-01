import hashlib
import json
from pathlib import Path
from uuid import UUID

from .agent_store import canonical,digest,now
from .analysis_recipes import recipe
from .analysis_models import analysis_payload
from .models import WorkspaceError

ACTIVE=('queued','running')
TERMINAL=('succeeded','failed','cancelled','interrupted')
JOB_QUERY='SELECT j.*,d.original_filename AS dataset_name FROM analysis_jobs j JOIN datasets d ON d.id=j.dataset_id AND d.document_id=j.document_id'


class Analyses:
    def __init__(self,store,datasets,catalog):
        self.store,self.datasets,self.catalog=store,datasets,catalog
        self.root=store.root/'analyses';self.root.mkdir(exist_ok=True)
        self.supervisor=None

    def record(self,row):
        payload=json.loads(row['payload_json'])
        method=payload.get('method','describe');statistical=method in ('ttest_independent','ttest_paired')
        method_fields=('method','paired','library_sha256') if method=='ttest_paired' else ('method','ttest','library_sha256')
        prefix=f"/api/v1/documents/{row['document_id']}/analyses/{row['id']}"
        outputs=json.loads(row['outputs_json']) if row['status']=='succeeded' else []
        outputs=[{**r,'url':prefix+'/files/'+r['name']} for r in outputs]
        return {'id':row['id'],'document_id':row['document_id'],'dataset_id':row['dataset_id'],
            'dataset_name':row['dataset_name'],'dataset_sha256':payload['dataset_sha256'],
            'engine':payload['engine'],'columns':payload['columns'],
            'recipe':{'id':{'ttest_independent':'ttest-independent-rstats-v1','ttest_paired':'ttest-paired-rstats-v1'}.get(method,'describe-v1'),
                      'version':1,'sha256':payload['recipe_sha256'],
                      'code_url':'/api/v1/analysis/recipes/'+payload['engine']+('?method='+method if statistical else '')},
            **({k:payload[k] for k in method_fields} if statistical else {}),
            'status':row['status'],'result':json.loads(row['result_json']) if row['result_json'] else None,
            'error':json.loads(row['error_json']) if row['error_json'] else None,
            'created_at':row['created_at'],'started_at':row['started_at'],'finished_at':row['finished_at'],
            'engine_version':row['engine_version'],'outputs':outputs,'log_url':prefix+'/log',
            'export_url':prefix+'/export' if row['status']=='succeeded' else None}

    @staticmethod
    def row(connection,document_id,identifier):
        row=connection.execute(JOB_QUERY+' WHERE j.id=? AND j.document_id=?',(identifier,document_id)).fetchone()
        if row is None:raise WorkspaceError('not_found','找不到这项分析记录。',404)
        return row

    def get(self,document_id,identifier):
        if self.supervisor:self.supervisor.check()
        with self.store.connection() as connection:row=self.row(connection,document_id,identifier)
        return self.record(row)

    def list(self,document_id):
        if self.supervisor:self.supervisor.check()
        self.store.get_document(document_id)
        with self.store.connection() as connection:
            rows=connection.execute(JOB_QUERY+' WHERE j.document_id=? ORDER BY j.rowid DESC',(document_id,)).fetchall()
        return [self.record(r) for r in rows]

    def validate(self,connection,document_id,payload,*,probe_data=True):
        row=self.datasets.row(connection,document_id,str(payload.dataset_id));self.datasets.checked(row)
        if row['sha256']!=payload.dataset_sha256:
            raise WorkspaceError('dataset_changed','数据版本与确认内容不同，请重新选择。',409)
        code=recipe(payload.engine,payload.method)
        if code['sha256']!=payload.recipe_sha256:raise WorkspaceError('recipe_changed','分析代码版本已改变，请重新查看后确认。',409)
        info=self.catalog.require(payload.engine)
        profile=json.loads(row['profile_json'])
        allowed={c['name'] for c in profile['columns'] if c['numeric']}
        if not set(payload.columns).issubset(allowed):raise WorkspaceError('invalid_columns','请选择包含有限数值的列。',422)
        if payload.method=='ttest_independent':
            self.catalog.statistics.require(payload.library_sha256)
            from .statistics_service import probe
            if probe_data:probe(self,row,{'columns':payload.columns,'ttest':payload.ttest.model_dump(mode='json')})
        if payload.method=='ttest_paired':
            self.catalog.statistics.require(payload.library_sha256)
            from .paired_statistics import probe
            if probe_data:probe(self,row,{'columns':payload.columns,'paired':payload.paired.model_dump(mode='json')})
        return row,info

    def create_in(self,connection,document_id,payload):
        identifier=str(payload.request_id)
        fingerprint=digest({'document_id':document_id,'payload':analysis_payload(payload)})
        old=connection.execute('SELECT * FROM analysis_jobs WHERE id=?',(identifier,)).fetchone()
        if old is not None:
            if old['document_id']!=document_id or old['request_hash']!=fingerprint:
                raise WorkspaceError('idempotency_conflict','运行编号已用于另一项分析。',409)
            return old,False
        _,engine=self.validate(connection,document_id,payload)
        if connection.execute("SELECT COUNT(*) FROM analysis_jobs WHERE status IN ('queued','running')").fetchone()[0]>=3:
            raise WorkspaceError('analysis_busy','当前分析队列已满，请等待现有任务。',409)
        if connection.execute('SELECT COUNT(*) FROM analysis_jobs WHERE document_id=?',(document_id,)).fetchone()[0]>=20:
            raise WorkspaceError('analysis_quota','这篇文献的分析记录已达上限。',409)
        connection.execute("INSERT INTO analysis_jobs VALUES (?,?,?,?,?,'queued',NULL,NULL,'[]',?,NULL,NULL,?)",
            (identifier,document_id,str(payload.dataset_id),fingerprint,canonical(analysis_payload(payload)),now(),engine['version']))
        return self.row(connection,document_id,identifier),True

    def create(self,document_id,payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE');row,created=self.create_in(connection,document_id,payload)
        self.notify()
        return self.get(document_id,row['id']),created

    def notify(self):
        if self.supervisor is not None:
            try:self.supervisor.ensure_started()
            except OSError:
                with self.store.connection() as connection:
                    connection.execute("UPDATE analysis_jobs SET status='failed',finished_at=?,error_json=? WHERE status='queued'",
                        (now(),canonical({'code':'worker_unavailable','message':'分析进程未能启动，请检查运行环境后重新发起。'})))

    def cancel(self,document_id,identifier):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE');row=self.row(connection,document_id,identifier)
            if row['status'] in ACTIVE:
                connection.execute("UPDATE analysis_jobs SET status='cancelled',finished_at=? WHERE id=?",(now(),identifier))
        return self.get(document_id,identifier)

    def directory(self,identifier):
        name=str(UUID(identifier));path=self.root/name
        if not path.resolve().is_relative_to(self.root.resolve()):raise WorkspaceError('not_found','找不到分析文件。',404)
        return path

    def claim(self):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row=connection.execute("SELECT * FROM analysis_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").fetchone()
            if row is None:return None
            connection.execute("UPDATE analysis_jobs SET status='running',started_at=? WHERE id=?",(now(),row['id']))
            return dict(self.row(connection,row['document_id'],row['id']))

    def recover(self):
        with self.store.connection() as connection:
            connection.execute("UPDATE analysis_jobs SET status='interrupted',finished_at=?,error_json=? WHERE status IN ('queued','running')",
                (now(),canonical({'code':'analysis_interrupted','message':'服务中断，分析未被自动重跑，请检查记录后重新发起。'})))

    def fail(self,identifier,code,message):
        with self.store.connection() as connection:
            connection.execute("UPDATE analysis_jobs SET status='failed',finished_at=?,error_json=? WHERE id=? AND status IN ('queued','running')",
                (now(),canonical({'code':code,'message':message}),identifier))

    def interrupt(self,identifier,message):
        with self.store.connection() as connection:
            connection.execute("UPDATE analysis_jobs SET status='interrupted',finished_at=?,error_json=? WHERE id=? AND status IN ('queued','running')",
                (now(),canonical({'code':'analysis_interrupted','message':message}),identifier))

    def publish(self,row,result,outputs,version):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE');current=self.row(connection,row['document_id'],row['id'])
            if current['status']!='running':return False
            used=sum(item['byte_size'] for r in connection.execute("SELECT outputs_json FROM analysis_jobs WHERE document_id=? AND status='succeeded'",(row['document_id'],)) for item in json.loads(r[0]))
            if used+sum(o['byte_size'] for o in outputs)>128*1024*1024:
                raise WorkspaceError('analysis_quota','分析产物存储已达上限。',409)
            connection.execute("UPDATE analysis_jobs SET status='succeeded',result_json=?,outputs_json=?,engine_version=?,finished_at=? WHERE id=?",
                (canonical(result),canonical(outputs),version,now(),row['id']))
        return True

    def file(self,document_id,identifier,name):
        job=self.get(document_id,identifier)
        item=next((o for o in job['outputs'] if o['name']==name),None)
        if item is None or Path(name).name!=name:raise WorkspaceError('not_found','找不到这份分析产物。',404)
        path=self.directory(identifier)/name
        try:
            if path.stat().st_size==item['byte_size'] and hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256']:return path,item
        except FileNotFoundError:pass
        raise WorkspaceError('analysis_output_changed','分析产物缺失或校验失败。',409)

    def result(self,document_id,identifier):
        job=self.get(document_id,identifier)
        if job['status']!='succeeded':raise WorkspaceError('analysis_not_complete','分析尚未成功完成，暂无可用结果。',409)
        path,_=self.file(document_id,identifier,'summary.json')
        value=json.loads(path.read_text(encoding='utf-8'))
        if value!=job['result']:raise WorkspaceError('analysis_output_changed','分析记录与结果不一致。',409)
        if job.get('method')=='ttest_paired':
            for item in job['outputs']:self.file(document_id,identifier,item['name'])
        self.datasets.path(document_id,job['dataset_id'])
        return job

    def log(self,document_id,identifier):
        self.get(document_id,identifier);parts=[];truncated=False
        for name in ('stdout.txt','stderr.txt'):
            path=self.directory(identifier)/name
            if not path.exists():continue
            value=path.read_bytes()[:65537];truncated=truncated or len(value)>65536
            text=value[:65536].decode('utf-8',errors='replace').replace(str(self.store.root),'[workspace]')
            parts.append(name+':\n'+text)
        return {'text':'\n'.join(parts),'truncated':truncated}
