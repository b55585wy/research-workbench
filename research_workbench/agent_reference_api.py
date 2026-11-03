from typing import Literal

from fastapi import APIRouter, Query, Request

from .agent_references import MAX_CURSOR, MAX_LIMIT, MAX_LIMIT_DEFAULT, MAX_QUERY

router = APIRouter(prefix='/api/v1')


@router.get('/agent/reference-catalog')
def reference_catalog(request: Request,
                       kind: Literal['paper', 'dataset'] = Query(...),
                       q: str = Query(default='', max_length=MAX_QUERY),
                       limit: int = Query(default=MAX_LIMIT_DEFAULT, ge=1, le=MAX_LIMIT),
                       cursor: str | None = Query(default=None, max_length=MAX_CURSOR)):
    return request.app.state.reference_catalog.catalog(kind, limit, q, cursor)
