"""HTTP surface for explicitly authorized continuous translation runs.

The router only reads metadata or records an explicit control request.  It never
starts parser/model work: only the existing exclusive translation worker advances
a run, so GET/poll/refresh cannot create a child or spend model credit.
"""
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from .translation_run_schema import TranslationRunControl, TranslationRunCreate

router = APIRouter(prefix='/api/v1')


def runs(request: Request):
    return request.app.state.translations.runs


@router.get('/documents/{document_id}/translation-runs')
def saved(document_id: UUID, request: Request, limit: int = Query(20, ge=1, le=20)):
    return {'items': runs(request).list(str(document_id), limit)}


@router.post('/documents/{document_id}/translation-runs')
def create(document_id: UUID, payload: TranslationRunCreate, request: Request):
    run, created = runs(request).create(str(document_id), payload)
    return JSONResponse(run, status_code=201 if created else 200)


@router.get('/translation-runs/{run_id}')
def detail(run_id: UUID, request: Request, page: int | None = Query(None, ge=1)):
    return runs(request).get(str(run_id), page)


@router.post('/translation-runs/{run_id}/pause')
def pause(run_id: UUID, payload: TranslationRunControl, request: Request):
    return runs(request).pause(str(run_id), payload)


@router.post('/translation-runs/{run_id}/resume')
def resume(run_id: UUID, payload: TranslationRunControl, request: Request):
    return runs(request).resume(str(run_id), payload)
