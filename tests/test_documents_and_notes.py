import hashlib
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from research_workbench.main import create_app

from conftest import make_pdf


def payload(**changes):
    return dict(request_id=str(uuid4()), page=1, rect=[0.1, 0.2, 0.6, 0.4],
                text='A source-linked note', **changes)


def test_original_bytes_and_metadata(client, pdf, document):
    assert document['page_count'] == 2
    assert document['sha256'] == hashlib.sha256(pdf).hexdigest()
    assert document['byte_size'] == len(pdf)
    assert client.get(f"/api/v1/documents/{document['id']}/file").content == pdf
    assert client.get('/api/v1/documents').json()['items'] == [document]
    assert client.get(f"/api/v1/documents/{document['id']}").json() == document


def test_page_region_notes_and_idempotent_retries(client, document):
    url = f"/api/v1/documents/{document['id']}/notes"
    region = payload()
    first = client.post(url, json=region)
    repeated = client.post(url, json=region)
    assert first.status_code == 201 and repeated.status_code == 200
    assert first.json() == repeated.json()
    assert first.json()['id'] == region['request_id']
    assert first.json()['rect'] == region['rect']
    page_note = payload()
    page_note.update(page=2, rect=None, text='  Chinese 中文 and <b>plain text</b>  ')
    result = client.post(url, json=page_note)
    assert result.status_code == 201
    assert result.json()['rect'] is None and result.json()['page'] == 2
    assert result.json()['text'] == page_note['text'].strip()
    assert len(client.get(url).json()['items']) == 2
    region['text'] = 'different text'
    assert client.post(url, json=region).status_code == 409


@pytest.mark.parametrize('field,value', [
    ('page', 0), ('page', -1), ('page', 3), ('page', 201), ('page', 1.2), ('page', True),
    ('text', ''), ('text', '  \n\t '), ('text', 'x' * 10001), ('text', '\x00'),
    ('rect', [-0.01, 0.1, 0.5, 0.4]), ('rect', [0, 0, 1.01, 1]),
    ('rect', [0.5, 0.1, 0.2, 0.4]), ('rect', [0, 0.5, 1, 0.5]),
    ('rect', [0, 0, 1]), ('rect', ['0', 0, 1, 1]), ('rect', [False, 0, 1, 1]),
    ('request_id', 'invalid'), ('unexpected', True),
])
def test_invalid_note_rejected_without_write(client, document, field, value):
    note = payload()
    note[field] = value
    url = f"/api/v1/documents/{document['id']}/notes"
    assert client.post(url, json=note).status_code == 422
    assert client.get(url).json()['items'] == []


def test_full_page_edges_and_maximum_text(client, document):
    note = payload()
    note.update(page=2, rect=[0, 0, 1, 1], text='中' * 10000)
    response = client.post(f"/api/v1/documents/{document['id']}/notes", json=note)
    assert response.status_code == 201
    assert response.json()['rect'] == [0, 0, 1, 1]
    assert response.json()['text'] == note['text']


def test_nonfinite_rect_rejected(client, document):
    raw = '{"request_id":"%s","page":1,"text":"x","rect":[0,0,NaN,1]}' % uuid4()
    response = client.post(f"/api/v1/documents/{document['id']}/notes", content=raw,
                           headers={'Content-Type': 'application/json'})
    assert response.status_code == 422


@pytest.mark.parametrize('suffix', ['', '/notes', '/file'])
def test_missing_document(client, suffix):
    assert client.get(f'/api/v1/documents/{uuid4()}{suffix}').status_code == 404


def test_missing_and_invalid_document_on_save(client):
    assert client.post(f'/api/v1/documents/{uuid4()}/notes', json=payload()).status_code == 404
    assert client.post('/api/v1/documents/invalid/notes', json=payload()).status_code == 422


def test_request_id_cannot_cross_documents(client, document, pdf):
    second = client.post('/api/v1/documents', files={'file': ('second.pdf', pdf)}).json()
    note = payload()
    assert client.post(f"/api/v1/documents/{document['id']}/notes", json=note).status_code == 201
    assert client.post(f"/api/v1/documents/{second['id']}/notes", json=note).status_code == 409
    assert client.get(f"/api/v1/documents/{second['id']}/notes").json()['items'] == []


def test_reopen_application_keeps_documents_and_notes(client, app, document, pdf):
    url = f"/api/v1/documents/{document['id']}/notes"
    saved = client.post(url, json=payload()).json()
    reopened = create_app(app.state.store.root)
    with TestClient(reopened, base_url='http://127.0.0.1', client=('127.0.0.1', 48001)) as fresh:
        assert fresh.get('/api/v1/documents').json()['items'] == [document]
        assert fresh.get(url).json()['items'] == [saved]
        assert fresh.get(f"/api/v1/documents/{document['id']}/file").content == pdf


@pytest.mark.parametrize('content,code', [
    (b'', 'invalid_pdf'), (b'not a PDF', 'invalid_pdf'), (b'%PDF-1.7\ntruncated', 'invalid_pdf'),
    (make_pdf(0), 'invalid_pdf'), (make_pdf(1, True), 'encrypted_pdf'), (make_pdf(201), 'page_limit')])
def test_invalid_pdf_leaves_no_record_or_file(client, app, content, code):
    response = client.post('/api/v1/documents', files={'file': ('input.pdf', content)})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == code
    assert client.get('/api/v1/documents').json()['items'] == []
    assert list(app.state.store.files.iterdir()) == []
    assert list(app.state.store.incoming.iterdir()) == []


def test_filename_is_a_label_not_a_path(client, pdf):
    response = client.post('/api/v1/documents', files={'file': ('../../private/data.pdf', pdf)})
    assert response.status_code == 201
    assert response.json()['original_filename'] == 'data.pdf'


def test_document_commit_failure_cleans_uploaded_file(client, app, pdf, monkeypatch):
    def fail(record):
        raise PermissionError('private/location must not leak')
    monkeypatch.setattr(app.state.store, 'add_document', fail)
    response = client.post('/api/v1/documents', files={'file': ('input.pdf', pdf)})
    assert response.status_code == 503
    assert 'private/location' not in response.text
    assert client.get('/api/v1/documents').json()['items'] == []
    assert list(app.state.store.files.iterdir()) == []
    assert list(app.state.store.incoming.iterdir()) == []


def test_note_storage_failure_reports_no_success(client, app, document, monkeypatch):
    def fail(*args):
        raise sqlite3.OperationalError('disk unavailable')
    monkeypatch.setattr(app.state.store, 'save_note', fail)
    url = f"/api/v1/documents/{document['id']}/notes"
    assert client.post(url, json=payload()).status_code == 503
    assert client.get(url).json()['items'] == []


def test_missing_original_reports_conflict(client, app, document):
    (app.state.store.files / f"{document['id']}.pdf").unlink()
    response = client.get(f"/api/v1/documents/{document['id']}/file")
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'file_missing'
