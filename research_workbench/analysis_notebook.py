"""Deterministic readonly projection of verified saved artifacts, not execution."""
import hashlib
from html import escape
import json
from pathlib import Path
import re

from .models import WorkspaceError

MAX_NOTEBOOK_BYTES=1024*1024


def invalid():
    return WorkspaceError('analysis_output_changed','已保存分析记录不完整或校验失败。',409)


def read_artifact(service,job,name,limit=MAX_NOTEBOOK_BYTES):
    item=next((item for item in job['outputs'] if item['name']==name),None)
    if item is None or Path(name).name!=name or ':' in name or name in ('.','..'):raise invalid()
    if item['byte_size']>limit:raise WorkspaceError('notebook_too_large','这份记录超过 Notebook 查看大小限制。',413)
    path=service.directory(job['id'])/name
    if not path.resolve().is_relative_to(service.directory(job['id']).resolve()):raise invalid()
    try:
        with path.open('rb') as stream:data=stream.read(limit+1)
    except FileNotFoundError:raise invalid() from None
    if len(data)>limit:raise WorkspaceError('notebook_too_large','这份记录超过 Notebook 查看大小限制。',413)
    if len(data)!=item['byte_size'] or hashlib.sha256(data).hexdigest()!=item['sha256']:raise invalid()
    return data


def markdown(identifier,source):
    return {'id':identifier,'cell_type':'markdown','metadata':{'editable':False,'deletable':False},'source':source}


def code(identifier,source,outputs,kind):
    return {'id':identifier,'cell_type':'code','execution_count':None,'source':source,'outputs':outputs,
            'metadata':{'editable':False,'deletable':False,'workbench':{'kind':kind}}}


def literal_summary(job):
    value=json.dumps({'data_file':job['dataset_name'],'engine':job['engine_version'],
        'completed_at':job['finished_at'],'rows':job['result']['row_count'],'columns':job['columns']},
        ensure_ascii=False,indent=2)
    longest=max((len(m[0]) for m in re.finditer(r'`+',value)),default=0)
    fence='`'*max(3,longest+1)
    return '# 已保存的分析 / Saved analysis\n\n仅展示保存结果，此视图不运行代码。 Stored outputs; this view does not execute code.\n\n'+fence+'json\n'+value+'\n'+fence


def result_table(result):
    if result.get('method')=='ttest_paired':
        from .paired_ttest_result import table
        return table(result)
    keys=('column','n','missing','mean','median','sd','min','max')
    header='<tr>'+''.join('<th>'+key+'</th>' for key in keys)+'</tr>'
    rows=['<tr>'+''.join('<td>'+escape(str(item[key]) if item[key] is not None else '—')+'</td>' for key in keys)+'</tr>' for item in result['stats']]
    html='<table><thead>'+header+'</thead><tbody>'+''.join(rows)+'</tbody></table>'
    if result.get('method')=='ttest_independent':
        test=result['test'];keys=('variant','alternative','confidence','statistic','df','p_value','difference','standard_error')
        html+='<h3>Independent samples: group1 minus group2</h3><table><tbody>'
        html+=''.join('<tr><th>'+key+'</th><td>'+escape(str(test[key]))+'</td></tr>' for key in keys)
        html+='<tr><th>CI</th><td>'+escape(str(test['ci']))+'</td></tr></tbody></table>'
        html+='<p>'+escape(json.dumps({'groups':test['groups'],'counts':result['counts'],'warnings':result['warnings']},ensure_ascii=False))+'</p>'
    return html


def notebook_from_snapshot(job,files):
    try:
        if job['engine'] not in ('python','r'):raise invalid()
        script='analysis.py' if job['engine']=='python' else 'analysis.R'
        saved=files[script]
        if hashlib.sha256(saved).hexdigest()!=job['recipe']['sha256']:raise invalid()
        parameters=json.loads(files['parameters.json'])
        expected={'request_id':job['id'],'dataset_id':job['dataset_id'],'dataset_sha256':job['dataset_sha256'],
                  'engine':job['engine'],'columns':job['columns'],'recipe_sha256':job['recipe']['sha256']}
        if job.get('method')=='ttest_independent':expected.update({k:job[k] for k in ('method','ttest','library_sha256')})
        if job.get('method')=='ttest_paired':expected.update({k:job[k] for k in ('method','paired','library_sha256')})
        if any(parameters['parameters'][k]!=v for k,v in expected.items()):raise invalid()
        if parameters['engine_version']!=job['engine_version'] or json.loads(files['summary.json'])!=job['result']:raise invalid()
        logs=[{'output_type':'stream','name':name,'text':files[name+'.txt'].decode('utf-8')} for name in ('stdout','stderr') if files[name+'.txt']]
        rendered=[{'output_type':'display_data','metadata':{},'data':{
            'text/html':result_table(job['result']),'text/plain':json.dumps(job['result'],ensure_ascii=False,indent=2)}},
            {'output_type':'display_data','metadata':{},'data':{'image/svg+xml':files['chart.svg'].decode('utf-8')}}]
        metadata={'language_info':{'name':job['engine']},'workbench':{
            'kind':'saved_analysis','view_version':1,'read_only':True,'code_executed_in_view':False,
            'source_data_embedded':False,'document_id':job['document_id'],'analysis_id':job['id'],
            'dataset_id':job['dataset_id'],'dataset_sha256':job['dataset_sha256'],'code_sha256':job['recipe']['sha256'],
            'engine_version':job['engine_version'],'created_at':job['created_at'],'finished_at':job['finished_at'],
            'artifact_sha256':{item['name']:item['sha256'] for item in job['outputs']}}}
        return {'nbformat':4,'nbformat_minor':5,'metadata':metadata,'cells':[
            markdown('overview',literal_summary(job)),code('analysis-code',saved.decode('utf-8'),logs,'saved_script'),
            markdown('saved-results','## 保存的产物 / Saved artifacts\n\n以下表格和图表来自已校验的保存产物。'),
            code('saved-artifacts','',rendered,'saved_summary_and_chart')]}
    except (KeyError,TypeError,ValueError,UnicodeError):raise invalid() from None


def serialize(notebook):
    try:data=json.dumps(notebook,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')
    except (ValueError,TypeError):raise invalid() from None
    if len(data)>MAX_NOTEBOOK_BYTES:raise WorkspaceError('notebook_too_large','这份记录超过 Notebook 查看大小限制。',413)
    return data


def saved_notebook(service,document_id,identifier):
    job=service.result(document_id,identifier)
    names=('analysis.py' if job['engine']=='python' else 'analysis.R','parameters.json','summary.json','stdout.txt','stderr.txt','chart.svg')
    files={name:read_artifact(service,job,name) for name in names}
    notebook=notebook_from_snapshot(job,files)
    return notebook,serialize(notebook)
