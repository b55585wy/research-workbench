"""Agent-side preparation of a source-pinned paper presentation plan.

The Agent tool only prepares a small machine plan.  It must not call the
presentation model, extract text into the model conversation or create a deck.
The existing paper-presentations API remains the only generation/export path.
"""
from contextlib import contextmanager
import json
from pathlib import Path
import threading
import time
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from agent_support import ScriptedModel, submit, tool, wait_turn, workspace
from research_workbench.agent_models import AgentSubmission, ReadingContext
from research_workbench.agent_store import canonical, submission_hash
from research_workbench.main import create_app
from test_presentation_paper import pdf_bytes

BASELINE = Path(__file__).parent / 'fixtures' / 'agent-presentation-legacy.json'
PLAN_FIELDS = {'format', 'document_id', 'file_sha256', 'source_sha256', 'title',
               'style', 'page_count', 'page_range', 'text_chars', 'empty_page_range'}


def upload_pdf(client, pages, name='agent-paper.pdf'):
    response = client.post('/api/v1/documents',
                           files={'file': (name, pdf_bytes(pages), 'application/pdf')})
    assert response.status_code == 201, response.text
    return response.json()


@contextmanager
def paper_workspace(root, pages=('Synthetic page one', 'Synthetic page two'), model=None):
    model = model or ScriptedModel()
    app = create_app(root, agent_provider=model, agent_autostart=True,
                     analysis_autostart=False)
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as client:
        document = upload_pdf(client, list(pages))
        yield client, app, document, model


def granted(**changes):
    value = {'page': 1, 'language': 'en', 'image_ids': [], 'presentation_actions': True}
    value.update(changes)
    return value


def prepare(client, document, **changes):
    body = granted()
    body.update(changes)
    return wait_turn(client, document,
                     submit(client, document, context=body).json()['id'])


def plan_events(turn):
    return [event for event in turn['events'] if event['kind'] == 'presentation_plan']


def stored_events(app, turn_id):
    with app.state.store.connection() as db:
        return [dict(row) for row in db.execute(
            'SELECT id,kind,title,status FROM agent_events WHERE turn_id=? ORDER BY rowid',
            (turn_id,))]


