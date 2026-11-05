"""Focused HTTP checks for the optional shared model connection.

All model traffic uses a fake transport: no provider, network, owner data or
real credential is contacted.  The guest gateway is built with background
workers disabled so no subprocess is started.
"""
import copy
import hashlib
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from research_workbench.device_ai import (
    DEVICE_AI_PATH, DEVICE_CONNECTION_PATH)
from research_workbench.device_question import DEVICE_QUESTION_PATH
from research_workbench.guest_registry import COOKIE_NAME
from research_workbench.main import create_app
from research_workbench.shared_model import SharedFallbackModelConnection

SHARED_KEY = 'synthetic-operator-site-key'
SHARED_MODEL = 'deepseek-chat'
PERSONAL_KEY = 'synthetic-guest-personal-key'
AUTHORIZATION = {'Authorization': f'Bearer {PERSONAL_KEY}'}


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.result = {'role': 'assistant', 'content': '合成平台译文',
                       'finish_reason': 'stop'}

    def complete_once(self, messages, tools):
        self.calls.append((copy.deepcopy(messages), tools))
        if isinstance(self.result, Exception):
            raise self.result
        return copy.deepcopy(self.result)


def shared_payload(**changes):
    value = {'base_url': 'https://api.deepseek.com/v1',
             'model': SHARED_MODEL,
             'api_key': SHARED_KEY,
             'supports_images': False}
    value.update(changes)
    return value


def write_shared(path, **changes):
    path.write_text(json.dumps(shared_payload(**changes)), encoding='utf-8')
    return path


def write_personal(root, model='deepseek-reasoner'):
    path = Path(root) / '.agent-model.json'
    path.write_text(json.dumps({
        'base_url': 'https://api.deepseek.com/v1', 'model': model,
        'api_key': PERSONAL_KEY, 'supports_images': False}), encoding='utf-8')
    return path


@pytest.fixture
def project(tmp_path, monkeypatch):
    root = tmp_path / 'project'
    plotly = root / 'frontend' / 'vendor' / 'plotly' / '4.2.0'
    plotly.mkdir(parents=True)
    script = b'synthetic-plotly-renderer'
    (plotly / 'plotly-strict.min.js').write_bytes(script)
    (plotly / 'manifest.json').write_text(json.dumps({'files': {
        'plotly-strict.min.js': {
            'byte_size': len(script),
            'sha256': hashlib.sha256(script).hexdigest()}}}),
        encoding='utf-8')
    monkeypatch.setattr('research_workbench.charts.ROOT', root)
    monkeypatch.setattr('research_workbench.main.ROOT', root)
    return root


@pytest.fixture
def shared_path(tmp_path):
    return write_shared(tmp_path / 'operator-shared.json')


@pytest.fixture
def transport():
    return FakeTransport()


@pytest.fixture
def make_gateway(tmp_path, project, monkeypatch):
    """Build gateways whose child apps start no agent/worker threads."""
    import research_workbench.guest_gateway as gateway_module

    real = gateway_module.create_app

    def create_without_background(root, **kwargs):
        kwargs.update(agent_autostart=False, analysis_autostart=False,
                      translation_autostart=False)
        return real(root, **kwargs)

    monkeypatch.setattr(gateway_module, 'create_app',
                        create_without_background)
    monkeypatch.setattr(gateway_module, 'ROOT', project)
    monkeypatch.setenv('RESEARCH_WORKBENCH_DATA', str(tmp_path / 'owner-data'))
    counter = iter(range(10))

    def build(shared_model_config=None):
        return gateway_module.create_guest_gateway(
            tmp_path / f'guests-{next(counter)}',
            shared_model_config=shared_model_config)

    return build


def attach_transport(app, transport):
    keys = []
    app.state.transport_keys = keys

    def factory(key, model):
        keys.append((key, model))
        return transport

    app.state.device_ai.transport_factory = factory
    return keys


@pytest.fixture
def gateway(make_gateway, shared_path, transport):
    app = make_gateway(shared_path)
    attach_transport(app, transport)
    return app


