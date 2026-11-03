"""Bounded, cached ruled-table regions for the PDF reader.

Only a separate short-lived worker imports a PDF parser. This module keeps the
web process free of in-process parsing and validates the worker's closed output
before it can reach the reader.
"""
import json
import math
import os
from collections import OrderedDict
from pathlib import Path
import re
import subprocess
import sys
import threading

from .excerpts import verify_source
from .models import WorkspaceError

WORKER = Path(__file__).with_name('pdf_regions_worker.py')
GEOMETRY_VERSION = 'pdfplumber-0.11.10-ruled-v1'
MAX_ITEMS = 128
MAX_OUTPUT_BYTES = 64 * 1024
REASON_PATTERN = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
TABLE_ID_PATTERN = re.compile(r'^table-[1-9][0-9]*$')


def validate_result(payload):
    if not isinstance(payload, dict) or set(payload) - {'status', 'items', 'unavailable_reason'}:
        raise ValueError('Invalid regions envelope')
    if payload.get('status') != 'ok':
        raise ValueError('Invalid regions status')
    items = payload.get('items')
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise ValueError('Invalid regions items')
    reason = payload.get('unavailable_reason')
    if reason is not None:
        if not isinstance(reason, str) or not REASON_PATTERN.fullmatch(reason) or items:
            raise ValueError('Invalid regions reason')
    checked, seen = [], set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {'id', 'kind', 'rect'}:
            raise ValueError('Invalid region item')
        identifier, kind, rect = item['id'], item['kind'], item['rect']
        if not isinstance(identifier, str) or not TABLE_ID_PATTERN.fullmatch(identifier) or identifier in seen:
            raise ValueError('Invalid region identity')
        if kind != 'table':
            raise ValueError('Invalid region kind')
        if not isinstance(rect, (list, tuple)) or len(rect) != 4:
            raise ValueError('Invalid region rectangle')
        values = []
        for value in rect:
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('Invalid region coordinate')
            values.append(float(value))
        if values[0] >= values[2] or values[1] >= values[3]:
            raise ValueError('Empty region rectangle')
        seen.add(identifier)
        checked.append({'id': identifier, 'kind': 'table', 'rect': values})
    result = {'items': checked}
    if reason is not None:
        result['unavailable_reason'] = reason
    return result


def copy_result(result):
    copied = {'items': [{'id': item['id'], 'kind': item['kind'], 'rect': list(item['rect'])}
                        for item in result['items']]}
    if result.get('unavailable_reason') is not None:
        copied['unavailable_reason'] = result['unavailable_reason']
    return copied


class PdfRegions:
    def __init__(self, store, timeout=10, cache_size=128):
        self.store = store
        self.timeout = timeout
        self.cache_size = cache_size
        self.slots = threading.BoundedSemaphore(1)
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def get_page(self, identifier, page):
        document = self.store.get_document(identifier)
        source = verify_source(self.store, document)
        if type(page) is not int or not 1 <= page <= document['page_count']:
            raise WorkspaceError('invalid_page', '页码超出文件范围。', 422)
        key = (document['sha256'], page, GEOMETRY_VERSION)
        result = self.cached(key)
        if result is None:
            if not self.slots.acquire(blocking=False):
                raise WorkspaceError('regions_busy', '正在识别另一页表格，请稍后重试。', 429)
            try:
                result = self.cached(key)
                if result is None:
                    result = self.run(source, page)
                    # The source must still be the active, unchanged document
                    # before this page's geometry may be cached.
                    current = self.store.get_document(identifier)
                    if current['sha256'] != document['sha256']:
                        raise WorkspaceError('source_changed', '原 PDF 已变化，请核对资料后重试。', 409)
                    verify_source(self.store, current)
                    self.remember(key, result)
                    document = current
            finally:
                self.slots.release()
        return self.response(document, page, result)

    def cached(self, key):
        with self.lock:
            result = self.cache.get(key)
            if result is None:
                return None
            self.cache.move_to_end(key)
            return copy_result(result)

    def remember(self, key, result):
        with self.lock:
            self.cache[key] = result
            self.cache.move_to_end(key)
            while len(self.cache) > self.cache_size:
                self.cache.popitem(last=False)

    def run(self, source, page):
        command = [sys.executable, str(WORKER), str(source), str(page)]
        try:
            completed = subprocess.run(command, capture_output=True, text=True,
                encoding='utf-8', errors='replace', timeout=self.timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except subprocess.TimeoutExpired as error:
            raise WorkspaceError('regions_timeout', '表格识别超时，请稍后重试。', 503) from error
        except OSError as error:
            raise WorkspaceError('regions_unavailable', '暂时无法识别表格，请稍后重试。', 503) from error
        if len(completed.stdout.encode('utf-8', 'replace')) > MAX_OUTPUT_BYTES:
            raise WorkspaceError('regions_failed', '表格识别结果异常，请稍后重试。', 422)
        try:
            payload = json.loads(completed.stdout)
        except ValueError:
            payload = None
        if completed.returncode != 0:
            if isinstance(payload, dict) and payload.get('error') == 'regions_unavailable':
                raise WorkspaceError('regions_unavailable', '暂时无法识别表格，请稍后重试。', 503)
            raise WorkspaceError('regions_failed', '表格识别未完成，请稍后重试。', 422)
        if payload is None:
            raise WorkspaceError('regions_failed', '表格识别未完成，请稍后重试。', 422)
        try:
            return validate_result(payload)
        except (TypeError, ValueError) as error:
            raise WorkspaceError('regions_failed', '表格识别结果异常，请稍后重试。', 422) from error

    @staticmethod
    def response(document, page, result):
        response = {'document_id': document['id'], 'page': page,
                    'source_sha256': document['sha256'],
                    'coordinate_space': 'display-normalized',
                    'items': result['items'], 'limited_to': 'ruled-tables'}
        if result.get('unavailable_reason') is not None:
            response['unavailable_reason'] = result['unavailable_reason']
        return response
