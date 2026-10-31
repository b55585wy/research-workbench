"""Closed raw-observation projection; no aggregation or inferential calculation."""
import csv
import json
import math
from pathlib import Path
import runpy
import sys

_tabular=runpy.run_path(str(Path(__file__).with_name('tabular.py')))
parse,numeric=_tabular['parse'],_tabular['numeric']
MAX_DATA=4*1024*1024


def project(profile,rows,spec):
    if spec['kind']!='grouped_points' or len(spec['columns'])!=2:raise ValueError('invalid_columns')
    columns=spec['columns'];names=[c['name'] for c in profile['columns']]
    if columns[0]==columns[1] or not set(columns)<=set(names):raise ValueError('invalid_columns')
    xi,yi=[names.index(name) for name in columns]
    if not profile['columns'][yi]['numeric']:raise ValueError('numeric_outcome_required')
    summary={'row_count':len(rows),'columns':columns,'groups':[],
             'missing_group_only':0,'missing_value_only':0,'missing_both':0}
    series={'x':[],'y':[],'rows':[]};groups={}
    for number,row in enumerate(rows,1):
        label=row[xi];missing_x,missing_y=not label.strip(),not row[yi].strip()
        if not missing_x and (len(label)>200 or any(ord(c)<32 or 127<=ord(c)<=159 for c in label)):
            raise ValueError('invalid_group_label')
        if missing_x or missing_y:
            reason='missing_both' if missing_x and missing_y else 'missing_group_only' if missing_x else 'missing_value_only'
            summary[reason]+=1
            continue
        value=numeric(row[yi])
        if value is None:raise ValueError('numeric_outcome_required')
        groups[label]=groups.get(label,0)+1
        if len(groups)>2:raise ValueError('exactly_two_complete_groups_required')
        series['x'].append(label);series['y'].append(value);series['rows'].append(number)
    if len(groups)!=2:raise ValueError('exactly_two_complete_groups_required')
    if not math.isfinite(max(series['y'])-min(series['y'])):raise ValueError('unsupported_numeric_range')
    summary.update(used_rows=len(series['y']),excluded_rows=len(rows)-len(series['y']),
                   groups=[{'label':label,'count':count} for label,count in groups.items()])
    return {'summary':summary,'series':series}


if __name__=='__main__':
    try:
        profile,rows=parse(sys.argv[1],sys.argv[2]);value=project(profile,rows,json.loads(sys.argv[3]))
        data=json.dumps(value,ensure_ascii=True,allow_nan=False).encode()
        if len(data)>MAX_DATA:raise ValueError('chart_too_large')
        sys.stdout.buffer.write(data)
    except (ValueError,TypeError,KeyError,OverflowError,UnicodeError,csv.Error) as error:
        print(json.dumps({'error':str(error)[:100]}));sys.exit(2)
