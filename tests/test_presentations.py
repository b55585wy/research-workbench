import copy
import json
from uuid import uuid4

from agent_support import text_pdf
from analysis_support import upload, run, workspace
from chart_support import payload, save
from research_workbench import presentation_service
from research_workbench.models import WorkspaceError


class FakeProvider:
    def __init__(self, responses=(), configured=True):
        self.responses = list(responses)
        self.calls = []
        self.configured = configured

    def status(self):
        return {'configured': self.configured, 'model': 'synthetic-presentation-model',
                'connection_state': 'test_double'}

    def complete_once(self, messages, tools):
        self.calls.append({'messages': copy.deepcopy(messages), 'tools': copy.deepcopy(tools)})
        if not self.responses:
            return {'role': 'assistant', 'content': '{}', 'finish_reason': 'stop'}
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return copy.deepcopy(response)


def sources(c, app, doc):
    data = upload(c, doc).json()
    job = run(app.state.analysis, doc, data, columns=['value', 'second'])
    chart = save(c, doc, payload(c, data, 'analysis_counts', analysis_id=job['id']))
    note = c.post(f"/api/v1/documents/{doc['id']}/notes",
                  json={'request_id': str(uuid4()), 'page': 1, 'text': 'Synthetic source note'})
    assert note.status_code == 201, note.text
    return data, job, chart, note.json()


def selectors(note, chart, job, **changes):
    value = {'title': 'Synthetic presentation', 'style': 'nature',
             'note_ids': [note['id']], 'chart_ids': [chart['id']],
             'analysis_ids': [job['id']]}
    value.update(changes)
    return value


def get_context(c, doc, body):
    response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def ai_outline(c, doc, body, context, provider, value, **changes):
    provider.responses.append({'role': 'assistant',
                               'content': json.dumps(value, ensure_ascii=False),
                               'finish_reason': 'stop'})
    request = {**body, 'source_sha256': context['source_sha256'],
               'request_id': str(uuid4()), 'confirmed': True}
    request.update(changes)
    return c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request), request


def simple_outline(context):
    refs = [item['ref'] for item in context['sources']]
    return {'title': 'AI outline',
            'slides': [{'title': 'Overview', 'body': ['Synthetic body'],
                        'source_refs': refs, 'chart_id': None}]}


def note_state(c, doc, note):
    response = c.get(f"/api/v1/documents/{doc['id']}/notes/{note['id']}/state")
    assert response.status_code == 200, response.text
    return response.json()


def test_capabilities_hide_keys_and_report_frozen_limits(tmp_path):
    provider = FakeProvider()
    with workspace(tmp_path, model=provider) as (c, app, doc, _):
        response = c.get('/api/v1/presentations/capabilities')
        assert response.status_code == 200
        value = response.json()
        assert set(value) == {'available', 'ai_available', 'styles', 'limits'}
        assert value['styles'] == ['default', 'nature', 'cell']
        assert value['limits'] == {'notes': 5, 'charts': 4, 'analyses': 4, 'slides': 8}
        assert value['ai_available'] is True
        assert 'api_key' not in response.text and 'base_url' not in response.text


def test_context_returns_verified_sources_and_deterministic_outline(tmp_path):
    with workspace(tmp_path) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        body = selectors(note, chart, job)
        first = get_context(c, doc, body)
        second = get_context(c, doc, body)
        assert set(first) == {'source_sha256', 'sources', 'text', 'suggested_outline'}
        assert first['source_sha256'] == second['source_sha256']
        assert first['sources'] == second['sources']
        assert [item['kind'] for item in first['sources']] == ['note', 'chart', 'analysis']
        assert first['sources'][0]['ref'] == 'note:' + note['id']
        assert 'Synthetic source note' in first['text']
        assert chart['id'] in first['text']
        outline = first['suggested_outline']
        assert outline == second['suggested_outline']
        assert 1 <= len(outline['slides']) <= 8
        allowed = {item['ref'] for item in first['sources']}
        for slide in outline['slides']:
            assert set(slide['source_refs']) <= allowed
            assert set(slide) == {'title', 'body', 'source_refs', 'chart_id'}


