"""Fixed reviewed computation: no generated or uploaded code execution."""
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

from .models import WorkspaceError

PYTHON_CODE='''import csv,statistics
with open('input.tsv',encoding='utf-8',newline='') as f:
    reader=csv.reader(f,delimiter='\\t');names=next(reader);rows=list(reader)
with open('raw-summary.tsv','w',encoding='utf-8',newline='') as f:
    out=csv.writer(f,delimiter='\\t',lineterminator='\\n')
    out.writerow(['column','n','missing','mean','median','sd','min','max'])
    for i,name in enumerate(names):
        values=[float(r[i]) for r in rows if r[i]!='NA']
        out.writerow([name,len(values),len(rows)-len(values),statistics.fmean(values),
            statistics.median(values),statistics.stdev(values) if len(values)>1 else '',min(values),max(values)])
print('Completed descriptive summary with Python standard library.')
'''
R_CODE='''options(warn=2,digits=17)
d <- read.delim("input.tsv",header=TRUE,sep="\\t",quote="\\\"",comment.char="",
    colClasses="numeric",na.strings="NA",check.names=FALSE,fileEncoding="UTF-8")
result <- do.call(rbind,lapply(seq_along(d),function(i) {
    x <- d[[i]]; values <- x[!is.na(x)]
    data.frame(column=names(d)[i],n=length(values),missing=sum(is.na(x)),
        mean=mean(values),median=median(values),sd=if(length(values)>1) sd(values) else NA_real_,
        min=min(values),max=max(values),stringsAsFactors=FALSE,check.names=FALSE)
}))
write.table(result,"raw-summary.tsv",sep="\\t",row.names=FALSE,quote=TRUE,
    na="",fileEncoding="UTF-8",eol="\\n")
cat("Completed descriptive summary with base R.\\n")
'''


def clean_environment(directory):
    keys=('SYSTEMROOT','WINDIR','COMSPEC','PATHEXT')
    env={k:v for k,v in os.environ.items() if k.upper() in keys}
    env.update(TEMP=str(directory),TMP=str(directory),R_USER=str(directory),LANGUAGE='en',
               OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1')
    return env


def recipe(engine,method='describe'):
    if engine not in ('python','r'):raise WorkspaceError('invalid_engine','请选择 Python 或 R。',422)
    if method=='correlation':
        if engine!='r':raise WorkspaceError('invalid_engine','相关分析需要已验证的 R 统计环境。',422)
        from .correlation_data import preparation_hash
        code='# Input preparation SHA-256: '+preparation_hash()+'\n'+Path(__file__).with_name('correlation_adapter.R').read_bytes().decode('utf-8')
        return {'engine':'r','id':'correlation-rstats-v1','version':1,'code':code,'sha256':hashlib.sha256(code.encode()).hexdigest()}
    if method=='ttest_paired':
        if engine!='r':raise WorkspaceError('invalid_engine','配对 t 检验需要已验证的 R 统计环境。',422)
        from .paired_ttest_data import preparation_hash
        code='# Input preparation SHA-256: '+preparation_hash()+'\n'+Path(__file__).with_name('paired_ttest_adapter.R').read_bytes().decode('utf-8')
        return {'engine':'r','id':'ttest-paired-rstats-v1','version':1,'code':code,'sha256':hashlib.sha256(code.encode()).hexdigest()}
    if method=='ttest_independent':
        if engine!='r':raise WorkspaceError('invalid_engine','独立样本 t 检验需要已验证的 R 统计环境。',422)
        code=Path(__file__).with_name('ttest_adapter.R').read_bytes().decode('utf-8')
        return {'engine':'r','id':'ttest-independent-rstats-v1','version':1,'code':code,
                'sha256':hashlib.sha256(code.encode('utf-8')).hexdigest()}
    if method!='describe':raise WorkspaceError('invalid_method','请选择已安装的分析方法。',422)
    code=PYTHON_CODE if engine=='python' else R_CODE
    return {'engine':engine,'id':'describe-v1','version':1,'code':code,
            'sha256':hashlib.sha256(code.encode('utf-8')).hexdigest()}


class RuntimeCatalog:
    def __init__(self,rscript=None,statistics_root=None):
        from .statistics_library import StatisticsLibrary
        self.statistics=StatisticsLibrary(statistics_root)
        self.rscript=Path(rscript).resolve() if rscript else None
        if self.rscript is None:
            found=shutil.which('Rscript');self.rscript=Path(found).resolve() if found else None
        self.r_version=None
        self.rterm=None
        if self.rscript is not None and self.rscript.name.lower() in ('rscript.exe','rscript') and self.rscript.is_file():
            try:
                run=subprocess.run([str(self.rscript),'--version'],capture_output=True,text=True,timeout=5,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                text=(run.stdout or run.stderr).strip().splitlines()
                if run.returncode==0 and text and text[0].startswith('Rscript '):self.r_version=text[0][:180]
            except (OSError,subprocess.TimeoutExpired):pass
        if os.name=='nt' and self.r_version:
            self.rterm=next((p for p in (self.rscript.parent/'x64/Rterm.exe',self.rscript.parent/'Rterm.exe') if p.is_file()),None)
            if self.rterm is None:self.r_version=None
        if self.statistics.available:
            home=Path(self.statistics.manifest['r_home']).resolve()
            allowed={home/'bin/Rscript.exe',home/'bin/x64/Rscript.exe',home/'bin/Rscript'}
            if self.rscript not in allowed or not self.r_version or '4.6.2' not in self.r_version:
                self.statistics.available=False

    def engines(self):
        return [{'id':'python','available':True,'version':'Python '+platform.python_version(),'recipe_sha256':recipe('python')['sha256']},
                {'id':'r','available':bool(self.r_version),'version':self.r_version,'recipe_sha256':recipe('r')['sha256']}]

    def require(self,engine):
        result=next((r for r in self.engines() if r['id']==engine),None)
        if result is None or not result['available']:raise WorkspaceError('engine_unavailable','当前分析语言尚未配置可用的运行环境。',409)
        return result

    def command(self,engine,directory):
        self.require(engine)
        if engine=='python':return [getattr(sys,'_base_executable',sys.executable),'-I','-S',str(directory/'analysis.py')]
        if self.rterm:return [str(self.rterm),'--vanilla','--slave','-f',str(directory/'analysis.R')]
        return [str(self.rscript),'--vanilla',str(directory/'analysis.R')]
