from concurrent.futures import ThreadPoolExecutor
import hashlib

from fastapi.testclient import TestClient
import pytest

from conftest import make_pdf
from research_workbench.main import create_app
from test_library import update
from test_excerpts import add_region


def upload(client,pdf,name='paper.pdf',deduplicate=True):
    return client.post('/api/v1/documents',data={'deduplicate':str(deduplicate).lower()},
        files={'file':(name,pdf,'application/pdf')})


def test_opted_in_duplicates_keep_notes_metadata_source_and_original_name(client,app,document,pdf):
    note=add_region(client,document)
    update(client,document,title='User corrected title',authors='王某')
    result=upload(client,pdf,'another-name.pdf')
    assert result.status_code==200 and result.json()=={**document,'title':'User corrected title'}
    assert client.get(f"/api/v1/documents/{document['id']}/notes").json()['items']==[note]
    assert len(list(app.state.store.files.glob('*.pdf')))==1
    assert list(app.state.store.incoming.iterdir())==[]
    assert (app.state.store.files/f"{document['id']}.pdf").read_bytes()==pdf


def test_new_import_and_uncertain_retry_reuse_the_same_record(client,app,pdf):
    first=upload(client,pdf)
    assert first.status_code==201
    repeated=upload(client,pdf)
    assert repeated.status_code==200 and repeated.json()==first.json()
    assert len(client.get('/api/v1/documents').json()['items'])==1
    assert len(list(app.state.store.files.glob('*.pdf')))==1


def test_same_filename_different_bytes_and_legacy_duplicates_stay_distinct(client,document,pdf):
    different=upload(client,make_pdf(1),'synthetic.pdf')
    assert different.status_code==201 and different.json()['id']!=document['id']
    legacy=upload(client,pdf,'synthetic.pdf',deduplicate=False)
    assert legacy.status_code==201 and legacy.json()['id']!=document['id']
    assert upload(client,pdf).json()['id']==document['id']
    assert len(client.get('/api/v1/documents').json()['items'])==3


def test_concurrent_opted_in_uploads_commit_one_record_and_one_source(tmp_path,pdf):
    app=create_app(tmp_path/'workspace',validator=lambda path:2)
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',48000)) as client:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:upload(client,pdf),range(2)))
        assert sorted(r.status_code for r in results)==[200,201]
        assert results[0].json()==results[1].json()
        assert len(client.get('/api/v1/documents').json()['items'])==1
        assert len(list(app.state.store.files.glob('*.pdf')))==1
        assert list(app.state.store.incoming.iterdir())==[]


@pytest.mark.parametrize('corrupt',[False,True])
def test_missing_or_corrupt_existing_source_is_not_false_duplicate_success(client,app,document,pdf,corrupt):
    source=app.state.store.files/f"{document['id']}.pdf"
    if corrupt:source.write_bytes(b'corrupted')
    else:source.unlink()
    response=upload(client,pdf)
    assert response.status_code==409
    assert response.json()['detail']['code']==('source_changed' if corrupt else 'file_missing')
    assert len(client.get('/api/v1/documents').json()['items'])==1
    assert list(app.state.store.incoming.iterdir())==[]


@pytest.mark.parametrize('data,code',[(b'not a pdf','invalid_pdf'),(make_pdf(1,True),'encrypted_pdf'),(make_pdf(0),'invalid_pdf')])
def test_invalid_opted_in_uploads_leave_no_records_or_files(client,app,data,code):
    response=upload(client,data)
    assert response.status_code==422 and response.json()['detail']['code']==code
    assert client.get('/api/v1/documents').json()['items']==[]
    assert list(app.state.store.files.iterdir())==list(app.state.store.incoming.iterdir())==[]


def test_opted_in_storage_failure_leaves_original_document_unchanged(client,app,document,monkeypatch):
    def fail(*args,**kwargs):raise PermissionError('simulated permission failure')
    monkeypatch.setattr(app.state.store,'add_document',fail)
    response=upload(client,make_pdf(1))
    assert response.status_code==503
    assert client.get('/api/v1/documents').json()['items']==[document]
    assert len(list(app.state.store.files.glob('*.pdf')))==1
    assert list(app.state.store.incoming.iterdir())==[]
