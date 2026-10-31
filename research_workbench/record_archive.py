"""Stream verified component exports into a bounded portable record."""
import hashlib
import json
from pathlib import PurePosixPath
import zipfile
from .models import WorkspaceError


def invalid():
    raise WorkspaceError('record_component_changed', '导出资料不完整或校验失败，请重新核对。', 409)


def safe_name(name):
    path = PurePosixPath(name)
    if not name or '\\' in name or ':' in name or '\x00' in name or path.is_absolute(): invalid()
    if any(part in ('.', '..', '') for part in name.split('/')) or str(path) != name: invalid()


def copy_component(writer, prefix, path):
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist(); names = [item.filename for item in entries]
            if len(names) != len(set(names)) or 'manifest.json' not in names: invalid()
            for name in names: safe_name(name)
            manifest_entry = archive.getinfo('manifest.json')
            if manifest_entry.file_size > 4*1024*1024: invalid()
            manifest = json.loads(archive.read(manifest_entry))
            files = manifest['files']
            if not isinstance(files, dict) or 'manifest.json' in files or set(names) != set(files) | {'manifest.json'}: invalid()
            for item in entries:
                copy_member(writer, archive, prefix, item, files.get(item.filename))
    except (ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError, NotImplementedError): invalid()


def copy_member(writer, archive, prefix, item, expected):
    name = prefix+'/'+item.filename
    if name in writer.files or item.is_dir() or item.flag_bits & 1: invalid()
    if item.filename != 'manifest.json' and not isinstance(expected, dict): invalid()
    if expected is not None:
        if not isinstance(expected, dict): invalid()
        if type(expected.get('byte_size')) is not int or expected['byte_size'] != item.file_size: invalid()
        if not isinstance(expected.get('sha256'), str) or len(expected['sha256']) != 64: invalid()
    if writer.total+item.file_size > 128*1024*1024:
        raise WorkspaceError('export_too_large', '研究记录超过128 MiB，请减少所选内容。', 413)
    size = 0; checksum = hashlib.sha256()
    with archive.open(item) as source, writer.archive.open(name, 'w') as destination:
        while chunk := source.read(1024*1024):
            writer.account(len(chunk)); size += len(chunk); checksum.update(chunk); destination.write(chunk)
    if size != item.file_size: invalid()
    checksum = checksum.hexdigest()
    if expected is not None and checksum != expected['sha256']: invalid()
    writer.files[name] = {'sha256': checksum, 'byte_size': size}
