from typing import Literal
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,field_validator


class TTestOptions(BaseModel):
    model_config=ConfigDict(extra='forbid')
    group_column:str=Field(min_length=1,max_length=100)
    groups:list[str]=Field(min_length=2,max_length=2)
    variant:Literal['student','welch']
    alternative:Literal['two_sided','greater','less']
    confidence:float=Field(strict=True,ge=.5,le=.999)
    missing:Literal['complete_cases']
    independent_samples_confirmed:Literal[True]

    @field_validator('independent_samples_confirmed',mode='before')
    @classmethod
    def independent(cls,value):
        if value is not True:raise ValueError('Explicit independent-sample declaration required')
        return value

    @field_validator('groups')
    @classmethod
    def distinct(cls,value):
        if len(set(value))!=2 or any(not v.strip() or len(v)>200 for v in value):
            raise ValueError('Specify two distinct exact group labels')
        return value


class GroupRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    dataset_id:UUID
    dataset_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    group_column:str=Field(min_length=1,max_length=100)
