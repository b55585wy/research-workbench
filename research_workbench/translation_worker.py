"""One exclusive SQLite consumer; parser/model work never runs in Web threads."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from uuid import UUID

from .agent_provider import ModelConnection
from .analysis_process import WorkerBusy, WorkerLease
from .store import Store
from .translation import Translations
from .translation_process import own_process_tree, transient_storage_error
from .translation_runtime import TranslationRuntime


def execute_job(service, row, args, stop):
    scratch_root = service.store.root / '.translation-worker/scratch'
    scratch_root.mkdir(exist_ok=True)
    owned = tempfile.TemporaryDirectory(prefix='job-', dir=scratch_root)
    scratch = Path(owned.name).resolve()
    if not scratch.is_relative_to(scratch_root.resolve()):
        raise RuntimeError('Invalid owned scratch directory')
    command = [sys.executable, '-s', '-m', 'research_workbench.translation_job',
               '--data', str(service.store.root), '--job', row['id'], '--scratch', str(scratch)]
    if args.translation_runtime:
        command += ['--translation-runtime', str(args.translation_runtime)]
    if args.agent_config:
        command += ['--agent-config', str(args.agent_config)]
    process = None
    try:
        process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[1],
                                   stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        deadline = time.monotonic() + 720
        while process.poll() is None:
            if stop.is_set() or service.status(row['id']) != 'running':
                break
            if time.monotonic() >= deadline:
                service.fail(row['id'], 'translation_timeout', '本次翻译超时，已完成的页面保留。请减少页数后重试。')
                break
            stop.wait(.1)
    finally:
        if process is not None:
            process.stdin.close()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                else:
                    process.kill()
                process.wait(timeout=5)
        # All descendants have exited before deleting this manager-owned directory.
        if not scratch.is_symlink() and scratch.resolve().is_relative_to(scratch_root.resolve()):
            owned.cleanup()
    if service.status(row['id']) == 'running':
        service.fail(row['id'], 'translation_worker_stopped', '翻译进程已停止，已完成的页面结果保留。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--token', type=UUID, required=True)
    parser.add_argument('--translation-runtime', type=Path)
    parser.add_argument('--agent-config', type=Path)
    args = parser.parse_args()
    tree = own_process_tree()
    store = Store(args.data)
    service = Translations(store, ModelConnection(store.root, args.agent_config),
                           TranslationRuntime(args.translation_runtime))
    stop = threading.Event()

    def parent_closed():
        try:
            os.read(sys.stdin.fileno(), 1)
        finally:
            stop.set()
            # A model transport may be blocked; do not outlive the owning Web process.
            time.sleep(2)
            os._exit(3)

    threading.Thread(target=parent_closed, daemon=True).start()
    root = store.root / '.translation-worker'
    ready = root / ('.ready-' + str(args.token) + '.json')
    try:
        with WorkerLease(root / '.lease'):
            service.recover()
            temporary = ready.with_suffix('.tmp')
            temporary.write_text(json.dumps({'pid': os.getpid(), 'token': str(args.token)}), encoding='utf-8')
            temporary.replace(ready)
            try:
                while not stop.is_set():
                    try:
                        row = service.claim()
                    except sqlite3.OperationalError as error:
                        # Contention is expected only around claiming, where no job row
                        # has been touched yet; retrying the claim is therefore safe.
                        if not transient_storage_error(error):
                            raise
                        stop.wait(.2)
                        continue
                    if row is not None:
                        # Execution errors must end this worker: the supervisor's
                        # recovery owns the interrupted row, never a fresh claim.
                        execute_job(service, row, args, stop)
                    else:
                        stop.wait(.2)
            finally:
                service.recover(queued=True)
                ready.unlink(missing_ok=True)
    except WorkerBusy:
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
