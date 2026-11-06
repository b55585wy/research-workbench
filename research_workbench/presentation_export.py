"""Editable 16:9 PPTX generation using the checked source context.

Text, tables, charts and worksheets are native OOXML objects.  Nothing is
captured as a whole-slide raster image and no dataset or PDF bytes are embedded.
"""
import math
import re
import tempfile
import threading
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from .chart_export import STYLE_PALETTES
from .models import WorkspaceError
from .presentation_paper import page_scope

try:
    from pptx import Presentation
    from pptx.chart.data import CategoryChartData, XyChartData
    from pptx.dml.color import RGBColor
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_MARKER_STYLE
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import PP_ALIGN, MSO_AUTO_SIZE
    from pptx.util import Inches, Pt
    PPTX_AVAILABLE = True
except ImportError:  # Optional dependency: never break application startup.
    PPTX_AVAILABLE = False

MAX_BYTES = 20 * 1024 * 1024
MAX_EXPORTS = 2
_EXPORT_SLOTS = threading.BoundedSemaphore(MAX_EXPORTS)
INK = (32, 37, 48)
MUTED = (92, 99, 112)
PANEL = (249, 250, 251)
DOI_PATTERN = re.compile(r'^10\.\d{4,9}/[-._;()/:A-Za-z0-9]+$')


def _rgb(value):
    return RGBColor(value[0], value[1], value[2])


def _hex(value):
    return RGBColor.from_string(value.lstrip('#').upper())


def _label(value, limit=60, default='Source'):
    text = ''.join(c for c in str(value or '') if ord(c) >= 32 and ord(c) != 127)
    return text.strip()[:limit] or default


def _rect(slide, left, top, width, height, color, line=False):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, int(left), int(top),
                                   max(int(width), 1), max(int(height), 1))
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    if line:
        shape.line.fill.solid()
        shape.line.color.rgb = color
    else:
        shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def _textbox(slide, left, top, width, height, text, size, bold=False,
             color=None, align=None, anchor=None):
    box = slide.shapes.add_textbox(int(left), int(top), int(width), int(height))
    frame = box.text_frame
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.NONE
    if anchor is not None:
        frame.vertical_anchor = anchor
    paragraph = frame.paragraphs[0]
    paragraph.text = text
    paragraph.font.size = Pt(size)
    paragraph.font.name = 'Arial'
    paragraph.font.bold = bold
    paragraph.font.color.rgb = _rgb(color or INK)
    if align is not None:
        paragraph.alignment = align
    return frame


def _body(slide, left, top, width, height, lines, size):
    box = slide.shapes.add_textbox(int(left), int(top), int(width), int(height))
    frame = box.text_frame
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.NONE
    for index, line in enumerate(lines or ['']):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = ('• ' + line) if line else ''
        paragraph.font.size = Pt(size)
        paragraph.font.name = 'Arial'
        paragraph.font.color.rgb = _rgb(INK)
        paragraph.space_after = Pt(6)
    return frame


def _base_slide(prs, palette):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _rect(slide, 0, 0, prs.slide_width, Inches(0.18), _hex(palette[0]))
    return slide


def _source_notes(source):
    if source['kind'] == 'paper':
        return f"{source['ref']} | paper | {source['title']} | id={source['id']} | " \
               f"file_sha256={source['file_sha256']} | source_sha256={source['sha']} | " \
               f"pages={page_scope(source['pages'])} | page_count={source['page_count']} | " \
               f"text_chars={source['text_chars']} | " \
               f"empty_pages={page_scope(source['empty_pages']) or 'none'}"
    if source['kind'] == 'note':
        page = source['page'] if source['page'] is not None else 'study'
        return f"{source['ref']} | note | {source['title']} | id={source['id']} | " \
               f"sha256={source['sha']} | page={page} | revision={source['revision']}"
    if source['kind'] == 'chart':
        summary = source['summary']
        return f"{source['ref']} | chart | {source['title']} | id={source['id']} | " \
               f"sha256={source['sha']} | kind={source['kind_value']} | " \
               f"used={summary['used_rows']} | excluded={summary['excluded_rows']}"
    return f"{source['ref']} | analysis | {source['title']} | id={source['id']} | " \
           f"sha256={source['sha']} | method={source['method']} | engine={source['engine']}"


