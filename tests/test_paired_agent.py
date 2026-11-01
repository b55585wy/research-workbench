import threading
from uuid import uuid4
import pytest
from paired_support import CSV,workspace
from agent_support import tool,answer,submit,wait_turn,confirm
from research_workbench.analysis_worker import execute
from task_support import checkpoint,note_responses,state
from study_support import workspace as study_workspace


def arguments(data):
    return {'dataset_id':data['id'],'columns':['first','second'],'paired':{'unit_column':'ID',
        'alternative':'two_sided','confidence':.95,'missing':'complete_pairs','paired_samples_confirmed':True}}


def responses(data):
    return [tool('analysis_methods',{}),tool('preview_paired_t_test',arguments(data)),tool('propose_paired_t_test',arguments(data))]


def test_shared_agent_preview_concrete_confirmation_retry_and_actual_r(tmp_path):
    with workspace(tmp_path,content=CSV,agent=True) as (c,app,doc,data,model):
        model.responses=responses(data)
        root=submit(c,doc,'同一对象的两次测量，按ID配对；first减second，双侧95%，仅软件验收。',context={'page':1,'dataset_id':data['id']}).json()
        pending=wait_turn(c,doc,root['id']);assert pending['status']=='waiting_confirmation',pending
        proposal=pending['proposals'][0];assert proposal['kind']=='run_paired_t_test'
        assert proposal['payload']['method']=='ttest_paired' and 'ttest' not in proposal['payload']
        assert proposal['payload']['preview']['counts']['used']==3 and 'test' not in proposal['payload']['preview']
        assert app.state.analysis.list(doc['id'])==[]
        response=confirm(c,doc,pending);assert response.status_code==200,response.text
        assert confirm(c,doc,pending).status_code==200 and len(app.state.analysis.list(doc['id']))==1
        row=app.state.analysis.claim();execute(app.state.analysis,row,threading.Event())
        job=app.state.analysis.get(doc['id'],row['id']);assert job['status']=='succeeded',job
        assert job['result']['test']['difference']==pytest.approx(-4/3)


@pytest.mark.parametrize('mode',['reject','cancel','source_changed','receipt_failure'])
def test_invalid_or_rejected_confirmation_never_queues(tmp_path,mode):
    with workspace(tmp_path,content=CSV,agent=True) as (c,app,doc,data,model):
        model.responses=responses(data)
        pending=wait_turn(c,doc,submit(c,doc,context={'page':1,'dataset_id':data['id']}).json()['id'])
        assert pending['status']=='waiting_confirmation',pending
        if mode=='cancel':c.post(f"/api/v1/documents/{doc['id']}/agent/turns/{pending['id']}/cancel",json={})
        if mode=='source_changed':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        if mode=='receipt_failure':
            with app.state.store.connection() as db:
                db.execute("CREATE TRIGGER reject_receipt BEFORE UPDATE ON agent_proposals WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'stop'); END")
        response=confirm(c,doc,pending,approved=mode!='reject')
        assert response.status_code=={'reject':200,'cancel':409,'source_changed':409,'receipt_failure':503}[mode],response.text
        assert app.state.analysis.list(doc['id'])==[]


@pytest.mark.parametrize('shared',[False,True])
def test_agent_cannot_invent_design_or_use_unshared_table(tmp_path,shared):
    with workspace(tmp_path,content=CSV,agent=True) as (c,app,doc,data,model):
        args=arguments(data)
        if shared:args['paired']['paired_samples_confirmed']=False
        model.responses=[tool('propose_paired_t_test',args),answer('Need explicit source/design')]
        turn=wait_turn(c,doc,submit(c,doc,context={'page':1,'dataset_id':data['id'] if shared else None}).json()['id'])
        assert turn['status']=='completed' and not turn['proposals'] and app.state.analysis.list(doc['id'])==[]


def test_paired_study_task_continues_to_scatter_and_source_note(tmp_path):
    with study_workspace(tmp_path) as (c,app,owner,model):
        response=c.post(f"/api/v1/documents/{owner['id']}/datasets",data={'request_id':str(uuid4())},files={'file':('paired.csv',CSV,'text/csv')})
        assert response.status_code==201,response.text
        data=response.json();root=submit(c,owner,'Explicit paired design by ID; first minus second, scatter and source note.',continue_task=True,context={'page':None,'dataset_id':data['id']}).json()
        pending=checkpoint(c,app,owner,model,responses(data));assert pending['status']=='waiting_confirmation',pending
        assert confirm(c,owner,pending).status_code==200
        row=app.state.analysis.claim();execute(app.state.analysis,row,threading.Event());assert app.state.analysis.get(owner['id'],row['id'])['status']=='succeeded'
        app.state.agent.tasks.tick();task=state(c,owner,root);assert task['phase']=='chart'
        args={'dataset_id':data['id'],'kind':'scatter','x':'first','y':'second','title':'Paired measurements'}
        pending=checkpoint(c,app,owner,model,[tool('read_analysis',{'analysis_id':row['id']}),tool('chart_capabilities',{}),tool('preview_chart',args),tool('propose_chart',args)])
        assert pending['status']=='waiting_confirmation',pending
        assert confirm(c,owner,pending).status_code==200
        app.state.agent.tasks.tick();task=state(c,owner,root);assert task['phase']=='note'
        pending=checkpoint(c,app,owner,model,note_responses(owner,task));assert pending['status']=='waiting_confirmation',pending
        assert pending['proposals'][0]['payload']['page'] is None
        assert confirm(c,owner,pending).status_code==200
        app.state.agent.tasks.tick();assert state(c,owner,root)['status']=='completed'
        assert not list(app.state.store.files.glob('*.pdf'))
