"""Focused persisted flows for sentence-aligned translation.

Only a synthetic provider/runtime/worker loop is used.  The real translation
service, SQLite store, publish/complete lifecycle and frozen run control are
exercised so both new v2 rows and legacy v1 rows keep their actual behaviour.
"""
import hashlib
import json
import threading
from uuid import uuid4

import pytest

from conftest import make_pdf
from research_workbench.store import Store, timestamp
from research_workbench.translation import Translations, TranslationCreate
from research_workbench.translation_run_schema import TranslationRunControl, TranslationRunCreate
from research_workbench.translation_sentences import LEGACY_PROMPT_VERSION, PROMPT_VERSION

LEGACY_BLOCK_KEYS = {'id', 'kind', 'order', 'rect', 'source_text', 'translated_text'}
ALIGNED_BLOCK_KEYS = LEGACY_BLOCK_KEYS | {'sentences'}


def add_document(store, pages=6):
    identifier = str(uuid4())
    data = make_pdf(pages)
    (store.files / f'{identifier}.pdf').write_bytes(data)
    record = dict(id=identifier, title='Synthetic sentences', original_filename='synthetic.pdf',
                  page_count=pages, byte_size=len(data),
                  sha256=hashlib.sha256(data).hexdigest(), created_at=timestamp())
    store.add_document(record)
    return record


class FakeRuntime:
    def __init__(self):
        self.units = {}
        self.parsed = []

    def probe(self):
        return True, None

    def parse(self, path, pages, cancelled):
        cancelled()
        self.parsed.append(list(pages))
        return [{'page_idx': page - 1, 'units': self.units.get(page, [
            {'t': 'text', 'text': f'Source page {page}.',
             'bbox': [0.1, 0.1, 0.9, 0.2]}])} for page in pages]


class FakeProvider:
    def __init__(self, model='synthetic-model'):
        self.model = model

    def config(self):
        return {'base_url': 'https://example.invalid/v1', 'model': self.model,
                'api_key': 'synthetic-private-key'}, 'local'

    def status(self):
        return {'configured': True, 'model': self.model, 'image_input': False,
                'connection_source': 'local', 'connection_state': 'unverified',
                'scope': 'local_research', 'multi_user_auth': False}


def answer(messages):
    payload = json.loads(messages[1]['content'])
    return {'role': 'assistant', 'finish_reason': 'stop',
            'content': json.dumps([{'id': block['id'], 'target': '译文 ' + block['id']}
                                   for block in payload['blocks']], ensure_ascii=False)}


def frozen_factory(calls, behaviour):
    class FakeFrozen:
        def __init__(self, root, config):
            self.root, self.config = root, config

        def complete(self, messages, tools):
            calls.append(('complete', messages))
            return behaviour(messages)

        def complete_once(self, messages, tools):
            calls.append(('once', messages))
            return behaviour(messages)

    return FakeFrozen


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / 'workspace')


@pytest.fixture
def document(store):
    return add_document(store, pages=6)


@pytest.fixture
def service(store, monkeypatch):
    calls = []
    state = {'behaviour': answer}
    monkeypatch.setattr('research_workbench.translation.FrozenConnection',
                        frozen_factory(calls, lambda messages: state['behaviour'](messages)))
    runtime = FakeRuntime()
    translations = Translations(store, FakeProvider(), runtime)
    translations.test_calls = calls
    translations.test_state = state
    translations.test_runtime = runtime
    return translations


def payload(document, pages, **changes):
    value = dict(request_id=str(uuid4()), source_sha256=document['sha256'],
                 pages=pages, target_language='zh', confirmed=True)
    value.update(changes)
    return TranslationRunCreate(**value)


def control(run, **changes):
    value = dict(request_id=str(uuid4()), expected_revision=run['revision'], confirmed=True)
    value.update(changes)
    return TranslationRunControl(**value)


def drive(service, limit=80):
    stop = threading.Event()
    rows = []
    for _ in range(limit):
        service.runs.advance()
        row = service.claim()
        if row is None:
            return rows
        rows.append(dict(row))
        service.run_job(row, stop)
        service.runs.advance()
    raise AssertionError('Run did not settle')


def requested_ids(call):
    return [block['id'] for block in json.loads(call[1][1]['content'])['blocks']]


def page_blocks(service, run_id, page):
    return service.runs.get(run_id, page)['result_pages'][0]['blocks']


def downgrade(store, table, identifier, version=LEGACY_PROMPT_VERSION):
    with store.connection() as db:
        db.execute(f'UPDATE {table} SET prompt_version=? WHERE id=?', (version, identifier))


