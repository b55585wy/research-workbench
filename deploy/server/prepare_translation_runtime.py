#!/usr/bin/env python3
"""Prepare the isolated Linux MinerU 4.1.5 Flash/txt parser runtime.

One purpose: build a brand-new conda prefix for the translation parser, run it
against a private glibc 2.28 sysroot instead of the host glibc 2.17 (CentOS 7),
install the pinned Linux lock, and publish runtime.json only after an offline
import check proves the result.

Hard boundaries:
  * writes only inside the new --root (plus conda's own package cache);
  * never touches system Python/libc, ld.so.conf, the app or its runtimes,
    services, firewall or SSH; never activates or exports LD_LIBRARY_PATH;
  * root must be fresh: absolute, below /opt/research-workspace/runtimes, not
    that directory itself, not existing (file, directory, symlink or non-empty);
  * refuses to publish runtime.json when any readiness check fails;
  * no recursive delete and no silent resume: a failed run leaves its evidence
    under the new root for review and the operator picks a new destination;
  * --finalize-existing is the one explicit exception: the operator names an
    existing failed root, nothing is installed or patched, and only the
    readiness audit plus manifest publication run.

Run it as root on the CentOS 7 host with the existing app runtime interpreter
(Python 3.12) or Miniforge base Python, for example:

  /opt/research-workspace/runtimes/app-0.50.0/bin/python \
      deploy/server/prepare_translation_runtime.py --root /opt/research-workspace/runtimes/mineru-flash-v415-linux

After a failed run whose packages are already installed, finalize that same
root explicitly instead of downloading and patching again:

  /opt/research-workspace/runtimes/app-0.50.0/bin/python \
      deploy/server/prepare_translation_runtime.py --finalize-existing \
      --root /opt/research-workspace/runtimes/mineru-flash-v415-linux
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time

RUNTIME_PARENT = Path('/opt/research-workspace/runtimes')
DEFAULT_ROOT = RUNTIME_PARENT / 'mineru-flash-v415-linux'
DEFAULT_CONDA = Path('/opt/research-workspace/miniforge/bin/conda')
LOCK_NAME = 'translation-requirements.lock.txt'
MANIFEST_NAME = 'runtime.json'

# python/pip/patchelf plus the private sysroot. libgcc/libstdc++/libgomp are the
# manylinux-whitelisted runtime libraries that PyPI wheels expect from the host.
CONDA_PACKAGES = ['python=3.12', 'pip', 'patchelf', 'sysroot_linux-64=2.28',
                  'libgcc-ng', 'libstdcxx-ng', 'libgomp']

# Contract pins (research_workbench/translation_runtime.py) and the Linux
# platform pins that make this lock a Linux lock rather than the Windows one.
CONTRACT_PINS = {'mineru': '4.1.5', 'docvortex': '0.6.11'}
PLATFORM_PINS = {'onnxruntime': '1.24.4', 'onnxruntime-ep-webgpu': '0.4.0',
                 'resvg-py': '0.5.0'}
FORBIDDEN_NAMES = {'torch', 'torchvision', 'triton', 'win32-setctime', 'directml',
                   'pywin32', 'pywintypes', 'wmi', 'pypiwin32', 'nvidia'}
FORBIDDEN_PREFIXES = ('nvidia-', 'cuda-', 'win32-')

LIBC_SEARCH = ('lib64', 'usr/lib64', 'lib', 'usr/lib')
# libnss_files/libnss_dns/libresolv are required, not optional: the DNS path is
# resolved by the private glibc, so a host-side 2.17 NSS module loaded next to a
# private 2.28 libresolv would mix glibc ABIs during pip's lookups.
LIBC_REQUIRED = ('ld-linux-x86-64.so.2', 'libc.so.6', 'libm.so.6',
                 'libpthread.so.0', 'libdl.so.2', 'librt.so.1', 'libutil.so.1',
                 'libnss_files.so.2', 'libnss_dns.so.2', 'libresolv.so.2')
# Copied when the sysroot ships them; absent ones are recorded, not fatal.
LIBC_OPTIONAL = ('libanl.so.1', 'libnsl.so.1', 'libmvec.so.1', 'libcrypt.so.1')

EXPECTED_GLIBC = 'glibc 2.28'
EXPECTED_PYTHON = (3, 12)
MIN_FREE_MIB = 4608
FINALIZE_MIN_FREE_MIB = 64
CONDA_TIMEOUT = 600
PIP_TIMEOUT = 1800
PATCH_TIMEOUT = 120
METADATA_TIMEOUT = 300
ALLOWED_EXTRA_PINS = {'pip', 'wheel'}
BLOCKED_PREFIXES = ('PYTHON', 'PIP', 'LD_', 'CONDA', 'HF_', 'TRANSFORMERS',
                    'MODELSCOPE', 'VIRTUAL_ENV')
OFFLINE_ENV = {'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
               'MODELSCOPE_OFFLINE': '1', 'TOKENIZERS_PARALLELISM': 'false',
               'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
               'OPENBLAS_NUM_THREADS': '1', 'PYTHONDONTWRITEBYTECODE': '1'}

# Small self-reporting children: the memory bound is applied inside the child
# before the expensive imports, and /proc/self/maps proves which loader and
# libc the kernel actually mapped. No document, model or network access.
PROBE = r'''
import json, os, resource, sys
limit = int(sys.argv[3]) * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
maps = open('/proc/self/maps', encoding='utf-8', errors='replace').read()
print(json.dumps({
    'version': list(sys.version_info[:3]),
    'executable': sys.executable,
    'base_executable': sys._base_executable,
    'prefix': sys.prefix,
    'base_prefix': sys.base_prefix,
    'libc': os.confstr('CS_GNU_LIBC_VERSION'),
    'loader_loaded': sys.argv[1] in maps,
    'libc_loaded': sys.argv[2] in maps,
}))
'''

READY = r'''
import json, os, resource, sys
import importlib.metadata
limit = int(sys.argv[3]) * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
maps = open('/proc/self/maps', encoding='utf-8', errors='replace').read()
versions = {}
for name in json.loads(sys.argv[4]):
    try:
        versions[name] = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        versions[name] = None
import ssl
import ctypes
import pypdfium2
from mineru.parser import parse
print(json.dumps({
    'version': list(sys.version_info[:3]),
    'executable': sys.executable,
    'base_executable': sys._base_executable,
    'prefix': sys.prefix,
    'base_prefix': sys.base_prefix,
    'libc': os.confstr('CS_GNU_LIBC_VERSION'),
    'loader_loaded': sys.argv[1] in maps,
    'libc_loaded': sys.argv[2] in maps,
    'versions': versions,
    'parse_callable': callable(parse),
    'mineru_module': getattr(sys.modules['mineru.parser'], '__file__', None),
    'openssl': getattr(ssl, 'OPENSSL_VERSION', None),
}))
'''

# Version audit source of truth: every installed distribution's declared
# name/version, read through importlib.metadata. Raw `pip freeze` output is kept
# only as provenance, because conda-installed packages legitimately carry
# `name @ file:///home/conda/...` direct_url lines that are not version pins.
AUDIT = r'''
import json, resource, sys
import importlib.metadata
limit = int(sys.argv[3]) * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
found = []
for dist in importlib.metadata.distributions():
    metadata = dist.metadata
    found.append({
        'name': metadata['Name'] if metadata is not None else None,
        'version': dist.version,
        'path': str(getattr(dist, '_path', '') or ''),
    })
print(json.dumps({'distributions': found}))
'''


def state(name, **fields):
    """One short machine-readable line per step; never contains secrets."""
    payload = {'state': name}
    payload.update(fields)
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True), flush=True)


def fail(code, detail):
    state('failed', code=code, detail=detail)
    raise SystemExit(1)


def tail(path, limit=1200):
    try:
        data = Path(path).read_bytes()
    except OSError:
        return ''
    text = data[-limit:].decode('utf-8', 'replace').strip()
    return re.sub(r'\s+', ' ', text)


def within(path, root):
    try:
        Path(path).relative_to(root)
        return True
    except ValueError:
        return False


def canonical(name):
    """PEP 503 name: 'resvg_py' and 'resvg-py' are the same distribution."""
    return re.sub(r'[-_.]+', '-', name).lower()


def inside(path, root):
    """Symlink-free containment check for paths that must already exist."""
    return within(Path(os.path.realpath(str(path))), Path(os.path.realpath(str(root))))


def sha256(path):
    digest = hashlib.sha256()
    with open(str(path), 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def child_env(extra=None):
    """Isolated child environment: no inherited Python/pip/LD/conda settings."""
    env = {}
    for key, value in os.environ.items():
        upper = key.upper()
        if upper.startswith(BLOCKED_PREFIXES):
            continue
        env[key] = value
    env['PYTHONNOUSERSITE'] = '1'
    if extra:
        env.update(extra)
    return env


def run(command, log, timeout, env, failure='command_failed'):
    log = Path(log)
    with open(str(log), 'ab') as handle:
        handle.write(('\n$ ' + ' '.join(command) + '\n').encode('utf-8'))
        handle.flush()
        try:
            completed = subprocess.run(command, stdin=subprocess.DEVNULL,
                                       stdout=handle, stderr=subprocess.STDOUT,
                                       timeout=timeout, env=env)
        except subprocess.TimeoutExpired:
            fail('command_timeout',
                 '%s exceeded %ss; see %s' % (Path(command[0]).name, timeout, log.name))
        except OSError as error:
            fail('command_unavailable', '%s: %s' % (command[0], error.strerror))
    if completed.returncode != 0:
        fail(failure, '%s exited %s; see %s: %s'
             % (Path(command[0]).name, completed.returncode, log.name, tail(log)))
    return completed.returncode


def capture(command, timeout, env):
    try:
        completed = subprocess.run(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        fail('command_timeout', '%s exceeded %ss' % (Path(command[0]).name, timeout))
    except OSError as error:
        fail('command_unavailable', '%s: %s' % (command[0], error.strerror))
    if completed.returncode != 0:
        fail('command_failed', '%s exited %s: %s'
             % (Path(command[0]).name, completed.returncode,
                completed.stderr.decode('utf-8', 'replace').strip()[:600]))
    return completed.stdout.decode('utf-8', 'replace')


def checked_destination(value):
    root = Path(value)
    if not root.is_absolute():
        fail('root_not_absolute', '%s is not an absolute path' % root)
    root = Path(os.path.normpath(str(root)))
    if root == RUNTIME_PARENT or RUNTIME_PARENT not in root.parents:
        fail('root_not_below', '%s must be strictly below %s' % (root, RUNTIME_PARENT))
    if os.path.lexists(str(root)):
        fail('root_exists', '%s already exists; choose a new destination' % root)
    parent = root.parent
    if not parent.is_dir():
        fail('root_parent_missing',
             '%s is missing; create the runtime parent directory first' % parent)
    probe = parent
    while True:
        if probe.is_symlink():
            fail('root_parent_symlink', '%s is a symlink' % probe)
        if probe.parent == probe:
            break
        probe = probe.parent
    return root


def checked_existing(value):
    """Strict operator path for --finalize-existing: an existing failed root.

    Deliberately separate from checked_destination: it requires the exact
    runtime parent, no symlink anywhere in the path, uid 0 ownership and an
    already-present root. It never creates or replaces anything.
    """
    root = Path(value)
    if not root.is_absolute():
        fail('root_not_absolute', '%s is not an absolute path' % root)
    root = Path(os.path.normpath(str(root)))
    if root == RUNTIME_PARENT or RUNTIME_PARENT not in root.parents:
        fail('root_not_below', '%s must be strictly below %s' % (root, RUNTIME_PARENT))
    probe = root
    while True:
        if probe.is_symlink():
            fail('root_symlink', '%s in the root path is a symlink' % probe)
        if probe.parent == probe:
            break
        probe = probe.parent
    if not root.is_dir():
        fail('root_missing', '%s is not an existing directory' % root)
    if Path(os.path.realpath(str(root))) != root:
        fail('root_symlink', '%s does not resolve to itself' % root)
    if root.stat().st_uid != 0:
        fail('root_not_owned', '%s is not owned by uid 0' % root)
    return root


def checked_executable(value, label):
    path = Path(value)
    if not path.is_absolute():
        fail('%s_not_absolute' % label, '%s is not an absolute path' % path)
    if not path.is_file() or not os.access(str(path), os.X_OK):
        fail('%s_unusable' % label, '%s is not an executable file' % path)
    return path


def checked_lock(value):
    path = Path(value)
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    if not path.is_file():
        fail('lock_missing', '%s is not a file' % path)
    pins = {}
    for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9][A-Za-z0-9._+-]*)', line)
        if match is None:
            fail('lock_unpinned',
                 '%s line %d is not a plain name==version pin' % (path.name, number))
        name, version = match.group(1), match.group(2)
        if canonical(name) in pins:
            fail('lock_duplicate', '%s line %d repeats %s' % (path.name, number, name))
        pins[canonical(name)] = (name, version)
    for name in sorted(pins):
        if name in FORBIDDEN_NAMES or name.startswith(FORBIDDEN_PREFIXES):
            fail('lock_forbidden_package', '%s/%s is not part of this runtime' % (name, pins[name][1]))
    for name, version in CONTRACT_PINS.items():
        if pins.get(name, (None, None))[1] != version:
            fail('lock_contract', 'lock must pin %s==%s' % (name, version))
    for name, version in PLATFORM_PINS.items():
        if pins.get(name, (None, None))[1] != version:
            fail('lock_platform', 'Linux lock must pin %s==%s' % (name, version))
    return path, pins


def checked_sysroot(env):
    sysroot = env / 'x86_64-conda-linux-gnu' / 'sysroot'
    if not sysroot.is_dir():
        fail('sysroot_missing',
             '%s not found; sysroot_linux-64=2.28 did not install' % sysroot)
    return sysroot


def sysroot_entry(sysroot, directory, name):
    """Resolve one name inside the sysroot; absolute link targets stay in it."""
    path = directory / name
    for _ in range(16):
        if not os.path.lexists(str(path)):
            return None
        if os.path.islink(str(path)):
            target = os.readlink(str(path))
            if target.startswith('/'):
                path = Path(os.path.normpath(str(sysroot / target.lstrip('/'))))
            else:
                path = Path(os.path.normpath(os.path.join(str(path.parent), target)))
            if path != sysroot and sysroot not in path.parents:
                fail('sysroot_escape', '%s resolves outside the private sysroot' % name)
            continue
        return path if path.is_file() else None
    fail('sysroot_loop', '%s never resolves to a file' % name)


def private_libc(root, sysroot):
    """Flatten the sysroot's runtime ELF files into a private, host-free libc dir.

    Symlinks are followed inside the sysroot only and copied as regular files,
    so no symlink in the runtime can point at the host /lib64.
    """
    target = root / 'libc'
    target.mkdir(mode=0o755)
    copied = {}
    for name in LIBC_REQUIRED + LIBC_OPTIONAL:
        source = None
        for part in LIBC_SEARCH:
            source = sysroot_entry(sysroot, sysroot / part, name)
            if source is not None:
                break
        if source is None:
            if name in LIBC_REQUIRED:
                fail('libc_incomplete', '%s missing from %s' % (name, sysroot))
            continue
        destination = target / name
        # copyfile opens a new inode; never patch or link a shared file.
        shutil.copyfile(str(source), str(destination))
        os.chmod(destination, 0o755)
        with open(str(destination), 'rb') as handle:
            if handle.read(4) != b'\x7fELF':
                fail('libc_not_elf', '%s is not an ELF file' % destination)
        copied[name] = sha256(destination)
    state('libc', dir=str(target), files=sorted(copied),
          absent=sorted(set(LIBC_OPTIONAL) - set(copied)))
    return target


def elf_paths(root, env, libc_dir, binary):
    """Re-read the patched ELF interpreter/RPATH and require private, in-root paths.

    Shared by the fresh create path and --finalize-existing so both prove the
    same invariant instead of trusting an earlier patchelf invocation.
    """
    binary = Path(binary)
    patchelf = env / 'bin/patchelf'
    if not patchelf.is_file():
        fail('patchelf_missing', '%s is not a file' % patchelf)
    if not binary.is_file():
        fail('python_missing', '%s is not a file' % binary)
    tool_env = child_env()
    version = capture([str(patchelf), '--version'], PATCH_TIMEOUT, tool_env).strip()
    interpreter = capture([str(patchelf), '--print-interpreter', str(binary)],
                          PATCH_TIMEOUT, tool_env).strip()
    rpath = capture([str(patchelf), '--print-rpath', str(binary)],
                    PATCH_TIMEOUT, tool_env).strip()
    loader = libc_dir / 'ld-linux-x86-64.so.2'
    if not loader.is_file() or not inside(loader, root):
        fail('loader_missing', 'private loader %s is not inside the runtime' % loader)
    if interpreter != str(loader):
        fail('interpreter_not_private', 'ELF interpreter is %s' % interpreter)
    for entry in rpath.split(':'):
        relative_rpath(entry, root, binary)        # validate the stored order
    return interpreter, rpath, version


def patched_python(root, env, libc_dir, logs):
    """Copy env/bin/python3.12 to a new inode, then point it at the private libc."""
    binary = env / 'bin/python3.12'
    if not binary.is_file():
        fail('python_missing', '%s is not a file' % binary)
    real = Path(os.path.realpath(str(binary)))
    if Path(os.path.realpath(str(env / 'bin'))) != real.parent:
        fail('python_outside_bin', '%s does not live in %s' % (real, env / 'bin'))
    staging = env / 'bin' / ('.python3.12.new.%d' % os.getpid())
    if os.path.lexists(str(staging)):
        fail('staging_exists', '%s already exists' % staging)
    mode = stat.S_IMODE(real.stat().st_mode)
    shutil.copyfile(str(real), str(staging))          # always break the hardlink
    os.chmod(staging, mode)
    os.replace(str(staging), str(real))               # atomic env/bin/python3.12
    if real.stat().st_nlink != 1:
        fail('python_hardlink', '%s still shares its inode' % real)

    patchelf = env / 'bin/patchelf'
    if not patchelf.is_file():
        fail('patchelf_missing', '%s is not a file' % patchelf)
    tool_env = child_env()
    before_rpath = capture([str(patchelf), '--print-rpath', str(real)],
                           PATCH_TIMEOUT, tool_env).strip()
    capture([str(patchelf), '--print-interpreter', str(real)], PATCH_TIMEOUT, tool_env)

    entries = ['$ORIGIN/../../libc', '$ORIGIN/../lib']
    for entry in before_rpath.split(':'):
        if not entry or entry in entries:
            continue
        entries.append(relative_rpath(entry, root, real))
    loader = libc_dir / 'ld-linux-x86-64.so.2'
    # DT_RPATH (not DT_RUNPATH) so libraries dlopen'd later by wheels inherit the
    # same search order and still find the private libc, env/lib and prior paths.
    run([str(patchelf), '--force-rpath', '--set-interpreter', str(loader),
         '--set-rpath', ':'.join(entries), str(real)],
        logs / 'patchelf.log', PATCH_TIMEOUT, tool_env, 'patchelf_failed')

    interpreter, rpath, patchelf_version = elf_paths(root, env, libc_dir, real)
    for link in ('python', 'python3'):
        path = env / 'bin' / link
        if not path.exists() or Path(os.path.realpath(str(path))) != real:
            fail('python_link_changed', '%s no longer resolves to %s' % (link, real))
    state('patched', python=str(real), interpreter=interpreter, rpath=rpath,
          patchelf=patchelf_version)
    return real, loader, patchelf_version, rpath


def relative_rpath(entry, root, binary):
    """Keep the existing search order, but only inside the new runtime."""
    if entry == '$ORIGIN':
        return entry
    if entry.startswith('$ORIGIN/'):
        resolved = Path(os.path.normpath(os.path.join(str(binary.parent), entry[8:])))
        if not inside(resolved, root) or not resolved.is_dir():
            fail('rpath_outside_runtime', '%s does not resolve inside the runtime' % entry)
        return entry
    if entry.startswith('/'):
        resolved = Path(os.path.normpath(entry))
        if not inside(resolved, root) or not resolved.is_dir():
            fail('rpath_outside_runtime', '%s does not resolve inside the runtime' % entry)
        return '$ORIGIN/' + os.path.relpath(str(resolved), str(binary.parent)).replace(os.sep, '/')
    fail('rpath_relative_entry', 'unsupported relative RPATH entry %r' % entry)


def probe(python, code, loader, libc_file, memory_mib, timeout, log, env, extra=()):
    command = [str(python), '-I', '-c', code, str(loader), str(libc_file),
               str(memory_mib)] + list(extra)
    try:
        completed = subprocess.run(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   timeout=timeout, env=env, cwd=str(python.parent.parent))
    except subprocess.TimeoutExpired:
        fail('probe_timeout', 'bounded child exceeded %ss; see %s' % (timeout, Path(log).name))
    except OSError as error:
        fail('probe_unavailable', '%s: %s' % (command[0], error.strerror))
    with open(str(log), 'ab') as handle:
        handle.write(('\n$ %s -I -c <probe>\n' % python).encode('utf-8'))
        handle.write(completed.stdout)
        handle.write(completed.stderr)
    if completed.returncode != 0:
        fail('probe_failed', 'exit %s; see %s: %s'
             % (completed.returncode, Path(log).name,
                completed.stderr.decode('utf-8', 'replace').strip()[-600:]))
    lines = [line for line in completed.stdout.decode('utf-8', 'replace').splitlines() if line.strip()]
    if not lines:
        fail('probe_empty', 'child produced no JSON; see %s' % Path(log).name)
    try:
        value = json.loads(lines[-1])
    except ValueError:
        fail('probe_invalid', 'child output is not JSON; see %s' % Path(log).name)
    if not isinstance(value, dict):
        fail('probe_invalid', 'child output is not a JSON object; see %s' % Path(log).name)
    return value


def verified(payload, root, env, python, where):
    problems = []
    if list(payload.get('version', []))[:2] != list(EXPECTED_PYTHON):
        problems.append('python %s' % payload.get('version'))
    if payload.get('libc') != EXPECTED_GLIBC:
        problems.append('libc %s != %s' % (payload.get('libc'), EXPECTED_GLIBC))
    for key in ('executable', 'base_executable'):
        value = payload.get(key) or ''
        if not os.path.isabs(value) or not inside(value, root):
            problems.append('%s %s outside runtime' % (key, value))
    if os.path.realpath(str(python)) != os.path.realpath(payload.get('executable') or ''):
        problems.append('executable mismatch')
    if not payload.get('prefix') or not inside(payload['prefix'], root):
        problems.append('prefix %s outside runtime' % payload.get('prefix'))
    elif os.path.realpath(payload['prefix']) != os.path.realpath(str(env)):
        problems.append('prefix %s is not %s' % (payload.get('prefix'), env))
    if not payload.get('loader_loaded'):
        problems.append('private loader not mapped')
    if not payload.get('libc_loaded'):
        problems.append('private libc not mapped')
    if problems:
        fail('interpreter_unverified', '%s: %s' % (where, '; '.join(problems)))
    return payload


def verify_interpreter(root, env, python, loader, libc_file, memory_mib, logs):
    """Bounded PROBE + contract checks; shared by create and finalize paths."""
    report = probe(python, PROBE, loader, libc_file, memory_mib, 120,
                   logs / 'interpreter.log', child_env(OFFLINE_ENV))
    report = verified(report, root, env, python, 'interpreter')
    state('interpreter', python=report['version'], glibc=report['libc'],
          executable=report['executable'])
    return report


def record_provenance(root, conda, env, python):
    """Save raw pip freeze and conda explicit output.

    Provenance only: conda's pip freeze may legitimately contain
    `name @ file:///home/conda/...` direct_url lines, which are not version
    pins and are never parsed as such. The installed-version audit below uses
    importlib.metadata instead.
    """
    metadata_env = child_env({'PIP_CONFIG_FILE': os.devnull,
                              'PIP_DISABLE_PIP_VERSION_CHECK': '1'})
    freeze = capture([str(python), '-I', '-m', 'pip', 'freeze', '--all'],
                     METADATA_TIMEOUT, metadata_env)
    explicit = capture([str(conda), 'list', '--prefix', str(env), '--explicit'],
                       METADATA_TIMEOUT, metadata_env)
    for name, text in (('pip-freeze.txt', freeze), ('conda-explicit.txt', explicit)):
        path = root / name
        path.write_text(text, encoding='utf-8')
        os.chmod(str(path), 0o644)


def audited_pins(report):
    """Installed name/version pins from importlib.metadata, not freeze text."""
    entries = report.get('distributions')
    if not isinstance(entries, list):
        fail('audit_invalid', 'metadata audit did not return a distribution list')
    pins = {}
    for entry in entries:
        if not isinstance(entry, dict):
            fail('audit_invalid', 'metadata audit entry is not an object')
        name, version = entry.get('name'), entry.get('version')
        if not name or not version:
            fail('metadata_unreadable',
                 'installed distribution at %s has no Name/Version'
                 % (entry.get('path') or '?'))
        key = canonical(str(name))
        text = str(version)
        if key in pins:
            if pins[key][1] != text:
                fail('metadata_conflict', '%s is installed as both %s and %s'
                     % (name, pins[key][1], text))
            continue
        pins[key] = (str(name), text)
    return pins


def audit_dependencies(env, python, loader, libc_file, lock_pins, logs):
    """Ask the patched interpreter for every installed distribution version."""
    report = probe(python, AUDIT, loader, libc_file, 512, METADATA_TIMEOUT,
                   logs / 'metadata-audit.log', child_env(OFFLINE_ENV))
    actual = audited_pins(report)
    compare_pins(lock_pins, actual)
    state('dependencies', installed=len(actual), pinned=len(lock_pins),
          source='importlib.metadata')
    return actual


def compare_pins(lock_pins, actual):
    missing, different, extra = [], [], []
    for name, (display, version) in lock_pins.items():
        found = actual.get(name)
        if found is None:
            missing.append(display)
        elif found[1] != version:
            different.append('%s %s != %s' % (display, found[1], version))
    for name, (display, version) in actual.items():
        if name not in lock_pins and name not in ALLOWED_EXTRA_PINS:
            extra.append('%s==%s' % (display, version))
    if missing:
        fail('dependency_missing', 'not installed: %s' % ', '.join(sorted(missing)))
    if different:
        fail('dependency_mismatch', '; '.join(sorted(different)))
    if extra:
        fail('dependency_unpinned', 'installed but not pinned: %s' % ', '.join(sorted(extra)))


def checked_metadata(root, env, python, lock_pins):
    """Mirror the application's readiness guard before publishing anything."""
    python = Path(python)
    if not python.is_absolute() or not inside(python, root):
        fail('manifest_python_outside', '%s is not inside %s' % (python, root))
    site = env / 'lib/python3.12/site-packages'
    if not site.is_dir():
        fail('site_packages_missing', '%s is not a directory' % site)
    for name in sorted(CONTRACT_PINS):
        version = lock_pins[name][1]
        meta = site / ('%s-%s.dist-info/METADATA' % (name, version))
        if not meta.is_file():
            fail('dist_info_missing', '%s is not a file' % meta)
        text = '\n' + meta.read_text(encoding='utf-8').replace('\r\n', '\n')
        if '\nVersion: %s\n' % version not in text:
            fail('dist_info_version', '%s does not declare version %s' % (meta, version))
    return site


