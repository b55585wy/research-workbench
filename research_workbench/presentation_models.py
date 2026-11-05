"""Frozen request and outline shapes for the presentation slice."""
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PresentationStyle = Literal['default', 'nature', 'cell']
SOURCE_REF = r'^(note|chart|analysis):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
# Only actual markup is refused.  Literal comparison signs such as "p < 0.05"
# and "p > 0.90" are ordinary scientific prose and stay editable text.
HTML_TAG = re.compile(r'</?[A-Za-z][^<>]*>|<!--[^<>]*-->')


def unsafe_text(value):
    if HTML_TAG.search(value) or '://' in value or '\\' in value:
        return True
    return any((part.startswith('/') and len(part) > 1) or part.startswith('../') for part in value.split())


class PresentationSelectors(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=120)
    style: PresentationStyle = 'default'
    note_ids: list[UUID] = Field(default_factory=list, max_length=5)
    chart_ids: list[UUID] = Field(default_factory=list, max_length=4)
    analysis_ids: list[UUID] = Field(default_factory=list, max_length=4)

    @field_validator('title')
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid presentation title')
        return value

    @model_validator(mode='after')
    def distinct_sources(self):
        identifiers = [str(item) for group in (self.note_ids, self.chart_ids, self.analysis_ids) for item in group]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError('Source identifiers must be distinct')
        if not identifiers:
            raise ValueError('Select at least one note, chart or completed analysis')
        return self


class OutlineSlide(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=100)
    body: list[str] = Field(default_factory=list, max_length=5)
    source_refs: list[str] = Field(default_factory=list, max_length=13)
    chart_id: UUID | None = None

    @field_validator('title')
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value) or unsafe_text(value):
            raise ValueError('Invalid slide title')
        return value

    @field_validator('body')
    @classmethod
    def clean_body(cls, value):
        result = []
        for item in value:
            if not isinstance(item, str):
                raise ValueError('Slide body lines must be text')
            item = item.strip()
            if len(item) > 400 or any(ord(c) < 32 and c not in '\t' for c in item) or unsafe_text(item):
                raise ValueError('Invalid slide body line')
            result.append(item)
        return result

    @field_validator('source_refs')
    @classmethod
    def clean_refs(cls, value):
        for item in value:
            if not isinstance(item, str) or re.fullmatch(SOURCE_REF, item) is None:
                raise ValueError('Invalid source reference')
        return value


class Outline(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=120)
    slides: list[OutlineSlide] = Field(min_length=1, max_length=8)

    @field_validator('title')
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value) or unsafe_text(value):
            raise ValueError('Invalid outline title')
        return value


class OutlineRequest(PresentationSelectors):
    source_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    request_id: UUID
    confirmed: Literal[True]


class ExportRequest(PresentationSelectors):
    source_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    outline: Outline
