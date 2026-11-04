import hashlib
import html
import json
from pathlib import Path
import re
import tempfile
from uuid import UUID
import zipfile
from .text_annotations import export_markup as text_annotation_markup
from .shape_annotations import export_markup as shape_annotation_markup, export_summary as shape_summary

from starlette.responses import FileResponse

from .excerpts import checked_image, verify_source, verify_excerpt_source
from .models import WorkspaceError
from .image_export import archive_files,collect,markup as uploaded_markup,portable as portable_upload
from .store import timestamp
from .rich_content import render_html
from . import image_annotation_export

MAX_EXPORT_BYTES = 128 * 1024 * 1024


class ExportResponse(FileResponse):
    """Remove this request's temporary bundle even if the download disconnects."""
    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            Path(self.path).unlink(missing_ok=True)


def markdown_text(value):
    return re.sub(r'([\\`*_{}\[\]()#+.!|>\-])', r'\\\1', html.escape(value, quote=False))


def reading_documents(document, notes, excerpts, exported_at,annotation_groups=None):
    by_note = {record['note_id']: record for record in excerpts}
    markdown = [f"# {markdown_text(document['title'])}", '',
                '[原 PDF / Source PDF](source.pdf)', '', f'导出 / Exported: {exported_at}', '']
    bibliography = []
    for key,label in [('authors','作者 / Authors'),('year','年份 / Year'),('doi','DOI')]:
        value = document.get(key)
        if value is not None and value != '':
            markdown.extend([f'{label}: {markdown_text(str(value))}', ''])
            bibliography.append(f'<p>{label}: {html.escape(str(value))}</p>')
    sections = []
    portable_notes = []
    for index, note in enumerate(notes, 1):
        identifier = str(UUID(note['id']))
        image = by_note.get(identifier)
        source_link = f"source.pdf#page={note['page']}"
        segments = note.get('source_segments') or []
        markdown.extend([f"## {index}. 第 {note['page']} 页 / Page {note['page']}", '',
                         f'[查看原文 / View source]({source_link})', ''])
        checked = note.get('review_status') == 'source_checked'
        review_label = '已核对原文（自行确认） / Source checked (self-reported)' if checked else '待核对原文 / Needs source checking'
        markdown.extend([review_label, ''])
        markdown.extend('> ' + markdown_text(line) for line in note['text'].splitlines())
        from .image_export import note_rich_html,attachment_only
        body = note_rich_html(note) if note.get('rich_content') else '<p>'+html.escape(note['text']).replace('\n', '<br>')+'</p>'
        if note.get('annotation'):
            annotation = note['annotation']
            markdown.extend(['', 'Text annotation: '+annotation['kind']+' / '+annotation['color'], ''])
            if annotation['quote'] != note['text']:
                markdown.extend('> '+markdown_text(line) for line in annotation['quote'].splitlines())
            body = text_annotation_markup(note) + (body if annotation['quote'] != note['text'] else '')
        if note.get('shape_annotation'):
            shape_label = {'textbox': 'Text box', 'line': 'Line drawing', 'ellipse': 'Ellipse drawing',
                           'ink': 'Freehand drawing'}.get(note['shape_annotation']['kind'], 'Shape annotation')
            markdown.extend(['', shape_label+': '+shape_summary(note['shape_annotation']), ''])
            body = shape_annotation_markup(note) + body
        section = f'<section><h2>{index}. 第 {note["page"]} 页 / Page {note["page"]}</h2>'
        section += f'<p><a href="{source_link}">查看原文 / View source</a></p><p class="review-status">{review_label}</p>'+body
        if len(segments) > 1:
            for segment in segments:
                link = f"source.pdf#page={segment['page']}"
                quote = html.escape(segment['quote']).replace('\n', '<br>')
                section += f'<p><a href="{link}">第 {segment["page"]} 页 / Page {segment["page"]}</a></p><blockquote>{quote}</blockquote>'
                markdown.extend(['', f'[Page {segment["page"]}]({link})', ''])
                markdown.extend('> ' + markdown_text(line) for line in segment['quote'].splitlines())
        image_path = f'images/{identifier}.png' if image else None
        if image:
            markdown.extend(['', f'![第 {note["page"]} 页图表摘录]({image_path})'])
            section += f'<a href="{source_link}"><img src="{image_path}" alt="第 {note["page"]} 页图表摘录"></a>'
        uploads=note.get('attachments',[])
        separate_ids={upload['id'] for upload in attachment_only(note)}
        for upload in uploads:
            paths=portable_upload(upload)
            markdown.extend(['',f'用户上传图片 / User-uploaded image: {markdown_text(upload["original_filename"])}',
                f'![上传图片 / Uploaded image]({paths["preview_path"]})',
                f'[下载上传原文件 / Original upload]({paths["file_path"]})'])
            if upload['id'] in separate_ids:section+=uploaded_markup(upload)
        markdown.append('')
        sections.append(section + '</section>')
        portable_note={**note, 'excerpt': None if image is None else {
            key: value for key, value in {**image, 'image_path': image_path}.items() if key != 'image_url'}}
        portable_note.pop('rich_html',None)
        if uploads:portable_note['attachments']=[portable_upload(i) for i in uploads]
        portable_notes.append(portable_note)
    if not notes:
        markdown.append('尚无已保存笔记 / No saved notes.')
        sections.append('<p>尚无已保存笔记 / No saved notes.</p>')
    heading = html.escape(document['title'])
    annotation_payload=None
    if annotation_groups:
        annotation_payload,annotation_markup,annotation_markdown=image_annotation_export.documents(annotation_groups)
        sections.append(annotation_markup);markdown.extend(['','## 图片标注 / Image annotations','',annotation_markdown])
    markup = ('<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
        'img-src \'self\' file: data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
        f'<title>{heading}</title><style>body{{font:16px/1.65 system-ui,sans-serif;max-width:960px;'
        'margin:32px auto;padding:0 20px;color:#20211f}h1{font-size:24px}h2{font-size:18px}'
        'section{border-top:1px solid #ddd;margin-top:24px;padding-top:12px}'
        'p{overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#245ea8}</style>'
        f'<h1>{heading}</h1><p><a href="source.pdf">原 PDF / Source PDF</a></p>'
        + ''.join(bibliography) + ''.join(sections) + '</html>')
    payload = {'format': 'research-reading-record/v1', 'exported_at': exported_at,
               'document': document, 'notes': portable_notes,
               'source_file': 'source.pdf',
               'coordinate_system': 'normalized rotated page view, left/top/right/bottom'}
    output={'README.md':'\n'.join(markdown).encode('utf-8'),'index.html':markup.encode('utf-8')}
    if annotation_payload:
        payload['image_annotations']=annotation_payload['sources']
        output['image-annotations.json']=json.dumps(annotation_payload,ensure_ascii=False,indent=2).encode('utf-8')
    output['notes.json']=json.dumps(payload,ensure_ascii=False,indent=2).encode('utf-8')
    return output


