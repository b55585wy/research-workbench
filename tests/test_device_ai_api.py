"""Bounded HTTP checks for the explicit device selected-text translation relay.

The device relay is exercised with a fake transport, so no provider, owner
configuration, guest file or credential is contacted.  Existing server
selection translation and guest dispatch paths are checked for regressions.
"""
import copy
import hashlib
import json
import threading
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from conftest import make_pdf
from research_workbench.device_ai import (
    DEVICE_AI_PATH, MAX_BODY_BYTES, MAX_RESULT_CHARS, SYSTEM_PROMPT,
)
from research_workbench.guest_gateway import create_guest_gateway
from research_workbench.main import create_app

AUTHORIZATION = {'Authorization': 'Bearer synthetic-device-key'}


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.keys = []
        self.result = {'role': 'assistant', 'content': '合成设备译文',
                       'finish_reason': 'stop'}
        self.on_call = None

    def complete_once(self, messages, tools):
        self.calls.append((copy.deepcopy(messages), tools))
        if self.on_call is not None:
            self.on_call(messages, tools)
        result = self.result
        if isinstance(result, Exception):
            raise result
        return copy.deepcopy(result)


class ServerProvider:
    """Stand-in for the existing server model connection."""

    def __init__(self):
        self.calls = []
        self.result = {'role': 'assistant', 'content': '合成服务端译文',
                       'finish_reason': 'stop'}

    def complete_once(self, messages, tools):
        self.calls.append((copy.deepcopy(messages), tools))
        return copy.deepcopy(self.result)

    def complete(self, messages, tools):
        return self.complete_once(messages, tools)


@pytest.fixture
def project(tmp_path, monkeypatch):
    root = tmp_path / 'project'
    frontend = root / 'frontend'
    plotly = frontend / 'vendor' / 'plotly' / '4.2.0'
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
def transport():
    return FakeTransport()


@pytest.fixture
def server_provider():
    return ServerProvider()


@pytest.fixture
def app(tmp_path, project, transport, server_provider):
    application = create_app(
        tmp_path / 'workspace', agent_provider=server_provider,
        agent_autostart=False, analysis_autostart=False,
        translation_autostart=False)

    def factory(api_key, model):
        transport.keys.append((api_key, model))
        return transport

    application.state.device_ai.transport_factory = factory
    return application


@pytest.fixture
def client(app):
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        yield client


def payload(**changes):
    value = {'request_id': str(uuid4()),
             'text': 'Synthetic selected text 3.5 mM [12]',
             'target_language': 'zh', 'model': 'deepseek-chat',
             'confirmed': True}
    value.update(changes)
    return value


def post(client, body=None, headers=None):
    return client.post(DEVICE_AI_PATH, json=body if body is not None else payload(),
                       headers=AUTHORIZATION if headers is None else headers)


def assert_no_store(response):
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['pragma'] == 'no-cache'
    assert 'access-control-allow-origin' not in response.headers


def test_valid_device_request_returns_exact_bounded_receipt(client, transport):
    request = payload(text='Value 3.5 mM [12], E=mc²', target_language='en',
                      model='deepseek-reasoner')
    response = post(client, request)
    assert response.status_code == 200, response.text
    assert_no_store(response)
    body = response.json()
    assert set(body) == {'request_id', 'text_sha256', 'target_language',
                         'model', 'translated_text'}
    assert body['request_id'] == request['request_id']
    assert body['text_sha256'] == hashlib.sha256(
        request['text'].encode('utf-8')).hexdigest()
    assert body['target_language'] == 'en'
    assert body['model'] == 'deepseek-reasoner'
    assert body['translated_text'] == '合成设备译文'
    assert 'synthetic-device-key' not in response.text
    assert request['text'] not in response.text
    assert 'set-cookie' not in response.headers

    assert len(transport.calls) == 1
    messages, tools = transport.calls[0]
    assert tools == []
    assert messages[0]['content'] == SYSTEM_PROMPT
    assert json.loads(messages[1]['content']) == {
        'text': request['text'], 'target_language': 'en'}
    assert transport.keys == [('synthetic-device-key', 'deepseek-reasoner')]


@pytest.mark.parametrize('content_type', [
    None, 'text/plain', 'application/x-www-form-urlencoded',
    'application/json-patch+json'])
def test_json_media_type_is_required(client, transport, content_type):
    headers = dict(AUTHORIZATION)
    if content_type is not None:
        headers['Content-Type'] = content_type
    response = client.post(DEVICE_AI_PATH, content=json.dumps(payload()),
                           headers=headers)
    assert response.status_code == 415, response.text
    assert response.json()['detail']['code'] == 'device_ai_media_type'
    assert_no_store(response)
    assert transport.calls == []


