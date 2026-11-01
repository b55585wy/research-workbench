import asyncio
import io
from uuid import uuid4

from pypdf import PdfReader
import pytest
from research_workbench.reading_export import ExportResponse
from test_note_lifecycle import mutate, state
from test_library_lifecycle import action as paper_action


def add_note(client, document, *, page=1, rect=None, text='SYNTHETIC note 注释', annotation=None):
    body = dict(request_id=str(uuid4()), page=page, rect=rect, text=text)
    if annotation:
        body['annotation'] = annotation
    response = client.post(f"/api/v1/documents/{document['id']}/notes", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def export_url(document):
    return f"/api/v1/documents/{document['id']}/export/annotated.pdf"


def markup(client, document, kind='highlight', color='yellow', page=1):
    rects = [[.1, .1, .7, .15], [.1, .2, .7, .25]]
    return add_note(client, document, page=page, rect=[.1, .1, .7, .25], text='SYNTHETIC quotation 原文',
                    annotation=dict(kind=kind, color=color, quote='SYNTHETIC quotation 原文', rects=rects))


def annotations(response):
    assert response.status_code == 200, response.text if response.status_code != 200 else ''
    assert response.headers['content-type'] == 'application/pdf'
    assert response.headers['cache-control'] == 'no-store'
    assert 'attachment;' in response.headers['content-disposition']
    reader = PdfReader(io.BytesIO(response.content))
    return reader, [ref.get_object() for page in reader.pages for ref in page.get('/Annots', [])]


def test_real_worker_exports_all_saved_pdf_note_kinds_without_changing_source(client, app, document, pdf):
    markup(client, document)
    markup(client, document, kind='underline', color='blue', page=2)
    add_note(client, document, rect=[.2, .4, .5, .6], text='框选区域说明')
    add_note(client, document, page=2, text='整页说明 Unicode αβ')
    before = app.state.store.reading_snapshot(document['id'])
    reader, items = annotations(client.get(export_url(document)))
    assert len(reader.pages) == 2
    assert [n['/Subtype'] for n in items] == ['/Highlight', '/Square', '/Underline', '/Text']
    assert len(items[0]['/QuadPoints']) == 16
    assert any(n['/Contents'] == '整页说明 Unicode αβ' for n in items)
    assert all(n['/F'] & 4 for n in items)
    assert app.state.store.reading_snapshot(document['id']) == before
    assert (app.state.store.files / (document['id']+'.pdf')).read_bytes() == pdf
    assert list(app.state.store.incoming.iterdir()) == []
    assert list(app.state.store.exports.iterdir()) == []


def test_edited_comment_and_style_export_keeps_original_quotation(client, document):
    note = markup(client, document)
    response = client.patch(f"/api/v1/documents/{document['id']}/notes/{note['id']}", json={
        'request_id': str(uuid4()), 'expected_revision': 1, 'text': '当前个人说明',
        'annotation_style': {'kind': 'underline', 'color': 'pink'}})
    assert response.status_code == 200, response.text
    _, items = annotations(client.get(export_url(document)))
    assert items[0]['/Subtype'] == '/Underline'
    assert 'SYNTHETIC quotation 原文' in items[0]['/Contents']
    assert '当前个人说明' in items[0]['/Contents']


def test_empty_export_is_honest_and_old_zip_still_available(client, document, app):
    response = client.get(export_url(document))
    assert response.status_code == 409 and response.json()['detail']['code'] == 'pdf_export_empty'
    assert client.get(f"/api/v1/documents/{document['id']}/export").status_code == 200
    assert list(app.state.store.exports.iterdir()) == []


def test_active_saved_lifecycle_excludes_deleted_and_restores_same_annotation(client, document):
    note = markup(client, document)
    endpoint = f"/api/v1/documents/{document['id']}/notes/{note['id']}"
    # The public lifecycle operation uses a request body through request().
    response = client.request('DELETE', endpoint, json={'request_id': str(uuid4()), 'expected_revision': 1})
    assert response.status_code == 200, response.text
    assert client.get(export_url(document)).json()['detail']['code'] == 'pdf_export_empty'
    restored = mutate(client, document, note, state(client, document, note), 'restore')
    assert restored.status_code == 200, restored.text
    assert len(annotations(client.get(export_url(document)))[1]) == 1
    deleted = mutate(client, document, note, restored.json(), 'delete')
    assert deleted.status_code == 200
    purged = client.post(endpoint+'/purge', json={'request_id': str(uuid4()), 'expected_revision': deleted.json()['revision']})
    assert purged.status_code == 200
    assert client.get(export_url(document)).json()['detail']['code'] == 'pdf_export_empty'


def test_source_change_and_missing_source_never_leave_partial_output(client, document, app):
    add_note(client, document)
    source = app.state.store.files / (document['id']+'.pdf')
    source.write_bytes(b'changed')
    response = client.get(export_url(document))
    assert response.status_code == 409 and response.json()['detail']['code'] == 'source_changed'
    source.unlink()
    assert client.get(export_url(document)).json()['detail']['code'] == 'file_missing'
    assert list(app.state.store.incoming.iterdir()) == []
    assert list(app.state.store.exports.iterdir()) == []


@pytest.mark.parametrize('identifier,status', [('not-a-uuid', 422), (str(uuid4()), 404)])
def test_invalid_and_missing_paper_identity(client, identifier, status):
    assert client.get(f'/api/v1/documents/{identifier}/export/annotated.pdf').status_code == status


def test_trashed_paper_and_pdf_free_study_are_not_exported(client, document):
    add_note(client, document)
    assert paper_action(client, document).status_code == 200
    assert client.get(export_url(document)).status_code == 410
    created = client.post('/api/v1/studies', json={'request_id': str(uuid4()), 'name': 'Synthetic study', 'question': 'Synthetic research question'})
    assert created.status_code == 201, created.text
    response = client.get(export_url(created.json()))
    assert response.status_code == 409 and response.json()['detail']['code'] == 'source_has_no_pdf'


def test_snapshot_is_fixed_before_a_concurrent_note_edit(client, app, document):
    note = markup(client, document)
    original_worker = app.state.annotated_pdf.worker
    def edit_then_render(job):
        current = state(client, document, note)
        changed = mutate(client, document, note, current, text='LATER COMMENT MUST NOT MIX INTO SNAPSHOT')
        assert changed.status_code == 200
        return original_worker(job)
    app.state.annotated_pdf.worker = edit_then_render
    _, values = annotations(client.get(export_url(document)))
    assert values[0]['/Contents'] == 'SYNTHETIC quotation 原文'
    assert state(client, document, note)['text'] == 'LATER COMMENT MUST NOT MIX INTO SNAPSHOT'


def test_concurrent_source_change_or_paper_trash_rejects_generated_copy(client, app, document):
    add_note(client, document)
    original_worker = app.state.annotated_pdf.worker
    def trash_then_finish(job):
        result = original_worker(job)
        assert paper_action(client, document).status_code == 200
        return result
    app.state.annotated_pdf.worker = trash_then_finish
    assert client.get(export_url(document)).status_code == 410
    assert list(app.state.store.incoming.iterdir()) == [] and list(app.state.store.exports.iterdir()) == []


def test_disconnected_pdf_download_removes_only_derived_file(app, client, document, pdf):
    add_note(client, document)
    target, name = app.state.annotated_pdf.build(document['id'])
    assert target.parent == app.state.store.exports and target.suffix == '.pdf'
    response = ExportResponse(target, media_type='application/pdf', filename=name)
    async def receive():
        return {'type': 'http.disconnect'}
    async def send(message):
        if message['type'] == 'http.response.body':
            raise OSError('Synthetic disconnect')
    async def exercise():
        with pytest.raises(Exception):
            await response({'type': 'http', 'method': 'GET', 'headers': [],
                            'asgi': {'spec_version': '2.4'}, 'extensions': {}}, receive, send)
    asyncio.run(exercise())
    assert not target.exists()
    assert (app.state.store.files/(document['id']+'.pdf')).read_bytes() == pdf
