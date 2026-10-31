from typing import Literal
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,field_validator,model_validator
from .models import NoteCreate,VersionedMutation

SourceKind=Literal['user_upload','pdf_excerpt']


class ImageSelection(BaseModel):
    model_config=ConfigDict(extra='forbid')
    source_kind:SourceKind
    source_id:UUID
    annotation_id:UUID|None=None


class ImageHashes(BaseModel):
    model_config=ConfigDict(extra='forbid')
    source_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    frame_sha256:str=Field(pattern='^[a-f0-9]{64}$')


class ImageAnnotationCreate(ImageHashes):
    request_id:UUID
    rect:tuple[float,float,float,float]
    text:str=Field(min_length=1,max_length=2000)

    @field_validator('rect',mode='before')
    @classmethod
    def numeric_rect(cls,value):return NoteCreate.numeric_rect(value)

    @field_validator('rect')
    @classmethod
    def valid_rect(cls,value):return NoteCreate.positive_rect(value)

    @field_validator('text')
    @classmethod
    def clean_text(cls,value):return NoteCreate.meaningful_text(value)


class ImageAnnotationMutation(ImageHashes,VersionedMutation):
    pass


class ImageAnnotationUpdate(ImageAnnotationMutation):
    rect:tuple[float,float,float,float]|None=None
    text:str|None=Field(default=None,min_length=1,max_length=2000)

    @field_validator('rect',mode='before')
    @classmethod
    def numeric_rect(cls,value):
        if value is None:raise ValueError('Rectangle cannot be null')
        return NoteCreate.numeric_rect(value)

    @field_validator('rect')
    @classmethod
    def valid_rect(cls,value):return NoteCreate.positive_rect(value)

    @field_validator('text')
    @classmethod
    def clean_text(cls,value):
        if value is None:raise ValueError('Text cannot be null')
        return NoteCreate.meaningful_text(value)

    @model_validator(mode='after')
    def has_change(self):
        if not self.model_fields_set&{'rect','text'}:raise ValueError('Annotation update requires text or rectangle')
        return self
