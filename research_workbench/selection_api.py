from uuid import UUID
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from .selection_models import SelectionValues, SelectionSpec, SelectionCreate

router = APIRouter(prefix='/api/v1')


@router.get('/dataset-selections/capabilities')
def capabilities(request: Request): return request.app.state.selections.capabilities()


@router.post('/documents/{document_id}/dataset-selections/values')
def values(document_id: UUID, payload: SelectionValues, request: Request):
    return request.app.state.selections.values(str(document_id), payload)


@router.post('/documents/{document_id}/dataset-selections/preview')
def preview(document_id: UUID, payload: SelectionSpec, request: Request):
    return request.app.state.selections.preview(str(document_id), payload)


@router.post('/documents/{document_id}/dataset-selections')
def create(document_id: UUID, payload: SelectionCreate, request: Request):
    value, created = request.app.state.selections.create(str(document_id), payload)
    return JSONResponse(value, status_code=201 if created else 200)


@router.get('/documents/{document_id}/datasets/{dataset_id}/selection')
def lineage(document_id: UUID, dataset_id: UUID, request: Request):
    return request.app.state.selections.lineage(str(document_id), str(dataset_id))
