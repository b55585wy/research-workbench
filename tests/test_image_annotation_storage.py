from migration_support import table_info
import importlib.util
import json
from pathlib import Path
import sqlite3
from uuid import uuid4
from fastapi.testclient import TestClient
import pytest
from analysis_support import workspace
from agent_support import ScriptedModel
from image_annotation_support import make_source,create,mutate
from research_workbench.main import create_app
from research_workbench.store import Store


def test_schema7_all_seventeen_original_tables_and_fields_are_preserved(tmp_path):
    database=tmp_path/'workspace.sqlite3'
    with sqlite3.connect(database) as db:
        db.executescript((Path(__file__).parent/'fixtures/schema-v7.sql').read_text(encoding='utf-8'))
        doc,note=str(uuid4()),str(uuid4());stamp='2026-10-31T00:00:00+00:00'
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(doc,'Original','original.pdf',1,1,'a'*64,stamp))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,doc,1,None,'Original plain note',stamp))
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")];assert len(tables)==17
        before={t:(table_info(db,t),db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall()) for t in tables}
    Store(tmp_path)
    with sqlite3.connect(database) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==15
        assert len(db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall())==31
        for t,(columns,rows) in before.items():assert (table_info(db,t),db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall())==(columns,rows)
        assert db.execute('SELECT COUNT(*) FROM image_annotations').fetchone()[0]==0


@pytest.mark.parametrize('kind',['user_upload','pdf_excerpt'])
def test_fresh_application_restores_annotations_and_receipts_without_replay(tmp_path,kind):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc,kind);item=create(c,source,url)[0].json();edited,payload=mutate(c,source,url,item,text='Persisted annotation');expected=edited.json()
    model=ScriptedModel();app=create_app(tmp_path,agent_provider=model,agent_autostart=False,analysis_autostart=False)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48001)) as c:
        assert c.get(url).json()['items']==[expected] and model.calls==[]
        assert c.patch(url+'/annotations/'+item['id'],json=payload).json()==expected


def clone_rows(app,doc,source,row,count):
    with app.state.store.connection() as db:
        columns=[r[1] for r in db.execute('PRAGMA table_info(image_annotations)')]
        for _ in range(count):
            value=dict(row);value.update(id=str(uuid4()),image_id=source['source_id'],excerpt_note_id=None,source_sha256=source['source_sha256'],frame_sha256=source['frame_sha256'],deleted_at='2026-10-31T00:00:00+00:00')
            db.execute('INSERT INTO image_annotations VALUES ('+','.join('?' for _ in columns)+')',[value[k] for k in columns])


def test_limits_count_trash_at_one_hundred_per_source_and_five_hundred_per_document(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);create(c,source,url)
        with app.state.store.connection() as db:row=dict(db.execute('SELECT * FROM image_annotations').fetchone())
        clone_rows(app,doc,source,row,98);assert create(c,source,url)[0].status_code==201
        assert create(c,source,url)[0].status_code==413
        for _ in range(4):
            other,_,_=make_source(c,app,doc);clone_rows(app,doc,other,row,100)
        other,_,other_url=make_source(c,app,doc);assert create(c,other,other_url)[0].status_code==413


@pytest.mark.parametrize('changes',[{'rect':'[true,0,1,1]'}, {'rect':'[0,0,0,1]'}, {'rect':'[0,0,2,1]'}, {'text':''}, {'revision':0}, {'origin':'authenticated_user'}, {'image_id':None}, {'excerpt_note_id':str(uuid4())}])
def test_database_rejects_invalid_geometry_origin_version_and_source(changes,tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);create(c,source,url)
        with app.state.store.connection() as db:
            with pytest.raises(sqlite3.IntegrityError):db.execute('UPDATE image_annotations SET '+','.join(k+'=?' for k in changes),list(changes.values()))


def test_pinned_assets_inventory_notices_and_loopback_boundary(tmp_path):
    root=Path(__file__).resolve().parents[1];p=root/'scripts/prepare_image_annotation_assets.py'
    spec=importlib.util.spec_from_file_location('image_asset_check',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);assert m.verify()>100
    manifest=json.loads((root/'frontend/vendor/image-annotations/manifest.json').read_text(encoding='utf-8'))
    assert {'openseadragon','@annotorious/openseadragon','@pixi/unsafe-eval'}<={p['name'] for p in manifest['packages']}
    assert all(p['notices'] for p in manifest['packages']) and 'prebundled' in manifest['notice_scope']
    with workspace(tmp_path) as (c,app,doc,_):
        response=c.get('/vendor/image-annotations/viewer.js');assert response.status_code==200
        assert "'unsafe-eval'" not in response.headers['content-security-policy']
        assert c.get('/vendor/image-annotations/viewer.js',headers={'Host':'external.invalid'}).status_code==403
