"""Bounded translation library read API (additive GET-only surface).

Only synthetic SQLite metadata rows are used: no parser, model, worker, network
or real translation call is made.  Page result blocks are never inserted because
the list must not read them.
"""
import hashlib
import json
from uuid import uuid4

import pytest
from conftest import make_pdf
from fastapi.testclient import TestClient

from research_workbench.main import create_app
from research_workbench.store import timestamp

FIELDS = {'kind', 'id', 'document_id', 'source_sha256', 'title', 'target_language',
          'pages', 'status', 'completed_pages', 'total_pages', 'created_at',
          'updated_at'}
ENDPOINT = '/api/v1/library/translations'


@pytest.fixture
def app(tmp_path, monkeypatch):
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
    return create_app(tmp_path / 'workspace', agent_autostart=False,
                      translation_autostart=False)


@pytest.fixture
def client(app):
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        yield client


def add_job(db, document, *, identifier=None, created_at=None, pages=(1,),
            status='completed', completed=None, sha256=None):
    identifier = identifier or str(uuid4())
    stamp = created_at or timestamp()
    total = len(pages)
    completed = total if completed is None else completed
    db.execute(
        'INSERT INTO translation_jobs (id,document_id,source_sha256,target_language,'
        'pages_json,request_hash,status,stage,parser_id,parser_version,prompt_version,'
        'result_schema_version,model_name,model_fingerprint,completed_pages,total_pages,'
        'error_json,created_at,started_at,updated_at,finished_at) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (identifier, document['id'], sha256 or document['sha256'], 'zh',
         json.dumps(list(pages)), 'r' * 64, status, 'finished', 'parser', '1.0',
         'translate-sentences-v2', 1, 'synthetic-model', 'm' * 16, completed, total,
         None, stamp, stamp, stamp, stamp))
    return identifier


def add_run(db, document, *, identifier=None, created_at=None, pages=(1, 2),
            status='completed', completed=None, processed=None):
    identifier = identifier or str(uuid4())
    stamp = created_at or timestamp()
    total = len(pages)
    completed = total if completed is None else completed
    processed = completed if processed is None else processed
    db.execute(
        'INSERT INTO translation_runs (id,document_id,source_sha256,pages_json,'
        'target_language,request_hash,status,stage,revision,total_pages,processed_pages,'
        'completed_pages,reused_pages,active_job_id,parser_id,parser_version,prompt_version,'
        'result_schema_version,model_name,model_fingerprint,error_json,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (identifier, document['id'], document['sha256'], json.dumps(list(pages)),
         'zh', 'h' * 64, status,
         'translating' if status in ('running', 'queued') else 'finished',
         1, total, processed, completed, 0, None, 'parser', '1.0',
         'translate-sentences-v2', 1, 'synthetic-model', 'm' * 16, None, stamp, stamp))
    return identifier


def link_child(db, run_id, job_id, *, page=1, reused=0):
    db.execute('INSERT INTO translation_run_jobs VALUES (?,?,?,?,?,?)',
               (run_id, job_id, page, 1, reused, timestamp()))


