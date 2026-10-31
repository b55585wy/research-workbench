import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from uuid import uuid4
import pytest

from analysis_support import workspace,upload,payload
from research_workbench.analysis_process import WorkerBusy,WorkerLease


def test_worker_lease_is_exclusive_and_reusable(tmp_path):
    with WorkerLease(tmp_path/'worker.lock'):
        with pytest.raises(WorkerBusy):
            with WorkerLease(tmp_path/'worker.lock'):pass
    with WorkerLease(tmp_path/'worker.lock'):pass


def test_worker_launch_permission_failure_is_terminal_not_false_success(tmp_path,monkeypatch):
    with workspace(tmp_path,worker=True) as (c,app,doc,_):
        def denied():raise PermissionError('private executable path')
        monkeypatch.setattr(app.state.analysis.supervisor,'ensure_started',denied)
        data=upload(c,doc).json();response=c.post(f"/api/v1/documents/{doc['id']}/analyses",json=payload(data))
        assert response.status_code==201,response.text
        job=response.json();assert job['status']=='failed' and job['result'] is None and not job['export_url']
        assert job['error']['code']=='worker_unavailable' and 'private executable' not in response.text


@pytest.mark.skipif(os.name!='nt',reason='Physical Windows job-object containment')
def test_hard_worker_death_reaps_its_actual_engine_process(tmp_path):
    record=tmp_path/'owned.json';script=tmp_path/'owned_worker.py'
    source_root=Path(__file__).resolve().parents[1]
    script.write_text('import sys,os,json,time,subprocess\nfrom pathlib import Path\nsys.path.insert(0,'+repr(str(source_root))+')\nfrom research_workbench.analysis_process import own_process_tree\nh=own_process_tree()\np=subprocess.Popen(['+repr(getattr(sys,'_base_executable',sys.executable))+',"-I","-S","-c","import time;time.sleep(30)",sys.argv[1]],creationflags=subprocess.CREATE_NO_WINDOW)\nPath(sys.argv[1]).write_text(json.dumps({"worker":os.getpid(),"engine":p.pid}))\ntime.sleep(30)\n',encoding='utf-8')
    process=subprocess.Popen([sys.executable,str(script),str(record)],creationflags=subprocess.CREATE_NO_WINDOW)
    ids=None
    try:
        deadline=time.monotonic()+5
        while not record.exists() and time.monotonic()<deadline:threading.Event().wait(.02)
        assert record.exists();ids=json.loads(record.read_text())
        command=f"$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = {ids['worker']}'; if($null -eq $p -or -not $p.CommandLine.Contains('{script}')){{throw 'Worker ownership mismatch'}}; Stop-Process -Id {ids['worker']} -ErrorAction Stop"
        subprocess.run(['powershell.exe','-NoProfile','-Command',command],check=True,capture_output=True)
        process.wait(timeout=5)
        check=subprocess.run(['powershell.exe','-NoProfile','-Command',f"@(Get-Process -Id {ids['engine']} -ErrorAction SilentlyContinue).Count"],capture_output=True,text=True,check=True)
        assert check.stdout.strip()=='0','Engine survived owned worker death'
    finally:
        if ids:
            for key in ('engine','worker'):
                signature=str(record if key=='engine' else script)
                command=f"$p=Get-CimInstance Win32_Process -Filter 'ProcessId = {ids[key]}'; if($null -ne $p){{if(-not $p.CommandLine.Contains('{signature}')){{throw 'Cleanup ownership mismatch'}};Stop-Process -Id {ids[key]} -ErrorAction Stop}}"
                subprocess.run(['powershell.exe','-NoProfile','-Command',command],check=True,capture_output=True)
        if process.poll() is None:process.wait(timeout=5)
