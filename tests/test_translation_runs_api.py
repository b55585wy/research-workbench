"""HTTP contract tests for continuous translation runs.

The app is built with a fake provider/runtime and autostart disabled, so no
server, model, parser or worker process is used.  Page work is driven through the
same translations service only to create saved results for read/control checks.
"""
import hashlib
import json
import threading
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from research_workbench.main import create_app
from research_workbench.store import timestamp
from test_translation_runs import (
    EmptyProvider, FakeProvider, FakeRuntime, answer, frozen_factory,
)

RUN_FIELDS = {
    'id', 'document_id', 'source_sha256', 'pages', 'target_language', 'status',
    'stage', 'revision', 'total_pages', 'processed_pages', 'completed_pages',
    'reused_pages', 'active_job_id', 'created_at', 'updated_at', 'error',
    'parser', 'model', 'model_fingerprint', 'prompt_version',
    'result_schema_version', 'result_pages',
}


def synthetic_assets(tmp_path, monkeypatch):
    assets = tmp_path / 'assets'
    plotly = assets / 'frontend' / 'vendor' / 'plotly' / '4.2.0'
    plotly.mkdir(parents=True)
    script = b'synthetic-plotly-renderer'
    (plotly / 'plotly-strict.min.js').write_bytes(script)
    (plotly / 'manifest.json').write_text(json.dumps({'files': {
        'plotly-strict.min.js': {'byte_size': len(script),
                                 'sha256': hashlib.sha256(script).hexdigest()}}}),
        encoding='utf-8')
    monkeypatch.setattr('research_workbench.charts.ROOT', assets)
    monkeypatch.setattr('research_workbench.main.ROOT', assets)


@pytest.fixture
def provider():
    return FakeProvider()


@pytest.fixture
def app(tmp_path, provider, monkeypatch):
    synthetic_assets(tmp_path, monkeypatch)
    application = create_app(tmp_path / 'workspace', agent_provider=provider,
                             agent_autostart=False, translation_autostart=False)
    application.state.translations.runtime = FakeRuntime()
    return application


@pytest.fixture
def client(app):
    with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 48000)) as client:
        yield client


def payload(document, pages, **changes):
    value = {'request_id': str(uuid4()), 'source_sha256': document['sha256'],
             'pages': pages, 'target_language': 'zh', 'confirmed': True}
    value.update(changes)
    return value


def control(run, **changes):
    value = {'request_id': str(uuid4()), 'expected_revision': run['revision'],
             'confirmed': True}
    value.update(changes)
    return value


def complete_one_page(app, monkeypatch):
    calls = []
    monkeypatch.setattr('research_workbench.translation.FrozenConnection',
                        frozen_factory(calls, answer))
    service = app.state.translations
    service.runs.advance()
    row = service.claim()
    assert row is not None
    service.run_job(row, threading.Event())
    service.runs.advance()
    return dict(row)


def counts(app):
    with app.state.store.connection() as db:
        return tuple(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                     for table in ('translation_jobs', 'translation_run_jobs',
                                   'translation_run_pages', 'translation_run_operations'))


def test_capabilities_adds_run_support_without_changing_the_legacy_limit(client):
    response = client.get('/api/v1/translation-capabilities')
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['max_pages'] == 5
    assert body['run_support'] is True
    assert body['run_max_pages'] == 200


def test_create_is_201_then_200_and_request_fields_are_strict(client, document):
    body = payload(document, [1, 2])
    first = client.post(f"/api/v1/documents/{document['id']}/translation-runs", json=body)
    assert first.status_code == 201, first.text
    created = first.json()
    assert set(created) == RUN_FIELDS
    assert created['pages'] == [1, 2] and created['status'] == 'queued'
    assert created['revision'] == 1 and created['total_pages'] == 2
    assert created['result_pages'] == [] and created['active_job_id'] is None

    duplicate = client.post(f"/api/v1/documents/{document['id']}/translation-runs", json=body)
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json() == created

    conflict = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                           json={**body, 'pages': [1]})
    assert conflict.status_code == 409
    assert conflict.json()['detail']['code'] == 'idempotency_conflict'

    assert client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                       json={**body, 'model': 'fake', 'request_id': str(uuid4())}
                       ).status_code == 422
    assert client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                       json={**body, 'confirmed': False,
                             'request_id': str(uuid4())}).status_code == 422
    assert client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                       json={**body, 'pages': [1, 3], 'request_id': str(uuid4())}
                       ).json()['detail']['code'] == 'invalid_page'
    assert client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                       json={**body, 'source_sha256': 'b' * 64,
                             'request_id': str(uuid4())}
                       ).json()['detail']['code'] == 'source_changed'


def test_one_active_run_and_list_and_detail_are_metadata_only(
        client, app, document, monkeypatch):
    created = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                          json=payload(document, [1, 2])).json()
    busy = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                       json=payload(document, [2]))
    assert busy.status_code == 409 and busy.json()['detail']['code'] == 'translation_run_busy'

    def forbidden(path):
        raise AssertionError('a polling read hashed the PDF')

    monkeypatch.setattr('research_workbench.translation.source_sha256', forbidden)
    before = counts(app)
    listed = client.get(f"/api/v1/documents/{document['id']}/translation-runs")
    detail = client.get(f"/api/v1/translation-runs/{created['id']}")
    requested = client.get(f"/api/v1/translation-runs/{created['id']}", params={'page': 1})
    after = counts(app)
    assert listed.status_code == detail.status_code == requested.status_code == 200
    assert before == after
    assert listed.json()['items'] == [detail.json()]
    assert detail.json()['result_pages'] == [] and requested.json()['result_pages'] == []
    assert detail.json()['active_job_id'] is None

    outside = client.get(f"/api/v1/translation-runs/{created['id']}", params={'page': 3})
    assert outside.status_code == 422 and outside.json()['detail']['code'] == 'invalid_page'
    assert client.get(f"/api/v1/translation-runs/{uuid4()}").status_code == 404


