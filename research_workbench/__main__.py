import argparse
from pathlib import Path

import uvicorn

from .main import create_app


def main():
    parser = argparse.ArgumentParser(description='Local papers and notes workspace')
    parser.add_argument('--port', type=int, default=3150)
    parser.add_argument('--data', type=Path)
    parser.add_argument('--agent-config', type=Path)
    parser.add_argument('--rscript', type=Path)
    parser.add_argument('--statistics-root',type=Path)
    args = parser.parse_args()
    uvicorn.run(create_app(args.data,agent_config=args.agent_config,analysis_rscript=args.rscript,statistics_root=args.statistics_root), host='127.0.0.1', port=args.port,
                proxy_headers=False, access_log=False)


if __name__ == '__main__':
    main()
