import pytest
from analysis_support import workspace, upload, payload, wait, R_PATH
from selection_support import save
from import_support import import_runtime, upload_import, confirm as confirm_import


@pytest.mark.parametrize('engine',['python','r'])
def test_actual_supervised_process_consumes_committed_selection(tmp_path,engine):
    if engine=='r' and R_PATH is None:pytest.skip('Set RESEARCH_TEST_RSCRIPT')
    with workspace(tmp_path,worker=True) as (c,app,doc,_):
        parent=upload(c,doc,b'value,second,label\n1,10,a\n2,20,b\n3,30,a\n').json()
        child,_,_=save(c,doc,parent)
        response=c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(child,engine))
        assert response.status_code==201,response.text
        job=wait(c,doc,response.json()['id']);assert job['status']=='succeeded',job['error']
        assert job['result']['stats'][0]['n']==2 and job['result']['stats'][0]['mean']==2
        assert c.get(parent['file_url']).content==b'value,second,label\n1,10,a\n2,20,b\n3,30,a\n'


def test_spss_selection_in_actual_process_preserves_and_checks_parent(tmp_path,import_runtime):
    with workspace(tmp_path,worker=True,import_root=import_runtime) as (c,app,doc,_):
        imported=upload_import(c,doc).json();parent=confirm_import(c,doc,imported).json()
        numeric=next(field['name'] for field in parent['columns'] if field['numeric'])
        child,_,_=save(c,doc,parent,column=parent['columns'][0]['name'],value=parent['preview'][0][0])
        response=c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(child,columns=[numeric]))
        assert response.status_code==201,response.text
        result=wait(c,doc,response.json()['id']);assert result['status']=='succeeded',result['error']


def test_supervised_worker_rejects_changed_ancestor_after_queuing(tmp_path):
    from research_workbench.analysis_models import AnalysisCreate
    with workspace(tmp_path,worker=True) as (c,app,doc,_):
        parent=upload(c,doc).json();child,_,_=save(c,doc,parent)
        job,_=app.state.analysis.create(doc['id'],AnalysisCreate(**payload(child)))
        app.state.datasets.path(doc['id'],parent['id']).write_bytes(b'corrupted source')
        app.state.analysis.supervisor.ensure_started()
        result=wait(c,doc,job['id']);assert result['status']=='failed' and result['error']['code']=='dataset_changed'
