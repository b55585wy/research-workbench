from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from uuid import uuid4
import pytest

from analysis_support import workspace
from import_support import FIXTURES,import_runtime,upload_import,confirm,confirmation


def test_pending_review_confirm_original_bytes_and_exact_replays(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        assert client.get('/api/v1/data-imports/status').json()['available'] is True
        request_id=str(uuid4());response=upload_import(client,doc,identifier=request_id)
        assert response.status_code==201,response.text
        imported=response.json();assert imported['status']=='pending' and imported['dataset_id'] is None
        assert client.get(f"/api/v1/documents/{doc['id']}/datasets").json()=={'items':[]}
        original=(FIXTURES/'synthetic.sav').read_bytes()
        assert client.get(imported['file_url']).content==original
        assert imported['sha256']==hashlib.sha256(original).hexdigest()
        assert upload_import(client,doc,identifier=request_id).json()==imported
        assert upload_import(client,doc,identifier=request_id,name='different.sav').status_code==409
        assert str(tmp_path) not in response.text and 'storage_key' not in response.text
        created=confirm(client,doc,imported);assert created.status_code==201,created.text
        dataset=created.json();assert dataset['import_provenance']['source_sha256']==imported['sha256']
        assert dataset['data_dictionary']==imported['review']['columns']
        assert client.get(dataset['file_url']).content.startswith(b'participant\tgroup\tscore\tvisit\tremark\n')
        repeated=confirm(client,doc,imported);assert repeated.status_code==200 and repeated.json()==dataset
        updated=client.get(f"/api/v1/documents/{doc['id']}/data-imports/{request_id}").json()
        assert updated['status']=='confirmed' and updated['dataset_id']==dataset['id']
        assert len(client.get(f"/api/v1/documents/{doc['id']}/datasets").json()['items'])==1
        assert list(app.state.store.incoming.iterdir())==[]


@pytest.mark.parametrize('body,name',[(b'','empty.sav'),(b'$FL2bad','broken.sav'),(b'value\n1\n','fake.sav'),(b'$FL3bad','broken.zsav'),(b'x','wrong.csv')])
def test_invalid_import_has_no_rows_or_artifacts(tmp_path,import_runtime,body,name):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        response=upload_import(client,doc,body,name);assert response.status_code==422,response.text
        assert client.get(f"/api/v1/documents/{doc['id']}/data-imports").json()=={'items':[]}
        assert list(app.state.data_imports.root.iterdir())==[] and list(app.state.store.incoming.iterdir())==[]


@pytest.mark.parametrize('changes',[{'acknowledge':False},{'acknowledge':1},{'acknowledge':'true'},{'source_sha256':'bad'},{'review_sha256':'bad'},{'unexpected':1}])
def test_confirmation_requires_explicit_ack_and_valid_shape(tmp_path,import_runtime,changes):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json()
        assert confirm(client,doc,imported,**changes).status_code==422
        assert not app.state.datasets.list(doc['id'])


@pytest.mark.parametrize('field',['source_sha256','review_sha256'])
def test_stale_confirmation_rejected(tmp_path,import_runtime,field):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json()
        assert confirm(client,doc,imported,**{field:'0'*64}).status_code==409
        assert not app.state.datasets.list(doc['id'])


@pytest.mark.parametrize('artifact',['source','tsv','review'])
def test_changed_original_normalized_or_dictionary_never_confirms(tmp_path,import_runtime,artifact):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json()
        if artifact=='review':
            with app.state.store.connection() as db:db.execute("UPDATE data_imports SET review_json='{}'")
        else:next(app.state.data_imports.root.glob('*.'+artifact)).write_bytes(b'changed')
        assert confirm(client,doc,imported).status_code==409
        assert not app.state.datasets.list(doc['id'])


def test_concurrent_confirmation_creates_one_dataset(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json()
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:confirm(client,doc,imported),range(2)))
        assert sorted(response.status_code for response in responses)==[200,201]
        assert responses[0].json()==responses[1].json()
        assert len(app.state.datasets.list(doc['id']))==1 and len(list(app.state.datasets.root.iterdir()))==1


def test_scope_acknowledgment_and_missing_ids(tmp_path,import_runtime):
    with workspace(tmp_path,import_root=import_runtime) as (client,_,doc,_):
        imported=upload_import(client,doc).json();other=str(uuid4())
        base=f"/api/v1/documents/{other}/data-imports/{imported['id']}"
        assert client.get(base).status_code==404
        assert client.get(base+'/file').status_code==404
        assert client.post(base+'/confirm',json=confirmation(imported)).status_code==404
        value=confirmation(imported);value.pop('acknowledge')
        assert client.post(f"/api/v1/documents/{doc['id']}/data-imports/{imported['id']}/confirm",json=value).status_code==422


@pytest.mark.parametrize('body_size,expected',[(5*1024*1024,201),(5*1024*1024+1,413)])
def test_source_byte_limit(tmp_path,import_runtime,body_size,expected):
    body=(FIXTURES/'synthetic.sav').read_bytes();body+=b'\0'*(body_size-len(body))
    with workspace(tmp_path,import_root=import_runtime) as (client,_,doc,_):
        result=upload_import(client,doc,body);assert result.status_code==expected,result.text


def test_runtime_absent_and_real_parser_faults_keep_health_alive(tmp_path,import_runtime):
    with workspace(tmp_path/'missing',import_root=tmp_path/'absent') as (client,app,doc,_):
        assert not client.get('/api/v1/data-imports/status').json()['available']
        assert upload_import(client,doc).status_code==503
        assert list(app.state.data_imports.root.iterdir())==[]
    for name,source,timeout in [('crash','raise SystemExit(7)',2),('timeout','import time;time.sleep(10)',.05)]:
        with workspace(tmp_path/name,import_root=import_runtime) as (client,app,doc,_):
            probe=tmp_path/(name+'.py');probe.write_text(source)
            app.state.data_imports.probe=probe;app.state.data_imports.timeout=timeout
            response=upload_import(client,doc)
            assert response.status_code==422
            assert response.json()['detail']['code']==('parser_failed' if name=='crash' else 'parser_timeout')
            assert client.get('/api/v1/health').status_code==200
            assert list(app.state.data_imports.root.iterdir())==[] and list(app.state.store.incoming.iterdir())==[]


def test_permission_failure_rolls_back_confirmation(tmp_path,import_runtime,monkeypatch):
    with workspace(tmp_path,import_root=import_runtime) as (client,app,doc,_):
        imported=upload_import(client,doc).json()
        def denied(*args,**kwargs):raise PermissionError('private path should not leak')
        monkeypatch.setattr('research_workbench.data_imports.shutil.copyfile',denied)
        response=confirm(client,doc,imported)
        assert response.status_code==503 and 'private path' not in response.text
        assert not app.state.datasets.list(doc['id']) and list(app.state.datasets.root.iterdir())==[]
        assert app.state.data_imports.get(doc['id'],imported['id'])['status']=='pending'
