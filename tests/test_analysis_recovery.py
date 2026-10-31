import json
from pathlib import Path
import sqlite3
import sys
import threading
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient

from analysis_support import workspace,upload,payload
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute
from research_workbench.main import create_app


def test_restart_interrupts_queued_and_claimed_tasks_without_replay(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        dataset=upload(c,doc).json();service=app.state.analysis
        a,_=service.create(doc['id'],AnalysisCreate(**payload(dataset)));service.claim()
        b,_=service.create(doc['id'],AnalysisCreate(**payload(dataset)))
    restarted=create_app(tmp_path,agent_autostart=False)
    with TestClient(restarted,base_url='http://127.0.0.1',client=('127.0.0.1',45000)) as c:
        jobs=c.get(f"/api/v1/documents/{doc['id']}/analyses").json()['items']
        assert {j['id'] for j in jobs}=={a['id'],b['id']}
        assert all(j['status']=='interrupted' and j['result'] is None for j in jobs)
        assert restarted.state.analysis.supervisor.process is None


def test_input_drift_after_queue_never_executes(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();service=app.state.analysis
        job,_=service.create(doc['id'],AnalysisCreate(**payload(data)))
        app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        execute(service,service.claim(),threading.Event())
        result=service.get(doc['id'],job['id']);assert result['status']=='failed' and result['error']['code']=='dataset_changed'
        assert not service.directory(job['id']).exists()


def test_engine_does_not_inherit_model_credentials(tmp_path,monkeypatch):
    with workspace(tmp_path/'data') as (c,app,doc,_):
        monkeypatch.setenv('OPENAI_API_KEY','SENTINEL_NOT_FOR_ENGINE')
        data=upload(c,doc).json();service=app.state.analysis;job,_=service.create(doc['id'],AnalysisCreate(**payload(data)))
        script=tmp_path/'environment.py';script.write_text('import os\nprint(os.getenv("OPENAI_API_KEY","absent"))\nraise SystemExit(7)')
        monkeypatch.setattr(service.catalog,'command',lambda *_:[getattr(sys,'_base_executable',sys.executable),'-I','-S',str(script)])
        execute(service,service.claim(),threading.Event())
        text=service.log(doc['id'],job['id'])['text'];assert 'absent' in text and 'SENTINEL_NOT_FOR_ENGINE' not in text


def test_fast_oversized_log_fails_even_if_process_exits_before_poll(tmp_path,monkeypatch):
    with workspace(tmp_path/'data') as (c,app,doc,_):
        data=upload(c,doc).json();service=app.state.analysis;job,_=service.create(doc['id'],AnalysisCreate(**payload(data)))
        script=tmp_path/'verbose.py';script.write_text('print("x"*70000)')
        monkeypatch.setattr(service.catalog,'command',lambda *_:[getattr(sys,'_base_executable',sys.executable),'-I','-S',str(script)])
        execute(service,service.claim(),threading.Event())
        result=service.get(doc['id'],job['id']);assert result['error']['code']=='analysis_log_limit' and not result['outputs']
        assert service.log(doc['id'],job['id'])['truncated']


def test_actual_normalized_artifact_size_limit_keeps_no_partial_result(tmp_path):
    header=','.join('c'+str(i) for i in range(50))+'\n';row=','.join('0.1' for _ in range(50))+'\n'
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc,(header+row*21000).encode()).json();service=app.state.analysis
        job,_=service.create(doc['id'],AnalysisCreate(**payload(data,columns=['c'+str(i) for i in range(50)])))
        execute(service,service.claim(),threading.Event())
        result=service.get(doc['id'],job['id']);assert result['status']=='failed' and result['error']['code']=='analysis_size_limit',result
        assert result['result'] is None and result['outputs']==[]
        assert set(p.name for p in service.directory(job['id']).iterdir())<= {'stdout.txt','stderr.txt'}
