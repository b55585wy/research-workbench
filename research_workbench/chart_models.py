from typing import Literal
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,field_validator,model_validator
from .models import VersionedMutation

ChartKind=Literal['analysis_counts','histogram','scatter']


class ChartCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    dataset_id:UUID
    dataset_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    kind:ChartKind
    title:str=Field(min_length=1,max_length=120)
    analysis_id:UUID|None=None
    x:str|None=Field(default=None,min_length=1,max_length=100)
    y:str|None=Field(default=None,min_length=1,max_length=100)
    bins:int|None=Field(default=None,strict=True,ge=2,le=50)
    recipe_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    renderer_sha256:str=Field(pattern='^[a-f0-9]{64}$')

    @field_validator('title')
    @classmethod
    def clean_title(cls,value):
        value=value.strip()
        if not value or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid chart title')
        return value

    @model_validator(mode='after')
    def fields_match_kind(self):
        if self.kind=='analysis_counts':
            if self.analysis_id is None or any(v is not None for v in (self.x,self.y,self.bins)):raise ValueError('Counts require saved analysis only')
        elif self.kind=='histogram':
            if self.x is None or self.y is not None or self.analysis_id is not None:raise ValueError('Histogram requires one numeric column')
            if self.bins is None:self.bins=20
        elif self.x is None or self.y is None or self.x==self.y or self.bins is not None or self.analysis_id is not None:
            raise ValueError('Scatter requires distinct numeric columns')
        return self


class ChartMutation(VersionedMutation):
    data_sha256:str=Field(pattern='^[a-f0-9]{64}$')
