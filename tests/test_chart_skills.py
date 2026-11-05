import hashlib
import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from agent_support import ScriptedModel
from analysis_support import workspace
from research_workbench.agent_store import canonical
from research_workbench.main import create_app
from research_workbench.store import Store

BASE='/api/v1/chart-skills'


def spec(**changes):
    value={
        'format':'research-chart-skill/v1',
        'name':'My research figure',
        'description':'Purpose',
        'chart':{'kind':'histogram','bins':20},
        'style':{
            'palette':['#0072B2','#D55E00','#009E73','#CC79A7'],
            'font_family':'Arial, sans-serif','font_size':12,'line_width':1,
            'marker_size':6,'width':900,'height':560},
        'exports':['png','svg','offline']}
    for key,item in changes.items():
        if isinstance(item,dict) and isinstance(value.get(key),dict):value[key]={**value[key],**item}
        else:value[key]=item
    return value


def create(client,value=None,request_id=None):
    request_id=request_id or str(uuid4())
    return client.post(BASE,json={'request_id':request_id,'spec':value or spec()}),request_id


def version(client,identifier,revision,value=None,request_id=None):
    request_id=request_id or str(uuid4())
    body={'request_id':request_id,'expected_revision':revision,'spec':value or spec()}
    return client.post(f'{BASE}/{identifier}/versions',json=body),request_id


def test_create_list_get_export_and_exact_retry(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        response,identifier=create(c,spec(name='  My research figure  '))
        assert response.status_code==201,response.text
        record=response.json();assert record['id']==identifier and record['revision']==1
        assert record['spec']['name']=='My research figure'
        assert record['sha256']==hashlib.sha256(canonical(record['spec']).encode()).hexdigest()
        assert set(record)=={'id','revision','sha256','spec','created_at','updated_at'}
        assert c.get(BASE).json()=={'items':[record]}
        assert c.get(f'{BASE}/{identifier}').json()==record
        exported=c.get(f'{BASE}/{identifier}/export')
        assert exported.status_code==200 and json.loads(exported.content)==record['spec']
        assert identifier in exported.headers['content-disposition']
        assert set(json.loads(exported.content))=={'format','name','description','chart','style','exports'}
        retried,identifier=create(c,spec(name='  My research figure  '),identifier)
        assert retried.status_code==200 and retried.json()==record
        conflict,_=create(c,spec(name='Different figure'),identifier)
        assert conflict.status_code==409 and conflict.json()['detail']['code']=='idempotency_conflict'
    app=create_app(tmp_path,agent_provider=ScriptedModel(),agent_autostart=False,analysis_autostart=False)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48002)) as c:
        assert c.get(BASE).json()=={'items':[record]}
        assert c.get(f'{BASE}/{identifier}').json()==record


@pytest.mark.parametrize('change',[
    {'extra':'value'},
    {'chart':{'extra':1}},
    {'style':{'extra':1}},
    {'chart':{'kind':'unknown'}},
    {'chart':{'kind':'scatter','bins':5}},
    {'chart':{'bins':None}},
    {'chart':{'bins':True}},
    {'style':{'palette':['#0072B2']}},
    {'style':{'palette':['#0072B2','#0072B2']}},
    {'style':{'palette':['#0072B2','#00GG00']}},
    {'style':{'font_family':'Comic Sans MS'}},
    {'style':{'font_size':True}},
    {'style':{'font_size':12.0}},
    {'style':{'line_width':True}},
    {'style':{'line_width':'1'}},
    {'style':{'line_width':0.4}},
    {'style':{'marker_size':17}},
    {'style':{'width':479}},
    {'style':{'height':1601}},
    {'exports':[]},
    {'exports':['png','png']},
    {'exports':['pdf']},
    {'name':''},
    {'name':'x'*61},
    {'name':'bad\nname'},
    {'name':'\nMy research figure'},
    {'name':'My research figure\t'},
    {'description':'x'*501},
    {'description':'bad\x7ftext'},
])
def test_invalid_specs_are_rejected_without_writes(tmp_path,change):
    with workspace(tmp_path) as (c,app,doc,_):
        response,_=create(c,spec(**change))
        assert response.status_code==422,response.text
        assert response.json()['detail']['code'] in ('chart_skill_invalid','validation_error')
        assert c.get(BASE).json()=={'items':[]}


