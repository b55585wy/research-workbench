import math
from uuid import UUID
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator, model_serializer
from .rich_content import validate_content,plaintext
from .shape_annotations import (MAX_TEXTBOX_BODY, ShapeAnnotation, ShapeAnnotationInput,
                                TextboxAnnotation, TextboxRecord)
from .text_annotations import AnnotationCreate, AnnotationStyle
from .source_segments import SourceSegment, validate_anchor

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_PAGES = 200


class WorkspaceError(Exception):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


class SourceAnchor(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind: Literal['study','dataset','analysis','chart']
    id: UUID
    sha256: str=Field(pattern=r'^[0-9a-f]{64}$')


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    page: int | None = Field(..., strict=True, ge=1, le=MAX_PAGES)
    source: SourceAnchor | None = None
    rect: tuple[float, float, float, float] | None = None
    text: str = Field(min_length=1, max_length=10_000)
    rich_content: dict | None = None
    annotation: AnnotationCreate | None = None
    shape_annotation: Optional[ShapeAnnotationInput] = None
    source_segments: list[SourceSegment] | None = Field(default=None, min_length=1, max_length=20)

    @model_serializer(mode='wrap')
    def compatible_serialization(self, handler):
        value = handler(self)
        if value.get('annotation') is None:
            value.pop('annotation', None)
        if value.get('shape_annotation') is None:
            value.pop('shape_annotation', None)
        if value.get('source_segments') is None:
            value.pop('source_segments', None)
        return value

    @field_validator('rich_content')
    @classmethod
    def valid_rich_content(cls,value):
        return validate_content(value) if value is not None else None

    @model_validator(mode='after')
    def consistent_rich_content(self):
        if self.rich_content is not None and plaintext(self.rich_content)!=self.text:
            raise ValueError('Rich and plain text must match')
        if self.source_segments is not None:
            if self.source is not None or self.shape_annotation is not None:
                raise ValueError('Selected page sources require a PDF text note')
            validate_anchor(self.source_segments, self.page, self.rect, self.annotation)
        if self.annotation is not None:
            if self.page is None or self.rect is None or self.source is not None or (self.source_segments is None and self.text != self.annotation.quote):
                raise ValueError('A text annotation requires its selected quote and PDF page anchor')
            if any(abs(a-b) > 1e-6 for a, b in zip(self.annotation.bounds(), self.rect)):
                raise ValueError('Annotation union must match the legacy note rectangle')
        if self.shape_annotation is not None:
            if self.page is None or self.source is not None:
                raise ValueError('A shape annotation requires a PDF page anchor')
            if self.annotation is not None:
                raise ValueError('A shape annotation cannot share a text annotation')
            if self.shape_annotation.kind == 'textbox' and len(self.text) > MAX_TEXTBOX_BODY:
                raise ValueError(f'A text box body cannot exceed {MAX_TEXTBOX_BODY} characters')
            bounds = self.shape_annotation.bounds()
            if self.rect is None:
                self.rect = tuple(bounds)
            elif any(abs(a-b) > 1e-6 for a, b in zip(bounds, self.rect)):
                raise ValueError('Shape bounds must match the legacy note rectangle')
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
    annotation_style: AnnotationStyle | None = None
    shape_annotation: Optional[ShapeAnnotationInput] = None
    # Independently self-reported learning level; strict integer only so null,
    # booleans, fractions, strings and out-of-range values are rejected.
    mastery_level: int | None = Field(default=None, strict=True, ge=0, le=5)

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
        if not ({'text', 'review_status', 'annotation_style', 'shape_annotation',
                 'mastery_level'} & self.model_fields_set):
            raise ValueError('No change supplied')
        if 'annotation_style' in self.model_fields_set and self.annotation_style is None:
            raise ValueError('Annotation style cannot be null')
        if 'shape_annotation' in self.model_fields_set and self.shape_annotation is None:
            raise ValueError('Shape annotation cannot be null')
        if 'review_status' in self.model_fields_set and self.review_status is None:
            raise ValueError('Review status cannot be null')
        if 'mastery_level' in self.model_fields_set and self.mastery_level is None:
            raise ValueError('Mastery level cannot be null')
        if 'rich_content' in self.model_fields_set and 'text' not in self.model_fields_set:
            raise ValueError('Rich edits require matching text')
        if self.rich_content is not None and plaintext(self.rich_content)!=self.text:
            raise ValueError('Rich and plain text must match')
        if (self.shape_annotation is not None and self.shape_annotation.kind == 'textbox'
                and 'text' in self.model_fields_set and self.text is not None
                and len(self.text) > MAX_TEXTBOX_BODY):
            raise ValueError(f'A text box body cannot exceed {MAX_TEXTBOX_BODY} characters')
        return self
