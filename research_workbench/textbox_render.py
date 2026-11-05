"""Bounded system-font layout and transparent raster appearance for saved PDF text boxes.

Pillow is imported lazily inside the fixed PDF worker path so ordinary web requests never
load an imaging stack. Wrapping and fit checks use the real raster font at its fractional
size, and every drawn line's glyph ink is verified against the outer box; no whitespace-only
wrapping, automatic shrinking, truncation or font substitution is performed.

The appearance is a solid ink plane plus a same-sized DeviceGray coverage mask: glyph
antialiasing lives entirely in the alpha channel, so unpainted pixels stay transparent and
never hide the page content beneath a text box.
"""
import math
from pathlib import Path
import zlib

from .shape_annotations import MAX_TEXTBOX_BODY, TEXTBOX_COLORS, geometry_bounds

PADDING = 4.0
LINE_ADVANCE = 1.4
MAX_SIDE = 2048
MAX_TEXTBOX_PIXELS = 4_000_000
TOTAL_TEXTBOX_PIXELS = 32_000_000
# Sub-pixel slack only absorbs float noise; the ink box itself is integral.
INK_TOLERANCE = 0.01
# ECMAScript \s, i.e. the whitespace set of the shared browser layout and its trimEnd.
WHITESPACE_TEXT = (' \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006'
                   '\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')
WHITESPACE = frozenset(WHITESPACE_TEXT)
# Windows primary face first; Linux Noto CJK regular faces are server fallbacks.
FONT_CANDIDATES = (
    'C:/Windows/Fonts/msyh.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
)


class TextboxFontUnavailable(Exception):
    code = 'textbox_font_unavailable'


class TextboxOverflow(Exception):
    code = 'textbox_overflow'


class TextboxResourceTooLarge(Exception):
    """The box cannot be rasterized inside the bounded render budget; the worker maps it
    onto the existing pdf_export_too_large error."""
    code = 'textbox_resource_too_large'


def font_path():
    for candidate in FONT_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    raise TextboxFontUnavailable('No system CJK font is available')


def load_font(size):
    """Load the system face at its exact fractional raster size, never rounded or clamped."""
    from PIL import ImageFont
    if not (math.isfinite(size) and size >= 1):
        raise TextboxResourceTooLarge('The text box raster font is too small to render')
    try:
        return ImageFont.truetype(font_path(), size)
    except (OSError, ValueError):
        raise TextboxFontUnavailable('The system CJK font cannot be loaded') from None


def _wrap_paragraph(characters, measure, max_width):
    """Mirror the shared browser paragraph wrapper for one explicit line of the body."""
    if not characters:
        return ['']
    lines = []
    offset = 0
    total = len(characters)
    while offset < total:
        # Longest prefix of the remaining codepoints that still fits.
        low, high, fit = 1, total - offset, 0
        while low <= high:
            middle = (low + high) // 2
            if measure(''.join(characters[offset:offset + middle])) <= max_width:
                fit = middle
                low = middle + 1
            else:
                high = middle - 1
        fit = max(1, fit)
        end = offset + fit
        if end >= total:
            lines.append(''.join(characters[offset:]))
            break
        # Prefer the last whitespace inside the fitting prefix; long tokens fall back.
        break_at = -1
        for index in range(end - 1, offset, -1):
            if characters[index] in WHITESPACE:
                break_at = index
                break
        if break_at > offset:
            lines.append(''.join(characters[offset:break_at]).rstrip(WHITESPACE_TEXT))
            offset = break_at + 1
            while offset < total and characters[offset] in WHITESPACE:
                offset += 1
        else:
            lines.append(''.join(characters[offset:end]))
            offset = end
    return lines


def wrap_text(value, measure, max_width):
    """Greedy Unicode wrapping over codepoints, preserving indentation and empty lines."""
    if max_width <= 0:
        raise TextboxOverflow('The text box has no usable width')
    normalized = value.replace('\r\n', '\n').replace('\r', '\n').replace('\t', '    ')
    lines = []
    for paragraph in normalized.split('\n'):
        lines.extend(_wrap_paragraph(list(paragraph), measure, max_width))
    return lines


