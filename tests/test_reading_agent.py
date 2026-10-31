import json
import threading
from uuid import uuid4

import pytest

from agent_support import ScriptedModel,answer,confirm,submit,tool,upload_image,wait_turn,workspace
from research_workbench.models import WorkspaceError
from test_excerpts import add_region
from test_note_lifecycle import mutate,state


def notes(client,document):
    return client.get(f"/api/v1/documents/{document['id']}/notes").json()['items']


def test_agent_reads_real_current_page_context_and_completes_explicitly(tmp_path):
    model=ScriptedModel([tool('read_context',{}),tool('read_page',{'page':2}),tool('complete_task',{'summary':'Synthetic summary [R1] [R2]'})])
    with workspace(tmp_path/'workspace',model) as (client,app,document,provider):
        response=submit(client,document,context={'page':1,'rect':[.1,.2,.6,.7],'language':'en','image_ids':[]})
        assert response.status_code==202,response.text
        result=wait_turn(client,document,response.json()['id'])
        assert result['status']=='completed' and result['answer']=='Synthetic summary [R1] [R2]'
        assert result['context']['document']['id']==document['id'] and result['context']['rect']==[.1,.2,.6,.7]
        assert result['context']['initiator']=={'identity_source':'local_compat','authenticated':False}
        assert {r['page'] for r in result['sources']}=={1,2}
        assert all(r['rect'] is None for r in result['sources'] if r['kind']=='pdf_page')
        assert next(r for r in result['sources'] if r['kind']=='display_selection')['rect']==[.1,.2,.6,.7]
        assert 'SYNTHETIC CONTEXT PAGE 1' in json.dumps(provider.calls[0]['messages'])
        assert 'SYNTHETIC CONTEXT PAGE 2' in json.dumps(provider.calls[2]['messages'])
        assert notes(client,document)==[]


def test_propose_confirm_retry_and_history_share_real_note_service(tmp_path):
    model=ScriptedModel([tool('propose_note',{'text':'Synthetic source-linked note','source_ref':'R1'})])
    with workspace(tmp_path/'workspace',model) as (client,app,document,provider):
        response=submit(client,document);turn=wait_turn(client,document,response.json()['id'])
        assert turn['status']=='waiting_confirmation' and notes(client,document)==[]
        assert turn['proposals'][0]['payload']['page']==1
        response=confirm(client,document,turn);assert response.status_code==200,response.text
        assert response.json()['status']=='completed'
        saved=notes(client,document);assert len(saved)==1 and saved[0]['text']=='Synthetic source-linked note'
        assert state(client,document,saved[0])['review_status']=='unreviewed'
        assert confirm(client,document,turn).status_code==200 and len(notes(client,document))==1
        assert confirm(client,document,turn,approved=False).status_code==409
        history=client.get(f"/api/v1/documents/{document['id']}/agent/conversations/{turn['conversation_id']}").json()
        assert history['turns'][0]['proposals'][0]['result']['note_id']==saved[0]['id']


def test_selected_image_pixels_and_note_attachment_use_original_provenance(tmp_path):
    with workspace(tmp_path/'workspace') as (client,app,document,provider):
        image=upload_image(client,document).json()
        provider.responses=[tool('read_image',{'image_id':image['id']}),
            tool('propose_note',{'text':'Synthetic uploaded figure observation','source_ref':'R2','image_ids':[image['id']]})]
        turn=wait_turn(client,document,submit(client,document,context={'page':2,'language':'en','image_ids':[image['id']]}).json()['id'])
        assert turn['status']=='waiting_confirmation'
        content=provider.calls[0]['messages'][-1]['content']
        assert any(p.get('type')=='image_url' and p['image_url']['url'].startswith('data:image/') for p in content)
        assert any(r['kind']=='user_upload' and r['image_id']==image['id'] for r in turn['sources'])
        assert confirm(client,document,turn).status_code==200
        saved=notes(client,document)[0];assert saved['page']==2
        assert client.get(f"/api/v1/documents/{document['id']}/images").json()['items'][0]['note_ids']==[saved['id']]


@pytest.mark.parametrize('name,args',[
    ('run_script',{'script':'anything'}),('read_page',{'page':True}),
    ('read_context',{'url':'https://example.invalid'}),
    ('propose_note',{'text':'Invalid ref','source_ref':'R9999'}),
    ('propose_note',{'text':'No review tools','source_ref':'R1','review_status':'source_checked'}),
    ('propose_metadata_edit',{'expected_revision':1,'changes':{'actor':'fake user'}})])
