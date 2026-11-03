"""Short-lived ruled-table detection for one PDF page.

The web process never imports pdfplumber. Output is a bounded, closed JSON shape
with display-normalized rectangles relative to the page's visible crop box at
its intrinsic rotation.
"""
import json
import math
import sys

MAX_ITEMS = 128
MAX_EDGES = 1000
MAX_CHARS = 20000
MAX_OUTPUT_BYTES = 64 * 1024
MIN_CHARS = 4
TABLE_SETTINGS = {
    'vertical_strategy': 'lines',
    'horizontal_strategy': 'lines',
    'snap_tolerance': 3,
    'join_tolerance': 3,
    'edge_min_length': 3,
    'intersection_tolerance': 3,
}


def emit(payload):
    text = json.dumps(payload, ensure_ascii=True, separators=(',', ':'))
    if len(text.encode('ascii')) > MAX_OUTPUT_BYTES:
        text = json.dumps({'status': 'ok', 'items': [],
                           'unavailable_reason': 'result-too-large'},
                          separators=(',', ':'))
    sys.stdout.write(text + '\n')
    sys.stdout.flush()


def empty(reason):
    return {'status': 'ok', 'items': [], 'unavailable_reason': reason}


def finite_box(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError('Invalid box')
    box = []
    for number in value:
        if type(number) not in (int, float) or not math.isfinite(number):
            raise ValueError('Invalid box')
        box.append(float(number))
    return tuple(box)


def intersection(first, second):
    left, top = max(first[0], second[0]), max(first[1], second[1])
    right, bottom = min(first[2], second[2]), min(first[3], second[3])
    if right <= left or bottom <= top:
        return None
    return (left, top, right, bottom)


def displayed_box(page):
    # pdfplumber reports boxes top-origin and already applies the page rotation.
    # PDF.js displays the intersection of CropBox and MediaBox, so intersect
    # here before normalizing table anchors.
    if page.rotation not in (0, 90, 180, 270):
        return None, 'unsupported-rotation'
    try:
        media = finite_box(page.mediabox)
        crop = finite_box(page.cropbox)
    except (AttributeError, ValueError):
        return None, 'unsupported-page-geometry'
    if media[2] <= media[0] or media[3] <= media[1]:
        return None, 'unsupported-page-geometry'
    # pdfplumber applies rotation to table coordinates, but its CropBox
    # property is not consistently rotated. With a distinct CropBox on a
    # rotated page the mapping is not provable, so fail closed instead of
    # returning misplaced anchors.
    if page.rotation != 0 and any(abs(a - b) > 0.01 for a, b in zip(media, crop)):
        return None, 'crop-rotation-geometry'
    view = intersection(media, crop)
    if view is None:
        return None, 'unsupported-page-geometry'
    return view, None


def char_count(chars, box):
    count = 0
    for char in chars:
        try:
            x = (char['x0'] + char['x1']) / 2
            top = (char['top'] + char['bottom']) / 2
        except (KeyError, TypeError):
            continue
        if box[0] <= x <= box[2] and box[1] <= top <= box[3]:
            count += 1
            if count >= MIN_CHARS:
                return count
    return count


def collect(pdfplumber, source, number):
    if number < 1:
        raise ValueError('Invalid page')
    with pdfplumber.open(source, pages=[number]) as pdf:
        if not pdf.pages:
            raise ValueError('Page not found')
        page = pdf.pages[0]
        if page.page_number != number:
            raise ValueError('Page mismatch')
        view, reason = displayed_box(page)
        if reason is not None:
            return empty(reason)
        width, height = view[2] - view[0], view[3] - view[1]
        if not (math.isfinite(width) and math.isfinite(height) and width > 0 and height > 0):
            return empty('unsupported-page-geometry')
        edges, chars = page.edges, page.chars
        if len(edges) > MAX_EDGES or len(chars) > MAX_CHARS:
            return empty('page-too-complex')
        items = []
        for table in page.find_tables(TABLE_SETTINGS):
            try:
                rows, columns = table.rows, table.columns
                if len(rows) < 2 or len(columns) < 2 or len(table.cells) < 4:
                    continue
                bbox = finite_box(table.bbox)
            except (AttributeError, TypeError, ValueError):
                continue
            if bbox[2] - bbox[0] < 4 or bbox[3] - bbox[1] < 4:
                continue
            visible = intersection(bbox, view)
            if visible is None:
                continue
            box_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
            visible_area = (visible[2] - visible[0]) * (visible[3] - visible[1])
            if box_area <= 0 or visible_area / box_area < 0.5:
                continue
            # A ruled grid without any glyphs inside is more likely a chart
            # frame than a data table; text itself is never returned.
            if char_count(chars, visible) < MIN_CHARS:
                continue
            rect = [round((visible[0] - view[0]) / width, 6),
                    round((visible[1] - view[1]) / height, 6),
                    round((visible[2] - view[0]) / width, 6),
                    round((visible[3] - view[1]) / height, 6)]
            rect = [min(1.0, max(0.0, value)) for value in rect]
            if rect[0] >= rect[2] or rect[1] >= rect[3]:
                continue
            items.append({'id': f'table-{len(items) + 1}', 'kind': 'table', 'rect': rect})
            if len(items) >= MAX_ITEMS:
                break
        return {'status': 'ok', 'items': items}


def main(argv):
    if len(argv) != 3:
        emit({'status': 'error', 'error': 'regions_failed'})
        return 2
    try:
        import pdfplumber
    except Exception:
        emit({'status': 'error', 'error': 'regions_unavailable'})
        return 3
    try:
        result = collect(pdfplumber, argv[1], int(argv[2]))
    except Exception:
        emit({'status': 'error', 'error': 'regions_failed'})
        return 2
    emit(result)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
