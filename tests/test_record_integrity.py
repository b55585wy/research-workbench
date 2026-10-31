import asyncio
import base64
import io
import json
from uuid import uuid4
import pytest
from analysis_support import workspace, upload, payload
from record_support import prefix, prepare, spec, preview, verified
from conftest import make_pdf
from image_annotation_support import make_source, create as annotate, mutate
from research_workbench.models import WorkspaceError
from research_workbench.reading_export import ExportResponse


def note(c,doc,text='Original synthetic source note'):
    response=c.post(f"/api/v1/documents/{doc['id']}/notes",json={'request_id':str(uuid4()),'page':1,'rect':None,'text':text})
    assert response.status_code==201,response.text
    return response.json()


@pytest.mark.parametrize('reading',[False,True])
def test_note_changes_invalidate_only_included_reading(tmp_path,reading):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();plan=preview(c,doc,data,include_reading=reading)
        note(c,doc)
        response=c.get(plan['download_url']);assert response.status_code==(409 if reading else 200),response.text[:300]
        assert not list(app.state.store.exports.iterdir())
        assert c.get(preview(c,doc,data,include_reading=reading)['download_url']).status_code==200


@pytest.mark.parametrize('kind',['source','dataset','analysis','chart'])
def test_changed_material_cannot_be_exported(tmp_path,kind):
    with workspace(tmp_path) as (c,app,doc,_):
        data,job,chart=prepare(c,app,doc);plan=preview(c,doc,data,analysis_id=job['id'],chart_id=chart['id'])
        if kind=='source':(app.state.store.files/(doc['id']+'.pdf')).write_bytes(b'changed')
        if kind=='dataset':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        if kind=='analysis':app.state.analysis.file(doc['id'],job['id'],'chart.svg')[0].write_bytes(b'changed')
        if kind=='chart':
            with app.state.store.connection() as db:db.execute("UPDATE charts SET data_bytes=? WHERE id=?",(b'{}',chart['id']))
        assert c.get(plan['download_url']).status_code==409
        assert not list(app.state.store.exports.iterdir())


def test_deleted_notes_and_annotations_are_excluded_and_changes_invalidate(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();kept=note(c,doc);removed=note(c,doc,'Delete synthetic note')
        c.request('DELETE',f"/api/v1/documents/{doc['id']}/notes/{removed['id']}",json={'request_id':str(uuid4()),'expected_revision':1})
        source,original,url=make_source(c,app,doc);response,_=annotate(c,source,url);annotation=response.json()
        plan=preview(c,doc,data);assert plan['reading']['notes']==1 and plan['reading']['annotations']==1
        mutate(c,source,url,annotation,'delete')
        assert c.get(plan['download_url']).status_code==409
        fresh=preview(c,doc,data);archive=verified(c.get(fresh['download_url']))
        exported=json.loads(archive.read('reading/notes.json'))
        assert [n['id'] for n in exported['notes']]==[kept['id']] and fresh['reading']['annotations']==0


def test_cross_document_and_incomplete_result_scopes_fail(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();queued=c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(data)).json()
        assert c.post(prefix(doc)+'/preview',json=spec(data,analysis_id=queued['id'])).status_code==409
        other=c.post('/api/v1/documents',files={'file':('other.pdf',make_pdf(3),'application/pdf')}).json()
        assert c.post(prefix(other)+'/preview',json=spec(data)).status_code==404
        plan=preview(c,doc,data)
        assert c.get(plan['download_url'].replace(doc['id'],other['id'])).status_code==409
        assert not list(app.state.store.exports.iterdir())


@pytest.mark.parametrize('token',['!','a','e30','x'*2049,'eyJ2ZXJzaW9uIjoyfQ','../file','a=b'])
def test_invalid_download_token_fails_without_files(tmp_path,token):
    with workspace(tmp_path) as (c,app,doc,_):
        response=c.get(prefix(doc)+'/download',params={'token':token})
        assert response.status_code==422,response.text
        assert not list(app.state.store.exports.iterdir())


def test_change_during_composition_removes_all_temporary_files(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data,job,graph=prepare(c,app,doc);plan=preview(c,doc,data,analysis_id=job['id'],chart_id=graph['id'])
        original=app.state.records.component;changed=False
        def mutate_after_copy(*args):
            nonlocal changed
            original(*args)
            if not changed:note(c,doc,'Concurrent note while exporting');changed=True
        monkeypatch.setattr(app.state.records,'component',mutate_after_copy)
        response=c.get(plan['download_url']);assert response.status_code==409 and response.json()['detail']['code']=='record_scope_changed'
        assert not list(app.state.store.exports.iterdir())


def test_capacity_size_and_permission_failures_leave_no_partial_record(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();plan=preview(c,doc,data,include_reading=False)
        app.state.records.capacity.acquire();app.state.records.capacity.acquire()
        assert c.get(plan['download_url']).status_code==429
        app.state.records.capacity.release();app.state.records.capacity.release()
        monkeypatch.setattr('research_workbench.reading_export.MAX_EXPORT_BYTES',1)
        assert c.get(plan['download_url']).status_code==413 and not list(app.state.store.exports.iterdir())
        monkeypatch.undo()
        def denied(*args,**kwargs):raise PermissionError('synthetic denied path')
        monkeypatch.setattr('research_workbench.research_records.tempfile.NamedTemporaryFile',denied)
        response=c.get(plan['download_url']);assert response.status_code==503 and 'denied path' not in response.text
        assert not list(app.state.store.exports.iterdir())
        monkeypatch.undo();assert c.get(plan['download_url']).status_code==200


def test_disconnect_cleans_actual_generated_record(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();plan=preview(c,doc,data)
        path,name=app.state.records.download(doc['id'],plan['download_url'].split('token=')[1])
        response=ExportResponse(path,filename=name)
        async def send(message):raise OSError('synthetic disconnected client')
        async def receive():return {'type':'http.disconnect'}
        with pytest.raises(OSError):asyncio.run(response({'type':'http','method':'GET','headers':[]},receive,send))
        assert not path.exists() and not list(app.state.store.exports.iterdir())


def test_excluded_corrupt_image_does_not_block_options_or_data_export(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();source,original,url=make_source(c,app,doc)
        annotate(c,source,url)
        app.state.images.path(doc['id'],original['id']).write_bytes(b'changed image')
        response=c.get(prefix(doc)+'/options',params={'dataset_id':data['id'],'dataset_sha256':data['sha256']})
        assert response.status_code==200 and response.json()['reading']['annotations']==1
        plan=preview(c,doc,data,include_reading=False)
        assert c.get(plan['download_url']).status_code==200
        assert c.post(prefix(doc)+'/preview',json=spec(data)).status_code==409


def test_expanded_limit_includes_manifest_at_exact_boundary(tmp_path,monkeypatch):
    import zipfile
    with workspace(tmp_path) as (c,app,doc,_):
        monkeypatch.setattr('research_workbench.research_records.timestamp',lambda:'2026-11-01T00:00:00+00:00')
        data=upload(c,doc).json();plan=preview(c,doc,data,include_reading=False)
        first=c.get(plan['download_url'])
        with zipfile.ZipFile(io.BytesIO(first.content)) as archive:expanded=sum(i.file_size for i in archive.infolist())
        monkeypatch.setattr('research_workbench.reading_export.MAX_EXPORT_BYTES',expanded)
        assert c.get(plan['download_url']).status_code==200
        monkeypatch.setattr('research_workbench.reading_export.MAX_EXPORT_BYTES',expanded-1)
        assert c.get(plan['download_url']).status_code==413 and not list(app.state.store.exports.iterdir())