def test_page_request_returns_exactly_the_saved_page_and_its_child_identity(
        client, app, document, monkeypatch):
    created = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                          json=payload(document, [1, 2])).json()
    child = complete_one_page(app, monkeypatch)

    first = client.get(f"/api/v1/translation-runs/{created['id']}", params={'page': 1})
    assert first.status_code == 200, first.text
    assert len(first.json()['result_pages']) == 1
    result = first.json()['result_pages'][0]
    assert result['page'] == 1 and result['status'] == 'completed'
    assert result['job_id'] == child['id']
    assert result['blocks'][0]['translated_text'] == '译文 p1-b0-s0'

    second = client.get(f"/api/v1/translation-runs/{created['id']}", params={'page': 2})
    assert second.json()['result_pages'] == []
    whole = client.get(f"/api/v1/translation-runs/{created['id']}")
    assert whole.json()['result_pages'] == []
    listed = client.get(f"/api/v1/documents/{document['id']}/translation-runs")
    assert listed.json()['items'][0]['result_pages'] == []


def test_pause_and_resume_http_receipts_are_idempotent_and_revision_bound(
        client, app, document):
    created = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                          json=payload(document, [1, 2])).json()
    pause = control(created)
    first = client.post(f"/api/v1/translation-runs/{created['id']}/pause", json=pause)
    assert first.status_code == 200, first.text
    assert first.json()['status'] == 'paused' and first.json()['revision'] == 2

    repeated = client.post(f"/api/v1/translation-runs/{created['id']}/pause", json=pause)
    assert repeated.status_code == 200 and repeated.json() == first.json()

    changed = client.post(f"/api/v1/translation-runs/{created['id']}/pause",
                          json={**pause, 'expected_revision': 2})
    assert changed.status_code == 409
    assert changed.json()['detail']['code'] == 'idempotency_conflict'
    stale = client.post(f"/api/v1/translation-runs/{created['id']}/pause",
                        json={**pause, 'request_id': str(uuid4())})
    assert stale.status_code == 409
    assert stale.json()['detail']['code'] == 'translation_run_conflict'

    resume = control(first.json())
    resumed = client.post(f"/api/v1/translation-runs/{created['id']}/resume", json=resume)
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()['status'] == 'queued' and resumed.json()['revision'] == 3
    assert client.post(f"/api/v1/translation-runs/{created['id']}/resume",
                       json=resume).json() == resumed.json()

    invalid = client.post(f"/api/v1/translation-runs/{created['id']}/resume",
                          json=control(resumed.json()))
    assert invalid.status_code == 409
    assert invalid.json()['detail']['code'] == 'translation_run_invalid_state'

    with app.state.store.connection() as db:
        receipts = [row[0] for row in db.execute(
            'SELECT result_json FROM translation_run_operations')]
    assert receipts and all('api_key' not in value and 'synthetic-private-key' not in value
                            for value in receipts)


def test_missing_model_still_allows_saved_page_reads_but_not_new_work(
        client, app, document, monkeypatch):
    created = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                          json=payload(document, [1, 2])).json()
    complete_one_page(app, monkeypatch)
    app.state.translations.provider = EmptyProvider()

    saved = client.get(f"/api/v1/translation-runs/{created['id']}", params={'page': 1})
    assert saved.status_code == 200
    assert saved.json()['result_pages'][0]['status'] == 'completed'

    paused = client.post(f"/api/v1/translation-runs/{created['id']}/pause",
                         json=control(created))
    assert paused.status_code == 200
    resume = client.post(f"/api/v1/translation-runs/{created['id']}/resume",
                         json=control(paused.json()))
    assert resume.status_code == 409
    assert resume.json()['detail']['code'] == 'translation_run_not_ready'

    other = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                        json=payload(document, [2]))
    assert other.status_code == 409
    assert other.json()['detail']['code'] == 'translation_not_ready'


def test_trashed_document_blocks_run_reads_and_creation(client, app, document):
    created = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                          json=payload(document, [1])).json()
    with app.state.store.connection() as db:
        db.execute('INSERT INTO document_trash VALUES (?,?)', (document['id'], timestamp()))

    listed = client.get(f"/api/v1/documents/{document['id']}/translation-runs")
    detail = client.get(f"/api/v1/translation-runs/{created['id']}")
    created_again = client.post(f"/api/v1/documents/{document['id']}/translation-runs",
                                json=payload(document, [2]))
    assert listed.status_code == detail.status_code == created_again.status_code == 410
    assert listed.json()['detail']['code'] == 'document_trashed'
    assert detail.json()['detail']['code'] == 'document_trashed'
    assert created_again.json()['detail']['code'] == 'document_trashed'
