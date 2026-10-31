"""Fixed bounded two-group validation; callable in an isolated Python child."""
import csv
import json
from pathlib import Path
import runpy
import statistics
import sys

_tabular=runpy.run_path(str(Path(__file__).with_name('tabular.py')))
parse,numeric=_tabular['parse'],_tabular['numeric']


def group_values(profile,rows,column):
    names=[c['name'] for c in profile['columns']]
    if column not in names:raise ValueError('invalid_group_column')
    index=names.index(column)
    labels=sorted({row[index] for row in rows if row[index].strip()})
    if len(labels)!=2 or any(len(v)>200 for v in labels):raise ValueError('exactly_two_groups_required')
    return [{'label':label,'rows':sum(row[index]==label for row in rows)} for label in labels]


def prepare(profile,rows,columns,options):
    if len(columns)!=1 or columns[0]==options['group_column']:raise ValueError('one_outcome_required')
    names=[c['name'] for c in profile['columns']]
    if columns[0] not in names or not profile['columns'][names.index(columns[0])]['numeric']:
        raise ValueError('numeric_outcome_required')
    found=group_values(profile,rows,options['group_column'])
    labels=options['groups']
    if {v['label'] for v in found}!=set(labels):raise ValueError('group_labels_changed')
    vi,gi=names.index(columns[0]),names.index(options['group_column'])
    values=[[],[]];normalized=[]
    counts={'total':len(rows),'used':0,'excluded':0,'missing_outcome_only':0,'missing_group_only':0,'missing_both':0}
    for row in rows:
        missing_value,missing_group=not row[vi].strip(),not row[gi].strip()
        if missing_value or missing_group:
            reason='missing_both' if missing_value and missing_group else 'missing_outcome_only' if missing_value else 'missing_group_only'
            counts[reason]+=1
            continue
        value=numeric(row[vi]);group=labels.index(row[gi])
        if value is None:raise ValueError('numeric_outcome_required')
        values[group].append(value);normalized.append((value,group+1))
    counts['used']=len(normalized);counts['excluded']=len(rows)-len(normalized)
    if any(len(v)<2 for v in values):raise ValueError('at_least_two_per_group')
    stats=[]
    for label,items in zip(labels,values):
        stats.append({'column':label,'n':len(items),'missing':0,'mean':statistics.fmean(items),
            'median':statistics.median(items),'sd':statistics.stdev(items),'min':min(items),'max':max(items)})
    if all(item['sd']==0 for item in stats):raise ValueError('both_groups_constant')
    return {'counts':counts,'stats':stats},normalized


if __name__=='__main__':
    try:
        profile,rows=parse(sys.argv[1],sys.argv[2]);request=json.loads(sys.argv[3])
        if 'ttest' in request:value=prepare(profile,rows,request['columns'],request['ttest'])[0]
        else:value={'groups':group_values(profile,rows,request['group_column'])}
        print(json.dumps(value,ensure_ascii=True,allow_nan=False))
    except (ValueError,TypeError,KeyError,OverflowError,UnicodeError,csv.Error) as error:
        print(json.dumps({'error':str(error)[:100]}));sys.exit(2)
