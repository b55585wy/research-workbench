"""Singleton personal data owner and read-only saved-data catalog.

The personal owner is an internal study owner with no PDF, created only by an
explicit user request.  The catalog reads saved rows and ownership metadata; it
never reads source files, validates payloads, starts workers or mutates state.
"""
import base64
from datetime import datetime
import json
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict

from .library import read_metadata
from .models import WorkspaceError
from .store import timestamp
from .studies import PERSONAL_ROLE, identity

PERSONAL_SLOT = 'personal'
PERSONAL_NAME = '我的数据'
PERSONAL_QUESTION = '个人分析资料，不预设研究问题。'
KINDS = ('dataset', 'analysis', 'chart')
CURSOR_VERSION = 1
MAX_CURSOR = 2048
MAX_QUERY = 200
MIN_LIMIT = 1
MAX_LIMIT = 100
MAX_LIMIT_DEFAULT = 50


def invalid_cursor():
    return WorkspaceError('invalid_cursor', '列表位置已失效，请刷新后重试。', 400)


def like_pattern(value):
    escaped = value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return '%' + escaped + '%'


OWNER_CASE = """CASE WHEN p.slot IS NOT NULL THEN 'personal'
        WHEN d.page_count IS NULL THEN 'project' ELSE 'paper' END"""

CATALOG = {
    'dataset': {
        'select': f'''SELECT 'dataset' AS kind,ds.id AS id,ds.document_id AS document_id,
            m.title AS owner_title,{OWNER_CASE} AS owner_kind,ds.original_filename AS title,
            ds.created_at AS created_at,ds.sha256 AS sha256
            FROM datasets ds
            JOIN documents d ON d.id=ds.document_id
            JOIN document_metadata m ON m.document_id=d.id
            LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
            WHERE NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)''',
        'match': "ds.original_filename LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\'",
        'order_column': 'ds.created_at',
        'id_column': 'ds.id',
        'order': 'ds.created_at DESC,ds.id DESC',
    },
    'analysis': {
        'select': f'''SELECT 'analysis' AS kind,j.id AS id,j.document_id AS document_id,
            m.title AS owner_title,{OWNER_CASE} AS owner_kind,ds.original_filename AS title,
            j.created_at AS created_at,j.dataset_id AS dataset_id,j.status AS status,
            COALESCE(json_extract(j.payload_json,'$.engine'),'') AS engine,
            COALESCE(json_extract(j.payload_json,'$.method'),'describe') AS method
            FROM analysis_jobs j
            JOIN datasets ds ON ds.id=j.dataset_id AND ds.document_id=j.document_id
            JOIN documents d ON d.id=j.document_id
            JOIN document_metadata m ON m.document_id=d.id
            LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
            WHERE NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)''',
        'match': "ds.original_filename LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\'",
        'order_column': 'j.created_at',
        'id_column': 'j.id',
        'order': 'j.created_at DESC,j.id DESC',
    },
    'chart': {
        'select': f'''SELECT 'chart' AS kind,c.id AS id,c.document_id AS document_id,
            m.title AS owner_title,{OWNER_CASE} AS owner_kind,
            COALESCE(json_extract(c.spec_json,'$.title'),'') AS title,
            c.created_at AS created_at,c.dataset_id AS dataset_id,c.revision AS revision
            FROM charts c
            JOIN documents d ON d.id=c.document_id
            JOIN document_metadata m ON m.document_id=d.id
            LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
            WHERE c.deleted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)''',
        'match': "COALESCE(json_extract(c.spec_json,'$.title'),'') LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\'",
        'order_column': 'c.created_at',
        'id_column': 'c.id',
        'order': 'c.created_at DESC,c.id DESC',
    },
}


class PersonalCreate(BaseModel):
    """The request body must be the exact empty JSON object."""
    model_config = ConfigDict(extra='forbid')


