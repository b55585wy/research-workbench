from concurrent.futures import ThreadPoolExecutor
import io
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import sys
import threading
import time
from uuid import uuid4
import zipfile
import pytest

from analysis_support import R_PATH,workspace,upload,payload,run,wait
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute
from research_workbench.models import WorkspaceError
from research_workbench.store import Store


@pytest.mark.parametrize('engine',['python','r'])
def test_actual_engines_match_independent_expected_numbers(tmp_path,engine):
    if engine=='r' and R_PATH is None:pytest.skip('Set RESEARCH_TEST_RSCRIPT for actual R validation')
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data,engine,['value','second'])
        assert job['status']=='succeeded',job
        a,b=job['result']['stats'];assert a=={'column':'value','n':3,'missing':0,'mean':2.,'median':2.,'sd':1.,'min':1.,'max':3.}
        assert b['mean']==b['median']==20 and b['n']==2 and b['missing']==1
        assert b['sd']==pytest.approx(math.sqrt(200),rel=1e-12)
        assert job['engine_version'] and job['outputs']
        for item in job['outputs']:
            response=c.get(item['url']);assert response.status_code==200
            assert len(response.content)==item['byte_size'] and hashlib.sha256(response.content).hexdigest()==item['sha256']


@pytest.mark.parametrize('engine',['python','r'])
@pytest.mark.parametrize('body,columns,means,sds',[
    ('one,constant\n,7\n-2e-3,7\n,7\n',['one','constant'],[-.002,7],[None,0]),
    ('温度,=formula\n-3,1\n0,2\n3,3\n',['温度','=formula'],[0,2],[3,1])])
def test_missing_single_constant_negative_scientific_unicode_and_formula_label(tmp_path,engine,body,columns,means,sds):
    if engine=='r' and R_PATH is None:pytest.skip('Actual R required')
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,body.encode()).json();job=run(app.state.analysis,doc,data,engine,columns)
        assert job['status']=='succeeded',job
        for item,mean,sd in zip(job['result']['stats'],means,sds):assert item['mean']==pytest.approx(mean) and item['sd']==sd
        if '=formula' in columns:
            output=next(o for o in job['outputs'] if o['name']=='summary.csv');assert "'=formula" in c.get(output['url']).content.decode('utf-8-sig')


@pytest.mark.parametrize('changes,expected',[
    ({'dataset_sha256':'0'*64},409),({'recipe_sha256':'0'*64},409),({'columns':['label']},422),
    ({'columns':['missing']},422),({'columns':[]},422),({'columns':['value','value']},422),
    ({'engine':'bash'},422),({'script':'print(1)'},422),({'url':'https://example.com'},422),
    ({'actor':'admin'},422),({'dataset_id':str(uuid4())},404)])
def test_invalid_or_unapproved_execution_intents_create_no_job(tmp_path,changes,expected):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();response=c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(data,**changes))
        assert response.status_code==expected,response.text
        assert app.state.analysis.list(doc['id'])==[]


def test_unavailable_r_is_visible_and_never_queued(tmp_path):
    with workspace(tmp_path,rscript=tmp_path/'missing/Rscript.exe') as (c,app,doc,_):
        status=c.get('/api/v1/analysis/status').json();assert not status['engines'][1]['available']
        data=upload(c,doc).json();assert c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(data,'r')).status_code==409
        assert app.state.analysis.list(doc['id'])==[]


def test_concurrent_exact_retry_and_changed_intent(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();value=payload(data);url=f"/api/v1/documents/{doc['id']}/analyses"
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:c.post(url,json=value),range(2)))
        assert sorted(r.status_code for r in responses)==[200,201]
        assert len(app.state.analysis.list(doc['id']))==1
        value['columns']=['second'];assert c.post(url,json=value).status_code==409


