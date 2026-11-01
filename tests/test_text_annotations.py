import io
import html
import json
import sqlite3
import zipfile
from uuid import uuid4
import pytest
from test_note_lifecycle import mutate, state, note_url


def annotation_payload(**changes):
    annotation={'kind':'highlight','color':'yellow','quote':'Selected quotation <literal>',
                'rects':[[.1,.1,.7,.14],[.1,.16,.5,.2]]}
    annotation.update(changes)
    return {'request_id':str(uuid4()),'page':1,'rect':[.1,.1,.7,.2],
            'text':annotation['quote'],'annotation':annotation}


def create_annotation(client, document, **changes):
    body=annotation_payload(**changes)
    response=client.post(f"/api/v1/documents/{document['id']}/notes",json=body)
    assert response.status_code==201,response.text
    return response.json(),body


@pytest.mark.parametrize('kind',['highlight','underline'])
@pytest.mark.parametrize('color',['yellow','green','blue','pink'])
def test_persist_exact_multiline_geometry_and_legacy_note_shape(client,app,document,kind,color):
    note,body=create_annotation(client,document,kind=kind,color=color)
    assert set(note)=={'id','document_id','page','rect','text','created_at'}
    saved=state(client,document,note)
    assert saved['annotation']=={**body['annotation'],'source_sha256':document['sha256']}
    assert saved['review_status']=='unreviewed' and saved['revision']==1
    assert client.get(f"/api/v1/documents/{document['id']}/file").status_code==200


def test_style_revision_retry_original_quote_and_comment_edit(client,app,document):
    note,body=create_annotation(client,document)
    first=state(client,document,note)
    checked=mutate(client,document,note,first,review_status='source_checked').json()
    payload={'request_id':str(uuid4()),'expected_revision':checked['revision'],
             'annotation_style':{'kind':'underline','color':'pink'}}
    url=note_url(document,note)
    changed=client.patch(url,json=payload)
    assert changed.status_code==200
    changed=changed.json()
    assert changed['annotation']['kind']=='underline' and changed['revision']==3
    assert changed['review_status']=='source_checked'
    assert client.patch(url,json=payload).json()==changed
    assert client.patch(url,json={**payload,'annotation_style':{'kind':'highlight','color':'blue'}}).status_code==409
    comment=mutate(client,document,note,changed,text='My comment only').json()
    assert comment['annotation']['quote']==body['annotation']['quote'] and comment['review_status']=='unreviewed'
    repeated=client.post(f"/api/v1/documents/{document['id']}/notes",json=body)
    assert repeated.status_code==200 and repeated.json()['text']=='My comment only'
    assert state(client,document,note)['annotation']['color']=='pink'
    other={**body,'annotation':{**body['annotation'],'color':'blue'}}
    assert client.post(f"/api/v1/documents/{document['id']}/notes",json=other).status_code==409
    stale={**payload,'request_id':str(uuid4())}
    assert client.patch(url,json=stale).json()['detail']['code']=='revision_conflict'


def test_delete_restore_purge_erase_original_and_current_annotation(client,app,document):
    note,_=create_annotation(client,document)
    first=state(client,document,note)
    deleted=mutate(client,document,note,first,'delete').json()
    assert deleted['annotation']==first['annotation']
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items']==[]
    restored=mutate(client,document,note,deleted,'restore').json()
    assert restored['annotation']==first['annotation']
    deleted=mutate(client,document,note,restored,'delete').json()
    result=client.post(note_url(document,note)+'/purge',json={'request_id':str(uuid4()),'expected_revision':deleted['revision']})
    assert result.status_code==200
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM note_text_annotations').fetchone()[0]==0
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]


@pytest.mark.parametrize('change',[{'kind':'ink'},{'color':'red;position:fixed'},{'quote':''},
    {'quote':'x\x00y'},{'quote':'x'*10001},{'rects':[]},{'rects':[[.1,.1,.7,.14]]*257},
    {'rects':[[True,0,.5,.5]]},{'rects':[['.1',.1,.5,.5]]},{'rects':[[.5,.1,.1,.5]]},
    {'rects':[[-.1,0,.5,.5]]},{'rects':[[0,0,1.1,.5]]},{'rects':[[0,0,.5,float('inf')]]},
    {'source_sha256':'a'*64},{'script':'alert(1)'}])
