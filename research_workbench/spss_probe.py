"""Fixed, bounded SPSS reader; executed only in the isolated import runtime."""
import csv
from datetime import date, datetime, time
import hashlib
import json
import math
from pathlib import Path
import runpy
import sys

MAX_BYTES=5*1024*1024
MAX_REVIEW=512*1024
POLICY={'version':1,'value_labels':'retain_codes','missing':'system_and_user_missing_to_empty',
        'dates':'iso8601_text','strings':'retain_text','blank_text':'empty_for_analysis'}


def scalar(value):
    if hasattr(value,'item'):value=value.item()
    if value is None:return None
    if isinstance(value,float) and math.isnan(value):return None
    if isinstance(value,(int,float)):
        if not math.isfinite(value):raise ValueError('nonfinite_value')
        return value
    if isinstance(value,(date,datetime,time)):return value.isoformat()
    if isinstance(value,str):return value
    raise ValueError('unsupported_value')


def text(value):
    value=scalar(value)
    if value is None:return ''
    if isinstance(value,float):return repr(value) if not value.is_integer() else str(int(value))
    return str(value)


def bounded(value,maximum=2048):
    if value is None:return ''
    value=str(value)
    if len(value)>maximum or '\x00' in value:raise ValueError('metadata_limit')
    return value


def user_missing(value,ranges):
    if value is None:return False
    return any(type(value) is type(item['lo']) and item['lo']<=value<=item['hi']
               or isinstance(value,(int,float)) and isinstance(item['lo'],(int,float)) and item['lo']<=value<=item['hi']
               for item in ranges)


def dictionary(name,raw,converted,meta,column):
    values=[scalar(value) for value in raw]
    ranges=[{'lo':scalar(item['lo']),'hi':scalar(item['hi'])} for item in meta.missing_ranges.get(name,[])]
    labels=[{'value':scalar(value),'label':bounded(label)} for value,label in meta.variable_value_labels.get(name,{}).items()]
    system=sum(value is None for value in values)
    missing=sum(user_missing(value,ranges) for value in values)
    blank=sum(isinstance(value,str) and not value.strip() and not user_missing(value,ranges) for value in values)
    temporal=any(isinstance(value,(date,datetime,time)) for value in converted)
    numeric=column['numeric'] and meta.readstat_variable_types.get(name)=='double' and not temporal
    column['numeric']=numeric
    return {'name':name,'label':bounded(meta.column_names_to_labels.get(name)),
            'source_type':'date_time' if temporal else meta.readstat_variable_types.get(name,'unknown'),
            'format':bounded(meta.original_variable_types.get(name)),
            'measure':bounded(meta.variable_measure.get(name)),
            'value_labels':labels,'missing_ranges':ranges,'system_missing':system,
            'user_missing':missing,'blank_missing':blank,'nonmissing':len(values)-system-missing-blank,'numeric':numeric}


def read_spss(source,destination):
    import pyreadstat
    source,destination=Path(source),Path(destination)
    if source.stat().st_size>MAX_BYTES:raise ValueError('source_too_large')
    with source.open('rb') as stream:
        if stream.read(4) not in (b'$FL2',b'$FL3'):raise ValueError('invalid_spss')
    _,header=pyreadstat.read_sav(source,metadataonly=True,output_format='dict',user_missing=True,disable_datetime_conversion=True)
    if not 1<=len(header.column_names)<=50:raise ValueError('column_limit')
    if header.number_rows is not None and not 1<=header.number_rows<=50000:raise ValueError('row_limit')
    raw,meta=pyreadstat.read_sav(source,output_format='dict',user_missing=True,disable_datetime_conversion=True,row_limit=50001)
    count=len(next(iter(raw.values()),[]))
    if not 1<=count<=50000:raise ValueError('row_limit')
    if any(isinstance(value,str) and (len(value)>2048 or '\x00' in value) for values in raw.values() for value in values):raise ValueError('cell_limit')
    converted,_=pyreadstat.read_sav(source,output_format='dict',user_missing=False,disable_datetime_conversion=False,row_limit=50001)
    names=meta.column_names
    if len(set(names))!=len(names) or any(not name or name!=name.strip() or len(name)>100 or any(ord(c)<32 or ord(c)==127 for c in name) for name in names):
        raise ValueError('invalid_headers')
    if any(len(raw[name])!=count or len(converted[name])!=count for name in names):raise ValueError('ragged_rows')
    with destination.open('w',encoding='utf-8',newline='') as stream:
        writer=csv.writer(stream,delimiter='\t',lineterminator='\n')
        writer.writerow(names)
        for index in range(count):
            row=[text(converted[name][index]) for name in names]
            if any(len(value)>2048 or '\x00' in value for value in row):raise ValueError('cell_limit')
            writer.writerow(row)
            if stream.tell()>MAX_BYTES:raise ValueError('expanded_too_large')
    tabular=runpy.run_path(str(Path(__file__).with_name('tabular.py')))
    profile,_=tabular['parse'](destination,'\t')
    columns=[dictionary(name,raw[name],converted[name],meta,column) for name,column in zip(names,profile['columns'])]
    review={'row_count':count,'column_count':len(names),'encoding':bounded(meta.file_encoding),
            'reader':{'id':'pyreadstat','version':pyreadstat.__version__},'policy':POLICY,'columns':columns,
            'preview':[[None if scalar(raw[name][i]) is None else text(raw[name][i])[:200] for name in names] for i in range(min(count,5))],
            'analysis_preview':profile['preview'],'sample_truncated':profile['sample_truncated']}
    encoded=json.dumps(review,ensure_ascii=True,allow_nan=False).encode()
    if len(encoded)>MAX_REVIEW:raise ValueError('metadata_limit')
    data=destination.read_bytes()
    return {'review':review,'profile':profile,'normalized_sha256':hashlib.sha256(data).hexdigest(),'normalized_size':len(data)}


if __name__=='__main__':
    try:
        _job=runpy.run_path(str(Path(__file__).with_name('import_limits.py')))['limit_memory']()
        value=read_spss(sys.argv[1],sys.argv[2])
        print(json.dumps(value,ensure_ascii=True,allow_nan=False))
    except Exception:
        # Parser internals and file content never enter the web error envelope.
        print(json.dumps({'error':'invalid_spss'}));sys.exit(2)
