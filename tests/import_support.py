import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4
import pytest

from research_workbench.import_runtime import environment

FIXTURES=Path(__file__).parent/'fixtures/spss'
RUNTIME=Path(os.environ['RESEARCH_TEST_IMPORT_ROOT']) if os.environ.get('RESEARCH_TEST_IMPORT_ROOT') else None


@pytest.fixture
def import_runtime():
    if RUNTIME is None or not (RUNTIME/'manifest.json').exists():pytest.skip('Set RESEARCH_TEST_IMPORT_ROOT to the isolated reader runtime')
    return RUNTIME


def upload_import(client,document,body=None,name='synthetic.sav',identifier=None):
    body=(FIXTURES/'synthetic.sav').read_bytes() if body is None else body
    return client.post(f"/api/v1/documents/{document['id']}/data-imports",data={'request_id':identifier or str(uuid4())},files={'file':(name,body,'application/octet-stream')})


def confirmation(imported,**changes):
    value={'source_sha256':imported['sha256'],'review_sha256':imported['review_sha256'],'acknowledge':True}
    value.update(changes);return value


def confirm(client,document,imported,**changes):
    return client.post(f"/api/v1/documents/{document['id']}/data-imports/{imported['id']}/confirm",json=confirmation(imported,**changes))


def probe(runtime,tmp_path,name):
    from research_workbench import spss_probe
    python=Path(json.loads((runtime/'manifest.json').read_text())['python'])
    target=tmp_path/'normalized.tsv'
    done=subprocess.run([str(python),'-I',spss_probe.__file__,str(FIXTURES/name),str(target)],capture_output=True,timeout=15,env=environment())
    return done,json.loads(done.stdout) if done.stdout else {},target
