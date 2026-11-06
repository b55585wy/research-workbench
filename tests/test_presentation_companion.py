"""Bounded smoke tests for the paper-presentation companion service.

Synthetic PDFs, scripted providers and temporary directories only: no real
network, model, credential, Rscript, production data or deployment is touched.
"""
import asyncio
import concurrent.futures
from datetime import datetime, timedelta, timezone
import hashlib
import importlib
import io
import json
from pathlib import Path
import sqlite3
import threading
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import (
    DecodedStreamObject, DictionaryObject, NameObject)

from agent_support import ScriptedModel, text_pdf
from analysis_support import payload as analysis_payload, upload
from chart_support import payload as chart_payload, save
from research_workbench import presentation_companion as companion
from research_workbench.analysis_models import AnalysisCreate
from research_workbench.analysis_worker import execute
from research_workbench.guest_gateway import GuestModelConnection
from research_workbench.guest_registry import (
    COOKIE_MAX_AGE, COOKIE_NAME, GuestRegistry, GuestRegistryError,
    GuestSecurityError, GuestStorageError)
from research_workbench.main import create_app
from research_workbench.presentation_passive import (
    PassiveRegistry, PresentationReadStore)
from research_workbench.presentation_service import OUTLINE_TTL, Presentations
from research_workbench.store import timestamp

BASE_CLIENT = ('127.0.0.1', 50000)


# --------------------------------------------------------------------- helpers
def pdf_bytes(pages):
    writer = PdfWriter()
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                             NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica')})
    reference = writer._add_object(font)
    for content in pages:
        page = writer.add_blank_page(width=612, height=792)
        lines = [content] if isinstance(content, str) else list(content)
        page[NameObject('/Resources')] = DictionaryObject({
            NameObject('/Font'): DictionaryObject({NameObject('/F1'): reference})})
        escaped = [line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                   for line in lines]
        operations = ('BT /F1 10 Tf 14 TL 40 760 Td '
                      + ' '.join(f'({line}) Tj T*' for line in escaped) + ' ET')
        stream = DecodedStreamObject()
        stream.set_data(operations.encode('latin-1', errors='replace'))
        page[NameObject('/Contents')] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def cookie(token):
    return {'cookie': f'{COOKIE_NAME}={token}'}


def digest_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def set_metadata(client, document):
    current = client.get(f"/api/v1/documents/{document['id']}/metadata").json()
    response = client.patch(
        f"/api/v1/documents/{document['id']}/metadata",
        json={'request_id': str(uuid4()), 'expected_revision': current['revision'],
              'title': 'Stored paper title', 'authors': 'Wang; Smith',
              'year': 2025, 'doi': '10.1234/example'})
    assert response.status_code == 200, response.text


def seed_guest(base, *, pages=None, with_dataset=False, with_chart=False,
               with_note=False, with_background_work=False, registry=None):
    """Create one real schema-29 guest workspace through the normal app."""
    registry = registry or GuestRegistry(base)
    session = registry.create()
    guest_root = registry.space_root(session.guest_id)
    app = create_app(guest_root, agent_provider=ScriptedModel(),
                     agent_autostart=False, analysis_autostart=False,
                     translation_autostart=False)
    value = {'registry': registry, 'session': session, 'root': guest_root}
    with TestClient(app, base_url='http://127.0.0.1', client=BASE_CLIENT) as client:
        content = pdf_bytes(pages) if pages is not None else text_pdf()
        document = client.post('/api/v1/documents', files={
            'file': ('paper.pdf', content, 'application/pdf')}).json()
        value['document'] = document
        set_metadata(client, document)
        if with_note:
            note = client.post(f"/api/v1/documents/{document['id']}/notes",
                               json={'request_id': str(uuid4()), 'page': 1,
                                     'text': 'Synthetic companion note'})
            assert note.status_code == 201, note.text
            value['note'] = note.json()
        if with_dataset:
            data = upload(client, document).json()
            value['dataset'] = data
            job, _ = app.state.analysis.create(
                document['id'],
                AnalysisCreate(**analysis_payload(
                    data, columns=['value', 'second'])))
            row = app.state.analysis.claim()
            execute(app.state.analysis, row, threading.Event())
            value['analysis'] = app.state.analysis.get(document['id'], job['id'])
        if with_chart:
            chart = save(client, document, chart_payload(
                client, value['dataset'], 'analysis_counts',
                analysis_id=value['analysis']['id']))
            value['chart'] = chart
        if with_background_work:
            queued = str(uuid4())
            value['queued_job'] = queued
            with app.state.store.connection() as db:
                db.execute(
                    'INSERT INTO document_purges (document_id,request_id,payload_hash,'
                    'revision,preview_sha256,manifest_json,counts_json,created_at,cleaned_at) '
                    'VALUES (?,?,?,?,?,?,?,?,NULL)',
                    (document['id'], str(uuid4()), 'a' * 64, 1, 'b' * 64, '{}',
                     '{}', timestamp()))
                db.execute(
                    'INSERT INTO analysis_jobs (id,document_id,dataset_id,request_hash,'
                    'payload_json,status,outputs_json,created_at) '
                    "VALUES (?,?,?,?,?,'queued','[]',?)",
                    (queued, document['id'], value['dataset']['id'],
                     'c' * 64, '{}', timestamp()))
    return value


def companion_app(base, **kwargs):
    return companion.create_companion_app(base, **kwargs)


def client_for(app, client=BASE_CLIENT, base_url='http://127.0.0.1'):
    return TestClient(app, base_url=base_url, client=client)


def paper_body(**changes):
    value = {'title': 'Companion paper deck', 'style': 'default',
             'include_paper': True, 'paper_pages': [1],
             'note_ids': [], 'chart_ids': [], 'analysis_ids': []}
    value.update(changes)
    return value


