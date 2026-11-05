"""Focused checks for the read-only reader-source cache probe."""
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from research_workbench.main import create_app
from research_workbench.reader_source_api import cache_scope
from research_workbench.store import timestamp
from research_workbench.studies import identity


def source_url(document):
    return f"/api/v1/documents/{document['id']}/reader-source"


def study_identifier(store):
    identifier = str(uuid4())
    title, question = 'Synthetic study', 'How do the recorded values differ?'
    with store.connection() as db:
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',
                   (identifier, title, None, None, None, None, timestamp()))
        db.execute('INSERT INTO studies VALUES (?,?,?,?)',
                   (identifier, question, identity(identifier, title, question), timestamp()))
    return identifier


def test_probe_returns_an_opaque_scope_and_the_existing_document_dto(client, app, document):
    response = client.get(source_url(document))
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {'cache_scope', 'document'}
    assert body['document'] == client.get(f"/api/v1/documents/{document['id']}").json()
    scope = body['cache_scope']
    assert len(scope) == 64 and scope == scope.lower()
    assert set(scope) <= set('0123456789abcdef')
    assert scope == cache_scope(app.state.store.root)
    assert response.headers['cache-control'] == 'no-store'
    serialized = response.text
    assert str(app.state.store.root) not in serialized
    assert str(app.state.store.files) not in serialized
    assert 'workspace.sqlite3' not in serialized


def test_scope_is_stable_per_store_and_isolated_between_stores(tmp_path, pdf):
    scopes = []
    for name in ('first', 'second'):
        options = {'agent_autostart': False, 'analysis_autostart': False,
                   'translation_autostart': False}
        app = create_app(tmp_path / name, **options)
        with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 48000)) as client:
            document = client.post('/api/v1/documents',
                                   files={'file': ('one.pdf', pdf, 'application/pdf')}).json()
            scopes.append(client.get(source_url(document)).json()['cache_scope'])
        reopened = create_app(tmp_path / name, **options)
        with TestClient(reopened, base_url='http://127.0.0.1', client=('127.0.0.1', 48000)) as client:
            assert client.get(source_url(document)).json()['cache_scope'] == scopes[-1]
    assert scopes[0] != scopes[1]


def test_unknown_study_and_trashed_documents_are_rejected(client, app, document):
    missing = client.get(f'/api/v1/documents/{uuid4()}/reader-source')
    assert missing.status_code == 404
    study = study_identifier(app.state.store)
    rejected_study = client.get(f'/api/v1/documents/{study}/reader-source')
    assert rejected_study.status_code == 409
    assert rejected_study.json()['detail']['code'] == 'source_has_no_pdf'
    store = app.state.store
    with store.connection() as db:
        db.execute('INSERT INTO document_trash VALUES (?,?)', (document['id'], timestamp()))
    trashed = client.get(source_url(document))
    assert trashed.status_code == 410
    assert trashed.json()['detail']['code'] == 'document_trashed'
    with store.connection() as db:
        db.execute('DELETE FROM document_trash WHERE document_id=?', (document['id'],))
    assert client.get(source_url(document)).status_code == 200


def test_missing_non_regular_and_size_mismatched_sources_are_rejected(client, app, document):
    store = app.state.store
    path = store.files / f"{document['id']}.pdf"
    original = path.read_bytes()
    path.unlink()
    missing = client.get(source_url(document))
    assert missing.status_code == 409 and missing.json()['detail']['code'] == 'file_missing'
    path.mkdir()
    directory = client.get(source_url(document))
    assert directory.status_code == 409 and directory.json()['detail']['code'] == 'file_missing'
    path.rmdir()
    path.write_bytes(original + b'\n')
    changed = client.get(source_url(document))
    assert changed.status_code == 409 and changed.json()['detail']['code'] == 'source_changed'


def test_probe_does_not_read_or_hash_the_pdf_bytes(client, document, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('reader-source must not read PDF bytes')
    monkeypatch.setattr(Path, 'open', forbidden)
    monkeypatch.setattr(Path, 'read_bytes', forbidden)
    response = client.get(source_url(document))
    assert response.status_code == 200, response.text


def test_probe_writes_no_rows_or_exports(client, app, document):
    store = app.state.store
    tables = ('documents', 'notes', 'note_states', 'note_operations', 'note_mastery',
              'excerpts', 'agent_tasks', 'translation_jobs')
    with store.connection() as db:
        before = {name: db.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]
                  for name in tables}
    exports = sorted(path.name for path in store.exports.iterdir())
    assert client.get(source_url(document)).status_code == 200
    with store.connection() as db:
        after = {name: db.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]
                 for name in tables}
    assert before == after
    assert sorted(path.name for path in store.exports.iterdir()) == exports
