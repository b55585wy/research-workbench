"""Versioned sidecar annotations on verified image frames, not PDF coordinates."""
import hashlib
import json
from datetime import datetime,timezone
from uuid import UUID
from .image_annotation_models import ImageAnnotationCreate
from .image_sources import ImageSources,source_column,source_error
from .models import WorkspaceError


def now():return datetime.now(timezone.utc).isoformat()


def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)


def fingerprint(value):return hashlib.sha256(canonical(value).encode()).hexdigest()


def conflict():return WorkspaceError('revision_conflict','这条标注已更新，请保留草稿并查看最新记录。',409)


def viewer_url(document_id,kind,source_id,annotation_id=None):
    value=f'/?document={document_id}&image_kind={kind}&image_source={source_id}'
    return value+(f'&image_annotation={annotation_id}' if annotation_id else '')


def record(row):
    result=dict(row);image=result.pop('image_id');excerpt=result.pop('excerpt_note_id');result.pop('creation_hash',None)
    result.update(source_kind='user_upload' if image else 'pdf_excerpt',source_id=image or excerpt)
    try:
        result['rect']=json.loads(result['rect']) if isinstance(result['rect'],str) else result['rect']
        ImageAnnotationCreate(request_id=result['id'],source_sha256=result['source_sha256'],frame_sha256=result['frame_sha256'],rect=result['rect'],text=result['text'])
    except (ValueError,TypeError,KeyError):raise WorkspaceError('image_annotation_changed','图片标注记录不完整，请保留草稿后检查。',409) from None
    result['viewer_url']=viewer_url(result['document_id'],result['source_kind'],result['source_id'],result['id'])
    return result


def ensure_source(annotation,source,payload=None):
    keys=('document_id','source_kind','source_id','source_sha256','frame_sha256','frame_width','frame_height')
    if any(annotation[k]!=source[k] for k in keys):raise source_error()
    if payload and (payload.source_sha256!=source['source_sha256'] or payload.frame_sha256!=source['frame_sha256']):raise source_error()


