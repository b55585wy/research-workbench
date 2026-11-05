"""Confirmed paper erasure with a body-free, retryable filesystem receipt."""
import hashlib
import json
from pathlib import Path
import sqlite3
import stat
from uuid import UUID

from pydantic import Field

from .library import read_metadata
from .library_lifecycle import PaperTrash, now
from .models import NoteMutation, WorkspaceError

SCHEMA = '''
CREATE TABLE IF NOT EXISTS document_purges (
 document_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 revision INTEGER NOT NULL, preview_sha256 TEXT NOT NULL CHECK(length(preview_sha256)=64),
 manifest_json TEXT NOT NULL, counts_json TEXT NOT NULL,
 created_at TEXT NOT NULL, cleaned_at TEXT
);
'''


class PaperPurgeMutation(NoteMutation):
    preview_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def checksum(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def uuid(value):
    try:
        canonical = str(UUID(value))
        if canonical != value:
            raise ValueError()
        return canonical
    except (ValueError, TypeError, AttributeError):
        raise WorkspaceError('document_purge_unsafe', '资料路径异常，未执行删除。', 409) from None


NOTES = 'note_id IN (SELECT id FROM notes WHERE document_id=?)'
TURNS = 'turn_id IN (SELECT id FROM agent_turns WHERE document_id=?)'
OWNED = 'document_id=?'
# Continuous translation adds four relations plus the run-owned child jobs they
# reference.  Only children created by a run are removed here; independent
# legacy translation jobs keep their existing (unchanged) lifecycle.
RUN = 'run_id IN (SELECT id FROM translation_runs WHERE document_id=?)'
RUN_JOB = ('id IN (SELECT job_id FROM translation_run_jobs WHERE run_id IN '
           '(SELECT id FROM translation_runs WHERE document_id=?))')
RUN_PAGE = ('job_id IN (SELECT job_id FROM translation_run_jobs WHERE run_id IN '
            '(SELECT id FROM translation_runs WHERE document_id=?))')
# Child records precede their parents. Restrictive foreign keys protect other owners.
ERASE = (
    ('translation_run_operations', RUN), ('translation_run_pages', RUN),
    ('translation_run_jobs', RUN), ('translation_runs', OWNED),
    ('translation_pages', RUN_PAGE), ('translation_jobs', RUN_JOB),
    ('agent_task_operations', 'task_id IN (SELECT id FROM agent_tasks WHERE document_id=?)'),
    ('agent_tasks', OWNED), ('agent_proposals', TURNS), ('agent_events', TURNS),
    ('agent_turns', OWNED), ('agent_conversations', OWNED),
    ('chart_operations', 'chart_id IN (SELECT id FROM charts WHERE document_id=?)'),
    ('charts', OWNED), ('data_imports', OWNED), ('dataset_selections', OWNED),
    ('analysis_jobs', OWNED), ('datasets', OWNED),
    ('image_annotation_operations', 'annotation_id IN (SELECT id FROM image_annotations WHERE document_id=?)'),
    ('image_annotations', OWNED), ('image_note_requests', OWNED), ('note_images', NOTES),
    ('note_operations', NOTES), ('note_rich_content', NOTES), ('note_text_annotations', NOTES),
    ('note_shape_annotations', NOTES), ('note_mastery', NOTES), ('study_note_sources', NOTES), ('purged_notes', OWNED), ('note_states', NOTES),
    ('excerpts', NOTES), ('image_assets', OWNED), ('notes', OWNED), ('document_operations', OWNED),
    ('document_trash', OWNED), ('document_metadata', OWNED), ('documents', 'id=?'),
)


class PaperPurge:
    def __init__(self, store):
        self.store = store

    def owner(self, db, identifier):
        current = read_metadata(db, identifier, include_trashed=True)
        if current.get('kind') == 'study':
            raise WorkspaceError('paper_required', '此操作只适用于论文。', 409)
        if not db.execute('SELECT 1 FROM document_trash WHERE document_id=?', (identifier,)).fetchone():
            raise WorkspaceError('document_not_deleted', '请先将文献移入回收站。', 409)
        PaperTrash.ensure_idle(db, identifier)
        return current

    def preview(self, identifier):
        with self.store.connection() as db:
            db.execute('BEGIN')
            current = self.owner(db, identifier)
            plan = self.plan(db, identifier)
        return {'id': identifier, 'title': current['title'],
                'expected_revision': current['revision'], 'preview_sha256': plan['sha256'],
                'counts': plan['counts'], 'excluded': ['exported_copies', 'backups']}

    def plan(self, db, identifier):
        rows = {table: [dict(row) for row in db.execute(
            f'SELECT * FROM {table} WHERE {where} ORDER BY 1', (identifier,))]
            for table, where in ERASE}
        manifest = self.manifest(identifier, rows)
        counts = {name: len(rows[table]) for name, table in (
            ('notes', 'notes'), ('images', 'image_assets'), ('datasets', 'datasets'),
            ('analyses', 'analysis_jobs'), ('charts', 'charts'), ('imports', 'data_imports'),
            ('conversations', 'agent_conversations'))}
        counts.update(files=sum(item.get('exists', False) for item in manifest if item['kind'] == 'file'),
                      bytes=sum(item.get('bytes', 0) for item in manifest),
                      missing_files=sum(not item['exists'] and not item.get('optional', False)
                                        for item in manifest if item['kind'] == 'file'))
        serializable = {table: [{key: value.hex() if isinstance(value, bytes) else value
                                for key, value in row.items()} for row in records]
                        for table, records in rows.items()}
        return {'manifest': manifest, 'counts': counts,
                'sha256': checksum({'rows': serializable, 'manifest': manifest})}

    def path(self, relative, identifier):
        parts = Path(relative).parts
        if not parts or Path(relative).is_absolute() or any(part in ('.', '..') for part in parts):
            self.unsafe()
        folder = parts[0]
        if folder == 'documents':
            valid = len(parts) == 2 and parts[1] == identifier + '.pdf'
        elif folder == 'analyses':
            valid = len(parts) >= 2 and uuid(parts[1]) == parts[1]
        else:
            suffixes = {'excerpts': ('.png',), 'images': ('.original', '.preview'),
                        'datasets': ('.data',), 'selection-cache': ('.csv',),
                        'data-imports': ('.source', '.tsv')}
            valid = folder in suffixes and len(parts) == 2 and Path(parts[1]).suffix in suffixes[folder]
            if valid:
                uuid(Path(parts[1]).stem)
        if not valid:
            self.unsafe()
        target = self.store.root.joinpath(*parts)
        current = self.store.root
        for part in ('', *parts):
            current = current / part
            try:
                info = current.lstat()
            except FileNotFoundError:
                continue
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                self.unsafe()
        if not target.resolve().is_relative_to(self.store.root):
            self.unsafe()
        return target

    @staticmethod
    def unsafe():
        raise WorkspaceError('document_purge_unsafe', '资料路径异常，未执行删除。', 409)

    def entry(self, relative, kind, identifier):
        path = self.path(relative, identifier)
        result = {'path': relative, 'kind': kind, 'exists': False}
        try:
            info = path.lstat()
        except FileNotFoundError:
            return result
        if (kind == 'file' and not stat.S_ISREG(info.st_mode)) or (kind == 'dir' and not stat.S_ISDIR(info.st_mode)):
            self.unsafe()
        result['exists'] = True
        if kind == 'file':
            result.update(bytes=info.st_size, modified=info.st_mtime_ns)
        return result

    def tree(self, relative, identifier):
        root = self.entry(relative, 'dir', identifier)
        items = [root]
        if not root['exists']:
            return items
        pending = [relative]
        while pending:
            parent = pending.pop()
            for path in sorted(self.path(parent, identifier).iterdir()):
                name = path.relative_to(self.store.root).as_posix()
                checked = self.path(name, identifier)
                kind = 'dir' if checked.is_dir() else 'file'
                items.append(self.entry(name, kind, identifier))
                if kind == 'dir':
                    pending.append(name)
                if len(items) > 20000:
                    raise WorkspaceError('document_purge_too_large', '清理文件数量过多，请检查分析目录。', 409)
        return items

    def manifest(self, identifier, rows):
        excerpt_ids = {row['note_id'] for row in rows['excerpts']}
        selection_ids = {row['dataset_id'] for row in rows['dataset_selections']}
        names = [('documents/' + uuid(identifier) + '.pdf', False)]
        names += [('excerpts/' + uuid(row['id']) + '.png', row['id'] not in excerpt_ids)
                  for row in rows['notes']]
        for row in rows['image_assets']:
            names.extend(('images/' + uuid(row['storage_key']) + suffix, False) for suffix in ('.original', '.preview'))
        for row in rows['datasets']:
            key = uuid(row['storage_key'])
            names.extend(((f'datasets/{key}.data', row['id'] in selection_ids), (f'selection-cache/{key}.csv', True)))
        for row in rows['data_imports']:
            names.extend(('data-imports/' + uuid(row['storage_key']) + suffix, False) for suffix in ('.source', '.tsv'))
        try:
            result = [{**self.entry(name, 'file', identifier), 'optional': optional} for name, optional in names]
            for row in rows['analysis_jobs']:
                result.extend(self.tree('analyses/' + uuid(row['id']), identifier))
            return sorted(result, key=lambda item: item['path'])
        except OSError:
            raise WorkspaceError('storage_unavailable', '无法检查文献文件，请稍后重试。', 503) from None

    def purge(self, identifier, payload):
        body = {'document_id': identifier, **payload.model_dump(mode='json')}
        digest = checksum(body)
        try:
            with self.store.connection() as db:
                db.execute('BEGIN IMMEDIATE')
                receipt = db.execute('SELECT * FROM document_purges WHERE document_id=? OR request_id=?',
                                     (identifier, str(payload.request_id))).fetchone()
                if receipt:
                    self.repeat(receipt, identifier, payload, digest)
                else:
                    self.erase(db, identifier, payload, digest)
        except sqlite3.IntegrityError:
            raise WorkspaceError('document_in_use', '资料仍被其他记录引用，未执行删除。', 409) from None
        return self.cleanup(identifier)

    @staticmethod
    def repeat(receipt, identifier, payload, digest):
        if (receipt['document_id'], receipt['request_id'], receipt['payload_hash']) != (
                identifier, str(payload.request_id), digest):
            raise WorkspaceError('idempotency_conflict', '删除请求与原确认不一致，请重试原请求。', 409)

    def erase(self, db, identifier, payload, digest):
        current = self.owner(db, identifier)
        if current['revision'] != payload.expected_revision:
            raise WorkspaceError('revision_conflict', '文献状态已改变，请重新查看清理预览。', 409)
        plan = self.plan(db, identifier)
        if plan['sha256'] != payload.preview_sha256:
            raise WorkspaceError('document_purge_changed', '关联资料已改变，请重新查看清理预览。', 409)
        db.execute('INSERT INTO document_purges VALUES (?,?,?,?,?,?,?,?,NULL)',
                   (identifier, str(payload.request_id), digest, current['revision'], plan['sha256'],
                    encoded(plan['manifest']), encoded(plan['counts']), now()))
        for table, where in ERASE:
            db.execute(f'DELETE FROM {table} WHERE {where}', (identifier,))

    def cleanup(self, identifier):
        with self.store.connection() as db:
            receipt = db.execute('SELECT * FROM document_purges WHERE document_id=?', (identifier,)).fetchone()
        if receipt is None:
            raise WorkspaceError('not_found', '找不到删除记录。', 404)
        if receipt['cleaned_at'] is None:
            try:
                self.remove_files(identifier, json.loads(receipt['manifest_json']))
            except (OSError, WorkspaceError):
                raise WorkspaceError('document_purge_pending', '文献已移除，文件清理尚未完成，请重试清理。', 503) from None
            with self.store.connection() as db:
                db.execute('UPDATE document_purges SET cleaned_at=COALESCE(cleaned_at,?) WHERE document_id=?',
                           (now(), identifier))
        return {'id': identifier, 'purged': True, 'files_removed': True}

    def remove_files(self, identifier, manifest):
        entries = {item['path']: item['kind'] for item in manifest}
        # Collect late worker leftovers only within registered, exclusively owned job directories.
        roots = [name for name, kind in entries.items() if kind == 'dir' and len(Path(name).parts) == 2]
        for root in roots:
            entries.update((item['path'], item['kind']) for item in self.tree(root, identifier))
        for name in sorted(entries, key=lambda value: (len(Path(value).parts), value), reverse=True):
            path = self.path(name, identifier)
            if entries[name] == 'file':
                path.unlink(missing_ok=True)
            else:
                try:
                    path.rmdir()
                except FileNotFoundError:
                    pass

    def pending(self, db):
        result = []
        for row in db.execute('SELECT * FROM document_purges WHERE cleaned_at IS NULL ORDER BY created_at DESC'):
            result.append({'id': row['document_id'], 'revision': row['revision'],
                           'deleted_at': row['created_at'], 'purge_pending': True,
                           'purge_request': {'request_id': row['request_id'],
                                             'expected_revision': row['revision'],
                                             'preview_sha256': row['preview_sha256']},
                           'counts': json.loads(row['counts_json'])})
        return result

    def resume_pending(self):
        with self.store.connection() as db:
            identifiers = [row[0] for row in db.execute(
                'SELECT document_id FROM document_purges WHERE cleaned_at IS NULL LIMIT 100')]
        for identifier in identifiers:
            try:
                self.cleanup(identifier)
            except WorkspaceError:
                pass  # Keep visible pending rows until an explicit retry or later startup succeeds.