def listed(client, **params):
    response = client.get(ENDPOINT, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def upload(client, name):
    response = client.post('/api/v1/documents',
                           files={'file': (name, make_pdf(2), 'application/pdf')})
    assert response.status_code == 201, response.text
    return response.json()


def snapshot(app):
    tables = ('translation_jobs', 'translation_runs', 'translation_run_jobs',
              'translation_run_pages', 'translation_run_operations')
    with app.state.store.connection() as db:
        return {table: [tuple(row) for row in db.execute(
            f'SELECT * FROM {table} ORDER BY 1')] for table in tables}


def test_mixed_records_exclude_children_and_expose_the_frozen_metadata(
        client, app, document):
    with app.state.store.connection() as db:
        legacy = add_job(db, document, created_at='2026-11-01T00:00:00+00:00', pages=[1])
        failed = add_job(db, document, created_at='2026-11-03T00:00:00+00:00',
                         pages=[2], status='failed', completed=0)
        run = add_run(db, document, created_at='2026-11-04T00:00:00+00:00', pages=[1, 2],
                      status='running', completed=1, processed=1)
        child = add_job(db, document, created_at='2026-11-04T00:00:00+00:00')
        reused = add_job(db, document, created_at='2026-10-01T00:00:00+00:00')
        link_child(db, run, child, page=1, reused=0)
        link_child(db, run, reused, page=2, reused=1)

    body = listed(client)
    assert set(body) == {'items', 'total', 'limit', 'offset'}
    assert body['total'] == 3 and body['limit'] == 20 and body['offset'] == 0
    assert [item['kind'] for item in body['items']] == ['run', 'job', 'job']
    assert [item['id'] for item in body['items']] == [run, failed, legacy]
    ids = {item['id'] for item in body['items']}
    assert child not in ids and reused not in ids
    assert all('result_pages' not in item and 'blocks' not in item
               for item in body['items'])

    whole_run, failed_job, legacy_job = body['items']
    assert set(whole_run) == FIELDS and set(failed_job) == FIELDS
    assert whole_run['document_id'] == document['id']
    assert whole_run['source_sha256'] == document['sha256']
    assert whole_run['title'] == 'synthetic'
    assert whole_run['target_language'] == 'zh'
    assert whole_run['pages'] == [1, 2]
    assert (whole_run['status'], whole_run['completed_pages'],
            whole_run['total_pages']) == ('running', 1, 2)
    assert whole_run['created_at'] == '2026-11-04T00:00:00+00:00'
    assert failed_job['pages'] == [2] and legacy_job['pages'] == [1]


def test_renamed_metadata_title_is_honored_and_search_is_literal(client, app, document):
    with app.state.store.connection() as db:
        add_job(db, document, pages=[1])
    other = upload(client, 'plain.pdf')
    with app.state.store.connection() as db:
        add_job(db, other)
    renamed = client.patch(f"/api/v1/documents/{document['id']}/metadata",
                           json={'request_id': str(uuid4()),
                                 'expected_revision': 1,
                                 'title': 'Renamed source 100%_translation'})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()['title'] == 'Renamed source 100%_translation'

    assert listed(client)['total'] == 2
    assert listed(client, q='  renamed SOURCE  ')['total'] == 1
    assert listed(client, q='100%_translation')['total'] == 1
    assert listed(client, q='100X_translation')['total'] == 0
    # Escaped wildcards: '%' and '_' match their literal characters only.
    assert listed(client, q='%')['total'] == 1
    assert listed(client, q='_')['total'] == 1
    assert listed(client, q='plain.pdf')['total'] == 0
    assert listed(client, q='synthetic')['total'] == 0
    assert listed(client, q='不存在')['items'] == []
    assert listed(client, q='')['total'] == 2


def test_pagination_is_bounded_and_deterministic(client, app, document):
    with app.state.store.connection() as db:
        created = ['2026-10-01T00:00:00+00:00', '2026-10-02T00:00:00+00:00',
                   '2026-10-02T00:00:00+00:00', '2026-10-03T00:00:00+00:00',
                   '2026-10-04T00:00:00+00:00']
        records = [add_job(db, document, created_at=stamp) for stamp in created]
    expected = [identifier for _, identifier in sorted(
        zip(created, records), key=lambda pair: (pair[0], pair[1]), reverse=True)]

    first = listed(client, limit=2, offset=0)
    assert first['total'] == 5 and first['limit'] == 2 and first['offset'] == 0
    assert [item['id'] for item in first['items']] == expected[:2]
    second = listed(client, limit=2, offset=2)
    assert second['total'] == 5
    assert [item['id'] for item in second['items']] == expected[2:4]
    last = listed(client, limit=2, offset=4)
    assert [item['id'] for item in last['items']] == expected[4:]
    assert listed(client, limit=2, offset=10)['items'] == []
    assert listed(client, limit=50)['total'] == 5

    for params in ({'limit': 0}, {'limit': 51}, {'offset': -1},
                   {'offset': 100001}, {'q': 'x' * 201}):
        assert client.get(ENDPOINT, params=params).status_code == 422, params


def test_trashed_study_and_replaced_sources_are_hidden(client, app, document):
    trashed = upload(client, 'trashed.pdf')
    with app.state.store.connection() as db:
        visible = add_job(db, document, created_at='2026-11-02T00:00:00+00:00')
        stale = add_job(db, document, created_at='2026-11-03T00:00:00+00:00',
                        sha256='b' * 64)
        trashed_job = add_job(db, trashed)
        db.execute('INSERT INTO document_trash VALUES (?,?)',
                   (trashed['id'], timestamp()))
        study_id = str(uuid4())
        db.execute('INSERT INTO documents VALUES (?,?,NULL,NULL,NULL,NULL,?)',
                   (study_id, 'Study owner', timestamp()))
        study_job = add_job(db, {'id': study_id, 'sha256': 'c' * 64})

    body = listed(client)
    assert body['total'] == 1
    assert [item['id'] for item in body['items']] == [visible]
    assert {stale, trashed_job, study_job}.isdisjoint(
        {item['id'] for item in body['items']})


def test_read_leaves_rows_and_call_count_untouched(client, app, document, monkeypatch):
    with app.state.store.connection() as db:
        run = add_run(db, document, pages=[1], status='completed')
        add_job(db, document, status='failed', completed=0)
        child = add_job(db, document)
        link_child(db, run, child, page=1)
    before = snapshot(app)

    def forbidden(*args, **kwargs):
        raise AssertionError('a history read touched the source file')

    monkeypatch.setattr('research_workbench.translation.source_sha256', forbidden)
    monkeypatch.setattr('research_workbench.translation_runs.verified_source', forbidden)
    assert listed(client)['total'] == 2
    assert listed(client, limit=1, offset=1, q='synthetic')['total'] == 2
    assert listed(client, q='nothing')['total'] == 0
    assert snapshot(app) == before


def test_each_store_only_lists_its_own_records(tmp_path, client, document):
    with client.app.state.store.connection() as db:
        first = add_job(db, document)

    second_app = create_app(tmp_path / 'second-workspace', agent_autostart=False,
                            translation_autostart=False)
    with TestClient(second_app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as second:
        other = upload(second, 'other.pdf')
        with second_app.state.store.connection() as db:
            second_record = add_job(db, other)
        mine = second.get(ENDPOINT).json()
        assert [item['id'] for item in mine['items']] == [second_record]

    original = client.get(ENDPOINT).json()
    assert [item['id'] for item in original['items']] == [first]
    assert original['total'] == 1
