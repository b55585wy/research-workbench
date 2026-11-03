from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from .data_workspace import MAX_LIMIT, MAX_LIMIT_DEFAULT, MAX_QUERY, PersonalCreate

router = APIRouter(prefix='/api/v1/data-workspace')


@router.get('/personal')
def personal(request: Request):
    return {'owner': request.app.state.data_workspace.personal()}


@router.post('/personal')
def ensure_personal(payload: PersonalCreate, request: Request):
    owner, created = request.app.state.data_workspace.ensure_personal()
    return JSONResponse({'owner': owner}, status_code=201 if created else 200)


@router.get('/catalog')
def catalog(request: Request,
            kind: Literal['dataset', 'analysis', 'chart'] = Query(...),
            limit: int = Query(default=MAX_LIMIT_DEFAULT, ge=1, le=MAX_LIMIT),
            cursor: str | None = Query(default=None, max_length=2048),
            q: str = Query(default='', max_length=MAX_QUERY)):
    return request.app.state.data_workspace.catalog(kind, limit, cursor, q)
