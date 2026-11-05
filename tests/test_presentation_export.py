import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from uuid import uuid4
import zipfile

import pytest

from analysis_support import upload, run, workspace
from chart_support import payload, prepare, save
from research_workbench import chart_export, presentation_export
from research_workbench.models import WorkspaceError

SHEET = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


class PresentationProvider:
    def __init__(self):
        self.responses = []
        self.calls = []

    def status(self):
        return {'configured': True, 'model': 'synthetic-presentation-model'}

    def complete_once(self, messages, tools):
        self.calls.append({'messages': messages, 'tools': tools})
        return self.responses.pop(0)


def build_sources(c, app, doc):
    data = upload(c, doc).json()
    job = run(app.state.analysis, doc, data, columns=['value', 'second'])
    chart = save(c, doc, payload(c, data, 'analysis_counts', analysis_id=job['id']))
    note = c.post(f"/api/v1/documents/{doc['id']}/notes",
                  json={'request_id': str(uuid4()), 'page': 1, 'text': 'Synthetic source note'})
    assert note.status_code == 201, note.text
    return data, job, chart, note.json()


def context(c, doc, body):
    response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_chart_export_style_is_offline_packaged_without_changing_canonical_data(tmp_path, monkeypatch):
    with workspace(tmp_path) as (c, app, doc, _):
        dataset, body = prepare(c, app, doc, 'histogram')
        chart = save(c, doc, body)
        styles = tmp_path / 'frontend-styles'
        styles.mkdir()
        helper = b'window.ResearchChartStyles = { ids: ["default", "nature", "cell"] };\n'
        (styles / 'chart-styles.js').write_bytes(helper)
        monkeypatch.setattr(chart_export, 'STYLE_DIR', styles)

        response = c.get(chart['export_url'], params={'style': 'nature'})
        assert response.status_code == 200, response.text
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names = set(archive.namelist())
            assert {'chart-styles.js', 'style.json', 'chart-export.js', 'chart.json',
                    'specification.json', 'chart.html'} <= names
            assert archive.read('chart-styles.js') == helper
            assert json.loads(archive.read('style.json')) == {
                'id': 'nature', 'version': 1,
                'palette': ['#0072B2', '#D55E00', '#009E73', '#CC79A7']}
            html = archive.read('chart.html')
            assert b'data-chart-style="nature"' in html
            assert b'data-style="nature"' in html
            assert html.index(b'chart-styles.js') < html.index(b'chart-export.js')
            assert archive.read('chart.json') == c.get(chart['data_url']).content
            assert json.loads(archive.read('specification.json')) == chart['spec']

        legacy = c.get(chart['export_url'])
        assert legacy.status_code == 200
        with zipfile.ZipFile(io.BytesIO(legacy.content)) as archive:
            names = set(archive.namelist())
            assert 'style.json' not in names and 'chart-styles.js' not in names
            assert b'data-chart-style="default"' in archive.read('chart.html')

        assert c.get(chart['export_url'], params={'style': 'journal'}).status_code == 422
        empty = tmp_path / 'empty-styles'
        empty.mkdir()
        monkeypatch.setattr(chart_export, 'STYLE_DIR', empty)
        missing = c.get(chart['export_url'], params={'style': 'cell'})
        assert missing.status_code == 503
        assert missing.json()['detail']['code'] == 'chart_style_unavailable'


