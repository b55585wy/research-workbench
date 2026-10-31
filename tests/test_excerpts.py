import io
import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, RectangleObject
import pytest

from research_workbench.models import WorkspaceError
import research_workbench.excerpts as excerpts


def add_region(client, document, rect=None):
    data = {'request_id': str(uuid4()), 'page': 1,
            'rect': [0.1, 0.2, 0.8, 0.7] if rect is None else rect, 'text': 'A figure or table'}
    result = client.post(f"/api/v1/documents/{document['id']}/notes", json=data)
    assert result.status_code == 201
    return result.json()


def excerpt_url(document, note):
    return f"/api/v1/documents/{document['id']}/notes/{note['id']}/excerpt"


def colored_pdf(rotation=0, cropped=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=100)
    page[NameObject('/Resources')] = DictionaryObject()
    stream = DecodedStreamObject()
    stream.set_data(b'1 0 0 rg 0 50 100 50 re f\n0 1 0 rg 100 50 100 50 re f\n'
                    b'0 0 1 rg 0 0 100 50 re f\n1 1 0 rg 100 0 100 50 re f\n')
    page[NameObject('/Contents')] = writer._add_object(stream)
    if cropped:
        page.cropbox = RectangleObject([20, 10, 180, 90])
    if rotation:
        page.rotate(rotation)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize('rotation,color', [(0, (255, 0, 0)), (90, (0, 0, 255)),
                                          (180, (255, 255, 0)), (270, (0, 255, 0))])
