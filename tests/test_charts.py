from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
from types import SimpleNamespace
from uuid import uuid4
import pytest
from analysis_support import workspace,upload
from agent_support import text_pdf
from chart_support import prefix,payload,prepare,save,lifecycle
import research_workbench.charts as module


@pytest.mark.parametrize('kind',['analysis_counts','histogram','scatter'])
def test_actual_projection_preview_save_retry_and_restartable_data_preserve_original(tmp_path,kind):
    with workspace(tmp_path) as (c,app,doc,model):
        dataset,body=prepare(c,app,doc,kind);original=c.get(dataset['file_url']).content
        preview=c.post(prefix(doc)+'/preview',json=body);assert preview.status_code==200,preview.text
        value=preview.json();assert value['chart']['revision']==0 and value['chart']['origin']=='preview'
        assert c.get(prefix(doc)).json()['items']==[]
        chart=save(c,doc,body);assert chart['origin']=='manual' and chart['revision']==1
        assert c.post(prefix(doc),json=body).status_code==200 and c.post(prefix(doc),json=body).json()==chart
        response=c.get(chart['data_url']);assert response.status_code==200
        assert len(response.content)==chart['data_byte_size'] and hashlib.sha256(response.content).hexdigest()==chart['data_sha256']==response.headers['x-content-sha256']
        assert response.json()==value['data'];series=response.json()['series'];summary=response.json()['summary']
        if kind=='analysis_counts':assert series=={'columns':['value','second'],'valid':[3,2],'missing':[0,1]}
        if kind=='histogram':assert series['counts']==[1,2] and summary['used_rows']==3
        if kind=='scatter':assert series=={'x':[1,3],'y':[10,30],'rows':[1,3]} and summary['excluded_rows']==1
        assert c.get(dataset['file_url']).content==original and model.calls==[]


@pytest.mark.parametrize('values,bins,counts',[
    ('5\n5\n5\n',20,[3]),('0\n1\n2\n3\n4\n',4,[1,1,1,2]),
    ('-1e308\n0\n1e308\n',2,[1,2]),('0\n5e-324\n1e-323\n',2,[1,2])])
def test_histogram_edges_equal_values_large_and_subnormal_numbers(tmp_path,values,bins,counts):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,content=('value\n'+values).encode()).json();body=payload(c,data,bins=bins)
        response=c.post(prefix(doc)+'/preview',json=body);assert response.status_code==200,response.text
        assert response.json()['data']['series']['counts']==counts


@pytest.mark.parametrize('changes',[
 {'kind':'arbitrary'},{'title':' '},{'title':'x'*121},{'title':'x\0y'}, {'bins':True},{'bins':1},{'bins':51},
 {'bins':'20'},{'y':'second'},{'analysis_id':str(uuid4())},{'x':None},{'x':'label'},{'x':'missing'},
 {'recipe_sha256':'0'*64},{'renderer_sha256':'0'*64},{'dataset_sha256':'0'*64},
 {'request_id':'invalid'},{'script':'anything'},{'layout':{}},{'dataset_id':str(uuid4())}])
def test_invalid_or_stale_parameters_never_create_records(tmp_path,changes):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();body=payload(c,data);body.update(changes)
        response=c.post(prefix(doc),json=body);assert response.status_code in (404,409,422),response.text
        assert c.get(prefix(doc)).json()['items']==[]


@pytest.mark.parametrize('raw',['value,second\n1,\n,2\n','value,second\n-1e308,1\n1e308,2\n'])
def test_scatter_rejects_no_pairs_or_unrepresentable_range(tmp_path,raw):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,content=raw.encode()).json();response=c.post(prefix(doc),json=payload(c,data,'scatter'))
        assert response.status_code==422 and c.get(prefix(doc)).json()['items']==[]


def test_cross_paper_dataset_analysis_chart_and_database_scopes(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc,'analysis_counts');chart=save(c,doc,body)
        other=c.post('/api/v1/documents',files={'file':('other.pdf',text_pdf(),'application/pdf')}).json()
        assert c.post(prefix(other),json=body).status_code==409
        body['request_id']=str(uuid4());assert c.post(prefix(other),json=body).status_code==404
        assert c.get(prefix(other)+'/'+chart['id']).status_code==404
        second=upload(c,doc).json();response=c.post(prefix(doc),json=payload(c,second,'analysis_counts',analysis_id=body['analysis_id']))
        assert response.status_code==409
        with app.state.store.connection() as db:
            with pytest.raises(sqlite3.IntegrityError):db.execute('UPDATE charts SET document_id=?',(other['id'],))


