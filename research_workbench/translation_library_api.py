"""HTTP surface for the bounded translation history list.

The router only reads the current Store's saved metadata.  It never starts
parser/model work, never creates a task or child, never writes a row and never
echoes credentials, so opening history cannot spend model credit.  Guest
isolation is the existing one-Store-per-space boundary: the query is bound to
``request.app.state.store`` and there is no cross-space lookup.
"""
from fastapi import APIRouter, Query, Request

from .translation_library import (
    DEFAULT_LIMIT, MAX_LIMIT, MAX_OFFSET, MAX_QUERY, TranslationLibrary,
)

router = APIRouter(prefix='/api/v1')


@router.get('/library/translations')
def translations(request: Request,
                 limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
                 offset: int = Query(0, ge=0, le=MAX_OFFSET),
                 q: str = Query('', max_length=MAX_QUERY)):
    return TranslationLibrary(request.app.state.store).list(limit, offset, q)
