from copy import deepcopy
import json
from uuid import uuid4
import pytest
from paired_support import CSV,payload,preview,workspace
from research_workbench.analysis_models import AnalysisCreate,analysis_payload
from research_workbench.analysis_recipes import recipe
from research_workbench.paired_ttest_data import parse,prepare


def test_discovery_preview_complete_pair_basis_and_no_write(tmp_path):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        body=payload(c,data);response=preview(c,doc,body);assert response.status_code==200,response.text
        value=response.json();assert value['saved'] is False and 'test' not in value
        assert value['counts']=={'total':6,'used':3,'excluded':3,'missing_first_only':1,'missing_second_only':1,'missing_both':1}
        assert value['stats_basis']=='complete_pairs' and value['stats'][0]['mean']==3
        assert value['stats'][1]['mean']==pytest.approx(13/3) and value['difference_stats']['mean']==pytest.approx(-4/3)
        assert value['pairing']['direction']=='first_minus_second'
        assert c.get(f"/api/v1/documents/{doc['id']}/analyses").json()['items']==[]
        assert body['method']==value['parameters']['method']=='ttest_paired'
        assert c.post(f"/api/v1/documents/{doc['id']}/analyses/ttest/preview",json=body).status_code==422


@pytest.mark.parametrize('change',[{'engine':'python'},{'columns':['first']},{'columns':['first','first']},
    {'columns':['first','second','ID']},{'paired':None},{'library_sha256':None},{'ttest':{}},{'extra':1}])
def test_invalid_method_shape_has_no_job(tmp_path,change):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        assert preview(c,doc,payload(c,data,**change)).status_code==422
        assert app.state.analysis.list(doc['id'])==[]


@pytest.mark.parametrize('change',[{'unit_column':'first'},{'unit_column':''},{'paired_samples_confirmed':False},
    {'paired_samples_confirmed':1},{'paired_samples_confirmed':'true'},{'confidence':.49},{'confidence':1.0},
    {'confidence':True},{'confidence':'0.95'},{'alternative':'automatic'},{'missing':'drop_each_column'},{'extra':1}])
def test_invalid_pairing_parameters(tmp_path,change):
    with workspace(tmp_path,content=CSV) as (c,app,doc,data,_):
        body=payload(c,data);body['paired'].update(change)
        assert preview(c,doc,body).status_code==422


@pytest.mark.parametrize('content',[
    b'ID,first,second\nA,1,2\nA,3,5\n',b'ID,first,second\n,1,2\nB,3,5\n',
    b'ID,first,second\n A,1,2\nB,3,5\n',b'ID,first,second\n"A\nB",1,2\nC,3,5\n',
    ('ID,first,second\n'+'A'*201+',1,2\nB,3,5\n').encode(),
    b'ID,first,second\nA,1,2\nB,3,4\n',b'ID,first,second\nA,1,2\nB,3,\n',
    b'ID,first,second\nA,bad,2\nB,3,5\n',b'ID,first,second\nA,1e308,-1e308\nB,1,2\n'])
def test_ambiguous_or_unusable_pairs_rejected(tmp_path,content):
    with workspace(tmp_path,content=content) as (c,app,doc,data,_):
        assert preview(c,doc,payload(c,data)).status_code==422
        assert app.state.analysis.list(doc['id'])==[]


def test_exact_identifiers_and_source_row_mapping(tmp_path):
    source=tmp_path/'input.csv';source.write_bytes(b'ID,first,second\n01,1,2\n1,3,5\nX,4,\n')
    profile,rows=parse(source,',');prepared,values,mapping=prepare(profile,rows,['first','second'],{'unit_column':'ID'})
    assert [v[1] for v in values]==['01','1'] and [v[0] for v in values]==[1,2]
    assert mapping['rows'][2]=={'source_row':3,'unit_id':'X','used':False,'reason':'missing_second_only'}


def test_legacy_payloads_and_independent_recipe_remain_exact():
    base={'request_id':str(uuid4()),'dataset_id':str(uuid4()),'dataset_sha256':'a'*64,'engine':'python','columns':['first'],'recipe_sha256':'b'*64}
    assert analysis_payload(AnalysisCreate(**base))==base
    old={**base,'engine':'r','method':'ttest_independent','library_sha256':'c'*64,
        'ttest':{'group_column':'group','groups':['A','B'],'variant':'welch','alternative':'two_sided',
        'confidence':.95,'missing':'complete_cases','independent_samples_confirmed':True}}
    assert analysis_payload(AnalysisCreate(**old))==old
    assert 'paired' not in analysis_payload(AnalysisCreate(**old))
