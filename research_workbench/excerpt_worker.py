"""Short-lived, resource-bounded PDFium rendering; never runs in the web process."""
from contextlib import closing
import json
import math
from pathlib import Path
import sys

import pypdfium2 as pdfium


def render_region(source, number, rect, output):
    with closing(pdfium.PdfDocument(source)) as document:
        with closing(document[number - 1]) as page:
            render_page(page, rect, output)


def render_page(page, rect, output):
    width, height = page.get_size()
    left, top, right, bottom = rect
    region_width, region_height = width * (right - left), height * (bottom - top)
    if not all(math.isfinite(v) and v > 0 for v in (width, height, region_width, region_height)):
        raise ValueError('Invalid page geometry')
    scale = min(2.0, 2046 / region_width, 2046 / region_height,
                math.sqrt(3_990_000 / (region_width * region_height)))
    if min(region_width, region_height) * scale < 1 or max(width, height) * scale > 2**30:
        raise ValueError('Unsupported region geometry')
    # PDFium crop is the margin removed from the rotated view: left, bottom, right, top.
    crop = (left * width, (1 - bottom) * height, (1 - right) * width, top * height)
    with closing(page.render(scale=scale, crop=crop, draw_annots=True)) as bitmap:
        if max(bitmap.width, bitmap.height) > 2048 or bitmap.width * bitmap.height > 4_000_000:
            raise ValueError('Bitmap budget exceeded')
        image = bitmap.to_pil()
        try:
            image.save(output, format='PNG')
        finally:
            image.close()
    if Path(output).stat().st_size > 8 * 1024 * 1024:
        raise ValueError('PNG budget exceeded')


if __name__ == '__main__':
    try:
        render_region(sys.argv[1], int(sys.argv[2]), json.loads(sys.argv[3]), sys.argv[4])
        print(json.dumps({'status': 'ok'}))
    except Exception:
        print(json.dumps({'error': 'renderer_failed'}))
        raise SystemExit(1)