def complete_legacy_page(service, store, document, page=1):
    job, created = service.create(document['id'], TranslationCreate(
        request_id=uuid4(), source_sha256=document['sha256'], pages=[page],
        target_language='zh'))
    assert created
    downgrade(store, 'translation_jobs', job['id'])
    row = service.claim()
    assert row['id'] == job['id']
    service.run_job(row, threading.Event())
    assert service.status(job['id']) == 'completed'
    return job


# 2. New explicit job / run: units are requested by id, alignment persists, and
#    a read or reopen keeps both the unit and the aggregate result without work.
def test_new_run_requests_sentence_ids_and_persists_alignment(service, document, monkeypatch):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': 'First sentence. Second sentence.',
         'bbox': [0.1, 0.1, 0.9, 0.2]},
        {'t': 'doc_title', 'text': 'A title!', 'bbox': [0.1, 0.3, 0.9, 0.35]},
        {'t': 'image', 'text': '', 'bbox': [0.1, 0.5, 0.9, 0.8]},
    ]
    run, created = service.runs.create(document['id'], payload(document, [1]))
    assert created and run['prompt_version'] == PROMPT_VERSION
    children = drive(service)

    assert len(children) == 1 and children[0]['prompt_version'] == PROMPT_VERSION
    assert [kind for kind, _ in service.test_calls] == ['once']
    assert requested_ids(service.test_calls[0]) == [
        'p1-b0-s0', 'p1-b0-s1', 'p1-b1-s0']

    blocks = page_blocks(service, run['id'], 1)
    assert blocks[0]['source_text'] == 'First sentence. Second sentence.'
    units = blocks[0]['sentences']
    assert [unit['id'] for unit in units] == ['p1-b0-s0', 'p1-b0-s1']
    assert [unit['source_text'] for unit in units] == [
        'First sentence. ', 'Second sentence.']
    assert ''.join(unit['source_text'] for unit in units) == blocks[0]['source_text']
    assert [unit['translated_text'] for unit in units] == [
        '译文 p1-b0-s0', '译文 p1-b0-s1']
    assert blocks[0]['translated_text'] == ' '.join(
        unit['translated_text'] for unit in units)
    assert blocks[1]['sentences'][0]['id'] == 'p1-b1-s0'
    assert 'sentences' not in blocks[2] and blocks[2]['translated_text'] is None
    assert set(blocks[0]) == ALIGNED_BLOCK_KEYS

    final = service.runs.get(run['id'])
    assert final['status'] == 'completed' and final['reused_pages'] == 0

    # Reads are pure: no model call, no hashing and no new rows.
    def forbidden(path):
        raise AssertionError('a saved-result read hashed the PDF')

    service.test_calls.clear()
    service.test_runtime.parsed.clear()
    monkeypatch.setattr('research_workbench.translation.source_sha256', forbidden)
    with service.store.connection() as db:
        before = tuple(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                       for table in ('translation_jobs', 'translation_pages',
                                     'translation_run_jobs', 'translation_run_pages'))
    detail = service.runs.get(run['id'])
    again = service.runs.get(run['id'], 1)
    listed = service.runs.list(document['id'])
    with service.store.connection() as db:
        after = tuple(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                      for table in ('translation_jobs', 'translation_pages',
                                    'translation_run_jobs', 'translation_run_pages'))
    assert before == after
    assert detail['result_pages'] == [] and listed[0]['result_pages'] == []
    assert again['result_pages'][0]['blocks'] == blocks
    assert service.test_calls == [] and service.test_runtime.parsed == []

    # Reopening the persisted workspace shows the same units and aggregate.
    reopened = Translations(Store(service.store.root), FakeProvider(), FakeRuntime())
    assert reopened.runs.get(run['id'], 1)['result_pages'][0]['blocks'] == blocks


def test_new_explicit_job_persists_alignment_and_reopens(service, document):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': 'One unit. Two units.', 'bbox': None}]
    job, created = service.create(document['id'], TranslationCreate(
        request_id=uuid4(), source_sha256=document['sha256'], pages=[1],
        target_language='en'))
    assert created and job['prompt_version'] == PROMPT_VERSION
    row = service.claim()
    service.run_job(row, threading.Event())
    assert service.status(job['id']) == 'completed'
    assert [kind for kind, _ in service.test_calls] == ['complete']
    assert requested_ids(service.test_calls[0]) == ['p1-b0-s0', 'p1-b0-s1']

    saved = service.get(job['id'])
    blocks = saved['result_pages'][0]['blocks']
    assert blocks[0]['translated_text'] == '译文 p1-b0-s0 译文 p1-b0-s1'
    assert [unit['source_text'] for unit in blocks[0]['sentences']] == [
        'One unit. ', 'Two units.']
    assert service.get(job['id'])['result_pages'] == saved['result_pages']