@pytest.fixture
def client(gateway):
    with TestClient(gateway, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        yield client


def issue(app):
    return app.state.guest_registry.create()


def cookie_headers(session):
    return {'Cookie': f'{COOKIE_NAME}={session.token}'}


def translation_payload(**changes):
    value = {'request_id': str(uuid4()),
             'text': 'Synthetic selected text 3.5 mM [12]',
             'target_language': 'zh', 'model': SHARED_MODEL,
             'confirmed': True}
    value.update(changes)
    return value


def question_payload(**changes):
    value = {'request_id': str(uuid4()),
             'question': 'What does the material say about 3.5 mM [12]?',
             'materials': [{'label': 'M1',
                            'text': 'Synthetic material 3.5 mM [12]'}],
             'history': [], 'answer_language': 'zh', 'model': SHARED_MODEL,
             'confirmed': True}
    value.update(changes)
    return value


def assert_no_store(response):
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['pragma'] == 'no-cache'
    assert 'access-control-allow-origin' not in response.headers


def assert_no_secret(response):
    text = response.text
    assert SHARED_KEY not in text
    assert PERSONAL_KEY not in text
    assert 'api_key' not in text


def bare_json_post(client, path, body, extra_headers=()):
    headers = [('content-type', 'application/json'), *extra_headers]
    return client.post(path, content=json.dumps(body), headers=headers)


def test_connection_status_is_capability_only_and_allocates_nothing(
        client, gateway, transport):
    response = client.get(DEVICE_CONNECTION_PATH)
    assert response.status_code == 200, response.text
    assert_no_store(response)
    assert response.json() == {'shared_available': True,
                               'shared_model': SHARED_MODEL}
    assert 'set-cookie' not in response.headers
    assert_no_secret(response)
    assert list(gateway.state.guest_registry.spaces.iterdir()) == []
    assert gateway.state.guest_manager._entries == {}
    assert transport.calls == []


@pytest.mark.parametrize('method', ['POST', 'PUT', 'PATCH', 'DELETE'])
def test_connection_status_is_get_only(client, method):
    response = client.request(method, DEVICE_CONNECTION_PATH)
    assert response.status_code == 405
    assert response.headers['allow'] == 'GET'
    assert_no_store(response)


def test_owner_connection_never_inherits_the_guest_environment(
        tmp_path, project, monkeypatch, shared_path):
    monkeypatch.setenv('RESEARCH_GUEST_MODEL_CONFIG', str(shared_path))
    app = create_app(tmp_path / 'owner-workspace', agent_autostart=False,
                     analysis_autostart=False, translation_autostart=False)
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        response = client.get(DEVICE_CONNECTION_PATH)
        assert response.status_code == 200
        assert response.json() == {'shared_available': False,
                                   'shared_model': None}
        assert_no_store(response)


def test_owner_create_app_does_not_wire_site_config(
        tmp_path, project, shared_path):
    app = create_app(tmp_path / 'owner-workspace', agent_autostart=False,
                     analysis_autostart=False, translation_autostart=True)
    assert app.state.translations.supervisor.shared_model_config is None
    assert app.state.translations.supervisor.guest_model_policy is False
    assert not isinstance(app.state.agent.provider,
                          SharedFallbackModelConnection)


def test_create_app_wires_operator_path_to_the_translation_supervisor(
        tmp_path, project, shared_path):
    app = create_app(tmp_path / 'guest-workspace',
                     shared_model_config=shared_path, guest_model_policy=True,
                     agent_autostart=False,
                     analysis_autostart=False, translation_autostart=True)
    supervisor = app.state.translations.supervisor
    assert supervisor.shared_model_config == shared_path
    assert supervisor.guest_model_policy is True
    assert isinstance(app.state.agent.provider,
                      SharedFallbackModelConnection)
    assert app.state.agent.provider.shared_status()['shared_model'] == (
        SHARED_MODEL)


def test_shared_translation_uses_the_site_key_without_authorization(
        client, gateway, transport):
    request = translation_payload()
    response = bare_json_post(
        client, DEVICE_AI_PATH, request,
        [('X-Research-Model-Source', 'shared')])
    assert response.status_code == 200, response.text
    assert_no_store(response)
    assert_no_secret(response)
    body = response.json()
    assert set(body) == {'request_id', 'text_sha256', 'target_language',
                         'model', 'translated_text'}
    assert body['model'] == SHARED_MODEL
    assert gateway.state.transport_keys == [(SHARED_KEY, SHARED_MODEL)]
    assert len(transport.calls) == 1


def test_shared_translation_model_mismatch_is_409_before_any_call(
        client, gateway, transport):
    response = bare_json_post(
        client, DEVICE_AI_PATH,
        translation_payload(model='deepseek-reasoner'),
        [('X-Research-Model-Source', 'shared')])
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'device_shared_model_changed'
    assert_no_store(response)
    assert_no_secret(response)
    assert gateway.state.transport_keys == []
    assert transport.calls == []


@pytest.mark.parametrize('authorization', [
    f'Bearer {PERSONAL_KEY}', 'Bearer', 'not-a-bearer-value'])
def test_shared_request_with_any_authorization_is_rejected(
        client, gateway, transport, authorization):
    response = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(),
        [('X-Research-Model-Source', 'shared'),
         ('Authorization', authorization)])
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'device_model_source_invalid'
    assert_no_store(response)
    assert_no_secret(response)
    assert gateway.state.transport_keys == []
    assert transport.calls == []


