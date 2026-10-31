from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

from .models import WorkspaceError
from .note_lifecycle import NoteLifecycle, base_note, read_state, read_states, ensure_active
from .library import Library, DOCUMENT_QUERY, base_document, read_metadata
from .rich_content import canonical

SCHEMA = '''
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
CREATE TABLE IF NOT EXISTS data_imports (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES documents(id),
 storage_key TEXT NOT NULL UNIQUE,
 original_filename TEXT NOT NULL,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
 normalized_sha256 TEXT NOT NULL CHECK(length(normalized_sha256)=64),
 normalized_size INTEGER NOT NULL CHECK(normalized_size BETWEEN 1 AND 5242880),
 review_sha256 TEXT NOT NULL CHECK(length(review_sha256)=64),
 review_json TEXT NOT NULL CHECK(json_valid(review_json)),
 profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),
 dataset_id TEXT UNIQUE,
 created_at TEXT NOT NULL,
 FOREIGN KEY(dataset_id,document_id) REFERENCES datasets(id,document_id)
);
CREATE INDEX IF NOT EXISTS data_imports_document ON data_imports(document_id,created_at);
PRAGMA user_version=10;
COMMIT;
'''


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def note_record(row):
    result = dict(row)
    result['rect'] = json.loads(result['rect']) if result['rect'] else None
    return result


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.files = self.root / 'documents'
        self.incoming = self.root / 'incoming'
        self.files.mkdir(parents=True, exist_ok=True)
        self.incoming.mkdir(exist_ok=True)
        self.excerpts = self.root / 'excerpts'
        self.exports = self.root / 'exports'
        self.excerpts.mkdir(exist_ok=True)
        self.exports.mkdir(exist_ok=True)
        self.database = self.root / 'workspace.sqlite3'
        with self.connection() as connection:
            if connection.execute('PRAGMA user_version').fetchone()[0] > 10:
                raise RuntimeError('Database requires a newer application')
            connection.executescript(SCHEMA)
        self.lifecycle = NoteLifecycle(self)
        self.library = Library(self)

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def list_documents(self):
        with self.connection() as connection:
            return [base_document(row) for row in connection.execute(
                DOCUMENT_QUERY + ' ORDER BY d.created_at DESC,d.id DESC')]

    def get_document(self, identifier):
        with self.connection() as connection:
            return base_document(read_metadata(connection,identifier))

    def add_document(self, record, deduplicate=False):
        with self.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            if deduplicate:
                existing = connection.execute('''SELECT id FROM documents WHERE sha256=? AND byte_size=?
                    ORDER BY created_at,id LIMIT 1''',(record['sha256'],record['byte_size'])).fetchone()
                if existing is not None:
                    return base_document(read_metadata(connection,existing['id']))
            connection.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)', (
                record['id'], record['title'], record['original_filename'], record['page_count'],
                record['byte_size'], record['sha256'], record['created_at']))
        return record

    def list_notes(self, identifier):
        self.get_document(identifier)
        with self.connection() as connection:
            return [base_note(state) for state in read_states(connection, identifier, include_deleted=False)]

    def save_note(self, identifier, payload):
        with self.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            return self.save_note_in(connection,identifier,payload)

    def save_note_in(self, connection, identifier, payload):
        rectangle = json.dumps(payload.rect) if payload.rect is not None else None
        note = dict(id=str(payload.request_id), document_id=identifier, page=payload.page,
                    rect=rectangle, text=payload.text, created_at=timestamp())
        document = connection.execute('SELECT page_count FROM documents WHERE id=?', (identifier,)).fetchone()
        if document is None:
            raise WorkspaceError('not_found', '找不到这份资料，请重新选择。', 404)
        if payload.page > document['page_count']:
            raise WorkspaceError('invalid_page', '笔记页码超出了这份资料的范围。')
        existing = connection.execute('SELECT * FROM notes WHERE id=?', (note['id'],)).fetchone()
        if existing is not None:
            self.repeated_note(existing, note)
            body=connection.execute('SELECT original_json FROM note_rich_content WHERE note_id=?',(note['id'],)).fetchone()
            original=body['original_json'] if body is not None else None
            proposed=canonical(payload.rich_content) if payload.rich_content is not None else None
            if original!=proposed:
                raise WorkspaceError('idempotency_conflict','笔记格式与已有保存请求不一致。',409)
            current = read_state(connection, identifier, note['id'])
            if current['deleted_at'] is not None:
                raise WorkspaceError('note_deleted', '这条笔记已删除，可在已删除笔记中恢复。', 409)
            return base_note(current), False
        connection.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)', tuple(note.values()))
        if payload.rich_content is not None:
            body=canonical(payload.rich_content)
            connection.execute('INSERT INTO note_rich_content VALUES (?,?,?)',(note['id'],body,body))
        return note_record(note), True

    def get_note(self, identifier, note_id):
        self.get_document(identifier)
        with self.connection() as connection:
            return base_note(ensure_active(read_state(connection, identifier, note_id)))

    @staticmethod
    def excerpt_record(row):
        result = dict(row)
        result['rect'] = json.loads(result['rect']) if result['rect'] else None
        result['image_url'] = (f"/api/v1/documents/{result['document_id']}/notes/"
                               f"{result['note_id']}/excerpt")
        return result

    def list_excerpts(self, identifier):
        self.get_document(identifier)
        with self.connection() as connection:
            return self.excerpt_rows(connection, identifier)

    def excerpt_rows(self, connection, identifier):
        rows = connection.execute('''SELECT e.*, n.document_id, n.page, n.rect
            FROM excerpts e JOIN notes n ON n.id=e.note_id JOIN note_states s ON s.note_id=n.id
            WHERE n.document_id=? AND s.deleted_at IS NULL
            ORDER BY e.created_at, e.note_id''', (identifier,))
        return [self.excerpt_record(row) for row in rows]

    def get_excerpt(self, identifier, note_id):
        self.get_note(identifier, note_id)
        with self.connection() as connection:
            row = connection.execute('''SELECT e.*, n.document_id, n.page, n.rect
                FROM excerpts e JOIN notes n ON n.id=e.note_id
                WHERE n.document_id=? AND e.note_id=?''', (identifier, note_id)).fetchone()
        return self.excerpt_record(row) if row is not None else None

    def add_excerpt(self, identifier, record):
        with self.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            ensure_active(read_state(connection, identifier, record['note_id']))
            connection.execute('INSERT INTO excerpts VALUES (?,?,?,?,?,?,?)', (
                record['note_id'], record['source_sha256'], record['sha256'],
                record['byte_size'], record['width'], record['height'], record['created_at']))
            row = connection.execute('''SELECT e.*,n.document_id,n.page,n.rect
                FROM excerpts e JOIN notes n ON n.id=e.note_id
                WHERE n.document_id=? AND e.note_id=?''', (identifier, record['note_id'])).fetchone()
            result = self.excerpt_record(row)
        return result

    def reading_snapshot(self, identifier,include_annotations=False):
        with self.connection() as connection:
            connection.execute('BEGIN')
            document = read_metadata(connection,identifier)
            notes = read_states(connection, identifier, include_deleted=False, ascending=True)
            from .image_export import add_attachments
            add_attachments(connection,identifier,notes)
            result=(dict(document),notes,self.excerpt_rows(connection,identifier))
            if include_annotations:
                from .image_annotations import ImageAnnotations
                return (*result,ImageAnnotations(self).export_groups(connection,identifier))
            return result

    @staticmethod
    def repeated_note(existing, proposed):
        if any(existing[key] != proposed[key] for key in ('document_id', 'page', 'rect', 'text')):
            raise WorkspaceError('idempotency_conflict', '这次保存与已有记录冲突，请保留内容后重新打开资料。', 409)
        return note_record(existing)
