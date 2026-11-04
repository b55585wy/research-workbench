"""Operator CLI: build, install and atomically select a compatible UI release."""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
from uuid import uuid4
import zipfile

from . import __version__
from .ui_releases import (FORMAT, MAX_BYTES, MAX_FILE_BYTES, MAX_FILES, OFFLINE_FORMAT,
                           OFFLINE_MANIFEST, OFFLINE_WORKER, STABLE_FILES, ReleaseError,
                           backend_fingerprint, canonical, digest, read_manifest, safe_name,
                           stable_fingerprints, validate_manifest, verify_files)


# Offline-playable, immutable same-release payloads only. HTML, Markdown, plain
# text, licenses, the legacy device worker and the derived manifest are excluded.
OFFLINE_SUFFIXES = ('.js', '.mjs', '.css', '.json', '.bcmap', '.pfb', '.ttf', '.woff', '.woff2', '.wasm', '.pdf')
OFFLINE_LEGAL = re.compile(r'(?i)^(?:licen[cs]e|notice|copying)(?:[._-]|$)')


def offline_assets(payload):
    names = []
    for name in payload:
        if name in (OFFLINE_MANIFEST, 'device-sw.js'):
            continue
        path = PurePosixPath(name)
        if any(part.lower() == 'licenses' for part in path.parts[:-1]) or OFFLINE_LEGAL.match(path.name):
            continue
        if path.suffix.lower() in OFFLINE_SUFFIXES:
            names.append(name)
    return sorted(names)


def offline_manifest(payload, identifier):
    try:
        index = payload['index.html'].decode('utf-8')
        choice = payload['storage-choice.html'].decode('utf-8')
    except KeyError as error:
        raise ReleaseError('Offline manifest requires the device and storage-choice HTML') from error
    prefix = '/_ui/' + identifier
    return {'format': OFFLINE_FORMAT, 'release': identifier,
            'entries': {'device': {'url': '/device/',
                                   'html': index.replace('<html ', '<html data-storage-mode="device" ', 1)},
                        'choice': {'url': '/', 'html': choice}},
            'assets': [{'url': prefix + '/' + name, 'sha256': digest(payload[name]), 'bytes': len(payload[name])}
                       for name in offline_assets(payload)]}


def asset_pattern(frontend):
    reserved = {'api', 'device', 'storage', '_ui', 'device-sw.js'}
    roots = [p.name for p in frontend.iterdir() if p.name not in reserved and p.suffix != '.html']
    return re.compile(r'''(["'`]|url\(\s*)/(''' + '|'.join(re.escape(n) for n in sorted(roots, key=len, reverse=True)) + r''')(?=/|[?#"'`\s)$])''')


def pack(project, output, frontend=None):
    project, output = Path(project), Path(output)
    frontend = Path(frontend) if frontend else project / 'frontend'
    files = {}
    for path in sorted(frontend.rglob('*')):
        if path.is_symlink():
            raise ReleaseError('Frontend symlinks are not supported')
        if path.is_file():
            name = safe_name(path.relative_to(frontend).as_posix())
            if name != OFFLINE_MANIFEST:
                files[name] = path.read_bytes()
    backend, stable = backend_fingerprint(project), stable_fingerprints(frontend)
    source = {name: digest(body) for name, body in files.items()}
    identifier = 'ui-' + __version__ + '-' + digest(canonical({'backend': backend, 'files': source}))[:16]
    prefix, pattern = '/_ui/' + identifier, asset_pattern(frontend)
    payload = {}
    for name, body in files.items():
        if name not in STABLE_FILES and Path(name).suffix in ('.html', '.css', '.js', '.mjs'):
            text = pattern.sub(lambda m: m[1] + prefix + '/' + m[2], body.decode('utf-8'))
            body = text.encode('utf-8')
        payload[name] = body
    if OFFLINE_WORKER in files:
        # Derived after the release identifier is fixed, then hashed like any
        # other payload file. The manifest never lists itself, so hashing stays
        # acyclic while its bytes remain part of the release.
        payload[OFFLINE_MANIFEST] = canonical(offline_manifest(payload, identifier))
    manifest = {'format': FORMAT, 'release': identifier, 'ui_version': __version__, 'backend_sha256': backend,
                'stable_files': stable, 'files': {name: {'bytes': len(body), 'sha256': digest(body)} for name, body in payload.items()}}
    validate_manifest(manifest, backend, stable)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('RELEASE.json', canonical(manifest))
        for name, body in payload.items():
            archive.writestr('frontend/' + name, body)
    return manifest


