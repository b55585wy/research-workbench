import copy
import hashlib
import io
import json
import threading
import urllib.error
from uuid import uuid4

import pytest
from pydantic import ValidationError

from conftest import make_pdf
from research_workbench.agent_models import ModelSettings
from research_workbench.agent_provider import ModelConnection
from research_workbench.models import WorkspaceError
from research_workbench.selection_translation import (
    CACHE_TTL_SECONDS, MAX_CACHE_ENTRIES, MAX_RESULT_CHARS, MAX_TEXT_CHARS,
    SelectionTranslation, SelectionTranslationRequest)
from research_workbench.store import Store, timestamp

DEFAULT = object()


def add_document(store, pages=2):
    identifier = str(uuid4())
    data = make_pdf(pages)
    (store.files / f'{identifier}.pdf').write_bytes(data)
    record = dict(id=identifier, title='Synthetic selection', original_filename='synthetic.pdf',
                  page_count=pages, byte_size=len(data),
                  sha256=hashlib.sha256(data).hexdigest(), created_at=timestamp())
    store.add_document(record)
    return record


def request(document, **changes):
    value = dict(request_id=str(uuid4()), source_sha256=document['sha256'], pages=[1],
                 text='Synthetic selected text 3.5 mM [12]', target_language='zh')
    value.update(changes)
    return SelectionTranslationRequest(**value)


class FakeProvider:
    def __init__(self, result=DEFAULT, on_call=None):
        self.calls = []
        self.result = result
        self.on_call = on_call

    def complete_once(self, messages, tools):
        self.calls.append((copy.deepcopy(messages), tools))
        if self.on_call is not None:
            self.on_call(messages, tools)
        result = self.result
        if result is DEFAULT:
            return {'role': 'assistant', 'content': '合成译文', 'finish_reason': 'stop'}
        if callable(result):
            return result(messages, tools)
        if isinstance(result, Exception):
            raise result
        return copy.deepcopy(result)


class LegacyProvider:
    def __init__(self, result=None):
        self.calls = []
        self.result = result or {'role': 'assistant', 'content': '旧通道译文', 'finish_reason': 'stop'}

    def complete(self, messages, tools):
        self.calls.append((copy.deepcopy(messages), tools))
        return copy.deepcopy(self.result)


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / 'workspace')


@pytest.fixture
def document(store):
    return add_document(store)


def test_success_uses_only_selected_text_as_untrusted_json(store, document):
    provider = FakeProvider()
    service = SelectionTranslation(store, provider)
    payload = request(document, pages=[1, 2], text='Value 3.5 mM [12], E=mc^2',
                      target_language='en')
    response = service.translate(document['id'], payload)
    assert response == {
        'request_id': str(payload.request_id), 'document_id': document['id'],
        'source_sha256': document['sha256'], 'pages': [1, 2],
        'target_language': 'en', 'translated_text': '合成译文'}
    assert 'rect' not in response
    assert len(provider.calls) == 1
    messages, tools = provider.calls[0]
    assert tools is None
    assert [message['role'] for message in messages] == ['system', 'user']
    assert json.loads(messages[1]['content']) == {
        'target_language': 'en', 'text': 'Value 3.5 mM [12], E=mc^2'}
    joined = json.dumps(messages, ensure_ascii=False)
    assert document['id'] not in joined and document['sha256'] not in joined
    assert '"pages"' not in joined and 'rect' not in joined
    assert 'untrusted' in messages[0]['content'] and 'no commentary' in messages[0]['content']


@pytest.mark.parametrize('change', [
    {'extra': 1}, {'rect': [0, 0, 1, 1]}, {'model': 'fake'}, {'api_key': 'fake'},
    {'request_id': 'not-a-uuid'}, {'source_sha256': 'A' * 64},
    {'source_sha256': 'a' * 63}, {'source_sha256': 'g' * 64},
    {'pages': []}, {'pages': [0]}, {'pages': [201]}, {'pages': [1, 1]}, {'pages': [2, 1]},
    {'pages': [True]}, {'pages': [1.5]}, {'pages': list(range(1, 22))},
    {'text': ''}, {'text': '   '}, {'text': 'x' * (MAX_TEXT_CHARS + 1)},
    {'text': 'bad\x00text'}, {'target_language': 'fr'}, {'target_language': 'ZH'}])
def test_invalid_fields_are_rejected_before_any_model_call(change):
    payload = dict(request_id=str(uuid4()), source_sha256='a' * 64, pages=[1],
                   text='Selected text', target_language='zh')
    payload.update(change)
    with pytest.raises(ValidationError):
        SelectionTranslationRequest(**payload)


