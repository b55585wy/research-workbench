
BEGIN IMMEDIATE;
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
CREATE TABLE IF NOT EXISTS note_states (
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
CREATE TABLE IF NOT EXISTS note_operations (
    request_id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id),
    kind TEXT NOT NULL CHECK(kind IN ('patch','delete','restore')),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    result_revision INTEGER NOT NULL CHECK(result_revision >= 1),
    created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS note_initial_state AFTER INSERT ON notes
BEGIN INSERT INTO note_states VALUES (NEW.id,NEW.text,1,'unreviewed',NULL,NEW.created_at,NULL); END;
INSERT OR IGNORE INTO note_states
    SELECT id,text,1,'unreviewed',NULL,created_at,NULL FROM notes;
CREATE INDEX IF NOT EXISTS documents_sha256 ON documents(sha256,created_at,id);
CREATE TABLE IF NOT EXISTS document_metadata (
    document_id TEXT PRIMARY KEY REFERENCES documents(id),
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 180),
    authors TEXT NOT NULL CHECK(length(authors) <= 2000),
    year INTEGER CHECK(year IS NULL OR (typeof(year)='integer' AND year BETWEEN 1 AND 9999)),
    doi TEXT NOT NULL CHECK(length(doi) <= 255),
    revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision >= 1),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_operations (
    request_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    result_revision INTEGER NOT NULL CHECK(result_revision >= 1),
    created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS document_initial_metadata AFTER INSERT ON documents
BEGIN INSERT INTO document_metadata VALUES (NEW.id,NEW.title,'',NULL,'',1,NEW.created_at); END;
INSERT OR IGNORE INTO document_metadata
    SELECT id,title,'',NULL,'',1,created_at FROM documents;
CREATE TABLE IF NOT EXISTS image_assets (
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
CREATE TABLE IF NOT EXISTS note_images (
    note_id TEXT NOT NULL REFERENCES notes(id),
    image_id TEXT NOT NULL REFERENCES image_assets(id),
    PRIMARY KEY(note_id,image_id)
);
CREATE TABLE IF NOT EXISTS image_note_requests (
    request_id TEXT PRIMARY KEY REFERENCES notes(id),
    document_id TEXT NOT NULL REFERENCES documents(id),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64)
);
CREATE TABLE IF NOT EXISTS agent_conversations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_turns (
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
CREATE INDEX IF NOT EXISTS agent_turns_conversation ON agent_turns(conversation_id,created_at,id);
CREATE TABLE IF NOT EXISTS agent_events (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES agent_turns(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_proposals (
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
CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
    delimiter TEXT NOT NULL CHECK(delimiter IN (',',char(9))),
    profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),
    created_at TEXT NOT NULL,
    UNIQUE(id,document_id)
);
CREATE TABLE IF NOT EXISTS analysis_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    dataset_id TEXT NOT NULL,
    request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
    result_json TEXT,
    error_json TEXT,
    outputs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    engine_version TEXT,
    FOREIGN KEY(dataset_id,document_id) REFERENCES datasets(id,document_id),
    CHECK((status='succeeded' AND result_json IS NOT NULL AND finished_at IS NOT NULL) OR
          (status<>'succeeded' AND result_json IS NULL))
);
CREATE INDEX IF NOT EXISTS analysis_jobs_document ON analysis_jobs(document_id,created_at,id);
CREATE TABLE IF NOT EXISTS note_rich_content (
    note_id TEXT PRIMARY KEY REFERENCES notes(id),
    original_json TEXT CHECK(original_json IS NULL OR json_valid(original_json)),
    current_json TEXT CHECK(current_json IS NULL OR json_valid(current_json))
);
CREATE TABLE IF NOT EXISTS image_annotations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    image_id TEXT REFERENCES image_assets(id),
    excerpt_note_id TEXT REFERENCES excerpts(note_id),
    source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
    frame_sha256 TEXT NOT NULL CHECK(length(frame_sha256)=64),
    frame_width INTEGER NOT NULL CHECK(typeof(frame_width)='integer' AND frame_width BETWEEN 1 AND 2048),
    frame_height INTEGER NOT NULL CHECK(typeof(frame_height)='integer' AND frame_height BETWEEN 1 AND 2048),
    creation_hash TEXT NOT NULL CHECK(length(creation_hash)=64),
    rect TEXT NOT NULL CHECK(CASE WHEN json_valid(rect) THEN json_type(rect)='array' AND json_array_length(rect)=4
        AND json_type(rect,'$[0]') IN ('integer','real') AND json_type(rect,'$[1]') IN ('integer','real')
        AND json_type(rect,'$[2]') IN ('integer','real') AND json_type(rect,'$[3]') IN ('integer','real')
        AND json_extract(rect,'$[0]')>=0 AND json_extract(rect,'$[1]')>=0
        AND json_extract(rect,'$[2]')<=1 AND json_extract(rect,'$[3]')<=1
        AND json_extract(rect,'$[0]')<json_extract(rect,'$[2]') AND json_extract(rect,'$[1]')<json_extract(rect,'$[3]') ELSE 0 END),
    text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 2000 AND instr(text,char(0))=0),
    origin TEXT NOT NULL CHECK(origin IN ('manual','agent_proposal')),
    revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK((image_id IS NULL)!=(excerpt_note_id IS NULL)),
    CHECK(frame_width*frame_height<=4000000)
);
CREATE INDEX IF NOT EXISTS image_annotations_source ON image_annotations(document_id,image_id,excerpt_note_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS image_annotation_scope_insert BEFORE INSERT ON image_annotations
WHEN (NEW.image_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM image_assets WHERE id=NEW.image_id AND document_id=NEW.document_id))
 OR (NEW.excerpt_note_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notes WHERE id=NEW.excerpt_note_id AND document_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT,'Image source outside document'); END;
