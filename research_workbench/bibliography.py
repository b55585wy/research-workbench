from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from urllib.parse import quote, urlsplit
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .excerpts import verify_source
from .models import DocumentUpdate, WorkspaceError
from .online_data import OnlineDataClient, doi, fingerprint

PROBE = Path(__file__).with_name('bibliography_probe.py')


class LookupRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    doi: str | None = Field(default=None, strict=True, max_length=255)


class BibliographyClient(OnlineDataClient):
    def allowed_endpoint(self, url):
        parsed = urlsplit(url)
        prefixes = {'api.crossref.org': '/works/', 'api.datacite.org': '/dois/'}
        return parsed.scheme == 'https' and parsed.netloc in prefixes and parsed.path.startswith(prefixes[parsed.netloc]) and not parsed.query and not parsed.fragment


class PlainMetadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(value):
    if not isinstance(value, str):
        return ''
    parser = PlainMetadata()
    parser.feed(value)
    parser.close()
    return ' '.join(''.join(parser.parts).split()).replace('\x00', '')


def valid_fields(fields):
    result, warnings = {}, []
    for key in ('title', 'authors', 'year', 'doi'):
        value = fields.get(key)
        if value is None or value == '':
            continue
        try:
            checked = DocumentUpdate(request_id=uuid4(), expected_revision=1, **{key: value})
            result[key] = getattr(checked, key)
        except ValidationError:
            warnings.append(f'{key}: 来源值超出当前字段限制，保留原字段。')
    return result, warnings


def read_pdf_metadata(source):
    try:
        result = subprocess.run([sys.executable, str(PROBE), str(source)], capture_output=True,
                                text=True, encoding='utf-8', errors='replace', timeout=12,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        value = json.loads(result.stdout)
        if result.returncode or len(result.stdout) > 96 * 1024 or not isinstance(value.get('fields'), dict) or not isinstance(value.get('candidates'), list):
            raise ValueError()
        return value
    except subprocess.TimeoutExpired:
        raise WorkspaceError('bibliography_probe_timeout', '读取 PDF 书目信息超时，请填写 DOI 后重试。', 503) from None
    except (OSError, ValueError, TypeError, AttributeError):
        raise WorkspaceError('bibliography_probe_failed', '暂时无法读取 PDF 书目信息，原字段保持不变。', 503) from None


def crossref_record(raw, identifier):
    record = raw['message']
    if doi(record.get('DOI')) != identifier:
        raise ValueError('DOI mismatch')
    titles = record.get('title') or []
    authors = []
    for person in record.get('author') or []:
        name = person.get('name') or ' '.join(filter(None, (person.get('given'), person.get('family'))))
        if plain(name):
            authors.append(plain(name))
    fields = {'doi': identifier, 'title': plain(titles[0]) if titles else '', 'authors': '; '.join(authors)}
    for key in ('published-print', 'published-online', 'published', 'issued'):
        parts = (record.get(key) or {}).get('date-parts') or []
        if parts and parts[0] and type(parts[0][0]) is int:
            fields['year'] = parts[0][0]
            break
    return fields, record, record.get('type')


def datacite_record(raw, identifier):
    row = raw['data']
    record = row['attributes']
    if doi(record.get('doi')) != identifier or doi(row.get('id')) != identifier:
        raise ValueError('DOI mismatch')
    titles = record.get('titles') or []
    authors = [plain(person.get('name') or ' '.join(filter(None, (person.get('givenName'), person.get('familyName'))))) for person in record.get('creators') or []]
    year = record.get('publicationYear')
    year = int(year) if isinstance(year, str) and year.isdigit() else year
    return {'doi': identifier, 'title': plain(titles[0].get('title')) if titles else '',
            'authors': '; '.join(filter(None, authors)), 'year': year}, row, (record.get('types') or {}).get('resourceTypeGeneral')


class Bibliography:
    def __init__(self, store, client=None, probe=None):
        self.store = store
        self.client = client or BibliographyClient()
        self.probe = probe or read_pdf_metadata
        self.slots = threading.BoundedSemaphore(2)

    def lookup(self, owner_id, payload):
        if not self.slots.acquire(blocking=False):
            raise WorkspaceError('bibliography_busy', '正在读取其他书目信息，请稍后重试。', 429)
        try:
            return self.lookup_bound(owner_id, payload)
        finally:
            self.slots.release()

    def lookup_bound(self, owner_id, payload):
        owner = self.store.library.get(owner_id)
        if owner.get('kind') == 'study':
            raise WorkspaceError('bibliography_scope', '请先打开需要更新书目信息的 PDF。', 422)
        source = verify_source(self.store, owner)
        raw_doi = owner.get('doi') if payload.doi is None else payload.doi
        base = {'saved': False, 'metadata_revision': owner['revision'], 'source_sha256': owner['sha256']}
        if raw_doi and raw_doi.strip():
            identifier = doi(raw_doi)
            if identifier is None:
                raise WorkspaceError('bibliography_invalid_doi', '请填写有效 DOI，或清空 DOI 后从 PDF 查找。', 422)
        else:
            probe = self.probe(source)
            verify_source(self.store, owner)
            candidates = list(dict.fromkeys(filter(None, (doi(value) for value in probe['candidates']))))[:10]
            if len(candidates) > 1:
                return {**base, 'status': 'choose_doi', 'candidates': candidates, 'warnings': ['PDF 前三页含多个 DOI，请确认哪个标识属于本文后再获取。']}
            identifier = candidates[0] if candidates else None
            if identifier is None:
                fields, warnings = valid_fields({key: plain(value) for key, value in probe['fields'].items() if key in ('title', 'authors')})
                origin = {'provider': 'pdf_metadata', 'url': f'/api/v1/documents/{owner_id}/file',
                          'retrieved_at': datetime.now(timezone.utc).isoformat(), 'metadata_sha256': fingerprint(probe), 'record_type': 'PDF embedded metadata'}
                return {**base, 'status': 'ready' if fields else 'not_found', 'fields': fields, 'source': origin,
                        'warnings': warnings + ['PDF 内嵌信息仍需核对；未使用创建时间推断发表年份。' if fields else '未识别到可更新的书目；可填写 DOI 后重试或手动编辑。']}
        result = self.resolve(identifier)
        verify_source(self.store, owner)
        return {**base, 'status': 'ready', **result}

    def resolve(self, identifier):
        failures = []
        for provider, root, normalize in (('crossref', 'https://api.crossref.org/works/', crossref_record),
                                            ('datacite', 'https://api.datacite.org/dois/', datacite_record)):
            try:
                raw = self.client.request(root + quote(identifier, safe='/'))
                raw_fields, record, kind = normalize(raw, identifier)
                fields, warnings = valid_fields(raw_fields)
                return {'fields': fields, 'warnings': warnings, 'source': {'provider': provider,
                        'url': 'https://doi.org/' + quote(identifier, safe='/():;._-'),
                        'retrieved_at': datetime.now(timezone.utc).isoformat(), 'metadata_sha256': fingerprint(record), 'record_type': kind}}
            except WorkspaceError as error:
                failures.append(error.code)
            except (ValueError, KeyError, TypeError, AttributeError):
                failures.append('bibliography_invalid_response')
        if all(code == 'online_not_found' for code in failures):
            raise WorkspaceError('bibliography_not_found', '公开书目服务未找到该 DOI，原字段保持不变。', 404)
        raise WorkspaceError('bibliography_unavailable', '公开书目暂时无法核实，请稍后重试；原字段保持不变。', 502)