def test_queue_capacity_cancel_and_terminal_idempotency(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();url=f"/api/v1/documents/{doc['id']}/analyses"
        values=[payload(data) for _ in range(4)]
        for v in values[:3]:assert c.post(url,json=v).status_code==201
        assert c.post(url,json=values[3]).status_code==409
        job=app.state.analysis.cancel(doc['id'],values[0]['request_id']);assert job['status']=='cancelled'
        assert app.state.analysis.cancel(doc['id'],job['id'])==job
        assert c.post(url,json=values[0]).json()['status']=='cancelled'
        assert c.post(url,json=values[3]).status_code==201


def test_job_count_quota(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json()
        for _ in range(20):
            job,_=app.state.analysis.create(doc['id'],AnalysisCreate(**payload(data)));app.state.analysis.cancel(doc['id'],job['id'])
        with pytest.raises(WorkspaceError,match='上限'):app.state.analysis.create(doc['id'],AnalysisCreate(**payload(data)))


@pytest.mark.parametrize('code,timeout,expected',[('raise SystemExit(7)',2,'analysis_process_failed'),('import time;time.sleep(10)',.1,'analysis_timeout'),('print("no results")',2,'analysis_storage')])
def test_real_engine_crash_timeout_and_missing_output_keep_web_alive(tmp_path,monkeypatch,code,timeout,expected):
    with workspace(tmp_path/'data') as (c,app,doc,_):
        data=upload(c,doc).json();svc=app.state.analysis;job,_=svc.create(doc['id'],AnalysisCreate(**payload(data)))
        fault=tmp_path/'fault.py';fault.write_text(code)
        monkeypatch.setattr(svc.catalog,'command',lambda *_:[getattr(sys,'_base_executable',sys.executable),'-I','-S',str(fault)])
        execute(svc,svc.claim(),threading.Event(),timeout=timeout)
        result=svc.get(doc['id'],job['id']);assert result['status']=='failed' and result['error']['code']==expected,result
        assert result['result'] is None and result['outputs']==[] and result['export_url'] is None
        assert c.get('/api/v1/health').status_code==200


def test_cancel_running_stops_actual_engine_and_prevents_late_success(tmp_path,monkeypatch):
    with workspace(tmp_path/'data') as (c,app,doc,_):
        data=upload(c,doc).json();svc=app.state.analysis;job,_=svc.create(doc['id'],AnalysisCreate(**payload(data)))
        marker=tmp_path/'started';fault=tmp_path/'fault.py';fault.write_text('from pathlib import Path\nimport time\nPath('+repr(str(marker))+').write_text("started")\ntime.sleep(10)')
        monkeypatch.setattr(svc.catalog,'command',lambda *_:[getattr(sys,'_base_executable',sys.executable),'-I','-S',str(fault)])
        thread=threading.Thread(target=execute,args=(svc,svc.claim(),threading.Event()));thread.start()
        deadline=time.monotonic()+3
        while not marker.exists() and time.monotonic()<deadline:threading.Event().wait(.01)
        assert marker.exists();svc.cancel(doc['id'],job['id']);thread.join(3);assert not thread.is_alive()
        result=svc.get(doc['id'],job['id']);assert result['status']=='cancelled' and result['outputs']==[]


def test_source_and_result_tampering_fail_closed_and_paper_scope(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();svc=app.state.analysis;job=run(svc,doc,data)
        assert svc.cancel(doc['id'],job['id'])['status']=='succeeded'
        wrong=str(uuid4());assert c.get(f"/api/v1/documents/{wrong}/analyses/{job['id']}").status_code==404
        item=next(o for o in job['outputs'] if o['name']=='summary.json');svc.file(doc['id'],job['id'],'summary.json')[0].write_bytes(b'{}')
        assert c.get(item['url']).status_code==409
        assert c.get(job['export_url']).status_code==409
        assert c.get(f"/api/v1/documents/{doc['id']}/analyses/{job['id']}/files/workspace.sqlite3").status_code==404


def test_portable_bundle_hashes_original_code_environment_and_no_scripts_in_html(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        response=c.get(job['export_url']);assert response.status_code==200
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manifest=json.loads(archive.read('manifest.json'));assert set(archive.namelist())==set(manifest['files'])|{'manifest.json'}
            for name,item in manifest['files'].items():assert hashlib.sha256(archive.read(name)).hexdigest()==item['sha256']
            assert hashlib.sha256(archive.read('source.csv')).hexdigest()==data['sha256']
            assert hashlib.sha256(archive.read('analysis.py')).hexdigest()==job['recipe']['sha256']
            assert b'<script' not in archive.read('index.html')
            assert 'engine_version' in json.loads(archive.read('parameters.json'))


def test_independent_worker_executes_and_cleanly_shuts_down(tmp_path):
    with workspace(tmp_path,worker=True) as (c,app,doc,_):
        data=upload(c,doc).json();response=c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(data))
        assert response.status_code==201,response.text
        result=wait(c,doc,response.json()['id']);assert result['status']=='succeeded',result
        owned=app.state.analysis.supervisor.process;assert owned is not None and owned.poll() is None
    assert owned.poll() is not None


def test_schema_five_preserves_all_fourteen_tables(tmp_path):
    fixture=(Path(__file__).parent/'fixtures/schema-v5.sql').read_text(encoding='utf-8')
    with sqlite3.connect(tmp_path/'workspace.sqlite3') as db:
        db.executescript(fixture)
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        before={t:db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall() for t in tables};assert len(tables)==14
    Store(tmp_path)
    with sqlite3.connect(tmp_path/'workspace.sqlite3') as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==11
        assert all(db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall()==value for t,value in before.items())
        assert db.execute('SELECT COUNT(*) FROM analysis_jobs').fetchone()[0]==0