def test_invalid_annotation_is_rejected_atomically(client,app,document,change):
    body=annotation_payload(**change)
    if 'quote' in change:body['text']='Valid body'
    response=client.post(f"/api/v1/documents/{document['id']}/notes",content=json.dumps(body),headers={'Content-Type':'application/json'})
    assert response.status_code==422,response.text
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM notes').fetchone()[0]==0
        assert db.execute('SELECT COUNT(*) FROM note_text_annotations').fetchone()[0]==0


def test_mismatched_union_quote_study_and_source_drift_rejected(client,app,document):
    url=f"/api/v1/documents/{document['id']}/notes"
    body=annotation_payload();body['rect']=[0,0,1,1]
    assert client.post(url,json=body).status_code==422
    body=annotation_payload();body['text']='Different body'
    assert client.post(url,json=body).status_code==422
    study=client.post('/api/v1/studies',json={'request_id':str(uuid4()),'name':'No PDF','question':'No PDF?'}).json()
    assert client.post(f"/api/v1/documents/{study['id']}/notes",json=annotation_payload()).status_code==422
    (app.state.store.files/f"{document['id']}.pdf").write_bytes(b'changed source')
    assert client.post(url,json=annotation_payload()).json()['detail']['code']=='source_changed'


def test_style_cannot_create_annotation_on_plain_note(client,document):
    body={'request_id':str(uuid4()),'page':1,'rect':None,'text':'Plain'}
    note=client.post(f"/api/v1/documents/{document['id']}/notes",json=body).json()
    result=client.patch(note_url(document,note),json={'request_id':str(uuid4()),'expected_revision':1,
        'annotation_style':{'kind':'highlight','color':'yellow'}})
    assert result.status_code==409


def test_creation_transaction_rollback_leaves_no_orphan_note(client,app,document):
    with app.state.store.connection() as db:
        db.execute("CREATE TRIGGER deny_annotation BEFORE INSERT ON note_text_annotations BEGIN SELECT RAISE(ABORT,'injected'); END")
    result=client.post(f"/api/v1/documents/{document['id']}/notes",json=annotation_payload())
    assert result.status_code==503
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM notes').fetchone()[0]==0


def test_reading_export_retains_annotation_quote_after_comment_edit_and_safe_html(client,document):
    note,body=create_annotation(client,document)
    mutate(client,document,note,state(client,document,note),text='Comment only')
    result=client.get(f"/api/v1/documents/{document['id']}/export")
    assert result.status_code==200
    with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
        payload=json.loads(archive.read('notes.json'))['notes'][0]
        assert payload['annotation']['quote']==body['annotation']['quote']
        markup=archive.read('index.html').decode()
        assert '&lt;literal&gt;' in markup and '<literal>' not in markup
        assert 'Comment only' in markup and body['annotation']['quote'] in html.unescape(archive.read('README.md').decode())


def test_schema14_upgrade_preserves_all_old_records_and_files(client,app,document):
    from research_workbench.store import Store
    from test_excerpts import add_region,excerpt_url
    note=add_region(client,document)
    assert client.post(excerpt_url(document,note)).status_code==201
    store=app.state.store
    with store.connection() as db:
        db.execute('DROP TABLE note_text_annotations');db.execute('PRAGMA user_version=14')
        names=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        assert len(names)==30
        before={n:list(map(tuple,db.execute(f'SELECT * FROM {n} ORDER BY 1'))) for n in names}
    pdf=(store.files/f"{document['id']}.pdf").read_bytes();png=(store.excerpts/f"{note['id']}.png").read_bytes()
    Store(store.root)
    with store.connection() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==15
        assert before=={n:list(map(tuple,db.execute(f'SELECT * FROM {n} ORDER BY 1'))) for n in names}
        assert db.execute('SELECT COUNT(*) FROM note_text_annotations').fetchone()[0]==0
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        db.execute('PRAGMA user_version=16')
    with pytest.raises(RuntimeError,match='newer application'):Store(store.root)
    assert (store.files/f"{document['id']}.pdf").read_bytes()==pdf
    assert (store.excerpts/f"{note['id']}.png").read_bytes()==png