# ------------------------------------------- manual ASGI driving for cancellation
def http_scope(path, *, method='POST', body=b'', token=None):
    """A loopback ASGI scope so one request can be cancelled deterministically."""
    headers = [(b'host', b'127.0.0.1:3154'),
               (b'content-type', b'application/json'),
               (b'content-length', str(len(body)).encode('ascii'))]
    if token is not None:
        headers.append((b'cookie', f'{COOKIE_NAME}={token}'.encode('ascii')))
    return {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.3'},
            'http_version': '1.1', 'method': method, 'scheme': 'http',
            'path': path, 'raw_path': path.encode('ascii'), 'query_string': b'',
            'root_path': '', 'headers': headers, 'client': BASE_CLIENT,
            'server': ('127.0.0.1', 3154), 'state': {}}


class AsgiCall:
    """Collect one raw ASGI response (and count response starts)."""

    def __init__(self):
        self.status = None
        self.starts = 0
        self.body = b''
        self.finished = False

    def send(self):
        async def send(message):
            if message['type'] == 'http.response.start':
                self.starts += 1
                self.status = message['status']
            elif message['type'] == 'http.response.body':
                self.body += message.get('body') or b''
                self.finished = not message.get('more_body', False)
        return send

    def json(self):
        return json.loads(self.body or b'{}')


def http_receive(body=b''):
    state = {'sent': False}

    async def receive():
        if not state['sent']:
            state['sent'] = True
            return {'type': 'http.request', 'body': body, 'more_body': False}
        return {'type': 'http.disconnect'}
    return receive


async def call_app(app, scope, body=b''):
    call = AsgiCall()
    await app(scope, http_receive(body), call.send())
    return call


async def let_loop_run():
    """Give pending cancellation/worker callbacks a chance to run."""
    for _ in range(3):
        await asyncio.sleep(0)


def make_directory_redirect(link, target):
    """Create a directory symlink, or a Windows junction when unprivileged."""
    try:
        link.symlink_to(target, target_is_directory=True)
        return True
    except (OSError, NotImplementedError):
        import subprocess
        result = subprocess.run(
            ['cmd', '/c', 'mklink', '/J', str(link), str(target)],
            capture_output=True, text=True)
        return result.returncode == 0 and link.exists()


def remove_directory_redirect(path):
    for action in (path.rmdir, path.unlink):
        try:
            action()
            return
        except OSError:
            continue


def get_context(client, document, body, token):
    response = client.post(
        f"/api/v1/documents/{document['id']}/paper-presentations/context",
        json=body, headers=cookie(token))
    return response


def export_deck(client, document, body, context_value, token):
    request = {**body, 'source_sha256': context_value['source_sha256'],
               'outline': context_value['suggested_outline']}
    return client.post(
        f"/api/v1/documents/{document['id']}/paper-presentations/export",
        json=request, headers=cookie(token))


def outline_request(client, document, body, context_value, token):
    request = {**body, 'source_sha256': context_value['source_sha256'],
               'request_id': str(uuid4()), 'confirmed': True}
    response = client.post(
        f"/api/v1/documents/{document['id']}/paper-presentations/outline",
        json=request, headers=cookie(token))
    return response, request


def guest_timestamps(registry, guest_id):
    with sqlite3.connect(registry.database) as db:
        return db.execute(
            'SELECT session_issued_at,last_seen_at FROM guests WHERE guest_id=?',
            (guest_id,)).fetchone()


# ----------------------------------------------------------------------- tests
def test_import_and_passive_start_do_not_construct_or_probe(
        tmp_path, monkeypatch):
    def refuse(*_args, **_kwargs):
        raise AssertionError('import must not open SQLite or run a probe')

    with monkeypatch.context() as scoped:
        scoped.setattr(sqlite3, 'connect', refuse)
        scoped.setattr('subprocess.run', refuse)
        reloaded = importlib.reload(companion)
        assert callable(reloaded.create_companion_app)
        assert callable(reloaded.main)

    with monkeypatch.context() as scoped:
        scoped.setattr(companion, 'PresentationReadStore',
                       lambda *_: pytest.fail('capabilities built a Store'))
        scoped.setattr(companion, 'PassiveDatasets',
                       lambda *_: pytest.fail('capabilities built datasets'))
        scoped.setattr(companion, 'PassiveAnalyses',
                       lambda *_: pytest.fail('capabilities built analyses'))
        scoped.setattr(companion, 'Charts',
                       lambda *_: pytest.fail('capabilities built charts'))

        guest = seed_guest(tmp_path / 'base')
        app = companion_app(tmp_path / 'base')
        with client_for(app) as client:
            response = client.get('/api/v1/paper-presentations/capabilities',
                                  headers=cookie(guest['session'].token))
        assert response.status_code == 200, response.text
        value = response.json()
        assert value['api_family'] == 'paper-presentations/v1'
        assert value['paper_available'] is True
        assert value['limits']['paper_pages'] == 60
        assert value['limits']['paper_chars'] == 120000
        assert value['limits']['paper_context_chars'] == 140000
        assert companion.MAX_BUNDLES == 32
        assert companion.MAX_CONCURRENT_REQUESTS == 2
        assert app.state.companion.max_bundles == 32
        assert app.state.companion._bundles == {}
        exports = guest['root'] / 'exports'
        assert not list(exports.glob('presentation-companion-*'))


