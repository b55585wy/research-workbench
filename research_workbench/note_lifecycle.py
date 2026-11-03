from datetime import datetime, timezone
import hashlib
import json

from .models import WorkspaceError
from .rich_content import validate_content,plaintext,add_to_state,canonical
from .shape_annotations import (MAX_TEXTBOX_BODY, add_record as add_shape_record,
    current_json as shape_current_json, geometry_bounds as shape_bounds)
from .text_annotations import add_record as add_annotation_record

NOTE_FIELDS = ('id', 'document_id', 'page', 'rect', 'text', 'created_at')
STATE_QUERY = '''SELECT n.id,n.document_id,n.page,n.rect,s.current_text AS text,
    n.created_at,s.revision,s.review_status,s.reviewed_at,s.updated_at,s.deleted_at,r.current_json,a.source_json,t.current_json AS annotation_json,
    q.original_json AS shape_original_json,q.current_json AS shape_current_json
    FROM notes n JOIN note_states s ON s.note_id=n.id
    LEFT JOIN note_rich_content r ON r.note_id=n.id LEFT JOIN study_note_sources a ON a.note_id=n.id
    LEFT JOIN note_text_annotations t ON t.note_id=n.id
    LEFT JOIN note_shape_annotations q ON q.note_id=n.id'''


def state_record(row):
    result = dict(row)
    result['rect'] = json.loads(result['rect']) if result['rect'] else None
    add_shape_record(result, result.pop('shape_original_json', None), result.pop('shape_current_json', None))
    add_annotation_record(result, result.pop('annotation_json', None))
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
    from .library import read_metadata
    from .library_lifecycle import reject_purged
    read_metadata(connection, identifier)
    reject_purged(connection, identifier, note_id)
    row = connection.execute(STATE_QUERY + ' WHERE n.document_id=? AND n.id=?',
                             (identifier, note_id)).fetchone()
    if row is None:
        raise WorkspaceError('not_found', '找不到这条笔记。', 404)
    return state_record(row)


def read_states(connection, identifier, include_deleted=True, ascending=False):
    condition = ' AND NOT EXISTS(SELECT 1 FROM purged_notes p WHERE p.note_id=n.id)'
    if not include_deleted:
        condition += ' AND s.deleted_at IS NULL'
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
        attempts_shape = 'shape_annotation' in getattr(payload, 'model_fields_set', ())
        if attempts_shape or (kind == 'patch' and current.get('shape_annotation')):
            # Receipts were replayed above, so verification never blocks a recorded success.
            # A shape move, and any edit to a shape note, must still match the stored source.
            self.verify_shape_source(connection, identifier, current)
        updated = self.apply(current, kind, data)
        if current.get('rich_content')!=updated.get('rich_content'):
            from .rich_images import sync_note_images
            sync_note_images(self.store,connection,identifier,note_id,current.get('rich_content'),updated.get('rich_content'))
        self.persist(connection, current, updated)
        connection.execute('INSERT INTO note_operations VALUES (?,?,?,?,?,?)', (
            request_id, note_id, kind, fingerprint, updated['revision'],
            datetime.now(timezone.utc).isoformat()))
        return updated

    def verify_shape_source(self, connection, identifier, current):
        from .excerpts import verify_source
        from .library import read_metadata
        shape = current.get('shape_annotation')
        if not shape:
            raise WorkspaceError('shape_annotation_required', '这条笔记没有可修改的形状批注。', 409)
        document = read_metadata(connection, identifier)
        if shape['source_sha256'] != document.get('sha256'):
            raise WorkspaceError('shape_annotation_changed', '形状批注对应的原文版本已变化，请重新绘制。', 409)
        verify_source(self.store, document)

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
        geometry_changed = False
        if kind == 'patch':
            if current['deleted_at'] is not None:
                raise WorkspaceError('note_deleted', '请先恢复这条笔记，再修改或核对。', 409)
            if 'annotation_style' in data:
                if not current.get('annotation'):
                    raise WorkspaceError('text_annotation_required', '这条笔记没有可修改样式的文字批注。', 409)
                result['annotation'] = {**current['annotation'], **data['annotation_style']}
            if 'shape_annotation' in data:
                shape = current.get('shape_annotation')
                if not shape:
                    raise WorkspaceError('shape_annotation_required', '这条笔记没有可修改的形状批注。', 409)
                proposed = data['shape_annotation']
                if proposed['kind'] != shape['kind']:
                    raise WorkspaceError('shape_kind_immutable', '形状类型不能更改，请删除后重新绘制。', 409)
                result['shape_annotation'] = {**proposed, 'source_sha256': shape['source_sha256']}
                result['rect'] = shape_bounds(proposed['kind'], proposed['points'])
                geometry_changed = proposed['points'] != shape['points']
                # Font size defines the reviewed glyph appearance, so it invalidates review too.
                font_size_changed = proposed.get('font_size') != shape.get('font_size')
            else:
                font_size_changed = False
            result['text'] = data.get('text', current['text'])
            text_changed = result['text'] != current['text']
            if (result.get('shape_annotation') or {}).get('kind') == 'textbox' and len(result['text']) > MAX_TEXTBOX_BODY:
                raise WorkspaceError('textbox_text_too_long',
                    f'文本框内容不能超过 {MAX_TEXTBOX_BODY} 个字符。', 422)
            # A textbox body is part of its reviewed appearance, so an edit to an existing
            # textbox body clears review even when this same PATCH asks for source_checked.
            textbox_text_changed = text_changed and (current.get('shape_annotation') or {}).get('kind') == 'textbox'
            if 'rich_content' in data:add_to_state(result,data['rich_content'])
            elif text_changed:add_to_state(result,None)
            changed = text_changed or result.get('rich_content')!=current.get('rich_content') or geometry_changed
            if geometry_changed or font_size_changed or textbox_text_changed:
                # Moving/resizing a shape, changing its font size or replacing a textbox body
                # invalidates the reviewed pixels even when this same request also asks for
                # source_checked; style-only and ordinary note edits keep the usual rules.
                result['review_status'] = 'unreviewed'
                result['reviewed_at'] = None
            else:
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
        meaningful = meaningful or result.get('annotation') != current.get('annotation')
        meaningful = meaningful or result.get('shape_annotation') != current.get('shape_annotation')
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
        if previous.get('annotation') != current.get('annotation'):
            connection.execute('UPDATE note_text_annotations SET current_json=? WHERE note_id=?',
                               (canonical(current['annotation']), current['id']))
        if previous.get('shape_annotation') != current.get('shape_annotation'):
            cursor = connection.execute('UPDATE note_shape_annotations SET current_json=? WHERE note_id=?',
                                        (shape_current_json(current['shape_annotation']), current['id']))
            if cursor.rowcount != 1:
                raise WorkspaceError('shape_annotation_changed', '形状批注记录不完整，请重新打开资料后重试。', 409)
        if previous.get('rich_content')!=current.get('rich_content'):
            content=current.get('rich_content')
            value=canonical(content) if content is not None else None
            connection.execute('''INSERT INTO note_rich_content VALUES (?,NULL,?)
                ON CONFLICT(note_id) DO UPDATE SET current_json=excluded.current_json''',(current['id'],value))
