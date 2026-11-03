"""One fixed, short-lived PDF annotation builder; no web-process PDF parsing."""
from contextlib import closing
import ctypes
from decimal import Decimal
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from research_workbench.pdf_annotation_contract import FORMAT, MAX_OUTPUT_BYTES, MAX_PAYLOAD_BYTES, COLORS, SnapshotTooLarge, snapshot
from research_workbench.shape_annotations import TEXTBOX_COLORS
from research_workbench.textbox_render import (TextboxFontUnavailable, TextboxOverflow,
    TextboxRenderBudget, TextboxResourceTooLarge, render as render_textbox)


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


def shape_axes(page):
    """Map the normalized page square exactly, without rounding coordinates to millionths.

    DeviceToPage is affine, so three basis corners describe it fully; every shape point is
    then interpolated in float precision instead of being quantized at the device grid.
    """
    import pypdfium2.raw as raw
    extent = 1000000
    corners = []
    for device_x, device_y in ((0, 0), (extent, 0), (0, extent)):
        page_x, page_y = ctypes.c_double(), ctypes.c_double()
        ok = raw.FPDF_DeviceToPage(page.raw, 0, 0, extent, extent, 0, device_x, device_y,
                                   ctypes.byref(page_x), ctypes.byref(page_y))
        if not ok or not all(math.isfinite(v) for v in (page_x.value, page_y.value)):
            raise ValueError('Invalid page transformation')
        corners.append((page_x.value, page_y.value))
    origin, right, top = corners
    if origin == right or origin == top:
        raise ValueError('Degenerate page transformation')
    return origin, right, top


def shape_point(axes, x, y):
    origin, right, top = axes
    dx_x, dx_y = right[0] - origin[0], right[1] - origin[1]
    dy_x, dy_y = top[0] - origin[0], top[1] - origin[1]
    return origin[0] + x * dx_x + y * dy_x, origin[1] + x * dx_y + y * dy_y


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


def number(value):
    # Exact float precision in fixed notation; a fixed 8-decimal format can merge endpoints
    # that differ only in the far decimals of the normalized page fraction.
    return format(Decimal(str(float(value))), 'f')


def color_channels(name):
    value = COLORS[name]
    return [int(value[index:index+2], 16) / 255 for index in (0, 2, 4)]


def appearance(writer, value, commands):
    from pypdf.generic import DictionaryObject, DecodedStreamObject, NameObject, RectangleObject
    stream = DecodedStreamObject()
    stream.set_data(('\n'.join(commands)+'\n').encode('ascii'))
    stream.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Form'),
                   NameObject('/BBox'): RectangleObject(value['/Rect']), NameObject('/Resources'): DictionaryObject()})
    value[NameObject('/AP')] = DictionaryObject({NameObject('/N'): writer._add_object(stream)})


def rectangle_shape(page, note, writer):
    from pypdf.annotations import Rectangle
    from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject
    shape = note['shape_annotation']
    axes = shape_axes(page)
    first, second = (shape_point(axes, *pair) for pair in shape['points'])
    # Raw user-space width; the page UserUnit already applies to these coordinates.
    width = shape['line_width']
    margin = width / 2
    x0, x1 = min(first[0], second[0]), max(first[0], second[0])
    y0, y1 = min(first[1], second[1]), max(first[1], second[1])
    value = Rectangle(rect=(x0-margin, y0-margin, x1+margin, y1+margin))
    channels = color_channels(shape['color'])
    value[NameObject('/C')] = ArrayObject([FloatObject(v) for v in channels])
    value[NameObject('/BS')] = DictionaryObject({NameObject('/W'): NumberObject(width)})
    # /Rect carries the stroke margin; /RD tells viewers where the drawn square sits so the
    # original rectangle is reconstructed instead of the expanded stroke box.
    value[NameObject('/RD')] = ArrayObject([FloatObject(margin) for _ in range(4)])
    # Explicit appearance keeps stroke width/color stable across viewers and page rotation.
    appearance(writer, value, ['q', ' '.join(number(v) for v in channels)+' RG', f'{number(width)} w',
        f'{number(x0)} {number(y0)} {number(x1-x0)} {number(y1-y0)} re S', 'Q'])
    return value