def test_shared_request_with_duplicate_authorization_is_rejected(
        client, gateway, transport):
    response = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(),
        [('X-Research-Model-Source', 'shared'),
         ('Authorization', f'Bearer {PERSONAL_KEY}'),
         ('Authorization', f'Bearer {PERSONAL_KEY}')])
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'device_model_source_invalid'
    assert gateway.state.transport_keys == []
    assert transport.calls == []


@pytest.mark.parametrize('source_header', ['site', 'SHARED', ''])
def test_unknown_source_header_is_rejected(
        client, gateway, transport, source_header):
    response = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(),
        [('X-Research-Model-Source', source_header),
         ('Authorization', f'Bearer {PERSONAL_KEY}')])
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'device_model_source_invalid'
    assert transport.calls == []


def test_duplicate_source_header_is_rejected(client, gateway, transport):
    response = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(),
        [('X-Research-Model-Source', 'shared'),
         ('X-Research-Model-Source', 'shared')])
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'device_model_source_invalid'
    assert gateway.state.transport_keys == []
    assert transport.calls == []


def test_shared_source_without_site_configuration_is_503(
        make_gateway, transport):
    app = make_gateway(None)
    attach_transport(app, transport)
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        response = bare_json_post(
            client, DEVICE_AI_PATH, translation_payload(),
            [('X-Research-Model-Source', 'shared')])
    assert response.status_code == 503
    assert response.json()['detail']['code'] == (
        'device_shared_model_unavailable')
    assert_no_store(response)
    assert transport.calls == []


def test_personal_source_requires_a_bearer_and_never_falls_back(
        client, gateway, transport):
    missing = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(),
        [('X-Research-Model-Source', 'personal')])
    assert missing.status_code == 401
    assert missing.json()['detail']['code'] == 'device_ai_credential_invalid'
    assert transport.calls == []

    accepted = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(model='deepseek-reasoner'),
        [('X-Research-Model-Source', 'personal'),
         ('Authorization', f'Bearer {PERSONAL_KEY}')])
    assert accepted.status_code == 200, accepted.text
    assert gateway.state.transport_keys == [
        (PERSONAL_KEY, 'deepseek-reasoner')]
    assert len(transport.calls) == 1


def test_personal_provider_failure_does_not_fall_back_to_shared(
        client, gateway, transport):
    transport.result = RuntimeError('synthetic provider failure')
    response = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(),
        [('Authorization', f'Bearer {PERSONAL_KEY}')])
    assert response.status_code == 502
    assert response.json()['detail']['code'] == 'device_ai_provider_failed'
    assert gateway.state.transport_keys == [(PERSONAL_KEY, SHARED_MODEL)]
    assert len(transport.calls) == 1


def test_legacy_requests_keep_the_existing_credential_rules(
        client, gateway, transport):
    legacy = bare_json_post(
        client, DEVICE_AI_PATH, translation_payload(),
        [('Authorization', f'Bearer {PERSONAL_KEY}')])
    assert legacy.status_code == 200, legacy.text
    assert gateway.state.transport_keys == [(PERSONAL_KEY, SHARED_MODEL)]

    missing = bare_json_post(client, DEVICE_AI_PATH, translation_payload())
    assert missing.status_code == 401
    assert missing.json()['detail']['code'] == 'device_ai_credential_invalid'
    assert len(gateway.state.transport_keys) == 1
    assert len(transport.calls) == 1


def test_shared_question_uses_the_site_key_and_model(
        client, gateway, transport):
    response = bare_json_post(
        client, DEVICE_QUESTION_PATH, question_payload(),
        [('X-Research-Model-Source', 'shared')])
    assert response.status_code == 200, response.text
    assert_no_store(response)
    assert_no_secret(response)
    assert gateway.state.transport_keys == [(SHARED_KEY, SHARED_MODEL)]
    assert len(transport.calls) == 1


def test_shared_question_model_mismatch_is_409(client, gateway, transport):
    response = bare_json_post(
        client, DEVICE_QUESTION_PATH,
        question_payload(model='deepseek-reasoner'),
        [('X-Research-Model-Source', 'shared')])
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'device_shared_model_changed'
    assert gateway.state.transport_keys == []
    assert transport.calls == []


def test_guest_status_reports_shared_without_any_secret(client, gateway):
    session = issue(gateway)
    response = client.get('/api/v1/agent/status',
                          headers=cookie_headers(session))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['configured'] is True
    assert body['model'] == SHARED_MODEL
    assert body['connection_source'] == 'shared'
    assert body['shared_available'] is True
    assert body['shared_model'] == SHARED_MODEL
    assert_no_secret(response)


def test_guest_personal_file_has_priority_in_status(client, gateway):
    session = issue(gateway)
    root = gateway.state.guest_registry.space_root(session.guest_id)
    write_personal(root, model='deepseek-reasoner')
    response = client.get('/api/v1/agent/status',
                          headers=cookie_headers(session))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['connection_source'] == 'local'
    assert body['model'] == 'deepseek-reasoner'
    assert body['shared_available'] is True
    assert body['shared_model'] == SHARED_MODEL
    assert_no_secret(response)