@pytest.mark.parametrize('headers', [
    {},
    {'Authorization': 'Basic synthetic-device-key'},
    {'Authorization': 'Bearer '},
    {'Authorization': 'Bearer key with space'},
    {'Authorization': 'Bearer ' + 'a' * 513},
    {'Authorization': b'Bearer caf\xe9'},
    [('Authorization', 'Bearer one'), ('Authorization', 'Bearer two')],
])
def test_missing_or_invalid_credential_is_generic(client, transport, headers):
    response = client.post(DEVICE_AI_PATH, json=payload(), headers=headers)
    assert response.status_code == 401, response.text
    detail = response.json()['detail']
    assert detail == {'code': 'device_ai_credential_invalid',
                      'message': '需要有效的模型密钥才能继续翻译。'}
    assert 'synthetic-device-key' not in response.text
    assert_no_store(response)
    assert transport.calls == []


def test_body_limit_covers_streamed_and_false_length_requests(client, transport):
    large = json.dumps({**payload(), 'padding': 'x' * (MAX_BODY_BYTES + 64)})
    assert len(large.encode()) > MAX_BODY_BYTES
    encoded_large = large.encode()

    # Declared length above the bound.
    response = client.post(DEVICE_AI_PATH, content=large,
                           headers={**AUTHORIZATION,
                                    'Content-Type': 'application/json'})
    assert response.status_code == 413, response.text
    assert response.json()['detail']['code'] == 'device_ai_body_too_large'
    assert_no_store(response)
    assert transport.calls == []

    # Streamed/chunked body with no Content-Length.
    response = client.post(
        DEVICE_AI_PATH,
        content=iter([encoded_large[:4096], encoded_large[4096:]]),
        headers={**AUTHORIZATION, 'Content-Type': 'application/json'})
    assert response.status_code == 413, response.text
    assert response.json()['detail']['code'] == 'device_ai_body_too_large'
    assert_no_store(response)
    assert transport.calls == []

    # A single oversized ASGI chunk is rejected before it is buffered.
    response = client.post(
        DEVICE_AI_PATH, content=iter([encoded_large]),
        headers={**AUTHORIZATION, 'Content-Type': 'application/json'})
    assert response.status_code == 413, response.text
    assert response.json()['detail']['code'] == 'device_ai_body_too_large'
    assert_no_store(response)
    assert transport.calls == []

    # A false small Content-Length must not bypass the actual byte count.
    response = client.post(
        DEVICE_AI_PATH, content=large,
        headers={**AUTHORIZATION, 'Content-Type': 'application/json',
                 'Content-Length': '10'})
    assert response.status_code == 413, response.text
    assert response.json()['detail']['code'] == 'device_ai_body_too_large'
    assert_no_store(response)
    assert transport.calls == []

    # A valid chunked request still works.
    small = json.dumps(payload())
    encoded = small.encode()
    response = client.post(
        DEVICE_AI_PATH, content=iter([encoded[:20], encoded[20:]]),
        headers={**AUTHORIZATION, 'Content-Type': 'application/json'})
    assert response.status_code == 200, response.text
    assert_no_store(response)
    assert len(transport.calls) == 1


def test_unencodable_text_is_a_safe_validation_error(client, transport):
    response = client.post(DEVICE_AI_PATH, content=json.dumps(payload(text='\ud800')),
                           headers={**AUTHORIZATION,
                                    'Content-Type': 'application/json'})
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'validation_error'
    assert_no_store(response)
    assert transport.calls == []


@pytest.mark.parametrize('change', [
    {'document_id': str(uuid4())}, {'source_sha256': 'a' * 64},
    {'pages': [1]}, {'rect': [0, 0, 1, 1]},
    {'api_key': 'synthetic-secret-value'}, {'url': 'https://example.invalid'},
    {'key': 'synthetic-secret-value'}, {'extra': 1},
    {'text': ''}, {'text': '   '}, {'text': 'x' * 3001},
    {'text': 'bad\x00text'}, {'text': 7},
    {'target_language': 'fr'}, {'target_language': 'ZH'},
    {'model': ''}, {'model': 'x' * 121}, {'model': '模型'},
    {'model': 'bad model'}, {'model': 7},
    {'confirmed': False}, {'confirmed': 1}, {'confirmed': 'true'},
    {'request_id': 'not-a-uuid'},
])
def test_invalid_payload_is_422_without_echo_or_model_call(client, transport, change):
    response = post(client, payload(**change))
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'validation_error'
    assert 'synthetic-secret-value' not in response.text
    assert 'bad\x00text' not in response.text
    assert_no_store(response)
    assert transport.calls == []


