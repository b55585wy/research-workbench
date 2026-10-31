from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator

class SelectionSource(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: UUID
    dataset_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    column: str = Field(strict=True, min_length=1, max_length=100)


class SelectionValues(SelectionSource):
    query: str = Field(default='', strict=True, max_length=100)
    offset: int = Field(default=0, strict=True, ge=0, le=50000)
    limit: int = Field(default=50, strict=True, ge=1, le=50)


class SelectionSpec(SelectionSource):
    value: str = Field(strict=True, max_length=2048)
    name: str | None = Field(default=None, strict=True, max_length=160)
    recipe_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')

    @field_validator('value')
    @classmethod
    def valid_value(cls, value):
        if '\x00' in value: raise ValueError('NUL is not a cell value')
        return value

    @field_validator('name')
    @classmethod
    def valid_name(cls, value):
        if value is None: return value
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 or c in '/\\' for c in value):
            raise ValueError('Invalid result name')
        return value


class SelectionCreate(SelectionSpec):
    request_id: UUID
    preview_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
