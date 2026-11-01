from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
        if not self.message and not self.context.image_ids:
            raise ValueError('Message or images required')
        return self


class ProposalConfirmation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    approved: bool=Field(strict=True)
    proposal_sha256: str=Field(pattern='^[a-f0-9]{64}$')


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
