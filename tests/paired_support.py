from statistics_support import workspace
from uuid import uuid4

CSV=b'ID,first,second\n01,1,2\n02,3,4\n03,5,7\n04,,8\n05,9,\n06,,\n'


def payload(c,data,**changes):
    method=next(m for m in c.get('/api/v1/analysis/methods').json()['items'] if m['id']=='ttest_paired')
    body={'request_id':str(uuid4()),'dataset_id':data['id'],'dataset_sha256':data['sha256'],'engine':'r',
        'method':'ttest_paired','columns':['first','second'],'recipe_sha256':method['recipe_sha256'],
        'library_sha256':method['library']['sha256'],'paired':{'unit_column':'ID','alternative':'two_sided',
        'confidence':.95,'missing':'complete_pairs','paired_samples_confirmed':True}}
    return {**body,**changes}


def preview(c,doc,body):return c.post(f"/api/v1/documents/{doc['id']}/analyses/paired/preview",json=body)
