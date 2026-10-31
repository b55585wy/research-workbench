from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class RecordSpec(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: UUID
    dataset_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    analysis_id: UUID | None = None
    chart_id: UUID | None = None
    include_reading: bool = Field(default=True, strict=True)


class RecordToken(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(strict=True, ge=1, le=1)
    document_id: UUID
    spec: RecordSpec
    preview_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
