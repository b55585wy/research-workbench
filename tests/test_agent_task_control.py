import copy
from uuid import uuid4
import pytest

from agent_support import answer,tool,confirm
from analysis_support import workspace,upload
from task_support import begin,state,control,analysis_checkpoint,successful_analysis,context,checkpoint,prefix


def test_stop_waiting_proposal_blocks_write_resume_reuses_frozen_proposal(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);pending=analysis_checkpoint(c,app,doc,model,data)
        stopped,payload=control(c,doc,state(c,doc,root),'stop');assert stopped.status_code==200
        assert confirm(c,doc,pending).status_code==409 and not app.state.analysis.list(doc['id'])
        replay=c.post(prefix(doc)+'/'+root['id']+'/control',json=payload);assert replay.json()==stopped.json()
        resumed,_=control(c,doc,stopped.json(),'resume');assert resumed.status_code==200,resumed.text
        restored=app.state.agent.store.get(doc['id'],pending['id'])
        assert restored['proposals']==pending['proposals'] and resumed.json()['current_turn_id']==pending['id']
        assert confirm(c,doc,restored).status_code==200 and len(model.calls)==1
        replay=c.post(prefix(doc)+'/'+root['id']+'/control',json=payload);assert replay.json()==stopped.json()
        assert state(c,doc,root)['generation']==2
        changed={**payload,'reason':'sharing_changed'}
        assert c.post(prefix(doc)+'/'+root['id']+'/control',json=changed).status_code==409


@pytest.mark.parametrize('job_state',['queued','succeeded'])
def test_stop_after_approval_never_cancels_or_repeats_analysis(tmp_path,job_state):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);pending=analysis_checkpoint(c,app,doc,model,data)
        assert confirm(c,doc,pending).status_code==200
        app.state.agent.tasks.tick();task=state(c,doc,root)
        stopped,_=control(c,doc,task,'stop');assert stopped.status_code==200
        if job_state=='succeeded':
            import threading
            from research_workbench.analysis_worker import execute
            execute(app.state.analysis,app.state.analysis.claim(),threading.Event())
        app.state.agent.tasks.tick()
        assert state(c,doc,root)['status']=='paused'
        assert app.state.analysis.list(doc['id'])[0]['status']==job_state
        resumed,_=control(c,doc,stopped.json(),'resume');assert resumed.status_code==200,resumed.text
        assert len(app.state.analysis.list(doc['id']))==1
        assert resumed.json()['status']==('waiting_analysis' if job_state=='queued' else 'running')
        assert resumed.json()['phase']==('analysis' if job_state=='queued' else 'chart')


@pytest.mark.parametrize('mode',['unshared','different_dataset','page','images','generation','operation','missing_context','message','wrong_doc','changed_file'])
def test_resume_revalidates_grant_scope_and_control_input(tmp_path,mode):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);stopped,_=control(c,doc,state(c,doc,root),'stop')
        payload={'request_id':str(uuid4()),'expected_generation':stopped.json()['generation'],'action':'resume','context':context(data)}
        target=prefix(doc)+'/'+root['id']+'/control'
        expected=409
        if mode=='unshared':payload['context'].pop('dataset_id')
        if mode=='different_dataset':payload['context']['dataset_id']=upload(c,doc).json()['id']
        if mode=='page':payload['context']['page']=2
        if mode=='images':payload['context']['image_ids']=[str(uuid4())];expected=404
        if mode=='generation':payload['expected_generation']=0
        if mode=='operation':payload['action']='run';expected=422
        if mode=='missing_context':payload.pop('context');expected=422
        if mode=='message':payload['message']='x'*8001;expected=422
        if mode=='wrong_doc':target=f"/api/v1/documents/{uuid4()}/agent/tasks/{root['id']}/control";expected=404
        if mode=='changed_file':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        response=c.post(target,json=payload);assert response.status_code==expected,response.text
        assert state(c,doc,root)['status']=='paused' and not model.calls


def test_late_model_response_and_stale_updates_do_not_resurrect_stopped_task(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model)
        def late(messages,tools):
            stopped,_=control(c,doc,state(c,doc,root),'stop');assert stopped.status_code==200
            resumed,_=control(c,doc,stopped.json(),'resume');assert resumed.status_code==200
            return tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['value']})
        old=app.state.agent.store.next_turn();model.responses=[late]
        app.state.agent.execute(old)
        current=state(c,doc,root)
        assert current['current_turn_id']!=old['id'] and len(current['turn_ids'])==2
        app.state.agent.store.update(doc['id'],old['id'],expected_turn=old,status='failed')
        assert app.state.agent.store.get(doc['id'],old['id'])['status']=='cancelled'
        assert not app.state.agent.store.get(doc['id'],old['id'])['proposals']
        assert not app.state.analysis.list(doc['id'])


def test_failed_analysis_resume_creates_only_new_confirmation_not_job(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);pending=analysis_checkpoint(c,app,doc,model,data)
        assert confirm(c,doc,pending).status_code==200
        app.state.agent.tasks.tick();task=state(c,doc,root)
        with app.state.store.connection() as db:db.execute("UPDATE analysis_jobs SET status='failed' WHERE id=?",(task['analysis_id'],))
        app.state.agent.tasks.tick();failed=state(c,doc,root);assert failed['status']=='failed'
        resumed,_=control(c,doc,failed,'resume');assert resumed.status_code==200
        assert len(app.state.analysis.list(doc['id']))==1 and resumed.json()['analysis_id'] is None
        new=analysis_checkpoint(c,app,doc,model,data)
        assert new['id']!=pending['id'] and new['status']=='waiting_confirmation'
        assert len(app.state.analysis.list(doc['id']))==1


def test_stop_and_confirm_serialization_has_no_half_write(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);pending=analysis_checkpoint(c,app,doc,model,data)
        task=state(c,doc,root)
        with ThreadPoolExecutor(2) as pool:
            a=pool.submit(lambda:control(c,doc,task,'stop')[0])
            b=pool.submit(lambda:confirm(c,doc,pending))
            assert a.result().status_code==200
            result=b.result();assert result.status_code in (200,409)
        jobs=app.state.analysis.list(doc['id'])
        assert len(jobs)==(1 if result.status_code==200 else 0)
        app.state.agent.tasks.tick();assert state(c,doc,root)['status']=='paused'
