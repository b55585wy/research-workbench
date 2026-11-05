import hashlib
import io
import json
from uuid import uuid4
import zipfile

import pytest

from analysis_support import workspace,upload
from chart_support import prefix,payload as chart_payload,save
from research_workbench.agent_store import canonical
from research_workbench.chart_models import ChartCreate

SKILLS='/api/v1/chart-skills'


def spec(**changes):
    value={
        'format':'research-chart-skill/v1','name':'My research figure','description':'Purpose',
        'chart':{'kind':'histogram','bins':2},
        'style':{'palette':['#0072B2','#D55E00','#009E73','#CC79A7'],'font_family':'Arial, sans-serif',
                 'font_size':12,'line_width':1,'marker_size':6,'width':900,'height':560},
        'exports':['png','svg','offline']}
    for key,item in changes.items():
        if isinstance(item,dict) and isinstance(value.get(key),dict):value[key]={**value[key],**item}
        else:value[key]=item
    return value


def create_skill(client,value=None,request_id=None):
    response=client.post(SKILLS,json={'request_id':request_id or str(uuid4()),'spec':value or spec()})
    assert response.status_code==201,response.text
    return response.json()


def reference(skill):
    return {'id':skill['id'],'revision':skill['revision'],'sha256':skill['sha256']}


