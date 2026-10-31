from contextlib import contextmanager
import os
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
import pytest
from agent_support import ScriptedModel,text_pdf
from research_workbench.main import create_app

CSV=b'value,group\n1,A\n2,A\n3,A\n4,A\n5,A\n2,B\n4,B\n6,B\n8,B\n10,B\n,A\n9,\n,\n'


@contextmanager
def workspace(root,model=None,agent=False,worker=False,content=CSV,statistics=True):
    runtime=os.environ.get('RESEARCH_TEST_STATISTICS_ROOT')
    rscript=os.environ.get('RESEARCH_TEST_RSCRIPT')
    if statistics and (not runtime or not rscript):pytest.skip('Explicit isolated R stats runtime required')
    model=model or ScriptedModel()
    app=create_app(root,agent_provider=model,agent_autostart=agent,analysis_autostart=worker,
        analysis_rscript=rscript,statistics_root=runtime if statistics else None)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as c:
        doc=c.post('/api/v1/documents',files={'file':('SYNTHETIC.pdf',text_pdf(),'application/pdf')}).json()
        prefix='/api/v1/documents/'+doc['id']
        data=c.post(prefix+'/datasets',data={'request_id':str(uuid4())},files={'file':('SYNTHETIC.csv',content,'text/csv')}).json()
        yield c,app,doc,data,model


def payload(c,data,**changes):
    method=c.get('/api/v1/analysis/methods').json()['items'][1]
    value={'request_id':str(uuid4()),'dataset_id':data['id'],'dataset_sha256':data['sha256'],'engine':'r',
        'columns':['value'],'method':'ttest_independent','recipe_sha256':method['recipe_sha256'],
        'library_sha256':method['library']['sha256'],'ttest':{'group_column':'group','groups':['A','B'],
        'variant':'welch','alternative':'two_sided','confidence':.95,'missing':'complete_cases','independent_samples_confirmed':True}}
    value.update(changes);return value
