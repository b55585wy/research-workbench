from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
from uuid import uuid4
import zipfile

from PIL import Image,PngImagePlugin
import pytest

from agent_support import picture,upload_image
from test_note_lifecycle import mutate,state


@pytest.mark.parametrize('format,mime',[('PNG','image/png'),('JPEG','image/jpeg'),('WEBP','image/webp')])
def test_real_upload_preserves_original_and_strips_preview_metadata(client,app,document,format,mime):
    raw=picture(format)
    response=upload_image(client,document,raw,name='figure.'+format.lower())
    assert response.status_code==201,response.text
    value=response.json()
    assert value['mime_type']==mime and value['sha256']==hashlib.sha256(raw).hexdigest()
    assert value['source_kind']=='user_upload' and value['note_ids']==[] and 'storage_key' not in value
    assert client.get(value['file_url']).content==raw
    preview=client.get(value['preview_url'])
    assert preview.status_code==200 and hashlib.sha256(preview.content).hexdigest()==value['preview_sha256']
    with Image.open(io.BytesIO(preview.content)) as image:
        assert max(image.size)<=1600 and 'exif' not in image.info
    assert app.state.store.list_notes(document['id'])==[]


def test_png_text_metadata_not_forwarded_and_large_dimensions_bounded(client,document):
    stream=io.BytesIO();metadata=PngImagePlugin.PngInfo();metadata.add_text('secret','SYNTHETIC PRIVATE METADATA')
    Image.new('RGB',(2000,1000),'red').save(stream,format='PNG',pnginfo=metadata)
    image=upload_image(client,document,stream.getvalue()).json()
    raw=client.get(image['file_url']).content
    assert b'SYNTHETIC PRIVATE METADATA' in raw
    preview=client.get(image['preview_url']).content
    assert b'SYNTHETIC PRIVATE METADATA' not in preview
    with Image.open(io.BytesIO(preview)) as p:assert p.size==(1600,800)


@pytest.mark.parametrize('raw',[b'not image',b'<svg xmlns="http://www.w3.org/2000/svg"/>',picture('GIF'),picture(size=(8193,1))])
def test_invalid_or_unsupported_images_do_not_create_files(client,app,document,raw):
    response=upload_image(client,document,raw)
    assert response.status_code==422,response.text
    assert client.get(f"/api/v1/documents/{document['id']}/images").json()['items']==[]
    assert list(app.state.images.files.iterdir())==list(app.state.store.incoming.iterdir())==[]


def test_animated_and_oversized_images_rejected(client,app,document):
    stream=io.BytesIO();Image.new('RGB',(10,10),'red').save(stream,format='WEBP',save_all=True,
        append_images=[Image.new('RGB',(10,10),'blue')],duration=100,loop=0)
    assert upload_image(client,document,stream.getvalue()).status_code==422
    assert upload_image(client,document,b'x'*(8*1024*1024+1)).status_code==413
    assert list(app.state.store.incoming.iterdir())==[]


def test_upload_retry_conflict_cross_document_and_quota(client,app,document,monkeypatch,pdf):
    identifier=str(uuid4());raw=picture()
    first=upload_image(client,document,raw,identifier)
    assert first.status_code==201
    assert upload_image(client,document,raw,identifier).json()==first.json()
    assert upload_image(client,document,picture(color='red'),identifier).status_code==409
    other=client.post('/api/v1/documents',files={'file':('other.pdf',pdf,'application/pdf')}).json()
    assert upload_image(client,other,raw,identifier).status_code==409
    assert client.get(first.json()['preview_url'].replace(document['id'],other['id'])).status_code==404
    monkeypatch.setattr('research_workbench.images.MAX_DOCUMENT_BYTES',1)
    assert upload_image(client,document,picture(color='red')).status_code==413
    assert len(client.get(f"/api/v1/documents/{document['id']}/images").json()['items'])==1


def test_concurrent_same_image_request_leaves_one_record_and_owned_pair(client,app,document):
    identifier=str(uuid4());raw=picture()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:upload_image(client,document,raw,identifier),range(2)))
    assert sorted(r.status_code for r in responses)==[200,201]
    assert responses[0].json()==responses[1].json()
    assert len(list(app.state.images.files.iterdir()))==2
    assert list(app.state.store.incoming.iterdir())==[]
    assert client.get(responses[0].json()['file_url']).content==raw


