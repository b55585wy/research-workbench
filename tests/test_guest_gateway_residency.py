"""Focused residency checks for the guest LRU eviction guard.

Only a synthetic SQLite store is used; no child app, worker process or model
call is started.
"""
import pytest

from research_workbench.guest_gateway import _space_has_active_work
from research_workbench.store import Store, timestamp
from test_translation_runs import add_document

RUN_TABLES = ('translation_run_operations', 'translation_run_pages',
              'translation_run_jobs', 'translation_runs')


def insert_run(store, document, status='running', stage='parsing'):
    with store.connection() as db:
        stamp = timestamp()
        db.execute(
            'INSERT INTO translation_runs (id,document_id,source_sha256,pages_json,'
            'target_language,request_hash,status,stage,revision,total_pages,'
            'processed_pages,completed_pages,reused_pages,active_job_id,parser_id,'
            'parser_version,prompt_version,result_schema_version,model_name,'
            'model_fingerprint,error_json,created_at,updated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ('run-1', document['id'], document['sha256'], '[1]', 'zh', 'a' * 64,
             status, stage, 1, 1, 0, 0, 0, None, 'mineru-flash-txt', '4.1.5',
             'translate-blocks-v1', 1, 'synthetic-model', 'b' * 16, None,
             stamp, stamp))


@pytest.mark.parametrize('status', ['queued', 'running'])
def test_active_parent_without_active_child_keeps_space_resident(tmp_path, status):
    store = Store(tmp_path / 'workspace')
    document = add_document(store, pages=2)
    insert_run(store, document, status=status)

    # No queued/running child exists between two one-page children; the parent
    # authorization alone still owns the space.
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM translation_jobs').fetchone()[0] == 0
    assert _space_has_active_work(store.root) is True


@pytest.mark.parametrize('status', ['paused', 'completed', 'partial', 'failed',
                                    'interrupted'])
def test_paused_or_terminal_parent_is_evictable(tmp_path, status):
    store = Store(tmp_path / 'workspace')
    document = add_document(store, pages=2)
    insert_run(store, document, status=status, stage='finished')
    assert _space_has_active_work(store.root) is False


def test_legacy26_store_without_parent_table_keeps_old_behavior(tmp_path):
    store = Store(tmp_path / 'workspace')
    add_document(store, pages=2)
    with store.connection() as db:
        for table in RUN_TABLES:
            db.execute(f'DROP TABLE {table}')
        db.execute('PRAGMA user_version=26')
    assert _space_has_active_work(store.root) is False


def test_missing_parent_table_on_schema27_stays_busy(tmp_path):
    store = Store(tmp_path / 'workspace')
    add_document(store, pages=2)
    with store.connection() as db:
        for table in RUN_TABLES:
            db.execute(f'DROP TABLE {table}')
        db.execute('PRAGMA user_version=27')
    assert _space_has_active_work(store.root) is True


def test_unreadable_database_stays_busy(tmp_path):
    root = tmp_path / 'workspace'
    root.mkdir()
    (root / 'workspace.sqlite3').write_bytes(b'not a sqlite database')
    assert _space_has_active_work(root) is True
