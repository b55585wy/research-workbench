from uuid import UUID

from fastapi import APIRouter, Request

from .presentation_models import ExportRequest, OutlineRequest, PresentationSelectors
from .reading_export import ExportResponse

PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
router = APIRouter(prefix='/api/v1')


@router.get('/presentations/capabilities')
def capabilities(request: Request):
    return request.app.state.presentations.capabilities()


@router.post('/documents/{document_id}/presentations/context')
def context(document_id: UUID, payload: PresentationSelectors, request: Request):
    return request.app.state.presentations.context(str(document_id), payload)


@router.post('/documents/{document_id}/presentations/outline')
def outline(document_id: UUID, payload: OutlineRequest, request: Request):
    return request.app.state.presentations.outline(str(document_id), payload)


@router.post('/documents/{document_id}/presentations/export')
def export(document_id: UUID, payload: ExportRequest, request: Request):
    path, name = request.app.state.presentations.export(str(document_id), payload)
    return ExportResponse(path, media_type=PPTX_MEDIA_TYPE, filename=name,
                          headers={'Cache-Control': 'no-store'})
