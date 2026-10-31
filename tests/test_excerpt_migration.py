from pathlib import Path
import sqlite3
from uuid import uuid4

import pytest

from research_workbench.store import Store


def test_schema_one_rows_survive_additive_migration(tmp_path):
    root = tmp_path / 'legacy'
    root.mkdir()
    database = root / 'workspace.sqlite3'
    schema = (Path(__file__).parent / 'fixtures/schema-v1.sql').read_text(encoding='utf-8')
    document_id, note_id = str(uuid4()), str(uuid4())
    document = (document_id, 'Legacy paper', 'original.pdf', 2, 100, 'a' * 64, '2026-10-30T00:00:00+00:00')
    note = (note_id, document_id, 2, '[0.1, 0.2, 0.6, 0.7]', 'Original 中文 note', '2026-10-30T01:00:00+00:00')
    with sqlite3.connect(database) as connection:
        connection.executescript(schema)
        connection.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)', document)
        connection.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)', note)
    store = Store(root)
    with sqlite3.connect(database) as connection:
        assert tuple(connection.execute('SELECT * FROM documents').fetchone()) == document
        assert tuple(connection.execute('SELECT * FROM notes').fetchone()) == note
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 9
    assert store.list_excerpts(document_id) == []
    assert store.get_note(document_id, note_id)['text'] == note[4]
    assert Store(root).list_notes(document_id) == store.list_notes(document_id)


def test_future_schema_is_refused_without_rewriting_database(tmp_path):
    with sqlite3.connect(tmp_path / 'workspace.sqlite3') as connection:
        connection.execute('PRAGMA user_version=99')
    with pytest.raises(RuntimeError):
        Store(tmp_path)
    with sqlite3.connect(tmp_path / 'workspace.sqlite3') as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 99
