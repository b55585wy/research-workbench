"""Bounded native-PDF text reading for the presentation slice.

One child process reads all selected pages of an already verified store file.
There is no OCR, no model call and no caller-controlled path here; the fixed
probe refuses rather than silently trimming an oversized selection.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

from .models import WorkspaceError

PROBE = Path(__file__).with_name('presentation_paper_probe.py')
MAX_PAGES = 60
MAX_CHARS = 120000
CONTEXT_CHARS = 140000
# One probe at a time per process.  Reader instances (one per guest app) must
# not multiply extractor children; only this gate is shared, never source data.
_READ_SLOTS = threading.BoundedSemaphore(1)

MESSAGES = {
    'encrypted': ('presentation_paper_encrypted',
                  '这篇 PDF 受密码保护，请先解除密码后再导入。', 422),
    'invalid': ('presentation_paper_unreadable',
                '无法从这份 PDF 读取页面，请检查文件后重试。', 422),
    'page_bounds': ('presentation_paper_pages',
                    '所选页码超出这篇 PDF 的页码范围，请重新选择。', 422),
    'char_limit': ('presentation_paper_chars',
                   f'所选页面的文字超过 {MAX_CHARS} 个字符，请减少页码后重试。', 413),
}


def page_scope(pages):
    """Compact, exact page scope such as "1-3,5"."""
    ordered = sorted({int(page) for page in pages})
    chunks, start, previous = [], None, None
    for page in ordered:
        if start is None:
            start = previous = page
            continue
        if page == previous + 1:
            previous = page
            continue
        chunks.append((start, previous))
        start = previous = page
    if start is not None:
        chunks.append((start, previous))
    return ','.join(str(a) if a == b else f'{a}-{b}' for a, b in chunks)


class PaperReader:
    def __init__(self, timeout=15):
        self.timeout = timeout
        self.slots = _READ_SLOTS

    def __call__(self, source, pages):
        if not self.slots.acquire(blocking=False):
            raise WorkspaceError('presentation_paper_busy',
                                 '正在读取另一篇论文，请稍后重试。', 429)
        try:
            return self.read(source, pages)
        finally:
            self.slots.release()

    def run(self, source, pages):
        return subprocess.run(
            [sys.executable, str(PROBE), str(source), json.dumps(pages)],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=self.timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    def read(self, source, pages):
        if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
            raise WorkspaceError('presentation_paper_pages',
                                 '请选择 1–60 个要读取的页码。', 422)
        try:
            result = self.run(source, pages)
        except subprocess.TimeoutExpired:
            raise WorkspaceError('presentation_paper_timeout',
                                 '读取论文文字超时，请减少所选页码后重试。', 422) from None
        except OSError:
            raise WorkspaceError('presentation_paper_unavailable',
                                 '暂时无法读取论文文字，请稍后重试。', 503) from None
        try:
            payload = json.loads(result.stdout)
        except (ValueError, TypeError):
            payload = None
        if not isinstance(payload, dict):
            raise WorkspaceError('presentation_paper_unreadable',
                                 '无法从这份 PDF 提取文字，请检查文件后重试。', 422)
        code = payload.get('error')
        if code in MESSAGES:
            raise WorkspaceError(*MESSAGES[code])
        extracted = payload.get('pages')
        count = payload.get('page_count')
        total = payload.get('text_chars')
        if (result.returncode != 0 or type(count) is not int
                or not isinstance(extracted, list) or len(extracted) != len(pages)
                or type(total) is not int or not 0 <= total <= MAX_CHARS):
            raise WorkspaceError('presentation_paper_unreadable',
                                 '无法从这份 PDF 提取文字，请检查文件后重试。', 422)
        result_pages = []
        for expected, item in zip(pages, extracted):
            if (not isinstance(item, dict) or item.get('page') != expected
                    or not isinstance(item.get('text'), str)):
                raise WorkspaceError('presentation_paper_unreadable',
                                     '无法从这份 PDF 提取文字，请检查文件后重试。', 422)
            result_pages.append({'page': expected, 'text': item['text']})
        if sum(len(item['text']) for item in result_pages) != total:
            raise WorkspaceError('presentation_paper_unreadable',
                                 '无法从这份 PDF 提取文字，请检查文件后重试。', 422)
        return {'page_count': count, 'pages': result_pages, 'text_chars': total}