def arrow_shape(page, note, writer):
    from pypdf.annotations import Line
    from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject
    shape = note['shape_annotation']
    axes = shape_axes(page)
    start, end = (shape_point(axes, *pair) for pair in shape['points'])
    dx, dy = end[0]-start[0], end[1]-start[1]
    length = math.hypot(dx, dy)
    if not length > 0:
        raise ValueError('Degenerate arrow geometry')
    # Raw user-space width; the page UserUnit already applies to these coordinates.
    width = shape['line_width']
    head = min(max(8, 4*width), 0.4*length)
    back = math.atan2(-dy, -dx)
    wings = [(end[0]+head*math.cos(back+sign*math.pi/6), end[1]+head*math.sin(back+sign*math.pi/6))
             for sign in (1, -1)]
    margin = width / 2
    xs = [start[0], end[0], wings[0][0], wings[1][0]]
    ys = [start[1], end[1], wings[0][1], wings[1][1]]
    value = Line(p1=start, p2=end, rect=(min(xs)-margin, min(ys)-margin, max(xs)+margin, max(ys)+margin))
    channels = color_channels(shape['color'])
    value[NameObject('/C')] = ArrayObject([FloatObject(v) for v in channels])
    value[NameObject('/LE')] = ArrayObject([NameObject('/None'), NameObject('/OpenArrow')])
    value[NameObject('/BS')] = DictionaryObject({NameObject('/W'): NumberObject(width)})
    stroke = ' '.join(number(v) for v in channels)
    # Shaft plus two open wing strokes, matching /LE /OpenArrow and the frontend head formula.
    appearance(writer, value, ['q', stroke+' RG', f'{number(width)} w', '1 J', '1 j',
        f'{number(start[0])} {number(start[1])} m {number(end[0])} {number(end[1])} l S',
        f'{number(end[0])} {number(end[1])} m {number(wings[0][0])} {number(wings[0][1])} l S',
        f'{number(end[0])} {number(end[1])} m {number(wings[1][0])} {number(wings[1][1])} l S', 'Q'])
    return value


def line_shape(page, note, writer):
    from pypdf.annotations import Line
    from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject
    shape = note['shape_annotation']
    axes = shape_axes(page)
    start, end = (shape_point(axes, *pair) for pair in shape['points'])
    if start == end:
        raise ValueError('Degenerate line geometry')
    # Raw user-space width; the page UserUnit already applies to these coordinates.
    width = shape['line_width']
    margin = width / 2
    value = Line(p1=start, p2=end, rect=(min(start[0], end[0]) - margin, min(start[1], end[1]) - margin,
                                         max(start[0], end[0]) + margin, max(start[1], end[1]) + margin))
    channels = color_channels(shape['color'])
    value[NameObject('/C')] = ArrayObject([FloatObject(v) for v in channels])
    value[NameObject('/LE')] = ArrayObject([NameObject('/None'), NameObject('/None')])
    value[NameObject('/BS')] = DictionaryObject({NameObject('/W'): NumberObject(width)})
    # Explicit vector appearance: no arrowhead, round caps/joins, same geometry as the screen.
    appearance(writer, value, ['q', ' '.join(number(v) for v in channels)+' RG', f'{number(width)} w',
        '1 J', '1 j',
        f'{number(start[0])} {number(start[1])} m {number(end[0])} {number(end[1])} l S', 'Q'])
    return value


# Four cubic Bezier segments approximate a full ellipse with this standard constant.
ELLIPSE_KAPPA = 0.5522847498307936


