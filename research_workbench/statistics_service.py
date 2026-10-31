"""Closed-method discovery and read-only data validation, never arbitrary code."""
import json
import os
from pathlib import Path
import subprocess
import sys
from .analysis_models import analysis_payload
from .analysis_recipes import clean_environment,recipe
from .models import WorkspaceError

WARNINGS=[
    '独立样本、抽样方式与研究设计由用户核实；软件不能从两组标签证明独立性。',
    'Student 还要求方差齐性；本方法不自动检验或断言分布、独立性和适用性。',
    '组1减组2；空结果值或空组别按完整案例规则排除，不自动删组或切换检验。',
    'p 值不是效应大小或科学/临床有效性的证明。',
]


def methods(service):
    code=recipe('r','ttest_independent');library=service.catalog.statistics.info()
    if library['available']:
        try:service.catalog.statistics.require()
        except WorkspaceError:library['available']=False
    return {'items':[{'id':'describe','available':True,'engines':['python','r']},
        {'id':'ttest_independent','title':'独立样本 t 检验','engine':'r',
         'available':library['available'] and bool(service.catalog.r_version),
         'recipe_sha256':code['sha256'],'code_url':'/api/v1/analysis/recipes/r?method=ttest_independent',
         'library':library,'limits':{'outcomes':1,'groups':2,'seconds':30}}]}


def probe(service,row,request):
    path=service.datasets.checked(row)
    command=[getattr(sys,'_base_executable',sys.executable),'-I','-S',
             str(Path(__file__).with_name('ttest_data.py')),str(path),row['delimiter'],
             json.dumps(request,ensure_ascii=True,allow_nan=False)]
    try:
        run=subprocess.run(command,capture_output=True,timeout=8,
            env=clean_environment(service.store.incoming),
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if len(run.stdout)>50000:raise ValueError()
        value=json.loads(run.stdout)
        if run.returncode==2:
            code=value.get('error','invalid_statistics_data')
            raise WorkspaceError('invalid_statistics_data','数据不满足两组独立样本 t 检验要求：'+code,422)
        if run.returncode:raise ValueError()
        service.datasets.checked(row)
        return value
    except subprocess.TimeoutExpired:
        raise WorkspaceError('statistics_preview_timeout','统计数据检查超时，请缩小数据后重试。',422) from None
    except (OSError,ValueError,TypeError):
        raise WorkspaceError('statistics_preview_failed','统计数据检查未完成，请保留参数后重试。',503) from None


def groups(service,document_id,payload):
    service.store.get_document(document_id)
    with service.store.connection() as connection:
        row=service.datasets.row(connection,document_id,str(payload.dataset_id))
    if row['sha256']!=payload.dataset_sha256:raise WorkspaceError('dataset_changed','数据版本已改变。',409)
    return probe(service,row,{'group_column':payload.group_column})


def preview(service,document_id,payload):
    if payload.method!='ttest_independent':raise WorkspaceError('invalid_method','请选择独立样本 t 检验。',422)
    with service.store.connection() as connection:
        row,_=service.validate(connection,document_id,payload)
    value=probe(service,row,{'columns':payload.columns,'ttest':payload.ttest.model_dump(mode='json')})
    library=service.catalog.statistics.require(payload.library_sha256)
    return {'saved':False,'parameters':analysis_payload(payload),**value,
            'recipe':recipe('r',payload.method),'library':library,'warnings':WARNINGS}
