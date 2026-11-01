from pathlib import Path
from uuid import uuid4
import sqlite3
import pytest

from research_workbench.store import Store
from test_excerpts import add_region, excerpt_url
from test_note_lifecycle import mutate, state, note_url
from analysis_support import workspace
from image_annotation_support import make_source, create, mutate as mutate_annotation


def deletion(client, document, note):
    result = mutate(client, document, note, state(client, document, note), 'delete')
    assert result.status_code == 200
    return {'request_id': str(uuid4()), 'expected_revision': result.json()['revision']}


def purge(client, document, note, payload):
    return client.post(note_url(document, note) + '/purge', json=payload)


def test_purge_removes_all_note_content_and_excerpt_without_resurrection(client, app, document):
    request_id = str(uuid4())
    creation = {'request_id': request_id, 'page': 1, 'rect': [.1, .1, .8, .8], 'text': 'SECRET ORIGINAL',
                'rich_content': {'version': 1, 'ops': [{'insert': 'SECRET ORIGINAL', 'attributes': {'bold': True}}, {'insert': '\n'}]}}
    response = client.post(f"/api/v1/documents/{document['id']}/notes", json=creation)
    assert response.status_code == 201, response.text
    note = response.json()
    assert client.post(excerpt_url(document, note)).status_code == 201
    changed = mutate(client, document, note, state(client, document, note), text='SECRET CURRENT')
    assert changed.status_code == 200
    payload = deletion(client, document, note)
    path = app.state.store.excerpts / f"{note['id']}.png"
    assert path.is_file()
    result = purge(client, document, note, payload)
    assert result.status_code == 200 and result.json()['files_removed'] is True
    assert not path.exists()
    assert purge(client, document, note, payload).json() == result.json()
    assert client.get(note_url(document, note) + '/state').status_code == 410
    assert client.get(excerpt_url(document, note)).status_code == 410
    assert client.get(f"/api/v1/documents/{document['id']}/note-states").json()['items'] == []
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items'] == []
    assert client.post(note_url(document, note) + '/restore', json=payload).status_code == 410
    assert client.post(f"/api/v1/documents/{document['id']}/notes", json=creation).status_code == 410
    assert client.get('/api/v1/search', params={'q': 'SECRET'}).json()['notes'] == []
    with app.state.store.connection() as db:
        assert db.execute('SELECT text,rect FROM notes WHERE id=?', (note['id'],)).fetchone()[:] == ('[purged]', None)
        assert db.execute('SELECT current_text FROM note_states WHERE note_id=?', (note['id'],)).fetchone()[0] == '[purged]'
        assert db.execute('SELECT COUNT(*) FROM note_rich_content WHERE note_id=?', (note['id'],)).fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_active_stale_wrong_scope_unknown_and_reused_purge_requests(client, document, pdf):
    note = add_region(client, document)
    payload = {'request_id': str(uuid4()), 'expected_revision': 1}
    assert purge(client, document, note, payload).json()['detail']['code'] == 'note_not_deleted'
    ready = deletion(client, document, note)
    assert purge(client, document, note, payload).json()['detail']['code'] == 'revision_conflict'
    other = client.post('/api/v1/documents', files={'file': ('other.pdf', pdf)}).json()
    assert purge(client, other, note, ready).status_code == 404
    assert purge(client, document, {'id': str(uuid4())}, ready).status_code == 404
    assert purge(client, document, note, ready).status_code == 200
    assert purge(client, document, note, {**ready, 'expected_revision': 9}).json()['detail']['code'] == 'idempotency_conflict'
    assert purge(client, other, note, ready).status_code == 409


def test_file_permission_failure_is_pending_exact_retry_finishes(client, app, document, monkeypatch):
    note = add_region(client, document)
    assert client.post(excerpt_url(document, note)).status_code == 201
    payload = deletion(client, document, note)
    path = app.state.store.excerpts / f"{note['id']}.png"
    original = Path.unlink
    def denied(self, *args, **kwargs):
        if self == path:
            raise PermissionError('injected')
        return original(self, *args, **kwargs)
    with monkeypatch.context() as patch:
        patch.setattr(Path, 'unlink', denied)
        failed = purge(client, document, note, payload)
        assert failed.status_code == 503
        assert client.get(note_url(document, note) + '/state').status_code == 410
        assert path.is_file()
    assert purge(client, document, note, payload).status_code == 200
    assert not path.exists()


