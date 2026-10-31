import copy
from uuid import uuid4
import pytest

from agent_support import answer,tool,submit,confirm,text_pdf
from analysis_support import workspace
from task_support import begin,state,prefix,checkpoint,analysis_checkpoint,successful_analysis,chart_checkpoint,note_responses,context


def test_one_goal_requires_three_confirmations_and_real_worker_success(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model)
        pending=analysis_checkpoint(c,app,doc,model,data)
        assert not app.state.analysis.list(doc['id'])
        assert state(c,doc,root)['status']=='waiting_confirmation'
        receipt=confirm(c,doc,pending);assert receipt.status_code==200,receipt.text
        app.state.agent.tasks.tick();task=state(c,doc,root)
        assert task['status']=='waiting_analysis' and len(task['turn_ids'])==1
        for _ in range(3):app.state.agent.tasks.tick()
        assert len(model.calls)==1 and len(state(c,doc,root)['turn_ids'])==1
        import threading
        from research_workbench.analysis_worker import execute
        execute(app.state.analysis,app.state.analysis.claim(),threading.Event())
        for _ in range(3):app.state.agent.tasks.tick()
        task=state(c,doc,root);assert task['phase']=='chart' and len(task['turn_ids'])==2
        chart=chart_checkpoint(c,app,doc,model,data)
        assert c.get(f"/api/v1/documents/{doc['id']}/charts").json()['items']==[]
        assert confirm(c,doc,chart).status_code==200
        app.state.agent.tasks.tick();task=state(c,doc,root)
        assert task['phase']=='note' and len(task['turn_ids'])==3
        note=checkpoint(c,app,doc,model,note_responses(doc,task))
        assert note['status']=='waiting_confirmation',note
        assert c.get(f"/api/v1/documents/{doc['id']}/note-states").json()['items']==[]
        assert confirm(c,doc,note).status_code==200
        for _ in range(4):app.state.agent.tasks.tick()
        done=state(c,doc,root);assert done['status']=='completed' and done['note_id']
        saved=c.get(f"/api/v1/documents/{doc['id']}/notes/{done['note_id']}/state").json()
        assert saved['review_status']=='unreviewed' and done['analysis_id'] in saved['text'] and done['chart_id'] in saved['text']
        for turn in (pending,chart,note):assert confirm(c,doc,turn).status_code==200
        assert len(app.state.analysis.list(doc['id']))==1 and len(done['turn_ids'])==3
        assert len(c.get(f"/api/v1/documents/{doc['id']}/charts").json()['items'])==1
        assert len(c.get(prefix(doc),params={'conversation_id':root['conversation_id']}).json()['items'])==1


def test_exact_start_replay_scope_and_busy_conversation(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model)
        payload={'request_id':root['id'],'conversation_id':None,'message':root['message'],'context':context(data),'continue_task':True}
        assert c.post(f"/api/v1/documents/{doc['id']}/agent/turns",json=payload).json()['id']==root['id']
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert c.get(prefix(other)+'/'+root['id']).status_code==404
        assert c.get(prefix(other),params={'conversation_id':root['conversation_id']}).status_code==404
        assert submit(c,doc,conversation_id=root['conversation_id']).status_code==409
        changed=copy.deepcopy(payload);changed['message']='Different goal'
        assert c.post(f"/api/v1/documents/{doc['id']}/agent/turns",json=changed).status_code==409


@pytest.mark.parametrize('changes',[{'continue_task':'true'},{'message':'x'*8001},{'context':{'page':1}},{'unexpected':True}])
def test_invalid_task_input_never_calls_model(tmp_path,changes):
    with workspace(tmp_path) as (c,app,doc,model):
        from analysis_support import upload
        data=upload(c,doc).json()
        args={'continue_task':True,'context':context(data),**changes}
        response=submit(c,doc,**args);assert response.status_code==422,response.text
        assert not model.calls and c.get(prefix(doc)).json()['items']==[]


def test_read_only_or_rejected_proposal_waits_for_input_without_auto_retry(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model)
        checkpoint(c,app,doc,model,[answer('Need explicit sampling design.')])
        for _ in range(3):app.state.agent.tasks.tick()
        assert state(c,doc,root)['status']=='needs_input' and len(model.calls)==1
    with workspace(tmp_path/'reject') as (c,app,doc,model):
        data,root=begin(c,app,doc,model);pending=analysis_checkpoint(c,app,doc,model,data)
        assert confirm(c,doc,pending,approved=False).status_code==200
        app.state.agent.tasks.tick()
        assert state(c,doc,root)['status']=='needs_input' and not app.state.analysis.list(doc['id'])


def test_stage_tools_cannot_skip_analysis_or_make_two_proposals(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model)
        duplicate=tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['value']})
        duplicate['tool_calls']+=tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['second']})['tool_calls']
        pending=checkpoint(c,app,doc,model,[tool('propose_note',{'text':'Too early','source_ref':'R1'}),duplicate])
        assert [p['kind'] for p in pending['proposals']]==['run_analysis']
        names={t['function']['name'] for t in model.calls[0]['tools']}
        assert 'propose_chart' not in names and 'propose_note' not in names and 'propose_analysis' in names
        assert any(e['status']=='failed' for e in pending['events'])
        assert sum(e['status']=='failed' for e in pending['events'])>=2


def test_note_requires_both_read_owned_result_links(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,root=begin(c,app,doc,model);successful_analysis(c,app,doc,model,data,root)
        chart=chart_checkpoint(c,app,doc,model,data);assert confirm(c,doc,chart).status_code==200
        app.state.agent.tasks.tick();task=state(c,doc,root)
        turn=checkpoint(c,app,doc,model,[tool('propose_note',{'text':task['analysis_id']+' '+task['chart_id'],'source_ref':'R1'}),answer('Need result reads.')])
        assert not turn['proposals'] and state(c,doc,root)['status']=='needs_input'
        assert any(e['status']=='failed' for e in turn['events'])
