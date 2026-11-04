from contextlib import asynccontextmanager
from threading import Event

from fastapi import FastAPI
from fastapi.testclient import TestClient

from research_workbench.device_pages import FrontendFiles, install_device_pages
from ui_release_support import project_fixture, publish_fixture


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