def wait_held_call_processed(app, turn_id, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        events = stored_events(app, turn_id)
        if any(event['kind'] in ('presentation_plan', 'tool') for event in events):
            return events
        time.sleep(.02)
    raise AssertionError('Held presentation call was not processed')


def tool_error(provider):
    for message in reversed(provider.calls[-1]['messages']):
        if message.get('role') != 'tool':
            continue
        value = json.loads(message['content'])
        if isinstance(value, dict) and 'error' in value:
            return value['error']['code']
    raise AssertionError('No tool error in the last provider request')


def paper_context(client, document, title='Synthetic deck', pages=None):
    body = {'title': title, 'style': 'default', 'include_paper': True,
            'paper_pages': pages, 'note_ids': [], 'chart_ids': [], 'analysis_ids': []}
    response = client.post(
        f"/api/v1/documents/{document['id']}/paper-presentations/context", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_prepare_persists_verified_plan_and_reloads_without_model_call(tmp_path):
    model = ScriptedModel([
        tool('prepare_presentation', {'title': 'Synthetic deck', 'style': 'nature',
                                      'paper_pages': [1, 2]}),
        tool('complete_task', {'summary': 'Plan prepared; no deck was generated.'}),
    ])
    with paper_workspace(tmp_path, model=model) as (client, app, document, provider):
        body = {'page': 1, 'language': 'en', 'image_ids': [], 'presentation_actions': True}
        turn = wait_turn(client, document,
                         submit(client, document, context=body).json()['id'])
        assert turn['status'] == 'completed'
        assert len(provider.calls) == 2
        assert 'prepare_presentation' in {
            item['function']['name'] for item in provider.calls[0]['tools']}
        assert any(
            'NOT a generated outline' in message['content']
            for message in provider.calls[0]['messages'] if message['role'] == 'system')
        tool_result = next(message for message in reversed(provider.calls[1]['messages'])
                           if message['role'] == 'tool')
        assert 'Synthetic page two' not in tool_result['content']
        events = plan_events(turn)
        assert len(events) == 1
        event = events[0]
        assert event['title'] == 'Synthetic deck' and event['status'] == 'completed'
        assert len(event['summary']) <= 2000
        assert event['summary'] == canonical(json.loads(event['summary']))
        plan = turn['presentation_plans'][0]
        assert set(plan) == PLAN_FIELDS | {'id'}
        assert plan['id'] == event['id']
        UUID(plan['id'])
        assert plan['format'] == 'research-agent-presentation-plan/v1'
        assert plan['document_id'] == document['id']
        assert plan['file_sha256'] == document['sha256']
        assert plan['title'] == 'Synthetic deck' and plan['style'] == 'nature'
        assert plan['page_count'] == 2 and plan['page_range'] == '1-2'
        assert plan['empty_page_range'] == ''
        assert 1 <= plan['text_chars'] <= 120000

        expected = paper_context(client, document, 'Synthetic deck', [1, 2])
        assert plan['source_sha256'] == expected['source_sha256']
        assert expected['sources'][0]['file_sha256'] == plan['file_sha256']

        reloaded = client.get(
            f"/api/v1/documents/{document['id']}/agent/turns/{turn['id']}").json()
        history = client.get(
            f"/api/v1/documents/{document['id']}/agent/conversations/"
            f"{turn['conversation_id']}").json()
        assert reloaded['presentation_plans'] == [plan]
        assert history['turns'][0]['presentation_plans'] == [plan]
        # The plan is the only new side effect: no note, deck or proposal.
        assert turn['proposals'] == []
        assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items'] == []
        stored_plan = plan

    # A fresh application process reads the same persisted plan without any
    # PDF extraction or provider call.
    with TestClient(create_app(tmp_path, agent_provider=ScriptedModel(),
                               agent_autostart=False, analysis_autostart=False),
                    base_url='http://127.0.0.1',
                    client=('127.0.0.1', 48000)) as reopened:
        reloaded = reopened.get(
            f"/api/v1/documents/{document['id']}/agent/turns/{turn['id']}").json()
        assert reloaded['presentation_plans'] == [stored_plan]


def test_whole_paper_selected_pages_and_empty_page_are_exact(tmp_path):
    model = ScriptedModel()
    pages = ['Synthetic first page', 'Synthetic second page']
    with paper_workspace(tmp_path, pages=pages, model=model) as (client, app, document, provider):
        model.responses = [
            tool('prepare_presentation', {'title': 'Whole paper', 'paper_pages': None}),
            tool('complete_task', {'summary': 'Whole paper plan.'})]
        whole = prepare(client, document)
        assert whole['presentation_plans'][0]['page_range'] == '1-2'
        assert whole['presentation_plans'][0]['page_count'] == 2

        model.responses = [
            tool('prepare_presentation', {'title': 'One page', 'paper_pages': [2]}),
            tool('complete_task', {'summary': 'One page plan.'})]
        one = prepare(client, document)
        plan = one['presentation_plans'][0]
        assert plan['page_count'] == 2 and plan['page_range'] == '2'

    with paper_workspace(tmp_path / 'empty', pages=['Text page', None],
                         model=ScriptedModel()) as (client, app, document, provider):
        provider.responses = [
            tool('prepare_presentation', {'title': 'Blank page', 'paper_pages': [1, 2]}),
            tool('complete_task', {'summary': 'Blank page recorded.'})]
        turn = prepare(client, document)
        plan = turn['presentation_plans'][0]
        assert plan['empty_page_range'] == '2' and plan['page_range'] == '1-2'


def test_whole_paper_over_limit_fails_instead_of_truncating(tmp_path):
    with paper_workspace(tmp_path, pages=[f'Page {index} body' for index in range(1, 62)],
                         model=ScriptedModel()) as (client, app, document, provider):
        provider.responses = [
            tool('prepare_presentation', {'title': 'Too long', 'paper_pages': None}),
            tool('complete_task', {'summary': 'Could not prepare.'})]
        turn = prepare(client, document)
        assert turn['status'] == 'completed'
        assert 'presentation_plans' not in turn
        assert tool_error(provider) == 'presentation_paper_pages'


@pytest.mark.parametrize('arguments,code', [
    ({'title': ''}, 'agent_invalid_tool_input'),
    ({'title': '   '}, 'agent_invalid_tool_input'),
    ({'title': '演' * 121}, 'agent_invalid_tool_input'),
    ({'title': 'Control\x01title'}, 'agent_invalid_tool_input'),
    ({'title': 'Bad style', 'style': 'fancy'}, 'agent_invalid_tool_input'),
    ({'title': 'Out of range', 'paper_pages': [0]}, 'agent_invalid_tool_input'),
    ({'title': 'Out of range', 'paper_pages': [201]}, 'agent_invalid_tool_input'),
    ({'title': 'Past end', 'paper_pages': [62]}, 'presentation_paper_pages'),
    ({'title': 'Not sorted', 'paper_pages': [2, 1]}, 'agent_invalid_tool_input'),
    ({'title': 'Duplicate', 'paper_pages': [1, 1]}, 'agent_invalid_tool_input'),
    ({'title': 'String page', 'paper_pages': ['1']}, 'agent_invalid_tool_input'),
    ({'title': 'Boolean page', 'paper_pages': [True]}, 'agent_invalid_tool_input'),
    ({'title': 'Empty selection', 'paper_pages': []}, 'agent_invalid_tool_input'),
    ({'title': 'Too many', 'paper_pages': list(range(1, 62))}, 'agent_invalid_tool_input'),
    ({'title': 'Unknown field', 'include_paper': False}, 'agent_invalid_tool_input'),
])
def test_malformed_and_out_of_range_arguments_never_create_a_plan(tmp_path, arguments, code):
    with paper_workspace(tmp_path, pages=[f'Page {index}' for index in range(1, 62)],
                         model=ScriptedModel()) as (client, app, document, provider):
        provider.responses = [
            tool('prepare_presentation', arguments),
            tool('complete_task', {'summary': 'Rejected arguments were not prepared.'})]
        turn = prepare(client, document)
        assert turn['status'] == 'completed'
        assert plan_events(turn) == [] and 'presentation_plans' not in turn
        assert tool_error(provider) == code


def test_bounded_max_title_and_sixty_discontiguous_pages_fit_event_summary(tmp_path):
    pages = [f'Page {index} synthetic body' for index in range(1, 120)]
    selected = list(range(1, 120, 2))  # 60 discontiguous pages up to 119
    assert len(selected) == 60
    with paper_workspace(tmp_path, pages=pages, model=ScriptedModel()) as (client, app, document, provider):
        title = '演' * 120
        provider.responses = [
            tool('prepare_presentation', {'title': title, 'paper_pages': selected,
                                          'style': 'cell'}),
            tool('complete_task', {'summary': 'Bounded plan.'})]
        turn = prepare(client, document)
        plan = turn['presentation_plans'][0]
        event = plan_events(turn)[0]
        assert plan['title'] == title and plan['page_count'] == 119
        assert plan['page_range'] == ','.join(str(page) for page in selected)
        assert len(plan['page_range']) <= 240
        assert len(event['summary']) <= 2000
        assert json.loads(event['summary'])['page_range'] == plan['page_range']


def test_old_or_false_grant_hides_tool_and_manual_call_fails_closed(tmp_path):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        for context in ({'page': 1, 'language': 'en', 'image_ids': []},
                        {'page': 1, 'language': 'en', 'image_ids': [],
                         'presentation_actions': False}):
            provider.responses = [
                tool('prepare_presentation', {'title': 'No grant', 'paper_pages': [1]}),
                tool('complete_task', {'summary': 'No grant honored.'})]
            turn = wait_turn(client, document,
                             submit(client, document, context=context).json()['id'])
            assert turn['status'] == 'completed'
            names = {item['function']['name'] for item in provider.calls[0]['tools']}
            assert 'prepare_presentation' not in names
            assert 'presentation_plans' not in turn
            assert tool_error(provider) == 'agent_presentation_not_allowed'


def test_study_context_is_not_a_paper_and_never_prepares(tmp_path):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        study = client.post('/api/v1/studies', json={
            'request_id': str(uuid4()), 'name': 'Synthetic study',
            'question': 'How do the recorded values differ?'})
        assert study.status_code == 201, study.text
        study_document = study.json()
        provider.responses = [
            tool('prepare_presentation', {'title': 'Study deck', 'paper_pages': [1]}),
            tool('complete_task', {'summary': 'Study is not a paper.'})]
        turn = wait_turn(client, study_document,
                         submit(client, study_document,
                                context=granted(page=None)).json()['id'])
        assert turn['status'] == 'completed'
        names = {item['function']['name'] for item in provider.calls[0]['tools']}
        assert 'prepare_presentation' not in names
        assert tool_error(provider) == 'agent_presentation_not_allowed'
        assert 'presentation_plans' not in turn


def test_trashed_and_changed_source_fail_before_any_plan(tmp_path):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        def trash(messages, tools):
            with app.state.store.connection() as db:
                db.execute('INSERT INTO document_trash VALUES (?,?)',
                           (document['id'], '2026-11-06T00:00:00+00:00'))
            return tool('prepare_presentation', {'title': 'Trashed', 'paper_pages': [1]})

        provider.responses = [trash,
                              tool('complete_task', {'summary': 'Trashed source.'})]
        turn = prepare(client, document)
        assert 'presentation_plans' not in turn
        assert tool_error(provider) == 'document_trashed'

    with paper_workspace(tmp_path / 'changed', model=ScriptedModel()) as (client, app, document, provider):
        def change(messages, tools):
            with (app.state.store.files / f"{document['id']}.pdf").open('ab') as stream:
                stream.write(b'\n% changed during preparation')
            return tool('prepare_presentation', {'title': 'Changed', 'paper_pages': [1]})

        provider.responses = [change,
                              tool('complete_task', {'summary': 'Changed source.'})]
        turn = prepare(client, document)
        assert 'presentation_plans' not in turn
        assert tool_error(provider) == 'source_changed'


def test_cancel_during_held_extraction_never_publishes_a_plan(tmp_path, monkeypatch):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        entered, release = threading.Event(), threading.Event()
        original = app.state.presentations.context

        def held(document_id, selectors):
            entered.set()
            assert release.wait(5), 'test did not release the extractor'
            return original(document_id, selectors)

        monkeypatch.setattr(app.state.presentations, 'context', held)
        provider.responses = [
            tool('prepare_presentation', {'title': 'Held plan', 'paper_pages': [1]}),
            tool('complete_task', {'summary': 'The request was cancelled.'})]
        turn_id = submit(client, document, context=granted()).json()['id']
        assert entered.wait(5), 'presentation extraction was not entered'
        response = client.post(
            f"/api/v1/documents/{document['id']}/agent/turns/{turn_id}/cancel")
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'cancelled'
        release.set()
        events = wait_held_call_processed(app, turn_id)
        assert [event for event in events if event['kind'] == 'presentation_plan'] == []
        turn = client.get(
            f"/api/v1/documents/{document['id']}/agent/turns/{turn_id}").json()
        assert turn['status'] == 'cancelled'
        assert plan_events(turn) == []


def test_clear_after_cancel_during_held_extraction_never_publishes_plan_and_loop_survives(
        tmp_path, monkeypatch):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        entered, release = threading.Event(), threading.Event()
        original = app.state.presentations.context

        def held(document_id, selectors):
            entered.set()
            assert release.wait(5), 'test did not release the extractor'
            return original(document_id, selectors)

        monkeypatch.setattr(app.state.presentations, 'context', held)
        provider.responses = [
            tool('prepare_presentation', {'title': 'Cleared plan', 'paper_pages': [1]}),
            tool('complete_task', {'summary': 'The conversation was cleared.'})]
        body = submit(client, document, context=granted()).json()
        turn_id, conversation_id = body['id'], body['conversation_id']
        assert entered.wait(5), 'presentation extraction was not entered'
        try:
            cancelled = client.post(
                f"/api/v1/documents/{document['id']}/agent/turns/{turn_id}/cancel")
            assert cancelled.status_code == 200, cancelled.text
            assert cancelled.json()['status'] == 'cancelled'
            cleared = client.post(
                f"/api/v1/documents/{document['id']}/agent/conversations/"
                f"{conversation_id}/clear", json={'request_id': str(uuid4())})
            assert cleared.status_code == 200, cleared.text
            assert cleared.json()['cleared'] is True
        finally:
            # The real worker loop must survive releasing the extractor on a
            # cleared conversation; never stop it to hide the lifecycle bug.
            release.set()
        events = wait_held_call_processed(app, turn_id)
        assert [event for event in events if event['kind'] == 'presentation_plan'] == []
        # The clear guard ended the turn without any further model dispatch.
        assert len(provider.calls) == 1
        assert app.state.agent.thread.is_alive()
        assert client.get(
            f"/api/v1/documents/{document['id']}/agent/conversations/"
            f"{conversation_id}").status_code == 410
        # The same surviving loop accepts a fresh normal conversation.
        provider.responses = [tool('complete_task', {'summary': 'Fresh conversation.'})]
        fresh = wait_turn(client, document,
                          submit(client, document, context=granted()).json()['id'])
        assert fresh['status'] == 'completed'
        assert fresh['conversation_id'] != conversation_id
        assert plan_events(fresh) == []
        assert app.state.agent.thread.is_alive()


def test_cross_owner_turn_access_and_foreign_plan_are_not_exposed(tmp_path):
    with paper_workspace(tmp_path / 'owner-a', model=ScriptedModel()) as (client, app, document, provider):
        provider.responses = [
            tool('prepare_presentation', {'title': 'Owner A deck', 'paper_pages': [1]}),
            tool('complete_task', {'summary': 'Owner A plan.'})]
        turn = prepare(client, document)
        assert turn['presentation_plans']

    with paper_workspace(tmp_path / 'owner-b', model=ScriptedModel()) as (client, app, document, provider):
        assert client.get(
            f"/api/v1/documents/{document['id']}/agent/turns/{turn['id']}").status_code == 404
        assert client.get(
            f"/api/v1/documents/{document['id']}/agent/conversations/"
            f"{turn['conversation_id']}").status_code == 404
        provider.responses = [tool('complete_task', {'summary': 'Owner B turn.'})]
        own = wait_turn(client, document,
                        submit(client, document, context=granted()).json()['id'])
        summary = canonical({
            'format': 'research-agent-presentation-plan/v1',
            'document_id': turn['presentation_plans'][0]['document_id'],
            'file_sha256': 'a' * 64, 'source_sha256': 'b' * 64,
            'title': 'Foreign plan', 'style': 'default', 'page_count': 1,
            'page_range': '1', 'text_chars': 10, 'empty_page_range': ''})
        with app.state.store.connection() as db:
            db.execute('INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)',
                       (str(uuid4()), own['id'], 'presentation_plan', 'Foreign',
                        'completed', summary, '2026-11-06T00:00:00+00:00'))
        reloaded = client.get(
            f"/api/v1/documents/{document['id']}/agent/turns/{own['id']}").json()
        assert 'presentation_plans' not in reloaded


def test_malformed_or_foreign_plans_are_ignored_without_reading_the_pdf(tmp_path, monkeypatch):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        provider.responses = [tool('complete_task', {'summary': 'No plan in this turn.'})]
        turn = wait_turn(client, document,
                         submit(client, document, context=granted()).json()['id'])
        identifier = plan_events(turn)
        assert identifier == []
        valid = {
            'format': 'research-agent-presentation-plan/v1',
            'document_id': document['id'], 'file_sha256': document['sha256'],
            'source_sha256': 'c' * 64, 'title': 'Kept plan', 'style': 'default',
            'page_count': 2, 'page_range': '1-2', 'text_chars': 20,
            'empty_page_range': ''}
        bad = [
            'not-json',
            canonical({**valid, 'document_id': str(uuid4())}),
            canonical({**valid, 'format': 'other/v1'}),
            canonical({**valid, 'extra': 'https://example.invalid'}),
            canonical({**valid, 'file_sha256': 'A' * 64}),
            canonical({**valid, 'source_sha256': 'c' * 63}),
            canonical({**valid, 'title': ' '}),
            canonical({**valid, 'title': '演' * 121}),
            canonical({**valid, 'style': 'fancy'}),
            canonical({**valid, 'page_count': 0}),
            canonical({**valid, 'page_range': '2-1'}),
            canonical({**valid, 'page_range': '1, 2'}),
            canonical({**valid, 'page_count': 1}),
            canonical({**valid, 'page_range': '3'}),
            canonical({**valid, 'page_count': 200, 'page_range': '1-61'}),
            canonical({**valid, 'page_range': '²'}),
            canonical({**valid, 'page_range': '١'}),
            canonical({**valid, 'page_range': '１'}),
            canonical({**valid, 'page_range': '1-²'}),
            canonical({**valid, 'page_range': '01'}),
            canonical({**valid, 'page_range': '1-٣'}),
            canonical({**valid, 'text_chars': 0}),
            canonical({**valid, 'empty_page_range': '3'}),
            'x' * 2001,
        ]
        with app.state.store.connection() as db:
            for summary in bad:
                db.execute('INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)',
                           (str(uuid4()), turn['id'], 'presentation_plan', 'Bad',
                            'completed', summary, '2026-11-06T00:00:00+00:00'))
            valid_id = str(uuid4())
            db.execute('INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)',
                       (valid_id, turn['id'], 'presentation_plan', 'Kept plan',
                        'completed', canonical(valid), '2026-11-06T00:00:00+00:00'))

        def forbidden(*_args, **_kwargs):
            raise AssertionError('History reading must not touch the PDF or model')

        monkeypatch.setattr(app.state.presentations, 'context', forbidden)
        reloaded = client.get(
            f"/api/v1/documents/{document['id']}/agent/turns/{turn['id']}").json()
        assert [plan['id'] for plan in reloaded['presentation_plans']] == [valid_id]
        assert set(reloaded['presentation_plans'][0]) == PLAN_FIELDS | {'id'}
        assert any(event['kind'] == 'presentation_plan' for event in reloaded['events'])


def test_plan_reader_uses_total_page_count_and_ignores_bad_stored_ranges(tmp_path):
    with paper_workspace(tmp_path, pages=[f'Page {index}' for index in range(1, 120)],
                         model=ScriptedModel()) as (client, app, document, provider):
        provider.responses = [tool('complete_task', {'summary': 'No plan in this turn.'})]
        turn = wait_turn(client, document,
                         submit(client, document, context=granted()).json()['id'])
        selected = list(range(1, 120, 2))  # 60 canonical pages, max 119
        base = {
            'format': 'research-agent-presentation-plan/v1',
            'document_id': document['id'], 'file_sha256': document['sha256'],
            'source_sha256': 'c' * 64, 'title': 'Stored plan', 'style': 'default',
            'page_count': 119, 'page_range': '1-2', 'text_chars': 20,
            'empty_page_range': ''}
        accepted = [
            (str(uuid4()), canonical({**base, 'page_range': '2'})),
            (str(uuid4()), canonical({**base, 'page_range': ','.join(
                str(page) for page in selected)})),
            (str(uuid4()), canonical({**base, 'page_range': '119'})),
        ]
        rejected = [
            canonical({**base, 'page_count': 118, 'page_range': '119'}),
            canonical({**base, 'page_count': 200, 'page_range': '1-61'}),
            canonical({**base, 'page_count': 200, 'page_range': ','.join(
                str(page) for page in range(1, 122, 2))}),
            canonical({**base, 'page_range': '1-119'}),
            canonical({**base, 'page_range': '²'}),
            canonical({**base, 'page_range': '١٢'}),
            canonical({**base, 'page_range': '１'}),
            canonical({**base, 'page_range': '1-²'}),
            canonical({**base, 'page_range': '1-٣'}),
            canonical({**base, 'page_range': '2,1'}),
            canonical({**base, 'page_range': '0'}),
            canonical({**base, 'page_range': ''}),
        ]
        with app.state.store.connection() as db:
            for identifier, summary in accepted:
                db.execute('INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)',
                           (identifier, turn['id'], 'presentation_plan', 'Stored plan',
                            'completed', summary, '2026-11-06T00:00:00+00:00'))
            for summary in rejected:
                db.execute('INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)',
                           (str(uuid4()), turn['id'], 'presentation_plan', 'Bad range',
                            'completed', summary, '2026-11-06T00:00:00+00:00'))
        reloaded = client.get(
            f"/api/v1/documents/{document['id']}/agent/turns/{turn['id']}").json()
        assert [plan['id'] for plan in reloaded['presentation_plans']] == [
            identifier for identifier, _ in accepted]
        assert reloaded['presentation_plans'][0]['page_count'] == 119


def test_identical_same_turn_plans_dedupe_but_distinct_plans_persist(tmp_path):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        arguments = {'title': 'Same plan', 'paper_pages': [1]}
        provider.responses = [
            tool('prepare_presentation', arguments),
            tool('prepare_presentation', arguments),
            tool('prepare_presentation', {**arguments, 'title': 'Other plan'}),
            tool('complete_task', {'summary': 'Two distinct plans.'})]
        turn = prepare(client, document)
        assert len(plan_events(turn)) == 2
        assert len(turn['presentation_plans']) == 2
        assert len({plan['id'] for plan in turn['presentation_plans']}) == 2


def test_baseline_payload_without_grant_keeps_serialization_and_hash():
    baseline = json.loads(BASELINE.read_text(encoding='utf-8'))
    payload = AgentSubmission.model_validate(baseline['input'])
    assert payload.model_dump(mode='json') == baseline['serialized']
    assert submission_hash(baseline['document_id'], payload) == baseline['hash']

    explicit_false = json.loads(json.dumps(baseline['input']))
    explicit_false['context']['presentation_actions'] = False
    payload = AgentSubmission.model_validate(explicit_false)
    assert payload.model_dump(mode='json') == baseline['serialized']
    assert submission_hash(baseline['document_id'], payload) == baseline['hash']

    granted_input = json.loads(json.dumps(baseline['input']))
    granted_input['context']['presentation_actions'] = True
    granted = AgentSubmission.model_validate(granted_input)
    assert granted.model_dump(mode='json')['context']['presentation_actions'] is True
    assert submission_hash(baseline['document_id'], granted) != baseline['hash']


def test_status_advertises_presentation_only_when_installed_and_schema_is_unchanged(tmp_path):
    with paper_workspace(tmp_path, model=ScriptedModel()) as (client, app, document, provider):
        status = client.get('/api/v1/agent/status').json()
        assert status['agent_presentations'] is True
        assert 'prepare_presentation' in {item['name'] for item in status['tools']}
        with app.state.store.connection() as db:
            columns = [row['name'] for row in db.execute('PRAGMA table_info(agent_events)')]
        assert columns == ['id', 'turn_id', 'kind', 'title', 'status', 'summary',
                           'created_at']
        app.state.agent.workspace.presentations = None
        status = client.get('/api/v1/agent/status').json()
        assert 'agent_presentations' not in status
        assert 'prepare_presentation' not in {item['name'] for item in status['tools']}