def test_oversized_encoded_json_is_rejected(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        identifier=str(uuid4())
        body=json.dumps({'request_id':identifier,'spec':spec()})
        padded='{'+(' '*(17*1024))+body[1:]
        response=c.post(BASE,content=padded,headers={'content-type':'application/json'})
        assert response.status_code==422 and response.json()['detail']['code']=='chart_skill_invalid'
        assert c.get(BASE).json()=={'items':[]}


def test_append_version_retry_conflict_and_stale_revision(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        first,_=create(c);original=first.json()
        second,second_id=version(c,original['id'],1,spec(name='Second version',style={'palette':['#ffffff','#000000']}))
        assert second.status_code==201,second.text
        revision2=second.json();assert revision2['revision']==2
        assert revision2['created_at']==original['created_at'] and revision2['updated_at']>=original['updated_at']
        retried,_=version(c,original['id'],1,spec(name='Second version',style={'palette':['#ffffff','#000000']}),second_id)
        assert retried.status_code==200 and retried.json()==revision2
        third,_=version(c,original['id'],2,spec(name='Third version'))
        assert third.status_code==201 and third.json()['revision']==3
        replay,_=version(c,original['id'],1,spec(name='Second version',style={'palette':['#ffffff','#000000']}),second_id)
        assert replay.status_code==200 and replay.json()==revision2
        conflict,_=version(c,original['id'],1,spec(name='Changed retry'),second_id)
        assert conflict.status_code==409 and conflict.json()['detail']['code']=='idempotency_conflict'
        stale,_=version(c,original['id'],1,spec(name='Stale edit'))
        assert stale.status_code==409 and stale.json()['detail']['code']=='revision_conflict'
        assert c.get(f'{BASE}/{original["id"]}').json()['revision']==3
        assert c.get(BASE).json()['items'][0]['revision']==3


def test_skill_and_version_quotas_boundaries(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        first,_=create(c);skill_id=first.json()['id']
        dbpath=app.state.store.database
        stamp='2026-11-05T00:00:00+00:00';value=spec();raw=canonical(value);sha=hashlib.sha256(raw.encode()).hexdigest()
        with sqlite3.connect(dbpath) as db:
            for index in range(99):
                identifier=str(uuid4());request_hash='a'*64
                db.execute('INSERT INTO chart_skills VALUES (?,?,?)',(identifier,request_hash,stamp))
                db.execute('INSERT INTO chart_skill_versions VALUES (?,1,?,?,?,?,?,?)',
                    (identifier,identifier,request_hash,sha,raw,stamp,stamp))
        assert len(c.get(BASE).json()['items'])==100
        blocked,_=create(c)
        assert blocked.status_code==413 and blocked.json()['detail']['code']=='chart_skill_quota'
        with sqlite3.connect(dbpath) as db:
            for revision in range(2,101):
                request_id=str(uuid4())
                db.execute('INSERT INTO chart_skill_versions VALUES (?,?,?,?,?,?,?,?)',
                    (skill_id,revision,request_id,'b'*64,sha,raw,stamp,stamp))
        blocked,_=version(c,skill_id,100,spec(name='Too many versions'))
        assert blocked.status_code==413 and blocked.json()['detail']['code']=='chart_skill_quota'


def test_workspaces_and_guests_do_not_share_skills(tmp_path):
    with workspace(tmp_path/'owner') as (owner,_,_,_):created=create(owner)[0].json()
    with workspace(tmp_path/'guest') as (guest,_,_,_):
        assert guest.get(BASE).json()=={'items':[]}
        assert guest.get(f'{BASE}/{created["id"]}').status_code==404
        assert guest.get(f'{BASE}/{created["id"]}').json()['detail']['code']=='not_found'


def test_schema28_old_rows_survive_upgrade_and_future_schema_is_rejected(tmp_path):
    Store(tmp_path)
    document,note=str(uuid4()),str(uuid4());stamp='2026-11-05T00:00:00+00:00'
    dbpath=tmp_path/'workspace.sqlite3'
    with sqlite3.connect(dbpath) as db:
        db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(document,'Original','original.pdf',1,1,'a'*64,stamp))
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note,document,1,None,'Original note',stamp))
        before=(db.execute('SELECT * FROM documents WHERE id=?',(document,)).fetchone(),
            db.execute('SELECT * FROM notes WHERE id=?',(note,)).fetchone())
        db.execute('DROP TABLE chart_skill_versions');db.execute('DROP TABLE chart_skills')
        db.execute('PRAGMA user_version=28')
    Store(tmp_path)
    with sqlite3.connect(dbpath) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==29
        assert (db.execute('SELECT * FROM documents WHERE id=?',(document,)).fetchone(),
            db.execute('SELECT * FROM notes WHERE id=?',(note,)).fetchone())==before
        tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {'chart_skills','chart_skill_versions'}<=tables
        db.execute('PRAGMA user_version=30')
    with pytest.raises(RuntimeError):Store(tmp_path)
