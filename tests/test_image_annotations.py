from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import sqlite3
from uuid import uuid4
from PIL import Image
import pytest
from analysis_support import workspace
from agent_support import text_pdf
from image_annotation_support import make_source,source_url,create,mutate


@pytest.mark.parametrize('kind',['user_upload','pdf_excerpt'])
def test_source_frames_create_and_all_lifecycle_transitions_preserve_originals(tmp_path,kind):
    with workspace(tmp_path) as (c,app,doc,model):
        source,original,url=make_source(c,app,doc,kind)
        frame=c.get(url+'/frame');assert frame.status_code==200 and len(frame.content)==source['frame_byte_size']
        assert hashlib.sha256(frame.content).hexdigest()==source['frame_sha256']==frame.headers['x-content-sha256']
        with Image.open(io.BytesIO(frame.content)) as image:assert image.size==(source['frame_width'],source['frame_height'])
        old=c.get(source['original_url']).content
        response,initial=create(c,source,url);assert response.status_code==201,response.text;item=response.json()
        assert item['origin']=='manual' and item['revision']==1 and item['rect']==initial['rect']
        assert c.post(url+'/annotations',json=initial).json()==item
        response,_=mutate(c,source,url,item,text=item['text']);assert response.json()==item
        response,_=mutate(c,source,url,item,text='Edited region',rect=[0,0,1,1]);item=response.json();assert item['revision']==2
        for action,revision in [('delete',3),('delete',3),('restore',4),('restore',4)]:
            response,_=mutate(c,source,url,item,action);assert response.status_code==200,response.text;item=response.json();assert item['revision']==revision
        assert c.get(source['original_url']).content==old and model.calls==[]
        assert c.get(url).json()['items']==[item]


@pytest.mark.parametrize('format',['JPEG','PNG','WEBP'])
def test_upload_annotation_frame_uses_normalized_orientation_not_raw_dimensions(tmp_path,format):
    raw=io.BytesIO();image=Image.new('RGB',(320,240),'green');exif=Image.Exif();exif[274]=6;image.save(raw,format=format,exif=exif)
    with workspace(tmp_path) as (c,app,doc,_):
        source,original,url=make_source(c,app,doc,content=raw.getvalue())
        assert (original['width'],original['height'])==(320,240)
        assert (source['frame_width'],source['frame_height'])==(240,320)
        assert c.get(source['original_url']).content==raw.getvalue()
        assert source['frame_sha256']!=source['source_sha256']


BAD_RECTS=[[True,0,.5,.5],['0',0,.5,.5],[-.01,0,.5,.5],[0,0,1.01,.5],[0,0,0,.5],[.5,0,.1,1],
           [0,.5,1,.5],[0,1,1,0],[0,0,1],[0,0,1,1,1],None,{'left':0}]


@pytest.mark.parametrize('rect',BAD_RECTS)
def test_reject_invalid_rectangle_without_state_or_original_note_changes(tmp_path,rect):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);response,_=create(c,source,url,rect=rect)
        assert response.status_code==422,response.text;assert c.get(url).json()['items']==[]
        assert c.get(f"/api/v1/documents/{doc['id']}/notes").json()['items']==[]


@pytest.mark.parametrize('changes',[{'text':''},{'text':'  '},{'text':'x\0y'},{'text':'x'*2001},{'text':None},{'origin':'agent_proposal'},
    {'frame_sha256':'bad'},{'source_sha256':'A'*64},{'request_id':'not-a-uuid'}])
def test_reject_invalid_text_hash_id_unknown_fields(tmp_path,changes):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);r,_=create(c,source,url,**changes)
        assert r.status_code==422,r.text;assert c.get(url).json()['items']==[]


def test_text_limit_and_geometry_edges_noop_and_mutation_validation(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);response,_=create(c,source,url,text='x'*2000,rect=[0,0,1,1]);assert response.status_code==201
        item=response.json()
        for changes in [{},{'text':None},{'rect':None},{'rect':[False,0,1,1]},{'expected_revision':True},{'review_status':'source_checked'}]:
            response,_=mutate(c,source,url,item,**changes);assert response.status_code==422,response.text
        for bad in ['NaN','Infinity']:
            payload={'request_id':str(uuid4()),'source_sha256':source['source_sha256'],'frame_sha256':source['frame_sha256'],'rect':[0,0,1,1],'text':'x'}
            raw=json.dumps(payload).replace('0, 0, 1, 1',bad+', 0, 1, 1')
            assert c.post(url+'/annotations',content=raw,headers={'content-type':'application/json'}).status_code==422


