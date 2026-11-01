"""Closed wide-pair preparation; raw unit IDs never determine an R expression."""
import csv
import hashlib
import json
import math
from pathlib import Path
import runpy
import statistics
import sys

_tabular=runpy.run_path(str(Path(__file__).with_name('tabular.py')))
parse,numeric=_tabular['parse'],_tabular['numeric']


def preparation_sources():
    return {name:Path(__file__).with_name(name).read_bytes() for name in ('paired_ttest_data.py','tabular.py')}


def preparation_hash():
    values={name:hashlib.sha256(raw).hexdigest() for name,raw in preparation_sources().items()}
    return hashlib.sha256(json.dumps(values,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def summary(column,values,excluded):
    return {'column':column,'n':len(values),'missing':excluded,'mean':statistics.fmean(values),
        'median':statistics.median(values),'sd':statistics.stdev(values),'min':min(values),'max':max(values)}


def prepare(profile,rows,columns,options):
    names=[c['name'] for c in profile['columns']];unit=options['unit_column']
    if len(columns)!=2 or len(set(columns))!=2 or unit in columns:raise ValueError('two_distinct_outcomes_and_unit_required')
    if unit not in names or any(c not in names for c in columns):raise ValueError('invalid_columns')
    if not all(profile['columns'][names.index(c)]['numeric'] for c in columns):raise ValueError('numeric_outcomes_required')
    ui,ai,bi=(names.index(c) for c in (unit,*columns));seen=set();values=[];mapping=[]
    counts={'total':len(rows),'used':0,'excluded':0,'missing_first_only':0,'missing_second_only':0,'missing_both':0}
    for index,row in enumerate(rows,1):
        identifier=row[ui]
        if not identifier or identifier!=identifier.strip() or not identifier.isprintable() or len(identifier)>200:
            raise ValueError('invalid_unit_id')
        if identifier in seen:raise ValueError('duplicate_unit_id')
        seen.add(identifier)
        missing_a,missing_b=not row[ai].strip(),not row[bi].strip()
        reason='missing_both' if missing_a and missing_b else 'missing_first_only' if missing_a else 'missing_second_only' if missing_b else None
        mapping.append({'source_row':index,'unit_id':identifier,'used':reason is None,'reason':reason})
        if reason:
            counts[reason]+=1
            continue
        a,b=numeric(row[ai]),numeric(row[bi])
        if a is None or b is None or not math.isfinite(a-b):raise ValueError('finite_outcomes_and_difference_required')
        values.append((index,identifier,a,b))
    counts.update(used=len(values),excluded=len(rows)-len(values))
    if len(values)<2:raise ValueError('at_least_two_complete_pairs')
    stats=[summary(name,[row[i+2] for row in values],counts['excluded']) for i,name in enumerate(columns)]
    differences={k:v for k,v in summary('first_minus_second',[r[2]-r[3] for r in values],counts['excluded']).items() if k not in ('column','missing')}
    if differences['sd']==0:raise ValueError('constant_differences')
    if any(not math.isfinite(item[key]) for item in [*stats,differences] for key in ('mean','median','sd','min','max')):
        raise ValueError('numeric_range_exceeded')
    pairing={'unit_column':unit,'columns':columns,'direction':'first_minus_second',
        'identity':'exact_unique_nonempty','missing':'complete_pairs'}
    return {'counts':counts,'stats':stats,'stats_basis':'complete_pairs',
        'difference_stats':differences,'pairing':pairing},values,{'format':'paired-input/v1',**pairing,'rows':mapping}


def write_input(directory,prepared,values,mapping,options):
    with (directory/'input.tsv').open('w',encoding='utf-8',newline='') as stream:
        out=csv.writer(stream,delimiter='\t',lineterminator='\n');out.writerow(['unit_id','first','second'])
        out.writerows((identifier,format(a,'.17g'),format(b,'.17g')) for _,identifier,a,b in values)
    (directory/'pair-map.json').write_bytes(json.dumps(mapping,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
    (directory/'ttest-options.json').write_bytes(json.dumps(options,sort_keys=True,separators=(',',':')).encode())
    with (directory/'ttest-options.tsv').open('w',encoding='utf-8',newline='') as stream:
        out=csv.writer(stream,delimiter='\t',lineterminator='\n');out.writerow(['alternative','confidence'])
        out.writerow([options['alternative'],options['confidence']])
    sources=preparation_sources()
    for name,raw in sources.items():(directory/name).write_bytes(raw)
    (directory/'preparation-sources.json').write_bytes(json.dumps({'sha256':preparation_hash(),
        'files':{n:hashlib.sha256(b).hexdigest() for n,b in sources.items()}},sort_keys=True,separators=(',',':')).encode())


if __name__=='__main__':
    try:
        profile,rows=parse(sys.argv[1],sys.argv[2]);request=json.loads(sys.argv[3])
        print(json.dumps(prepare(profile,rows,request['columns'],request['paired'])[0],ensure_ascii=True,allow_nan=False))
    except (ValueError,TypeError,KeyError,OverflowError,UnicodeError,csv.Error) as error:
        print(json.dumps({'error':str(error)[:100]}));sys.exit(2)