# 4. Legacy rows keep their frozen v1 block plan and stay runnable/resumable.
def test_legacy_v1_job_and_run_keep_block_behaviour(service, store, document):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': 'First sentence. Second sentence.', 'bbox': None}]
    job = complete_legacy_page(service, store, document, page=1)
    assert requested_ids(service.test_calls[0]) == ['p1-b0']

    saved = service.get(job['id'])
    block = saved['result_pages'][0]['blocks'][0]
    assert saved['prompt_version'] == LEGACY_PROMPT_VERSION
    assert block['translated_text'] == '译文 p1-b0'
    assert set(block) == LEGACY_BLOCK_KEYS and 'sentences' not in block

    # A queued legacy v1 run pauses and resumes without being upgraded.
    service.test_calls.clear()
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    downgrade(store, 'translation_runs', run['id'])
    paused = service.runs.pause(run['id'], control(run))
    resumed = service.runs.resume(run['id'], control(paused))
    assert resumed['status'] == 'queued' and resumed['prompt_version'] == LEGACY_PROMPT_VERSION
    children = drive(service)
    # The compatible completed v1 page is reused; only page 2 needs a child.
    assert len(children) == 1 and json.loads(children[0]['pages_json']) == [2]
    assert children[0]['prompt_version'] == LEGACY_PROMPT_VERSION
    assert requested_ids(service.test_calls[0]) == ['p2-b0']
    for page in (1, 2):
        blocks = page_blocks(service, run['id'], page)
        assert set(blocks[0]) == LEGACY_BLOCK_KEYS and 'sentences' not in blocks[0]
    final = service.runs.get(run['id'])
    assert final['status'] == 'completed' and final['reused_pages'] == 1


def test_v2_never_reuses_v1_but_reuses_compatible_v2(service, store, document):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': 'Paragraph source.', 'bbox': None}]
    legacy = complete_legacy_page(service, store, document, page=1)

    service.test_calls.clear()
    first, _ = service.runs.create(document['id'], payload(document, [1]))
    children = drive(service)
    assert len(children) == 1 and [kind for kind, _ in service.test_calls] == ['once']
    final = service.runs.get(first['id'])
    assert final['status'] == 'completed' and final['reused_pages'] == 0
    assert service.runs.get(first['id'], 1)['result_pages'][0]['job_id'] != legacy['id']
    assert service.runs.get(first['id'], 1)['result_pages'][0]['blocks'][0][
        'translated_text'] == '译文 p1-b0-s0'

    service.test_calls.clear()
    second, _ = service.runs.create(document['id'], payload(document, [1]))
    assert drive(service) == []
    reused = service.runs.get(second['id'])
    assert reused['status'] == 'completed' and reused['reused_pages'] == 1
    assert service.test_calls == []


# 3. Invalid or over-budget output fails the page without fake alignment, extra
#    calls or removing an unrelated completed page.
def duplicate_ids(messages):
    payload_value = json.loads(messages[1]['content'])
    output = [{'id': block['id'], 'target': '译文'} for block in payload_value['blocks']]
    output[-1]['id'] = output[0]['id']
    return {'role': 'assistant', 'finish_reason': 'stop',
            'content': json.dumps(output, ensure_ascii=False)}


def missing_id(messages):
    payload_value = json.loads(messages[1]['content'])
    output = [{'id': block['id'], 'target': '译文'} for block in payload_value['blocks'][:-1]]
    return {'role': 'assistant', 'finish_reason': 'stop',
            'content': json.dumps(output, ensure_ascii=False)}


def unknown_id(messages):
    payload_value = json.loads(messages[1]['content'])
    output = [{'id': block['id'], 'target': '译文'} for block in payload_value['blocks']]
    output.append({'id': str(payload_value['blocks'][0]['id']).replace('-s0', '-s9'),
                   'target': '译文'})
    return {'role': 'assistant', 'finish_reason': 'stop',
            'content': json.dumps(output, ensure_ascii=False)}


def empty_target(messages):
    payload_value = json.loads(messages[1]['content'])
    output = [{'id': block['id'], 'target': '   ' if index == 0 else '译文'}
              for index, block in enumerate(payload_value['blocks'])]
    return {'role': 'assistant', 'finish_reason': 'stop',
            'content': json.dumps(output, ensure_ascii=False)}


