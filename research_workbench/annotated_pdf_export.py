"""Verified, temporary PDF derivatives of server-owned saved-note snapshots."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading

from .excerpts import file_digest, verify_source
from .models import WorkspaceError
from .pdf_annotation_contract import (MAX_OUTPUT_BYTES, MAX_INPUT_BYTES, InvalidSnapshot,
                                      SnapshotTooLarge, snapshot)

WORKER = Path(__file__).with_name('annotated_pdf_worker.py')


class PdfAnnotationWorker:
    def __init__(self, timeout=20):
        self.timeout = timeout

    def __call__(self, job):
        try:
            result = subprocess.run([sys.executable, '-I', '-X', 'utf8', str(WORKER), str(job)],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=self.timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except subprocess.TimeoutExpired as error:
            raise WorkspaceError('pdf_export_timeout', '批注 PDF 生成超时，请稍后重试或使用阅读记录导出。') from error
        except OSError as error:
            raise WorkspaceError('pdf_export_unavailable', '暂时无法生成批注 PDF，请稍后重试。', 503) from error
        try:
            value = json.loads(result.stdout)
        except (ValueError, UnicodeError, TypeError) as error:
            raise WorkspaceError('pdf_export_failed', '批注 PDF 未正确生成，请重试。') from error
        if isinstance(value, dict) and value.get('error') == 'pdf_export_too_large':
            raise WorkspaceError('pdf_export_too_large', '批注 PDF 过大，请减少批注后重试。', 413)
        if isinstance(value, dict) and value.get('error') == 'textbox_font_unavailable':
            raise WorkspaceError('textbox_font_unavailable', '服务器缺少可用的中文字体，暂时无法生成文本框。', 503)
        if isinstance(value, dict) and value.get('error') == 'textbox_overflow':
            raise WorkspaceError('textbox_overflow', '有文本框内容超出范围，请调整文本框大小或字号后重试。', 422)
        if result.returncode != 0 or not isinstance(value, dict) or value.get('status') != 'ok':
            raise WorkspaceError('pdf_export_failed', '批注 PDF 未正确生成，请重试。')
        return value


def checked_output(job, metadata, data):
    output = job / 'output.pdf'
    document = data['document']
    if not isinstance(metadata, dict):
        raise WorkspaceError('pdf_export_failed', '批注 PDF 未正确生成，请重试。')
    if output.is_file() and output.stat().st_size > MAX_OUTPUT_BYTES:
        raise WorkspaceError('pdf_export_too_large', '批注 PDF 过大，请减少批注后重试。', 413)
    good = (metadata.get('status') == 'ok' and type(metadata.get('byte_size')) is int and 1 <= metadata['byte_size'] <= MAX_OUTPUT_BYTES
            and type(metadata.get('note_count')) is int and metadata['note_count'] == len(data['notes'])
            and type(metadata.get('page_count')) is int and metadata['page_count'] == document['page_count']
            and metadata.get('source_sha256') == document['sha256'])
    if not good or not output.is_file():
        raise WorkspaceError('pdf_export_failed', '批注 PDF 未正确生成，请重试。')
    with output.open('rb') as stream:
        header = stream.read(5)
    if header != b'%PDF-' or output.stat().st_size != metadata['byte_size'] or file_digest(output) != metadata.get('sha256'):
        raise WorkspaceError('pdf_export_failed', '批注 PDF 未正确生成，请重试。')
    return output


def checked_source(store, document):
    source = store.files / (document['id'] + '.pdf')
    if source.is_file() and (source.stat().st_size != document['byte_size'] or source.stat().st_size > MAX_INPUT_BYTES):
        raise WorkspaceError('source_changed', '原 PDF 已变化，请核对资料后重试。', 409)
    return verify_source(store, document)


def filename(title):
    title = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]', '_', title)[:100].strip(' .')
    return (title or 'document') + ' - annotated.pdf'


class AnnotatedPdfExport:
    def __init__(self, store, worker=None):
        self.store = store
        self.worker = worker or PdfAnnotationWorker()
        self.slots = threading.BoundedSemaphore(1)

    def build(self, identifier):
        if not self.slots.acquire(blocking=False):
            raise WorkspaceError('pdf_export_busy', '正在生成另一份批注 PDF，请稍后重试。', 429)
        try:
            return self.generate(identifier)
        finally:
            self.slots.release()

    def generate(self, identifier):
        document, notes, _ = self.store.reading_snapshot(identifier)
        if document.get('kind') == 'study':
            raise WorkspaceError('source_has_no_pdf', '请打开关联论文后导出批注 PDF。', 409)
        if not notes:
            raise WorkspaceError('pdf_export_empty', '请先保存一条笔记或文字批注，再导出批注 PDF。', 409)
        try:
            data, encoded = snapshot(document, notes)
        except SnapshotTooLarge as error:
            raise WorkspaceError('pdf_export_too_large', '本次批注 PDF 内容过大，请减少批注后重试。', 413) from error
        except (InvalidSnapshot, ValueError, TypeError, KeyError) as error:
            raise WorkspaceError('pdf_export_invalid', '笔记或批注记录不完整，暂时无法导出。', 409) from error
        source = checked_source(self.store, document)
        target = None
        try:
            with tempfile.TemporaryDirectory(dir=self.store.incoming, prefix='annotated-') as directory:
                job = Path(directory)
                if job.resolve().parent != self.store.incoming.resolve():
                    raise OSError('Invalid temporary workspace')
                target = self.render_job(document, data, encoded, source, job)
            return target, filename(document['title'])
        except BaseException:
            if target is not None:
                target.unlink(missing_ok=True)
            raise

    def render_job(self, document, data, encoded, source, job):
        (job / 'request.json').write_bytes(encoded)
        shutil.copyfile(source, job / 'source.pdf')
        if file_digest(job / 'source.pdf') != document['sha256']:
            raise WorkspaceError('source_changed', '导出期间原 PDF 发生变化，请检查后重试。', 409)
        metadata = self.worker(job)
        output = checked_output(job, metadata, data)
        current = self.store.get_document(document['id'])
        if current['sha256'] != document['sha256']:
            raise WorkspaceError('source_changed', '导出期间原 PDF 发生变化，请检查后重试。', 409)
        checked_source(self.store, document)
        with tempfile.NamedTemporaryFile(dir=self.store.exports, suffix='.pdf', delete=False) as stream:
            target = Path(stream.name)
        try:
            output.replace(target)
            return target
        except BaseException:
            target.unlink(missing_ok=True)
            raise
