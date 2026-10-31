from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import sqlite3
from uuid import uuid4
import zipfile

import pytest

from research_workbench.models import DocumentUpdate, WorkspaceError
from test_note_lifecycle import mutate, state
from test_excerpts import add_region


def metadata_url(document):
    return f"/api/v1/documents/{document['id']}/metadata"


def metadata(client,document):
    return client.get(metadata_url(document)).json()


def update(client,document,current=None,**changes):
    current=current or metadata(client,document)
    return client.patch(metadata_url(document),json={
        'request_id':str(uuid4()),'expected_revision':current['revision'],**changes})


def test_metadata_defaults_edit_clear_and_noop_preserve_original_source(client,app,document,pdf):
    initial=metadata(client,document)
    assert initial=={**document,'authors':'','year':None,'doi':'','revision':1,'updated_at':document['created_at']}
    note=add_region(client,document)
    client.post(f"/api/v1/documents/{document['id']}/notes/{note['id']}/excerpt")
    note_before=state(client,document,note)
    files={p:p.read_bytes() for p in app.state.store.files.glob('*')}
    files.update({p:p.read_bytes() for p in app.state.store.excerpts.glob('*')})
    response=update(client,document,title='  Revised paper  ',authors=' 王某; Smith ',year=2025,doi=' 10.1234/example ')
    assert response.status_code==200
    saved=response.json()
    assert (saved['title'],saved['authors'],saved['year'],saved['doi'])==('Revised paper','王某; Smith',2025,'10.1234/example')
    assert saved['revision']==2
    base=client.get(f"/api/v1/documents/{document['id']}").json()
    assert base=={**document,'title':'Revised paper'} and len(base)==7
    assert client.get('/api/v1/documents').json()['items']==[base]
    assert update(client,document,title=saved['title'],authors=saved['authors'],year=saved['year'],doi=saved['doi']).json()==saved
    cleared=update(client,document,authors=' ',year=None,doi='').json()
    assert cleared['authors']==cleared['doi']=='' and cleared['year'] is None and cleared['revision']==3
    assert state(client,document,note)==note_before
    assert all(p.read_bytes()==content for p,content in files.items())
    with app.state.store.connection() as db:
        assert dict(db.execute('SELECT * FROM documents').fetchone())==document


@pytest.mark.parametrize('field,value',[
    ('title',''),('title',' \n '),('title',None),('title','x'*181),('title','a\x00b'),
    ('authors',None),('authors','a'*2001),('authors','a\x00b'),
    ('doi',None),('doi','a'*256),('doi','a\x00b'),
    ('year',0),('year',10000),('year',True),('year',2025.0),('year','2025'),
    ('expected_revision',0),('expected_revision',True),('expected_revision',1.0),
    ('request_id','invalid'),('sha256','x'*64),('page_count',4),('owner','someone')])
def test_invalid_metadata_mutations_do_not_change_state(client,document,field,value):
    before=metadata(client,document)
    payload={'request_id':str(uuid4()),'expected_revision':1,'title':'Valid',field:value}
    assert client.patch(metadata_url(document),json=payload).status_code==422
    assert metadata(client,document)==before


def test_metadata_missing_empty_and_boundaries(client,document):
    assert update(client,document).status_code==422
    assert client.get(f'/api/v1/documents/{uuid4()}/metadata').status_code==404
    assert client.patch(f'/api/v1/documents/{uuid4()}/metadata',json={
        'request_id':str(uuid4()),'expected_revision':1,'title':'Missing'}).status_code==404
    result=update(client,document,title='界'*180,authors='王'*2000,year=9999,doi='引'*255)
    assert result.status_code==200
    assert update(client,document,year=1).status_code==200


def test_metadata_exact_retry_conflicting_uuid_and_superseded_retry(client,document):
    payload={'request_id':str(uuid4()),'expected_revision':1,'title':'Retry title'}
    first=client.patch(metadata_url(document),json=payload)
    assert first.status_code==200
    assert client.patch(metadata_url(document),json=payload).json()==first.json()
    conflict=client.patch(metadata_url(document),json={**payload,'title':'Another'})
    assert conflict.status_code==409 and conflict.json()['detail']['code']=='idempotency_conflict'
    update(client,document,authors='Later edit')
    conflict=client.patch(metadata_url(document),json=payload)
    assert conflict.status_code==409 and conflict.json()['detail']['code']=='revision_conflict'
    assert metadata(client,document)['authors']=='Later edit'


