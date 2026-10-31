import html
from uuid import UUID

from .images import EXTENSIONS,ImageLibrary,image_record


def add_attachments(connection,identifier,notes):
    by_note={n['id']:n for n in notes}
    rows=connection.execute('''SELECT i.*,ni.note_id FROM image_assets i JOIN note_images ni ON ni.image_id=i.id
        JOIN note_states s ON s.note_id=ni.note_id WHERE i.document_id=? AND s.deleted_at IS NULL
        ORDER BY i.created_at,i.id''',(identifier,))
    for row in rows:
        record=dict(row)
        note_id=record.pop('note_id')
        if note_id in by_note:by_note[note_id].setdefault('attachments',[]).append(image_record(record,[note_id]))


def portable(image):
    identifier=str(UUID(image['id']))
    data={key:value for key,value in image.items() if key not in ('file_url','preview_url','note_ids')}
    data.update(file_path='uploads/'+identifier+EXTENSIONS[image['mime_type']],
                preview_path='images/upload-'+identifier+EXTENSIONS[image['preview_mime_type']])
    return data


def collect(notes):
    return list({i['id']:i for n in notes for i in n.get('attachments',[])}.values())


def archive_files(store,identifier,notes):
    images=collect(notes)
    if not images:return []
    library=ImageLibrary(store)
    output=[]
    for image in images:
        value=portable(image)
        output.append((value['file_path'],library.path(identifier,image['id']),image['sha256'],image['byte_size']))
        output.append((value['preview_path'],library.path(identifier,image['id'],True),image['preview_sha256'],image['preview_byte_size']))
    return output


def markup(image):
    value=portable(image)
    label=html.escape(image['original_filename'])
    return (f'<figure><img src="{value["preview_path"]}" alt="{label}">'
            f'<figcaption>用户上传图片 / User-uploaded image: {label} '
            f'<a href="{value["file_path"]}">下载上传原文件 / Original upload</a></figcaption></figure>')
