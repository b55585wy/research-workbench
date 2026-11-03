import hashlib
from html import escape
import json
from pathlib import Path
import tempfile
import zipfile

from .agent_store import canonical
from .analysis_notebook import read_artifact,notebook_from_snapshot,serialize,result_table
from .models import WorkspaceError


def build_analysis_export(service,document_id,identifier):
    job=service.result(document_id,identifier)
    files={item['name']:read_artifact(service,job,item['name'],20*1024*1024) for item in job['outputs']}
    dataset=service.datasets.get(document_id,job['dataset_id']);extension='.tsv' if dataset['original_filename'].lower().endswith('.tsv') else '.csv'
    files['source'+extension]=service.datasets.path(document_id,job['dataset_id']).read_bytes()
    if hashlib.sha256(files['source'+extension]).hexdigest()!=job['dataset_sha256']:
        raise WorkspaceError('dataset_changed','原始数据文件已改变。',409)
    if dataset.get('import_provenance'):
        files.update(service.datasets.imports.export_files(document_id,dataset['import_provenance']['import_id'],dataset))
    files.update(service.datasets.selections.export_files(document_id,job['dataset_id']))
    owner=service.store.get_document(document_id)
    if owner.get('kind')=='study':files['study.json']=canonical(owner).encode()
    if sum(len(data) for data in files.values())>128*1024*1024:
        raise WorkspaceError('export_too_large','导出资料超过128 MiB。',413)
    files['analysis.ipynb']=serialize(notebook_from_snapshot(job,files))
    rows=[]
    for item in job['result']['stats']:
        rows.append('<tr>'+''.join('<td>'+escape(str(item.get(k,'')))+'</td>' for k in ('column','n','missing','mean','median','sd','min','max'))+'</tr>')
    html='<!doctype html><meta charset="utf-8"><title>Analysis record</title><h1>Descriptive analysis record</h1>'
    html+='<p>'+escape(dataset['original_filename'])+' · '+escape(job['engine_version'])+'</p>'
    html+='<p>Software output, not scientific or clinical validation. Empty cells are missing; sample SD uses n−1.</p>'
    html+='<table><thead><tr>'+''.join('<th>'+k+'</th>' for k in ('Column','n','Missing','Mean','Median','SD','Min','Max'))+'</tr></thead><tbody>'+''.join(rows)+'</tbody></table><img src="chart.svg" alt="Non-missing counts">'
    if job.get('method') in ('ttest_independent','ttest_paired','correlation'):
        label='Correlation analysis' if job.get('method')=='correlation' else 'Paired samples t-test' if job.get('method')=='ttest_paired' else 'Independent samples t-test'
        html='<!doctype html><meta charset="utf-8"><title>'+label+'</title><h1>'+label+'</h1>'
        html+='<p>'+escape(dataset['original_filename'])+' · '+escape(job['engine_version'])+'</p>'
        html+=result_table(job['result'])+'<img src="chart.svg" alt="'+('Complete observations per variable' if job.get('method')=='correlation' else 'Complete pairs per measurement' if job.get('method')=='ttest_paired' else 'Included samples per group')+'">'
    html+='<ul>'+''.join('<li><a href="'+escape(name)+'">'+escape(name)+'</a></li>' for name in sorted(files))+'</ul>'
    files['index.html']=html.encode('utf-8')
    manifest={'analysis_id':identifier,'dataset_sha256':job['dataset_sha256'],
              'files':{name:{'sha256':hashlib.sha256(data).hexdigest(),'byte_size':len(data)} for name,data in files.items()}}
    files['manifest.json']=canonical(manifest).encode('utf-8')
    path=None
    try:
        with tempfile.NamedTemporaryFile(dir=service.store.exports,suffix='.zip',delete=False) as stream:path=Path(stream.name)
        with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
            for name,data in files.items():archive.writestr(name,data)
        return path,'analysis-'+identifier+'.zip'
    except BaseException:
        if path is not None:path.unlink(missing_ok=True)
        raise