@pytest.mark.parametrize('cropped', [False, True])
def test_visual_top_left_matches_intrinsic_rotation_and_crop(client, rotation, color, cropped):
    document = client.post('/api/v1/documents', files={'file': ('colors.pdf', colored_pdf(rotation, cropped))}).json()
    note = add_region(client, document, [0.05, 0.05, 0.45, 0.45])
    result = client.post(excerpt_url(document, note))
    assert result.status_code == 201, result.text
    record = result.json()
    image_response = client.get(record['image_url'])
    assert image_response.headers['content-type'] == 'image/png'
    with Image.open(io.BytesIO(image_response.content)) as image:
        assert image.size == (record['width'], record['height'])
        assert image.convert('RGB').getpixel((image.width // 2, image.height // 2)) == color
        assert max(image.size) <= 2048 and image.width * image.height <= 4_000_000


def test_repeated_excerpt_preserves_note_and_image(client, document):
    note = add_region(client, document)
    before = client.get(f"/api/v1/documents/{document['id']}/notes").json()
    url = excerpt_url(document, note)
    created = client.post(url)
    repeated = client.post(url)
    assert created.status_code == 201 and repeated.status_code == 200
    assert repeated.json() == created.json()
    assert created.json()['source_sha256'] == document['sha256']
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json() == before
    assert client.get(f"/api/v1/documents/{document['id']}/excerpts").json()['items'] == [created.json()]


def test_whole_page_and_wrong_document_cannot_create_excerpt(client, document, pdf):
    page_note = client.post(f"/api/v1/documents/{document['id']}/notes", json={
        'request_id': str(uuid4()), 'page': 1, 'rect': None, 'text': 'Whole page'}).json()
    assert client.post(excerpt_url(document, page_note)).json()['detail']['code'] == 'region_required'
    region = add_region(client, document)
    second = client.post('/api/v1/documents', files={'file': ('second.pdf', pdf)}).json()
    assert client.post(excerpt_url(second, region)).status_code == 404
    assert client.get(excerpt_url(document, region)).status_code == 404
    assert client.post(f"/api/v1/documents/{document['id']}/notes/invalid/excerpt").status_code == 422


@pytest.mark.parametrize('missing', [False, True])
def test_original_must_still_match_before_excerpt(client, app, document, missing):
    note = add_region(client, document)
    source = app.state.store.files / f"{document['id']}.pdf"
    if missing:
        source.unlink()
    else:
        source.write_bytes(b'changed')
    response = client.post(excerpt_url(document, note))
    assert response.status_code == 409
    assert app.state.store.list_excerpts(document['id']) == []


def test_renderer_busy_rejects_without_duplicate_work(client, app, document):
    note = add_region(client, document)
    app.state.excerpts.slots.acquire()
    try:
        assert client.post(excerpt_url(document, note)).status_code == 429
    finally:
        app.state.excerpts.slots.release()
    assert client.post(excerpt_url(document, note)).status_code == 201


@pytest.mark.parametrize('script,code', [('import time;time.sleep(10)', 'renderer_timeout'),
                                      ('import os;os._exit(38)', 'renderer_failed')])
def test_actual_child_failure_leaves_web_and_note_available(client, app, document, tmp_path, monkeypatch, script, code):
    note = add_region(client, document)
    worker = tmp_path / 'worker.py'
    worker.write_text(script)
    original = excerpts.WORKER
    monkeypatch.setattr(excerpts, 'WORKER', worker)
    app.state.excerpts.renderer.timeout = 0.4
    response = client.post(excerpt_url(document, note))
    assert response.status_code == 422
    assert response.json()['detail']['code'] == code
    assert client.get('/api/v1/health').status_code == 200
    assert list(app.state.store.incoming.iterdir()) == []
    assert list(app.state.store.excerpts.iterdir()) == []
    monkeypatch.setattr(excerpts, 'WORKER', original)
    app.state.excerpts.renderer.timeout = 12
    assert client.post(excerpt_url(document, note)).status_code == 201


def test_image_commit_failure_keeps_note_and_cleans_bytes(client, app, document, monkeypatch):
    note = add_region(client, document)
    def denied(*args):
        raise PermissionError('private/path')
    with monkeypatch.context() as patch:
        patch.setattr(app.state.store, 'add_excerpt', denied)
        response = client.post(excerpt_url(document, note))
        assert response.status_code == 503 and 'private/path' not in response.text
    assert len(app.state.store.list_notes(document['id'])) == 1
    assert app.state.store.list_excerpts(document['id']) == []
    assert list(app.state.store.excerpts.iterdir()) == []
    assert list(app.state.store.incoming.iterdir()) == []
    assert client.post(excerpt_url(document, note)).status_code == 201


def test_source_changed_during_render_is_not_committed(client, app, document):
    note = add_region(client, document)
    real = app.state.excerpts.renderer
    def changed(source, note, output):
        real(source, note, output)
        source.write_bytes(b'changed while rendering')
    app.state.excerpts.renderer = changed
    response = client.post(excerpt_url(document, note))
    assert response.status_code == 409
    assert app.state.store.list_excerpts(document['id']) == []
    assert list(app.state.store.incoming.iterdir()) == []


@pytest.mark.parametrize('missing', [False, True])
def test_missing_or_corrupt_image_is_rejected(client, app, document, missing):
    note = add_region(client, document)
    assert client.post(excerpt_url(document, note)).status_code == 201
    path = app.state.store.excerpts / f"{note['id']}.png"
    if missing:
        path.unlink()
    else:
        path.write_bytes(b'not the saved PNG')
    assert client.get(excerpt_url(document, note)).status_code == 409
    assert client.post(excerpt_url(document, note)).status_code == 409


def test_concurrent_duplicate_request_finishes_as_one_image(client, app, document):
    note = add_region(client, document)
    entered, release = threading.Event(), threading.Event()
    actual = app.state.excerpts.renderer
    def held(source, note, output):
        entered.set()
        assert release.wait(5)
        actual(source, note, output)
    app.state.excerpts.renderer = held
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(app.state.excerpts.create, document['id'], note['id'])
        assert entered.wait(3)
        try:
            assert client.post(excerpt_url(document, note)).status_code == 429
        finally:
            release.set()
        record, created = pending.result(timeout=10)
    assert created is True
    repeated = client.post(excerpt_url(document, note))
    assert repeated.status_code == 200 and repeated.json() == record
    assert len(app.state.store.list_excerpts(document['id'])) == 1
    assert len(list(app.state.store.excerpts.iterdir())) == 1


def test_mismatched_source_identity_is_rejected(client, app, document):
    note = add_region(client, document)
    assert client.post(excerpt_url(document, note)).status_code == 201
    with app.state.store.connection() as connection:
        connection.execute('UPDATE excerpts SET source_sha256=? WHERE note_id=?', ('f' * 64, note['id']))
    assert client.get(excerpt_url(document, note)).status_code == 409
    assert client.post(excerpt_url(document, note)).status_code == 409
    assert client.get(f"/api/v1/documents/{document['id']}/export").status_code == 409
