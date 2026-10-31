import copy
import hashlib
import io
import json
import sqlite3
import subprocess
from types import SimpleNamespace
from uuid import uuid4
import zipfile
import pytest

from analysis_support import workspace
from agent_support import text_pdf
from chart_support import prefix,save
from grouped_support import prepare
from research_workbench.chart_validation import projection


def test_old_recipe_fingerprints_remain_exact_and_new_kind_is_independent():
    from research_workbench.charts import recipe
    expected={'analysis_counts':'0cbd577f40daf535822b971e46442b33a7c9a63126634a11ebdd634e9a97d947',
      'histogram':'f50388e6c02bfa9a9553ab36e282945b80c055c1f1ff10271745dc3ea4e1c11b',
      'scatter':'55ad0068e76a7b774f3131de50383601448cf15529b612132200a1fe3c5b47ec'}
    assert {kind:recipe(kind)['sha256'] for kind in expected}==expected
    assert recipe('grouped_points')['sha256'] not in expected.values()


@pytest.mark.parametrize('mode',['numeric_x','nan_y','bool_y','duplicate_rows','bool_row','too_large_row','group_count','group_order','extra_group','missing_reason','bool_reason','summary_extra','series_extra'])
def test_malformed_child_protocol_rejected_without_write(tmp_path,monkeypatch,mode):
    with workspace(tmp_path) as (c,app,doc,_):
        _,body=prepare(c,doc)
        response=c.post(prefix(doc)+'/preview',json=body);value=response.json()['data']
        output={k:value[k] for k in ('summary','series')}
        s,r=output['summary'],output['series']
        if mode=='numeric_x':r['x'][0]=1
        if mode=='nan_y':r['y'][0]=float('nan')
        if mode=='bool_y':r['y'][0]=True
        if mode=='duplicate_rows':r['rows'][1]=r['rows'][0]
        if mode=='bool_row':r['rows'][0]=True
        if mode=='too_large_row':r['rows'][0]=8
        if mode=='group_count':s['groups'][0]['count']=1
        if mode=='group_order':s['groups'].reverse()
        if mode=='extra_group':r['x'][-1]='C'
        if mode=='missing_reason':s['missing_both']=0
        if mode=='bool_reason':s['missing_group_only']=True
        if mode=='summary_extra':s['unexpected']=1
        if mode=='series_extra':r['z']=[1,2,3]
        import research_workbench.charts as module
        monkeypatch.setattr(module.subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=0,stdout=json.dumps(output).encode()))
        result=c.post(prefix(doc),json=body);assert result.status_code==503,result.text
        assert c.get(prefix(doc)).json()['items']==[] and not list(app.state.store.incoming.iterdir())


@pytest.mark.parametrize('mode',['timeout','permission','busy','paper','dataset','receipt'])
def test_execution_failures_leave_no_record_and_release_resources(tmp_path,monkeypatch,mode):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,doc);service=app.state.charts
        if mode in ('timeout','permission'):
            error=subprocess.TimeoutExpired('fixed-probe',8) if mode=='timeout' else PermissionError('test permission failure')
            def failed(*args,**kwargs):raise error
            import research_workbench.charts as module
            monkeypatch.setattr(module.subprocess,'run',failed)
        if mode=='busy':service.slots.acquire();service.slots.acquire()
        if mode=='paper':app.state.store.files.joinpath(doc['id']+'.pdf').write_bytes(b'changed')
        if mode=='dataset':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        if mode=='receipt':
            with app.state.store.connection() as db:db.execute("CREATE TRIGGER no_chart BEFORE INSERT ON charts BEGIN SELECT RAISE(ABORT,'stop'); END")
        response=c.post(prefix(doc),json=body)
        assert response.status_code in (409,422,429,503),response.text
        assert c.get(prefix(doc)).json()['items']==[] and not list(app.state.store.incoming.iterdir())
        if mode=='busy':service.slots.release();service.slots.release()
        assert service.slots.acquire(False);service.slots.release()


def test_grouped_source_snapshot_export_restart_and_wrong_paper(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,doc);chart=save(c,doc,body);original=c.get(chart['data_url']).content
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert c.get(prefix(other)+'/'+chart['id']).status_code==404
        assert c.post(prefix(other),json={**body,'request_id':str(uuid4())}).status_code==404
        response=c.get(chart['export_url']);assert response.status_code==200,response.text
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manifest=json.loads(archive.read('manifest.json'))
            for name,entry in manifest['files'].items():assert hashlib.sha256(archive.read(name)).hexdigest()==entry['sha256']
            assert archive.read('chart.json')==original
            assert b'Closed raw-observation projection' in archive.read('chart-projection.py')
            sources=chart['kind'].encode()+archive.read('chart-projection.py')+archive.read('tabular.py')
            assert hashlib.sha256(sources).hexdigest()==chart['recipe']['sha256']
    from fastapi.testclient import TestClient
    from research_workbench.main import create_app
    app=create_app(tmp_path,agent_autostart=False,analysis_autostart=False)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as c:
        assert c.get(chart['data_url']).content==original and c.get(chart['export_url']).status_code==200
