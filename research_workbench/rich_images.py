"""Typed inline images reference existing owned assets, never arbitrary URLs."""
import re
from uuid import UUID

from .models import WorkspaceError

MAX_INLINE_IMAGES = 8


def image_insert(value):
    if type(value) is not dict or set(value) != {'research_image'}:
        raise ValueError('Unsupported rich embed')
    image = value['research_image']
    if type(image) is not dict or set(image) != {'document_id', 'image_id', 'sha256', 'alt'}:
        raise ValueError('Invalid rich image fields')
    for key in ('document_id', 'image_id'):
        if not isinstance(image[key], str) or str(UUID(image[key])) != image[key]:
            raise ValueError('Image identifiers must be canonical UUIDs')
    if not isinstance(image['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', image['sha256']):
        raise ValueError('Invalid image SHA256')
    alt = image['alt']
    if not isinstance(alt, str) or not alt.strip() or len(alt) > 180 or any(ord(c) < 32 or ord(c) == 127 for c in alt):
        raise ValueError('Invalid image label')
    return {'research_image': dict(image)}


def image_text(image):
    return '[Image: ' + image['alt'] + ']'


def references(content):
    if not content:
        return {}
    result = {}
    for op in content.get('ops', []):
        insert = op.get('insert')
        if isinstance(insert, dict) and 'research_image' in insert:
            value = insert['research_image']
            old = result.get(value['image_id'])
            if old and any(old[key] != value[key] for key in ('document_id','sha256')):
                raise ValueError('Conflicting image references')
            result[value['image_id']] = value
    return result


def sync_note_images(store, connection, owner_id, note_id, previous, current):
    before, after = references(previous), references(current)
    if not before and not after:
        return
    from .images import ImageLibrary
    library = ImageLibrary(store)
    for image_id, image in after.items():
        if image['document_id'] != owner_id:
            raise WorkspaceError('rich_image_scope', '正文图片必须属于当前文献或研究。', 409)
        row = library.row(connection, owner_id, image_id)
        if row['sha256'] != image['sha256']:
            raise WorkspaceError('rich_image_changed', '正文图片版本已变化，请重新插入。', 409)
        try:
            library.path(owner_id, image_id)
            library.path(owner_id, image_id, True)
        except OSError:
            raise WorkspaceError('rich_image_unavailable','暂时无法读取正文图片，请保留草稿后重试。',503) from None
    for image_id in before.keys() - after.keys():
        connection.execute('DELETE FROM note_images WHERE note_id=? AND image_id=?', (note_id, image_id))
    connection.executemany('INSERT OR IGNORE INTO note_images VALUES (?,?)', [(note_id, image_id) for image_id in after])


def web_image_url(image):
    return f"/api/v1/documents/{image['document_id']}/images/{image['image_id']}/preview"
