from typing import Literal
from uuid import UUID
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse,Response
from .chart_models import ChartCreate,ChartMutation
from .chart_export import build_chart_export
from .reading_export import ExportResponse

router=APIRouter(prefix='/api/v1')


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
