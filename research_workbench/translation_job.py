"""One disposable translation execution: cancellation can stop blocked model IO."""
import argparse
import os
from pathlib import Path
import sys
import threading
import time
from uuid import UUID

from .agent_provider import ModelConnection
from .store import Store
from .translation import Translations
from .translation_process import own_process_tree
from .translation_runtime import TranslationRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--job', type=UUID, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--translation-runtime', type=Path)
    parser.add_argument('--agent-config', type=Path)
    args = parser.parse_args()
    tree = own_process_tree()
    stop = threading.Event()

    def parent_closed():
        try:
            os.read(sys.stdin.fileno(), 1)
        finally:
            stop.set()
            time.sleep(2)
            os._exit(3)

    threading.Thread(target=parent_closed, daemon=True).start()
    store = Store(args.data)
    scratch = args.scratch.resolve()
    if not scratch.is_relative_to((store.root / '.translation-worker/scratch').resolve()):
        return 3
    service = Translations(store, ModelConnection(store.root, args.agent_config),
                           TranslationRuntime(args.translation_runtime, scratch))
    with store.connection() as db:
        row = db.execute("SELECT * FROM translation_jobs WHERE id=? AND status='running'",
                         (str(args.job),)).fetchone()
    if row is not None:
        service.run_job(dict(row), stop)
    return 0


if __name__ == '__main__':
    sys.exit(main())
