import copy
import hashlib
from html.parser import HTMLParser
import io
import json
from uuid import uuid4
import zipfile
import pytest

from analysis_support import workspace
from agent_support import upload_image
from research_workbench.rich_content import canonical,validate_content,plaintext,MAX_RICH_BYTES


def body(text='Rich note',attrs=None):
    return {'version':1,'ops':[{'insert':text,'attributes':attrs or {'bold':True}},{'insert':'\n'}]}


def prefix(doc):return f"/api/v1/documents/{doc['id']}"


def create(c,doc,text='Rich note',rich=True,**changes):
    payload={'request_id':str(uuid4()),'page':1,'rect':[.1,.1,.4,.4],'text':text}
    if rich:payload['rich_content']=body(text)
    payload.update(changes)
    return c.post(prefix(doc)+'/notes',json=payload),payload


def state(c,doc,note):return c.get(prefix(doc)+f"/notes/{note['id']}/state").json()


def patch(c,doc,note,**changes):
    return c.patch(prefix(doc)+f"/notes/{note['id']}",json={'request_id':str(uuid4()),'expected_revision':note['revision'],**changes})


def test_rich_create_keeps_original_json_anchor_and_effective_search(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        response,payload=create(c,doc);assert response.status_code==201,response.text
        note=response.json();assert set(note)=={'id','document_id','page','rect','text','created_at'}
        current=state(c,doc,note)
        assert current['rich_content']==body() and '<strong>Rich note</strong>' in current['rich_html']
        assert current['review_status']=='unreviewed' and current['revision']==1
        assert current['rect']==payload['rect'] and current['page']==1
        assert c.get('/api/v1/search',params={'q':'Rich note'}).json()['notes'][0]['id']==note['id']
        assert c.post(prefix(doc)+'/notes',json=payload).status_code==200 and model.calls==[]


def test_format_only_edit_review_noop_delete_restore_and_plain_conversion(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        n=create(c,doc)[0].json();n=state(c,doc,n)
        n=patch(c,doc,n,review_status='source_checked').json();assert n['revision']==2
        styled=body(attrs={'italic':True,'underline':True})
        n=patch(c,doc,n,text=n['text'],rich_content=styled).json()
        assert n['revision']==3 and n['review_status']=='unreviewed' and n['reviewed_at'] is None
        same=patch(c,doc,n,text=n['text'],rich_content=styled).json();assert same==n
        n=patch(c,doc,n,review_status='source_checked').json();reviewed=n['reviewed_at']
        n=patch(c,doc,n,text=n['text']).json();assert n['reviewed_at']==reviewed and n['rich_content']==styled
        for route,method in [('',c.delete),('/restore',c.post)]:
            response=method(prefix(doc)+f"/notes/{n['id']}"+route,json={'request_id':str(uuid4()),'expected_revision':n['revision']}) if route else c.request('DELETE',prefix(doc)+f"/notes/{n['id']}",json={'request_id':str(uuid4()),'expected_revision':n['revision']})
            assert response.status_code==200,response.text;n=response.json()
            assert n['rich_content']==styled and n['reviewed_at']==reviewed
        n=patch(c,doc,n,text=n['text'],rich_content=None).json()
        assert 'rich_content' not in n and 'rich_html' not in n and n['review_status']=='unreviewed'


def test_plain_text_change_drops_format_but_old_create_retry_keeps_current_state(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        response,original=create(c,doc);n=state(c,doc,response.json())
        updated=patch(c,doc,n,text='Changed plain text').json();assert 'rich_content' not in updated
        again=c.post(prefix(doc)+'/notes',json=original);assert again.status_code==200 and again.json()['text']=='Changed plain text'
        conflict=copy.deepcopy(original);conflict['rich_content']=body(attrs={'italic':True})
        assert c.post(prefix(doc)+'/notes',json=conflict).status_code==409
        assert c.get(prefix(doc)+'/notes').json()['items']==[again.json()]


def test_plain_creation_and_patch_fingerprints_and_retries_unchanged(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        response,original=create(c,doc,rich=False);n=state(c,doc,response.json());assert 'rich_content' not in n
        request={'request_id':str(uuid4()),'expected_revision':1,'text':'Updated'}
        url=prefix(doc)+f"/notes/{n['id']}";r=c.patch(url,json=request);assert r.status_code==200
        legacy={'document_id':doc['id'],'note_id':n['id'],'kind':'patch','data':{'expected_revision':1,'text':'Updated'}}
        expected=hashlib.sha256(json.dumps(legacy,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        with app.state.store.connection() as db:assert db.execute('SELECT payload_hash FROM note_operations WHERE request_id=?',(request['request_id'],)).fetchone()[0]==expected
        assert c.patch(url,json=request).json()==r.json()
        n=r.json();n=patch(c,doc,n,text=n['text'],rich_content=body(n['text'])).json()
        assert c.post(prefix(doc)+'/notes',json=original).status_code==200
        assert state(c,doc,n)['rich_content']==body('Updated')


def test_exact_rich_edit_retry_conflict_and_wrong_scope(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        n=state(c,doc,create(c,doc)[0].json());request={'request_id':str(uuid4()),'expected_revision':1,'text':'Edited','rich_content':body('Edited')}
        url=prefix(doc)+f"/notes/{n['id']}";first=c.patch(url,json=request);assert first.status_code==200
        assert c.patch(url,json=request).json()==first.json()
        assert c.patch(url,json={**request,'rich_content':body('Edited',{'italic':True})}).status_code==409
        later=patch(c,doc,first.json(),text='Later',rich_content=body('Later')).json()
        assert c.patch(url,json=request).status_code==409 and state(c,doc,n)==later
        assert c.patch(f"/api/v1/documents/{uuid4()}/notes/{n['id']}",json=request).status_code==404


INVALID=[
    {},{'version':True,'ops':[{'insert':'x\n'}]}, {'version':2,'ops':[{'insert':'x\n'}]},
    {'version':1,'ops':[]},{'version':1,'ops':[{'retain':1}]},{'version':1,'ops':[{'delete':1}]},
    {'version':1,'ops':[{'insert':{'image':'https://evil.test/a'}}]},
    {'version':1,'ops':[{'insert':'x'}]}, {'version':1,'ops':[{'insert':'\n'}]},
    {'version':1,'ops':[{'insert':'x\x00\n'}]}, {'version':1,'ops':[{'insert':'x\r\n'}]},
    {'version':1,'ops':[{'insert':'x\n','extra':1}]},
    body('x',{'color':'red'}),body('x',{'bold':1}),body('x',{'bold':False}),
    body('x',{'link':'javascript:alert(1)'}),body('x',{'link':'data:text/html,evil'}),
    body('x',{'link':'//evil.test/a'}),body('x',{'link':'file:///a'}),
    body('x',{'link':'https://user:secret@example.test/a'}),body('x',{'link':'https://a.test/\nevil'}),
    body('x',{'header':1}),body('x',{'header':True}),body('x',{'header':3}),body('x',{'list':'check'}),
    {'version':1,'ops':[{'insert':'x'},{'insert':'\n','attributes':{'header':1,'list':'bullet'}}]},
    {'version':1,'ops':[{'insert':'x\n','attributes':[]}]},
]


@pytest.mark.parametrize('rich',INVALID)
def test_reject_invalid_document_without_creating_note(tmp_path,rich):
    with workspace(tmp_path) as (c,app,doc,_):
        response,_=create(c,doc,text='x',rich_content=rich);assert response.status_code==422,response.text
        assert c.get(prefix(doc)+'/notes').json()['items']==[]


def test_text_mismatch_missing_text_surrogate_and_character_boundaries(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        assert create(c,doc,text='different',rich_content=body('x'))[0].status_code==422
        n=state(c,doc,create(c,doc)[0].json());assert patch(c,doc,n,rich_content=body()).status_code==422
        value={'request_id':str(uuid4()),'page':1,'text':'\ud800','rich_content':body('\ud800')}
        assert c.post(prefix(doc)+'/notes',content=json.dumps(value),headers={'content-type':'application/json'}).status_code==422
        assert create(c,doc,text='x'*10000)[0].status_code==201
        assert create(c,doc,text='x'*10001)[0].status_code==422


def test_operation_link_and_exact_utf8_size_boundaries():
    ops=[{'insert':'x','attributes':{'bold':True} if i%2 else {'italic':True}} for i in range(511)]+[{'insert':'\n'}]
    assert len(validate_content({'version':1,'ops':ops})['ops'])==512
    with pytest.raises(ValueError):validate_content({'version':1,'ops':ops+[{'insert':'\n'}]})
    assert validate_content(body('x',{'link':'https://e.test/'+'a'*(2048-len('https://e.test/'))}))
    with pytest.raises(ValueError):validate_content(body('x',{'link':'https://e.test/'+'a'*(2049-len('https://e.test/'))}))
    rich={'version':1,'ops':[{'insert':'x','attributes':{'link':f'https://e.test/{i}/'}} for i in range(40)]+[{'insert':'\n'}]}
    remaining=MAX_RICH_BYTES-len(canonical(rich).encode())
    for op in rich['ops'][:-1]:
        link=op['attributes']['link'];extra=min(remaining,2048-len(link));op['attributes']['link']+='a'*extra;remaining-=extra
    assert remaining==0 and len(canonical(validate_content(rich)).encode())==MAX_RICH_BYTES
    rich['ops'][-2]['attributes']['link']+='x'
    with pytest.raises(ValueError):validate_content(rich)


def test_all_formats_and_hostile_literal_text_export_exact_json(tmp_path):
    content={'version':1,'ops':[{'insert':'<img src=x onerror=alert(1)>','attributes':{'bold':True,'italic':True,'underline':True}},
        {'insert':'\n','attributes':{'header':1}},{'insert':'sub'},{'insert':'\n','attributes':{'header':2}},
        {'insert':'one'},{'insert':'\n','attributes':{'list':'bullet'}},{'insert':'two'},{'insert':'\n','attributes':{'list':'ordered'}},
        {'insert':'Reference','attributes':{'link':'https://example.test/?x="<script>'}},{'insert':'\n'}]}
    with workspace(tmp_path) as (c,app,doc,_):
        response,_=create(c,doc,text=plaintext(content),rich_content=content);assert response.status_code==201,response.text
        n=state(c,doc,response.json());markup=n['rich_html']
        assert '<h1><u><em><strong>&lt;img' in markup and '<ul><li>one</li></ul><ol><li>two</li></ol>' in markup
        class Tags(HTMLParser):
            def __init__(self):super().__init__();self.tags=[]
            def handle_starttag(self,tag,attrs):self.tags.append(tag)
        parser=Tags();parser.feed(markup);assert not {'img','script','iframe','svg'}&set(parser.tags)
        exported=c.get(prefix(doc)+'/export');assert exported.status_code==200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            assert markup.encode() in archive.read('index.html')
            item=json.loads(archive.read('notes.json'))['notes'][0];assert item['rich_content']==content and 'rich_html' not in item
            for name,record in json.loads(archive.read('manifest.json'))['files'].items():assert hashlib.sha256(archive.read(name)).hexdigest()==record['sha256']
        assert not list(app.state.store.exports.iterdir())


def test_image_note_atomic_body_and_original_hash_compatibility(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        image=upload_image(c,doc).json();payload={'request_id':str(uuid4()),'page':1,'rect':None,'text':'Rich note','image_ids':[image['id']],'rich_content':body()}
        response=c.post(prefix(doc)+'/image-notes',json=payload);assert response.status_code==201,response.text
        assert state(c,doc,response.json())['rich_content']==body()
        assert c.post(prefix(doc)+'/image-notes',json=payload).status_code==200
        assert c.post(prefix(doc)+'/image-notes',json={**payload,'rich_content':body(attrs={'italic':True})}).status_code==409
        plain={**payload,'request_id':str(uuid4())};plain.pop('rich_content')
        response=c.post(prefix(doc)+'/image-notes',json=plain);assert response.status_code==201
        expected=hashlib.sha256(json.dumps({'document_id':doc['id'],'data':plain},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        with app.state.store.connection() as db:assert db.execute('SELECT payload_hash FROM image_note_requests WHERE request_id=?',(plain['request_id'],)).fetchone()[0]==expected


@pytest.mark.parametrize('operation',['create','edit','image'])
def test_content_persistence_failure_rolls_back_all_note_state(tmp_path,operation):
    with workspace(tmp_path) as (c,app,doc,_):
        plain=create(c,doc,rich=False)[0].json();before=state(c,doc,plain)
        image=upload_image(c,doc).json() if operation=='image' else None
        with app.state.store.connection() as db:db.execute("CREATE TRIGGER reject_rich BEFORE INSERT ON note_rich_content BEGIN SELECT RAISE(ABORT,'synthetic persistence failure'); END")
        if operation=='edit':response=patch(c,doc,before,text=before['text'],rich_content=body())
        elif operation=='image':response=c.post(prefix(doc)+'/image-notes',json={'request_id':str(uuid4()),'page':1,'text':'Rich note','rich_content':body(),'image_ids':[image['id']]})
        else:response=create(c,doc)[0]
        assert response.status_code==503,response.text
        assert c.get(prefix(doc)+'/notes').json()['items']==[plain] and state(c,doc,plain)==before
        with app.state.store.connection() as db:assert db.execute('SELECT COUNT(*) FROM note_operations').fetchone()[0]==0


def test_corrupt_persisted_body_never_pairs_with_different_plain_text(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        n=create(c,doc)[0].json()
        with app.state.store.connection() as db:db.execute('UPDATE note_rich_content SET current_json=? WHERE note_id=?',(canonical(body('Other text')),n['id']))
        response=c.get(prefix(doc)+f"/notes/{n['id']}/state");assert response.status_code==409 and response.json()['detail']['code']=='rich_content_changed'
        assert c.get(prefix(doc)+'/export').status_code==409
