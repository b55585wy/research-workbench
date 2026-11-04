"""Focused lifecycle tests for persisted continuous translation runs.

Fake provider/runtime/executor only: no real model, parser, worker process or
HTTP call is started.  The existing translations execution path is reused so the
publish/fail/complete semantics are the deployed ones.
"""
import hashlib
import json
import threading
from uuid import uuid4

import pytest
from pydantic import ValidationError

from conftest import make_pdf
from research_workbench.models import WorkspaceError
from research_workbench.store import Store, timestamp
from research_workbench.translation import Translations, TranslationCreate
from research_workbench.translation_process import TranslationSupervisor
from research_workbench.translation_run_schema import TranslationRunControl, TranslationRunCreate


def add_document(store, pages=2):
    identifier = str(uuid4())
    data = make_pdf(pages)
    (store.files / f'{identifier}.pdf').write_bytes(data)
    record = dict(id=identifier, title='Synthetic run', original_filename='synthetic.pdf',
                  page_count=pages, byte_size=len(data),
                  sha256=hashlib.sha256(data).hexdigest(), created_at=timestamp())
    store.add_document(record)
    return record


class FakeRuntime:
    def __init__(self):
        self.parsed = []

    def probe(self):
        return True, None

    def parse(self, path, pages, cancelled):
        cancelled()
        self.parsed.append(list(pages))
        return [{'page_idx': page - 1, 'units': [
            {'t': 'text', 'text': f'Source page {page}', 'bbox': [0.1, 0.1, 0.9, 0.2]}]}
            for page in pages]


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


