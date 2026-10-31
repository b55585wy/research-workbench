from contextlib import contextmanager
import copy
import io
import json
import threading
import time
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject

from research_workbench.main import create_app


def text_pdf():
    writer=PdfWriter()
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    for number in (1,2):
        page=writer.add_blank_page(width=612,height=792)
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream=DecodedStreamObject();stream.set_data(f'BT /F1 12 Tf 50 740 Td (SYNTHETIC CONTEXT PAGE {number}. Not research evidence.) Tj ET'.encode())
        page[NameObject('/Contents')]=writer._add_object(stream)
    output=io.BytesIO();writer.write(output);return output.getvalue()


def picture(format='PNG',size=(320,240),color='blue'):
    output=io.BytesIO();Image.new('RGB',size,color).save(output,format=format);return output.getvalue()


def tool(name,arguments,identifier=None):
    return {'role':'assistant','content':None,'tool_calls':[{'id':identifier or str(uuid4()),'type':'function',
        'function':{'name':name,'arguments':json.dumps(arguments)}}],'finish_reason':'tool_calls'}


def answer(text='Synthetic answer [R1]'):
    return {'role':'assistant','content':text,'finish_reason':'stop'}


class ScriptedModel:
    def __init__(self,responses=(),images=True,configured=True):
        self.responses=list(responses);self.calls=[];self.images=images;self.configured=configured
        self.lock=threading.Lock()

    def status(self):
        return {'configured':self.configured,'model':'synthetic-test-model','image_input':self.images,
                'connection_state':'test_double','connection_source':'local','scope':'local_research','multi_user_auth':False}

    def complete(self,messages,tools):
        with self.lock:
            self.calls.append({'messages':copy.deepcopy(messages),'tools':copy.deepcopy(tools)})
            response=self.responses.pop(0) if self.responses else answer()
        if isinstance(response,Exception):raise response
        return response(messages,tools) if callable(response) else copy.deepcopy(response)


@contextmanager
def workspace(root,model=None,autostart=True,reader=None):
    model=model or ScriptedModel()
    app=create_app(root,agent_provider=model,page_reader=reader,agent_autostart=autostart)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as client:
        uploaded=client.post('/api/v1/documents',files={'file':('synthetic-context.pdf',text_pdf(),'application/pdf')})
        assert uploaded.status_code==201,uploaded.text
        yield client,app,uploaded.json(),model


def submit(client,document,message='Explain current page',**changes):
    payload={'request_id':str(uuid4()),'conversation_id':None,'message':message,
             'context':{'page':1,'language':'en','image_ids':[]}}
    payload.update(changes)
    return client.post(f"/api/v1/documents/{document['id']}/agent/turns",json=payload)


def wait_turn(client,document,identifier):
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        response=client.get(f"/api/v1/documents/{document['id']}/agent/turns/{identifier}")
        assert response.status_code==200,response.text
        result=response.json()
        if result['status'] not in ('queued','running'):return result
        threading.Event().wait(.02)
    raise AssertionError('Agent turn did not reach a visible checkpoint')


def upload_image(client,document,content=None,identifier=None,name='synthetic.png'):
    return client.post(f"/api/v1/documents/{document['id']}/images",data={'request_id':identifier or str(uuid4())},
                       files={'file':(name,content or picture(),'image/png')})


def confirm(client,document,turn,proposal=None,approved=True,**changes):
    proposal=proposal or turn['proposals'][0]
    return client.post(f"/api/v1/documents/{document['id']}/agent/turns/{turn['id']}/proposals/{proposal['id']}/confirm",
        json={'approved':approved,'proposal_sha256':proposal['sha256'],**changes})
