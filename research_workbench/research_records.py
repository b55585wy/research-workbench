"""Read-only export plans bound to the precise sources the user reviewed."""
import base64
import hashlib
from html import escape
import json
from pathlib import Path
import re
import tempfile
import threading
from uuid import UUID
import zipfile
from pydantic import ValidationError

from .agent_store import canonical
from .analysis_export import build_analysis_export
from .chart_export import build_chart_export
from .excerpts import verify_source
from .models import WorkspaceError
from .reading_export import ArchiveWriter, build_export
from .record_archive import copy_component
from .record_models import RecordSpec, RecordToken
from .store import timestamp

MAX_BYTES = 128*1024*1024


def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()


def changed():
    raise WorkspaceError('record_scope_changed', '所选资料或结果已变化，请重新预览导出范围。', 409)


def encode_token(document_id, spec, checksum):
    value = {'version': 1, 'document_id': document_id, 'spec': spec.model_dump(mode='json'), 'preview_sha256': checksum}
    return base64.urlsafe_b64encode(canonical(value).encode()).decode().rstrip('=')


def decode_token(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,2048}', value): raise ValueError()
        raw = base64.b64decode(value+'='*((-len(value))%4), altchars=b'-_', validate=True)
        token = RecordToken.model_validate_json(raw)
        if encode_token(str(token.document_id), token.spec, token.preview_sha256) != value: raise ValueError()
        return token
    except (ValueError, ValidationError):
        raise WorkspaceError('invalid_record_token', '导出链接无效，请重新预览。', 422) from None


def counts(snapshot):
    _, notes, excerpts, groups = snapshot
    return {'notes': len(notes), 'excerpts': len(excerpts), 'annotations': sum(len(group['items']) for group in groups)}


