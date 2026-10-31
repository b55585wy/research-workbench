"""Strict validation of the bounded two-group projection protocol."""
from collections import Counter
import math


def validate(value,row_count,columns):
    summary,series=value['summary'],value['series']
    assert set(summary)=={'row_count','columns','groups','missing_group_only','missing_value_only','missing_both','used_rows','excluded_rows'}
    assert set(series)=={'x','y','rows'} and len(columns)==2 and columns[0]!=columns[1]
    used=summary['used_rows'];excluded=summary['excluded_rows']
    assert all(isinstance(v,list) and len(v)==used for v in series.values())
    assert all(isinstance(x,str) and x.strip() and len(x)<=200 and not any(ord(c)<32 or 127<=ord(c)<=159 for c in x) for x in series['x'])
    assert all(type(y) in (int,float) and math.isfinite(y) for y in series['y'])
    assert math.isfinite(max(series['y'])-min(series['y']))
    assert all(type(r) is int and 1<=r<=row_count for r in series['rows'])
    assert sorted(set(series['rows']))==series['rows']
    counts=Counter(series['x']);labels=list(dict.fromkeys(series['x']))
    assert len(labels)==2 and isinstance(summary['groups'],list) and len(summary['groups'])==2
    for item,label in zip(summary['groups'],labels):
        assert isinstance(item,dict) and set(item)=={'label','count'} and item['label']==label
        assert type(item['count']) is int and 1<=item['count']<=row_count and item['count']==counts[label]
    reasons=[summary[k] for k in ('missing_group_only','missing_value_only','missing_both')]
    assert all(type(n) is int and 0<=n<=row_count for n in reasons) and sum(reasons)==excluded