def _paper_footer(slide, paper):
    text = f"来源：{_label(paper['title'], 70)} · 第 {page_scope(paper['pages'])} 页"
    _textbox(slide, Inches(0.55), Inches(7.0), Inches(12.2), Inches(0.3),
             text, 8, color=MUTED)


def _content_slide(prs, item, palette, sources):
    slide = _base_slide(prs, palette)
    title_size = 25 if len(item.title) <= 45 else 20 if len(item.title) <= 70 else 16
    _textbox(slide, Inches(0.5), Inches(0.38), Inches(12.3), Inches(0.9),
             item.title, title_size, bold=True)
    chart_source = sources.get(f"chart:{item.chart_id}") if item.chart_id else None
    body_width = Inches(5.6) if chart_source else Inches(12.3)
    characters = sum(len(line) for line in item.body)
    size = 14 if characters <= 800 else 12 if characters <= 1400 else 10
    _body(slide, Inches(0.55), Inches(1.45), body_width, Inches(5.5), item.body, size)
    if chart_source is not None:
        _chart(slide, chart_source, palette, Inches(6.35), Inches(1.45),
               Inches(6.45), Inches(5.35))
    notes = [_source_notes(sources[ref]) for ref in item.source_refs if ref in sources]
    slide.notes_slide.notes_text_frame.text = '\n'.join(notes)
    paper = next((sources[ref] for ref in item.source_refs
                  if ref in sources and sources[ref]['kind'] == 'paper'), None)
    if paper is not None:
        _paper_footer(slide, paper)
    return slide


# --------------------------------------------------------------------- charts
def _chart_font(chart):
    chart.font.name = 'Arial'
    chart.font.size = Pt(9)
    chart.font.color.rgb = _rgb(INK)


def _legend(chart):
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.legend.include_in_layout = False
    chart.legend.font.name = 'Arial'
    chart.legend.font.size = Pt(8)


def _bar_axis(chart, counts):
    axis = chart.value_axis
    axis.has_major_gridlines = True
    axis.has_title = True
    axis.axis_title.text_frame.text = '计数 / Count'
    axis.axis_title.text_frame.paragraphs[0].font.size = Pt(9)
    axis.tick_labels.number_format = '0'
    axis.tick_labels.number_format_is_linked = False
    axis.tick_labels.font.name = 'Arial'
    axis.tick_labels.font.size = Pt(8)
    highest = max([int(value) for value in counts] or [1]) or 1
    unit = max(1, math.ceil(highest / 5))
    axis.minimum_scale = 0
    axis.major_unit = float(unit)
    axis.maximum_scale = float(unit * math.ceil(highest / unit))


def _category_axis(chart, title):
    axis = chart.category_axis
    axis.has_major_gridlines = False
    axis.has_title = True
    axis.axis_title.text_frame.text = title
    axis.axis_title.text_frame.paragraphs[0].font.size = Pt(9)
    axis.tick_labels.font.name = 'Arial'
    axis.tick_labels.font.size = Pt(7)


def _scale(values, ticks=5):
    numbers = [float(value) for value in values]
    low, high = min(numbers), max(numbers)
    if low == high:
        low, high = low - 1, high + 1
    padding = (high - low) * 0.05
    low, high = low - padding, high + padding
    rough = (high - low) / ticks
    magnitude = 10 ** math.floor(math.log10(rough)) if rough > 0 else 1
    unit = magnitude
    for multiplier in (1, 2, 2.5, 5, 10):
        unit = magnitude * multiplier
        if unit >= rough:
            break
    low = math.floor(low / unit) * unit
    high = math.ceil(high / unit) * unit
    if not all(math.isfinite(value) for value in (low, high, unit)) or high <= low:
        return None
    return low, high, unit


def _xy_axis(axis, title, values, gridlines=False):
    axis.has_title = True
    axis.axis_title.text_frame.text = _label(title, 40, 'Value')
    axis.axis_title.text_frame.paragraphs[0].font.size = Pt(9)
    axis.has_major_gridlines = gridlines
    axis.tick_labels.number_format = 'General'
    axis.tick_labels.number_format_is_linked = False
    axis.tick_labels.font.name = 'Arial'
    axis.tick_labels.font.size = Pt(8)
    scale = _scale(values)
    if scale is not None:
        axis.minimum_scale, axis.maximum_scale, axis.major_unit = scale


def _series_color(series, value):
    fill = series.format.fill
    fill.solid()
    fill.fore_color.rgb = _hex(value)