def test_source_hash_page_trash_missing_file_and_other_store_scope(store, document):
    provider = FakeProvider()
    service = SelectionTranslation(store, provider)
    with pytest.raises(WorkspaceError) as error:
        service.translate(document['id'], request(document, source_sha256='b' * 64))
    assert (error.value.code, error.value.status) == ('source_changed', 409)

    with pytest.raises(WorkspaceError) as error:
        service.translate(document['id'], request(document, pages=[3]))
    assert (error.value.code, error.value.status) == ('invalid_page', 422)

    with pytest.raises(WorkspaceError) as error:
        service.translate(str(uuid4()), request(document))
    assert (error.value.code, error.value.status) == ('not_found', 404)

    other = Store(store.root.parent / 'other-workspace')
    other_document = add_document(other, pages=1)
    with pytest.raises(WorkspaceError) as error:
        service.translate(other_document['id'], request(other_document))
    assert (error.value.code, error.value.status) == ('not_found', 404)

    missing = add_document(store, pages=1)
    (store.files / f"{missing['id']}.pdf").unlink()
    with pytest.raises(WorkspaceError) as error:
        service.translate(missing['id'], request(missing))
    assert (error.value.code, error.value.status) == ('source_missing', 409)

    with store.connection() as database:
        database.execute('INSERT INTO document_trash VALUES (?,?)',
                         (document['id'], timestamp()))
    with pytest.raises(WorkspaceError) as error:
        service.translate(document['id'], request(document))
    assert (error.value.code, error.value.status) == ('document_trashed', 410)
    assert provider.calls == []


@pytest.mark.parametrize('result', [
    {'role': 'assistant', 'content': '', 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': '   ', 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': None, 'finish_reason': 'stop'},
    {'role': 'assistant', 'content': 'Answer',
     'tool_calls': [{'id': 'call-1', 'type': 'function'}], 'finish_reason': 'tool_calls'},
    {'role': 'assistant', 'content': 'Answer', 'finish_reason': 'length'},
    {'role': 'assistant', 'content': 'Answer', 'finish_reason': 'tool_calls'},
    {'role': 'assistant', 'content': 'x' * (MAX_RESULT_CHARS + 1),
     'finish_reason': 'stop'},
    'not-a-message'])
def test_invalid_provider_output_is_rejected_and_admission_is_released(store, document, result):
    provider = FakeProvider(result=result)
    service = SelectionTranslation(store, provider)
    payload = request(document)
    with pytest.raises(WorkspaceError) as error:
        service.translate(document['id'], payload)
    assert (error.value.code, error.value.status) == ('selection_translation_output_invalid', 502)
    assert len(provider.calls) == 1

    with pytest.raises(WorkspaceError) as repeated:
        service.translate(document['id'], payload)
    assert repeated.value.code == error.value.code
    assert len(provider.calls) == 1

    provider.result = {'role': 'assistant', 'content': 'Recovered', 'finish_reason': 'stop'}
    assert service.translate(document['id'], request(document))['translated_text'] == 'Recovered'
    assert len(provider.calls) == 2


def test_concurrent_duplicate_busy_and_changed_payload(store, document):
    entered, release = threading.Event(), threading.Event()

    def block(messages, tools):
        entered.set()
        assert release.wait(5)

    provider = FakeProvider(on_call=block)
    service = SelectionTranslation(store, provider)
    payload = request(document)
    responses, failures = [], []

    def work():
        try:
            responses.append(service.translate(document['id'], payload))
        except Exception as error:  # pragma: no cover - surfaced by assertions
            failures.append(error)
        finally:
            release.set()

    worker = threading.Thread(target=work)
    worker.start()
    try:
        assert entered.wait(5)
        with pytest.raises(WorkspaceError) as error:
            service.translate(document['id'], payload)
        assert (error.value.code, error.value.status) == ('selection_translation_pending', 409)

        with pytest.raises(WorkspaceError) as error:
            service.translate(document['id'], request(document))
        assert (error.value.code, error.value.status) == ('selection_translation_busy', 429)

        with pytest.raises(WorkspaceError) as error:
            service.translate(document['id'], request(document, request_id=payload.request_id,
                                                          text='Changed selected text'))
        assert (error.value.code, error.value.status) == ('selection_translation_conflict', 409)
    finally:
        release.set()
        worker.join(5)
    assert not failures and responses[0]['translated_text'] == '合成译文'
    assert len(provider.calls) == 1


