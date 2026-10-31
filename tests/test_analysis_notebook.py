import hashlib
import io
import json
from pathlib import Path
from uuid import uuid4
import zipfile
import nbformat
import pytest

from analysis_support import R_PATH,workspace,upload,run,payload
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_notebook import MAX_NOTEBOOK_BYTES,serialize


def url(doc,job):return f"/api/v1/documents/{doc['id']}/analyses/{job['id']}/notebook"


def rows(store):
    with store.connection() as db:
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {t:[tuple(r) for r in db.execute(f'SELECT * FROM {t} ORDER BY 1')] for t in tables}


def rewrite_output(service,doc,job,name,data):
    (service.directory(job['id'])/name).write_bytes(data)
    outputs=[{k:v for k,v in o.items() if k!='url'} for o in job['outputs']]
    item=next(o for o in outputs if o['name']==name)
    item.update(sha256=hashlib.sha256(data).hexdigest(),byte_size=len(data))
    with service.store.connection() as db:db.execute('UPDATE analysis_jobs SET outputs_json=? WHERE id=?',(json.dumps(outputs),job['id']))


@pytest.mark.parametrize('engine',['python','r'])
def test_real_job_notebook_is_standard_exact_readonly_and_deterministic(tmp_path,engine):
    if engine=='r' and R_PATH is None:pytest.skip('Actual R requires RESEARCH_TEST_RSCRIPT')
    with workspace(tmp_path) as (c,app,doc,model):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data,engine,['value','second'])
        before=rows(app.state.store)
        response=c.get(url(doc,job));assert response.status_code==200,response.text
        book=nbformat.reads(response.text,as_version=4);nbformat.validate(book,version=4,version_minor=5)
        assert book.nbformat_minor==5 and book.metadata.language_info.name==engine
        provenance=book.metadata.workbench
        assert provenance.analysis_id==job['id'] and provenance.dataset_sha256==data['sha256']
        assert provenance.engine_version==job['engine_version'] and not provenance.code_executed_in_view
        assert provenance.read_only and not provenance.source_data_embedded
        saved=next(cell for cell in book.cells if cell.id=='analysis-code')
        script='analysis.py' if engine=='python' else 'analysis.R'
        assert saved.source==(app.state.analysis.directory(job['id'])/script).read_text(encoding='utf-8')
        assert hashlib.sha256(saved.source.encode()).hexdigest()==job['recipe']['sha256']
        assert all(cell.metadata.editable is False and cell.metadata.deletable is False for cell in book.cells)
        assert all(cell.execution_count is None for cell in book.cells if cell.cell_type=='code')
        assert 'Completed descriptive summary' in saved.outputs[0].text
        result=next(cell for cell in book.cells if cell.id=='saved-artifacts')
        assert '<table>' in result.outputs[0].data['text/html'] and '<svg' in result.outputs[1].data['image/svg+xml']
        assert response.headers['cache-control']=='no-store' and job['id']+'.ipynb' in response.headers['content-disposition']
        assert c.get(url(doc,job)).content==response.content
        assert rows(app.state.store)==before and model.calls==[]


def test_analysis_zip_has_identical_notebook_and_verified_manifest(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        book=c.get(url(doc,job)).content;download=c.get(job['export_url']);assert download.status_code==200
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            assert archive.read('analysis.ipynb')==book
            manifest=json.loads(archive.read('manifest.json'));assert set(archive.namelist())==set(manifest['files'])|{'manifest.json'}
            for name,expected in manifest['files'].items():assert hashlib.sha256(archive.read(name)).hexdigest()==expected['sha256']
            assert hashlib.sha256(archive.read('source.csv')).hexdigest()==data['sha256']
            assert b'<script' not in archive.read('index.html')
        assert not list(app.state.store.exports.iterdir())


@pytest.mark.parametrize('status',['queued','running','failed','cancelled','interrupted'])
def test_unfinished_states_never_publish_a_notebook(tmp_path,status):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();service=app.state.analysis;job,_=service.create(doc['id'],AnalysisCreate(**payload(data)))
        if status=='running':service.claim()
        if status=='failed':service.fail(job['id'],'test_failure','Synthetic failure')
        if status=='cancelled':service.cancel(doc['id'],job['id'])
        if status=='interrupted':service.interrupt(job['id'],'Synthetic interruption')
        response=c.get(url(doc,job));assert response.status_code==409 and response.json()['detail']['code']=='analysis_not_complete'
        assert service.get(doc['id'],job['id'])['status']==status


@pytest.mark.parametrize('name',['analysis.py','parameters.json','summary.json','stdout.txt','stderr.txt','chart.svg'])
@pytest.mark.parametrize('operation',['change','missing'])
def test_missing_or_tampered_artifact_fails_closed(tmp_path,name,operation):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        target=app.state.analysis.directory(job['id'])/name
        if operation=='missing':target.unlink()
        else:target.write_bytes(target.read_bytes()+b'changed')
        response=c.get(url(doc,job));assert response.status_code==409,response.text
        assert response.json()['detail']['code']=='analysis_output_changed'


@pytest.mark.parametrize('key,value',[('request_id',str(uuid4())),('dataset_sha256','0'*64),('columns',['other']),('engine','r')])
def test_validly_hashed_parameters_cannot_claim_another_job(tmp_path,key,value):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data);service=app.state.analysis
        saved=json.loads((service.directory(job['id'])/'parameters.json').read_bytes());saved['parameters'][key]=value
        rewrite_output(service,doc,job,'parameters.json',json.dumps(saved).encode())
        assert c.get(url(doc,job)).status_code==409


