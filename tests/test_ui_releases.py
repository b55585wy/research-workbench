import json
import zipfile

import pytest

from research_workbench.ui_publish import pack, install, activate
from research_workbench.ui_releases import ReleaseError, backend_fingerprint, digest
from ui_release_support import project_fixture, publish_fixture


def offline_fixture(tmp_path):
    project = project_fixture(tmp_path)
    frontend = project / 'frontend'
    additions = {
        'offline-worker.js': '// Root offline worker\n',
        'offline-client.js': 'export const state = "idle";\n',
        'vendor/module.mjs': 'export const m = 1;\n',
        'vendor/skin.css': 'body{}\n',
        'assets/runtime.json': '{"ready":true}',
        'assets/example.pdf': '%PDF-1.4 sample',
        'vendor/pdfjs/cmaps/H.bcmap': 'cmap',
        'vendor/pdfjs/wasm/jbig2.wasm': '\0asm',
        'vendor/fonts/reader.woff2': 'wOF2',
        'notes.md': '# note',
        'README.txt': 'read me',
        'LICENSE': 'legal',
        'vendor/third-party/LICENSES.txt': 'legal',
    }
    for name, body in additions.items():
        path = frontend / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body.encode('utf-8'))
    return project


def test_pack_pins_assets_without_changing_api_navigation_or_worker(tmp_path):
    project = project_fixture(tmp_path)
    releases, manifest = publish_fixture(project, tmp_path, 'first')
    frontend = releases / manifest['release'] / 'frontend'
    prefix = '/_ui/' + manifest['release']
    assert 'src="' + prefix + '/app.js"' in (frontend / 'index.html').read_text()
    assert '"' + prefix + '/lazy.js"' in (frontend / 'app.js').read_text()
    assert 'url(' + prefix + '/vendor/icon.svg)' in (frontend / 'styles.css').read_text()
    assert '"/api/v1/documents"' in (frontend / 'app.js').read_text()
    assert '"/device-sw.js"' in (frontend / 'app.js').read_text()
    assert 'href="/device/"' in (frontend / 'storage-choice.html').read_text()
    assert 'href="/recover.html"' in (frontend / 'storage-choice.html').read_text()


def test_repeat_install_and_atomic_rollback_keep_old_release(tmp_path):
    project = project_fixture(tmp_path)
    releases, first = publish_fixture(project, tmp_path, 'first')
    install(project, releases, tmp_path / 'first.zip')
    (project / 'frontend/lazy.js').write_text('export const version="second";')
    _, second = publish_fixture(project, tmp_path, 'second')
    pointer = json.loads((releases / 'current.json').read_text())
    assert pointer == {'release': second['release'], 'previous': first['release']}
    assert (releases / first['release'] / 'frontend/lazy.js').read_text().endswith('"first";')
    activate(project, releases, first['release'])
    assert json.loads((releases / 'current.json').read_text())['release'] == first['release']


@pytest.mark.parametrize('changed', ['research_workbench/api.py', 'requirements.txt', 'frontend/device-db.js'])
def test_backend_or_device_changes_reject_activation_and_preserve_pointer(tmp_path, changed):
    project = project_fixture(tmp_path)
    releases, first = publish_fixture(project, tmp_path, 'first')
    before = (releases / 'current.json').read_bytes()
    target = project / changed
    target.write_text(target.read_text() + '\nchanged\n')
    with pytest.raises(ReleaseError):
        activate(project, releases, first['release'])
    assert (releases / 'current.json').read_bytes() == before


def test_version_label_alone_does_not_claim_backend_change(tmp_path):
    project = project_fixture(tmp_path)
    before = backend_fingerprint(project)
    (project / 'research_workbench/__init__.py').write_text("__version__ = 'next'\n")
    assert backend_fingerprint(project) == before


def test_corrupt_release_is_not_selected(tmp_path):
    project = project_fixture(tmp_path)
    releases, first = publish_fixture(project, tmp_path, 'first')
    (project / 'frontend/lazy.js').write_text('second')
    second = pack(project, tmp_path / 'second.zip')
    install(project, releases, tmp_path / 'second.zip')
    (releases / second['release'] / 'frontend/lazy.js').write_text('damaged')
    with pytest.raises(ReleaseError):
        activate(project, releases, second['release'])
    assert json.loads((releases / 'current.json').read_text())['release'] == first['release']


