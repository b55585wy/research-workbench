import hashlib
import json
from pathlib import Path

from analysis_support import workspace

ROOT=Path(__file__).resolve().parents[1]


def test_actual_upstream_assets_are_pinned_with_licenses_and_no_execution_packages():
    folder=ROOT/'frontend/vendor/notebook';manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    packages={p['name']:p for p in manifest['packages']}
    assert packages['@jupyter-kit/core']['version']==packages['@jupyter-kit/theme-default']['version']=='3.0.0'
    assert packages['@jupyter-kit/core']['license']=='Apache-2.0'
    assert not any(name in ('react','react-dom') or name.startswith(('@jupyter-kit/executor-','@jupyter-kit/editor-')) for name in packages)
    assert not any(manifest[k] for k in ('editors','executors','frameworks'))
    assert manifest['rspace_reference']['kind']=='upstream_dependency_reference_only'
    for name,item in manifest['files'].items():
        data=(folder/name).read_bytes();assert len(data)==item['byte_size'] and hashlib.sha256(data).hexdigest()==item['sha256']
    assert any('LICENSE' in name or 'license' in name for name in manifest['files'])
    for name,key in (('package-lock.json','lock_sha256'),('entry.mjs','entry_sha256')):
        assert hashlib.sha256((ROOT/'scripts/notebook-assets'/name).read_bytes()).hexdigest()==manifest[key]


def test_component_and_notice_assets_served_locally_under_existing_boundary(tmp_path):
    with workspace(tmp_path) as (client,app,doc,_):
        manifest=client.get('/vendor/notebook/manifest.json');assert manifest.status_code==200
        assert client.get('/vendor/notebook/renderer.js').status_code==200
        assert client.get('/vendor/notebook/renderer.css').status_code==200
        assert client.get('/vendor/notebook/renderer.js',headers={'Host':'example.com'}).status_code==403