class EmptyProvider:
    def config(self):
        return {}, 'none'

    def status(self):
        return {'configured': False, 'model': None, 'image_input': False,
                'connection_source': 'none', 'connection_state': 'not_configured',
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
    provider = FakeProvider()
    translations = Translations(store, provider, runtime)
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


def translations(service):
    with service.store.connection() as db:
        return db.execute('SELECT COUNT(*) FROM translation_jobs').fetchone()[0]


def test_six_pages_run_sequentially_with_one_page_children_and_one_shot_calls(
        service, document):
    run, created = service.runs.create(document['id'], payload(document, list(range(1, 7))))
    assert created is True and run['status'] == 'queued' and run['revision'] == 1
    assert run['result_pages'] == [] and run['active_job_id'] is None

    children = drive(service)
    assert len(children) == 6
    assert all(child['total_pages'] == 1 and json.loads(child['pages_json']) == [number]
               for number, child in zip(range(1, 7), children))

    final = service.runs.get(run['id'])
    assert final['status'] == 'completed' and final['stage'] == 'finished'
    assert final['processed_pages'] == final['completed_pages'] == 6
    assert final['reused_pages'] == 0 and final['error'] is None
    assert final['model'] == {'name': 'synthetic-model'}

    page = service.runs.get(run['id'], 3)
    assert len(page['result_pages']) == 1
    result = page['result_pages'][0]
    assert result['page'] == 3 and result['status'] == 'completed'
    assert result['job_id'] == children[2]['id']
    assert result['blocks'][0]['translated_text'] == '译文 p3-b0'
    assert result['blocks'][0]['source_text'] == 'Source page 3'

    # Run children never use the legacy transport retry path.
    assert [kind for kind, _ in service.test_calls] == ['once'] * 6
    assert service.test_runtime.parsed == [[1], [2], [3], [4], [5], [6]]


def test_compatible_completed_legacy_page_is_reused_without_model_work(service, document):
    legacy, created = service.create(document['id'], TranslationCreate(
        request_id=uuid4(), source_sha256=document['sha256'], pages=[1], target_language='zh'))
    assert created
    row = service.claim()
    assert row['id'] == legacy['id']
    service.run_job(row, threading.Event())
    assert service.status(legacy['id']) == 'completed'

    service.test_calls.clear()
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    children = drive(service)
    assert len(children) == 1 and json.loads(children[0]['pages_json']) == [2]

    final = service.runs.get(run['id'])
    assert final['status'] == 'completed'
    assert final['reused_pages'] == 1 and final['completed_pages'] == 2
    assert len(service.test_calls) == 1 and service.test_calls[0][0] == 'once'
    first = service.runs.get(run['id'], 1)['result_pages'][0]
    assert first['job_id'] == legacy['id']


def test_unavailable_or_invalid_page_is_not_success_and_run_finishes_partial(
        service, document):
    def invalid_for_first_page(messages):
        payload_value = json.loads(messages[1]['content'])
        if payload_value['blocks'][0]['id'].startswith('p1-'):
            return {'role': 'assistant', 'content': 'not-json', 'finish_reason': 'stop'}
        return answer(messages)

    service.test_state['behaviour'] = invalid_for_first_page
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    children = drive(service)
    assert len(children) == 2

    final = service.runs.get(run['id'])
    assert final['status'] == 'partial'
    assert final['processed_pages'] == 2 and final['completed_pages'] == 1
    assert final['error']['code'] == 'translation_run_incomplete'
    first = service.runs.get(run['id'], 1)['result_pages'][0]
    assert first['status'] == 'failed' and first['blocks'][0]['translated_text'] is None
    second = service.runs.get(run['id'], 2)['result_pages'][0]
    assert second['status'] == 'completed'


def test_partial_run_continues_only_noncompleted_pages_per_explicit_revision(
        service, document):
    def invalid_for_first_page(messages):
        payload_value = json.loads(messages[1]['content'])
        if payload_value['blocks'][0]['id'].startswith('p1-'):
            return {'role': 'assistant', 'content': 'not-json', 'finish_reason': 'stop'}
        return answer(messages)

    service.test_state['behaviour'] = invalid_for_first_page
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    first = drive(service)
    assert len(first) == 2

    partial = service.runs.get(run['id'])
    assert partial['status'] == 'partial' and partial['processed_pages'] == 2
    completed_page = service.runs.get(run['id'], 2)['result_pages'][0]
    assert completed_page['status'] == 'completed'

    # Reaching partial is terminal: the worker never retries it by itself.
    before = translations(service)
    service.runs.advance()
    assert translations(service) == before

    resumed = service.runs.resume(run['id'], control(partial))
    assert resumed['status'] == 'queued' and resumed['revision'] == partial['revision'] + 1
    retried = drive(service)
    assert len(retried) == 1 and json.loads(retried[0]['pages_json']) == [1]
    assert retried[0]['id'] not in {child['id'] for child in first}

    still = service.runs.get(run['id'])
    assert still['status'] == 'partial' and still['completed_pages'] == 1
    assert still['processed_pages'] == 2
    assert service.runs.get(run['id'], 2)['result_pages'][0]['job_id'] == completed_page['job_id']

    service.test_state['behaviour'] = answer
    resumed_again = service.runs.resume(run['id'], control(still))
    assert resumed_again['status'] == 'queued'
    final_children = drive(service)
    assert len(final_children) == 1 and json.loads(final_children[0]['pages_json']) == [1]
    final = service.runs.get(run['id'])
    assert final['status'] == 'completed' and final['completed_pages'] == 2
    assert final['revision'] == resumed_again['revision']


def test_duplicate_control_replay_returns_current_run_after_later_revision(
        service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    pause = control(run)
    paused = service.runs.pause(run['id'], pause)
    assert paused['status'] == 'paused' and paused['revision'] == 2
    resumed = service.runs.resume(run['id'], control(paused))
    assert resumed['status'] == 'queued' and resumed['revision'] == 3

    # Replaying the original pause must not rewind the displayed run to the
    # historic paused revision, and must not mutate or notify again.
    replay = service.runs.pause(run['id'], pause)
    assert replay == service.runs.get(run['id'])
    assert replay['status'] == 'queued' and replay['revision'] == 3
    with service.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM translation_runs').fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM translation_jobs').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM translation_run_operations').fetchone()[0] == 2
        receipt = json.loads(db.execute(
            'SELECT result_json FROM translation_run_operations WHERE request_id=?',
            (str(pause.request_id),)).fetchone()[0])
    # The durable receipt keeps the historic pause outcome.
    assert receipt['status'] == 'paused' and receipt['revision'] == 2
    assert service.test_calls == []


def test_missing_page_result_stops_until_resume_retries_only_missing_pages(service, document):
    def fail_second_page(messages):
        payload_value = json.loads(messages[1]['content'])
        if payload_value['blocks'][0]['id'].startswith('p2-'):
            raise WorkspaceError('agent_provider_unavailable',
                                 '暂时无法连接模型服务，请稍后重试。', 502)
        return answer(messages)

    service.test_state['behaviour'] = fail_second_page
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    children = drive(service)
    assert len(children) == 2

    final = service.runs.get(run['id'])
    assert final['status'] == 'failed'
    assert final['completed_pages'] == 1 and final['processed_pages'] == 1
    assert final['error']['code'] == 'translation_model_failed'

    before = translations(service)
    service.runs.advance()
    assert translations(service) == before

    service.test_state['behaviour'] = answer
    resumed = service.runs.resume(run['id'], control(run))
    assert resumed['status'] == 'queued' and resumed['revision'] == run['revision'] + 1
    retried = drive(service)
    assert len(retried) == 1 and json.loads(retried[0]['pages_json']) == [2]
    assert retried[0]['id'] not in {child['id'] for child in children}

    final = service.runs.get(run['id'])
    assert final['status'] == 'completed' and final['completed_pages'] == 2
    assert final['revision'] == resumed['revision']


def test_pause_cancels_child_and_resume_does_not_create_an_overlapping_child(service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    service.runs.advance()
    child = service.claim()
    assert child is not None

    paused = service.runs.pause(run['id'], control(run))
    assert paused['status'] == 'paused' and paused['revision'] == run['revision'] + 1
    assert paused['active_job_id'] == child['id']
    assert service.status(child['id']) == 'cancelled'
    assert service.claim() is None

    service.runs.advance()
    assert translations(service) == 1

    resumed = service.runs.resume(run['id'], control(paused))
    assert resumed['status'] == 'queued' and resumed['revision'] == paused['revision'] + 1
    # The Web control path never creates a child itself.
    assert translations(service) == 1 and service.claim() is None

    service.runs.advance()
    replacement = service.claim()
    assert replacement is not None and replacement['id'] != child['id']
    assert json.loads(replacement['pages_json']) == [1]


def test_recovery_interrupts_active_run_and_cancels_only_linked_children(service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1]))
    service.runs.advance()
    linked = service.claim()
    manual, _ = service.create(document['id'], TranslationCreate(
        request_id=uuid4(), source_sha256=document['sha256'], pages=[2], target_language='zh'))

    service.recover()

    assert service.status(linked['id']) == 'cancelled'
    assert service.status(manual['id']) == 'queued'
    final = service.runs.get(run['id'])
    assert final['status'] == 'interrupted'
    assert final['completed_pages'] == 0

    service.runs.advance()
    assert translations(service) == 2
    claimed = service.claim()
    assert claimed['id'] == manual['id']


