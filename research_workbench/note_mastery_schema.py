"""Independent self-reported learning mastery, one optional row per note.

Mastery is deliberately separate from ``note_states.review_status``: it records
how well the reader feels they know the material, never whether the quoted
source was checked.  Rows are sparse (existing notes simply have no row and read
back as 0) and are removed together with the note's content on hard purge.
"""
SCHEMA = '''
CREATE TABLE IF NOT EXISTS note_mastery (
 note_id TEXT PRIMARY KEY REFERENCES notes(id),
 mastery_level INTEGER NOT NULL CHECK(typeof(mastery_level)='integer' AND mastery_level BETWEEN 0 AND 5),
 updated_at TEXT NOT NULL
);
'''
