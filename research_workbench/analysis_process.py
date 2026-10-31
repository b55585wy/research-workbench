"""Ownership of a fixed analysis worker, never the tFUS job runner."""
import os
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
from uuid import uuid4

from .analysis_recipes import clean_environment


class WorkerBusy(Exception):pass


class WorkerLease:
    def __init__(self,path):self.path=Path(path);self.stream=None
    def __enter__(self):
        self.stream=self.path.open('a+b')
        if self.path.stat().st_size==0:self.stream.write(b'0');self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.stream.close();raise WorkerBusy() from None
        return self
    def __exit__(self,*args):self.stream.close()


def own_process_tree():
    """Assign self before any engine is spawned; OS closes job on worker death."""
    if os.name!='nt':return None
    import ctypes
    from ctypes import wintypes as w
    class Basic(ctypes.Structure):
        _fields_=[('process_time',ctypes.c_int64),('job_time',ctypes.c_int64),('flags',w.DWORD),
            ('min_ws',ctypes.c_size_t),('max_ws',ctypes.c_size_t),('active',w.DWORD),
            ('affinity',ctypes.c_size_t),('priority',w.DWORD),('scheduling',w.DWORD)]
    class IO(ctypes.Structure):
        _fields_=[(name,ctypes.c_uint64) for name in ('read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes')]
    class Extended(ctypes.Structure):
        _fields_=[('basic',Basic),('io',IO),('process_memory',ctypes.c_size_t),('job_memory',ctypes.c_size_t),
                  ('peak_process',ctypes.c_size_t),('peak_job',ctypes.c_size_t)]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,w.LPCWSTR];kernel.CreateJobObjectW.restype=w.HANDLE
    kernel.SetInformationJobObject.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD]
    kernel.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE]
    kernel.GetCurrentProcess.restype=w.HANDLE
    handle=kernel.CreateJobObjectW(None,None)
    limits=Extended();limits.basic.flags=0x2000|0x100|0x8
    limits.basic.active=4;limits.process_memory=256*1024*1024
    if not handle or not kernel.SetInformationJobObject(handle,9,ctypes.byref(limits),ctypes.sizeof(limits)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not kernel.AssignProcessToJobObject(handle,kernel.GetCurrentProcess()):raise ctypes.WinError(ctypes.get_last_error())
    # Keep the handle live for the worker's lifetime; closing it kills descendants.
    return handle


class AnalysisSupervisor:
    def __init__(self,service):
        self.service=service;self.process=None;self.log=None;self.lock=threading.Lock()
        self.ready=None;self.failed=False
        service.supervisor=self

    def recover(self):
        try:
            with WorkerLease(self.service.root/'.worker.lock'):self.service.recover()
        except WorkerBusy:pass

    def ensure_started(self):
        with self.lock:
            if self.process is not None and self.process.poll() is None:return
            if self.log:self.log.close()
            if self.ready:self.ready.unlink(missing_ok=True)
            token=str(uuid4());self.ready=self.service.root/('.ready-'+token+'.json')
            command=[sys.executable,'-s','-m','research_workbench.analysis_worker','--data',str(self.service.store.root)]
            command+=['--token',token]
            if self.service.catalog.rscript:command+=['--rscript',str(self.service.catalog.rscript)]
            if self.service.catalog.statistics.root:command+=['--statistics-root',str(self.service.catalog.statistics.root)]
            self.log=(self.service.root/'.worker.log').open('ab')
            self.process=subprocess.Popen(command,cwd=Path(__file__).resolve().parents[1],
                stdin=subprocess.PIPE,stdout=self.log,stderr=subprocess.STDOUT,
                env=clean_environment(self.service.root),creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            deadline=time.monotonic()+4
            while time.monotonic()<deadline:
                if self.ready.exists():self.failed=False;return
                if self.process.poll() is not None:break
                time.sleep(.02)
            self.failed=True
            if self.process.stdin and not self.process.stdin.closed:self.process.stdin.close()
            raise OSError('Owned worker did not become ready')

    def check(self):
        if self.process is not None and self.process.poll() is not None:
            self.failed=True;self.recover()

    def close(self):
        with self.lock:
            if self.process is not None:
                if self.process.stdin and not self.process.stdin.closed:self.process.stdin.close()
                try:self.process.wait(timeout=4)
                except subprocess.TimeoutExpired:self.process.terminate();self.process.wait(timeout=5)
                self.process=None
            if self.log:self.log.close();self.log=None
            if self.ready:self.ready.unlink(missing_ok=True);self.ready=None
            self.recover()

    def state(self):
        self.check()
        if self.failed:return 'unavailable'
        return 'running' if self.process is not None and self.process.poll() is None else 'idle'
