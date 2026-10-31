from uuid import UUID
from fastapi.responses import JSONResponse,Response
from .image_annotation_models import SourceKind,ImageAnnotationCreate,ImageAnnotationUpdate,ImageAnnotationMutation


def install_image_annotation_routes(app,service):
    prefix='/api/v1/documents/{document_id}/image-sources/{source_kind}/{source_id}'

    @app.get(prefix)
    def image_source(document_id:UUID,source_kind:SourceKind,source_id:UUID):
        value,_=service.view(str(document_id),source_kind,str(source_id));return value

    @app.get(prefix+'/frame')
    def image_frame(document_id:UUID,source_kind:SourceKind,source_id:UUID):
        value,data=service.view(str(document_id),source_kind,str(source_id));source=value['source']
        return Response(data,media_type=source['frame_mime_type'],headers={'Cache-Control':'no-store','X-Content-Sha256':source['frame_sha256']})

    @app.post(prefix+'/annotations')
    def create_annotation(document_id:UUID,source_kind:SourceKind,source_id:UUID,payload:ImageAnnotationCreate):
        value,created=service.create(str(document_id),source_kind,str(source_id),payload)
        return JSONResponse(value,status_code=201 if created else 200)

    @app.patch(prefix+'/annotations/{annotation_id}')
    def update_annotation(document_id:UUID,source_kind:SourceKind,source_id:UUID,annotation_id:UUID,payload:ImageAnnotationUpdate):
        return service.mutate(str(document_id),source_kind,str(source_id),str(annotation_id),'patch',payload)

    @app.delete(prefix+'/annotations/{annotation_id}')
    def delete_annotation(document_id:UUID,source_kind:SourceKind,source_id:UUID,annotation_id:UUID,payload:ImageAnnotationMutation):
        return service.mutate(str(document_id),source_kind,str(source_id),str(annotation_id),'delete',payload)

    @app.post(prefix+'/annotations/{annotation_id}/restore')
    def restore_annotation(document_id:UUID,source_kind:SourceKind,source_id:UUID,annotation_id:UUID,payload:ImageAnnotationMutation):
        return service.mutate(str(document_id),source_kind,str(source_id),str(annotation_id),'restore',payload)