CREATE TRIGGER IF NOT EXISTS image_annotation_scope_update BEFORE UPDATE OF document_id,image_id,excerpt_note_id ON image_annotations
WHEN (NEW.image_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM image_assets WHERE id=NEW.image_id AND document_id=NEW.document_id))
 OR (NEW.excerpt_note_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notes WHERE id=NEW.excerpt_note_id AND document_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT,'Image source outside document'); END;
CREATE TABLE IF NOT EXISTS image_annotation_operations (
    request_id TEXT PRIMARY KEY,
    annotation_id TEXT NOT NULL REFERENCES image_annotations(id),
    kind TEXT NOT NULL CHECK(kind IN ('patch','delete','restore')),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    result_revision INTEGER NOT NULL CHECK(result_revision>=1),
    created_at TEXT NOT NULL
);
PRAGMA user_version=8;
CREATE TABLE IF NOT EXISTS charts (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES documents(id),
 dataset_id TEXT NOT NULL REFERENCES datasets(id),
 analysis_id TEXT REFERENCES analysis_jobs(id),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
 summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
 data_sha256 TEXT NOT NULL CHECK(length(data_sha256)=64 AND data_sha256 NOT GLOB '*[^0-9a-f]*'),
 data_bytes BLOB NOT NULL CHECK(typeof(data_bytes)='blob' AND length(data_bytes) BETWEEN 1 AND 4194304 AND json_valid(CAST(data_bytes AS TEXT))),
 origin TEXT NOT NULL CHECK(origin IN ('manual','agent_proposal')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS charts_document ON charts(document_id,created_at);
CREATE TRIGGER IF NOT EXISTS charts_source_insert BEFORE INSERT ON charts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM datasets WHERE id=NEW.dataset_id AND document_id=NEW.document_id)
  OR (NEW.analysis_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM analysis_jobs WHERE id=NEW.analysis_id AND document_id=NEW.document_id AND dataset_id=NEW.dataset_id))
  THEN RAISE(ABORT,'chart source scope') END;
END;
CREATE TRIGGER IF NOT EXISTS charts_source_update BEFORE UPDATE ON charts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM datasets WHERE id=NEW.dataset_id AND document_id=NEW.document_id)
  OR (NEW.analysis_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM analysis_jobs WHERE id=NEW.analysis_id AND document_id=NEW.document_id AND dataset_id=NEW.dataset_id))
  THEN RAISE(ABORT,'chart source scope') END;
END;
CREATE TABLE IF NOT EXISTS chart_operations (
 request_id TEXT PRIMARY KEY,chart_id TEXT NOT NULL REFERENCES charts(id),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 kind TEXT NOT NULL CHECK(kind IN ('delete','restore')),
 result_revision INTEGER NOT NULL CHECK(result_revision>=1),created_at TEXT NOT NULL
);
PRAGMA user_version=9;
COMMIT;
