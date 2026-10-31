import json
import pytest
from analysis_support import workspace,upload
from agent_support import ScriptedModel,tool,answer,submit,wait_turn,confirm,text_pdf
from chart_support import prefix,payload,save,lifecycle


def context(data,chart=None):
    result={'page':1,'language':'en','dataset_id':data['id']}
    if chart:result['active_chart_id']=chart['id']
    return result


def test_agent_discovery_preview_then_concrete_proposal_confirmation_and_note_link(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        dataset=upload(c,doc).json();arguments={'dataset_id':dataset['id'],'kind':'scatter','x':'value','y':'second','title':'Synthetic model scatter'}
        def propose(messages,tools):
            preview=json.loads(messages[-1]['content']);assert not preview['saved'] and preview['chart']['summary']['used_rows']==2
            assert 'series' not in preview and 'series' not in preview['chart']
            return tool('propose_chart',arguments)
        model.responses=[tool('chart_capabilities',{}),tool('preview_chart',arguments),propose]
        turn=wait_turn(c,doc,submit(c,doc,context=context(dataset)).json()['id']);assert turn['status']=='waiting_confirmation',turn
        assert c.get(prefix(doc)).json()['items']==[]
        frozen=turn['proposals'][0]['payload'];assert frozen['request_id']
        preview={k:frozen[k] for k in ('request_id','dataset_id','dataset_sha256','kind','title','analysis_id','x','y','bins','recipe_sha256','renderer_sha256')}
        assert c.post(prefix(doc)+'/preview',json=preview).status_code==200
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        chart=c.get(prefix(doc)).json()['items'][0];assert chart['origin']=='agent_proposal'
        assert chart['id']==frozen['request_id']
        assert confirm(c,doc,turn).json()['proposals'][0]['result']['chart_id']==chart['id']
        def note(messages,tools):
            value=json.loads(messages[-1]['content']);assert value['id']==chart['id'] and 'series' not in value
            return tool('propose_note',{'text':'Synthetic chart result note','source_ref':value['source_ref']})
        model.responses=[tool('read_chart',{'chart_id':chart['id']}),note]
        turn=wait_turn(c,doc,submit(c,doc,context=context(dataset,chart)).json()['id']);assert turn['context']['active_chart']['id']==chart['id']
        assert chart['viewer_url'] in turn['proposals'][0]['payload']['text']
        assert confirm(c,doc,turn).status_code==200
        note=c.get(f"/api/v1/documents/{doc['id']}/note-states").json()['items'][0]
        assert chart['viewer_url'] in note['text'] and note['review_status']=='unreviewed' and note['rect'] is None


@pytest.mark.parametrize('mode',['reject','cancel','source_changed','receipt_failure'])
def test_agent_never_saves_without_valid_confirmation_and_atomic_receipt(tmp_path,mode):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();model.responses=[tool('propose_chart',{'dataset_id':data['id'],'kind':'histogram','x':'value','title':'Pending'})]
        turn=wait_turn(c,doc,submit(c,doc,context=context(data)).json()['id']);assert turn['status']=='waiting_confirmation'
        if mode=='cancel':c.post(f"/api/v1/documents/{doc['id']}/agent/turns/{turn['id']}/cancel",json={})
        if mode=='source_changed':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        if mode=='receipt_failure':
            with app.state.store.connection() as db:db.execute("CREATE TRIGGER reject_receipt BEFORE UPDATE ON agent_proposals WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'stop'); END")
        response=confirm(c,doc,turn,approved=mode!='reject');assert response.status_code==({'reject':200,'cancel':409,'source_changed':409,'receipt_failure':503}[mode]),response.text
        assert c.get(prefix(doc)).json()['items']==[]


def test_agent_and_capture_require_shared_matching_dataset_and_paper(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();chart=save(c,doc,payload(c,data))
        assert submit(c,doc,context={'page':1,'active_chart_id':chart['id']}).status_code==409
        second=upload(c,doc).json();assert submit(c,doc,context=context(second,chart)).status_code==409
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert submit(c,other,context=context(data,chart)).status_code==404
        model.responses=[tool('read_chart',{'chart_id':chart['id']}),answer('Not shared')]
        turn=wait_turn(c,doc,submit(c,doc).json()['id']);assert not turn['proposals'] and any(e['status']=='failed' for e in turn['events'])


def test_agent_delete_restore_match_manual_revisions_and_do_not_send_raw_series(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        data=upload(c,doc).json();chart=save(c,doc,payload(c,data))
        for action in ['delete','restore']:
            model.responses=[tool('propose_chart_'+action,{'chart_id':chart['id'],'expected_revision':chart['revision']})]
            turn=wait_turn(c,doc,submit(c,doc,context=context(data)).json()['id']);assert turn['status']=='waiting_confirmation',turn
            assert c.get(prefix(doc)+'/'+chart['id']).json()==chart
            response=confirm(c,doc,turn);assert response.status_code==200,response.text
            chart=c.get(prefix(doc)+'/'+chart['id']).json();assert bool(chart['deleted_at'])==(action=='delete')
        assert chart['revision']==3
