"""Bounded fixed numeric projections, invoked by an isolated Python process."""
from decimal import Decimal,localcontext
import json
import math
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
from tabular import parse,numeric

MAX_DATA=4*1024*1024


def distribution(values,bins):
    numbers=[Decimal(repr(v)) for v in values];low=min(numbers);high=max(numbers)
    if low==high:
        label=str(low)
        return {'labels':['['+label+', '+label+']'],'counts':[len(values)],'lower':[label],'upper':[label]}
    with localcontext() as context:
        context.prec=800
        width=(high-low)/bins;edges=[low+width*i for i in range(bins)]+[high];counts=[0]*bins
        for value in numbers:counts[min(bins-1,int((value-low)/width))]+=1
        lower=[str(v) for v in edges[:-1]];upper=[str(v) for v in edges[1:]]
    labels=['['+format(edges[i],'.18g')+', '+format(edges[i+1],'.18g')+(']' if i==bins-1 else ')') for i in range(bins)]
    return {'labels':labels,'counts':counts,'lower':lower,'upper':upper}


def project(profile,rows,spec):
    columns=spec['columns'];names=[c['name'] for c in profile['columns']];indices=[names.index(n) for n in columns]
    if not all(c['numeric'] for c in profile['columns'] if c['name'] in columns):raise ValueError('invalid_columns')
    summary={'row_count':len(rows),'columns':columns}
    if spec['kind']=='analysis_counts':
        selected=[profile['columns'][i] for i in indices]
        series={'columns':columns,'valid':[c['nonempty'] for c in selected],'missing':[c['missing'] for c in selected]}
        summary.update(used_rows=len(rows),excluded_rows=0)
    elif spec['kind']=='histogram':
        values=[numeric(row[indices[0]]) for row in rows if row[indices[0]].strip()]
        series=distribution(values,spec['bins']);summary.update(used_rows=len(values),excluded_rows=len(rows)-len(values),bins=len(series['counts']))
    else:
        pairs=[(number,numeric(row[indices[0]]),numeric(row[indices[1]])) for number,row in enumerate(rows,1) if all(row[i].strip() for i in indices)]
        if not pairs:raise ValueError('no_paired_rows')
        series={'x':[p[1] for p in pairs],'y':[p[2] for p in pairs],'rows':[p[0] for p in pairs]}
        if any(not math.isfinite(max(series[k])-min(series[k])) for k in ('x','y')):raise ValueError('unsupported_numeric_range')
        summary.update(used_rows=len(pairs),excluded_rows=len(rows)-len(pairs))
    return {'summary':summary,'series':series}


if __name__=='__main__':
    try:
        profile,rows=parse(sys.argv[1],sys.argv[2]);value=project(profile,rows,json.loads(sys.argv[3]))
        data=json.dumps(value,ensure_ascii=True,allow_nan=False).encode()
        if len(data)>MAX_DATA:raise ValueError('chart_too_large')
        sys.stdout.buffer.write(data)
    except (ValueError,UnicodeError,KeyError) as error:
        print(json.dumps({'error':str(error)[:80]}));sys.exit(2)
