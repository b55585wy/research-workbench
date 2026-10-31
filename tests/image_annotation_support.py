from uuid import uuid4
from agent_support import upload_image


def source_url(doc,kind,source_id):return f"/api/v1/documents/{doc['id']}/image-sources/{kind}/{source_id}"


def make_source(c,app,doc,kind='user_upload',content=None):
    if kind=='user_upload':
        response=upload_image(c,doc,content=content);assert response.status_code==201,response.text
        original=response.json();identifier=original['id']
    else:
        response=c.post(f"/api/v1/documents/{doc['id']}/notes",json={'request_id':str(uuid4()),'page':1,'rect':[.1,.1,.6,.4],'text':'Synthetic PDF excerpt parent'})
        assert response.status_code==201,response.text;original=response.json();identifier=original['id']
        response=c.post(f"/api/v1/documents/{doc['id']}/notes/{identifier}/excerpt");assert response.status_code==201,response.text
    url=source_url(doc,kind,identifier);response=c.get(url);assert response.status_code==200,response.text
    return response.json()['source'],original,url


def create(c,source,url,**changes):
    payload={'request_id':str(uuid4()),'source_sha256':source['source_sha256'],'frame_sha256':source['frame_sha256'],
             'rect':[.1,.2,.6,.7],'text':'Synthetic image region description'}
    payload.update(changes);return c.post(url+'/annotations',json=payload),payload


def mutate(c,source,url,item,action='patch',**changes):
    payload={'request_id':str(uuid4()),'expected_revision':item['revision'],'source_sha256':source['source_sha256'],'frame_sha256':source['frame_sha256']}
    payload.update(changes);target=url+'/annotations/'+item['id']
    if action=='restore':return c.post(target+'/restore',json=payload),payload
    return c.request('PATCH' if action=='patch' else 'DELETE',target,json=payload),payload
