"""Build the verified Windows/Python3.12 SPSS reader without changing the app venv."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import venv

parser=argparse.ArgumentParser(description='Create a separate, pinned SPSS file-reader runtime')
parser.add_argument('--root',type=Path,required=True)
args=parser.parse_args()
if sys.platform!='win32' or sys.version_info[:2]!=(3,12):parser.error('This wheel lock is verified for Windows Python 3.12 only')
root=args.root.resolve()
if root.exists():parser.error('Destination already exists; choose a new empty runtime location')
root.mkdir(parents=True)
wheels=root/'wheels';wheels.mkdir()
lock=Path(__file__).resolve().parent/'import-runtime/requirements.lock.txt'
venv.EnvBuilder(with_pip=True).create(root/'venv')
python=root/'venv/Scripts/python.exe'
subprocess.run([str(python),'-m','pip','download','--only-binary=:all:','--require-hashes','--dest',str(wheels),'-r',str(lock)],check=True)
subprocess.run([str(python),'-m','pip','install','--no-index','--find-links',str(wheels),'--require-hashes','-r',str(lock)],check=True)
code='import importlib.metadata as m,json; print(json.dumps({d.metadata["Name"]:d.version for d in m.distributions()}))'
packages=json.loads(subprocess.check_output([str(python),'-I','-c',code],text=True))
assert packages['pyreadstat']=='1.3.7' and packages['numpy']=='2.5.4' and packages['narwhals']=='2.28.0'
manifest={'id':'research-import-v1','python':str(python),'pyreadstat':'1.3.7','packages':packages,
          'wheels':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in wheels.iterdir()},
          'lock_sha256':hashlib.sha256(lock.read_bytes()).hexdigest(),
          'bytes':sum(path.stat().st_size for path in root.rglob('*') if path.is_file())}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'ready':True,'runtime':str(root),'bytes':manifest['bytes']}))
