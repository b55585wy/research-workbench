from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,field_validator,model_validator


class CorrelationOptions(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind:Literal['pearson','spearman']
    alternative:Literal['two_sided','greater','less']
    confidence:float|None=Field(default=None,strict=True,ge=.5,le=.999)
    missing:Literal['complete_pairs']
    independent_pairs_confirmed:Literal[True]

    @field_validator('independent_pairs_confirmed',mode='before')
    @classmethod
    def confirmed(cls,value):
        if value is not True:raise ValueError('Confirm matched measurements and independent observational rows')
        return value

    @model_validator(mode='after')
    def interval(self):
        if (self.kind=='pearson') != (self.confidence is not None):
            raise ValueError('Pearson requires confidence; Spearman does not provide a confidence interval')
        return self
