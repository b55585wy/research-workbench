"""Acquire pinned local assistant Markdown assets; standard library only, no npm/Node."""
import argparse
import base64
import hashlib
import hmac
import http.client
import io
import json
import os
import re
import ssl
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LOCK=ROOT/'scripts/assistant-markdown-assets.lock.json'
OUT=ROOT/'frontend/vendor/assistant-markdown'
LOCK_REL='scripts/assistant-markdown-assets.lock.json'
OUT_REL='frontend/vendor/assistant-markdown'

MAX_TARBALL_BYTES=16*1024*1024
MAX_MEMBER_BYTES=8*1024*1024
MAX_TOTAL_BYTES=48*1024*1024
MAX_MEMBERS=10000
TIMEOUT_SECONDS=30
USER_AGENT='research-workspace-asset-preparer/1'

EXPECTED=(
    ('markdown-it','15.0.3','MIT'),
    ('markdown-it-texmath','1.0.0','MIT'),
    ('katex','0.19.1','MIT'),
    ('dompurify','3.4.17','(MPL-2.0 OR Apache-2.0)'),
)
FIXED={
    'markdown-it':(('package/dist/browser/markdown-it.umd.min.js','markdown-it.min.js'),),
    'markdown-it-texmath':(('package/texmath.js','texmath.js'),('package/css/texmath.css','texmath.css')),
    'katex':(('package/dist/katex.min.js','katex.min.js'),('package/dist/katex.min.css','katex.min.css')),
    'dompurify':(('package/dist/purify.min.js','purify.min.js'),),
}
GLOBALS={
    'markdown-it.min.js':'markdownit',
    'katex.min.js':'katex',
    'texmath.js':'texmath',
    'purify.min.js':'DOMPurify',
}
REQUIRED=('markdown-it.min.js','katex.min.js','katex.min.css','texmath.js','texmath.css','purify.min.js')

_NAME_RE=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$')
_LICENSE_RE=re.compile(r'^package/(?:licen[cs]e|copying|notice)(?:[._-][A-Za-z0-9._-]+)?$',re.IGNORECASE)
_URL_RE=re.compile(r'url\(\s*([\'"]?)([^\'")]*)\1\s*\)',re.IGNORECASE)
_FONT_REF_RE=re.compile(r'^fonts/[A-Za-z0-9][A-Za-z0-9._-]*$')
_FONT_EXT_RE=re.compile(r'\.(?:woff2|woff|ttf|otf|eot|svg)$',re.IGNORECASE)
_DRIVE_RE=re.compile(r'^[A-Za-z]:')


class AssetError(RuntimeError):
    """A pinned asset could not be acquired or verified safely."""


class _Transient(Exception):
    """A retryable network failure."""


def _ssl_context():
    context=ssl.create_default_context()
    context.check_hostname=True
    context.verify_mode=ssl.CERT_REQUIRED
    return context


SSL_CONTEXT=_ssl_context()


def _expected_tarball(name,version):
    return f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'


