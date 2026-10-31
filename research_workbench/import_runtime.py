"""A configured file-reader runtime; no user-selected programs or packages."""
import json
import os
from pathlib import Path
import subprocess

ADAPTER='spss-import-v1'
READER_VERSION='1.3.7'


def environment():
    value={name:os.environ[name] for name in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if name in os.environ}
    value.update({'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','MKL_NUM_THREADS':'1'})
    return value


class ImportRuntime:
    def __init__(self,root=None):
        self.python=None
        root=root or os.environ.get('RESEARCH_IMPORT_ROOT')
        if not root:return
        try:
            root=Path(root).resolve()
            manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
            python=Path(manifest['python']).resolve()
            if manifest['id']!='research-import-v1' or manifest['pyreadstat']!=READER_VERSION or not python.is_relative_to(root) or not python.is_file():return
            done=subprocess.run([str(python),'-I','-c','import pyreadstat; print(pyreadstat.__version__)'],
                capture_output=True,timeout=5,env=environment(),creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            if done.returncode==0 and done.stdout.decode().strip()==READER_VERSION:self.python=python
        except (OSError,ValueError,KeyError,TypeError,subprocess.TimeoutExpired):pass

    def status(self):
        return {'available':self.python is not None,'adapter':ADAPTER,'reader':{'id':'pyreadstat','version':READER_VERSION},
                'limits':{'file_bytes':5242880,'rows':50000,'columns':50,'seconds':12,'review_bytes':524288},
                'formats':['sav','zsav'],'requires_confirmation':True}
