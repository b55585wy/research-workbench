import csv
import io
import json
from uuid import uuid4
import pytest
from analysis_support import workspace, upload
from selection_support import prefix, spec, prepared, save


@pytest.mark.parametrize('value,indices', [('0.5',[1,4]), ('0.50',[2]), (' 0.5',[3]), ('',[5]), (' ',[6]), ('001',[7]), ('1',[8]), ('中文',[9])])
@pytest.mark.parametrize('delimiter,name', [(',', 'source.csv'), ('\t','source.tsv')])
def test_raw_equality_preserves_cells_order_mapping_and_source(tmp_path,value,indices,delimiter,name):
    raw=delimiter.join(['label','value'])+'\n'+'\n'.join(delimiter.join(r) for r in [('0.5','1'),('0.50','2'),(' 0.5','3'),('0.5','4'),('','5'),(' ','6'),('001','7'),('1','8'),('中文','9')])+'\n'
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,raw.encode(),name).json(); original=app.state.datasets.path(doc['id'],data['id']).read_bytes()
        child,body,preview=save(c,doc,data,value=value)
        assert preview['saved'] is False and preview['counts']=={'total':9,'matched':len(indices),'excluded':9-len(indices)}
        rows=list(csv.reader(io.StringIO(c.get(child['file_url']).text)))
        assert rows[0]==['label','value'] and [r[1] for r in rows[1:]]==[str(i) for i in indices]
        assert child['row_count']==len(indices) and child['columns'][1]['nonempty']==len(indices)
        lineage=c.get(child['selection_provenance']['rows_url']).json()
        assert lineage['steps'][0]['source_rows']==indices
        assert app.state.datasets.path(doc['id'],data['id']).read_bytes()==original
        assert c.post(prefix(doc),json=body).status_code==200
        assert len(app.state.datasets.list(doc['id']))==2


def test_catalog_paginates_searches_and_preserves_long_or_empty_values(tmp_path):
    values=['',' ','中'*300]+[f'v{i}' for i in range(65)]+['v1']
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,('label,value\n'+'\n'.join(f'{v},1' for v in values)+'\n').encode()).json()
        base={k:spec(c,data)[k] for k in ('dataset_id','dataset_sha256','column')}
        result=c.post(prefix(doc)+'/values',json=base).json()
        assert len(result['items'])==50 and result['total_distinct']==68 and result['has_more']
        assert result['items'][:2]==[{'value':'','count':1},{'value':' ','count':1}]
        assert result['items'][2]['value']=='中'*300
        second=c.post(prefix(doc)+'/values',json={**base,'offset':50}).json()
        assert len(second['items'])==18 and not second['has_more']
        found=c.post(prefix(doc)+'/values',json={**base,'query':'v1'}).json()
        assert found['items'][0]=={'value':'v1','count':2} and found['total_matches']==11


@pytest.mark.parametrize('change', [{'value':1},{'value':'\x00'},{'value':'x'*2049},{'column':''},{'column':'unknown'},{'name':'../x'},{'name':' '},{'name':'a\n'+'b'},{'recipe_sha256':'a'*64}])
def test_invalid_rule_is_rejected_without_any_write(tmp_path,change):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json()
        response=c.post(prefix(doc)+'/preview',json=spec(c,data,**change))
        assert response.status_code in (409,422),response.text
        assert len(app.state.datasets.list(doc['id']))==1 and not list(app.state.selections.root.iterdir())


def test_zero_preview_and_drift_and_idempotency_conflict(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();body,preview=prepared(c,doc,data,value='absent')
        assert preview['counts']['matched']==0 and preview['columns']==[]
        assert c.post(prefix(doc),json=body).status_code==422
        body,preview=prepared(c,doc,data)
        for changes in ({'value':'b'},{'name':'Other'},{'preview_sha256':'a'*64},{'dataset_sha256':'b'*64}):
            assert c.post(prefix(doc),json={**body,**changes}).status_code==409
        child=c.post(prefix(doc),json=body).json()
        assert child['id']==body['request_id']
        assert c.post(prefix(doc),json={**body,'name':'Other'}).status_code==409
        assert len(app.state.datasets.list(doc['id']))==2


@pytest.mark.parametrize('changes', [{'offset':-1},{'offset':50001},{'limit':51},{'limit':0},{'query':'x'*101},{'limit':True}])
def test_values_limits(tmp_path,changes):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();body={k:spec(c,data)[k] for k in ('dataset_id','dataset_sha256','column')}
        assert c.post(prefix(doc)+'/values',json={**body,**changes}).status_code==422


def test_cross_paper_source_and_generated_identifier_cannot_be_reused(tmp_path):
    from conftest import make_pdf
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();other=c.post('/api/v1/documents',files={'file':('second.pdf',make_pdf(3),'application/pdf')}).json()
        assert c.post(prefix(other)+'/preview',json=spec(c,data)).status_code==404
        body,_=prepared(c,doc,data);body['request_id']=data['id']
        assert c.post(prefix(doc),json=body).status_code==409
