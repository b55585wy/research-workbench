import csv
import hashlib
import io
import json
import pytest

from import_support import FIXTURES,import_runtime,probe


@pytest.mark.parametrize('name',['synthetic.sav','synthetic.zsav'])
def test_native_reader_preserves_codes_labels_missing_dates_and_text(import_runtime,tmp_path,name):
    done,value,target=probe(import_runtime,tmp_path,name)
    assert done.returncode==0,done.stderr.decode()
    review=value['review'];fields={column['name']:column for column in review['columns']}
    assert (review['row_count'],review['column_count'])==(8,5)
    assert fields['group']['label']=='实验分组'
    assert fields['group']['value_labels']==[{'value':1.0,'label':'干预组'},{'value':2.0,'label':'对照组'},{'value':99.0,'label':'未分组'}]
    assert fields['score']['label']=='得分 <script>literal</script>'
    assert fields['score']['missing_ranges']==[{'lo':998.0,'hi':999.0}]
    for name in ('group','score'):
        assert (fields[name]['system_missing'],fields[name]['user_missing'],fields[name]['nonmissing'])==(1,1,6)
    assert (fields['remark']['system_missing'],fields['remark']['user_missing'],fields['remark']['blank_missing'])==(0,1,1)
    assert fields['participant']['numeric'] is False and fields['visit']['numeric'] is False
    assert fields['visit']['source_type']=='date_time'
    rows=list(csv.reader(io.StringIO(target.read_text(encoding='utf-8')),delimiter='\t'))
    assert rows[1][:3]==['001','1','1'] and rows[1][3]=='2025-01-01'
    assert rows[3][2]=='' and rows[3][4]=='' and rows[7][1]==''
    assert review['preview'][2][2]=='999' and review['preview'][2][4]=='unknown'
    assert value['normalized_sha256']==hashlib.sha256(target.read_bytes()).hexdigest()
    assert review['policy']['value_labels']=='retain_codes'


@pytest.mark.parametrize('name,accepted',[
    ('rows-50000.sav',True),('rows-50001.sav',False),
    ('columns-50.sav',True),('columns-51.sav',False),
    ('cell-2048.sav',True),('cell-2049.sav',False),
    ('metadata.sav',False),('expanded.zsav',False),
])
def test_native_reader_resource_boundaries(import_runtime,tmp_path,name,accepted):
    done,value,_=probe(import_runtime,tmp_path,name)
    assert (done.returncode==0) is accepted
    if not accepted:assert value=={'error':'invalid_spss'}


def test_fixture_manifest_matches_independent_writer_inputs():
    manifest=json.loads((FIXTURES/'manifest.json').read_text())
    assert manifest['synthetic'] is True
    for name,checksum in manifest['files'].items():assert hashlib.sha256((FIXTURES/name).read_bytes()).hexdigest()==checksum
