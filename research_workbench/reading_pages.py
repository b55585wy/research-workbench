"""Model-free paragraph reading built from parsed source pages.

Cached reads never parse the PDF and never spawn a worker; only an explicit
prepare request runs the pinned local MinerU Flash txt parser in one owned
subprocess.  No model connection, credential or agent participates, so the
original text is readable before any model is configured.  A completed page
means its supported text and visual positions came from the original PDF, never
that OCR ran or that figures, tables and formulas were reconstructed.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from .agent_store import canonical, now
from .library import read_metadata
from .models import WorkspaceError
from .translation import blocks_from_units, source_sha256
from .translation_runtime import TranslationRuntime, validate_result

PARSER_ID = 'mineru-flash-txt'
PARSER_VERSION = '4.1.5'
RESULT_SCHEMA_VERSION = 1
MAX_PAGES = 5
MAX_DOCUMENT_PAGES = 200
MAX_BLOCKS = 240
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
PREPARE_TIMEOUT = 150
STATUSES = ('completed', 'partial', 'unavailable')
KINDS = ('text', 'title', 'caption', 'formula', 'image', 'table', 'other')
TEXT_WARNING = '本页没有正文文字，只保留了版面中的其他内容，请对照原文核对。'
EMPTY_WARNING = '本页没有可解析的文字，可能是扫描页或空白页。'
LIMIT_WARNING = '本页有部分内容超出解析上限，请对照原文核对。'
RUNTIME_WARNING = '本地阅读内容解析环境尚未就绪，原文仍可正常阅读。'
_QUERY_PAGE = re.compile(r'[0-9]{1,3}')

PARSER = {'id': PARSER_ID, 'version': PARSER_VERSION}


class ReadingPrepare(BaseModel):
    """Explicit reading action; the only input that may start local parsing."""

    model_config = ConfigDict(extra='forbid')
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    pages: list[StrictInt] = Field(min_length=1, max_length=MAX_PAGES)

    @field_validator('pages')
    @classmethod
    def canonical_pages(cls, value):
        if any(page < 1 or page > MAX_DOCUMENT_PAGES for page in value):
            raise ValueError('Pages must be within the document page bound')
        if len(set(value)) != len(value):
            raise ValueError('Pages must be distinct')
        return sorted(value)


def checked_pages(pages):
    """Bound a requested page list; pages are 1-based and never invented."""
    if not isinstance(pages, (list, tuple)) or not 1 <= len(pages) <= MAX_PAGES:
        raise WorkspaceError('reading_pages_invalid', '请选择 1 到 5 个页码。', 422)
    if any(type(page) is not int or page < 1 or page > MAX_DOCUMENT_PAGES for page in pages):
        raise WorkspaceError('reading_pages_invalid', '请在资料页数范围内选择页码。', 422)
    if len(set(pages)) != len(pages):
        raise WorkspaceError('reading_pages_invalid', '页码不能重复。', 422)
    return sorted(pages)


def query_pages(value):
    """Parse the frozen comma-separated page query strictly."""
    tokens = (value or '').split(',')
    if not 1 <= len(tokens) <= MAX_PAGES:
        raise WorkspaceError('reading_pages_invalid', '请选择 1 到 5 个页码。', 422)
    pages = []
    for token in tokens:
        token = token.strip()
        if not _QUERY_PAGE.fullmatch(token):
            raise WorkspaceError('reading_pages_invalid', '页码必须是有效数字。', 422)
        pages.append(int(token))
    return checked_pages(pages)


class ReadingPages:
    """Read-only cache plus one bounded, cancellable local preparation slot."""

    def __init__(self, store, runtime_root=None):
        self.store = store
        self.runtime = TranslationRuntime(runtime_root)
        self.root = store.root / '.reading-pages'
        self.scratch_root = self.root / 'scratch'
        self.slot = threading.Lock()
        self.stop = threading.Event()

    # ------------------------------------------------------------ readiness
    def capabilities(self):
        parser_ready, _ = self.runtime.probe()
        closing = self.stop.is_set()
        if closing:
            reason = '阅读准备服务正在关闭。'
        elif not parser_ready:
            reason = RUNTIME_WARNING
        else:
            reason = None
        return {'ready': bool(parser_ready) and not closing, 'parser_ready': bool(parser_ready),
                'reason': reason, 'max_pages': MAX_PAGES, 'parser': dict(PARSER),
                'result_schema_version': RESULT_SCHEMA_VERSION}

    # ---------------------------------------------------------------- source
    def source(self, document_id, source_sha256_value):
        """Active-source guard for every read and every preparation start."""
        with self.store.connection() as connection:
            owner = read_metadata(connection, document_id)
        if owner.get('kind') == 'study' or not owner.get('sha256'):
            raise WorkspaceError('source_has_no_pdf', '研究没有可阅读的 PDF 原文件，请打开实际关联文献。', 409)
        if owner['sha256'] != source_sha256_value:
            raise WorkspaceError('source_changed', '这份资料已更换版本，请重新打开后再阅读。', 409)
        path = self.store.files / f'{UUID(document_id)}.pdf'
        try:
            size = path.stat().st_size
        except OSError:
            raise WorkspaceError('source_missing', '原文件暂时无法读取，请检查资料存储。', 409) from None
        if size <= 0 or size > MAX_SOURCE_BYTES:
            raise WorkspaceError('source_too_large', '这份资料的原文超出了可解析的大小上限。', 409)
        return owner, path

    def bounded(self, pages, owner):
        total = owner.get('page_count')
        if type(total) is not int or total < 1:
            raise WorkspaceError('source_has_no_pdf', '研究没有可阅读的 PDF 原文件，请打开实际关联文献。', 409)
        if any(page > total for page in pages):
            raise WorkspaceError('reading_pages_invalid', '所选页码超出了这份资料的页数范围。', 422)
        return pages

    # ----------------------------------------------------------------- reads
    def read(self, document_id, source_sha256_value, pages_text):
        """Cached read only: no parsing, no hashing, no worker, no model."""
        pages = query_pages(pages_text)
        owner, _ = self.source(document_id, source_sha256_value)
        return self.result(document_id, source_sha256_value, self.bounded(pages, owner))

    def result(self, document_id, source_sha256_value, pages):
        cached = self.cached(document_id, source_sha256_value, pages)
        result_pages = [cached[page] for page in pages if page in cached]
        return {'document_id': document_id, 'source_sha256': source_sha256_value,
                'parser': dict(PARSER), 'result_schema_version': RESULT_SCHEMA_VERSION,
                'requested_pages': list(pages),
                'cached_pages': [page['page'] for page in result_pages],
                'missing_pages': [page for page in pages if page not in cached],
                'result_pages': result_pages}

    def cached(self, document_id, source_sha256_value, pages):
        """Cache entries matching source, parser and schema only."""
        wanted, found = set(pages), {}
        with self.store.connection() as connection:
            rows = connection.execute(
                'SELECT page,status,warning,blocks_json FROM reading_pages '
                'WHERE document_id=? AND source_sha256=? AND parser_id=? AND parser_version=? '
                'AND result_schema_version=? AND page BETWEEN ? AND ?',
                (document_id, source_sha256_value, PARSER_ID, PARSER_VERSION,
                 RESULT_SCHEMA_VERSION, min(pages), max(pages))).fetchall()
            for row in rows:
                if row['page'] not in wanted or row['status'] not in STATUSES:
                    continue
                blocks = self.blocks(row['blocks_json'])
                if blocks is None:
                    continue
                found[row['page']] = {'page': row['page'], 'status': row['status'],
                                      'warning': self.warning(row['status'], row['warning']),
                                      'blocks': blocks}
            missing = [page for page in pages if page not in found]
            if missing:
                for page in self.reused(connection, document_id, source_sha256_value, missing):
                    found.setdefault(page['page'], page)
        return found

    def reused(self, connection, document_id, source_sha256_value, pages):
        """Read-only reuse of source text already parsed for saved translations.

        Exactly one row is read per requested page, so the work stays bounded by
        the (already bounded) page request instead of the number of saved jobs:
        the newest completed/unavailable page of the newest matching job.
        """
        found = []
        for page in pages:
            row = connection.execute(
                "SELECT p.page,p.blocks_json FROM translation_pages p "
                "JOIN translation_jobs j ON j.id=p.job_id "
                "WHERE j.document_id=? AND j.source_sha256=? AND j.parser_id=? AND j.parser_version=? "
                "AND j.result_schema_version=? AND p.status IN ('completed','unavailable') "
                "AND p.page=? "
                "ORDER BY j.updated_at DESC,j.created_at DESC,j.id LIMIT 1",
                (document_id, source_sha256_value, PARSER_ID, PARSER_VERSION,
                 RESULT_SCHEMA_VERSION, page)).fetchone()
            if row is None:
                continue
            blocks = self.blocks(row['blocks_json'])
            if blocks is None:
                continue
            # Old translations keep their own translated_text; the source API
            # never exposes it and never rewrites the translation tables.
            status = 'completed' if blocks else 'unavailable'
            warning = self.warning(status, None)
            if status == 'completed' and not self.readable(blocks):
                warning = TEXT_WARNING
            found.append({'page': row['page'], 'status': status, 'warning': warning,
                          'blocks': blocks})
        return found

    @staticmethod
    def readable(blocks):
        return any(block['kind'] in ('text', 'title', 'caption') and block['source_text']
                   for block in blocks)

    @staticmethod
    def warning(status, warning):
        if status == 'unavailable':
            return warning or EMPTY_WARNING
        if status == 'partial':
            return warning or LIMIT_WARNING
        return warning or None

    def blocks(self, value):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (TypeError, ValueError):
                return None
        if not isinstance(value, list) or len(value) > MAX_BLOCKS:
            return None
        result = []
        for item in value:
            if not isinstance(item, dict):
                continue
            identifier, text = item.get('id'), item.get('source_text')
            if not isinstance(identifier, str) or not identifier or not isinstance(text, str):
                continue
            kind = item.get('kind')
            order = item.get('order')
            result.append({'id': identifier,
                           'kind': kind if kind in KINDS else 'other',
                           'order': order if type(order) is int and order >= 0 else len(result),
                           'rect': self.rect(item.get('rect')),
                           'source_text': text, 'translated_text': None})
        return result

    @staticmethod
    def rect(value):
        if not isinstance(value, dict) or set(value) != {'x', 'y', 'width', 'height'}:
            return None
        for key in ('x', 'y', 'width', 'height'):
            number = value[key]
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
                return None
        x, y, width, height = (float(value[key]) for key in ('x', 'y', 'width', 'height'))
        if not (0.0 <= x < 1.0 and 0.0 <= y < 1.0 and 0 < width and 0 < height):
            return None
        if x + width > 1.000001 or y + height > 1.000001:
            return None
        return {'x': x, 'y': y, 'width': width, 'height': height}

    # ------------------------------------------------------------- preparing
    def prepare(self, document_id, source_sha256_value, pages, cancel=None):
        """Prepare missing pages only; cached pages never need a runtime."""
        cancel = cancel if cancel is not None else threading.Event()
        owner, path = self.source(document_id, source_sha256_value)
        pages = self.bounded(checked_pages(pages), owner)
        current = self.result(document_id, source_sha256_value, pages)
        if not current['missing_pages']:
            return current
        ready, _ = self.runtime.probe()
        if not ready:
            raise WorkspaceError('reading_runtime_unavailable', RUNTIME_WARNING, 409)
        if cancel.is_set() or self.stop.is_set():
            raise self.cancelled()
        if not self.slot.acquire(blocking=False):
            raise WorkspaceError('reading_prepare_busy', '正在准备其他页面的阅读内容，请稍后重试。', 429)
        try:
            parsed = self.parse(path, current['missing_pages'], cancel, source_sha256_value)
            if cancel.is_set() or self.stop.is_set():
                raise self.cancelled()
            # Source is re-checked after the work and again inside publication.
            self.publish(document_id, source_sha256_value, parsed, path, cancel)
        finally:
            self.slot.release()
        return self.result(document_id, source_sha256_value, pages)

    def verify_source(self, path, source_sha256_value):
        """Digest guard used where metadata alone is not proof of the bytes."""
        if source_sha256(path) != source_sha256_value:
            raise WorkspaceError('source_changed', '这份资料的原文已改变，请重新打开后再阅读。', 409)

    def parse(self, path, pages, cancel, source_sha256_value):
        """Run exactly one owned worker; the slot stays held until it is gone."""
        try:
            self.scratch_root.mkdir(parents=True, exist_ok=True)
            base = self.scratch_root.resolve()
        except OSError:
            raise WorkspaceError('storage_unavailable', '无法准备本地阅读内容，请检查存储后重试。', 503) from None
        owned = tempfile.TemporaryDirectory(prefix='prepare-', dir=base)
        scratch = Path(owned.name).resolve()
        process, parsed = None, None
        try:
            if scratch == base or not scratch.is_relative_to(base):
                raise OSError('Invalid owned reading scratch directory')
            request, output = scratch / 'request.json', scratch / 'result.json'
            request.write_text(canonical({'pdf': str(path), 'pages': list(pages)}), encoding='utf-8')
            command = [sys.executable, '-s', '-m', 'research_workbench.reading_page_worker',
                       '--request', str(request), '--output', str(output), '--scratch', str(scratch),
                       '--documents', str(path.parent)]
            if self.runtime.root:
                command += ['--runtime', str(self.runtime.root)]
            env = {key: value for key, value in os.environ.items()
                   if key.upper() not in ('PYTHONPATH', 'PYTHONHOME')}
            # The requested digest is verified here, in the preparation thread,
            # immediately before the parser is spawned: metadata/stat alone do
            # not prove the bytes. Cached GET never hashes the file.
            self.verify_source(path, source_sha256_value)
            process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[1],
                                       stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, env=env,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            deadline = time.monotonic() + PREPARE_TIMEOUT
            while process.poll() is None:
                if cancel.is_set() or self.stop.is_set():
                    raise self.cancelled()
                if time.monotonic() >= deadline:
                    raise WorkspaceError('reading_prepare_timeout',
                                         '本地阅读准备超时，请减少页数后重试。', 409)
                time.sleep(.1)
            parsed = self.parsed(output, pages)
        except OSError:
            raise WorkspaceError('storage_unavailable', '无法准备本地阅读内容，请检查存储后重试。', 503) from None
        finally:
            if process is not None:
                self.stop_process(process)
            if not scratch.is_symlink() and scratch.is_relative_to(base):
                try:
                    owned.cleanup()
                except OSError:
                    pass
        return parsed

    @staticmethod
    def stop_process(process):
        try:
            if process.stdin is not None and not process.stdin.closed:
                process.stdin.close()
        except OSError:
            pass
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            else:
                process.kill()
            process.wait(timeout=5)

    def parsed(self, output, pages):
        try:
            if not output.is_file() or output.stat().st_size > MAX_OUTPUT_BYTES:
                raise ValueError()
            value = json.loads(output.read_text(encoding='utf-8'))
        except (OSError, ValueError, TypeError):
            raise WorkspaceError('reading_parse_failed', '本地解析未能产生可用内容，原文保留。', 409) from None
        if not isinstance(value, dict) or value.get('ok') is not True:
            code = value.get('error') if isinstance(value, dict) else None
            if code == 'reading_prepare_cancelled':
                raise self.cancelled()
            if code == 'reading_runtime_unavailable':
                raise WorkspaceError('reading_runtime_unavailable', RUNTIME_WARNING, 409)
            if code == 'reading_prepare_timeout':
                raise WorkspaceError('reading_prepare_timeout', '本地阅读准备超时，请减少页数后重试。', 409)
            raise WorkspaceError('reading_parse_failed', '本地解析未能产生可用内容，原文保留。', 409)
        try:
            units = validate_result(value.get('pages'), list(pages))
        except (ValueError, TypeError, KeyError):
            raise WorkspaceError('reading_parse_failed', '本地解析未能产生可用内容，原文保留。', 409) from None
        return [self.page(entry) for entry in units]

    def page(self, entry):
        """Normalize one parsed page into the frozen source-page shape."""
        number = entry['page_idx'] + 1
        units = entry['units']
        blocks, translatable, issues = blocks_from_units(number, units)
        if not units or not blocks:
            status, warning = 'unavailable', EMPTY_WARNING
        elif issues:
            status, warning = 'partial', LIMIT_WARNING
        elif not translatable:
            status, warning = 'completed', TEXT_WARNING
        else:
            status, warning = 'completed', None
        return {'page': number, 'status': status, 'warning': warning, 'blocks': blocks}

    def publish(self, document_id, source_sha256_value, pages, path, cancel=None):
        """Durable publication guarded by source identity and cancellation."""
        cancel = cancel if cancel is not None else threading.Event()
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            self.check_cancel(cancel)
            owner = read_metadata(connection, document_id)
            if owner.get('kind') == 'study' or owner.get('sha256') != source_sha256_value:
                raise WorkspaceError('source_changed', '这份资料已更换版本，请重新打开后再阅读。', 409)
            self.check_cancel(cancel)
            if source_sha256(path) != source_sha256_value:
                raise WorkspaceError('source_changed', '这份资料的原文已改变，请重新打开后再阅读。', 409)
            # Cancellation or shutdown arriving during the digest keeps the
            # transaction empty: a cancelled preparation must publish nothing.
            self.check_cancel(cancel)
            stamp = now()
            for page in pages:
                connection.execute(
                    'INSERT OR REPLACE INTO reading_pages '
                    '(document_id,page,source_sha256,parser_id,parser_version,'
                    'result_schema_version,status,warning,blocks_json,updated_at) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (document_id, page['page'], source_sha256_value, PARSER_ID, PARSER_VERSION,
                     RESULT_SCHEMA_VERSION, page['status'], page['warning'],
                     canonical(page['blocks']), stamp))

    def check_cancel(self, cancel):
        """Cancellation and shutdown may never publish a partial preparation."""
        if cancel.is_set() or self.stop.is_set():
            raise self.cancelled()

    @staticmethod
    def cancelled():
        return WorkspaceError('reading_prepare_cancelled', '已停止准备阅读内容。', 409)

    def close(self):
        """Signal the current preparation so owned work and scratch can finish."""
        self.stop.set()
