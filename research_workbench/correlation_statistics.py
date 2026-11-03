import json,os,subprocess,sys
from pathlib import Path
from .analysis_models import analysis_payload
from .analysis_recipes import clean_environment,recipe
from .models import WorkspaceError

WARNINGS=[
    '每行两项测量须来自同一观察单位，行间独立性与研究设计由用户核实。 / Confirm matched measurements and independent observational rows.',
    '缺任一项时整对排除，描述统计仅基于完整配对。 / Missing either value excludes the entire pair; summaries use complete pairs.',
    '相关不代表因果；异常值、分布和方法适用性需核实。 / Correlation does not establish causality; check outliers, distributions and method suitability.',
]


def warnings(kind):
    detail=('Spearman 使用渐近近似 p 值，不提供置信区间。 / Spearman uses asymptotic p-values and provides no confidence interval.' if kind=='spearman' else
            'Pearson 仅在至少4个完整配对时提供 Fisher 区间。 / Pearson provides a Fisher interval only with at least4 complete pairs.')
    return [*WARNINGS,detail]


def probe(service,row,request):
    path=service.datasets.checked(row)
    command=[getattr(sys,'_base_executable',sys.executable),'-I','-S',str(Path(__file__).with_name('correlation_data.py')),
             str(path),row['delimiter'],json.dumps(request,ensure_ascii=True,allow_nan=False)]
    try:
        run=subprocess.run(command,capture_output=True,timeout=8,env=clean_environment(service.store.incoming),
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if len(run.stdout)>50000:raise ValueError()
        value=json.loads(run.stdout)
        if run.returncode==2:raise WorkspaceError('invalid_correlation_data','相关数据检查未通过：'+value.get('error','invalid_data'),422)
        if run.returncode:raise ValueError()
        service.datasets.checked(row)
        return value
    except subprocess.TimeoutExpired:
        raise WorkspaceError('correlation_preview_timeout','相关数据检查超时，请缩小数据后重试。',422) from None
    except (OSError,ValueError,TypeError):
        raise WorkspaceError('correlation_preview_failed','相关数据检查未完成，请保留参数后重试。',503) from None


def preview(service,document_id,payload):
    if payload.method!='correlation':raise WorkspaceError('invalid_method','请选择相关分析。',422)
    with service.store.connection() as connection:
        row,_=service.validate(connection,document_id,payload,probe_data=False)
    value=probe(service,row,{'columns':payload.columns,'correlation':payload.correlation.model_dump(mode='json')})
    return {'saved':False,'parameters':analysis_payload(payload),**value,'recipe':recipe('r','correlation'),
            'library':service.catalog.statistics.require(payload.library_sha256),'warnings':warnings(payload.correlation.kind)}
