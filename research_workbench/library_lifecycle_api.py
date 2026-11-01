from uuid import UUID
from fastapi import APIRouter, Request
from .models import NoteMutation

router = APIRouter(prefix='/api/v1')


@router.get('/documents/trash')
def trashed_documents(request: Request):
    return {'items': request.app.state.store.paper_trash.list()}


@router.delete('/documents/{identifier}')
def trash_document(identifier: UUID, payload: NoteMutation, request: Request):
    return request.app.state.store.paper_trash.mutate(str(identifier), 'trash', payload)


@router.post('/documents/{identifier}/restore')
def restore_document(identifier: UUID, payload: NoteMutation, request: Request):
    return request.app.state.store.paper_trash.mutate(str(identifier), 'restore', payload)


@router.post('/documents/{identifier}/notes/{note_id}/purge')
def purge_note(identifier: UUID, note_id: UUID, payload: NoteMutation, request: Request):
    return request.app.state.store.note_purge.purge(str(identifier), str(note_id), payload)