def test_export_editable_pptx_with_sources_and_no_model_call(tmp_path):
    pptx = pytest.importorskip('pptx')
    from pptx import Presentation

    with workspace(tmp_path) as (c, app, doc, provider):
        data, job, chart, note = build_sources(c, app, doc)
        body = {'title': 'Synthetic deck', 'style': 'cell',
                'note_ids': [note['id']], 'chart_ids': [chart['id']],
                'analysis_ids': [job['id']]}
        context_value = context(c, doc, body)
        request = {**body, 'source_sha256': context_value['source_sha256'],
                   'outline': context_value['suggested_outline']}
        calls = len(provider.calls)
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
        assert response.status_code == 200, response.text
        assert response.headers['content-type'].startswith(
            'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        assert '.pptx' in response.headers['content-disposition'].lower()
        assert len(provider.calls) == calls

        deck = Presentation(io.BytesIO(response.content))
        assert len(deck.slides) == len(context_value['suggested_outline']['slides']) + 1
        assert abs(deck.slide_width / deck.slide_height - 16 / 9) < 0.01
        texts = [shape.text_frame.text for slide in deck.slides for shape in slide.shapes
                 if shape.has_text_frame]
        assert any('Synthetic source note' in text for text in texts)
        assert any('来源附录' in text for text in texts)
        from pptx.enum.shapes import MSO_SHAPE_TYPE
        shapes = [shape for slide in deck.slides for shape in slide.shapes]
        assert sum(1 for shape in shapes
                   if shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE) > 5

        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            xml = '\n'.join(archive.read(name).decode('utf-8', errors='ignore')
                            for name in archive.namelist() if name.endswith('.xml'))
            assert note['id'] in xml and chart['id'] in xml and job['id'] in xml
            assert chart['data_sha256'] in xml

        retry = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
        assert retry.status_code == 200 and len(provider.calls) == calls


def test_export_failure_cleans_temporary_pptx(tmp_path, monkeypatch):
    pytest.importorskip('pptx')
    with workspace(tmp_path) as (c, app, doc, _):
        data, job, chart, note = build_sources(c, app, doc)
        body = {'title': 'Cleanup deck', 'style': 'default',
                'note_ids': [note['id']], 'chart_ids': [chart['id']],
                'analysis_ids': [job['id']]}
        context_value = context(c, doc, body)
        request = {**body, 'source_sha256': context_value['source_sha256'],
                   'outline': context_value['suggested_outline']}

        def fail(path):
            raise WorkspaceError('presentation_export_failed', '演示文稿 XML 校验失败，请重试。', 503)

        monkeypatch.setattr(presentation_export, '_validate', fail)
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
        assert response.status_code == 503
        assert list(app.state.store.exports.iterdir()) == []


def embedded_tables(archive):
    tables = []
    names = sorted(name for name in archive.namelist()
                   if name.startswith('ppt/embeddings/') and name.endswith('.xlsx'))
    for name in names:
        with zipfile.ZipFile(io.BytesIO(archive.read(name))) as workbook:
            shared = []
            if 'xl/sharedStrings.xml' in workbook.namelist():
                root = ET.fromstring(workbook.read('xl/sharedStrings.xml'))
                shared = [''.join(node.itertext()) for node in root]
            sheet = ET.fromstring(workbook.read('xl/worksheets/sheet1.xml'))
            strings, numbers = [], []
            for cell in sheet.iter(SHEET + 'c'):
                value = cell.find(SHEET + 'v')
                if value is None:
                    continue
                if cell.get('t') == 's':
                    strings.append(shared[int(value.text)])
                else:
                    numbers.append(float(value.text))
            tables.append((tuple(strings), tuple(numbers)))
    return tables


def xy_values(series):
    cache = series._element.find('{http://schemas.openxmlformats.org/drawingml/2006/chart}xVal')
    cache = cache.find('{http://schemas.openxmlformats.org/drawingml/2006/chart}numRef')
    cache = cache.find('{http://schemas.openxmlformats.org/drawingml/2006/chart}numCache')
    return [float(point.findtext('{http://schemas.openxmlformats.org/drawingml/2006/chart}v'))
            for point in cache.findall('{http://schemas.openxmlformats.org/drawingml/2006/chart}pt')]


def deck_texts(deck):
    return [shape.text_frame.text for slide in deck.slides for shape in slide.shapes
            if shape.has_text_frame]


def chart_suite(c, app, doc):
    data = upload(c, doc).json()
    job = run(app.state.analysis, doc, data, columns=['value', 'second'])
    charts = {'analysis_counts': save(c, doc, payload(c, data, 'analysis_counts',
                                                       analysis_id=job['id'])),
              'histogram': save(c, doc, payload(c, data, 'histogram')),
              'scatter': save(c, doc, payload(c, data, 'scatter'))}
    grouped = upload(c, doc, content=b'value,label\n1,a\n2,b\n3,a\n4,b\n',
                     name='groups.csv').json()
    charts['grouped_points'] = save(c, doc, payload(c, grouped, 'grouped_points',
                                                    x='label', y='value'))
    return job, charts


def test_native_charts_match_all_four_projections_and_embedded_values(tmp_path):
    pytest.importorskip('pptx')
    from pptx import Presentation
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    with workspace(tmp_path) as (c, app, doc, _):
        job, charts = chart_suite(c, app, doc)
        order = ['analysis_counts', 'histogram', 'scatter', 'grouped_points']
        body = {'title': 'Native chart deck', 'style': 'nature', 'note_ids': [],
                'chart_ids': [charts[kind]['id'] for kind in order], 'analysis_ids': []}
        context_value = context(c, doc, body)
        request = {**body, 'source_sha256': context_value['source_sha256'],
                   'outline': context_value['suggested_outline']}
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
        assert response.status_code == 200, response.text

        deck = Presentation(io.BytesIO(response.content))
        shapes = [shape for slide in deck.slides for shape in slide.shapes if shape.has_chart]
        assert len(shapes) == 4
        counts, histogram, scatter, grouped = [shape.chart for shape in shapes]

        assert counts.chart_type == XL_CHART_TYPE.COLUMN_CLUSTERED
        bar = counts.plots[0]
        assert [item.name for item in bar.series] == ['有效 / Valid', '缺失 / Missing']
        assert [list(item.values) for item in bar.series] == [[3.0, 2.0], [0.0, 1.0]]
        assert [str(item) for item in bar.categories] == ['value', 'second']
        assert counts.has_legend and counts.legend.position == XL_LEGEND_POSITION.BOTTOM
        assert bar.has_data_labels
        assert counts.value_axis.tick_labels.number_format == '0'

        assert histogram.chart_type == XL_CHART_TYPE.COLUMN_CLUSTERED
        bins = histogram.plots[0]
        assert [item.name for item in bins.series] == ['计数 / Count']
        assert list(bins.series[0].values) == [1.0, 2.0]
        assert [str(item) for item in bins.categories] == ['[1.0, 2.0)', '[2.0, 3.0]']
        assert bins.gap_width == 0
        assert histogram.value_axis.tick_labels.number_format == '0'

        assert scatter.chart_type == XL_CHART_TYPE.XY_SCATTER
        observations = scatter.plots[0].series[0]
        assert list(observations.values) == [10.0, 30.0]
        assert xy_values(observations) == [1.0, 3.0]
        assert scatter.category_axis.has_title
        assert scatter.category_axis.axis_title.text_frame.text == 'value'
        assert scatter.value_axis.axis_title.text_frame.text == 'second'

        assert grouped.chart_type == XL_CHART_TYPE.XY_SCATTER
        groups = grouped.plots[0].series
        assert [item.name for item in groups] == ['a', 'b']
        assert [list(item.values) for item in groups] == [[1.0, 3.0], [2.0, 4.0]]
        assert [xy_values(item) for item in groups] == [[1.0, 1.0], [2.0, 2.0]]
        assert sum(len(list(item.values)) for item in groups) == 4
        assert grouped.has_legend
        assert grouped.category_axis.minimum_scale == 0.5
        assert grouped.category_axis.maximum_scale == 2.5
        assert grouped.category_axis.major_unit == 1.0
        mapping = '\n'.join(shape.text_frame.text for shape in deck.slides[4].shapes
                            if shape.has_text_frame)
        assert '1 = a（n=2）' in mapping and '2 = b（n=2）' in mapping

        names = [shape.shape_type for slide in deck.slides for shape in slide.shapes]
        assert MSO_SHAPE_TYPE.PICTURE not in names
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            entries = archive.namelist()
            assert not any(name.startswith('ppt/media/') for name in entries)
            assert len([name for name in entries
                        if name.startswith('ppt/charts/chart') and name.endswith('.xml')]) == 4
            tables = embedded_tables(archive)

        def worksheet(*expected):
            matches = [numbers for strings, numbers in tables
                       if len(strings) == len(expected) and set(strings) == set(expected)]
            assert len(matches) == 1, tables
            return sorted(matches[0])

        assert len(tables) == 4
        assert worksheet('value', 'second', '有效 / Valid', '缺失 / Missing') == [0.0, 1.0, 2.0, 3.0]
        assert worksheet('[1.0, 2.0)', '[2.0, 3.0]', '计数 / Count') == [1.0, 2.0]
        assert worksheet('观测值 / Observation') == [1.0, 3.0, 10.0, 30.0]
        assert worksheet('a', 'b') == [1.0, 1.0, 1.0, 2.0, 2.0, 2.0, 3.0, 4.0]


def test_comparison_signs_stay_plain_text_and_markup_is_rejected(tmp_path):
    pytest.importorskip('pptx')
    from pptx import Presentation

    provider = PresentationProvider()
    with workspace(tmp_path, model=provider) as (c, app, doc, _):
        text = 'p < 0.05 supports the finding; p > 0.90 is compatible with no effect.'
        note = c.post(f"/api/v1/documents/{doc['id']}/notes",
                      json={'request_id': str(uuid4()), 'page': 2, 'text': text}).json()
        body = {'title': 'Comparison signs', 'style': 'default',
                'note_ids': [note['id']], 'chart_ids': [], 'analysis_ids': []}
        context_value = context(c, doc, body)
        assert 'p < 0.05' in context_value['text'] and 'p > 0.90' in context_value['text']
        note_slide = context_value['suggested_outline']['slides'][1]
        assert note_slide['source_refs'] == ['note:' + note['id']]
        assert 'p < 0.05' in note_slide['title'] and 'p > 0.90' in note_slide['title']

        outline = {'title': 'Result: p < 0.05', 'slides': [
            {'title': 'Comparison p < 0.05', 'body': ['p < 0.05 and p > 0.90'],
             'source_refs': ['note:' + note['id']], 'chart_id': None}]}
        provider.responses.append({'role': 'assistant', 'content': json.dumps(outline),
                                   'finish_reason': 'stop'})
        request = {**body, 'source_sha256': context_value['source_sha256'],
                   'request_id': str(uuid4()), 'confirmed': True}
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert response.status_code == 200, response.text
        assert response.json()['outline']['slides'][0]['body'] == ['p < 0.05 and p > 0.90']
        assert provider.calls[0]['tools'] == []
        system = provider.calls[0]['messages'][0]['content'].lower()
        assert 'untrusted quoted data' in system and 'never follow' in system

        export = {**body, 'source_sha256': context_value['source_sha256'],
                  'outline': response.json()['outline']}
        deck_response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export",
                               json=export)
        assert deck_response.status_code == 200, deck_response.text
        deck = Presentation(io.BytesIO(deck_response.content))
        assert any('p < 0.05' in text_value and 'p > 0.90' in text_value
                   for text_value in deck_texts(deck))

        tagged = {**export, 'outline': {'title': 'Tagged', 'slides': [
            {'title': 'Tagged', 'body': ['<script>alert(1)</script>'],
             'source_refs': ['note:' + note['id']], 'chart_id': None}]}}
        rejected = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=tagged)
        assert rejected.status_code == 422