def test_exact_retry_uuid_conflict_later_revision_and_deleted_creation_retry(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);response,initial=create(c,source,url);item=response.json()
        assert c.post(url+'/annotations',json={**initial,'text':'different'}).status_code==409
        response,payload=mutate(c,source,url,item,text='Edited');assert response.status_code==200;edited=response.json()
        target=url+'/annotations/'+item['id'];assert c.patch(target,json=payload).json()==edited
        assert c.patch(target,json={**payload,'rect':[.2,.2,.3,.3]}).status_code==409
        later=mutate(c,source,url,edited,text='Later')[0].json();assert c.patch(target,json=payload).status_code==409
        assert c.post(url+'/annotations',json=initial).json()==later
        deleted=mutate(c,source,url,later,'delete')[0].json();assert mutate(c,source,url,deleted,text='No')[0].status_code==409
        assert c.post(url+'/annotations',json=initial).status_code==409


def test_concurrent_creation_and_mutation_retry_commit_once(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc)
        payload={'request_id':str(uuid4()),'source_sha256':source['source_sha256'],'frame_sha256':source['frame_sha256'],'rect':[0,0,.5,.5],'text':'Concurrent'}
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:c.post(url+'/annotations',json=payload),range(2)))
        assert sorted(r.status_code for r in responses)==[200,201] and responses[0].json()==responses[1].json()
        item=responses[0].json();change={k:payload[k] for k in ('source_sha256','frame_sha256')};change.update(request_id=str(uuid4()),expected_revision=1,text='Concurrent edit')
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:c.patch(url+'/annotations/'+item['id'],json=change),range(2)))
        assert all(r.status_code==200 for r in responses) and responses[0].json()==responses[1].json()
        assert responses[0].json()['revision']==2


def test_cross_paper_source_and_annotation_scope_never_leaks_or_writes(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);item=create(c,source,url)[0].json()
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        second,_,other_url=make_source(c,app,doc)
        assert c.get(source_url(other,'user_upload',source['source_id'])).status_code==404
        assert c.get(source_url(doc,'pdf_excerpt',source['source_id'])).status_code==404
        assert c.get(source_url(doc,'other',source['source_id'])).status_code==422
        assert mutate(c,second,other_url,item,text='Wrong source')[0].status_code==404
        assert c.get(url).json()['items']==[item]


@pytest.mark.parametrize('kind',['user_upload','pdf_excerpt'])
def test_missing_tampered_files_and_stale_hashes_fail_closed(tmp_path,kind):
    with workspace(tmp_path) as (c,app,doc,_):
        source,original,url=make_source(c,app,doc,kind);item=create(c,source,url)[0].json()
        assert create(c,source,url,frame_sha256='0'*64)[0].status_code==409
        path=app.state.images.path(doc['id'],source['source_id'],True) if kind=='user_upload' else app.state.store.excerpts/f"{source['source_id']}.png"
        data=path.read_bytes();path.write_bytes(data+b'tampered')
        assert c.get(url).status_code==409 and c.get(url+'/frame').status_code==409
        assert mutate(c,source,url,item,text='Wrong frame')[0].status_code==409
        path.write_bytes(data);path.unlink();assert c.get(url).status_code==409


def test_deleted_excerpt_parent_hides_without_deleting_annotation_and_restore_recovers(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        source,parent,url=make_source(c,app,doc,'pdf_excerpt');item=create(c,source,url)[0].json();prefix=f"/api/v1/documents/{doc['id']}/notes/{parent['id']}"
        assert c.request('DELETE',prefix,json={'request_id':str(uuid4()),'expected_revision':1}).status_code==200
        assert c.get(url).status_code==404
        assert c.post(prefix+'/restore',json={'request_id':str(uuid4()),'expected_revision':2}).status_code==200
        assert c.get(url).json()['items']==[item]


@pytest.mark.parametrize('action',['create','patch'])
def test_transaction_failure_rolls_back_state_and_receipts(tmp_path,action):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);item=create(c,source,url)[0].json() if action=='patch' else None
        table='image_annotation_operations' if action=='patch' else 'image_annotations'
        with app.state.store.connection() as db:db.execute(f"CREATE TRIGGER reject_write BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END")
        response=mutate(c,source,url,item,text='Not committed')[0] if item else create(c,source,url)[0]
        assert response.status_code==503,response.text
        assert c.get(url).json()['items']==([item] if item else [])
        with app.state.store.connection() as db:assert db.execute('SELECT COUNT(*) FROM image_annotation_operations').fetchone()[0]==0


def test_frame_permission_error_reports_generic_failure_no_partial_write(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        source,_,url=make_source(c,app,doc);target=app.state.images.path(doc['id'],source['source_id'],True);original=Path.open
        def fail(path,*args,**kwargs):
            if path==target:raise PermissionError('sensitive filesystem path')
            return original(path,*args,**kwargs)
        monkeypatch.setattr(Path,'open',fail)
        r,_=create(c,source,url);assert r.status_code==503 and 'sensitive' not in r.text
        with app.state.store.connection() as db:assert db.execute('SELECT COUNT(*) FROM image_annotations').fetchone()[0]==0
