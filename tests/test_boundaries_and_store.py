from concurrent.futures import ThreadPoolExecutor
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from research_workbench.models import MAX_FILE_BYTES, NoteCreate
from research_workbench.main import import_document
from starlette.datastructures import UploadFile
import io


@pytest.mark.parametrize('headers', [
    {'Host': 'external.example'}, {'Origin': 'https://external.example'},
    {'Origin': 'http://127.0.0.1.evil.example'}, {'Origin': 'null'},
    {'Sec-Fetch-Site': 'cross-site'}, {'Origin': 'http://127.0.0.1:9999'}])
def test_nonlocal_hosts_and_origins_rejected(client, headers):
    assert client.get('/api/v1/documents', headers=headers).status_code == 403


def test_remote_client_cannot_spoof_loopback(app):
    with TestClient(app, base_url='http://127.0.0.1', client=('192.0.2.1', 44)) as remote:
        assert remote.get('/api/v1/health', headers={'X-Forwarded-For': '127.0.0.1'}).status_code == 403


def test_same_origin_and_command_line_access(client):
    assert client.get('/api/v1/health').status_code == 200
    result = client.get('/api/v1/health', headers={'Origin': 'http://127.0.0.1'})
    assert result.status_code == 200
    assert result.headers['X-Content-Type-Options'] == 'nosniff'
    assert result.headers['Cross-Origin-Resource-Policy'] == 'same-origin'


def test_declared_oversized_body_rejected_before_parsing(client):
    response = client.post('/api/v1/documents', content=b'x', headers={'Content-Length': str(MAX_FILE_BYTES + 2 * 1024 * 1024)})
    assert response.status_code == 413


def test_chunked_upload_is_bounded(client, app):
    def body():
        yield b'--b\r\nContent-Disposition: form-data; name="file"; filename="input.pdf"\r\nContent-Type: application/pdf\r\n\r\n'
        for _ in range(22):
            yield b'x' * 1024 * 1024
        yield b'\r\n--b--\r\n'
    response = client.post('/api/v1/documents', content=body(), headers={'Content-Type': 'multipart/form-data; boundary=b'})
    assert response.status_code == 413, response.text
    assert list(app.state.store.files.iterdir()) == []


def test_actual_file_size_limit_and_exact_boundary(app):
    upload = UploadFile(io.BytesIO(b'x' * MAX_FILE_BYTES), filename='boundary.pdf')
    record = import_document(app.state.store, lambda path: 1, upload)
    assert record['byte_size'] == MAX_FILE_BYTES
    with pytest.raises(Exception) as caught:
        import_document(app.state.store, lambda path: 1,
                        UploadFile(io.BytesIO(b'x' * (MAX_FILE_BYTES + 1)), filename='too-large.pdf'))
    assert caught.value.code == 'file_too_large'
    assert len(app.state.store.list_documents()) == 1


def test_database_constraints_protect_notes(app, document):
    store = app.state.store
    cases = [(str(uuid4()), 1, '[0,0,1,1]', 'note'),
             (document['id'], 3, None, 'note'),
             (document['id'], 1, '[0.8,0,0.2,1]', 'note'),
             (document['id'], 1, '[null,0,1,1]', 'note'),
             (document['id'], 1, '["0",0,1,1]', 'note'),
             (document['id'], 1, 'not JSON', 'note'),
             (document['id'], 1, None, '')]
    for document_id, page, rect, text in cases:
        with pytest.raises(sqlite3.IntegrityError), store.connection() as connection:
            connection.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',
                               (str(uuid4()), document_id, page, rect, text, 'test'))
    assert store.list_notes(document['id']) == []


def test_concurrent_duplicate_saves_create_one_note(app, document):
    note = NoteCreate(request_id=uuid4(), page=1, rect=None, text='same operation')
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: app.state.store.save_note(document['id'], note), range(12)))
    assert sum(created for _, created in results) == 1
    assert len({result['id'] for result, _ in results}) == 1
    assert len(app.state.store.list_notes(document['id'])) == 1


def test_cannot_write_upload_when_storage_denies_access(client, app, pdf, monkeypatch):
    def denied(*args, **kwargs):
        raise PermissionError('secret path')
    monkeypatch.setattr('research_workbench.main.tempfile.NamedTemporaryFile', denied)
    response = client.post('/api/v1/documents', files={'file': ('input.pdf', pdf)})
    assert response.status_code == 503 and 'secret path' not in response.text
    assert app.state.store.list_documents() == []
