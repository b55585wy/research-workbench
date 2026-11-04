from uuid import uuid4
import sqlite3
import pytest

from research_workbench.library_lifecycle import PaperTrash
from research_workbench.models import WorkspaceError
from research_workbench.store import Store, timestamp
from test_excerpts import add_region, excerpt_url
from test_translation_runs import add_document

RUN_TABLES = ('translation_run_operations', 'translation_run_pages',
              'translation_run_jobs', 'translation_runs')


def metadata(client, document):
    response = client.get(f"/api/v1/documents/{document['id']}/metadata")
    assert response.status_code == 200
    return response.json()


def action(client, document, kind='trash', payload=None):
    payload = payload or {'request_id': str(uuid4()), 'expected_revision': metadata(client, document)['revision']}
    path = f"/api/v1/documents/{document['id']}" + ('/restore' if kind == 'restore' else '')
    return client.request('DELETE' if kind == 'trash' else 'POST', path, json=payload)


def test_trash_restore_preserves_identity_pdf_notes_images_and_search(client, app, document):
    note = add_region(client, document)
    image = client.post(excerpt_url(document, note)).json()
    pdf_path = app.state.store.files / f"{document['id']}.pdf"
    image_path = app.state.store.excerpts / f"{note['id']}.png"
    original = pdf_path.read_bytes(), image_path.read_bytes()
    deleted = action(client, document)
    assert deleted.status_code == 200
    value = deleted.json()
    assert value['id'] == document['id'] and value['deleted_at'] and value['revision'] == 2
    assert client.get('/api/v1/documents').json()['items'] == []
    assert client.get('/api/v1/documents/trash').json()['items'] == [value]
    for suffix in ('', '/file', '/metadata', '/notes', '/excerpts', '/export'):
        result = client.get(f"/api/v1/documents/{document['id']}" + suffix)
        assert result.status_code == 410 and result.json()['detail']['code'] == 'document_trashed'
    search = client.get('/api/v1/search', params={'q': 'figure'}).json()
    assert search['documents'] == search['notes'] == []
    assert (pdf_path.read_bytes(), image_path.read_bytes()) == original
    restored = action(client, document, 'restore', {'request_id': str(uuid4()), 'expected_revision': 2})
    assert restored.status_code == 200 and restored.json()['deleted_at'] is None
    assert restored.json()['revision'] == 3
    assert client.get(f"/api/v1/documents/{document['id']}").json() == document
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items'] == [note]
    assert client.get(image['image_url']).status_code == 200
    assert client.get('/api/v1/documents/trash').json()['items'] == []


def test_exact_uncertain_retries_and_superseded_requests(client, document):
    payload = {'request_id': str(uuid4()), 'expected_revision': 1}
    first = action(client, document, payload=payload)
    assert action(client, document, payload=payload).json() == first.json()
    assert action(client, document, payload={**payload, 'expected_revision': 2}).status_code == 409
    restore = {'request_id': str(uuid4()), 'expected_revision': 2}
    restored = action(client, document, 'restore', restore)
    assert action(client, document, 'restore', restore).json() == restored.json()
    assert action(client, document, payload=payload).status_code == 409


def test_rename_conflict_and_noop_restore(client, document):
    root = f"/api/v1/documents/{document['id']}"
    renamed = client.patch(root + '/metadata', json={'request_id': str(uuid4()), 'expected_revision': 1, 'title': 'Renamed 中文'})
    assert renamed.status_code == 200
    assert action(client, document, payload={'request_id': str(uuid4()), 'expected_revision': 1}).status_code == 409
    restored = action(client, document, 'restore', {'request_id': str(uuid4()), 'expected_revision': 2})
    assert restored.status_code == 200 and restored.json()['revision'] == 2
    assert restored.json()['title'] == 'Renamed 中文'
    assert restored.json()['original_filename'] == document['original_filename']


def test_duplicate_upload_does_not_resurrect_trashed_paper(client, document, pdf):
    assert action(client, document).status_code == 200
    uploaded = client.post('/api/v1/documents', files={'file': ('same.pdf', pdf)}, data={'deduplicate': 'true'})
    assert uploaded.status_code == 201 and uploaded.json()['id'] != document['id']
    assert len(client.get('/api/v1/documents/trash').json()['items']) == 1


@pytest.mark.parametrize('kind', ['analysis', 'agent'])
def test_active_work_blocks_paper_removal(tmp_path, kind):
    from analysis_support import workspace, upload, payload
    from agent_support import submit
    with workspace(tmp_path) as (client, app, doc, _):
        if kind == 'analysis':
            data = upload(client, doc).json()
            result = client.post(f"/api/v1/documents/{doc['id']}/analyses", json=payload(data))
        else:
            result = submit(client, doc)
        assert result.status_code == (201 if kind == 'analysis' else 202), result.text
        blocked = action(client, doc)
        assert blocked.status_code == 409 and blocked.json()['detail']['code'] == 'document_busy'
        assert client.get(f"/api/v1/documents/{doc['id']}").status_code == 200


