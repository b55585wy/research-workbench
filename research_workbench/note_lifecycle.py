from datetime import datetime, timezone
import hashlib
import json

from .models import WorkspaceError
from .rich_content import validate_content,plaintext,add_to_state,canonical

NOTE_FIELDS = ('id', 'document_id', 'page', 'rect', 'text', 'created_at')
STATE_QUERY = '''SELECT n.id,n.document_id,n.page,n.rect,s.current_text AS text,
    n.created_at,s.revision,s.review_status,s.reviewed_at,s.updated_at,s.deleted_at,r.current_json,a.source_json
    FROM notes n JOIN note_states s ON s.note_id=n.id
    LEFT JOIN note_rich_content r ON r.note_id=n.id LEFT JOIN study_note_sources a ON a.note_id=n.id'''


def state_record(row):
    result = dict(row)
    result['rect'] = json.loads(result['rect']) if result['rect'] else None
    source=result.pop('source_json')
    if source is not None:result['source']=json.loads(source)
    result['review_provenance'] = 'self_reported' if result['review_status'] == 'source_checked' else None
    content=result.pop('current_json')
    if content is not None:
        try:
            rich=validate_content(json.loads(content))
            if plaintext(rich)!=result['text']:raise ValueError('Rich text mismatch')
            add_to_state(result,rich)
        except (ValueError,TypeError,KeyError):
            raise WorkspaceError('rich_content_changed','笔记格式记录不完整，请保留草稿后检查。',409) from None
    return result


def base_note(state):
    return {**{key: state[key] for key in NOTE_FIELDS},**({'source':state['source']} if 'source' in state else {})}


def read_state(connection, identifier, note_id):
    row = connection.execute(STATE_QUERY + ' WHERE n.document_id=? AND n.id=?',
                             (identifier, note_id)).fetchone()
    if row is None:
        raise WorkspaceError('not_found', '找不到这条笔记。', 404)
    return state_record(row)


def read_states(connection, identifier, include_deleted=True, ascending=False):
    condition = '' if include_deleted else ' AND s.deleted_at IS NULL'
    direction = 'ASC' if ascending else 'DESC'
    rows = connection.execute(STATE_QUERY + ' WHERE n.document_id=?' + condition +
        f' ORDER BY n.created_at {direction},n.id {direction}', (identifier,))
    return [state_record(row) for row in rows]


def ensure_active(state):
    if state['deleted_at'] is not None:
        raise WorkspaceError('not_found', '这条笔记已删除，可在已删除笔记中恢复。', 404)
    return state


def conflict():
    return WorkspaceError('revision_conflict', '这条笔记已在其他页面更新。请保留草稿，查看最新内容后再编辑。', 409)


class NoteLifecycle:
    def __init__(self, store):
        self.store = store

    def list(self, identifier):
        self.store.get_document(identifier)
        with self.store.connection() as connection:
            return read_states(connection, identifier)

    def get(self, identifier, note_id):
        with self.store.connection() as connection:
            return read_state(connection, identifier, note_id)

    def mutate(self, identifier, note_id, kind, payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            return self.mutate_in(connection, identifier, note_id, kind, payload)

    def mutate_in(self, connection, identifier, note_id, kind, payload):
        data = payload.model_dump(mode='json', exclude_unset=True, exclude={'request_id'})
        fingerprint = hashlib.sha256(json.dumps({'document_id': identifier, 'note_id': note_id,
            'kind': kind, 'data': data}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        request_id = str(payload.request_id)
        current = read_state(connection, identifier, note_id)
        receipt = connection.execute('SELECT * FROM note_operations WHERE request_id=?', (request_id,)).fetchone()
        if receipt is not None:
            return self.repeat(receipt, current, fingerprint)
        if current['revision'] != payload.expected_revision:
            raise conflict()
        updated = self.apply(current, kind, data)
        self.persist(connection, current, updated)
        connection.execute('INSERT INTO note_operations VALUES (?,?,?,?,?,?)', (
            request_id, note_id, kind, fingerprint, updated['revision'],
            datetime.now(timezone.utc).isoformat()))
        return updated

    @staticmethod
    def repeat(receipt, current, fingerprint):
        if receipt['note_id'] != current['id'] or receipt['payload_hash'] != fingerprint:
            raise WorkspaceError('idempotency_conflict', '这次操作与已有记录冲突，请保留内容后重试。', 409)
        if receipt['result_revision'] != current['revision']:
            raise conflict()
        return current

    @staticmethod
    def apply(current, kind, data):
        result = dict(current)
        now = datetime.now(timezone.utc).isoformat()
        if kind == 'patch':
            if current['deleted_at'] is not None:
                raise WorkspaceError('note_deleted', '请先恢复这条笔记，再修改或核对。', 409)
            result['text'] = data.get('text', current['text'])
            text_changed = result['text'] != current['text']
            if 'rich_content' in data:add_to_state(result,data['rich_content'])
            elif text_changed:add_to_state(result,None)
            changed = text_changed or result.get('rich_content')!=current.get('rich_content')
            result['review_status'] = data.get('review_status', 'unreviewed' if changed else current['review_status'])
            checked = result['review_status'] == 'source_checked'
            result['reviewed_at'] = (current['reviewed_at'] if checked and not changed and
                current['review_status'] == 'source_checked' else now if checked else None)
        elif kind == 'delete':
            result['deleted_at'] = current['deleted_at'] or now
        elif kind == 'restore':
            result['deleted_at'] = None
        else:
            raise ValueError('Unknown lifecycle action')
        meaningful = any(current[key] != result[key] for key in ('text', 'review_status', 'reviewed_at', 'deleted_at')) or current.get('rich_content')!=result.get('rich_content')
        if meaningful:
            result.update(revision=current['revision'] + 1, updated_at=now)
        result['review_provenance'] = 'self_reported' if result['review_status'] == 'source_checked' else None
        return result

    @staticmethod
    def persist(connection, previous, current):
        if previous['revision'] == current['revision']:
            return
        cursor = connection.execute('''UPDATE note_states SET current_text=?,revision=?,review_status=?,
            reviewed_at=?,updated_at=?,deleted_at=? WHERE note_id=? AND revision=?''', (
            current['text'], current['revision'], current['review_status'], current['reviewed_at'],
            current['updated_at'], current['deleted_at'], current['id'], previous['revision']))
        if cursor.rowcount != 1:
            raise conflict()
        if previous.get('rich_content')!=current.get('rich_content'):
            content=current.get('rich_content')
            value=canonical(content) if content is not None else None
            connection.execute('''INSERT INTO note_rich_content VALUES (?,NULL,?)
                ON CONFLICT(note_id) DO UPDATE SET current_json=excluded.current_json''',(current['id'],value))
