"""Focused unit checks for the operator shared model configuration.

No network, provider, worker process or owner data is used: only synthetic JSON
files in ``tmp_path`` and the resolver classes themselves.
"""
import json
import os
from pathlib import Path

import pytest

from research_workbench.models import WorkspaceError
from research_workbench.shared_model import (
    MAX_SHARED_MODEL_BYTES, SharedFallbackModelConnection, SharedModel)


SHARED_KEY = 'synthetic-operator-key-0123456789'
SHARED_MODEL = 'deepseek-chat'
PERSONAL_KEY = 'synthetic-guest-personal-key'


def shared_payload(**changes):
    value = {'base_url': 'https://api.deepseek.com',
             'model': SHARED_MODEL,
             'api_key': SHARED_KEY,
             'supports_images': False}
    value.update(changes)
    return value


def write_json(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')
    return path


def write_personal(root, **changes):
    path = Path(root) / '.agent-model.json'
    write_json(path, {'base_url': 'https://api.deepseek.com/v1',
                      'model': 'deepseek-reasoner',
                      'api_key': PERSONAL_KEY,
                      'supports_images': True, **changes})
    return path


def connection(root, shared_path):
    return SharedFallbackModelConnection.from_paths(
        root, None, shared_path)


@pytest.mark.parametrize('base_url', [
    'https://api.deepseek.com', 'https://api.deepseek.com/v1',
    'https://api.deepseek.com/'])
def test_valid_shared_file_exposes_only_the_model(tmp_path, base_url):
    path = write_json(tmp_path / 'operator.json', shared_payload(
        base_url=base_url))
    model = SharedModel(path)
    config = model.load()
    assert config['model'] == SHARED_MODEL
    assert config['api_key'] == SHARED_KEY
    assert config['base_url'] == base_url.rstrip('/')
    status = model.status()
    assert status == {'shared_available': True, 'shared_model': SHARED_MODEL}
    assert SHARED_KEY not in json.dumps(status)


@pytest.mark.parametrize('payload', [
    shared_payload(base_url='http://api.deepseek.com'),
    shared_payload(base_url='https://api.deepseek.com.evil.example/v1'),
    shared_payload(base_url='https://api.deepseek.com/v2'),
    shared_payload(base_url='https://user@api.deepseek.com/v1'),
    shared_payload(base_url='https://api.deepseek.com/v1?query=1'),
    shared_payload(base_url='https://example.invalid/v1'),
    shared_payload(model=''),
    shared_payload(model='deep seek'),
    shared_payload(model='m' * 101),
    shared_payload(api_key=''),
    shared_payload(api_key='key with space'),
    shared_payload(api_key='k' * 513),
    shared_payload(supports_images='yes'),
    [shared_payload()],
])
def test_unsafe_shared_payload_disables_sharing(tmp_path, payload):
    path = tmp_path / 'operator.json'
    path.write_text(json.dumps(payload), encoding='utf-8')
    model = SharedModel(path)
    assert model.load() is None
    assert model.status() == {'shared_available': False,
                              'shared_model': None}


def test_invalid_json_and_oversized_file_disable_sharing(tmp_path):
    broken = tmp_path / 'broken.json'
    broken.write_bytes(b'{not json')
    assert SharedModel(broken).load() is None

    oversized = tmp_path / 'large.json'
    oversized.write_bytes(b'x' * (MAX_SHARED_MODEL_BYTES + 1))
    assert SharedModel(oversized).load() is None


def test_missing_file_and_directory_disable_sharing(tmp_path):
    assert SharedModel(tmp_path / 'absent.json').load() is None
    directory = tmp_path / 'directory.json'
    directory.mkdir()
    assert SharedModel(directory).load() is None


def test_symlinked_shared_file_is_rejected(tmp_path):
    target = write_json(tmp_path / 'target.json', shared_payload())
    link = tmp_path / 'link.json'
    try:
        os.symlink(target, link)
    except (OSError, NotImplementedError):
        pytest.skip('symlinks are not available for this user')
    assert SharedModel(link).load() is None


def test_shared_file_inside_guest_root_is_rejected(tmp_path):
    guest_root = tmp_path / 'guests'
    guest_root.mkdir()
    path = write_json(guest_root / 'operator.json', shared_payload())
    assert SharedModel(path, forbidden_root=guest_root).load() is None


def test_personal_file_has_priority_over_shared(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    write_personal(root)
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    provider = connection(root, shared_path)
    config, source = provider.config()
    assert source == 'local'
    assert config['api_key'] == PERSONAL_KEY
    status = provider.status()
    assert status['connection_source'] == 'local'
    assert status['shared_available'] is True
    assert status['shared_model'] == SHARED_MODEL
    assert PERSONAL_KEY not in json.dumps(status)
    assert SHARED_KEY not in json.dumps(status)


def test_shared_is_used_only_without_a_personal_file(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    provider = connection(root, shared_path)
    config, source = provider.config()
    assert source == 'shared'
    assert config['api_key'] == SHARED_KEY
    status = provider.status()
    assert status['configured'] is True
    assert status['model'] == SHARED_MODEL
    assert status['connection_source'] == 'shared'
    assert status['scope'] == 'local_research'
    assert status['multi_user_auth'] is False


@pytest.mark.parametrize('content', [
    b'{not json',
    b'{"base_url": "https://example.invalid/v1", '
    b'"model": "deepseek-chat", "api_key": "personal", '
    b'"supports_images": false}',
])
def test_invalid_personal_file_never_falls_back_to_shared(tmp_path, content):
    root = tmp_path / 'space'
    root.mkdir()
    (root / '.agent-model.json').write_bytes(content)
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    provider = connection(root, shared_path)
    assert provider.config() == ({}, 'none')
    status = provider.status()
    assert status['configured'] is False
    assert status['connection_source'] == 'none'
    # The site capability is still reported, but it is not selected.
    assert status['shared_available'] is True


def test_symlinked_personal_file_fails_closed(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    elsewhere = write_json(tmp_path / 'elsewhere.json', shared_payload(
        api_key='another-guest-key'))
    link = root / '.agent-model.json'
    try:
        os.symlink(elsewhere, link)
    except (OSError, NotImplementedError):
        pytest.skip('symlinks are not available for this user')
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    provider = connection(root, shared_path)
    assert provider.config() == ({}, 'none')


def test_use_shared_removes_only_the_personal_file(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    personal = write_personal(root)
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    before = shared_path.read_bytes()
    provider = connection(root, shared_path)

    status = provider.use_shared()
    assert status['connection_source'] == 'shared'
    assert status['model'] == SHARED_MODEL
    assert not personal.exists()
    assert shared_path.read_bytes() == before
    assert SHARED_KEY not in json.dumps(status)


def test_use_shared_unavailable_keeps_the_personal_file(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    personal = write_personal(root)
    provider = connection(root, tmp_path / 'absent-operator.json')
    with pytest.raises(WorkspaceError) as error:
        provider.use_shared()
    assert error.value.code == 'shared_model_unavailable'
    assert error.value.status == 409
    assert personal.exists()


def test_use_shared_never_removes_a_directory(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    (root / '.agent-model.json').mkdir()
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    provider = connection(root, shared_path)
    with pytest.raises(WorkspaceError) as error:
        provider.use_shared()
    assert error.value.code == 'shared_model_reset_failed'
    assert (root / '.agent-model.json').is_dir()


def test_nonofficial_personal_save_and_connection_are_rejected(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    provider = connection(root, shared_path)
    with pytest.raises(WorkspaceError) as error:
        provider.validate({'base_url': 'https://example.invalid/v1',
                           'model': 'deepseek-chat',
                           'api_key': PERSONAL_KEY})
    assert error.value.code == 'agent_endpoint_not_allowed'
    assert error.value.status == 422


def test_worker_resolver_prefers_own_key_then_shared(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    personal_path = root / '.agent-model.json'

    worker = SharedFallbackModelConnection.from_paths(
        root, personal_path, shared_path)
    assert worker.config()[1] == 'shared'

    write_personal(root)
    worker = SharedFallbackModelConnection.from_paths(
        root, personal_path, shared_path)
    assert worker.config()[1] == 'local'
    assert worker.config()[0]['api_key'] == PERSONAL_KEY


def test_worker_without_shared_keeps_owner_personal_rules(tmp_path):
    root = tmp_path / 'space'
    root.mkdir()
    personal = root / '.agent-model.json'
    write_json(personal, {'base_url': 'https://example.invalid/v1',
                          'model': 'owner-model',
                          'api_key': PERSONAL_KEY,
                          'supports_images': False})
    owner_worker = SharedFallbackModelConnection.from_paths(root, personal, None)
    assert owner_worker.config()[1] == 'local'
    assert owner_worker.config()[0]['api_key'] == PERSONAL_KEY

    guest_worker = SharedFallbackModelConnection.from_paths(
        root, personal, None, guest_policy=True)
    assert guest_worker.config() == ({}, 'none')


def test_guest_connection_without_shared_reports_unavailable(tmp_path):
    from research_workbench.guest_gateway import GuestModelConnection

    provider = GuestModelConnection(tmp_path)
    status = provider.status()
    assert status['shared_available'] is False
    assert status['shared_model'] is None
    assert status['configured'] is False
    assert status['connection_source'] == 'none'


def test_worker_rejects_a_site_file_inside_the_guest_root(tmp_path):
    guest_root = tmp_path / 'guests'
    space = guest_root / 'spaces' / 'one'
    space.mkdir(parents=True)
    path = write_json(space / 'operator.json', shared_payload())
    worker = SharedFallbackModelConnection.from_paths(
        space, None, path, guest_policy=True, forbidden_root=guest_root)
    assert worker.config() == ({}, 'none')


def test_cli_guest_model_config_and_environment_fallback(
        tmp_path, monkeypatch):
    import sys

    import research_workbench.__main__ as cli

    captured = {}
    monkeypatch.setattr(cli.uvicorn, 'run',
                        lambda app, **kwargs: captured.update(app=app))
    monkeypatch.setattr(cli, 'create_app',
                        lambda *args, **kwargs: captured.update(
                            owner=kwargs) or 'owner-app')

    def fake_gateway(root, **kwargs):
        captured['root'] = root
        captured['gateway'] = kwargs
        return 'gateway-app'

    monkeypatch.setattr(
        'research_workbench.guest_gateway.create_guest_gateway', fake_gateway)
    shared = tmp_path / 'operator.json'
    monkeypatch.setenv('RESEARCH_GUEST_MODEL_CONFIG', str(shared))

    # Explicit CLI path wins in guest mode.
    monkeypatch.setattr(sys, 'argv', [
        'research_workbench', '--guest-root', str(tmp_path / 'guests'),
        '--guest-model-config', str(shared)])
    cli.main()
    assert captured['gateway']['shared_model_config'] == shared
    assert captured['app'] == 'gateway-app'

    # Environment fallback applies in guest mode only.
    captured.clear()
    monkeypatch.setattr(sys, 'argv', [
        'research_workbench', '--guest-root', str(tmp_path / 'guests')])
    cli.main()
    assert captured['gateway']['shared_model_config'] == shared

    # Owner mode ignores the environment and the guest-only option is refused.
    captured.clear()
    monkeypatch.setattr(sys, 'argv', ['research_workbench'])
    cli.main()
    assert 'shared_model_config' not in captured['owner']
    with pytest.raises(SystemExit) as error:
        monkeypatch.setattr(sys, 'argv', [
            'research_workbench', '--guest-model-config', str(shared)])
        cli.main()
    assert error.value.code == 2


def test_guest_child_app_forwards_guest_policy_and_path(
        tmp_path, monkeypatch):
    import research_workbench.guest_gateway as gateway_module

    captured = {}

    def fake_create_app(root, **kwargs):
        captured['root'] = root
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(gateway_module, 'create_app', fake_create_app)
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    shared = SharedModel(shared_path)
    root = tmp_path / 'space'
    guest_root = tmp_path / 'guests'
    gateway_module.guest_child_app(
        root, shared_model=shared, shared_model_root=guest_root)

    assert captured['shared_model_config'] == shared_path
    assert captured['guest_model_policy'] is True
    assert captured['shared_model_forbidden_root'] == guest_root
    assert captured['agent_config'] == root / '.agent-model.json'
    provider = captured['agent_provider']
    assert isinstance(provider, gateway_module.GuestModelConnection)
    assert provider.guest_policy is True
    assert provider.config()[1] == 'shared'
    assert provider.shared_status() == {
        'shared_available': True, 'shared_model': SHARED_MODEL}


def test_supervisor_forwards_the_operator_path_not_the_secret(
        tmp_path, monkeypatch):
    from types import SimpleNamespace

    import research_workbench.translation_process as process_module

    root = tmp_path / 'space'
    root.mkdir()
    shared_path = write_json(tmp_path / 'operator.json', shared_payload())
    service = SimpleNamespace(store=SimpleNamespace(root=root))
    captured = {}

    class FakeProcess:
        def __init__(self, command, **kwargs):
            captured['command'] = list(command)
            token = command[command.index('--token') + 1]
            ready = (root / '.translation-worker' /
                     ('.ready-' + token + '.json'))
            ready.write_text(json.dumps(
                {'pid': os.getpid(), 'token': token}), encoding='utf-8')
            self.stdin = None

        def poll(self):
            return None

    monkeypatch.setattr(process_module.subprocess, 'Popen', FakeProcess)
    supervisor = process_module.TranslationSupervisor(
        service, None, root / '.agent-model.json',
        shared_model_config=shared_path, guest_model_policy=True,
        shared_model_forbidden_root=tmp_path / 'guests')
    try:
        supervisor.ensure_started()
    finally:
        supervisor.dispose_files()

    command = captured['command']
    assert '--shared-model-config' in command
    assert command[command.index('--shared-model-config') + 1] == str(
        shared_path)
    assert '--guest-model-policy' in command
    assert '--shared-model-forbidden-root' in command
    assert command[command.index('--shared-model-forbidden-root') + 1] == str(
        tmp_path / 'guests')
    assert SHARED_KEY not in ' '.join(command)