def test_preview_save_frozen_snapshot_and_reuse_after_recipe_edit(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        skill=create_skill(c);data=upload(c,doc).json()
        body=chart_payload(c,data,'histogram',skill=reference(skill))
        preview=c.post(prefix(doc)+'/preview',json=body)
        assert preview.status_code==200,preview.text
        value=preview.json();snapshot=value['chart']['skill_snapshot']
        assert snapshot=={'id':skill['id'],'revision':1,'sha256':skill['sha256'],'spec':skill['spec']}
        assert value['data']['skill_snapshot']==snapshot and 'skill_snapshot' not in value['data']['spec']
        assert c.get(prefix(doc)).json()=={'items':[]}
        saved=c.post(prefix(doc),json=body);assert saved.status_code==201,saved.text
        chart=saved.json();assert chart['skill_snapshot']==snapshot
        original_data=c.get(chart['data_url']).content
        assert json.loads(original_data)['skill_snapshot']==snapshot
        edited=c.post(f'{SKILLS}/{skill["id"]}/versions',json={'request_id':str(uuid4()),'expected_revision':1,
            'spec':spec(name='Edited recipe',style={'palette':['#ffffff','#000000']})})
        assert edited.status_code==201,edited.text
        assert edited.json()['revision']==2
        replay=c.post(prefix(doc),json=body)
        assert replay.status_code==200 and replay.json()==chart
        assert c.get(f'{prefix(doc)}/{chart["id"]}').json()['skill_snapshot']==snapshot
        assert c.get(chart['data_url']).content==original_data
        stale=c.post(prefix(doc)+'/preview',json=body)
        assert stale.status_code==409 and stale.json()['detail']['code']=='chart_skill_changed'
        fresh=chart_payload(c,data,'histogram',skill=reference(edited.json()))
        assert c.post(prefix(doc)+'/preview',json=fresh).json()['chart']['skill_snapshot']['revision']==2
        assert c.get(chart['data_url']).content==original_data


def test_skill_reference_kind_bins_and_missing_skill_are_enforced(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();histogram=create_skill(c)
        mismatch=chart_payload(c,data,'histogram',skill={**reference(histogram),'revision':2})
        assert c.post(prefix(doc)+'/preview',json=mismatch).status_code==409
        bad_hash=chart_payload(c,data,'histogram',skill={**reference(histogram),'sha256':'0'*64})
        assert c.post(prefix(doc)+'/preview',json=bad_hash).json()['detail']['code']=='chart_skill_changed'
        missing=chart_payload(c,data,'histogram',skill={'id':str(uuid4()),'revision':1,'sha256':'0'*64})
        response=c.post(prefix(doc)+'/preview',json=missing)
        assert response.status_code==404 and response.json()['detail']['code']=='not_found'
        bins=create_skill(c,spec(chart={'bins':4}))
        wrong=chart_payload(c,data,'histogram',skill=reference(bins))
        assert c.post(prefix(doc)+'/preview',json=wrong).json()['detail']['code']=='chart_skill_changed'
        scatter=create_skill(c,spec(chart={'kind':'scatter','bins':None}))
        wrong_kind=chart_payload(c,data,'histogram',skill=reference(scatter))
        assert c.post(prefix(doc)+'/preview',json=wrong_kind).json()['detail']['code']=='chart_skill_changed'
        assert c.get(prefix(doc)).json()=={'items':[]}


def test_custom_export_manifest_skill_json_and_style_override(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        skill=create_skill(c);data=upload(c,doc).json()
        chart=save(c,doc,chart_payload(c,data,'histogram',skill=reference(skill)))
        snapshot=chart['skill_snapshot'];data_bytes=c.get(chart['data_url']).content
        response=c.get(chart['export_url']);assert response.status_code==200,response.text
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names=archive.namelist();manifest=json.loads(archive.read('manifest.json'))
            assert len(names)==len(set(names)) and set(names)==set(manifest['files'])|{'manifest.json'}
            for name,entry in manifest['files'].items():
                raw=archive.read(name)
                assert len(raw)==entry['byte_size'] and hashlib.sha256(raw).hexdigest()==entry['sha256']
            assert {'skill.json','chart-styles.js'}<=set(names) and 'style.json' not in names
            assert json.loads(archive.read('skill.json'))==snapshot
            assert archive.read('chart.json')==data_bytes
            assert json.loads(archive.read('chart.json'))['skill_snapshot']==snapshot
            assert json.loads(archive.read('specification.json'))==chart['spec']
            assert json.loads(archive.read('provenance.json'))['skill_snapshot']==snapshot
            assert b'<script src="chart-styles.js"></script>' in archive.read('chart.html')
        override=c.get(chart['export_url']+'?style=nature')
        assert override.status_code==409 and override.json()['detail']['code']=='chart_skill_changed'
        offline=create_skill(c,spec(name='Online only',exports=['png','svg']))
        online_chart=save(c,doc,chart_payload(c,data,'histogram',skill=reference(offline)))
        refused=c.get(online_chart['export_url'])
        assert refused.status_code==409 and refused.json()['detail']['code']=='chart_skill_changed'


def test_legacy_chart_and_export_remain_byte_compatible(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();body=chart_payload(c,data,'histogram')
        first=c.post(prefix(doc),json=body);assert first.status_code==201
        chart=first.json();retry=c.post(prefix(doc),json=body)
        assert retry.status_code==200 and retry.json()==chart
        assert 'skill_snapshot' not in chart and 'skill_snapshot' not in json.loads(c.get(chart['data_url']).content)
        assert ChartCreate(**body).model_dump(mode='json')==body
        assert 'skill' not in ChartCreate(**body).model_dump(mode='json')
        with workspace(tmp_path/'skill') as (sc,_,sdoc,_):
            skill=create_skill(sc);assert 'skill' in ChartCreate(**chart_payload(sc,upload(sc,sdoc).json(),'histogram',
                skill=reference(skill))).model_dump(mode='json')
        with zipfile.ZipFile(io.BytesIO(c.get(chart['export_url']).content)) as archive:
            names=archive.namelist()
            assert 'skill.json' not in names and 'chart-styles.js' not in names and 'style.json' not in names
            assert json.loads(archive.read('specification.json'))==chart['spec']
        styled=c.get(chart['export_url']+'?style=nature');assert styled.status_code==200
        with zipfile.ZipFile(io.BytesIO(styled.content)) as archive:
            assert {'chart-styles.js','style.json'}<=set(archive.namelist())


def test_tampered_recipe_snapshot_is_rejected(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        skill=create_skill(c);data=upload(c,doc).json()
        chart=save(c,doc,chart_payload(c,data,'histogram',skill=reference(skill)))
        with app.state.store.connection() as db:
            stored=json.loads(db.execute('SELECT spec_json FROM charts WHERE id=?',(chart['id'],)).fetchone()['spec_json'])
            stored['skill_snapshot']['spec']['name']='Tampered recipe'
            db.execute('UPDATE charts SET spec_json=? WHERE id=?',(canonical(stored),chart['id']))
        damaged=c.get(chart['data_url'])
        assert damaged.status_code==409 and damaged.json()['detail']['code']=='chart_skill_changed'
        assert c.get(chart['export_url']).status_code==409

@pytest.mark.parametrize('revision',[1.0,True])
def test_artifact_snapshot_is_validated_before_equality(tmp_path,revision):
    with workspace(tmp_path) as (c,app,doc,_):
        skill=create_skill(c);data=upload(c,doc).json()
        chart=save(c,doc,chart_payload(c,data,'histogram',skill=reference(skill)))
        with app.state.store.connection() as db:
            artifact=json.loads(db.execute('SELECT data_bytes FROM charts WHERE id=?',(chart['id'],)).fetchone()['data_bytes'])
            assert artifact['skill_snapshot']==chart['skill_snapshot']
            artifact['skill_snapshot']['revision']=revision
            tampered=canonical(artifact).encode()
            db.execute('UPDATE charts SET data_bytes=?,data_sha256=? WHERE id=?',
                (tampered,hashlib.sha256(tampered).hexdigest(),chart['id']))
        rejected=c.get(chart['data_url'])
        assert rejected.status_code==409 and rejected.json()['detail']['code']=='chart_skill_changed'
        assert c.get(chart['export_url']).status_code==409

