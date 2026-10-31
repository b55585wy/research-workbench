"""Bounded fixed PDF-text operation; no model-selected executable or path."""
import json
import sys

from pypdf import PdfReader


if __name__=='__main__':
    try:
        reader=PdfReader(sys.argv[1])
        number=int(sys.argv[2])
        if not 1<=number<=len(reader.pages):
            raise ValueError('Page bounds')
        text=reader.pages[number-1].extract_text() or ''
        print(json.dumps({'page':number,'text':text[:12000],'truncated':len(text)>12000},ensure_ascii=True))
    except Exception:
        print(json.dumps({'error':'text_unavailable'}))
        raise SystemExit(1)