def _marker_color(series, value, size):
    series.marker.style = XL_MARKER_STYLE.CIRCLE
    series.marker.size = size
    color = _hex(value)
    series.marker.format.fill.solid()
    series.marker.format.fill.fore_color.rgb = color
    series.marker.format.line.color.rgb = color


def _counts_chart(slide, source, palette, left, top, width, height):
    series = source['projection']['series']
    data = CategoryChartData()
    data.categories = [str(value) for value in series['columns']]
    data.add_series('有效 / Valid', [float(value) for value in series['valid']])
    data.add_series('缺失 / Missing', [float(value) for value in series['missing']])
    chart = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, int(left), int(top),
                                   int(width), int(height), data).chart
    plot = chart.plots[0]
    plot.vary_by_categories = False
    plot.gap_width = 60
    plot.overlap = -10
    plot.has_data_labels = True
    plot.data_labels.number_format_is_linked = False
    plot.data_labels.number_format = '0'
    plot.data_labels.font.name = 'Arial'
    plot.data_labels.font.size = Pt(8)
    for index, item in enumerate(plot.series):
        _series_color(item, palette[index % len(palette)])
    _bar_axis(chart, list(series['valid']) + list(series['missing']))
    _category_axis(chart, '列 / Column')
    _legend(chart)
    _chart_font(chart)
    chart.has_title = False
    return chart


def _histogram_chart(slide, source, palette, left, top, width, height):
    series = source['projection']['series']
    data = CategoryChartData()
    data.categories = [str(value) for value in series['labels']]
    data.add_series('计数 / Count', [float(value) for value in series['counts']])
    chart = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, int(left), int(top),
                                   int(width), int(height), data).chart
    plot = chart.plots[0]
    plot.vary_by_categories = False
    plot.gap_width = 0
    _series_color(plot.series[0], palette[2])
    _bar_axis(chart, series['counts'])
    _category_axis(chart, '区间 / Bin')
    chart.has_legend = False
    _chart_font(chart)
    chart.has_title = False
    return chart


def _scatter_chart(slide, source, palette, left, top, width, height):
    series = source['projection']['series']
    spec = source['projection']['spec']
    data = XyChartData()
    item = data.add_series('观测值 / Observation')
    for x_value, y_value in zip(series['x'], series['y']):
        item.add_data_point(float(x_value), float(y_value))
    chart = slide.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, int(left), int(top),
                                   int(width), int(height), data).chart
    plot = chart.plots[0]
    _marker_color(plot.series[0], palette[0], 4 if len(series['x']) > 300 else 6)
    _xy_axis(chart.category_axis, spec.get('x') or 'X', series['x'])
    _xy_axis(chart.value_axis, spec.get('y') or 'Y', series['y'], gridlines=True)
    chart.has_legend = False
    _chart_font(chart)
    chart.has_title = False
    return chart


def _grouped_chart(slide, source, palette, left, top, width, height):
    projection = source['projection']
    series = projection['series']
    groups = projection['summary'].get('groups') or []
    order = [str(group['label']) for group in groups]
    if len(order) != 2:
        order = list(dict.fromkeys(str(value) for value in series['x']))
    order = order[:2]
    positions = {label: float(index + 1) for index, label in enumerate(order)}
    buckets = {label: [] for label in order}
    for label, value in zip(series['x'], series['y']):
        label = str(label)
        if label in buckets:
            buckets[label].append(float(value))
    data = XyChartData()
    names = []
    for index, label in enumerate(order):
        name = _label(label, 60, f'Group {index + 1}')
        if name in names:
            name = f'{index + 1}. {name}'[:60]
        names.append(name)
        item = data.add_series(name)
        for value in buckets[label]:
            item.add_data_point(positions[label], value)
    chart = slide.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, int(left), int(top),
                                   int(width), int(height - Inches(0.42)), data).chart
    plot = chart.plots[0]
    for index, item in enumerate(plot.series):
        _marker_color(item, palette[index % len(palette)], 5)
    x_axis = chart.category_axis
    x_axis.has_title = True
    x_axis.axis_title.text_frame.text = '分组位置 / Group position'
    x_axis.axis_title.text_frame.paragraphs[0].font.size = Pt(9)
    x_axis.has_major_gridlines = False
    x_axis.tick_labels.number_format = '0'
    x_axis.tick_labels.number_format_is_linked = False
    x_axis.tick_labels.font.name = 'Arial'
    x_axis.tick_labels.font.size = Pt(8)
    x_axis.minimum_scale = 0.5
    x_axis.maximum_scale = 2.5
    x_axis.major_unit = 1.0
    _xy_axis(chart.value_axis, projection['spec'].get('y') or 'Y', series['y'], gridlines=True)
    _legend(chart)
    _chart_font(chart)
    chart.has_title = False
    mapping = []
    for index, label in enumerate(order):
        mapping.append(f'{index + 1} = {_label(label, 48)}（n={len(buckets[label])}）')
    _textbox(slide, left, top + height - Inches(0.4), width, Inches(0.34),
             '；'.join(mapping), 8, color=MUTED, align=PP_ALIGN.CENTER)
    return chart