def test_study_link_blocks_removal_until_explicit_unlink(client, document):
    study = client.post('/api/v1/studies', json={'request_id': str(uuid4()), 'name': 'Scope', 'question': 'Why?'}).json()
    link = f"/api/v1/studies/{study['id']}/papers/{document['id']}"
    response = client.post(f"/api/v1/studies/{study['id']}/papers", json={'document_id': document['id'], 'sha256': document['sha256']})
    assert response.status_code in (200, 201), response.text
    result = action(client, document)
    assert result.status_code == 409 and result.json()['detail']['code'] == 'document_in_use'
    assert client.delete(link, params={'sha256': document['sha256']}).status_code == 200
    assert action(client, document).status_code == 200
    rejected = action(client, study, payload={'request_id': str(uuid4()), 'expected_revision': 1})
    assert rejected.status_code == 409


@pytest.mark.parametrize('payload', [None, {}, {'request_id': 'bad', 'expected_revision': 1},
    {'request_id': str(uuid4()), 'expected_revision': 0}, {'request_id': str(uuid4()), 'expected_revision': True},
    {'request_id': str(uuid4()), 'expected_revision': 1, 'extra': True}])
def test_strict_mutation_inputs(client, document, payload):
    result = client.request('DELETE', f"/api/v1/documents/{document['id']}", json=payload)
    assert result.status_code == 422
    assert len(client.get('/api/v1/documents').json()['items']) == 1


def insert_translation_run(store, document, status='running', stage='parsing'):
    identifier = str(uuid4())
    with store.connection() as db:
        stamp = timestamp()
        db.execute(
            'INSERT INTO translation_runs (id,document_id,source_sha256,pages_json,'
            'target_language,request_hash,status,stage,revision,total_pages,'
            'processed_pages,completed_pages,reused_pages,active_job_id,parser_id,'
            'parser_version,prompt_version,result_schema_version,model_name,'
            'model_fingerprint,error_json,created_at,updated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (identifier, document['id'], document['sha256'], '[1]', 'zh', 'a' * 64,
             status, stage, 1, 1, 0, 0, 0, None, 'mineru-flash-txt', '4.1.5',
             'translate-blocks-v1', 1, 'synthetic-model', 'b' * 16, None,
             stamp, stamp))
    return identifier


def test_active_translation_run_blocks_removal_and_paused_purge_cleans_relations(
        tmp_path):
    from research_workbench.document_purge import PaperPurgeMutation
    from research_workbench.models import NoteMutation

    store = Store(tmp_path / 'workspace')
    document = add_document(store, pages=1)
    identifier = insert_translation_run(store, document)

    with pytest.raises(WorkspaceError) as error:
        store.paper_trash.mutate(
            document['id'], 'trash',
            NoteMutation(request_id=uuid4(), expected_revision=1))
    assert error.value.code == 'document_busy' and error.value.status == 409

    with store.connection() as db:
        db.execute("UPDATE translation_runs SET status='paused',stage='finished' "
                   "WHERE id=?", (identifier,))
    trashed = store.paper_trash.mutate(
        document['id'], 'trash',
        NoteMutation(request_id=uuid4(), expected_revision=1))
    assert trashed['deleted_at'] is not None and trashed['revision'] == 2

    preview = store.paper_purge.preview(document['id'])
    purged = store.paper_purge.purge(document['id'], PaperPurgeMutation(
        request_id=uuid4(), expected_revision=preview['expected_revision'],
        preview_sha256=preview['preview_sha256']))
    assert purged == {'id': document['id'], 'purged': True, 'files_removed': True}

    with store.connection() as db:
        for table in RUN_TABLES:
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM documents WHERE id=?',
                          (document['id'],)).fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_missing_parent_run_table_legacy_is_idle_but_schema27_is_busy(tmp_path):
    store = Store(tmp_path / 'workspace')
    document = add_document(store, pages=1)
    with store.connection() as db:
        for table in RUN_TABLES:
            db.execute(f'DROP TABLE {table}')
        db.execute('PRAGMA user_version=26')
    with store.connection() as db:
        PaperTrash.ensure_idle(db, document['id'])
        db.execute('PRAGMA user_version=27')
    with store.connection() as db:
        with pytest.raises(WorkspaceError) as error:
            PaperTrash.ensure_idle(db, document['id'])
    assert error.value.code == 'document_busy'


def test_schema13_upgrade_preserves_rows_and_future_schema_refused(tmp_path):
    store = Store(tmp_path / 'data')
    with store.connection() as db:
        old = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} - {'document_trash', 'purged_notes'}
        before = {name: db.execute(f'SELECT * FROM {name}').fetchall() for name in old}
        db.execute('DROP TABLE purged_notes'); db.execute('DROP TABLE document_trash')
        db.execute('PRAGMA user_version=13')
    Store(store.root)
    with store.connection() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 15
        assert all(db.execute(f'SELECT * FROM {name}').fetchall() == rows for name, rows in before.items())
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        db.execute('PRAGMA user_version=16')
    with pytest.raises(RuntimeError, match='newer application'):
        Store(store.root)
