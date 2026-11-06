"""Fixed bounded PDF page-text operation for the presentation slice.

The caller never supplies an executable, a path flag or free-form page text:
argv 1 is the already verified store path and argv 2 is a JSON array of
ascending integer page numbers.  Output is capped by refusing (not trimming)
selections beyond the hard character budget.
"""
import json
import logging
import sys

from pypdf import PdfReader

MAX_PAGES = 60
MAX_CHARS = 120000
MAX_PDF_PAGES = 200


def requested_pages(raw):
    pages = json.loads(raw)
    if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
        raise ValueError('Page selection')
    if any(type(page) is not int or not 1 <= page <= MAX_PDF_PAGES for page in pages):
        raise ValueError('Page bounds')
    if pages != sorted(set(pages)):
        raise ValueError('Page order')
    return pages


def extract(path, pages):
    reader = PdfReader(path)
    if reader.is_encrypted:
        return {'error': 'encrypted'}
    count = len(reader.pages)
    if not 1 <= count <= MAX_PDF_PAGES:
        return {'error': 'invalid'}
    if any(page > count for page in pages):
        return {'error': 'page_bounds', 'page_count': count}
    extracted = []
    total = 0
    for page in pages:
        text = reader.pages[page - 1].extract_text() or ''
        total += len(text)
        if total > MAX_CHARS:
            return {'error': 'char_limit', 'text_chars': total, 'page_count': count}
        extracted.append({'page': page, 'text': text})
    return {'page_count': count, 'pages': extracted, 'text_chars': total}


if __name__ == '__main__':
    logging.disable(logging.CRITICAL)
    try:
        result = extract(sys.argv[1], requested_pages(sys.argv[2]))
    except Exception:
        result = {'error': 'unreadable'}
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(1 if 'error' in result else 0)
