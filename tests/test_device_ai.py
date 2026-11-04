"""Bounded unit checks for the explicit device translation relay.

Every model call goes to an injected fake transport; no network, provider
configuration, credential file or guest data is read or written.
"""
import asyncio
import copy
import hashlib
import io
import json
import threading
import urllib.error
from uuid import uuid4

import pytest
from pydantic import ValidationError

from research_workbench import device_ai as device_ai_module
from research_workbench.device_ai import (
    MAX_BODY_BYTES, MAX_RECEIPTS, MAX_RESULT_CHARS, MAX_TEXT_CHARS,
    PROVIDER_BASE_URL, RECEIPT_TTL_SECONDS, SYSTEM_PROMPT, DeviceAiRelay,
    DeviceModelConnection, DeviceSelectionTranslationRequest, request_identity,
)
from research_workbench.models import WorkspaceError
from research_workbench.selection_translation import SYSTEM_PROMPT as SELECTION_PROMPT

DEFAULT = object()


class Clock:
    def __init__(self, now=100.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FakeTransport:
    def __init__(self, result=DEFAULT, on_call=None):
        self.calls = []
        self.keys = []
        self.result = result
        self.on_call = on_call

    def complete_once(self, messages, tools):
        self.calls.append((copy.deepcopy(messages), tools))
        if self.on_call is not None:
            self.on_call(messages, tools)
        result = self.result
        if result is DEFAULT:
            return {'role': 'assistant', 'content': '合成设备译文',
                    'finish_reason': 'stop'}
        if callable(result):
            return result(messages, tools)
        if isinstance(result, Exception):
            raise result
        return copy.deepcopy(result)


def factory(transport):
    def make(api_key, model):
        transport.keys.append((api_key, model))
        return transport
    return make


def relay(transport, clock=None):
    return DeviceAiRelay(clock=clock or Clock(),
                         transport_factory=factory(transport))


def payload(**changes):
    value = {'request_id': str(uuid4()),
             'text': 'Synthetic selected text 3.5 mM [12]',
             'target_language': 'zh', 'model': 'deepseek-chat',
             'confirmed': True}
    value.update(changes)
    return DeviceSelectionTranslationRequest(**value)


def failure(callable_, *arguments):
    with pytest.raises(WorkspaceError) as error:
        callable_(*arguments)
    return error.value


def test_success_sends_only_frozen_fields_once_and_returns_bounded_receipt():
    transport = FakeTransport()
    service = relay(transport)
    request = payload(text='Value 3.5 mM [12], E=mc²', target_language='en',
                      model='deepseek-reasoner')
    response = service.translate('synthetic-user-key', request)

    assert set(response) == {'request_id', 'text_sha256', 'target_language',
                             'model', 'translated_text'}
    assert response['request_id'] == str(request.request_id)
    assert response['text_sha256'] == hashlib.sha256(
        request.text.encode('utf-8')).hexdigest()
    assert response['target_language'] == 'en'
    assert response['model'] == 'deepseek-reasoner'
    assert response['translated_text'] == '合成设备译文'
    assert 'rect' not in response and 'source_sha256' not in response

    assert len(transport.calls) == 1
    messages, tools = transport.calls[0]
    assert tools == []
    assert [message['role'] for message in messages] == ['system', 'user']
    assert messages[0]['content'] == SYSTEM_PROMPT == SELECTION_PROMPT
    assert json.loads(messages[1]['content']) == {
        'text': request.text, 'target_language': 'en'}
    joined = json.dumps(messages, ensure_ascii=False)
    assert 'synthetic-user-key' not in joined
    assert str(request.request_id) not in joined
    assert '"model"' not in joined and 'rect' not in joined
    assert transport.keys == [('synthetic-user-key', 'deepseek-reasoner')]
    assert 'synthetic-user-key' not in json.dumps(response, ensure_ascii=False)


@pytest.mark.parametrize('change', [
    {'document_id': str(uuid4())}, {'source_sha256': 'a' * 64},
    {'pages': [1]}, {'rect': [0, 0, 1, 1]}, {'api_key': 'synthetic'},
    {'url': 'https://example.invalid'}, {'key': 'synthetic'}, {'extra': 1},
    {'text': ''}, {'text': '   '}, {'text': 'x' * (MAX_TEXT_CHARS + 1)},
    {'text': 'bad\x00text'}, {'text': 7}, {'text': None},
    {'text': '\ud800'},
    {'target_language': 'fr'}, {'target_language': 'ZH'},
    {'model': ''}, {'model': 'x' * 121}, {'model': '模型'},
    {'model': 'bad model'}, {'model': 'bad\nmodel'}, {'model': 7},
    {'confirmed': False}, {'confirmed': 1}, {'confirmed': 'true'},
    {'request_id': 'not-a-uuid'},
])
def test_invalid_fields_are_rejected_before_any_model_call(change):
    value = {'request_id': str(uuid4()), 'text': 'Selected text',
             'target_language': 'zh', 'model': 'deepseek-chat',
             'confirmed': True}
    value.update(change)
    with pytest.raises(ValidationError):
        DeviceSelectionTranslationRequest(**value)


def test_bounded_limits_are_inclusive():
    assert payload(text='x' * MAX_TEXT_CHARS,
                   model='x' * 120).confirmed is True


def test_completed_and_failed_request_ids_replay_without_another_model_call():
    transport = FakeTransport()
    service = relay(transport)
    request = payload()

    first = service.translate('synthetic-key', request)
    second = service.translate('synthetic-key', request)
    assert first == second and len(transport.calls) == 1

    conflict = failure(service.translate, 'synthetic-key',
                       payload(request_id=request.request_id,
                               text='Changed selected text'))
    assert (conflict.code, conflict.status) == (
        'device_ai_request_conflict', 409)
    assert len(transport.calls) == 1

    transport.result = {'role': 'assistant', 'content': '',
                        'finish_reason': 'stop'}
    failed_request = payload()
    first_failure = failure(service.translate, 'synthetic-key', failed_request)
    second_failure = failure(service.translate, 'synthetic-key', failed_request)
    assert (first_failure.code, first_failure.status) == (
        'device_ai_output_invalid', 502)
    assert (first_failure.code, first_failure.message) == (
        second_failure.code, second_failure.message)
    assert len(transport.calls) == 2

    transport.result = DEFAULT
    recovered = service.translate('synthetic-key', payload())
    assert recovered['translated_text'] == '合成设备译文'
    assert len(transport.calls) == 3


def test_terminal_receipts_retain_only_fingerprints_results_and_safe_errors():
    transport = FakeTransport()
    service = relay(transport)
    source = 'Sensitive selected source 3.5 mM [12]'
    key = 'synthetic-user-key'
    request = payload(text=source)
    response = service.translate(key, request)

    credential_digest = hashlib.sha256(key.encode('ascii')).hexdigest()
    receipt = service.receipts[(credential_digest, str(request.request_id))]
    assert receipt.identity == request_identity(request)
    assert len(receipt.identity) == 64
    assert receipt.identity != source
    assert 'text' not in receipt.__dict__

    representations = (
        repr(receipt), str(receipt), repr(receipt.__dict__),
        repr(service.receipts),
        json.dumps(receipt.response, ensure_ascii=False),
        json.dumps(response, ensure_ascii=False),
    )
    for value in representations:
        assert source not in value
        assert key not in value

    changed = payload(request_id=request.request_id,
                      text='Sensitive selected source 3.5 mM [13]')
    assert request_identity(changed) != receipt.identity
    conflict = failure(service.translate, key, changed)
    assert (conflict.code, conflict.status) == (
        'device_ai_request_conflict', 409)
    assert len(transport.calls) == 1

    transport.result = {'role': 'assistant', 'content': '',
                        'finish_reason': 'stop'}
    failed_source = 'Another sensitive selected source 4.5 mM [14]'
    failed_request = payload(text=failed_source)
    failed = failure(service.translate, key, failed_request)
    failed_receipt = service.receipts[
        (credential_digest, str(failed_request.request_id))]
    assert failed_receipt.error == (
        failed.code, failed.message, failed.status)
    for value in (repr(failed_receipt), str(failed_receipt),
                  repr(failed_receipt.__dict__), repr(service.receipts)):
        assert failed_source not in value
        assert key not in value


def test_body_bound_is_checked_before_extending(monkeypatch):
    class StreamRequest:
        def __init__(self, chunks):
            self.headers = {}
            self.chunks = chunks

        async def stream(self):
            for chunk in self.chunks:
                yield chunk

    class NoExtend(bytearray):
        def extend(self, chunk):
            raise AssertionError('body extended before the bound check')

    monkeypatch.setattr(device_ai_module, 'bytearray', NoExtend, raising=False)
    request = StreamRequest([b'x' * (MAX_BODY_BYTES + 1)])
    with pytest.raises(WorkspaceError) as error:
        asyncio.run(device_ai_module._read_bounded_body(request))
    assert (error.value.code, error.value.status) == (
        'device_ai_body_too_large', 413)


def test_pending_duplicate_and_admission_limits():
    first_entered, second_entered = threading.Event(), threading.Event()
    release = threading.Event()
    seen = {'count': 0}

    def block(messages, tools):
        seen['count'] += 1
        (first_entered if seen['count'] == 1 else second_entered).set()
        assert release.wait(5)

    transport = FakeTransport(on_call=block)
    service = relay(transport)
    request_a, request_b = payload(), payload()
    results, errors = {}, []

    def work(name, key, request):
        try:
            results[name] = service.translate(key, request)
        except Exception as error:  # pragma: no cover - surfaced below
            errors.append(error)

    first = threading.Thread(target=work,
                             args=('a', 'synthetic-key-a', request_a))
    first.start()
    try:
        assert first_entered.wait(5)
        pending = failure(service.translate, 'synthetic-key-a', request_a)
        assert (pending.code, pending.status) == (
            'device_ai_request_pending', 409)
        same_key = failure(service.translate, 'synthetic-key-a', payload())
        assert (same_key.code, same_key.status) == ('device_ai_busy', 503)

        second = threading.Thread(target=work,
                                  args=('b', 'synthetic-key-b', request_b))
        second.start()
        assert second_entered.wait(5)
        full = failure(service.translate, 'synthetic-key-c', payload())
        assert (full.code, full.status) == ('device_ai_busy', 503)
        assert service.active == 2 and len(service.active_by_credential) == 2
    finally:
        release.set()
        first.join(5)
        if 'second' in locals():
            second.join(5)

    assert not errors
    assert results['a']['translated_text'] == '合成设备译文'
    assert results['b']['translated_text'] == '合成设备译文'
    assert len(transport.calls) == 2
    assert service.active == 0 and service.active_by_credential == {}

    service.translate('synthetic-key-c', payload())
    assert len(transport.calls) == 3


def test_provider_failure_is_safe_terminal_and_releases_admission():
    transport = FakeTransport(result=RuntimeError(
        'synthetic-provider-crash private detail 3.5 mM [12] '
        'synthetic-user-key'))
    service = relay(transport)
    request = payload()

    error = failure(service.translate, 'synthetic-user-key', request)
    assert (error.code, error.message, error.status) == (
        'device_ai_provider_failed', '模型服务暂时无法完成翻译，请稍后重试。', 502)
    assert len(transport.calls) == 1
    surfaced = f'{error.message} {error!s}'
    for marker in ('synthetic-provider-crash', 'private detail', '3.5 mM',
                   'synthetic-user-key', 'Traceback'):
        assert marker not in surfaced

    repeated = failure(service.translate, 'synthetic-user-key', request)
    assert (repeated.code, repeated.message, repeated.status) == (
        error.code, error.message, error.status)
    assert len(transport.calls) == 1
    assert service.active == 0 and service.active_by_credential == {}

    transport.result = DEFAULT
    assert service.translate('synthetic-user-key',
                             payload())['translated_text'] == '合成设备译文'
    assert len(transport.calls) == 2


@pytest.mark.parametrize('result', [
    {'role': 'assistant', 'content': '', 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': '   ', 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': None, 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': 'Answer',
     'tool_calls': [{'id': 'call-1', 'type': 'function'}],
     'finish_reason': 'tool_calls'},
    {'role': 'assistant', 'content': 'Answer', 'finish_reason': 'length'},
    {'role': 'assistant', 'content': 'Answer', 'finish_reason': 'tool_calls'},
    {'role': 'assistant', 'content': 'x' * (MAX_RESULT_CHARS + 1),
     'finish_reason': 'stop'},
    'not-a-message',
])
def test_invalid_provider_output_is_rejected_and_admission_is_released(result):
    transport = FakeTransport(result=result)
    service = relay(transport)
    request = payload()
    error = failure(service.translate, 'synthetic-key', request)
    assert (error.code, error.status) == ('device_ai_output_invalid', 502)
    assert len(transport.calls) == 1
    assert service.active == 0

    repeated = failure(service.translate, 'synthetic-key', request)
    assert repeated.code == error.code and len(transport.calls) == 1

    transport.result = DEFAULT
    assert service.translate('synthetic-key',
                             payload())['translated_text'] == '合成设备译文'
    assert len(transport.calls) == 2


def test_output_limit_is_6000_characters():
    transport = FakeTransport(result={
        'role': 'assistant', 'content': 'y' * MAX_RESULT_CHARS,
        'finish_reason': 'stop'})
    response = relay(transport).translate('synthetic-key', payload())
    assert len(response['translated_text']) == MAX_RESULT_CHARS


def test_terminal_receipts_expire_and_evict_oldest_only():
    clock = Clock()
    transport = FakeTransport()
    service = relay(transport, clock)
    requests = [payload() for _ in range(MAX_RECEIPTS)]
    for request in requests:
        service.translate('synthetic-key', request)
        clock.advance(1)
    assert len(service.receipts) == MAX_RECEIPTS

    clock.advance(RECEIPT_TTL_SECONDS + 1)
    service.translate('synthetic-key', payload())
    assert all(receipt.status != 'pending' for receipt in service.receipts.values())
    assert len(service.receipts) <= MAX_RECEIPTS

    expiry_clock = Clock()
    expiry_transport = FakeTransport()
    expiring = relay(expiry_transport, expiry_clock)
    expiring_request = payload()
    expiring.translate('synthetic-key', expiring_request)
    assert len(expiry_transport.calls) == 1
    expiry_clock.advance(RECEIPT_TTL_SECONDS + 1)
    expiring.translate('synthetic-key', expiring_request)
    assert len(expiry_transport.calls) == 2

    bounded_clock = Clock()
    bounded_transport = FakeTransport()
    bounded = relay(bounded_transport, bounded_clock)
    first = payload()
    bounded.translate('synthetic-key', first)
    for _ in range(MAX_RECEIPTS + 4):
        bounded.translate('synthetic-key', payload())
        bounded_clock.advance(1)
    assert len(bounded.receipts) == MAX_RECEIPTS
    assert len(bounded_transport.calls) == MAX_RECEIPTS + 5
    # The oldest terminal receipt was evicted, so replaying it calls again.
    bounded.translate('synthetic-key', first)
    assert len(bounded_transport.calls) == MAX_RECEIPTS + 6


def test_pending_receipt_is_never_evicted_or_counted_as_terminal():
    clock = Clock()
    transport = FakeTransport()
    service = relay(transport, clock)
    for _ in range(MAX_RECEIPTS):
        service.translate('synthetic-key', payload())
        clock.advance(1)
    assert len(service.receipts) == MAX_RECEIPTS

    entered, release = threading.Event(), threading.Event()

    def block(messages, tools):
        entered.set()
        assert release.wait(5)

    transport.on_call = block
    active_request = payload()
    worker = threading.Thread(target=service.translate,
                              args=('synthetic-key', active_request))
    worker.start()
    try:
        assert entered.wait(5)
        pending = failure(service.translate, 'synthetic-key', active_request)
        assert pending.code == 'device_ai_request_pending'
        # A second admitted call finishes and prunes; the pending receipt stays.
        transport.on_call = None
        service.translate('synthetic-other-key', payload())
        still_pending = failure(service.translate, 'synthetic-key',
                                active_request)
        assert still_pending.code == 'device_ai_request_pending'
    finally:
        release.set()
        worker.join(5)
    completed = service.translate('synthetic-key', active_request)
    assert completed['translated_text'] == '合成设备译文'


class Transport:
    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    def open(self, request, timeout):
        self.requests.append(request)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(response)


def chat_response(content='Synthetic answer'):
    return json.dumps({'choices': [{
        'message': {'role': 'assistant', 'content': content},
        'finish_reason': 'stop'}]}).encode()


def test_device_connection_is_fixed_memory_endpoint_and_one_shot():
    transport = Transport([chat_response('Fixed endpoint answer')])
    connection = DeviceModelConnection(
        'synthetic-user-key', 'deepseek-chat', opener=transport)
    config, source = connection.config()
    assert source == 'memory'
    assert config == {'base_url': PROVIDER_BASE_URL,
                      'model': 'deepseek-chat',
                      'api_key': 'synthetic-user-key'}
    assert connection.path is None and connection.inherited is None

    result = connection.complete_once(
        [{'role': 'user', 'content': 'Synthetic input'}], [])
    assert result['content'] == 'Fixed endpoint answer'
    assert result['finish_reason'] == 'stop'
    assert len(transport.requests) == 1
    request = transport.requests[0]
    assert request.full_url == PROVIDER_BASE_URL + '/chat/completions'
    assert request.get_method() == 'POST'
    assert request.headers['Authorization'] == 'Bearer synthetic-user-key'
    value = json.loads(request.data)
    assert value['model'] == 'deepseek-chat'
    assert 'tools' not in value and value['stream'] is False

    failing = Transport([urllib.error.URLError('synthetic disconnect'),
                         chat_response('Must not be retried')])
    failing_connection = DeviceModelConnection(
        'synthetic-user-key', 'deepseek-chat', opener=failing)
    error = failure(failing_connection.complete_once,
                    [{'role': 'user', 'content': 'Synthetic'}], [])
    assert error.code == 'agent_provider_unavailable'
    assert len(failing.requests) == 1

    for url in ('https://api.deepseek.com/v1/', 'https://api.deepseek.com',
                'https://api.deepseek.com/v2', 'https://example.invalid/v1',
                'http://api.deepseek.com/v1'):
        with pytest.raises(WorkspaceError) as invalid:
            DeviceModelConnection.validate(
                {'base_url': url, 'model': 'deepseek-chat',
                 'api_key': 'synthetic-user-key'})
        assert invalid.value.code in ('device_ai_endpoint_not_allowed',
                                      'agent_invalid_provider')
