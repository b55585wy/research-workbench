
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
    original_filename TEXT NOT NULL,
    page_count INTEGER NOT NULL CHECK(typeof(page_count)='integer' AND page_count BETWEEN 1 AND 200),
    byte_size INTEGER NOT NULL CHECK(typeof(byte_size)='integer' AND byte_size BETWEEN 1 AND 20971520),
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    page INTEGER NOT NULL CHECK(typeof(page)='integer' AND page BETWEEN 1 AND 200),
    rect TEXT CHECK(rect IS NULL OR CASE WHEN json_valid(rect) THEN (
        json_type(rect)='array' AND json_array_length(rect)=4 AND
        json_type(rect,'$[0]') IN ('integer','real') AND
        json_type(rect,'$[1]') IN ('integer','real') AND
        json_type(rect,'$[2]') IN ('integer','real') AND
        json_type(rect,'$[3]') IN ('integer','real') AND
        json_extract(rect,'$[0]') >= 0 AND json_extract(rect,'$[1]') >= 0 AND
        json_extract(rect,'$[2]') <= 1 AND json_extract(rect,'$[3]') <= 1 AND
        json_extract(rect,'$[0]') < json_extract(rect,'$[2]') AND
        json_extract(rect,'$[1]') < json_extract(rect,'$[3]')) ELSE 0 END),
    text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 10000),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_document ON notes(document_id, created_at);
CREATE TRIGGER IF NOT EXISTS note_page_bounds BEFORE INSERT ON notes
WHEN NEW.page > (SELECT page_count FROM documents WHERE id=NEW.document_id)
BEGIN SELECT RAISE(ABORT, 'Page outside document'); END;
CREATE TABLE IF NOT EXISTS excerpts (
    note_id TEXT PRIMARY KEY REFERENCES notes(id),
    source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 8388608),
    width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width BETWEEN 1 AND 2048),
    height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height BETWEEN 1 AND 2048),
    created_at TEXT NOT NULL,
    CHECK(width*height <= 4000000)
);
PRAGMA user_version=2;
