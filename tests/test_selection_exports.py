import hashlib
import io
import json
import zipfile
from analysis_support import workspace, upload, run
from selection_support import save
from chart_support import payload as chart_payload, prefix as chart_prefix
from import_support import import_runtime, upload_import, confirm as confirm_import, FIXTURES


def check_archive(response):
    assert response.status_code==200,response.text
    archive=zipfile.ZipFile(io.BytesIO(response.content));manifest=json.loads(archive.read('manifest.json'))
    for name,record in manifest['files'].items():
        assert hashlib.sha256(archive.read(name)).hexdigest()==record['sha256']
        assert len(archive.read(name))==record['byte_size']
    return archive


def test_selected_table_analysis_chart_and_exports_retain_entire_chain(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        parent=upload(c,doc,b'value,second,label\n1,10,a\n2,20,b\n3,30,a\n').json()
        child,_,_=save(c,doc,parent);grandchild,_,_=save(c,doc,child)
        job=run(app.state.analysis,doc,grandchild,columns=['value']);assert job['status']=='succeeded'
        result=app.state.analysis.result(doc['id'],job['id']);assert result['result']['stats'][0]['mean']==2
        archive=check_archive(c.get(f"/api/v1/documents/{doc['id']}/analyses/{job['id']}/export"))
        lineage=json.loads(archive.read('selection/lineage.json'));assert len(lineage['steps'])==2
        assert lineage['steps'][0]['source_rows']==[1,2] and lineage['steps'][1]['source_rows']==[1,3]
        assert archive.read('selection/'+parent['id']+'/source.csv')==c.get(parent['file_url']).content
        chart=c.post(chart_prefix(doc),json=chart_payload(c,grandchild,'scatter')).json()
        bundle=check_archive(c.get(chart_prefix(doc)+'/'+chart['id']+'/export'))
        assert json.loads(bundle.read('selection/lineage.json'))==lineage


def test_spss_child_retains_original_dictionary_policy_and_source_without_false_missing_counts(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (c,app,doc,_):
        imported=upload_import(c,doc).json();response=confirm_import(c,doc,imported)
        assert response.status_code==201,response.text
        parent=response.json();column=parent['columns'][0]['name'];value=parent['preview'][0][0]
        child,_,_=save(c,doc,parent,column=column,value=value)
        assert 'data_dictionary' not in child and 'import_provenance' not in child
        assert child['selection_provenance']['original_dictionary_available'] is True
        assert child['row_count']<=parent['row_count']
        files=app.state.selections.export_files(doc['id'],child['id'])
        root='selection/'+parent['id']+'/'
        assert json.loads(files[root+'data-dictionary.json'])==parent['data_dictionary']
        assert files[root+'original.sav']==(FIXTURES/'synthetic.sav').read_bytes()
        assert root+'import-provenance.json' in files
