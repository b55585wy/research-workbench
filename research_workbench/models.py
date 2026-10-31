import math
from uuid import UUID
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .rich_content import validate_content,plaintext

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_PAGES = 200


class WorkspaceError(Exception):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    page: int = Field(strict=True, ge=1, le=MAX_PAGES)
    rect: tuple[float, float, float, float] | None = None
    text: str = Field(min_length=1, max_length=10_000)
    rich_content: dict | None = None

    @field_validator('rich_content')
    @classmethod
    def valid_rich_content(cls,value):
        return validate_content(value) if value is not None else None

    @model_validator(mode='after')
    def consistent_rich_content(self):
        if self.rich_content is not None and plaintext(self.rich_content)!=self.text:
            raise ValueError('Rich and plain text must match')
        return self

    @field_validator('text')
    @classmethod
    def meaningful_text(cls, value):
        value = value.strip()
        if not value or '\x00' in value:
            raise ValueError('Note text must not be empty or contain NUL')
        return value
    @field_validator('rect', mode='before')
    @classmethod
    def numeric_rect(cls, value):
        if value is not None and (not isinstance(value, (list, tuple)) or len(value) != 4
                                  or any(type(v) not in (float, int) for v in value)):
            raise ValueError('Rectangle must contain four numbers')
        return value

    @field_validator('rect')
    @classmethod
    def positive_rect(cls, value):
        if value is None:
            return value
        if any(not math.isfinite(v) or not 0 <= v <= 1 for v in value):
            raise ValueError('Rectangle must use finite page fractions')
        left, top, right, bottom = value
        if left >= right or top >= bottom:
            raise ValueError('Rectangle must have positive width and height')
        return value


class VersionedMutation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    expected_revision: int = Field(strict=True, ge=1)


class NoteMutation(VersionedMutation):
    pass


class DocumentUpdate(VersionedMutation):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    authors: str | None = Field(default=None, max_length=2000)
    year: int | None = Field(default=None, strict=True, ge=1, le=9999)
    doi: str | None = Field(default=None, max_length=255)

    @field_validator('title', 'authors', 'doi')
    @classmethod
    def bibliographic_text(cls, value, info):
        if value is None or '\x00' in value:
            raise ValueError('Text cannot be null or contain NUL')
        value = value.strip()
        if info.field_name == 'title' and not value:
            raise ValueError('Title cannot be empty')
        return value

    @model_validator(mode='after')
    def has_metadata_change(self):
        if not ({'title','authors','year','doi'} & self.model_fields_set):
            raise ValueError('No metadata change supplied')
        return self


class NoteUpdate(NoteMutation):
    text: str | None = Field(default=None, min_length=1, max_length=10_000)
    review_status: Literal['unreviewed', 'source_checked'] | None = None
    rich_content: dict | None = None

    @field_validator('rich_content')
    @classmethod
    def valid_rich_content(cls,value):
        return NoteCreate.valid_rich_content(value)

    @field_validator('text')
    @classmethod
    def meaningful_text(cls, value):
        if value is None:
            raise ValueError('Text cannot be null')
        return NoteCreate.meaningful_text(value)

    @model_validator(mode='after')
    def has_change(self):
        if not ({'text', 'review_status'} & self.model_fields_set):
            raise ValueError('No change supplied')
        if 'review_status' in self.model_fields_set and self.review_status is None:
            raise ValueError('Review status cannot be null')
        if 'rich_content' in self.model_fields_set and 'text' not in self.model_fields_set:
            raise ValueError('Rich edits require matching text')
        if self.rich_content is not None and plaintext(self.rich_content)!=self.text:
            raise ValueError('Rich and plain text must match')
        return self