@pytest.mark.parametrize('name', ['../outside', 'frontend/../../outside', '/absolute', 'frontend\\outside', 'C:/outside'])
def test_unsafe_archive_does_not_change_active_release(tmp_path, name):
    project = project_fixture(tmp_path)
    releases, first = publish_fixture(project, tmp_path, 'first')
    with zipfile.ZipFile(tmp_path / 'bad.zip', 'w') as archive:
        with zipfile.ZipFile(tmp_path / 'first.zip') as valid:
            archive.writestr('RELEASE.json', valid.read('RELEASE.json'))
        archive.writestr(name, b'bad')
    with pytest.raises(ReleaseError):
        install(project, releases, tmp_path / 'bad.zip')
    assert json.loads((releases / 'current.json').read_text())['release'] == first['release']
    assert not list(releases.glob('.install-*'))


def test_permission_failure_preserves_pointer(tmp_path, monkeypatch):
    project = project_fixture(tmp_path)
    releases, first = publish_fixture(project, tmp_path, 'first')
    before = (releases / 'current.json').read_bytes()

    def denied(*args):
        raise PermissionError('simulated denied pointer switch')

    monkeypatch.setattr('research_workbench.ui_publish.os.replace', denied)
    with pytest.raises(PermissionError):
        activate(project, releases, first['release'])
    assert (releases / 'current.json').read_bytes() == before
    assert not list(releases.glob('.current-*'))


def test_offline_manifest_hashes_only_immutable_runtime_payloads(tmp_path):
    project = offline_fixture(tmp_path)
    releases, manifest = publish_fixture(project, tmp_path, 'first')
    frontend = releases / manifest['release'] / 'frontend'
    prefix = '/_ui/' + manifest['release']
    offline = json.loads((frontend / 'offline-manifest.json').read_text(encoding='utf-8'))
    assets = [entry['url'][len(prefix) + 1:] for entry in offline['assets']]

    assert offline['format'] == 'research-workspace-offline-v1'
    assert offline['release'] == manifest['release']
    assert [entry['url'] for entry in offline['assets']] == sorted(entry['url'] for entry in offline['assets'])
    assert assets == sorted(assets)
    assert 'offline-manifest.json' in manifest['files']
    assert 'offline-manifest.json' not in assets
    assert all(url.startswith(prefix + '/') for url in (entry['url'] for entry in offline['assets']))

    for name in ('app.js', 'lazy.js', 'styles.css', 'offline-client.js', 'offline-worker.js', 'vendor/module.mjs',
                 'vendor/skin.css', 'assets/runtime.json', 'assets/example.pdf', 'vendor/pdfjs/cmaps/H.bcmap',
                 'vendor/pdfjs/wasm/jbig2.wasm', 'vendor/fonts/reader.woff2'):
        assert name in assets
    for name in ('index.html', 'storage-choice.html', 'recover.html', 'device-sw.js', 'notes.md', 'README.txt',
                 'LICENSE', 'vendor/third-party/LICENSES.txt'):
        assert name not in assets

    for entry, name in zip(offline['assets'], assets):
        body = (frontend / name).read_bytes()
        assert entry['bytes'] == len(body) == manifest['files'][name]['bytes']
        assert entry['sha256'] == digest(body) == manifest['files'][name]['sha256']


def test_offline_manifest_embeds_transformed_device_and_choice_html(tmp_path):
    project = offline_fixture(tmp_path)
    releases, manifest = publish_fixture(project, tmp_path, 'first')
    frontend = releases / manifest['release'] / 'frontend'
    prefix = '/_ui/' + manifest['release']
    offline = json.loads((frontend / 'offline-manifest.json').read_text(encoding='utf-8'))
    device, choice = offline['entries']['device'], offline['entries']['choice']
    index = (frontend / 'index.html').read_text(encoding='utf-8')

    assert device['url'] == '/device/' and choice['url'] == '/'
    assert device['html'] == index.replace('<html ', '<html data-storage-mode="device" ', 1)
    assert 'data-storage-mode="device"' in device['html']
    assert 'src="' + prefix + '/app.js"' in device['html']
    assert 'src="/app.js"' not in device['html']
    assert choice['html'] == (frontend / 'storage-choice.html').read_text(encoding='utf-8')
    assert 'href="/device/"' in choice['html']


def test_offline_manifest_is_deterministic_and_optional(tmp_path):
    project = offline_fixture(tmp_path)
    first = pack(project, tmp_path / 'first.zip')
    second = pack(project, tmp_path / 'second.zip')
    assert first == second
    with zipfile.ZipFile(tmp_path / 'first.zip') as left, zipfile.ZipFile(tmp_path / 'second.zip') as right:
        assert left.read('frontend/offline-manifest.json') == right.read('frontend/offline-manifest.json')

    toy = project_fixture(tmp_path / 'toy')
    _, manifest = publish_fixture(toy, tmp_path / 'toy-out', 'toy')
    assert 'offline-manifest.json' not in manifest['files']
