from uuid import UUID

from fastapi import APIRouter,File,Form,Request,UploadFile
from fastapi.responses import FileResponse,JSONResponse

from .agent_models import AgentSubmission,ImageNoteCreate,ModelSettings,ProposalConfirmation,TaskControl

router=APIRouter(prefix='/api/v1')


@router.get('/documents/{document_id}/images')
def images(document_id:UUID,request:Request):
    return {'items':request.app.state.images.list(str(document_id))}


@router.post('/documents/{document_id}/images')
def upload_image(document_id:UUID,request:Request,file:UploadFile=File(...),request_id:UUID=Form(...)):
    image,created=request.app.state.images.upload(str(document_id),str(request_id),file)
    return JSONResponse(image,status_code=201 if created else 200)


def image_response(document_id,image_id,request,preview):
    service=request.app.state.images
    record=service.get(str(document_id),str(image_id))
    return FileResponse(service.path(str(document_id),str(image_id),preview),
        media_type=record['preview_mime_type' if preview else 'mime_type'],
        filename=record['original_filename'],content_disposition_type='inline')


@router.get('/documents/{document_id}/images/{image_id}/file')
def original_image(document_id:UUID,image_id:UUID,request:Request):
    return image_response(document_id,image_id,request,False)


@router.get('/documents/{document_id}/images/{image_id}/preview')
def preview_image(document_id:UUID,image_id:UUID,request:Request):
    return image_response(document_id,image_id,request,True)


@router.post('/documents/{document_id}/image-notes')
def save_image_note(document_id:UUID,payload:ImageNoteCreate,request:Request):
    note,created=request.app.state.images.create_note(str(document_id),payload)
    return JSONResponse(note,status_code=201 if created else 200)


@router.get('/agent/status')
def status(request:Request):
    return request.app.state.agent.status()


@router.post('/agent/settings')
def settings(payload:ModelSettings,request:Request):
    return request.app.state.agent.provider.save(payload)


@router.get('/documents/{document_id}/agent/conversations')
def conversations(document_id:UUID,request:Request):
    return {'items':request.app.state.agent.store.conversations(str(document_id))}


@router.get('/documents/{document_id}/agent/conversations/{conversation_id}')
def conversation(document_id:UUID,conversation_id:UUID,request:Request):
    return request.app.state.agent.store.history(str(document_id),str(conversation_id))


@router.post('/documents/{document_id}/agent/turns',status_code=202)
def submit(document_id:UUID,payload:AgentSubmission,request:Request):
    return request.app.state.agent.submit(str(document_id),payload)


@router.get('/documents/{document_id}/agent/tasks')
def tasks(document_id:UUID,request:Request,conversation_id:UUID|None=None):
    return {'items':request.app.state.agent.tasks.list(str(document_id),str(conversation_id) if conversation_id else None)}


@router.get('/documents/{document_id}/agent/tasks/{task_id}')
def task(document_id:UUID,task_id:UUID,request:Request):
    return request.app.state.agent.tasks.get(str(document_id),str(task_id))


@router.post('/documents/{document_id}/agent/tasks/{task_id}/control')
def control_task(document_id:UUID,task_id:UUID,payload:TaskControl,request:Request):
    result=request.app.state.agent.tasks.control(str(document_id),str(task_id),payload)
    request.app.state.agent.wake.set()
    return result


@router.get('/documents/{document_id}/agent/turns/{turn_id}')
def turn(document_id:UUID,turn_id:UUID,request:Request):
    return request.app.state.agent.store.get(str(document_id),str(turn_id))


@router.post('/documents/{document_id}/agent/turns/{turn_id}/cancel')
def cancel(document_id:UUID,turn_id:UUID,request:Request):
    return request.app.state.agent.store.cancel(str(document_id),str(turn_id))


@router.post('/documents/{document_id}/agent/turns/{turn_id}/proposals/{proposal_id}/confirm')
def confirm(document_id:UUID,turn_id:UUID,proposal_id:UUID,payload:ProposalConfirmation,request:Request):
    return request.app.state.agent.confirm(str(document_id),str(turn_id),str(proposal_id),payload)
