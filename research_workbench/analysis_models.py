from typing import Literal
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,field_validator,model_validator
from .statistics_models import TTestOptions,PairedOptions


class AnalysisCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    dataset_id:UUID
    dataset_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    engine:Literal['python','r']
    columns:list[str]=Field(min_length=1,max_length=50)
    recipe_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    method:Literal['describe','ttest_independent','ttest_paired']='describe'
    ttest:TTestOptions|None=None
    paired:PairedOptions|None=None
    library_sha256:str|None=Field(default=None,pattern='^[a-f0-9]{64}$')

    @model_validator(mode='after')
    def method_fields(self):
        if self.method=='describe':
            if self.ttest is not None or self.paired is not None or self.library_sha256 is not None:raise ValueError('Unexpected statistical parameters')
        elif self.method=='ttest_independent':
            if self.engine!='r' or len(self.columns)!=1 or self.ttest is None or self.paired is not None or self.library_sha256 is None:
                raise ValueError('Independent t-test requires one outcome, R, explicit options and verified library')
        elif self.engine!='r' or len(self.columns)!=2 or self.paired is None or self.ttest is not None or self.library_sha256 is None or self.paired.unit_column in self.columns:
            raise ValueError('Paired t-test requires R, two ordered outcomes, a separate unit ID and verified library')
        return self

    @field_validator('columns')
    @classmethod
    def unique_columns(cls,value):
        if len(set(value))!=len(value) or any(not c or len(c)>100 for c in value):raise ValueError('Invalid columns')
        return value


def analysis_payload(payload):
    value=payload.model_dump(mode='json')
    if payload.method!='ttest_paired':value.pop('paired')
    else:value.pop('ttest')
    if payload.method=='describe':
        for key in ('method','ttest','library_sha256'):value.pop(key)
    return value
