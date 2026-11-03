"""Fixed complete-observation preparation; only numeric data enters R."""
import csv,hashlib,json,math
from pathlib import Path
import runpy,statistics,sys

_tabular=runpy.run_path(str(Path(__file__).with_name('tabular.py')))
parse,numeric=_tabular['parse'],_tabular['numeric']


def preparation_sources():
    return {name:Path(__file__).with_name(name).read_bytes() for name in ('correlation_data.py','tabular.py')}


def preparation_hash():
    values={name:hashlib.sha256(raw).hexdigest() for name,raw in preparation_sources().items()}
    return hashlib.sha256(json.dumps(values,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def summary(name,values,excluded):
    return {'column':name,'n':len(values),'missing':excluded,'mean':statistics.fmean(values),
            'median':statistics.median(values),'sd':statistics.stdev(values),'min':min(values),'max':max(values)}


def prepare(profile,rows,columns,options):
    names=[c['name'] for c in profile['columns']]
    if len(columns)!=2 or len(set(columns))!=2 or any(c not in names for c in columns):raise ValueError('two_distinct_columns_required')
    if not all(profile['columns'][names.index(c)]['numeric'] for c in columns):raise ValueError('numeric_columns_required')
    ai,bi=(names.index(c) for c in columns)
    values,mapping=[],[]
    counts={'total':len(rows),'used':0,'excluded':0,'missing_first_only':0,'missing_second_only':0,'missing_both':0}
    for index,row in enumerate(rows,1):
        a_missing,b_missing=not row[ai].strip(),not row[bi].strip()
        reason='missing_both' if a_missing and b_missing else 'missing_first_only' if a_missing else 'missing_second_only' if b_missing else None
        mapping.append({'source_row':index,'used':reason is None,'reason':reason})
        if reason:
            counts[reason]+=1
            continue
        a,b=numeric(row[ai]),numeric(row[bi])
        if a is None or b is None:raise ValueError('finite_numeric_pairs_required')
        values.append((a,b))
    counts.update(used=len(values),excluded=len(rows)-len(values))
    if len(values)<3:raise ValueError('at_least_three_complete_pairs')
    series=[[row[i] for row in values] for i in range(2)]
    if any(len(set(x))<2 for x in series):raise ValueError('constant_column')
    stats=[summary(name,series[i],counts['excluded']) for i,name in enumerate(columns)]
    if any(not math.isfinite(item[key]) for item in stats for key in ('mean','median','sd','min','max')):raise ValueError('numeric_range_exceeded')
    pairs={'columns':columns,'missing':'complete_pairs','matching':'same_row_same_dataset',
           'ties':{'first':len(values)-len(set(series[0])),'second':len(values)-len(set(series[1]))}}
    prepared={'counts':counts,'stats':stats,'stats_basis':'complete_pairs','pairs':pairs}
    return prepared,values,{'format':'correlation-input/v1',**pairs,'rows':mapping}


def write_input(directory,prepared,values,mapping,options):
    with (directory/'input.tsv').open('w',encoding='utf-8',newline='') as stream:
        out=csv.writer(stream,delimiter='\t',lineterminator='\n');out.writerow(['first','second'])
        out.writerows((format(a,'.17g'),format(b,'.17g')) for a,b in values)
    for name,value in [('pair-map.json',mapping),('correlation-options.json',options)]:
        (directory/name).write_bytes(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
    with (directory/'correlation-options.tsv').open('w',encoding='utf-8',newline='') as stream:
        out=csv.writer(stream,delimiter='\t',lineterminator='\n');out.writerow(['kind','alternative','confidence'])
        out.writerow([options['kind'],options['alternative'],options['confidence']])
    sources=preparation_sources()
    for name,raw in sources.items():(directory/name).write_bytes(raw)
    (directory/'preparation-sources.json').write_bytes(json.dumps({'sha256':preparation_hash(),
        'files':{n:hashlib.sha256(b).hexdigest() for n,b in sources.items()}},sort_keys=True,separators=(',',':')).encode())


if __name__=='__main__':
    try:
        profile,rows=parse(sys.argv[1],sys.argv[2]);request=json.loads(sys.argv[3])
        print(json.dumps(prepare(profile,rows,request['columns'],request['correlation'])[0],ensure_ascii=True,allow_nan=False))
    except (ValueError,TypeError,KeyError,OverflowError,UnicodeError,csv.Error) as error:
        print(json.dumps({'error':str(error)[:100]}));sys.exit(2)
