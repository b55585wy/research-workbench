from pathlib import Path

from research_workbench.ui_publish import pack, install, activate
from research_workbench.ui_releases import STABLE_FILES


def project_fixture(tmp_path):
    project = tmp_path / 'project'
    backend = project / 'research_workbench'
    backend.mkdir(parents=True)
    (backend / '__init__.py').write_text("__version__ = 'test'\n")
    (backend / 'api.py').write_text('BUSINESS_API = 1\n')
    (project / 'requirements.txt').write_text('example==1\n')
    frontend = project / 'frontend'
    frontend.mkdir()
    for name in STABLE_FILES:
        path = frontend / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('// Stable device worker dependency\n')
    (frontend / 'index.html').write_text('<html lang="en"><head><script type="module" src="/app.js"></script></head><body>First</body></html>')
    (frontend / 'storage-choice.html').write_text('<a href="/device/">Device</a><a href="/recover.html">Recover</a>')
    (frontend / 'recover.html').write_text('<script src="/app.js"></script>')
    (frontend / 'app.js').write_text('import "/lazy.js"; const api="/api/v1/documents"; const worker="/device-sw.js";')
    (frontend / 'lazy.js').write_text('export const version="first";')
    (frontend / 'styles.css').write_text('body { background:url(/vendor/icon.svg) }')
    (frontend / 'vendor/icon.svg').write_text('<svg/>')
    return project


def publish_fixture(project, tmp_path, label):
    archive = tmp_path / (label + '.zip')
    releases = tmp_path / 'releases'
    manifest = pack(project, archive)
    install(project, releases, archive)
    activate(project, releases, manifest['release'])
    return releases, manifest
