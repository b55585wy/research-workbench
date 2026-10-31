from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sqlite3
from uuid import uuid4
import pytest

from analysis_support import CSV,workspace,upload
from research_workbench.models import WorkspaceError
from research_workbench.tabular import parse


@pytest.mark.parametrize('name,body',[('unicode.csv','\ufeff温度,备注\r\n1,中国\r\n,NA\r\n2,<script>x</script>\r\n'.encode('utf-8')),('unicode.tsv','温度\t备注\n1\t中国\n\tNA\n2\t<script>x</script>\n'.encode())])
def test_unicode_bom_missing_literal_and_original_bytes(tmp_path,name,body):
    with workspace(tmp_path) as (c,app,doc,_):
        response=upload(c,doc,body,name);assert response.status_code==201,response.text
        data=response.json();assert data['row_count']==3 and data['column_count']==2
        assert data['columns']==[{'name':'温度','numeric':True,'nonempty':2,'missing':1},{'name':'备注','numeric':False,'nonempty':3,'missing':0}]
        assert data['sha256']==hashlib.sha256(body).hexdigest()
        assert c.get(data['file_url']).content==body
        assert data['preview'][2][1]=='<script>x</script>'
        assert 'storage_key' not in data and str(tmp_path) not in response.text


@pytest.mark.parametrize('body',[b'',b'a\n',b'\n1\n',b'a,a\n1,2\n',b'a,b\n1\n',b'a,b\n1,2,3\n',b'a\n"unterminated',b'a\n\xff\n',b'a\nNaN\n',b'a\nInfinity\n',b'a\n1e999\n',b'a\x00\n1\n',b'a\nhi\x00\n'])
def test_invalid_inputs_leave_no_rows_or_files(tmp_path,body):
    with workspace(tmp_path) as (c,app,doc,_):
        response=upload(c,doc,body);assert response.status_code==422,response.text
        assert c.get(f"/api/v1/documents/{doc['id']}/datasets").json()['items']==[]
        assert list(app.state.datasets.root.iterdir())==[] and list(app.state.store.incoming.iterdir())==[]


@pytest.mark.parametrize('length,expected',[(100,201),(101,422)])
def test_header_length(tmp_path,length,expected):
    with workspace(tmp_path) as (c,_,doc,_):assert upload(c,doc,('a'*length+'\n1\n').encode()).status_code==expected


@pytest.mark.parametrize('count,expected',[(50,201),(51,422)])
def test_column_limit(tmp_path,count,expected):
    body=(','.join('c'+str(i) for i in range(count))+'\n'+','.join('1' for _ in range(count))+'\n').encode()
    with workspace(tmp_path) as (c,_,doc,_):assert upload(c,doc,body).status_code==expected


@pytest.mark.parametrize('count,expected',[(50000,201),(50001,422)])
def test_row_limit(tmp_path,count,expected):
    with workspace(tmp_path) as (c,_,doc,_):assert upload(c,doc,b'n\n'+b'1\n'*count).status_code==expected


@pytest.mark.parametrize('count,expected',[(2048,201),(2049,422)])
def test_cell_limit(tmp_path,count,expected):
    with workspace(tmp_path) as (c,_,doc,_):assert upload(c,doc,b'text\n'+b'x'*count+b'\n').status_code==expected


@pytest.mark.parametrize('extra,expected',[(0,201),(1,413)])
def test_exact_upload_byte_limit(tmp_path,extra,expected):
    maximum=5*1024*1024;header=b'n,t\n';unit=b'1,'+b'x'*1000+b'\n'
    count,remainder=divmod(maximum-len(header),len(unit))
    if remainder<3:count-=1;remainder+=len(unit)
    body=header+unit*count+b'1,'+b'x'*(remainder-3)+b'\n'+b'x'*extra
    assert len(body)==maximum+extra
    with workspace(tmp_path) as (c,_,doc,_):assert upload(c,doc,body).status_code==expected


def test_exact_retry_conflict_and_concurrent_upload_once(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        identifier=str(uuid4())
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:upload(c,doc,identifier=identifier),range(2)))
        assert sorted(r.status_code for r in responses)==[200,201]
        assert responses[0].json()==responses[1].json()
        assert upload(c,doc,identifier=identifier,name='changed.csv').status_code==409
        assert upload(c,doc,b'value\n5\n',identifier=identifier).status_code==409
        assert len(list(app.state.datasets.root.iterdir()))==1


def test_cross_paper_scope_and_tampered_original(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();fake=str(uuid4())
        assert c.get(f"/api/v1/documents/{fake}/datasets/{data['id']}").status_code==404
        assert c.get(f"/api/v1/documents/{fake}/datasets/{data['id']}/file").status_code==404
        app.state.datasets.path(doc['id'],data['id']).write_bytes(b'changed')
        assert c.get(data['file_url']).status_code==409
        assert upload(c,doc,identifier=data['id']).status_code==409


def test_dataset_count_quota(tmp_path):
    with workspace(tmp_path) as (c,_,doc,_):
        for _ in range(20):assert upload(c,doc).status_code==201
        assert upload(c,doc).status_code==409


@pytest.mark.parametrize('code,timeout,expected',[('raise SystemExit(9)',1,'parser_failed'),('import time;time.sleep(10)',.1,'parser_timeout')])
def test_actual_parser_crash_and_timeout_keep_app_alive(tmp_path,code,timeout,expected):
    with workspace(tmp_path/'data') as (c,app,doc,_):
        probe=tmp_path/'fault.py';probe.write_text(code);app.state.datasets.probe=probe;app.state.datasets.timeout=timeout
        response=upload(c,doc);assert response.status_code==422 and response.json()['detail']['code']==expected
        assert c.get('/api/v1/health').status_code==200
        assert list(app.state.datasets.root.iterdir())==[]


def test_storage_failure_rolls_back_and_closes_upload(tmp_path,monkeypatch):
    with workspace(tmp_path) as (c,app,doc,_):
        original=Path.replace
        def denied(path,target):
            if str(target).startswith(str(app.state.datasets.root)):raise PermissionError('private path must not leak')
            return original(path,target)
        monkeypatch.setattr(Path,'replace',denied)
        response=upload(c,doc);assert response.status_code==503 and 'private path' not in response.text
        assert list(app.state.datasets.root.iterdir())==[] and list(app.state.store.incoming.iterdir())==[]
