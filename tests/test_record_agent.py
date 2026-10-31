import json
from uuid import uuid4
from agent_support import answer, tool, submit
from analysis_support import workspace, upload, run
from task_support import checkpoint
from record_support import prepare, preview, spec, prefix
from chart_support import payload as chart_payload, prefix as chart_prefix


def test_agent_requires_explicit_dataset_and_prepares_summary_without_files_or_raw_data(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,job,chart=prepare(c,app,doc)
        secret='Private source note text not supplied in an export summary'
        c.post(f"/api/v1/documents/{doc['id']}/notes",json={'request_id':str(uuid4()),'page':1,'rect':None,'text':secret})
        args={'dataset_id':data['id'],'analysis_id':job['id'],'chart_id':chart['id'],'include_reading':True}
        submit(c,doc)
        turn=checkpoint(c,app,doc,model,[tool('prepare_research_record',args),answer('Sharing required')])
        assert not any(s['kind']=='research_record' for s in turn['sources'])
        submit(c,doc,'Prepare one research record',context={'page':1,'dataset_id':data['id']})
        turn=checkpoint(c,app,doc,model,[tool('prepare_research_record',args),tool('complete_task',{'summary':'Scope prepared; review and download in the interface.'})])
        assert turn['status']=='completed' and not turn['proposals']
        source=next(s for s in turn['sources'] if s['kind']=='research_record')
        assert source['page'] is None and source['spec']['analysis_id']==job['id'] and source['spec']['chart_id']==chart['id']
        results=[m['content'] for call in model.calls for m in call['messages'] if m['role']=='tool']
        assert not any(secret in item or '"series"' in item or '"source_rows"' in item or '"preview":' in item for item in results)
        assert not list(app.state.store.exports.iterdir())
        assert c.get(source['url']).status_code==200
        assert len(app.state.analysis.list(doc['id']))==1 and len(app.state.charts.list(doc['id']))==1
        assert c.get(f"/api/v1/documents/{doc['id']}/notes").json()['items'][0]['text']==secret


def test_agent_cannot_prepare_other_unshared_dataset(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        parent=upload(c,doc).json();other=upload(c,doc,name='Other.csv').json()
        submit(c,doc,context={'page':1,'dataset_id':parent['id']})
        turn=checkpoint(c,app,doc,model,[tool('prepare_research_record',{'dataset_id':other['id']}),answer('Select source first')])
        assert not any(s['kind']=='research_record' for s in turn['sources']) and not list(app.state.store.exports.iterdir())


def test_analysis_linked_chart_rejects_a_different_chosen_analysis(tmp_path):
    with workspace(tmp_path) as (c,app,doc,_):
        data=upload(c,doc).json();first=run(app.state.analysis,doc,data);second=run(app.state.analysis,doc,data,columns=['second'])
        response=c.post(chart_prefix(doc),json=chart_payload(c,data,'analysis_counts',analysis_id=first['id']))
        assert response.status_code==201,response.text
        chart=response.json()
        assert c.post(prefix(doc)+'/preview',json=spec(data,analysis_id=second['id'],chart_id=chart['id'])).json()['detail']['code']=='record_result_mismatch'
        plan=preview(c,doc,data,analysis_id=first['id'],chart_id=chart['id'])
        assert c.get(plan['download_url']).status_code==200