def test_duplicate_terminal_receipts_and_conflict_through_http(client, transport):
    request = payload()
    first = post(client, request)
    second = post(client, request)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(transport.calls) == 1

    conflict = post(client, {**request, 'text': 'Changed selected text'})
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()['detail']['code'] == 'device_ai_request_conflict'
    assert_no_store(conflict)
    assert len(transport.calls) == 1

    transport.result = {'role': 'assistant', 'content': '',
                        'finish_reason': 'stop'}
    failed_request = payload()
    failed = post(client, failed_request)
    repeated = post(client, failed_request)
    assert failed.status_code == repeated.status_code == 502
    assert failed.json() == repeated.json()
    assert failed.json()['detail']['code'] == 'device_ai_output_invalid'
    assert_no_store(failed)
    assert len(transport.calls) == 2

    transport.result = {'role': 'assistant', 'content': 'y' * (MAX_RESULT_CHARS + 1),
                        'finish_reason': 'stop'}
    too_long = post(client, payload())
    assert too_long.status_code == 502
    assert too_long.json()['detail']['code'] == 'device_ai_output_invalid'
    assert len(transport.calls) == 3


def test_pending_and_full_capacity_are_bounded_through_http(client, transport):
    entered, second_entered, release = (
        threading.Event(), threading.Event(), threading.Event())
    seen = {'count': 0}

    def block(messages, tools):
        seen['count'] += 1
        (entered if seen['count'] == 1 else second_entered).set()
        assert release.wait(5)

    transport.on_call = block
    first_request = payload()
    responses, errors = {}, []

    def work(name, key, request):
        try:
            responses[name] = client.post(
                DEVICE_AI_PATH, json=request,
                headers={'Authorization': f'Bearer {key}'})
        except Exception as error:  # pragma: no cover - surfaced below
            errors.append(error)

    first = threading.Thread(target=work,
                             args=('a', 'synthetic-key-a', first_request))
    first.start()
    try:
        assert entered.wait(5)
        pending = post(client, first_request,
                       {'Authorization': 'Bearer synthetic-key-a'})
        assert pending.status_code == 409, pending.text
        assert pending.json()['detail']['code'] == 'device_ai_request_pending'
        same_key = post(client, payload(),
                        {'Authorization': 'Bearer synthetic-key-a'})
        assert same_key.status_code == 503, same_key.text
        assert same_key.json()['detail']['code'] == 'device_ai_busy'

        second = threading.Thread(target=work,
                                  args=('b', 'synthetic-key-b', payload()))
        second.start()
        assert second_entered.wait(5)
        full = post(client, payload(),
                    {'Authorization': 'Bearer synthetic-key-c'})
        assert full.status_code == 503, full.text
        assert full.json()['detail']['code'] == 'device_ai_busy'
        assert_no_store(full)
    finally:
        release.set()
        first.join(10)
        if 'second' in locals():
            second.join(10)

    assert not errors
    assert responses['a'].status_code == responses['b'].status_code == 200
    assert len(transport.calls) == 2
    assert client.app.state.device_ai.active == 0


def test_provider_failure_is_generic_and_replayed_without_retry(client, transport):
    transport.result = RuntimeError(
        'synthetic-provider-crash private detail synthetic-device-key '
        'Synthetic selected text')
    request = payload()
    first = post(client, request)
    assert first.status_code == 502, first.text
    assert first.json()['detail'] == {
        'code': 'device_ai_provider_failed',
        'message': '模型服务暂时无法完成翻译，请稍后重试。'}
    assert 'synthetic-provider-crash' not in first.text
    assert 'private detail' not in first.text
    assert 'synthetic-device-key' not in first.text
    assert '3.5 mM' not in first.text
    assert_no_store(first)
    assert len(transport.calls) == 1

    second = post(client, request)
    assert second.status_code == 502
    assert second.json() == first.json()
    assert len(transport.calls) == 1

    transport.result = {'role': 'assistant', 'content': 'Recovered',
                        'finish_reason': 'stop'}
    recovered = post(client, payload())
    assert recovered.status_code == 200
    assert recovered.json()['translated_text'] == 'Recovered'
    assert len(transport.calls) == 2


@pytest.mark.parametrize('method', ['get', 'options', 'put', 'delete'])
def test_non_post_methods_are_not_callable(client, transport, method):
    response = getattr(client, method)(DEVICE_AI_PATH, headers=AUTHORIZATION)
    assert response.status_code == 405, response.text
    assert response.json()['detail']['code'] == 'method_not_allowed'
    assert response.headers['allow'] == 'POST'
    assert_no_store(response)
    assert transport.calls == []


