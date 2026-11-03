"""Non-owning, versioned links from a normal project to existing data/results.

The service reads saved rows and bounded metadata only.  It never copies or
reassigns a source, never runs an analysis, never parses a stored result for
display and never starts or polls the analysis supervisor.  Explicit add is the
only route that verifies source bytes, and it uses the existing side-effect-free
checked helpers.
"""
import base64
from datetime import datetime
import hashlib
import json
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .image_sources import checked_bytes
from .library import read_metadata
from .models import WorkspaceError
from .store import timestamp
from .studies import PERSONAL_ROLE

KINDS = ('dataset', 'analysis', 'chart')
MAX_LINKS = 100
MAX_QUERY = 200
MAX_CURSOR = 2048
MIN_LIMIT = 1
MAX_LIMIT = 50
DEFAULT_LIMIT = 20
CURSOR_VERSION = 1
SUMMARY_LIMIT = 1024 * 1024
CHART_DATA_LIMIT = 4 * 1024 * 1024


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def source_changed():
    return WorkspaceError('source_changed', '来源数据或结果已变化，请移除关联后重新添加。', 409)


def owner_changed():
    return WorkspaceError('owner_changed', '来源归属已变化，请重新检查后添加。', 409)


def invalid_cursor():
    return WorkspaceError('invalid_cursor', '列表位置已失效，请刷新后重试。', 400)


def like_pattern(value):
    escaped = value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return '%' + escaped + '%'


def analysis_caption(connection, document_id, resource_id):
    """Saved-analysis caption from the same bounded SQL expression as listings."""
    row = connection.execute(f'''SELECT {ANALYSIS_CAPTION} AS caption
        FROM analysis_jobs j
        JOIN datasets ds ON ds.id=j.dataset_id AND ds.document_id=j.document_id
        WHERE j.id=? AND j.document_id=?''', (resource_id, document_id)).fetchone()
    return None if row is None else row['caption']


def project(connection, study_id):
    """Require an actual normal project; My data and papers are not projects."""
    record = read_metadata(connection, study_id)
    if record.get('kind') != 'study':
        raise WorkspaceError('project_required', '请选择一个研究项目后再关联数据与结果。', 409)
    if record.get('workspace_role') == PERSONAL_ROLE:
        raise WorkspaceError('personal_workspace_not_project',
                             '个人数据工作区不是研究项目，不能关联数据与结果。', 409)
    return record


def summary_output(outputs):
    """Return the single valid summary.json output descriptor, or None."""
    if not isinstance(outputs, list):
        return None
    found = [item for item in outputs if isinstance(item, dict)
             and item.get('name') == 'summary.json']
    if len(found) != 1:
        return None
    item = found[0]
    checksum = item.get('sha256')
    size = item.get('byte_size')
    if (not isinstance(checksum, str) or len(checksum) != 64
            or any(char not in '0123456789abcdef' for char in checksum)):
        return None
    if type(size) is not int or not 1 <= size <= SUMMARY_LIMIT:
        return None
    return item


OWNER_CASE = """CASE WHEN p.slot IS NOT NULL THEN 'personal'
        WHEN d.page_count IS NULL THEN 'project' ELSE 'paper' END"""
OWNER_HASH = 'CASE WHEN d.page_count IS NULL THEN s.request_hash ELSE d.sha256 END'
OWNER_JOIN = """JOIN documents d ON d.id=ds.document_id
        JOIN document_metadata m ON m.document_id=d.id
        LEFT JOIN studies s ON s.document_id=d.id
        LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
        WHERE NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)"""

OUTPUT_EXPR = "CASE WHEN json_valid(j.outputs_json) THEN j.outputs_json ELSE '[]' END"
OUTPUT_ENTRY = "CASE WHEN entry.type='object' THEN entry.value ELSE '{}' END"
SUMMARY_ENTRY = ("(SELECT entry.value FROM json_each(" + OUTPUT_EXPR
                 + ") AS entry WHERE json_extract(" + OUTPUT_ENTRY
                 + ",'$.name')='summary.json')")
SUMMARY_COUNT = ("(SELECT COUNT(*) FROM json_each(" + OUTPUT_EXPR
                 + ") AS entry WHERE json_extract(" + OUTPUT_ENTRY
                 + ",'$.name')='summary.json')")
SUMMARY_SHA = "json_extract(" + SUMMARY_ENTRY + ",'$.sha256')"
SUMMARY_SIZE = "json_extract(" + SUMMARY_ENTRY + ",'$.byte_size')"

