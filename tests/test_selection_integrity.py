from migration_support import table_info
import hashlib
import json
from pathlib import Path
import sqlite3
from concurrent.futures import ThreadPoolExecutor
import subprocess
from uuid import uuid4
import pytest
from analysis_support import workspace, upload
from selection_support import prefix, prepared, save, spec
from research_workbench.models import WorkspaceError
from research_workbench.selection_models import SelectionCreate
from research_workbench.store import Store


def test_atomic_rollback_creates_no_dataset_or_cache(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();body,_=prepared(c,doc,data)
        with pytest.raises(RuntimeError):
            with app.state.store.connection() as db:
                db.execute('BEGIN IMMEDIATE');app.state.selections.create_in(db,doc['id'],SelectionCreate(**body))
                assert not list(app.state.selections.root.iterdir())
                raise RuntimeError('synthetic receipt storage failure')
        assert len(app.state.datasets.list(doc['id']))==1
        assert not list(app.state.selections.root.iterdir())
        assert c.post(prefix(doc),json=body).status_code==201


def test_missing_cache_rebuilds_but_changed_cache_or_ancestor_fails_closed(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();first,_,_=save(c,doc,data);second,_,_=save(c,doc,first)
        path=app.state.datasets.path(doc['id'],second['id']);raw=path.read_bytes();path.unlink()
        assert app.state.datasets.path(doc['id'],second['id']).read_bytes()==raw
        assert len(c.get(second['selection_provenance']['rows_url']).json()['steps'])==2
        path.write_bytes(b'changed');assert c.get(second['file_url']).status_code==409
        path.unlink();assert c.get(second['file_url']).content==raw
        app.state.datasets.path(doc['id'],data['id']).write_bytes(b'label,value\na,999\n')
        assert c.get(second['file_url']).status_code==409


@pytest.mark.parametrize('field,value', [('data_bytes',b'changed'),('source_rows_json','[2]'),('sources_json','{}'),('spec_json','{}'),('preview_json','{}')])
def test_lineage_corruption_fails_closed(tmp_path,field,value):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();child,_,_=save(c,doc,data)
        with app.state.store.connection() as db:db.execute(f'UPDATE dataset_selections SET {field}=? WHERE dataset_id=?',(value,child['id']))
        assert c.get(child['file_url']).status_code==409


def test_concurrent_same_request_and_quota(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();body,_=prepared(c,doc,data)
        def create():return app.state.selections.create(doc['id'],SelectionCreate(**body))
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:create(),range(2)))
        assert sorted(r[1] for r in results)==[False,True]
        assert results[0][0]==results[1][0]
        for i in range(18):assert upload(c,doc,name=f'quota-{i}.csv').status_code==201
        body,_=prepared(c,doc,data)
        assert c.post(prefix(doc),json=body).status_code==409
        assert len(app.state.datasets.list(doc['id']))==20


def test_busy_timeout_and_corrupted_worker_output(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();service=app.state.selections
        service.capacity.acquire();service.capacity.acquire()
        assert c.post(prefix(doc)+'/preview',json=spec(c,data)).status_code==429
        service.capacity.release();service.capacity.release()
        def timeout(*a,**kw):raise subprocess.TimeoutExpired('fixed probe',8)
        monkeypatch.setattr('research_workbench.dataset_selections.subprocess.run',timeout)
        assert c.post(prefix(doc)+'/preview',json=spec(c,data)).json()['detail']['code']=='selection_timeout'
        monkeypatch.setattr('research_workbench.dataset_selections.subprocess.run',lambda *a,**kw:subprocess.CompletedProcess([],0,b'invalid',b''))
        assert c.post(prefix(doc)+'/preview',json=spec(c,data)).json()['detail']['code']=='selection_failed'


def test_schema11_migration_preserves_all24_tables_columns_rows_and_file(tmp_path):
    database=tmp_path/'workspace.sqlite3';doc,note=str(uuid4()),str(uuid4())
    with sqlite3.connect(database) as db:
        db.executescript((Path(__file__).parent/'fixtures/schema-v11.sql').read_text(encoding='utf-8'))
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(doc,'Original','original.pdf',1,1,'a'*64,'2026-10-31'))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,doc,1,None,'Preserve me','2026-10-31'))
        names=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        before={n:(table_info(db,n),db.execute(f'SELECT * FROM {n} ORDER BY 1').fetchall()) for n in names}
    files=tmp_path/'documents';files.mkdir();material=files/(doc+'.pdf');material.write_bytes(b'preserve exact bytes')
    Store(tmp_path)
    with sqlite3.connect(database) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==13 and len(names)==24
        assert {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}-set(names)=={'dataset_selections','studies','study_note_sources','study_papers'}
        assert before=={n:(table_info(db,n),db.execute(f'SELECT * FROM {n} ORDER BY 1').fetchall()) for n in names}
    assert material.read_bytes()==b'preserve exact bytes'
