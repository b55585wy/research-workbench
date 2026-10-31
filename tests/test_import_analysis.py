import hashlib
import io
import json
import math
import os
from pathlib import Path
import sqlite3
import threading
from uuid import uuid4
import zipfile
import pytest

from analysis_support import workspace,run
from import_support import FIXTURES,import_runtime,upload_import,confirm
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute
from research_workbench.store import Store
from statistics_support import payload as statistics_payload


@pytest.mark.parametrize('engine',['python','r'])
def test_confirmed_data_summary_and_provenance_export(tmp_path,import_runtime,engine):
    if engine=='r' and not os.environ.get('RESEARCH_TEST_RSCRIPT'):pytest.skip('R runtime required')
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json();dataset=confirm(client,doc,imported).json()
        job=run(app.state.analysis,doc,dataset,engine,['score'])
        assert job['status']=='succeeded',job
        stat=job['result']['stats'][0]
        assert (stat['n'],stat['missing'])==(6,2)
        assert stat['mean']==pytest.approx(26/6) and stat['min']==1 and stat['max']==8
        archive=client.get(job['export_url']);assert archive.status_code==200
        with zipfile.ZipFile(io.BytesIO(archive.content)) as zipped:
            assert zipped.read('original.sav')==(FIXTURES/'synthetic.sav').read_bytes()
            assert zipped.read('source.tsv')==client.get(dataset['file_url']).content
            assert json.loads(zipped.read('data-dictionary.json'))==dataset['data_dictionary']
            provenance=json.loads(zipped.read('import-provenance.json'))
            assert provenance['source_sha256']==imported['sha256']
            manifest=json.loads(zipped.read('manifest.json'))
            for name,record in manifest['files'].items():assert hashlib.sha256(zipped.read(name)).hexdigest()==record['sha256']
        app.state.data_imports.path(doc['id'],imported['id']).write_bytes(b'changed')
        assert client.get(job['export_url']).status_code==409


def test_confirmed_data_independent_ttest_matches_known_group_counts_and_formula(tmp_path,import_runtime):
    runtime=os.environ.get('RESEARCH_TEST_STATISTICS_ROOT')
    if not runtime or not os.environ.get('RESEARCH_TEST_RSCRIPT'):pytest.skip('Explicit R stats runtime required')
    with workspace(tmp_path,import_root=import_runtime,statistics_root=runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json();dataset=confirm(client,doc,imported).json()
        options={'group_column':'group','groups':['1','2'],'variant':'welch','alternative':'two_sided',
                 'confidence':.95,'missing':'complete_cases','independent_samples_confirmed':True}
        request=statistics_payload(client,dataset,columns=['score'],ttest=options)
        preview=client.post(f"/api/v1/documents/{doc['id']}/analyses/ttest/preview",json=request)
        assert preview.status_code==200,preview.text
        job,_=app.state.analysis.create(doc['id'],AnalysisCreate(**request))
        execute(app.state.analysis,app.state.analysis.claim(),threading.Event())
        saved=app.state.analysis.get(doc['id'],job['id']);assert saved['status']=='succeeded',saved
        result=saved['result']
        assert result['counts']=={'total':8,'used':5,'excluded':3,'missing_outcome_only':1,'missing_group_only':1,'missing_both':1}
        assert [item['n'] for item in result['stats']]==[2,3]
        expected_t=(1.5-5)/math.sqrt(.5/2+1/3)
        expected_df=(.5/2+1/3)**2/((.5/2)**2+(1/3)**2/2)
        assert result['test']['statistic']==pytest.approx(expected_t)
        assert result['test']['df']==pytest.approx(expected_df)


def test_agent_dictionary_is_bounded_and_preserves_confirmed_semantics(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json();dataset=confirm(client,doc,imported).json()
        value=app.state.datasets.for_agent(dataset)
        assert 'data_dictionary' not in value
        assert len(json.dumps(value['data_dictionary_summary'],ensure_ascii=True).encode())<=16384
        score=next(item for item in value['data_dictionary_summary'] if item['name']=='score')
        assert score['user_missing']==1 and score['system_missing']==1
        assert value['import_provenance']['review_sha256']==imported['review_sha256']
        huge=json.loads(json.dumps(dataset))
        for column in huge['data_dictionary']:column['label']='中'*1600;column['value_labels']=[{'value':i,'label':'中'*1000} for i in range(50)]
        bounded=app.state.datasets.for_agent(huge)
        assert bounded['data_dictionary_truncated'] is True
        assert len(json.dumps(bounded['data_dictionary_summary'],ensure_ascii=True).encode())<=16384


def test_schema9_upgrade_preserves_every_old_table(tmp_path):
    root=tmp_path/'workspace';root.mkdir();database=root/'workspace.sqlite3'
    with sqlite3.connect(database) as db:
        db.executescript((Path(__file__).parent/'fixtures/schema-v9.sql').read_text(encoding='utf-8'))
        doc=str(uuid4());note=str(uuid4())
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(doc,'synthetic','synthetic.pdf',1,10,'a'*64,'2026-01-01'))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,doc,1,None,'synthetic note','2026-01-01'))
        tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        before={name:db.execute(f'SELECT * FROM {name} ORDER BY 1').fetchall() for name in tables}
    assert len(tables)==21
    store=Store(root)
    with store.connection() as db:
        after={name:[tuple(row) for row in db.execute(f'SELECT * FROM {name} ORDER BY 1')] for name in tables}
        assert before==after and db.execute('PRAGMA user_version').fetchone()[0]==11
        assert db.execute('SELECT COUNT(*) FROM data_imports').fetchone()[0]==0
