from uuid import uuid4
from study_support import workspace,anchor,note
from analysis_support import upload
from agent_support import submit,tool,answer,confirm
from task_support import checkpoint,successful_analysis,chart_checkpoint,note_responses,state
import pytest
from research_workbench.agent_tasks import AgentTasks
from research_workbench.models import WorkspaceError


def test_no_pdf_agent_requires_data_share_and_does_not_invent_pages(tmp_path):
    with workspace(tmp_path,page_reader=lambda *a: (_ for _ in ()).throw(AssertionError('No PDF reader for study'))) as (c,app,owner,model):
        data=upload(c,owner).json()
        root=submit(c,owner,'Describe data',context={'page':None,'dataset_id':None})
        assert root.status_code==202,root.text
        turn=checkpoint(c,app,owner,model,[tool('read_page',{'page':1}),tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['value']}),answer('No PDF; share data first')])
        assert turn['status']=='completed' and not turn['proposals']
        assert any(s['kind']=='study_context' for s in turn['sources'])
        assert not any(s.get('page') for s in turn['sources'])
        bad=submit(c,owner,context={'page':1});assert bad.status_code==422


def test_study_continuous_task_analysis_chart_note_and_source_anchor(tmp_path):
    with workspace(tmp_path) as (c,app,owner,model):
        data=upload(c,owner).json();root=submit(c,owner,'Describe values, scatter and source note.',continue_task=True,context={'page':None,'dataset_id':data['id']})
        assert root.status_code==202,root.text
        root=root.json();successful_analysis(c,app,owner,model,data,root)
        chart=chart_checkpoint(c,app,owner,model,data);assert confirm(c,owner,chart).status_code==200
        app.state.agent.tasks.tick();task=state(c,owner,root);assert task['phase']=='note'
        pending=checkpoint(c,app,owner,model,note_responses(owner,task));assert pending['status']=='waiting_confirmation',pending
        assert pending['proposals'][0]['payload']['page'] is None
        assert pending['proposals'][0]['payload']['source']['kind'] in ('analysis','chart')
        result=confirm(c,owner,pending);assert result.status_code==200,result.text
        app.state.agent.tasks.tick();done=state(c,owner,root);assert done['status']=='completed'
        saved=c.get(f"/api/v1/documents/{owner['id']}/notes/{done['note_id']}/state").json()
        assert saved['page'] is None and saved['review_status']=='unreviewed' and saved['source']['id'] in (done['analysis_id'],done['chart_id'])
        assert not list(app.state.store.files.glob('*.pdf'))


def test_study_note_exact_retry_lifecycle_and_rollback(tmp_path):
    with workspace(tmp_path) as (c,app,owner,_):
        identifier=str(uuid4());first=note(c,owner,identifier=identifier);assert first.status_code==201
        assert note(c,owner,identifier=identifier).status_code==200
        assert note(c,owner,text='Different',identifier=identifier).status_code==409
        url=f"/api/v1/documents/{owner['id']}/notes/{identifier}"
        deleted=c.request('DELETE',url,json={'request_id':str(uuid4()),'expected_revision':1});assert deleted.status_code==200
        assert note(c,owner,identifier=identifier).status_code==409
        assert c.post(url+'/restore',json={'request_id':str(uuid4()),'expected_revision':2}).status_code==200
        assert c.get(url+'/state').json()['source']['kind']=='study'


@pytest.mark.parametrize('kind',['study','dataset'])
def test_continuous_result_note_requires_actual_result_anchor(kind):
    row={'analysis_id':'analysis-1','chart_id':'chart-1'}
    sources=[{'kind':'analysis_result','analysis_id':'analysis-1','url':'/analysis-1'},
             {'kind':'chart_result','chart_id':'chart-1','url':'/chart-1'}]
    payload={'text':'/analysis-1 /chart-1','source':{'kind':kind,'id':'data-1'}}
    with pytest.raises(WorkspaceError,match='结果笔记'):
        AgentTasks.check_note_sources(row,{'sources':sources},payload)
