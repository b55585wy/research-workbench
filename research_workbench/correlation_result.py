import csv,hashlib,json,math
from html import escape
from .agent_store import canonical,now
from .correlation_statistics import warnings
from .models import WorkspaceError


def number(value):
    if value=='':return None
    result=float(value)
    if not math.isfinite(result):raise ValueError()
    return result


def result(directory,prepared,payload,library,version):
    with (directory/'r-correlation-result.tsv').open(encoding='utf-8',newline='') as stream:
        rows=list(csv.DictReader(stream,delimiter='\t'))
    if len(rows)!=1 or rows[0]['stats_version']!='4.6.2':raise ValueError()
    saved=rows[0];options=payload.correlation;n=prepared['counts']['used']
    if int(saved['n'])!=n or saved['estimate_name']!=('cor' if options.kind=='pearson' else 'rho'):raise ValueError()
    estimate,p_value=number(saved['estimate']),number(saved['p_value'])
    if estimate is None or not -1<=estimate<=1 or p_value is None or not 0<=p_value<=1:raise ValueError()
    statistic=float(saved['statistic']);infinite=0
    if math.isnan(statistic):raise ValueError()
    if math.isinf(statistic):
        if options.kind!='pearson' or abs(estimate)!=1:raise ValueError()
        infinite=1 if statistic>0 else -1;statistic=None
    expected_name='t' if options.kind=='pearson' else 'S'
    df=number(saved['df'])
    if saved['statistic_name']!=expected_name or (df!=n-2 if options.kind=='pearson' else df is not None):raise ValueError()
    if options.kind=='spearman' and statistic<0:raise ValueError()
    lower,upper,level=(number(saved[k]) for k in ('ci_lower','ci_upper','confidence'))
    has_interval=options.kind=='pearson' and n>=4
    if has_interval:
        if lower is None or upper is None or not -1<=lower<=estimate<=upper<=1 or level!=options.confidence:raise ValueError()
    elif any(v is not None for v in (lower,upper,level)):raise ValueError()
    test={'kind':options.kind,'columns':payload.columns,'estimate':estimate,
          'coefficient':'r' if options.kind=='pearson' else 'rho','statistic':statistic,'statistic_infinite':infinite,
          'statistic_name':expected_name,'df':df,'p_value':p_value,'alternative':options.alternative,
          'confidence':level,'ci':{'lower':lower,'upper':upper} if has_interval else None,
          'p_value_method':'student_t' if options.kind=='pearson' else 'asymptotic_t'}
    (directory/'environment.json').write_bytes(canonical({'r':saved['r_version'],'packages':{'stats':saved['stats_version']},'library_sha256':library.sha256}).encode())
    return {'method':'correlation','row_count':prepared['counts']['total'],**prepared,'test':test,
            'software':{'stats':'4.6.2','r':version,'library_sha256':library.sha256,'library':library.info()},'warnings':warnings(options.kind)}


def artifacts(directory,value,parameters,version,library):
    from .analysis_worker import artifacts as common,MEDIA
    (directory/'raw-summary.tsv').write_bytes(b'');common(directory,value,parameters,version)
    graph=directory/'chart.svg'
    graph.write_bytes(graph.read_bytes().replace(b'Non-missing values per column (count)',b'Complete observations per variable (count)'))
    (directory/'parameters.json').write_bytes(canonical({'parameters':parameters,'engine_version':version,
        'recipe_id':'correlation-rstats-v1','recipe_version':1,'created_at':now(),
        'missing_rule':'complete pairs; same row of one dataset; no cross-table inferred matching',
        'stats_basis':'complete_pairs','library':library.info(),
        'initiator':{'identity_source':'local_compat','authenticated':False},'warnings':value['warnings']}).encode())
    (directory/'statistics-lock.json').write_bytes(canonical({'library_sha256':library.sha256,'packages':library.manifest['packages']}).encode())
    with (directory/'test.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        out=csv.writer(stream);out.writerow(['method','coefficient','estimate','n','statistic','df','p_value','ci_lower','ci_upper','p_value_method'])
        test=value['test'];statistic=test['statistic'] if not test['statistic_infinite'] else ('Infinity' if test['statistic_infinite']>0 else '-Infinity')
        out.writerow([test['kind'],test['coefficient'],test['estimate'],value['counts']['used'],statistic,test['df'],test['p_value'],
                      test['ci']['lower'] if test['ci'] else None,test['ci']['upper'] if test['ci'] else None,test['p_value_method']])
    files=[{'name':p.name,'byte_size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
            'media_type':MEDIA.get(p.suffix,'application/octet-stream')} for p in sorted(directory.iterdir()) if p.is_file()]
    if sum(f['byte_size'] for f in files)>20*1024*1024:raise WorkspaceError('analysis_size_limit','分析产物超出存储限制。',409)
    return files


def table(value):
    test=value['test'];body='<h3>Correlation / 相关分析</h3><p>Complete observation pairs only; correlation does not establish causality.</p><table><tbody>'
    fields={'method':test['kind'],'coefficient':test['coefficient'],'estimate':test['estimate'],
            'n':value['counts']['used'],'excluded':value['counts']['excluded'],'p_value':test['p_value'],
            'alternative':test['alternative'],'p_value_method':test['p_value_method'],
            'confidence_interval':test['ci'] if test['ci'] else 'Unavailable / 不提供'}
    body+=''.join('<tr><th>'+escape(k)+'</th><td>'+escape(str(v))+'</td></tr>' for k,v in fields.items())+'</tbody></table>'
    return body+'<p>'+escape(json.dumps({k:value[k] for k in ('counts','pairs','warnings')},ensure_ascii=False))+'</p>'
