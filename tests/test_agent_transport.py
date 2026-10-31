import io
import json
from pathlib import Path
import urllib.error
from uuid import uuid4

import pytest

from research_workbench.agent_context import PageTextReader
from research_workbench.agent_models import ModelSettings
from research_workbench.agent_provider import ModelConnection,NoRedirect
from research_workbench.models import WorkspaceError


def settings(**changes):
    return ModelSettings(base_url=changes.get('base_url','https://example.invalid/v1'),model='synthetic-model',
                         api_key='synthetic-private-key',supports_images=True)


def test_provider_own_config_private_and_inherited_config_read_only(tmp_path):
    inherited=tmp_path/'inherited.json'
    inherited.write_text(json.dumps(settings().model_dump()))
    original=inherited.read_bytes()
    provider=ModelConnection(tmp_path/'own',inherited)
    status=provider.status()
    assert status['configured'] and status['image_input'] and status['connection_source']=='inherited'
    assert all(term not in json.dumps(status) for term in ['synthetic-private-key','api_key',str(inherited)])
    provider.save(settings(base_url='https://different.invalid/v1'))
    assert provider.status()['connection_source']=='local'
    assert inherited.read_bytes()==original
    assert not list((tmp_path/'own').glob('*.private'))


@pytest.mark.parametrize('url',['http://example.invalid','https://u:p@example.invalid','https://example.invalid?token=x',
                                'https://example.invalid#frag','file:///private/path','https://'])
def test_provider_rejects_non_https_or_credentialed_urls(tmp_path,url):
    provider=ModelConnection(tmp_path)
    with pytest.raises(WorkspaceError) as error:provider.save(settings(base_url=url))
    assert error.value.code=='agent_invalid_provider'
    assert not provider.path.exists()


class Transport:
    def __init__(self,responses):self.responses=list(responses);self.requests=[]
    def open(self,request,timeout):
        self.requests.append(request)
        response=self.responses.pop(0)
        if isinstance(response,Exception):raise response
        return io.BytesIO(response)


def response():
    return json.dumps({'choices':[{'message':{'role':'assistant','content':'Synthetic answer'},'finish_reason':'stop'}]}).encode()


def test_model_transport_retries_once_without_replaying_business_tools(tmp_path):
    transport=Transport([urllib.error.URLError('synthetic disconnect'),response()])
    provider=ModelConnection(tmp_path,opener=transport);provider.save(settings())
    result=provider.complete([{'role':'user','content':'Synthetic input'}],[])
    assert result['content']=='Synthetic answer' and result['finish_reason']=='stop'
    assert len(transport.requests)==2
    assert transport.requests[0].data==transport.requests[1].data
    assert transport.requests[0].headers['Authorization']=='Bearer synthetic-private-key'


@pytest.mark.parametrize('failure,code',[
    (urllib.error.HTTPError('https://example.invalid',302,'redirect',{},None),'agent_provider_error'),
    (urllib.error.HTTPError('https://example.invalid',401,'invalid secret',{},None),'agent_provider_error'),
    (b'not json','agent_provider_response'),(b'{}','agent_provider_response'),
    (b'x'*(256*1024+1),'agent_provider_response')])
def test_transport_error_is_sanitized_and_not_false_success(tmp_path,failure,code):
    transport=Transport([failure]);provider=ModelConnection(tmp_path,opener=transport);provider.save(settings())
    with pytest.raises(WorkspaceError) as error:provider.complete([{'role':'user','content':'Synthetic'}],[])
    assert error.value.code==code and 'synthetic-private-key' not in error.value.message
    assert provider.status()['connection_state']=='unavailable'
    assert len(transport.requests)==1
    assert NoRedirect().redirect_request(None,None,None,None,None,None) is None


def test_transport_second_network_failure_stops_after_two_attempts(tmp_path):
    transport=Transport([TimeoutError(),TimeoutError()]);provider=ModelConnection(tmp_path,opener=transport);provider.save(settings())
    with pytest.raises(WorkspaceError) as error:provider.complete([],[])
    assert error.value.code=='agent_provider_unavailable' and len(transport.requests)==2


def test_bad_or_missing_config_does_not_claim_configured(tmp_path):
    provider=ModelConnection(tmp_path)
    assert not provider.status()['configured']
    provider.path.write_text('{broken')
    assert not provider.status()['configured']
    with pytest.raises(WorkspaceError) as error:provider.complete([],[])
    assert error.value.code=='agent_not_configured'


@pytest.mark.parametrize('body,code',[("import os;os._exit(7)",'text_unavailable'),("import time;time.sleep(5)",'text_timeout')])
def test_pdf_text_child_crash_and_timeout_do_not_kill_parent(tmp_path,monkeypatch,body,code):
    probe=tmp_path/'probe.py';probe.write_text(body)
    monkeypatch.setattr('research_workbench.agent_context.PROBE',probe)
    with pytest.raises(WorkspaceError) as error:PageTextReader(timeout=.1)(tmp_path/'synthetic.pdf',1)
    assert error.value.code==code


@pytest.mark.parametrize('field,value',[
    ('page',0),('page',True),('page',1.5),('page',3),('rect',[0,0,2,1]),('rect',[0,0,0,1]),
    ('image_ids',[str(uuid4()) for _ in range(5)]),('language','unknown'),('actor','fake')])
def test_invalid_reading_context_never_queues_model_work(tmp_path,field,value):
    from agent_support import workspace,submit
    with workspace(tmp_path/'workspace') as (client,app,document,provider):
        response=submit(client,document,context={'page':1,field:value})
        assert response.status_code==422,response.text
        assert provider.calls==[]
