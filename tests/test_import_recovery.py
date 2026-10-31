from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import threading
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient

from agent_support import ScriptedModel,answer,tool,submit,wait_turn
from analysis_support import workspace,upload,payload
from import_support import FIXTURES,import_runtime,upload_import,confirm,probe
from research_workbench.main import create_app


def test_concurrent_upload_replays_once_and_pending_never_becomes_a_dataset(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        identifier=str(uuid4())
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:upload_import(client,doc,identifier=identifier),range(2)))
        assert sorted(response.status_code for response in responses)==[200,201]
        assert responses[0].json()==responses[1].json()
        assert len(app.state.data_imports.list(doc['id']))==1 and not app.state.datasets.list(doc['id'])
        assert len(list(app.state.data_imports.root.iterdir()))==2


def test_restart_pending_confirm_and_repeated_confirm_are_persistent(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,_,doc,_):imported=upload_import(client,doc).json()
    for expected in (201,200):
        app=create_app(tmp_path,agent_provider=ScriptedModel(),agent_autostart=False,analysis_autostart=False,import_root=import_runtime)
        with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as client:
            current=client.get(f"/api/v1/documents/{doc['id']}/data-imports/{imported['id']}").json()
            assert current['status']==('pending' if expected==201 else 'confirmed')
            result=confirm(client,doc,imported);assert result.status_code==expected,result.text
            assert len(app.state.datasets.list(doc['id']))==1


def test_pending_review_can_be_confirmed_without_reloading_native_reader(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json();app.state.data_imports.runtime.python=None
        assert client.get('/api/v1/data-imports/status').json()['available'] is False
        assert confirm(client,doc,imported).status_code==201


def test_import_count_and_dataset_quota_preserve_pending_state(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        for _ in range(20):assert upload_import(client,doc).status_code==201
        assert upload_import(client,doc).status_code==409
        imported=app.state.data_imports.list(doc['id'])[0]
        for _ in range(20):assert upload(client,doc).status_code==201
        assert confirm(client,doc,imported).status_code==409
        assert app.state.data_imports.get(doc['id'],imported['id'])['status']=='pending'
        assert len(app.state.datasets.list(doc['id']))==20 and len(list(app.state.datasets.root.iterdir()))==20


def test_native_memory_limit_and_timeout_release_parser_capacity(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        from research_workbench import import_limits
        original=app.state.data_imports.probe
        probe=tmp_path/'memory.py'
        probe.write_text(f"import runpy\njob=runpy.run_path({import_limits.__file__!r})['limit_memory']()\nvalue=bytearray(1024*1024*1024)\n")
        app.state.data_imports.probe=probe
        response=upload_import(client,doc);assert response.status_code==422 and response.json()['detail']['code']=='parser_failed'
        assert client.get('/api/v1/health').status_code==200
        app.state.data_imports.probe=original
        assert upload_import(client,doc).status_code==201


@pytest.mark.parametrize('changed',['original','table','dictionary'])
def test_source_chain_drift_prevents_new_analysis_and_repeat_confirmation(tmp_path,import_runtime,changed):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json();dataset=confirm(client,doc,imported).json()
        if changed=='dictionary':
            with app.state.store.connection() as db:
                row=db.execute('SELECT profile_json FROM datasets WHERE id=?',(dataset['id'],)).fetchone()
                profile=json.loads(row[0]);profile['data_dictionary'][0]['label']='changed'
                db.execute('UPDATE datasets SET profile_json=? WHERE id=?',(json.dumps(profile),dataset['id']))
        elif changed=='original':next(app.state.data_imports.root.glob('*.source')).write_bytes(b'changed')
        else:app.state.datasets.path(doc['id'],dataset['id']).write_bytes(b'changed')
        result=client.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(dataset,columns=['score']))
        assert result.status_code==409 and app.state.analysis.list(doc['id'])==[]
        assert confirm(client,doc,imported).status_code==409


def test_imported_metadata_only_reaches_agent_after_explicit_sharing(tmp_path,import_runtime):
    model=ScriptedModel()
    with workspace(tmp_path,model,agent=True,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json();dataset=confirm(client,doc,imported).json()
        turn=submit(client,doc,'What data is shared?',context={'page':1,'language':'en','image_ids':[]})
        saved=wait_turn(client,doc,turn.json()['id'])
        assert saved['context']['dataset'] is None
        assert '实验分组' not in json.dumps(model.calls,ensure_ascii=False)
        model.responses=[tool('read_dataset',{'dataset_id':dataset['id']}),answer('Reviewed data read.')]
        turn=submit(client,doc,'Read the selected data.',context={'page':1,'language':'en','image_ids':[],'dataset_id':dataset['id']})
        saved=wait_turn(client,doc,turn.json()['id'])
        assert saved['status']=='completed',saved
        assert 'data_dictionary' not in saved['context']['dataset']
        assert saved['context']['dataset']['data_dictionary_summary']
        assert '实验分组' in json.dumps(model.calls,ensure_ascii=False)
        assert app.state.analysis.list(doc['id'])==[]


def test_actual_parser_concurrency_rejects_third_request_without_artifacts(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        original=app.state.data_imports.probe
        wrapper=tmp_path/'slow_reader.py'
        wrapper.write_text(f"import time,runpy\ntime.sleep(1)\nrunpy.run_path({str(original)!r},run_name='__main__')\n")
        app.state.data_imports.probe=wrapper
        barrier=threading.Barrier(3)
        def send(_):
            barrier.wait()
            return upload_import(client,doc)
        with ThreadPoolExecutor(max_workers=3) as pool:responses=list(pool.map(send,range(3)))
        assert sorted(response.status_code for response in responses)==[201,201,429]
        assert len(app.state.data_imports.list(doc['id']))==2
        assert len(list(app.state.data_imports.root.iterdir()))==4
        assert list(app.state.store.incoming.iterdir())==[]


def test_actual_import_storage_exact_limit_and_overflow(tmp_path,import_runtime):
    done,value,_=probe(import_runtime,tmp_path,'synthetic.sav')
    assert done.returncode==0
    normalized=value['normalized_size'];maximum=5*1024*1024
    source=(FIXTURES/'synthetic.sav').read_bytes()
    exact=source+b'\0'*(maximum-normalized-len(source))
    excess=source+b'\0'*(maximum-len(source))
    with workspace(tmp_path/'workspace',import_root=import_runtime) as (client,app,doc,_):
        for _ in range(19):assert upload_import(client,doc,exact).status_code==201
        response=upload_import(client,doc,excess)
        assert response.status_code==409 and response.json()['detail']['code']=='import_quota'
        assert len(app.state.data_imports.list(doc['id']))==19
        assert upload_import(client,doc,exact).status_code==201
        with app.state.store.connection() as db:
            assert db.execute('SELECT SUM(byte_size+normalized_size) FROM data_imports').fetchone()[0]==100*1024*1024