def ellipse_shape(page, note, writer):
    from pypdf.annotations import Ellipse
    from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject
    shape = note['shape_annotation']
    axes = shape_axes(page)
    first, second = shape['points']
    left, right = sorted((first[0], second[0]))
    top, bottom = sorted((first[1], second[1]))
    if left == right or top == bottom:
        raise ValueError('Degenerate ellipse geometry')
    corners = [shape_point(axes, x, y) for x, y in ((left, top), (right, top), (right, bottom), (left, bottom))]
    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]
    width = shape['line_width']
    margin = width / 2
    rect = (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)
    value = Ellipse(rect=rect)
    channels = color_channels(shape['color'])
    value[NameObject('/C')] = ArrayObject([FloatObject(v) for v in channels])
    value[NameObject('/BS')] = DictionaryObject({NameObject('/W'): NumberObject(width)})
    # /Rect carries the stroke margin; /RD keeps the drawn ellipse recoverable from it.
    value[NameObject('/RD')] = ArrayObject([FloatObject(margin) for _ in range(4)])
    center_x, center_y = (left + right) / 2, (top + bottom) / 2
    radius_x, radius_y = (right - left) / 2, (bottom - top) / 2
    k = ELLIPSE_KAPPA
    # Control points are built in the normalized page square, then mapped once through the
    # existing affine shape axes; an affine image of a Bezier stays the same Bezier.
    segments = (
        ((right, center_y), (right, center_y + k*radius_y), (center_x + k*radius_x, bottom), (center_x, bottom)),
        ((center_x, bottom), (center_x - k*radius_x, bottom), (left, center_y + k*radius_y), (left, center_y)),
        ((left, center_y), (left, center_y - k*radius_y), (center_x - k*radius_x, top), (center_x, top)),
        ((center_x, top), (center_x + k*radius_x, top), (right, center_y - k*radius_y), (right, center_y)),
    )
    commands = ['q', ' '.join(number(v) for v in channels)+' RG', f'{number(width)} w', '1 J', '1 j']
    for index, (start, control_a, control_b, end) in enumerate(segments):
        points = [shape_point(axes, *pair) for pair in (start, control_a, control_b, end)]
        if index == 0:
            commands.append(f'{number(points[0][0])} {number(points[0][1])} m')
        commands.append(
            f'{number(points[1][0])} {number(points[1][1])} {number(points[2][0])} {number(points[2][1])} '
            f'{number(points[3][0])} {number(points[3][1])} c')
    commands.append('S')
    commands.append('Q')
    # Unfilled stroke only: no fill operator is emitted.
    appearance(writer, value, commands)
    return value


def ink_shape(page, note, writer):
    """One freehand stroke as /Ink with a single flat absolute-point /InkList array.

    Installed pypdf has no Ink annotation class, so the bounded dictionary is built by hand
    with the same explicit appearance and geometry transforms as the other new shapes.
    """
    from pypdf.generic import (ArrayObject, DictionaryObject, FloatObject, NameObject,
        NumberObject, RectangleObject)
    shape = note['shape_annotation']
    axes = shape_axes(page)
    path = [shape_point(axes, *pair) for pair in shape['points']]
    if len(path) < 2:
        raise ValueError('Degenerate ink geometry')
    width = shape['line_width']
    margin = width / 2
    xs = [p[0] for p in path]
    ys = [p[1] for p in path]
    value = DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'),
        NameObject('/Subtype'): NameObject('/Ink'),
        NameObject('/Rect'): RectangleObject((min(xs) - margin, min(ys) - margin,
                                              max(xs) + margin, max(ys) + margin)),
        # Exactly one stroke; the path keeps every saved point in order.
        NameObject('/InkList'): ArrayObject([ArrayObject([FloatObject(v) for p in path for v in p])]),
    })
    channels = color_channels(shape['color'])
    value[NameObject('/C')] = ArrayObject([FloatObject(v) for v in channels])
    value[NameObject('/BS')] = DictionaryObject({NameObject('/W'): NumberObject(width)})
    commands = ['q', ' '.join(number(v) for v in channels)+' RG', f'{number(width)} w', '1 J', '1 j',
                f'{number(path[0][0])} {number(path[0][1])} m']
    commands.extend(f'{number(x)} {number(y)} l' for x, y in path[1:])
    commands.append('S')
    commands.append('Q')
    appearance(writer, value, commands)
    return value