def test_invalid_or_uninstalled_tools_never_mutate_records(tmp_path,name,args):
    model=ScriptedModel([tool(name,args),tool('complete_task',{'summary':'Requested action was not available.'})])
    with workspace(tmp_path/'workspace',model) as (client,app,document,provider):
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        assert turn['status']=='completed' and notes(client,document)==[] and turn['proposals']==[]
        assert any(e['status']=='failed' for e in turn['events'])
        assert 'error' in provider.calls[1]['messages'][-1]['content']


def test_context_and_conversation_cannot_cross_papers(tmp_path):
    with workspace(tmp_path/'workspace') as (client,app,document,provider):
        from agent_support import text_pdf
        other=client.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        image=upload_image(client,other).json()
        assert submit(client,document,context={'page':1,'image_ids':[image['id']]}).status_code==404
        note=add_region(client,other)
        assert submit(client,document,context={'page':1,'active_note_id':note['id']}).status_code==404
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        assert client.get(f"/api/v1/documents/{other['id']}/agent/turns/{turn['id']}").status_code==404
        assert submit(client,other,conversation_id=turn['conversation_id']).status_code==404


def test_submission_replay_uses_captured_scope_and_rejects_changed_request(tmp_path):
    with workspace(tmp_path/'workspace',autostart=False) as (client,app,document,provider):
        identifier=str(uuid4());payload={'request_id':identifier,'conversation_id':None,'message':'Captured request','context':{'page':1}}
        first=client.post(f"/api/v1/documents/{document['id']}/agent/turns",json=payload)
        assert first.status_code==202
        assert client.post(f"/api/v1/documents/{document['id']}/agent/turns",json=payload).json()==first.json()
        assert client.post(f"/api/v1/documents/{document['id']}/agent/turns",json={**payload,'message':'Changed'}).status_code==409
        assert submit(client,document,conversation_id=first.json()['conversation_id']).status_code==409
        assert provider.calls==[]


@pytest.mark.parametrize('configured,images,code',[(False,True,'agent_not_configured'),(True,False,'agent_vision_disabled')])
def test_missing_model_or_vision_is_explicit_and_does_not_create_turn(tmp_path,configured,images,code):
    with workspace(tmp_path/'workspace',ScriptedModel(configured=configured,images=images)) as (client,app,document,provider):
        image=upload_image(client,document).json()
        response=submit(client,document,context={'page':1,'image_ids':[image['id']]})
        assert response.status_code==409 and response.json()['detail']['code']==code
        assert client.get(f"/api/v1/documents/{document['id']}/agent/conversations").json()['items']==[]
        assert provider.calls==[] and client.get(image['file_url']).status_code==200


def test_concurrent_manual_edit_conflicts_with_original_agent_proposal(tmp_path):
    with workspace(tmp_path/'workspace') as (client,app,document,provider):
        note=add_region(client,document)
        provider.responses=[tool('read_note',{'note_id':note['id']}),tool('propose_note_edit',{
            'note_id':note['id'],'expected_revision':1,'text':'Agent proposed edit'})]
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        current=mutate(client,document,note,state(client,document,note),text='Newer manual edit').json()
        assert confirm(client,document,turn).status_code==409
        stored=app.state.agent.store.get(document['id'],turn['id'])
        assert stored['proposals'][0]['status']=='conflict' and stored['proposals'][0]['payload']['text']=='Agent proposed edit'
        assert state(client,document,note)==current
        assert confirm(client,document,stored,approved=False).status_code==200


@pytest.mark.parametrize('operation',['edit','delete','restore'])
def test_note_mutation_proposals_use_existing_revisioned_lifecycle(tmp_path,operation):
    with workspace(tmp_path/'workspace') as (client,app,document,provider):
        note=add_region(client,document);current=state(client,document,note)
        if operation=='restore':current=mutate(client,document,note,current,kind='delete').json()
        args={'note_id':note['id'],'expected_revision':current['revision']}
        if operation=='edit':args['text']='Changed through actual note service'
        provider.responses=[tool('propose_note_'+operation,args)]
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        assert turn['status']=='waiting_confirmation'
        assert confirm(client,document,turn).status_code==200
        changed=state(client,document,note)
        assert changed['revision']==current['revision']+1
        assert bool(changed['deleted_at'])==(operation=='delete')
        assert changed['review_status']=='unreviewed'


