"""Fixed MinerU Flash txt entry, executed only in the separate pinned runtime."""
import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading

VISUAL = {'image', 'table', 'chart', 'code'}
INLINE = {'text', 'equation_inline', 'code_inline', 'hyperlink'}


def units_from_blocks(blocks):
    result = []

    def add(kind, text, box, truncated=False):
        if len(result) >= 240:
            if len(result) == 240:
                result.append({'t': 'text', 'text': '', 'bbox': None, 'truncated': True})
            return
        if text or kind not in ('text', 'ref_text'):
            result.append({'t': kind, 'text': text[:2401], 'bbox': box,
                           'truncated': truncated or len(text) > 2400})

    def inline(spans, kind, box):
        text = []
        for span in spans:
            typ = span.get('type')
            if typ == 'text':
                text.append(span.get('content', ''))
            elif typ == 'hyperlink':
                # Links are text only; their destinations are never opened.
                for child in span.get('content', []):
                    if child.get('type') == 'text':
                        text.append(child.get('content', ''))
                    else:
                        add(kind, ''.join(text), box); text = []
                        add('equation' if child.get('type') == 'equation_inline' else 'code_body', child.get('content', ''), box)
            else:
                add(kind, ''.join(text), box); text = []
                add('equation' if typ == 'equation_inline' else 'code_body', span.get('content', ''), box)
        add(kind, ''.join(text), box)

    def visit(block, depth=0):
        if depth > 16 or len(result) > 240:
            return
        kind, content, box = block.get('type', 'other'), block.get('content'), block.get('bbox')
        if isinstance(content, list) and content and all(isinstance(x, dict) and x.get('type') in INLINE for x in content):
            inline(content, kind, box)
            return
        if kind in VISUAL:
            add(kind, '', box)
        if isinstance(content, list):
            for child in content:
                if not isinstance(child, dict):
                    continue
                # Visual bodies contain HTML/base64, not translatable prose.
                if str(child.get('type', '')).endswith('_body'):
                    continue
                visit(child, depth + 1)
        elif isinstance(content, str):
            add(kind, content if kind not in VISUAL else '', box)
        elif kind not in VISUAL:
            add(kind, '', box)

    for block in blocks:
        visit(block)
    return result


def main():
    if os.read(sys.stdin.fileno(), 1) != b'1':
        return 3

    def parent_closed():
        os.read(sys.stdin.fileno(), 1)
        os._exit(3)

    threading.Thread(target=parent_closed, daemon=True).start()
    if os.name != 'nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
    request_path = Path(sys.argv[1]).resolve()
    request = json.loads(request_path.read_text(encoding='utf-8'))
    output = Path(request['output']).resolve()
    if output.parent != request_path.parent or output.name != 'result.json':
        return 3
    pages = request['pages']
    if (not isinstance(pages, list) or not 1 <= len(pages) <= 5
            or any(type(p) is not int or not 1 <= p <= 200 for p in pages)
            or len(set(pages)) != len(pages)):
        return 3
    for name, version in (('mineru', '4.1.5'), ('docvortex', '0.6.11')):
        if importlib.metadata.version(name) != version:
            return 3
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        safe_geometry = set()
        try:
            from pypdf import PdfReader
            reader = PdfReader(request['pdf'], strict=False)
            for number in pages:
                original = reader.pages[number - 1]
                media, crop = original.mediabox, original.cropbox
                if (int(original.rotation) % 360 == 0 and list(media) == list(crop)
                        and float(media.left) == 0 and float(media.bottom) == 0):
                    safe_geometry.add(number - 1)
        except Exception:
            pass  # Unknown crop/rotation retains page-only provenance.
        from mineru.parser import parse
        parsed = parse(request['pdf'], tier='flash', ocr_mode='txt',
                       image_analysis=False, page_range=','.join(map(str, pages)))
        result = [{'page_idx': page.page_idx,
                   'units': units_from_blocks([block.model_dump(mode='json') for block in page.blocks])}
                  for page in parsed.pages]
        for page in result:
            if page['page_idx'] not in safe_geometry:
                for unit in page['units']:
                    unit['bbox'] = None
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(encoded) > 4 * 1024 * 1024:
        return 3
    output.write_bytes(encoded)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # Only the caller publishes a safe error; parser traces can include PDF text.
        sys.exit(2)
