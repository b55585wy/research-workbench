"""Explicit library references for the reading Agent.

Pinned references are metadata candidates from the existing local library until
the user adds them.  Capture validates the real active owner, exact expected
hash and source integrity, then keeps bounded immutable metadata only.  This
module never writes business records, never creates a personal owner and never
reads unrequested paper pages or dataset profiles.
"""
import base64
from datetime import datetime
import json
import re
from uuid import UUID

from .excerpts import verify_source
from .library import read_metadata
from .models import WorkspaceError
from .studies import PERSONAL_ROLE

MAX_RESOURCE_REFS = 8
MAX_QUERY = 200
MIN_LIMIT = 1
MAX_LIMIT = 50
MAX_LIMIT_DEFAULT = 20
MAX_CURSOR = 2048
CURSOR_VERSION = 1
REFERENCE_SOURCE_KINDS = ('reference_pdf_page', 'reference_dataset_sample')


def invalid_cursor():
    return WorkspaceError('invalid_cursor', '列表位置已失效，请刷新后重试。', 400)


def like_pattern(value):
    escaped = value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return '%' + escaped + '%'


def owner_kind(owner):
    if owner.get('kind') == 'study':
        return 'personal' if owner.get('workspace_role') == PERSONAL_ROLE else 'project'
    return 'paper'


# Metadata catalog.  Papers are active PDF documents only; datasets exclude
# trashed owners.  No private paths, previews, profiles or full text are read.
CATALOG = {
    'paper': {
        'select': '''SELECT 'paper' AS kind,d.id AS id,d.id AS document_id,
            m.title AS title,d.sha256 AS sha256,m.title AS owner_title,
            'paper' AS owner_kind,d.created_at AS created_at,d.page_count AS page_count
            FROM documents d JOIN document_metadata m ON m.document_id=d.id
            WHERE d.page_count IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)''',
        'match': ("m.title LIKE ? ESCAPE '\\' OR m.authors LIKE ? ESCAPE '\\' "
                  "OR m.doi LIKE ? ESCAPE '\\' OR d.original_filename LIKE ? ESCAPE '\\'"),
        'params': 4,
        'order_column': 'd.created_at',
        'id_column': 'd.id',
        'order': 'd.created_at DESC,d.id DESC',
    },
    'dataset': {
        'select': '''SELECT 'dataset' AS kind,ds.id AS id,ds.document_id AS document_id,
            ds.original_filename AS title,ds.sha256 AS sha256,m.title AS owner_title,
            CASE WHEN p.slot IS NOT NULL THEN 'personal'
                 WHEN d.page_count IS NULL THEN 'project' ELSE 'paper' END AS owner_kind,
            ds.created_at AS created_at,ds.id AS dataset_id
            FROM datasets ds
            JOIN documents d ON d.id=ds.document_id
            JOIN document_metadata m ON m.document_id=d.id
            LEFT JOIN personal_analysis_owner p ON p.document_id=d.id
            WHERE NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)''',
        'match': "ds.original_filename LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\'",
        'params': 2,
        'order_column': 'ds.created_at',
        'id_column': 'ds.id',
        'order': 'ds.created_at DESC,ds.id DESC',
    },
}


class ReferenceCatalog:
    def __init__(self, store):
        self.store = store

    def catalog(self, kind, limit, query='', cursor=None):
        if kind not in CATALOG:
            raise WorkspaceError('invalid_reference_kind', '请选择论文或数据列表。', 422)
        if not isinstance(limit, int) or isinstance(limit, bool) or not MIN_LIMIT <= limit <= MAX_LIMIT:
            raise WorkspaceError('invalid_reference_limit', '每次加载数量需在 1 到 50 之间。', 422)
        query = (query or '').strip()
        if len(query) > MAX_QUERY:
            raise WorkspaceError('invalid_reference_query', '搜索内容过长，请缩短后重试。', 422)
        position = self.decode_cursor(cursor, kind, query) if cursor else None
        spec = CATALOG[kind]
        clauses, params = [], []
        if query:
            pattern = like_pattern(query)
            clauses.append('(' + spec['match'] + ')')
            params.extend([pattern] * spec['params'])
        if position is not None:
            clauses.append('(' + spec['order_column'] + '<? OR ('
                           + spec['order_column'] + '=? AND ' + spec['id_column'] + '<?))')
            params.extend([position['created_at'], position['created_at'], position['id']])
        sql = spec['select'] + ''.join(' AND ' + clause for clause in clauses)
        sql += ' ORDER BY ' + spec['order'] + ' LIMIT ?'
        params.append(limit + 1)
        with self.store.connection() as connection:
            if not connection.in_transaction:
                connection.execute('BEGIN')
            rows = connection.execute(sql, params).fetchall()
        items = [dict(row) for row in rows[:limit]]
        next_cursor = None
        if len(rows) > limit:
            last = items[-1]
            next_cursor = encode_cursor(kind, query, last['created_at'], last['id'])
        return {'items': items, 'next_cursor': next_cursor}

    @staticmethod
    def decode_cursor(value, kind, query):
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
        if canonical_id != identifier:
            raise invalid_cursor()
        return payload


