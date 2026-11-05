"""Persisted continuous translation runs over the existing exclusive worker.

A run is a persisted authorization, not a second executor and not an Agent task.
Only the existing ``WorkerLease``-protected translation worker advances it, and
every unit of model work is still an ordinary translation job.  New children are
created with exactly one page so the legacy five-page/eight-call budget cannot
be exhausted by a dense batch.  Browser reads never create children.

Completed pages are mapped once from their actual source job/page.  An exactly
compatible completed page from any earlier legacy or run job may be reused
without model work; failed, unavailable and partial outcomes are never promoted
to success.  A child that ends without any page result stops the run until an
explicit resume creates a fresh attempt for the still-missing pages only.
"""
from __future__ import annotations

import json
from uuid import UUID, uuid5

from .agent_provider import ModelConnection
from .agent_store import canonical, digest, now
from .library import read_metadata
from .models import WorkspaceError
from .translation import (
    PARSER_ID, PARSER_VERSION, PROMPT_VERSION, RESULT_SCHEMA_VERSION, verified_source,
)
from .translation_sentences import PROMPT_VERSIONS

ACTIVE = ('queued', 'running')
# ``partial`` is a finished attempt with untranslated/failed pages.  An explicit
# continue is allowed and retries only noncompleted pages; it never retries on
# its own after reaching partial.
RESUMABLE = ('paused', 'failed', 'interrupted', 'partial')


