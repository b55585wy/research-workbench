import json
import threading
from uuid import uuid4
import pytest

from agent_support import ScriptedModel,answer,tool,submit,wait_turn,confirm,text_pdf
from analysis_support import workspace,upload,payload
from research_workbench.agent_models import AgentSubmission
from research_workbench.agent_store import digest
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute


def request(client,doc,data,message='Describe selected data',**changes):
    return submit(client,doc,message,context={'page':1,'language':'en','image_ids':[],'dataset_id':data['id'] if data else None},**changes)


def test_only_explicit_selection_reaches_context_and_model(tmp_path):
    with workspace(tmp_path,agent=True) as (c,app,doc,model):
        data=upload(c,doc,b'value,PRIVATE_SAMPLE\n1,hidden-marker-947\n').json()
        turn=wait_turn(c,doc,request(c,doc,None).json()['id'])
        assert turn['context']['dataset'] is None and 'hidden-marker-947' not in json.dumps(model.calls)
        turn=wait_turn(c,doc,request(c,doc,data).json()['id'])
        assert turn['context']['dataset']['sha256']==data['sha256']
        assert 'hidden-marker-947' in json.dumps(model.calls)
        assert any(s['kind']=='dataset_sample' and s['dataset_sha256']==data['sha256'] for s in turn['sources'])
        assert app.state.analysis.list(doc['id'])==[]


def test_other_paper_or_invented_selection_never_starts_model(tmp_path):
    with workspace(tmp_path,agent=True) as (c,app,doc,model):
        data=upload(c,doc).json();other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert request(c,other,data).status_code==404
        assert model.calls==[]


def test_unshared_dataset_tool_rejected_and_no_job(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();model.responses=[tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['value']}),answer('Not shared')]
        turn=wait_turn(c,doc,request(c,doc,None).json()['id'])
        assert turn['status']=='completed' and not turn['proposals'] and not app.state.analysis.list(doc['id'])
        assert any(e['status']=='failed' for e in turn['events'])


def test_confirmed_proposal_atomically_queues_once_and_repeat_is_same(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();model.responses=[tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['value','second']})]
        turn=wait_turn(c,doc,request(c,doc,data).json()['id']);assert turn['status']=='waiting_confirmation'
        proposal=turn['proposals'][0];assert proposal['kind']=='run_analysis' and proposal['payload']['dataset_sha256']==data['sha256']
        assert app.state.analysis.list(doc['id'])==[]
        first=confirm(c,doc,turn);assert first.status_code==200,first.text
        receipt=first.json()['proposals'][0]['result'];assert receipt['status']=='queued'
        again=confirm(c,doc,turn);assert again.status_code==200 and again.json()['proposals'][0]['result']==receipt
        assert len(app.state.analysis.list(doc['id']))==1
        assert confirm(c,doc,turn,approved=False).status_code==409


@pytest.mark.parametrize('mode',['reject','cancel','hash','dataset_changed','recipe_changed'])
def test_rejected_cancelled_or_drifted_proposal_never_creates_job(tmp_path,mode,monkeypatch):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();model.responses=[tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['value']})]
        turn=wait_turn(c,doc,request(c,doc,data).json()['id'])
        if mode=='cancel':c.post(f"/api/v1/documents/{doc['id']}/agent/turns/{turn['id']}/cancel",json={})
        if mode=='dataset_changed':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'altered')
        if mode=='recipe_changed':
            import research_workbench.analysis_recipes as recipes
            monkeypatch.setattr(recipes,'PYTHON_CODE',recipes.PYTHON_CODE+'\n# revised')
        response=confirm(c,doc,turn,approved=mode!='reject',**({'proposal_sha256':'0'*64} if mode=='hash' else {}))
        assert response.status_code==(200 if mode=='reject' else 409),response.text
        assert app.state.analysis.list(doc['id'])==[]


def test_agent_reads_only_verified_completed_result_and_source_link_survives_note(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();svc=app.state.analysis;job,_=svc.create(doc['id'],AnalysisCreate(**payload(data)))
        execute(svc,svc.claim(),threading.Event());job=svc.result(doc['id'],job['id'])
        def propose(messages,tools):
            result=json.loads(next(m['content'] for m in reversed(messages) if m['role']=='tool'))
            assert result['result']['stats'][0]['mean']==2
            return tool('propose_note',{'text':'Synthetic descriptive mean is 2.','source_ref':result['source_ref']})
        model.responses=[tool('read_analysis',{'analysis_id':job['id']}),propose]
        turn=wait_turn(c,doc,request(c,doc,data).json()['id']);assert turn['status']=='waiting_confirmation',turn
        source=next(s for s in turn['sources'] if s['kind']=='analysis_result');assert source['analysis_id']==job['id'] and source['result_sha256']
        assert job['id'] in turn['proposals'][0]['payload']['text']
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        note_id=response.json()['proposals'][0]['result']['note_id']
        note=c.get(f"/api/v1/documents/{doc['id']}/notes/{note_id}/state").json()
        assert note['review_status']=='unreviewed' and job['id'] in note['text']


def test_legacy_v05_request_hash_retries_after_schema_upgrade(tmp_path):
    with workspace(tmp_path,agent=False) as (c,app,doc,_):
        value={'request_id':str(uuid4()),'conversation_id':None,'message':'Legacy pending send','context':{'page':1}}
        response=c.post(f"/api/v1/documents/{doc['id']}/agent/turns",json=value);assert response.status_code==202,response.text
        legacy=AgentSubmission.model_validate(value).model_dump(mode='json');legacy['context'].pop('dataset_id');legacy['context'].pop('active_analysis_id');legacy['context'].pop('active_image',None);legacy['context'].pop('active_chart_id',None)
        old=digest({'document_id':doc['id'],'payload':legacy})
        with app.state.store.connection() as db:db.execute('UPDATE agent_turns SET request_hash=? WHERE id=?',(old,value['request_id']))
        again=c.post(f"/api/v1/documents/{doc['id']}/agent/turns",json=value)
        assert again.status_code==202 and again.json()['id']==value['request_id']
