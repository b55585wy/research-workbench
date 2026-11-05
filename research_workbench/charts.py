"""Source-bound immutable figures with transactionally stored canonical data."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from uuid import UUID
from .agent_store import canonical,digest,now
from .analysis_recipes import clean_environment
from .studies import verify_owner as verify_source
from .image_sources import checked_bytes
from .library import read_metadata
from .models import WorkspaceError
from .chart_validation import projection as validate_projection
from .chart_skills import ChartSkills

ROOT=Path(__file__).resolve().parents[1]
PROBE=Path(__file__).with_name('chart_probe.py')
GROUPED_PROBE=Path(__file__).with_name('grouped_points_probe.py')
KINDS={'analysis_counts':'有效/缺失数对比','histogram':'数值分布','scatter':'双列散点','grouped_points':'两组观测点'}
MAX_DATA=4*1024*1024
COLUMNS='id,document_id,dataset_id,analysis_id,request_hash,spec_json,summary_json,data_sha256,origin,revision,created_at,updated_at,deleted_at,length(data_bytes) AS data_byte_size'


def changed():return WorkspaceError('chart_source_changed','图表数据或来源发生变化，请保留草稿后重新检查。',409)


def projection_error(kind,value):
    if not isinstance(value,dict):return WorkspaceError('chart_failed','绘图计算未能完成，请保留草稿后重试。',503)
    if value.get('error')=='chart_too_large':return WorkspaceError('chart_too_large','图表数据过大，请减少记录。',413)
    if kind=='grouped_points':return WorkspaceError('invalid_grouped_points_data','两组观测点需要恰好两组完整数据，分组名最长200字符且不含控制字符。',422)
    return WorkspaceError('invalid_chart_data','没有有效成对数据，或该数据无法生成所选图表。',422)


def projection_probe(kind):
    return GROUPED_PROBE if kind=='grouped_points' else PROBE


def recipe(kind):
    if kind not in KINDS:raise WorkspaceError('invalid_chart','请选择支持的图表类型。',422)
    probe=projection_probe(kind)
    value=hashlib.sha256(kind.encode()+probe.read_bytes()+probe.with_name('tabular.py').read_bytes()).hexdigest()
    return {'id':kind+'-v1','version':1,'sha256':value}


class Charts:
    def __init__(self,store,datasets,analysis,timeout=8):
        self.store,self.datasets,self.analysis=store,datasets,analysis
        self.skills=ChartSkills(store)
        self.timeout=timeout;self.slots=threading.BoundedSemaphore(2)
        self.asset_root=ROOT/'frontend/vendor/plotly/4.2.0'
        manifest=json.loads((self.asset_root/'manifest.json').read_text(encoding='utf-8'))
        entry=manifest['files']['plotly-strict.min.js']
        self.renderer={'id':'plotly-strict','version':'4.2.0',**entry,'script_url':'/vendor/plotly/4.2.0/plotly-strict.min.js'}
        self.check_renderer()

    def check_renderer(self):
        try:checked_bytes(self.asset_root/'plotly-strict.min.js',self.renderer['byte_size'],self.renderer['sha256'],8*1024*1024,False)
        except WorkspaceError:raise WorkspaceError('chart_renderer_changed','绘图组件缺失或已改变，请检查本地资源。',409) from None

    def capabilities(self):
        self.check_renderer()
        return {'items':[{'id':k,'title':v,'recipe_sha256':recipe(k)['sha256']} for k,v in KINDS.items()],
            'renderer':self.renderer,'limits':{'data_bytes':MAX_DATA,'charts_per_document':20,'rows':50000},'arbitrary_code':False,
            'custom_skills':True}

    @staticmethod
    def row(connection,document_id,identifier):
        value=connection.execute('SELECT '+COLUMNS+' FROM charts WHERE id=? AND document_id=?',(str(identifier),document_id)).fetchone()
        if value is None:raise WorkspaceError('not_found','找不到这张图表。',404)
        return value

    def source(self,connection,document_id,payload):
        document=read_metadata(connection,document_id);verify_source(self.store,document)
        row=self.datasets.row(connection,document_id,str(payload['dataset_id']))
        try:UUID(row['storage_key'])
        except (ValueError,TypeError):raise changed() from None
        if row['sha256']!=payload['dataset_sha256']:raise changed()
        self.datasets.checked(row);dataset=self.datasets.record(row)
        return document,row,dataset

    def analysis_source(self,connection,document_id,identifier,dataset):
        row=self.analysis.row(connection,document_id,str(identifier));job=self.analysis.record(row)
        if job['dataset_id']!=dataset['id'] or job['dataset_sha256']!=dataset['sha256']:raise WorkspaceError('chart_analysis_scope','分析与所选数据不匹配。',409)
        if job['status']!='succeeded':raise WorkspaceError('analysis_not_complete','请先完成并验证这项分析。',409)
        if job['recipe']['id']!='describe-v1':raise WorkspaceError('chart_analysis_scope','此数量对比图仅支持描述统计记录。',422)
        output=next((r for r in job['outputs'] if r['name']=='summary.json'),None)
        if output is None:raise changed()
        data=checked_bytes(self.analysis.directory(job['id'])/'summary.json',output['byte_size'],output['sha256'],1024*1024)
        if json.loads(data)!=job['result']:raise changed()
        name='analysis.py' if job['engine']=='python' else 'analysis.R'
        code=next((r for r in job['outputs'] if r['name']==name),None)
        if code is None or code['sha256']!=job['recipe']['sha256']:raise changed()
        checked_bytes(self.analysis.directory(job['id'])/name,code['byte_size'],code['sha256'],1024*1024,False)
        return job

    def validate(self,connection,document_id,payload):
        fields=payload.model_dump(mode='json');document,row,dataset=self.source(connection,document_id,fields)
        if fields['recipe_sha256']!=recipe(fields['kind'])['sha256']:raise WorkspaceError('chart_recipe_changed','绘图计算版本已改变，请重新预览。',409)
        if fields['renderer_sha256']!=self.renderer['sha256']:raise WorkspaceError('chart_renderer_changed','绘图组件版本已改变，请重新预览。',409)
        snapshot=None
        if payload.skill is not None:
            snapshot=self.skills.snapshot(connection,payload.skill)
            chart=snapshot['spec']['chart']
            if chart['kind']!=fields['kind'] or chart['bins']!=fields['bins']:
                raise WorkspaceError('chart_skill_changed','绘图 skill 与图表类型或分箱不一致。',409)
        self.check_renderer();analysis=None
        if fields['kind']=='analysis_counts':
            analysis=self.analysis_source(connection,document_id,fields['analysis_id'],dataset);columns=analysis['columns']
        else:columns=[fields[k] for k in ('x','y') if fields[k] is not None]
        allowed={c['name'] for c in dataset['columns'] if c['numeric']}
        valid=(fields['x'] in {c['name'] for c in dataset['columns']} and fields['y'] in allowed) if fields['kind']=='grouped_points' else set(columns).issubset(allowed)
        if not valid:raise WorkspaceError('invalid_columns','请选择有效分组列和有限数值列，或图型要求的数值列。',422)
        return fields,document,row,dataset,analysis,columns,snapshot

    def compute(self,row,fields,columns):
        if not self.slots.acquire(False):raise WorkspaceError('chart_busy','正在准备其他图表，请稍后重试。',429)
        try:
            original=checked_bytes(self.datasets.checked(row),row['byte_size'],row['sha256'],5*1024*1024)
            with tempfile.TemporaryDirectory(prefix='chart-',dir=self.store.incoming) as directory:
                directory=Path(directory);path=directory/'input.table';path.write_bytes(original)
                spec={'kind':fields['kind'],'columns':columns,'bins':fields['bins']}
                command=[getattr(sys,'_base_executable',sys.executable),'-I','-S',str(projection_probe(fields['kind'])),str(path),row['delimiter'],canonical(spec)]
                run=subprocess.run(command,capture_output=True,timeout=self.timeout,env=clean_environment(directory),
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                if len(run.stdout)>MAX_DATA:raise WorkspaceError('chart_too_large','图表数据过大，请减少记录。',413)
                value=json.loads(run.stdout)
                if run.returncode==2:raise projection_error(fields['kind'],value)
                if run.returncode or set(value)!={'summary','series'}:raise ValueError()
                validate_projection(value,fields['kind'],columns,json.loads(row['profile_json'])['row_count'])
            self.datasets.checked(row)
            return value
        except subprocess.TimeoutExpired:raise WorkspaceError('chart_timeout','绘图计算超时，请缩小数据后重试。',422) from None
        except (AssertionError,ValueError,TypeError,KeyError):raise WorkspaceError('chart_failed','绘图计算未能完成，请保留草稿后重试。',503) from None
        finally:self.slots.release()

    def prepare_in(self,connection,document_id,payload):
        fields,document,row,dataset,analysis,columns,snapshot=self.validate(connection,document_id,payload)
        projection=self.compute(row,fields,columns)
        self.source(connection,document_id,fields)
        if fields['recipe_sha256']!=recipe(fields['kind'])['sha256']:raise WorkspaceError('chart_recipe_changed','绘图计算版本已改变，请重新预览。',409)
        self.check_renderer()
        if analysis:
            stats=analysis['result']['stats'];series=projection['series']
            if [s['n'] for s in stats]!=series['valid'] or [s['missing'] for s in stats]!=series['missing']:raise changed()
        spec={k:fields[k] for k in ('kind','title','analysis_id','x','y','bins')}
        value={'format':'research-chart/v1','document_id':document_id,'dataset_id':dataset['id'],'dataset_sha256':dataset['sha256'],
            'analysis_id':fields['analysis_id'],'kind':fields['kind'],'title':fields['title'],'spec':spec,
            'recipe_sha256':fields['recipe_sha256'],'renderer_sha256':fields['renderer_sha256'],**projection}
        if snapshot is not None:value['skill_snapshot']=snapshot
        data=canonical(value).encode()
        if len(data)>MAX_DATA:raise WorkspaceError('chart_too_large','图表数据过大，请减少记录。',413)
        return fields,document,dataset,value,data,snapshot

    def record(self,row,dataset_name=None):
        fields=json.loads(row['spec_json']);spec={k:fields[k] for k in ('kind','title','analysis_id','x','y','bins')}
        prefix=f"/api/v1/documents/{row['document_id']}/charts/{row['id']}"
        result={'id':row['id'],'document_id':row['document_id'],'source_sha256':fields['source_sha256'],
            'dataset_id':row['dataset_id'],'dataset_name':dataset_name or fields['dataset_name'],'dataset_sha256':fields['dataset_sha256'],
            'analysis_id':row['analysis_id'],'kind':fields['kind'],'title':fields['title'],'spec':spec,
            'recipe':{'id':fields['kind']+'-v1','version':1,'sha256':fields['recipe_sha256']},'renderer':fields['renderer'],
            'summary':json.loads(row['summary_json']),'origin':row['origin'],'revision':row['revision'],
            'created_at':row['created_at'],'updated_at':row['updated_at'],'deleted_at':row['deleted_at'],
            'data_sha256':row['data_sha256'],'data_byte_size':row['data_byte_size'],'data_url':prefix+'/data',
            'viewer_url':f"/?document={row['document_id']}&chart={row['id']}",'export_url':prefix+'/export'}
        if fields.get('skill_snapshot') is not None:result['skill_snapshot']=fields['skill_snapshot']
        return result

    def preview(self,document_id,payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN');fields,doc,dataset,value,data,snapshot=self.prepare_in(connection,document_id,payload)
        stored={key:item for key,item in fields.items() if key!='skill'}
        stored.update(source_sha256=doc['sha256'],dataset_name=dataset['original_filename'],renderer=self.renderer)
        if snapshot is not None:stored['skill_snapshot']=snapshot
        raw={'id':str(payload.request_id),'document_id':document_id,'dataset_id':dataset['id'],'analysis_id':fields['analysis_id'],
            'spec_json':canonical(stored),'summary_json':canonical(value['summary']),'origin':'preview','revision':0,'created_at':None,
            'updated_at':None,'deleted_at':None,'data_sha256':hashlib.sha256(data).hexdigest(),'data_byte_size':len(data)}
        chart=self.record(raw);chart.update(data_url=None,viewer_url=None,export_url=None)
        return {'chart':chart,'data':value}

    def create_in(self,connection,document_id,payload,origin='manual'):
        signature=digest({'document_id':document_id,'payload':payload.model_dump(mode='json'),'origin':origin})
        old=connection.execute('SELECT '+COLUMNS+' FROM charts WHERE id=?',(str(payload.request_id),)).fetchone()
        if old is not None:
            if old['document_id']!=document_id or old['request_hash']!=signature:raise WorkspaceError('idempotency_conflict','保存编号已用于另一张图表。',409)
            self.data_in(connection,document_id,old['id']);return self.record(old),False
        if connection.execute('SELECT COUNT(*) FROM charts WHERE document_id=?',(document_id,)).fetchone()[0]>=20:
            raise WorkspaceError('chart_quota','这篇文献的图表记录已达上限（包含可恢复记录）。',413)
        fields,doc,dataset,value,data,snapshot=self.prepare_in(connection,document_id,payload)
        stored={key:item for key,item in fields.items() if key!='skill'}
        stored.update(source_sha256=doc['sha256'],dataset_name=dataset['original_filename'],renderer=self.renderer);stamp=now()
        if snapshot is not None:stored['skill_snapshot']=snapshot
        probe=projection_probe(fields['kind'])
        stored['calculation_sources']={'chart-projection.py':probe.read_bytes().decode('utf-8'),'tabular.py':probe.with_name('tabular.py').read_bytes().decode('utf-8')}
        connection.execute('INSERT INTO charts VALUES (?,?,?,?,?,?,?,?,?, ?,1,?,?,NULL)',(str(payload.request_id),document_id,dataset['id'],fields['analysis_id'],signature,
            canonical(stored),canonical(value['summary']),hashlib.sha256(data).hexdigest(),data,origin,stamp,stamp))
        return self.record(self.row(connection,document_id,str(payload.request_id))),True

    def create(self,document_id,payload,origin='manual'):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE');return self.create_in(connection,document_id,payload,origin)

    def list(self,document_id):
        self.store.get_document(document_id)
        with self.store.connection() as connection:
            return [self.record(r) for r in connection.execute('SELECT '+COLUMNS+' FROM charts WHERE document_id=? ORDER BY created_at DESC,id DESC',(document_id,))]

    def get(self,document_id,identifier):
        with self.store.connection() as connection:return self.record(self.row(connection,document_id,identifier))

    def data_in(self,connection,document_id,identifier,allow_deleted=False):
        row=self.row(connection,document_id,identifier);fields=json.loads(row['spec_json'])
        if row['deleted_at'] and not allow_deleted:raise WorkspaceError('chart_deleted','图表已删除，可从已删除列表恢复。',409)
        snapshot=fields.get('skill_snapshot')
        if snapshot is not None:
            self.skills.frozen(snapshot)
            skill_chart=snapshot['spec']['chart']
            if skill_chart['kind']!=fields['kind'] or skill_chart['bins']!=fields['bins']:raise changed()
        document,_,dataset=self.source(connection,document_id,fields)
        if document['sha256']!=fields['source_sha256']:raise changed()
        if fields['analysis_id']:self.analysis_source(connection,document_id,fields['analysis_id'],dataset)
        data=connection.execute('SELECT data_bytes FROM charts WHERE id=?',(row['id'],)).fetchone()[0]
        if not isinstance(data,bytes) or not 0<len(data)<=MAX_DATA or hashlib.sha256(data).hexdigest()!=row['data_sha256']:raise changed()
        value=json.loads(data)
        try:
            spec={k:fields[k] for k in ('kind','title','analysis_id','x','y','bins')}
            if value['summary']!=json.loads(row['summary_json']) or value['spec']!=spec:raise changed()
            if snapshot is None:
                if 'skill_snapshot' in value:raise changed()
            else:
                artifact=value.get('skill_snapshot')
                if artifact is None:raise changed()
                self.skills.frozen(artifact)
                if artifact!=snapshot:raise changed()
            for key in ('document_id','dataset_id','analysis_id','kind','title','recipe_sha256','renderer_sha256','dataset_sha256'):
                expected=row[key] if key in ('document_id','dataset_id','analysis_id') else fields[key]
                if value[key]!=expected:raise changed()
            validate_projection({k:value[k] for k in ('summary','series')},fields['kind'],value['summary']['columns'],dataset['row_count'])
        except (AssertionError,KeyError,TypeError,ValueError):raise changed() from None
        return self.record(row),data

    def data(self,document_id,identifier,allow_deleted=False):
        with self.store.connection() as connection:
            connection.execute('BEGIN');return self.data_in(connection,document_id,identifier,allow_deleted)

    def mutate_in(self,connection,document_id,identifier,action,payload):
        current,_=self.data_in(connection,document_id,identifier,True)
        if payload.data_sha256!=current['data_sha256']:raise changed()
        signature=digest({'document_id':document_id,'id':identifier,'action':action,'payload':payload.model_dump(mode='json')})
        old=connection.execute('SELECT * FROM chart_operations WHERE request_id=?',(str(payload.request_id),)).fetchone()
        if old:
            if old['payload_hash']!=signature:raise WorkspaceError('idempotency_conflict','操作编号已用于其他请求。',409)
            if old['result_revision']!=current['revision']:raise WorkspaceError('revision_conflict','图表状态已更新，请重新查看。',409)
            return current
        if current['revision']!=payload.expected_revision:raise WorkspaceError('revision_conflict','图表状态已更新，请重新查看。',409)
        deleted=(current['deleted_at'] or now()) if action=='delete' else None
        revision=current['revision']+int(deleted!=current['deleted_at'])
        connection.execute('UPDATE charts SET deleted_at=?,revision=?,updated_at=? WHERE id=?',(deleted,revision,now() if revision!=current['revision'] else current['updated_at'],identifier))
        connection.execute('INSERT INTO chart_operations VALUES (?,?,?,?,?,?)',(str(payload.request_id),identifier,signature,action,revision,now()))
        return self.record(self.row(connection,document_id,identifier))

    def mutate(self,document_id,identifier,action,payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE');return self.mutate_in(connection,document_id,identifier,action,payload)
