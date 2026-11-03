"""Immutable selections: bytes, lineage and Agent receipt share one transaction."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from uuid import UUID, uuid4

from .agent_store import canonical
from .models import WorkspaceError
from .selection_models import SelectionSpec
from .store import timestamp
from .tabular import MAX_BYTES


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def sources():
    root = Path(__file__).parent
    return {name: (root / name).read_text(encoding='utf-8') for name in ('selection_probe.py', 'tabular.py')}


def recipe_hash(code):
    return digest({'id': 'raw-cell-equality', 'version': 1, 'sources': code})


def fail(code='selection_changed', status=409):
    messages = {'selection_empty': '没有符合条件的记录，请修改筛选条件。',
                'selection_busy': '正在筛选其他数据，请稍后重试。',
                'selection_timeout': '筛选超时，请缩小数据后重试。',
                'selection_failed': '筛选进程未能完成，请重试。',
                'invalid_selection': '筛选列或数据无效，请重新选择。',
                'dataset_quota': '这篇文献的数据存储已达上限。'}
    raise WorkspaceError(code, messages.get(code, '筛选来源、规则或保存记录已改变，请重新预览。'), status)


class DatasetSelections:
    def __init__(self, store, datasets):
        self.store, self.datasets = store, datasets
        self.root = store.root / 'selection-cache'; self.root.mkdir(exist_ok=True)
        self.capacity = threading.BoundedSemaphore(2)
        self.cache_lock = threading.Lock()
        self.timeout = 8

    def capabilities(self):
        return {'recipe': {'id': 'raw-cell-equality', 'version': 1, 'sha256': recipe_hash(sources())},
                'limits': {'bytes': MAX_BYTES, 'rows': 50000, 'columns': 50, 'cell': 2048,
                           'datasets_per_document': 20, 'preview_rows': 5}, 'arbitrary_code': False}

    def source(self, document_id, payload):
        self.store.get_document(document_id)
        with self.store.connection() as db:
            row = self.datasets.row(db, document_id, str(payload.dataset_id))
        if row['sha256'] != payload.dataset_sha256: fail('dataset_changed')
        return row, self.datasets.checked(row)

    def compute(self, row, path, request):
        if not self.capacity.acquire(False): fail('selection_busy', 429)
        try:
            done = subprocess.run([getattr(sys, '_base_executable', sys.executable), '-X', 'utf8', '-I', '-S',
                str(Path(__file__).with_name('selection_probe.py')), str(path), row['delimiter']],
                input=canonical(request).encode(), capture_output=True, timeout=self.timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            result = json.loads(done.stdout)
            if done.returncode == 2: fail('invalid_selection', 422)
            if done.returncode or not isinstance(result, dict): fail('selection_failed', 422)
            if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']: fail('dataset_changed')
            return result
        except subprocess.TimeoutExpired: fail('selection_timeout', 422)
        except (ValueError, TypeError): fail('selection_failed', 422)
        finally: self.capacity.release()

    def values(self, document_id, payload):
        row, path = self.source(document_id, payload)
        return self.compute(row, path, {'mode': 'values', **payload.model_dump(mode='json')})

    def prepared(self, document_id, payload):
        code = sources(); recipe = self.capabilities()['recipe']
        if payload.recipe_sha256 != recipe['sha256']: fail('selection_recipe_changed')
        row, path = self.source(document_id, payload)
        result = self.compute(row, path, {'mode': 'preview', 'column': payload.column, 'value': payload.value})
        if sources() != code: fail('selection_recipe_changed')
        name = payload.name or Path(row['original_filename']).stem[:140] + '-筛选.csv'
        if not name.lower().endswith('.csv'): name += '.csv'
        counts = {'total': result['source_row_count'], 'matched': result['profile']['row_count'],
                  'excluded': result['source_row_count'] - result['profile']['row_count']}
        preview = {'saved': False, 'source': {'id': row['id'], 'name': row['original_filename'],
                    'sha256': row['sha256'], 'row_count': counts['total']},
                   'condition': {'column': payload.column, 'value': payload.value}, 'name': name,
                   'counts': counts, 'recipe': recipe, 'result_sha256': result['result_sha256'],
                   'source_rows_sha256': digest(result['source_rows'])}
        preview['preview_sha256'] = digest(preview)
        preview.update(columns=result['profile']['columns'] if counts['matched'] else [],
                       preview=result['profile']['preview'])
        return row, result, preview, code

    def preview(self, document_id, payload):
        return self.prepared(document_id, payload)[2]

    @staticmethod
    def summary(document_id, identifier, preview, inherited_dictionary):
        return {'parent_dataset_id': preview['source']['id'], 'parent_name': preview['source']['name'],
                'parent_sha256': preview['source']['sha256'], 'condition': preview['condition'],
                'counts': preview['counts'], 'recipe_sha256': preview['recipe']['sha256'],
                'source_rows_sha256': preview['source_rows_sha256'],
                'rows_url': f'/api/v1/documents/{document_id}/datasets/{identifier}/selection',
                'parent_url': f"/api/v1/documents/{document_id}/datasets/{preview['source']['id']}",
                'original_dictionary_available': inherited_dictionary}

    def create(self, document_id, payload):
        with self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            return self.create_in(db, document_id, payload)

    def create_in(self, db, document_id, payload):
        identifier = str(payload.request_id); body = payload.model_dump(mode='json')
        fingerprint = digest({'document_id': document_id, 'body': body})
        old = db.execute('SELECT * FROM dataset_selections WHERE dataset_id=?', (identifier,)).fetchone()
        if old is not None:
            if old['request_hash'] != fingerprint: fail('idempotency_conflict')
            row = self.datasets.row(db, document_id, identifier); self.datasets.checked(row)
            return self.datasets.record(row), False
        if db.execute('SELECT 1 FROM datasets WHERE id=?', (identifier,)).fetchone(): fail('idempotency_conflict')
        parent, result, preview, code = self.prepared(document_id, payload)
        if preview['preview_sha256'] != payload.preview_sha256: fail('selection_preview_changed')
        if not preview['counts']['matched']: fail('selection_empty', 422)
        raw = base64.b64decode(result['data'], validate=True)
        total = db.execute('SELECT COUNT(*),COALESCE(SUM(byte_size),0) FROM datasets WHERE document_id=?', (document_id,)).fetchone()
        if total[0] >= 20 or total[1]+len(raw) > 100*1024*1024: fail('dataset_quota')
        profile = result['profile']; parent_profile = json.loads(parent['profile_json'])
        inherited = bool(parent_profile.get('data_dictionary') or parent_profile.get('selection_provenance', {}).get('original_dictionary_available'))
        profile['selection_provenance'] = self.summary(document_id, identifier, preview, inherited)
        created = timestamp()
        db.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?,?,?,?)', (identifier, document_id, str(uuid4()),
            preview['name'], preview['result_sha256'], len(raw), ',', canonical(profile), created))
        db.execute('INSERT INTO dataset_selections VALUES (?,?,?,?,?,?,?,?,?,?)', (identifier, document_id,
            parent['id'], fingerprint, canonical(body), canonical(preview), canonical(result['source_rows']),
            canonical(code), raw, created))
        return self.datasets.record(self.datasets.row(db, document_id, identifier)), True

    def verified(self, row, relation):
        try:
            body = json.loads(relation['spec_json']); preview = json.loads(relation['preview_json'])
            mapping = json.loads(relation['source_rows_json']); code = json.loads(relation['sources_json'])
            spec = SelectionSpec.model_validate({k: body[k] for k in SelectionSpec.model_fields})
            if relation['document_id'] != row['document_id'] or body['request_id'] != row['id']: fail()
            if relation['request_hash'] != digest({'document_id': row['document_id'], 'body': body}): fail()
            base = {k: v for k, v in preview.items() if k not in ('preview_sha256', 'columns', 'preview')}
            if digest(base) != preview['preview_sha256'] or body['preview_sha256'] != preview['preview_sha256']: fail()
            if preview['recipe']['sha256'] != recipe_hash(code) or spec.recipe_sha256 != preview['recipe']['sha256']: fail()
            if set(code) != {'selection_probe.py', 'tabular.py'} or digest(mapping) != preview['source_rows_sha256']: fail()
            if spec.dataset_id != UUID(relation['parent_dataset_id']) or str(spec.dataset_id) != preview['source']['id']: fail()
            if spec.dataset_sha256 != preview['source']['sha256'] or preview['condition'] != {'column': spec.column, 'value': spec.value}: fail()
            raw = relation['data_bytes']; profile = json.loads(row['profile_json'])
            if row['sha256'] != preview['result_sha256'] or hashlib.sha256(raw).hexdigest() != row['sha256'] or len(raw) != row['byte_size']: fail()
            if not mapping or any(type(i) is not int or not 1 <= i <= preview['counts']['total'] for i in mapping): fail()
            if mapping != sorted(set(mapping)) or len(mapping) != preview['counts']['matched'] or len(mapping) != profile['row_count']: fail()
            if preview['counts']['excluded'] != preview['counts']['total']-len(mapping): fail()
            if profile['columns'] != preview['columns'] or profile['preview'] != preview['preview'] or row['original_filename'] != preview['name']: fail()
            expected = self.summary(row['document_id'], row['id'], preview, profile['selection_provenance']['original_dictionary_available'])
            if profile['selection_provenance'] != expected or row['delimiter'] != ',': fail()
            return preview, mapping, code
        except (KeyError, ValueError, TypeError): fail()

    def check_dataset(self, row, seen=None):
        seen = set() if seen is None else seen
        if row['id'] in seen or len(seen) >= 20: fail()
        seen.add(row['id'])
        with self.store.connection() as db:
            relation = db.execute('SELECT * FROM dataset_selections WHERE dataset_id=?', (row['id'],)).fetchone()
            if relation is None:
                if json.loads(row['profile_json']).get('selection_provenance'): fail()
                return None
            parent = self.datasets.row(db, row['document_id'], relation['parent_dataset_id'])
        preview, _, _ = self.verified(row, relation)
        if parent['sha256'] != preview['source']['sha256'] or parent['original_filename'] != preview['source']['name']: fail('dataset_changed')
        parent_profile = json.loads(parent['profile_json'])
        if parent_profile['row_count'] != preview['counts']['total']: fail()
        inherited = bool(parent_profile.get('data_dictionary') or parent_profile.get('selection_provenance', {}).get('original_dictionary_available'))
        if json.loads(row['profile_json'])['selection_provenance']['original_dictionary_available'] is not inherited: fail()
        self.datasets.checked(parent, seen)
        try: key = str(UUID(row['storage_key']))
        except ValueError: fail()
        target = self.root / (key+'.csv')
        with self.cache_lock:
            if target.exists():
                if target.stat().st_size != row['byte_size'] or hashlib.sha256(target.read_bytes()).hexdigest() != row['sha256']: fail('dataset_changed')
                return target
            pending = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.root, delete=False) as out:
                    pending = Path(out.name); out.write(relation['data_bytes'])
                from .library import read_metadata
                with self.store.connection() as db:
                    db.execute('BEGIN IMMEDIATE')
                    read_metadata(db, row['document_id'])
                    pending.replace(target)
            finally:
                if pending is not None: pending.unlink(missing_ok=True)
        return target

    def lineage(self, document_id, identifier):
        self.datasets.path(document_id, identifier)
        steps = []; seen = set()
        with self.store.connection() as db:
            while identifier not in seen:
                seen.add(identifier); row = self.datasets.row(db, document_id, identifier)
                relation = db.execute('SELECT * FROM dataset_selections WHERE dataset_id=?', (identifier,)).fetchone()
                if relation is None: break
                _, mapping, code = self.verified(row, relation)
                steps.append({'dataset_id': identifier, **json.loads(row['profile_json'])['selection_provenance'],
                              'source_rows': mapping, 'calculation_sources': code})
                identifier = relation['parent_dataset_id']
        return {'format': 'dataset-selection-lineage/v1', 'steps': steps}

    def export_files(self, document_id, identifier):
        lineage = self.lineage(document_id, identifier)
        if not lineage['steps']: return {}
        files = {'selection/lineage.json': canonical(lineage).encode()}
        for step in lineage['steps']:
            parent_id = step['parent_dataset_id']; parent = self.datasets.get(document_id, parent_id)
            prefix = 'selection/'+parent_id+'/'
            suffix = '.tsv' if parent['original_filename'].lower().endswith('.tsv') else '.csv'
            files[prefix+'source'+suffix] = self.datasets.path(document_id, parent_id).read_bytes()
            if parent.get('import_provenance'):
                imported = self.datasets.imports.export_files(document_id, parent['import_provenance']['import_id'], parent)
                files.update({prefix+name: data for name, data in imported.items()})
        if sum(len(v) for v in files.values()) > 110*1024*1024: fail('export_too_large', 413)
        return files
