"""Immutable UI releases. Switching the entry never replaces the running backend."""
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re

from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

FORMAT = 'research-workspace-ui-v1'
OFFLINE_FORMAT = 'research-workspace-offline-v1'
OFFLINE_MANIFEST = 'offline-manifest.json'
OFFLINE_WORKER = 'offline-worker.js'
MAX_BYTES = 100 * 1024 * 1024
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_FILES = 5000
STABLE_FILES = ('device-sw.js', 'device-db.js', 'vendor/device-storage/device-storage.js')
RELEASE_ID = re.compile(r'ui-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\Z')


class ReleaseError(ValueError):
    pass


def digest(body):
    return hashlib.sha256(body).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def safe_name(name):
    if not isinstance(name, str) or not name or '\\' in name or '\0' in name or ':' in name:
        raise ReleaseError('Invalid release path')
    path = PurePosixPath(name)
    if path.is_absolute() or name == '.' or '..' in path.parts or path.as_posix() != name:
        raise ReleaseError('Invalid release path')
    return name


def backend_fingerprint(project):
    project = Path(project)
    files = sorted((project / 'research_workbench').rglob('*.py'))
    files += sorted(project.glob('requirements*.txt'))
    if not files:
        raise ReleaseError('Backend sources are missing')
    hashes = {}
    for path in files:
        body = path.read_bytes()
        if path == project / 'research_workbench/__init__.py':
            body = re.sub(rb"__version__\s*=\s*['\"][^'\"]+['\"]", b"__version__ = 'VERSION'", body)
        hashes[path.relative_to(project).as_posix()] = digest(body)
    return digest(canonical(hashes))


def stable_fingerprints(frontend):
    return {name: digest((Path(frontend) / name).read_bytes()) for name in STABLE_FILES}


def validate_payload(manifest):
    """Release metadata that must hold for any installed release.

    Deliberately independent of the running backend: an installed bundle is
    judged by its own recorded metadata, path bounds and file hashes.
    """
    if not isinstance(manifest, dict) or manifest.get('format') != FORMAT or not isinstance(manifest.get('release'), str) or not RELEASE_ID.fullmatch(manifest['release']):
        raise ReleaseError('Unsupported UI release')
    files = manifest.get('files')
    if not isinstance(files, dict) or not 1 <= len(files) <= MAX_FILES or 'index.html' not in files:
        raise ReleaseError('Invalid release file list')
    total = 0
    for name, meta in files.items():
        safe_name(name)
        if not isinstance(meta, dict):
            raise ReleaseError('Invalid release file metadata')
        size, sha = meta.get('bytes'), meta.get('sha256')
        if type(size) is not int or not 0 <= size <= MAX_FILE_BYTES or not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{64}', sha):
            raise ReleaseError('Invalid release file metadata')
        total += size
    if total > MAX_BYTES:
        raise ReleaseError('Invalid release size')
    return files


def validate_manifest(manifest, backend, stable):
    files = validate_payload(manifest)
    if manifest.get('backend_sha256') != backend or manifest.get('stable_files') != stable:
        raise ReleaseError('UI release requires a backend or device-storage update')
    if any(files.get(name, {}).get('sha256') != sha for name, sha in stable.items()):
        raise ReleaseError('Invalid release size or stable device files')


def release_metadata(directory):
    directory = Path(directory)
    path = directory / 'RELEASE.json'
    if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
        raise ReleaseError('Invalid release manifest')
    return json.loads(path.read_text(encoding='utf-8'))


def read_manifest(directory, backend, stable):
    directory = Path(directory)
    manifest = release_metadata(directory)
    validate_manifest(manifest, backend, stable)
    if directory.name != manifest['release']:
        raise ReleaseError('Release directory mismatch')
    return manifest


def read_historical_manifest(directory, identifier):
    """Validate an already-installed immutable bundle on its own terms.

    Selection and installation stay bound to the running backend fingerprint.
    Serving bytes that a still-open page pinned must not be: a distribution-only
    update changes that fingerprint while the installed bundle stays intact.
    """
    directory = Path(directory)
    manifest = release_metadata(directory)
    validate_payload(manifest)
    if directory.name != manifest['release'] or manifest['release'] != identifier:
        raise ReleaseError('Release directory mismatch')
    verify_files(directory, manifest)
    return manifest