def install(project, releases, archive_path):
    project, releases = Path(project), Path(releases)
    if releases.is_symlink() or releases.exists() and not releases.is_dir():
        raise ReleaseError('Release root must be a dedicated directory')
    if not releases.exists():
        releases.mkdir(parents=True)
        releases.chmod(0o755)
    staging = Path(tempfile.mkdtemp(prefix='.install-', dir=releases))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            names = {i.filename for i in entries}
            if 'RELEASE.json' not in names or len(names) != len(entries) or len(entries) > MAX_FILES + 1 or sum(i.file_size for i in entries) > MAX_BYTES + 2 * 1024 * 1024:
                raise ReleaseError('Invalid release archive size or duplicate paths')
            for item in entries:
                safe_name(item.filename)
                if item.is_dir() or stat.S_ISLNK(item.external_attr >> 16) or item.file_size > MAX_FILE_BYTES:
                    raise ReleaseError('Unsupported release archive entry')
            manifest = json.loads(archive.read('RELEASE.json'))
            validate_manifest(manifest, backend_fingerprint(project), stable_fingerprints(project / 'frontend'))
            if names != {'RELEASE.json'} | {'frontend/' + name for name in manifest['files']}:
                raise ReleaseError('Archive manifest mismatch')
            for item in entries:
                target = staging / item.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(item))
        verify_files(staging, manifest)
        staging.chmod(0o755)
        for path in staging.rglob('*'):
            path.chmod(0o755 if path.is_dir() else 0o644)
        target = releases / manifest['release']
        if target.exists():
            existing = read_manifest(target, backend_fingerprint(project), stable_fingerprints(project / 'frontend'))
            if existing != manifest:
                raise ReleaseError('Existing release differs')
            verify_files(target, existing)
        else:
            staging.rename(target)
        return manifest
    finally:
        if staging.exists():
            assert staging.resolve().parent == releases.resolve() and staging.name.startswith('.install-') and not staging.is_symlink()
            shutil.rmtree(staging)


def activate(project, releases, identifier):
    from .ui_releases import RELEASE_ID
    project, releases = Path(project), Path(releases)
    if not RELEASE_ID.fullmatch(identifier):
        raise ReleaseError('Invalid release identifier')
    target = releases / identifier
    if target.is_symlink():
        raise ReleaseError('Release symlinks are not supported')
    manifest = read_manifest(target, backend_fingerprint(project), stable_fingerprints(project / 'frontend'))
    verify_files(target, manifest)
    pointer = releases / 'current.json'
    previous = json.loads(pointer.read_text(encoding='utf-8')).get('release') if pointer.exists() else None
    pending = releases / ('.current-' + uuid4().hex)
    try:
        with pending.open('x', encoding='utf-8') as stream:
            json.dump({'release': identifier, 'previous': previous}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        pending.chmod(0o644)
        os.replace(pending, pointer)
    finally:
        pending.unlink(missing_ok=True)
    return {'release': identifier, 'previous': previous}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('pack')
    build.add_argument('archive', type=Path)
    setup = commands.add_parser('install')
    setup.add_argument('archive', type=Path)
    setup.add_argument('releases', type=Path)
    switch = commands.add_parser('activate')
    switch.add_argument('releases', type=Path)
    switch.add_argument('release')
    args = parser.parse_args()
    if args.command == 'pack':
        result = pack(args.project, args.archive)
    elif args.command == 'install':
        result = install(args.project, args.releases, args.archive)
    else:
        result = activate(args.project, args.releases, args.release)
    print(json.dumps({key: value for key, value in result.items() if key in ('release', 'previous', 'ui_version')}))


if __name__ == '__main__':
    main()