def line_capacity(height, font_size):
    available = height - 2 * PADDING
    if available < font_size or available <= 0:
        raise TextboxOverflow('The text box is too short for the selected font size')
    return max(1, int((available - font_size) // (LINE_ADVANCE * font_size)) + 1)


def render_scale(width, height):
    if not (math.isfinite(width) and math.isfinite(height)) or width <= 0 or height <= 0:
        raise TextboxOverflow('The text box has no usable area')
    return min(3.0, MAX_SIDE / width, MAX_SIDE / height,
               math.sqrt(MAX_TEXTBOX_PIXELS / (width * height)))


def raster_geometry(width, height):
    """Raster scale plus the exact pixel bitmap size the appearance will use."""
    scale = render_scale(width, height)
    if not scale > 0:
        raise TextboxResourceTooLarge('The text box raster is too small to render')
    pixel_width = max(1, min(MAX_SIDE, int(math.ceil(width * scale))))
    pixel_height = max(1, min(MAX_SIDE, int(math.ceil(height * scale))))
    while pixel_width * pixel_height > MAX_TEXTBOX_PIXELS:
        if pixel_width >= pixel_height:
            pixel_width -= 1
        else:
            pixel_height -= 1
    return scale, pixel_width, pixel_height


class TextboxRenderBudget:
    """Total raster budget for one exported PDF, shared across saved text boxes."""

    def __init__(self, total=TOTAL_TEXTBOX_PIXELS):
        self.remaining = total

    def consume(self, width, height):
        pixels = width * height
        if width < 1 or height < 1 or width > MAX_SIDE or height > MAX_SIDE:
            raise TextboxResourceTooLarge('The text box raster exceeds the side limit')
        if pixels > MAX_TEXTBOX_PIXELS:
            raise TextboxResourceTooLarge('The text box raster exceeds the per-box pixel limit')
        if pixels > self.remaining:
            raise TextboxResourceTooLarge('The PDF text boxes exceed the total raster budget')
        self.remaining -= pixels


def layout(shape, body, width, height, raster, font):
    """Wrap one body and verify every glyph ink box against the outer text box.

    The raster font is the one actually drawn, positions are the exact rounded pixel
    baselines, and the raster is the outer box, so ink outside it is clipped ink.
    """
    scale, pixel_width, pixel_height = raster
    font_size = shape['font_size']
    available_width = (width - 2 * PADDING) * scale
    capacity = line_capacity(height, font_size)
    lines = wrap_text(body, font.getlength, available_width)
    if len(lines) > capacity:
        raise TextboxOverflow('The text needs more lines than the text box can show')
    x = round(PADDING * scale)
    baselines = [round((PADDING + font_size + index * LINE_ADVANCE * font_size) * scale)
                 for index in range(len(lines))]
    for line, baseline in zip(lines, baselines):
        if not line:
            continue
        # Negative left/top bearings are legitimate as long as the ink stays inside.
        left, top, right, bottom = font.getbbox(line, anchor='ls')
        if (x + left < -INK_TOLERANCE or baseline + top < -INK_TOLERANCE or
                x + right > pixel_width + INK_TOLERANCE or
                baseline + bottom > pixel_height + INK_TOLERANCE):
            raise TextboxOverflow('The text is clipped by the text box')
    return lines, x, baselines


def render(shape, body, width, height, budget):
    """Return the Flate-compressed ink plane and DeviceGray alpha mask for one text box.

    The ink plane is the selected text color over the whole bounded raster, and the coverage
    mask is an antialiased grayscale glyph bitmap of exactly the same pixel size. The worker
    attaches the mask as the image /SMask, so the PDF shows colored text on a transparent
    background instead of white hiding the original page.
    """
    from PIL import Image, ImageDraw
    if not isinstance(body, str) or not body.strip():
        raise ValueError('Empty text box body')
    if len(body) > MAX_TEXTBOX_BODY:
        raise ValueError('Text box body exceeds the stored limit')
    geometry_bounds('textbox', shape['points'])  # validates stored geometry
    raster = raster_geometry(width, height)
    scale, pixel_width, pixel_height = raster
    budget.consume(pixel_width, pixel_height)
    # Integer stored font size scaled by the raster scale stays floating on purpose.
    font = load_font(shape['font_size'] * scale)
    lines, x, baselines = layout(shape, body, width, height, raster, font)
    ink = TEXTBOX_COLORS[shape['color']]
    rgb = tuple(int(ink[index:index + 2], 16) for index in (1, 3, 5))
    # Drawing coverage into an L image keeps the raster font's antialiasing as per-pixel
    # alpha; nothing is painted where there is no glyph ink.
    image = Image.new('L', (pixel_width, pixel_height), 0)
    try:
        draw = ImageDraw.Draw(image)
        for line, baseline in zip(lines, baselines):
            draw.text((x, baseline), line, font=font, fill=255, anchor='ls')
        mask = zlib.compress(image.tobytes(), 6)
    finally:
        image.close()
    # A constant-color plane is exact, bounded and compresses to a few hundred bytes.
    data = zlib.compress(bytes(rgb) * (pixel_width * pixel_height), 6)
    return {'data': data, 'mask': mask, 'pixel_width': pixel_width, 'pixel_height': pixel_height,
            'width': width, 'height': height}
