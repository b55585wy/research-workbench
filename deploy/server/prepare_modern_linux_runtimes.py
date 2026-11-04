"""Pinned optional runtimes for a new glibc>=2.28 Linux installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess


def execute(command, log):
    with log.open('w', encoding='utf-8') as output:
        subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True)


def create_python(conda, root):
    if root.exists():
        raise RuntimeError(f'Runtime already exists: {root}')
    root.mkdir(mode=0o755)
    execute([str(conda), 'create', '--yes', '--override-channels', '--channel',
             'conda-forge', '--prefix', str(root / 'env'), 'python=3.12.16', 'pip'], root / 'create.log')
    return root / 'env/bin/python'


def write_manifest(root, name, value):
    target = root / name
    with target.open('x', encoding='utf-8') as output:
        json.dump(value, output, indent=2)


def parser_runtime(conda, parent, release):
    root = parent / 'mineru-flash-v415-linux'
    python = create_python(conda, root)
    lock = release / 'deploy/server/translation-requirements.lock.txt'
    execute([str(python), '-m', 'pip', '--isolated', 'install', '--only-binary=:all:',
             '--no-cache-dir', '-r', str(lock)], root / 'install.log')
    execute([str(python), '-I', '-c', 'import mineru, docvortex; from importlib.metadata import version; '
             'assert version("mineru")=="4.1.5" and version("docvortex")=="0.6.11"'], root / 'verify.log')
    write_manifest(root, 'runtime.json', {'schema_version': 1, 'engine': 'mineru-flash-txt',
        'mineru_version': '4.1.5', 'docvortex_version': '0.6.11', 'python': str(python.resolve()),
        'lock_sha256': hashlib.sha256(lock.read_bytes()).hexdigest()})


def import_runtime(conda, parent):
    root = parent / 'import-v1'
    python = create_python(conda, root)
    execute([str(python), '-m', 'pip', '--isolated', 'install', '--only-binary=:all:', '--no-cache-dir',
             'pyreadstat==1.3.7', 'numpy==2.5.4', 'narwhals==2.28.0'], root / 'install.log')
    execute([str(python), '-I', '-c', 'import pyreadstat, numpy, narwhals; '
             'assert pyreadstat.__version__=="1.3.7"'], root / 'verify.log')
    write_manifest(root, 'manifest.json', {'id': 'research-import-v1', 'python': str(python.resolve()),
                                         'pyreadstat': '1.3.7'})


def statistics_runtime(conda, parent, release):
    root = parent / 'rstats-4.6.2'
    if root.exists():
        raise RuntimeError(f'Runtime already exists: {root}')
    execute([str(conda), 'create', '--yes', '--override-channels', '--channel', 'conda-forge',
             '--prefix', str(root), 'r-base=4.6.2'], parent / 'rstats-create.log')
    execute([str(Path(os.sys.executable)), str(release / 'scripts/prepare_statistics_manifest.py'),
             '--root', str(parent / 'rstats-manifest'), '--r-home', str(root / 'lib/R')],
            parent / 'rstats-verify.log')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--kind', choices=['parser', 'import', 'statistics'], required=True)
    args = parser.parse_args()
    libc, version = platform.libc_ver()
    if os.name != 'posix' or libc != 'glibc' or tuple(map(int, version.split('.')[:2])) < (2, 28):
        raise RuntimeError('This installer requires Linux glibc >=2.28')
    if os.geteuid() != 0:
        raise RuntimeError('Run as root in the new server installation')
    parent = Path('/opt/research-workspace/runtimes')
    conda = Path('/opt/research-workspace/miniforge/bin/conda')
    release = args.release.resolve(strict=True)
    if not parent.is_dir() or parent.is_symlink() or not conda.is_file():
        raise RuntimeError('Prepare the isolated application layout first')
    {'parser': lambda: parser_runtime(conda, parent, release),
     'import': lambda: import_runtime(conda, parent),
     'statistics': lambda: statistics_runtime(conda, parent, release)}[args.kind]()
    print(json.dumps({'ready': True, 'kind': args.kind}))


if __name__ == '__main__':
    main()
