import json,sqlite3
from pathlib import Path
from uuid import uuid4
import pytest
from research_workbench.store import Store,SCHEMA
from research_workbench.study_migration import install
from migration_support import table_info


def fixture(root):
    db=root/'workspace.sqlite3';doc,note=str(uuid4()),str(uuid4())
    with sqlite3.connect(db) as c:
        c.executescript((Path(__file__).parent/'fixtures/schema-v12.sql').read_text(encoding='utf-8'))
        c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(doc,'Old','old.pdf',1,10,'a'*64,'2026-01-01'))
        c.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,doc,1,None,'Old source note','2026-01-01'))
        names=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        before={n:(table_info(c,n),c.execute(f'SELECT * FROM {n} ORDER BY 1').fetchall()) for n in names}
    return db,doc,before


def test_schema12_preserves_all25_tables_and_foreign_keys(tmp_path):
    database,doc,before=fixture(tmp_path);store=Store(tmp_path)
    with store.connection() as c:
        assert c.execute('PRAGMA user_version').fetchone()[0]==15
        assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
        after={n:(table_info(c,n),list(map(tuple,c.execute(f'SELECT * FROM {n} ORDER BY 1')))) for n in before}
        assert before==after and len(before)==25
        assert not any('migration_' in r[0] for r in c.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))
    assert store.get_document(doc)['sha256']=='a'*64
    Store(tmp_path)


def test_migration_failure_rolls_back_schema_rows_and_version(tmp_path):
    database,doc,before=fixture(tmp_path)
    with sqlite3.connect(database) as c:
        with pytest.raises(sqlite3.Error):install(c,SCHEMA.replace('PRAGMA user_version=13;','THIS IS INVALID SQL;'))
        assert c.execute('PRAGMA user_version').fetchone()[0]==12
        assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert before=={n:(table_info(c,n),c.execute(f'SELECT * FROM {n} ORDER BY 1').fetchall()) for n in before}
        assert c.execute("SELECT name FROM sqlite_master WHERE name LIKE 'migration_%'").fetchall()==[]


def test_pdf_note_null_page_and_partial_pdf_header_remain_invalid(tmp_path):
    database,doc,_=fixture(tmp_path);store=Store(tmp_path)
    with store.connection() as c:
        with pytest.raises(sqlite3.IntegrityError):c.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(str(uuid4()),doc,None,None,'Bad PDF page','now'))
        with pytest.raises(sqlite3.IntegrityError):c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(str(uuid4()),'Bad','file.pdf',None,10,'a'*64,'now'))