def test_startup_recovery_preserves_a_queued_run_but_shutdown_interrupts_it(
        service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1]))

    # Worker startup must not interrupt the queued run that requested this
    # worker: it has no in-flight child and is equivalent to a manual job.
    service.recover()
    assert service.runs.get(run['id'])['status'] == 'queued'

    service.runs.advance()
    child = service.claim()
    assert child is not None

    service.recover(queued=True)
    assert service.status(child['id']) == 'cancelled'
    assert service.runs.get(run['id'])['status'] == 'interrupted'


def test_supervisor_start_interrupts_parents_while_worker_startup_preserves_queued(
        service, document, monkeypatch):
    """In-process fake: no worker process or model is started by this test."""
    started = []
    monkeypatch.setattr(TranslationSupervisor, 'ensure_started',
                        lambda self: started.append(True))

    def legacy(page):
        row, _ = service.create(document['id'], TranslationCreate(
            request_id=uuid4(), source_sha256=document['sha256'], pages=[page],
            target_language='zh'))
        return row

    # 1. Initial Web startup with a persisted queued parent and a manual queued
    #    legacy job: the parent is not an on-demand request and is interrupted;
    #    the manual queued job is preserved and still requests the worker.
    pending, _ = service.runs.create(document['id'], payload(document, [1]))
    manual = legacy(2)
    first = TranslationSupervisor(service)
    try:
        first.start()
        assert started == [True]
        interrupted = service.runs.get(pending['id'])
        assert interrupted['status'] == 'interrupted' and interrupted['stage'] == 'finished'
        assert interrupted['error']['code'] == 'translation_run_interrupted'
        assert service.status(manual['id']) == 'queued'
    finally:
        first.close()

    # 2. Initial Web startup with a running parent: its linked child is
    #    cancelled, and a manual queued legacy job stays untouched.
    running, _ = service.runs.create(document['id'], payload(document, [1]))
    service.runs.advance()
    linked = service.claim()
    assert linked is not None and service.status(linked['id']) == 'running'
    manual = legacy(2)
    second = TranslationSupervisor(service)
    try:
        second.start()
        assert service.status(linked['id']) == 'cancelled'
        assert service.runs.get(running['id'])['status'] == 'interrupted'
        assert service.status(manual['id']) == 'queued'
    finally:
        second.close()

    # 3. Ordinary worker startup preserves the freshly queued parent that caused
    #    this worker process to start, and that parent can create its child.
    queued, _ = service.runs.create(document['id'], payload(document, [1]))
    service.recover()  # exactly what translation_worker.main does at startup
    assert service.runs.get(queued['id'])['status'] == 'queued'
    service.runs.advance()
    current = service.runs.get(queued['id'])
    assert current['status'] == 'running' and current['active_job_id'] is not None
    assert service.status(current['active_job_id']) == 'queued'


