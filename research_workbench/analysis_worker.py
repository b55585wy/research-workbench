"""Standalone SQLite consumer executing fixed Python/R descriptive recipes."""
import argparse
import csv
import hashlib
from html import escape
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
from uuid import UUID

from .analyses import Analyses
from .analysis_models import AnalysisCreate,analysis_payload
from .analysis_process import WorkerBusy,WorkerLease,own_process_tree
from .analysis_recipes import RuntimeCatalog,clean_environment,recipe
from .agent_store import canonical,now
from .datasets import Datasets
from .models import WorkspaceError
from .store import Store
from .tabular import parse,numeric

MEDIA={'.json':'application/json','.csv':'text/csv','.tsv':'text/tab-separated-values',
       '.svg':'image/svg+xml','.py':'text/plain','.R':'text/plain','.txt':'text/plain'}


def normalized_input(directory,profile,rows,columns):
    indexes=[next(i for i,c in enumerate(profile['columns']) if c['name']==name) for name in columns]
    with (directory/'input.tsv').open('w',encoding='utf-8',newline='') as stream:
        out=csv.writer(stream,delimiter='\t',lineterminator='\n');out.writerow(columns)
        for row in rows:out.writerow(['NA' if not row[i].strip() else format(numeric(row[i]),'.17g') for i in indexes])


def read_result(directory,profile,columns):
    with (directory/'raw-summary.tsv').open(encoding='utf-8',newline='') as stream:
        reader=csv.DictReader(stream,delimiter='\t')
        if reader.fieldnames!=['column','n','missing','mean','median','sd','min','max']:raise ValueError()
        raw=list(reader)
    if len(raw)!=len(columns):raise ValueError()
    stats=[]
    for item,name in zip(raw,columns):
        expected=next(c for c in profile['columns'] if c['name']==name)
        value={'column':item['column'],'n':int(item['n']),'missing':int(item['missing'])}
        if value['column']!=name or value['n']!=expected['nonempty'] or value['missing']!=expected['missing']:raise ValueError()
        for key in ('mean','median','sd','min','max'):
            value[key]=float(item[key]) if item[key] else None
            if value[key] is None and not (key=='sd' and value['n']==1):raise ValueError()
            if value[key] is not None and not math.isfinite(value[key]):raise ValueError()
        if value['min']>value['max'] or value['sd'] is not None and value['sd']<0:raise ValueError()
        stats.append(value)
    return {'row_count':profile['row_count'],'stats':stats}


