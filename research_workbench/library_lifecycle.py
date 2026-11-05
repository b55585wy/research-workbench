"""Recoverable paper removal and irreversible note content removal."""
from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from uuid import UUID

from .models import WorkspaceError

SCHEMA = '''
CREATE TABLE IF NOT EXISTS document_trash (
 document_id TEXT PRIMARY KEY REFERENCES documents(id), deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purged_notes (
 note_id TEXT PRIMARY KEY REFERENCES notes(id),
 document_id TEXT NOT NULL REFERENCES documents(id), request_id TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 created_at TEXT NOT NULL, cleaned_at TEXT
);
'''


def now():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(identifier, target, kind, payload):
    data = {'document_id': identifier, 'target': target, 'kind': kind,
            'expected_revision': payload.expected_revision}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def reject_purged(connection, identifier, note_id):
    if connection.execute('SELECT 1 FROM purged_notes WHERE document_id=? AND note_id=?',
                          (identifier, note_id)).fetchone():
        raise WorkspaceError('note_purged', '这条笔记已彻底删除，无法恢复。', 410)


class PaperTrash:
    def __init__(self, store):
        self.store = store

    def list(self):
        from .library import DOCUMENT_QUERY
        query = DOCUMENT_QUERY.replace('SELECT d.id,', 'SELECT t.deleted_at,d.id,', 1)
        query += ' JOIN document_trash t ON t.document_id=d.id ORDER BY t.deleted_at DESC,d.id'
        with self.store.connection() as db:
            items = [self.record(dict(row), row['deleted_at']) for row in db.execute(query)]
            return items + self.store.paper_purge.pending(db)

    @staticmethod
    def record(metadata, deleted_at):
        from .library import base_document
        return {**base_document(metadata), 'revision': metadata['revision'], 'deleted_at': deleted_at}

    @staticmethod
    def ensure_idle(db, identifier):
        if db.execute('SELECT 1 FROM study_papers WHERE paper_id=? LIMIT 1', (identifier,)).fetchone():
            raise WorkspaceError('document_in_use', '请先在研究中解除这篇论文的关联，再移入回收站。', 409)
        try:
            version_row = db.execute('PRAGMA user_version').fetchone()
            version = version_row[0] if version_row is not None else None
        except sqlite3.Error:
            version = None
        active = [('analysis_jobs', ('queued', 'running')),
                  ('agent_turns', ('queued', 'running', 'waiting_confirmation')),
                  ('agent_tasks', ('running', 'waiting_confirmation', 'waiting_analysis')),
                  ('translation_runs', ('queued', 'running'))]
        for table, states in active:
            marks = ','.join('?' for _ in states)
            try:
                found = db.execute(
                    f'SELECT 1 FROM {table} WHERE document_id=? AND status IN ({marks}) LIMIT 1',
                    (identifier, *states)).fetchone()
            except sqlite3.Error:
                if (table == 'translation_runs' and isinstance(version, int)
                        and not isinstance(version, bool) and 0 < version <= 26):
                    # Legacy schema <=26 predates persisted parent runs.
                    continue
                # A missing relation on schema >=27 or an unknown version
                # stays conservatively busy rather than allowing a delete.
                raise WorkspaceError(
                    'document_busy', '这篇论文还有进行中的任务，请先停止或完成任务。', 409) from None
            if found:
                raise WorkspaceError('document_busy', '这篇论文还有进行中的任务，请先停止或完成任务。', 409)

    def mutate(self, identifier, kind, payload):
        from .library import read_metadata, revision_conflict
        digest = fingerprint(identifier, identifier, kind, payload)
        with self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            current = read_metadata(db, identifier, include_trashed=True)
            if current.get('kind') == 'study':
                raise WorkspaceError('paper_required', '此操作只适用于论文。', 409)
            receipt = db.execute('SELECT * FROM document_operations WHERE request_id=?',
                                 (str(payload.request_id),)).fetchone()
            old = db.execute('SELECT deleted_at FROM document_trash WHERE document_id=?',
                             (identifier,)).fetchone()
            if receipt:
                self.store.library.repeat(receipt, current, digest)
                return self.record(current, old[0] if old else None)
            if current['revision'] != payload.expected_revision:
                raise revision_conflict()
            if kind == 'trash':
                self.ensure_idle(db, identifier)
            changed = (kind == 'trash') != bool(old)
            stamp = now()
            if changed:
                if kind == 'trash':
                    db.execute('INSERT INTO document_trash VALUES (?,?)', (identifier, stamp))
                else:
                    db.execute('DELETE FROM document_trash WHERE document_id=?', (identifier,))
                current.update(revision=current['revision'] + 1, updated_at=stamp)
                db.execute('UPDATE document_metadata SET revision=?,updated_at=? WHERE document_id=?',
                           (current['revision'], stamp, identifier))
            db.execute('INSERT INTO document_operations VALUES (?,?,?,?,?)',
                       (str(payload.request_id), identifier, digest, current['revision'], stamp))
            deleted_at = (old[0] if old else stamp) if kind == 'trash' else None
            return self.record(current, deleted_at)


