"""Immutable SPSS sources and explicitly reviewed analysis-table creation."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from uuid import uuid4

from .import_runtime import ADAPTER,ImportRuntime,environment
from .models import WorkspaceError
from .store import timestamp

MAX_BYTES=5*1024*1024


def canonical(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(data):return hashlib.sha256(data).hexdigest()


def copy_source(upload,target):
    size=0;checksum=hashlib.sha256()
    with target.open('wb') as stream:
        while chunk:=upload.file.read(65536):
            size+=len(chunk)
            if size>MAX_BYTES:raise WorkspaceError('dataset_too_large','原文件最大支持 5 MiB。',413)
            stream.write(chunk);checksum.update(chunk)
    return size,checksum.hexdigest()


def profile_for_review(datasets,path,review):
    profile=datasets.profile(path,'\t')
    if [field['name'] for field in review['columns']]!=[field['name'] for field in profile['columns']]:raise ValueError()
    for column,field in zip(profile['columns'],review['columns']):column['numeric']=column['numeric'] and field['numeric']
    return profile


class DataImports:
    def __init__(self,store,datasets,runtime_root=None,timeout=12,probe=None):
        self.store,self.datasets=store,datasets
        self.root=store.root/'data-imports';self.root.mkdir(exist_ok=True)
        self.runtime=ImportRuntime(runtime_root)
        self.timeout=timeout;self.probe=probe or Path(__file__).with_name('spss_probe.py')
        self.capacity=threading.BoundedSemaphore(2)

    @staticmethod
    def row(connection,document_id,identifier):
        row=connection.execute('SELECT * FROM data_imports WHERE id=? AND document_id=?',(identifier,document_id)).fetchone()
        if row is None:raise WorkspaceError('not_found','找不到这份导入记录。',404)
        return row

    def record(self,row):
        return {key:row[key] for key in ('id','document_id','original_filename','byte_size','sha256','created_at','dataset_id','review_sha256')}|{
            'status':'confirmed' if row['dataset_id'] else 'pending','review':json.loads(row['review_json']),
            'file_url':f"/api/v1/documents/{row['document_id']}/data-imports/{row['id']}/file"}

    def list(self,document_id):
        self.store.get_document(document_id)
        with self.store.connection() as connection:
            return [self.record(row) for row in connection.execute('SELECT * FROM data_imports WHERE document_id=? ORDER BY rowid DESC',(document_id,))]

    def get(self,document_id,identifier):
        with self.store.connection() as connection:return self.record(self.row(connection,document_id,identifier))

    def checked(self,row):
        source=self.root/(row['storage_key']+'.source');normalized=self.root/(row['storage_key']+'.tsv')
        try:
            valid=source.stat().st_size==row['byte_size'] and normalized.stat().st_size==row['normalized_size']
            valid=valid and digest(source.read_bytes())==row['sha256'] and digest(normalized.read_bytes())==row['normalized_sha256']
            valid=valid and digest(canonical(json.loads(row['review_json'])).encode())==row['review_sha256']
            if valid:return source,normalized
        except (FileNotFoundError,ValueError,TypeError):pass
        raise WorkspaceError('import_changed','导入原文件、转换表或字段规则已改变，请重新导入。',409)

    def path(self,document_id,identifier):
        with self.store.connection() as connection:return self.checked(self.row(connection,document_id,identifier))[0]

    def provenance(self,row,review):
        return {'import_id':row['id'],'source_filename':row['original_filename'],'source_sha256':row['sha256'],
                'review_sha256':row['review_sha256'],'normalized_sha256':row['normalized_sha256'],
                'original_file_url':self.record(row)['file_url'],'reader':review['reader'],'policy':review['policy']}

    def check_dataset(self,dataset_row,profile):
        with self.store.connection() as connection:
            row=self.row(connection,dataset_row['document_id'],profile['import_provenance']['import_id'])
        self.checked(row);review=json.loads(row['review_json'])
        if row['dataset_id']!=dataset_row['id'] or row['normalized_sha256']!=dataset_row['sha256'] or profile['data_dictionary']!=review['columns'] or profile['import_provenance']!=self.provenance(row,review):
            raise WorkspaceError('import_changed','导入来源、字典或转换记录与分析表不一致。',409)

    def parse(self,source,normalized):
        if self.runtime.python is None:raise WorkspaceError('import_unavailable','SPSS 文件读取部件尚未就绪。',503)
        if not self.capacity.acquire(False):raise WorkspaceError('parser_busy','正在检查其他数据，请稍后重试。',429)
        try:
            command=[str(self.runtime.python),'-I',str(self.probe),str(source),str(normalized)]
            done=subprocess.run(command,capture_output=True,timeout=self.timeout,env=environment(),
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            if len(done.stdout)>2*1024*1024:raise ValueError()
            value=json.loads(done.stdout)
            if done.returncode==2 and value.get('error'):
                raise WorkspaceError('invalid_spss','无法读取这份 SPSS 文件，或文件超过行列、字段或展开大小限制。',422)
            if done.returncode or not isinstance(value.get('review'),dict):raise ValueError()
            content=normalized.read_bytes()
            if not 0<len(content)<=MAX_BYTES or digest(content)!=value['normalized_sha256'] or len(content)!=value['normalized_size']:raise ValueError()
            profile=profile_for_review(self.datasets,normalized,value['review'])
            if profile!=value['profile']:raise ValueError()
            value['review']['reader']['adapter']=ADAPTER
            value['review']['reader']['adapter_sha256']=digest(self.probe.read_bytes())
            return value
        except subprocess.TimeoutExpired:
            raise WorkspaceError('parser_timeout','SPSS 文件检查超时，请缩小文件后重试。',422) from None
        except (ValueError,KeyError,TypeError,FileNotFoundError):
            raise WorkspaceError('parser_failed','SPSS 解析进程未能完成，请检查文件后重试。',422) from None
        finally:self.capacity.release()

    @staticmethod
    def same(row,document_id,name,checksum,size):
        if (row['document_id'],row['original_filename'],row['sha256'],row['byte_size'])!=(document_id,name,checksum,size):
            raise WorkspaceError('idempotency_conflict','导入编号已用于其他数据，请使用原请求重试。',409)

    def upload(self,document_id,identifier,upload):
        try:return self._upload(document_id,identifier,upload)
        finally:upload.file.close()

    def _upload(self,document_id,identifier,upload):
        self.store.get_document(document_id)
        name=re.split(r'[/\\]',upload.filename or '')[-1]
        name=''.join(char for char in name if ord(char)>=32 and ord(char)!=127)[:180]
        if Path(name).suffix.lower() not in ('.sav','.zsav'):raise WorkspaceError('invalid_spss','请选择 .sav 或 .zsav 文件。',422)
        with tempfile.TemporaryDirectory(dir=self.store.incoming) as temporary:
            source=Path(temporary)/'source.sav';normalized=Path(temporary)/'normalized.tsv'
            size,checksum=copy_source(upload,source)
            return self._stage_upload(document_id,identifier,name,checksum,size,source,normalized)

    def _stage_upload(self,document_id,identifier,name,checksum,size,source,normalized):
        with self.store.connection() as connection:old=connection.execute('SELECT * FROM data_imports WHERE id=?',(identifier,)).fetchone()
        if old is not None:
            self.same(old,document_id,name,checksum,size);self.checked(old)
            return self.record(old),False
        parsed=self.parse(source,normalized);key=str(uuid4());review=canonical(parsed['review'])
        data={'id':identifier,'document_id':document_id,'storage_key':key,'original_filename':name,
              'sha256':checksum,'byte_size':size,'normalized_sha256':parsed['normalized_sha256'],
              'normalized_size':parsed['normalized_size'],'review_sha256':digest(review.encode()),
              'review_json':review,'profile_json':canonical(parsed['profile']),'dataset_id':None,'created_at':timestamp()}
        source_target=self.root/(key+'.source');normalized_target=self.root/(key+'.tsv');committed=False
        try:
            source.replace(source_target);normalized.replace(normalized_target)
            result,created=self._insert_review(data)
            committed=created
            return result,created
        finally:
            if not committed:source_target.unlink(missing_ok=True);normalized_target.unlink(missing_ok=True)

    def _insert_review(self,data):
        with self.store.connection() as connection:return self._insert_review_in(connection,data)

    def _insert_review_in(self,connection,data):
        connection.execute('BEGIN IMMEDIATE')
        old=connection.execute('SELECT * FROM data_imports WHERE id=?',(data['id'],)).fetchone()
        if old is not None:
            self.same(old,data['document_id'],data['original_filename'],data['sha256'],data['byte_size']);self.checked(old)
            return self.record(old),False
        total=connection.execute('SELECT COUNT(*),COALESCE(SUM(byte_size+normalized_size),0) FROM data_imports WHERE document_id=?',(data['document_id'],)).fetchone()
        if total[0]>=20 or total[1]+data['byte_size']+data['normalized_size']>100*1024*1024:raise WorkspaceError('import_quota','这篇文献的导入存储已达上限。',409)
        names=','.join(data);parameters=','.join(':'+name for name in data)
        connection.execute(f'INSERT INTO data_imports ({names}) VALUES ({parameters})',data)
        return self.record(self.row(connection,data['document_id'],data['id'])),True

    def confirm(self,document_id,identifier,payload):
        with self.store.connection() as connection:row=self.row(connection,document_id,identifier)
        _,normalized=self.checked(row)
        if row['sha256']!=payload.source_sha256 or row['review_sha256']!=payload.review_sha256:
            raise WorkspaceError('import_changed','导入文件或字段确认已过期，请重新核对。',409)
        if row['dataset_id']:
            self.datasets.path(document_id,row['dataset_id'])
            return self.datasets.get(document_id,row['dataset_id']),False
        review=json.loads(row['review_json']);profile=profile_for_review(self.datasets,normalized,review)
        if profile!=json.loads(row['profile_json']):raise WorkspaceError('import_changed','导入预览已改变，请重新导入。',409)
        provenance=self.provenance(row,review)
        profile.update({'data_dictionary':review['columns'],'import_provenance':provenance})
        dataset_id,key=str(uuid4()),str(uuid4());target=self.datasets.root/(key+'.data');committed=False
        try:
            shutil.copyfile(normalized,target)
            if digest(target.read_bytes())!=row['normalized_sha256']:raise WorkspaceError('import_changed','转换表已改变，请重新导入。',409)
            result,created=self._confirm_transaction(row,profile,dataset_id,key)
            committed=created
            return result,created
        finally:
            if not committed:target.unlink(missing_ok=True)

    def _confirm_transaction(self,row,profile,dataset_id,key):
        with self.store.connection() as connection:return self._confirm_in(connection,row,profile,dataset_id,key)

    def _confirm_in(self,connection,row,profile,dataset_id,key):
        document_id,identifier=row['document_id'],row['id']
        connection.execute('BEGIN IMMEDIATE');current=self.row(connection,document_id,identifier)
        if current['dataset_id']:
            saved=self.datasets.row(connection,document_id,current['dataset_id']);self.datasets.checked(saved)
            return self.datasets.record(saved),False
        self.checked(current)
        if any(current[name]!=row[name] for name in ('sha256','review_sha256','normalized_sha256')):raise WorkspaceError('import_changed','导入内容已改变，请重新核对。',409)
        total=connection.execute('SELECT COUNT(*),COALESCE(SUM(byte_size),0) FROM datasets WHERE document_id=?',(document_id,)).fetchone()
        if total[0]>=20 or total[1]+row['normalized_size']>100*1024*1024:raise WorkspaceError('dataset_quota','这篇文献的数据存储已达上限。',409)
        name=Path(row['original_filename']).stem[:140]+'.imported.tsv'
        connection.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?,?,?,?)',
            (dataset_id,document_id,key,name,row['normalized_sha256'],row['normalized_size'],'\t',canonical(profile),timestamp()))
        connection.execute('UPDATE data_imports SET dataset_id=? WHERE id=?',(dataset_id,identifier))
        return self.datasets.record(self.datasets.row(connection,document_id,dataset_id)),True

    def export_files(self,document_id,identifier,dataset):
        with self.store.connection() as connection:row=self.row(connection,document_id,identifier)
        source,_=self.checked(row)
        if row['dataset_id']!=dataset['id'] or row['normalized_sha256']!=dataset['sha256']:
            raise WorkspaceError('import_changed','导入来源与分析表不一致。',409)
        provenance=dataset['import_provenance'];dictionary=dataset['data_dictionary']
        review=json.loads(row['review_json'])
        if dictionary!=review['columns'] or provenance['review_sha256']!=row['review_sha256'] or provenance['source_sha256']!=row['sha256'] or provenance['policy']!=review['policy']:
            raise WorkspaceError('import_changed','导入字典或转换记录已改变。',409)
        return {'original'+Path(row['original_filename']).suffix.lower():source.read_bytes(),
                'data-dictionary.json':canonical(dictionary).encode(),'import-provenance.json':canonical(provenance).encode()}
