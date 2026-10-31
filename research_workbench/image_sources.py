"""Read verified immutable image frames, independent of PDF display coordinates."""
import hashlib
import io
import json
from pathlib import Path
from uuid import UUID
from PIL import Image,UnidentifiedImageError
from .models import WorkspaceError
from .library import read_metadata

SOURCE_COLUMNS={'user_upload':'image_id','pdf_excerpt':'excerpt_note_id'}


def source_column(kind):
    if kind not in SOURCE_COLUMNS:raise WorkspaceError('validation_error','不支持这类图片来源。')
    return SOURCE_COLUMNS[kind]


def source_error():return WorkspaceError('image_source_changed','图片来源缺失或已发生变化，请保留草稿后检查。',409)


def checked_bytes(path,size,digest,limit,retain=True):
    if not 0<size<=limit:raise source_error()
    try:
        if path.stat().st_size!=size:raise source_error()
        value=hashlib.sha256();count=0;chunks=[]
        with path.open('rb') as stream:
            while chunk:=stream.read(min(1024*1024,limit-count+1)):
                count+=len(chunk)
                if count>size:raise source_error()
                value.update(chunk)
                if retain:chunks.append(chunk)
        if count!=size or value.hexdigest()!=digest:raise source_error()
        return b''.join(chunks) if retain else None
    except FileNotFoundError:raise source_error() from None


class ImageSources:
    def __init__(self,store):self.store=store

    def source_in(self,connection,document_id,kind,source_id):
        source_column(kind);source_id=str(UUID(source_id));document_id=str(UUID(document_id))
        document=read_metadata(connection,document_id)
        base=f'/api/v1/documents/{document_id}'
        descriptor={'document_id':document_id,'source_kind':kind,'source_id':source_id,'page':None,'rect':None,'parent_note_id':None}
        if kind=='user_upload':
            row=connection.execute('SELECT * FROM image_assets WHERE document_id=? AND id=?',(document_id,source_id)).fetchone()
            if row is None:raise WorkspaceError('not_found','找不到这张上传图片。',404)
            try:key=str(UUID(row['storage_key']))
            except (ValueError,TypeError,AttributeError):raise source_error() from None
            root=self.store.root/'images'
            checked_bytes(root/(key+'.original'),row['byte_size'],row['sha256'],8*1024*1024,False)
            frame=checked_bytes(root/(key+'.preview'),row['preview_byte_size'],row['preview_sha256'],2*1024*1024)
            descriptor.update(label=row['original_filename'],original_filename=row['original_filename'],
                source_sha256=row['sha256'],frame_sha256=row['preview_sha256'],frame_byte_size=row['preview_byte_size'],
                frame_mime_type=row['preview_mime_type'],original_mime_type=row['mime_type'],original_byte_size=row['byte_size'],
                original_url=base+f'/images/{source_id}/file')
        else:
            row=connection.execute('''SELECT e.*,n.page,n.rect,s.deleted_at FROM excerpts e
                JOIN notes n ON n.id=e.note_id JOIN note_states s ON s.note_id=n.id
                WHERE n.document_id=? AND e.note_id=?''',(document_id,source_id)).fetchone()
            if row is None or row['deleted_at'] is not None:raise WorkspaceError('not_found','摘录不存在或所属笔记已删除。',404)
            if row['source_sha256']!=document['sha256']:raise source_error()
            checked_bytes(self.store.files/f'{document_id}.pdf',document['byte_size'],document['sha256'],20*1024*1024,False)
            frame=checked_bytes(self.store.excerpts/f'{source_id}.png',row['byte_size'],row['sha256'],8*1024*1024)
            descriptor.update(label=f"{document['title']} · 第{row['page']}页摘录",original_filename=f'excerpt-{source_id}.png',
                source_sha256=document['sha256'],frame_sha256=row['sha256'],frame_byte_size=row['byte_size'],
                frame_mime_type='image/png',original_mime_type='image/png',original_byte_size=row['byte_size'],
                original_url=base+f'/notes/{source_id}/excerpt',page=row['page'],rect=json.loads(row['rect']),parent_note_id=source_id)
        try:
            with Image.open(io.BytesIO(frame)) as opened:
                width,height=opened.size;mime={'PNG':'image/png','JPEG':'image/jpeg'}.get(opened.format)
            if mime!=descriptor['frame_mime_type'] or not(1<=width<=2048 and 1<=height<=2048 and width*height<=4_000_000):raise source_error()
            if kind=='pdf_excerpt' and (width,height)!=(row['width'],row['height']):raise source_error()
        except (UnidentifiedImageError,ValueError,OSError):raise source_error() from None
        descriptor.update(frame_width=width,frame_height=height,frame_url=base+f'/image-sources/{kind}/{source_id}/frame')
        return descriptor,frame
