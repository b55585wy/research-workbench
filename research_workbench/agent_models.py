from typing import Annotated, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator, model_serializer

from .models import NoteCreate
from .image_annotation_models import ImageSelection


class ImageNoteCreate(NoteCreate):
    image_ids: list[UUID] = Field(min_length=1,max_length=4)

    @field_validator('image_ids')
    @classmethod
    def unique_images(cls,value):
        if len(set(value)) != len(value):
            raise ValueError('Images must be unique')
        return value


class NoteReference(BaseModel):
    model_config=ConfigDict(extra='forbid')
    note_id: UUID
    revision: int=Field(strict=True,ge=1)


class PaperResourceReference(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind: Literal['paper']
    document_id: UUID
    sha256: str=Field(pattern='^[a-f0-9]{64}$')


class DatasetResourceReference(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind: Literal['dataset']
    document_id: UUID
    dataset_id: UUID
    sha256: str=Field(pattern='^[a-f0-9]{64}$')
    allow_analysis: bool=Field(default=False,strict=True)

    @model_serializer(mode='wrap')
    def compatible_serialization(self,handler):
        value=handler(self)
        # Old no-grant payloads, submission hashes and task signatures must stay
        # byte-identical: a false/absent grant is omitted, an explicit true kept.
        if value.get('allow_analysis') is False:value.pop('allow_analysis',None)
        return value


ResourceReference = Annotated[
    Union[PaperResourceReference,DatasetResourceReference],Field(discriminator='kind')]


def reference_identity(reference):
    dataset_id = reference.dataset_id if reference.kind == 'dataset' else None
    return (reference.kind,reference.document_id,dataset_id)


class ReadingContext(BaseModel):
    model_config=ConfigDict(extra='forbid')
    page: int | None=Field(...,strict=True,ge=1,le=200)
    rect: tuple[float,float,float,float] | None=None
    active_note_id: UUID | None=None
    image_ids: list[UUID]=Field(default_factory=list,max_length=4)
    dataset_id: UUID | None=None
    active_analysis_id: UUID | None=None
    active_image: ImageSelection | None=None
    active_chart_id: UUID | None=None
    language: Literal['zh','en']='zh'
    presentation_actions: bool=Field(default=False,strict=True)
    note_refs: list[NoteReference]=Field(default_factory=list,max_length=8)
    resource_refs: list[ResourceReference]=Field(default_factory=list,max_length=8)

    @field_validator('note_refs')
    @classmethod
    def unique_note_refs(cls, values):
        if len({value.note_id for value in values}) != len(values):
            raise ValueError('Pinned notes must be unique')
        return values

    @field_validator('resource_refs')
    @classmethod
    def unique_resource_refs(cls, values):
        if len({reference_identity(value) for value in values}) != len(values):
            raise ValueError('Pinned references must be unique')
        return values

    @model_serializer(mode='wrap')
    def compatible_serialization(self, handler):
        value=handler(self)
        # Absent/false negotiation must serialize exactly as before: old
        # submission hashes and stored captures stay byte-identical.
        if value.get('presentation_actions') is False:
            value.pop('presentation_actions',None)
        if not value.get('note_refs'):
            value.pop('note_refs',None)
        if not value.get('resource_refs'):
            value.pop('resource_refs',None)
        return value

    @field_validator('rect',mode='before')
    @classmethod
    def numeric_rect(cls,value):
        return NoteCreate.numeric_rect(value)

    @field_validator('rect')
    @classmethod
    def positive_rect(cls,value):
        return NoteCreate.positive_rect(value)

    @field_validator('image_ids')
    @classmethod
    def unique_images(cls,value):
        return ImageNoteCreate.unique_images(value)


class AgentSubmission(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id: UUID
    conversation_id: UUID | None=None
    message: str=Field(default='',max_length=8000)
    context: ReadingContext
    continue_task: bool=Field(default=False,strict=True)

    @field_validator('message')
    @classmethod
    def clean_message(cls,value):
        if '\x00' in value:
            raise ValueError('Invalid message')
        return value.strip()

    @model_validator(mode='after')
    def nonempty_message(self):
        if not self.message and not self.context.image_ids and not self.context.note_refs:
            raise ValueError('Message or images required')
        return self


class ProposalConfirmation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    approved: bool=Field(strict=True)
    proposal_sha256: str=Field(pattern='^[a-f0-9]{64}$')


class ConversationClear(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id: UUID


class TaskControl(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id: UUID
    expected_generation: int=Field(strict=True,ge=0)
    action: Literal['stop','resume']
    context: ReadingContext | None=None
    message: str=Field(default='',max_length=8000)
    reason: Literal['user','sharing_changed']='user'

    @model_validator(mode='after')
    def action_fields(self):
        if '\x00' in self.message:raise ValueError('Invalid message')
        self.message=self.message.strip()
        if self.action=='resume' and self.context is None:raise ValueError('Fresh context required')
        if self.action=='stop' and (self.context is not None or self.message):raise ValueError('Stop has no new input')
        return self


class ModelSettings(BaseModel):
    model_config=ConfigDict(extra='forbid')
    base_url: str=Field(min_length=1,max_length=500)
    model: str=Field(min_length=1,max_length=100)
    api_key: str=Field(min_length=1,max_length=4096)
    supports_images: bool=Field(strict=True)
