from contextlib import asynccontextmanager
import json
import shutil
from threading import Event

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from research_workbench import ui_releases
from research_workbench.device_pages import FrontendFiles, install_device_pages
from research_workbench.ui_publish import activate
from research_workbench.ui_releases import ReleaseError
from ui_release_support import project_fixture, publish_fixture


def offline_project(tmp_path):
    project = project_fixture(tmp_path)
    frontend = project / 'frontend'
    for name, body in {
        'offline-worker.js': '// Root offline worker\n',
        'offline-client.js': 'export const state = "idle";\n',
        'vendor/pdfjs/cmaps/H.bcmap': 'cmap',
    }.items():
        path = frontend / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
    return project


def test_switch_does_not_restart_backend_or_drop_inflight_request(tmp_path, monkeypatch):
    project = project_fixture(tmp_path)
    releases, first = publish_fixture(project, tmp_path, 'first')
    monkeypatch.setenv('RESEARCH_WORKBENCH_UI_RELEASES', str(releases))
    lifecycle, requests = [], []
    started, finish = Event(), Event()

    @asynccontextmanager
    async def lifespan(app):
        lifecycle.append('started')
        yield
        lifecycle.append('stopped')

    app = FastAPI(lifespan=lifespan)

    @app.post('/api/save')
    def save():
        started.set()
        assert finish.wait(10)
        requests.append('saved')
        return {'saved': True}

    install_device_pages(app, project / 'frontend')
    app.mount('/', FrontendFiles(directory=project / 'frontend', html=True))
    with TestClient(app) as client:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pending = pool.submit(client.post, '/api/save')
            assert started.wait(5)
            (project / 'frontend/lazy.js').write_text('export const version="second";')
            _, second = publish_fixture(project, tmp_path, 'second')
            assert client.get('/').headers['X-Workspace-UI-Release'] == second['release']
            old = client.get('/_ui/' + first['release'] + '/lazy.js')
            new = client.get('/_ui/' + second['release'] + '/lazy.js')
            assert '"first"' in old.text and '"second"' in new.text
            assert 'immutable' in old.headers['Cache-Control']
            assert lifecycle == ['started']
            finish.set()
            assert pending.result().json() == {'saved': True}
        assert requests == ['saved']
        assert client.get('/device/').headers['X-Workspace-UI-Release'] == second['release']
        assert 'data-storage-mode="device"' in client.get('/device/').text
        assert client.get('/device/files/missing').status_code == 404
        assert client.get('/device-sw.js').status_code == 200
        assert client.get('/_ui/' + first['release'] + '/device-db.js').status_code == 200
        assert client.get('/_ui/' + first['release'] + '/index.html').status_code == 404
        assert client.get('/_ui/ui-missing/app.js').status_code == 404
    assert lifecycle == ['started', 'stopped']


def test_bad_pointer_fails_entry_without_breaking_api_or_existing_assets(tmp_path, monkeypatch):
    project = project_fixture(tmp_path)
    releases, first = publish_fixture(project, tmp_path, 'first')
    monkeypatch.setenv('RESEARCH_WORKBENCH_UI_RELEASES', str(releases))
    app = FastAPI()

    @app.get('/api/health')
    def health():
        return {'status': 'ok'}

    install_device_pages(app, project / 'frontend')
    app.mount('/', FrontendFiles(directory=project / 'frontend', html=True))
    with TestClient(app) as client:
        (releases / 'current.json').write_text('[]')
        response = client.get('/device/')
        assert response.status_code == 503 and response.headers['Retry-After'] == '3'
        assert client.get('/api/health').json() == {'status': 'ok'}
        assert client.get('/_ui/' + first['release'] + '/lazy.js').status_code == 200


def test_unconfigured_local_mode_keeps_original_assets(tmp_path, monkeypatch):
    project = project_fixture(tmp_path)
    monkeypatch.delenv('RESEARCH_WORKBENCH_UI_RELEASES', raising=False)
    app = FastAPI()
    install_device_pages(app, project / 'frontend')
    app.mount('/', FrontendFiles(directory=project / 'frontend', html=True))
    with TestClient(app) as client:
        assert 'src="/app.js"' in client.get('/').text
        assert client.get('/app.js').headers['Cache-Control'] == 'no-cache'
        assert 'data-storage-mode="device"' in client.get('/device/').text


def test_offline_worker_root_header_is_limited_to_the_exact_versioned_worker(tmp_path, monkeypatch):
    project = offline_project(tmp_path)
    releases, manifest = publish_fixture(project, tmp_path, 'first')
    monkeypatch.setenv('RESEARCH_WORKBENCH_UI_RELEASES', str(releases))
    prefix = '/_ui/' + manifest['release']
    app = FastAPI()
    install_device_pages(app, project / 'frontend')
    app.mount('/', FrontendFiles(directory=project / 'frontend', html=True))
    with TestClient(app) as client:
        worker = client.get(prefix + '/offline-worker.js')
        assert worker.status_code == 200
        assert worker.headers['Service-Worker-Allowed'] == '/'
        assert worker.headers['X-Workspace-UI-Release'] == manifest['release']

        root = client.get('/offline-worker.js')
        assert root.status_code == 200
        assert 'Service-Worker-Allowed' not in root.headers

        for path in ('/app.js', '/offline-client.js', '/styles.css', '/vendor/pdfjs/cmaps/H.bcmap'):
            response = client.get(prefix + path)
            assert response.status_code == 200
            assert 'Service-Worker-Allowed' not in response.headers

        offline = client.get(prefix + '/offline-manifest.json')
        assert offline.status_code == 200
        assert 'Service-Worker-Allowed' not in offline.headers
        offline = offline.json()
        assert offline['release'] == manifest['release']
        assert offline['entries']['device']['html'] == client.get('/device/').text
        assert offline['entries']['choice']['html'] == client.get('/storage').text
        assert any(entry['url'] == prefix + '/offline-worker.js' for entry in offline['assets'])

        assert client.get(prefix + '/device-sw.js').status_code == 404
        assert client.get(prefix + '/index.html').status_code == 404
        assert 'Service-Worker-Allowed' not in client.get(prefix + '/index.html').headers