# Bounded, server-derived caption for saved analyses: dataset filename, a
# human-readable method label, the saved engine and the saved creation time.
# All four parts come from existing bounded columns; no payload/result text is
# exposed and no stored record or version hash is modified.
ANALYSIS_METHOD = """CASE json_extract(j.payload_json,'$.method')
    WHEN 'describe' THEN 'Descriptive statistics'
    WHEN 'ttest_independent' THEN 'Independent t-test'
    WHEN 'ttest_paired' THEN 'Paired t-test'
    WHEN 'correlation' THEN 'Correlation'
    ELSE 'Saved analysis' END"""
ANALYSIS_CAPTION = ("ds.original_filename || ' · ' || " + ANALYSIS_METHOD
                    + " || ' · ' || COALESCE(json_extract(j.payload_json,'$.engine'),'')"
                    + " || ' · ' || j.created_at")

CANDIDATES = {
    'dataset': {
        'select': f'''SELECT 'dataset' AS kind,ds.document_id AS document_id,
            ds.id AS resource_id,ds.sha256 AS source_sha256,
            {OWNER_HASH} AS owner_sha256,ds.original_filename AS title,
            m.title AS owner_title,{OWNER_CASE} AS owner_kind,ds.created_at AS created_at
            FROM datasets ds {OWNER_JOIN}
            AND (d.page_count IS NOT NULL OR s.request_hash IS NOT NULL)''',
        'match': "ds.original_filename LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\'",
        'created': 'ds.created_at',
        'id': 'ds.id',
        'order': 'ds.created_at DESC,ds.id DESC',
    },
    'analysis': {
        'select': f'''SELECT 'analysis' AS kind,j.document_id AS document_id,
            j.id AS resource_id,{SUMMARY_SHA} AS source_sha256,
            {OWNER_HASH} AS owner_sha256,{ANALYSIS_CAPTION} AS title,
            m.title AS owner_title,{OWNER_CASE} AS owner_kind,j.created_at AS created_at
            FROM analysis_jobs j
            JOIN datasets ds ON ds.id=j.dataset_id AND ds.document_id=j.document_id
            JOIN documents d ON d.id=j.document_id
            JOIN document_metadata m ON m.document_id=d.id
            LEFT JOIN studies s ON s.document_id=d.id
            LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
            WHERE NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)
            AND (d.page_count IS NOT NULL OR s.request_hash IS NOT NULL)
            AND j.status='succeeded'
            AND {SUMMARY_COUNT}=1
            AND typeof({SUMMARY_SHA})='text' AND length({SUMMARY_SHA})=64
            AND {SUMMARY_SHA} NOT GLOB '*[^0-9a-f]*'
            AND typeof({SUMMARY_SIZE})='integer'
            AND {SUMMARY_SIZE} BETWEEN 1 AND {SUMMARY_LIMIT}''',
        'match': ("(" + ANALYSIS_CAPTION + ") LIKE ? ESCAPE '\\'"
                  " OR m.title LIKE ? ESCAPE '\\'"),
        'created': 'j.created_at',
        'id': 'j.id',
        'order': 'j.created_at DESC,j.id DESC',
    },
    'chart': {
        'select': f'''SELECT 'chart' AS kind,c.document_id AS document_id,
            c.id AS resource_id,c.data_sha256 AS source_sha256,
            {OWNER_HASH} AS owner_sha256,
            COALESCE(json_extract(c.spec_json,'$.title'),'') AS title,
            m.title AS owner_title,{OWNER_CASE} AS owner_kind,c.created_at AS created_at
            FROM charts c
            JOIN documents d ON d.id=c.document_id
            JOIN document_metadata m ON m.document_id=d.id
            LEFT JOIN studies s ON s.document_id=d.id
            LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
            WHERE c.deleted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)
            AND (d.page_count IS NOT NULL OR s.request_hash IS NOT NULL)''',
        'match': ("COALESCE(json_extract(c.spec_json,'$.title'),'') LIKE ? ESCAPE '\\'"
                  " OR m.title LIKE ? ESCAPE '\\'"),
        'created': 'c.created_at',
        'id': 'c.id',
        'order': 'c.created_at DESC,c.id DESC',
    },
}