class ImageAnnotations:
    def __init__(self,store):
        self.store=store;self.sources=ImageSources(store)

    @staticmethod
    def row(connection,document_id,annotation_id,kind=None,source_id=None):
        row=connection.execute('SELECT * FROM image_annotations WHERE document_id=? AND id=?',(document_id,str(annotation_id))).fetchone()
        if row is None:raise WorkspaceError('not_found','找不到这条图片标注。',404)
        value=record(row)
        if kind is not None and (value['source_kind'],value['source_id'])!=(kind,source_id):raise WorkspaceError('not_found','标注不属于这张图片。',404)
        return value

    def view_in(self,connection,document_id,kind,source_id):
        source,frame=self.sources.source_in(connection,document_id,kind,source_id)
        column=source_column(kind)
        rows=connection.execute(f'SELECT * FROM image_annotations WHERE document_id=? AND {column}=? ORDER BY created_at,id',(document_id,source_id))
        items=[record(row) for row in rows]
        for item in items:ensure_source(item,source)
        return {'source':source,'items':items},frame

    def view(self,document_id,kind,source_id):
        with self.store.connection() as connection:
            connection.execute('BEGIN')
            return self.view_in(connection,document_id,kind,source_id)

    def create(self,document_id,kind,source_id,payload,origin='manual'):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            return self.create_in(connection,document_id,kind,source_id,payload,origin)

    def create_in(self,connection,document_id,kind,source_id,payload,origin='manual'):
        source,_=self.sources.source_in(connection,document_id,kind,source_id)
        if payload.source_sha256!=source['source_sha256'] or payload.frame_sha256!=source['frame_sha256']:raise source_error()
        data=payload.model_dump(mode='json',exclude={'request_id'})
        signature=fingerprint({'document_id':document_id,'source_kind':kind,'source_id':source_id,'origin':origin,'data':data})
        identifier=str(payload.request_id)
        previous=connection.execute('SELECT * FROM image_annotations WHERE id=?',(identifier,)).fetchone()
        if previous is not None:
            if previous['creation_hash']!=signature:raise WorkspaceError('idempotency_conflict','这次保存与已有标注请求不同，请保留草稿。',409)
            value=record(previous);ensure_source(value,source)
            if value['deleted_at'] is not None:raise WorkspaceError('annotation_deleted','标注已删除，可在已删除标注中恢复。',409)
            return value,False
        column=source_column(kind)
        count=connection.execute(f'SELECT COUNT(*) FROM image_annotations WHERE document_id=? AND {column}=?',(document_id,source_id)).fetchone()[0]
        total=connection.execute('SELECT COUNT(*) FROM image_annotations WHERE document_id=?',(document_id,)).fetchone()[0]
        if count>=100 or total>=500:raise WorkspaceError('annotation_limit','标注数量已达到限制（包含可恢复的已删除记录）。',413)
        stamp=now()
        values={'id':identifier,'document_id':document_id,'image_id':source_id if kind=='user_upload' else None,
            'excerpt_note_id':source_id if kind=='pdf_excerpt' else None,'source_sha256':source['source_sha256'],
            'frame_sha256':source['frame_sha256'],'frame_width':source['frame_width'],'frame_height':source['frame_height'],
            'creation_hash':signature,'rect':canonical(data['rect']),'text':payload.text,'origin':origin,'revision':1,
            'created_at':stamp,'updated_at':stamp,'deleted_at':None}
        connection.execute('INSERT INTO image_annotations VALUES ('+','.join('?' for _ in values)+')',tuple(values.values()))
        return record(values),True

    def mutate(self,document_id,kind,source_id,annotation_id,action,payload):
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            return self.mutate_in(connection,document_id,kind,source_id,annotation_id,action,payload)

    def mutate_in(self,connection,document_id,kind,source_id,annotation_id,action,payload):
        source,_=self.sources.source_in(connection,document_id,kind,source_id)
        current=self.row(connection,document_id,annotation_id,kind,source_id);ensure_source(current,source,payload)
        data=payload.model_dump(mode='json',exclude_unset=True,exclude={'request_id'})
        signature=fingerprint({'document_id':document_id,'source_kind':kind,'source_id':source_id,'annotation_id':str(annotation_id),'action':action,'data':data})
        request_id=str(payload.request_id)
        previous=connection.execute('SELECT * FROM image_annotation_operations WHERE request_id=?',(request_id,)).fetchone()
        if previous is not None:
            if previous['annotation_id']!=current['id'] or previous['payload_hash']!=signature:raise WorkspaceError('idempotency_conflict','这次操作与已有标注请求不同。',409)
            if previous['result_revision']!=current['revision']:raise conflict()
            return current
        if current['revision']!=payload.expected_revision:raise conflict()
        updated=self.apply(current,action,data)
        if updated['revision']!=current['revision']:
            cursor=connection.execute('''UPDATE image_annotations SET rect=?,text=?,revision=?,updated_at=?,deleted_at=?
                WHERE id=? AND revision=?''',(canonical(updated['rect']),updated['text'],updated['revision'],updated['updated_at'],updated['deleted_at'],current['id'],current['revision']))
            if cursor.rowcount!=1:raise conflict()
        connection.execute('INSERT INTO image_annotation_operations VALUES (?,?,?,?,?,?)',(request_id,current['id'],action,signature,updated['revision'],now()))
        return updated

    @staticmethod
    def apply(current,action,data):
        result=dict(current);stamp=now()
        if action=='patch':
            if current['deleted_at'] is not None:raise WorkspaceError('annotation_deleted','请先恢复标注，再修改。',409)
            for key in ('rect','text'):
                if key in data:result[key]=data[key]
        elif action=='delete':result['deleted_at']=current['deleted_at'] or stamp
        elif action=='restore':result['deleted_at']=None
        else:raise ValueError('Unknown annotation mutation')
        if any(result[k]!=current[k] for k in ('rect','text','deleted_at')):result.update(revision=current['revision']+1,updated_at=stamp)
        return result

    def export_groups(self,connection,document_id):
        rows=connection.execute('''SELECT a.* FROM image_annotations a LEFT JOIN note_states s ON s.note_id=a.excerpt_note_id
            WHERE a.document_id=? AND a.deleted_at IS NULL AND (a.image_id IS NOT NULL OR s.deleted_at IS NULL)
            ORDER BY a.created_at,a.id''',(document_id,)).fetchall()
        groups={}
        for row in rows:
            item=record(row);key=(item['source_kind'],item['source_id'])
            if key not in groups:
                source,_=self.sources.source_in(connection,document_id,*key)
                groups[key]={'source':source,'items':[]}
            ensure_source(item,groups[key]['source']);groups[key]['items'].append(item)
        return list(groups.values())
