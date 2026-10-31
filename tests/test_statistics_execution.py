from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import threading
import zipfile
import pytest
from agent_support import text_pdf
from statistics_support import workspace,payload
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute
from research_workbench.models import WorkspaceError
from research_workbench.statistics_library import StatisticsLibrary

REFERENCE=json.loads((Path(__file__).parent/'fixtures/ttest-reference.json').read_text(encoding='utf-8'))['cases']


def run(app,doc,body,**options):
    service=app.state.analysis;job,_=service.create(doc['id'],AnalysisCreate(**body))
    row=service.claim();execute(service,row,threading.Event(),**options)
    return service.get(doc['id'],job['id'])


@pytest.mark.parametrize('case',REFERENCE)
def test_actual_r_matches_independent_50_digit_reference(tmp_path,case):
    with workspace(tmp_path) as (c,app,doc,data,_):
        body=payload(c,data)
        body['ttest'].update({key:case[key] for key in ('variant','alternative','confidence')})
        if case['reverse']:body['ttest']['groups'].reverse()
        job=run(app,doc,body);assert job['status']=='succeeded',job
        actual=job['result']['test'];expected=case['expected']
        for key in ('statistic','df','p_value','difference','standard_error'):
            assert actual[key]==pytest.approx(expected[key],rel=1e-11,abs=1e-13)
        for key in ('lower','upper'):
            if expected['ci'][key] is None:assert actual['ci'][key] is None
            else:assert actual['ci'][key]==pytest.approx(expected['ci'][key],rel=1e-11,abs=1e-12)
        assert actual['ci']['lower_unbounded']==expected['ci']['lower_unbounded']
        assert actual['ci']['upper_unbounded']==expected['ci']['upper_unbounded']
        assert job['result']['counts']['used']==10 and job['result']['counts']['excluded']==3
        assert job['result']['software']['stats']=='4.6.2'


def test_preview_no_write_groups_scope_retry_and_conflict(tmp_path):
    with workspace(tmp_path) as (c,app,doc,data,_):
        prefix='/api/v1/documents/'+doc['id'];body=payload(c,data)
        response=c.post(prefix+'/analyses/ttest/groups',json={key:body[key] for key in ('dataset_id','dataset_sha256')}|{'group_column':'group'})
        assert response.status_code==200 and response.json()['groups']==[{'label':'A','rows':6},{'label':'B','rows':5}]
        response=c.post(prefix+'/analyses/ttest/preview',json=body)
        assert response.status_code==200,response.text
        assert response.json()['saved'] is False and 'test' not in response.json()
        assert c.get(prefix+'/analyses').json()['items']==[]
        assert c.post(prefix+'/analyses',json=body).status_code==201
        assert c.post(prefix+'/analyses',json=body).status_code==200
        changed=deepcopy(body);changed['ttest']['groups'].reverse()
        assert c.post(prefix+'/analyses',json=changed).status_code==409
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert c.post('/api/v1/documents/'+other['id']+'/analyses/ttest/preview',json=body).status_code==404


@pytest.mark.parametrize('field',['dataset_sha256','recipe_sha256','library_sha256'])
def test_changed_input_code_or_library_never_queues(tmp_path,field):
    with workspace(tmp_path) as (c,app,doc,data,_):
        body=payload(c,data);body[field]='f'*64
        assert c.post('/api/v1/documents/'+doc['id']+'/analyses',json=body).status_code==409
        assert app.state.analysis.list(doc['id'])==[]


def test_library_missing_does_not_disable_old_descriptive_methods(tmp_path):
    with workspace(tmp_path,statistics=False) as (c,app,doc,data,_):
        methods=c.get('/api/v1/analysis/methods').json()['items']
        assert methods[0]['available'] and not methods[1]['available']
        assert c.get('/api/v1/analysis/recipes/python').json()['id']=='describe-v1'


