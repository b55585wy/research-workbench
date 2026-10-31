import hashlib
import io
import json
import zipfile
from uuid import uuid4
import pytest
from analysis_support import workspace
from image_annotation_support import make_source,create,mutate


def bundle(c,doc):
    response=c.get(f"/api/v1/documents/{doc['id']}/export");assert response.status_code==200,response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        names=z.namelist();assert len(names)==len(set(names))
        files={n:z.read(n) for n in names};manifest=json.loads(files['manifest.json'])
        assert set(files)==set(manifest['files'])|{'manifest.json'}
        for name,entry in manifest['files'].items():assert len(files[name])==entry['byte_size'] and hashlib.sha256(files[name]).hexdigest()==entry['sha256']
        return files


def test_both_source_frames_originals_and_safe_overlays_export_once_without_note_attachment(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        groups=[];text='<script>window.injected=1</script>\n![bad](https://example.invalid/x)'
        for kind in ['user_upload','pdf_excerpt']:
            source,_,url=make_source(c,app,doc,kind);item=create(c,source,url,text=text)[0].json();groups.append((source,item))
        files=bundle(c,doc);payload=json.loads(files['image-annotations.json']);assert len(payload['sources'])==2
        for group,(source,item) in zip(payload['sources'],groups):
            portable=group['source'];assert 'frame_url' not in portable and 'original_url' not in portable
            assert files[portable['frame_path']]==c.get(source['frame_url']).content
            assert files[portable['original_file_path']]==c.get(source['original_url']).content
            assert group['items'][0]['text']==text and 'viewer_url' not in group['items'][0]
            assert b'<svg ' in files['index.html'] and b'<rect ' in files['index.html']
        assert b'<script>' not in files['index.html'] and b'&lt;script&gt;' in files['index.html']
        assert b'![bad](' not in files['README.md']
        assert len(json.loads(files['notes.json'])['notes'])==1
        assert list(app.state.store.exports.iterdir())==[]


def test_deleted_annotations_and_deleted_excerpt_parents_are_excluded_and_restorable(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        upload,_,url=make_source(c,app,doc);item=create(c,upload,url)[0].json();deleted=mutate(c,upload,url,item,'delete')[0].json()
        excerpt,parent,other=make_source(c,app,doc,'pdf_excerpt');create(c,excerpt,other)
        prefix=f"/api/v1/documents/{doc['id']}/notes/{parent['id']}"
        c.request('DELETE',prefix,json={'request_id':str(uuid4()),'expected_revision':1})
        assert 'image-annotations.json' not in bundle(c,doc)
        mutate(c,upload,url,deleted,'restore');assert len(json.loads(bundle(c,doc)['image-annotations.json'])['sources'])==1
        c.post(prefix+'/restore',json={'request_id':str(uuid4()),'expected_revision':2})
        assert len(json.loads(bundle(c,doc)['image-annotations.json'])['sources'])==2


@pytest.mark.parametrize('target',['frame','original','source_pdf'])
def test_export_fails_closed_on_changed_annotated_source_and_cleans_archive(tmp_path,target):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);create(c,source,url)
        path=app.state.store.files/f"{doc['id']}.pdf" if target=='source_pdf' else app.state.images.path(doc['id'],source['source_id'],target=='frame')
        path.write_bytes(b'tampered')
        assert c.get(f"/api/v1/documents/{doc['id']}/export").status_code==409
        assert list(app.state.store.exports.iterdir())==[]
