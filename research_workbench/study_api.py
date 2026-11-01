from uuid import UUID
from fastapi import APIRouter,Request,Query
from fastapi.responses import JSONResponse
from .studies import StudyCreate,PaperLink

router=APIRouter(prefix='/api/v1/studies')

@router.get('')
def studies(request:Request):return {'items':request.app.state.studies.list()}

@router.post('')
def create(payload:StudyCreate,request:Request):
    value,created=request.app.state.studies.create(payload);return JSONResponse(value,status_code=201 if created else 200)

@router.get('/{study_id}')
def study(study_id:UUID,request:Request):return request.app.state.studies.get(str(study_id))

@router.get('/{study_id}/papers')
def papers(study_id:UUID,request:Request):return {'items':request.app.state.studies.papers(str(study_id))}

@router.post('/{study_id}/papers')
def link(study_id:UUID,payload:PaperLink,request:Request):
    value,created=request.app.state.studies.link(str(study_id),payload);return JSONResponse(value,status_code=201 if created else 200)

@router.delete('/{study_id}/papers/{paper_id}')
def unlink(study_id:UUID,paper_id:UUID,request:Request,sha256:str=Query(pattern=r'^[0-9a-f]{64}$')):
    return request.app.state.studies.unlink(str(study_id),str(paper_id),sha256)