def load_lock():
    try:
        raw=LOCK.read_bytes()
        entries=json.loads(raw.decode('utf-8'))
    except (OSError,UnicodeDecodeError,ValueError) as exc:
        raise AssetError(f'cannot read {LOCK_REL}: {exc}') from exc
    if not isinstance(entries,list) or len(entries)!=len(EXPECTED):
        raise AssetError('lock must list exactly the four pinned packages')
    expected={name:(version,license_text) for name,version,license_text in EXPECTED}
    locked={}
    for entry in entries:
        if not isinstance(entry,dict) or not isinstance(entry.get('name'),str):
            raise AssetError('lock entry is not a package object')
        name=entry['name']
        if name in locked:
            raise AssetError(f'duplicate lock entry {name}')
        if name not in expected:
            raise AssetError(f'unexpected package in lock: {name}')
        version,license_text=expected[name]
        if entry.get('version')!=version:
            raise AssetError(f'{name}: pinned version changed')
        if entry.get('license')!=license_text:
            raise AssetError(f'{name}: pinned license changed')
        tarball=entry.get('tarball')
        if tarball!=_expected_tarball(name,version):
            raise AssetError(f'{name}: tarball URL is not the pinned registry URL')
        parsed=urllib.parse.urlparse(tarball)
        if parsed.scheme!='https' or parsed.hostname!='registry.npmjs.org' or parsed.port not in (None,443):
            raise AssetError(f'{name}: tarball URL is not HTTPS registry.npmjs.org')
        if parsed.username or parsed.password:
            raise AssetError(f'{name}: tarball URL must not embed credentials')
        integrity=entry.get('integrity')
        if not isinstance(integrity,str) or not integrity.startswith('sha512-'):
            raise AssetError(f'{name}: lock integrity is not SHA-512 SRI')
        try:
            digest=base64.b64decode(integrity[len('sha512-'):],validate=True)
        except (ValueError,TypeError) as exc:
            raise AssetError(f'{name}: malformed SRI digest') from exc
        if len(digest)!=64:
            raise AssetError(f'{name}: SRI digest is not 64 bytes')
        locked[name]={'name':name,'version':version,'license':license_text,'tarball':tarball,'integrity':integrity}
    missing=set(expected)-set(locked)
    if missing:
        raise AssetError(f'lock is missing packages: {sorted(missing)}')
    return raw,[locked[name] for name,_,_ in EXPECTED]


def _read_body(response):
    header=response.headers.get('Content-Length')
    declared=None
    if header is not None:
        try:
            declared=int(header)
        except ValueError as exc:
            raise AssetError('invalid Content-Length') from exc
        if declared<0 or declared>MAX_TARBALL_BYTES:
            raise AssetError('tarball exceeds the byte bound')
    chunks=[]
    total=0
    while True:
        chunk=response.read(64*1024)
        if not chunk:
            break
        total+=len(chunk)
        if total>MAX_TARBALL_BYTES:
            raise AssetError('tarball exceeds the byte bound')
        chunks.append(chunk)
    if declared is not None and total!=declared:
        raise _Transient('truncated download')
    if total==0:
        raise AssetError('empty download')
    return b''.join(chunks)


def _download_once(url):
    request=urllib.request.Request(
        url,
        headers={'User-Agent':USER_AGENT,'Accept':'application/octet-stream','Accept-Encoding':'identity'},
        method='GET',
    )
    try:
        with urllib.request.urlopen(request,timeout=TIMEOUT_SECONDS,context=SSL_CONTEXT) as response:
            final=urllib.parse.urlparse(response.geturl())
            if final.scheme!='https' or final.hostname!='registry.npmjs.org' or final.port not in (None,443):
                raise AssetError('download redirected outside registry.npmjs.org')
            if response.status!=200:
                raise AssetError(f'unexpected HTTP status {response.status}')
            return _read_body(response)
    except AssetError:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code in (408,425,429,500,502,503,504):
            raise _Transient(f'HTTP {exc.code}') from exc
        raise AssetError(f'HTTP {exc.code} for {url}') from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason,ssl.SSLError):
            raise AssetError(f'TLS verification failed for {url}: {exc.reason}') from exc
        raise _Transient(f'network failure for {url}: {exc.reason}') from exc
    except ssl.SSLError as exc:
        raise AssetError(f'TLS failure for {url}: {exc}') from exc
    except OSError as exc:
        raise _Transient(f'network failure for {url}: {exc}') from exc
    except http.client.HTTPException as exc:
        raise _Transient(f'network failure for {url}: {exc}') from exc


def download(url):
    for attempt in (0,1):
        try:
            return _download_once(url)
        except _Transient as exc:
            if attempt:
                raise AssetError(f'download failed after one retry: {exc}') from exc
            time.sleep(0.5)


