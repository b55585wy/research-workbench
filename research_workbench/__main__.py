import argparse
import os
from pathlib import Path

import uvicorn

from .main import create_app


def main():
    parser = argparse.ArgumentParser(description='Local papers and notes workspace')
    parser.add_argument('--port', type=int)
    parser.add_argument('--data', type=Path)
    parser.add_argument('--agent-config', type=Path)
    parser.add_argument('--rscript', type=Path)
    parser.add_argument('--statistics-root',type=Path)
    parser.add_argument('--import-root',type=Path)
    parser.add_argument('--translation-runtime', type=Path)
    # Opt-in public guest mode.  Omitted entirely, the owner server below keeps
    # its original single-Store invocation and semantics.
    parser.add_argument('--guest-root', type=Path)
    parser.add_argument('--guest-max-spaces', type=int, default=32)
    parser.add_argument('--guest-max-active', type=int, default=2)
    args = parser.parse_args()

    if args.guest_root is not None:
        if args.data is not None or args.agent_config is not None:
            parser.error('--guest-root 不能与 --data 或 --agent-config 同时使用')
        if not 1 <= args.guest_max_spaces <= 32:
            parser.error('--guest-max-spaces 必须在 1 到 32 之间')
        if not 1 <= args.guest_max_active <= 2:
            parser.error('--guest-max-active 必须在 1 到 2 之间')
        # Guest data and registry files stay owner-only where the platform
        # supports it; this process is separate from the owner server.
        try:
            os.umask(0o077)
        except OSError:
            pass
        from .guest_gateway import create_guest_gateway
        app = create_guest_gateway(
            args.guest_root, max_spaces=args.guest_max_spaces,
            max_active=args.guest_max_active, analysis_rscript=args.rscript,
            statistics_root=args.statistics_root, import_root=args.import_root,
            translation_runtime=args.translation_runtime)
        port = args.port if args.port is not None else 3151
    else:
        app = create_app(args.data,agent_config=args.agent_config,analysis_rscript=args.rscript,statistics_root=args.statistics_root,import_root=args.import_root,translation_runtime=args.translation_runtime)
        port = args.port if args.port is not None else 3150
    uvicorn.run(app, host='127.0.0.1', port=port,
                proxy_headers=False, access_log=False)


if __name__ == '__main__':
    main()
