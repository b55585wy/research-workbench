from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field
from .models import WorkspaceError
from .record_models import RecordSpec


class RecordArguments(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: UUID
    analysis_id: UUID | None = None
    chart_id: UUID | None = None
    include_reading: bool = Field(default=True, strict=True)


RECORD_DEFINITIONS = [
    ('prepare_research_record', '准备研究记录导出', 'Prepare a read-only frozen export scope for the explicitly shared dataset, optional ONE successful analysis and ONE active saved chart of that same dataset. include_reading includes ALL active notes/excerpts/image annotations of the paper, not only current result notes. Returns bounded scope and human review entry, no raw rows/series/notes. Does NOT create a ZIP or download/save a file. User reviews and clicks download. Changes require fresh preview.', RecordArguments, 'read'),
]


class RecordTools:
    def tool_prepare_research_record(self, data, call_id):
        dataset = self.selected_dataset(data.dataset_id)
        service = self.workspace.records
        current = service.store.get_document(self.document_id)
        if current['sha256'] != self.turn['context']['document']['sha256']:
            raise WorkspaceError('source_changed', '原论文已变化，请重新发送。', 409)
        spec = RecordSpec(**data.model_dump(mode='json'), dataset_sha256=dataset['sha256'])
        value = service.preview(self.document_id, spec)
        source = self.sources.add('research_record', '研究记录导出 / Research record export', page=None,
            dataset_id=dataset['id'], spec=value['spec'], preview_sha256=value['preview_sha256'], url=value['download_url'])
        return {**value, 'source_ref': source['ref'], 'notice': 'Scope prepared only. User must review and download. No ZIP or local file was created.'}
