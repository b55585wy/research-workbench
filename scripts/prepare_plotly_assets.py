"""Fetch the unchanged pinned strict Plotly distribution, or verify local files."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[1]
VERSION='4.2.0'
INTEGRITY='sha512-187yjrpuOgQHocroi66mWVAh6Ckdm1BOEO6uWQE552lG1GlmL/70LJdLsvOMq3evTG/EehCLFggIVm2/2ZHyJQ=='
URL=f'https://registry.npmjs.org/plotly.js-strict-dist-min/-/plotly.js-strict-dist-min-{VERSION}.tgz'
OUT=ROOT/'frontend/vendor/plotly'/VERSION
NAMES=('LICENSE','README.md','package.json','plotly-strict.min.js')


def prepare(archive=None):
    if archive is None:
        with urlopen(URL,timeout=40) as response:archive=response.read(16*1024*1024+1)
    assert len(archive)<=16*1024*1024
    assert 'sha512-'+base64.b64encode(hashlib.sha512(archive).digest()).decode()==INTEGRITY
    OUT.mkdir(parents=True,exist_ok=True);files={}
    with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as source:
        for name in NAMES:
            data=source.extractfile('package/'+name).read();(OUT/name).write_bytes(data)
            files[name]={'sha256':hashlib.sha256(data).hexdigest(),'byte_size':len(data)}
    manifest={'package':'plotly.js-strict-dist-min','version':VERSION,'license':'MIT','url':URL,'integrity':INTEGRITY,'unchanged_distribution':True,'files':files}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')


def verify():
    value=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    assert value['version']==VERSION and value['integrity']==INTEGRITY
    for name,item in value['files'].items():
        path=OUT/name;assert path.resolve().is_relative_to(OUT.resolve())
        data=path.read_bytes();assert len(data)==item['byte_size'] and hashlib.sha256(data).hexdigest()==item['sha256']
    return len(value['files'])


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--verify',action='store_true');args=parser.parse_args()
    if not args.verify:prepare()
    print(json.dumps({'version':VERSION,'verified_files':verify()}))