def _verify_sri(blob,expected):
    actual='sha512-'+base64.b64encode(hashlib.sha512(blob).digest()).decode('ascii')
    if not hmac.compare_digest(actual,expected):
        raise AssetError('tarball SHA-512 integrity mismatch')


def _check_member(member,package):
    name=member.name
    if not isinstance(name,str) or not name or '\x00' in name or '\\' in name:
        raise AssetError(f'{package}: unsafe member name')
    if name.startswith('/') or _DRIVE_RE.match(name):
        raise AssetError(f'{package}: absolute member path')
    if len(name)>256:
        raise AssetError(f'{package}: overlong member path')
    raw=name[:-1] if name.endswith('/') else name
    parts=raw.split('/')
    if any(part in ('','.','..') for part in parts):
        raise AssetError(f'{package}: member path traversal')
    if any(':' in part for part in parts):
        raise AssetError(f'{package}: member path device separator')
    if parts[0]!='package':
        raise AssetError(f'{package}: member outside package/ root')
    if len(parts)<2 and not member.isdir():
        raise AssetError(f'{package}: member outside package/ root')
    if member.issym() or member.islnk():
        raise AssetError(f'{package}: symlink or hardlink member refused')
    if hasattr(member,'issparse') and member.issparse():
        raise AssetError(f'{package}: sparse member refused')
    if not member.isdir() and not member.isfile():
        raise AssetError(f'{package}: non-regular member refused')


def _index_members(tar,package):
    members={}
    for count,member in enumerate(tar,1):
        if count>MAX_MEMBERS:
            raise AssetError(f'{package}: too many tarball members')
        _check_member(member,package)
        if member.isdir():
            continue
        if member.name in members:
            raise AssetError(f'{package}: duplicate member {member.name}')
        members[member.name]=member
    return members


def _read_member(tar,members,name,package):
    member=members.get(name)
    if member is None:
        raise AssetError(f'{package}: missing required member {name}')
    if not member.isfile():
        raise AssetError(f'{package}: {name} is not a regular file')
    if member.size<0 or member.size>MAX_MEMBER_BYTES:
        raise AssetError(f'{package}: {name} exceeds the member byte bound')
    try:
        handle=tar.extractfile(member)
    except (tarfile.TarError,OSError) as exc:
        raise AssetError(f'{package}: cannot read {name}') from exc
    if handle is None:
        raise AssetError(f'{package}: cannot read {name}')
    with handle:
        data=handle.read(MAX_MEMBER_BYTES+1)
    if len(data)>MAX_MEMBER_BYTES:
        raise AssetError(f'{package}: {name} exceeds the member byte bound')
    if len(data)!=member.size:
        raise AssetError(f'{package}: short read for {name}')
    if not data:
        raise AssetError(f'{package}: empty member {name}')
    return data


def _katex_fonts(css,members,tar,package):
    try:
        text=css.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise AssetError('katex stylesheet is not UTF-8') from exc
    fonts={}
    for match in _URL_RE.finditer(text):
        reference=match.group(2).strip()
        if not reference or reference.startswith('data:'):
            continue
        if not _FONT_REF_RE.fullmatch(reference):
            raise AssetError(f'katex stylesheet references a non-local resource: {reference!r}')
        filename=reference.split('/',1)[1]
        if not _FONT_EXT_RE.search(filename):
            raise AssetError(f'katex stylesheet references an unsupported font: {reference!r}')
        rel='fonts/'+filename
        if rel not in fonts:
            fonts[rel]=_read_member(tar,members,'package/dist/'+reference,package)
    if not fonts:
        raise AssetError('katex stylesheet references no local font files')
    return fonts


