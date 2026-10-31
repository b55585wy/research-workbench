import json
import threading
from uuid import uuid4

from agent_support import tool,submit,confirm
from analysis_support import upload
from research_workbench.analysis_worker import execute


def prefix(doc):return f"/api/v1/documents/{doc['id']}/agent/tasks"


def context(data,**changes):return {'page':1,'language':'en','dataset_id':data['id'],'image_ids':[],**changes}


def begin(c,app,doc,model,**changes):
    data=upload(c,doc).json()
    response=submit(c,doc,'Describe, plot paired values, then save a source note.',continue_task=True,context=context(data),**changes)
    assert response.status_code==202,response.text
    return data,response.json()


def state(c,doc,turn):return c.get(prefix(doc)+'/'+turn['context']['task_id']).json()


def checkpoint(c,app,doc,model,responses):
    model.responses=list(responses)
    turn=app.state.agent.store.next_turn();assert turn
    app.state.agent.execute(turn)
    app.state.agent.tasks.tick()
    return app.state.agent.store.get(doc['id'],turn['id'])


def analysis_checkpoint(c,app,doc,model,data):
    return checkpoint(c,app,doc,model,[tool('propose_analysis',{'dataset_id':data['id'],'engine':'python','columns':['value','second']})])


def control(c,doc,task,action,**changes):
    payload={'request_id':str(uuid4()),'expected_generation':task['generation'],'action':action}
    if action=='resume':payload['context']=task['reading_context']
    payload.update(changes)
    return c.post(prefix(doc)+'/'+task['id']+'/control',json=payload),payload


def successful_analysis(c,app,doc,model,data,root):
    pending=analysis_checkpoint(c,app,doc,model,data)
    assert confirm(c,doc,pending).status_code==200
    app.state.agent.tasks.tick()
    assert state(c,doc,root)['status']=='waiting_analysis'
    execute(app.state.analysis,app.state.analysis.claim(),threading.Event())
    app.state.agent.tasks.tick()
    assert state(c,doc,root)['phase']=='chart'
    return pending


def chart_checkpoint(c,app,doc,model,data):
    return checkpoint(c,app,doc,model,[tool('propose_chart',{'dataset_id':data['id'],'kind':'scatter','x':'value','y':'second','title':'Task synthetic scatter'})])


def note_responses(doc,task):
    def proposal(messages,tools):
        sources=[json.loads(m['content']) for m in messages if m['role']=='tool']
        analysis=next(s for s in sources if s.get('source_ref') and s.get('id')==task['analysis_id'])
        chart=next(s for s in sources if s.get('source_ref') and s.get('id')==task['chart_id'])
        text=f"Synthetic descriptive data, no inference. Analysis: /?document={doc['id']}&analysis={task['analysis_id']}\nChart: /?document={doc['id']}&chart={task['chart_id']}"
        return tool('propose_note',{'text':text,'source_ref':analysis['source_ref']})
    return [tool('read_analysis',{'analysis_id':task['analysis_id']}),tool('read_chart',{'chart_id':task['chart_id']}),proposal]
