from uuid import uuid4
from analysis_support import upload,run


def prefix(doc):return f"/api/v1/documents/{doc['id']}/charts"


def payload(c,data,kind='histogram',**changes):
    cap=c.get('/api/v1/charts/capabilities').json()
    value={'request_id':str(uuid4()),'dataset_id':data['id'],'dataset_sha256':data['sha256'],'kind':kind,
        'title':'Synthetic traceable chart','analysis_id':None,'x':'value' if kind!='analysis_counts' else None,
        'y':'second' if kind=='scatter' else None,'bins':2 if kind=='histogram' else None,
        'recipe_sha256':next(r['recipe_sha256'] for r in cap['items'] if r['id']==kind),'renderer_sha256':cap['renderer']['sha256']}
    value.update(changes);return value


def prepare(c,app,doc,kind='histogram',**changes):
    data=upload(c,doc).json()
    if kind=='analysis_counts':changes['analysis_id']=run(app.state.analysis,doc,data,columns=['value','second'])['id']
    return data,payload(c,data,kind,**changes)


def save(c,doc,body):
    response=c.post(prefix(doc),json=body);assert response.status_code==201,response.text
    return response.json()


def lifecycle(c,doc,chart,action='delete',**changes):
    body={'request_id':str(uuid4()),'expected_revision':chart['revision'],'data_sha256':chart['data_sha256']};body.update(changes)
    url=prefix(doc)+'/'+chart['id']
    return c.request('DELETE' if action=='delete' else 'POST',url+('/restore' if action=='restore' else ''),json=body),body
