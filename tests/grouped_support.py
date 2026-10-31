from analysis_support import upload
from chart_support import payload

RAW=b'group,value\nB,3\nA,1\nB,3\n,7\nA,\n,\nC,\n'


def prepare(c,doc,raw=RAW,**changes):
    response=upload(c,doc,raw);assert response.status_code==201,response.text
    data=response.json();body=payload(c,data,'grouped_points',x='group',y='value',**changes)
    return data,body