def test_upload_write_failure_cleans_only_attempt_files(client,app,document):
    first=upload_image(client,document).json()
    original=client.get(first['file_url']).content
    with app.state.store.connection() as db:
        db.execute("CREATE TRIGGER reject_upload BEFORE INSERT ON image_assets BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    assert upload_image(client,document,picture(color='red')).status_code==503
    assert client.get(first['file_url']).content==original
    assert len(list(app.state.images.files.iterdir()))==2
    assert list(app.state.store.incoming.iterdir())==[]


@pytest.mark.parametrize('preview',[False,True])
def test_missing_or_changed_image_is_not_success(client,app,document,preview):
    image=upload_image(client,document).json()
    path=app.state.images.path(document['id'],image['id'],preview)
    path.write_bytes(b'changed synthetic bytes')
    assert client.get(image['preview_url' if preview else 'file_url']).status_code==409


def image_note(client,document,image_ids,identifier=None,**fields):
    payload={'request_id':identifier or str(uuid4()),'page':1,'text':'User-uploaded synthetic figure',
             'image_ids':image_ids,**fields}
    return client.post(f"/api/v1/documents/{document['id']}/image-notes",json=payload)


def test_image_note_atomic_retry_after_edit_and_deleted_note_no_resurrection(client,document):
    image=upload_image(client,document).json();identifier=str(uuid4())
    first=image_note(client,document,[image['id']],identifier)
    assert first.status_code==201 and len(first.json())==6
    note=first.json()
    assert image_note(client,document,[image['id']],identifier).status_code==200
    changed=mutate(client,document,note,state(client,document,note),text='Edited image note').json()
    retry=image_note(client,document,[image['id']],identifier)
    assert retry.json()['text']==changed['text']
    mutate(client,document,note,changed,kind='delete')
    assert image_note(client,document,[image['id']],identifier).status_code in (404,409)
    assert client.get(image['file_url']).status_code==200


@pytest.mark.parametrize('kind',['unknown','other_document','duplicate','too_many'])
def test_image_note_invalid_links_cannot_create_partial_note(client,document,pdf,kind):
    image=upload_image(client,document).json()
    ids=[str(uuid4())]
    if kind=='duplicate':ids=[image['id'],image['id']]
    if kind=='too_many':ids=[str(uuid4()) for _ in range(5)]
    if kind=='other_document':
        other=client.post('/api/v1/documents',files={'file':('other.pdf',pdf,'application/pdf')}).json()
        ids=[upload_image(client,other).json()['id']]
    assert image_note(client,document,ids).status_code in (404,422)
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items']==[]


def test_image_note_receipt_failure_rolls_back_note_state_and_links(client,app,document):
    image=upload_image(client,document).json();identifier=str(uuid4())
    with app.state.store.connection() as db:
        db.execute("CREATE TRIGGER reject_image_note BEFORE INSERT ON image_note_requests BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    assert image_note(client,document,[image['id']],identifier).status_code==503
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM notes').fetchone()[0]==0
        assert db.execute('SELECT COUNT(*) FROM note_states').fetchone()[0]==0
        assert db.execute('SELECT COUNT(*) FROM note_images').fetchone()[0]==0
        db.execute('DROP TRIGGER reject_image_note')
    assert image_note(client,document,[image['id']],identifier).status_code==201


def test_export_original_preview_provenance_omit_unattached_and_deleted(client,document):
    selected=upload_image(client,document).json();other=upload_image(client,document,picture(color='red')).json()
    note=image_note(client,document,[selected['id']]).json()
    response=client.get(f"/api/v1/documents/{document['id']}/export")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        data=json.loads(archive.read('notes.json'));attachment=data['notes'][0]['attachments'][0]
        assert attachment['source_kind']=='user_upload'
        assert hashlib.sha256(archive.read(attachment['file_path'])).hexdigest()==selected['sha256']
        assert hashlib.sha256(archive.read(attachment['preview_path'])).hexdigest()==selected['preview_sha256']
        assert all(other['id'] not in n for n in archive.namelist())
        assert 'User-uploaded image' in archive.read('index.html').decode()
    mutate(client,document,note,state(client,document,note),kind='delete')
    with zipfile.ZipFile(io.BytesIO(client.get(f"/api/v1/documents/{document['id']}/export").content)) as archive:
        assert json.loads(archive.read('notes.json'))['notes']==[]
        assert all(not n.startswith(('uploads/','images/')) for n in archive.namelist())


def test_empty_and_exact_size_boundary(client,document):
    response=client.post(f"/api/v1/documents/{document['id']}/images",data={'request_id':str(uuid4())},files={'file':('empty.png',b'','image/png')})
    assert response.status_code==422
    raw=picture();raw+=b' '*(8*1024*1024-len(raw))
    response=upload_image(client,document,raw)
    assert response.status_code==201 and response.json()['byte_size']==8*1024*1024


@pytest.mark.parametrize('body,code',[("import os;os._exit(9)",'invalid_image'),("import time;time.sleep(5)",'image_timeout')])
def test_image_child_crash_timeout_isolated_from_parent(tmp_path,monkeypatch,body,code):
    from research_workbench.images import ImageLibrary
    from research_workbench.models import WorkspaceError
    script=tmp_path/'probe.py';script.write_text(body)
    monkeypatch.setattr('research_workbench.images.PROBE',script)
    with pytest.raises(WorkspaceError) as error:
        ImageLibrary.decode(tmp_path/'synthetic.png',tmp_path/'preview.png',timeout=.1)
    assert error.value.code==code
