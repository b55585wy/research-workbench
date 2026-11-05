"""Bounded checks for transparent, antialiased PDF text-box appearances.

The rest of the annotated-PDF matrix is covered elsewhere; these cases only assert the
text-box appearance contract: a same-sized DeviceGray /SMask, no white annotation
background, visible antialiased ink, and unchanged page content or source bytes.
"""
import hashlib
from uuid import uuid4
import zlib

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject
import pytest

from annotation_pdf_support import marked, raster, request, saved, source_pdf
from research_workbench import annotated_pdf_worker as worker
from research_workbench.shape_annotations import TEXTBOX_COLORS
from research_workbench.textbox_render import (TextboxOverflow, TextboxRenderBudget,
    TextboxResourceTooLarge, render)

BOX = [[.10, .20], [.70, .45]]
TEXT = 'SYNTHETIC textbox 透明 αβ'


def shape(color='black', font_size=14, points=BOX):
    return {'kind': 'textbox', 'color': color, 'font_size': font_size, 'points': points}


def textbox(source, text=TEXT, *, color='black', font_size=14, points=BOX, page=1):
    note = saved(source, page=page, text=text)
    left, top = points[0]
    right, bottom = points[1]
    left, right = sorted((left, right))
    top, bottom = sorted((top, bottom))
    note['rect'] = [left, top, right, bottom]
    note['shape_annotation'] = {**shape(color, font_size, points), 'source_sha256': source['sha256']}
    return note


def ink(color):
    value = TEXTBOX_COLORS[color]
    return tuple(int(value[index:index + 2], 16) for index in (1, 3, 5))


def color_counts(image):
    counts = image.getcolors(maxcolors=1 << 22)
    assert counts is not None
    return {color: count for count, color in counts}


def solid_source(job):
    """One page fully filled with a non-white color below the text box."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=500)
    stream = DecodedStreamObject()
    stream.set_data(b'0 0 1 rg 0 0 400 500 re f')
    page[NameObject('/Contents')] = writer._add_object(stream)
    with (job / 'source.pdf').open('wb') as target:
        writer.write(target)
    writer.close()
    raw = (job / 'source.pdf').read_bytes()
    return dict(id=str(uuid4()), sha256=hashlib.sha256(raw).hexdigest(),
                byte_size=len(raw), page_count=1)


@pytest.mark.parametrize('color', list(TEXTBOX_COLORS))
def test_raster_is_transparent_with_antialiased_selected_ink(color):
    result = render(shape(color), TEXT, 300, 90, TextboxRenderBudget())
    width, height = result['pixel_width'], result['pixel_height']
    alpha = zlib.decompress(result['mask'])
    plane = zlib.decompress(result['data'])
    assert plane == bytes(ink(color)) * (width * height)
    assert len(alpha) == width * height
    # Nothing is painted above or below the single wrapped line inside the padded box.
    assert alpha[:width] == bytes(width)
    assert alpha[-width:] == bytes(width)
    assert alpha.count(0) > 0 and alpha.count(255) > 0
    assert any(0 < value < 255 for value in alpha)


def test_export_embeds_same_size_devicegray_mask_without_white_background(tmp_path):
    source = source_pdf(tmp_path)
    request(tmp_path, source, [textbox(source)])
    original = (tmp_path / 'source.pdf').read_bytes()
    result = worker.build(tmp_path)
    assert result['status'] == 'ok' and result['note_count'] == 1
    assert (tmp_path / 'source.pdf').read_bytes() == original
    reader = PdfReader(tmp_path / 'output.pdf')
    # /SMask transparency is a 1.4 feature; the writer only ever raises the original version.
    assert reader.pdf_header >= '%PDF-1.4'
    value = reader.pages[0]['/Annots'][0].get_object()
    assert value['/Subtype'] == '/FreeText'
    assert value['/Contents'] == TEXT
    # No opaque annotation fill and no opacity-only trick: the image pixels carry alpha.
    assert '/C' not in value and '/CA' not in value
    form = value['/AP']['/N'].get_object()
    image = form['/Resources']['/XObject']['/Im0'].get_object()
    mask = image['/SMask'].get_object()
    assert image['/ColorSpace'] == '/DeviceRGB'
    assert mask['/ColorSpace'] == '/DeviceGray'
    assert int(mask['/BitsPerComponent']) == 8
    width, height = int(image['/Width']), int(image['/Height'])
    assert (int(mask['/Width']), int(mask['/Height'])) == (width, height)
    alpha = mask.get_data()
    assert len(alpha) == width * height
    assert alpha.count(0) > alpha.count(255) > 0
    assert any(0 < value < 255 for value in alpha)


def test_page_content_under_the_text_box_stays_visible(tmp_path):
    source = solid_source(tmp_path)
    request(tmp_path, source, [textbox(source, text='SYNTHETIC')])
    before = raster(tmp_path / 'source.pdf')
    worker.build(tmp_path)
    after = raster(tmp_path / 'output.pdf')
    try:
        width, height = after.size
        box = (round(BOX[0][0] * width), round(BOX[0][1] * height),
               round(BOX[1][0] * width), round(BOX[1][1] * height))
        crop = after.crop(box)
        try:
            counts = color_counts(crop)
        finally:
            crop.close()
        total = sum(counts.values())
        assert counts.get((255, 255, 255), 0) == 0
        assert counts.get((0, 0, 255), 0) > .9 * total
        assert counts.get(ink('black'), 0) > 0
        assert len(counts) > 10
        # The lower part of the box has no glyphs and must show the original page color.
        spot = (box[0] + (box[2] - box[0]) // 2, box[3] - 8)
        assert after.getpixel(spot) == (0, 0, 255) == before.getpixel(spot)
    finally:
        before.close()
        after.close()


def test_other_annotation_appearances_stay_vector_while_textbox_uses_a_mask(tmp_path):
    source = source_pdf(tmp_path)
    request(tmp_path, source, [textbox(source), marked(source)])
    worker.build(tmp_path)
    values = [value.get_object() for value in PdfReader(tmp_path / 'output.pdf').pages[0]['/Annots']]
    by_subtype = {value['/Subtype']: value for value in values}
    # Highlight appearances are either viewer-generated or a vector form; never an image mask.
    highlight = by_subtype['/Highlight'].get('/AP')
    if highlight is not None:
        assert '/XObject' not in highlight['/N'].get_object()['/Resources']
    textbox_image = (by_subtype['/FreeText']['/AP']['/N'].get_object()
                     ['/Resources']['/XObject']['/Im0'].get_object())
    assert '/SMask' in textbox_image


def test_bounded_raster_budget_and_overflow_guards_are_unchanged():
    with pytest.raises(TextboxResourceTooLarge):
        render(shape(), 'x', 300, 90, TextboxRenderBudget(total=10))
    with pytest.raises(TextboxOverflow):
        render(shape(font_size=48), 'long ' * 40, 160, 30, TextboxRenderBudget())