def unsafe_target(messages):
    payload_value = json.loads(messages[1]['content'])
    output = [{'id': block['id'],
               'target': '<script>alert(1)</script>' if index == 0 else '译文'}
              for index, block in enumerate(payload_value['blocks'])]
    return {'role': 'assistant', 'finish_reason': 'stop',
            'content': json.dumps(output, ensure_ascii=False)}


def truncated(messages):
    return {'role': 'assistant', 'finish_reason': 'length', 'content': '[]'}


@pytest.mark.parametrize('behaviour', [
    duplicate_ids, missing_id, unknown_id, empty_target, unsafe_target, truncated])
def test_invalid_sentence_output_fails_page_without_alignment_or_retry(
        service, document, behaviour):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': 'First sentence. Second sentence.', 'bbox': None}]

    def page_one_only(messages):
        first = json.loads(messages[1]['content'])['blocks'][0]['id']
        return behaviour(messages) if first.startswith('p1-') else answer(messages)

    service.test_state['behaviour'] = page_one_only
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    children = drive(service)
    assert len(children) == 2
    # Exactly one attempt per page: no automatic retry on invalid output.
    assert [kind for kind, _ in service.test_calls] == ['once', 'once']

    first = service.runs.get(run['id'], 1)['result_pages'][0]
    assert first['status'] == 'failed'
    assert all('sentences' not in block for block in first['blocks'])
    assert all(block['translated_text'] is None for block in first['blocks'])
    second = service.runs.get(run['id'], 2)['result_pages'][0]
    assert second['status'] == 'completed'
    assert second['blocks'][0]['sentences'][0]['id'] == 'p2-b0-s0'
    final = service.runs.get(run['id'])
    assert final['status'] == 'partial' and final['completed_pages'] == 1


def test_aggregate_oversize_rejects_the_page(service, document):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': 'First sentence. Second sentence.', 'bbox': None}]

    def oversized(messages):
        payload_value = json.loads(messages[1]['content'])
        return {'role': 'assistant', 'finish_reason': 'stop',
                'content': json.dumps([{'id': block['id'], 'target': 'x' * 5000}
                                       for block in payload_value['blocks']])}

    service.test_state['behaviour'] = oversized
    run, _ = service.runs.create(document['id'], payload(document, [1]))
    drive(service)
    assert [kind for kind, _ in service.test_calls] == ['once']
    result = service.runs.get(run['id'], 1)['result_pages'][0]
    assert result['status'] == 'failed'
    assert all('sentences' not in block for block in result['blocks'])
    assert all(block['translated_text'] is None for block in result['blocks'])
    assert service.runs.get(run['id'])['status'] == 'partial'


def test_sentence_count_bounds_reject_without_model_calls(service, document):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': ' '.join(f'S{index}.' for index in range(129)),
         'bbox': None}]
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    drive(service)

    # Only the in-budget page is sent; the over-budget page makes no call.
    assert [kind for kind, _ in service.test_calls] == ['once']
    assert requested_ids(service.test_calls[0]) == ['p2-b0-s0']
    first = service.runs.get(run['id'], 1)['result_pages'][0]
    assert first['status'] == 'failed'
    assert all('sentences' not in block and block['translated_text'] is None
               for block in first['blocks'])
    second = service.runs.get(run['id'], 2)['result_pages'][0]
    assert second['status'] == 'completed'


def test_page_sentence_bound_rejects_without_model_calls(service, document):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': ' '.join(f'S{index}.' for index in range(120)),
         'bbox': None} for _ in range(9)]  # 1080 sentences > 1024 on one page
    run, _ = service.runs.create(document['id'], payload(document, [1]))
    drive(service)
    assert service.test_calls == []
    result = service.runs.get(run['id'], 1)['result_pages'][0]
    assert result['status'] == 'failed'
    assert all('sentences' not in block for block in result['blocks'])


# 5. A cancelled child never publishes a hidden or partial aligned page.
def test_cancelled_child_publishes_no_sentences(service, document):
    service.test_runtime.units[1] = [
        {'t': 'text', 'text': 'First sentence. Second sentence.', 'bbox': None}]
    run, _ = service.runs.create(document['id'], payload(document, [1]))
    service.runs.advance()
    child = service.claim()
    assert child is not None
    service.cancel(child['id'])
    service.run_job(child, threading.Event())
    service.runs.advance()

    with service.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM translation_pages WHERE job_id=?',
                          (child['id'],)).fetchone()[0] == 0
    final = service.runs.get(run['id'])
    assert final['status'] == 'failed' and final['processed_pages'] == 0
    assert final['result_pages'] == []
    assert service.runs.get(run['id'], 1)['result_pages'] == []
