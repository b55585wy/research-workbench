from pathlib import Path
import sqlite3
from uuid import uuid4

import pytest

from research_workbench.models import NoteUpdate, DocumentUpdate
from research_workbench.store import Store


@pytest.mark.parametrize('version',[1,2,3,4])
def test_legacy_notes_are_preserved_and_never_inferred_as_reviewed(tmp_path,version):
    schema=(Path(__file__).parent/f'fixtures/schema-v{version}.sql').read_text(encoding='utf-8')
    identifier,note_id=str(uuid4()),str(uuid4())
    original=(note_id,identifier,1,'[0.1, 0.2, 0.6, 0.7]','Text saying 已核对原文 is not a review record','2026-10-30T00:00:00+00:00')
    with sqlite3.connect(tmp_path/'workspace.sqlite3') as db:
        db.executescript(schema)
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(identifier,'Legacy','source.pdf',1,100,'a'*64,original[-1]))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',original)
    store=Store(tmp_path)
    with store.connection() as db:
        assert tuple(db.execute('SELECT * FROM notes').fetchone())==original
        assert db.execute('PRAGMA user_version').fetchone()[0]==15
    metadata=store.library.get(identifier)
    assert metadata['title']=='Legacy' and metadata['authors']==metadata['doi']==''
    assert metadata['year'] is None and metadata['revision']==1
    revised=store.library.update(identifier,DocumentUpdate(request_id=uuid4(),expected_revision=1,title='Saved title',authors='王某',year=2025))
    assert Store(tmp_path).library.get(identifier)==revised
    state=store.lifecycle.get(identifier,note_id)
    assert state['review_status']=='unreviewed' and state['reviewed_at'] is None and state['review_provenance'] is None
    checked=store.lifecycle.mutate(identifier,note_id,'patch',NoteUpdate(request_id=uuid4(),expected_revision=1,review_status='source_checked'))
    assert Store(tmp_path).lifecycle.get(identifier,note_id)==checked
