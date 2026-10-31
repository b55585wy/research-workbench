from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest

from agent_support import answer,confirm,submit,upload_image
from analysis_support import workspace,upload
from task_support import begin,state,control,analysis_checkpoint,successful_analysis,chart_checkpoint,note_responses,checkpoint,prefix,context


def test_concurrent_identical_start_has_one_task_and_conversation(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data=upload(c,doc).json()
        payload={'request_id':str(uuid4()),'continue_task':True,'message':'One concurrent goal','context':context(data)}
        with ThreadPoolExecutor(2) as pool:
            responses=list(pool.map(lambda _:c.post(f"/api/v1/documents/{doc['id']}/agent/turns",json=payload),range(2)))
        assert [r.status_code for r in responses]==[202,202]
        assert responses[0].json()['id']==responses[1].json()['id']
        assert len(c.get(prefix(doc)).json()['items'])==1
        assert len(app.state.agent.store.conversations(doc['id']))==1


@pytest.mark.parametrize('point',['chart','note'])
def test_completed_output_drift_blocks_downstream_confirmation(tmp_path,point):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);successful_analysis(c,app,doc,model,data,root)
        pending=chart_checkpoint(c,app,doc,model,data)
        if point=='note':
            assert confirm(c,doc,pending).status_code==200
            app.state.agent.tasks.tick()
            pending=checkpoint(c,app,doc,model,note_responses(doc,state(c,doc,root)))
        task=state(c,doc,root)
        if point=='chart':app.state.analysis.directory(task['analysis_id']).joinpath('summary.json').write_text('{}')
        else:
            with app.state.store.connection() as db:db.execute("UPDATE charts SET deleted_at='2026-10-31' WHERE id=?",(task['chart_id'],))
        result=confirm(c,doc,pending);assert result.status_code==409,result.text
        assert not c.get(f"/api/v1/documents/{doc['id']}/notes").json()['items']
        assert app.state.agent.store.get(doc['id'],pending['id'])['proposals'][0]['status']=='pending'


def test_shared_image_file_drift_blocks_confirmation(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data=upload(c,doc).json();image=upload_image(c,doc).json()
        root=submit(c,doc,'Describe and plot shared data',continue_task=True,context=context(data,image_ids=[image['id']])).json()
        pending=analysis_checkpoint(c,app,doc,model,data)
        app.state.images.path(doc['id'],image['id'],True).write_bytes(b'changed')
        assert confirm(c,doc,pending).status_code==409
        assert not app.state.analysis.list(doc['id'])


def test_bounded_continuation_turns_preserve_history_on_limit(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model)
        for index in range(8):
            checkpoint(c,app,doc,model,[answer('Need missing design input')])
            task=state(c,doc,root);assert len(task['turn_ids'])==index+1
            response,_=control(c,doc,task,'resume',message='Still no new design information')
            assert response.status_code==(409 if index==7 else 200),response.text
        task=state(c,doc,root)
        assert task['status']=='needs_input' and len(task['turn_ids'])==8 and len(model.calls)==8
        assert not app.state.analysis.list(doc['id'])


def test_fresh_app_restart_pauses_durable_task_without_model_call(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);pending=analysis_checkpoint(c,app,doc,model,data)
    from fastapi.testclient import TestClient
    from agent_support import ScriptedModel
    from research_workbench.main import create_app
    provider=ScriptedModel()
    restored=create_app(tmp_path,agent_provider=provider,analysis_autostart=False)
    with TestClient(restored,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as c:
        task=state(c,doc,root);assert task['status']=='paused'
        assert confirm(c,doc,pending).status_code==409
        assert provider.calls==[]
        resumed,_=control(c,doc,task,'resume');assert resumed.status_code==200
        assert resumed.json()['current_turn_id']==pending['id'] and provider.calls==[]


def test_control_receipt_failure_rolls_back_stop_and_generation(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);pending=analysis_checkpoint(c,app,doc,model,data)
        before=state(c,doc,root)
        with app.state.store.connection() as db:
            db.execute("CREATE TRIGGER refuse_control BEFORE INSERT ON agent_task_operations BEGIN SELECT RAISE(ABORT,'receipt failure'); END")
        response,_=control(c,doc,before,'stop');assert response.status_code==503
        assert state(c,doc,root)==before
        assert app.state.agent.store.get(doc['id'],pending['id'])['status']=='waiting_confirmation'


def test_reordered_explicit_image_grant_is_same_scope_and_image_only_goal_rejected(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data=upload(c,doc).json();images=[upload_image(c,doc).json()['id'] for _ in range(2)]
        response=submit(c,doc,'',continue_task=True,context=context(data,image_ids=images))
        assert response.status_code==422 and not model.calls
        root=submit(c,doc,'One explicitly shared task',continue_task=True,context=context(data,image_ids=images)).json()
        stopped,_=control(c,doc,state(c,doc,root),'stop')
        resumed,_=control(c,doc,stopped.json(),'resume',context=context(data,image_ids=list(reversed(images))))
        assert resumed.status_code==200,resumed.text
