import hashlib
import json
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .models import WorkspaceError


def canonical(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
def identity(identifier, name, question):
    return hashlib.sha256(canonical({'kind':'study/v1','id':identifier,'name':name,'question':question}).encode()).hexdigest()


PERSONAL_ROLE='personal_analysis'


def tagged_personal(connection, identifier):
    return connection.execute('SELECT 1 FROM personal_analysis_owner WHERE document_id=?',
                              (identifier,)).fetchone() is not None


def user_study_count(connection):
    return connection.execute('''SELECT COUNT(*) FROM studies s
        WHERE NOT EXISTS(SELECT 1 FROM personal_analysis_owner p WHERE p.document_id=s.document_id)''').fetchone()[0]


class StudyCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    name: str = Field(strict=True, min_length=1, max_length=180)
    question: str = Field(strict=True, min_length=1, max_length=4000)

    @field_validator('name','question')
    @classmethod
    def meaningful(cls,value):
        value=value.strip()
        if not value or '\x00' in value: raise ValueError('Empty research description')
        return value


class PaperLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    document_id: UUID
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


def owner(connection, metadata):
    row=connection.execute('SELECT * FROM studies WHERE document_id=?',(metadata['id'],)).fetchone()
    if row is None or any(metadata[k] is not None for k in ('page_count','original_filename','byte_size','sha256')):
        raise WorkspaceError('study_changed','研究归属记录不完整，请检查资料。',409)
    checksum=identity(metadata['id'],metadata['title'],row['question'])
    if checksum!=row['request_hash']:raise WorkspaceError('study_changed','研究描述已发生变化。',409)
    record={**metadata,'kind':'study','name':metadata['title'],'question':row['question'],
            'sha256':checksum,'scope_sha256':checksum}
    if tagged_personal(connection,metadata['id']):record['workspace_role']=PERSONAL_ROLE
    return record


def verify_owner(store, record):
    if record.get('kind')=='study':
        current=store.get_document(record['id'])
        if current.get('kind')!='study' or current['scope_sha256']!=record['scope_sha256']:
            raise WorkspaceError('study_changed','研究上下文已变化，请重新打开。',409)
        return None
    from .excerpts import verify_source
    return verify_source(store,record)


class Studies:
    def __init__(self,store):self.store=store

    def get(self,identifier):
        value=self.store.get_document(identifier)
        if value.get('kind')!='study':raise WorkspaceError('not_found','找不到这项研究。',404)
        return value

    def list(self):
        with self.store.connection() as db:
            ids=[r[0] for r in db.execute('''SELECT s.document_id FROM studies s
                WHERE NOT EXISTS(SELECT 1 FROM personal_analysis_owner p WHERE p.document_id=s.document_id)
                ORDER BY s.rowid DESC''')]
        return [self.get(i) for i in ids]

    def create(self,payload):
        from .store import timestamp
        identifier=str(payload.request_id);checksum=identity(identifier,payload.name,payload.question)
        with self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM studies WHERE document_id=?',(identifier,)).fetchone()
            if old:
                if old['request_hash']!=checksum:raise WorkspaceError('idempotency_conflict','编号已用于另一项研究，请保留原请求。',409)
                return self.get(identifier),False
            if db.execute('SELECT 1 FROM documents WHERE id=?',(identifier,)).fetchone():
                raise WorkspaceError('idempotency_conflict','编号已用于已有资料。',409)
            if user_study_count(db)>=100:raise WorkspaceError('study_quota','研究数量已达100项。',409)
            created=timestamp()
            db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?)',(identifier,payload.name,None,None,None,None,created))
            db.execute('INSERT INTO studies VALUES (?,?,?,?)',(identifier,payload.question,checksum,created))
            from .library import read_metadata
            return read_metadata(db,identifier),True

    def papers(self,identifier):
        record=self.get(identifier)
        if record.get('workspace_role')==PERSONAL_ROLE:return []
        with self.store.connection() as db:
            rows=db.execute('SELECT paper_id,sha256 FROM study_papers WHERE study_id=? ORDER BY created_at,paper_id',(identifier,)).fetchall()
        result=[]
        for row in rows:
            paper=self.store.get_document(row['paper_id'])
            if paper['sha256']!=row['sha256'] or paper.get('kind')=='study':raise WorkspaceError('source_changed','关联文献版本已改变。',409)
            result.append(paper)
        return result

    def link(self,identifier,payload):
        from .excerpts import verify_source
        from .store import timestamp
        record=self.get(identifier)
        if record.get('workspace_role')==PERSONAL_ROLE:
            raise WorkspaceError('personal_workspace_not_project','个人数据工作区不是研究项目，不能关联文献。',409)
        paper=self.store.get_document(str(payload.document_id))
        if paper.get('kind')=='study':raise WorkspaceError('invalid_paper','请选择实际PDF文献。',422)
        if paper['sha256']!=payload.sha256:raise WorkspaceError('source_changed','文献版本已变化。',409)
        verify_source(self.store,paper)
        with self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM study_papers WHERE study_id=? AND paper_id=?',(identifier,paper['id'])).fetchone()
            if old:return paper,False
            if db.execute('SELECT COUNT(*) FROM study_papers WHERE study_id=?',(identifier,)).fetchone()[0]>=20:
                raise WorkspaceError('paper_quota','每项研究最多关联20篇文献。',409)
            db.execute('INSERT INTO study_papers VALUES (?,?,?,?)',(identifier,paper['id'],paper['sha256'],timestamp()))
        return paper,True

    def unlink(self,identifier,paper_id,checksum):
        record=self.get(identifier)
        if record.get('workspace_role')==PERSONAL_ROLE:
            raise WorkspaceError('personal_workspace_not_project','个人数据工作区不是研究项目，不能关联文献。',409)
        with self.store.connection() as db:
            old=db.execute('SELECT * FROM study_papers WHERE study_id=? AND paper_id=?',(identifier,paper_id)).fetchone()
            if old and old['sha256']!=checksum:raise WorkspaceError('source_changed','关联版本不同，请重新读取。',409)
            result=db.execute('DELETE FROM study_papers WHERE study_id=? AND paper_id=?',(identifier,paper_id))
            return {'removed':result.rowcount>0}