def test_completed_and_failed_dedupe_with_explicit_new_id(store, document):
    provider = FakeProvider(result={'role': 'assistant', 'content': 'Same answer',
                                    'finish_reason': 'stop'})
    service = SelectionTranslation(store, provider)
    payload = request(document)
    first = service.translate(document['id'], payload)
    second = service.translate(document['id'], payload)
    assert first == second and len(provider.calls) == 1

    failure = FakeProvider(result={'role': 'assistant', 'content': '',
                                   'finish_reason': 'stop'})
    failing = SelectionTranslation(store, failure)
    bad = request(document)
    with pytest.raises(WorkspaceError) as first_error:
        failing.translate(document['id'], bad)
    with pytest.raises(WorkspaceError) as second_error:
        failing.translate(document['id'], bad)
    assert first_error.value.code == second_error.value.code
    assert len(failure.calls) == 1
    failure.result = {'role': 'assistant', 'content': 'New answer', 'finish_reason': 'stop'}
    assert failing.translate(document['id'], request(document))['translated_text'] == 'New answer'
    assert len(failure.calls) == 2


def test_unexpected_provider_failure_keeps_safe_failed_receipt_and_releases_admission(store, document):
    provider = FakeProvider(result=RuntimeError(
        'synthetic-provider-crash private detail 3.5 mM [12]'))
    service = SelectionTranslation(store, provider)
    payload = request(document)

    with pytest.raises(WorkspaceError) as first_error:
        service.translate(document['id'], payload)
    error = first_error.value
    assert (error.code, error.message, error.status) == (
        'selection_translation_failed', '选区翻译未完成，请重试。', 502)
    assert len(provider.calls) == 1

    # The same request id must not reach the provider again: it replays the safe
    # failed receipt instead of the original user operation.
    with pytest.raises(WorkspaceError) as repeated:
        service.translate(document['id'], payload)
    assert (repeated.value.code, repeated.value.message, repeated.value.status) == (
        'selection_translation_failed', '选区翻译未完成，请重试。', 502)
    assert len(provider.calls) == 1

    # No exception, provider or selected-text detail may leak through the error.
    surfaced = f'{repeated.value.message} {repeated.value!s}'
    assert 'synthetic-provider-crash' not in surfaced
    assert 'private detail' not in surfaced
    assert '3.5 mM' not in surfaced and 'Traceback' not in surfaced
    assert 'selection_translation_failed' in repeated.value.code

    # The admission slot was released even though the failure was unexpected.
    assert service.active is False
    assert service.cache[str(payload.request_id)].status == 'failed'

    # A new explicit request id can still recover.
    provider.result = DEFAULT
    assert service.translate(document['id'], request(document))['translated_text'] == '合成译文'
    assert len(provider.calls) == 2
    assert service.active is False


@pytest.mark.parametrize('mutation,code,status', [
    ('trash', 'document_trashed', 410),
    ('replace', 'source_changed', 409),
    ('delete', 'source_missing', 409)])
def test_source_becomes_invalid_during_model_call(store, document, mutation, code, status):
    original = (store.files / f"{document['id']}.pdf").read_bytes()

    def change(*_arguments):
        if mutation == 'trash':
            with store.connection() as database:
                database.execute('INSERT INTO document_trash VALUES (?,?)',
                                 (document['id'], timestamp()))
        elif mutation == 'replace':
            with store.connection() as database:
                database.execute('UPDATE documents SET sha256=? WHERE id=?',
                                 ('c' * 64, document['id']))
        else:
            (store.files / f"{document['id']}.pdf").unlink()

    provider = FakeProvider(on_call=change)
    service = SelectionTranslation(store, provider)
    with pytest.raises(WorkspaceError) as error:
        service.translate(document['id'], request(document))
    assert (error.value.code, error.value.status) == (code, status)
    assert len(provider.calls) == 1

    if mutation == 'trash':
        with store.connection() as database:
            database.execute('DELETE FROM document_trash WHERE document_id=?', (document['id'],))
    elif mutation == 'replace':
        with store.connection() as database:
            database.execute('UPDATE documents SET sha256=? WHERE id=?',
                             (document['sha256'], document['id']))
    else:
        (store.files / f"{document['id']}.pdf").write_bytes(original)
    provider.on_call = None
    assert service.translate(document['id'], request(document))['translated_text'] == '合成译文'
    assert len(provider.calls) == 2


