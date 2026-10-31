"""Administrator-configured immutable R library; never a client-supplied path."""
import hashlib
import json
from pathlib import Path
from .models import WorkspaceError


class StatisticsLibrary:
    def __init__(self,root=None):
        self.root=Path(root).resolve() if root else None
        self.manifest=None;self.sha256=None;self.available=False
        if self.root is not None:
            try:
                content=(self.root/'manifest.json').read_bytes()
                self.manifest=json.loads(content);self.sha256=hashlib.sha256(content).hexdigest()
                self.verify();self.available=True
            except (OSError,ValueError,KeyError,TypeError,WorkspaceError):pass

    def verify(self):
        try:
            if self.root is None or self.manifest is None:raise ValueError()
            if hashlib.sha256((self.root/'manifest.json').read_bytes()).hexdigest()!=self.sha256:raise ValueError()
            if self.manifest['format']!='research-rstats-library/v1' or self.manifest['stats_version']!='4.6.2':raise ValueError()
            library=Path(self.manifest['r_home']).resolve()/'library'
            files=self.manifest['library_files']
            if not files or len(files)>30000:raise ValueError()
            for relative,checksum in files.items():
                path=library/relative
                if not path.resolve().is_relative_to(library.resolve()):raise ValueError()
                if hashlib.sha256(path.read_bytes()).hexdigest()!=checksum:raise ValueError()
        except (OSError,ValueError,KeyError,TypeError):
            raise WorkspaceError('statistics_unavailable','统计组件未配置或版本校验失败，请检查独立 R 统计环境。',409) from None

    def require(self,checksum=None):
        if not self.available:raise WorkspaceError('statistics_unavailable','统计运行环境未通过校验。',409)
        self.verify()
        if checksum is not None and checksum!=self.sha256:
            raise WorkspaceError('statistics_changed','统计组件版本与确认内容不同，请重新预览。',409)
        return self.info()

    def info(self):
        return {'id':'r-stats','version':'4.6.2','sha256':self.sha256,
                'license':'Part of R; GNU GPL version 2 or 3','available':self.available}

    def environment(self):return {}
