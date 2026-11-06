"""Read-only Agent preparation of a source-pinned paper presentation plan.

This module is deliberately small: it reuses ``Presentations.context`` to
validate the actual bound PDF, metadata and page range, then stores a machine
plan in the existing ``agent_events`` table.  It never invokes the outline
model, creates a slide file or exposes extracted paper text to the model.
"""
import json
import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .agent_store import canonical
from .models import WorkspaceError
from .presentation_models import PresentationSelectors
from .presentation_paper import MAX_PAGES as PAPER_MAX_PAGES, page_scope

PLAN_FORMAT = 'research-agent-presentation-plan/v1'
PLAN_KIND = 'presentation_plan'
MAX_TITLE = 120
MAX_SUMMARY = 2000
MAX_PAGE_RANGE = 240
MAX_TEXT_CHARS = 120000
STYLES = ('default', 'nature', 'cell')
PLAN_FIELDS = ('format', 'document_id', 'file_sha256', 'source_sha256', 'title',
               'style', 'page_count', 'page_range', 'text_chars', 'empty_page_range')
_HEX = frozenset('0123456789abcdef')
_PAGE_TOKEN = re.compile(r'[1-9][0-9]*')


class PresentationArguments(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    paper_pages: list[Annotated[int, Field(strict=True, ge=1, le=200)]] | None = Field(
        default=None, max_length=PAPER_MAX_PAGES)
    style: Literal['default', 'nature', 'cell'] = 'default'

    @field_validator('title')
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid presentation title')
        return value

    @field_validator('paper_pages', mode='before')
    @classmethod
    def clean_paper_pages(cls, value):
        if value is None:
            return None
        if not isinstance(value, list) or not value:
            raise ValueError('Select at least one paper page')
        if len(value) > PAPER_MAX_PAGES:
            raise ValueError(f'Select at most {PAPER_MAX_PAGES} paper pages')
        for item in value:
            # bool is an int subclass; reject it and every non-integer form.
            if type(item) is not int or not 1 <= item <= 200:
                raise ValueError('Invalid paper page number')
        if value != sorted(set(value)):
            raise ValueError('Paper pages must be unique and ascending')
        return value


PRESENTATION_DEFINITIONS = [
    ('prepare_presentation', '准备演示文稿',
     'Prepare a read-only, source-pinned plan for the current bound paper only. '
     'This does not generate a model outline, slide deck, file or download; the '
     'user must explicitly generate it from the plan later. title is required. '
     'paper_pages must be strictly ascending unique integers 1..200, at most 60; '
     'null means the whole paper only when it is within that limit.',
     PresentationArguments, 'read'),
]


def presentation_context_granted(context):
    """Persisted negotiated grant: true, ordinary turn and non-study PDF."""
    return (context.get('presentation_actions') is True
            and not context.get('task_id')
            and context.get('document', {}).get('kind') != 'study')


def presentation_granted(workspace, context):
    """Negotiated, ordinary (not continue_task) PDF context only."""
    return (getattr(workspace, 'presentations', None) is not None
            and presentation_context_granted(context))


def _canonical_uuid(value):
    if not isinstance(value, str) or len(value) != 36:
        return None
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None
    return value if str(parsed) == value else None


def _digest(value):
    return isinstance(value, str) and len(value) == 64 and set(value) <= _HEX


def _pages(value):
    """Parse one canonical compact page scope and return an ordered list.

    Only ASCII canonical numbers are accepted: ``str.isdigit`` also accepts
    characters such as superscripts, which would raise in ``int``.  Expansion
    is bounded before any range is materialised.
    """
    if not isinstance(value, str) or not value or len(value) > MAX_PAGE_RANGE:
        return None
    pages = []
    for chunk in value.split(','):
        parts = chunk.split('-')
        if len(parts) > 2 or any(_PAGE_TOKEN.fullmatch(part) is None for part in parts):
            return None
        start = int(parts[0])
        end = int(parts[-1])
        if not 1 <= start <= end <= 200:
            return None
        if len(pages) + (end - start + 1) > PAPER_MAX_PAGES:
            return None
        pages.extend(range(start, end + 1))
    if len(pages) != len(set(pages)):
        return None
    return pages if page_scope(pages) == value else None


def plan_record(document_id, event):
    """Validate one stored event as an additive, same-owner plan DTO.

    Only stored text is inspected: opening history never reads a PDF file or
    calls a model.  Malformed/foreign rows are ignored rather than rendered.
    """
    if not isinstance(event, dict) or event.get('kind') != PLAN_KIND:
        return None
    if event.get('status') != 'completed':
        return None
    summary = event.get('summary')
    if not isinstance(summary, str) or not summary or len(summary) > MAX_SUMMARY:
        return None
    try:
        plan = json.loads(summary)
    except (ValueError, TypeError):
        return None
    if not isinstance(plan, dict) or set(plan) != set(PLAN_FIELDS):
        return None
    if plan['format'] != PLAN_FORMAT:
        return None
    if _canonical_uuid(plan['document_id']) != str(document_id):
        return None
    if _canonical_uuid(event.get('id')) is None:
        return None
    if not _digest(plan['file_sha256']) or not _digest(plan['source_sha256']):
        return None
    title = plan['title']
    if (not isinstance(title, str) or not title or len(title) > MAX_TITLE
            or title != title.strip()
            or any(ord(c) < 32 or ord(c) == 127 for c in title)):
        return None
    if plan['style'] not in STYLES:
        return None
    page_count = plan['page_count']
    if type(page_count) is not int or not 1 <= page_count <= 200:
        return None
    # page_count is the TOTAL PDF page count; page_range is the selected,
    # canonical subset.  Opening history never opens the PDF to recount it.
    pages = _pages(plan['page_range'])
    if not pages or pages[-1] > page_count:
        return None
    empty = plan['empty_page_range']
    if not isinstance(empty, str) or len(empty) > MAX_PAGE_RANGE:
        return None
    if empty:
        empty_pages = _pages(empty)
        if empty_pages is None or not set(empty_pages) <= set(pages):
            return None
    text_chars = plan['text_chars']
    if type(text_chars) is not int or not 1 <= text_chars <= MAX_TEXT_CHARS:
        return None
    return {'id': event['id'], **plan}


class PresentationTools:
    def _checked_document(self, expected_sha, captured):
        from .studies import verify_owner
        if captured.get('kind') == 'study' or captured.get('page_count') is None:
            raise WorkspaceError('agent_presentation_not_pdf',
                                 '只有当前绑定的 PDF 论文可以准备演示文稿。', 409)
        current = self.workspace.store.get_document(self.document_id)
        if current.get('kind') == 'study' or current.get('page_count') is None:
            raise WorkspaceError('agent_presentation_not_pdf',
                                 '只有当前绑定的 PDF 论文可以准备演示文稿。', 409)
        verify_owner(self.workspace.store, current)
        if current.get('sha256') != expected_sha:
            raise WorkspaceError('source_changed', '原论文已变化，请核对资料后重试。', 409)
        return current

    def _publish_plan(self, summary, title):
        event_id = self.store.publish_presentation_plan(
            self.document_id, self.turn['id'], title, summary,
            self.turn['context']['document'].get('sha256'))
        if event_id is None:
            raise WorkspaceError('agent_cancelled', '助手请求已结束，本次演示文稿计划未保存。', 409)
        return event_id

    def tool_prepare_presentation(self, data, call_id):
        context = self.turn['context']
        if not presentation_granted(self.workspace, context):
            raise WorkspaceError('agent_presentation_not_allowed',
                                 '当前对话没有准备演示文稿的授权。', 409)
        service = self.workspace.presentations
        captured = context['document']
        expected_sha = captured.get('sha256')
        if not _digest(expected_sha):
            raise WorkspaceError('source_changed', '原论文已变化，请核对资料后重试。', 409)
        current = self._checked_document(expected_sha, captured)
        selectors = PresentationSelectors(title=data.title, style=data.style,
                                          include_paper=True, paper_pages=data.paper_pages)
        result = service.context(self.document_id, selectors)
        current = self._checked_document(expected_sha, captured)
        if not isinstance(result, dict):
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文来源上下文无法验证，请重试。', 409)
        papers = [source for source in result.get('sources', [])
                  if isinstance(source, dict) and source.get('kind') == 'paper']
        if len(papers) != 1:
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文来源上下文无法验证，请重试。', 409)
        paper = papers[0]
        if str(paper.get('id')) != str(self.document_id) or paper.get('file_sha256') != expected_sha:
            raise WorkspaceError('source_changed', '原论文已变化，请核对资料后重试。', 409)
        pages = paper.get('pages')
        if (not isinstance(pages, list) or not pages or len(pages) > PAPER_MAX_PAGES
                or any(type(page) is not int or not 1 <= page <= 200 for page in pages)
                or pages != sorted(set(pages))
                or pages[-1] > current['page_count']):
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文页码无法验证，请重试。', 409)
        expected_pages = (data.paper_pages if data.paper_pages is not None
                          else list(range(1, current['page_count'] + 1)))
        if pages != expected_pages:
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文页码无法验证，请重试。', 409)
        empty_pages = paper.get('empty_pages')
        if (not isinstance(empty_pages, list)
                or any(type(page) is not int or page not in pages for page in empty_pages)
                or empty_pages != sorted(set(empty_pages))):
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文页码无法验证，请重试。', 409)
        text_chars = paper.get('text_chars')
        if type(text_chars) is not int or not 1 <= text_chars <= MAX_TEXT_CHARS:
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文文字范围无法验证，请重试。', 409)
        page_range = page_scope(pages)
        empty_range = page_scope(empty_pages) if empty_pages else ''
        if len(page_range) > MAX_PAGE_RANGE or len(empty_range) > MAX_PAGE_RANGE:
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文页码范围无法验证，请重试。', 409)
        plan = {
            'format': PLAN_FORMAT,
            'document_id': str(self.document_id),
            'file_sha256': expected_sha,
            'source_sha256': result.get('source_sha256'),
            'title': data.title,
            'style': data.style,
            'page_count': current['page_count'],
            'page_range': page_range,
            'text_chars': text_chars,
            'empty_page_range': empty_range,
        }
        if not _digest(plan['source_sha256']):
            raise WorkspaceError('presentation_plan_invalid',
                                 '论文来源摘要无法验证，请重试。', 409)
        summary = canonical(plan)
        if len(summary) > MAX_SUMMARY:
            raise WorkspaceError('presentation_plan_too_large',
                                 '演示文稿计划过大，请缩短标题或减少页码。', 413)
        self._publish_plan(summary, data.title)
        return {**plan, 'prepared': True,
                'notice': 'Plan only. No model outline, slide deck, file or download '
                          'was created; the user must explicitly generate it.'}
