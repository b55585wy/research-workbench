"""Frozen HTTP surface for mobile paragraph reading; local boundary applies."""
import asyncio
import threading
from uuid import UUID

from fastapi import APIRouter, Query, Request

from .reading_pages import ReadingPrepare

router = APIRouter(prefix='/api/v1')


@router.get('/reading-capabilities')
def capabilities(request: Request):
    return request.app.state.reading_pages.capabilities()


@router.get('/documents/{document_id}/reading-pages')
def reading_pages(document_id: UUID, request: Request,
                  source_sha256: str = Query(pattern=r'^[0-9a-f]{64}$'),
                  pages: str = Query(min_length=1, max_length=32)):
    return request.app.state.reading_pages.read(str(document_id), source_sha256, pages)


def settle(task):
    """Retrieve a late failure when the request handler is cancelled first."""
    if not task.cancelled():
        task.exception()


@router.post('/documents/{document_id}/reading-pages/prepare')
async def prepare(document_id: UUID, payload: ReadingPrepare, request: Request):
    service = request.app.state.reading_pages
    cancel = threading.Event()
    work = asyncio.create_task(asyncio.to_thread(
        service.prepare, str(document_id), payload.source_sha256, payload.pages, cancel))
    work.add_done_callback(settle)
    try:
        while not work.done():
            if await request.is_disconnected():
                # Abort the owned worker; the preparation slot is released only
                # after its subprocess and private scratch are actually gone.
                cancel.set()
                break
            await asyncio.wait({work}, timeout=.25)
        return await work
    except asyncio.CancelledError:
        cancel.set()
        raise
