from uuid import UUID,uuid4
from pydantic import BaseModel,ConfigDict,Field
from .analysis_models import AnalysisCreate,analysis_payload
from .analysis_recipes import recipe
from .statistics_models import GroupRequest,TTestOptions,PairedOptions
from .statistics_service import methods,groups,preview
from .models import WorkspaceError


class Empty(BaseModel):
    model_config=ConfigDict(extra='forbid')


class GroupArguments(Empty):
    dataset_id:UUID
    group_column:str=Field(min_length=1,max_length=100)


class TTestArguments(Empty):
    dataset_id:UUID
    columns:list[str]=Field(min_length=1,max_length=1)
    ttest:TTestOptions


class CancelArguments(Empty):
    analysis_id:UUID


class PairedArguments(Empty):
    dataset_id:UUID
    columns:list[str]=Field(min_length=2,max_length=2)
    paired:PairedOptions


STATISTICS_DEFINITIONS=[
    ('preview_paired_t_test','预览配对 t 检验','Read-only validation of two ordered numeric columns within each row, unique unit ID and complete-pair exclusions. paired_samples_confirmed=true ONLY when the user explicitly states same-unit paired design. Never infer pairing, independent units or distribution validity from labels. No p value or job.',PairedArguments,'read'),
    ('propose_paired_t_test','建议配对 t 检验','Propose fixed R paired t-test with explicit dataset, unit ID, first-minus-second columns, alternative, confidence and complete-pair design declaration. User confirms every run; preview has no p value. Same requirements as preview_paired_t_test.',PairedArguments,'write'),
    ('analysis_methods','查看统计方法','Discover installed analysis methods/library versions; unavailable methods cannot run. No SPSS engine claim.',Empty,'read'),
    ('read_t_test_groups','查看已共享数据分组','Read exact two nonempty grouping labels/counts from explicitly shared data. This does not establish independent experimental design.',GroupArguments,'read'),
    ('preview_t_test','预览独立样本 t 检验','Validate a concrete independent-samples t-test on shared data without creating/running a job. Specify one outcome, exact group1/group2 order, Student/Welch, alternative, confidence, complete_cases and independent_samples_confirmed=true ONLY when user states independent design. Never infer design from labels.',TTestArguments,'read'),
    ('propose_t_test','建议独立样本 t 检验','Propose a concrete verified t-test for explicit confirmation; same parameters/requirements as preview_t_test. No p values before successful execution. User must review scientific choices and design.',TTestArguments,'write'),
    ('propose_analysis_cancel','建议取消分析','Propose cancellation of a queued/running analysis of explicitly shared data. Requires user confirmation; completed results are not deleted.',CancelArguments,'write'),
]


class StatisticsTools:
    def tool_analysis_methods(self,data,call_id):return methods(self.workspace.analysis)

    def paired_payload(self,data):
        dataset=self.selected_dataset(data.dataset_id);library=self.workspace.analysis.catalog.statistics.require()
        return AnalysisCreate(request_id=uuid4(),dataset_id=data.dataset_id,dataset_sha256=dataset['sha256'],engine='r',
            columns=data.columns,recipe_sha256=recipe('r','ttest_paired')['sha256'],method='ttest_paired',
            paired=data.paired,library_sha256=library['sha256'])

    def tool_preview_paired_t_test(self,data,call_id):
        from .paired_statistics import preview as paired_preview
        value=paired_preview(self.workspace.analysis,self.document_id,self.paired_payload(data))
        return {k:value[k] for k in ('saved','counts','stats','stats_basis','difference_stats','pairing','library','warnings')}

    def tool_propose_paired_t_test(self,data,call_id):
        from .paired_statistics import preview as paired_preview
        payload=self.paired_payload(data);value=paired_preview(self.workspace.analysis,self.document_id,payload)
        fields=analysis_payload(payload);fields.pop('request_id');dataset=self.selected_dataset(data.dataset_id)
        content={**self.base_proposal(),**fields,'dataset_name':dataset['original_filename'],'recipe_id':value['recipe']['id'],
            'recipe_version':1,'library':value['library'],
            'preview':{k:value[k] for k in ('counts','stats','stats_basis','difference_stats','pairing','warnings')}}
        return self.proposals.add(self.turn,'run_paired_t_test','运行配对 t 检验',content,call_id)

    def tool_read_t_test_groups(self,data,call_id):
        dataset=self.selected_dataset(data.dataset_id)
        return groups(self.workspace.analysis,self.document_id,GroupRequest(dataset_id=data.dataset_id,
            dataset_sha256=dataset['sha256'],group_column=data.group_column))

    def statistics_payload(self,data):
        dataset=self.selected_dataset(data.dataset_id);service=self.workspace.analysis
        library=service.catalog.statistics.require()
        return AnalysisCreate(request_id=uuid4(),dataset_id=data.dataset_id,dataset_sha256=dataset['sha256'],
            engine='r',columns=data.columns,recipe_sha256=recipe('r','ttest_independent')['sha256'],
            method='ttest_independent',ttest=data.ttest,library_sha256=library['sha256'])

    def tool_preview_t_test(self,data,call_id):
        value=preview(self.workspace.analysis,self.document_id,self.statistics_payload(data))
        return {k:value[k] for k in ('saved','counts','stats','library','warnings')}

    def tool_propose_t_test(self,data,call_id):
        payload=self.statistics_payload(data);value=preview(self.workspace.analysis,self.document_id,payload)
        fields=analysis_payload(payload);fields.pop('request_id')
        dataset=self.selected_dataset(data.dataset_id)
        content={**self.base_proposal(),**fields,'dataset_name':dataset['original_filename'],
            'recipe_id':value['recipe']['id'],'recipe_version':1,'library':value['library'],
            'preview':{key:value[key] for key in ('counts','stats','warnings')}}
        return self.proposals.add(self.turn,'run_t_test','运行独立样本 t 检验',content,call_id)

    def tool_propose_analysis_cancel(self,data,call_id):
        job=self.workspace.analysis.get(self.document_id,str(data.analysis_id));dataset=self.selected_dataset(job['dataset_id'])
        if job['status'] not in ('queued','running'):
            raise WorkspaceError('analysis_not_active','这项分析已结束，无需取消。',409)
        return self.proposals.add(self.turn,'cancel_analysis','取消分析任务',{
            **self.base_proposal(),'analysis_id':job['id'],'dataset_id':dataset['id'],
            'dataset_sha256':dataset['sha256'],'status':job['status']},call_id)
