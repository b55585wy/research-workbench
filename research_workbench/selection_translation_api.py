"""Frozen HTTP surface for bounded selected-text translation; local boundary applies."""
from uuid import UUID

from fastapi import APIRouter, Request

from .selection_translation import SelectionTranslationRequest

router = APIRouter(prefix='/api/v1')


@router.post('/documents/{document_id}/selection-translation')
def translate(document_id: UUID, payload: SelectionTranslationRequest, request: Request):
    return request.app.state.selection_translation.translate(str(document_id), payload)