class TranslationRuns:
    """Run metadata, control receipts, page map and one-page child lifecycle."""

    def __init__(self, translations):
        self.translations = translations
        self.store = translations.store

    # ------------------------------------------------------------- serializing
    @staticmethod
    def pages_of(row):
        return json.loads(row['pages_json'])

    def public(self, row, result_pages=None):
        return {
            'id': row['id'], 'document_id': row['document_id'],
            'source_sha256': row['source_sha256'],
            'pages': self.pages_of(row),
            'target_language': row['target_language'],
            'status': row['status'], 'stage': row['stage'],
            'revision': row['revision'],
            'total_pages': row['total_pages'],
            'processed_pages': row['processed_pages'],
            'completed_pages': row['completed_pages'],
            'reused_pages': row['reused_pages'],
            'active_job_id': row['active_job_id'],
            'created_at': row['created_at'], 'updated_at': row['updated_at'],
            'error': json.loads(row['error_json']) if row['error_json'] else None,
            'parser': {'id': row['parser_id'], 'version': row['parser_version']},
            'model': {'name': row['model_name']},
            'model_fingerprint': row['model_fingerprint'],
            'prompt_version': row['prompt_version'],
            'result_schema_version': row['result_schema_version'],
            'result_pages': result_pages or [],
        }

    @staticmethod
    def row(connection, identifier):
        row = connection.execute('SELECT * FROM translation_runs WHERE id=?', (identifier,)).fetchone()
        return dict(row) if row is not None else None

    def _row(self, connection, identifier):
        row = self.row(connection, identifier)
        if row is None:
            raise WorkspaceError('not_found', '找不到这次整篇翻译。', 404)
        return row

    # ------------------------------------------------------------------ reads
    def list(self, document_id, limit=20):
        limit = max(1, min(int(limit), 20))
        with self.store.connection() as connection:
            read_metadata(connection, document_id)
            rows = connection.execute(
                'SELECT * FROM translation_runs WHERE document_id=? '
                'ORDER BY created_at DESC,id DESC LIMIT ?', (document_id, limit)).fetchall()
        return [self.public(row) for row in rows]

    def get(self, identifier, page=None):
        """Pure read: metadata, or exactly the requested saved page result."""
        with self.store.connection() as connection:
            connection.execute('BEGIN')
            row = self._row(connection, identifier)
            self.translations.source_in(connection, row)
            pages = self.pages_of(row)
            result = None
            if page is not None:
                if type(page) is not int or page not in pages:
                    raise WorkspaceError('invalid_page', '所选页码不在这次翻译的授权范围内。', 422)
                result = self.page_result(connection, identifier, page)
        return self.public(row, [result] if result is not None else [])

    @staticmethod
    def page_result(connection, run_id, page):
        row = connection.execute(
            'SELECT rp.page,rp.job_id,p.status,p.warning,p.blocks_json '
            'FROM translation_run_pages rp '
            'JOIN translation_pages p ON p.job_id=rp.job_id AND p.page=rp.page '
            'WHERE rp.run_id=? AND rp.page=?', (run_id, page)).fetchone()
        if row is None:
            return None
        return {'page': row['page'], 'status': row['status'], 'warning': row['warning'],
                'blocks': json.loads(row['blocks_json']), 'job_id': row['job_id']}

    # --------------------------------------------------------------- creation
    def create(self, document_id, payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            owner = read_metadata(connection, document_id)
            row, created = self.create_in(connection, document_id, owner, payload)
        if created:
            self.translations.notify()
        return self.get(row['id']), created

    def create_in(self, connection, document_id, owner, payload):
        identifier = str(payload.request_id)
        fingerprint = digest({'document_id': document_id,
                              'source_sha256': payload.source_sha256,
                              'pages': payload.pages,
                              'target_language': payload.target_language})
        old = self.row(connection, identifier)
        if old is not None:
            if old['document_id'] != document_id or old['request_hash'] != fingerprint:
                raise WorkspaceError('idempotency_conflict',
                                     '这次整篇翻译请求与已有记录冲突，请重新打开资料后发起新任务。', 409)
            self.translations.source_in(connection, old)
            return old, False
        if owner.get('kind') == 'study' or not owner.get('sha256'):
            raise WorkspaceError('source_has_no_pdf', '研究没有可翻译的 PDF 原文件，请打开实际关联文献。', 409)
        if payload.source_sha256 != owner['sha256']:
            raise WorkspaceError('source_changed', '这份资料已更换版本，请重新打开后再翻译。', 409)
        page_count = owner.get('page_count')
        if not isinstance(page_count, int) or any(page > page_count for page in payload.pages):
            raise WorkspaceError('invalid_page', '所选页码超出了这份资料的范围。', 422)
        if connection.execute("SELECT 1 FROM translation_runs WHERE status IN ('queued','running') "
                              "LIMIT 1").fetchone() is not None:
            raise WorkspaceError('translation_run_busy',
                                 '已有整篇翻译在进行，请等待完成或暂停后再发起。', 409)
        ready = self.translations.capabilities()
        if not ready['ready']:
            raise WorkspaceError('translation_not_ready', ready['reason'] or '翻译环境尚未就绪。', 409)
        config, _ = self.translations.provider.config()
        name, model_fingerprint = self.translations.model_identity(config)
        stamp = now()
        connection.execute(
            'INSERT INTO translation_runs (id,document_id,source_sha256,pages_json,target_language,'
            'request_hash,status,stage,revision,total_pages,processed_pages,completed_pages,'
            'reused_pages,active_job_id,parser_id,parser_version,prompt_version,'
            'result_schema_version,model_name,model_fingerprint,error_json,created_at,updated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (identifier, document_id, payload.source_sha256, canonical(payload.pages),
             payload.target_language, fingerprint, 'queued', 'queued', 1, len(payload.pages),
             0, 0, 0, None, PARSER_ID, PARSER_VERSION, PROMPT_VERSION,
             RESULT_SCHEMA_VERSION, name, model_fingerprint, None, stamp, stamp))
        return self.row(connection, identifier), True

    # ---------------------------------------------------------------- control
    def pause(self, identifier, payload):
        return self.control(identifier, 'pause', payload)

    def resume(self, identifier, payload):
        return self.control(identifier, 'resume', payload)

    def control(self, identifier, action, payload):
        if action not in ('pause', 'resume'):
            raise ValueError('Unknown run control action')
        body = {'run_id': identifier, 'action': action,
                'payload': payload.model_dump(mode='json')}
        fingerprint = digest(body)
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row = self._row(connection, identifier)
            self.translations.source_in(connection, row)
            previous = connection.execute(
                'SELECT * FROM translation_run_operations WHERE request_id=?',
                (str(payload.request_id),)).fetchone()
            if previous is not None:
                if (previous['run_id'], previous['action'], previous['payload_hash']) != (
                        identifier, action, fingerprint):
                    raise WorkspaceError('idempotency_conflict',
                                         '这次控制请求编号已用于其他操作，请刷新后重试。', 409)
                # The receipt is the historic outcome of this operation, not
                # authority to rewind the run.  A later revision may have
                # resumed (or otherwise advanced) it in another tab, so return
                # the current public metadata.  No second mutation or notify.
                current = self._row(connection, identifier)
                self.translations.source_in(connection, current)
                return self.public(current)
            if row['revision'] != payload.expected_revision:
                raise WorkspaceError('translation_run_conflict',
                                     '整篇翻译状态已更新，请刷新后再操作。', 409)
            if action == 'pause':
                row = self.pause_in(connection, row)
            else:
                row = self.resume_in(connection, row)
            result = self.public(row)
            connection.execute(
                'INSERT INTO translation_run_operations VALUES (?,?,?,?,?,?)',
                (str(payload.request_id), identifier, action, fingerprint,
                 canonical(result), now()))
        if action == 'resume':
            self.translations.notify()
        return result

    def pause_in(self, connection, row):
        if row['status'] == 'paused':
            return row
        if row['status'] not in ACTIVE:
            raise WorkspaceError('translation_run_invalid_state',
                                 '这次整篇翻译已经结束，无法暂停。', 409)
        stamp = now()
        if row['active_job_id']:
            connection.execute(
                "UPDATE translation_jobs SET status='cancelled',stage='finished',finished_at=?,"
                "updated_at=? WHERE id=? AND status IN ('queued','running')",
                (stamp, stamp, row['active_job_id']))
        connection.execute(
            "UPDATE translation_runs SET status='paused',error_json=NULL,revision=revision+1,"
            "updated_at=? WHERE id=?", (stamp, row['id']))
        return self._row(connection, row['id'])

    def resume_in(self, connection, row):
        if row['status'] not in RESUMABLE:
            raise WorkspaceError('translation_run_invalid_state',
                                 '这次整篇翻译正在推进或已经结束，无需继续。', 409)
        if connection.execute("SELECT 1 FROM translation_runs WHERE id!=? AND "
                              "status IN ('queued','running') LIMIT 1", (row['id'],)).fetchone():
            raise WorkspaceError('translation_run_busy', '已有整篇翻译在进行，请先暂停后再继续。', 409)
        verified_source(self.store, row['document_id'], row['source_sha256'])
        self.check_identity(row)
        connection.execute("DELETE FROM translation_run_pages WHERE run_id=? AND status!='completed'",
                           (row['id'],))
        counts = self.counts(connection, row['id'])
        stamp = now()
        connection.execute(
            "UPDATE translation_runs SET status='queued',stage='queued',error_json=NULL,"
            "processed_pages=?,completed_pages=?,reused_pages=?,revision=revision+1,updated_at=? "
            "WHERE id=?",
            (counts['processed'], counts['completed'], counts['reused'], stamp, row['id']))
        return self._row(connection, row['id'])

    def recover(self, queued=False, restart=False):
        """Lease-owned startup/shutdown/dead-worker recovery for parent runs.

        Worker startup (``queued=False, restart=False``) interrupts only parents
        that were actually running, cancelling their in-flight/queued linked
        children before any automatic claim: their outcome is uncertain so no
        paid work is resumed silently.  A parent that is still merely queued has
        no child in flight and is left for the existing worker, exactly like a
        manual queued legacy job created by the request that starts that worker.

        Web/supervisor startup (``restart=True``) additionally interrupts
        parents that are still merely queued and cancels their linked children:
        a persisted queued parent is not the on-demand request that starts this
        worker, so it must not auto-resume after a restart.  Legacy manually
        queued jobs remain untouched, exactly as in worker startup.

        Shutdown/dead-worker recovery (``queued=True``) interrupts every active
        parent and cancels its linked children, so the next process cannot run
        work left in an uncertain state.
        """
        states = "('queued','running')" if (queued or restart) else "('running')"
        stamp = now()
        with self.store.connection() as connection:
            connection.execute(
                "UPDATE translation_jobs SET status='cancelled',stage='finished',finished_at=?,"
                "updated_at=? WHERE status IN ('queued','running') AND id IN ("
                "SELECT rj.job_id FROM translation_run_jobs rj JOIN translation_runs r "
                "ON r.id=rj.run_id WHERE r.status IN " + states + ")",
                (stamp, stamp))
            connection.execute(
                "UPDATE translation_runs SET status='interrupted',stage='finished',"
                "error_json=?,updated_at=? WHERE status IN " + states,
                (canonical({'code': 'translation_run_interrupted',
                            'message': '服务中断，已完成的页面结果保留；继续后只重试未完成页面。'}),
                 stamp))

    def worker_unavailable(self, connection):
        """Called from the existing notify failure path, in its transaction."""
        connection.execute(
            "UPDATE translation_runs SET status='failed',stage='finished',error_json=?,updated_at=? "
            "WHERE status='queued'",
            (canonical({'code': 'worker_unavailable',
                        'message': '翻译进程未能启动，请检查运行环境后继续。'}), now()))

    # ----------------------------------------------------------------- worker
    def is_linked(self, job_id):
        """True only for a child created by a run, never for a reused legacy job."""
        with self.store.connection() as connection:
            return connection.execute(
                'SELECT 1 FROM translation_run_jobs WHERE job_id=? AND reused=0 LIMIT 1',
                (job_id,)).fetchone() is not None

    def child_stage(self, job_id, stage):
        """Mirror the actual child parser/model stage onto its running parent."""
        parent = 'parsing' if stage in ('queued', 'parsing') else (
            'translating' if stage == 'translating' else None)
        if parent is None:
            return
        with self.store.connection() as connection:
            row = connection.execute(
                'SELECT run_id FROM translation_run_jobs WHERE job_id=? AND reused=0 LIMIT 1',
                (job_id,)).fetchone()
            if row is None:
                return
            connection.execute(
                "UPDATE translation_runs SET stage=?,updated_at=? WHERE id=? AND status='running'",
                (parent, now(), row['run_id']))

    def advance(self):
        """Exclusive worker hook: reconcile, then create at most one next child."""
        while self.step():
            pass

    def step(self):
        try:
            return self._step()
        except WorkspaceError as error:
            self.fail_active(error)
            return False

    def _step(self):
        with self.store.connection() as connection:
            active = connection.execute(
                "SELECT 1 FROM translation_runs WHERE status IN ('queued','running') LIMIT 1").fetchone()
            if active is None:
                return False
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute(
                "SELECT * FROM translation_runs WHERE status IN ('queued','running') "
                "ORDER BY created_at,id LIMIT 1").fetchone()
            if row is None:
                return False
            row = dict(row)
            if row['active_job_id']:
                job = connection.execute('SELECT * FROM translation_jobs WHERE id=?',
                                         (row['active_job_id'],)).fetchone()
                if job is None:
                    connection.execute('UPDATE translation_runs SET active_job_id=NULL,updated_at=? '
                                       'WHERE id=?', (now(), row['id']))
                    row['active_job_id'] = None
                elif job['status'] in ACTIVE:
                    stage = 'parsing' if job['stage'] in ('queued', 'parsing') else 'translating'
                    if row['stage'] != stage:
                        connection.execute('UPDATE translation_runs SET stage=?,updated_at=? '
                                           'WHERE id=?', (stage, now(), row['id']))
                    return False
                else:
                    # Reconcile in its own committed step so a later identity or
                    # source guard can never roll back an immutable page mapping.
                    row = self.reconcile(connection, row, dict(job))
                    return row['status'] in ACTIVE
            self.translations.source_in(connection, row)
            verified_source(self.store, row['document_id'], row['source_sha256'])
            pages = self.pages_of(row)
            mapped = {item['page'] for item in connection.execute(
                'SELECT page FROM translation_run_pages WHERE run_id=?', (row['id'],))}
            page = next((value for value in pages if value not in mapped), None)
            if page is None:
                self.finalize(connection, row)
                return False
            reused = self.reusable(connection, row, page)
            if reused is not None:
                connection.execute(
                    'INSERT OR IGNORE INTO translation_run_pages '
                    '(run_id,page,job_id,status,reused,mapped_at) VALUES (?,?,?,?,?,?)',
                    (row['id'], page, reused, 'completed', 1, now()))
                self.update_counts(connection, row['id'])
                return True
            self.check_identity(row)
            self.create_child(connection, row, page)
            return False

    def reconcile(self, connection, row, job):
        attempt = connection.execute(
            'SELECT * FROM translation_run_jobs WHERE run_id=? AND job_id=?',
            (row['id'], job['id'])).fetchone()
        page = attempt['page'] if attempt is not None else None
        if page is None:
            pages = json.loads(job['pages_json'])
            page = pages[0] if len(pages) == 1 else None
        result = None
        if page is not None:
            result = connection.execute(
                'SELECT status FROM translation_pages WHERE job_id=? AND page=?',
                (job['id'], page)).fetchone()
        # A terminal child from a superseded control revision may not publish its
        # noncompleted outcome: resume must retry it in a fresh attempt.  A
        # completed page is always immutable and is mapped regardless.
        superseded = (attempt is not None
                      and row['revision'] != attempt['attempt_revision']
                      and (result is None or result['status'] != 'completed'))
        if result is not None and not superseded:
            connection.execute(
                'INSERT OR IGNORE INTO translation_run_pages '
                '(run_id,page,job_id,status,reused,mapped_at) VALUES (?,?,?,?,?,?)',
                (row['id'], page, job['id'], result['status'],
                 1 if attempt is not None and attempt['reused'] else 0, now()))
        if result is None and not superseded:
            code, message = self.child_error(job)
            self.fail_in(connection, row, code, message)
            return self._row(connection, row['id'])
        stamp = now()
        connection.execute(
            'UPDATE translation_runs SET active_job_id=NULL,updated_at=? WHERE id=?',
            (stamp, row['id']))
        self.update_counts(connection, row['id'])
        return self._row(connection, row['id'])

    @staticmethod
    def child_error(job):
        try:
            value = json.loads(job['error_json']) if job['error_json'] else None
        except (TypeError, ValueError):
            value = None
        if isinstance(value, dict):
            code, message = value.get('code'), value.get('message')
            if isinstance(code, str) and code and isinstance(message, str) and message:
                return code[:80], message[:500]
        return ('translation_run_page_failed',
                '本页翻译未能完成，已保留先前完成的页面；继续后只重试未完成页面。')

    def reusable(self, connection, row, page):
        """Newest exactly compatible completed page from all saved history."""
        result = connection.execute(
            "SELECT p.job_id FROM translation_pages p "
            "JOIN translation_jobs j ON j.id=p.job_id "
            "WHERE j.document_id=? AND j.source_sha256=? AND j.target_language=? "
            "AND j.model_fingerprint=? AND j.parser_id=? AND j.parser_version=? "
            "AND j.prompt_version=? AND j.result_schema_version=? "
            "AND p.page=? AND p.status='completed' "
            "ORDER BY j.updated_at DESC,j.created_at DESC,j.id DESC LIMIT 1",
            (row['document_id'], row['source_sha256'], row['target_language'],
             row['model_fingerprint'], row['parser_id'], row['parser_version'],
             row['prompt_version'], row['result_schema_version'], page)).fetchone()
        return result['job_id'] if result is not None else None

    def check_identity(self, row):
        if (row['parser_id'], row['parser_version'], row['result_schema_version']) != (
                PARSER_ID, PARSER_VERSION, RESULT_SCHEMA_VERSION):
            raise WorkspaceError('translation_parser_changed',
                                 '翻译解析或结果版本已更新，请重新发起整篇翻译。', 409)
        # The prompt version is frozen per row: a legacy v1 run continues with
        # its original block behaviour and is never silently upgraded.
        if row['prompt_version'] not in PROMPT_VERSIONS:
            raise WorkspaceError('translation_parser_changed',
                                 '翻译结果版本已更新，请重新发起整篇翻译。', 409)
        config, _ = self.translations.provider.config()
        try:
            ModelConnection.validate(config)
        except WorkspaceError as error:
            raise WorkspaceError('translation_run_not_ready', error.message, 409) from None
        name, fingerprint = self.translations.model_identity(config)
        if (name, fingerprint) != (row['model_name'], row['model_fingerprint']):
            raise WorkspaceError('translation_model_changed',
                                 '模型连接已更改，请核对已有结果后重新发起整篇翻译。', 409)

    def create_child(self, connection, row, page):
        identifier = str(uuid5(UUID(row['id']),
                               f'translation-run-child:{row["revision"]}:{page}'))
        existing = connection.execute('SELECT * FROM translation_jobs WHERE id=?',
                                      (identifier,)).fetchone()
        if existing is None:
            stamp = now()
            connection.execute(
                'INSERT INTO translation_jobs (id,document_id,source_sha256,target_language,'
                'pages_json,request_hash,status,stage,parser_id,parser_version,prompt_version,'
                'result_schema_version,model_name,model_fingerprint,completed_pages,total_pages,'
                'error_json,created_at,started_at,updated_at,finished_at) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (identifier, row['document_id'], row['source_sha256'], row['target_language'],
                 canonical([page]), digest({'run_id': row['id'], 'revision': row['revision'],
                                            'page': page}), 'queued', 'queued',
                 row['parser_id'], row['parser_version'], row['prompt_version'],
                 row['result_schema_version'], row['model_name'], row['model_fingerprint'],
                 0, 1, None, stamp, None, stamp, None))
        else:
            self.verify_child(existing, row, page)
            if existing['status'] not in ACTIVE:
                raise WorkspaceError('translation_run_conflict',
                                     '翻译子任务状态已改变，请刷新后继续。', 409)
        association = connection.execute(
            'SELECT * FROM translation_run_jobs WHERE run_id=? AND job_id=?',
            (row['id'], identifier)).fetchone()
        if association is None:
            connection.execute(
                'INSERT INTO translation_run_jobs VALUES (?,?,?,?,?,?)',
                (row['id'], identifier, page, row['revision'], 0, now()))
        elif (association['page'], association['attempt_revision'], association['reused']) != (
                page, row['revision'], 0):
            raise WorkspaceError('translation_run_conflict',
                                 '翻译子任务关联已改变，请刷新后继续。', 409)
        connection.execute(
            "UPDATE translation_runs SET status='running',stage='parsing',active_job_id=?,"
            "updated_at=? WHERE id=? AND status IN ('queued','running')",
            (identifier, now(), row['id']))

    @staticmethod
    def verify_child(existing, row, page):
        expected = (row['document_id'], row['source_sha256'], row['target_language'],
                    row['parser_id'], row['parser_version'], row['prompt_version'],
                    row['result_schema_version'], row['model_name'], row['model_fingerprint'],
                    1)
        actual = (existing['document_id'], existing['source_sha256'],
                  existing['target_language'], existing['parser_id'],
                  existing['parser_version'], existing['prompt_version'],
                  existing['result_schema_version'], existing['model_name'],
                  existing['model_fingerprint'], existing['total_pages'])
        if actual != expected or json.loads(existing['pages_json']) != [page]:
            raise WorkspaceError('translation_run_conflict',
                                 '翻译子任务身份不一致，请刷新后继续。', 409)

    def finalize(self, connection, row):
        counts = self.counts(connection, row['id'])
        if counts['processed'] >= row['total_pages'] and counts['completed'] == row['total_pages']:
            status, error = 'completed', None
        elif counts['processed'] >= row['total_pages']:
            status, error = 'partial', {'code': 'translation_run_incomplete',
                                        'message': '部分页面未能翻译，已保留可用结果，并标出了缺页。'}
        else:
            raise WorkspaceError('translation_run_incomplete_state',
                                 '整篇翻译的页面状态不完整，请继续后只重试未完成页面。', 409)
        connection.execute(
            'UPDATE translation_runs SET status=?,stage=?,processed_pages=?,completed_pages=?,'
            'reused_pages=?,active_job_id=NULL,error_json=?,updated_at=? WHERE id=?',
            (status, 'finished', counts['processed'], counts['completed'],
             counts['reused'], canonical(error) if error else None, now(), row['id']))

    def fail_active(self, error):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute(
                "SELECT * FROM translation_runs WHERE status IN ('queued','running') "
                "ORDER BY created_at,id LIMIT 1").fetchone()
            if row is None:
                return
            self.fail_in(connection, dict(row), error.code, error.message, cancel=True)

    def fail_in(self, connection, row, code, message, cancel=False):
        stamp = now()
        if cancel and row['active_job_id']:
            connection.execute(
                "UPDATE translation_jobs SET status='cancelled',stage='finished',finished_at=?,"
                "updated_at=? WHERE id=? AND status IN ('queued','running')",
                (stamp, stamp, row['active_job_id']))
        counts = self.counts(connection, row['id'])
        connection.execute(
            "UPDATE translation_runs SET status='failed',stage='finished',active_job_id=NULL,"
            "processed_pages=?,completed_pages=?,reused_pages=?,error_json=?,updated_at=? "
            "WHERE id=? AND status IN ('queued','running')",
            (counts['processed'], counts['completed'], counts['reused'],
             canonical({'code': str(code)[:80], 'message': str(message)[:500]}),
             stamp, row['id']))

    def update_counts(self, connection, run_id):
        counts = self.counts(connection, run_id)
        connection.execute(
            'UPDATE translation_runs SET processed_pages=?,completed_pages=?,reused_pages=? '
            'WHERE id=?',
            (counts['processed'], counts['completed'], counts['reused'], run_id))

    @staticmethod
    def counts(connection, run_id):
        row = connection.execute(
            "SELECT COUNT(*) AS processed,"
            "COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed,"
            "COALESCE(SUM(CASE WHEN reused=1 THEN 1 ELSE 0 END),0) AS reused "
            "FROM translation_run_pages WHERE run_id=?", (run_id,)).fetchone()
        return {'processed': int(row['processed']), 'completed': int(row['completed']),
                'reused': int(row['reused'])}
