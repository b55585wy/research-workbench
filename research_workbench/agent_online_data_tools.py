from typing import Literal
import re
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from .models import NoteCreate, WorkspaceError
from .online_data import normalize_query
from .rich_content import render_html
from .studies import verify_owner


class OnlineArguments(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['paper_doi', 'dataset_identifier', 'keywords']
    query: str = Field(min_length=1, max_length=180)
    source_ref: str = Field(pattern=r'^R[1-9][0-9]*$', max_length=20)


class ReferenceArguments(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_ref: str = Field(pattern=r'^R[1-9][0-9]*$', max_length=20)


ONLINE_DEFINITIONS = [
    ('find_online_datasets', '查找在线数据来源',
     'Query PUBLIC DataCite/Zenodo METADATA only. source_ref must be an actual current paper page, associated paper page, or study context. '
     'kind=paper_doi searches datasets whose metadata explicitly relates to that exact PAPER DOI; read data-availability pages first. '
     'kind=dataset_identifier resolves an exact DATASET DOI or Zenodo record ID/URL; use identifiers actually supplied by the user or read in the paper. '
     'kind=keywords searches short relevant public terms; hits are unverified candidates. query is sent to these public services; never send private raw data, credentials or full paper text. '
     'At most3 distinct queries per turn, at most3 hits per provider. Returned metadata supplies actual citation refs, relation types, access status, retrieval time and hash. '
     'Do not infer underlying-data identity or downloadability from a hit, license or public metadata. Provider failures are not empty successful searches. '
     'No arbitrary URL fetch, downloads or writes. Present supported-scope/partial/empty limitations. Cite returned R refs.', OnlineArguments, 'read'),
    ('propose_data_reference', '建议保存数据来源引用',
     'Propose an EXISTING source-linked note for one online_dataset ref actually returned by find_online_datasets IN THIS TURN. '
     'The server constructs the citation from verified metadata with query, access/relationship limitations, timestamp/hash and original paper/study provenance. '
     'No extra text or invented metadata accepted. This is pending only; user must explicitly confirm before a note is saved. '
     'Re-query if the ref is historical, missing or changed. This does NOT download data or certify research suitability.', ReferenceArguments, 'write'),
]


def historical_online_answer(turn, language):
    refs = {s['ref'] for s in turn.get('sources', []) if s.get('kind') == 'online_dataset'}
    if not refs:
        return turn['answer']
    marker = '[online source needs fresh lookup]' if language == 'en' else '[在线来源需重新查询]'
    return re.sub(r'\[R[1-9][0-9]*(?:\s*,\s*R[1-9][0-9]*)*\]',
                  lambda match: marker if refs.intersection(re.findall(r'R[1-9][0-9]*', match[0])) else match[0], turn['answer'])


def verify_anchor(store, owner_id, anchor):
    owner = store.get_document(owner_id)
    current = store.get_document(anchor['document_id'])
    verify_owner(store, current)
    if current['sha256'] != anchor['source_sha256']:
        raise WorkspaceError('source_changed', '引用对应的研究或原文版本已变化，请重新查询。', 409)
    if anchor['document_id'] == owner_id:
        expected = 'study_context' if current.get('kind') == 'study' else 'pdf_page'
        if anchor['kind'] != expected:
            raise WorkspaceError('agent_source_required', '请使用实际研究上下文或原文页面。', 409)
        return
    if owner.get('kind') != 'study' or anchor['kind'] != 'associated_pdf_page':
        raise WorkspaceError('agent_source_required', '引用出处不属于本次研究。', 409)
    with store.connection() as db:
        link = db.execute('SELECT sha256 FROM study_papers WHERE study_id=? AND paper_id=?', (owner_id, current['id'])).fetchone()
    if link is None or link['sha256'] != anchor['source_sha256']:
        raise WorkspaceError('agent_paper_not_available', '论文关联已变化，请重新关联后查询。', 409)


def reference_content(reference):
    record, query, anchor = (reference[k] for k in ('record', 'query', 'anchor'))
    en = reference['language'] == 'en'
    access = record['access']
    relation = record['association']
    labels = ('Online dataset reference', 'Title', 'Creators', 'Year', 'Repository / publisher', 'Version', 'License',
              'Identifier', 'Source', 'Access status (metadata)', 'Files listed / total bytes', 'Lookup',
              'Association basis / relation types', 'Metadata retrieved', 'Metadata SHA256', 'Metadata API', 'Research / paper provenance') if en else (
              '在线数据来源引用', '标题', '作者', '年份', '仓库 / 发布者', '版本', '许可', '标识', '来源链接', '访问状态（元数据）',
              '列出文件数 / 总字节数', '查询输入', '关联依据 / 关联类型', '元数据查询时间', '元数据 SHA256', '元数据接口', '研究 / 论文出处')
    unknown = 'Not reported / unknown' if en else '未提供 / 未知'
    access_labels = {'unknown': ('Unknown', '未知'), 'open_files_reported': ('Public files listed; access not tested', '元数据列出公开文件；未测试访问'),
                     'open_metadata_only': ('Open record; no files listed', '公开记录；未列出文件'), 'restricted': ('Restricted', '受限访问'),
                     'embargoed': ('Embargoed', '禁运期'), 'closed': ('Closed', '不公开')}
    basis_labels = {'metadata_relationship': ('Reported metadata relationship', '元数据报告关联'),
                    'identifier_lookup': ('Exact identifier lookup', '精确标识查询'), 'keyword_candidate': ('Keyword candidate only', '仅关键词候选')}
    index = 0 if en else 1
    status = access_labels.get(access['status'], access_labels['unknown'])[index]
    basis = basis_labels[relation['basis']][index]
    files = ' / '.join(str(access[key]) if access[key] is not None else unknown for key in ('file_count', 'total_size_bytes'))
    values = [record['title'], '; '.join(record['authors']), record['year'], record['publisher'], record['version'],
              '; '.join(record['licenses']), record['doi'] or record['identifier'], record['landing_url'], access['status'],
              files, query['kind'] + ': ' + query['value'],
              basis + ' / ' + (', '.join(relation['relation_types']) or '—'), record['retrieved_at'],
              record['metadata_sha256'], record['metadata_url'], anchor['label'] + ' · ' + anchor['url']]
    values[8] = status
    ops = [{'insert': labels[0] + '\n'}]
    for label, value in zip(labels[1:], values):
        ops.append({'insert': label + ': '})
        entry = {'insert': value or unknown}
        if value in (record['landing_url'], record['metadata_url']):
            entry['attributes'] = {'link': value}
        ops.extend((entry, {'insert': '\n'}))
    notice = ('Metadata reference only. No files downloaded or file-access test performed. A relationship/keyword hit does not prove these are the paper\'s underlying data. Version, access, license and scientific suitability require review. Source review remains manual.' if en else
              '仅保存元数据引用；未下载文件，也未测试文件访问。关联记录或关键词命中不证明这是论文的原始数据。版本、访问条件、许可及研究适用性仍需核对；原文复核保持人工确认。')
    ops.append({'insert': notice + '\n'})
    return ''.join(op['insert'] for op in ops), {'version': 1, 'ops': ops}


def verify_reference_note(store, owner_id, data):
    reference = data['online_reference']
    verify_anchor(store, owner_id, reference['anchor'])
    expected_text, expected_rich = reference_content(reference)
    expected = NoteCreate(request_id=uuid4(), page=data['page'], rect=None, text=expected_text, rich_content=expected_rich)
    if data['text'] != expected.text or data.get('rich_content') != expected.rich_content:
        raise WorkspaceError('agent_proposal_changed', '引用正文与已取得的元数据不一致，请重新查询。', 409)


class OnlineDataTools:
    def online_anchor(self, ref):
        source = next((s for s in self.sources.items if s['ref'] == ref), None)
        if source is None or source['kind'] not in ('study_context', 'pdf_page', 'associated_pdf_page'):
            raise WorkspaceError('agent_source_required', '请先读取本次研究或论文中的实际出处。', 409)
        anchor = {key: source[key] for key in ('kind', 'document_id', 'label', 'url', 'page')}
        anchor['source_sha256'] = source.get('source_sha256') or source.get('scope_sha256')
        verify_anchor(self.workspace.store, self.document_id, anchor)
        return anchor

    def tool_find_online_datasets(self, data, call_id):
        anchor = self.online_anchor(data.source_ref)
        value = normalize_query(data.kind, data.query)
        cache = getattr(self, '_online_queries', {})
        self._online_queries = cache
        key = (data.kind, value, data.source_ref)
        if key in cache:
            return cache[key]
        if len(cache) >= 3:
            raise WorkspaceError('online_query_limit', '本次已查询3组来源，请核对结果或开启新的请求。', 409)
        cache[key] = {'saved': False, 'status': 'unavailable', 'items': [], 'notice': 'Query did not complete; retry in a new turn.'}
        result = self.workspace.online_data.find(data.kind, value)
        verify_anchor(self.workspace.store, self.document_id, anchor)
        items = []
        for record in result['items']:
            summary = record['provider'] + ' · ' + record['access']['status'] + '\n' + record['landing_url'] + '\n' + record['retrieved_at']
            source = self.sources.add('online_dataset', record['title'], page=self.turn['context']['page'], rect=None,
                url=record['landing_url'], text=summary, citation=record, query=result['query'], anchor=anchor)
            items.append({**record, 'source_ref': source['ref']})
        cache[key] = {**result, 'items': items}
        return cache[key]

    def tool_propose_data_reference(self, data, call_id):
        source = next((s for s in self.sources.items if s['ref'] == data.source_ref and s['kind'] == 'online_dataset'), None)
        if source is None or source['document_id'] != self.document_id:
            raise WorkspaceError('online_reference_required', '请先在本次请求中查询并选择真实的数据来源。', 409)
        verify_anchor(self.workspace.store, self.document_id, source['anchor'])
        reference = {'record': source['citation'], 'query': source['query'], 'anchor': source['anchor'],
                     'language': self.turn['context']['language']}
        body, rich = reference_content(reference)
        checked = NoteCreate(request_id=uuid4(), page=self.turn['context']['page'], rect=None, text=body, rich_content=rich)
        owner_source = self.sources.study(self.turn['context']['document']) if checked.page is None else next(
            (s for s in self.sources.items if s['kind'] == 'pdf_page' and s['document_id'] == self.document_id and s['page'] == source['anchor']['page']), None)
        if owner_source is None:
            raise WorkspaceError('agent_source_required', '原文页面出处已变化，请重新查询。', 409)
        payload = {**self.base_proposal(), 'page': owner_source['page'], 'rect': None, 'text': checked.text,
                   'rich_content': checked.rich_content, 'rich_html': render_html(checked.rich_content),
                   'image_ids': [], 'source_ref': owner_source['ref'], 'online_reference': reference}
        if checked.page is None:
            from .study_notes import anchor_from_source
            payload['source'] = anchor_from_source(owner_source, self.document_id)
        return self.proposals.add(self.turn, 'create_note', '保存数据来源引用' if reference['language'] == 'zh' else 'Save dataset reference', payload, call_id)