def artifacts(directory,result,parameters,version):
    (directory/'summary.json').write_text(canonical(result),encoding='utf-8')
    with (directory/'summary.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        out=csv.writer(stream);keys=['column','n','missing','mean','median','sd','min','max'];out.writerow(keys)
        for item in result['stats']:
            label=item['column'];label="'"+label if label.lstrip().startswith(('=','+','-','@')) else label
            out.writerow([label]+[item[k] for k in keys[1:]])
    bars=[];width=700;height=90+40*len(result['stats']);maximum=max(s['n'] for s in result['stats'])
    for i,item in enumerate(result['stats']):
        y=70+40*i
        bars.append(f'<text x="12" y="{y}" font-size="12">{escape(item["column"])}</text><rect x="220" y="{y-14}" width="{400*item["n"]/maximum:.2f}" height="20" fill="#007da8"/><text x="640" y="{y}" font-size="12">{item["n"]}</text>')
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/><text x="12" y="26" font-size="16">Non-missing values per column (count)</text>{"".join(bars)}</svg>'
    (directory/'chart.svg').write_text(svg,encoding='utf-8')
    (directory/'parameters.json').write_text(canonical({'parameters':parameters,'engine_version':version,
        'recipe_id':'describe-v1','recipe_version':1,'missing_rule':'empty cells only','sd':'sample, n-1',
        'created_at':now(),'initiator':{'identity_source':'local_compat','authenticated':False},
        'note':'Descriptive software output; not scientific or clinical validation.'}),encoding='utf-8')
    (directory/'raw-summary.tsv').unlink()
    files=[]
    for path in sorted(directory.iterdir()):
        if not path.is_file():raise ValueError()
        data=path.read_bytes()
        files.append({'name':path.name,'byte_size':len(data),'sha256':hashlib.sha256(data).hexdigest(),
                      'media_type':MEDIA.get(path.suffix,'application/octet-stream')})
    if sum(f['byte_size'] for f in files)>20*1024*1024:raise WorkspaceError('analysis_size_limit','分析产物超出存储限制。',409)
    return files


def cleanup_failed(directory):
    for name in ('input.tsv','analysis.py','analysis.R','raw-summary.tsv','summary.json','summary.csv','chart.svg','parameters.json',
                 'ttest-options.json','ttest-options.tsv','test-result.json','test.csv','jmv-result.json','r-stats-result.tsv','environment.json','statistics-lock.json'):
        (directory/name).unlink(missing_ok=True)
    for name in ('pair-map.json','preparation-sources.json','paired_ttest_data.py','tabular.py'):(directory/name).unlink(missing_ok=True)


def execute(service,row,stop,timeout=30):
    directory=service.directory(row['id']);process=None;published=False
    try:
        payload=AnalysisCreate.model_validate_json(row['payload_json'])
        with service.store.connection() as connection:data,engine=service.validate(connection,row['document_id'],payload,probe_data=False)
        source=service.datasets.checked(data);profile,rows=parse(source,data['delimiter'])
        directory.mkdir(exist_ok=False)
        prepared=None
        if payload.method=='ttest_paired':
            from .paired_ttest_data import prepare,write_input,preparation_hash
            options=payload.paired.model_dump(mode='json')
            prepared,values,mapping=prepare(profile,rows,payload.columns,options)
            mapping.update(dataset_id=data['id'],dataset_sha256=data['sha256'],preparation_sha256=preparation_hash())
            write_input(directory,prepared,values,mapping,options)
        elif payload.method=='ttest_independent':
            from .ttest_data import prepare
            prepared,values=prepare(profile,rows,payload.columns,payload.ttest.model_dump(mode='json'))
            with (directory/'input.tsv').open('w',encoding='utf-8',newline='') as stream:
                out=csv.writer(stream,delimiter='\t',lineterminator='\n');out.writerow(['value','group'])
                out.writerows((format(value,'.17g'),group) for value,group in values)
            (directory/'ttest-options.json').write_text(canonical(payload.ttest.model_dump(mode='json')),encoding='utf-8')
            with (directory/'ttest-options.tsv').open('w',encoding='utf-8',newline='') as stream:
                out=csv.writer(stream,delimiter='\t',lineterminator='\n');out.writerow(['variant','alternative','confidence'])
                out.writerow([payload.ttest.variant,payload.ttest.alternative,payload.ttest.confidence])
        else:normalized_input(directory,profile,rows,payload.columns)
        code=recipe(payload.engine,payload.method);script=directory/('analysis.py' if payload.engine=='python' else 'analysis.R')
        script.write_bytes(code['code'].encode('utf-8'))
        if hashlib.sha256(script.read_bytes()).hexdigest()!=payload.recipe_sha256:raise ValueError()
        environment=clean_environment(directory)
        if prepared is not None:environment.update(service.catalog.statistics.environment())
        with (directory/'stdout.txt').open('wb') as stdout,(directory/'stderr.txt').open('wb') as stderr:
            process=subprocess.Popen(service.catalog.command(payload.engine,directory),cwd=directory,
                stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,env=environment,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            deadline=time.monotonic()+timeout
            while process.poll() is None:
                if stop.is_set():raise WorkspaceError('analysis_interrupted','服务停止，本次分析未完成。',409)
                if service.get(row['document_id'],row['id'])['status']!='running':return
                if time.monotonic()>=deadline:raise WorkspaceError('analysis_timeout','分析运行超时，进程已停止。',422)
                if any(p.stat().st_size>65536 for p in (directory/'stdout.txt',directory/'stderr.txt')):
                    raise WorkspaceError('analysis_log_limit','分析日志超出限制，进程已停止。',422)
                stop.wait(.05)
            if any(p.stat().st_size>65536 for p in (directory/'stdout.txt',directory/'stderr.txt')):
                raise WorkspaceError('analysis_log_limit','分析日志超出限制，未保存为有效结果。',422)
            if process.returncode:raise WorkspaceError('analysis_process_failed','分析进程未正常完成，请查看运行日志。',422)
        if stop.is_set():raise WorkspaceError('analysis_interrupted','服务停止，本次分析未完成。',409)
        service.datasets.checked(data)
        if hashlib.sha256(script.read_bytes()).hexdigest()!=payload.recipe_sha256:raise ValueError()
        if prepared is not None:
            if payload.method=='ttest_paired':
                from . import paired_ttest_result as ttest_result
                if recipe(payload.engine,payload.method)['sha256']!=payload.recipe_sha256:
                    raise WorkspaceError('recipe_changed','配对准备代码版本已变化，本次结果未发布。',409)
            else:from . import ttest_result
            service.catalog.statistics.require(payload.library_sha256)
            result=ttest_result.result(directory,prepared,payload,service.catalog.statistics,engine['version'])
            files=ttest_result.artifacts(directory,result,analysis_payload(payload),engine['version'],service.catalog.statistics)
        else:
            result=read_result(directory,profile,payload.columns)
            files=artifacts(directory,result,analysis_payload(payload),engine['version'])
        published=service.publish(row,result,files,engine['version'])
    except WorkspaceError as error:
        if error.code=='analysis_interrupted':service.interrupt(row['id'],error.message)
        else:service.fail(row['id'],error.code,error.message)
    except (ValueError,TypeError,KeyError,OverflowError):service.fail(row['id'],'analysis_invalid_output','运行结果不完整或超出数值范围，未保存为有效结果。')
    except (OSError,sqlite3.Error):service.fail(row['id'],'analysis_storage','分析运行或存储失败，未保存为有效结果。')
    finally:
        if process is not None and process.poll() is None:process.kill();process.wait(timeout=5)
        if directory.exists() and not published:cleanup_failed(directory)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data',type=Path,required=True);parser.add_argument('--rscript',type=Path);parser.add_argument('--token',type=UUID,required=True)
    parser.add_argument('--statistics-root',type=Path)
    args=parser.parse_args();job_handle=own_process_tree()
    store=Store(args.data);datasets=Datasets(store)
    from .data_imports import DataImports
    from .dataset_selections import DatasetSelections
    datasets.imports=DataImports(store,datasets)
    datasets.selections=DatasetSelections(store,datasets)
    service=Analyses(store,datasets,RuntimeCatalog(args.rscript,args.statistics_root))
    stop=threading.Event()
    def parent_closed():
        try:os.read(sys.stdin.fileno(),1)
        finally:stop.set()
    threading.Thread(target=parent_closed,name='parent-lifetime',daemon=True).start()
    try:
        with WorkerLease(service.root/'.worker.lock'):
            ready=service.root/('.ready-'+str(args.token)+'.json')
            ready.write_text(canonical({'pid':os.getpid(),'token':str(args.token)}),encoding='utf-8')
            while not stop.is_set():
                try:row=service.claim()
                except sqlite3.OperationalError as error:
                    if not any(word in str(error).lower() for word in ('locked','busy')):raise
                    if stop.wait(.1):break
                    row=service.claim()
                if row is None:stop.wait(.1)
                else:execute(service,row,stop)
    except WorkerBusy:return 3
    return 0


if __name__=='__main__':sys.exit(main())
