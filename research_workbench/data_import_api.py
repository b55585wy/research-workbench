from typing import Annotated,Literal
from uuid import UUID
from fastapi import APIRouter,File,Form,Request,UploadFile
from fastapi.responses import FileResponse,JSONResponse
from pydantic import BaseModel,ConfigDict,Field,field_validator

router=APIRouter(prefix='/api/v1')
Checksum=Annotated[str,Field(pattern=r'^[0-9a-f]{64}$')]


class ImportConfirm(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    source_sha256:Checksum
    review_sha256:Checksum
    acknowledge:Literal[True]

    @field_validator('acknowledge',mode='before')
    @classmethod
    def explicit_acknowledgment(cls,value):
        if value is not True:raise ValueError('Explicit acknowledgment required')
        return value


@router.get('/data-imports/status')
def status(request:Request):return request.app.state.data_imports.runtime.status()


@router.get('/documents/{document_id}/data-imports')
def imports(document_id:UUID,request:Request):return {'items':request.app.state.data_imports.list(str(document_id))}


@router.post('/documents/{document_id}/data-imports')
def upload(document_id:UUID,request:Request,file:UploadFile=File(...),request_id:UUID=Form(...)):
    value,created=request.app.state.data_imports.upload(str(document_id),str(request_id),file)
    return JSONResponse(value,status_code=201 if created else 200)


@router.get('/documents/{document_id}/data-imports/{identifier}')
def imported(document_id:UUID,identifier:UUID,request:Request):return request.app.state.data_imports.get(str(document_id),str(identifier))


@router.get('/documents/{document_id}/data-imports/{identifier}/file')
def original(document_id:UUID,identifier:UUID,request:Request):
    service=request.app.state.data_imports;value=service.get(str(document_id),str(identifier))
    return FileResponse(service.path(str(document_id),str(identifier)),media_type='application/octet-stream',filename=value['original_filename'])


@router.post('/documents/{document_id}/data-imports/{identifier}/confirm')
def confirm(document_id:UUID,identifier:UUID,payload:ImportConfirm,request:Request):
    value,created=request.app.state.data_imports.confirm(str(document_id),str(identifier),payload)
    return JSONResponse(value,status_code=201 if created else 200)
