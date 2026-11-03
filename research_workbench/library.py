from datetime import datetime, timezone
import hashlib
import json

from .models import WorkspaceError
from .note_lifecycle import STATE_QUERY, state_record

DOCUMENT_FIELDS = ('id','title','original_filename','page_count','byte_size','sha256','created_at')
META_FIELDS = ('title','authors','year','doi')
DOCUMENT_QUERY = '''SELECT d.id,m.title,d.original_filename,d.page_count,d.byte_size,
    d.sha256,d.created_at,m.authors,m.year,m.doi,m.revision,m.updated_at
    FROM documents d JOIN document_metadata m ON m.document_id=d.id'''


def base_document(metadata):
    metadata=dict(metadata)
    if metadata.get('kind')=='study':return dict(metadata)
    return {key: metadata[key] for key in DOCUMENT_FIELDS}


def read_metadata(connection, identifier, include_trashed=False):
    row = connection.execute(DOCUMENT_QUERY + ' WHERE d.id=?', (identifier,)).fetchone()
    if row is None:
        if connection.execute('SELECT 1 FROM document_purges WHERE document_id=?', (identifier,)).fetchone():
            raise WorkspaceError('document_purged', '这篇文献已彻底删除，无法恢复。', 410)
        raise WorkspaceError('not_found', '找不到这篇文献。', 404)
    if not include_trashed and connection.execute('SELECT 1 FROM document_trash WHERE document_id=?', (identifier,)).fetchone():
        raise WorkspaceError('document_trashed', '这篇论文已移入回收站，请先恢复。', 410)
    if row['page_count'] is None:
        from .studies import owner
        return owner(connection,dict(row))
    return dict(row)


def revision_conflict():
    return WorkspaceError('revision_conflict', '文献信息已在其他页面更新，请保留草稿并查看最新信息。', 409)


class Library:
    def __init__(self, store):
        self.store = store

    def get(self, identifier):
        with self.store.connection() as connection:
            return read_metadata(connection, identifier)

    def find_duplicate(self, checksum, byte_size):
        with self.store.connection() as connection:
            row = connection.execute(DOCUMENT_QUERY + ''' WHERE d.sha256=? AND d.byte_size=?
                AND NOT EXISTS(SELECT 1 FROM document_trash t WHERE t.document_id=d.id)
                ORDER BY d.created_at,d.id LIMIT 1''',(checksum,byte_size)).fetchone()
            return base_document(row) if row is not None else None

    def update(self, identifier, payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            return self.update_in(connection, identifier, payload)

    def update_in(self, connection, identifier, payload):
        data = payload.model_dump(mode='json', exclude_unset=True, exclude={'request_id'})
        fingerprint = hashlib.sha256(json.dumps({'document_id':identifier,'data':data},
            ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        current = read_metadata(connection, identifier)
        if current.get('kind')=='study':raise WorkspaceError('study_metadata','首版研究描述在创建时确认。',409)
        receipt = connection.execute('SELECT * FROM document_operations WHERE request_id=?',
                                     (str(payload.request_id),)).fetchone()
        if receipt is not None:
            return self.repeat(receipt,current,fingerprint)
        if current['revision'] != payload.expected_revision:
            raise revision_conflict()
        changes = {key:value for key,value in data.items() if key in META_FIELDS}
        result = {**current,**changes}
        if any(result[key] != current[key] for key in META_FIELDS):
            result.update(revision=current['revision']+1,updated_at=datetime.now(timezone.utc).isoformat())
            connection.execute('''UPDATE document_metadata SET title=?,authors=?,year=?,doi=?,
                revision=?,updated_at=? WHERE document_id=?''', (
                *(result[key] for key in META_FIELDS),result['revision'],result['updated_at'],identifier))
        connection.execute('INSERT INTO document_operations VALUES (?,?,?,?,?)', (
            str(payload.request_id),identifier,fingerprint,result['revision'],datetime.now(timezone.utc).isoformat()))
        return result

    @staticmethod
    def repeat(receipt,current,fingerprint):
        if receipt['document_id'] != current['id'] or receipt['payload_hash'] != fingerprint:
            raise WorkspaceError('idempotency_conflict','这次保存请求与已有记录冲突，请保留草稿。',409)
        if receipt['result_revision'] != current['revision']:
            raise revision_conflict()
        return current

    def search(self, query, limit=40, include_studies=False):
        query = query.strip()
        result = {'query':query,'documents':[],'notes':[],'has_more':False}
        if include_studies:result['studies']=[]
        if not query:
            return result
        folded = query.casefold()
        with self.store.connection() as connection:
            if not connection.in_transaction:connection.execute('BEGIN')
            documents = connection.execute(DOCUMENT_QUERY + ' WHERE d.page_count IS NOT NULL AND NOT EXISTS '
                '(SELECT 1 FROM document_trash t WHERE t.document_id=d.id) ORDER BY d.created_at DESC,d.id DESC')
            result['documents'] = self.find_documents(documents,folded,limit)
            if include_studies:result['studies']=self.find_studies(connection,folded,limit)
            sql = STATE_QUERY.replace('SELECT n.id','SELECT m.title AS document_title,n.id',1)
            sql += ''' JOIN document_metadata m ON m.document_id=n.document_id
                WHERE s.deleted_at IS NULL AND NOT EXISTS
                (SELECT 1 FROM document_trash t WHERE t.document_id=n.document_id)'''
            if not include_studies:sql+=' AND n.page IS NOT NULL'
            sql+=' ORDER BY n.created_at DESC,n.id DESC'
            for row in connection.execute(sql):
                if folded in row['text'].casefold():
                    note=state_record(row)
                    if note['page'] is None:note['owner_kind']='study'
                    result['notes'].append(note)
                if len(result['notes']) > limit:
                    break
        result['has_more'] = any(len(result[key])>limit for key in ('documents','notes','studies') if key in result)
        result['documents'] = result['documents'][:limit]
        result['notes'] = result['notes'][:limit]
        if include_studies:result['studies']=result['studies'][:limit]
        return result

    @staticmethod
    def find_studies(connection,folded,limit):
        found=[]
        rows=connection.execute('''SELECT d.id,d.title,s.question FROM studies s
            JOIN documents d ON d.id=s.document_id
            WHERE NOT EXISTS(SELECT 1 FROM personal_analysis_owner p WHERE p.document_id=s.document_id)
            ORDER BY d.created_at DESC,d.id DESC''')
        for row in rows:
            matches=[key for key,value in (('name',row['title']),('question',row['question'])) if folded in value.casefold()]
            if matches:found.append({**read_metadata(connection,row['id']),'matched_fields':matches})
            if len(found)>limit:break
        return found

    @staticmethod
    def find_documents(rows, folded, limit):
        found = []
        for row in rows:
            record = dict(row)
            matches = [key for key in (*META_FIELDS,'original_filename')
                       if record[key] is not None and folded in str(record[key]).casefold()]
            if matches:
                found.append({**record,'matched_fields':matches})
            if len(found) > limit:
                break
        return found