def test_metadata_proposal_and_confirmation_hash_validation(tmp_path):
    model=ScriptedModel([tool('propose_metadata_edit',{'expected_revision':1,'changes':{'title':'Synthetic revised title','authors':'Synthetic author'}})])
    with workspace(tmp_path/'workspace',model) as (client,app,document,provider):
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        assert confirm(client,document,turn,proposal_sha256='0'*64).status_code==409
        assert app.state.store.get_document(document['id'])['title']==document['title']
        assert confirm(client,document,turn).status_code==200
        assert app.state.store.get_document(document['id'])['title']=='Synthetic revised title'


def test_confirmation_storage_failure_rolls_back_note_and_receipt(tmp_path):
    model=ScriptedModel([tool('propose_note',{'text':'Must commit once','source_ref':'R1'})])
    with workspace(tmp_path/'workspace',model) as (client,app,document,provider):
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        with app.state.store.connection() as db:
            db.execute("CREATE TRIGGER reject_agent_receipt BEFORE UPDATE ON agent_proposals WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END")
        assert confirm(client,document,turn).status_code==503
        assert notes(client,document)==[]
        assert app.state.agent.store.get(document['id'],turn['id'])['proposals'][0]['status']=='pending'
        with app.state.store.connection() as db:db.execute('DROP TRIGGER reject_agent_receipt')
        assert confirm(client,document,turn).status_code==200 and len(notes(client,document))==1


def test_changed_persisted_proposal_cannot_reuse_old_confirmation(tmp_path):
    model=ScriptedModel([tool('propose_note',{'text':'Original concrete suggestion','source_ref':'R1'})])
    with workspace(tmp_path/'workspace',model) as (client,app,document,provider):
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        proposal=turn['proposals'][0]
        with app.state.store.connection() as db:
            data={**proposal['payload'],'text':'Changed after review'}
            db.execute('UPDATE agent_proposals SET payload_json=? WHERE id=?',(json.dumps(data),proposal['id']))
        assert confirm(client,document,turn).status_code==409
        assert notes(client,document)==[]


def test_cancel_during_model_call_prevents_late_proposal(tmp_path):
    entered,release=threading.Event(),threading.Event()
    def held(messages,tools):
        entered.set();assert release.wait(5)
        return tool('propose_note',{'text':'Must not save','source_ref':'R1'})
    with workspace(tmp_path/'workspace',ScriptedModel([held])) as (client,app,document,provider):
        response=submit(client,document);assert entered.wait(3)
        identifier=response.json()['id']
        assert client.post(f"/api/v1/documents/{document['id']}/agent/turns/{identifier}/cancel",json={}).status_code==200
        release.set();app.state.agent.close()
        turn=app.state.agent.store.get(document['id'],identifier)
        assert turn['status']=='cancelled' and turn['proposals']==[] and notes(client,document)==[]


def test_model_failure_and_step_limit_are_not_success(tmp_path):
    model=ScriptedModel([WorkspaceError('agent_provider_unavailable','Synthetic unavailable',502)])
    with workspace(tmp_path/'failure',model) as (client,app,document,provider):
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        assert turn['status']=='failed' and turn['error']['code']=='agent_provider_unavailable' and turn['answer']==''
    model=ScriptedModel([tool('read_context',{}),tool('read_context',{})])
    with workspace(tmp_path/'limit',model) as (client,app,document,provider):
        app.state.agent.max_steps=2
        turn=wait_turn(client,document,submit(client,document).json()['id'])
        assert turn['status']=='failed' and turn['error']['code']=='agent_step_limit'


def test_restart_interrupts_queued_turn_without_replay_and_keeps_history(tmp_path):
    root=tmp_path/'workspace'
    with workspace(root,autostart=False) as (client,app,document,provider):
        turn=submit(client,document).json()
        assert turn['status']=='queued'
    from fastapi.testclient import TestClient
    from research_workbench.main import create_app
    model=ScriptedModel()
    with TestClient(create_app(root,agent_provider=model),base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as client:
        stored=client.get(f"/api/v1/documents/{document['id']}/agent/turns/{turn['id']}").json()
        assert stored['status']=='interrupted' and model.calls==[]
        assert len(client.get(f"/api/v1/documents/{document['id']}/agent/conversations/{turn['conversation_id']}").json()['turns'])==1