def test_control_receipts_are_idempotent_bounded_and_revision_conflicts(store, service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1]))
    pause = control(run)
    first = service.runs.pause(run['id'], pause)
    assert service.runs.pause(run['id'], pause) == first
    with pytest.raises(WorkspaceError) as error:
        service.runs.pause(run['id'], control(run, request_id=pause.request_id,
                                             expected_revision=pause.expected_revision + 1))
    assert error.value.code == 'idempotency_conflict'
    with pytest.raises(WorkspaceError) as error:
        service.runs.pause(run['id'], control(run))
    assert error.value.code == 'translation_run_conflict'

    resume = control(first)
    queued = service.runs.resume(run['id'], resume)
    assert service.runs.resume(run['id'], resume) == queued
    with pytest.raises(WorkspaceError) as error:
        service.runs.resume(run['id'], control(queued))
    assert error.value.code == 'translation_run_invalid_state'

    with store.connection() as db:
        receipts = [row[0] for row in db.execute(
            'SELECT result_json FROM translation_run_operations ORDER BY created_at')]
    assert receipts and all('api_key' not in value and 'synthetic-private-key' not in value
                            for value in receipts)


def test_model_change_fails_before_next_child_and_existing_page_stays_readable(
        service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    service.runs.advance()
    child = service.claim()
    service.run_job(child, threading.Event())
    assert service.status(child['id']) == 'completed'

    service.provider.model = 'another-model'
    service.runs.advance()

    final = service.runs.get(run['id'])
    assert final['status'] == 'failed'
    assert final['error']['code'] == 'translation_model_changed'
    assert final['completed_pages'] == 1 and final['processed_pages'] == 1
    assert translations(service) == 1
    assert service.runs.get(run['id'], 1)['result_pages'][0]['status'] == 'completed'

    with pytest.raises(WorkspaceError) as error:
        service.runs.resume(run['id'], control(final))
    assert error.value.code == 'translation_model_changed'


def test_source_change_fails_safely_and_blocks_reads(service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1]))
    service.runs.advance()
    child = service.claim()
    service.run_job(child, threading.Event())
    with service.store.connection() as db:
        db.execute('UPDATE documents SET sha256=? WHERE id=?', ('c' * 64, document['id']))
    service.runs.advance()
    with pytest.raises(WorkspaceError) as error:
        service.runs.get(run['id'])
    assert error.value.code == 'source_changed'
    with service.store.connection() as db:
        row = db.execute('SELECT status,error_json FROM translation_runs WHERE id=?',
                         (run['id'],)).fetchone()
    assert row['status'] == 'failed' and json.loads(row['error_json'])['code'] == 'source_changed'


def test_reads_are_pure_and_never_hash_or_create_children(service, document, monkeypatch):
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))

    def forbidden(path):
        raise AssertionError('a polling read hashed the PDF')

    monkeypatch.setattr('research_workbench.translation.source_sha256', forbidden)
    with service.store.connection() as db:
        before = tuple(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                       for table in ('translation_jobs', 'translation_run_jobs',
                                     'translation_run_pages', 'translation_run_operations'))
    listed = service.runs.list(document['id'])
    detail = service.runs.get(run['id'])
    requested = service.runs.get(run['id'], 1)
    with service.store.connection() as db:
        after = tuple(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                      for table in ('translation_jobs', 'translation_run_jobs',
                                    'translation_run_pages', 'translation_run_operations'))
    assert before == after
    assert len(listed) == 1 and listed[0]['result_pages'] == []
    assert detail['result_pages'] == [] and requested['result_pages'] == []
    assert detail['active_job_id'] is None