class NotePurge:
    def __init__(self, store):
        self.store = store

    def purge(self, identifier, note_id, payload):
        from .library import read_metadata
        from .note_lifecycle import read_state, conflict
        digest = fingerprint(identifier, note_id, 'purge', payload)
        with self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            read_metadata(db, identifier)
            receipt = db.execute('SELECT * FROM purged_notes WHERE request_id=?',
                                 (str(payload.request_id),)).fetchone()
            if receipt:
                if (receipt['document_id'], receipt['note_id'], receipt['payload_hash']) != (identifier, note_id, digest):
                    raise WorkspaceError('idempotency_conflict', '这次删除请求与原请求不一致。', 409)
            else:
                current = read_state(db, identifier, note_id)
                if current['revision'] != payload.expected_revision:
                    raise conflict()
                if not current['deleted_at']:
                    raise WorkspaceError('note_not_deleted', '请先将笔记移入已删除列表，再彻底删除。', 409)
                self.erase_in(db, identifier, note_id, payload, digest)
        return self.cleanup(identifier, note_id)

    @staticmethod
    def erase_in(db, identifier, note_id, payload, digest):
        stamp = now()
        # Retain a body-free reference for completed tasks and frozen request IDs.
        db.execute('INSERT INTO purged_notes VALUES (?,?,?,?,?,NULL)',
                   (note_id, identifier, str(payload.request_id), digest, stamp))
        db.execute('DELETE FROM image_annotation_operations WHERE annotation_id IN '
                   '(SELECT id FROM image_annotations WHERE excerpt_note_id=?)', (note_id,))
        db.execute('DELETE FROM image_annotations WHERE excerpt_note_id=?', (note_id,))
        for table in ('excerpts', 'note_images', 'note_rich_content', 'note_mastery',
                      'study_note_sources', 'note_text_annotations', 'note_shape_annotations',
                      'note_source_segments'):
            db.execute(f'DELETE FROM {table} WHERE note_id=?', (note_id,))
        db.execute("UPDATE notes SET text='[purged]',rect=NULL WHERE document_id=? AND id=?", (identifier, note_id))
        db.execute("UPDATE note_states SET current_text='[purged]',revision=revision+1,"
                   "review_status='unreviewed',reviewed_at=NULL,updated_at=? WHERE note_id=?", (stamp, note_id))

    def cleanup(self, identifier, note_id):
        with self.store.connection() as db:
            receipt = db.execute('SELECT * FROM purged_notes WHERE document_id=? AND note_id=?',
                                 (identifier, note_id)).fetchone()
        if receipt is None:
            raise WorkspaceError('not_found', '找不到这条删除记录。', 404)
        if receipt['cleaned_at'] is None:
            path = self.store.excerpts / (str(UUID(note_id)) + '.png')
            try:
                if path.resolve().parent != self.store.excerpts.resolve():
                    raise OSError('Invalid excerpt path')
                path.unlink(missing_ok=True)
            except OSError:
                raise WorkspaceError('storage_unavailable', '笔记已移除，图片清理尚未完成，请重试同一次删除。', 503) from None
            with self.store.connection() as db:
                db.execute('UPDATE purged_notes SET cleaned_at=COALESCE(cleaned_at,?) WHERE note_id=?',
                           (now(), note_id))
        return {'id': note_id, 'document_id': identifier, 'purged': True, 'files_removed': True}

    def resume_pending(self):
        with self.store.connection() as db:
            rows = db.execute('SELECT document_id,note_id FROM purged_notes WHERE cleaned_at IS NULL LIMIT 100').fetchall()
        for row in rows:
            try:
                self.cleanup(row['document_id'], row['note_id'])
            except WorkspaceError:
                pass  # An explicit retry or next startup can finish inaccessible file cleanup.
