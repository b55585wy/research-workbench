"""Own a fixed translation worker and its parser descendants."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from uuid import uuid4

from .analysis_process import WorkerBusy, WorkerLease


def own_process_tree():
    if os.name != 'nt':
        return None
    import ctypes
    from ctypes import wintypes as w

    class Basic(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64), ('flags', w.DWORD),
                    ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t), ('active', w.DWORD),
                    ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in
                    ('read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes')]

    class Extended(ctypes.Structure):
        _fields_ = [('basic', Basic), ('io', IO), ('process_memory', ctypes.c_size_t),
                    ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]

    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.basic.flags = 0x2000 | 0x100 | 0x200 | 0x8
    limits.basic.active = 8
    limits.process_memory = limits.job_memory = 4 * 1024**3
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if (not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits))
            or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess())):
        error = ctypes.WinError(ctypes.get_last_error()); kernel.CloseHandle(handle)
        raise error
    # Keep live until process exit: closing kills this worker and all descendants.
    return handle


class TranslationSupervisor:
    def __init__(self, service, runtime_root=None, agent_config=None):
        self.service, self.runtime_root, self.agent_config = service, runtime_root, agent_config
        self.root = service.store.root / '.translation-worker'
        self.root.mkdir(exist_ok=True)
        self.process = None
        self.ready = None
        self.log = None
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.monitor = None
        service.supervisor = self

    def recover(self, queued=False):
        try:
            with WorkerLease(self.root / '.lease'):
                self.service.recover(queued=queued)
        except WorkerBusy:
            pass

    def start(self):
        self.recover()
        self.monitor = threading.Thread(target=self.watch, name='translation-health', daemon=True)
        self.monitor.start()
        with self.service.store.connection() as db:
            queued = db.execute("SELECT 1 FROM translation_jobs WHERE status='queued' LIMIT 1").fetchone()
        if queued:
            try:
                self.ensure_started()
            except OSError:
                self.recover(queued=True)

    def watch(self):
        while not self.stop.wait(1):
            with self.lock:
                if self.process is not None and self.process.poll() is not None:
                    self.recover(queued=True)
                    self.process = None

    def ensure_started(self):
        with self.lock:
            if self.stop.is_set():
                raise OSError('Translation supervisor is stopping')
            if self.process is not None and self.process.poll() is None:
                return
            self.dispose_files()
            token = str(uuid4())
            self.ready = self.root / ('.ready-' + token + '.json')
            command = [sys.executable, '-s', '-m', 'research_workbench.translation_worker',
                       '--data', str(self.service.store.root), '--token', token]
            if self.runtime_root:
                command += ['--translation-runtime', str(self.runtime_root)]
            if self.agent_config:
                command += ['--agent-config', str(self.agent_config)]
            self.log = (self.root / '.worker.log').open('ab')
            env = {k: v for k, v in os.environ.items() if k.upper() not in ('PYTHONPATH', 'PYTHONHOME')}
            self.process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[1],
                                            stdin=subprocess.PIPE, stdout=self.log, stderr=subprocess.STDOUT,
                                            env=env, start_new_session=os.name != 'nt',
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if self.ready.is_file():
                    info = json.loads(self.ready.read_text(encoding='utf-8'))
                    # Windows venv launchers have a different PID from their Python child.
                    if (type(info.get('pid')) is int and info['pid'] > 0
                            and info.get('token') == token and self.process.poll() is None):
                        return
                if self.process.poll() is not None:
                    break
                time.sleep(.03)
            self.stop_process()
            raise OSError('Translation worker did not become ready')

    def stop_process(self):
        if self.process is None:
            return
        process = self.process
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        self.process = None

    def dispose_files(self):
        if self.log:
            self.log.close(); self.log = None
        if self.ready:
            self.ready.unlink(missing_ok=True); self.ready = None

    def close(self):
        self.stop.set()
        if self.monitor:
            self.monitor.join(timeout=2)
        with self.lock:
            self.stop_process()
            self.dispose_files()
            self.recover(queued=True)