def _chart(slide, source, palette, left, top, width, height):
    projection = source['projection']
    summary = projection['summary']
    _rect(slide, left, top, width, height, _rgb(PANEL), line=True)
    _textbox(slide, left + Inches(0.15), top + Inches(0.06), width - Inches(0.3),
             Inches(0.32), f"{_label(source['title'], 48)} · 有效 {summary['used_rows']} / "
             f"排除 {summary['excluded_rows']}", 9, bold=True)
    plot_left = left + Inches(0.1)
    plot_top = top + Inches(0.42)
    plot_width = width - Inches(0.2)
    plot_height = height - Inches(0.54)
    kind = projection['kind']
    if kind == 'analysis_counts':
        return _counts_chart(slide, source, palette, plot_left, plot_top, plot_width, plot_height)
    if kind == 'histogram':
        return _histogram_chart(slide, source, palette, plot_left, plot_top, plot_width, plot_height)
    if kind == 'grouped_points':
        return _grouped_chart(slide, source, palette, plot_left, plot_top, plot_width, plot_height)
    return _scatter_chart(slide, source, palette, plot_left, plot_top, plot_width, plot_height)


def _paper_reference(prs, papers, palette):
    if not papers:
        return None
    for paper in papers:
        slide = _base_slide(prs, palette)
        _textbox(slide, Inches(0.5), Inches(0.35), Inches(12.3), Inches(0.8),
                 '论文来源 / Paper reference', 22, bold=True)
        top = Inches(1.35)
        title_size = 20 if len(paper['title']) <= 90 else 16 if len(paper['title']) <= 140 else 13
        _textbox(slide, Inches(0.6), top, Inches(12.1), Inches(1.2),
                 _label(paper['title'], 180), title_size, bold=True)
        top += Inches(1.25)
        if paper.get('authors'):
            long_authors = len(paper['authors']) > 120
            author_height = Inches(1.1 if long_authors else 0.6)
            _textbox(slide, Inches(0.6), top, Inches(12.1), author_height,
                     '作者 / Authors：' + _label(paper['authors'], 300, ''),
                     11 if long_authors else 14)
            top += author_height + Inches(0.05)
        if paper.get('year') is not None:
            _textbox(slide, Inches(0.6), top, Inches(12.1), Inches(0.45),
                     f"年份 / Year：{paper['year']}", 14)
            top += Inches(0.45)
        if paper.get('doi'):
            long_doi = len(paper['doi']) > 100
            doi_height = Inches(1.0 if long_doi else 0.45)
            frame = _textbox(slide, Inches(0.6), top, Inches(12.1), doi_height,
                             'DOI：' + _label(paper['doi'], 255, ''),
                             10 if long_doi else 14)
            doi = paper['doi'].strip()
            if DOI_PATTERN.fullmatch(doi):
                run = frame.paragraphs[0].runs[0]
                run.hyperlink.address = 'https://doi.org/' + doi
            top += doi_height + Inches(0.05)
        scope = page_scope(paper['pages'])
        _textbox(slide, Inches(0.6), top + Inches(0.2), Inches(12.1), Inches(0.7),
                 f'阅读范围 / Reading scope：第 {scope} 页'
                 f'（PDF 共 {paper["page_count"]} 页；实际读取 {len(paper["pages"])} 页；'
                 f'可提取文字 {paper["text_chars"]} 字符）', 13)
        if paper['empty_pages']:
            _textbox(slide, Inches(0.6), top + Inches(0.95), Inches(12.1), Inches(0.5),
                     '无可提取文字的页码 / No native text：'
                     + page_scope(paper['empty_pages']), 12, color=MUTED)
        slide.notes_slide.notes_text_frame.text = _source_notes(paper)
    return slide


