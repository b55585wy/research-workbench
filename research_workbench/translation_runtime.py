"""Pinned parser subprocess; no parser imports or subprocesses on readiness GET."""
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

from .models import WorkspaceError

MAX_OUTPUT = 4 * 1024 * 1024


class TranslationRuntime:
    def __init__(self, root, scratch_root=None):
        self.root = Path(root).resolve() if root else None
        self.scratch_root = scratch_root

    def specification(self):
        if self.root is None:
            raise ValueError()
        manifest = self.root / 'runtime.json'
        if manifest.stat().st_size > 8192:
            raise ValueError()
        data = json.loads(manifest.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError()
        expected = {'schema_version': 1, 'engine': 'mineru-flash-txt',
                    'mineru_version': '4.1.5', 'docvortex_version': '0.6.11'}
        if any(data.get(key) != value for key, value in expected.items()):
            raise ValueError()
        python = Path(data['python'])
        if not python.is_absolute() or not python.is_file() or not python.resolve().is_relative_to(self.root):
            raise ValueError()
        env = python.parent.parent
        sites = [env / 'Lib/site-packages', *sorted((env / 'lib').glob('python*/site-packages'))]
        for name, version in (('mineru', '4.1.5'), ('docvortex', '0.6.11')):
            found = False
            for site in sites:
                meta = site / f'{name}-{version}.dist-info/METADATA'
                if meta.is_file() and f'\nVersion: {version}\n' in '\n' + meta.read_text(encoding='utf-8').replace('\r\n', '\n'):
                    found = True
            if not found:
                raise ValueError()
        return python

    def probe(self):
        try:
            self.specification()
            return True, None
        except (OSError, ValueError, TypeError, KeyError):
            return False, '尚未配置本地 PDF 翻译解析环境；原文仍可正常阅读。'

    def parse(self, path, pages, cancelled):
        try:
            python = self.specification()
        except (OSError, ValueError, TypeError, KeyError):
            raise WorkspaceError('translation_runtime_unavailable', '本地解析环境未就绪。', 409) from None
        with tempfile.TemporaryDirectory(prefix='research-translation-', dir=self.scratch_root) as temporary:
            directory = Path(temporary).resolve()
            request, output = directory / 'request.json', directory / 'result.json'
            request.write_text(json.dumps({'pdf': str(path.resolve()), 'pages': pages,
                                           'output': str(output)}), encoding='utf-8')
            env = {key: value for key, value in os.environ.items()
                   if key.upper() not in ('PYTHONPATH', 'PYTHONHOME')}
            env.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                       MODELSCOPE_OFFLINE='1', TOKENIZERS_PARALLELISM='false',
                       OMP_NUM_THREADS='2', MKL_NUM_THREADS='2')
            command = [str(python), '-I', str(Path(__file__).with_name('translation_parser.py')), str(request)]
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, env=env, cwd=directory,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            try:
                process.stdin.write(b'1'); process.stdin.flush()
                deadline = time.monotonic() + 120
                while process.poll() is None:
                    if cancelled():
                        raise WorkspaceError('translation_cancelled', '翻译已停止。', 409)
                    if time.monotonic() >= deadline:
                        raise WorkspaceError('translation_parse_timeout', '本地解析超时，请减少页数后重试。', 409)
                    time.sleep(.1)
                if process.returncode != 0 or not output.is_file() or output.stat().st_size > MAX_OUTPUT:
                    raise ValueError()
                return validate_result(json.loads(output.read_text(encoding='utf-8')), pages)
            except (ValueError, TypeError, KeyError, OSError):
                raise WorkspaceError('translation_parse_failed', '本地解析未能产生可用内容，原文保留。', 409) from None
            finally:
                try:
                    process.stdin.close()
                except OSError:
                    pass
                if process.poll() is None:
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        if os.name == 'nt':
                            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                        else:
                            process.kill()
                process.wait(timeout=5)


def validate_result(value, pages):
    if not isinstance(value, list) or len(value) != len(pages):
        raise ValueError()
    seen = set()
    total = 0
    for page in value:
        if not isinstance(page, dict):
            raise ValueError()
        index = page.get('page_idx')
        if type(index) is not int or index + 1 not in pages or index in seen:
            raise ValueError()
        seen.add(index)
        units = page.get('units')
        if not isinstance(units, list) or len(units) > 241:
            raise ValueError()
        for unit in units:
            if not isinstance(unit, dict) or not isinstance(unit.get('t'), str) or not isinstance(unit.get('text'), str):
                raise ValueError()
            text = unit['text']
            total += len(text)
            if len(text) > 2401 or total > 65000:
                raise ValueError()
            box = unit.get('bbox')
            if box is not None and not valid_bbox(box):
                raise ValueError()
    return value


def valid_bbox(value):
    return (isinstance(value, (list, tuple)) and len(value) == 4
            and all(type(v) in (int, float) and math.isfinite(v) for v in value)
            and 0 <= value[0] < value[2] <= 1 and 0 <= value[1] < value[3] <= 1)