def verify_files(directory, manifest):
    frontend = Path(directory) / 'frontend'
    for name, meta in manifest['files'].items():
        path = frontend / name
        if path.is_symlink() or any((frontend / parent).is_symlink() for parent in PurePosixPath(name).parents):
            raise ReleaseError('Release symlinks are not supported')
        body = path.read_bytes()
        if len(body) != meta['bytes'] or digest(body) != meta['sha256']:
            raise ReleaseError('Release file checksum mismatch')


class UIDelivery:
    def __init__(self, frontend, releases=None):
        self.frontend = Path(frontend)
        self.releases = Path(releases) if releases else None

    @lru_cache(maxsize=1)
    def compatibility(self):
        return backend_fingerprint(self.frontend.parent), stable_fingerprints(self.frontend)

    @lru_cache(maxsize=8)
    def release(self, identifier):
        if not self.releases or not RELEASE_ID.fullmatch(identifier):
            raise ReleaseError('Unknown UI release')
        directory = self.releases / identifier
        if directory.is_symlink():
            raise ReleaseError('Release symlinks are not supported')
        manifest = read_manifest(directory, *self.compatibility())
        verify_files(directory, manifest)
        return directory, manifest, StaticFiles(directory=directory / 'frontend')

    @lru_cache(maxsize=8)
    def historical(self, identifier):
        """Installed bundle served to pages opened before a distribution update.

        Unlike ``release`` this never compares against the running backend or
        stable-file fingerprints, so pinned immutable paths keep their bytes.
        """
        if not self.releases or not RELEASE_ID.fullmatch(identifier):
            raise ReleaseError('Unknown UI release')
        directory = self.releases / identifier
        if directory.is_symlink():
            raise ReleaseError('Release symlinks are not supported')
        manifest = read_historical_manifest(directory, identifier)
        return directory, manifest, StaticFiles(directory=directory / 'frontend')

    def selected(self):
        if not self.releases:
            return self.frontend, None
        pointer = self.releases / 'current.json'
        if pointer.is_symlink() or pointer.stat().st_size > 1024:
            raise ReleaseError('Invalid active UI pointer')
        selected = json.loads(pointer.read_text(encoding='utf-8'))
        if not isinstance(selected, dict):
            raise ReleaseError('Invalid active UI pointer')
        identifier = selected.get('release')
        directory, manifest, _ = self.release(identifier)
        return directory / 'frontend', manifest['release']

    def html(self, name, *, device=False):
        try:
            frontend, identifier = self.selected()
            content = (frontend / name).read_text(encoding='utf-8')
            if device:
                content = content.replace('<html ', '<html data-storage-mode="device" ', 1)
            headers = {'Cache-Control': 'no-store'}
            if identifier:
                headers['X-Workspace-UI-Release'] = identifier
            return HTMLResponse(content, headers=headers)
        except (OSError, ValueError, TypeError):
            return HTMLResponse('Workspace is temporarily unavailable. Please try again.', status_code=503,
                                headers={'Cache-Control': 'no-store', 'Retry-After': '3'})

    async def asset(self, path, scope):
        identifier, separator, name = path.partition('/')
        try:
            if not separator or name.endswith('.html') or name == 'device-sw.js':
                raise ReleaseError('Not a versioned asset')
            _, manifest, static = await run_in_threadpool(self.historical, identifier)
            if safe_name(name) not in manifest['files']:
                raise ReleaseError('Unknown release asset')
            response = await static.get_response(name, scope)
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
            response.headers['X-Workspace-UI-Release'] = identifier
            if name == OFFLINE_WORKER:
                # Only the exact versioned worker may claim the root scope; every
                # other asset keeps its existing headers and versioned HTML stays 404.
                response.headers['Service-Worker-Allowed'] = '/'
            return response
        except (OSError, ValueError, TypeError):
            return Response(status_code=404, headers={'Cache-Control': 'no-store'})


@lru_cache(maxsize=8)
def _delivery(frontend, releases):
    return UIDelivery(frontend, releases)


def delivery_for(frontend):
    return _delivery(str(frontend), os.environ.get('RESEARCH_WORKBENCH_UI_RELEASES'))
