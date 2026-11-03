import hashlib
import json
from pathlib import Path
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
from uuid import uuid4

from .models import WorkspaceError
from .store import timestamp
from .tabular import MAX_BYTES


class Datasets:
    def __init__(self,store,timeout=8,probe=None):
        self.store=store
        self.root=store.root/'datasets';self.root.mkdir(exist_ok=True)
        self.timeout=timeout
        self.probe=probe or Path(__file__).with_name('tabular.py')
        self.capacity=threading.BoundedSemaphore(2)

    def record(self,row):
        value=dict(row)
        profile=json.loads(value.pop('profile_json'));value.pop('storage_key');value.pop('delimiter')
        value.update(profile)
        value['file_url']=f"/api/v1/documents/{value['document_id']}/datasets/{value['id']}/file"
        return value

    @staticmethod
    def for_agent(value):
        if 'data_dictionary' not in value:return value
        result={key:item for key,item in value.items() if key!='data_dictionary'}
        summary=[]
        for field in value['data_dictionary']:
            item={key:field[key] for key in ('name','source_type','measure','format','system_missing','user_missing','blank_missing','nonmissing')}
            item['label']=field['label'][:160]
            item['value_labels']=[{'value':label['value'],'label':label['label'][:80]} for label in field['value_labels'][:3]]
            item['missing_ranges']=field['missing_ranges']
            if len(json.dumps(summary+[item],ensure_ascii=True).encode())>16384:break
            summary.append(item)
        result['data_dictionary_summary']=summary
        result['data_dictionary_truncated']=len(summary)<len(value['data_dictionary']) or any(len(field['value_labels'])>3 or len(field['label'])>160 or any(len(label['label'])>80 for label in field['value_labels']) for field in value['data_dictionary'])
        return result

    @staticmethod
    def row(connection,document_id,identifier):
        value=connection.execute('SELECT * FROM datasets WHERE id=? AND document_id=?',(identifier,document_id)).fetchone()
        if value is None:raise WorkspaceError('not_found','找不到这份表格数据。',404)
        return value

    def list(self,document_id):
        self.store.get_document(document_id)
        with self.store.connection() as connection:
            return [self.record(r) for r in connection.execute('SELECT * FROM datasets WHERE document_id=? ORDER BY rowid DESC',(document_id,))]

    def get(self,document_id,identifier):
        with self.store.connection() as connection:return self.record(self.row(connection,document_id,identifier))

    def checked(self,row,seen=None):
        selections=getattr(self,'selections',None)
        if selections is not None:
            derived=selections.check_dataset(row,seen)
            if derived is not None:return derived
        path=self.root/(row['storage_key']+'.data')
        try:
            if path.stat().st_size==row['byte_size'] and hashlib.sha256(path.read_bytes()).hexdigest()==row['sha256']:
                profile=json.loads(row['profile_json'])
                if profile.get('import_provenance'):self.imports.check_dataset(row,profile)
                return path
        except FileNotFoundError:pass
        raise WorkspaceError('dataset_changed','数据文件缺失或已改变，请重新上传。',409)

    def path(self,document_id,identifier):
        with self.store.connection() as connection:return self.checked(self.row(connection,document_id,identifier))

    def profile(self,path,delimiter):
        if not self.capacity.acquire(False):raise WorkspaceError('parser_busy','正在检查其他数据，请稍后重试。',429)
        try:
            done=subprocess.run([getattr(sys,'_base_executable',sys.executable),'-I','-S',str(self.probe),str(path),delimiter],
                capture_output=True,timeout=self.timeout,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            value=json.loads(done.stdout)
            if done.returncode==2 and 'error' in value:
                raise WorkspaceError('invalid_dataset','请上传格式完整的 UTF-8 CSV/TSV，表头唯一，数据行列数一致且数值有限。',422)
            if done.returncode or not isinstance(value.get('columns'),list) or not 1<=value.get('row_count',0)<=50000:
                raise ValueError()
            return value
        except subprocess.TimeoutExpired:
            raise WorkspaceError('parser_timeout','表格检查超时，请缩小文件后重试。',422) from None
        except (ValueError,TypeError):
            raise WorkspaceError('parser_failed','表格解析进程未能完成，请检查文件后重试。',422) from None
        finally:self.capacity.release()

    @staticmethod
    def same(row,document_id,name,checksum,size):
        if (row['document_id'],row['original_filename'],row['sha256'],row['byte_size'])!=(document_id,name,checksum,size):
            raise WorkspaceError('idempotency_conflict','上传编号已用于其他数据，请检查原请求。',409)

    def upload(self,document_id,identifier,upload):
        from .library import read_metadata
        self.store.get_document(document_id)
        name=re.split(r'[/\\]',upload.filename or '')[-1]
        name=''.join(c for c in name if ord(c)>=32 and ord(c)!=127)[:180]
        suffix=Path(name).suffix.lower()
        if suffix not in ('.csv','.tsv'):
            upload.file.close();raise WorkspaceError('invalid_dataset','请选择 CSV 或 TSV 文件。',422)
        delimiter='\t' if suffix=='.tsv' else ','
        storage=str(uuid4());target=self.root/(storage+'.data');temporary=None;committed=False
        try:
            with tempfile.NamedTemporaryFile(dir=self.store.incoming,suffix='.table',delete=False) as out:
                temporary=Path(out.name);size=0;checksum=hashlib.sha256()
                while chunk:=upload.file.read(65536):
                    size+=len(chunk)
                    if size>MAX_BYTES:raise WorkspaceError('dataset_too_large','表格最大支持 5 MiB。',413)
                    out.write(chunk);checksum.update(chunk)
            checksum=checksum.hexdigest()
            with self.store.connection() as connection:
                old=connection.execute('SELECT * FROM datasets WHERE id=?',(identifier,)).fetchone()
                if old is not None:
                    self.same(old,document_id,name,checksum,size);self.checked(old)
                    return self.record(old),False
            profile=self.profile(temporary,delimiter)
            temporary.replace(target)
            with self.store.connection() as connection:
                connection.execute('BEGIN IMMEDIATE')
                read_metadata(connection,document_id)
                old=connection.execute('SELECT * FROM datasets WHERE id=?',(identifier,)).fetchone()
                if old is not None:
                    self.same(old,document_id,name,checksum,size);self.checked(old)
                    return self.record(old),False
                total=connection.execute('SELECT COUNT(*),COALESCE(SUM(byte_size),0) FROM datasets WHERE document_id=?',(document_id,)).fetchone()
                if total[0]>=20 or total[1]+size>100*1024*1024:
                    raise WorkspaceError('dataset_quota','这篇文献的数据存储已达上限。',409)
                connection.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?,?,?,?)',
                    (identifier,document_id,storage,name,checksum,size,delimiter,json.dumps(profile,ensure_ascii=True),timestamp()))
                result=self.record(self.row(connection,document_id,identifier))
            committed=True
            return result,True
        finally:
            upload.file.close()
            if temporary is not None:temporary.unlink(missing_ok=True)
            if not committed:target.unlink(missing_ok=True)