def test_concurrent_exact_save_and_lifecycle_noops_receipts_and_conflicts(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc)
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:c.post(prefix(doc),json=body),range(2)))
        assert sorted(r.status_code for r in responses)==[200,201];chart=responses[0].json();assert responses[1].json()==chart
        assert c.post(prefix(doc),json={**body,'title':'Changed'}).status_code==409
        response,request=lifecycle(c,doc,chart);deleted=response.json();assert deleted['revision']==2
        assert c.get(deleted['data_url']).status_code==409 and c.post(prefix(doc),json=body).status_code==409
        assert lifecycle(c,doc,deleted)[0].json()==deleted
        restored=lifecycle(c,doc,deleted,'restore')[0].json();assert restored['revision']==3
        assert c.request('DELETE',prefix(doc)+'/'+chart['id'],json=request).status_code==409
        assert lifecycle(c,doc,chart)[0].status_code==409
        assert lifecycle(c,doc,restored,'restore')[0].json()==restored


@pytest.mark.parametrize('target',['dataset','paper','blob','summary'])
def test_source_and_artifact_corruption_fail_closed(tmp_path,target):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc);chart=save(c,doc,body)
        if target=='dataset':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        if target=='paper':(app.state.store.files/f"{doc['id']}.pdf").write_bytes(b'changed')
        if target in ('blob','summary'):
            with app.state.store.connection() as db:
                db.execute('UPDATE charts SET '+('data_bytes=?' if target=='blob' else 'summary_json=?'),(b'{}' if target=='blob' else '{}',))
        assert c.get(chart['data_url']).status_code==409
        assert lifecycle(c,doc,chart)[0].status_code==409


@pytest.mark.parametrize('failure',['timeout','crash','protocol','busy','permission','transaction'])
def test_child_capacity_and_failure_roll_back_without_leaking_paths(tmp_path,monkeypatch,failure):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc);service=app.state.charts
        if failure=='timeout':monkeypatch.setattr(module.subprocess,'run',lambda *a,**k:(_ for _ in ()).throw(subprocess.TimeoutExpired('private',1)))
        if failure=='crash':monkeypatch.setattr(module.subprocess,'run',lambda *a,**k:SimpleNamespace(stdout=b'',returncode=1))
        if failure=='protocol':monkeypatch.setattr(module.subprocess,'run',lambda *a,**k:SimpleNamespace(stdout=b'{"summary":{},"series":{}}',returncode=0))
        if failure=='busy':service.slots.acquire();service.slots.acquire()
        if failure=='permission':monkeypatch.setattr(service,'compute',lambda *a:(_ for _ in ()).throw(PermissionError('private-path')))
        if failure=='transaction':
            with app.state.store.connection() as db:db.execute("CREATE TRIGGER reject_chart BEFORE INSERT ON charts BEGIN SELECT RAISE(ABORT,'private-path'); END")
        response=c.post(prefix(doc),json=body);assert response.status_code in (422,429,503),response.text
        assert 'private' not in response.text and c.get(prefix(doc)).json()['items']==[]
        assert list(app.state.store.incoming.iterdir())==[]


def test_lifecycle_receipt_write_failure_is_atomic_and_quota_includes_trash(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc);chart=save(c,doc,body)
        with app.state.store.connection() as db:db.execute("CREATE TRIGGER reject_op BEFORE INSERT ON chart_operations BEGIN SELECT RAISE(ABORT,'stop'); END")
        assert lifecycle(c,doc,chart)[0].status_code==503 and c.get(prefix(doc)+'/'+chart['id']).json()==chart
        with app.state.store.connection() as db:
            db.execute('DROP TRIGGER reject_op');row=dict(db.execute('SELECT * FROM charts').fetchone());columns=list(row)
            for _ in range(19):
                copy={**row,'id':str(uuid4()),'deleted_at':'2026-10-31T00:00:00+00:00'}
                db.execute('INSERT INTO charts VALUES ('+','.join('?' for _ in columns)+')',[copy[k] for k in columns])
        assert c.post(prefix(doc),json={**body,'request_id':str(uuid4())}).status_code==413


@pytest.mark.parametrize('target',['dataset','recipe','renderer'])
def test_change_during_projection_is_rechecked_before_save(tmp_path,monkeypatch,target):
    with workspace(tmp_path) as (c,app,doc,_):
        data,body=prepare(c,app,doc);service=app.state.charts;actual=service.compute
        def changed(*args):
            result=actual(*args)
            if target=='dataset':app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
            if target=='recipe':monkeypatch.setattr(module,'recipe',lambda kind:{'id':kind+'-v1','version':1,'sha256':'0'*64})
            if target=='renderer':service.renderer={**service.renderer,'sha256':'0'*64}
            return result
        monkeypatch.setattr(service,'compute',changed)
        response=c.post(prefix(doc),json=body);assert response.status_code==409,response.text
        assert c.get(prefix(doc)).json()['items']==[]
