from copy import deepcopy
from pathlib import Path
from uuid import uuid4
import pytest
from pydantic import ValidationError
from research_workbench.analysis_models import AnalysisCreate,analysis_payload
from research_workbench.analysis_recipes import recipe
from research_workbench.tabular import parse
from research_workbench.ttest_data import prepare
from statistics_support import CSV

OPTIONS={'group_column':'group','groups':['A','B'],'variant':'welch','alternative':'two_sided',
    'confidence':.95,'missing':'complete_cases','independent_samples_confirmed':True}


def body():
    return {'request_id':str(uuid4()),'dataset_id':str(uuid4()),'dataset_sha256':'a'*64,'engine':'r',
            'columns':['value'],'method':'ttest_independent','ttest':deepcopy(OPTIONS),
            'recipe_sha256':recipe('r','ttest_independent')['sha256'],'library_sha256':'b'*64}


@pytest.mark.parametrize('field,value',[('independent_samples_confirmed',False),('independent_samples_confirmed',1),
    ('independent_samples_confirmed','true'),('variant','paired'),('alternative','automatic'),
    ('confidence',0),('confidence',1),('confidence','0.95'),('groups',['A','A']),
    ('groups',['A']),('groups',['','B']),('missing','mean_imputation')])
def test_scientific_choices_are_explicit_and_closed(field,value):
    request=body();request['ttest'][field]=value
    with pytest.raises(ValidationError):AnalysisCreate(**request)


def test_old_descriptive_payload_bytes_remain_unchanged():
    request=body()
    for key in ('method','ttest','library_sha256'):request.pop(key)
    assert analysis_payload(AnalysisCreate(**request))==request


def test_complete_case_counts_and_order(tmp_path):
    path=tmp_path/'data.csv';path.write_bytes(CSV);profile,rows=parse(path,',')
    prepared,normalized=prepare(profile,rows,['value'],OPTIONS)
    assert prepared['counts']=={'total':13,'used':10,'excluded':3,'missing_outcome_only':1,'missing_group_only':1,'missing_both':1}
    assert [s['mean'] for s in prepared['stats']]==[3,6]
    assert normalized[:2]==[(1,1),(2,1)]
    reverse=deepcopy(OPTIONS);reverse['groups'].reverse()
    assert [s['mean'] for s in prepare(profile,rows,['value'],reverse)[0]['stats']]==[6,3]


@pytest.mark.parametrize('raw,columns,options',[
    (b'value,group\n1,A\n2,A\n3,B\n4,B\n5,C\n',['value'],OPTIONS),
    (b'value,group\n1,A\n2,B\n3,B\n',['value'],OPTIONS),
    (b'value,group\n1,A\n1,A\n2,B\n2,B\n',['value'],OPTIONS),
    (b'value,group\nno,A\n2,A\n3,B\n4,B\n',['value'],OPTIONS),
    (CSV,['value','group'],OPTIONS),(CSV,['group'],OPTIONS),
    (CSV,['value'],{**OPTIONS,'groups':['A','C']}),
    (CSV,['value'],{**OPTIONS,'group_column':'missing'})])
def test_invalid_design_data_rejected(tmp_path,raw,columns,options):
    path=tmp_path/'data.csv';path.write_bytes(raw);profile,rows=parse(path,',')
    with pytest.raises((ValueError,OverflowError)):prepare(profile,rows,columns,options)
