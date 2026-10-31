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
    return {key: metadata[key] for key in DOCUMENT_FIELDS}


def read_metadata(connection, identifier):
    row = connection.execute(DOCUMENT_QUERY + ' WHERE d.id=?', (identifier,)).fetchone()
    if row is None:
        raise WorkspaceError('not_found', '找不到这篇文献。', 404)
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

    def search(self, query, limit=40):
        query = query.strip()
        result = {'query':query,'documents':[],'notes':[],'has_more':False}
        if not query:
            return result
        folded = query.casefold()
        with self.store.connection() as connection:
            connection.execute('BEGIN')
            documents = connection.execute(DOCUMENT_QUERY + ' ORDER BY d.created_at DESC,d.id DESC')
            result['documents'] = self.find_documents(documents,folded,limit)
            sql = STATE_QUERY.replace('SELECT n.id','SELECT m.title AS document_title,n.id',1)
            sql += ''' JOIN document_metadata m ON m.document_id=n.document_id
                WHERE s.deleted_at IS NULL ORDER BY n.created_at DESC,n.id DESC'''
            for row in connection.execute(sql):
                if folded in row['text'].casefold():
                    result['notes'].append(state_record(row))
                if len(result['notes']) > limit:
                    break
        result['has_more'] = len(result['documents']) > limit or len(result['notes']) > limit
        result['documents'] = result['documents'][:limit]
        result['notes'] = result['notes'][:limit]
        return result

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
