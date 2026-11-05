"""Read-only probe for the browser's separate server-PDF cache namespace.

The response never contains a filesystem path, cookie, token or key.  The
``cache_scope`` value is a stable opaque namespace derived from the current
canonical Store root; it is a cache key only and never authentication.  The
probe never hashes or reads the PDF bytes and never writes rows, jobs or files.
"""
from functools import lru_cache
import hashlib
import stat
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .models import WorkspaceError

SCOPE_PREFIX = b'research-workbench/server-pdf-cache/v1\x00'

router = APIRouter(prefix='/api/v1')


@lru_cache(maxsize=8)
def cache_scope(root):
    """Stable 64-lowercase-hex namespace for one canonical store root."""
    return hashlib.sha256(SCOPE_PREFIX + str(root).encode('utf-8')).hexdigest()


def unavailable():
    return WorkspaceError('file_missing', '原 PDF 缺失，暂时无法读取。', 409)


def probe(store, identifier):
    document = store.get_document(identifier)
    if document.get('kind') == 'study':
        raise WorkspaceError('source_has_no_pdf', '这项研究没有原始 PDF，请打开关联文献。', 409)
    if document.get('page_count') is None or document.get('byte_size') is None:
        raise unavailable()
    path = store.files / f'{document["id"]}.pdf'
    try:
        info = path.stat()
    except OSError:
        raise unavailable() from None
    if not stat.S_ISREG(info.st_mode):
        raise unavailable()
    if info.st_size != document['byte_size']:
        # The recorded source changed on disk; a caller must drop any cached copy.
        raise WorkspaceError('source_changed', '原 PDF 已变化，请核对资料后重试。', 409)
    return {'cache_scope': cache_scope(store.root), 'document': document}


@router.get('/documents/{document_id}/reader-source')
def reader_source(document_id: UUID, request: Request):
    result = probe(request.app.state.store, str(document_id))
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})