def test_restart_resumes_pending_file_cleanup(client, app, document, monkeypatch):
    note = add_region(client, document)
    client.post(excerpt_url(document, note))
    payload = deletion(client, document, note)
    original = app.state.store.note_purge.cleanup
    def interrupted(*args):
        raise RuntimeError('injected process interruption after database commit')
    with monkeypatch.context() as patch:
        patch.setattr(app.state.store.note_purge, 'cleanup', interrupted)
        with pytest.raises(RuntimeError, match='interruption'):
            purge(client, document, note, payload)
    assert (app.state.store.excerpts / f"{note['id']}.png").exists()
    Store(app.state.store.root)
    assert not (app.state.store.excerpts / f"{note['id']}.png").exists()
    assert original(document['id'], note['id'])['files_removed']


def test_transaction_failure_preserves_body_and_image(client, app, document):
    note = add_region(client, document)
    client.post(excerpt_url(document, note))
    payload = deletion(client, document, note)
    path = app.state.store.excerpts / f"{note['id']}.png"
    before = path.read_bytes()
    with app.state.store.connection() as db:
        db.execute("CREATE TRIGGER deny_purge BEFORE UPDATE ON notes BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    failed = purge(client, document, note, payload)
    assert failed.status_code == 503
    assert state(client, document, note)['text'] == note['text']
    assert path.read_bytes() == before
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM purged_notes').fetchone()[0] == 0


def test_purge_removes_excerpt_annotations_and_operation_content(tmp_path):
    with workspace(tmp_path) as (client, app, doc, _):
        source, note, url = make_source(client, app, doc, 'pdf_excerpt')
        response, _ = create(client, source, url)
        annotation = response.json()
        changed, _ = mutate_annotation(client, source, url, annotation, text='ANNOTATION SECRET')
        assert changed.status_code == 200
        assert purge(client, doc, note, deletion(client, doc, note)).status_code == 200
        with app.state.store.connection() as db:
            assert db.execute('SELECT COUNT(*) FROM image_annotations').fetchone()[0] == 0
            assert db.execute('SELECT COUNT(*) FROM image_annotation_operations').fetchone()[0] == 0
            assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_independent_uploaded_image_and_other_note_survive(tmp_path):
    with workspace(tmp_path) as (client, app, doc, _):
        source, image, _ = make_source(client, app, doc)
        note = add_region(client, doc)
        other = add_region(client, doc)
        with app.state.store.connection() as db:
            db.execute('INSERT INTO note_images VALUES (?,?)', (note['id'], image['id']))
            db.execute('INSERT INTO note_images VALUES (?,?)', (other['id'], image['id']))
        original = client.get(source['original_url']).content
        assert purge(client, doc, note, deletion(client, doc, note)).status_code == 200
        assert client.get(source['original_url']).content == original
        assert state(client, doc, other)['text'] == other['text']
        with app.state.store.connection() as db:
            assert db.execute('SELECT note_id FROM note_images').fetchall()[0][0] == other['id']


def test_completed_task_keeps_reference_and_truth_after_note_purge(tmp_path):
    from agent_support import confirm
    from task_support import begin, successful_analysis, chart_checkpoint, checkpoint, note_responses, state as task_state
    with workspace(tmp_path) as (client, app, doc, model):
        data, root = begin(client, app, doc, model)
        successful_analysis(client, app, doc, model, data, root)
        chart = chart_checkpoint(client, app, doc, model, data)
        assert confirm(client, doc, chart).status_code == 200
        app.state.agent.tasks.tick()
        task = task_state(client, doc, root)
        proposal = checkpoint(client, app, doc, model, note_responses(doc, task))
        assert confirm(client, doc, proposal).status_code == 200
        app.state.agent.tasks.tick()
        done = task_state(client, doc, root)
        assert done['status'] == 'completed'
        note = state(client, doc, {'id': done['note_id']})
        assert purge(client, doc, note, deletion(client, doc, note)).status_code == 200
        assert task_state(client, doc, root) == done
        with app.state.store.connection() as db:
            assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_concurrent_exact_retries_complete_one_purge(client, app, document):
    from concurrent.futures import ThreadPoolExecutor
    from research_workbench.models import NoteMutation
    note = add_region(client, document)
    client.post(excerpt_url(document, note))
    payload = NoteMutation(**deletion(client, document, note))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(app.state.store.note_purge.purge, document['id'], note['id'], payload) for _ in range(2)]
        results = [future.result() for future in futures]
    assert results[0] == results[1] and results[0]['files_removed']
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM purged_notes').fetchone()[0] == 1


@pytest.mark.parametrize('payload', [{}, {'request_id': 'bad', 'expected_revision': 2},
    {'request_id': str(uuid4()), 'expected_revision': 0}, {'request_id': str(uuid4()), 'expected_revision': True},
    {'request_id': str(uuid4()), 'expected_revision': 1, 'delete_all': True}])
def test_strict_purge_inputs_leave_data_untouched(client, document, payload):
    note = add_region(client, document)
    assert purge(client, document, note, payload).status_code == 422
    assert state(client, document, note)['text'] == note['text']