class DataWorkspace:
    def __init__(self, store):
        self.store = store

    def personal(self):
        with self.store.connection() as connection:
            if not connection.in_transaction: connection.execute('BEGIN')
            return self.personal_in(connection)

    def personal_in(self, connection):
        row = connection.execute('SELECT document_id FROM personal_analysis_owner WHERE slot=?',
                                 (PERSONAL_SLOT,)).fetchone()
        if row is None: return None
        identifier = row['document_id']
        try:
            record = read_metadata(connection, identifier)
        except WorkspaceError:
            raise WorkspaceError('personal_workspace_changed',
                                 '个人数据工作区记录不完整，请检查数据目录。', 409) from None
        if (record.get('kind') != 'study' or record.get('workspace_role') != PERSONAL_ROLE
                or record.get('title') != PERSONAL_NAME
                or record.get('question') != PERSONAL_QUESTION):
            raise WorkspaceError('personal_workspace_changed',
                                 '个人数据工作区记录不完整，请检查数据目录。', 409)
        return record

    def ensure_personal(self):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            existing = connection.execute('SELECT document_id FROM personal_analysis_owner WHERE slot=?',
                                           (PERSONAL_SLOT,)).fetchone()
            if existing is not None: return self.personal_in(connection), False
            identifier = str(uuid4())
            checksum = identity(identifier, PERSONAL_NAME, PERSONAL_QUESTION)
            created = timestamp()
            connection.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',
                               (identifier, PERSONAL_NAME, None, None, None, None, created))
            connection.execute('INSERT INTO studies VALUES (?,?,?,?)',
                               (identifier, PERSONAL_QUESTION, checksum, created))
            connection.execute('INSERT INTO personal_analysis_owner VALUES (?,?)',
                               (PERSONAL_SLOT, identifier))
            return self.personal_in(connection), True

    def catalog(self, kind, limit, cursor=None, q=''):
        if kind not in KINDS:
            raise WorkspaceError('invalid_catalog_kind', '请选择数据、分析或图表列表。', 422)
        if not isinstance(limit, int) or not MIN_LIMIT <= limit <= MAX_LIMIT:
            raise WorkspaceError('invalid_catalog_limit', '每次加载数量需在 1 到 100 之间。', 422)
        query = (q or '').strip()
        if len(query) > MAX_QUERY:
            raise WorkspaceError('invalid_catalog_query', '搜索内容过长，请缩短后重试。', 422)
        position = self.decode_cursor(cursor, kind, query) if cursor else None
        spec = CATALOG[kind]
        clauses, params = [], []
        if query:
            pattern = like_pattern(query)
            clauses.append('(' + spec['match'] + ')')
            params.extend([pattern, pattern])
        if position is not None:
            clauses.append('(' + spec['order_column'] + '<? OR ('
                           + spec['order_column'] + '=? AND ' + spec['id_column'] + '<?))')
            params.extend([position['created_at'], position['created_at'], position['id']])
        sql = spec['select'] + ''.join(' AND ' + clause for clause in clauses)
        sql += ' ORDER BY ' + spec['order'] + ' LIMIT ?'
        params.append(limit + 1)
        with self.store.connection() as connection:
            if not connection.in_transaction: connection.execute('BEGIN')
            rows = connection.execute(sql, params).fetchall()
        items = [dict(row) for row in rows[:limit]]
        following = len(rows) > limit
        next_cursor = None
        if following:
            last = items[-1]
            next_cursor = self.encode_cursor(kind, query, last['created_at'], last['id'])
        return {'items': items, 'next_cursor': next_cursor}

    @staticmethod
    def encode_cursor(kind, query, created_at, identifier):
        payload = {'v': CURSOR_VERSION, 'kind': kind, 'q': query,
                   'created_at': created_at, 'id': identifier}
        # UTF-8 JSON keeps 200 non-BMP query characters inside the 2048-character
        # cursor bound; ASCII escaping would exceed it.
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':')).encode('utf-8')
        value = base64.urlsafe_b64encode(raw).decode('ascii')
        if len(value) > MAX_CURSOR:
            raise invalid_cursor()
        return value

    def decode_cursor(self, value, kind, query):
        if not isinstance(value, str) or not value or len(value) > MAX_CURSOR:
            raise invalid_cursor()
        try:
            raw = base64.b64decode(value.encode('ascii'), altchars=b'-_', validate=True)
            payload = json.loads(raw.decode('utf-8'))
        except (ValueError, TypeError, UnicodeError):
            raise invalid_cursor() from None
        if (not isinstance(payload, dict) or set(payload) != {'v', 'kind', 'q', 'created_at', 'id'}
                or payload['v'] != CURSOR_VERSION or payload['kind'] != kind
                or payload['q'] != query):
            raise invalid_cursor()
        created, identifier = payload['created_at'], payload['id']
        if (not isinstance(created, str) or not 1 <= len(created) <= 64
                or not isinstance(identifier, str)):
            raise invalid_cursor()
        try:
            datetime.fromisoformat(created)
            canonical_id = str(UUID(identifier))
        except (ValueError, TypeError):
            raise invalid_cursor() from None
        if canonical_id != identifier: raise invalid_cursor()
        return payload