def test_passive_start_keeps_schema_data_purges_and_jobs_untouched(tmp_path):
    base = tmp_path / 'base'
    guest = seed_guest(base, with_dataset=True, with_background_work=True)
    registry = guest['registry']
    before_users = guest_timestamps(registry, guest['session'].guest_id)
    paths = [registry.database, guest['root'] / 'workspace.sqlite3',
             guest['root'] / 'documents' / f"{guest['document']['id']}.pdf"]
    before = {str(path): digest_file(path) for path in paths}

    app = companion_app(base)
    with client_for(app) as client:
        caps = client.get('/api/v1/paper-presentations/capabilities',
                          headers=cookie(guest['session'].token))
        assert caps.status_code == 200, caps.text
        context_value = get_context(
            client, guest['document'], paper_body(), guest['session'].token)
        assert context_value.status_code == 200, context_value.text
        exported = export_deck(client, guest['document'], paper_body(),
                               context_value.json(), guest['session'].token)
        assert exported.status_code == 200, exported.text

    assert {str(path): digest_file(path) for path in paths} == before
    assert guest_timestamps(registry, guest['session'].guest_id) == before_users

    with sqlite3.connect(registry.database) as db:
        assert db.execute('SELECT COUNT(*) FROM guests').fetchone()[0] == 1
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2
    with sqlite3.connect(guest['root'] / 'workspace.sqlite3') as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 29
        purge = db.execute(
            'SELECT cleaned_at FROM document_purges').fetchall()
        job = db.execute('SELECT status FROM analysis_jobs WHERE id=?',
                         (guest['queued_job'],)).fetchall()
    assert purge == [(None,)] and job == [('queued',)]


def test_missing_older_newer_and_symlinked_roots_are_rejected(tmp_path):
    with pytest.raises(GuestSecurityError):
        PassiveRegistry(tmp_path / 'missing')

    base = tmp_path / 'base'
    guest = seed_guest(base)
    registry = guest['registry']

    with sqlite3.connect(registry.database) as db:
        db.execute('PRAGMA user_version=1')
    with pytest.raises(GuestStorageError):
        PassiveRegistry(base)
    with sqlite3.connect(registry.database) as db:
        db.execute('PRAGMA user_version=3')
    with pytest.raises(GuestStorageError):
        PassiveRegistry(base)
    with sqlite3.connect(registry.database) as db:
        db.execute('PRAGMA user_version=2')
    PassiveRegistry(base)

    database = guest['root'] / 'workspace.sqlite3'
    for version in (28, 30):
        with sqlite3.connect(database) as db:
            db.execute(f'PRAGMA user_version={version}')
        with pytest.raises(GuestStorageError):
            PresentationReadStore(guest['root'])
    with sqlite3.connect(database) as db:
        db.execute('PRAGMA user_version=29')

    with sqlite3.connect(registry.database) as db:
        columns = {row[1] for row in db.execute('PRAGMA table_info(guests)')}
    assert columns == {'guest_id', 'session_digest', 'recovery_digest',
                       'recovery_generation', 'created_at', 'last_seen_at',
                       'session_issued_at'}

    link = tmp_path / 'linked-base'
    created = False
    try:
        link.symlink_to(base, target_is_directory=True)
        created = True
    except (OSError, NotImplementedError):
        # A Windows junction needs no elevation and provides the same test.
        import subprocess
        result = subprocess.run(
            ['cmd', '/c', 'mklink', '/J', str(link), str(base)],
            capture_output=True, text=True)
        created = result.returncode == 0 and link.exists()
    if not created:
        pytest.skip('symlinks/junctions are unavailable on this platform')
    with pytest.raises(GuestRegistryError):
        PassiveRegistry(link)


def test_personal_shared_and_invalid_personal_policy_without_network(
        tmp_path, monkeypatch):
    base = tmp_path / 'base'
    guest = seed_guest(base)
    operator = tmp_path / 'operator'
    operator.mkdir()
    shared = operator / 'shared-model.json'
    shared.write_text(json.dumps({
        'base_url': 'https://api.deepseek.com', 'model': 'deepseek-chat',
        'api_key': 'sk-synthetic-shared-only', 'supports_images': False}),
        encoding='utf-8')
    personal = guest['root'] / '.agent-model.json'

    def refuse_network(*_args, **_kwargs):
        raise AssertionError('capabilities must never call the provider')

    monkeypatch.setattr(
        'research_workbench.agent_provider.ModelConnection.request',
        refuse_network)
    monkeypatch.setattr(
        'research_workbench.agent_provider.ModelConnection.request_once',
        refuse_network)

    app = companion_app(base, shared_model_config=shared)
    with client_for(app) as client:
        personal.write_text(json.dumps({
            'base_url': 'https://api.deepseek.com', 'model': 'deepseek-chat',
            'api_key': 'sk-synthetic-personal-only',
            'supports_images': False}), encoding='utf-8')
        value = client.get('/api/v1/paper-presentations/capabilities',
                           headers=cookie(guest['session'].token)).json()
        assert value['ai_available'] is True

        personal.write_text(json.dumps({
            'base_url': 'https://not-deepseek.example',
            'model': 'deepseek-chat', 'api_key': 'sk-synthetic-personal-only',
            'supports_images': False}), encoding='utf-8')
        value = client.get('/api/v1/paper-presentations/capabilities',
                           headers=cookie(guest['session'].token))
        assert value.status_code == 200
        assert value.json()['ai_available'] is False  # fail closed, no fallback
        assert 'sk-synthetic' not in value.text and str(base) not in value.text

        personal.unlink()
        value = client.get('/api/v1/paper-presentations/capabilities',
                           headers=cookie(guest['session'].token)).json()
        assert value['ai_available'] is True  # shared explicit server path


