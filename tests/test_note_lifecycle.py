from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import threading
from uuid import uuid4
import zipfile

import pytest

from research_workbench.models import NoteMutation, NoteUpdate, WorkspaceError
from test_excerpts import add_region, excerpt_url


def note_url(document, note):
    return f"/api/v1/documents/{document['id']}/notes/{note['id']}"


def state(client, document, note):
    response = client.get(note_url(document, note) + '/state')
    assert response.status_code == 200
    return response.json()


def mutate(client, document, note, current, kind='patch', **changes):
    payload = {'request_id': str(uuid4()), 'expected_revision': current['revision'], **changes}
    suffix = '/restore' if kind == 'restore' else ''
    method = {'patch': 'PATCH', 'delete': 'DELETE', 'restore': 'POST'}[kind]
    return client.request(method, note_url(document, note) + suffix, json=payload)


def test_edit_preserves_source_image_and_original_creation_text(client, app, document):
    note = add_region(client, document)
    image = client.post(excerpt_url(document, note)).json()
    original_bytes = client.get(image['image_url']).content
    original = state(client, document, note)
    assert original['revision'] == 1 and original['review_status'] == 'unreviewed'
    response = mutate(client, document, note, original, text='  Revised 中文 note  ')
    assert response.status_code == 200
    updated = response.json()
    assert updated['text'] == 'Revised 中文 note' and updated['revision'] == 2
    assert all(updated[key] == note[key] for key in ('id', 'document_id', 'page', 'rect', 'created_at'))
    assert client.get(image['image_url']).content == original_bytes
    with app.state.store.connection() as db:
        assert db.execute('SELECT text FROM notes WHERE id=?', (note['id'],)).fetchone()[0] == note['text']
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items'][0] == {
        key: updated[key] for key in ('id','document_id','page','rect','text','created_at')}


def test_review_lifecycle_resets_only_for_changed_text(client, document):
    note = add_region(client, document)
    initial = state(client, document, note)
    checked = mutate(client, document, note, initial, review_status='source_checked').json()
    assert checked['reviewed_at'] and checked['review_provenance'] == 'self_reported'
    assert checked['revision'] == 2
    assert mutate(client, document, note, checked, review_status='source_checked').json() == checked
    assert mutate(client, document, note, checked, text=checked['text']).json() == checked
    changed = mutate(client, document, note, checked, text='Corrected content').json()
    assert changed['review_status'] == 'unreviewed' and changed['reviewed_at'] is None
    assert changed['review_provenance'] is None and changed['revision'] == 3
    explicit = mutate(client, document, note, changed, text='Explicitly checked new text', review_status='source_checked').json()
    assert explicit['revision'] == 4 and explicit['review_status'] == 'source_checked'
    unchecked = mutate(client, document, note, explicit, review_status='unreviewed').json()
    assert unchecked['revision'] == 5 and unchecked['reviewed_at'] is None


@pytest.mark.parametrize('review', ['unreviewed','source_checked'])
def test_delete_and_restore_preserve_text_source_image_and_review(client, app, document, review):
    note = add_region(client, document)
    image = client.post(excerpt_url(document, note)).json()
    current = state(client, document, note)
    if review == 'source_checked':
        current = mutate(client, document, note, current, review_status=review).json()
    deleted = mutate(client, document, note, current, kind='delete').json()
    assert deleted['deleted_at'] and deleted['revision'] == current['revision'] + 1
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items'] == []
    assert client.get(f"/api/v1/documents/{document['id']}/excerpts").json()['items'] == []
    assert client.get(image['image_url']).status_code == 404
    assert client.post(image['image_url']).status_code == 404
    assert mutate(client, document, note, deleted, text='Hidden edit').status_code == 409
    assert mutate(client, document, note, deleted, review_status='source_checked').status_code == 409
    assert mutate(client, document, note, deleted, kind='delete').json() == deleted
    assert (app.state.store.excerpts/f"{note['id']}.png").is_file()
    restored = mutate(client, document, note, deleted, kind='restore').json()
    assert restored['deleted_at'] is None and restored['revision'] == deleted['revision'] + 1
    assert all(restored[key] == current[key] for key in ('text','rect','page','review_status','reviewed_at','review_provenance'))
    assert mutate(client, document, note, restored, kind='restore').json() == restored
    assert client.get(image['image_url']).status_code == 200


@pytest.mark.parametrize('field,value', [
    ('text',None),('text',''),('text',' \n\t '),('text','x'*10001),('text','\x00'),
    ('review_status',None),('review_status','verified'),('review_status',True),
    ('expected_revision',0),('expected_revision',-1),('expected_revision',True),('expected_revision',1.2),
    ('request_id','invalid'),('page',2),('rect',[0,0,1,1]),('reviewed_at','self timestamp'),('actor_id','self user')])
