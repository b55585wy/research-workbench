import json
from uuid import uuid4
import pytest
from analysis_support import workspace
from chart_support import prefix,save,lifecycle
from grouped_support import prepare


def test_complete_observations_missing_reasons_first_order_and_duplicates(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,body=prepare(c,doc);original=c.get(data['file_url']).content
        response=c.post(prefix(doc)+'/preview',json=body);assert response.status_code==200,response.text
        value=response.json()['data']
        assert value['series']=={'x':['B','A','B'],'y':[3,1,3],'rows':[1,2,3]}
        assert value['summary']=={'row_count':7,'columns':['group','value'],'groups':[{'label':'B','count':2},{'label':'A','count':1}],
            'used_rows':3,'excluded_rows':4,'missing_group_only':1,'missing_value_only':2,'missing_both':1}
        assert c.get(prefix(doc)).json()['items']==[] and model.calls==[]
        saved=save(c,doc,body);again=c.post(prefix(doc),json=body);assert again.status_code==200 and again.json()==saved
        assert c.get(saved['data_url']).json()==value and c.get(data['file_url']).content==original
        assert c.post(prefix(doc),json={**body,'title':'Different title'}).status_code==409
        deleted=lifecycle(c,doc,saved)[0].json();assert c.get(saved['data_url']).status_code==409
        restored=lifecycle(c,doc,deleted,'restore')[0].json();assert restored['revision']==3
        assert c.get(restored['data_url']).json()==value


@pytest.mark.parametrize('raw,labels,values',[
 ('group,value\n001,0\n1,0\n',['001','1'],[0,0]),
 ('group,value\n A,5\nA,5\n',[' A','A'],[5,5]),
 ('group,value\n对照,5e-324\n处理,1e-323\n',['对照','处理'],[5e-324,1e-323]),
 ('group,value\n<script>alert(1)</script>,1\n<b>plain & literal</b>,2\n',['<script>alert(1)</script>','<b>plain & literal</b>'],[1,2]),
 ('group,value\n'+('甲'*200)+',1\n乙,2\n',['甲'*200,'乙'],[1,2]),
 ('group,value\nB,1\nA,2\n   ,4\n',['B','A'],[1,2]),
])
def test_exact_labels_constants_and_boundary_values(tmp_path,raw,labels,values):
    with workspace(tmp_path) as (c,app,doc,_):
        _,body=prepare(c,doc,raw.encode());response=c.post(prefix(doc)+'/preview',json=body)
        assert response.status_code==200,response.text
        artifact=response.json()['data'];assert artifact['series']['x']==labels and artifact['series']['y']==values
        assert artifact['summary']['groups']==[{'label':label,'count':1} for label in labels]


@pytest.mark.parametrize('raw',[
 'group,value\nA,1\nA,2\n','group,value\n,1\n,2\n',
 'group,value\nA,1\nB,2\nC,3\n','group,value\nA,\nB,\n',
 'group,value\nA,one\nB,two\n','group,value\n'+('a'*201)+',1\nB,2\n',
 'group,value\n"A\tB",1\nC,2\n','group,value\n"A\nB",1\nC,2\n',
 'group,value\nA\u0085B,1\nC,2\n',
 'group,value\nA,-1e308\nB,1e308\n',
])
def test_ineligible_data_never_saves(tmp_path,raw):
    with workspace(tmp_path) as (c,app,doc,_):
        _,body=prepare(c,doc,raw.encode());response=c.post(prefix(doc),json=body)
        assert response.status_code==422,response.text
        assert c.get(prefix(doc)).json()['items']==[]


@pytest.mark.parametrize('changes',[
 {'x':None},{'y':None},{'x':'group','y':'group'},{'x':'missing'},{'y':'group'},
 {'bins':2},{'analysis_id':str(uuid4())},{'script':'anything'},{'layout':{}},
 {'dataset_sha256':'0'*64},{'recipe_sha256':'0'*64},{'renderer_sha256':'0'*64},
])
def test_closed_parameter_and_source_guards(tmp_path,changes):
    with workspace(tmp_path) as (c,app,doc,_):
        _,body=prepare(c,doc);response=c.post(prefix(doc),json={**body,**changes})
        assert response.status_code in (409,422),response.text
        assert not c.get(prefix(doc)).json()['items']


def test_large_observation_count_and_protocol_size_boundary(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        raw=('group,value\n'+''.join(('A' if i%2 else 'B')+',1\n' for i in range(50000))).encode()
        _,body=prepare(c,doc,raw);response=c.post(prefix(doc)+'/preview',json=body)
        assert response.status_code==200,response.text
        series=response.json()['data']['series'];assert len(series['rows'])==50000 and series['rows'][-1]==50000
    with workspace(tmp_path/'bounded') as (c,app,doc,_):
        a,b='甲'*100,'乙'*100
        raw=('group,value\n'+''.join((a if i%2 else b)+',1\n' for i in range(10000))).encode()
        _,body=prepare(c,doc,raw);response=c.post(prefix(doc),json=body)
        assert response.status_code==413,response.text
        assert c.get(prefix(doc)).json()['items']==[]
