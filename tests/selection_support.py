from uuid import uuid4


def prefix(doc): return f"/api/v1/documents/{doc['id']}/dataset-selections"


def spec(c, data, **changes):
    body = {'dataset_id': data['id'], 'dataset_sha256': data['sha256'], 'column': 'label', 'value': 'a',
            'name': None, 'recipe_sha256': c.get('/api/v1/dataset-selections/capabilities').json()['recipe']['sha256']}
    return {**body, **changes}


def prepared(c, doc, data, **changes):
    body = spec(c, data, **changes)
    response = c.post(prefix(doc)+'/preview', json=body)
    assert response.status_code == 200, response.text
    return {**body, 'request_id': str(uuid4()), 'preview_sha256': response.json()['preview_sha256']}, response.json()


def save(c, doc, data, **changes):
    body, preview = prepared(c, doc, data, **changes)
    response = c.post(prefix(doc), json=body)
    assert response.status_code == 201, response.text
    return response.json(), body, preview