def test_invalid_update_never_changes_state(client, document, field, value):
    note = add_region(client, document)
    before = state(client, document, note)
    payload = {'request_id':str(uuid4()),'expected_revision':1,'text':'Valid text'}
    payload[field] = value
    assert client.patch(note_url(document,note),json=payload).status_code == 422
    assert state(client,document,note) == before


def test_empty_patch_and_missing_wrong_document_are_rejected(client, document, pdf):
    note = add_region(client,document)
    request={'request_id':str(uuid4()),'expected_revision':1}
    assert client.patch(note_url(document,note),json=request).status_code == 422
    assert client.patch(note_url(document,{'id':str(uuid4())}),json={**request,'text':'x'}).status_code == 404
    other=client.post('/api/v1/documents',files={'file':('other.pdf',pdf)}).json()
    assert client.get(note_url(other,note)+'/state').status_code == 404
    assert client.patch(note_url(other,note),json={**request,'text':'x'}).status_code == 404
    assert client.get(f'/api/v1/documents/{uuid4()}/note-states').status_code == 404


def test_maximum_text_and_stale_revision_boundary(client, document):
    note=add_region(client,document)
    current=state(client,document,note)
    updated=mutate(client,document,note,current,text='中'*10000).json()
    assert len(updated['text']) == 10000
    conflict=mutate(client,document,note,current,text='Cannot overwrite')
    assert conflict.status_code == 409 and conflict.json()['detail']['code']=='revision_conflict'
    assert state(client,document,note) == updated


def test_lost_response_retry_applies_one_mutation_and_receipt(client,app,document):
    note=add_region(client,document)
    payload={'request_id':str(uuid4()),'expected_revision':1,'text':'One edit'}
    first=client.patch(note_url(document,note),json=payload)
    repeat=client.patch(note_url(document,note),json=payload)
    assert first.status_code==repeat.status_code==200 and repeat.json()==first.json()
    with app.state.store.connection() as db:
        assert db.execute('SELECT count(*) FROM note_operations').fetchone()[0]==1
    assert client.patch(note_url(document,note),json={**payload,'text':'Changed request'}).json()['detail']['code']=='idempotency_conflict'
    assert client.request('DELETE',note_url(document,note),json={key:payload[key] for key in ('request_id','expected_revision')}).json()['detail']['code']=='idempotency_conflict'
    newest=mutate(client,document,note,first.json(),text='Newer text').json()
    old=client.patch(note_url(document,note),json=payload)
    assert old.status_code==409 and old.json()['detail']['code']=='revision_conflict'
    assert state(client,document,note)==newest


@pytest.mark.parametrize('kind',['delete','restore'])
def test_lifecycle_response_retry_keeps_same_revision(client,document,kind):
    note=add_region(client,document)
    current=state(client,document,note)
    if kind=='restore':current=mutate(client,document,note,current,kind='delete').json()
    payload={'request_id':str(uuid4()),'expected_revision':current['revision']}
    method='DELETE' if kind=='delete' else 'POST'
    url=note_url(document,note)+('/restore' if kind=='restore' else '')
    first=client.request(method,url,json=payload)
    repeated=client.request(method,url,json=payload)
    assert first.status_code==repeated.status_code==200 and first.json()==repeated.json()


def test_failed_receipt_write_rolls_back_edit_and_retry_can_succeed(client,app,document):
    note=add_region(client,document)
    before=state(client,document,note)
    with app.state.store.connection() as db:
        db.executescript("CREATE TRIGGER reject_receipt BEFORE INSERT ON note_operations BEGIN SELECT RAISE(ABORT,'private/path'); END;")
    payload={'request_id':str(uuid4()),'expected_revision':1,'text':'Retry safely'}
    response=client.patch(note_url(document,note),json=payload)
    assert response.status_code==503 and 'private/path' not in response.text
    assert state(client,document,note)==before
    with app.state.store.connection() as db:
        assert db.execute('SELECT count(*) FROM note_operations').fetchone()[0]==0
        db.execute('DROP TRIGGER reject_receipt')
    assert client.patch(note_url(document,note),json=payload).json()['revision']==2


