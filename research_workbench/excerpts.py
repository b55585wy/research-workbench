import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading

from .models import WorkspaceError
from .note_lifecycle import ensure_active, read_state
from .store import timestamp

WORKER = Path(__file__).with_name('excerpt_worker.py')
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_source(store, document):
    if document.get('kind')=='study':raise WorkspaceError('source_has_no_pdf','这项研究尚无原始PDF，请打开关联文献阅读。',409)
    path = store.files / f"{document['id']}.pdf"
    if not path.is_file():
        raise WorkspaceError('file_missing', '原 PDF 缺失，无法摘录或导出。', 409)
    if file_digest(path) != document['sha256']:
        raise WorkspaceError('source_changed', '原 PDF 已变化，请核对资料后重试。', 409)
    return path


def png_metadata(path):
    size = path.stat().st_size
    with path.open('rb') as stream:
        header = stream.read(24)
    if size > MAX_IMAGE_BYTES or len(header) != 24 or header[:8] != b'\x89PNG\r\n\x1a\n' or header[12:16] != b'IHDR':
        raise WorkspaceError('renderer_failed', '图表图片未正确生成，请重试。')
    width, height = struct.unpack('>II', header[16:24])
    if not (1 <= width <= 2048 and 1 <= height <= 2048 and width * height <= 4_000_000):
        raise WorkspaceError('renderer_failed', '图表图片超出尺寸限制，请重新框选。')
    return dict(byte_size=size, width=width, height=height, sha256=file_digest(path))


def checked_image(store, record):
    path = store.excerpts / f"{record['note_id']}.png"
    if not path.is_file():
        raise WorkspaceError('excerpt_missing', '图表图片缺失，请检查资料存储。', 409)
    if path.stat().st_size != record['byte_size'] or file_digest(path) != record['sha256']:
        raise WorkspaceError('excerpt_corrupt', '图表图片已变化，请检查资料存储。', 409)
    return path


def verify_excerpt_source(record, document):
    if record['source_sha256'] != document['sha256']:
        raise WorkspaceError('source_changed', '图表摘录与原 PDF 的版本不一致，请检查资料。', 409)


class ExcerptRenderer:
    def __init__(self, timeout=12):
        self.timeout = timeout

    def __call__(self, source, note, output):
        command = [sys.executable, str(WORKER), str(source), str(note['page']),
                   json.dumps(note['rect']), str(output)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8',
                errors='replace', timeout=self.timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except subprocess.TimeoutExpired as error:
            raise WorkspaceError('renderer_timeout', '图表摘录超时，请缩小区域后重试。') from error
        except OSError as error:
            raise WorkspaceError('renderer_unavailable', '暂时无法生成图表摘录，请稍后重试。', 503) from error
        if result.returncode != 0:
            raise WorkspaceError('renderer_failed', '图表摘录未完成，请重试。')
        try:
            successful = json.loads(result.stdout) == {'status': 'ok'}
        except ValueError:
            successful = False
        if not successful:
            raise WorkspaceError('renderer_failed', '图表摘录未完成，请重试。')


class Excerpts:
    def __init__(self, store, renderer=None):
        self.store = store
        self.renderer = renderer or ExcerptRenderer()
        self.slots = threading.BoundedSemaphore(1)

    def create(self, identifier, note_id):
        document = self.store.get_document(identifier)
        with self.store.connection() as connection:
            note = ensure_active(read_state(connection, identifier, note_id))
        if note.get('shape_annotation'):
            raise WorkspaceError('shape_annotation_excerpt_unsupported',
                                 '形状批注请使用独立图片上传分享，不能生成图表摘录。', 409)
        if note['rect'] is None:
            raise WorkspaceError('region_required', '请先框选要摘录的图表区域。')
        source = verify_source(self.store, document)
        existing = self.store.get_excerpt(identifier, note_id)
        if existing is not None:
            verify_excerpt_source(existing, document)
            checked_image(self.store, existing)
            return existing, False
        if not self.slots.acquire(blocking=False):
            raise WorkspaceError('renderer_busy', '正在生成另一张图表摘录，请稍后重试。', 429)
        try:
            existing = self.store.get_excerpt(identifier, note_id)
            if existing is not None:
                verify_excerpt_source(existing, document)
                checked_image(self.store, existing)
                return existing, False
            return self.generate(identifier, note, document, source), True
        finally:
            self.slots.release()

    def generate(self, identifier, note, document, source):
        target = self.store.excerpts / f"{note['id']}.png"
        completed = False
        with tempfile.NamedTemporaryFile(dir=self.store.incoming, suffix='.png', delete=False) as stream:
            temporary = Path(stream.name)
        try:
            self.renderer(source, note, temporary)
            # Refuse a source changed during rendering, before linking the image to it.
            verify_source(self.store, document)
            record = dict(note_id=note['id'], source_sha256=document['sha256'],
                          **png_metadata(temporary), created_at=timestamp())
            temporary.replace(target)
            result = self.store.add_excerpt(identifier, record)
            completed = True
            return result
        finally:
            temporary.unlink(missing_ok=True)
            if not completed:
                target.unlink(missing_ok=True)