def test_every_request_authenticates_even_with_a_cached_bundle(tmp_path):
    base = tmp_path / 'base'
    first = seed_guest(base)
    second = seed_guest(base, registry=first['registry'])
    registry = first['registry']
    app = companion_app(base)
    with client_for(app) as client:
        good = get_context(client, first['document'], paper_body(),
                           first['session'].token)
        assert good.status_code == 200, good.text
        assert app.state.companion.cached(first['session'].guest_id) is not None

        missing = client.post(
            f"/api/v1/documents/{first['document']['id']}/paper-presentations/context",
            json=paper_body())
        assert missing.status_code == 401
        assert missing.json()['detail']['code'] == 'guest_session_required'

        duplicate = client.post(
            f"/api/v1/documents/{first['document']['id']}/paper-presentations/context",
            json=paper_body(),
            headers=[('cookie', f'{COOKIE_NAME}={first["session"].token}'),
                     ('cookie', f'{COOKIE_NAME}={first["session"].token}')])
        assert duplicate.status_code == 401
        assert duplicate.json()['detail']['code'] == 'guest_cookie_invalid'

        unknown = get_context(client, first['document'], paper_body(), 'f' * 64)
        assert unknown.status_code == 401
        assert unknown.json()['detail']['code'] == 'guest_session_invalid'

        with sqlite3.connect(registry.database) as db:
            db.execute('UPDATE guests SET session_issued_at=? WHERE guest_id=?',
                       ((datetime.now(timezone.utc) - timedelta(
                           seconds=COOKIE_MAX_AGE + 60)).isoformat(),
                        first['session'].guest_id))
        expired = get_context(client, first['document'], paper_body(),
                              first['session'].token)
        assert expired.status_code == 401

        with sqlite3.connect(registry.database) as db:
            db.execute('UPDATE guests SET session_digest=? WHERE guest_id=?',
                       ('d' * 64, first['session'].guest_id))
        revoked = get_context(client, first['document'], paper_body(),
                              first['session'].token)
        assert revoked.status_code == 401
        # The cached bundle itself was never consulted as a credential.
        assert app.state.companion.cached(first['session'].guest_id) is not None

        foreign = get_context(client, first['document'], paper_body(),
                              second['session'].token)
        assert foreign.status_code == 404


def test_real_paper_context_and_export_use_only_scoped_temp_output(tmp_path):
    pptx = pytest.importorskip('pptx')

    base = tmp_path / 'base'
    guest = seed_guest(base, with_dataset=True, with_chart=True, with_note=True)
    sentinel = guest['root'] / 'exports' / 'keep-this-file.pptx'
    sentinel.write_bytes(b'keep')
    app = companion_app(base)
    with client_for(app) as client:
        assert client.get('/api/v1/health').json()['api_family'] == \
            'paper-presentations/v1'
        body = paper_body(include_paper=True, paper_pages=None)
        response = get_context(client, guest['document'], body,
                               guest['session'].token)
        assert response.status_code == 200, response.text
        context_value = response.json()
        assert context_value['sources'][0]['kind'] == 'paper'
        assert context_value['sources'][0]['pages'] == [1, 2]
        assert 'SYNTHETIC CONTEXT PAGE 1' in context_value['text']

        exported = export_deck(client, guest['document'], body, context_value,
                               guest['session'].token)
        assert exported.status_code == 200, exported.text
        deck = pptx.Presentation(io.BytesIO(exported.content))
        texts = [shape.text_frame.text for slide in deck.slides
                 for shape in slide.shapes if shape.has_text_frame]
        assert any('论文来源 / Paper reference' in text for text in texts)
        assert any('Stored paper title' in text for text in texts)

    assert sentinel.read_bytes() == b'keep'
    assert list((guest['root'] / 'exports').rglob('*.pptx')) == [sentinel]
    scoped = [path for path in (guest['root'] / 'exports').iterdir()
              if path.name.startswith('presentation-companion-')]
    assert len(scoped) == 1 and scoped[0].is_dir()
    assert list(scoped[0].iterdir()) == []

    store = PresentationReadStore(guest['root'])
    with store.connection() as first:
        with store.connection() as second:
            assert first is second
        with pytest.raises(sqlite3.OperationalError):
            first.execute("INSERT INTO document_trash VALUES (?,?)",
                          (guest['document']['id'], timestamp()))


def test_combined_sources_exercise_passive_read_graph(tmp_path):
    base = tmp_path / 'base'
    guest = seed_guest(base, with_dataset=True, with_chart=True, with_note=True)
    app = companion_app(base)
    body = paper_body(paper_pages=[1],
                      note_ids=[guest['note']['id']],
                      chart_ids=[guest['chart']['id']],
                      analysis_ids=[guest['analysis']['id']])
    with client_for(app) as client:
        response = get_context(client, guest['document'], body,
                               guest['session'].token)
        assert response.status_code == 200, response.text
        kinds = [source['kind'] for source in response.json()['sources']]
        assert kinds == ['paper', 'note', 'chart', 'analysis']
        exported = export_deck(client, guest['document'], body,
                               response.json(), guest['session'].token)
        assert exported.status_code == 200, exported.text


def test_capacity_retains_unexpired_receipts_and_replay_never_rebills(
        tmp_path, monkeypatch):
    base = tmp_path / 'base'
    first = seed_guest(base)
    second = seed_guest(base, registry=first['registry'])
    calls = []

    # Scripted reply cites the exact allowed refs parsed from the real prompt,
    # so no network, model, credential or retry is involved.
    def wrapped(self, messages, tools):
        calls.append(1)
        user = messages[-1]['content']
        ref = user.split('Allowed source refs: ', 1)[1].split('\n', 1)[0]
        return {'role': 'assistant', 'finish_reason': 'stop',
                'content': json.dumps({'title': 'Companion AI outline',
                                       'slides': [{'title': 'Overview',
                                                   'body': ['Synthetic body'],
                                                   'source_refs': json.loads(ref),
                                                   'chart_id': None}]})}

    monkeypatch.setattr(GuestModelConnection, 'complete_once', wrapped)
    app = companion_app(base, max_bundles=1, max_requests=2)
    with client_for(app) as client:
        context_value = get_context(client, first['document'], paper_body(),
                                    first['session'].token).json()
        response, request = outline_request(
            client, first['document'], paper_body(), context_value,
            first['session'].token)
        assert response.status_code == 200, response.text
        assert len(calls) == 1
        replay = client.post(
            f"/api/v1/documents/{first['document']['id']}/paper-presentations/outline",
            json=request, headers=cookie(first['session'].token))
        assert replay.status_code == 200
        assert replay.json() == response.json() and len(calls) == 1

        blocked = get_context(client, second['document'], paper_body(),
                              second['session'].token)
        assert blocked.status_code == 429
        assert blocked.json()['detail']['code'] == 'paper_presentation_capacity'

        bundle = app.state.companion.cached(first['session'].guest_id)
        with bundle.service._receipts_lock:
            for item in bundle.service._receipts.values():
                item['created'] -= OUTLINE_TTL + 60

        evicted = get_context(client, second['document'], paper_body(),
                              second['session'].token)
        assert evicted.status_code == 200, evicted.text
        assert app.state.companion.cached(first['session'].guest_id) is None
        assert app.state.companion.cached(second['session'].guest_id) is not None


