import copy,json
from uuid import uuid4
import pytest
from analysis_support import workspace
from agent_support import submit,answer
from test_text_annotations import create_annotation
from test_note_lifecycle import mutate,state,note_url
from research_workbench.agent_models import AgentSubmission
from research_workbench.agent_store import submission_hash,digest


def send(c,doc,refs,**extra):
    return submit(c,doc,message='Explain the attached quotation.',context={'page':1,'note_refs':refs},**extra)


def test_capture_actual_quote_comment_and_citable_source_before_model_use(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        note,body=create_annotation(c,doc)
        changed=mutate(c,doc,note,state(c,doc,note),text='My interpretation').json()
        refs=[{'note_id':note['id'],'revision':changed['revision']}]
        submitted=send(c,doc,refs);assert submitted.status_code==202,submitted.text
        turn=submitted.json();assert turn['context']['pinned_notes'][0]['annotation']['quote']==body['annotation']['quote']
        model.responses=[answer('Synthetic quotation, not research evidence. [R2]')]
        app.state.agent.execute(app.state.agent.store.next_turn())
        completed=app.state.agent.store.get(doc['id'],turn['id'])
        source=next(s for s in completed['sources'] if s.get('note_id')==note['id'])
        assert source['annotation']['kind']=='highlight' and source['annotation']['quote']==body['annotation']['quote']
        assert source['text']=='My interpretation' and source['page']==1
        assert source['url'].endswith('note='+note['id'])
        assert len(model.calls)==1


@pytest.mark.parametrize('kind',['foreign','missing','stale','deleted','purged'])
def test_invalid_pins_never_reach_model(tmp_path,kind):
    with workspace(tmp_path) as (c,app,doc,model):
        note,_=create_annotation(c,doc)
        owner=doc;revision=1;expected=404
        if kind=='foreign':
            from agent_support import text_pdf
            owner=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf())}).json()
        elif kind=='missing':note={'id':str(uuid4())}
        elif kind=='stale':revision=9;expected=409
        elif kind in ('deleted','purged'):
            deleted=mutate(c,doc,note,state(c,doc,note),'delete').json();revision=deleted['revision']
            if kind=='purged':
                assert c.post(note_url(doc,note)+'/purge',json={'request_id':str(uuid4()),'expected_revision':revision}).status_code==200
                expected=410
        result=send(c,owner,[{'note_id':note['id'],'revision':revision}])
        assert result.status_code==expected,result.text
        assert not model.calls


@pytest.mark.parametrize('refs',[[],[{'note_id':'bad','revision':1}],[{'note_id':str(uuid4()),'revision':True}],
    [{'note_id':str(uuid4()),'revision':0}], [{'note_id':str(uuid4()),'revision':1,'quote':'forged'}]])
def test_strict_refs_and_legacy_empty_refs(tmp_path,refs):
    with workspace(tmp_path) as (c,app,doc,model):
        result=send(c,doc,refs)
        assert result.status_code==(202 if refs==[] else 422),result.text
        if refs==[]:assert 'pinned_notes' not in result.json()['context']
        assert not model.calls


def test_duplicates_maximum_and_budget_are_checked_before_model(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        notes=[create_annotation(c,doc,quote='x'*4000)[0] for _ in range(2)]
        ref={'note_id':notes[0]['id'],'revision':1}
        assert send(c,doc,[ref,ref]).status_code==422
        assert send(c,doc,[{'note_id':str(uuid4()),'revision':1} for _ in range(9)]).status_code==422
        result=send(c,doc,[{'note_id':n['id'],'revision':1} for n in notes])
        assert result.status_code==422 and result.json()['detail']['code']=='note_reference_limit'
        assert not model.calls


def test_no_refs_legacy_submission_hash_is_byte_compatible():
    context={'page':1,'rect':None,'active_note_id':None,'image_ids':[],'language':'en'}
    original={'request_id':str(uuid4()),'conversation_id':None,'message':'Legacy','context':context}
    doc=str(uuid4());parsed=AgentSubmission(**original)
    expected=digest({'document_id':doc,'payload':original})
    assert submission_hash(doc,parsed)==expected
    parsed.context.note_refs=[]
    assert submission_hash(doc,parsed)==expected


def test_plain_and_study_notes_and_attachment_only_send(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        note=c.post(f"/api/v1/documents/{doc['id']}/notes",json={'request_id':str(uuid4()),'page':1,'rect':None,'text':'Plain saved note'}).json()
        value=send(c,doc,[{'note_id':note['id'],'revision':1}])
        assert value.status_code==202 and value.json()['context']['pinned_notes'][0]['text']=='Plain saved note'
        model.responses=[answer('Saved note [R2]')];app.state.agent.execute(app.state.agent.store.next_turn())
        study=c.post('/api/v1/studies',json={'request_id':str(uuid4()),'name':'Pinned study','question':'What is saved?'}).json()
        note=c.post(f"/api/v1/documents/{study['id']}/notes",json={'request_id':str(uuid4()),'page':None,'text':'Study note','source':{'kind':'study','id':study['id'],'sha256':study['scope_sha256']}}).json()
        result=c.post(f"/api/v1/documents/{study['id']}/agent/turns",json={'request_id':str(uuid4()),'message':'','context':{'page':None,'note_refs':[{'note_id':note['id'],'revision':1}]}})
        assert result.status_code==202,result.text
        model.responses=[answer('Saved study note [R2]')];app.state.agent.execute(app.state.agent.store.next_turn())
        complete=app.state.agent.store.get(study['id'],result.json()['id'])
        assert any(s.get('note_id')==note['id'] and '?study=' in s['url'] for s in complete['sources'])


def test_annotation_pin_source_bytes_and_snapshot_are_frozen(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        note,_=create_annotation(c,doc)
        result=send(c,doc,[{'note_id':note['id'],'revision':1}])
        assert result.status_code==202
        mutate(c,doc,note,state(c,doc,note),text='Changed later')
        frozen=app.state.agent.store.get(doc['id'],result.json()['id'])['context']['pinned_notes'][0]
        assert frozen['text']!='Changed later'
        (app.state.store.files/f"{doc['id']}.pdf").write_bytes(b'changed')
        bad=send(c,doc,[{'note_id':note['id'],'revision':2}])
        assert bad.status_code==409 and bad.json()['detail']['code']=='source_changed'
        assert not model.calls


def test_active_and_pinned_same_annotation_share_one_citation(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        note,_=create_annotation(c,doc)
        result=submit(c,doc,message='Explain annotation',context={'page':1,'active_note_id':note['id'],'note_refs':[{'note_id':note['id'],'revision':1}]})
        assert result.status_code==202
        model.responses=[answer('Selected quote [R2]')]
        app.state.agent.execute(app.state.agent.store.next_turn())
        done=app.state.agent.store.get(doc['id'],result.json()['id'])
        assert len([s for s in done['sources'] if s.get('note_id')==note['id']])==1
