import threading
from agent_support import answer,tool,submit,confirm
from analysis_support import workspace
from chart_support import prefix
from grouped_support import prepare
from task_support import checkpoint,state,note_responses


def test_agent_grouped_preview_requires_explicit_share_and_confirmation(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data,_=prepare(c,doc)
        arguments={'dataset_id':data['id'],'kind':'grouped_points','x':'group','y':'value','title':'Synthetic observations'}
        submit(c,doc)
        turn=checkpoint(c,app,doc,model,[tool('propose_chart',arguments),answer('Data not shared')])
        assert not turn['proposals'] and not c.get(prefix(doc)).json()['items']
        root=submit(c,doc,'Show actual grouped observations',context={'page':1,'dataset_id':data['id']}).json()
        pending=checkpoint(c,app,doc,model,[tool('chart_capabilities',{}),tool('preview_chart',arguments),tool('propose_chart',arguments)])
        assert pending['status']=='waiting_confirmation' and not c.get(prefix(doc)).json()['items']
        preview_results=[m['content'] for call in model.calls for m in call['messages'] if m['role']=='tool']
        assert any('grouped_points' in r for r in preview_results)
        assert not any('"series"' in r for r in preview_results)
        result=confirm(c,doc,pending);assert result.status_code==200,result.text
        chart=result.json()['proposals'][0]['result'];assert c.get(prefix(doc)+'/'+chart['chart_id']).json()['kind']=='grouped_points'
        assert confirm(c,doc,pending).json()['proposals'][0]['result']==chart
        assert len(c.get(prefix(doc)).json()['items'])==1


def test_actual_r_ttest_task_continues_to_grouped_points_and_source_note(tmp_path):
    from statistics_support import workspace as stats_workspace,payload
    from research_workbench.analysis_worker import execute
    with stats_workspace(tmp_path) as (c,app,doc,data,model):
        goal='Synthetic independent groups A/B, Welch two-sided95% complete cases; test value then grouped plot and note.'
        root=submit(c,doc,goal,continue_task=True,context={'page':1,'dataset_id':data['id']}).json()
        body=payload(c,data)
        args={key:body[key] for key in ('dataset_id','columns','ttest')}
        pending=checkpoint(c,app,doc,model,[tool('analysis_methods',{}),tool('preview_t_test',args),tool('propose_t_test',args)])
        assert pending['status']=='waiting_confirmation' and pending['proposals'][0]['kind']=='run_t_test'
        assert not app.state.analysis.list(doc['id'])
        assert confirm(c,doc,pending).status_code==200
        app.state.agent.tasks.tick();assert state(c,doc,root)['status']=='waiting_analysis'
        execute(app.state.analysis,app.state.analysis.claim(),threading.Event());app.state.agent.tasks.tick()
        task=state(c,doc,root);assert task['phase']=='chart'
        job=app.state.analysis.result(doc['id'],task['analysis_id']);assert job['method']=='ttest_independent'
        args={'dataset_id':data['id'],'kind':'grouped_points','x':'group','y':'value','title':'Actual R task observations'}
        chart=checkpoint(c,app,doc,model,[tool('read_analysis',{'analysis_id':job['id']}),tool('preview_chart',args),tool('propose_chart',args)])
        assert chart['status']=='waiting_confirmation',chart
        assert confirm(c,doc,chart).status_code==200
        app.state.agent.tasks.tick();task=state(c,doc,root)
        saved=c.get(prefix(doc)+'/'+task['chart_id']+'/data').json()
        assert saved['summary']['used_rows']==10 and saved['summary']['excluded_rows']==3
        assert saved['summary']['groups']==[{'label':'A','count':5},{'label':'B','count':5}]
        note=checkpoint(c,app,doc,model,note_responses(doc,task));assert note['status']=='waiting_confirmation',note
        assert confirm(c,doc,note).status_code==200
        app.state.agent.tasks.tick();done=state(c,doc,root);assert done['status']=='completed'
        assert len(app.state.analysis.list(doc['id']))==1 and len(c.get(prefix(doc)).json()['items'])==1
        note=c.get(f"/api/v1/documents/{doc['id']}/notes/{done['note_id']}/state").json()
        assert note['review_status']=='unreviewed' and done['analysis_id'] in note['text'] and done['chart_id'] in note['text']
