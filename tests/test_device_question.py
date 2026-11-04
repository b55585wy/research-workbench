"""Bounded unit checks for the explicit device-material question relay.

Every model call goes to an injected fake transport; no network, provider
configuration, credential file, guest space or identity data is read or
written.  The shared relay admission and receipts are exercised through both
the question and the legacy selected-text translation operations.
"""
import asyncio
import copy
import hashlib
import json
import threading
from uuid import uuid4

import pytest
from pydantic import ValidationError

from research_workbench import device_ai as device_ai_module
from research_workbench.device_ai import (
    DeviceAiRelay, DeviceSelectionTranslationRequest, request_identity,
)
from research_workbench.device_question import (
    DOMAIN, MAX_ANSWER_CHARS, MAX_BODY_BYTES, MAX_COMBINED_CHARS,
    MAX_HISTORY_TOTAL, MAX_MATERIAL_CHARS, MAX_MATERIAL_TOTAL, MAX_MATERIALS,
    MAX_QUESTION_CHARS, SYSTEM_PROMPT, DeviceQuestionRequest, ask_question,
    payload_sha256, question_identity, question_scope,
)
from research_workbench.models import WorkspaceError

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
            return {'role': 'assistant', 'content': '合成设备回答',
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


def material(label, text):
    return {'label': label, 'text': text}


def history_pair(question='Prior synthetic question', answer='Prior answer'):
    return [{'role': 'user', 'content': question},
            {'role': 'assistant', 'content': answer}]


def payload(**changes):
    value = {'request_id': str(uuid4()),
             'question': 'Synthetic question about 3.5 mM [12]?',
             'materials': [material('M1', 'Synthetic material 3.5 mM [12]')],
             'history': [],
             'answer_language': 'zh',
             'model': 'deepseek-flash',
             'confirmed': True}
    value.update(changes)
    return DeviceQuestionRequest(**value)


def translation_payload(**changes):
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


def test_success_sends_only_confirmed_scope_once_and_returns_bounded_receipt():
    transport = FakeTransport()
    service = relay(transport)
    request = payload(
        question='What does the report say about 3.5 mM [12]?',
        materials=[material('M1', 'First synthetic material'),
                   material('M2', 'Second synthetic material, E=mc²')],
        history=history_pair('Earlier question', 'Earlier answer'),
        answer_language='en', model='deepseek-flash')
    response = ask_question(service, 'synthetic-user-key', request)

    assert set(response) == {'request_id', 'payload_sha256', 'model', 'answer'}
    assert response['request_id'] == str(request.request_id)
    assert response['payload_sha256'] == payload_sha256(request)
    assert response['model'] == 'deepseek-flash'
    assert response['answer'] == '合成设备回答'
    assert 'key' not in response and 'question' not in response

    assert len(transport.calls) == 1
    messages, tools = transport.calls[0]
    assert tools == []
    assert [message['role'] for message in messages] == ['system', 'user']
    assert messages[0]['content'] == SYSTEM_PROMPT
    assert json.loads(messages[1]['content']) == {
        'question': request.question,
        'materials': [
            {'label': 'M1', 'text': 'First synthetic material'},
            {'label': 'M2', 'text': 'Second synthetic material, E=mc²'}],
        'history': [
            {'role': 'user', 'content': 'Earlier question'},
            {'role': 'assistant', 'content': 'Earlier answer'}],
        'answer_language': 'en',
    }
    joined = json.dumps(messages, ensure_ascii=False)
    for marker in ('synthetic-user-key', str(request.request_id),
                   '"model"', 'document_id', 'source_sha256', 'page',
                   'rect', 'note_id', 'title', 'url'):
        assert marker not in joined
    assert transport.keys == [('synthetic-user-key', 'deepseek-flash')]
    assert 'synthetic-user-key' not in json.dumps(response, ensure_ascii=False)


def test_plain_question_without_materials_or_history_is_allowed():
    transport = FakeTransport()
    request = payload(question='General synthetic question', materials=[],
                      history=[])
    response = ask_question(relay(transport), 'synthetic-key', request)
    assert response['answer'] == '合成设备回答'
    messages, tools = transport.calls[0]
    assert tools == []
    assert json.loads(messages[1]['content']) == {
        'question': 'General synthetic question', 'materials': [],
        'history': [], 'answer_language': 'zh'}


@pytest.mark.parametrize('change', [
    {'document_id': str(uuid4())}, {'source_sha256': 'a' * 64},
    {'page': 1}, {'pages': [1]}, {'rect': [0, 0, 1, 1]},
    {'note_id': str(uuid4())}, {'title': 'Synthetic title'},
    {'url': 'https://example.invalid'}, {'image': 'data:image/png;base64,AA'},
    {'tool': 'read_pdf'}, {'tools': []}, {'api_key': 'synthetic-secret-value'},
    {'key': 'synthetic-secret-value'}, {'extra': 1},
    {'question': ''}, {'question': '   '},
    {'question': 'x' * (MAX_QUESTION_CHARS + 1)},
    {'question': 'bad\x00question'}, {'question': '\ud800'}, {'question': 7},
    {'question': None},
    {'materials': [material('M1', '')]},
    {'materials': [material('M1', '   ')]},
    {'materials': [material('M1', 'x' * (MAX_MATERIAL_CHARS + 1))]},
    {'materials': [material('M1', 'bad\x00text')]},
    {'materials': [material('M1', '\ud800')]},
    {'materials': [material('M1', 7)]},
    {'materials': [material('M1', None)]},
    {'materials': [{'label': 'M1', 'text': 'text', 'page': 1}]},
    {'materials': [{'label': 'M1', 'text': 'text', 'text_kind': 'note'}]},
    {'materials': [material('M2', 'first')]},
    {'materials': [material('M1', 'first'), material('M1', 'second')]},
    {'materials': [material('M1', 'a'), material('M3', 'b')]},
    {'materials': [material('M1', 'a'), material('M2', 'b'),
                   material('M3', 'c'), material('M4', 'd'),
                   material('M4', 'e')]},
    {'materials': [{'label': 'M1'}]},
    {'materials': 'M1 text'},
    {'materials': [material('M1', 'x' * 1501),
                   material('M2', 'x' * 1501),
                   material('M3', 'x' * 1501),
                   material('M4', 'x' * 1501)]},
    {'history': [{'role': 'user', 'content': 'only one'}]},
    {'history': history_pair() + [{'role': 'user', 'content': 'extra'}]},
    {'history': [{'role': 'assistant', 'content': 'answer'},
                 {'role': 'user', 'content': 'question'}]},
    {'history': [{'role': 'user', 'content': 'one'},
                 {'role': 'user', 'content': 'two'}]},
    {'history': [{'role': 'user', 'content': 'q', 'document_id': str(uuid4())},
                 {'role': 'assistant', 'content': 'a'}]},
    {'history': [{'role': 'system', 'content': 'q'},
                 {'role': 'assistant', 'content': 'a'}]},
    {'history': [{'role': 'user', 'content': ''},
                 {'role': 'assistant', 'content': 'a'}]},
    {'history': [{'role': 'user', 'content': 'q'},
                 {'role': 'assistant', 'content': '   '}]},
    {'history': [{'role': 'user', 'content': 'bad\x00q'},
                 {'role': 'assistant', 'content': 'a'}]},
    {'history': [{'role': 'user', 'content': 'q'},
                 {'role': 'assistant', 'content': '\ud800'}]},
    {'history': [{'role': 'user', 'content': 7},
                 {'role': 'assistant', 'content': 'a'}]},
    {'history': [{'role': 'user', 'content': 'x' * 4001},
                 {'role': 'assistant', 'content': 'x' * 4000}]},
    {'history': 'prior pair'},
    {'answer_language': 'fr'}, {'answer_language': 'ZH'},
    {'answer_language': 7},
    {'model': ''}, {'model': 'x' * 121}, {'model': '模型'},
    {'model': 'bad model'}, {'model': 'bad\nmodel'}, {'model': 7},
    {'confirmed': False}, {'confirmed': 1}, {'confirmed': 'true'},
    {'request_id': 'not-a-uuid'},
])
def test_invalid_scope_is_rejected_before_any_model_call(change):
    value = {'request_id': str(uuid4()),
             'question': 'Synthetic question', 'materials': [],
             'history': [], 'answer_language': 'zh',
             'model': 'deepseek-flash', 'confirmed': True}
    value.update(change)
    with pytest.raises(ValidationError):
        DeviceQuestionRequest(**value)


def test_bounded_limits_are_inclusive():
    request = payload(
        question='q' * MAX_QUESTION_CHARS,
        materials=[material('M1', 'a' * 1500), material('M2', 'b' * 1500),
                   material('M3', 'c' * 1500), material('M4', 'd' * 1500)],
        history=[{'role': 'user', 'content': 'u' * 4000},
                 {'role': 'assistant', 'content': 'a' * 4000}],
        model='x' * 120)
    assert sum(len(item.text) for item in request.materials) == MAX_MATERIAL_TOTAL
    assert len(request.question) == MAX_QUESTION_CHARS
    assert MAX_QUESTION_CHARS + MAX_MATERIAL_TOTAL + MAX_HISTORY_TOTAL == (
        MAX_COMBINED_CHARS)
    assert len(request.history) == 2


def test_materials_and_history_are_bounded_and_atomic_contract():
    # Four sequential labels are the wire maximum.
    accepted = payload(materials=[material('M%d' % index, 'text %d' % index)
                                 for index in range(1, MAX_MATERIALS + 1)])
    assert [item.label for item in accepted.materials] == ['M1', 'M2', 'M3', 'M4']
    with pytest.raises(ValidationError):
        payload(materials=[material('M%d' % index, 'text')
                           for index in range(1, MAX_MATERIALS + 2)])


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
        asyncio.run(device_ai_module._read_bounded_body(
            request, MAX_BODY_BYTES))
    assert (error.value.code, error.value.status) == (
        'device_ai_body_too_large', 413)
    assert MAX_BODY_BYTES == 65536


def test_response_fingerprint_is_canonical_and_excludes_operational_fields():
    request = payload(
        question='Synthetic question 3.5 mM [12]',
        materials=[material('M1', 'Material with E=mc² and 4.5 μM')],
        history=history_pair('Prior 3.5 mM question', 'Prior 4.5 μM answer'),
        answer_language='en', model='deepseek-flash')
    scope = question_scope(request)
    assert set(scope) == {'question', 'materials', 'history',
                          'answer_language', 'model'}
    canonical = json.dumps(scope, sort_keys=True, ensure_ascii=False,
                           allow_nan=False, separators=(',', ':'))
    expected = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    assert payload_sha256(request) == expected
    # Nested keys are sorted too, and non-ASCII stays UTF-8.
    assert canonical.startswith('{"answer_language":')
    assert '"materials":[{"label":"M1","text":' in canonical
    assert '"history":[{"content":"Prior 3.5 mM question","role":"user"},' in canonical
    assert 'E=mc²' in canonical and '\\u' not in canonical

    same_scope = payload(
        request_id=str(uuid4()),
        question=request.question, materials=[material('M1', 'Material with E=mc² and 4.5 μM')],
        history=history_pair('Prior 3.5 mM question', 'Prior 4.5 μM answer'),
        answer_language='en', model='deepseek-flash')
    assert payload_sha256(same_scope) == payload_sha256(request)
    assert question_identity(same_scope) == question_identity(request)

    changed = payload(
        question=request.question + ' changed',
        materials=[material('M1', 'Material with E=mc² and 4.5 μM')],
        history=history_pair('Prior 3.5 mM question', 'Prior 4.5 μM answer'),
        answer_language='en', model='deepseek-flash')
    assert payload_sha256(changed) != payload_sha256(request)
    # The receipt identity is domain-scoped and is not the raw scope.
    assert question_identity(request) == hashlib.sha256(
        ('%s:%s' % (DOMAIN, payload_sha256(request))).encode('ascii')).hexdigest()
    assert request.question not in question_identity(request)
    assert DOMAIN == 'device_question'


def test_terminal_receipts_retain_only_fingerprints_results_and_safe_errors():
    transport = FakeTransport()
    service = relay(transport)
    key = 'synthetic-user-key'
    request = payload(question='Sensitive synthetic question 3.5 mM [12]',
                      materials=[material('M1', 'Sensitive material text')])
    response = ask_question(service, key, request)

    credential_digest = hashlib.sha256(key.encode('ascii')).hexdigest()
    receipt = service.receipts[(DOMAIN, credential_digest, str(request.request_id))]
    assert receipt.identity == question_identity(request)
    assert len(receipt.identity) == 64
    assert 'question' not in receipt.__dict__
    assert 'materials' not in receipt.__dict__

    representations = (
        repr(receipt), str(receipt), repr(receipt.__dict__),
        repr(service.receipts),
        json.dumps(receipt.response, ensure_ascii=False),
        json.dumps(response, ensure_ascii=False),
    )
    for value in representations:
        assert 'Sensitive synthetic question' not in value
        assert 'Sensitive material text' not in value
        assert key not in value

    conflict = failure(
        ask_question, service, key,
        payload(request_id=request.request_id,
                question='Changed sensitive question'))
    assert (conflict.code, conflict.status) == (
        'device_question_request_conflict', 409)
    assert len(transport.calls) == 1

    transport.result = {'role': 'assistant', 'content': '',
                        'finish_reason': 'stop'}
    failed_request = payload(question='Another sensitive question')
    failed = failure(ask_question, service, key, failed_request)
    failed_receipt = service.receipts[
        (DOMAIN, credential_digest, str(failed_request.request_id))]
    assert failed_receipt.error == (failed.code, failed.message, failed.status)
    for value in (repr(failed_receipt), str(failed_receipt),
                  repr(failed_receipt.__dict__), repr(service.receipts)):
        assert 'Another sensitive question' not in value
        assert key not in value


def test_question_shares_admission_and_receipts_with_translation():
    first_entered, second_entered = threading.Event(), threading.Event()
    release = threading.Event()
    seen = {'count': 0}

    def block(messages, tools):
        seen['count'] += 1
        (first_entered if seen['count'] == 1 else second_entered).set()
        assert release.wait(5)

    transport = FakeTransport(on_call=block)
    service = relay(transport)
    translation = translation_payload()
    question = payload()
    results, errors = {}, []

    def work(name, call, *arguments):
        try:
            results[name] = call(*arguments)
        except Exception as error:  # pragma: no cover - surfaced below
            errors.append(error)

    first = threading.Thread(target=work,
                             args=('translation', service.translate,
                                   'synthetic-key-a', translation))
    first.start()
    second = None
    try:
        assert first_entered.wait(5)
        # The translation and the question can occupy the two shared slots.
        pending_same_translation = failure(
            service.translate, 'synthetic-key-a', translation)
        assert pending_same_translation.code == 'device_ai_request_pending'
        cross_busy = failure(
            ask_question, service, 'synthetic-key-a', payload())
        assert (cross_busy.code, cross_busy.status) == (
            'device_question_busy', 503)

        second = threading.Thread(
            target=work, args=('question', ask_question, service,
                               'synthetic-key-b', question))
        second.start()
        assert second_entered.wait(5)
        full_question = failure(
            ask_question, service, 'synthetic-key-c', payload())
        assert (full_question.code, full_question.status) == (
            'device_question_busy', 503)
        full_translation = failure(
            service.translate, 'synthetic-key-c', translation_payload())
        assert (full_translation.code, full_translation.status) == (
            'device_ai_busy', 503)
        assert service.active == 2 and len(service.active_by_credential) == 2
    finally:
        release.set()
        first.join(10)
        if second is not None:
            second.join(10)

    assert not errors
    assert results['translation']['translated_text'] == '合成设备回答'
    assert results['question']['answer'] == '合成设备回答'
    assert len(transport.calls) == 2
    assert service.active == 0 and service.active_by_credential == {}


def test_same_request_id_is_safe_across_translation_and_question():
    transport = FakeTransport()
    service = relay(transport)
    shared_id = str(uuid4())
    translation = translation_payload(request_id=shared_id)
    question = payload(request_id=shared_id)

    translated = service.translate('synthetic-key', translation)
    answered = ask_question(service, 'synthetic-key', question)
    assert translated['request_id'] == answered['request_id'] == shared_id
    assert translated['translated_text'] == '合成设备回答'
    assert answered['answer'] == '合成设备回答'
    assert translated['text_sha256'] != answered['payload_sha256']
    assert set(translated) != set(answered)
    assert len(transport.calls) == 2

    # Each operation replays only its own receipt.
    assert ask_question(service, 'synthetic-key', question) == answered
    assert service.translate('synthetic-key', translation) == translated
    assert len(transport.calls) == 2

    # A question never records a translation receipt and vice versa.
    keys = set(service.receipts)
    assert (DOMAIN, hashlib.sha256(b'synthetic-key').hexdigest(),
            shared_id) in keys


def test_provider_failure_is_safe_terminal_and_releases_admission():
    transport = FakeTransport(result=RuntimeError(
        'synthetic-provider-crash private detail 3.5 mM [12] '
        'synthetic-user-key'))
    service = relay(transport)
    request = payload()

    error = failure(ask_question, service, 'synthetic-user-key', request)
    assert (error.code, error.message, error.status) == (
        'device_question_provider_failed', '模型服务暂时无法完成回答，请稍后重试。',
        502)
    assert len(transport.calls) == 1
    surfaced = f'{error.message} {error!s}'
    for marker in ('synthetic-provider-crash', 'private detail', '3.5 mM',
                   'synthetic-user-key', 'Traceback'):
        assert marker not in surfaced

    repeated = failure(ask_question, service, 'synthetic-user-key', request)
    assert (repeated.code, repeated.message, repeated.status) == (
        error.code, error.message, error.status)
    assert len(transport.calls) == 1
    assert service.active == 0 and service.active_by_credential == {}

    transport.result = DEFAULT
    assert ask_question(
        service, 'synthetic-user-key', payload())['answer'] == '合成设备回答'
    assert len(transport.calls) == 2


def test_unexpected_worker_failure_uses_detail_free_question_fallback():
    def broken(api_key, model):
        raise RuntimeError('synthetic unexpected failure with synthetic-key')

    service = DeviceAiRelay(clock=Clock(), transport_factory=broken)
    request = payload()
    error = failure(ask_question, service, 'synthetic-key', request)
    assert (error.code, error.message, error.status) == (
        'device_question_failed', '回答未完成，请稍后重试。', 502)
    assert 'synthetic unexpected failure' not in f'{error} {error.message}'
    repeated = failure(ask_question, service, 'synthetic-key', request)
    assert repeated.code == error.code
    assert service.active == 0


@pytest.mark.parametrize('result', [
    {'role': 'assistant', 'content': '', 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': '   ', 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': None, 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': 'Answer',
     'tool_calls': [{'id': 'call-1', 'type': 'function'}],
     'finish_reason': 'tool_calls'},
    {'role': 'assistant', 'content': 'Answer', 'finish_reason': 'length'},
    {'role': 'assistant', 'content': 'Answer', 'finish_reason': 'tool_calls'},
    {'role': 'assistant', 'content': 'x' * (MAX_ANSWER_CHARS + 1),
     'finish_reason': 'stop'},
    'not-a-message',
])
def test_invalid_provider_output_is_rejected_and_admission_is_released(result):
    transport = FakeTransport(result=result)
    service = relay(transport)
    request = payload()
    error = failure(ask_question, service, 'synthetic-key', request)
    assert (error.code, error.status) == ('device_question_output_invalid', 502)
    assert len(transport.calls) == 1
    assert service.active == 0

    repeated = failure(ask_question, service, 'synthetic-key', request)
    assert repeated.code == error.code and len(transport.calls) == 1

    transport.result = DEFAULT
    assert ask_question(
        service, 'synthetic-key', payload())['answer'] == '合成设备回答'
    assert len(transport.calls) == 2


def test_answer_limit_is_6000_characters():
    transport = FakeTransport(result={
        'role': 'assistant', 'content': 'y' * MAX_ANSWER_CHARS,
        'finish_reason': 'stop'})
    response = ask_question(relay(transport), 'synthetic-key', payload())
    assert len(response['answer']) == MAX_ANSWER_CHARS


def test_legacy_translation_contract_is_unchanged():
    transport = FakeTransport()
    service = relay(transport)
    request = translation_payload(text='x' * 3000, model='x' * 120)
    response = service.translate('synthetic-key', request)
    assert set(response) == {'request_id', 'text_sha256', 'target_language',
                             'model', 'translated_text'}
    assert response['text_sha256'] == hashlib.sha256(
        request.text.encode('utf-8')).hexdigest()
    assert service.receipts[
        (hashlib.sha256(b'synthetic-key').hexdigest(),
         str(request.request_id))].identity == request_identity(request)
    assert len(transport.calls) == 1
