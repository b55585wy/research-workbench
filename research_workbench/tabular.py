"""Bounded UTF-8 table parser; also a fixed standalone upload probe."""
import csv
import json
import math
from pathlib import Path
import re
import sys

MAX_BYTES=5*1024*1024
NUMBER=re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')


def numeric(value):
    value=value.strip()
    if value.lower() in ('nan','inf','infinity','+inf','-inf','+infinity','-infinity'):
        raise ValueError('nonfinite_value')
    if not value or not NUMBER.fullmatch(value):return None
    number=float(value)
    if not math.isfinite(number):raise ValueError('nonfinite_value')
    return number


def parse(path,delimiter):
    if Path(path).stat().st_size>MAX_BYTES:raise ValueError('dataset_too_large')
    csv.field_size_limit(2048)
    with Path(path).open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.reader(stream,delimiter=delimiter,strict=True)
        headers=[s.strip() for s in next(reader,[])]
        if not 1<=len(headers)<=50:raise ValueError('invalid_headers')
        if len(set(headers))!=len(headers):raise ValueError('invalid_headers')
        if any(not h or len(h)>100 or any(ord(c)<32 or ord(c)==127 for c in h) for h in headers):
            raise ValueError('invalid_headers')
        rows=[]
        for row in reader:
            if len(row)!=len(headers):raise ValueError('ragged_rows')
            if any('\x00' in cell or len(cell)>2048 for cell in row):raise ValueError('invalid_cell')
            rows.append(row)
            if len(rows)>50000:raise ValueError('row_limit')
    if not rows:raise ValueError('empty_dataset')
    columns=[]
    for index,name in enumerate(headers):
        present=[row[index] for row in rows if row[index].strip()]
        values=[numeric(value) for value in present]
        columns.append({'name':name,'numeric':bool(present) and all(v is not None for v in values),
                        'nonempty':len(present),'missing':len(rows)-len(present)})
    preview=[[cell[:200] for cell in row] for row in rows[:5]]
    profile={'row_count':len(rows),'column_count':len(headers),'columns':columns,'preview':preview,
             'sample_truncated':len(rows)>5 or any(len(c)>200 for r in rows[:5] for c in r)}
    return profile,rows


if __name__=='__main__':
    try:
        profile,_=parse(sys.argv[1],sys.argv[2])
        print(json.dumps(profile,ensure_ascii=True,allow_nan=False))
    except (ValueError,UnicodeError,csv.Error,StopIteration) as error:
        print(json.dumps({'error':str(error)[:80]}));sys.exit(2)
