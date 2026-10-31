"""Validate the fixed child protocol and stored figure identities."""
import math


def integer(value,lower=0,upper=50000):return type(value) is int and lower<=value<=upper


def projection(value,kind,columns,row_count):
    assert isinstance(value,dict) and set(value)=={'summary','series'}
    summary=value['summary'];series=value['series']
    assert summary['row_count']==row_count and summary['columns']==columns
    used=summary['used_rows'];excluded=summary['excluded_rows']
    assert integer(used,1) and integer(excluded) and used+excluded==row_count
    if kind=='analysis_counts':
        assert set(series)=={'columns','valid','missing'} and series['columns']==columns
        assert len(series['valid'])==len(series['missing'])==len(columns)
        assert all(integer(a) and integer(b) and a+b==row_count for a,b in zip(series['valid'],series['missing']))
    elif kind=='histogram':
        assert set(series)=={'labels','counts','lower','upper'}
        size=len(series['counts']);assert 1<=size<=50
        assert all(len(series[k])==size for k in series)
        assert all(integer(n) for n in series['counts']) and sum(series['counts'])==used
        assert all(isinstance(s,str) and 1<=len(s)<=2000 for k in ('labels','lower','upper') for s in series[k])
    else:
        assert set(series)=={'x','y','rows'} and all(len(v)==used for v in series.values())
        assert all(type(v) in (int,float) and math.isfinite(v) for k in ('x','y') for v in series[k])
        assert all(integer(v,1,row_count) for v in series['rows']) and sorted(set(series['rows']))==series['rows']
