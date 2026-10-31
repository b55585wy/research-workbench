import threading
import time

from analysis_support import workspace,upload,payload
from research_workbench.analysis_models import AnalysisCreate


def test_list_polling_and_worker_state_commit_cannot_deadlock(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();service=app.state.analysis
        for _ in range(3):service.create(doc['id'],AnalysisCreate(**payload(data)))
        reserved=threading.Event();reading=threading.Event();committing=threading.Event();errors=[];results=[]
        original=service.record
        def scheduled_record(row):
            if not reading.is_set():
                reading.set();assert committing.wait(3);time.sleep(.05)
            return original(row)
        monkeypatch.setattr(service,'record',scheduled_record)
        def writer():
            try:
                with service.store.connection() as connection:
                    connection.execute('BEGIN IMMEDIATE');connection.execute("UPDATE analysis_jobs SET status='running' WHERE rowid=(SELECT MIN(rowid) FROM analysis_jobs)")
                    reserved.set();assert reading.wait(3);committing.set()
            except Exception as error:errors.append(error)
        def reader():
            try:
                assert reserved.wait(3);results.extend(service.list(doc['id']))
            except Exception as error:errors.append(error)
        a=threading.Thread(target=writer);b=threading.Thread(target=reader);a.start();b.start();a.join(3);b.join(3)
        finished=not a.is_alive() and not b.is_alive()
        if not finished:a.join(12);b.join(12)
        assert finished,'Task polling prevented worker state commit'
        assert not errors and len(results)==3
