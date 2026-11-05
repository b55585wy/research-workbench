"""Closed, deterministic validation for reusable chart skills.

A skill is a recipe for an existing chart kind, never executable code.  Every
object forbids unknown keys, every numeric field is a strict finite type and the
canonical hash is computed with the workspace's existing canonical JSON helper so
a saved recipe can be frozen into a chart snapshot.
"""
import hashlib
import math
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel,ConfigDict,Field,field_validator,model_validator

from .agent_store import canonical

FORMAT='research-chart-skill/v1'
MAX_SKILL_BYTES=16*1024
SKILL_KINDS=('analysis_counts','histogram','scatter','grouped_points')
FONT_FAMILIES=('Arial, sans-serif','Georgia, serif','monospace')
EXPORT_FORMATS=('png','svg','offline')
_HEX=re.compile(r'^#[0-9A-Fa-f]{6}$')
_CONTROL=re.compile(r'[\u0000-\u001f\u007f-\u009f]')


def skill_hash(spec):
    return hashlib.sha256(canonical(spec).encode('utf-8')).hexdigest()


class ChartSkillChart(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind:Literal['analysis_counts','histogram','scatter','grouped_points']
    bins:int|None=Field(strict=True,ge=2,le=50)

    @model_validator(mode='after')
    def bins_match_kind(self):
        if self.kind=='histogram':
            if self.bins is None:raise ValueError('Histogram skills require exactly one bins value')
        elif self.bins is not None:
            raise ValueError('Only histogram skills may set bins')
        return self


class ChartSkillStyle(BaseModel):
    model_config=ConfigDict(extra='forbid')
    palette:list[str]=Field(min_length=2,max_length=8)
    font_family:Literal['Arial, sans-serif','Georgia, serif','monospace']
    font_size:int=Field(strict=True,ge=8,le=24)
    line_width:int|float
    marker_size:int=Field(strict=True,ge=2,le=16)
    width:int=Field(strict=True,ge=480,le=2400)
    height:int=Field(strict=True,ge=320,le=1600)

    @field_validator('palette')
    @classmethod
    def valid_palette(cls,value):
        if any(type(item) is not str or not _HEX.fullmatch(item) for item in value):
            raise ValueError('Palette entries must be six-digit hex colors')
        if len({item.upper() for item in value})!=len(value):
            raise ValueError('Palette colors must be unique')
        return value

    @field_validator('line_width',mode='before')
    @classmethod
    def finite_line_width(cls,value):
        if type(value) not in (int,float) or not math.isfinite(value):
            raise ValueError('Line width must be a finite number')
        return value

    @field_validator('line_width')
    @classmethod
    def line_width_range(cls,value):
        if not 0.5<=value<=4:raise ValueError('Line width is outside the supported range')
        return value


class ChartSkillSpec(BaseModel):
    model_config=ConfigDict(extra='forbid')
    format:Literal['research-chart-skill/v1']
    name:str
    description:str
    chart:ChartSkillChart
    style:ChartSkillStyle
    exports:list[Literal['png','svg','offline']]=Field(min_length=1,max_length=3)

    @field_validator('name',mode='before')
    @classmethod
    def clean_name(cls,value):
        if type(value) is not str:return value
        if _CONTROL.search(value):raise ValueError('Skill name cannot contain control characters')
        value=value.strip()
        if not 1<=len(value)<=60:
            raise ValueError('Skill name must contain 1 to 60 characters')
        return value

    @field_validator('description')
    @classmethod
    def valid_description(cls,value):
        if len(value)>500:raise ValueError('Skill description cannot exceed 500 characters')
        if _CONTROL.search(value):raise ValueError('Skill description cannot contain control characters')
        return value

    @field_validator('exports')
    @classmethod
    def unique_exports(cls,value):
        if len(set(value))!=len(value):raise ValueError('Export formats must be unique')
        return value

    @model_validator(mode='after')
    def bounded_canonical(self):
        if len(canonical(self.model_dump(mode='json')).encode('utf-8'))>MAX_SKILL_BYTES:
            raise ValueError('Skill specification is too large')
        return self


class ChartSkillReference(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id:UUID
    revision:int=Field(strict=True,ge=1)
    sha256:str=Field(pattern='^[a-f0-9]{64}$')


class ChartSkillSnapshot(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id:UUID
    revision:int=Field(strict=True,ge=1)
    sha256:str=Field(pattern='^[a-f0-9]{64}$')
    spec:ChartSkillSpec


class ChartSkillCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    spec:ChartSkillSpec


class ChartSkillVersionCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    expected_revision:int=Field(strict=True,ge=1)
    spec:ChartSkillSpec