def test_ai_outline_calls_once_and_reuses_terminal_result(tmp_path):
    provider = FakeProvider()
    with workspace(tmp_path, model=provider) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        body = selectors(note, chart, job)
        context = get_context(c, doc, body)
        response, request = ai_outline(c, doc, body, context, provider, simple_outline(context))
        assert response.status_code == 200, response.text
        result = response.json()
        assert set(result) == {'outline', 'sources', 'source_sha256', 'ai_generated'}
        assert result['ai_generated'] is True and result['source_sha256'] == context['source_sha256']
        assert len(provider.calls) == 1 and provider.calls[0]['tools'] == []
        repeat = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert repeat.status_code == 200 and repeat.json() == result
        assert len(provider.calls) == 1
        changed = {**request, 'title': 'Changed request title'}
        conflict = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=changed)
        assert conflict.status_code == 409 and len(provider.calls) == 1


def test_changed_source_is_rejected_before_provider(tmp_path):
    provider = FakeProvider()
    with workspace(tmp_path, model=provider) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        body = selectors(note, chart, job)
        context = get_context(c, doc, body)
        state = note_state(c, doc, note)
        patched = c.patch(f"/api/v1/documents/{doc['id']}/notes/{note['id']}",
                          json={'request_id': str(uuid4()), 'expected_revision': state['revision'],
                                'text': 'Changed source note'})
        assert patched.status_code == 200, patched.text
        response, _ = ai_outline(c, doc, body, context, provider, simple_outline(context))
        assert response.status_code == 409
        assert response.json()['detail']['code'] == 'presentation_source_changed'
        assert provider.calls == []


def test_missing_deleted_and_cross_document_sources_are_rejected(tmp_path):
    provider = FakeProvider()
    with workspace(tmp_path, model=provider) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        body = selectors(note, chart, job)
        state = note_state(c, doc, note)
        deleted = c.request('DELETE',
            f"/api/v1/documents/{doc['id']}/notes/{note['id']}",
            json={'request_id': str(uuid4()), 'expected_revision': state['revision']})
        assert deleted.status_code == 200, deleted.text
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context", json=body)
        assert response.status_code == 409
        assert response.json()['detail']['code'] == 'note_deleted'

        other = c.post('/api/v1/documents',
                       files={'file': ('other.pdf', text_pdf(), 'application/pdf')})
        assert other.status_code == 201, other.text
        other_doc = other.json()
        foreign = c.post(f"/api/v1/documents/{other_doc['id']}/notes",
                         json={'request_id': str(uuid4()), 'page': 1, 'text': 'Foreign note'})
        assert foreign.status_code == 201, foreign.text
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context",
                          json=selectors(foreign.json(), chart, job))
        assert response.status_code == 404


def test_empty_cross_kind_oversize_and_invalid_outlines_are_rejected(tmp_path):
    with workspace(tmp_path) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        empty = selectors(note, chart, job, note_ids=[], chart_ids=[], analysis_ids=[])
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context", json=empty)
        assert response.status_code == 422
        duplicate = selectors(note, chart, job, note_ids=[note['id'], note['id']])
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context", json=duplicate)
        assert response.status_code == 422
        style = selectors(note, chart, job, style='journal')
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context", json=style)
        assert response.status_code == 422

        context = get_context(c, doc, selectors(note, chart, job))
        base = simple_outline(context)
        too_many = {**base, 'slides': [
            {'title': f'Slide {index}', 'body': [], 'source_refs': [],
             'chart_id': None} for index in range(9)]}
        request = {**selectors(note, chart, job), 'source_sha256': context['source_sha256'],
                   'outline': too_many}
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
        assert response.status_code == 422


