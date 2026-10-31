import json
import pytest
from agent_support import ScriptedModel,tool,answer,submit,wait_turn,confirm,upload_image
from analysis_support import workspace,upload,payload
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute
import threading
from test_rich_notes import body,prefix,create,state,patch


@pytest.mark.parametrize('with_image',[False,True])
def test_agent_rich_creation_requires_confirmation_and_keeps_source(tmp_path,with_image):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        ids=[upload_image(c,doc).json()['id']] if with_image else []
        model.responses=[tool('propose_note',{'text':'Rich note','rich_content':body(),'source_ref':'R1','image_ids':ids})]
        turn=wait_turn(c,doc,submit(c,doc,context={'page':1,'language':'en','image_ids':ids}).json()['id'])
        assert turn['status']=='waiting_confirmation' and c.get(prefix(doc)+'/notes').json()['items']==[]
        proposal=turn['proposals'][0];assert proposal['payload']['rich_content']==body() and '<strong>' in proposal['payload']['rich_html']
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        n=state(c,doc,{'id':response.json()['proposals'][0]['result']['note_id']})
        assert n['rich_content']==body() and n['review_status']=='unreviewed' and n['page']==1
        assert confirm(c,doc,turn).json()['proposals'][0]['result']==response.json()['proposals'][0]['result']
        assert len(c.get(prefix(doc)+'/notes').json()['items'])==1


def test_agent_reads_structured_content_and_proposes_revision_checked_edit(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        n=state(c,doc,create(c,doc)[0].json())
        def propose(messages,tools):
            value=json.loads(messages[-1]['content']);assert value['rich_content']==body() and 'rich_html' not in value
            return tool('propose_note_edit',{'note_id':n['id'],'expected_revision':1,'text':'Edited rich note','rich_content':body('Edited rich note',{'italic':True})})
        model.responses=[tool('read_note',{'note_id':n['id']}),propose]
        context={'page':1,'language':'en','active_note_id':n['id']}
        turn=wait_turn(c,doc,submit(c,doc,context=context).json()['id'])
        assert turn['status']=='waiting_confirmation' and turn['context']['active_note']['rich_content']==body()
        assert 'rich_html' not in turn['context']['active_note'] and state(c,doc,n)==n
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        updated=state(c,doc,n);assert updated['revision']==2 and updated['rich_content']==body('Edited rich note',{'italic':True}) and updated['review_status']=='unreviewed'


@pytest.mark.parametrize('mode',['reject','cancel','conflict'])
def test_rich_proposal_never_applies_without_valid_approval(tmp_path,mode):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        n=state(c,doc,create(c,doc)[0].json())
        model.responses=[tool('propose_note_edit',{'note_id':n['id'],'expected_revision':1,'text':'Edited','rich_content':body('Edited')})]
        turn=wait_turn(c,doc,submit(c,doc).json()['id'])
        if mode=='cancel':c.post(prefix(doc)+f"/agent/turns/{turn['id']}/cancel",json={})
        if mode=='conflict':n=patch(c,doc,n,text='Concurrent',rich_content=body('Concurrent')).json()
        response=confirm(c,doc,turn,approved=mode!='reject')
        assert response.status_code==(200 if mode=='reject' else 409),response.text
        assert state(c,doc,n)==n


def test_plain_edit_proposal_explains_format_removal_and_legacy_proposal_still_applies(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        n=state(c,doc,create(c,doc)[0].json())
        model.responses=[tool('propose_note_edit',{'note_id':n['id'],'expected_revision':1,'text':'Plain replacement'})]
        turn=wait_turn(c,doc,submit(c,doc).json()['id']);assert turn['proposals'][0]['payload']['formatting_removed']
        assert confirm(c,doc,turn).status_code==200 and 'rich_content' not in state(c,doc,n)
        model.responses=[tool('propose_note',{'text':'Legacy plain payload','source_ref':'R1'})]
        turn=wait_turn(c,doc,submit(c,doc).json()['id']);assert 'rich_content' not in turn['proposals'][0]['payload']
        assert confirm(c,doc,turn).status_code==200


def test_invalid_model_format_is_visible_tool_failure_and_never_saved(tmp_path):
    model=ScriptedModel([tool('propose_note',{'text':'Rich note','source_ref':'R1','rich_content':body(attrs={'link':'javascript:alert(1)'})}),answer('Cannot save invalid formatting')])
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        turn=wait_turn(c,doc,submit(c,doc).json()['id'])
        assert turn['status']=='completed' and turn['proposals']==[] and any(e['status']=='failed' for e in turn['events'])
        assert c.get(prefix(doc)+'/notes').json()['items']==[]


def test_rich_analysis_note_keeps_persistent_calculation_link_in_both_bodies(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();svc=app.state.analysis;job,_=svc.create(doc['id'],AnalysisCreate(**payload(data)))
        execute(svc,svc.claim(),threading.Event())
        def propose(messages,tools):
            result=json.loads(messages[-1]['content'])
            return tool('propose_note',{'text':'Mean is2.','rich_content':body('Mean is2.'),'source_ref':result['source_ref']})
        model.responses=[tool('read_analysis',{'analysis_id':job['id']}),propose]
        turn=wait_turn(c,doc,submit(c,doc,context={'page':1,'dataset_id':data['id'],'active_analysis_id':job['id']}).json()['id'])
        assert turn['status']=='waiting_confirmation',turn
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        n=state(c,doc,{'id':response.json()['proposals'][0]['result']['note_id']})
        assert job['id'] in n['text'] and job['id'] in json.dumps(n['rich_content'])