class ResourceAdd(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    kind: Literal['dataset', 'analysis', 'chart']
    document_id: UUID
    resource_id: UUID
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    owner_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


class ResourceRemove(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


class ProjectResources:
    def __init__(self, store, datasets, analysis, charts):
        self.store, self.datasets, self.analysis, self.charts = store, datasets, analysis, charts

    # ---------------------------------------------------------------- read side

    def list(self, study_id):
        with self.store.connection() as connection:
            if not connection.in_transaction:
                connection.execute('BEGIN')
            project(connection, study_id)
            rows = connection.execute('''SELECT * FROM project_resources WHERE study_id=?
                ORDER BY created_at DESC,id DESC LIMIT ?''', (study_id, MAX_LINKS)).fetchall()
            return {'items': [self.item(connection, row) for row in rows]}

    def candidates(self, study_id, kind, q='', limit=DEFAULT_LIMIT, cursor=None):
        with self.store.connection() as connection:
            if not connection.in_transaction:
                connection.execute('BEGIN')
            project(connection, study_id)
            if kind not in KINDS:
                raise WorkspaceError('invalid_catalog_kind', '请选择数据、分析或图表列表。', 422)
            if not isinstance(limit, int) or not MIN_LIMIT <= limit <= MAX_LIMIT:
                raise WorkspaceError('invalid_catalog_limit', '每次加载数量需在 1 到 50 之间。', 422)
            query = (q or '').strip()
            if len(query) > MAX_QUERY:
                raise WorkspaceError('invalid_catalog_query', '搜索内容过长，请缩短后重试。', 422)
            position = self.decode_cursor(cursor, kind, query) if cursor else None
            spec = CANDIDATES[kind]
            clauses, params = [], []
            if query:
                pattern = like_pattern(query)
                clauses.append('(' + spec['match'] + ')')
                params.extend([pattern, pattern])
            if position is not None:
                clause = ('(' + spec['created'] + '<? OR (' + spec['created'] + '=? AND '
                          + spec['id'] + '<?))')
                clauses.append(clause)
                params.extend([position['created_at'], position['created_at'], position['id']])
            sql = spec['select'] + ''.join(' AND ' + clause for clause in clauses)
            sql += ' ORDER BY ' + spec['order'] + ' LIMIT ?'
            params.append(limit + 1)
            rows = connection.execute(sql, params).fetchall()
        items = [dict(row) for row in rows[:limit]]
        following = len(rows) > limit
        next_cursor = None
        if following:
            last = items[-1]
            next_cursor = self.encode_cursor(kind, query, last['created_at'], last['resource_id'])
        return {'items': items, 'next_cursor': next_cursor}

    def item(self, connection, row):
        """Current labels only when the saved owner/source identity still matches."""
        state = self.owner_state(connection, row['document_id'], row['owner_sha256'],
                                 row['owner_kind'])
        reason = state['reason']
        owner_title = state['title'] if state['ok'] else row['owner_title']
        title = row['title']
        if reason is None:
            current, reason = self.source_state(connection, row['kind'], row['document_id'],
                                                row['resource_id'], row['source_sha256'])
            if reason is None and current:
                title = current
        available = reason is None
        return {
            'id': row['id'],
            'study_id': row['study_id'],
            'kind': row['kind'],
            'document_id': row['document_id'],
            'resource_id': row['resource_id'],
            'source_sha256': row['source_sha256'],
            'owner_sha256': row['owner_sha256'],
            'title': title,
            'owner_title': owner_title,
            'owner_kind': row['owner_kind'],
            'created_at': row['created_at'],
            'available': available,
            'unavailable_reason': reason,
            'url': (f"/?document={row['document_id']}&{row['kind']}={row['resource_id']}"
                    if available else None),
        }

    @staticmethod
    def owner_state(connection, document_id, expected, saved_kind):
        row = connection.execute('''SELECT d.id,d.page_count,d.sha256,
            COALESCE(m.title,d.title) AS title,s.request_hash AS study_hash,p.slot AS personal,
            (SELECT 1 FROM document_trash t WHERE t.document_id=d.id) AS trashed
            FROM documents d
            LEFT JOIN document_metadata m ON m.document_id=d.id
            LEFT JOIN studies s ON s.document_id=d.id
            LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
            WHERE d.id=?''', (document_id,)).fetchone()
        if row is None:
            return {'ok': False, 'reason': 'owner_missing', 'title': None}
        if row['trashed']:
            return {'ok': False, 'reason': 'owner_trashed', 'title': None}
        if row['page_count'] is None:
            kind = 'personal' if row['personal'] is not None else 'project'
            checksum = row['study_hash']
        else:
            kind = 'paper'
            checksum = row['sha256']
        if kind != saved_kind or checksum is None or checksum != expected:
            return {'ok': False, 'reason': 'owner_changed', 'title': None}
        return {'ok': True, 'reason': None, 'title': row['title']}

    @staticmethod
    def source_state(connection, kind, document_id, resource_id, expected):
        """Row/version/lifecycle availability only; no file or result reads."""
        if kind == 'dataset':
            row = connection.execute('''SELECT original_filename,sha256 FROM datasets
                WHERE id=? AND document_id=?''', (resource_id, document_id)).fetchone()
            if row is None:
                return None, 'source_missing'
            if row['sha256'] != expected:
                return None, 'source_changed'
            return row['original_filename'], None
        if kind == 'analysis':
            row = connection.execute(f'''SELECT j.status,j.outputs_json,j.dataset_id,
                ds.original_filename AS dataset_title,{ANALYSIS_CAPTION} AS caption
                FROM analysis_jobs j
                LEFT JOIN datasets ds ON ds.id=j.dataset_id AND ds.document_id=j.document_id
                WHERE j.id=? AND j.document_id=?''', (resource_id, document_id)).fetchone()
            if row is None:
                return None, 'source_missing'
            if row['status'] != 'succeeded':
                return None, 'source_not_succeeded'
            try:
                outputs = json.loads(row['outputs_json'])
            except (TypeError, ValueError):
                return None, 'source_changed'
            item = summary_output(outputs)
            if item is None or item['sha256'] != expected:
                return None, 'source_changed'
            if not row['dataset_title'] or not row['caption']:
                return None, 'source_changed'
            return row['caption'], None
        row = connection.execute('''SELECT spec_json,data_sha256,deleted_at FROM charts
            WHERE id=? AND document_id=?''', (resource_id, document_id)).fetchone()
        if row is None:
            return None, 'source_missing'
        if row['deleted_at'] is not None:
            return None, 'source_deleted'
        if row['data_sha256'] != expected:
            return None, 'source_changed'
        try:
            spec = json.loads(row['spec_json'])
            title = spec.get('title') if isinstance(spec, dict) else None
        except (TypeError, ValueError):
            title = None
        return (title if isinstance(title, str) else None), None

    # --------------------------------------------------------------- write side

    def add(self, study_id, payload):
        fields = payload.model_dump(mode='json')
        request_id = str(payload.request_id)
        signature = digest({'study_id': study_id, 'operation': 'add', 'payload': fields})

        # Receipt first, then an early duplicate check, then source verification.
        with self.store.connection() as connection:
            if not connection.in_transaction:
                connection.execute('BEGIN')
            project(connection, study_id)
            receipt = self.receipt(connection, request_id)
            if receipt is not None:
                return self.replayed(receipt, signature)
            existing = self.link(connection, study_id, fields)
            if existing is not None:
                if existing['source_sha256'] != fields['source_sha256']:
                    raise source_changed()
                if existing['owner_sha256'] != fields['owner_sha256']:
                    raise owner_changed()
            # Non-replay requests always revalidate the live owner/source, even
            # when the same link already exists.
            labels = self.verify(connection, fields, files=True)

        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            project(connection, study_id)
            receipt = self.receipt(connection, request_id)
            if receipt is not None:
                return self.replayed(receipt, signature)
            existing = self.link(connection, study_id, fields)
            if existing is not None:
                if existing['source_sha256'] != fields['source_sha256']:
                    raise source_changed()
                if existing['owner_sha256'] != fields['owner_sha256']:
                    raise owner_changed()
                self.verify(connection, fields, files=False)
                result = self.item(connection, existing)
                self.write_receipt(connection, request_id, study_id, 'add', signature, result)
                return result, False
            # Recheck row identities under the writer lock; file bytes were
            # verified above and are rechecked only by an explicit future add.
            if labels is None:
                labels = self.verify(connection, fields, files=True)
            else:
                self.verify(connection, fields, files=False)
            if connection.execute('SELECT COUNT(*) FROM project_resources WHERE study_id=?',
                                  (study_id,)).fetchone()[0] >= MAX_LINKS:
                raise WorkspaceError('resource_quota', '每项研究最多关联100份数据与结果。', 409)
            created_at = timestamp()
            connection.execute('''INSERT INTO project_resources
                (id,study_id,document_id,kind,resource_id,source_sha256,owner_sha256,
                 title,owner_title,owner_kind,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (
                request_id, study_id, fields['document_id'], fields['kind'],
                fields['resource_id'], fields['source_sha256'], fields['owner_sha256'],
                labels['title'], labels['owner_title'], labels['owner_kind'], created_at))
            row = connection.execute('SELECT * FROM project_resources WHERE id=?',
                                     (request_id,)).fetchone()
            result = self.item(connection, row)
            self.write_receipt(connection, request_id, study_id, 'add', signature, result)
            return result, True

    def remove(self, study_id, link_id, payload):
        fields = payload.model_dump(mode='json')
        request_id = str(payload.request_id)
        signature = digest({'study_id': study_id, 'operation': 'remove', 'id': link_id,
                            'payload': fields})
        with self.store.connection() as connection:
            if not connection.in_transaction:
                connection.execute('BEGIN')
            project(connection, study_id)
            receipt = self.receipt(connection, request_id)
            if receipt is not None:
                return self.replayed(receipt, signature)[0]
            row = self.link_row(connection, study_id, link_id)
            if row is not None and row['source_sha256'] != fields['source_sha256']:
                raise source_changed()
            self.assert_link_scope(connection, study_id, link_id)

        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            project(connection, study_id)
            receipt = self.receipt(connection, request_id)
            if receipt is not None:
                return self.replayed(receipt, signature)[0]
            row = self.link_row(connection, study_id, link_id)
            if row is None:
                self.assert_link_scope(connection, study_id, link_id)
                result = {'id': link_id, 'removed': False}
            else:
                if row['source_sha256'] != fields['source_sha256']:
                    raise source_changed()
                connection.execute('DELETE FROM project_resources WHERE id=? AND study_id=?',
                                   (link_id, study_id))
                result = {'id': link_id, 'removed': True}
            self.write_receipt(connection, request_id, study_id, 'remove', signature, result)
            return result

    # ------------------------------------------------------------- verification

    def verify(self, connection, fields, files=True):
        """Side-effect-free source validation; labels are always server-derived."""
        owner = read_metadata(connection, fields['document_id'])
        if owner.get('kind') == 'study':
            owner_kind = ('personal' if owner.get('workspace_role') == PERSONAL_ROLE
                          else 'project')
            checksum = owner.get('scope_sha256')
        else:
            owner_kind = 'paper'
            checksum = owner.get('sha256')
        if checksum != fields['owner_sha256']:
            raise owner_changed()
        title = None
        if fields['kind'] == 'dataset':
            row = self.datasets.row(connection, fields['document_id'], fields['resource_id'])
            if row['sha256'] != fields['source_sha256']:
                raise source_changed()
            if files:
                self.datasets.checked(row)
            title = row['original_filename']
        elif fields['kind'] == 'analysis':
            row = self.analysis.row(connection, fields['document_id'], fields['resource_id'])
            if row['status'] != 'succeeded':
                raise WorkspaceError('source_not_succeeded', '只有已成功完成的分析可以关联。', 409)
            try:
                outputs = json.loads(row['outputs_json'])
            except (TypeError, ValueError):
                raise source_changed() from None
            item = summary_output(outputs)
            if item is None or item['sha256'] != fields['source_sha256']:
                raise source_changed()
            dataset = self.datasets.row(connection, fields['document_id'], row['dataset_id'])
            try:
                payload = json.loads(row['payload_json'])
            except (TypeError, ValueError):
                raise source_changed() from None
            if not isinstance(payload, dict) or payload.get('dataset_sha256') != dataset['sha256']:
                raise source_changed()
            if files:
                try:
                    data = checked_bytes(self.analysis.directory(row['id']) / 'summary.json',
                                         item['byte_size'], item['sha256'], SUMMARY_LIMIT)
                except WorkspaceError:
                    raise source_changed() from None
                try:
                    saved = json.loads(row['result_json'])
                    if json.loads(data) != saved:
                        raise source_changed()
                except (TypeError, ValueError):
                    raise source_changed() from None
                self.datasets.checked(dataset)
            title = analysis_caption(connection, fields['document_id'], row['id'])
            if title is None:
                raise source_changed()
        else:
            row = self.charts.row(connection, fields['document_id'], fields['resource_id'])
            if row['deleted_at'] is not None:
                raise WorkspaceError('source_deleted', '图表已删除，不能关联。', 409)
            if row['data_sha256'] != fields['source_sha256']:
                raise source_changed()
            try:
                spec = json.loads(row['spec_json'])
            except (TypeError, ValueError):
                raise source_changed() from None
            if not isinstance(spec, dict):
                raise source_changed()
            dataset = self.datasets.row(connection, fields['document_id'], row['dataset_id'])
            if (spec.get('dataset_id') != dataset['id']
                    or spec.get('dataset_sha256') != dataset['sha256']):
                raise source_changed()
            if spec.get('source_sha256') not in (None, fields['owner_sha256']):
                raise owner_changed()
            if files:
                data = connection.execute('SELECT data_bytes FROM charts WHERE id=? AND document_id=?',
                                          (row['id'], fields['document_id'])).fetchone()
                raw = data[0] if data is not None else None
                if (not isinstance(raw, bytes) or not 0 < len(raw) <= CHART_DATA_LIMIT
                        or hashlib.sha256(raw).hexdigest() != row['data_sha256']):
                    raise source_changed()
                self.datasets.checked(dataset)
            title = spec.get('title') if isinstance(spec.get('title'), str) else None
            title = title or dataset['original_filename']
        return {'title': title, 'owner_title': owner['title'], 'owner_kind': owner_kind}

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def link(connection, study_id, fields):
        return connection.execute('''SELECT * FROM project_resources
            WHERE study_id=? AND kind=? AND document_id=? AND resource_id=?''', (
            study_id, fields['kind'], fields['document_id'], fields['resource_id'])).fetchone()

    @staticmethod
    def link_row(connection, study_id, link_id):
        return connection.execute('SELECT * FROM project_resources WHERE id=? AND study_id=?',
                                  (link_id, study_id)).fetchone()

    @staticmethod
    def assert_link_scope(connection, study_id, link_id):
        other = connection.execute('SELECT study_id FROM project_resources WHERE id=?',
                                   (link_id,)).fetchone()
        if other is not None and other['study_id'] != study_id:
            raise WorkspaceError('not_found', '找不到这项关联。', 404)

    @staticmethod
    def receipt(connection, request_id):
        return connection.execute('SELECT * FROM project_resource_operations WHERE request_id=?',
                                  (request_id,)).fetchone()

    @staticmethod
    def replayed(receipt, signature):
        if receipt['request_hash'] != signature:
            raise WorkspaceError('idempotency_conflict',
                                 '操作编号已用于其他请求，请保留原操作记录。', 409)
        try:
            return json.loads(receipt['result_json']), False
        except (TypeError, ValueError):
            raise WorkspaceError('idempotency_conflict', '操作回执无法读取，请刷新后重试。', 409) from None

    @staticmethod
    def write_receipt(connection, request_id, study_id, operation, signature, result):
        connection.execute('''INSERT INTO project_resource_operations
            (request_id,study_id,operation,request_hash,result_json,created_at)
            VALUES (?,?,?,?,?,?)''', (
            request_id, study_id, operation, signature, canonical(result), timestamp()))

    @staticmethod
    def encode_cursor(kind, query, created_at, identifier):
        payload = {'v': CURSOR_VERSION, 'kind': kind, 'q': query,
                   'created_at': created_at, 'id': identifier}
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':')).encode('utf-8')
        value = base64.urlsafe_b64encode(raw).decode('ascii')
        if len(value) > MAX_CURSOR:
            raise invalid_cursor()
        return value

    @staticmethod
    def decode_cursor(value, kind, query):
        if not isinstance(value, str) or not value or len(value) > MAX_CURSOR:
            raise invalid_cursor()
        try:
            raw = base64.b64decode(value.encode('ascii'), altchars=b'-_', validate=True)
            payload = json.loads(raw.decode('utf-8'))
        except (ValueError, TypeError, UnicodeError):
            raise invalid_cursor() from None
        if (not isinstance(payload, dict)
                or set(payload) != {'v', 'kind', 'q', 'created_at', 'id'}
                or payload['v'] != CURSOR_VERSION or payload['kind'] != kind
                or payload['q'] != query):
            raise invalid_cursor()
        created, identifier = payload['created_at'], payload['id']
        if (not isinstance(created, str) or not 1 <= len(created) <= 64
                or not isinstance(identifier, str)):
            raise invalid_cursor()
        try:
            datetime.fromisoformat(created)
            if str(UUID(identifier)) != identifier:
                raise ValueError()
        except (ValueError, TypeError):
            raise invalid_cursor() from None
        return payload
