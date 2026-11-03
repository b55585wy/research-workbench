"""One disposable paragraph-reading parse: no database, no model, no agent.

The Web process starts this fixed module only for an explicit prepare request.
It owns the same 4 GiB / 8-process job object as the translation worker, calls
the pinned local MinerU Flash txt parser and writes one bounded JSON result.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import threading
import time
from uuid import UUID

from .models import WorkspaceError
from .translation_process import own_process_tree
from .translation_runtime import TranslationRuntime

MAX_OUTPUT = 4 * 1024 * 1024
MAX_PAGES = 5
MAX_DOCUMENT_PAGES = 200
ERRORS = {'translation_runtime_unavailable': 'reading_runtime_unavailable',
          'translation_cancelled': 'reading_prepare_cancelled',
          'translation_parse_timeout': 'reading_prepare_timeout',
          'translation_parse_failed': 'reading_parse_failed'}


def request_of(path, documents):
    """Accept only the owned request file and the active document source."""
    request = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(request, dict) or set(request) != {'pdf', 'pages'}:
        raise ValueError()
    pages = request['pages']
    if (not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES
            or any(type(page) is not int or not 1 <= page <= MAX_DOCUMENT_PAGES for page in pages)
            or len(set(pages)) != len(pages)):
        raise ValueError()
    source = Path(request['pdf'])
    if (not source.is_absolute() or source.parent != documents or source.suffix != '.pdf'):
        raise ValueError()
    UUID(source.stem)
    return source, list(pages)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--documents', type=Path, required=True)
    parser.add_argument('--runtime', type=Path)
    args = parser.parse_args()
    tree = own_process_tree()
    stop = threading.Event()

    def parent_closed():
        try:
            os.read(sys.stdin.fileno(), 1)
        finally:
            stop.set()
            time.sleep(2)
            os._exit(3)

    threading.Thread(target=parent_closed, daemon=True).start()
    scratch, output = args.scratch.resolve(), args.output.resolve()
    request = args.request.resolve()
    if (request.parent != scratch or request.name != 'request.json'
            or output.parent != scratch or output.name != 'result.json'
            or not scratch.is_dir()):
        return 3
    try:
        source, pages = request_of(request, args.documents.resolve())
    except (OSError, ValueError, TypeError, KeyError):
        return 3
    try:
        result = {'ok': True, 'pages': TranslationRuntime(args.runtime, scratch).parse(
            source, pages, stop.is_set)}
    except WorkspaceError as error:
        result = {'ok': False, 'error': ERRORS.get(error.code, 'reading_parse_failed')}
    except Exception:
        result = {'ok': False, 'error': 'reading_parse_failed'}
    payload = json.dumps(result, ensure_ascii=False, separators=(',', ':'))
    if len(payload.encode('utf-8')) > MAX_OUTPUT:
        payload = json.dumps({'ok': False, 'error': 'reading_parse_failed'})
    temporary = output.with_name('result.tmp')
    temporary.write_text(payload, encoding='utf-8')
    temporary.replace(output)
    return 0


if __name__ == '__main__':
    sys.exit(main())
