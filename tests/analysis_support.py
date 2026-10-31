from contextlib import contextmanager
import os
from pathlib import Path
import threading
import time
from uuid import uuid4
from fastapi.testclient import TestClient

from agent_support import ScriptedModel,text_pdf
from research_workbench.main import create_app
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_recipes import recipe
from research_workbench.analysis_worker import execute

R_PATH=Path(os.environ['RESEARCH_TEST_RSCRIPT']) if os.environ.get('RESEARCH_TEST_RSCRIPT') else None
CSV='value,second,label\n1,10,a\n2,,b\n3,30,c\n'.encode()


@contextmanager
def workspace(root,model=None,worker=False,agent=False,rscript=R_PATH):
    model=model or ScriptedModel()
    app=create_app(root,agent_provider=model,agent_autostart=agent,analysis_autostart=worker,analysis_rscript=rscript)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as client:
        response=client.post('/api/v1/documents',files={'file':('synthetic.pdf',text_pdf(),'application/pdf')})
        assert response.status_code==201,response.text
        yield client,app,response.json(),model


def upload(client,document,content=CSV,name='synthetic.csv',identifier=None):
    return client.post(f"/api/v1/documents/{document['id']}/datasets",data={'request_id':identifier or str(uuid4())},
        files={'file':(name,content,'text/csv')})


def payload(dataset,engine='python',columns=None,**changes):
    value={'request_id':str(uuid4()),'dataset_id':dataset['id'],'dataset_sha256':dataset['sha256'],
           'engine':engine,'columns':['value'] if columns is None else columns,'recipe_sha256':recipe(engine if engine in ('python','r') else 'python')['sha256']}
    value.update(changes);return value


def run(service,document,dataset,engine='python',columns=None):
    job,_=service.create(document['id'],AnalysisCreate(**payload(dataset,engine,columns)))
    row=service.claim();execute(service,row,threading.Event())
    return service.get(document['id'],job['id'])


def wait(client,document,identifier):
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        result=client.get(f"/api/v1/documents/{document['id']}/analyses/{identifier}").json()
        if result['status'] not in ('queued','running'):return result
        threading.Event().wait(.02)
    raise AssertionError('Analysis did not finish')