def test_saved_code_survives_current_recipe_change(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data);original=c.get(url(doc,job)).content
        import research_workbench.analysis_recipes as recipes
        monkeypatch.setattr(recipes,'PYTHON_CODE',recipes.PYTHON_CODE+'\n# future recipe')
        assert c.get(url(doc,job)).content==original


def test_paper_scope_source_drift_and_no_credentials(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        (app.state.store.root/'.agent-model.json').write_text('{"api_key":"SENTINEL_PRIVATE_MODEL_KEY"}')
        response=c.get(url(doc,job));assert b'SENTINEL_PRIVATE_MODEL_KEY' not in response.content
        assert str(app.state.store.root) not in response.text
        assert c.get(url({'id':str(uuid4())},job)).status_code==404
        assert c.get(url(doc,{'id':str(uuid4())})).status_code==404
        app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        response=c.get(url(doc,job));assert response.status_code==409 and response.json()['detail']['code']=='dataset_changed'


def test_literal_metadata_and_escaped_table_labels(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        name='literal````[x](bad).csv';column='<img src=x onerror=alert(1)>'
        data=upload(c,doc,(column+'\n1\n2\n3\n').encode(),name).json();job=run(app.state.analysis,doc,data,columns=[column])
        book=c.get(url(doc,job)).json();nbformat.validate(book)
        overview=book['cells'][0]['source'];assert '`````json' in overview and name in overview
        html=book['cells'][-1]['outputs'][0]['data']['text/html'];assert '<img' not in html and '&lt;img' in html


def test_notebook_cap_rejects_oversize_stream_and_serialization_boundaries(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        rewrite_output(app.state.analysis,doc,job,'stdout.txt',b'x'*(MAX_NOTEBOOK_BYTES-100))
        response=c.get(url(doc,job));assert response.status_code==413 and response.json()['detail']['code']=='notebook_too_large'
    book={'nbformat':4,'nbformat_minor':5,'metadata':{},'cells':[]}
    base=len(serialize(book));book['metadata']['padding']=''
    overhead=len(serialize(book));book['metadata']['padding']='x'*(MAX_NOTEBOOK_BYTES-overhead)
    assert len(serialize(book))==MAX_NOTEBOOK_BYTES
    book['metadata']['padding']+='x'
    from research_workbench.models import WorkspaceError
    with pytest.raises(WorkspaceError) as error:serialize(book)
    assert error.value.code=='notebook_too_large'


def test_failed_read_permissions_do_not_expose_paths(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data);target=app.state.analysis.directory(job['id'])/'stdout.txt';original=Path.open
        def denied(path,*args,**kwargs):
            if path==target:raise PermissionError('hidden internal path')
            return original(path,*args,**kwargs)
        monkeypatch.setattr(Path,'open',denied)
        response=c.get(url(doc,job));assert response.status_code==503 and 'hidden internal path' not in response.text


def test_output_changes_after_job_validation_fail_before_returning_body(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        target=app.state.analysis.directory(job['id'])/'stdout.txt';original=Path.open;changed=False
        def racing(path,*args,**kwargs):
            nonlocal changed
            if path==target and args and args[0]=='rb' and not changed:
                changed=True;target.write_bytes(b'changed after metadata read')
            return original(path,*args,**kwargs)
        monkeypatch.setattr(Path,'open',racing)
        response=c.get(url(doc,job));assert changed and response.status_code==409
        assert response.json()['detail']['code']=='analysis_output_changed'
