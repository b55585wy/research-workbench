"""One fixed, short-lived PDF annotation builder; no web-process PDF parsing."""
from contextlib import closing
import ctypes
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from research_workbench.pdf_annotation_contract import FORMAT, MAX_OUTPUT_BYTES, MAX_PAYLOAD_BYTES, COLORS, SnapshotTooLarge, snapshot


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def install_limits():
    from research_workbench.import_limits import limit_memory
    handle = limit_memory()
    if os.name != 'nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    return handle


def point(page, x, y):
    import pypdfium2.raw as raw
    px, py = ctypes.c_double(), ctypes.c_double()
    # A square device viewport maps normalized axes without a bitmap allocation.
    ok = raw.FPDF_DeviceToPage(page.raw, 0, 0, 1000000, 1000000, 0,
                              round(x * 1000000), round(y * 1000000), ctypes.byref(px), ctypes.byref(py))
    if not ok or not all(math.isfinite(v) for v in (px.value, py.value)):
        raise ValueError('Invalid page transformation')
    return px.value, py.value


def quad(page, rect):
    left, top, right, bottom = rect
    return [point(page, x, y) for x, y in ((left, top), (right, top), (left, bottom), (right, bottom))]


def bounds(points):
    result = min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points)
    if result[0] >= result[2] or result[1] >= result[3]:
        raise ValueError('Degenerate page geometry')
    return result


def note_contents(note):
    markup = note['annotation']
    if markup and markup['quote'] != note['text']:
        return '原文 / Quotation:\n' + markup['quote'] + '\n\n说明 / Note:\n' + note['text']
    return note['text']


def underline_appearance(writer, value, points):
    from pypdf.generic import DictionaryObject, DecodedStreamObject, NameObject, RectangleObject
    number = lambda v: format(float(v), '.8f').rstrip('0').rstrip('.') or '0'
    commands = ['q', ' '.join(number(v) for v in value['/C']) + ' RG']
    for index in range(0, len(points), 4):
        top, _, left, right = points[index:index+4]
        dx, dy = top[0]-left[0], top[1]-left[1]
        height = math.hypot(dx, dy)
        if height <= 0:
            raise ValueError('Degenerate underline geometry')
        width = min(1, height/3)
        shift = .75 * width / height
        p1 = left[0]+dx*shift, left[1]+dy*shift
        p2 = right[0]+dx*shift, right[1]+dy*shift
        commands.append(f'{number(width)} w {number(p1[0])} {number(p1[1])} m {number(p2[0])} {number(p2[1])} l S')
    commands.append('Q')
    form = DecodedStreamObject()
    form.set_data(('\n'.join(commands)+'\n').encode('ascii'))
    form.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Form'),
                 NameObject('/BBox'): RectangleObject(value['/Rect']), NameObject('/Resources'): DictionaryObject()})
    # Explicit appearance keeps the selected baseline correct under page rotation.
    value[NameObject('/AP')] = DictionaryObject({NameObject('/N'): writer._add_object(form)})


def make_annotation(page, note, index, writer):
    from pypdf.annotations import Highlight, Rectangle, Text
    from pypdf.generic import ArrayObject, FloatObject, NameObject, NumberObject, TextStringObject
    markup = note['annotation']
    if markup:
        points = [p for rect in markup['rects'] for p in quad(page, rect)]
        value = Highlight(rect=bounds(points), quad_points=ArrayObject([FloatObject(v) for p in points for v in p]),
                          highlight_color=COLORS[markup['color']], printing=True)
        if markup['kind'] == 'underline':
            value[NameObject('/Subtype')] = NameObject('/Underline')
            underline_appearance(writer, value, points)
        value[NameObject('/CA')] = FloatObject(.4 if markup['kind'] == 'highlight' else 1)
    elif note['rect'] is not None:
        value = Rectangle(bounds(quad(page, note['rect'])))
        value[NameObject('/C')] = ArrayObject([FloatObject(v) for v in (.15, .45, .85)])
    else:
        x, y = .94 - (index % 12) * .04, .02 + ((index // 12) % 12) * .035
        value = Text(rect=bounds(quad(page, [x, y, x + .025, y + .02])), text=note_contents(note), open=False)
        value[NameObject('/C')] = ArrayObject([FloatObject(v) for v in (1, .85, .25)])
    value[NameObject('/F')] = NumberObject(4)
    value[NameObject('/T')] = TextStringObject('Synrise Neuro')
    value[NameObject('/Contents')] = TextStringObject(note_contents(note))
    value[NameObject('/NM')] = TextStringObject('synrise-' + note['id'])
    return value


def build(job):
    import pypdfium2 as pdfium
    from pypdf import PdfReader, PdfWriter
    request = job / 'request.json'
    if request.stat().st_size > MAX_PAYLOAD_BYTES:
        raise ValueError('Snapshot budget exceeded')
    raw = json.loads(request.read_text(encoding='utf-8'))
    if raw.get('format') != FORMAT:
        raise ValueError('Invalid snapshot version')
    data, _ = snapshot(raw['document'], raw['notes'])
    source, output = job / 'source.pdf', job / 'output.pdf'
    document = data['document']
    if source.stat().st_size != document['byte_size'] or file_hash(source) != document['sha256']:
        raise ValueError('Source mismatch')
    with source.open('rb') as stream, closing(pdfium.PdfDocument(source)) as native:
        reader = PdfReader(stream)
        if reader.is_encrypted or len(reader.pages) != document['page_count'] or len(native) != document['page_count']:
            raise ValueError('Invalid source document')
        writer = PdfWriter(clone_from=reader)
        if writer.pdf_header < '%PDF-1.7':
            writer.pdf_header = '%PDF-1.7'
        for index, note in enumerate(data['notes']):
            with closing(native[note['page'] - 1]) as page:
                writer.add_annotation(note['page'] - 1, make_annotation(page, note, index, writer))
        with output.open('wb') as target:
            writer.write(target)
        writer.close()
    size = output.stat().st_size
    if size > MAX_OUTPUT_BYTES:
        raise SnapshotTooLarge('Output budget exceeded')
    if size < 1:
        raise ValueError('Empty output')
    with output.open('rb') as stream:
        if len(PdfReader(stream).pages) != document['page_count']:
            raise ValueError('Incomplete output')
    return {'status': 'ok', 'sha256': file_hash(output), 'byte_size': size,
            'source_sha256': document['sha256'], 'page_count': document['page_count'], 'note_count': len(data['notes'])}


if __name__ == '__main__':
    try:
        limit_handle = install_limits()
        logging.getLogger('pypdf').setLevel(logging.CRITICAL)
        print(json.dumps(build(Path(sys.argv[1]))))
    except SnapshotTooLarge:
        print(json.dumps({'error': 'pdf_export_too_large'}))
        raise SystemExit(1)
    except Exception:
        print(json.dumps({'error': 'pdf_export_failed'}))
        raise SystemExit(1)
