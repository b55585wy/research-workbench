import hashlib
import threading
import pytest
from uuid import uuid4
from analysis_support import upload


def study(c,name='研究 Alpha',question='研究问题：组间差异 Straße 100%_literal',identifier=None):
    r=c.post('/api/v1/studies',json={'request_id':identifier or str(uuid4()),'name':name,'question':question})
    assert r.status_code==201,r.text
    return r.json()


def note(c,owner,text='研究笔记证据',source=None,page=None):
    body={'request_id':str(uuid4()),'text':text,'page':page,'rect':None}
    if page is None:body['source']=source or {'kind':'study','id':owner['id'],'sha256':owner['sha256']}
    r=c.post(f"/api/v1/documents/{owner['id']}/notes",json=body);assert r.status_code==201,r.text
    return r.json()


def search(c,q,**options):
    r=c.get('/api/v1/search',params={'q':q,'include_studies':'true',**options});assert r.status_code==200,r.text
    return r.json()


def test_default_and_false_remain_exact_paper_only_shape(client,document):
    owner=study(client,name='Alpha');note(client,owner,'Alpha study note')
    pdf_note=note(client,document,'Alpha PDF note',page=1)
    expected=client.get('/api/v1/search',params={'q':'Alpha'}).json()
    assert set(expected)=={'query','documents','notes','has_more'}
    assert [n['id'] for n in expected['notes']]==[pdf_note['id']]
    assert client.get('/api/v1/search',params={'q':'Alpha','include_studies':'false'}).json()==expected
    hits=search(client,'Alpha')['notes']
    assert len(hits)==2 and hits[0]['id']==pdf_note['id']
    assert hits[1]['owner_kind']=='study'


@pytest.mark.parametrize('q,field',[('ALPHA','name'),('研究','name'),('组间差异','question'),('STRASSE','question'),('%_literal','question')])
def test_study_name_question_unicode_and_literal_matching(client,q,field):
    owner=study(client);hit=search(client,q)['studies'][0]
    assert hit['id']==owner['id'] and field in hit['matched_fields']
    assert hit['kind']=='study' and hit['page_count'] is None and hit['scope_sha256']==owner['scope_sha256']


@pytest.mark.parametrize('q',['','   ',"' OR 1=1 --",'%wildcard','no-match'])
def test_empty_and_nonmatching_queries_have_empty_groups(client,q):
    study(client)
    assert search(client,q)=={'query':q.strip(),'studies':[],'documents':[],'notes':[],'has_more':False}


def test_current_note_edits_delete_restore_and_rich_plain_text(client):
    owner=study(client);saved=note(client,owner,'旧证据')
    url=f"/api/v1/documents/{owner['id']}/notes/{saved['id']}"
    response=client.patch(url,json={'request_id':str(uuid4()),'expected_revision':1,'text':'新证据 Straße'})
    assert response.status_code==200,response.text
    assert search(client,'旧证据')['notes']==[]
    hit=search(client,'STRASSE')['notes'][0]
    assert hit['id']==saved['id'] and hit['page'] is None and hit['rect'] is None
    assert hit['source']['kind']=='study' and hit['source']['id']==owner['id'] and hit['owner_kind']=='study'
    assert hit['document_title']==owner['title']
    assert client.request('DELETE',url,json={'request_id':str(uuid4()),'expected_revision':2}).status_code==200
    assert search(client,'新证据')['notes']==[]
    assert client.post(url+'/restore',json={'request_id':str(uuid4()),'expected_revision':3}).status_code==200
    assert search(client,'新证据')['notes'][0]['id']==saved['id']


def test_dataset_anchor_is_preserved_without_false_page(client):
    owner=study(client);data=upload(client,owner).json()
    source={'kind':'dataset','id':data['id'],'sha256':data['sha256']}
    saved=note(client,owner,'数据来源说明',source)
    hit=search(client,'数据来源说明')['notes'][0]
    assert hit['source']==saved['source'] and hit['source']['id']==data['id'] and hit['page'] is None
    assert search(client,data['original_filename'])['notes']==[]


