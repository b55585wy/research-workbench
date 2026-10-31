BEGIN TRANSACTION;
CREATE TABLE agent_conversations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO "agent_conversations" VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic saved conversation','2026-10-30T00:00:00+00:00','2026-10-30T00:00:00+00:00');
CREATE TABLE agent_events (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES agent_turns(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE agent_proposals (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES agent_turns(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','applied','rejected','conflict')),
    result_json TEXT,
    error_json TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE agent_turns (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),
    request_hash TEXT NOT NULL,
    message TEXT NOT NULL,
    context_json TEXT NOT NULL,
    sources_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_confirmation','completed','failed','cancelled','interrupted')),
    answer TEXT NOT NULL DEFAULT '',
    error_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO "agent_turns" VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','Synthetic input','{}','[]','completed','Synthetic saved answer',NULL,'2026-10-30T00:00:00+00:00','2026-10-30T00:00:00+00:00');
CREATE TABLE document_metadata (
    document_id TEXT PRIMARY KEY REFERENCES documents(id),
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 180),
    authors TEXT NOT NULL CHECK(length(authors) <= 2000),
    year INTEGER CHECK(year IS NULL OR (typeof(year)='integer' AND year BETWEEN 1 AND 9999)),
    doi TEXT NOT NULL CHECK(length(doi) <= 255),
    revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision >= 1),
    updated_at TEXT NOT NULL
);
INSERT INTO "document_metadata" VALUES('10000000-0000-4000-8000-000000000001','Synthetic migration fixture','',NULL,'',1,'2026-10-30T00:00:00+00:00');
CREATE TABLE document_operations (
    request_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    result_revision INTEGER NOT NULL CHECK(result_revision >= 1),
    created_at TEXT NOT NULL
);
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
    original_filename TEXT NOT NULL,
    page_count INTEGER NOT NULL CHECK(typeof(page_count)='integer' AND page_count BETWEEN 1 AND 200),
    byte_size INTEGER NOT NULL CHECK(typeof(byte_size)='integer' AND byte_size BETWEEN 1 AND 20971520),
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    created_at TEXT NOT NULL
);
INSERT INTO "documents" VALUES('10000000-0000-4000-8000-000000000001','Synthetic migration fixture','synthetic.pdf',2,100,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-10-30T00:00:00+00:00');
CREATE TABLE excerpts (
    note_id TEXT PRIMARY KEY REFERENCES notes(id),
    source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 8388608),
    width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width BETWEEN 1 AND 2048),
    height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height BETWEEN 1 AND 2048),
    created_at TEXT NOT NULL,
    CHECK(width*height <= 4000000)
);
CREATE TABLE image_assets (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp')),
    byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 8388608),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 8192),
    height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 8192),
    preview_mime_type TEXT NOT NULL CHECK(preview_mime_type IN ('image/png','image/jpeg')),
    preview_byte_size INTEGER NOT NULL CHECK(preview_byte_size BETWEEN 1 AND 2097152),
    preview_sha256 TEXT NOT NULL CHECK(length(preview_sha256)=64),
    created_at TEXT NOT NULL,
    CHECK(width*height<=16000000)
);
CREATE TABLE image_note_requests (
    request_id TEXT PRIMARY KEY REFERENCES notes(id),
    document_id TEXT NOT NULL REFERENCES documents(id),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64)
);
CREATE TABLE note_images (
    note_id TEXT NOT NULL REFERENCES notes(id),
    image_id TEXT NOT NULL REFERENCES image_assets(id),
    PRIMARY KEY(note_id,image_id)
);
CREATE TABLE note_operations (
    request_id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id),
    kind TEXT NOT NULL CHECK(kind IN ('patch','delete','restore')),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    result_revision INTEGER NOT NULL CHECK(result_revision >= 1),
    created_at TEXT NOT NULL
);
CREATE TABLE note_states (
    note_id TEXT PRIMARY KEY REFERENCES notes(id),
    current_text TEXT NOT NULL CHECK(length(trim(current_text)) BETWEEN 1 AND 10000),
    revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision >= 1),
    review_status TEXT NOT NULL CHECK(review_status IN ('unreviewed','source_checked')),
    reviewed_at TEXT,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK((review_status='unreviewed' AND reviewed_at IS NULL) OR
          (review_status='source_checked' AND reviewed_at IS NOT NULL))
);
INSERT INTO "note_states" VALUES('20000000-0000-4000-8000-000000000001','Synthetic source note, not research evidence.',1,'unreviewed',NULL,'2026-10-30T00:00:00+00:00',NULL);
CREATE TABLE notes (
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
INSERT INTO "notes" VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,NULL,'Synthetic source note, not research evidence.','2026-10-30T00:00:00+00:00');
CREATE INDEX agent_turns_conversation ON agent_turns(conversation_id,created_at,id);
CREATE INDEX documents_sha256 ON documents(sha256,created_at,id);
CREATE INDEX notes_document ON notes(document_id, created_at);
CREATE TRIGGER document_initial_metadata AFTER INSERT ON documents
BEGIN INSERT INTO document_metadata VALUES (NEW.id,NEW.title,'',NULL,'',1,NEW.created_at); END;
CREATE TRIGGER note_initial_state AFTER INSERT ON notes
BEGIN INSERT INTO note_states VALUES (NEW.id,NEW.text,1,'unreviewed',NULL,NEW.created_at,NULL); END;
CREATE TRIGGER note_page_bounds BEFORE INSERT ON notes
WHEN NEW.page > (SELECT page_count FROM documents WHERE id=NEW.document_id)
BEGIN SELECT RAISE(ABORT, 'Page outside document'); END;
COMMIT;
PRAGMA user_version=5;
