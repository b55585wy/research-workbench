import hashlib
import io
import json
import zipfile
import pytest
from research_workbench.models import WorkspaceError
from research_workbench.reading_export import ArchiveWriter
from research_workbench.record_archive import copy_component


def component(tmp_path,name='file.txt',record=None,extra=False,missing=False):
    path=tmp_path/'component.zip';data=b'actual bytes'
    entry=record if record is not None else {'sha256':hashlib.sha256(data).hexdigest(),'byte_size':len(data)}
    with zipfile.ZipFile(path,'w') as z:
        z.writestr(name,data)
        if not missing:z.writestr('manifest.json',json.dumps({'files':{name:entry}}))
        if extra:z.writestr('unlisted.txt',b'unlisted')
    return path


@pytest.mark.parametrize('name',['../file','a/../b','/file','C:/file','a\\file','a//file','./file'])
def test_unsafe_component_paths_rejected(tmp_path,name):
    source=component(tmp_path,name)
    with zipfile.ZipFile(io.BytesIO(),'w') as z:
        with pytest.raises(WorkspaceError,match='校验失败'):copy_component(ArchiveWriter(z),'reading',source)


@pytest.mark.parametrize('record',[None,{},'bad',{'sha256':'0'*64,'byte_size':12},{'sha256':'x'*64,'byte_size':True},{'sha256':'x'*64,'byte_size':11}])
def test_component_manifest_invalid_types_or_hashes_rejected(tmp_path,record):
    source=component(tmp_path,record={} if record is None else record)
    with zipfile.ZipFile(io.BytesIO(),'w') as z:
        with pytest.raises(WorkspaceError):copy_component(ArchiveWriter(z),'analysis',source)


@pytest.mark.parametrize('extra,missing',[(True,False),(False,True)])
def test_missing_or_unlisted_components_rejected(tmp_path,extra,missing):
    source=component(tmp_path,extra=extra,missing=missing)
    with zipfile.ZipFile(io.BytesIO(),'w') as z:
        with pytest.raises(WorkspaceError):copy_component(ArchiveWriter(z),'chart',source)


def test_duplicate_and_broken_zip_rejected(tmp_path):
    path=component(tmp_path)
    with zipfile.ZipFile(path,'a') as z:
        with pytest.warns(UserWarning,match='Duplicate name'):z.writestr('file.txt',b'duplicate')
    with zipfile.ZipFile(io.BytesIO(),'w') as z:
        with pytest.raises(WorkspaceError):copy_component(ArchiveWriter(z),'reading',path)
    path.write_bytes(b'not a ZIP')
    with zipfile.ZipFile(io.BytesIO(),'w') as z:
        with pytest.raises(WorkspaceError):copy_component(ArchiveWriter(z),'reading',path)
