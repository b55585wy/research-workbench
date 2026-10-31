import json
import os
from pathlib import Path
import subprocess
import sys
import threading

from .models import MAX_PAGES, WorkspaceError

PROBE = Path(__file__).with_name('pdf_probe.py')
MESSAGES = {'invalid_pdf': '无法读取这份 PDF，请检查文件后重试。',
            'encrypted_pdf': '请先解除 PDF 密码保护，再添加资料。',
            'page_limit': '目前支持最多 200 页的 PDF，请先拆分文件。'}


class PdfValidator:
    def __init__(self, timeout=8):
        self.timeout = timeout
        self.slots = threading.BoundedSemaphore(1)

    def __call__(self, path):
        if not self.slots.acquire(blocking=False):
            raise WorkspaceError('parser_busy', '正在检查另一份 PDF，请稍后重试。', 429)
        try:
            return self.run(path)
        finally:
            self.slots.release()

    def run(self, path):
        try:
            result = subprocess.run([sys.executable, str(PROBE), str(path)],
                capture_output=True, text=True, encoding='utf-8', errors='replace',
                timeout=self.timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except subprocess.TimeoutExpired as error:
            raise WorkspaceError('parser_timeout', 'PDF 检查超时，请换用较小文件或稍后重试。', 422) from error
        except OSError as error:
            raise WorkspaceError('parser_unavailable', '暂时无法检查 PDF，请稍后重试。', 503) from error
        try:
            payload = json.loads(result.stdout)
        except (ValueError, TypeError) as error:
            raise WorkspaceError('parser_failed', 'PDF 检查未完成，请重试或换用其他文件。', 422) from error
        code = payload.get('error') if isinstance(payload, dict) else None
        if code in MESSAGES:
            raise WorkspaceError(code, MESSAGES[code])
        count = payload.get('page_count') if isinstance(payload, dict) else None
        if result.returncode != 0 or type(count) is not int or not 1 <= count <= MAX_PAGES:
            raise WorkspaceError('parser_failed', 'PDF 检查未完成，请重试或换用其他文件。', 422)
        return count
