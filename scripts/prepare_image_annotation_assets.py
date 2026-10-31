"""Rebuild pinned original image components or verify their local inventory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'scripts/image-annotation-assets'
OUT=ROOT/'frontend/vendor/image-annotations'


def verify():
    manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['viewer_version']=='6.1.1' and manifest['annotator_version']=='3.9.5'
    assert not manifest['application_framework'] and not manifest['executors']
    assert manifest['installation_notices'] and manifest['notice_scope']
    for name,expected in manifest['upstream_source']['files'].items():
        target=BUILD/'upstream-source'/name;assert target.resolve().is_relative_to((BUILD/'upstream-source').resolve())
        assert hashlib.sha256(target.read_bytes()).hexdigest()==expected
    for name,expected in manifest['files'].items():
        target=OUT/name;assert target.resolve().is_relative_to(OUT.resolve())
        data=target.read_bytes();assert len(data)==expected['byte_size'] and hashlib.sha256(data).hexdigest()==expected['sha256']
    for name,key in [('package-lock.json','lock_sha256'),('entry.mjs','entry_sha256')]:
        assert hashlib.sha256((BUILD/name).read_bytes()).hexdigest()==manifest[key]
    return len(manifest['files'])


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--verify',action='store_true');args=parser.parse_args()
    if not args.verify:
        subprocess.run(['npm.cmd' if os.name=='nt' else 'npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=BUILD,check=True)
        subprocess.run(['node',str(BUILD/'build.mjs')],cwd=BUILD,check=True)
    print(json.dumps({'verified_files':verify(),'viewer':'openseadragon@6.1.1','annotator':'@annotorious/openseadragon@3.9.5'}))
