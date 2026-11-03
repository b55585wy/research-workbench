from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from .translation import TranslationCancel, TranslationCreate

router = APIRouter(prefix='/api/v1')


@router.get('/translation-capabilities')
def capabilities(request: Request):
    return request.app.state.translations.capabilities()


@router.get('/documents/{document_id}/translations')
def saved(document_id: UUID, request: Request, limit: int = Query(20, ge=1, le=20)):
    return {'items': request.app.state.translations.list(str(document_id), limit)}


@router.post('/documents/{document_id}/translations')
def create(document_id: UUID, payload: TranslationCreate, request: Request):
    job, created = request.app.state.translations.create(str(document_id), payload)
    return JSONResponse(job, status_code=201 if created else 200)


@router.get('/translations/{job_id}')
def detail(job_id: UUID, request: Request):
    return request.app.state.translations.get(str(job_id))


@router.post('/translations/{job_id}/cancel')
def cancel(job_id: UUID, payload: TranslationCancel, request: Request):
    return request.app.state.translations.cancel(str(job_id))
