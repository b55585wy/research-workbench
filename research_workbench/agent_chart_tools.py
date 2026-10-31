from uuid import UUID,uuid4,uuid5,NAMESPACE_URL
from pydantic import BaseModel,ConfigDict,Field
from .chart_models import ChartCreate
from .charts import recipe
from .models import WorkspaceError


class ChartArguments(BaseModel):
    model_config=ConfigDict(extra='forbid')
    dataset_id:UUID
    kind:str=Field(min_length=1,max_length=40)
    title:str=Field(min_length=1,max_length=120)
    analysis_id:UUID|None=None
    x:str|None=None
    y:str|None=None
    bins:int|None=Field(default=None,strict=True,ge=2,le=50)


class ChartReadArguments(BaseModel):
    model_config=ConfigDict(extra='forbid')
    chart_id:UUID


class ChartChangeArguments(ChartReadArguments):
    expected_revision:int=Field(strict=True,ge=1)


CHART_DEFINITIONS=[
    ('read_chart','读取已保存图表','Read verified chart metadata/summary/provenance of the explicitly shared dataset; never full raw series. Cite persistent chart reference.',ChartReadArguments,'read'),
    ('preview_chart','预览绘图方案','Compute a read-only preview summary of registered chart kind and fields on explicitly shared dataset. Does not save. analysis_counts requires successful analysis_id only; histogram needs x and optional bins; scatter needs distinct x/y. No code/URLs/layout.',ChartArguments,'read'),
    ('propose_chart','建议保存图表','Propose concrete validated registered chart and fields for explicit user approval. Same arguments as preview_chart. Never claim saved before confirmation.',ChartArguments,'write'),
    ('propose_chart_delete','建议删除图表','Propose recoverable chart deletion using actual revision; explicitly shared dataset required.',ChartChangeArguments,'write'),
    ('propose_chart_restore','建议恢复图表','Propose restoring a deleted chart using actual revision; explicitly shared dataset required.',ChartChangeArguments,'write'),
]


class ChartTools:
    def chart_service(self):
        service=getattr(self.workspace,'charts',None)
        if service is None:raise WorkspaceError('agent_tool_unavailable','绘图工具尚未安装。',409)
        return service

    def tool_chart_capabilities(self,data,call_id):return self.chart_service().capabilities()

    def tool_list_charts(self,data,call_id):
        charts=self.chart_service().list(self.document_id)
        return {'items':[{k:c[k] for k in ('id','dataset_id','kind','title','revision','deleted_at')} for c in charts]}

    def shared_chart(self,identifier):
        service=self.chart_service();chart=service.get(self.document_id,str(identifier));self.selected_dataset(chart['dataset_id'])
        return service.data(self.document_id,str(identifier),True)[0]

    def tool_read_chart(self,data,call_id):
        chart=self.shared_chart(data.chart_id)
        return {**chart,'source_ref':self.sources.chart(chart)['ref'],'notice':'Metadata and computed summary only, not full raw series or proof of scientific significance.'}

    def chart_payload(self,data):
        dataset=self.selected_dataset(data.dataset_id);capabilities=self.chart_service().capabilities()
        fields=data.model_dump(mode='json')
        return ChartCreate(request_id=uuid4(),**fields,dataset_sha256=dataset['sha256'],
            recipe_sha256=recipe(data.kind)['sha256'],renderer_sha256=capabilities['renderer']['sha256'])

    def tool_preview_chart(self,data,call_id):
        value=self.chart_service().preview(self.document_id,self.chart_payload(data))
        return {'saved':False,'chart':value['chart'],'notice':'Computed summary, no persistent record or model image pixels; full raw series are not provided.'}

    def tool_propose_chart(self,data,call_id):
        payload=self.chart_payload(data);preview=self.chart_service().preview(self.document_id,payload)['chart']
        fields=payload.model_dump(mode='json',exclude={'request_id'})
        proposal_id=str(uuid5(UUID(self.turn['id']),call_id))
        fields['request_id']=str(uuid5(NAMESPACE_URL,'research-agent-proposal:'+proposal_id))
        content={**self.base_proposal(),**fields,'dataset_name':preview['dataset_name'],'summary':preview['summary']}
        return self.proposals.add(self.turn,'create_chart','保存可追溯图表',content,call_id)

    def chart_change(self,data,kind,call_id):
        chart=self.shared_chart(data.chart_id)
        if chart['revision']!=data.expected_revision:raise WorkspaceError('revision_conflict','图表已更新，请先重新读取。',409)
        payload={**self.base_proposal(),'chart_id':chart['id'],'title':chart['title'],'dataset_id':chart['dataset_id'],
            'expected_revision':chart['revision'],'data_sha256':chart['data_sha256']}
        return self.proposals.add(self.turn,kind,'删除图表' if kind=='delete_chart' else '恢复图表',payload,call_id)

    def tool_propose_chart_delete(self,data,call_id):return self.chart_change(data,'delete_chart',call_id)

    def tool_propose_chart_restore(self,data,call_id):return self.chart_change(data,'restore_chart',call_id)
