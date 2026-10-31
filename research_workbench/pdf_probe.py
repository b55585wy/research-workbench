"""Bounded subprocess entry point: validate a PDF without parsing in the web process."""
import json
import logging
from pathlib import Path
import sys

from pypdf import PdfReader


def inspect_pdf(path):
    with Path(path).open('rb') as stream:
        if b'%PDF-' not in stream.read(1024):
            return {'error': 'invalid_pdf'}
        stream.seek(0)
        reader = PdfReader(stream, strict=True)
        if reader.is_encrypted:
            return {'error': 'encrypted_pdf'}
        count = len(reader.pages)
        if count > 200:
            return {'error': 'page_limit'}
        if count < 1:
            return {'error': 'invalid_pdf'}
        return {'page_count': count}


if __name__ == '__main__':
    logging.disable(logging.CRITICAL)
    try:
        result = inspect_pdf(sys.argv[1])
    except Exception:
        result = {'error': 'invalid_pdf'}
    print(json.dumps(result))
    raise SystemExit(1 if 'error' in result else 0)