def test_cache_is_bounded_expires_and_keeps_the_active_entry(store, document):
    now = [0.0]
    provider = FakeProvider()
    service = SelectionTranslation(store, provider, clock=lambda: now[0])
    payload = request(document)
    service.translate(document['id'], payload)
    assert len(provider.calls) == 1
    now[0] = CACHE_TTL_SECONDS + 1
    service.translate(document['id'], payload)
    assert len(provider.calls) == 2

    for _ in range(MAX_CACHE_ENTRIES + 8):
        service.translate(document['id'], request(document))
    assert len(service.cache) <= MAX_CACHE_ENTRIES

    entered, release = threading.Event(), threading.Event()

    def block(messages, tools):
        entered.set()
        assert release.wait(5)

    provider.on_call = block
    active = request(document)
    worker = threading.Thread(target=service.translate, args=(document['id'], active))
    worker.start()
    try:
        assert entered.wait(5)
        assert str(active.request_id) in service.cache
        assert service.cache[str(active.request_id)].status == 'pending'
        assert len(service.cache) <= MAX_CACHE_ENTRIES
        with pytest.raises(WorkspaceError) as error:
            service.translate(document['id'], active)
        assert error.value.code == 'selection_translation_pending'
    finally:
        release.set()
        worker.join(5)


def test_provider_without_one_shot_uses_complete_once_and_type_error_is_not_retried(store, document):
    legacy = LegacyProvider()
    service = SelectionTranslation(store, legacy)
    result = service.translate(document['id'], request(document))
    assert result['translated_text'] == '旧通道译文'
    assert len(legacy.calls) == 1 and legacy.calls[0][1] is None

    class Broken:
        def __init__(self):
            self.one_shot, self.legacy = 0, 0

        def complete_once(self, messages, tools):
            self.one_shot += 1
            raise TypeError('synthetic interface error')

        def complete(self, messages, tools):
            self.legacy += 1
            return {'role': 'assistant', 'content': 'Must not be used',
                    'finish_reason': 'stop'}

    broken = Broken()
    with pytest.raises(TypeError):
        SelectionTranslation(store, broken).translate(document['id'], request(document))
    assert broken.one_shot == 1 and broken.legacy == 0


class Transport:
    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    def open(self, request, timeout):
        self.requests.append(request)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(response)


def settings():
    return ModelSettings(base_url='https://example.invalid/v1', model='synthetic-model',
                         api_key='synthetic-private-key', supports_images=True)


def chat_response(content='Synthetic answer'):
    return json.dumps({'choices': [{'message': {'role': 'assistant', 'content': content},
                                    'finish_reason': 'stop'}]}).encode()


def test_complete_once_attempts_transport_once_while_complete_still_retries(tmp_path):
    transport = Transport([urllib.error.URLError('synthetic disconnect')])
    provider = ModelConnection(tmp_path / 'one-shot', opener=transport)
    provider.save(settings())
    with pytest.raises(WorkspaceError) as error:
        provider.complete_once([{'role': 'user', 'content': 'Synthetic'}], None)
    assert error.value.code == 'agent_provider_unavailable'
    assert len(transport.requests) == 1

    retrying = Transport([urllib.error.URLError('synthetic disconnect'), chat_response()])
    provider = ModelConnection(tmp_path / 'retry', opener=retrying)
    provider.save(settings())
    result = provider.complete([{'role': 'user', 'content': 'Synthetic'}], [])
    assert result['content'] == 'Synthetic answer'
    assert len(retrying.requests) == 2

    once = Transport([chat_response('One shot')])
    provider = ModelConnection(tmp_path / 'success', opener=once)
    provider.save(settings())
    assert provider.complete_once([{'role': 'user', 'content': 'Synthetic'}], None)['content'] == 'One shot'
    assert len(once.requests) == 1

    from research_workbench.translation import FrozenConnection
    frozen_transport = Transport([urllib.error.URLError('synthetic disconnect'),
                                  chat_response('Frozen retry')])
    frozen = FrozenConnection(tmp_path / 'frozen', settings().model_dump())
    frozen.opener = frozen_transport
    result = frozen.complete([{'role': 'user', 'content': 'Synthetic'}], None)
    assert result['content'] == 'Frozen retry' and len(frozen_transport.requests) == 2
    frozen_once = Transport([urllib.error.URLError('synthetic disconnect')])
    frozen.opener = frozen_once
    with pytest.raises(WorkspaceError) as error:
        frozen.complete_once([{'role': 'user', 'content': 'Synthetic'}], None)
    assert error.value.code == 'agent_provider_unavailable'
    assert len(frozen_once.requests) == 1
