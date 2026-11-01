import json
import os
from pathlib import Path
import subprocess
import sys
from .analysis_models import analysis_payload
from .analysis_recipes import clean_environment,recipe
from .models import WorkspaceError

WARNINGS=[
    '每行两次测量必须来自同一对象；唯一标识只检查数据形式，不证明实验配对或跨对象独立性。',
    '第一列减第二列；缺任一测量时整对排除，不分别删行或按顺序猜配对。',
    '两列量纲与单位的一致性、差值分布、异常值、抽样方式及重复测量设计由用户核实，本方法不自动验证适用性。',
    '仅支持每个对象恰好一对测量，不替代多时点模型；p 值不证明科学或临床有效性。',
]


def probe(service,row,request):
    path=service.datasets.checked(row)
    command=[getattr(sys,'_base_executable',sys.executable),'-I','-S',
        str(Path(__file__).with_name('paired_ttest_data.py')),str(path),row['delimiter'],json.dumps(request,ensure_ascii=True,allow_nan=False)]
    try:
        run=subprocess.run(command,capture_output=True,timeout=8,env=clean_environment(service.store.incoming),
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if len(run.stdout)>50000:raise ValueError()
        value=json.loads(run.stdout)
        if run.returncode==2:
            raise WorkspaceError('invalid_paired_data','配对数据检查未通过：'+value.get('error','invalid_data'),422)
        if run.returncode:raise ValueError()
        service.datasets.checked(row)
        return value
    except subprocess.TimeoutExpired:
        raise WorkspaceError('statistics_preview_timeout','配对数据检查超时，请缩小数据后重试。',422) from None
    except (OSError,ValueError,TypeError):
        raise WorkspaceError('statistics_preview_failed','配对数据检查未完成，请保留参数后重试。',503) from None


def preview(service,document_id,payload):
    if payload.method!='ttest_paired':raise WorkspaceError('invalid_method','请选择配对 t 检验。',422)
    with service.store.connection() as connection:
        row,_=service.validate(connection,document_id,payload,probe_data=False)
    value=probe(service,row,{'columns':payload.columns,'paired':payload.paired.model_dump(mode='json')})
    return {'saved':False,'parameters':analysis_payload(payload),**value,
        'recipe':recipe('r',payload.method),'library':service.catalog.statistics.require(payload.library_sha256),'warnings':WARNINGS}
