import csv
import io
import threading
from uuid import uuid4
from analysis_support import workspace, upload
from selection_support import prefix, prepared, save, spec
from research_workbench.selection_probe import project
import pytest


@pytest.mark.parametrize('value', ['x'*2048,'中'*2048,'a,b\n"quoted"'])
def test_maximum_cells_and_csv_escaping_are_exact(tmp_path,value):
    output=io.StringIO(newline='');writer=csv.writer(output,lineterminator='\n');writer.writerow(['label','value']);writer.writerow([value,'1'])
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,output.getvalue().encode()).json();child,_,_=save(c,doc,data,value=value)
        assert list(csv.reader(io.StringIO(c.get(child['file_url']).text)))[1]==[value,'1']


def test_maximum_rows_and_complete_matching_result(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,b'label,value\n'+b'a,1\n'*50000).json()
        child,_,preview=save(c,doc,data)
        assert child['row_count']==50000 and preview['counts']['excluded']==0
        assert len(c.get(child['selection_provenance']['rows_url']).json()['steps'][0]['source_rows'])==50000


def test_tsv_to_csv_expansion_cannot_exceed_five_mib(tmp_path):
    path=tmp_path/'large.tsv'
    # Commas need no TSV escaping but are quoted when materialized as CSV.
    path.write_bytes(b'label\tvalue\n'+(b'a\t'+b','*100+b'\n')*50000)
    assert path.stat().st_size<5*1024*1024
    with pytest.raises(ValueError,match='dataset_too_large'):
        project(path,'\t',{'mode':'preview','column':'label','value':'a'})


def test_changed_recipe_after_preview_and_invalid_parent_are_rejected(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();body,_=prepared(c,doc,data)
        from research_workbench import dataset_selections as module
        old=module.sources();monkeypatch.setattr(module,'sources',lambda:{**old,'selection_probe.py':old['selection_probe.py']+'\n# updated recipe'})
        assert c.post(prefix(doc),json=body).status_code==409
        assert c.post(prefix(doc)+'/preview',json={**spec(c,data),'dataset_id':str(uuid4())}).status_code==404
        assert len(app.state.datasets.list(doc['id']))==1
