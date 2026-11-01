from migration_support import table_info
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
from uuid import uuid4
import zipfile
import pytest
from fastapi.testclient import TestClient
from analysis_support import workspace,upload,run,R_PATH
from agent_support import ScriptedModel
from chart_support import prefix,payload,prepare,save,lifecycle
from research_workbench.main import create_app
from research_workbench.store import Store


def test_schema8_preserves_all_nineteen_tables_rows_and_columns(tmp_path):
    dbpath=tmp_path/'workspace.sqlite3'
    with sqlite3.connect(dbpath) as db:
        db.executescript((Path(__file__).parent/'fixtures/schema-v8.sql').read_text(encoding='utf-8'))
        doc,note=str(uuid4()),str(uuid4());stamp='2026-10-31T00:00:00+00:00'
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(doc,'Original','original.pdf',1,1,'a'*64,stamp))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,doc,1,None,'Original unreviewed note',stamp))
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")];assert len(tables)==19
        before={t:(table_info(db,t),db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall()) for t in tables}
    Store(tmp_path)
    with sqlite3.connect(dbpath) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==14
        assert len(db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall())==30
        for t,old in before.items():assert (table_info(db,t),db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall())==old
        assert db.execute('SELECT COUNT(*) FROM charts').fetchone()[0]==db.execute('SELECT COUNT(*) FROM chart_operations').fetchone()[0]==0


def test_fresh_application_preserves_exact_chart_and_lifecycle_receipt(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc);chart=save(c,doc,body);response,request=lifecycle(c,doc,chart);expected=response.json()
    model=ScriptedModel();app=create_app(tmp_path,agent_provider=model,agent_autostart=False,analysis_autostart=False)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48001)) as c:
        assert c.get(prefix(doc)).json()['items']==[expected] and model.calls==[]
        assert c.request('DELETE',prefix(doc)+'/'+chart['id'],json=request).json()==expected
        restored=lifecycle(c,doc,expected,'restore')[0].json();assert c.get(restored['data_url']).status_code==200


@pytest.mark.parametrize('field,value',[('data_bytes',b'bad'),('data_bytes',b'"'+b'x'*4194304+b'"'),('data_sha256','X'*64),('origin','authenticated_user'),('revision',0)])
def test_database_rejects_invalid_or_oversize_data_and_workflow_identity(tmp_path,field,value):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc);save(c,doc,body)
        with app.state.store.connection() as db:
            with pytest.raises(sqlite3.IntegrityError):db.execute('UPDATE charts SET '+field+'=?',(value,))


def test_full_fifty_thousand_rows_and_maximum_bins_use_real_source(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        content=('value,second\n'+''.join(f'{n},{2*n}\n' for n in range(50000))).encode()
        data=upload(c,doc,content=content).json();chart=save(c,doc,payload(c,data,'scatter'))
        series=c.get(chart['data_url']).json()['series'];assert len(series['x'])==50000 and series['x'][-1]==49999 and series['y'][-1]==99998
        chart=save(c,doc,payload(c,data,bins=50));series=c.get(chart['data_url']).json()['series'];assert len(series['counts'])==50 and sum(series['counts'])==50000


@pytest.mark.parametrize('kind',['analysis_counts','histogram','scatter'])
def test_portable_export_exact_source_data_renderer_spec_and_safe_text(tmp_path,kind):
    with workspace(tmp_path) as (c,app,doc,_):
        dataset,body=prepare(c,app,doc,kind,title='<img src="https://evil.invalid/x" onerror="window.injected=1">')
        chart=save(c,doc,body);response=c.get(chart['export_url']);assert response.status_code==200,response.text
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names=archive.namelist();assert len(names)==len(set(names));manifest=json.loads(archive.read('manifest.json'))
            assert set(names)==set(manifest['files'])|{'manifest.json'}
            for name,entry in manifest['files'].items():
                raw=archive.read(name);assert len(raw)==entry['byte_size'] and hashlib.sha256(raw).hexdigest()==entry['sha256']
            assert archive.read('chart.json')==c.get(chart['data_url']).content
            assert archive.read('source.csv')==c.get(dataset['file_url']).content
            assert json.loads(archive.read('specification.json'))==chart['spec']
            html=archive.read('chart.html');assert b'<img src=' not in html and b'\\u003cimg' in html
            assert archive.read('LICENSE') and b'window.Plotly' in archive.read('chart-export.js')
            code_hash=hashlib.sha256(kind.encode()+archive.read('chart-projection.py')+archive.read('tabular.py')).hexdigest()
            assert code_hash==chart['recipe']['sha256']
            assert ('analysis-record.json' in names)==(kind=='analysis_counts')
        assert list(app.state.store.exports.iterdir())==[]
        assert lifecycle(c,doc,chart)[0].status_code==200 and c.get(chart['export_url']).status_code==409


def test_export_write_failure_cleans_partial_archive(tmp_path,monkeypatch):
    from research_workbench.reading_export import ArchiveWriter
    with workspace(tmp_path) as (c,app,doc,_):
        dataset,body=prepare(c,app,doc);chart=save(c,doc,body)
        monkeypatch.setattr(ArchiveWriter,'file',lambda *a:(_ for _ in ()).throw(PermissionError('secret-path')))
        r=c.get(chart['export_url']);assert r.status_code==503 and 'secret-path' not in r.text
        assert list(app.state.store.exports.iterdir())==[]


def test_original_pinned_renderer_hash_license_and_existing_host_csp_boundary(tmp_path):
    root=Path(__file__).resolve().parents[1];p=root/'scripts/prepare_plotly_assets.py'
    spec=importlib.util.spec_from_file_location('plotly_asset_verification',p);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);assert module.verify()==4
    with workspace(tmp_path) as (c,app,doc,_):
        cap=c.get('/api/v1/charts/capabilities').json();renderer=cap['renderer'];r=c.get(renderer['script_url'])
        assert r.status_code==200 and hashlib.sha256(r.content).hexdigest()==renderer['sha256']
        assert "'unsafe-eval'" not in r.headers['content-security-policy']
        assert c.get(renderer['script_url'],headers={'Host':'remote.invalid'}).status_code==403
        assert cap['arbitrary_code'] is False


def test_counts_can_project_an_actual_saved_r_analysis(tmp_path):
    if R_PATH is None:pytest.skip('Set RESEARCH_TEST_RSCRIPT for real R acceptance')
    with workspace(tmp_path,rscript=R_PATH) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data,engine='r',columns=['value','second'])
        assert job['status']=='succeeded',job
        chart=save(c,doc,payload(c,data,'analysis_counts',analysis_id=job['id']))
        value=c.get(chart['data_url']).json();assert value['series']['valid']==[3,2]