def textbox_shape(page, note, writer, budget):
    from pypdf.annotations import FreeText
    from pypdf.generic import (DecodedStreamObject, DictionaryObject, NameObject, NumberObject,
        RectangleObject, StreamObject, TextStringObject)
    shape = note['shape_annotation']
    axes = shape_axes(page)
    left, top, right, bottom = shape['points'][0][0], shape['points'][0][1], shape['points'][1][0], shape['points'][1][1]
    left, right = sorted((left, right))
    top, bottom = sorted((top, bottom))
    top_left = shape_point(axes, left, top)
    top_right = shape_point(axes, right, top)
    bottom_right = shape_point(axes, right, bottom)
    bottom_left = shape_point(axes, left, bottom)
    rect = bounds([top_left, top_right, bottom_right, bottom_left])
    horizontal = bottom_right[0] - bottom_left[0], bottom_right[1] - bottom_left[1]
    vertical = top_left[0] - bottom_left[0], top_left[1] - bottom_left[1]
    width = math.hypot(*horizontal)
    height = math.hypot(*vertical)
    rendered = render_textbox(shape, note['text'], width, height, budget)

    image = StreamObject()
    image.set_data(rendered['data'])
    image.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Image'),
                  NameObject('/Width'): NumberObject(rendered['pixel_width']),
                  NameObject('/Height'): NumberObject(rendered['pixel_height']),
                  NameObject('/ColorSpace'): NameObject('/DeviceRGB'),
                  NameObject('/BitsPerComponent'): NumberObject(8),
                  NameObject('/Filter'): NameObject('/FlateDecode')})
    image_ref = writer._add_object(image)
    form = DecodedStreamObject()
    commands = ['q',
        ' '.join(number(v) for v in (horizontal[0], horizontal[1], vertical[0], vertical[1],
                                    bottom_left[0], bottom_left[1])) + ' cm',
        '/Im0 Do', 'Q']
    form.set_data(('\n'.join(commands) + '\n').encode('ascii'))
    form.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Form'),
                 NameObject('/BBox'): RectangleObject(rect),
                 NameObject('/Resources'): DictionaryObject({NameObject('/XObject'): DictionaryObject(
                     {NameObject('/Im0'): image_ref})})})
    ink = TEXTBOX_COLORS[shape['color']].lstrip('#')
    value = FreeText(rect=rect, text=note_contents(note), border_color=None, background_color='ffffff',
                     font_size=f"{shape['font_size']}pt", font_color=ink)
    channels = [int(ink[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    helvetica = getattr(writer, '_synrise_helvetica', None)
    if helvetica is None:
        helvetica = writer._add_object(DictionaryObject({
            NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
            NameObject('/BaseFont'): NameObject('/Helvetica')}))
        writer._synrise_helvetica = helvetica
    value[NameObject('/DA')] = TextStringObject(
        ' '.join(number(v) for v in channels) + f" rg /Helv {shape['font_size']} Tf")
    value[NameObject('/DR')] = DictionaryObject({NameObject('/Font'): DictionaryObject(
        {NameObject('/Helv'): helvetica})})
    # The raster appearance governs Unicode/CJK text; Contents keeps the complete body.
    value[NameObject('/AP')] = DictionaryObject({NameObject('/N'): writer._add_object(form)})
    return value


def make_annotation(page, note, index, writer, budget):
    from pypdf.annotations import Highlight, Rectangle, Text
    from pypdf.generic import ArrayObject, FloatObject, NameObject, NumberObject, TextStringObject
    markup = note['annotation']
    shape = note.get('shape_annotation')
    if shape:
        if shape['kind'] == 'textbox':
            value = textbox_shape(page, note, writer, budget)
        elif shape['kind'] == 'arrow':
            value = arrow_shape(page, note, writer)
        elif shape['kind'] == 'line':
            value = line_shape(page, note, writer)
        elif shape['kind'] == 'ellipse':
            value = ellipse_shape(page, note, writer)
        elif shape['kind'] == 'ink':
            value = ink_shape(page, note, writer)
        elif shape['kind'] == 'rectangle':
            value = rectangle_shape(page, note, writer)
        else:
            # A new kind must never silently render as an old rectangle or arrow.
            raise ValueError('Unknown shape kind')
    elif markup:
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
        textbox_budget = TextboxRenderBudget()
        for index, note in enumerate(data['notes']):
            with closing(native[note['page'] - 1]) as page:
                writer.add_annotation(note['page'] - 1, make_annotation(page, note, index, writer, textbox_budget))
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
    except TextboxFontUnavailable:
        print(json.dumps({'error': 'textbox_font_unavailable'}))
        raise SystemExit(1)
    except TextboxOverflow:
        print(json.dumps({'error': 'textbox_overflow'}))
        raise SystemExit(1)
    except TextboxResourceTooLarge:
        # Sub-pixel fonts and raster budget exhaustion are oversize export conditions.
        print(json.dumps({'error': 'pdf_export_too_large'}))
        raise SystemExit(1)
    except SnapshotTooLarge:
        print(json.dumps({'error': 'pdf_export_too_large'}))
        raise SystemExit(1)
    except Exception:
        print(json.dumps({'error': 'pdf_export_failed'}))
        raise SystemExit(1)