class ResearchRecords:
    def __init__(self, store, datasets, analysis, charts):
        self.store, self.datasets, self.analysis, self.charts = store, datasets, analysis, charts
        self.capacity = threading.BoundedSemaphore(2)

    def dataset(self, document_id, identifier, checksum):
        dataset = self.datasets.get(document_id, str(identifier))
        if dataset['sha256'] != checksum: changed()
        self.datasets.path(document_id, dataset['id'])
        return dataset

    def options(self, document_id, identifier, checksum):
        document = self.store.get_document(document_id); verify_source(self.store, document)
        data = self.dataset(document_id, identifier, checksum)
        jobs = [j for j in self.analysis.list(document_id) if j['dataset_id'] == data['id'] and j['dataset_sha256'] == checksum and j['status'] == 'succeeded']
        charts = [c for c in self.charts.list(document_id) if c['dataset_id'] == data['id'] and c['dataset_sha256'] == checksum and not c['deleted_at']]
        return {'document': {'id': document['id'], 'title': document['title']}, 'dataset': self.dataset_summary(data),
                'analyses': [{**{k: j[k] for k in ('id', 'engine', 'created_at')}, 'method': j.get('method', 'describe')} for j in jobs],
                'charts': [{k: c[k] for k in ('id', 'title', 'kind')} for c in charts],
                'reading': self.reading_counts(document_id),
                'limits': {'max_bytes': MAX_BYTES}}

    def reading_counts(self, document_id):
        with self.store.connection() as db:
            notes = db.execute('SELECT COUNT(*) FROM notes n JOIN note_states s ON s.note_id=n.id WHERE n.document_id=? AND s.deleted_at IS NULL', (document_id,)).fetchone()[0]
            excerpts = db.execute('SELECT COUNT(*) FROM excerpts e JOIN notes n ON n.id=e.note_id JOIN note_states s ON s.note_id=n.id WHERE n.document_id=? AND s.deleted_at IS NULL', (document_id,)).fetchone()[0]
            annotations = db.execute('''SELECT COUNT(*) FROM image_annotations a LEFT JOIN note_states s ON s.note_id=a.excerpt_note_id
                WHERE a.document_id=? AND a.deleted_at IS NULL AND (a.image_id IS NOT NULL OR s.deleted_at IS NULL)''', (document_id,)).fetchone()[0]
        return {'notes': notes, 'excerpts': excerpts, 'annotations': annotations}

    @staticmethod
    def dataset_summary(data):
        return {'id': data['id'], 'name': data['original_filename'], 'sha256': data['sha256'], 'row_count': data['row_count']}

    def snapshot(self, document_id, spec):
        document = self.store.get_document(document_id); verify_source(self.store, document)
        dataset = self.dataset(document_id, spec.dataset_id, spec.dataset_sha256)
        reading = self.store.reading_snapshot(document_id, include_annotations=True) if spec.include_reading else None
        job = self.analysis.result(document_id, str(spec.analysis_id)) if spec.analysis_id else None
        chart = self.charts.data(document_id, str(spec.chart_id))[0] if spec.chart_id else None
        for result in (job, chart):
            if result and (result['dataset_id'], result['dataset_sha256']) != (dataset['id'], dataset['sha256']): changed()
        if job and chart and chart['analysis_id'] and chart['analysis_id'] != job['id']:
            raise WorkspaceError('record_result_mismatch', '图表关联的分析与所选分析不同，请重新选择。', 409)
        if job:
            for item in job['outputs']: self.analysis.file(document_id, job['id'], item['name'])
        if chart and chart['deleted_at']: changed()
        snapshot = {'document': document, 'dataset': dataset, 'reading': reading, 'analysis': job, 'chart': chart}
        checksum = digest({'format': 'research-record/v1', 'spec': spec.model_dump(mode='json'), 'snapshot': snapshot})
        public = {'saved': False, 'format': 'research-record/v1', 'spec': spec.model_dump(mode='json'),
                  'document': {k: document[k] for k in ('id', 'title', 'sha256')}, 'dataset': self.dataset_summary(dataset),
                  'analysis': {**{k: job[k] for k in ('id', 'engine')}, 'method': job.get('method', 'describe')} if job else None,
                  'chart': {k: chart[k] for k in ('id', 'title', 'kind', 'analysis_id')} if chart else None,
                  'reading': {'included': spec.include_reading, **(counts(reading) if reading else {'notes': 0, 'excerpts': 0, 'annotations': 0})},
                  'limits': {'max_bytes': MAX_BYTES}, 'preview_sha256': checksum}
        public['download_url'] = f'/api/v1/documents/{document_id}/research-records/download?token='+encode_token(document_id, spec, checksum)
        return public

    def preview(self, document_id, spec): return self.snapshot(document_id, spec)

    def download(self, document_id, value):
        token = decode_token(value)
        if str(token.document_id) != document_id: changed()
        if not self.capacity.acquire(False):
            raise WorkspaceError('record_export_busy', '正在导出其他研究记录，请稍后重试。', 429)
        try:
            preview = self.snapshot(document_id, token.spec)
            if preview['preview_sha256'] != token.preview_sha256: changed()
            return self.build(document_id, token.spec, preview)
        finally: self.capacity.release()

    def build(self, document_id, spec, preview):
        target = None; components = []; complete = False
        try:
            with tempfile.NamedTemporaryFile(dir=self.store.exports, suffix='.zip', delete=False) as stream: target = Path(stream.name)
            with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                writer = ArchiveWriter(archive)
                if spec.include_reading:
                    self.component(writer, components, 'reading', build_export, self.store, document_id)
                else:
                    document = self.store.get_document(document_id)
                    writer.file('source.pdf', verify_source(self.store, document), document['sha256'], document['byte_size'])
                self.data_files(writer, document_id, preview['dataset'])
                if spec.analysis_id:
                    self.component(writer, components, 'analysis', build_analysis_export, self.analysis, document_id, str(spec.analysis_id))
                if spec.chart_id:
                    self.component(writer, components, 'chart', build_chart_export, self.charts, document_id, str(spec.chart_id))
                if self.snapshot(document_id, spec)['preview_sha256'] != preview['preview_sha256']: changed()
                record = {k: v for k, v in preview.items() if k not in ('download_url', 'saved')}
                record['exported_at'] = timestamp()
                writer.text('record.json', canonical(record).encode())
                writer.text('index.html', self.index(preview).encode('utf-8'))
                manifest = {'format': 'research-record/v1', 'scope_sha256': preview['preview_sha256'], 'files': writer.files}
                manifest_bytes = canonical(manifest).encode()
                writer.account(len(manifest_bytes))
                archive.writestr('manifest.json', manifest_bytes)
            complete = True
            return target, f"research-record-{document_id}-{spec.dataset_id}.zip"
        finally:
            for path in components: path.unlink(missing_ok=True)
            if target is not None and not complete: target.unlink(missing_ok=True)

    @staticmethod
    def component(writer, components, prefix, builder, *args):
        path, _ = builder(*args); components.append(path)
        copy_component(writer, prefix, path)

    def data_files(self, writer, document_id, summary):
        data = self.datasets.get(document_id, summary['id'])
        suffix = '.tsv' if data['original_filename'].lower().endswith('.tsv') else '.csv'
        writer.file('data/source'+suffix, self.datasets.path(document_id, data['id']), data['sha256'], data['byte_size'])
        extra = self.datasets.selections.export_files(document_id, data['id'])
        if data.get('import_provenance'):
            extra.update(self.datasets.imports.export_files(document_id, data['import_provenance']['import_id'], data))
        for name, raw in extra.items(): writer.text('data/'+name, raw)

    @staticmethod
    def index(preview):
        data = preview['dataset']; reading = preview['reading']['included']
        suffix = '.tsv' if data['name'].lower().endswith('.tsv') else '.csv'
        links = [('reading/source.pdf' if reading else 'source.pdf', '原论文 / Source PDF'),
                 ('data/source'+suffix, '所选数据 / Selected data'), ('record.json', '范围与来源 / Scope and provenance'),
                 ('manifest.json', '文件校验清单 / File checksums')]
        if reading: links.append(('reading/index.html', '有效笔记与图片标注 / Active notes and image annotations'))
        if preview['analysis']: links.append(('analysis/index.html', '已保存分析 / Saved analysis'))
        if preview['chart']: links.append(('chart/chart.html', '交互图表 / Interactive chart'))
        html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        html += '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">'
        html += '<title>研究记录 / Research record</title><style>body{font:16px/1.65 system-ui;max-width:960px;margin:32px auto;padding:0 16px}h1{font-size:26px}p,li{overflow-wrap:anywhere}li{margin:12px 0}a{color:#176487}code{font-size:13px}</style>'
        html += '<h1>'+escape(preview['document']['title'])+'</h1><p>研究记录 / Research record</p>'
        html += '<p>'+escape(data['name'])+' · '+str(data['row_count'])+'行 / rows</p><p>数据 SHA-256: <code>'+data['sha256']+'</code></p>'
        html += '<ul>'+''.join('<li><a href="'+name+'">'+label+'</a></li>' for name,label in links)+'</ul>'
        html += '<p>解压后打开本页。图表可离线交互；记录中的代码不会自动执行。 / Extract and open this page. Charts work offline; saved code does not execute automatically.</p>'
        html += '<p>仅收录明确选择的已保存结果；不代表分析方法适用或结论已复核。笔记保留原复核状态。 / Selected saved results only. Inclusion does not establish scientific validity or source review.</p></html>'
        return html