def test_release_without_offline_worker_keeps_existing_delivery(tmp_path, monkeypatch):
    project = project_fixture(tmp_path)
    releases, manifest = publish_fixture(project, tmp_path, 'first')
    monkeypatch.setenv('RESEARCH_WORKBENCH_UI_RELEASES', str(releases))
    prefix = '/_ui/' + manifest['release']
    app = FastAPI()
    install_device_pages(app, project / 'frontend')
    app.mount('/', FrontendFiles(directory=project / 'frontend', html=True))
    with TestClient(app) as client:
        assert client.get(prefix + '/offline-manifest.json').status_code == 404
        assert client.get(prefix + '/offline-worker.js').status_code == 404
        assert 'Service-Worker-Allowed' not in client.get(prefix + '/app.js').headers


def test_installed_assets_survive_distribution_update_while_selection_stays_strict(tmp_path, monkeypatch):
    project = offline_project(tmp_path)
    releases, old = publish_fixture(project, tmp_path, 'old')
    monkeypatch.setenv('RESEARCH_WORKBENCH_UI_RELEASES', str(releases))
    old_prefix = '/_ui/' + old['release']
    app = FastAPI()
    install_device_pages(app, project / 'frontend')
    app.mount('/', FrontendFiles(directory=project / 'frontend', html=True))
    with TestClient(app) as client:
        assert '"first"' in client.get(old_prefix + '/lazy.js').text

        # A distribution-only backend update changes the running fingerprint and
        # the service restarts; the installed bundle is untouched.
        (project / 'research_workbench/api.py').write_text('BUSINESS_API = 2\n')
        ui_releases._delivery.cache_clear()

        # Only a compatible new UI may be published and selected.
        (project / 'frontend/lazy.js').write_text('export const version="second";')
        _, new = publish_fixture(project, tmp_path, 'new')
        new_prefix = '/_ui/' + new['release']
        assert new['release'] != old['release']

        entry = client.get('/')
        assert entry.status_code == 200
        assert entry.headers['X-Workspace-UI-Release'] == new['release']
        assert 'src="' + new_prefix + '/app.js"' in entry.text
        device = client.get('/device/')
        assert device.status_code == 200 and 'data-storage-mode="device"' in device.text
        assert device.headers['X-Workspace-UI-Release'] == new['release']
        assert '"second"' in client.get(new_prefix + '/lazy.js').text

        # Pages still open on the old release keep their pinned immutable bytes.
        pinned = client.get(old_prefix + '/lazy.js')
        assert pinned.status_code == 200 and '"first"' in pinned.text
        assert pinned.headers['Cache-Control'] == 'public, max-age=31536000, immutable'
        assert pinned.headers['X-Workspace-UI-Release'] == old['release']
        worker = client.get(old_prefix + '/offline-worker.js')
        assert worker.status_code == 200
        assert worker.headers['Service-Worker-Allowed'] == '/'
        assert client.get(old_prefix + '/offline-manifest.json').status_code == 200
        assert client.get(old_prefix + '/vendor/pdfjs/cmaps/H.bcmap').status_code == 200
        assert 'Service-Worker-Allowed' not in client.get(old_prefix + '/app.js').headers
        assert client.get(old_prefix + '/device-sw.js').status_code == 404
        assert client.get(old_prefix + '/index.html').status_code == 404

        # Choosing the now-incompatible old UI by hand still fails loudly.
        with pytest.raises(ReleaseError):
            activate(project, releases, old['release'])
        (releases / 'current.json').write_text(json.dumps({'release': old['release']}))
        for path in ('/', '/device/', '/storage'):
            response = client.get(path)
            assert response.status_code == 503 and response.headers['Retry-After'] == '3'
        (releases / 'current.json').write_text(json.dumps({'release': new['release']}))
        assert client.get('/').headers['X-Workspace-UI-Release'] == new['release']
        assert client.get(old_prefix + '/lazy.js').status_code == 200

        # Corrupted historical bytes and unsafe manifest paths stay rejected.
        ui_releases._delivery.cache_clear()
        (releases / old['release'] / 'frontend/lazy.js').write_text('damaged')
        assert client.get(old_prefix + '/lazy.js').status_code == 404
        assert client.get(new_prefix + '/lazy.js').status_code == 200

        unsafe = releases / 'ui-test-unsafe'
        shutil.copytree(releases / old['release'], unsafe)
        manifest = json.loads((unsafe / 'RELEASE.json').read_text(encoding='utf-8'))
        manifest['release'] = unsafe.name
        manifest['files']['../escape.js'] = {'bytes': 4, 'sha256': '0' * 64}
        (unsafe / 'RELEASE.json').write_text(json.dumps(manifest), encoding='utf-8')
        ui_releases._delivery.cache_clear()
        assert client.get('/_ui/' + unsafe.name + '/app.js').status_code == 404
        assert client.get(new_prefix + '/app.js').status_code == 200
