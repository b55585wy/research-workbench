"""Bounded public metadata queries; no dataset files or arbitrary URL requests."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from urllib.parse import quote, urlencode, urlsplit

from .models import WorkspaceError

MAX_RESPONSE = 512 * 1024
MAX_RESULTS = 3
DOI = re.compile(r'10\.\d{4,9}/[^\s?#<>"\\]+', re.IGNORECASE)
ZENODO = re.compile(r'(?:https://zenodo\.org/(?:records|record)/)?([1-9]\d{0,11})/?')


def fingerprint(value):
    raw = json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(raw).hexdigest()


def text(value, limit=400):
    return re.sub(r'[\x00-\x1f\x7f]', ' ', value).strip()[:limit] if isinstance(value, str) else ''


def doi(value):
    if not isinstance(value, str) or len(value) > 500 or re.search(r'[\x00-\x1f\x7f]', value):
        return None
    value = value.strip()
    value = re.sub(r'^https://(?:dx\.)?doi\.org/', '', value, flags=re.IGNORECASE)
    value = re.sub(r'^doi:\s*', '', value, flags=re.IGNORECASE)
    return value.lower() if DOI.fullmatch(value) else None


def normalize_query(kind, value):
    if not isinstance(value, str) or not 1 <= len(value) <= 180 or re.search(r'[\x00-\x1f\x7f]', value):
        raise WorkspaceError('online_invalid_query', '请提供不超过180字的 DOI、Zenodo 记录编号或检索词。', 422)
    value = value.strip()
    if kind == 'keywords' and value and '://' not in value:
        return value
    if kind == 'paper_doi' and doi(value):
        return doi(value)
    if kind == 'dataset_identifier':
        if doi(value):
            return doi(value)
        match = ZENODO.fullmatch(value)
        if match:
            return 'https://zenodo.org/records/' + match[1]
    raise WorkspaceError('online_identifier_unsupported', '本轮支持 DOI 和 Zenodo 记录编号；其他来源可用简短关键词查找候选。', 422)


def literal(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def plans(kind, value):
    if kind == 'dataset_identifier':
        record = re.fullmatch(r'10\.5281/zenodo\.([1-9]\d{0,11})', value)
        record = record or ZENODO.fullmatch(value)
        if record:
            return [('zenodo', 'https://zenodo.org/api/records/' + record[1], True)]
        return [('datacite', 'https://api.datacite.org/dois/' + quote(value, safe='/'), True)]
    if kind == 'paper_doi':
        dc_query = 'relatedIdentifiers.relatedIdentifier:' + literal(value)
        zn_query = 'related_identifiers.identifier:' + literal(value)
    else:
        terms = value.split()
        dc_query = zn_query = ' AND '.join(literal(term) for term in terms)
    return [
        ('datacite', 'https://api.datacite.org/dois?' + urlencode({
            'query': 'types.resourceTypeGeneral:Dataset AND (' + dc_query + ')', 'page[size]': MAX_RESULTS}), False),
        ('zenodo', 'https://zenodo.org/api/records?' + urlencode({
            'q': 'resource_type.type:dataset AND (' + zn_query + ')', 'size': MAX_RESULTS}), False),
    ]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class OnlineDataClient:
    def __init__(self, opener=None, timeout=6):
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.timeout = timeout

    def allowed_endpoint(self, url):
        parsed = urlsplit(url)
        allowed = parsed.scheme == 'https' and parsed.netloc in ('api.datacite.org', 'zenodo.org')
        path_ok = parsed.path.startswith('/dois') if parsed.netloc == 'api.datacite.org' else parsed.path.startswith('/api/records')
        return allowed and path_ok and not parsed.fragment

    def request(self, url):
        if not self.allowed_endpoint(url):
            raise WorkspaceError('online_endpoint_rejected', '在线查询地址不在已安装的元数据接口范围内。', 422)
        request = urllib.request.Request(url, headers={
            'Accept': 'application/json', 'User-Agent': 'SynriseResearchWorkbench/0.28 public-metadata'})
        for attempt in range(2):
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    if response.geturl() != url:
                        raise WorkspaceError('online_redirect_rejected', '元数据接口发生重定向，本次未跟随。', 502)
                    raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise WorkspaceError('online_response_too_large', '元数据响应过大，请缩小查询范围。', 502)
                value = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                if not isinstance(value, dict):
                    raise ValueError()
                return value
            except urllib.error.HTTPError as error:
                error.close()
                retry = error.code == 429 or 500 <= error.code <= 599
                if retry and not attempt:
                    time.sleep(.2)
                    continue
                code = {403: 'online_forbidden', 404: 'online_not_found', 429: 'online_rate_limited'}.get(error.code, 'online_http_error')
                raise WorkspaceError(code, f'公开元数据接口返回 HTTP {error.code}；未取得文件。', 502) from None
            except (urllib.error.URLError, TimeoutError, OSError):
                if not attempt:
                    time.sleep(.2)
                    continue
                raise WorkspaceError('online_unavailable', '暂时无法连接公开元数据接口，请稍后重试。', 502) from None
            except (ValueError, UnicodeError, TypeError):
                raise WorkspaceError('online_invalid_response', '公开元数据接口返回了无法核实的格式。', 502) from None

    def find(self, kind, query):
        value = normalize_query(kind, query)
        queries = plans(kind, value)
        with ThreadPoolExecutor(max_workers=len(queries), thread_name_prefix='dataset-metadata') as pool:
            results = list(pool.map(lambda plan: self.fetch(plan, kind, value), queries))
        checks = [check for _, check in results]
        records = [record for items, _ in results for record in items]
        seen, unique = set(), []
        for record in records:
            key = record['doi'] or record['landing_url']
            if key not in seen:
                unique.append(record)
                seen.add(key)
        failed = any(c['status'] not in ('ok', 'not_found', 'not_dataset') for c in checks)
        status = 'partial' if failed and unique else 'unavailable' if failed else 'found' if unique else 'not_found'
        return {'saved': False, 'query': {'kind': kind, 'value': value}, 'status': status,
                'items': unique, 'providers': checks, 'files_downloaded': False,
                'notice': 'Metadata only. Relationships and keyword hits do not establish that these are the paper\'s underlying data. File access and scientific suitability remain unverified.'}

    def fetch(self, plan, kind, query):
        provider, url, single = plan
        try:
            value = self.request(url)
            records = rows(provider, value, single)
            items = [normalize(provider, row, kind, query, url) for row in records]
            items = [item for item in items if item is not None]
            status = 'not_dataset' if single and records and not items else 'ok'
            return items, {'provider': provider, 'url': url, 'status': status, 'returned': len(records),
                           'retained': len(items), 'bounded_results': MAX_RESULTS, 'retrieved_at': utc_now()}
        except WorkspaceError as error:
            status = 'not_found' if error.code == 'online_not_found' else error.code
            return [], {'provider': provider, 'url': url, 'status': status, 'message': error.message, 'retrieved_at': utc_now()}
        except (KeyError, ValueError, TypeError, AttributeError):
            return [], {'provider': provider, 'url': url, 'status': 'online_invalid_response', 'retrieved_at': utc_now()}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def year(value):
    match = re.match(r'^[12]\d{3}(?:$|-)', str(value))
    return match[0][:4] if match else None


def rows(provider, value, single):
    result = value.get('data') if provider == 'datacite' else value if single else value.get('hits', {}).get('hits')
    if single and isinstance(result, dict):
        result = [result]
    if not isinstance(result, list) or any(not isinstance(row, dict) for row in result):
        raise ValueError()
    return result[:MAX_RESULTS]


def related(provider, metadata, query):
    key = 'relatedIdentifiers' if provider == 'datacite' else 'related_identifiers'
    result = []
    for relation in metadata.get(key, []) or []:
        value = relation.get('relatedIdentifier' if provider == 'datacite' else 'identifier')
        if doi(value) == query:
            result.append(text(relation.get('relationType' if provider == 'datacite' else 'relation'), 80))
    return result[:10]


def normalize(provider, row, kind, query, url):
    metadata = row['attributes'] if provider == 'datacite' else row['metadata']
    if not isinstance(metadata, dict):
        raise ValueError()
    record = datacite(row, metadata) if provider == 'datacite' else zenodo(row, metadata)
    if record is None:
        return None
    relations = related(provider, metadata, query) if kind == 'paper_doi' else []
    if kind == 'paper_doi' and not relations:
        return None
    if kind == 'dataset_identifier' and doi(query) and record['doi'] != query:
        raise ValueError('Identifier mismatch')
    if kind == 'dataset_identifier' and query.startswith('https://zenodo.org/') and record['landing_url'] != query:
        raise ValueError('Identifier mismatch')
    basis = {'paper_doi': 'metadata_relationship', 'dataset_identifier': 'identifier_lookup', 'keywords': 'keyword_candidate'}[kind]
    return {**record, 'provider': provider, 'record_type': 'Dataset', 'metadata_url': url,
            'metadata_sha256': fingerprint(row), 'retrieved_at': utc_now(),
            'association': {'basis': basis, 'paper_doi': query if kind == 'paper_doi' else None,
                            'relation_types': relations, 'underlying_data_verified': False}}


def datacite(row, metadata):
    if metadata.get('types', {}).get('resourceTypeGeneral', '').lower() != 'dataset':
        return None
    identifier = doi(metadata.get('doi'))
    if not identifier or doi(row.get('id')) != identifier:
        raise ValueError('Identifier mismatch')
    titles = metadata.get('titles', [])
    title = text(titles[0].get('title')) if titles else ''
    if not title:
        raise ValueError('Missing title')
    publisher = metadata.get('publisher')
    if isinstance(publisher, dict):
        publisher = publisher.get('name')
    return {'identifier': identifier, 'doi': identifier, 'title': title,
            'authors': [text(p.get('name'), 120) for p in metadata.get('creators', [])[:10]],
            'year': year(metadata.get('publicationYear')), 'publisher': text(publisher, 160),
            'version': text(metadata.get('version'), 100) or None,
            'licenses': [text(r.get('rights') or r.get('rightsIdentifier'), 180) for r in (metadata.get('rightsList') or [])[:5]],
            'landing_url': 'https://doi.org/' + quote(identifier, safe='/():;._-'),
            'access': {'status': 'unknown', 'basis': 'DataCite public metadata does not verify file access',
                       'file_count': None, 'total_size_bytes': None, 'files_downloaded': False}}


def zenodo(row, metadata):
    if metadata.get('resource_type', {}).get('type') != 'dataset':
        return None
    identifier = str(row.get('id', ''))
    if not re.fullmatch(r'[1-9]\d{0,11}', identifier):
        raise ValueError('Invalid record id')
    title = text(metadata.get('title'))
    if not title:
        raise ValueError('Missing title')
    files = row.get('files')
    sizes = [f.get('size') for f in files] if isinstance(files, list) else []
    valid_sizes = sizes and all(type(size) is int and size >= 0 for size in sizes)
    access = metadata.get('access_right') or row.get('access', {}).get('files')
    if access in ('open', 'public'):
        status = 'open_files_reported' if files else 'open_metadata_only'
    else:
        status = access if access in ('restricted', 'embargoed', 'closed') else 'unknown'
    license_value = metadata.get('license', {})
    license_name = text(license_value.get('id') or license_value.get('title'), 180) if isinstance(license_value, dict) else text(license_value, 180)
    return {'identifier': 'zenodo:' + identifier, 'doi': doi(metadata.get('doi') or row.get('doi')),
            'title': title, 'authors': [text(p.get('name'), 120) for p in metadata.get('creators', [])[:10]],
            'year': year(metadata.get('publication_date')), 'publisher': 'Zenodo',
            'version': text(metadata.get('version'), 100) or None, 'licenses': [license_name] if license_name else [],
            'landing_url': 'https://zenodo.org/records/' + identifier,
            'access': {'status': status, 'basis': 'Zenodo metadata and file listing only; files have not been requested',
                       'file_count': len(files) if isinstance(files, list) else None,
                       'total_size_bytes': sum(sizes) if valid_sizes else None, 'files_downloaded': False}}
