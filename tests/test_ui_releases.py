import json
import zipfile

import pytest

from research_workbench.ui_publish import pack, install, activate
from research_workbench.ui_releases import ReleaseError, backend_fingerprint
from ui_release_support import project_fixture, publish_fixture


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
