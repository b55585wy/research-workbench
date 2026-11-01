import sqlite3
import threading
import pytest
from research_workbench.store import Store


def fixture_store(tmp_path):
    store=Store(tmp_path)
    with store.connection() as db:db.execute('CREATE TABLE transaction_probe (value INTEGER)')
    return store


def test_nested_write_waits_for_outer_commit_and_outer_failure_rolls_back(tmp_path):
    store=fixture_store(tmp_path)
    with pytest.raises(RuntimeError):
        with store.connection() as outer:
            outer.execute('BEGIN IMMEDIATE')
            with store.connection() as inner:
                assert inner is outer
                inner.execute('INSERT INTO transaction_probe VALUES (1)')
            with sqlite3.connect(store.database) as observer:
                assert observer.execute('SELECT * FROM transaction_probe').fetchall()==[]
            raise RuntimeError('abort the operation')
    with store.connection() as fresh:
        assert fresh.execute('SELECT * FROM transaction_probe').fetchall()==[]
        fresh.execute('INSERT INTO transaction_probe VALUES (2)')
    with store.connection() as fresh:
        assert fresh.execute('SELECT value FROM transaction_probe').fetchone()[0]==2


def test_nested_read_finishes_while_another_writer_waits_to_commit(tmp_path):
    store=fixture_store(tmp_path);committing=threading.Event();errors=[];connections=[]
    def writer():
        try:
            with store.connection() as db:
                connections.append(db)
                db.execute('INSERT INTO transaction_probe VALUES (1)')
                db.set_trace_callback(lambda statement:committing.set() if statement=='COMMIT' else None)
        except Exception as error:errors.append(error)
    with store.connection() as reader:
        reader.execute('BEGIN');reader.execute('SELECT * FROM transaction_probe').fetchall()
        worker=threading.Thread(target=writer);worker.start()
        assert committing.wait(3)
        with store.connection() as nested:
            assert nested is reader and nested is not connections[0]
            assert nested.execute('SELECT * FROM transaction_probe').fetchall()==[]
    worker.join(3)
    assert not worker.is_alive() and errors==[]
    with store.connection() as db:assert len(db.execute('SELECT * FROM transaction_probe').fetchall())==1
