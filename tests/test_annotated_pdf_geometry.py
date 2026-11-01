from contextlib import closing
import hashlib

from PIL import ImageChops
import pypdfium2 as pdfium
from pypdf import PdfReader
import pytest

from annotation_pdf_support import source_pdf, marked, saved, request, raster
from research_workbench import annotated_pdf_worker as worker
from research_workbench.pdf_annotation_contract import COLORS


def changed_pixels(source, target):
    with raster(source) as before, raster(target) as after:
        assert before.size == after.size
        difference = ImageChops.difference(before, after).convert('L').point(lambda v: 255 if v > 3 else 0)
        return difference


@pytest.mark.parametrize('rotation', [0, 90, 180, 270])
@pytest.mark.parametrize('box', ['plain', 'cropped', 'shifted'])
@pytest.mark.parametrize('unit', [1, 2])
@pytest.mark.parametrize('kind', ['highlight', 'underline'])
def test_native_visible_mark_occupies_selected_rotated_crop_region(tmp_path, rotation, box, unit, kind):
    source = source_pdf(tmp_path, rotation, box, unit)
    note = marked(source, kind=kind)
    request(tmp_path, source, [note])
    original = (tmp_path/'source.pdf').read_bytes()
    result = worker.build(tmp_path)
    assert result['note_count'] == 1 and result['page_count'] == 1
    assert (tmp_path/'source.pdf').read_bytes() == original
    with changed_pixels(tmp_path/'source.pdf', tmp_path/'output.pdf') as diff:
        bounds = diff.getbbox()
        assert bounds is not None
        normalized = [bounds[0]/diff.width, bounds[1]/diff.height, bounds[2]/diff.width, bounds[3]/diff.height]
        left, top, right, bottom = note['rect']
        assert left-.02 <= normalized[0] <= left+.03
        assert right-.03 <= normalized[2] <= right+.02
        assert top-.02 <= normalized[1] and normalized[3] <= bottom+.02
        if kind == 'underline':
            assert normalized[1] >= bottom-.025
        else:
            assert normalized[1] <= top+.02 and normalized[3] >= bottom-.02


@pytest.mark.parametrize('rotation', [0, 90, 180, 270])
def test_inherited_rotation_uses_the_same_visible_page_coordinates(tmp_path, rotation):
    source = source_pdf(tmp_path, rotation, inherited=True)
    request(tmp_path, source, [marked(source)])
    worker.build(tmp_path)
    with changed_pixels(tmp_path/'source.pdf', tmp_path/'output.pdf') as diff:
        bounds = diff.getbbox()
        assert bounds and abs(bounds[0]/diff.width-.18) < .02 and abs(bounds[1]/diff.height-.30) < .02


@pytest.mark.parametrize('rotation', [0, 90, 180, 270])
def test_coordinate_conversion_matches_independent_inverse_rotation(tmp_path, rotation):
    source_pdf(tmp_path, rotation, box='cropped')
    u, v = .23, .61
    x0, y0, width, height = 25, 40, 350, 410
    normalized = {0: (u, 1-v), 90: (v, u), 180: (1-u, v), 270: (1-v, 1-u)}[rotation]
    expected = x0+normalized[0]*width, y0+normalized[1]*height
    with closing(pdfium.PdfDocument(tmp_path/'source.pdf')) as document, closing(document[0]) as page:
        assert worker.point(page, u, v) == pytest.approx(expected, abs=.001)


@pytest.mark.parametrize('color', list(COLORS))
@pytest.mark.parametrize('kind', ['highlight', 'underline'])
def test_multiline_export_has_real_colors_and_does_not_fill_line_gaps(tmp_path, color, kind):
    source = source_pdf(tmp_path)
    rects = [[.1, .12, .65, .17], [.1, .3, .65, .35]]
    request(tmp_path, source, [marked(source, rects, kind, color)])
    worker.build(tmp_path)
    reader = PdfReader(tmp_path/'output.pdf')
    value = reader.pages[0]['/Annots'][0].get_object()
    assert len(value['/QuadPoints']) == 16 and value['/Subtype'] == '/'+kind.title()
    expected = [int(COLORS[color][i:i+2], 16)/255 for i in (0, 2, 4)]
    assert list(value['/C']) == pytest.approx(expected, abs=.000002)
    with changed_pixels(tmp_path/'source.pdf', tmp_path/'output.pdf') as diff:
        gap = diff.crop((int(.1*diff.width), int(.20*diff.height), int(.65*diff.width), int(.27*diff.height)))
        try:
            assert gap.getbbox() is None
        finally:
            gap.close()


def test_original_text_outlines_metadata_existing_annotations_and_unicode_comments_survive(tmp_path):
    source = source_pdf(tmp_path, pages=2, existing=True)
    notes = [marked(source), saved(source, page=2, text='Unicode 注释 αβ🙂 /JS <script> (literal)')]
    request(tmp_path, source, notes)
    before = PdfReader(tmp_path/'source.pdf')
    worker.build(tmp_path)
    after = PdfReader(tmp_path/'output.pdf')
    assert [p.extract_text() for p in before.pages] == [p.extract_text() for p in after.pages]
    assert before.pages[0].extract_text().strip() == 'SYNTHETIC ORIGINAL PAGE 1'
    assert after.metadata.title == before.metadata.title and after.metadata.author == before.metadata.author
    assert after.outline[0]['/Title'] == before.outline[0]['/Title']
    annots = [r.get_object() for p in after.pages for r in p.get('/Annots', [])]
    assert any(a['/Contents'] == 'Original embedded comment' for a in annots)
    assert any(a['/Contents'] == notes[1]['text'] for a in annots)
    assert all('/A' not in a and '/AA' not in a and '/JS' not in a for a in annots)
    assert hashlib.sha256((tmp_path/'source.pdf').read_bytes()).hexdigest() == source['sha256']


def test_short_page_whole_page_and_edge_region_notes_stay_within_page(tmp_path):
    source = source_pdf(tmp_path, box='short')
    request(tmp_path, source, [saved(source), saved(source, rect=[0, 0, 1, 1])])
    worker.build(tmp_path)
    reader = PdfReader(tmp_path/'output.pdf')
    values = [r.get_object() for r in reader.pages[0]['/Annots']]
    assert {n['/Subtype'] for n in values} == {'/Text', '/Square'}
    assert all(0 <= n['/Rect'][0] < n['/Rect'][2] <= 400 and 0 <= n['/Rect'][1] < n['/Rect'][3] <= 50 for n in values)
