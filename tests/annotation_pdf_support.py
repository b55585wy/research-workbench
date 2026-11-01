from contextlib import closing
import hashlib
from pathlib import Path
from uuid import uuid4

import pypdfium2 as pdfium
from pypdf import PdfWriter
from pypdf.annotations import Text
from pypdf.generic import DictionaryObject, NameObject, NumberObject, RectangleObject, DecodedStreamObject

from research_workbench.pdf_annotation_contract import snapshot


def source_pdf(job, rotation=0, box='plain', unit=1, inherited=False, pages=1, existing=False):
    writer = PdfWriter()
    for index in range(pages):
        page = writer.add_blank_page(width=400, height=500)
        if box == 'shifted':
            page.mediabox = RectangleObject([-40, -20, 360, 480])
            page.cropbox = RectangleObject([10, 20, 330, 450])
        elif box == 'cropped':
            page.cropbox = RectangleObject([25, 40, 375, 450])
        elif box == 'short':
            page.mediabox = RectangleObject([0, 0, 400, 50])
        page[NameObject('/UserUnit')] = NumberObject(unit)
        if not inherited:
            page.rotate(rotation)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 14 Tf 40 440 Td (SYNTHETIC ORIGINAL PAGE {index+1}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    if inherited:
        writer._pages.get_object()[NameObject('/Rotate')] = NumberObject(rotation)
    if existing:
        writer.add_annotation(0, Text(rect=(10, 10, 28, 28), text='Original embedded comment'))
    writer.add_outline_item('SYNTHETIC section', 0)
    writer.add_metadata({'/Title': 'SYNTHETIC original title', '/Author': 'Synthetic fixture'})
    source = Path(job) / 'source.pdf'
    with source.open('wb') as stream:
        writer.write(stream)
    writer.close()
    return dict(id=str(uuid4()), sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                byte_size=source.stat().st_size, page_count=pages)


def saved(source, *, page=1, rect=None, annotation=None, text='SYNTHETIC comment 中文'):
    return dict(id=str(uuid4()), document_id=source['id'], page=page, revision=3,
                text=text, rect=rect, annotation=annotation)


def marked(source, rects=None, kind='highlight', color='yellow', page=1):
    rects = rects or [[.18, .30, .62, .38]]
    bounds = [min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects)]
    annotation = dict(kind=kind, color=color, quote='SYNTHETIC original quotation', rects=rects, source_sha256=source['sha256'])
    return saved(source, page=page, rect=bounds, annotation=annotation)


def request(job, source, notes):
    data, encoded = snapshot(source, notes)
    (Path(job) / 'request.json').write_bytes(encoded)
    return data


def raster(path, page=0, draw_annots=True):
    with closing(pdfium.PdfDocument(path)) as document, closing(document[page]) as sheet:
        with closing(sheet.render(scale=1, draw_annots=draw_annots, may_draw_forms=False)) as bitmap:
            image = bitmap.to_pil()
            try:
                return image.convert('RGB')
            finally:
                image.close()