def test_metadata_receipt_failure_rolls_back_state_and_allows_retry(client,app,document):
    before=metadata(client,document)
    with app.state.store.connection() as db:
        db.execute("CREATE TRIGGER reject_metadata_receipt BEFORE INSERT ON document_operations BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END")
    payload={'request_id':str(uuid4()),'expected_revision':1,'authors':'Must roll back'}
    assert client.patch(metadata_url(document),json=payload).status_code==503
    assert metadata(client,document)==before
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM document_operations').fetchone()[0]==0
        db.execute('DROP TRIGGER reject_metadata_receipt')
    assert client.patch(metadata_url(document),json=payload).status_code==200


@pytest.mark.parametrize('same_request',[False,True])
def test_concurrent_metadata_saves_are_versioned(app,document,same_request):
    identifiers=[str(uuid4()) for _ in range(2)]
    if same_request:identifiers[1]=identifiers[0]
    def save(identifier):
        try:
            return app.state.store.library.update(document['id'],DocumentUpdate(
                request_id=identifier,expected_revision=1,title='Concurrent title'))
        except WorkspaceError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(save,identifiers))
    assert sum(isinstance(r,dict) for r in results)==(2 if same_request else 1)
    assert app.state.store.library.get(document['id'])['revision']==2
    if not same_request:assert 'revision_conflict' in results


@pytest.mark.parametrize('field,value,query',[
    ('title','声全息研究','全息'),('authors','Straße; 王某','STRASSE'),
    ('year',2025,'2025'),('doi','10.1234/Test_DATA','test_data')])
def test_search_saved_bibliography_and_original_filename(client,document,field,value,query):
    assert update(client,document,**{field:value}).status_code==200
    result=client.get('/api/v1/search',params={'q':query}).json()
    assert [r['id'] for r in result['documents']]==[document['id']]
    assert field in result['documents'][0]['matched_fields']
    assert client.get('/api/v1/search',params={'q':'SYNTHETIC.PDF'}).json()['documents'][0]['id']==document['id']


def test_search_only_current_active_note_text_with_correct_source(client,document):
    note=add_region(client,document)
    before=state(client,document,note)
    updated=mutate(client,document,note,before,text='中文证据 Straße 100%_literal').json()
    update(client,document,title='Changed document title')
    for query in ['中文证据','STRASSE','%_literal']:
        hit=client.get('/api/v1/search',params={'q':query}).json()['notes'][0]
        assert hit=={**updated,'document_title':'Changed document title'}
    assert client.get('/api/v1/search',params={'q':before['text']}).json()['notes']==[]
    assert client.get('/api/v1/search',params={'q':'%wildcard'}).json()['notes']==[]
    mutate(client,document,note,updated,kind='delete')
    assert client.get('/api/v1/search',params={'q':'中文证据'}).json()['notes']==[]


def test_search_limits_order_empty_and_literal_queries(client,document):
    notes=[add_region(client,document) for _ in range(4)]
    expected=client.get(f"/api/v1/documents/{document['id']}/notes").json()['items']
    query=notes[0]['text']
    result=client.get('/api/v1/search',params={'q':query,'limit':2}).json()
    assert [n['id'] for n in result['notes']]==[n['id'] for n in expected[:2]]
    assert result['has_more'] is True and len(result['notes'])==2
    for q in ['', '  ',"' OR 1=1 --"]:
        result=client.get('/api/v1/search',params={'q':q}).json()
        assert result=={'query':q.strip(),'documents':[],'notes':[],'has_more':False}
    for params in [{'q':'x'*201},{'limit':0},{'limit':101},{'limit':'true'}]:
        assert client.get('/api/v1/search',params=params).status_code==422


def test_export_uses_saved_metadata_and_escapes_markup(client,document):
    saved=update(client,document,title='Paper <img src=x>',authors='A <script>bad()</script>',year=2025,doi='10.1234/<test>').json()
    response=client.get(f"/api/v1/documents/{document['id']}/export")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert json.loads(archive.read('notes.json'))['document']==saved
        for file in ['index.html','README.md']:
            body=archive.read(file).decode()
            doi='10\\.1234/' if file=='README.md' else '10.1234/'
            assert '2025' in body and doi in body and '&lt;script&gt;' in body
        assert '<script>bad()' not in archive.read('index.html').decode()