def test_oversize_context_is_rejected_with_selection_explanation(tmp_path, monkeypatch):
    with workspace(tmp_path) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        monkeypatch.setattr(presentation_service, 'MAX_CONTEXT', 10)
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/context",
                          json=selectors(note, chart, job))
        assert response.status_code == 413
        assert response.json()['detail']['code'] == 'presentation_context_too_large'


def test_failed_truncated_and_invalid_model_outputs_never_bill_twice(tmp_path):
    provider = FakeProvider()
    with workspace(tmp_path, model=provider) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        body = selectors(note, chart, job)
        context = get_context(c, doc, body)
        valid = simple_outline(context)

        provider.responses.append({'role': 'assistant', 'content': json.dumps(valid),
                                   'finish_reason': 'length'})
        request = {**body, 'source_sha256': context['source_sha256'],
                   'request_id': str(uuid4()), 'confirmed': True}
        first = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert first.status_code == 502
        assert first.json()['detail']['code'] == 'presentation_outline_truncated'
        second = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert second.status_code == 502 and len(provider.calls) == 1

        invalid = {**valid, 'slides': [{**valid['slides'][0],
                   'source_refs': ['note:' + str(uuid4())]}]}
        provider.responses.append({'role': 'assistant', 'content': json.dumps(invalid),
                                   'finish_reason': 'stop'})
        request = {**request, 'request_id': str(uuid4())}
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert response.status_code == 422 and len(provider.calls) == 2
        repeat = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert repeat.status_code == 422 and len(provider.calls) == 2

        provider.responses.append(WorkspaceError('agent_provider_unavailable',
                                                 '暂时无法连接模型服务，请稍后重试。', 502))
        request = {**request, 'request_id': str(uuid4())}
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert response.status_code == 502 and len(provider.calls) == 3
        repeat = c.post(f"/api/v1/documents/{doc['id']}/presentations/outline", json=request)
        assert repeat.status_code == 502 and len(provider.calls) == 3


def test_stale_source_before_export_and_missing_dependency_are_safe(tmp_path, monkeypatch):
    with workspace(tmp_path) as (c, app, doc, _):
        data, job, chart, note = sources(c, app, doc)
        body = selectors(note, chart, job)
        context = get_context(c, doc, body)
        stale = {**body, 'source_sha256': context['source_sha256'],
                 'outline': context['suggested_outline']}
        state = note_state(c, doc, note)
        patched = c.patch(f"/api/v1/documents/{doc['id']}/notes/{note['id']}",
                          json={'request_id': str(uuid4()), 'expected_revision': state['revision'],
                                'text': 'Stale source note'})
        assert patched.status_code == 200, patched.text
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=stale)
        assert response.status_code == 409
        assert response.json()['detail']['code'] == 'presentation_source_changed'

        fresh = get_context(c, doc, body)
        request = {**body, 'source_sha256': fresh['source_sha256'],
                   'outline': fresh['suggested_outline']}
        monkeypatch.setattr(presentation_service, '_pptx_available', lambda: False)
        assert c.get('/api/v1/presentations/capabilities').json()['available'] is False
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
        assert response.status_code == 503
        assert response.json()['detail']['code'] == 'presentation_unavailable'


def test_chart_observations_are_bounded_not_sampled(tmp_path):
    with workspace(tmp_path) as (c, app, doc, _):
        content = ('value,second\n' + ''.join(f'{index},{index * 2}\n'
                   for index in range(2001))).encode()
        data = upload(c, doc, content=content).json()
        chart = save(c, doc, payload(c, data, 'scatter'))
        body = {'title': 'Large chart', 'style': 'default',
                'note_ids': [], 'chart_ids': [chart['id']], 'analysis_ids': []}
        context = get_context(c, doc, body)
        request = {**body, 'source_sha256': context['source_sha256'],
                   'outline': context['suggested_outline']}
        response = c.post(f"/api/v1/documents/{doc['id']}/presentations/export", json=request)
        assert response.status_code == 413
        assert response.json()['detail']['code'] == 'presentation_chart_too_large'
