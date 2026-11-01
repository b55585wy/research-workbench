import io,json,sqlite3,zipfile
from pathlib import Path
from uuid import uuid4
import pytest
from study_support import workspace,anchor,note
from analysis_support import upload,run,payload,wait,R_PATH
from chart_support import payload as chart_payload,prefix as chart_prefix
from record_support import preview,verified
from conftest import make_pdf
from import_support import import_runtime,upload_import,confirm as confirm_import,FIXTURES


def test_creation_retry_identity_and_zero_pdf(tmp_path):
    with workspace(tmp_path) as (c,app,owner,_):
        assert owner['kind']=='study' and owner['page_count'] is None and owner['original_filename'] is None and owner['byte_size'] is None
        assert c.get('/api/v1/documents').json()['items']==[] and not list(app.state.store.files.glob('*.pdf'))
        body={'request_id':owner['id'],'name':owner['name'],'question':owner['question']}
        assert c.post('/api/v1/studies',json=body).status_code==200
        assert c.post('/api/v1/studies',json={**body,'question':'Changed'}).status_code==409
        assert c.get('/api/v1/studies').json()['items']==[owner]
        assert c.get('/api/v1/documents/'+owner['id']).json()==owner
        assert c.get('/api/v1/documents/'+owner['id']+'/file').json()['detail']['code']=='source_has_no_pdf'
        assert len(owner['scope_sha256'])==64


@pytest.mark.parametrize('change',[{'name':''},{'name':' '},{'name':'x'*181},{'question':''},{'question':'x'*4001},{'question':'bad\x00'},{'question':4},{'request_id':'bad'},{'extra':1}])
def test_invalid_create_has_no_extra_owner(tmp_path,change):
    with workspace(tmp_path) as (c,app,owner,_):
        body={'request_id':str(uuid4()),'name':'Study','question':'Question'}
        assert c.post('/api/v1/studies',json={**body,**change}).status_code==422
        assert len(c.get('/api/v1/studies').json()['items'])==1


@pytest.mark.parametrize('engine',['python','r'])
def test_actual_supervised_analysis_chart_note_and_pdf_free_export(tmp_path,engine):
    if engine=='r' and R_PATH is None:pytest.skip('Set R runtime')
    with workspace(tmp_path,worker=True) as (c,app,owner,_):
        data=upload(c,owner).json()
        response=c.post(f"/api/v1/documents/{owner['id']}/analyses",json=payload(data,engine));assert response.status_code==201,response.text
        job=wait(c,owner,response.json()['id']);assert job['status']=='succeeded',job['error']
        response=c.post(chart_prefix(owner),json=chart_payload(c,data));assert response.status_code==201,response.text
        graph=response.json()
        summary=next(o for o in job['outputs'] if o['name']=='summary.json')
        saved=note(c,owner,anchor(owner,'analysis',job['id'],summary['sha256']));assert saved.status_code==201,saved.text
        assert saved.json()['page'] is None and saved.json()['source']['id']==job['id']
        plan=preview(c,owner,data,analysis_id=job['id'],chart_id=graph['id'])
        archive=verified(c.get(plan['download_url']))
        assert 'study.json' in archive.namelist() and not any(p.endswith('.pdf') for p in archive.namelist())
        assert 'source.pdf' not in archive.read('index.html').decode()
        assert json.loads(archive.read('study.json'))['question']==owner['question']
        assert json.loads(archive.read('reading/notes.json'))['notes'][0]['source']['id']==job['id']
        assert not list(app.state.store.files.glob('*.pdf'))


def test_paper_association_unlink_and_frozen_record(tmp_path):
    with workspace(tmp_path) as (c,app,owner,_):
        data=upload(c,owner).json();plan=preview(c,owner,data)
        paper=c.post('/api/v1/documents',files={'file':('real.pdf',make_pdf(),'application/pdf')}).json()
        prefix='/api/v1/studies/'+owner['id']+'/papers';body={'document_id':paper['id'],'sha256':paper['sha256']}
        assert c.post(prefix,json=body).status_code==201 and c.post(prefix,json=body).status_code==200
        assert c.get(plan['download_url']).status_code==409
        fresh=preview(c,owner,data);archive=verified(c.get(fresh['download_url']))
        assert archive.read('papers/'+paper['id']+'/source.pdf')==make_pdf()
        assert c.delete(prefix+'/'+paper['id'],params={'sha256':paper['sha256']}).json()['removed']
        assert c.get('/api/v1/documents/'+paper['id']+'/file').status_code==200
        assert c.get('/api/v1/studies/'+owner['id']+'/papers').json()['items']==[]


def test_cross_owner_sources_and_invalid_page_rejected(tmp_path):
    with workspace(tmp_path) as (c,app,owner,_):
        other=c.post('/api/v1/studies',json={'request_id':str(uuid4()),'name':'Other','question':'Other question'}).json()
        data=upload(c,other).json()
        assert note(c,owner,anchor(owner,'dataset',data['id'],data['sha256'])).status_code==404
        assert note(c,owner,anchor(owner,checksum='a'*64)).status_code==409
        bad={'request_id':str(uuid4()),'page':1,'rect':None,'text':'Not PDF','source':anchor(owner)}
        assert c.post(f"/api/v1/documents/{owner['id']}/notes",json=bad).status_code==422


@pytest.mark.parametrize('name',['synthetic.sav','synthetic.zsav'])
def test_study_spss_review_confirm_and_original_bytes(tmp_path,import_runtime,name):
    with workspace(tmp_path) as (c,app,owner,_):
        raw=(FIXTURES/name).read_bytes()
        response=upload_import(c,owner,raw,name);assert response.status_code==201,response.text
        pending=response.json();assert pending['dataset_id'] is None
        assert c.get(pending['file_url']).content==raw
        response=confirm_import(c,owner,pending);assert response.status_code==201,response.text
        data=response.json();assert data['data_dictionary']==pending['review']['columns']
        assert confirm_import(c,owner,pending).json()==data
        saved=note(c,owner,anchor(owner,'dataset',data['id'],data['sha256']))
        assert saved.status_code==201 and saved.json()['page'] is None
        assert not list(app.state.store.files.glob('*.pdf'))


def test_study_note_anchor_failure_rolls_back_note_and_receipt(tmp_path):
    with workspace(tmp_path) as (c,app,owner,_):
        with app.state.store.connection() as db:
            db.execute("CREATE TRIGGER reject_anchor BEFORE INSERT ON study_note_sources BEGIN SELECT RAISE(ABORT,'stop'); END")
        assert note(c,owner).status_code==503
        with app.state.store.connection() as db:
            assert db.execute('SELECT COUNT(*) FROM notes').fetchone()[0]==0
            assert db.execute('SELECT COUNT(*) FROM note_states').fetchone()[0]==0
            assert db.execute('SELECT COUNT(*) FROM study_note_sources').fetchone()[0]==0
