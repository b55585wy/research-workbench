from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
from uuid import UUID,uuid4

from .models import WorkspaceError
from .note_lifecycle import base_note,ensure_active,read_state

MAX_UPLOAD=8*1024*1024
MAX_DOCUMENT_BYTES=256*1024*1024
PROBE=Path(__file__).with_name('image_probe.py')
EXTENSIONS={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}


def checksum(path):
    digest=hashlib.sha256()
    with path.open('rb') as source:
        while chunk:=source.read(1024*1024):
            digest.update(chunk)
    return digest.hexdigest()


def safe_name(value):
    value=re.split(r'[/\\]',value or '')[-1]
    return ''.join(c for c in value if ord(c)>=32 and ord(c)!=127).strip()[:180] or 'image'


def image_record(row,note_ids=()):
    result={key:value for key,value in dict(row).items() if key!='storage_key'}
    prefix=f"/api/v1/documents/{result['document_id']}/images/{result['id']}"
    result.update(source_kind='user_upload',file_url=prefix+'/file',preview_url=prefix+'/preview',note_ids=list(note_ids))
    return result


class ImageLibrary:
    def __init__(self,store,decoder=None):
        self.store=store
        self.files=store.root/'images'
        self.files.mkdir(exist_ok=True)
        self.decoder=decoder or self.decode
        self.slots=threading.BoundedSemaphore(2)

    @staticmethod
    def decode(source,target,timeout=8):
        try:
            result=subprocess.run([sys.executable,str(PROBE),str(source),str(target)],
                capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        except subprocess.TimeoutExpired as error:
            raise WorkspaceError('image_timeout','图片处理超时，请换用较小图片重试。') from error
        except OSError as error:
            raise WorkspaceError('image_unavailable','暂时无法处理图片，请重试。',503) from error
        try:
            value=json.loads(result.stdout)
            if result.returncode or not isinstance(value,dict) or value.get('error'):
                raise ValueError()
            if value['mime_type'] not in EXTENSIONS or value['preview_mime_type'] not in ('image/png','image/jpeg'):
                raise ValueError()
            return value
        except (ValueError,KeyError,TypeError) as error:
            raise WorkspaceError('invalid_image','请上传有效的静态 PNG、JPEG 或 WebP 图片。') from error

    def row(self,connection,identifier,image_id):
        row=connection.execute('SELECT * FROM image_assets WHERE document_id=? AND id=?',(identifier,image_id)).fetchone()
        if row is None:
            raise WorkspaceError('not_found','找不到这张图片。',404)
        return row

    def get(self,identifier,image_id):
        with self.store.connection() as connection:
            row=self.row(connection,identifier,image_id)
            links=connection.execute('''SELECT ni.note_id FROM note_images ni JOIN note_states s ON s.note_id=ni.note_id
                WHERE ni.image_id=? AND s.deleted_at IS NULL ORDER BY ni.note_id''',(image_id,))
            return image_record(row,[r[0] for r in links])

    def list(self,identifier):
        self.store.get_document(identifier)
        with self.store.connection() as connection:
            rows=connection.execute('SELECT * FROM image_assets WHERE document_id=? ORDER BY created_at DESC,id DESC',(identifier,)).fetchall()
            links=connection.execute('''SELECT ni.image_id,ni.note_id FROM note_images ni JOIN image_assets i ON i.id=ni.image_id
                JOIN note_states s ON s.note_id=ni.note_id WHERE i.document_id=? AND s.deleted_at IS NULL ORDER BY ni.note_id''',(identifier,))
            by_image={row['id']:[] for row in rows}
            for link in links:
                by_image[link['image_id']].append(link['note_id'])
            return [image_record(row,by_image[row['id']]) for row in rows]

    def path(self,identifier,image_id,preview=False):
        with self.store.connection() as connection:
            row=dict(self.row(connection,identifier,image_id))
        key=str(UUID(row['storage_key']))
        path=self.files/(key+('.preview' if preview else '.original'))
        expected_size=row['preview_byte_size' if preview else 'byte_size']
        expected_hash=row['preview_sha256' if preview else 'sha256']
        if not path.is_file() or path.stat().st_size!=expected_size or checksum(path)!=expected_hash:
            raise WorkspaceError('image_missing','图片缺失或发生变化，请检查资料后重试。',409)
        return path

    def upload(self,identifier,request_id,upload):
        self.store.get_document(identifier)
        temporary=[]
        try:
            with tempfile.NamedTemporaryFile(dir=self.store.incoming,delete=False) as target:
                raw=Path(target.name);temporary.append(raw)
                size=0
                while chunk:=upload.file.read(1024*1024):
                    size+=len(chunk)
                    if size>MAX_UPLOAD:
                        raise WorkspaceError('image_too_large','图片需小于 8 MiB。',413)
                    target.write(chunk)
            if not size:
                raise WorkspaceError('invalid_image','图片内容为空。')
            digest=checksum(raw);name=safe_name(upload.filename)
            with self.store.connection() as connection:
                existing=connection.execute('SELECT * FROM image_assets WHERE id=?',(request_id,)).fetchone()
            if existing is not None:
                return self.repeat(existing,identifier,digest,name),False
            if not self.slots.acquire(blocking=False):
                raise WorkspaceError('image_busy','正在处理其他图片，请稍后重试。',429)
            try:
                with tempfile.NamedTemporaryFile(dir=self.store.incoming,delete=False) as stream:
                    preview=Path(stream.name);temporary.append(preview)
                info=self.decoder(raw,preview)
                preview_size=preview.stat().st_size
                if not 0<preview_size<=2*1024*1024:
                    raise WorkspaceError('invalid_image','图片预览超过限制。')
                record=dict(id=request_id,document_id=identifier,storage_key=str(uuid4()),original_filename=name,
                    mime_type=info['mime_type'],byte_size=size,sha256=digest,width=info['width'],height=info['height'],
                    preview_mime_type=info['preview_mime_type'],preview_byte_size=preview_size,
                    preview_sha256=checksum(preview),created_at=datetime.now(timezone.utc).isoformat())
                return self.commit_upload(record,raw,preview)
            finally:
                self.slots.release()
        finally:
            for path in temporary:path.unlink(missing_ok=True)
            upload.file.close()

    def repeat(self,row,identifier,digest,name):
        if (row['document_id'],row['sha256'],row['original_filename'])!=(identifier,digest,name):
            raise WorkspaceError('idempotency_conflict','图片上传请求与已有记录冲突。',409)
        self.path(identifier,row['id']);self.path(identifier,row['id'],True)
        return self.get(identifier,row['id'])

    def commit_upload(self,record,raw,preview):
        key=record['storage_key']
        targets=[self.files/(key+'.original'),self.files/(key+'.preview')]
        try:
            with self.store.connection() as connection:
                connection.execute('BEGIN IMMEDIATE')
                previous=connection.execute('SELECT * FROM image_assets WHERE id=?',(record['id'],)).fetchone()
                if previous is not None:
                    return self.repeat(previous,record['document_id'],record['sha256'],record['original_filename']),False
                total=connection.execute('SELECT COALESCE(SUM(byte_size+preview_byte_size),0),COUNT(*) FROM image_assets WHERE document_id=?',(record['document_id'],)).fetchone()
                if total[0]+record['byte_size']+record['preview_byte_size']>MAX_DOCUMENT_BYTES or total[1]>=200:
                    raise WorkspaceError('image_quota','这篇论文的图片资料已达到容量限制。',413)
                raw.replace(targets[0]);preview.replace(targets[1])
                connection.execute('INSERT INTO image_assets VALUES ('+','.join('?' for _ in record)+')',tuple(record.values()))
            return self.get(record['document_id'],record['id']),True
        except Exception:
            # Each attempt owns a random storage key; never delete another retry's files.
            with self.store.connection() as connection:
                referenced=connection.execute('SELECT 1 FROM image_assets WHERE storage_key=?',(key,)).fetchone()
            if referenced is None:
                for target in targets:target.unlink(missing_ok=True)
            raise

    def create_note(self,identifier,payload,connection=None):
        if connection is not None:
            return self.create_note_in(connection,identifier,payload)
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            return self.create_note_in(connection,identifier,payload)

    def create_note_in(self,connection,identifier,payload):
        data=payload.model_dump(mode='json',exclude={'source'} if payload.source is None else set());data['image_ids']=sorted(data['image_ids'])
        if data.get('rich_content') is None:data.pop('rich_content',None)
        digest=hashlib.sha256(json.dumps({'document_id':identifier,'data':data},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        identifier_note=str(payload.request_id)
        receipt=connection.execute('SELECT * FROM image_note_requests WHERE request_id=?',(identifier_note,)).fetchone()
        if receipt is not None:
            if receipt['document_id']!=identifier or receipt['payload_hash']!=digest:
                raise WorkspaceError('idempotency_conflict','图片笔记请求与已有记录冲突。',409)
            current=read_state(connection,identifier,identifier_note)
            if current['deleted_at'] is not None:
                raise WorkspaceError('note_deleted','这条笔记已删除，可从已删除笔记中恢复。',409)
            return base_note(current),False
        if connection.execute('SELECT 1 FROM notes WHERE id=?',(identifier_note,)).fetchone():
            raise WorkspaceError('idempotency_conflict','这个笔记请求编号已被使用。',409)
        for image_id in payload.image_ids:self.row(connection,identifier,str(image_id))
        note,created=self.store.save_note_in(connection,identifier,payload)
        connection.executemany('INSERT INTO note_images VALUES (?,?)',[(identifier_note,str(i)) for i in payload.image_ids])
        connection.execute('INSERT INTO image_note_requests VALUES (?,?,?)',(identifier_note,identifier,digest))
        return note,created