@pytest.mark.parametrize('same_request',[False,True])
def test_concurrent_edits_do_not_lose_updates(client,app,document,same_request):
    note=add_region(client,document)
    barrier=threading.Barrier(2)
    request_id=uuid4()
    def edit(index):
        payload=NoteUpdate(request_id=request_id if same_request else uuid4(),expected_revision=1,
                           text='Same edit' if same_request else f'Edit {index}')
        barrier.wait(timeout=3)
        try:return app.state.store.lifecycle.mutate(document['id'],note['id'],'patch',payload)
        except WorkspaceError as error:return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(edit,[0,1]))
    if same_request:assert results[0]==results[1]
    else:assert sum(isinstance(result,dict) for result in results)==1 and 'revision_conflict' in results
    assert state(client,document,note)['revision']==2


def test_original_creation_retry_does_not_revert_edit_or_restore_deletion(client,document):
    note=add_region(client,document)
    creation={'request_id':note['id'],'page':note['page'],'rect':note['rect'],'text':note['text']}
    changed=mutate(client,document,note,state(client,document,note),text='Current edited text').json()
    repeated=client.post(f"/api/v1/documents/{document['id']}/notes",json=creation)
    assert repeated.status_code==200 and repeated.json()['text']==changed['text']
    mutate(client,document,note,changed,kind='delete')
    assert client.post(f"/api/v1/documents/{document['id']}/notes",json=creation).status_code==409
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items']==[]


def test_export_uses_current_text_review_and_only_active_images(client,document):
    first=add_region(client,document)
    second=add_region(client,document)
    first_image=client.post(excerpt_url(document,first)).json()
    client.post(excerpt_url(document,second))
    changed=mutate(client,document,first,state(client,document,first),text='Revised export text').json()
    checked=mutate(client,document,first,changed,review_status='source_checked').json()
    mutate(client,document,second,state(client,document,second),kind='delete')
    response=client.get(f"/api/v1/documents/{document['id']}/export")
    assert response.status_code==200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        notes=json.loads(archive.read('notes.json'))['notes']
        assert len(notes)==1 and notes[0]['text']==checked['text']
        assert notes[0]['review_status']=='source_checked' and notes[0]['review_provenance']=='self_reported'
        assert notes[0]['revision']==checked['revision'] and notes[0]['reviewed_at']==checked['reviewed_at']
        assert f"images/{first['id']}.png" in archive.namelist() and f"images/{second['id']}.png" not in archive.namelist()
        assert '自行确认' in archive.read('index.html').decode()
        assert hashlib.sha256(archive.read(f"images/{first['id']}.png")).hexdigest()==first_image['sha256']


def test_deletion_during_render_cannot_commit_a_late_image(client,app,document):
    note=add_region(client,document)
    entered,release=threading.Event(),threading.Event()
    actual=app.state.excerpts.renderer
    def held(source,note,output):
        entered.set();assert release.wait(5);actual(source,note,output)
    app.state.excerpts.renderer=held
    def create():
        try:return app.state.excerpts.create(document['id'],note['id'])
        except WorkspaceError as error:return error.status
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(create);assert entered.wait(3)
        deleted=mutate(client,document,note,state(client,document,note),kind='delete').json()
        release.set();assert future.result(timeout=10)==404
    assert app.state.store.list_excerpts(document['id'])==[]
    assert list(app.state.store.excerpts.iterdir())==[]
    mutate(client,document,note,deleted,kind='restore')
    app.state.excerpts.renderer=actual
    assert client.post(excerpt_url(document,note)).status_code==201


def test_export_snapshot_stays_consistent_if_note_deleted_after_snapshot(client,app,document,monkeypatch):
    note=add_region(client,document)
    image=client.post(excerpt_url(document,note)).json()
    entered,release=threading.Event(),threading.Event()
    actual=app.state.store.reading_snapshot
    def held(identifier,**options):
        snapshot=actual(identifier,**options)
        entered.set();assert release.wait(5)
        return snapshot
    monkeypatch.setattr(app.state.store,'reading_snapshot',held)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(client.get,f"/api/v1/documents/{document['id']}/export")
        assert entered.wait(3)
        mutate(client,document,note,state(client,document,note),kind='delete')
        release.set();response=future.result(timeout=10)
    assert response.status_code==200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        exported=json.loads(archive.read('notes.json'))['notes']
        assert len(exported)==1 and exported[0]['id']==note['id']
        assert exported[0]['deleted_at'] is None
        assert hashlib.sha256(archive.read(f"images/{note['id']}.png")).hexdigest()==image['sha256']
    monkeypatch.setattr(app.state.store,'reading_snapshot',actual)
    response=client.get(f"/api/v1/documents/{document['id']}/export")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert json.loads(archive.read('notes.json'))['notes']==[]
        assert not any(name.startswith('images/') for name in archive.namelist())
