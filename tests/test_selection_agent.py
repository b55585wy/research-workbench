import json
from agent_support import answer, tool, submit, confirm
from analysis_support import workspace, upload
from task_support import checkpoint, state
from selection_support import save


def test_agent_requires_parent_share_and_never_grants_child(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data=upload(c,doc).json();args={'dataset_id':data['id'],'column':'label','value':'a'}
        submit(c,doc)
        turn=checkpoint(c,app,doc,model,[tool('propose_dataset_selection',args),answer('Share required')])
        assert turn['status']=='completed' and not turn['proposals']
        submit(c,doc,'Select rows',context={'page':1,'dataset_id':data['id']})
        turn=checkpoint(c,app,doc,model,[tool('dataset_values',{'dataset_id':data['id'],'column':'label'}),tool('preview_dataset_selection',args),tool('propose_dataset_selection',args)])
        assert turn['status']=='waiting_confirmation' and turn['proposals'][0]['kind']=='create_dataset_selection'
        assert len(app.state.datasets.list(doc['id']))==1
        messages=[m['content'] for call in model.calls for m in call['messages'] if m['role']=='tool']
        assert not any('"source_rows":' in m or '"preview":' in m or '"data":' in m for m in messages)
        result=confirm(c,doc,turn);assert result.status_code==200,result.text
        receipt=result.json()['proposals'][0]['result'];assert 'preview' not in receipt
        assert c.get(receipt['url']).json()['id']==receipt['dataset_id']
        assert receipt['row_count']==1 and receipt['parent_dataset_id']==data['id']
        assert confirm(c,doc,turn).json()['proposals'][0]['result']==receipt
        submit(c,doc,'Read child',context={'page':1,'dataset_id':data['id']})
        denied=checkpoint(c,app,doc,model,[tool('read_dataset',{'dataset_id':receipt['dataset_id']}),answer('Share child first')])
        assert not denied['proposals']
        assert any('agent_dataset_not_selected' in m['content'] for m in model.calls[-1]['messages'] if m['role']=='tool')
        submit(c,doc,'Read explicitly selected child',context={'page':1,'dataset_id':receipt['dataset_id']})
        checkpoint(c,app,doc,model,[tool('read_dataset',{'dataset_id':receipt['dataset_id']}),answer('Child shared')])
        assert any('selection_provenance' in m['content'] for m in model.calls[-1]['messages'] if m['role']=='tool')


def test_agent_receipt_failure_rolls_back_blob_dataset_and_all_files(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data=upload(c,doc).json();submit(c,doc,context={'page':1,'dataset_id':data['id']})
        turn=checkpoint(c,app,doc,model,[tool('propose_dataset_selection',{'dataset_id':data['id'],'column':'label','value':'a'})])
        with app.state.store.connection() as db:
            db.executescript("CREATE TRIGGER fail_receipt BEFORE UPDATE ON agent_proposals WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;")
        assert confirm(c,doc,turn).status_code==503
        assert len(app.state.datasets.list(doc['id']))==1 and not list(app.state.selections.root.iterdir())
        with app.state.store.connection() as db:
            assert db.execute('SELECT COUNT(*) FROM dataset_selections').fetchone()[0]==0
            db.execute('DROP TRIGGER fail_receipt')
        assert confirm(c,doc,turn).status_code==200
        assert len(app.state.datasets.list(doc['id']))==2 and not list(app.state.selections.root.iterdir())


def test_continuous_task_cannot_filter_or_retarget_source(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        data=upload(c,doc).json()
        root=submit(c,doc,'Analyze current data and save note',continue_task=True,context={'page':1,'dataset_id':data['id']}).json()
        pending=checkpoint(c,app,doc,model,[tool('propose_dataset_selection',{'dataset_id':data['id'],'column':'label','value':'a'}),answer('Prepare a child before starting task')])
        assert not pending['proposals'] and len(app.state.datasets.list(doc['id']))==1
        assert state(c,doc,root)['dataset_id']==data['id']


def test_model_catalog_long_value_is_not_an_exact_argument(tmp_path):
    with workspace(tmp_path) as (c,app,doc,model):
        long='中'*300;data=upload(c,doc,('label,value\n'+long+',1\n').encode()).json()
        submit(c,doc,context={'page':1,'dataset_id':data['id']})
        checkpoint(c,app,doc,model,[tool('dataset_values',{'dataset_id':data['id'],'column':'label'}),answer('Select long value in interface')])
        values=[json.loads(m['content']) for m in model.calls[-1]['messages'] if m['role']=='tool']
        item=values[0]['items'][0]
        assert item['value_unavailable'] and 'value' not in item and len(item['label'])==200
