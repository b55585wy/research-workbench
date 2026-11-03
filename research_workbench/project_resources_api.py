from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from .project_resources import (DEFAULT_LIMIT, MAX_CURSOR, MAX_LIMIT, MAX_QUERY,
                                ResourceAdd, ResourceRemove)

router = APIRouter(prefix='/api/v1/studies')


@router.get('/{study_id}/resources')
def resources(study_id: UUID, request: Request):
    return request.app.state.project_resources.list(str(study_id))


@router.get('/{study_id}/resource-candidates')
def resource_candidates(study_id: UUID, request: Request,
                        kind: Literal['dataset', 'analysis', 'chart'] = Query(...),
                        q: str = Query(default='', max_length=MAX_QUERY),
                        limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
                        cursor: str | None = Query(default=None, max_length=MAX_CURSOR)):
    return request.app.state.project_resources.candidates(str(study_id), kind, q, limit, cursor)


@router.post('/{study_id}/resources')
def add_resource(study_id: UUID, payload: ResourceAdd, request: Request):
    value, created = request.app.state.project_resources.add(str(study_id), payload)
    return JSONResponse(value, status_code=201 if created else 200)


@router.delete('/{study_id}/resources/{link_id}')
def remove_resource(study_id: UUID, link_id: UUID, payload: ResourceRemove, request: Request):
    return request.app.state.project_resources.remove(str(study_id), str(link_id), payload)
