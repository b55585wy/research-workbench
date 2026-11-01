"""Transactional SQLite rebuild preserves legacy IDs, columns, values and FKs."""
DOCUMENTS='''CREATE TABLE documents (
 id TEXT PRIMARY KEY,title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 original_filename TEXT,page_count INTEGER,byte_size INTEGER,sha256 TEXT,created_at TEXT NOT NULL,
 CHECK((original_filename IS NULL AND page_count IS NULL AND byte_size IS NULL AND sha256 IS NULL)
 OR (original_filename IS NOT NULL AND typeof(page_count)='integer' AND page_count BETWEEN 1 AND 200
 AND typeof(byte_size)='integer' AND byte_size BETWEEN 1 AND 20971520 AND sha256 IS NOT NULL AND length(sha256)=64))
);'''
NOTES='''CREATE TABLE notes (
 id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),
 page INTEGER CHECK(page IS NULL OR (typeof(page)='integer' AND page BETWEEN 1 AND 200)),
 rect TEXT,text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 10000),created_at TEXT NOT NULL,
 CHECK(rect IS NULL OR CASE WHEN json_valid(rect) THEN (
 json_type(rect)='array' AND json_array_length(rect)=4 AND
 json_type(rect,'$[0]') IN ('integer','real') AND json_type(rect,'$[1]') IN ('integer','real') AND
 json_type(rect,'$[2]') IN ('integer','real') AND json_type(rect,'$[3]') IN ('integer','real') AND
 json_extract(rect,'$[0]')>=0 AND json_extract(rect,'$[1]')>=0 AND
 json_extract(rect,'$[2]')<=1 AND json_extract(rect,'$[3]')<=1 AND
 json_extract(rect,'$[0]')<json_extract(rect,'$[2]') AND json_extract(rect,'$[1]')<json_extract(rect,'$[3]')) ELSE 0 END)
);'''
ADDITIONS='''
CREATE TABLE IF NOT EXISTS studies (
 document_id TEXT PRIMARY KEY REFERENCES documents(id),question TEXT NOT NULL CHECK(length(trim(question)) BETWEEN 1 AND 4000),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_note_sources (
 note_id TEXT PRIMARY KEY REFERENCES notes(id),source_json TEXT NOT NULL CHECK(json_valid(source_json))
);
CREATE TABLE IF NOT EXISTS study_papers (
 study_id TEXT NOT NULL REFERENCES studies(document_id),paper_id TEXT NOT NULL REFERENCES documents(id),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),created_at TEXT NOT NULL,PRIMARY KEY(study_id,paper_id),CHECK(study_id!=paper_id)
);
CREATE TRIGGER IF NOT EXISTS note_owner_kind BEFORE INSERT ON notes
WHEN (NEW.page IS NULL AND NOT EXISTS(SELECT 1 FROM studies WHERE document_id=NEW.document_id))
 OR (NEW.page IS NOT NULL AND EXISTS(SELECT 1 FROM studies WHERE document_id=NEW.document_id))
 OR (NEW.page IS NULL AND NEW.rect IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'note source kind mismatch'); END;
CREATE TRIGGER IF NOT EXISTS study_note_source_owner BEFORE INSERT ON study_note_sources
WHEN NOT EXISTS(SELECT 1 FROM notes n JOIN studies s ON s.document_id=n.document_id WHERE n.id=NEW.note_id AND n.page IS NULL)
BEGIN SELECT RAISE(ABORT,'study note source mismatch'); END;
PRAGMA user_version=13;
'''


def install(connection,schema):
    exists=connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").fetchone()
    if not exists or connection.execute('PRAGMA user_version').fetchone()[0]>=13:
        connection.executescript(schema);return
    connection.execute('PRAGMA foreign_keys=OFF');connection.execute('PRAGMA legacy_alter_table=ON')
    prefix='BEGIN IMMEDIATE; ALTER TABLE documents RENAME TO migration_documents; ALTER TABLE notes RENAME TO migration_notes;'
    prefix+=DOCUMENTS+NOTES+'INSERT INTO documents SELECT * FROM migration_documents; INSERT INTO notes SELECT * FROM migration_notes; DROP TABLE migration_notes; DROP TABLE migration_documents;'
    body=schema.replace('BEGIN IMMEDIATE;','',1).rsplit('COMMIT;',1)[0]
    try:
        connection.executescript(prefix+body)
        if connection.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('Migration foreign key check failed')
        connection.commit()
    except BaseException:
        connection.rollback();raise
    finally:
        connection.execute('PRAGMA legacy_alter_table=OFF');connection.execute('PRAGMA foreign_keys=ON')
