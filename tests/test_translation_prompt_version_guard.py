"""Focused checks for the frozen prompt-version guard in ``execute``.

Only a synthetic provider/runtime is used.  An unsupported frozen row must stop
before any provider, parser or model work, while the two supported versions keep
their existing behaviour.
"""
import hashlib
import json
import threading
from uuid import uuid4

import pytest

from conftest import make_pdf
from research_workbench.store import Store, timestamp
from research_workbench.translation import Translations, TranslationCreate
from research_workbench.translation_sentences import LEGACY_PROMPT_VERSION, PROMPT_VERSION

UNKNOWN_PROMPT_VERSION = 'translate-sentences-v99'


class FakeRuntime:
    def __init__(self):
        self.parsed = []

    def probe(self):
        return True, None

    def parse(self, path, pages, cancelled):
        cancelled()
        self.parsed.append(list(pages))
        return [{'page_idx': page - 1, 'units': [
            {'t': 'text', 'text': 'First sentence. Second sentence.', 'bbox': None}]}
            for page in pages]


class CountingProvider:
    def __init__(self, forbid=False):
        self.config_calls = 0
        self.forbid = forbid

    def config(self):
        self.config_calls += 1
        if self.forbid:
            raise AssertionError('unsupported prompt version reached provider config')
        return {'base_url': 'https://example.invalid/v1', 'model': 'synthetic-model',
                'api_key': 'synthetic-private-key'}, 'local'

    def status(self):
        return {'configured': True, 'model': 'synthetic-model', 'image_input': False,
                'connection_source': 'local', 'connection_state': 'unverified',
                'scope': 'local_research', 'multi_user_auth': False}


def answer(messages):
    payload = json.loads(messages[1]['content'])
    return {'role': 'assistant', 'finish_reason': 'stop',
            'content': json.dumps([{'id': block['id'], 'target': '译文 ' + block['id']}
                                   for block in payload['blocks']], ensure_ascii=False)}


def frozen_factory(calls):
    class FakeFrozen:
        def __init__(self, root, config):
            self.root, self.config = root, config

        def complete(self, messages, tools):
            calls.append(messages)
            return answer(messages)

        def complete_once(self, messages, tools):
            calls.append(messages)
            return answer(messages)

    return FakeFrozen


@pytest.fixture
def service(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr('research_workbench.translation.FrozenConnection',
                        frozen_factory(calls))
    store = Store(tmp_path / 'workspace')
    data = make_pdf(2)
    identifier = str(uuid4())
    (store.files / f'{identifier}.pdf').write_bytes(data)
    store.add_document(dict(
        id=identifier, title='Synthetic prompt versions', original_filename='synthetic.pdf',
        page_count=2, byte_size=len(data), sha256=hashlib.sha256(data).hexdigest(),
        created_at=timestamp()))
    provider = CountingProvider()
    runtime = FakeRuntime()
    translations = Translations(store, provider, runtime)
    translations.test_calls = calls
    translations.test_runtime = runtime
    translations.test_document = identifier
    translations.test_sha = hashlib.sha256(data).hexdigest()
    return translations


def create_job(service):
    job, created = service.create(service.test_document, TranslationCreate(
        request_id=uuid4(), source_sha256=service.test_sha, pages=[1],
        target_language='zh'))
    assert created
    return job


def set_version(service, job_id, version):
    with service.store.connection() as db:
        db.execute('UPDATE translation_jobs SET prompt_version=? WHERE id=?', (version, job_id))


def run_claimed(service, job_id):
    row = service.claim()
    assert row is not None and row['id'] == job_id
    service.run_job(row, threading.Event())
    return service.get(job_id)


def test_unknown_frozen_version_fails_before_provider_parser_or_model(service):
    job = create_job(service)
    set_version(service, job['id'], UNKNOWN_PROMPT_VERSION)
    # Any provider access would raise this assertion instead of being swallowed.
    service.provider = CountingProvider(forbid=True)

    saved = run_claimed(service, job['id'])
    assert saved['status'] == 'failed'
    assert saved['prompt_version'] == UNKNOWN_PROMPT_VERSION
    assert saved['error']['code'] == 'translation_parser_changed'
    assert service.provider.config_calls == 0
    assert service.test_runtime.parsed == []
    assert service.test_calls == []
    with service.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM translation_pages WHERE job_id=?',
                          (job['id'],)).fetchone()[0] == 0


def test_supported_v1_and_v2_still_execute_with_their_own_shape(service):
    for version in (PROMPT_VERSION, LEGACY_PROMPT_VERSION):
        job = create_job(service)
        if version != PROMPT_VERSION:
            set_version(service, job['id'], version)
        saved = run_claimed(service, job['id'])
        assert saved['prompt_version'] == version
        assert saved['status'] == 'completed'
        assert service.provider.config_calls >= 1
        assert len(service.test_calls) >= 1
        service.provider.config_calls = 0
        service.test_calls.clear()
        block = saved['result_pages'][0]['blocks'][0]
        if version == PROMPT_VERSION:
            assert block['sentences'][0]['id'] == 'p1-b0-s0'
            assert block['translated_text'] == '译文 p1-b0-s0 译文 p1-b0-s1'
        else:
            assert 'sentences' not in block
            assert block['translated_text'] == '译文 p1-b0'
