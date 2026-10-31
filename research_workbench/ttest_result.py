"""Validate fixed R stats output against input and preserve the original table."""
import csv
import json
import math
from .agent_store import canonical,now
from .statistics_service import WARNINGS


def close(a,b):return math.isclose(a,b,rel_tol=1e-8,abs_tol=1e-12)


def result(directory,prepared,payload,library,version):
    with (directory/'r-stats-result.tsv').open(encoding='utf-8',newline='') as stream:
        rows=list(csv.DictReader(stream,delimiter='\t'))
    if len(rows)!=1:raise ValueError()
    saved=rows[0]
    if saved['stats_version']!='4.6.2':raise ValueError()
    raw={key:float(saved[key]) for key in ('statistic','df','p_value','difference','standard_error')}
    lower,upper=float(saved['ci_lower']),float(saved['ci_upper'])
    raw['ci']={'lower':lower if math.isfinite(lower) else None,'upper':upper if math.isfinite(upper) else None,
        'lower_unbounded':lower==-math.inf,'upper_unbounded':upper==math.inf}
    keys={'statistic','df','p_value','difference','standard_error','ci'}
    if set(raw)!=keys:raise ValueError()
    if any(type(raw[k]) not in (int,float) or not math.isfinite(raw[k]) for k in keys-{'ci'}):raise ValueError()
    if raw['df']<=0 or raw['standard_error']<=0 or not 0<=raw['p_value']<=1:raise ValueError()
    a,b=prepared['stats'];difference=a['mean']-b['mean']
    va,vb=a['sd']**2,b['sd']**2
    if payload.ttest.variant=='student':
        df=a['n']+b['n']-2
        se=math.sqrt(((a['n']-1)*va+(b['n']-1)*vb)/df*(1/a['n']+1/b['n']))
    else:
        se=math.sqrt(va/a['n']+vb/b['n'])
        df=se**4/((va/a['n'])**2/(a['n']-1)+(vb/b['n'])**2/(b['n']-1))
    if not all((close(raw['difference'],difference),close(raw['standard_error'],se),
                close(raw['statistic'],difference/se),close(raw['df'],df))):raise ValueError()
    ci=raw['ci'];alternative=payload.ttest.alternative
    if set(ci)!={'lower','upper','lower_unbounded','upper_unbounded'}:raise ValueError()
    for side,unbounded in [('lower',alternative=='less'),('upper',alternative=='greater')]:
        if type(ci[side+'_unbounded']) is not bool or ci[side+'_unbounded']!=unbounded:raise ValueError()
        if unbounded:
            if ci[side] is not None:raise ValueError()
        elif type(ci[side]) not in (int,float) or not math.isfinite(ci[side]):raise ValueError()
    if ci['lower'] is not None and ci['lower']>difference:raise ValueError()
    if ci['upper'] is not None and ci['upper']<difference:raise ValueError()
    (directory/'environment.json').write_text(canonical({'r':saved['r_version'],
        'packages':{'stats':saved['stats_version']},'library_sha256':library.sha256}),encoding='utf-8')
    test={**raw,'variant':payload.ttest.variant,'alternative':alternative,
          'confidence':payload.ttest.confidence,'outcome':payload.columns[0],
          'group_column':payload.ttest.group_column,'groups':payload.ttest.groups}
    return {'method':'ttest_independent','row_count':prepared['counts']['total'],**prepared,
            'test':test,'software':{'stats':'4.6.2','r':version,'library_sha256':library.sha256,'library':library.info()},
            'warnings':WARNINGS}


def artifacts(directory,result,parameters,version,library):
    from .analysis_worker import artifacts as common_artifacts
    (directory/'raw-summary.tsv').write_text('',encoding='utf-8')
    common_artifacts(directory,result,parameters,version)
    (directory/'parameters.json').write_text(canonical({'parameters':parameters,'engine_version':version,
        'recipe_id':'ttest-independent-rstats-v1','recipe_version':1,'created_at':now(),
        'missing_rule':'complete cases: empty outcome or group; no group filtering',
        'contrast':'group1 minus group2','library':library.info(),
        'initiator':{'identity_source':'local_compat','authenticated':False},'warnings':WARNINGS}),encoding='utf-8')
    (directory/'statistics-lock.json').write_text(canonical({'library_sha256':library.sha256,
        'packages':library.manifest['packages']}),encoding='utf-8')
    with (directory/'test.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        out=csv.writer(stream);out.writerow(['statistic','df','p_value','difference','standard_error','ci_lower','ci_upper'])
        t=result['test'];out.writerow([t[k] for k in ('statistic','df','p_value','difference','standard_error')]+[
            '-Infinity' if t['ci']['lower_unbounded'] else t['ci']['lower'],
            'Infinity' if t['ci']['upper_unbounded'] else t['ci']['upper']])
    from .analysis_worker import MEDIA
    import hashlib
    return [{'name':path.name,'byte_size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'media_type':MEDIA.get(path.suffix,'application/octet-stream')} for path in sorted(directory.iterdir()) if path.is_file()]
