from migration_support import table_info
import sqlite3
from pathlib import Path
import pytest
from analysis_support import workspace
from agent_support import confirm,answer,submit
from task_support import begin,state,control,analysis_checkpoint,context,prefix,checkpoint
from research_workbench.store import Store


@pytest.mark.parametrize('point',['queued','confirmation','analysis','chart'])
def test_restart_pauses_checkpoints_and_never_replays_success(tmp_path,point):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model)
        if point!='queued':pending=analysis_checkpoint(c,app,doc,model,data)
        if point in ('analysis','chart'):
            assert confirm(c,doc,pending).status_code==200
            app.state.agent.tasks.tick()
        if point=='chart':
            import threading
            from research_workbench.analysis_worker import execute
            execute(app.state.analysis,app.state.analysis.claim(),threading.Event());app.state.agent.tasks.tick()
        before=state(c,doc,root);calls=len(model.calls)
        app.state.agent.store.recover();app.state.agent.tasks.recover()
        for _ in range(3):app.state.agent.tasks.tick()
        paused=state(c,doc,root);assert paused['status']=='paused' and paused['generation']==before['generation']+1
        assert len(model.calls)==calls
        resumed,_=control(c,doc,paused,'resume');assert resumed.status_code==200,resumed.text
        assert len(app.state.analysis.list(doc['id']))==(1 if point in ('analysis','chart') else 0)
        if point=='confirmation':assert resumed.json()['current_turn_id']==pending['id']
        if point=='chart':assert resumed.json()['phase']=='chart'


def test_active_task_and_turn_bounds_and_manual_mode_default(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        roots=[begin(c,app,doc,model) for _ in range(5)]
        from analysis_support import upload
        data=upload(c,doc).json()
        assert submit(c,doc,'Sixth task',continue_task=True,context=context(data)).status_code==429
        for _,root in roots:assert control(c,doc,state(c,doc,root),'stop')[0].status_code==200
        ordinary=submit(c,doc);assert ordinary.status_code==202 and 'task_id' not in ordinary.json()['context']
        assert len(c.get(prefix(doc)).json()['items'])==5


def test_schema10_migration_preserves_original_rows_and_adds_only_two_tables(tmp_path):
    from uuid import uuid4
    fixture=Path(__file__).parents[1]/'tests/fixtures/schema-v10.sql'
    root=tmp_path/'db';root.mkdir()
    with sqlite3.connect(root/'workspace.sqlite3') as db:
        db.executescript(fixture.read_text(encoding='utf-8'))
        doc,note=str(uuid4()),str(uuid4())
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(doc,'Original','original.pdf',1,10,'a'*64,'2026-10-31'))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,doc,1,None,'Original note','2026-10-31'))
        db.executescript(fixture.read_text(encoding='utf-8'))
        names=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        before={n:(table_info(db,n),list(db.execute(f'SELECT * FROM {n}'))) for n in names}
    Store(root)
    with sqlite3.connect(root/'workspace.sqlite3') as db:
        after={n:(table_info(db,n),list(db.execute(f'SELECT * FROM {n}'))) for n in names}
        allnames={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        assert before==after and len(names)==22
        assert allnames-set(names)=={'agent_tasks','agent_task_operations','dataset_selections','studies','study_note_sources','study_papers','document_trash','purged_notes'} and db.execute('PRAGMA user_version').fetchone()[0]==14