@pytest.mark.parametrize('mode',['cancel','restart','timeout','failed_process','stop'])
def test_non_success_states_never_publish_results(tmp_path,monkeypatch,mode):
    with workspace(tmp_path) as (c,app,doc,data,_):
        service=app.state.analysis;body=payload(c,data)
        job,_=service.create(doc['id'],AnalysisCreate(**body))
        if mode=='cancel':
            assert service.cancel(doc['id'],job['id'])['status']=='cancelled';assert service.claim() is None
        else:
            row=service.claim();stop=threading.Event()
            if mode=='restart':service.recover()
            else:
                code='import time;time.sleep(30)' if mode in ('timeout','stop') else 'raise SystemExit(2)'
                monkeypatch.setattr(service.catalog,'command',lambda *args:[sys.executable,'-c',code])
                if mode=='stop':stop.set()
                execute(service,row,stop,timeout=.1)
        actual=service.get(doc['id'],job['id'])
        assert actual['status'] in ('cancelled','interrupted','failed')
        assert actual['result'] is None and actual['outputs']==[]
        assert service.create(doc['id'],AnalysisCreate(**body))[1] is False


def test_saved_artifacts_notebook_export_restart_and_tamper(tmp_path):
    with workspace(tmp_path) as (c,app,doc,data,_):
        body=payload(c,data);job=run(app,doc,body);assert job['status']=='succeeded'
        prefix='/api/v1/documents/'+doc['id']+'/analyses/'+job['id']
        notebook=c.get(prefix+'/notebook');assert notebook.status_code==200
        assert 'p_value' in notebook.text and 'stats::t.test' in notebook.text
        archive=c.get(job['export_url']);assert archive.status_code==200
        with zipfile.ZipFile(io.BytesIO(archive.content)) as z:
            manifest=json.loads(z.read('manifest.json'))
            for name,info in manifest['files'].items():
                content=z.read(name);assert hashlib.sha256(content).hexdigest()==info['sha256'] and len(content)==info['byte_size']
            assert {'r-stats-result.tsv','test.csv','environment.json','statistics-lock.json','analysis.ipynb'}<=set(z.namelist())
            assert hashlib.sha256(z.read('source.csv')).hexdigest()==data['sha256']
            assert b'p_value' in z.read('index.html')
        service=app.state.analysis;service.recover();assert service.get(doc['id'],job['id'])==job
        (service.directory(job['id'])/'summary.json').write_text('{}',encoding='utf-8')
        assert c.get(prefix+'/notebook').status_code==409
        assert c.get(prefix+'/export').status_code==409


def test_manifest_and_actual_file_drift_fail_closed(tmp_path):
    import os
    original=Path(os.environ['RESEARCH_TEST_STATISTICS_ROOT']);manifest=json.loads((original/'manifest.json').read_text(encoding='utf-8'))
    home=tmp_path/'r';shutil.copytree(Path(manifest['r_home'])/'library/stats',home/'library/stats')
    root=tmp_path/'manifest';root.mkdir();manifest['r_home']=str(home)
    (root/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
    library=StatisticsLibrary(root);assert library.available
    target=home/'library'/next(iter(manifest['library_files']));target.write_bytes(b'changed')
    with pytest.raises(WorkspaceError):library.require(library.sha256)


@pytest.mark.parametrize('mode',['invalid_output','permission','source_changed','cancel_running'])
def test_method_specific_publication_failures(tmp_path,monkeypatch,mode):
    import time
    from research_workbench import ttest_result
    with workspace(tmp_path) as (c,app,doc,data,_):
        service=app.state.analysis;body=payload(c,data)
        job,_=service.create(doc['id'],AnalysisCreate(**body));row=service.claim()
        if mode=='invalid_output':
            code="from pathlib import Path;Path('r-stats-result.tsv').write_text('bad\\n1\\n')"
            monkeypatch.setattr(service.catalog,'command',lambda *args:[sys.executable,'-c',code])
        if mode=='permission':
            def denied(*args):raise PermissionError('Synthetic write denial')
            monkeypatch.setattr(ttest_result,'artifacts',denied)
        if mode=='source_changed':service.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        if mode=='cancel_running':
            monkeypatch.setattr(service.catalog,'command',lambda *args:[sys.executable,'-c','import time;time.sleep(30)'])
            thread=threading.Thread(target=execute,args=(service,row,threading.Event()));thread.start()
            deadline=time.monotonic()+5
            while not (service.directory(job['id'])/'stdout.txt').exists() and time.monotonic()<deadline:time.sleep(.01)
            service.cancel(doc['id'],job['id']);thread.join(6);assert not thread.is_alive()
        else:execute(service,row,threading.Event())
        saved=service.get(doc['id'],job['id'])
        assert saved['status'] in ('failed','cancelled') and saved['result'] is None and saved['outputs']==[]
