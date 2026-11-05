from typing import Literal
from uuid import UUID
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse,Response
from pydantic import ValidationError
from .agent_store import canonical
from .chart_models import ChartCreate,ChartMutation
from .chart_skill_models import MAX_SKILL_BYTES,ChartSkillCreate,ChartSkillVersionCreate
from .chart_export import build_chart_export
from .models import WorkspaceError
from .reading_export import ExportResponse

router=APIRouter(prefix='/api/v1')


async def skill_payload(request,model):
    raw=await request.body()
    if len(raw)>MAX_SKILL_BYTES:raise WorkspaceError('chart_skill_invalid','绘图 skill 文件过大。',422)
    try:return model.model_validate_json(raw)
    except ValidationError:raise WorkspaceError('chart_skill_invalid','请检查绘图 skill 内容。',422) from None


@router.get('/chart-skills')
def skill_list(request:Request):return request.app.state.charts.skills.list()


@router.get('/chart-skills/{skill_id}')
def skill_get(skill_id:UUID,request:Request):return request.app.state.charts.skills.get(str(skill_id))


@router.post('/chart-skills')
async def skill_create(request:Request):
    payload=await skill_payload(request,ChartSkillCreate)
    value,created=request.app.state.charts.skills.create(payload)
    return JSONResponse(value,status_code=201 if created else 200)


@router.post('/chart-skills/{skill_id}/versions')
async def skill_version(skill_id:UUID,request:Request):
    payload=await skill_payload(request,ChartSkillVersionCreate)
    value,created=request.app.state.charts.skills.versions(str(skill_id),payload)
    return JSONResponse(value,status_code=201 if created else 200)


@router.get('/chart-skills/{skill_id}/export')
def skill_export(skill_id:UUID,request:Request):
    spec,name=request.app.state.charts.skills.export(str(skill_id))
    return Response(canonical(spec).encode(),media_type='application/json',
        headers={'Content-Disposition':f'attachment; filename="{name}"','Cache-Control':'no-store'})


@router.get('/charts/capabilities')
def capabilities(request:Request):return request.app.state.charts.capabilities()


@router.get('/documents/{document_id}/charts')
def charts(document_id:UUID,request:Request):return {'items':request.app.state.charts.list(str(document_id))}


@router.post('/documents/{document_id}/charts/preview')
def preview(document_id:UUID,payload:ChartCreate,request:Request):return request.app.state.charts.preview(str(document_id),payload)


@router.post('/documents/{document_id}/charts')
def create(document_id:UUID,payload:ChartCreate,request:Request):
    value,created=request.app.state.charts.create(str(document_id),payload)
    return JSONResponse(value,status_code=201 if created else 200)


@router.get('/documents/{document_id}/charts/{chart_id}')
def chart(document_id:UUID,chart_id:UUID,request:Request):return request.app.state.charts.get(str(document_id),str(chart_id))


@router.get('/documents/{document_id}/charts/{chart_id}/data')
def data(document_id:UUID,chart_id:UUID,request:Request):
    chart,raw=request.app.state.charts.data(str(document_id),str(chart_id))
    return Response(raw,media_type='application/json',headers={'Cache-Control':'no-store','X-Content-Sha256':chart['data_sha256']})


@router.delete('/documents/{document_id}/charts/{chart_id}')
def delete(document_id:UUID,chart_id:UUID,payload:ChartMutation,request:Request):return request.app.state.charts.mutate(str(document_id),str(chart_id),'delete',payload)


@router.post('/documents/{document_id}/charts/{chart_id}/restore')
def restore(document_id:UUID,chart_id:UUID,payload:ChartMutation,request:Request):return request.app.state.charts.mutate(str(document_id),str(chart_id),'restore',payload)


@router.get('/documents/{document_id}/charts/{chart_id}/export')
def export(document_id:UUID,chart_id:UUID,request:Request,style:Literal['default','nature','cell']|None=None):
    path,name=build_chart_export(request.app.state.charts,str(document_id),str(chart_id),style)
    return ExportResponse(path,media_type='application/zip',filename=name)
