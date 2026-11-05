"""Focused checks for independently self-reported learning mastery."""
import io
import json
import sqlite3
from uuid import uuid4
import zipfile

import pytest
from pydantic import ValidationError

from research_workbench.document_purge import PaperPurgeMutation
from research_workbench.library_lifecycle import now
from research_workbench.models import NoteUpdate
from research_workbench.store import Store, timestamp
from test_excerpts import add_region
from test_note_lifecycle import mutate, note_url, state


def rate(client, document, note, level):
    return mutate(client, document, note, state(client, document, note), mastery_level=level)


def test_fresh_store_is_schema28_with_an_empty_mastery_table(tmp_path):
    store = Store(tmp_path / 'workspace')
    with store.connection() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 28
        assert db.execute('SELECT COUNT(*) FROM note_mastery').fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_new_and_repeated_notes_default_to_unrated(client, app, document):
    note = add_region(client, document)
    current = state(client, document, note)
    assert current['mastery_level'] == 0
    assert current['review_status'] == 'unreviewed'
    creation = {'request_id': note['id'], 'page': note['page'], 'rect': note['rect'], 'text': note['text']}
    repeated = client.post(f"/api/v1/documents/{document['id']}/notes", json=creation)
    assert repeated.status_code == 200 and repeated.json()['text'] == note['text']
    assert state(client, document, note)['mastery_level'] == 0
    listed = client.get(f"/api/v1/documents/{document['id']}/note-states").json()['items']
    assert listed[0]['mastery_level'] == 0
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM note_mastery').fetchone()[0] == 0


@pytest.mark.parametrize('level', [0, 1, 5])
def test_set_mastery_persists_change_and_reopen(client, app, document, level):
    note = add_region(client, document)
    current = state(client, document, note)
    response = mutate(client, document, note, current, mastery_level=level)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['mastery_level'] == level
    assert body['revision'] == current['revision'] + (1 if level != current['mastery_level'] else 0)
    assert state(client, document, note) == body
    reopened = Store(app.state.store.root)
    assert reopened.lifecycle.get(document['id'], note['id']) == body


@pytest.mark.parametrize('value', [None, True, False, 1.5, '3', 6, -1])
def test_invalid_mastery_payload_never_changes_state(client, document, value):
    note = add_region(client, document)
    before = state(client, document, note)
    response = client.patch(note_url(document, note), json={
        'request_id': str(uuid4()), 'expected_revision': before['revision'],
        'mastery_level': value})
    assert response.status_code == 422, response.text
    assert state(client, document, note) == before


@pytest.mark.parametrize('value', [None, True, False, 1.5, '3', 6, -1])
def test_request_model_rejects_non_strict_mastery(value):
    with pytest.raises(ValidationError):
        NoteUpdate(request_id=uuid4(), expected_revision=1, mastery_level=value)


def test_database_constraint_and_foreign_key_bound_mastery_rows(client, app, document):
    note = add_region(client, document)
    with app.state.store.connection() as db:
        for value in (6, -1, 2.5):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute('INSERT INTO note_mastery VALUES (?,?,?)',
                           (note['id'], value, timestamp()))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute('INSERT INTO note_mastery VALUES (?,?,?)',
                       (str(uuid4()), 2, timestamp()))
        assert db.execute('SELECT COUNT(*) FROM note_mastery').fetchone()[0] == 0


def test_mastery_retry_stale_revision_and_reused_request(client, app, document):
    note = add_region(client, document)
    current = state(client, document, note)
    payload = {'request_id': str(uuid4()), 'expected_revision': current['revision'],
               'mastery_level': 4}
    first = client.patch(note_url(document, note), json=payload)
    repeat = client.patch(note_url(document, note), json=payload)
    assert first.status_code == repeat.status_code == 200
    assert first.json() == repeat.json() and first.json()['mastery_level'] == 4
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM note_operations').fetchone()[0] == 1
    changed = client.patch(note_url(document, note), json={**payload, 'mastery_level': 5})
    assert changed.json()['detail']['code'] == 'idempotency_conflict'
    stale = client.patch(note_url(document, note), json={
        'request_id': str(uuid4()), 'expected_revision': current['revision'],
        'mastery_level': 2})
    assert stale.json()['detail']['code'] == 'revision_conflict'
    assert state(client, document, note) == first.json()


def test_mastery_and_source_review_stay_independent(client, document):
    note = add_region(client, document)
    current = state(client, document, note)
    checked = mutate(client, document, note, current, review_status='source_checked').json()
    rated = mutate(client, document, note, checked, mastery_level=4).json()
    assert rated['mastery_level'] == 4 and rated['review_status'] == 'source_checked'
    assert rated['reviewed_at'] == checked['reviewed_at']
    edited = mutate(client, document, note, rated, text='Edited after rating').json()
    assert edited['mastery_level'] == 4
    assert edited['review_status'] == 'unreviewed' and edited['reviewed_at'] is None
    rereviewed = mutate(client, document, note, edited, review_status='source_checked').json()
    assert rereviewed['mastery_level'] == 4 and rereviewed['review_status'] == 'source_checked'
    cleared = mutate(client, document, note, rereviewed, mastery_level=0).json()
    assert cleared['mastery_level'] == 0 and cleared['review_status'] == 'source_checked'
    combined = mutate(client, document, note, cleared, text='Combined edit', mastery_level=2).json()
    assert combined['text'] == 'Combined edit' and combined['mastery_level'] == 2
    assert combined['review_status'] == 'unreviewed'
    assert client.get(note_url(document, note) + '/state').json() == combined


