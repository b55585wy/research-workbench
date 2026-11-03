from html import escape
import json
import tempfile
from pathlib import Path
import zipfile
from .models import WorkspaceError
from .agent_store import canonical
from .note_lifecycle import base_note,read_state,read_states
from .reading_export import ArchiveWriter
from .rich_content import render_html


def anchor_from_source(source,document_id):
    mapping={'study_context':('study',document_id,'scope_sha256'),'dataset_sample':('dataset',source.get('dataset_id'),'dataset_sha256'),
             'analysis_result':('analysis',source.get('analysis_id'),'result_sha256'),'chart_result':('chart',source.get('chart_id'),'result_sha256')}
    if source['kind']=='note' and source.get('source'):return {k:source['source'][k] for k in ('kind','id','sha256')}
    if source['kind'] not in mapping:raise WorkspaceError('note_source_scope','请使用研究、数据或实际结果来源。',409)
    kind,identifier,key=mapping[source['kind']]
    return {'kind':kind,'id':identifier,'sha256':source[key]}


class StudyNotes:
    def __init__(self,store,datasets,analysis,charts):
        self.store,self.datasets,self.analysis,self.charts=store,datasets,analysis,charts

    def resolve(self,document_id,source):
        identifier=str(source.id);kind=source.kind
        if kind=='study':
            value=self.store.get_document(document_id)
            if identifier!=document_id or value.get('kind')!='study':raise WorkspaceError('note_source_scope','研究来源不匹配。',409)
            checksum=value['scope_sha256'];label=value['title'];url=f'/?study={document_id}'
        elif kind=='dataset':
            value=self.datasets.get(document_id,identifier);self.datasets.path(document_id,identifier)
            checksum=value['sha256'];label=value['original_filename'];url=f'/?study={document_id}&dataset={identifier}'
        elif kind=='analysis':
            value=self.analysis.result(document_id,identifier)
            checksum=next(o['sha256'] for o in value['outputs'] if o['name']=='summary.json')
            label=value['dataset_name']+' · '+value['engine'];url=f'/?study={document_id}&analysis={identifier}'
        else:
            value,_=self.charts.data(document_id,identifier)
            checksum=value['data_sha256'];label=value['title'];url=f'/?study={document_id}&chart={identifier}'
        if checksum!=source.sha256:raise WorkspaceError('note_source_changed','笔记来源版本已变化，请重新选择。',409)
        return {'kind':kind,'id':identifier,'sha256':checksum,'label':label,'url':url}

    def save_in(self,db,identifier,payload):
        if payload.page is not None or payload.rect is not None or payload.source is None:
            raise WorkspaceError('study_note_source_required','研究笔记需要实际来源，不使用PDF页码。',422)
        source=self.resolve(identifier,payload.source);note_id=str(payload.request_id)
        old=db.execute('SELECT * FROM notes WHERE id=?',(note_id,)).fetchone()
        if old:
            original=db.execute('SELECT source_json FROM study_note_sources WHERE note_id=?',(note_id,)).fetchone()
            rich=db.execute('SELECT original_json FROM note_rich_content WHERE note_id=?',(note_id,)).fetchone()
            if (old['document_id'],old['text'])!=(identifier,payload.text) or original is None or json.loads(original[0])!=source or (json.loads(rich[0]) if rich else None)!=payload.rich_content:
                raise WorkspaceError('idempotency_conflict','笔记原请求与当前内容不同。',409)
            current=read_state(db,identifier,note_id)
            if current['deleted_at']:raise WorkspaceError('note_deleted','笔记已删除，请恢复后查看。',409)
            return base_note(current),False
        from .store import timestamp
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',(note_id,identifier,None,None,payload.text,timestamp()))
        db.execute('INSERT INTO study_note_sources VALUES (?,?)',(note_id,canonical(source)))
        if payload.rich_content is not None:
            content=canonical(payload.rich_content);db.execute('INSERT INTO note_rich_content VALUES (?,?,?)',(note_id,content,content))
            from .rich_images import sync_note_images
            sync_note_images(self.store,db,identifier,note_id,None,payload.rich_content)
        return base_note(read_state(db,identifier,note_id)),True

    def export(self,document_id):
        from .models import SourceAnchor
        owner=self.store.get_document(document_id)
        owner,notes,_,groups=self.store.reading_snapshot(document_id,include_annotations=True)
        from .image_export import archive_files,markup
        from . import image_annotation_export
        images={name:(path,checksum,size) for name,path,checksum,size in archive_files(self.store,document_id,notes)}
        for name,path,checksum,size in image_annotation_export.archive_files(self.store,document_id,groups):images[name]=(path,checksum,size)
        for note in notes:
            source=note['source'];self.resolve(document_id,SourceAnchor(**{k:source[k] for k in ('kind','id','sha256')}))
        files={'notes.json':canonical({'format':'study-notes/v1','study':owner,'notes':notes}).encode()}
        body='<!doctype html><meta charset="utf-8"><title>研究笔记</title><h1>'+escape(owner['title'])+'</h1><p>'+escape(owner['question'])+'</p>'
        for note in notes:
            body+='<section><h2>'+escape(note['source']['label'])+'</h2><p>来源 / Source: '+escape(note['source']['kind'])+' · '+escape(note['source']['id'])+'</p>'
            from .image_export import note_rich_html,attachment_only
            body+=note_rich_html(note) if note.get('rich_content') else '<p>'+escape(note['text']).replace('\n','<br>')+'</p>'
            body+=''.join(markup(image) for image in attachment_only(note))
            body+='<p>'+escape(note['review_status'])+'</p></section>'
        if groups:
            annotation_payload,annotation_html,_=image_annotation_export.documents(groups)
            files['image-annotations.json']=canonical(annotation_payload).encode();body+=annotation_html
        files['index.html']=body.encode()
        path=None
        try:
            with tempfile.NamedTemporaryFile(dir=self.store.exports,suffix='.zip',delete=False) as stream:path=Path(stream.name)
            with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
                writer=ArchiveWriter(archive)
                for name,content in files.items():writer.text(name,content)
                for name,(material,checksum,size) in images.items():writer.file(name,material,checksum,size)
                archive.writestr('manifest.json',canonical({'format':'study-notes/v1','files':writer.files}).encode())
            return path,'study-notes.zip'
        except BaseException:
            if path:path.unlink(missing_ok=True)
            raise