def test_existing_local_boundary_rejects_cross_origin_and_foreign_host(client, transport):
    response = client.post(DEVICE_AI_PATH, json=payload(),
                           headers={**AUTHORIZATION,
                                    'Origin': 'http://evil.example'})
    assert response.status_code == 403
    assert response.json()['detail']['code'] == 'origin_rejected'
    assert_no_store(response)
    assert transport.calls == []

    response = client.post(DEVICE_AI_PATH, json=payload(),
                           headers={**AUTHORIZATION,
                                    'Sec-Fetch-Site': 'cross-site'})
    assert response.status_code == 403
    assert response.json()['detail']['code'] == 'origin_rejected'
    assert_no_store(response)
    assert transport.calls == []


def test_remote_client_and_foreign_host_are_rejected_by_local_boundary(app, transport):
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('203.0.113.5', 48000)) as remote:
        response = remote.post(DEVICE_AI_PATH, json=payload(),
                               headers=AUTHORIZATION)
        assert response.status_code == 403
        assert response.json()['detail']['code'] == 'local_only'
        assert_no_store(response)
        assert transport.calls == []

    with TestClient(app, base_url='http://evil.example',
                    client=('127.0.0.1', 48000)) as spoofed:
        response = spoofed.post(DEVICE_AI_PATH, json=payload(),
                                headers=AUTHORIZATION)
        assert response.status_code == 403
        assert response.json()['detail']['code'] == 'local_only'
        assert_no_store(response)
        assert transport.calls == []


def test_server_paths_schema_and_legacy_selection_api_are_unchanged(
        client, app, server_provider, transport):
    assert client.get('/api/v1/health').status_code == 200
    assert client.get('/api/v1/reader-capabilities').json() == {
        'source_segments': True, 'storage': 'server'}

    document = client.post(
        '/api/v1/documents',
        files={'file': ('synthetic.pdf', make_pdf(), 'application/pdf')}).json()
    server_request = {'request_id': str(uuid4()),
                      'source_sha256': document['sha256'], 'pages': [1],
                      'text': 'Server selected text', 'target_language': 'zh'}
    response = client.post(
        f"/api/v1/documents/{document['id']}/selection-translation",
        json=server_request)
    assert response.status_code == 200, response.text
    assert response.json()['translated_text'] == '合成服务端译文'
    assert len(server_provider.calls) == 1
    assert transport.calls == []

    with app.state.store.connection() as database:
        assert database.execute('PRAGMA user_version').fetchone()[0] == 27


def test_guest_gateway_serves_device_relay_without_allocating_a_space(
        tmp_path, project, monkeypatch, transport):
    import research_workbench.guest_gateway as gateway_module

    monkeypatch.setattr(gateway_module, 'ROOT', project)
    monkeypatch.setenv('RESEARCH_WORKBENCH_DATA', str(tmp_path / 'owner-data'))
    guest_root = tmp_path / 'guests'
    gateway = create_guest_gateway(guest_root)
    gateway.state.device_ai.transport_factory = (
        lambda key, model: transport)

    with TestClient(gateway, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        assert not any((guest_root / 'spaces').iterdir())
        response = client.post(DEVICE_AI_PATH, json=payload(),
                               headers=AUTHORIZATION)
        assert response.status_code == 200, response.text
        assert response.headers['cache-control'] == 'no-store'
        assert 'set-cookie' not in response.headers
        assert len(transport.calls) == 1
        assert not any((guest_root / 'spaces').iterdir())

        # A malformed guest cookie is irrelevant: this route is outside the
        # credential-gated /api dispatcher and allocates nothing.
        with_bad_cookie = client.post(
            DEVICE_AI_PATH, json=payload(),
            headers={**AUTHORIZATION,
                     'Cookie': '__Host-rw_guest=not-a-valid-token'})
        assert with_bad_cookie.status_code == 200, with_bad_cookie.text
        assert 'set-cookie' not in with_bad_cookie.headers
        assert len(transport.calls) == 2
        assert not any((guest_root / 'spaces').iterdir())
        with gateway.state.guest_registry._connection() as database:
            assert database.execute('SELECT COUNT(*) FROM guests').fetchone()[0] == 0
        assert gateway.state.guest_manager._entries == {}

        assert client.get(DEVICE_AI_PATH).status_code == 405
        denied = client.get('/api/v1/access')
        assert denied.status_code == 401
        assert denied.json()['detail']['code'] == 'guest_session_required'