def encode_cursor(kind, query, created_at, identifier):
    payload = {'v': CURSOR_VERSION, 'kind': kind, 'q': query,
               'created_at': created_at, 'id': identifier}
    # UTF-8 rather than ASCII escapes: 200 non-BMP query characters would exceed
    # the 2048-character cursor when escaped as surrogate pairs, while UTF-8 JSON
    # with the existing bounded fields stays well within it.
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                     separators=(',', ':')).encode('utf-8')
    value = base64.urlsafe_b64encode(raw).decode('ascii')
    if len(value) > MAX_CURSOR:
        raise invalid_cursor()
    return value


def capture_references(store, analysis, connection, refs):
    if len(refs) > MAX_RESOURCE_REFS:
        raise WorkspaceError('reference_limit', '每次最多加入 8 份参考资料。', 422)
    return [capture_reference(store, analysis, connection, ref) for ref in refs]


def capture_reference(store, analysis, connection, ref):
    document_id, expected = str(ref.document_id), ref.sha256
    if ref.kind == 'paper':
        document = read_metadata(connection, document_id)
        if document.get('kind') == 'study' or document.get('page_count') is None:
            raise WorkspaceError('reference_not_paper', '所选资料不是可读取的论文 PDF。', 409)
        if document.get('sha256') != expected:
            raise WorkspaceError('reference_changed', '所选论文版本已变化，请移除后重新加入。', 409)
        verify_source(store, document)
        return {'kind': 'paper', 'document_id': document_id, 'title': document['title'],
                'sha256': document['sha256'], 'owner_title': document['title'],
                'owner_kind': 'paper', 'owner_sha256': document['sha256'],
                'created_at': document['created_at'], 'page_count': document['page_count'],
                'filename': document['original_filename']}
    if analysis is None:
        raise WorkspaceError('agent_tool_unavailable', '数据读取服务尚未安装。', 409)
    owner = read_metadata(connection, document_id)
    row = analysis.datasets.row(connection, document_id, str(ref.dataset_id))
    if row['sha256'] != expected:
        raise WorkspaceError('reference_changed', '所选数据版本已变化，请移除后重新加入。', 409)
    analysis.datasets.checked(row)
    return {'kind': 'dataset', 'document_id': document_id, 'dataset_id': str(ref.dataset_id),
            'title': row['original_filename'], 'sha256': row['sha256'],
            'owner_title': owner['title'], 'owner_kind': owner_kind(owner),
            'owner_sha256': owner['sha256'], 'created_at': row['created_at'],
            'filename': row['original_filename']}


def verify_paper(store, document_id, expected_sha):
    document = store.get_document(str(document_id))
    if document.get('kind') == 'study' or document.get('page_count') is None:
        raise WorkspaceError('reference_not_paper', '所选资料不是可读取的论文 PDF。', 409)
    if document.get('sha256') != expected_sha:
        raise WorkspaceError('reference_changed', '所选论文版本已变化，请移除后重新加入。', 409)
    verify_source(store, document)
    return document


def verify_dataset(store, analysis, document_id, dataset_id, expected_sha, owner_sha=None):
    if analysis is None:
        raise WorkspaceError('agent_tool_unavailable', '数据读取服务尚未安装。', 409)
    with store.connection() as connection:
        if not connection.in_transaction:
            connection.execute('BEGIN')
        owner = read_metadata(connection, str(document_id))
        row = analysis.datasets.row(connection, str(document_id), str(dataset_id))
        if row['sha256'] != expected_sha:
            raise WorkspaceError('reference_changed', '所选数据版本已变化，请移除后重新加入。', 409)
        if owner_sha is not None and owner.get('sha256') != owner_sha:
            raise WorkspaceError('reference_changed', '参考资料所属资料已变化，请移除后重新加入。', 409)
        analysis.datasets.checked(row)
    return owner, row


CITATION = re.compile(r'\[R[1-9][0-9]*(?:\s*,\s*R[1-9][0-9]*)*\]')
CITATION_TOKEN = re.compile(r'R[1-9][0-9]*')


def historical_reference_answer(turn, language):
    """Mask historical citations to pinned reference sources before reuse.

    A reference is not replayed as current evidence: the agent must read the
    actual pinned material again, and removed references can never be re-read.
    Only the reference tokens inside a mixed group such as [R1,R2] are masked so
    unrelated citations keep their original numbers.
    """
    refs = {source['ref'] for source in turn.get('sources', [])
            if source.get('kind') in REFERENCE_SOURCE_KINDS}
    if not refs:
        return turn['answer']
    marker = '[source needs rereading]' if language == 'en' else '[来源需重新读取]'
    inline = marker[1:-1]

    def mask(match):
        tokens = CITATION_TOKEN.findall(match[0])
        if not any(token in refs for token in tokens):
            return match[0]
        if all(token in refs for token in tokens):
            return marker
        return '[' + ', '.join(inline if token in refs else token for token in tokens) + ']'

    return CITATION.sub(mask, turn['answer'])
