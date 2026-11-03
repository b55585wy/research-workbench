from uuid import UUID,uuid4
from pydantic import BaseModel,ConfigDict,Field
from .analysis_models import AnalysisCreate,analysis_payload
from .analysis_recipes import recipe
from .correlation_models import CorrelationOptions
from .correlation_statistics import preview


class CorrelationArguments(BaseModel):
    model_config=ConfigDict(extra='forbid')
    dataset_id:UUID
    columns:list[str]=Field(min_length=2,max_length=2)
    correlation:CorrelationOptions


CORRELATION_DEFINITIONS=[
    ('preview_correlation','预览相关分析','Read-only complete-pair validation for two numeric columns in explicitly shared data. kind=pearson requires confidence, kind=spearman requires confidence=null (asymptotic p, no CI). Specify alternative,missing=complete_pairs,independent_pairs_confirmed=true ONLY when user explicitly confirms each row is same-unit X/Y and rows are independent. Never infer this from labels, never select for significance, no p value/job from preview.',CorrelationArguments,'read'),
    ('propose_correlation','建议相关分析','Propose fixed R stats::cor.test correlation for explicit confirmation; same input requirements as preview_correlation. Pearson targets linear association; Spearman rank association with declared asymptotic p. No causality or full SPSS claim. First discover analysis_methods and preview actual data. Existing scatter chart supports these two columns after successful analysis, with separate confirmation.',CorrelationArguments,'write'),
]


class CorrelationTools:
    def correlation_payload(self,data):
        dataset=self.selected_dataset(data.dataset_id);library=self.workspace.analysis.catalog.statistics.require()
        return AnalysisCreate(request_id=uuid4(),dataset_id=data.dataset_id,dataset_sha256=dataset['sha256'],engine='r',
            columns=data.columns,recipe_sha256=recipe('r','correlation')['sha256'],method='correlation',
            correlation=data.correlation,library_sha256=library['sha256'])

    def tool_preview_correlation(self,data,call_id):
        value=preview(self.workspace.analysis,self.document_id,self.correlation_payload(data))
        return {k:value[k] for k in ('saved','counts','stats','stats_basis','pairs','library','warnings')}

    def tool_propose_correlation(self,data,call_id):
        payload=self.correlation_payload(data);value=preview(self.workspace.analysis,self.document_id,payload)
        fields=analysis_payload(payload);fields.pop('request_id');dataset=self.selected_dataset(data.dataset_id)
        content={**self.base_proposal(),**fields,'dataset_name':dataset['original_filename'],
                 'recipe_id':value['recipe']['id'],'recipe_version':1,'library':value['library'],
                 'preview':{k:value[k] for k in ('counts','stats','stats_basis','pairs','warnings')}}
        return self.proposals.add(self.turn,'run_correlation','运行相关分析',content,call_id)
