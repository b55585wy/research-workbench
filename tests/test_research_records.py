import hashlib
import json
from html.parser import HTMLParser
from pathlib import PurePosixPath
from uuid import uuid4
import pytest
from analysis_support import workspace, upload, payload
from record_support import prefix, prepare, spec, preview, verified
from chart_support import prefix as chart_prefix, lifecycle
from selection_support import save
from import_support import import_runtime, upload_import, confirm as confirm_import, FIXTURES


class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.links.extend(v for k,v in attrs if k=='href')


@pytest.mark.parametrize('reading',[False,True])
@pytest.mark.parametrize('analysis,chart',[(False,False),(True,False),(False,True),(True,True)])
def test_explicit_scope_exports_exact_saved_artifacts_without_writes(tmp_path,reading,analysis,chart):
    with workspace(tmp_path) as (c,app,doc,_):
        dataset,job,graph=prepare(c,app,doc)
        with app.state.store.connection() as db:
            names=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            before={n:list(map(tuple,db.execute(f'SELECT * FROM {n} ORDER BY 1'))) for n in names}
        plan=preview(c,doc,dataset,analysis_id=job['id'] if analysis else None,chart_id=graph['id'] if chart else None,include_reading=reading)
        assert plan['saved'] is False and not list(app.state.store.exports.iterdir())
        archive=verified(c.get(plan['download_url']))
        assert archive.read('data/source.csv')==c.get(dataset['file_url']).content
        assert ('reading/index.html' in archive.namelist()) is reading
        assert ('analysis/index.html' in archive.namelist()) is analysis
        assert ('chart/chart.html' in archive.namelist()) is chart
        parser=Links();parser.feed(archive.read('index.html').decode())
        assert all(link in archive.namelist() for link in parser.links)
        record=json.loads(archive.read('record.json'));assert record['preview_sha256']==plan['preview_sha256']
        assert 'download_url' not in record and not list(app.state.store.exports.iterdir())
        if analysis:
            for item in app.state.analysis.result(doc['id'],job['id'])['outputs']:
                assert archive.read('analysis/'+item['name'])==app.state.analysis.file(doc['id'],job['id'],item['name'])[0].read_bytes()
        if chart:assert archive.read('chart/chart.json')==c.get(chart_prefix(doc)+'/'+graph['id']+'/data').content
        assert c.get(plan['download_url']).status_code==200
        with app.state.store.connection() as db:
            assert db.execute('PRAGMA user_version').fetchone()[0]==13 and len(names)==28
            assert before=={n:list(map(tuple,db.execute(f'SELECT * FROM {n} ORDER BY 1'))) for n in names}


def test_options_only_succeeded_results_and_active_same_source_charts(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        dataset,job,graph=prepare(c,app,doc);other=upload(c,doc,name='other.csv').json()
        c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(dataset))
        options=c.get(prefix(doc)+'/options',params={'dataset_id':dataset['id'],'dataset_sha256':dataset['sha256']}).json()
        assert [j['id'] for j in options['analyses']]==[job['id']]
        assert [g['id'] for g in options['charts']]==[graph['id']]
        lifecycle(c,doc,graph)
        options=c.get(prefix(doc)+'/options',params={'dataset_id':dataset['id'],'dataset_sha256':dataset['sha256']}).json()
        assert options['charts']==[]
        assert c.post(prefix(doc)+'/preview',json=spec(other,analysis_id=job['id'])).status_code==409
        assert c.post(prefix(doc)+'/preview',json=spec(other,chart_id=graph['id'])).status_code==409


@pytest.mark.parametrize('change',[{'dataset_id':'bad'},{'dataset_sha256':'x'},{'include_reading':1},{'include_reading':'false'},{'analysis_id':[]},{'chart_id':'bad'},{'extra':1}])
def test_invalid_scope_has_no_outputs(tmp_path,change):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json()
        assert c.post(prefix(doc)+'/preview',json=spec(data,**change)).status_code==422
        assert not list(app.state.store.exports.iterdir())


def test_selection_lineage_and_spss_sources_are_preserved(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (c,app,doc,_):
        imported=upload_import(c,doc).json();parent=confirm_import(c,doc,imported).json()
        child,_,_=save(c,doc,parent,column=parent['columns'][0]['name'],value=parent['preview'][0][0])
        plan=preview(c,doc,child,include_reading=False);archive=verified(c.get(plan['download_url']))
        lineage=json.loads(archive.read('data/selection/lineage.json'))
        assert lineage['steps'][0]['parent_dataset_id']==parent['id']
        root='data/selection/'+parent['id']+'/'
        assert archive.read(root+'original.sav')==(FIXTURES/'synthetic.sav').read_bytes()
        assert json.loads(archive.read(root+'data-dictionary.json'))==parent['data_dictionary']
        assert archive.read(root+'source.tsv')==c.get(parent['file_url']).content
