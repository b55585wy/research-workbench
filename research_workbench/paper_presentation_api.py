"""Feature-specific paper-presentation API family (additive alias only).

The existing ``/api/v1/presentations/*`` endpoints and their request receipts
stay exactly as deployed.  This router exposes the same validated operations
under ``/api/v1/paper-presentations/*`` and refuses a request that does not
explicitly opt into the paper source; it never falls back to the legacy routes.

Every response is JSON or the existing editable ``.pptx`` download.  Errors are
the shared ``WorkspaceError``/validation envelopes and never echo request
bodies, credentials or filesystem paths.
"""
from uuid import UUID

from fastapi import APIRouter, Request

from .models import WorkspaceError
from .presentation_models import ExportRequest, OutlineRequest, PresentationSelectors
from .reading_export import ExportResponse

PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
API_FAMILY = 'paper-presentations/v1'
FROZEN_PAPER_LIMITS = {'paper_pages': 60, 'paper_chars': 120000,
                       'paper_context_chars': 140000}
router = APIRouter(prefix='/api/v1')


def _service(request):
    """Per-request service (companion) or the app-wide one (local/full app)."""
    service = getattr(request.state, 'paper_presentation', None)
    if service is not None:
        return service
    service = getattr(request.app.state, 'presentations', None)
    if service is None:
        raise WorkspaceError('paper_presentation_unavailable',
                             '论文演示文稿服务暂不可用，请稍后重试。', 503)
    return service


def _require_paper(payload):
    # Only an explicit paper request uses this family.  There is no automatic
    # retry through the older endpoint when the flag is omitted or false.
    if payload.include_paper is not True:
        raise WorkspaceError('paper_required',
                             '论文演示文稿需要选择论文来源，请勾选论文后再试。', 422)


@router.get('/paper-presentations/capabilities')
def capabilities(request: Request):
    value = dict(_service(request).capabilities())
    limits = dict(value.get('limits') or {})
    limits.update(FROZEN_PAPER_LIMITS)
    value.update({'api_family': API_FAMILY, 'paper_available': True,
                  'limits': limits})
    return value


@router.post('/documents/{document_id}/paper-presentations/context')
def context(document_id: UUID, payload: PresentationSelectors, request: Request):
    _require_paper(payload)
    return _service(request).context(str(document_id), payload)


@router.post('/documents/{document_id}/paper-presentations/outline')
def outline(document_id: UUID, payload: OutlineRequest, request: Request):
    _require_paper(payload)
    return _service(request).outline(str(document_id), payload)


@router.post('/documents/{document_id}/paper-presentations/export')
def export(document_id: UUID, payload: ExportRequest, request: Request):
    _require_paper(payload)
    path, name = _service(request).export(str(document_id), payload)
    return ExportResponse(path, media_type=PPTX_MEDIA_TYPE, filename=name,
                          headers={'Cache-Control': 'no-store'})