def test_parser_identity_change_fails_before_next_child(service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    service.runs.advance()
    child = service.claim()
    service.run_job(child, threading.Event())
    with service.store.connection() as db:
        db.execute("UPDATE translation_runs SET parser_version='9.9.9' WHERE id=?",
                   (run['id'],))
    service.runs.advance()
    final = service.runs.get(run['id'])
    assert final['status'] == 'failed'
    assert final['error']['code'] == 'translation_parser_changed'
    assert final['completed_pages'] == 1 and translations(service) == 1


def test_completed_pages_reuse_across_runs_and_are_not_remapped(service, document):
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    drive(service)
    assert service.runs.get(run['id'])['status'] == 'completed'
    with service.store.connection() as db:
        before = [tuple(row) for row in db.execute(
            'SELECT page,job_id,status,reused FROM translation_run_pages '
            'WHERE run_id=? ORDER BY page', (run['id'],))]

    service.test_calls.clear()
    second, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    assert drive(service) == []
    final = service.runs.get(second['id'])
    assert final['status'] == 'completed' and final['reused_pages'] == 2
    assert service.test_calls == []
    with service.store.connection() as db:
        after = [tuple(row) for row in db.execute(
            'SELECT page,job_id,status,reused FROM translation_run_pages '
            'WHERE run_id=? ORDER BY page', (run['id'],))]
        reused_rows = [tuple(row) for row in db.execute(
            'SELECT page,job_id,status,reused FROM translation_run_pages '
            'WHERE run_id=? ORDER BY page', (second['id'],))]
    assert after == before
    assert [row[1] for row in reused_rows] == [row[1] for row in before]
    assert all(row[2] == 'completed' and row[3] == 1 for row in reused_rows)


def test_creation_bounds_one_active_run_and_cross_store_scope(service, document, store):
    run, _ = service.runs.create(document['id'], payload(document, [1, 2]))
    with pytest.raises(WorkspaceError) as error:
        service.runs.create(document['id'], payload(document, [3]))
    assert error.value.code == 'translation_run_busy'

    with pytest.raises(WorkspaceError) as error:
        service.runs.create(document['id'], payload(document, [3], source_sha256='b' * 64))
    assert error.value.code == 'source_changed'

    other = Store(store.root.parent / 'other-workspace')
    other_service = Translations(other, FakeProvider(), FakeRuntime())
    with pytest.raises(WorkspaceError) as error:
        other_service.runs.get(run['id'])
    assert error.value.code == 'not_found'

    with pytest.raises(WorkspaceError) as error:
        service.runs.get(run['id'], 3)
    assert error.value.code == 'invalid_page'


@pytest.mark.parametrize('change', [
    {'extra': 1}, {'model': 'fake'}, {'api_key': 'fake'}, {'base_url': 'https://x'},
    {'confirmed': False}, {'pages': []}, {'pages': [0]}, {'pages': [201]},
    {'pages': [1, 1]}, {'pages': [True]}, {'pages': [1.5]},
    {'pages': list(range(1, 202))}, {'target_language': 'fr'},
    {'source_sha256': 'A' * 64}, {'request_id': 'not-a-uuid'}])
def test_request_validation_is_strict_before_any_work(change):
    value = dict(request_id=str(uuid4()), source_sha256='a' * 64, pages=[1],
                 target_language='zh', confirmed=True)
    value.update(change)
    with pytest.raises(ValidationError):
        TranslationRunCreate(**value)


def test_pages_are_canonicalized_unique_ascending():
    request = TranslationRunCreate(request_id=uuid4(), source_sha256='a' * 64,
                                   pages=[3, 1, 2], target_language='en', confirmed=True)
    assert request.pages == [1, 2, 3]


def test_control_validation_requires_positive_revision_and_confirmation():
    with pytest.raises(ValidationError):
        TranslationRunControl(request_id=uuid4(), expected_revision=0, confirmed=True)
    with pytest.raises(ValidationError):
        TranslationRunControl(request_id=uuid4(), expected_revision=1, confirmed=False)
    with pytest.raises(ValidationError):
        TranslationRunControl(request_id=uuid4(), expected_revision=1, confirmed=True, action='x')
