import hashlib
import io
import json
import zipfile
from analysis_support import upload, run
from chart_support import payload as chart_payload, prefix as chart_prefix


def prefix(doc): return f"/api/v1/documents/{doc['id']}/research-records"


def prepare(c, app, doc):
    dataset = upload(c, doc).json()
    job = run(app.state.analysis, doc, dataset)
    response = c.post(chart_prefix(doc), json=chart_payload(c, dataset))
    assert response.status_code == 201, response.text
    return dataset, job, response.json()


def spec(dataset, **changes):
    return {'dataset_id': dataset['id'], 'dataset_sha256': dataset['sha256'], 'analysis_id': None,
            'chart_id': None, 'include_reading': True, **changes}


def preview(c, doc, dataset, **changes):
    response = c.post(prefix(doc)+'/preview', json=spec(dataset, **changes))
    assert response.status_code == 200, response.text
    return response.json()


def verified(response):
    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    manifest = json.loads(archive.read('manifest.json'))
    assert set(archive.namelist()) == set(manifest['files']) | {'manifest.json'}
    assert len(archive.namelist()) == len(set(archive.namelist()))
    for name, item in manifest['files'].items():
        raw = archive.read(name)
        assert hashlib.sha256(raw).hexdigest() == item['sha256'] and len(raw) == item['byte_size']
    return archive
