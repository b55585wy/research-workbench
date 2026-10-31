import json
import threading
from uuid import uuid4
import pytest

from analysis_support import workspace,upload,run
from agent_support import ScriptedModel,answer,tool,submit,wait_turn,text_pdf
from research_workbench.agent_models import AgentSubmission
from research_workbench.agent_store import digest


def test_exact_active_analysis_is_captured_and_actual_saved_code_read(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        model.responses=[tool('read_analysis',{'analysis_id':job['id']}),answer('Saved analysis explained')]
        response=submit(c,doc,context={'page':1,'dataset_id':data['id'],'active_analysis_id':job['id']})
        assert response.status_code==202,response.text
        turn=wait_turn(c,doc,response.json()['id']);assert turn['status']=='completed'
        assert turn['context']['active_analysis_id']==job['id'] and turn['context']['active_analysis']['columns']==['value']
        output=json.loads(next(m['content'] for m in model.calls[-1]['messages'] if m['role']=='tool'))
        assert output['saved_code']==(app.state.analysis.directory(job['id'])/'analysis.py').read_text()
        assert 'Completed descriptive summary' in output['saved_stdout'] and output['notebook_url'].endswith('/notebook')
        assert len(app.state.analysis.list(doc['id']))==1


@pytest.mark.parametrize('mode',['unshared','different_dataset','different_paper','unknown'])
def test_unshared_or_wrong_active_analysis_rejected_before_model(tmp_path,mode):
    with workspace(tmp_path,agent=True) as (c,app,doc,model):
        data=upload(c,doc).json();job=run(app.state.analysis,doc,data)
        selected=data['id'];target=job['id'];paper=doc
        if mode=='unshared':selected=None
        if mode=='different_dataset':selected=upload(c,doc,name='other.csv').json()['id']
        if mode=='different_paper':paper=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json();selected=None
        if mode=='unknown':target=str(uuid4())
        response=submit(c,paper,context={'page':1,'dataset_id':selected,'active_analysis_id':target})
        assert response.status_code==(404 if mode in ('different_paper','unknown') else 409),response.text
        assert model.calls==[]


@pytest.mark.parametrize('version',[5,6])
def test_previous_frozen_submission_hash_still_retries(tmp_path,version):
    with workspace(tmp_path,agent=False) as (c,app,doc,_):
        data=upload(c,doc).json();context={'page':1}
        if version==6:context['dataset_id']=data['id']
        value={'request_id':str(uuid4()),'message':'Older frozen request','context':context}
        response=c.post(f"/api/v1/documents/{doc['id']}/agent/turns",json=value);assert response.status_code==202
        previous=AgentSubmission.model_validate(value).model_dump(mode='json');previous['context'].pop('active_analysis_id');previous['context'].pop('active_image',None);previous['context'].pop('active_chart_id',None)
        if version==5:previous['context'].pop('dataset_id')
        fingerprint=digest({'document_id':doc['id'],'payload':previous})
        with app.state.store.connection() as db:db.execute('UPDATE agent_turns SET request_hash=? WHERE id=?',(fingerprint,value['request_id']))
        again=c.post(f"/api/v1/documents/{doc['id']}/agent/turns",json=value)
        assert again.status_code==202 and again.json()['id']==value['request_id']
