"""Build or verify pinned local Quill assets; no npm lifecycle scripts."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'scripts/rich-text-assets'
OUT=ROOT/'frontend/vendor/rich-text'


def verify():
    manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['editor_version']=='2.0.3' and manifest['editors'] and not any(manifest[k] for k in ('executors','frameworks'))
    for name,expected in manifest['files'].items():
        target=OUT/name;assert target.resolve().is_relative_to(OUT.resolve())
        data=target.read_bytes();assert len(data)==expected['byte_size'] and hashlib.sha256(data).hexdigest()==expected['sha256']
    for name,key in (('package-lock.json','lock_sha256'),('entry.mjs','entry_sha256')):
        assert hashlib.sha256((BUILD/name).read_bytes()).hexdigest()==manifest[key]
    return len(manifest['files'])


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--verify',action='store_true');args=parser.parse_args()
    if not args.verify:
        subprocess.run(['npm.cmd' if __import__('os').name=='nt' else 'npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=BUILD,check=True)
        subprocess.run(['node',str(BUILD/'build.mjs')],cwd=BUILD,check=True)
    print(json.dumps({'verified_files':verify(),'editor':'quill@2.0.3'}))
