from copy import deepcopy
import hashlib,io,json,os,subprocess,sys,threading,zipfile
from pathlib import Path
import pytest
from paired_support import CSV,payload,preview,workspace
from test_statistics_execution import run
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_recipes import recipe
from research_workbench.analysis_worker import execute
from research_workbench.models import WorkspaceError

ROOT=Path(__file__).resolve().parents[1]
REFERENCE=json.loads((ROOT/'tests/fixtures/paired-reference.json').read_text(encoding='utf-8'))


@pytest.fixture(scope='session')
def sleep_csv(tmp_path_factory):
    rscript=os.environ.get('RESEARCH_TEST_RSCRIPT')
    if not rscript:pytest.skip('Explicit R runtime required')
    output=tmp_path_factory.mktemp('sleep-source')/'data'
    subprocess.run([rscript,'--vanilla',str(ROOT/'examples/sleep/prepare-sleep.R'),str(output)],check=True,capture_output=True,timeout=20)
    raw=(output/'sleep-wide.csv').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==REFERENCE['sleep_wide_sha256']
    return raw


@pytest.mark.parametrize('case',REFERENCE['cases'])
def test_actual_r_paired_matches_independent_60_digit_reference(tmp_path,sleep_csv,case):
    content=sleep_csv if case['sample']=='sleep' else CSV
    with workspace(tmp_path,content=content) as (c,app,doc,data,_):
        body=payload(c,data,columns=['drug1','drug2'] if case['sample']=='sleep' else ['first','second'])
        body['paired'].update({k:case[k] for k in ('alternative','confidence')})
        if case['reverse']:body['columns'].reverse()
        job=run(app,doc,body);assert job['status']=='succeeded',job
        actual=job['result']['test'];expected=case['expected']
        for key in ('statistic','df','p_value','difference','standard_error'):
            assert actual[key]==pytest.approx(expected[key],rel=1e-11,abs=1e-13)
        for key in ('lower','upper'):
            assert actual['ci'][key]==(None if expected['ci'][key] is None else pytest.approx(expected['ci'][key],rel=1e-11,abs=1e-12))
            assert actual['ci'][key+'_unbounded']==expected['ci'][key+'_unbounded']
        assert job['result']['stats_basis']=='complete_pairs' and actual['variant']=='paired'
        assert job['result']['counts']['used']==(10 if case['sample']=='sleep' else 3)
        assert job['result']['software']['stats']=='4.6.2'


def test_frozen_maps_preparation_notebook_and_export(tmp_path):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        body=payload(c,data);job=run(app,doc,body);assert job['status']=='succeeded',job
        prefix=f"/api/v1/documents/{doc['id']}/analyses/{job['id']}"
        note=c.get(prefix+'/notebook');assert note.status_code==200,note.text
        assert 'Paired samples' in note.text and 'Complete pairs' in note.text and 'Independent samples' not in note.text
        response=c.get(job['export_url']);assert response.status_code==200,response.text
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manifest=json.loads(archive.read('manifest.json'))
            for name,item in manifest['files'].items():
                raw=archive.read(name);assert len(raw)==item['byte_size'] and hashlib.sha256(raw).hexdigest()==item['sha256']
            assert archive.read('source.csv')==CSV
            mapping=json.loads(archive.read('pair-map.json'));assert mapping['dataset_sha256']==data['sha256']
            assert [r['unit_id'] for r in mapping['rows']]==['01','02','03','04','05','06']
            assert [r['source_row'] for r in mapping['rows'] if r['used']]==[1,2,3]
            assert b'Complete pairs per measurement' in archive.read('chart.svg')
            assert b'complete_pairs,excluded_pairs' in archive.read('summary.csv')
            assert b'paired=TRUE' in archive.read('analysis.R') and b'Input preparation SHA-256:' in archive.read('analysis.R')
            assert {'paired_ttest_data.py','tabular.py','preparation-sources.json','statistics-lock.json','test.csv'}<=set(archive.namelist())


@pytest.mark.parametrize('name',['pair-map.json','preparation-sources.json','paired_ttest_data.py','tabular.py','input.tsv','parameters.json'])
def test_traceability_drift_rejects_result_notebook_and_export(tmp_path,name):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        job=run(app,doc,payload(c,data));assert job['status']=='succeeded',job
        (app.state.analysis.directory(job['id'])/name).write_bytes(b'changed')
        with pytest.raises(WorkspaceError):app.state.analysis.result(doc['id'],job['id'])
        assert c.get(f"/api/v1/documents/{doc['id']}/analyses/{job['id']}/notebook").status_code==409
        assert c.get(job['export_url']).status_code==409


@pytest.mark.parametrize('mode',['cancel','restart','timeout','failed_process','stop','permission'])
def test_failed_or_interrupted_paired_run_publishes_no_result(tmp_path,monkeypatch,mode):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        service=app.state.analysis;body=payload(c,data);job,_=service.create(doc['id'],AnalysisCreate(**body))
        if mode=='cancel':service.cancel(doc['id'],job['id']);assert service.claim() is None
        else:
            row=service.claim();stop=threading.Event()
            if mode=='restart':service.recover()
            else:
                if mode=='permission':
                    from research_workbench import paired_ttest_result
                    def denied(*args):raise PermissionError('Synthetic failure')
                    monkeypatch.setattr(paired_ttest_result,'artifacts',denied)
                else:
                    source='raise SystemExit(2)' if mode=='failed_process' else 'import time; time.sleep(30)'
                    monkeypatch.setattr(service.catalog,'command',lambda *args:[sys.executable,'-c',source])
                if mode=='stop':stop.set()
                execute(service,row,stop,timeout=.1)
        value=service.get(doc['id'],job['id']);assert value['status'] in ('cancelled','interrupted','failed') and value['outputs']==[] and value['result'] is None
        assert not (service.directory(job['id'])/'pair-map.json').exists()


@pytest.mark.parametrize('field',['dataset_sha256','recipe_sha256','library_sha256'])
def test_changed_binding_never_queues(tmp_path,field):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        body=payload(c,data);body[field]='f'*64
        assert c.post(f"/api/v1/documents/{doc['id']}/analyses",json=body).status_code==409
        assert app.state.analysis.list(doc['id'])==[]


def test_exact_retry_scope_and_conflict(tmp_path):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        body=payload(c,data);url=f"/api/v1/documents/{doc['id']}/analyses"
        assert c.post(url,json=body).status_code==201 and c.post(url,json=body).status_code==200
        changed=deepcopy(body);changed['columns'].reverse();assert c.post(url,json=changed).status_code==409
        from agent_support import text_pdf
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert preview(c,other,body).status_code==404


def test_na_unicode_and_leading_zero_unit_identifiers_are_preserved(tmp_path):
    raw='ID,first,second\nNA,1,2\n001,3,5\n对象甲,5,6\n'.encode()
    with workspace(tmp_path,content=raw) as (c,app,doc,data,_):
        job=run(app,doc,payload(c,data));assert job['status']=='succeeded',job
        mapping=json.loads((app.state.analysis.directory(job['id'])/'pair-map.json').read_text(encoding='utf-8'))
        assert [r['unit_id'] for r in mapping['rows']]==['NA','001','对象甲']


def test_old_recipe_bytes_unchanged():
    values=json.loads((ROOT/'tests/fixtures/paired-compatibility.json').read_text())
    assert recipe('python')['sha256']==values['python_describe']
    assert recipe('r')['sha256']==values['r_describe']
    assert recipe('r','ttest_independent')['sha256']==values['independent']