def test_guest_invalid_personal_file_fails_closed_in_status(client, gateway):
    session = issue(gateway)
    root = gateway.state.guest_registry.space_root(session.guest_id)
    (root / '.agent-model.json').write_text('{not json', encoding='utf-8')
    response = client.get('/api/v1/agent/status',
                          headers=cookie_headers(session))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['configured'] is False
    assert body['connection_source'] == 'none'
    assert body['shared_available'] is True


def test_shared_settings_reset_is_scoped_to_one_space(
        client, gateway, shared_path):
    first = issue(gateway)
    second = issue(gateway)
    first_root = gateway.state.guest_registry.space_root(first.guest_id)
    second_root = gateway.state.guest_registry.space_root(second.guest_id)
    first_personal = write_personal(first_root)
    second_personal = write_personal(second_root, model='deepseek-flash')
    before = shared_path.read_bytes()

    response = client.post('/api/v1/agent/settings/shared', json={},
                           headers=cookie_headers(first))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['connection_source'] == 'shared'
    assert body['shared_available'] is True
    assert_no_secret(response)

    assert not first_personal.exists()
    assert second_personal.read_text(encoding='utf-8')
    assert shared_path.read_bytes() == before
    assert not (first_root / 'shared').exists()

    other = client.get('/api/v1/agent/status',
                       headers=cookie_headers(second))
    assert other.json()['connection_source'] == 'local'
    assert other.json()['model'] == 'deepseek-flash'


def test_shared_settings_unavailable_keeps_personal(
        make_gateway, transport):
    app = make_gateway()
    attach_transport(app, transport)
    session = issue(app)
    root = app.state.guest_registry.space_root(session.guest_id)
    personal = write_personal(root)
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        response = client.post('/api/v1/agent/settings/shared', json={},
                               headers=cookie_headers(session))
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'shared_model_unavailable'
    assert personal.exists()


def test_shared_settings_requires_empty_json(client, gateway):
    session = issue(gateway)
    response = client.post('/api/v1/agent/settings/shared',
                           json={'extra': True},
                           headers=cookie_headers(session))
    assert response.status_code == 422


def test_owner_shared_settings_removes_nothing(
        tmp_path, project, monkeypatch):
    monkeypatch.setenv('RESEARCH_WORKBENCH_DATA', str(tmp_path / 'owner-data'))
    app = create_app(tmp_path / 'owner-workspace', agent_autostart=False,
                     analysis_autostart=False, translation_autostart=False)
    personal = write_personal(app.state.store.root)
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        response = client.post('/api/v1/agent/settings/shared', json={})
        assert response.status_code == 409
        assert response.json()['detail']['code'] == 'shared_model_unavailable'
    assert personal.exists()


def test_owner_shared_settings_stays_refused_with_explicit_config(
        tmp_path, project, shared_path):
    app = create_app(tmp_path / 'owner-shared', shared_model_config=shared_path,
                     agent_autostart=False, analysis_autostart=False,
                     translation_autostart=False)
    personal = write_personal(app.state.store.root)
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        response = client.post('/api/v1/agent/settings/shared', json={})
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'shared_model_unavailable'
    assert personal.exists()


def test_guest_status_without_a_cookie_allocates_nothing(client, gateway):
    response = client.get('/api/v1/agent/status')
    assert response.status_code == 401
    assert response.json()['detail']['code'] == 'guest_session_required'
    assert list(gateway.state.guest_registry.spaces.iterdir()) == []


def test_guest_personal_save_stays_official_and_in_its_own_space(
        client, gateway, shared_path):
    session = issue(gateway)
    before = shared_path.read_bytes()
    rejected = client.post('/api/v1/agent/settings', json={
        'base_url': 'https://example.invalid/v1', 'model': 'deepseek-chat',
        'api_key': PERSONAL_KEY, 'supports_images': False},
        headers=cookie_headers(session))
    assert rejected.status_code == 422
    assert rejected.json()['detail']['code'] == 'agent_endpoint_not_allowed'

    accepted = client.post('/api/v1/agent/settings', json={
        'base_url': 'https://api.deepseek.com/v1', 'model': 'deepseek-chat',
        'api_key': PERSONAL_KEY, 'supports_images': False},
        headers=cookie_headers(session))
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()['connection_source'] == 'local'
    root = gateway.state.guest_registry.space_root(session.guest_id)
    saved = (root / '.agent-model.json').read_text(encoding='utf-8')
    assert PERSONAL_KEY in saved
    assert SHARED_KEY not in saved
    assert shared_path.read_bytes() == before