def test_soft_delete_and_restore_preserve_mastery(client, app, document):
    note = add_region(client, document)
    rated = mutate(client, document, note, state(client, document, note), mastery_level=3).json()
    deleted = mutate(client, document, note, rated, kind='delete').json()
    assert deleted['mastery_level'] == 3
    with app.state.store.connection() as db:
        assert db.execute('SELECT mastery_level FROM note_mastery WHERE note_id=?',
                          (note['id'],)).fetchone()[0] == 3
    restored = mutate(client, document, note, deleted, kind='restore').json()
    assert restored['mastery_level'] == 3 and state(client, document, note) == restored


def test_hard_note_purge_clears_mastery(client, app, document):
    note = add_region(client, document)
    rated = mutate(client, document, note, state(client, document, note), mastery_level=5).json()
    deleted = mutate(client, document, note, rated, kind='delete').json()
    payload = {'request_id': str(uuid4()), 'expected_revision': deleted['revision']}
    purged = client.post(note_url(document, note) + '/purge', json=payload)
    assert purged.status_code == 200, purged.text
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM note_mastery WHERE note_id=?',
                          (note['id'],)).fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    assert client.get(note_url(document, note) + '/state').status_code == 410


def test_paper_purge_removes_mastery_rows_before_notes(client, app, document):
    note = add_region(client, document)
    mutate(client, document, note, state(client, document, note), mastery_level=2)
    store = app.state.store
    with store.connection() as db:
        db.execute('INSERT INTO document_trash VALUES (?,?)', (document['id'], now()))
    preview = store.paper_purge.preview(document['id'])
    result = store.paper_purge.purge(document['id'], PaperPurgeMutation(
        request_id=uuid4(), expected_revision=preview['expected_revision'],
        preview_sha256=preview['preview_sha256']))
    assert result['purged'] is True
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM note_mastery').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM documents').fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_schema27_to_28_is_additive_and_preserves_checked_rich_notes(client, app, document):
    creation = {
        'request_id': str(uuid4()), 'page': 1, 'rect': [0.1, 0.1, 0.6, 0.6],
        'text': 'Legacy rich body',
        'rich_content': {'version': 1, 'ops': [
            {'insert': 'Legacy rich body', 'attributes': {'bold': True}}, {'insert': '\n'}]}}
    note = client.post(f"/api/v1/documents/{document['id']}/notes", json=creation).json()
    checked = mutate(client, document, note, state(client, document, note),
                     review_status='source_checked').json()
    store = app.state.store
    tables = ('documents', 'document_metadata', 'notes', 'note_states', 'note_operations',
              'note_rich_content')
    with store.connection() as db:
        before = {name: list(map(tuple, db.execute(f'SELECT * FROM {name} ORDER BY 1')))
                  for name in tables}
        db.execute('DROP TABLE note_mastery')
        db.execute('PRAGMA user_version=27')
    reopened = Store(store.root)
    with reopened.connection() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 28
        assert db.execute('SELECT COUNT(*) FROM note_mastery').fetchone()[0] == 0
        assert before == {name: list(map(tuple, db.execute(f'SELECT * FROM {name} ORDER BY 1')))
                          for name in tables}
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    state_after = reopened.lifecycle.get(document['id'], note['id'])
    assert state_after['mastery_level'] == 0
    assert state_after['review_status'] == 'source_checked'
    assert state_after['reviewed_at'] == checked['reviewed_at']
    assert state_after['rich_content'] == checked['rich_content']
    assert state_after['revision'] == checked['revision']


def test_export_includes_mastery_without_changing_source_review(client, document):
    note = add_region(client, document)
    checked = mutate(client, document, note, state(client, document, note),
                     review_status='source_checked').json()
    rated = mutate(client, document, note, checked, mastery_level=4).json()
    response = client.get(f"/api/v1/documents/{document['id']}/export")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        exported = json.loads(archive.read('notes.json'))['notes'][0]
        readme = archive.read('README.md').decode()
        markup = archive.read('index.html').decode()
    assert exported['mastery_level'] == 4
    assert exported['review_status'] == 'source_checked'
    assert exported['revision'] == rated['revision']
    assert '学习掌握 / Mastery: ★★★★☆ (4/5)' in readme
    assert '已核对原文（自行确认） / Source checked (self-reported)' in readme
    assert 'class="mastery"' in markup and '★★★★☆' in markup