def test_linked_paper_is_not_duplicated_or_invented_study_match(client,document):
    owner=study(client,name='Other',question='Unrelated question')
    assert client.post(f"/api/v1/studies/{owner['id']}/papers",json={'document_id':document['id'],'sha256':document['sha256']}).status_code==201
    result=search(client,'synthetic.pdf')
    assert [d['id'] for d in result['documents']]==[document['id']] and result['studies']==[]


def test_group_limits_order_and_has_more(client):
    owners=[study(client,name='Common '+str(i)) for i in range(3)]
    notes=[note(client,o,'Common note') for o in owners]
    result=search(client,'Common',limit=2)
    assert [s['id'] for s in result['studies']]==[o['id'] for o in owners[::-1][:2]]
    assert [n['id'] for n in result['notes']]==[n['id'] for n in notes[::-1][:2]]
    assert result['has_more'] and not search(client,'Common',limit=3)['has_more']


@pytest.mark.parametrize('params',[{'q':'x'*201},{'limit':0},{'limit':101},{'limit':'true'},{'include_studies':'invalid'}])
def test_invalid_bounds_and_flag(client,params):
    assert client.get('/api/v1/search',params={'include_studies':'true',**params}).status_code==422


def test_search_is_read_only_and_does_not_interpret_markup(client,app,document):
    owner=study(client,name='<img src=x onerror=bad()>');note(client,owner,'<script>bad()</script>')
    with app.state.store.connection() as db:
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        before={t:[tuple(r) for r in db.execute('SELECT * FROM '+t+' ORDER BY 1')] for t in tables}
    files={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in app.state.store.root.rglob('*') if p.is_file()}
    assert search(client,'<img')['studies'][0]['name']==owner['name']
    assert search(client,'<script>')['notes'][0]['text']=='<script>bad()</script>'
    with app.state.store.connection() as db:
        assert before=={t:[tuple(r) for r in db.execute('SELECT * FROM '+t+' ORDER BY 1')] for t in tables}
    assert files=={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in app.state.store.root.rglob('*') if p.is_file()}


def test_groups_share_one_snapshot_during_concurrent_edit(client,app,document,monkeypatch):
    assert client.patch(f"/api/v1/documents/{document['id']}/metadata",json={'request_id':str(uuid4()),'expected_revision':1,'title':'Snapshot before'}).status_code==200
    saved=note(client,document,'Snapshot before',page=1);study(client,name='Other',question='Other')
    library=app.state.store.library;original=library.find_studies
    committing=threading.Event();errors=[];workers=[]
    def writer():
        try:
            with app.state.store.connection() as db:
                db.execute('BEGIN IMMEDIATE')
                db.execute('UPDATE document_metadata SET title=? WHERE document_id=?',('After',document['id']))
                db.execute('UPDATE note_states SET current_text=?,revision=revision+1 WHERE note_id=?',('After',saved['id']))
                db.set_trace_callback(lambda sql:committing.set() if sql=='COMMIT' else None)
        except Exception as error:errors.append(error)
    def between_groups(connection,folded,limit):
        result=original(connection,folded,limit)
        monkeypatch.setattr(library,'find_studies',original)
        worker=threading.Thread(target=writer);workers.append(worker);worker.start()
        assert committing.wait(3)
        return result
    monkeypatch.setattr(library,'find_studies',between_groups)
    result=search(client,'Snapshot before')
    for worker in workers:worker.join(3)
    assert errors==[] and not any(w.is_alive() for w in workers)
    assert result['documents'][0]['title']=='Snapshot before'
    assert result['notes'][0]['text']=='Snapshot before' and result['notes'][0]['document_title']=='Snapshot before'
    assert search(client,'Snapshot before')['documents']==[] and search(client,'Snapshot before')['notes']==[]