def _collect_package(entry,blob):
    name=entry['name']
    try:
        with tarfile.open(fileobj=io.BytesIO(blob),mode='r:gz') as tar:
            members=_index_members(tar,name)
            chosen={}
            for member_name,rel in FIXED[name]:
                chosen[rel]=_read_member(tar,members,member_name,name)
            notices=sorted(member for member in members if _LICENSE_RE.fullmatch(member))
            if not notices:
                raise AssetError(f'{name}: no license notice in tarball')
            license_files=[]
            for notice in notices:
                base=notice.rsplit('/',1)[-1]
                if not _NAME_RE.fullmatch(base):
                    raise AssetError(f'{name}: unsafe license file name')
                rel=f'licenses/{name}-{base}'
                if rel in chosen:
                    raise AssetError(f'{name}: duplicate license output')
                chosen[rel]=_read_member(tar,members,notice,name)
                license_files.append(rel)
            if name=='katex':
                chosen.update(_katex_fonts(chosen['katex.min.css'],members,tar,name))
            return chosen,license_files
    except (tarfile.TarError,OSError,EOFError) as exc:
        raise AssetError(f'{name}: invalid gzip tarball') from exc


def _output_target(rel):
    if not isinstance(rel,str) or not rel or '\\' in rel or rel.startswith('/'):
        raise AssetError(f'unsafe output path {rel!r}')
    parts=rel.split('/')
    if any(part in ('','.','..') for part in parts):
        raise AssetError(f'unsafe output path {rel!r}')
    for part in parts:
        if not _NAME_RE.fullmatch(part):
            raise AssetError(f'unsafe output path {rel!r}')
    if OUT.is_symlink():
        raise AssetError(f'{OUT_REL} must not be a symlink')
    root=OUT.resolve()
    target=(OUT/rel).resolve()
    if target==root or not target.is_relative_to(root):
        raise AssetError(f'output path escapes {OUT_REL}: {rel!r}')
    if target.is_symlink():
        raise AssetError(f'output path is a symlink: {rel!r}')
    parent=target.parent
    while parent!=root:
        if parent.is_symlink():
            raise AssetError(f'output directory is a symlink: {parent}')
        parent=parent.parent
    return target


