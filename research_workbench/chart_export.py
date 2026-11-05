"""Portable chart replay with an unchanged pinned renderer and exact input."""
import html
import hashlib
import json
from pathlib import Path
import tempfile
import zipfile
from .agent_store import canonical
from .reading_export import ArchiveWriter
from .models import WorkspaceError

STYLE_DIR=Path(__file__).resolve().parents[1]/'frontend'
STYLE_IDS=('default','nature','cell')
STYLE_PALETTES={
    'default':['#1677B8','#8DA5B5','#009E73','#CC79A7'],
    'nature':['#0072B2','#D55E00','#009E73','#CC79A7'],
    'cell':['#3B5488','#E69F00','#00A087','#CC79A7'],
}


def style_payload(style):
    return {'id':style,'version':1,'palette':list(STYLE_PALETTES[style])}


def markup(chart,data,style='default',include_styles=False):
    value=json.loads(data);series=value['series'];kind=value['kind']
    if kind=='analysis_counts':rows=zip(series['columns'],series['valid'],series['missing']);headers=['Column','Valid','Missing']
    elif kind=='histogram':rows=zip(series['labels'],series['counts']);headers=['Interval','Count']
    else:rows=list(zip(series['rows'],series['x'],series['y']))[:200];headers=['Record',value['spec']['x'],value['spec']['y']]
    table='<table><thead><tr>'+''.join('<th>'+html.escape(str(h))+'</th>' for h in headers)+'</tr></thead><tbody>'
    for row in rows:table+='<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in row)+'</tr>'
    table+='</tbody></table>'
    escaped=data.decode().replace('&','\\u0026').replace('<','\\u003c').replace('>','\\u003e').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    style_helper='<script src="chart-styles.js"></script>' if include_styles else ''
    return ('<!doctype html><html lang="zh-CN" data-chart-style="'+style+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\' file:; style-src \'unsafe-inline\'; img-src \'self\' file: data: blob:; worker-src blob:; base-uri \'none\'; form-action \'none\'">'
        '<title>'+html.escape(chart['title'])+'</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:24px auto;padding:0 16px}#chart-plot{height:560px;max-width:100%}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{padding:8px;border:1px solid #ccc}h1{overflow-wrap:anywhere;font-size:24px}</style>'
        '<h1>'+html.escape(chart['title'])+'</h1><p>Derived chart / 派生图表 · '+html.escape(chart['dataset_name'])+'</p>'
        '<div id="chart-status" role="status"></div><div id="chart-plot" aria-label="Interactive chart"></div>'
        '<p>Used / 有效记录：'+str(chart['summary']['used_rows'])+' · Excluded / 排除记录：'+str(chart['summary']['excluded_rows'])+'</p>'
        '<details><summary>Data table / 数据表（散点最多预览200行，完整数据见 chart.json）</summary>'+table+'</details>'
        '<p><a href="chart.json">Chart data</a> · <a href="specification.json">Specification</a> · <a href="provenance.json">Provenance</a></p>'
        '<script id="chart-data" type="application/json">'+escaped+'</script>'
        '<script src="plotly-strict.min.js"></script>'+style_helper+'<script src="chart-export.js" data-style="'+style+'" id="chart-export-script"></script></html>').encode()


def build_chart_export(service,document_id,identifier,style=None):
    helper=None
    if style is not None:
        if style not in STYLE_IDS:raise WorkspaceError('chart_style_invalid','请选择支持的图表样式。',422)
        helper=STYLE_DIR/'chart-styles.js'
        if not helper.is_file():raise WorkspaceError('chart_style_unavailable','离线样式组件尚未部署，请稍后重试。',503)
    chart,data=service.data(document_id,identifier);service.check_renderer()
    if chart['renderer']['sha256']!=service.renderer['sha256']:raise WorkspaceError('chart_renderer_changed','此图表需要对应版本的绘图组件。',409)
    chosen='default' if style is None else style
    dataset=service.datasets.get(document_id,chart['dataset_id']);source=service.datasets.path(document_id,dataset['id'])
    suffix='.tsv' if dataset['original_filename'].lower().endswith('.tsv') else '.csv'
    provenance={k:v for k,v in chart.items() if k not in ('data_url','viewer_url','export_url')}
    owner=service.store.get_document(document_id)
    if owner.get('kind')=='study':provenance.update(source_kind='study',scope_sha256=owner['scope_sha256'])
    pending=None
    try:
        with tempfile.NamedTemporaryFile(dir=service.store.exports,suffix='.zip',delete=False) as temporary:pending=Path(temporary.name)
        with zipfile.ZipFile(pending,'w',compression=zipfile.ZIP_DEFLATED) as archive:
            writer=ArchiveWriter(archive);writer.text('chart.json',data);writer.text('specification.json',canonical(chart['spec']).encode())
            writer.text('provenance.json',canonical(provenance).encode());writer.text('chart.html',markup(chart,data,chosen,style is not None))
            if style is not None:
                writer.text('chart-styles.js',helper.read_bytes());writer.text('style.json',canonical(style_payload(chosen)).encode())
            if owner.get('kind')=='study':writer.text('study.json',canonical(owner).encode())
            writer.file('source'+suffix,source,dataset['sha256'],dataset['byte_size'])
            for name,raw in service.datasets.selections.export_files(document_id,dataset['id']).items():writer.text(name,raw)
            writer.file('plotly-strict.min.js',service.asset_root/'plotly-strict.min.js',service.renderer['sha256'],service.renderer['byte_size'])
            writer.text('LICENSE',(service.asset_root/'LICENSE').read_bytes())
            writer.text('renderer-manifest.json',(service.asset_root/'manifest.json').read_bytes())
            script=Path(__file__).resolve().parents[1]/'frontend/chart-export.js'
            writer.text('chart-export.js',script.read_bytes())
            with service.store.connection() as connection:
                stored=json.loads(service.row(connection,document_id,identifier)['spec_json'])
            sources=stored['calculation_sources']
            calculation_hash=hashlib.sha256(chart['kind'].encode()+sources['chart-projection.py'].encode()+sources['tabular.py'].encode()).hexdigest()
            if calculation_hash!=chart['recipe']['sha256']:raise WorkspaceError('chart_source_changed','图表计算代码记录已变化。',409)
            for name in ('chart-projection.py','tabular.py'):writer.text(name,sources[name].encode())
            if chart['analysis_id']:
                with service.store.connection() as connection:job=service.analysis_source(connection,document_id,chart['analysis_id'],dataset)
                writer.text('analysis-record.json',canonical(job).encode())
            manifest={'format':'research-chart-export/v1','files':writer.files}
            archive.writestr('manifest.json',canonical(manifest).encode())
        return pending,'chart-'+identifier+'.zip'
    except BaseException:
        if pending is not None:pending.unlink(missing_ok=True)
        raise