def manifest_payload(root, python, loader, libc_file, lock_copy, lock_pins,
                     report, rpath, patchelf_version, site):
    files = [path for path in root.rglob('*') if path.is_file()]
    return {
        'schema_version': 1,
        'engine': 'mineru-flash-txt',
        'mineru_version': CONTRACT_PINS['mineru'],
        'docvortex_version': CONTRACT_PINS['docvortex'],
        'python': str(python),
        # Provenance only; the application reads the four contract fields above.
        'created_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'python_version': report.get('version'),
        'glibc': report.get('libc'),
        'elf_interpreter': str(loader),
        'elf_rpath': rpath,
        'interpreter_sha256': sha256(python),
        'loader_sha256': sha256(loader),
        'libc_sha256': sha256(libc_file),
        'lock_sha256': sha256(lock_copy),
        'lock': lock_copy.name,
        'pip_freeze': 'pip-freeze.txt',
        'conda_explicit': 'conda-explicit.txt',
        'patchelf_version': patchelf_version,
        'site_packages': str(site),
        'pinned_packages': len(lock_pins),
        'bytes': sum(path.stat().st_size for path in files),
        'files': len(files),
    }


def publish(root, manifest):
    """Atomic manifest write; it never exists for a failed run."""
    temporary = root / (MANIFEST_NAME + '.tmp')
    with open(str(temporary), 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(str(temporary), 0o644)
    if os.path.lexists(str(root / MANIFEST_NAME)):
        fail('manifest_exists', '%s appeared during the run' % (root / MANIFEST_NAME))
    os.replace(str(temporary), str(root / MANIFEST_NAME))
    os.chmod(str(root), 0o755)


def postinstall(root, env, python, loader, libc_file, conda, lock_copy, lock_pins,
                report, rpath, patchelf_version, memory_mib, import_timeout, logs):
    """Shared readiness after a fresh install or an operator finalization.

    Nothing here installs, patches or downloads: provenance records, the
    metadata version audit, the offline import check, the app-facing metadata
    guard and the atomic manifest all operate on the existing root.
    """
    record_provenance(root, conda, env, python)
    audit_dependencies(env, python, loader, libc_file, lock_pins, logs)

    names = [lock_pins[name][0] for name in sorted(lock_pins)]
    ready = probe(python, READY, loader, libc_file, memory_mib, import_timeout,
                  logs / 'imports.log', child_env(OFFLINE_ENV), [json.dumps(names)])
    ready = verified(ready, root, env, python, 'imports')
    if not isinstance(ready.get('versions'), dict):
        fail('probe_invalid', 'import child did not report package versions')
    if not ready.get('parse_callable'):
        fail('parser_missing', 'mineru.parser.parse is not callable')
    if not ready.get('mineru_module') or not inside(ready['mineru_module'], env):
        fail('parser_outside_runtime', 'mineru imported from %s' % ready.get('mineru_module'))
    for name in sorted(lock_pins):
        display, version = lock_pins[name]
        if ready['versions'].get(display) != version:
            fail('dependency_mismatch', '%s is %s, pinned %s'
                 % (display, ready['versions'].get(display), version))
    state('imports', glibc=ready['libc'], openssl=ready.get('openssl'),
          ssl=True, ctypes=True, pypdfium2=True, mineru_parser=True)

    site = checked_metadata(root, env, python, lock_pins)
    manifest = manifest_payload(root, python, loader, libc_file, lock_copy,
                                lock_pins, ready, rpath, patchelf_version, site)
    publish(root, manifest)
    state('ready', runtime=str(root), python=str(python), glibc=manifest['glibc'],
          files=manifest['files'], bytes=manifest['bytes'],
          manifest=str(root / MANIFEST_NAME))


def finalize(root, conda, lock, lock_pins, args):
    """Explicit operator finalization of an existing failed root; installs nothing."""
    env = root / 'env'
    binary = env / 'bin/python3.12'
    if not binary.is_file():
        fail('python_missing', '%s is not a file' % binary)
    real = Path(os.path.realpath(str(binary)))
    if Path(os.path.realpath(str(env / 'bin'))) != real.parent:
        fail('python_outside_bin', '%s does not live in %s' % (real, env / 'bin'))
    if os.path.lexists(str(root / MANIFEST_NAME)):
        fail('manifest_exists', '%s already exists; use a fresh --root'
             % (root / MANIFEST_NAME))
    copied = root / LOCK_NAME
    if not copied.is_file() or not inside(copied, root):
        fail('lock_copy_missing', '%s is not the copied lock inside the root' % copied)
    supplied = sha256(lock)
    if supplied != sha256(copied):
        fail('lock_mismatch',
             'supplied lock sha256 %s differs from %s' % (supplied, copied))

    libc_dir = root / 'libc'
    loader = libc_dir / 'ld-linux-x86-64.so.2'
    libc_file = libc_dir / 'libc.so.6'
    for path in (loader, libc_file):
        if not path.is_file() or not inside(path, root):
            fail('libc_incomplete', '%s is missing from the existing root' % path)
    interpreter, rpath, patchelf_version = elf_paths(root, env, libc_dir, real)
    logs = root / 'logs'
    if not logs.is_dir():
        logs.mkdir(mode=0o755)
    state('finalize', root=str(root), python=str(real), interpreter=interpreter,
          rpath=rpath, patchelf=patchelf_version, lock_sha256=supplied)

    report = verify_interpreter(root, env, real, loader, libc_file,
                                args.import_memory_mib, logs)
    postinstall(root, env, real, loader, libc_file, conda, copied, lock_pins,
                report, rpath, patchelf_version, args.import_memory_mib,
                args.import_timeout, logs)


def main():
    parser = argparse.ArgumentParser(
        description='Create the isolated Linux MinerU Flash translation runtime')
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT,
                        help='new runtime root (default %(default)s)')
    parser.add_argument('--conda', type=Path, default=DEFAULT_CONDA,
                        help='existing conda executable (default %(default)s)')
    parser.add_argument('--lock', type=Path,
                        default=Path(__file__).resolve().with_name(LOCK_NAME),
                        help='pinned Linux lock (default %(default)s)')
    parser.add_argument('--import-memory-mib', type=int, default=3072,
                        help='address-space bound for the import child')
    parser.add_argument('--import-timeout', type=int, default=240,
                        help='seconds allowed for the import child')
    parser.add_argument('--finalize-existing', action='store_true',
                        help='finalize an existing failed root in place; installs nothing')
    args = parser.parse_args()

    if sys.version_info < (3, 8):
        sys.exit('This helper needs Python 3.8+; use the app runtime or Miniforge Python')
    if not sys.platform.startswith('linux'):
        fail('platform_unsupported', 'Linux only, found %s' % sys.platform)
    if os.uname().machine != 'x86_64' or sys.maxsize <= 2 ** 32:
        fail('platform_unsupported', 'x86_64 64-bit only')
    if os.geteuid() != 0:
        fail('not_root', 'run as root; the runtime parent is root-owned')
    if not 1024 <= args.import_memory_mib <= 4096:
        fail('import_memory_range', '--import-memory-mib must be 1024..4096')
    if not 60 <= args.import_timeout <= 1800:
        fail('import_timeout_range', '--import-timeout must be 60..1800')

    root = checked_existing(args.root) if args.finalize_existing \
        else checked_destination(args.root)
    conda = checked_executable(args.conda, 'conda')
    conda_pkgs = Path(os.path.realpath(str(conda))).parent.parent / 'pkgs'
    lock, lock_pins = checked_lock(args.lock)
    usage = root if args.finalize_existing else root.parent
    free_mib = shutil.disk_usage(str(usage)).free // (1024 * 1024)
    floor = FINALIZE_MIN_FREE_MIB if args.finalize_existing else MIN_FREE_MIB
    if free_mib < floor:
        fail('space_insufficient', '%s MiB free, at least %s MiB required'
             % (free_mib, floor))
    state('preflight', root=str(root), conda=str(conda), conda_pkgs=str(conda_pkgs),
          lock=str(lock), pins=len(lock_pins), free_mib=free_mib,
          glibc_expected=EXPECTED_GLIBC,
          mode='finalize' if args.finalize_existing else 'create')

    if args.finalize_existing:
        finalize(root, conda, lock, lock_pins, args)
        return

    root.mkdir(mode=0o755)                 # the parent already exists
    os.chmod(root, 0o755)
    logs = root / 'logs'
    logs.mkdir(mode=0o755)
    lock_copy = root / LOCK_NAME
    shutil.copyfile(str(lock), str(lock_copy))
    os.chmod(lock_copy, 0o644)
    (root / 'tmp').mkdir(mode=0o700)
    state('root_created', root=str(root), lock_sha256=sha256(lock_copy))

    env = root / 'env'
    state('conda_create', prefix=str(env), channel='conda-forge', packages=CONDA_PACKAGES)
    run([str(conda), 'create', '--yes', '--prefix', str(env),
         '--override-channels', '--channel', 'conda-forge'] + CONDA_PACKAGES,
        logs / 'conda-create.log', CONDA_TIMEOUT,
        child_env({'CONDA_REGISTER_ENVS': 'false',
                   'CONDA_AUTO_UPDATE_CONDA': 'false',
                   'CONDA_NOTIFY_OUTDATED_CONDA': 'false',
                   'CONDA_PKGS_DIRS': str(conda_pkgs)}), 'conda_create_failed')
    for name in ('bin/python3.12', 'bin/patchelf'):
        if not (env / name).is_file():
            fail('env_incomplete', '%s missing after conda create' % (env / name))
    state('conda_created', python=str(env / 'bin/python3.12'))

    libc_dir = private_libc(root, checked_sysroot(env))
    python, loader, patchelf_version, rpath = patched_python(root, env, libc_dir, logs)

    libc_file = libc_dir / 'libc.so.6'
    report = verify_interpreter(root, env, python, loader, libc_file,
                                args.import_memory_mib, logs)

    state('pip_install', lock=lock_copy.name, pins=len(lock_pins),
          binary_only=True, sdist_allow=['jieba', 'pylatexenc'])
    run([str(python), '-I', '-m', 'pip', 'install', '--no-input',
         '--no-warn-script-location', '--no-cache-dir',
         '--only-binary=:all:', '--no-binary=jieba,pylatexenc',
         '-r', str(lock_copy)],
        logs / 'pip-install.log', PIP_TIMEOUT,
        child_env({'PIP_CONFIG_FILE': os.devnull, 'PIP_DISABLE_PIP_VERSION_CHECK': '1',
                   'PIP_NO_INPUT': '1', 'PIP_PROGRESS_BAR': 'off',
                   'TMPDIR': str(root / 'tmp'), 'TEMP': str(root / 'tmp'),
                   'TMP': str(root / 'tmp')}), 'pip_install_failed')

    postinstall(root, env, python, loader, libc_file, conda, lock_copy, lock_pins,
                report, rpath, patchelf_version, args.import_memory_mib,
                args.import_timeout, logs)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        fail('interrupted', 'stopped by the operator; the destination is left for review')
    except OSError as error:
        fail('io_error', '%s: %s' % (getattr(error, 'strerror', error),
                                     getattr(error, 'filename', '')))
