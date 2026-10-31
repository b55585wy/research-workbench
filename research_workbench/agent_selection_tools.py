from uuid import UUID, uuid5, NAMESPACE_URL
from pydantic import BaseModel, ConfigDict, Field
from .selection_models import SelectionSpec, SelectionValues


class SelectionArguments(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: UUID
    column: str = Field(min_length=1, max_length=100)
    value: str = Field(strict=True, max_length=200)
    name: str | None = Field(default=None, max_length=160)


class ValuesArguments(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: UUID
    column: str = Field(min_length=1, max_length=100)
    query: str = Field(default='', max_length=100)
    offset: int = Field(default=0, strict=True, ge=0, le=50000)


SELECTION_DEFINITIONS = [
    ('dataset_values', '查看筛选值', 'Read bounded exact raw value counts of the explicitly shared dataset column. Paginated ten values. A truncated label is not an exact value; unavailable long values must be selected by the user. Never infer numeric equivalence.', ValuesArguments, 'read'),
    ('preview_dataset_selection', '预览数据筛选', 'Read-only counts of one exact raw-cell equality on explicitly shared dataset. No trimming or numeric coercion. No rows are shared and no table saved.', SelectionArguments, 'read'),
    ('propose_dataset_selection', '建议生成分析表', 'Propose a new immutable table using one exact raw-cell equality. Concrete confirmation required. Original unchanged. Child is NOT shared; user must explicitly select/share it in a NEW turn before analysis. Cannot retarget an existing continuous task.', SelectionArguments, 'write'),
]


class SelectionTools:
    def tool_dataset_values(self, data, call_id):
        dataset = self.selected_dataset(data.dataset_id)
        payload = SelectionValues(dataset_id=data.dataset_id, dataset_sha256=dataset['sha256'],
            column=data.column, query=data.query, offset=data.offset, limit=10)
        value = self.workspace.analysis.datasets.selections.values(self.document_id, payload)
        value['items'] = [item if len(item['value']) <= 200 else
            {'label': item['value'][:200], 'count': item['count'], 'value_unavailable': True} for item in value['items']]
        return value

    def selection_preview(self, data):
        dataset = self.selected_dataset(data.dataset_id)
        service = self.workspace.analysis.datasets.selections
        payload = SelectionSpec(**data.model_dump(mode='json'), dataset_sha256=dataset['sha256'],
                                recipe_sha256=service.capabilities()['recipe']['sha256'])
        preview = service.preview(self.document_id, payload)
        return payload, {k: v for k, v in preview.items() if k not in ('preview', 'columns')}

    def tool_preview_dataset_selection(self, data, call_id):
        return self.selection_preview(data)[1]

    def tool_propose_dataset_selection(self, data, call_id):
        payload, preview = self.selection_preview(data)
        if not preview['counts']['matched']:
            from .models import WorkspaceError
            raise WorkspaceError('selection_empty', '没有符合条件的记录，请修改筛选条件。', 422)
        proposal_id = str(uuid5(UUID(self.turn['id']), call_id))
        fields = payload.model_dump(mode='json')
        fields.update(request_id=str(uuid5(NAMESPACE_URL, 'research-agent-proposal:'+proposal_id)),
                      preview_sha256=preview['preview_sha256'], source_name=preview['source']['name'],
                      counts=preview['counts'], recipe=preview['recipe'])
        return self.proposals.add(self.turn, 'create_dataset_selection', '生成可追溯分析表',
                                  {**self.base_proposal(), **fields}, call_id)
