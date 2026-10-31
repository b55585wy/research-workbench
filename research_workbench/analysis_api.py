from uuid import UUID
from fastapi import APIRouter,File,Form,Request,UploadFile
from fastapi.responses import FileResponse,JSONResponse,Response

from .analysis_export import build_analysis_export
from .analysis_models import AnalysisCreate
from .statistics_models import GroupRequest
from .statistics_service import methods,groups,preview
from .analysis_recipes import recipe
from .analysis_notebook import saved_notebook
from .reading_export import ExportResponse

router=APIRouter(prefix='/api/v1')


@router.get('/analysis/status')
def status(request:Request):
    service=request.app.state.analysis
    return {'engines':service.catalog.engines(),'recipe_id':'describe-v1','recipe_version':1,
        'limits':{'file_bytes':5242880,'rows':50000,'columns':50,'seconds':30},
        'worker_state':service.supervisor.state() if service.supervisor else 'idle','scope':'local_research','arbitrary_code':False}


@router.get('/analysis/recipes/{engine}')
def code(engine:str,method:str='describe'):return recipe(engine,method)


@router.get('/analysis/methods')
def installed_methods(request:Request):return methods(request.app.state.analysis)


@router.post('/documents/{document_id}/analyses/ttest/groups')
def group_labels(document_id:UUID,payload:GroupRequest,request:Request):
    return groups(request.app.state.analysis,str(document_id),payload)


@router.post('/documents/{document_id}/analyses/ttest/preview')
def statistics_preview(document_id:UUID,payload:AnalysisCreate,request:Request):
    return preview(request.app.state.analysis,str(document_id),payload)


@router.get('/documents/{document_id}/datasets')
def datasets(document_id:UUID,request:Request):return {'items':request.app.state.datasets.list(str(document_id))}


@router.post('/documents/{document_id}/datasets')
def upload(document_id:UUID,request:Request,file:UploadFile=File(...),request_id:UUID=Form(...)):
    value,created=request.app.state.datasets.upload(str(document_id),str(request_id),file)
    return JSONResponse(value,status_code=201 if created else 200)


@router.get('/documents/{document_id}/datasets/{dataset_id}')
def dataset(document_id:UUID,dataset_id:UUID,request:Request):return request.app.state.datasets.get(str(document_id),str(dataset_id))


@router.get('/documents/{document_id}/datasets/{dataset_id}/file')
def dataset_file(document_id:UUID,dataset_id:UUID,request:Request):
    service=request.app.state.datasets;value=service.get(str(document_id),str(dataset_id))
    return FileResponse(service.path(str(document_id),str(dataset_id)),media_type='application/octet-stream',filename=value['original_filename'])


@router.get('/documents/{document_id}/analyses')
def jobs(document_id:UUID,request:Request):return {'items':request.app.state.analysis.list(str(document_id))}


@router.post('/documents/{document_id}/analyses')
def create(document_id:UUID,payload:AnalysisCreate,request:Request):
    value,created=request.app.state.analysis.create(str(document_id),payload)
    return JSONResponse(value,status_code=201 if created else 200)


@router.get('/documents/{document_id}/analyses/{analysis_id}')
def job(document_id:UUID,analysis_id:UUID,request:Request):return request.app.state.analysis.get(str(document_id),str(analysis_id))


@router.post('/documents/{document_id}/analyses/{analysis_id}/cancel')
def cancel(document_id:UUID,analysis_id:UUID,request:Request):return request.app.state.analysis.cancel(str(document_id),str(analysis_id))


@router.get('/documents/{document_id}/analyses/{analysis_id}/log')
def log(document_id:UUID,analysis_id:UUID,request:Request):return request.app.state.analysis.log(str(document_id),str(analysis_id))


@router.get('/documents/{document_id}/analyses/{analysis_id}/files/{name}')
def artifact(document_id:UUID,analysis_id:UUID,name:str,request:Request):
    path,record=request.app.state.analysis.file(str(document_id),str(analysis_id),name)
    return FileResponse(path,media_type=record['media_type'],filename=record['name'],
        content_disposition_type='inline' if name=='chart.svg' else 'attachment')


@router.get('/documents/{document_id}/analyses/{analysis_id}/export')
def export(document_id:UUID,analysis_id:UUID,request:Request):
    path,name=build_analysis_export(request.app.state.analysis,str(document_id),str(analysis_id))
    return ExportResponse(path,media_type='application/zip',filename=name)


@router.get('/documents/{document_id}/analyses/{analysis_id}/notebook')
def notebook(document_id:UUID,analysis_id:UUID,request:Request):
    _,data=saved_notebook(request.app.state.analysis,str(document_id),str(analysis_id))
    return Response(data,media_type='application/x-ipynb+json',headers={
        'Content-Disposition':f'attachment; filename="analysis-{analysis_id}.ipynb"','Cache-Control':'no-store'})
