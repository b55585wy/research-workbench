import copy
import hashlib
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from research_workbench.main import create_app
from research_workbench.store import timestamp


class FakeProvider:
    def __init__(self):
        self.calls = []
        self.result = {'role': 'assistant', 'content': '合成选区译文', 'finish_reason': 'stop'}

    def complete_once(self, messages, tools):
        self.calls.append((copy.deepcopy(messages), tools))
        return copy.deepcopy(self.result)


@pytest.fixture
def provider():
    return FakeProvider()


@pytest.fixture
def app(tmp_path, provider, monkeypatch):
    # This isolated source copy intentionally has no frontend bundle.  Supply a
    # synthetic local renderer asset root so create_app exercises the real
    # service/router wiring without reading or changing the original workspace.
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
    return create_app(tmp_path / 'workspace', agent_provider=provider,
                      agent_autostart=False, translation_autostart=False)


@pytest.fixture
def client(app):
    with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 48000)) as client:
        yield client


def payload(document, **changes):
    value = {'request_id': str(uuid4()), 'source_sha256': document['sha256'], 'pages': [1],
             'text': 'Synthetic selected text', 'target_language': 'zh'}
    value.update(changes)
    return value


def test_selected_text_translation_returns_exact_bounded_response(client, document, provider):
    response = client.post(f"/api/v1/documents/{document['id']}/selection-translation",
                           json=payload(document, pages=[1, 2], text='3.5 mM [12]',
                                       target_language='en'))
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {'request_id', 'document_id', 'source_sha256', 'pages',
                         'target_language', 'translated_text'}
    assert body['document_id'] == document['id'] and body['source_sha256'] == document['sha256']
    assert body['pages'] == [1, 2] and body['target_language'] == 'en'
    assert body['translated_text'] == '合成选区译文' and 'rect' not in body
    assert len(provider.calls) == 1


@pytest.mark.parametrize('change', [
    {'rect': [0, 0, 1, 1]}, {'model': 'fake'}, {'pages': [2, 1]}, {'pages': [1, 1]},
    {'pages': []}, {'pages': list(range(1, 22))}, {'text': ''}, {'text': '   '},
    {'text': 'x' * 3001}, {'target_language': 'fr'}, {'source_sha256': 'A' * 64},
    {'request_id': 'not-a-uuid'}])
def test_invalid_payload_uses_existing_validation_error_shape(client, document, provider, change):
    response = client.post(f"/api/v1/documents/{document['id']}/selection-translation",
                           json=payload(document, **change))
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'validation_error'
    assert provider.calls == []


def test_missing_changed_page_trashed_and_study_sources_are_rejected(client, app, document, provider):
    prefix = f"/api/v1/documents/{document['id']}/selection-translation"
    response = client.post(prefix, json=payload(document, source_sha256='b' * 64))
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'source_changed'

    response = client.post(prefix, json=payload(document, pages=[3]))
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'invalid_page'

    missing = client.post(f"/api/v1/documents/{uuid4()}/selection-translation",
                          json=payload(document))
    assert missing.status_code == 404
    assert missing.json()['detail']['code'] == 'not_found'

    study = client.post('/api/v1/studies', json={
        'request_id': str(uuid4()), 'name': 'Synthetic study',
        'question': 'Synthetic question'}).json()
    response = client.post(f"/api/v1/documents/{study['id']}/selection-translation",
                           json=payload(document, source_sha256='a' * 64))
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'source_has_no_pdf'

    with app.state.store.connection() as database:
        database.execute('INSERT INTO document_trash VALUES (?,?)',
                         (document['id'], timestamp()))
    response = client.post(prefix, json=payload(document))
    assert response.status_code == 410
    assert response.json()['detail']['code'] == 'document_trashed'
    assert provider.calls == []


def test_completed_and_failed_request_ids_dedupe_through_http(client, document, provider):
    prefix = f"/api/v1/documents/{document['id']}/selection-translation"
    body = payload(document)
    first = client.post(prefix, json=body)
    second = client.post(prefix, json=body)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(provider.calls) == 1

    conflict = client.post(prefix, json={**body, 'text': 'Changed selected text'})
    assert conflict.status_code == 409
    assert conflict.json()['detail']['code'] == 'selection_translation_conflict'
    assert len(provider.calls) == 1

    provider.result = {'role': 'assistant', 'content': '', 'finish_reason': 'stop'}
    failed_body = payload(document)
    first_failure = client.post(prefix, json=failed_body)
    second_failure = client.post(prefix, json=failed_body)
    assert first_failure.status_code == second_failure.status_code == 502
    assert first_failure.json() == second_failure.json()
    assert len(provider.calls) == 2

    provider.result = {'role': 'assistant', 'content': 'New answer', 'finish_reason': 'stop'}
    recovered = client.post(prefix, json=payload(document))
    assert recovered.status_code == 200
    assert recovered.json()['translated_text'] == 'New answer'
    assert len(provider.calls) == 3


def test_provider_failure_is_a_safe_502_without_leaking_output(client, document, provider):
    provider.result = {'role': 'assistant', 'content': '',
                       'tool_calls': [{'id': 'synthetic'}], 'finish_reason': 'tool_calls'}
    prefix = f"/api/v1/documents/{document['id']}/selection-translation"
    first = client.post(prefix, json=payload(document))
    assert first.status_code == 502
    assert first.json()['detail']['code'] == 'selection_translation_output_invalid'
    assert 'synthetic' not in first.text
    assert len(provider.calls) == 1

    provider.result = {'role': 'assistant', 'content': 'Recovered', 'finish_reason': 'stop'}
    recovered = client.post(prefix, json=payload(document))
    assert recovered.status_code == 200
    assert recovered.json()['translated_text'] == 'Recovered'
    assert len(provider.calls) == 2
