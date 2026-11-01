"""Validate the native R paired result and freeze the complete-pair provenance."""
import csv
import hashlib
from html import escape
import json
import math
from .agent_store import canonical,now
from .paired_statistics import WARNINGS
from .models import WorkspaceError


def result(directory,prepared,payload,library,version):
    with (directory/'r-stats-result.tsv').open(encoding='utf-8',newline='') as stream:rows=list(csv.DictReader(stream,delimiter='\t'))
    if len(rows)!=1 or rows[0]['stats_version']!='4.6.2':raise ValueError()
    saved=rows[0];raw={k:float(saved[k]) for k in ('statistic','df','p_value','difference','standard_error')}
    if any(not math.isfinite(v) for v in raw.values()) or raw['standard_error']<=0 or not 0<=raw['p_value']<=1:raise ValueError()
    differences=prepared['difference_stats'];se=differences['sd']/math.sqrt(differences['n'])
    expected={'difference':differences['mean'],'standard_error':se,'statistic':differences['mean']/se,'df':differences['n']-1}
    if any(not math.isclose(raw[k],v,rel_tol=1e-8,abs_tol=1e-12) for k,v in expected.items()):raise ValueError()
    alternative=payload.paired.alternative;ci={}
    for side,infinite in (('lower',-math.inf if alternative=='less' else None),('upper',math.inf if alternative=='greater' else None)):
        value=float(saved['ci_'+side])
        if infinite is not None:
            if value!=infinite:raise ValueError()
        elif not math.isfinite(value) or side=='lower' and value>raw['difference'] or side=='upper' and value<raw['difference']:raise ValueError()
        ci[side]=None if infinite is not None else value;ci[side+'_unbounded']=infinite is not None
    test={**raw,'ci':ci,'variant':'paired','alternative':alternative,'confidence':payload.paired.confidence,
        'columns':payload.columns,'unit_column':payload.paired.unit_column}
    (directory/'environment.json').write_bytes(canonical({'r':saved['r_version'],'packages':{'stats':saved['stats_version']},'library_sha256':library.sha256}).encode())
    return {'method':'ttest_paired','row_count':prepared['counts']['total'],**prepared,'test':test,
        'software':{'stats':'4.6.2','r':version,'library_sha256':library.sha256,'library':library.info()},'warnings':WARNINGS}


def artifacts(directory,value,parameters,version,library):
    from .analysis_worker import artifacts as common,MEDIA
    (directory/'raw-summary.tsv').write_bytes(b'');common(directory,value,parameters,version)
    graph=directory/'chart.svg';graph.write_bytes(graph.read_bytes().replace(b'Non-missing values per column (count)',b'Complete pairs per measurement (count)'))
    with (directory/'summary.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        out=csv.writer(stream);out.writerow(['column','complete_pairs','excluded_pairs','mean','median','sd','min','max'])
        for item in value['stats']:
            label=item['column'];label="'"+label if label.lstrip().startswith(('=','+','-','@')) else label
            out.writerow([label]+[item[k] for k in ('n','missing','mean','median','sd','min','max')])
    (directory/'parameters.json').write_bytes(canonical({'parameters':parameters,'engine_version':version,
        'recipe_id':'ttest-paired-rstats-v1','recipe_version':1,'created_at':now(),
        'missing_rule':'complete pairs; unique exact nonempty unit ID; no inferred matching',
        'contrast':'first column minus second column','stats_basis':'complete_pairs','library':library.info(),
        'initiator':{'identity_source':'local_compat','authenticated':False},'warnings':WARNINGS}).encode())
    (directory/'statistics-lock.json').write_bytes(canonical({'library_sha256':library.sha256,'packages':library.manifest['packages']}).encode())
    with (directory/'test.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        out=csv.writer(stream);out.writerow(['statistic','df','p_value','difference','standard_error','ci_lower','ci_upper'])
        test=value['test'];out.writerow([test[k] for k in ('statistic','df','p_value','difference','standard_error')]+[
            '-Infinity' if test['ci']['lower_unbounded'] else test['ci']['lower'],'Infinity' if test['ci']['upper_unbounded'] else test['ci']['upper']])
    files=[{'name':p.name,'byte_size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
        'media_type':MEDIA.get(p.suffix,'application/octet-stream')} for p in sorted(directory.iterdir()) if p.is_file()]
    if sum(f['byte_size'] for f in files)>20*1024*1024:raise WorkspaceError('analysis_size_limit','分析产物超出存储限制。',409)
    return files


def table(value):
    keys=('column','n','missing','mean','median','sd','min','max');labels=('Measurement','Complete pairs','Excluded pairs','Mean','Median','SD','Min','Max')
    body='<h3>Paired samples: first column minus second column</h3><p>Descriptive values use complete pairs only.</p><table><thead><tr>'
    body+=''.join('<th>'+label+'</th>' for label in labels)+'</tr></thead><tbody>'
    body+=''.join('<tr>'+''.join('<td>'+escape(str(item[k]))+'</td>' for k in keys)+'</tr>' for item in value['stats'])+'</tbody></table>'
    body+='<table><tbody>'+''.join('<tr><th>'+k+'</th><td>'+escape(str(v))+'</td></tr>' for k,v in value['test'].items())+'</tbody></table>'
    return body+'<p>'+escape(json.dumps({k:value[k] for k in ('counts','pairing','warnings')},ensure_ascii=False))+'</p>'
