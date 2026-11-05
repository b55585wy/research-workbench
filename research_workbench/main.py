import hashlib
from contextlib import asynccontextmanager
import ipaddress
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, Query, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException

from . import __version__
from .models import MAX_FILE_BYTES, DocumentUpdate, NoteCreate, NoteMutation, NoteUpdate, WorkspaceError
from .pdf_validation import PdfValidator
from .store import Store, timestamp
from .excerpts import Excerpts, checked_image, verify_excerpt_source, verify_source
from .pdf_regions import PdfRegions
from .reading_export import build_export, ExportResponse
from .annotated_pdf_export import AnnotatedPdfExport
from .images import ImageLibrary
from .agent_provider import ModelConnection
from .agent_runtime import ReadingAgent
from .bibliography import Bibliography,LookupRequest
from .agent_api import router as agent_router
from .datasets import Datasets
from .analyses import Analyses
from .analysis_process import AnalysisSupervisor
from .analysis_recipes import RuntimeCatalog
from .analysis_api import router as analysis_router
from .reader_diagnostics import ReaderErrorReporter, router as reader_errors_router
from .reader_source_api import router as reader_source_router

ROOT = Path(__file__).resolve().parents[1]
SECURITY_HEADERS = {'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
    "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data: blob:; "
    "img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}


def error_response(code, message, status):
    return JSONResponse({'detail': {'code': code, 'message': message}}, status,
                        headers=SECURITY_HEADERS)


class LocalBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        if not self.allowed(scope, headers):
            return await error_response('local_only', '此入口仅供本机使用。', 403)(scope, receive, send)
        if headers.get('sec-fetch-site') == 'cross-site' or not self.same_origin(scope, headers):
            return await error_response('origin_rejected', '请从本机工作台页面重试。', 403)(scope, receive, send)
        limit = MAX_FILE_BYTES + 1024 * 1024
        length = headers.get('content-length')
        if length and (not length.isdecimal() or int(length) > limit):
            return await error_response('file_too_large', '目前支持不超过 20 MiB 的 PDF。', 413)(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get('body', b''))
            if received > limit:
                raise HTTPException(413, detail={'code': 'file_too_large', 'message': '文件超过大小限制。'})
            return message

        async def protected_send(message):
            if message['type'] == 'http.response.start':
                message.setdefault('headers', []).extend((k.lower().encode(), v.encode()) for k, v in SECURITY_HEADERS.items())
            await send(message)

        await self.app(scope, bounded_receive, protected_send)

    @staticmethod
    def allowed(scope, headers):
        from urllib.parse import urlsplit
        try:
            client = (scope.get('client') or ('', 0))[0]
            host = urlsplit('//' + headers.get('host', '')).hostname
            return ipaddress.ip_address(client).is_loopback and host in ('127.0.0.1', 'localhost', '::1')
        except ValueError:
            return False

    @staticmethod
    def same_origin(scope, headers):
        origin = headers.get('origin')
        return origin is None or origin == f"{scope['scheme']}://{headers.get('host', '')}"


def original_filename(filename):
    name = re.split(r'[/\\]', filename or '')[-1]
    name = ''.join(char for char in name if ord(char) >= 32 and ord(char) != 127).strip()[:180]
    return name or 'document.pdf'


def import_document(store, validator, upload, deduplicate=False):
    identifier = str(uuid4())
    target = store.files / f'{identifier}.pdf'
    temporary = None
    completed = False
    try:
        with tempfile.NamedTemporaryFile(dir=store.incoming, suffix='.pdf', delete=False) as output:
            temporary = Path(output.name)
            digest, size = copy_upload(upload, output)
        if deduplicate:
            existing = store.library.find_duplicate(digest.hexdigest(),size)
            if existing is not None:
                verify_source(store,existing)
                return existing,False
        pages = validator(temporary)
        name = original_filename(upload.filename)
        record = dict(id=identifier, title=Path(name).stem or name, original_filename=name,
                      page_count=pages, byte_size=size, sha256=digest.hexdigest(), created_at=timestamp())
        temporary.replace(target)
        result = store.add_document(record,deduplicate=True) if deduplicate else store.add_document(record)
        completed = result['id'] == identifier
        if not completed:
            verify_source(store,result)
        return (result,completed) if deduplicate else result
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        if not completed:
            target.unlink(missing_ok=True)
        upload.file.close()


def copy_upload(upload, output):
    digest, size = hashlib.sha256(), 0
    while chunk := upload.file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_FILE_BYTES:
            raise WorkspaceError('file_too_large', '目前支持不超过 20 MiB 的 PDF。', 413)
        output.write(chunk)
        digest.update(chunk)
    return digest, size


def create_app(data_root=None, validator=None, renderer=None, *, agent_provider=None, agent_config=None,
               page_reader=None, agent_autostart=True, analysis_rscript=None, analysis_autostart=True,
               statistics_root=None,import_root=None,translation_runtime=None,translation_autostart=True,
               shared_model_config=None,guest_model_policy=False,
               shared_model_forbidden_root=None):
    store = Store(data_root or os.environ.get('RESEARCH_WORKBENCH_DATA', ROOT / 'data'))
    validator = validator or PdfValidator()
    images=ImageLibrary(store)
    bibliography=Bibliography(store)
    shared_path = Path(shared_model_config) if shared_model_config is not None else None
    if agent_provider is not None:
        provider = agent_provider
    elif shared_path is not None:
        # Explicit operator path only: owner/local startup never inherits it.
        from .shared_model import SharedFallbackModelConnection
        provider = SharedFallbackModelConnection.from_paths(
            store.root, agent_config or os.environ.get('RESEARCH_AGENT_CONFIG'),
            shared_path, guest_policy=True,
            forbidden_root=shared_model_forbidden_root)
    else:
        provider = ModelConnection(store.root,agent_config or os.environ.get('RESEARCH_AGENT_CONFIG'))
    from .translation import Translations
    from .translation_runtime import TranslationRuntime
    from .translation_process import TranslationSupervisor
    from .translation_api import router as translation_router
    from .translation_run_api import router as translation_run_router
    from .translation_library_api import router as translation_library_router
    translation_root = translation_runtime or os.environ.get('RESEARCH_TRANSLATION_RUNTIME')
    translations = Translations(store, provider, TranslationRuntime(translation_root))
    translation_supervisor = TranslationSupervisor(translations, translation_root,
        agent_config or os.environ.get('RESEARCH_AGENT_CONFIG'),
        shared_model_config=shared_path,
        guest_model_policy=guest_model_policy,
        shared_model_forbidden_root=shared_model_forbidden_root) if translation_autostart else None
    from .selection_translation import SelectionTranslation
    from .selection_translation_api import router as selection_translation_router
    selection_translation = SelectionTranslation(store, provider)
    # Model-free paragraph reading reuses the resolved translation runtime root
    # for its pinned local parser; it never reads model configuration.
    from .reading_pages import ReadingPages
    from .reading_page_api import router as reading_page_router
    reading_pages = ReadingPages(store, translation_root)
    datasets=Datasets(store)
    from .data_imports import DataImports
    from .data_import_api import router as data_import_router
    data_imports=DataImports(store,datasets,import_root)
    datasets.imports=data_imports
    from .dataset_selections import DatasetSelections
    from .selection_api import router as selection_router
    selections=DatasetSelections(store,datasets)
    datasets.selections=selections
    analysis=Analyses(store,datasets,RuntimeCatalog(analysis_rscript or os.environ.get('RESEARCH_RSCRIPT'),statistics_root))
    supervisor=AnalysisSupervisor(analysis) if analysis_autostart else None
    from .image_annotations import ImageAnnotations
    from .image_annotation_api import install_image_annotation_routes
    image_annotations=ImageAnnotations(store)
    from .charts import Charts
    from .chart_api import router as chart_router
    charts=Charts(store,datasets,analysis)
    from .presentation_service import Presentations
    from .presentation_api import router as presentation_router
    presentations=Presentations(store,datasets,analysis,charts,provider)
    from .research_records import ResearchRecords
    from .record_api import router as record_router
    records=ResearchRecords(store,datasets,analysis,charts)
    agent=ReadingAgent(store,images,provider,page_reader,analysis=analysis,image_annotations=image_annotations,charts=charts)

    from .studies import Studies
    from .study_notes import StudyNotes
    from .study_api import router as study_router
    studies=Studies(store)
    from .data_workspace import DataWorkspace
    from .data_workspace_api import router as data_workspace_router
    data_workspace=DataWorkspace(store)
    from .project_resources import ProjectResources
    from .project_resources_api import router as project_resources_router
    project_resources=ProjectResources(store,datasets,analysis,charts)
    from .agent_references import ReferenceCatalog
    from .agent_reference_api import router as agent_reference_router
    reference_catalog=ReferenceCatalog(store)
    store.study_notes=StudyNotes(store,datasets,analysis,charts)
    agent.workspace.records=records
    agent.workspace.references=reference_catalog

    @asynccontextmanager
    async def lifespan(app):
        if translation_supervisor:translation_supervisor.start()
        if supervisor:supervisor.recover()
        if agent_autostart:agent.start()
        try:
            yield
        finally:
            reading_pages.close()
            if translation_supervisor:translation_supervisor.close()
            agent.close()
            if supervisor:supervisor.close()

    app = FastAPI(title='Research workbench', version=__version__, docs_url=None, redoc_url=None,lifespan=lifespan)
    app.state.store, app.state.validator = store, validator
    # The explicit shared reset endpoint is a guest-only capability; the owner
    # application never exposes it even when a root caller explicitly wires a
    # shared connection for testing.
    app.state.guest_model_space = bool(guest_model_policy)
    app.state.reader_errors = ReaderErrorReporter(store)
    app.state.translations = translations
    app.include_router(translation_router)
    app.include_router(translation_run_router)
    app.include_router(translation_library_router)
    app.state.selection_translation = selection_translation
    app.include_router(selection_translation_router)
    app.state.reading_pages = reading_pages
    app.include_router(reading_page_router)
    app.state.excerpts = Excerpts(store, renderer)
    app.state.pdf_regions = PdfRegions(store)
    app.state.annotated_pdf = AnnotatedPdfExport(store)
    app.state.images,app.state.agent=images,agent
    app.state.bibliography=bibliography
    app.state.datasets,app.state.analysis=datasets,analysis
    app.state.data_imports=data_imports
    app.state.selections=selections
    app.include_router(selection_router)
    from .library_lifecycle_api import router as library_lifecycle_router
    app.include_router(library_lifecycle_router)
    app.state.image_annotations=image_annotations
    app.state.charts=charts
    app.state.presentations=presentations
    app.state.records=records
    app.state.studies=studies
    app.state.data_workspace=data_workspace
    app.state.project_resources=project_resources
    app.state.reference_catalog=reference_catalog
    app.include_router(study_router)
    app.include_router(project_resources_router)
    app.include_router(data_workspace_router)
    app.include_router(record_router)
    app.include_router(chart_router)
    app.include_router(presentation_router)
    app.include_router(data_import_router)
    app.add_middleware(LocalBoundary)
    install_image_annotation_routes(app,image_annotations)
    from .device_ai import install_device_ai_routes
    install_device_ai_routes(app)

    @app.exception_handler(WorkspaceError)
    async def workspace_error(request, error):
        return error_response(error.code, error.message, error.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return error_response('validation_error', '请检查页码、笔记内容和所选位置。', 422)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        if isinstance(error.detail, dict):
            return JSONResponse({'detail': error.detail}, error.status_code)
        return error_response('not_found', '找不到请求的资料或页面。', error.status_code)

    @app.exception_handler(OSError)
    @app.exception_handler(sqlite3.Error)
    async def storage_error(request, error):
        return error_response('storage_unavailable', '无法读取或保存资料，请检查存储后重试。', 503)

    @app.get('/api/v1/health')
    def health():
        return {'status': 'ok', 'version': __version__}

    @app.get('/api/v1/reader-capabilities')
    def reader_capabilities():
        return {'source_segments': True, 'storage': 'server'}

    @app.get('/api/v1/documents')
    def documents():
        return {'items': store.list_documents()}

    @app.get('/api/v1/search')
    def search(q: str = Query(default='',max_length=200), limit: int = Query(default=40,ge=1,le=100), include_studies: bool = Query(default=False)):
        return store.library.search(q,limit,include_studies)

    @app.post('/api/v1/documents', status_code=201)
    def upload_document(file: UploadFile = File(...), deduplicate: bool = Form(False)):
        result = import_document(store, validator, file,deduplicate)
        document,created = result if deduplicate else (result,True)
        return JSONResponse(document,status_code=201 if created else 200)

    @app.get('/api/v1/documents/{identifier}/metadata')
    def document_metadata(identifier: UUID):
        return store.library.get(str(identifier))

    @app.patch('/api/v1/documents/{identifier}/metadata')
    def update_document_metadata(identifier: UUID, payload: DocumentUpdate):
        return store.library.update(str(identifier),payload)

    @app.post('/api/v1/documents/{identifier}/metadata/lookup')
    def lookup_document_metadata(identifier: UUID,payload:LookupRequest):
        return bibliography.lookup(str(identifier),payload)

    @app.get('/api/v1/documents/{identifier}')
    def document(identifier: UUID):
        return store.get_document(str(identifier))

    @app.get('/api/v1/documents/{identifier}/file')
    def document_file(identifier: UUID):
        record = store.get_document(str(identifier))
        if record.get('kind')=='study':raise WorkspaceError('source_has_no_pdf','研究没有占位PDF，请打开实际关联文献。',409)
        path = store.files / f'{identifier}.pdf'
        if not path.is_file():
            raise WorkspaceError('file_missing', '原文件暂时无法打开，请检查资料存储。', 409)
        return FileResponse(path, media_type='application/pdf', filename=record['original_filename'],
                            content_disposition_type='inline')

    @app.get('/api/v1/documents/{identifier}/pages/{page}/regions')
    def page_regions(identifier: UUID, page: int):
        return app.state.pdf_regions.get_page(str(identifier), page)

    @app.get('/api/v1/documents/{identifier}/notes')
    def notes(identifier: UUID):
        return {'items': store.list_notes(str(identifier))}

    @app.post('/api/v1/documents/{identifier}/notes')
    def save_note(identifier: UUID, payload: NoteCreate):
        note, created = store.save_note(str(identifier), payload)
        return JSONResponse(note, status_code=201 if created else 200)

    @app.get('/api/v1/documents/{identifier}/excerpts')
    def excerpts(identifier: UUID):
        return {'items': store.list_excerpts(str(identifier))}

    @app.get('/api/v1/documents/{identifier}/note-states')
    def note_states(identifier: UUID):
        return {'items': store.lifecycle.list(str(identifier))}

    @app.get('/api/v1/documents/{identifier}/notes/{note_id}/state')
    def note_state(identifier: UUID, note_id: UUID):
        return store.lifecycle.get(str(identifier), str(note_id))

    @app.patch('/api/v1/documents/{identifier}/notes/{note_id}')
    def update_note(identifier: UUID, note_id: UUID, payload: NoteUpdate):
        return store.lifecycle.mutate(str(identifier), str(note_id), 'patch', payload)

    @app.delete('/api/v1/documents/{identifier}/notes/{note_id}')
    def delete_note(identifier: UUID, note_id: UUID, payload: NoteMutation):
        return store.lifecycle.mutate(str(identifier), str(note_id), 'delete', payload)

    @app.post('/api/v1/documents/{identifier}/notes/{note_id}/restore')
    def restore_note(identifier: UUID, note_id: UUID, payload: NoteMutation):
        return store.lifecycle.mutate(str(identifier), str(note_id), 'restore', payload)

    @app.post('/api/v1/documents/{identifier}/notes/{note_id}/excerpt')
    def create_excerpt(identifier: UUID, note_id: UUID):
        record, created = app.state.excerpts.create(str(identifier), str(note_id))
        return JSONResponse(record, status_code=201 if created else 200)

    @app.get('/api/v1/documents/{identifier}/notes/{note_id}/excerpt')
    def excerpt_image(identifier: UUID, note_id: UUID):
        record = store.get_excerpt(str(identifier), str(note_id))
        if record is None:
            raise WorkspaceError('not_found', '这条笔记尚无图表摘录。', 404)
        verify_excerpt_source(record, store.get_document(str(identifier)))
        return FileResponse(checked_image(store, record), media_type='image/png',
                            filename=f'page-{record["page"]}-{note_id}.png', content_disposition_type='inline')

    @app.get('/api/v1/documents/{identifier}/export')
    def export_reading(identifier: UUID):
        path, filename = build_export(store, str(identifier))
        return ExportResponse(path, media_type='application/zip', filename=filename)

    @app.get('/api/v1/documents/{identifier}/export/annotated.pdf')
    def export_annotated_pdf(identifier: UUID):
        path, filename = app.state.annotated_pdf.build(str(identifier))
        return ExportResponse(path, media_type='application/pdf', filename=filename,
                              headers={'Cache-Control': 'no-store'})

    app.include_router(agent_router)
    app.include_router(reader_errors_router)
    app.include_router(reader_source_router)
    app.include_router(agent_reference_router)
    app.include_router(analysis_router)
    from .device_pages import FrontendFiles, install_device_pages
    install_device_pages(app, ROOT / 'frontend')
    app.mount('/', FrontendFiles(directory=ROOT / 'frontend', html=True), name='reader')
    return app
