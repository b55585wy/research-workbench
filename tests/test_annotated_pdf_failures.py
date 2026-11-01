from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import threading

import pytest

import research_workbench.annotated_pdf_export as exporting
from test_annotated_pdf_export import add_note, markup, export_url, annotations


def clean(app):
    assert list(app.state.store.incoming.iterdir()) == []
    assert list(app.state.store.exports.iterdir()) == []


@pytest.mark.parametrize('stdout,code', [(b'not json', 0), (b'[]', 0), (b'null', 0), (b'{}', 0),
    (b'{"status":"ok"}', 3), (b'{"status":"ok"}', 0), (b'{"error":"pdf_export_failed"}', 1)])
def test_child_crash_or_incomplete_protocol_cannot_report_success(client, app, document, monkeypatch, stdout, code):
    add_note(client, document)
    with monkeypatch.context() as patch:
        patch.setattr(exporting.subprocess, 'run', lambda *a, **k: subprocess.CompletedProcess(a[0], code, stdout))
        response = client.get(export_url(document))
        assert response.status_code == 422 and response.json()['detail']['code'] == 'pdf_export_failed'
    clean(app)
    assert client.get('/api/v1/health').status_code == 200
    assert client.get(export_url(document)).status_code == 200
    clean(app)


@pytest.mark.parametrize('error,code,status', [(subprocess.TimeoutExpired('fixed worker', 20), 'pdf_export_timeout', 422),
    (PermissionError('secret/private/path'), 'pdf_export_unavailable', 503)])
def test_timeout_and_spawn_denial_release_admission(client, app, document, monkeypatch, error, code, status):
    add_note(client, document)
    def failed(*a, **k):
        raise error
    with monkeypatch.context() as patch:
        patch.setattr(exporting.subprocess, 'run', failed)
        response = client.get(export_url(document))
        assert response.status_code == status and response.json()['detail']['code'] == code
        assert 'private/path' not in response.text
    clean(app)
    assert client.get(export_url(document)).status_code == 200


def test_actual_short_timeout_kills_worker_and_next_export_works(client, app, document):
    add_note(client, document)
    app.state.annotated_pdf.worker.timeout = .001
    response = client.get(export_url(document))
    assert response.status_code == 422 and response.json()['detail']['code'] == 'pdf_export_timeout'
    clean(app)
    app.state.annotated_pdf.worker.timeout = 20
    assert client.get(export_url(document)).status_code == 200


def test_second_export_is_bounded_while_health_and_reading_stay_available(client, app, document):
    add_note(client, document)
    entered, release = threading.Event(), threading.Event()
    original = app.state.annotated_pdf.worker
    def wait_then_render(job):
        entered.set()
        assert release.wait(10)
        return original(job)
    app.state.annotated_pdf.worker = wait_then_render
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.get, export_url(document))
        try:
            assert entered.wait(5)
            response = client.get(export_url(document))
            assert response.status_code == 429 and response.json()['detail']['code'] == 'pdf_export_busy'
            assert client.get('/api/v1/health').status_code == 200
            assert client.get(f"/api/v1/documents/{document['id']}/file").status_code == 200
        finally:
            release.set()
        assert pending.result(timeout=10).status_code == 200
    clean(app)


@pytest.mark.parametrize('operation', ['copyfile', 'output'])
def test_storage_permission_failure_cleans_only_owned_files(client, app, document, monkeypatch, operation):
    add_note(client, document)
    keep_incoming = app.state.store.incoming/'unrelated.pending'
    keep_export = app.state.store.exports/'unrelated.saved'
    keep_incoming.write_bytes(b'keep incoming'); keep_export.write_bytes(b'keep export')
    def denied(*a, **k):
        raise PermissionError('secret/private/path')
    with monkeypatch.context() as patch:
        if operation == 'copyfile':
            patch.setattr(exporting.shutil, 'copyfile', denied)
        else:
            patch.setattr(exporting.tempfile, 'NamedTemporaryFile', denied)
        response = client.get(export_url(document))
        assert response.status_code == 503 and 'private/path' not in response.text
    assert keep_incoming.read_bytes() == b'keep incoming' and keep_export.read_bytes() == b'keep export'
    assert list(app.state.store.incoming.iterdir()) == [keep_incoming]
    assert list(app.state.store.exports.iterdir()) == [keep_export]


def test_original_changed_during_generation_is_refused(client, app, document):
    add_note(client, document)
    original = app.state.annotated_pdf.worker
    def change_source(job):
        result = original(job)
        (app.state.store.files/(document['id']+'.pdf')).write_bytes(b'changed')
        return result
    app.state.annotated_pdf.worker = change_source
    response = client.get(export_url(document))
    assert response.status_code == 409 and response.json()['detail']['code'] == 'source_changed'
    clean(app)


@pytest.mark.parametrize('change', ['sha256', 'byte_size', 'page_count', 'note_count', 'missing', 'header'])
def test_generated_file_metadata_header_and_integrity_are_verified(client, app, document, change):
    add_note(client, document)
    original = app.state.annotated_pdf.worker
    def corrupt_output(job):
        value = original(job)
        if change in ('byte_size', 'page_count', 'note_count'):
            value[change] += 1
        elif change == 'sha256':
            value['sha256'] = 'b'*64
        elif change == 'missing':
            (job/'output.pdf').unlink()
        else:
            (job/'output.pdf').write_bytes(b'not PDF')
        return value
    app.state.annotated_pdf.worker = corrupt_output
    assert client.get(export_url(document)).status_code == 422
    clean(app)


def test_corrupt_stored_markup_and_note_bounds_are_rejected_before_worker(client, app, document):
    markup(client, document)
    original = app.state.store.reading_snapshot
    def corrupt(identifier):
        source, notes, excerpts = original(identifier)
        notes[0]['annotation']['source_sha256'] = 'b'*64
        return source, notes, excerpts
    app.state.store.reading_snapshot = corrupt
    response = client.get(export_url(document))
    assert response.status_code == 409 and response.json()['detail']['code'] == 'pdf_export_invalid'
    clean(app)


def test_output_size_limit_is_enforced_before_delivery(client, app, document, monkeypatch):
    add_note(client, document)
    monkeypatch.setattr(exporting, 'MAX_OUTPUT_BYTES', 10)
    response = client.get(export_url(document))
    assert response.status_code == 413 and response.json()['detail']['code'] == 'pdf_export_too_large'
    clean(app)