class ArchiveWriter:
    def __init__(self, archive):
        self.archive = archive
        self.total = 0
        self.files = {}

    def account(self, size):
        self.total += size
        if self.total > MAX_EXPORT_BYTES:
            raise WorkspaceError('export_too_large', '本次阅读记录过大，请减少摘录后重试。', 413)

    def text(self, name, content):
        self.account(len(content))
        self.archive.writestr(name, content)
        self.files[name] = {'sha256': hashlib.sha256(content).hexdigest(), 'byte_size': len(content)}

    def file(self, name, path, expected_hash, expected_size):
        digest, size = hashlib.sha256(), 0
        with path.open('rb') as source, self.archive.open(name, 'w') as destination:
            while chunk := source.read(1024 * 1024):
                self.account(len(chunk))
                digest.update(chunk)
                size += len(chunk)
                destination.write(chunk)
        if size != expected_size or digest.hexdigest() != expected_hash:
            raise WorkspaceError('source_changed', '导出期间资料发生变化，请检查后重试。', 409)
        self.files[name] = {'sha256': digest.hexdigest(), 'byte_size': size}


def build_export(store, identifier):
    document, notes, excerpts,annotation_groups = store.reading_snapshot(identifier,include_annotations=True)
    if document.get('kind')=='study':return store.study_notes.export(identifier)
    source = verify_source(store, document)
    for record in excerpts:
        verify_excerpt_source(record, document)
    planned_size = document['byte_size'] + sum(item['byte_size'] for item in excerpts)
    planned_size += sum(len(note['text'].encode('utf-8')) * 3 + 2048 for note in notes)
    planned_size += sum(image['byte_size']+image['preview_byte_size'] for image in collect(notes))
    if planned_size > MAX_EXPORT_BYTES:
        raise WorkspaceError('export_too_large', '本次阅读记录过大，请减少摘录后重试。', 413)
    # UUID validation also prevents damaged database identifiers becoming archive paths.
    try:
        images = [(f"images/{str(UUID(item['note_id']))}.png", checked_image(store, item), item)
                  for item in excerpts]
        documents = reading_documents(document, notes, excerpts, timestamp(),annotation_groups)
        uploads=archive_files(store,identifier,notes)
        existing={name for name,*_ in uploads}|{name for name,*_ in images}
        for item in image_annotation_export.archive_files(store,identifier,annotation_groups):
            if item[0] not in existing:uploads.append(item);existing.add(item[0])
    except ValueError as error:
        raise WorkspaceError('excerpt_corrupt', '阅读记录不完整，暂时无法导出。', 409) from error
    with tempfile.NamedTemporaryFile(dir=store.exports, suffix='.zip', delete=False) as stream:
        target = Path(stream.name)
    completed = False
    try:
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=4) as archive:
            writer = ArchiveWriter(archive)
            writer.file('source.pdf', source, document['sha256'], document['byte_size'])
            for name, path, record in images:
                writer.file(name, path, record['sha256'], record['byte_size'])
            for name,path,checksum,size in uploads:
                writer.file(name,path,checksum,size)
            for name, content in documents.items():
                writer.text(name, content)
            manifest = {'format': 'research-reading-record/v1', 'document_id': identifier,
                        'source_sha256': document['sha256'], 'files': writer.files}
            archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8'))
        completed = True
        return target, f"{document['title'][:120]} - reading-record.zip"
    finally:
        if not completed:
            target.unlink(missing_ok=True)