def _appendix(prs, sources, palette):
    chunks = [sources[index:index + 7] for index in range(0, len(sources), 7)]
    for number, chunk in enumerate(chunks, 1):
        slide = _base_slide(prs, palette)
        _textbox(slide, Inches(0.5), Inches(0.35), Inches(12.3), Inches(0.7),
                 f'来源附录 / Source appendix {number}/{len(chunks)}', 22, bold=True)
        table = slide.shapes.add_table(len(chunk) + 1, 5, Inches(0.4), Inches(1.2),
                                       Inches(12.5), Inches(0.55) * (len(chunk) + 1)).table
        widths = (Inches(1.35), Inches(3.0), Inches(2.35), Inches(3.45), Inches(2.2))
        for index, value in enumerate(widths):
            table.columns[index].width = value
        headers = ('Ref', 'Title', 'ID', 'SHA-256', 'Info')
        for column, header in enumerate(headers):
            cell = table.cell(0, column)
            cell.text = header
            for paragraph in cell.text_frame.paragraphs:
                paragraph.font.size = Pt(8)
                paragraph.font.bold = True
                paragraph.font.name = 'Arial'
        for row, source in enumerate(chunk, 1):
            if source['kind'] == 'note':
                page = source['page'] if source['page'] is not None else 'study'
                info = f"page={page}; rev={source['revision']}"
            elif source['kind'] == 'chart':
                info = f"{source['kind_value']}; used={source['summary']['used_rows']}"
            else:
                info = f"{source['method']}; {source['engine']}"
            values = (source['ref'], _label(source['title'], 55), source['id'],
                      source['sha'], info)
            for column, value in enumerate(values):
                cell = table.cell(row, column)
                cell.text = value
                for paragraph in cell.text_frame.paragraphs:
                    paragraph.font.size = Pt(6.5 if column == 3 else 7.5)
                    paragraph.font.name = 'Arial'
        slide.notes_slide.notes_text_frame.text = '\n'.join(
            _source_notes(source) for source in sources)


def _filename(title):
    cleaned = ''.join(c for c in str(title or '') if c not in '\\/:*?"<>|' and ord(c) >= 32)
    return f"{cleaned.strip()[:80] or 'presentation'} - presentation.pptx"


def _validate(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if '[Content_Types].xml' not in names or 'ppt/presentation.xml' not in names:
            raise WorkspaceError('presentation_export_failed', '演示文稿结构不完整，请重试。', 503)
        for name in names:
            if name.endswith(('.xml', '.rels')):
                try:
                    ET.fromstring(archive.read(name))
                except ET.ParseError:
                    raise WorkspaceError('presentation_export_failed',
                        '演示文稿 XML 校验失败，请重试。', 503) from None
    reopened = Presentation(str(path))
    if len(reopened.slides) < 1:
        raise WorkspaceError('presentation_export_failed', '演示文稿没有可读页面。', 503)


def build_presentation(store, context, outline, style):
    if not PPTX_AVAILABLE:
        raise WorkspaceError('presentation_unavailable', '演示文稿导出组件暂未安装。', 503)
    if not _EXPORT_SLOTS.acquire(False):
        raise WorkspaceError('presentation_busy', '正在导出其他演示文稿，请稍后重试。', 429)
    path = None
    try:
        palette = STYLE_PALETTES[style]
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        sources = {source['ref']: source for source in context['sources']}
        for item in outline.slides:
            _content_slide(prs, item, palette, sources)
        papers = [source for source in context['sources'] if source['kind'] == 'paper']
        if papers:
            _paper_reference(prs, papers, palette)
        _appendix(prs, [source for source in context['sources'] if source['kind'] != 'paper'],
                  palette)
        with tempfile.NamedTemporaryFile(dir=store.exports, suffix='.pptx', delete=False) as stream:
            path = Path(stream.name)
        prs.save(str(path))
        if path.stat().st_size > MAX_BYTES:
            raise WorkspaceError('presentation_export_too_large',
                '演示文稿超过 20 MiB，请减少所选来源。', 413)
        _validate(path)
        return path, _filename(outline.title)
    except BaseException:
        if path is not None:
            path.unlink(missing_ok=True)
        raise
    finally:
        _EXPORT_SLOTS.release()
