from uuid import UUID
from fastapi import APIRouter, Query, Request
from .record_models import RecordSpec
from .reading_export import ExportResponse

router = APIRouter(prefix='/api/v1/documents/{document_id}/research-records')


@router.get('/options')
def options(document_id: UUID, dataset_id: UUID, request: Request,
            dataset_sha256: str = Query(pattern=r'^[0-9a-f]{64}$')):
    return request.app.state.records.options(str(document_id), str(dataset_id), dataset_sha256)


@router.post('/preview')
def preview(document_id: UUID, payload: RecordSpec, request: Request):
    return request.app.state.records.preview(str(document_id), payload)


@router.get('/download')
def download(document_id: UUID, request: Request, token: str = Query(min_length=1, max_length=2048)):
    path, name = request.app.state.records.download(str(document_id), token)
    return ExportResponse(path, media_type='application/zip', filename=name)