def test_request_gate_slots_release_on_busy_and_errors(tmp_path):
    base = tmp_path / 'base'
    guest = seed_guest(base)
    app = companion_app(base, max_requests=1)
    state = app.state.companion
    with client_for(app) as client:
        assert state._requests.acquire(blocking=False)
        try:
            busy = get_context(client, guest['document'], paper_body(),
                               guest['session'].token)
        finally:
            state.release_request()
        assert busy.status_code == 429
        assert busy.json()['detail']['code'] == 'paper_presentation_busy'

        invalid = client.post(
            f"/api/v1/documents/{guest['document']['id']}/paper-presentations/context",
            json={'title': 'x'},
            headers=cookie(guest['session'].token))
        assert invalid.status_code == 422
        assert invalid.json()['detail']['code'] == 'validation_error'
        # Validation failures do not leak a request slot.
        assert state.try_request()
        state.release_request()

        ok = get_context(client, guest['document'], paper_body(),
                         guest['session'].token)
        assert ok.status_code == 200
        assert state.try_request()
        state.release_request()


def test_concurrent_guests_share_slots_without_leaking(tmp_path):
    base = tmp_path / 'base'
    first = seed_guest(base)
    second = seed_guest(base, registry=first['registry'])
    app = companion_app(base, max_requests=2)

    def call(guest):
        with client_for(app) as client:
            response = get_context(client, guest['document'], paper_body(),
                                   guest['session'].token)
            return response.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(call, [first, second]))
    # The one process-wide native-PDF gate from phase 1 may legitimately return
    # busy for the second simultaneous extraction; the request slot itself is
    # still released and the same guest succeeds on the next attempt.
    assert 200 in results
    assert set(results) <= {200, 429}

    with client_for(app) as client:
        for guest in (first, second):
            retry = get_context(client, guest['document'], paper_body(),
                                guest['session'].token)
            assert retry.status_code == 200, retry.text
    assert app.state.companion.try_request()
    app.state.companion.release_request()
    for guest in (first, second):
        bundle = app.state.companion.cached(guest['session'].guest_id)
        assert bundle is not None and bundle.in_flight == 0


def test_local_boundary_and_no_store_headers(tmp_path):
    base = tmp_path / 'base'
    guest = seed_guest(base)
    app = companion_app(base)

    remote = TestClient(app, base_url='http://127.0.0.1',
                        client=('203.0.113.9', 50001))
    with remote:
        response = remote.get('/api/v1/paper-presentations/capabilities',
                              headers=cookie(guest['session'].token))
    assert response.status_code == 403
    assert response.json()['detail']['code'] == 'local_only'

    with client_for(app) as client:
        foreign_host = client.get(
            '/api/v1/paper-presentations/capabilities',
            headers={**cookie(guest['session'].token), 'host': 'evil.example'})
        assert foreign_host.status_code == 403
        assert foreign_host.json()['detail']['code'] == 'local_only'

        foreign_origin = client.get(
            '/api/v1/paper-presentations/capabilities',
            headers={**cookie(guest['session'].token),
                     'origin': 'https://evil.example'})
        assert foreign_origin.status_code == 403
        assert foreign_origin.json()['detail']['code'] == 'origin_rejected'

        cross_site = client.get(
            '/api/v1/paper-presentations/capabilities',
            headers={**cookie(guest['session'].token),
                     'sec-fetch-site': 'cross-site'})
        assert cross_site.status_code == 403

        ok = client.get('/api/v1/paper-presentations/capabilities',
                        headers=cookie(guest['session'].token))
        assert ok.status_code == 200
        assert ok.headers['cache-control'] == 'no-store'
        assert ok.headers['pragma'] == 'no-cache'

        unauthorized = client.get(
            '/api/v1/paper-presentations/capabilities')
        assert unauthorized.status_code == 401
        assert unauthorized.headers['cache-control'] == 'no-store'


def test_full_app_aliases_leave_legacy_endpoints_untouched(tmp_path):
    provider = ScriptedModel()
    app = create_app(tmp_path / 'workspace', agent_provider=provider,
                     agent_autostart=False, analysis_autostart=False,
                     translation_autostart=False)
    with client_for(app) as client:
        document = client.post('/api/v1/documents', files={
            'file': ('paper.pdf', text_pdf(), 'application/pdf')}).json()
        note = client.post(f"/api/v1/documents/{document['id']}/notes",
                           json={'request_id': str(uuid4()), 'page': 1,
                                 'text': 'Legacy note'}).json()
        legacy = client.get('/api/v1/presentations/capabilities').json()
        assert set(legacy) == {'available', 'ai_available', 'paper_available',
                               'styles', 'limits'}
        alias = client.get('/api/v1/paper-presentations/capabilities').json()
        assert alias['api_family'] == 'paper-presentations/v1'
        assert alias['paper_available'] is True
        assert alias['limits'] == legacy['limits']

        legacy_body = {'title': 'Legacy deck', 'style': 'default',
                       'note_ids': [note['id']], 'chart_ids': [],
                       'analysis_ids': []}
        assert client.post(
            f"/api/v1/documents/{document['id']}/presentations/context",
            json=legacy_body).status_code == 200

        refused = client.post(
            f"/api/v1/documents/{document['id']}/paper-presentations/context",
            json={**legacy_body, 'include_paper': False})
        assert refused.status_code == 422
        assert refused.json()['detail']['code'] == 'paper_required'

        paper = client.post(
            f"/api/v1/documents/{document['id']}/paper-presentations/context",
            json=paper_body(note_ids=[note['id']]))
        assert paper.status_code == 200, paper.text


