import json
from uuid import uuid4
import pytest
from agent_support import ScriptedModel,tool,answer,submit,wait_turn,confirm,text_pdf
from analysis_support import workspace
from image_annotation_support import make_source,create,mutate,source_url


def context(source,annotation=None,share=False):
    selection={'source_kind':source['source_kind'],'source_id':source['source_id']}
    if annotation:selection['annotation_id']=annotation['id']
    return {'page':1,'language':'en','image_ids':[source['source_id']] if share else [],'active_image':selection}


@pytest.mark.parametrize('kind,share',[('user_upload',False),('user_upload',True),('pdf_excerpt',False)])
def test_context_metadata_is_not_pixels_and_create_requires_exact_confirmation(tmp_path,kind,share):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc,kind)
        notes_before=c.get(f"/api/v1/documents/{doc['id']}/notes").json()['items']
        model.responses=[tool('propose_image_annotation',{'source_kind':kind,'source_id':source['source_id'],'rect':[0,0,.5,.5],'text':'Synthetic region'})]
        turn=wait_turn(c,doc,submit(c,doc,context=context(source,share=share)).json()['id'])
        assert turn['status']=='waiting_confirmation',turn
        active=turn['context']['active_image'];assert active['source']==source and active['pixels_shared']==share
        parts=[p for m in model.calls[0]['messages'] if isinstance(m.get('content'),list) for p in m['content']]
        assert len([p for p in parts if p['type']=='image_url'])==int(share)
        proposal=turn['proposals'][0];assert proposal['kind']=='create_image_annotation'
        assert proposal['payload']['source_sha256']==doc['sha256'] and proposal['payload']['image_source_sha256']==source['source_sha256']
        assert c.get(url).json()['items']==[]
        assert confirm(c,doc,turn,proposal_sha256='0'*64).status_code==409
        response=confirm(c,doc,turn);assert response.status_code==200,response.text
        result=response.json()['proposals'][0]['result'];assert confirm(c,doc,turn).json()['proposals'][0]['result']==result
        item=c.get(url).json()['items'][0];assert item['origin']=='agent_proposal' and item['revision']==1
        assert c.get(f"/api/v1/documents/{doc['id']}/notes").json()['items']==notes_before


def test_read_annotations_reference_cannot_be_promoted_to_pdf_note(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);item=create(c,source,url)[0].json()
        def promote(messages,tools):
            value=json.loads(messages[-1]['content']);assert not value['pixels_shared'] and value['items'][0]['text']==item['text']
            return tool('propose_note',{'text':'Wrong coordinate promotion','source_ref':value['items'][0]['source_ref']})
        model.responses=[tool('read_image_annotations',{'source_kind':'user_upload','source_id':source['source_id'],'annotation_id':item['id']}),promote,answer('Cannot promote image coordinates')]
        turn=wait_turn(c,doc,submit(c,doc,context=context(source,item)).json()['id'])
        assert turn['status']=='completed' and not turn['proposals'] and any(e['status']=='failed' for e in turn['events'])
        ref=next(s for s in turn['sources'] if s['kind']=='image_annotation')
        assert ref['image_rect']==item['rect'] and 'rect' not in ref and 'page' not in ref
        assert c.get(f"/api/v1/documents/{doc['id']}/notes").json()['items']==[]


def test_agent_annotation_edit_delete_restore_all_confirmed_once(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);item=create(c,source,url)[0].json()
        for action,changes,revision in [('edit',{'text':'Agent edited','rect':[.2,.2,.8,.8]},2),('delete',{},3),('restore',{},4)]:
            model.responses=[tool('propose_image_annotation_'+action,{'annotation_id':item['id'],'expected_revision':item['revision'],**changes})]
            turn=wait_turn(c,doc,submit(c,doc,context=context(source,item)).json()['id']);assert turn['status']=='waiting_confirmation',turn
            assert c.get(url).json()['items']==[item]
            r=confirm(c,doc,turn);assert r.status_code==200,r.text
            assert confirm(c,doc,turn).json()==r.json()
            item=c.get(url).json()['items'][0];assert item['revision']==revision
            assert bool(item['deleted_at'])==(action=='delete') and item['origin']=='manual'


@pytest.mark.parametrize('mode',['reject','cancel','revision_conflict','source_changed'])
def test_pending_annotation_cannot_write_after_rejection_cancel_or_drift(tmp_path,mode):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);item=create(c,source,url)[0].json()
        model.responses=[tool('propose_image_annotation_edit',{'annotation_id':item['id'],'expected_revision':1,'text':'Pending'})]
        turn=wait_turn(c,doc,submit(c,doc,context=context(source,item)).json()['id']);assert turn['status']=='waiting_confirmation'
        if mode=='cancel':c.post(f"/api/v1/documents/{doc['id']}/agent/turns/{turn['id']}/cancel",json={})
        if mode=='revision_conflict':item=mutate(c,source,url,item,text='Concurrent user edit')[0].json()
        if mode=='source_changed':app.state.images.path(doc['id'],source['source_id'],True).write_bytes(b'changed')
        response=confirm(c,doc,turn,approved=mode!='reject');assert response.status_code==(200 if mode=='reject' else 409),response.text
        with app.state.store.connection() as db:assert dict(db.execute('SELECT * FROM image_annotations').fetchone())['text']==item['text']


def test_context_source_annotation_and_tools_are_strictly_paper_bound(tmp_path):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);item=create(c,source,url)[0].json()
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert submit(c,other,context=context(source,item)).status_code==404
        second,_,_=make_source(c,app,doc)
        assert submit(c,doc,context=context(second,item)).status_code==404
        model.responses=[tool('read_image_annotations',{'source_kind':'user_upload','source_id':source['source_id']}),answer()]
        turn=wait_turn(c,other,submit(c,other).json()['id']);assert not turn['proposals'] and any(e['status']=='failed' for e in turn['events'])


@pytest.mark.parametrize('rect',[[True,0,1,1],[-1,0,1,1],[0,0,1],['0',0,1,1]])
def test_invalid_agent_geometry_is_visible_tool_failure_not_a_proposal(tmp_path,rect):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc)
        model.responses=[tool('propose_image_annotation',{'source_kind':'user_upload','source_id':source['source_id'],'rect':rect,'text':'Invalid'}),answer()]
        turn=wait_turn(c,doc,submit(c,doc).json()['id']);assert turn['status']=='completed' and not turn['proposals']
        assert any(e['status']=='failed' for e in turn['events']) and c.get(url).json()['items']==[]
