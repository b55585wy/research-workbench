"""Schema 26 -> 27 additive migration and permanent-purge coverage for runs."""
import sqlite3
from uuid import uuid4

import pytest

from research_workbench.document_purge import PaperPurgeMutation
from research_workbench.store import Store, timestamp
from research_workbench.translation import Translations
from test_translation_runs import FakeProvider, FakeRuntime, add_document, control, payload

RUN_TABLES = ('translation_runs', 'translation_run_jobs',
              'translation_run_pages', 'translation_run_operations')


def insert_legacy_job(connection, document, identifier, total_pages=1):
    stamp = timestamp()
    connection.execute(
        'INSERT INTO translation_jobs (id,document_id,source_sha256,target_language,'
        'pages_json,request_hash,status,stage,parser_id,parser_version,prompt_version,'
        'result_schema_version,model_name,model_fingerprint,completed_pages,total_pages,'
        'error_json,created_at,started_at,updated_at,finished_at) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (identifier, document['id'], document['sha256'], 'zh', '[1]', 'a' * 64,
         'completed', 'finished', 'mineru-flash-txt', '4.1.5', 'translate-blocks-v1', 1,
         'synthetic-model', 'b' * 16, 1, total_pages, None,
         stamp, stamp, stamp, stamp))
    connection.execute('INSERT INTO translation_pages VALUES (?,?,?,?,?)',
                       (identifier, 1, 'completed', None, '[]'))


def test_schema_26_upgrade_is_additive_and_keeps_the_legacy_five_page_check(tmp_path):
    root = tmp_path / 'workspace'
    store = Store(root)
    document = add_document(store, pages=2)
    job_id = str(uuid4())
    with store.connection() as db:
        insert_legacy_job(db, document, job_id)
        original_job = tuple(db.execute('SELECT * FROM translation_jobs').fetchone())
        original_page = tuple(db.execute('SELECT * FROM translation_pages').fetchone())

    with store.connection() as db:
        for table in RUN_TABLES:
            db.execute(f'DROP TABLE {table}')
        db.execute('PRAGMA user_version=26')

    reopened = Store(root)
    with reopened.connection() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 28
        names = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        assert set(RUN_TABLES) <= names
        assert tuple(db.execute('SELECT * FROM translation_jobs').fetchone()) == original_job
        assert tuple(db.execute('SELECT * FROM translation_pages').fetchone()) == original_page
        for table in RUN_TABLES:
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []

        # The deployed legacy translation job boundary is unchanged.
        with pytest.raises(sqlite3.IntegrityError):
            insert_legacy_job(db, document, str(uuid4()), total_pages=6)


def test_purge_removes_run_relations_and_run_owned_children_without_fk_leftovers(tmp_path):
    store = Store(tmp_path / 'workspace')
    document = add_document(store, pages=2)
    service = Translations(store, FakeProvider(), FakeRuntime())
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    service.runs.advance()
    child = service.claim()
    assert child is not None and child['document_id'] == document['id']

    # An active parent run keeps the document busy; an explicit pause is the
    # deployed way to stop it before the trash/purge lifecycle may proceed.
    service.runs.pause(run['id'], control(run))
    with store.connection() as db:
        db.execute('INSERT INTO document_trash VALUES (?,?)', (document['id'], timestamp()))
    preview = store.paper_purge.preview(document['id'])
    result = store.paper_purge.purge(document['id'], PaperPurgeMutation(
        request_id=uuid4(), expected_revision=preview['expected_revision'],
        preview_sha256=preview['preview_sha256']))
    assert result == {'id': document['id'], 'purged': True, 'files_removed': True}

    with store.connection() as db:
        for table in RUN_TABLES + ('translation_jobs', 'translation_pages'):
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM documents').fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_future_schema_29_is_refused_without_rewriting_the_database(tmp_path):
    root = tmp_path / 'future'
    root.mkdir()
    database = root / 'workspace.sqlite3'
    with sqlite3.connect(database) as db:
        db.execute('PRAGMA user_version=29')
    with pytest.raises(RuntimeError):
        Store(root)
    with sqlite3.connect(database) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 29