def test_companion_exposes_only_aliases_and_health(tmp_path):
    base = tmp_path / 'base'
    guest = seed_guest(base)
    app = companion_app(base)
    router_paths = {route.path for route in companion.paper_router.routes}
    assert router_paths == {
        '/api/v1/paper-presentations/capabilities',
        '/api/v1/documents/{document_id}/paper-presentations/context',
        '/api/v1/documents/{document_id}/paper-presentations/outline',
        '/api/v1/documents/{document_id}/paper-presentations/export',
    }
    with client_for(app) as client:
        assert client.get('/api/v1/health').status_code == 200
        assert client.get('/openapi.json').status_code == 404
        assert client.get('/docs').status_code == 404
        assert client.get('/api/v1/paper-presentations/capabilities',
                          headers=cookie(guest['session'].token)).status_code == 200
        for path in ('/', '/index.html', '/api/v1/access',
                     '/api/v1/documents', '/recover.html'):
            assert client.get(path).status_code == 404, path


# ------------------------------------------------------------------- repair: gate
def test_cancelled_acquisition_holds_slot_until_worker_really_settles(
        tmp_path, monkeypatch):
    """Cancelling the outer request must not free the slot early (defect 1)."""
    base = tmp_path / 'base'
    guest = seed_guest(base)
    app = companion_app(base, max_bundles=1, max_requests=1)
    state = app.state.companion
    entered, release = threading.Event(), threading.Event()
    original_build = state._build_service

    def slow_build(current):
        entered.set()
        assert release.wait(20), 'test never released bundle construction'
        return original_build(current)

    monkeypatch.setattr(state, '_build_service', slow_build)
    dispatched = []
    original_context = Presentations.context

    def spy(self, document_id, selectors):
        dispatched.append(document_id)
        return original_context(self, document_id, selectors)

    monkeypatch.setattr(Presentations, 'context', spy)
    path = (f"/api/v1/documents/{guest['document']['id']}"
            '/paper-presentations/context')

    async def scenario():
        baseline = asyncio.all_tasks()
        scope = http_scope(path, token=guest['session'].token)
        request = asyncio.ensure_future(
            call_app(app, scope, json.dumps(paper_body()).encode('utf-8')))
        await asyncio.get_running_loop().run_in_executor(None, entered.wait, 20)

        # The bundle construction thread owns the only request slot.
        assert state.try_request() is False
        request.cancel()
        await let_loop_run()

        # Cancellation was seen by the outer task, but acquisition is still
        # running: the slot stays reserved and no downstream work starts.
        # ``acquire`` holds its cache lock while building, so read the dict.
        assert dispatched == []
        assert state.try_request() is False
        assert state._bundles == {}

        release.set()
        with pytest.raises(asyncio.CancelledError):
            await request
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()

    asyncio.run(scenario())

    # Exactly one slot was released (a second release would raise ValueError).
    assert state.try_request() is True
    state.release_request()
    bundle = state.cached(guest['session'].guest_id)
    assert bundle is not None and bundle.in_flight == 0
    # The delayed acquisition was drained and skipped, never dispatched.
    assert dispatched == []


def test_cancelled_provider_work_keeps_slot_and_single_billing_receipt(
        tmp_path, monkeypatch):
    """A real provider call keeps its reservations and its 1h receipt (defect 1)."""
    base = tmp_path / 'base'
    first = seed_guest(base)
    second = seed_guest(base, registry=first['registry'])
    registry = first['registry']
    app = companion_app(base, max_bundles=1, max_requests=1)
    state = app.state.companion
    entered, release = threading.Event(), threading.Event()
    calls = []

    def wrapped(self, messages, tools):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            assert release.wait(30), 'test never released the scripted provider'
        user = messages[-1]['content']
        ref = user.split('Allowed source refs: ', 1)[1].split('\n', 1)[0]
        return {'role': 'assistant', 'finish_reason': 'stop',
                'content': json.dumps({'title': 'Cancelled-but-settled outline',
                                       'slides': [{'title': 'Overview',
                                                   'body': ['Synthetic body'],
                                                   'source_refs': json.loads(ref),
                                                   'chart_id': None}]})}

    monkeypatch.setattr(GuestModelConnection, 'complete_once', wrapped)

    with client_for(app) as client:
        context_value = get_context(client, first['document'], paper_body(),
                                    first['session'].token)
        assert context_value.status_code == 200, context_value.text
    context_json = context_value.json()

    body = {**paper_body(), 'source_sha256': context_json['source_sha256'],
            'request_id': str(uuid4()), 'confirmed': True}
    payload = json.dumps(body).encode('utf-8')
    path = (f"/api/v1/documents/{first['document']['id']}"
            '/paper-presentations/outline')
    other_path = (f"/api/v1/documents/{second['document']['id']}"
                  '/paper-presentations/context')
    guarded = [registry.database, first['root'] / 'workspace.sqlite3']
    before = {str(path_name): digest_file(path_name) for path_name in guarded}

    async def scenario():
        baseline = asyncio.all_tasks()
        request = asyncio.ensure_future(call_app(
            app, http_scope(path, token=first['session'].token), payload))
        await asyncio.get_running_loop().run_in_executor(None, entered.wait, 30)

        bundle = state.cached(first['session'].guest_id)
        assert bundle is not None and bundle.in_flight == 1
        assert bundle.service._receipt(body['request_id']) is None

        request.cancel()
        await let_loop_run()

        # The provider thread still runs: the slot, the bundle reservation and
        # the cached (currently empty) receipt bundle all stay in place.
        assert state.try_request() is False
        assert state.cached(first['session'].guest_id) is bundle
        assert bundle.in_flight == 1
        assert state.cached(second['session'].guest_id) is None

        # Another guest cannot evict the live bundle while the model call runs.
        blocked = await call_app(
            app, http_scope(other_path, token=second['session'].token),
            json.dumps(paper_body()).encode('utf-8'))
        assert blocked.status == 429
        assert blocked.json()['detail']['code'] == 'paper_presentation_busy'

        # The same request id cannot start a duplicate model call either.
        replay = await call_app(
            app, http_scope(path, token=first['session'].token), payload)
        assert replay.status == 429
        assert replay.json()['detail']['code'] == 'paper_presentation_busy'
        assert calls == [1]

        release.set()
        with pytest.raises(asyncio.CancelledError):
            await request
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()

    asyncio.run(scenario())

    assert calls == [1]
    assert state.try_request() is True
    state.release_request()
    bundle = state.cached(first['session'].guest_id)
    assert bundle is not None and bundle.in_flight == 0
    # The cancelled request settled its success receipt exactly once.
    assert bundle.service._receipt(body['request_id']) is not None
    assert len(bundle.service._receipts) == 1
    assert {str(name): digest_file(name) for name in guarded} == before

    with client_for(app) as client:
        replay = client.post(path, json=body,
                             headers=cookie(first['session'].token))
        assert replay.status_code == 200, replay.text
        assert replay.json()['ai_generated'] is True
    # Replay reused the retained receipt: the provider was not billed again.
    assert calls == [1]


