import threading
import pytest
from agent_support import tool,answer,submit,wait_turn,confirm
from statistics_support import workspace,payload
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute


def send(c,doc,data):
    return submit(c,doc,'Synthetic independent samples: compare A minus B with a Welch two-sided t test,95% CI; exclude empty outcome/group. Stop for confirmation.',
        context={'page':1,'language':'en','dataset_id':data['id'] if data else None})


@pytest.mark.parametrize('selected',[False,True])
def test_agent_explicit_sharing_preview_and_exact_confirmation(tmp_path,selected):
    with workspace(tmp_path,agent=True) as (c,app,doc,data,model):
        body=payload(c,data);arguments={key:body[key] for key in ('dataset_id','columns','ttest')}
        model.responses=[tool('analysis_methods',{}),tool('read_t_test_groups',{'dataset_id':data['id'],'group_column':'group'}),
            tool('preview_t_test',arguments),tool('propose_t_test',arguments),answer('Not available')]
        turn=wait_turn(c,doc,send(c,doc,data if selected else None).json()['id'])
        assert app.state.analysis.list(doc['id'])==[]
        if not selected:
            assert not turn['proposals'] and turn['status']=='completed';return
        assert turn['status']=='waiting_confirmation'
        proposal=turn['proposals'][0];assert proposal['kind']=='run_t_test'
        assert proposal['payload']['preview']['counts']['excluded']==3
        first=confirm(c,doc,turn);assert first.status_code==200,first.text
        receipt=first.json()['proposals'][0]['result'];assert receipt['status']=='queued'
        assert confirm(c,doc,turn).json()['proposals'][0]['result']==receipt
        assert len(app.state.analysis.list(doc['id']))==1


@pytest.mark.parametrize('mode',['reject','library_changed','dataset_changed'])
def test_agent_rejected_or_stale_proposal_never_runs(tmp_path,mode):
    with workspace(tmp_path,agent=True) as (c,app,doc,data,model):
        body=payload(c,data);model.responses=[tool('propose_t_test',{key:body[key] for key in ('dataset_id','columns','ttest')})]
        turn=wait_turn(c,doc,send(c,doc,data).json()['id'])
        if mode=='library_changed':app.state.analysis.catalog.statistics.sha256='a'*64
        if mode=='dataset_changed':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        response=confirm(c,doc,turn,approved=mode!='reject')
        assert response.status_code==(200 if mode=='reject' else 409)
        assert app.state.analysis.list(doc['id'])==[]


def test_saved_result_agent_citation_and_confirmed_cancellation(tmp_path):
    with workspace(tmp_path,agent=True) as (c,app,doc,data,model):
        service=app.state.analysis;job,_=service.create(doc['id'],AnalysisCreate(**payload(c,data)))
        execute(service,service.claim(),threading.Event());assert service.get(doc['id'],job['id'])['status']=='succeeded'
        def note(messages,tools):
            import json
            result=json.loads(next(m['content'] for m in reversed(messages) if m['role']=='tool'))
            return tool('propose_note',{'text':'Synthetic statistical software result; assumptions unverified.','source_ref':result['source_ref']})
        model.responses=[tool('read_analysis',{'analysis_id':job['id']}),note]
        turn=wait_turn(c,doc,send(c,doc,data).json()['id']);assert turn['status']=='waiting_confirmation'
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        note_id=response.json()['proposals'][0]['result']['note_id']
        saved=c.get('/api/v1/documents/'+doc['id']+'/notes/'+note_id+'/state').json()
        assert job['id'] in saved['text'] and saved['review_status']=='unreviewed'
        queued,_=service.create(doc['id'],AnalysisCreate(**payload(c,data)))
        model.responses=[tool('propose_analysis_cancel',{'analysis_id':queued['id']})]
        turn=wait_turn(c,doc,send(c,doc,data).json()['id']);assert turn['proposals'][0]['kind']=='cancel_analysis'
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        assert response.json()['proposals'][0]['result']['status']=='cancelled'
