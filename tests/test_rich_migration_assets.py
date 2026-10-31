import importlib.util
import json
from pathlib import Path
import sqlite3
from uuid import uuid4
from fastapi.testclient import TestClient
from analysis_support import workspace
from agent_support import ScriptedModel
from research_workbench.store import Store
from research_workbench.main import create_app
from test_rich_notes import create,state,body,prefix


def test_schema6_all_sixteen_tables_and_original_rows_survive(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    database=tmp_path/'workspace.sqlite3'
    with sqlite3.connect(database) as db:
        db.executescript((Path(__file__).parent/'fixtures/schema-v6.sql').read_text(encoding='utf-8'))
        doc,note=str(uuid4()),str(uuid4());stamp='2026-10-30T00:00:00+00:00'
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(doc,'Original','original.pdf',1,1,'a'*64,stamp))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,doc,1,None,'Original unformatted note',stamp))
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        assert len(tables)==16;before={t:db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall() for t in tables}
    store=Store(tmp_path)
    with sqlite3.connect(database) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==9
        for table,rows in before.items():assert db.execute(f'SELECT * FROM {table} ORDER BY 1').fetchall()==rows
        assert db.execute('SELECT COUNT(*) FROM note_rich_content').fetchone()[0]==0
    assert 'rich_content' not in store.lifecycle.get(doc,note)


def test_fresh_app_recovers_saved_format_and_review_without_replay(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        n=create(c,doc)[0].json();expected=state(c,doc,n)
    fresh_model=ScriptedModel();app=create_app(tmp_path,agent_provider=fresh_model,agent_autostart=False,analysis_autostart=False)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48001)) as c:
        assert state(c,doc,n)==expected and c.get(prefix(doc)+'/notes').json()['items']==[n]
        assert expected['rich_content']==body() and fresh_model.calls==[]


def test_original_pinned_assets_licenses_integrity_and_host_boundary(tmp_path):
    root=Path(__file__).resolve().parents[1]
    path=root/'scripts/prepare_rich_text_assets.py';spec=importlib.util.spec_from_file_location('rich_asset_check',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    assert module.verify()>=20
    manifest=json.loads((root/'frontend/vendor/rich-text/manifest.json').read_text(encoding='utf-8'))
    packages={p['name']:p for p in manifest['packages']}
    assert packages['quill']['version']=='2.0.3' and packages['quill']['license']=='BSD-3-Clause'
    assert packages['dompurify']['version']=='3.4.17' and all(p['notices'] for p in packages.values())
    assert not {'react','tinymce'}&set(packages) and not manifest['executors'] and not manifest['frameworks']
    with workspace(tmp_path) as (c,app,doc,_):
        response=c.get('/vendor/rich-text/editor.js');assert response.status_code==200 and len(response.content)>100000
        assert c.get('/vendor/rich-text/editor.js',headers={'Host':'not-local.test'}).status_code==403