def test_late_acquisition_failure_after_cancel_is_consumed_without_leaks(
        tmp_path, monkeypatch):
    base = tmp_path / 'base'
    guest = seed_guest(base)
    app = companion_app(base, max_bundles=1, max_requests=1)
    state = app.state.companion
    entered, release, hold = threading.Event(), threading.Event(), threading.Event()

    def failing_build(current):
        entered.set()
        if hold.is_set():
            assert release.wait(20), 'test never released bundle construction'
        raise GuestStorageError('registry_unavailable')

    monkeypatch.setattr(state, '_build_service', failing_build)
    path = (f"/api/v1/documents/{guest['document']['id']}"
            '/paper-presentations/context')
    payload = json.dumps(paper_body()).encode('utf-8')

    async def plain():
        baseline = asyncio.all_tasks()
        response = await call_app(
            app, http_scope(path, token=guest['session'].token), payload)
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()
        return response

    response = asyncio.run(plain())
    assert response.status == 503
    assert response.json()['detail']['code'] == 'guest_storage_unavailable'
    assert state.try_request() is True
    state.release_request()
    assert state.cached(guest['session'].guest_id) is None

    hold.set()
    entered.clear()

    async def late():
        baseline = asyncio.all_tasks()
        request = asyncio.ensure_future(call_app(
            app, http_scope(path, token=guest['session'].token), payload))
        await asyncio.get_running_loop().run_in_executor(None, entered.wait, 20)
        request.cancel()
        await let_loop_run()
        assert state.try_request() is False
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await request
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()

    asyncio.run(late())
    # The late failure was retrieved by the drain and released exactly once.
    assert state.try_request() is True
    state.release_request()
    assert state.cached(guest['session'].guest_id) is None


def test_downstream_failure_and_disconnect_release_reservations_once(
        tmp_path, monkeypatch):
    base = tmp_path / 'base'
    guest = seed_guest(base)
    app = companion_app(base, max_bundles=1, max_requests=1)
    state = app.state.companion
    path = (f"/api/v1/documents/{guest['document']['id']}"
            '/paper-presentations/context')
    payload = json.dumps(paper_body()).encode('utf-8')

    def explode(self, document_id, selectors):
        raise RuntimeError('synthetic downstream failure')

    monkeypatch.setattr(Presentations, 'context', explode)

    async def failing():
        baseline = asyncio.all_tasks()
        call = AsgiCall()
        await app(http_scope(path, token=guest['session'].token),
                  http_receive(payload), call.send())
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()
        return call

    response = asyncio.run(failing())
    # No response had started, so the gate preserved its existing single safe
    # 503 envelope (never a body/path echo) and released both reservations.
    assert response.status == 503 and response.starts == 1
    assert response.json()['detail']['code'] == 'paper_presentation_unavailable'
    assert state.try_request() is True
    state.release_request()
    bundle = state.cached(guest['session'].guest_id)
    assert bundle is not None and bundle.in_flight == 0

    def cancelled(self, document_id, selectors):
        raise asyncio.CancelledError()

    monkeypatch.setattr(Presentations, 'context', cancelled)

    async def cancelled_downstream():
        baseline = asyncio.all_tasks()
        with pytest.raises(asyncio.CancelledError):
            await call_app(
                app, http_scope(path, token=guest['session'].token), payload)
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()

    asyncio.run(cancelled_downstream())
    assert state.try_request() is True
    state.release_request()
    bundle = state.cached(guest['session'].guest_id)
    assert bundle is not None and bundle.in_flight == 0

    # A disconnect while the response is being written: the start already went
    # out, so the gate must not append a second response, but it still releases.
    def answer(self, document_id, selectors):
        return {'source_sha256': 'a' * 64, 'sources': [], 'text': '',
                'suggested_outline': {'title': 'x', 'slides': []}}

    monkeypatch.setattr(Presentations, 'context', answer)
    attempts = []

    async def disconnect():
        baseline = asyncio.all_tasks()

        async def send(message):
            attempts.append(message['type'])
            raise OSError('synthetic client disconnect')

        try:
            await app(http_scope(path, token=guest['session'].token),
                      http_receive(payload), send)
        except BaseException:
            # Starlette re-raises (possibly wrapped) after a started response;
            # the gate itself must not append a second response.
            pass
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()

    asyncio.run(disconnect())
    assert attempts == ['http.response.start']
    assert state.try_request() is True
    state.release_request()
    bundle = state.cached(guest['session'].guest_id)
    assert bundle is not None and bundle.in_flight == 0