def _write_file(target,data):
    target.parent.mkdir(parents=True,exist_ok=True)
    fd,temp_path=tempfile.mkstemp(prefix='.asset-',dir=str(target.parent))
    try:
        with os.fdopen(fd,'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path,target)
    except BaseException:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def _license_readme(packages,license_map):
    lines=[
        '# Bundled assistant Markdown assets',
        '',
        'These third-party files are copied unmodified from pinned npm tarballs by',
        '`scripts/prepare_assistant_markdown_assets.py`. Do not edit them by hand;',
        're-run the helper to refresh the pinned set.',
        '',
        '| Package | Version | License | Source tarball | Notice file |',
        '| --- | --- | --- | --- | --- |',
    ]
    for entry in packages:
        name=entry['name']
        notices=', '.join(rel.rsplit('/',1)[-1] for rel in license_map[name])
        lines.append(f"| {name} | {entry['version']} | {entry['license']} | {entry['tarball']} | {notices} |")
    lines.extend([
        '',
        'Per-file SHA-256 digests and package SRI locks are recorded in `manifest.json`',
        'at the asset root.',
        '',
    ])
    return '\n'.join(lines).encode('utf-8')


def acquire():
    lock_raw,packages=load_lock()
    blobs={}
    for entry in packages:
        blob=download(entry['tarball'])
        _verify_sri(blob,entry['integrity'])
        blobs[entry['name']]=blob
    files={}
    license_map={}
    for entry in packages:
        chosen,license_files=_collect_package(entry,blobs[entry['name']])
        for rel,data in chosen.items():
            if rel in files:
                raise AssetError(f'duplicate output path {rel}')
            files[rel]=data
        license_map[entry['name']]=license_files
    if not set(REQUIRED).issubset(files):
        raise AssetError('required browser entry points are missing')
    if not any(rel.startswith('fonts/') for rel in files):
        raise AssetError('katex font files are missing')
    files['licenses/README.md']=_license_readme(packages,license_map)
    total_bytes=sum(len(data) for data in files.values())
    if total_bytes>MAX_TOTAL_BYTES:
        raise AssetError('selected assets exceed the total byte bound')
    lock_sha=hashlib.sha256(lock_raw).hexdigest()
    manifest={
        'generator':'scripts/prepare_assistant_markdown_assets.py',
        'lock_file':LOCK_REL,
        'lock_sha256':lock_sha,
        'output_directory':OUT_REL,
        'load_order':{
            'scripts':['markdown-it.min.js','katex.min.js','texmath.js','purify.min.js'],
            'styles':['katex.min.css','texmath.css'],
            'fonts_directory':'fonts/',
        },
        'browser_globals':GLOBALS,
        'packages':[
            {
                'name':entry['name'],
                'version':entry['version'],
                'license':entry['license'],
                'tarball':entry['tarball'],
                'integrity':entry['integrity'],
                'license_files':license_map[entry['name']],
            }
            for entry in packages
        ],
        'files':{
            rel:{'byte_size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            for rel,data in sorted(files.items())
        },
    }
    manifest_bytes=(json.dumps(manifest,indent=2,ensure_ascii=True)+'\n').encode('utf-8')
    targets={rel:_output_target(rel) for rel in files}
    manifest_target=_output_target('manifest.json')
    for rel in sorted(files):
        _write_file(targets[rel],files[rel])
    _write_file(manifest_target,manifest_bytes)
    return {
        'action':'acquired',
        'out':OUT_REL,
        'lock_sha256':lock_sha,
        'packages':{entry['name']:entry['version'] for entry in packages},
        'files':len(files),
        'fonts':sum(1 for rel in files if rel.startswith('fonts/')),
        'licenses':sum(1 for rel in files if rel.startswith('licenses/')),
        'total_bytes':total_bytes+len(manifest_bytes),
    }


def verify():
    try:
        lock_raw=LOCK.read_bytes()
        manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    except (OSError,UnicodeDecodeError,ValueError) as exc:
        raise AssetError(f'cannot read lock or manifest: {exc}') from exc
    if not isinstance(manifest,dict) or manifest.get('output_directory')!=OUT_REL:
        raise AssetError('manifest output directory mismatch')
    lock_sha=hashlib.sha256(lock_raw).hexdigest()
    if manifest.get('lock_sha256')!=lock_sha:
        raise AssetError('lock changed since the assets were prepared')
    files=manifest.get('files')
    if not isinstance(files,dict) or not files:
        raise AssetError('manifest has no files mapping')
    total_bytes=0
    for rel,meta in sorted(files.items()):
        if not isinstance(meta,dict):
            raise AssetError(f'malformed manifest entry {rel}')
        target=_output_target(rel)
        if not target.is_file():
            raise AssetError(f'missing acquired file {rel}')
        data=target.read_bytes()
        if len(data)!=meta.get('byte_size') or hashlib.sha256(data).hexdigest()!=meta.get('sha256'):
            raise AssetError(f'size or SHA-256 mismatch for {rel}')
        total_bytes+=len(data)
    if not set(REQUIRED).issubset(files):
        raise AssetError('manifest is missing required entry points')
    if not any(rel.startswith('fonts/') for rel in files):
        raise AssetError('manifest is missing katex font files')
    return {
        'action':'verified',
        'out':OUT_REL,
        'lock_sha256':lock_sha,
        'files':len(files),
        'total_bytes':total_bytes,
    }


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify',action='store_true',help='verify existing assets against manifest; no network')
    args=parser.parse_args(argv)
    try:
        summary=verify() if args.verify else acquire()
    except AssetError as exc:
        print(f'assistant markdown assets: {exc}',file=sys.stderr)
        return 1
    print(json.dumps(summary,ensure_ascii=True,sort_keys=True))
    return 0


if __name__=='__main__':
    raise SystemExit(main())