def test_suggested_outline_lists_materials_and_marks_note_excerpt_range(tmp_path):
    pytest.importorskip('pptx')
    from pptx import Presentation

    with workspace(tmp_path) as (c, app, doc, _):
        data = upload(c, doc).json()
        job = run(app.state.analysis, doc, data, columns=['value', 'second'])
        chart = save(c, doc, payload(c, data, 'histogram'))
        long_text = 'Long note line for the excerpt. ' + 'segment ' * 400
        note = c.post(f"/api/v1/documents/{doc['id']}/notes",
                      json={'request_id': str(uuid4()), 'page': 2,
                            'text': long_text}).json()
        assert 'id' in note, note
        body = {'title': 'Materials deck', 'style': 'cell', 'note_ids': [note['id']],
                'chart_ids': [chart['id']], 'analysis_ids': [job['id']]}
        context_value = context(c, doc, body)
        assert '仅提供前 2000 字符' in context_value['text']
        outline = context_value['suggested_outline']
        assert '确定性草稿' not in json.dumps(outline, ensure_ascii=False)
        overview = '\n'.join(outline['slides'][0]['body'])
        assert 'Long note line' in overview
        assert 'Synthetic traceable chart' in overview
        note_slide = outline['slides'][1]
        assert note_slide['source_refs'] == ['note:' + note['id']]
        note_body = '\n'.join(note_slide['body'])
        assert 'Long note line' in note_body
        assert '页码：' not in note_body
        assert '仅提供前 2000 字符' in note_body
        assert f"原文共 {len(note['text'])} 字符" in note_body

        export = {**body, 'source_sha256': context_value['source_sha256'],
                  'outline': outline}
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=export)
        assert response.status_code == 200, response.text
        deck = Presentation(io.BytesIO(response.content))
        assert any('仅提供前 2000 字符' in text_value for text_value in deck_texts(deck))
        notes = [slide.notes_slide.notes_text_frame.text for slide in deck.slides]
        assert any('page=2' in value and 'revision=' in value for value in notes)