def test_health_answers_while_cleanup_waits_on_a_held_builder(
        tmp_path, monkeypatch):
    """Bundle release must not run on the loop while another build holds it.

    One guest's bundle build holds ``CompanionState._lock`` across its blocking
    I/O.  A second request that already owns its bundle then finishes and
    enters cleanup, which needs that same lock.  An unrelated health probe must
    still answer *before* the held build is released: an inline release on the
    event loop would stall health (and every other request) until the build
    ended.  All waits are bounded and the held thread is always released.
    """
    base = tmp_path / 'base'
    holder = seed_guest(base)
    finisher = seed_guest(base, registry=holder['registry'])
    app = companion_app(base, max_bundles=2, max_requests=2)
    state = app.state.companion
    builder_entered, builder_release = threading.Event(), threading.Event()
    downstream_entered, downstream_release = threading.Event(), threading.Event()
    cleanup_entered, cleanup_finished = threading.Event(), threading.Event()

    original_build = state._build_service
    original_context = Presentations.context
    original_release = state.release

    def held_build(guest):
        if guest.guest_id == holder['session'].guest_id:
            builder_entered.set()
            assert builder_release.wait(20), 'test never released the builder'
        return original_build(guest)

    def held_context(self, document_id, selectors):
        if document_id == finisher['document']['id']:
            downstream_entered.set()
            assert downstream_release.wait(20), 'test never released the finisher'
        return original_context(self, document_id, selectors)

    def watched_release(bundle):
        if bundle.guest_id != finisher['session'].guest_id:
            return original_release(bundle)
        cleanup_entered.set()
        try:
            return original_release(bundle)
        finally:
            cleanup_finished.set()

    monkeypatch.setattr(state, '_build_service', held_build)
    monkeypatch.setattr(Presentations, 'context', held_context)
    monkeypatch.setattr(state, 'release', watched_release)

    holder_scope = http_scope(
        f"/api/v1/documents/{holder['document']['id']}"
        '/paper-presentations/context', token=holder['session'].token)
    finisher_scope = http_scope(
        f"/api/v1/documents/{finisher['document']['id']}"
        '/paper-presentations/context', token=finisher['session'].token)
    payload = json.dumps(paper_body()).encode('utf-8')

    def failsafe():
        # Bounded escape hatch: always free the held builder so a failed
        # assertion can never leave the scenario loop blocked forever.
        if not builder_release.wait(8):
            builder_release.set()
        downstream_release.set()

    threading.Thread(target=failsafe, daemon=True).start()

    async def scenario():
        baseline = asyncio.all_tasks()
        loop = asyncio.get_running_loop()
        finisher_task = asyncio.ensure_future(
            call_app(app, finisher_scope, payload))
        assert await loop.run_in_executor(None, downstream_entered.wait, 20)
        builder_task = asyncio.ensure_future(
            call_app(app, holder_scope, payload))
        assert await loop.run_in_executor(None, builder_entered.wait, 20)
        # The builder owns the process cache lock across its blocking build.
        assert state._lock.locked() is True

        downstream_release.set()
        assert await loop.run_in_executor(None, cleanup_entered.wait, 20)

        try:
            health = await asyncio.wait_for(
                call_app(app, http_scope('/api/v1/health', method='GET')), 15)
        finally:
            answered_while_held = not builder_release.is_set()
            cleanup_still_pending = not cleanup_finished.is_set()
            builder_release.set()
            downstream_release.set()

        assert health.status == 200
        assert health.json()['api_family'] == 'paper-presentations/v1'
        assert answered_while_held, (
            'health only answered once the held bundle build was released')
        assert cleanup_still_pending, (
            'the finishing request had already completed its cleanup')

        holder_response = await asyncio.wait_for(builder_task, 60)
        finisher_response = await asyncio.wait_for(finisher_task, 60)
        await let_loop_run()
        assert asyncio.all_tasks() - baseline == set()
        assert holder_response.status == 200, holder_response.body
        assert finisher_response.status == 200, finisher_response.body

    try:
        asyncio.run(scenario())
    finally:
        builder_release.set()
        downstream_release.set()


# --------------------------------------------------------- repair: passive checks
def test_registry_ancestor_redirect_after_start_fails_closed(tmp_path):
    base = tmp_path / 'base'
    guest = seed_guest(base)
    registry = PassiveRegistry(base)
    token = guest['session'].token
    assert registry.lookup(token) is not None

    moved = tmp_path / 'base-moved'
    base.rename(moved)
    if not make_directory_redirect(base, moved):
        moved.rename(base)
        pytest.skip('symlinks/junctions are unavailable on this platform')
    try:
        # A real open through the redirect works, so the check below is about
        # the companion's own guard, not an unreadable path.
        probe = sqlite3.connect(base / 'registry.sqlite3')
        try:
            assert probe.execute('SELECT COUNT(*) FROM guests').fetchone()[0] == 1
        finally:
            probe.close()
        # The registry was verified at startup; a redirect introduced later must
        # still fail closed before any SQLite file is opened through it.
        with pytest.raises(GuestRegistryError):
            registry.count()
        with pytest.raises(GuestRegistryError):
            registry.lookup(token)
        with pytest.raises(GuestRegistryError):
            registry.space_root(guest['session'].guest_id)
    finally:
        remove_directory_redirect(base)
        moved.rename(base)

    # The restored real layout is readable again: nothing was initialized.
    assert registry.lookup(token) is not None
    db = sqlite3.connect(base / 'registry.sqlite3')
    try:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2
    finally:
        db.close()
