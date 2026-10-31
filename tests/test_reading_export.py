import hashlib
import io
import json
import zipfile
import asyncio

import pytest

import research_workbench.reading_export as exporting
from test_excerpts import add_region, excerpt_url


def verify_bundle(response, expected_pdf):
    assert response.status_code == 200, response.text[:300] if response.status_code != 200 else ''
    assert response.headers['content-type'] == 'application/zip'
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert archive.read('source.pdf') == expected_pdf
        for name, record in manifest['files'].items():
            content = archive.read(name)
            assert hashlib.sha256(content).hexdigest() == record['sha256']
            assert len(content) == record['byte_size']
            assert not name.startswith('/') and '..' not in name.split('/')
        return {name: archive.read(name) for name in archive.namelist()}


def test_bundle_contains_exact_images_pdf_and_portable_notes(client, app, document, pdf):
    note = add_region(client, document)
    image = client.post(excerpt_url(document, note)).json()
    response = client.get(f"/api/v1/documents/{document['id']}/export")
    bundle = verify_bundle(response, pdf)
    image_path = f"images/{note['id']}.png"
    assert bundle[image_path] == client.get(image['image_url']).content
    payload = json.loads(bundle['notes.json'])
    assert payload['notes'][0]['id'] == note['id']
    assert payload['notes'][0]['rect'] == note['rect']
    assert payload['notes'][0]['excerpt']['image_path'] == image_path
    assert 'image_url' not in payload['notes'][0]['excerpt']
    assert b'source.pdf#page=1' in bundle['README.md']
    assert image_path.encode() in bundle['index.html']
    assert b'127.0.0.1' not in bundle['notes.json']
    assert list(app.state.store.exports.iterdir()) == []


def test_empty_reading_record_still_exports_original(client, document, pdf):
    bundle = verify_bundle(client.get(f"/api/v1/documents/{document['id']}/export"), pdf)
    assert json.loads(bundle['notes.json'])['notes'] == []
    assert set(bundle) == {'source.pdf', 'README.md', 'index.html', 'notes.json', 'manifest.json'}


def test_user_markup_is_literal_in_html_and_markdown_but_original_in_json(client, document, pdf):
    value = '<script>alert(1)</script>\n![remote](https://example.invalid/x)\n# Heading'
    note = add_region(client, document)
    # Create a separate real note instead of changing immutable source data.
    from uuid import uuid4
    client.post(f"/api/v1/documents/{document['id']}/notes", json={
        'request_id': str(uuid4()), 'page': 1, 'rect': None, 'text': value})
    bundle = verify_bundle(client.get(f"/api/v1/documents/{document['id']}/export"), pdf)
    assert b'<script>' not in bundle['index.html']
    assert b'&lt;script&gt;' in bundle['index.html']
    assert b'![remote](' not in bundle['README.md']
    assert any(n['text'] == value for n in json.loads(bundle['notes.json'])['notes'])


@pytest.mark.parametrize('target', ['source', 'image'])
def test_export_rejects_changed_source_or_image_and_leaves_no_zip(client, app, document, target):
    note = add_region(client, document)
    client.post(excerpt_url(document, note))
    path = app.state.store.files / f"{document['id']}.pdf" if target == 'source' else app.state.store.excerpts / f"{note['id']}.png"
    path.write_bytes(b'changed')
    assert client.get(f"/api/v1/documents/{document['id']}/export").status_code == 409
    assert list(app.state.store.exports.iterdir()) == []


def test_export_size_limit_is_enforced_before_sending(client, app, document, monkeypatch):
    monkeypatch.setattr(exporting, 'MAX_EXPORT_BYTES', 10)
    assert client.get(f"/api/v1/documents/{document['id']}/export").status_code == 413
    assert list(app.state.store.exports.iterdir()) == []


def test_export_io_failure_cleans_partial_archive(client, app, document, monkeypatch):
    def failed(*args):
        raise PermissionError('secret/path')
    monkeypatch.setattr(exporting.ArchiveWriter, 'file', failed)
    response = client.get(f"/api/v1/documents/{document['id']}/export")
    assert response.status_code == 503 and 'secret/path' not in response.text
    assert list(app.state.store.exports.iterdir()) == []


def test_disconnected_download_removes_owned_temporary_bundle(tmp_path):
    target = tmp_path / 'download.zip'
    target.write_bytes(b'x' * 200000)
    response = exporting.ExportResponse(target, media_type='application/zip')
    async def receive():
        return {'type': 'http.disconnect'}
    async def send(message):
        if message['type'] == 'http.response.body':
            raise OSError('client disconnected')
    async def exercise():
        with pytest.raises(Exception):
            await response({'type': 'http', 'method': 'GET', 'headers': [],
                            'asgi': {'spec_version': '2.4'}, 'extensions': {}}, receive, send)
    asyncio.run(exercise())
    assert not target.exists()
