from contextlib import contextmanager
import os
from uuid import uuid4
from fastapi.testclient import TestClient
from agent_support import ScriptedModel
from research_workbench.main import create_app
from analysis_support import R_PATH


@contextmanager
def workspace(root,worker=False,**kwargs):
    model=ScriptedModel();app=create_app(root,agent_provider=model,agent_autostart=False,analysis_autostart=worker,
        analysis_rscript=R_PATH,statistics_root=os.environ.get('RESEARCH_TEST_STATISTICS_ROOT'),import_root=os.environ.get('RESEARCH_TEST_IMPORT_ROOT'),**kwargs)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as c:
        body={'request_id':str(uuid4()),'name':'Synthetic study','question':'How do the recorded values differ?'}
        response=c.post('/api/v1/studies',json=body);assert response.status_code==201,response.text
        yield c,app,response.json(),model


def anchor(owner,kind='study',identifier=None,checksum=None):
    return {'kind':kind,'id':identifier or owner['id'],'sha256':checksum or owner['sha256']}


def note(c,owner,source=None,text='Synthetic research note',identifier=None):
    return c.post(f"/api/v1/documents/{owner['id']}/notes",json={'request_id':identifier or str(uuid4()),'page':None,'rect':None,'text':text,'source':source or anchor(owner)})