def test_export_slots_return_busy_and_always_release(tmp_path, monkeypatch):
    pytest.importorskip('pptx')
    with workspace(tmp_path) as (c, app, doc, _):
        data, job, chart, note = build_sources(c, app, doc)
        body = {'title': 'Slot deck', 'style': 'default', 'note_ids': [note['id']],
                'chart_ids': [chart['id']], 'analysis_ids': [job['id']]}
        context_value = context(c, doc, body)
        request = {**body, 'source_sha256': context_value['source_sha256'],
                   'outline': context_value['suggested_outline']}
        slots = presentation_export._EXPORT_SLOTS
        assert slots.acquire(False) and slots.acquire(False)
        try:
            busy = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
            assert busy.status_code == 429
            assert busy.json()['detail']['code'] == 'presentation_busy'
        finally:
            slots.release()
            slots.release()
        assert c.post(f"/api/v1/documents/{doc['id']}/presentations/export",
                      json=request).status_code == 200

        def fail(path):
            raise WorkspaceError('presentation_export_failed', '演示文稿 XML 校验失败，请重试。', 503)

        with monkeypatch.context() as scoped:
            scoped.setattr(presentation_export, '_validate', fail)
            assert c.post(f"/api/v1/documents/{doc['id']}/presentations/export",
                          json=request).status_code == 503
        assert slots.acquire(False) and slots.acquire(False)
        slots.release()
        slots.release()
        assert c.post(f"/api/v1/documents/{doc['id']}/presentations/export",
                      json=request).status_code == 200
