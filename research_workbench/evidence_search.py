"""Bounded, read-only lexical evidence search over cached source pages.

This module never parses a PDF, starts a worker, calls a model or writes a cache
row.  It reads the existing ``reading_pages`` cache first and falls back to the
original source text already stored with saved translation jobs, then returns
short literal excerpts with stable chunk identity and truthful coverage.

The search is lexical only: Unicode-normalized term matching over prepared
text/title/caption blocks.  It is not semantic or cross-language retrieval, does
not analyze figures, tables, formulas or pixels, and is not scientific
verification.

An explicit ``page_scopes`` mapping selects exact page numbers per document
before any page is scheduled, so a recently prepared page is never crowded out
by lower prepared pages.  Scope descriptors come from ``reading_pages`` first and
then from at most one exact-page translation lookup per still-missing page.  The
scoped phase reads through one owned, genuinely read-only SQLite connection
(``mode=ro`` file URI) with a cooperative work budget, leaving the shared Store
connection defaults untouched and never creating a missing database file.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import time
import unicodedata

from .reading_pages import (
    KINDS, MAX_BLOCKS, PARSER_ID, PARSER_VERSION, RESULT_SCHEMA_VERSION,
)

MAX_QUERY_CHARS = 200
MAX_QUERY_TERMS = 16
MAX_DOCUMENTS = 9
MAX_LIMIT = 6
DEFAULT_LIMIT = 4
MAX_SEARCH_CALLS = 3

MAX_SNIPPET_CHARS = 1200
MAX_TOTAL_SNIPPET_CHARS = 7200
MAX_CHUNK_CHARS = 1200
CHUNK_OVERLAP = 150
MAX_CHUNKS_PER_PAGE = 32
MAX_RETAINED_HITS = 24

MAX_PAGE_JSON_CHARS = 256 * 1024
MAX_PAGE_JSON_BYTES = 256 * 1024
MAX_PAGE_SOURCE_CHARS = 24000
MAX_SCAN_PAGES_PER_DOCUMENT = 20
MAX_SCAN_PAGES_TOTAL = 60
MAX_PREPARED_PAGES = 200
MAX_REUSE_JOBS = 3
MAX_JOB_PAGES = 5
MAX_LISTED_PAGES = 20

MAX_SCOPE_PAGES_PER_DOCUMENT = 20
MAX_SCOPE_PAGES_TOTAL = 60
MAX_SCOPE_PAGE_NUMBER = 200
# Cooperative SQLite work budget for one explicit-scope source selection and
# search.  This bounds checked VM steps and lock waits on the owned connection,
# never file I/O or another connection.
SCOPE_BUDGET_SECONDS = 5.0
SCOPE_PROGRESS_STEPS = 2000
SCOPE_BUSY_TIMEOUT = 1.0
# Genuine SQLite primary result code for an interrupted statement ("interrupted").
# The fallback keeps older drivers without the constant usable.
SQLITE_INTERRUPT = getattr(sqlite3, 'SQLITE_INTERRUPT', 9)

READABLE_KINDS = ('text', 'title', 'caption')
PAGE_STATUSES = ('completed', 'partial', 'unavailable')
REUSE_STATUSES = ('completed', 'unavailable')

_LATIN = re.compile(r'[0-9a-z\u00c0-\u024f]+')
_CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f]+')

SCOPE_NOTICE = (
    'Bounded lexical search over cached prepared source pages. Only text, title and '
    'caption blocks were searched; figures, tables, formulas, pixels and OCR were not '
    'analyzed. At most 20 prepared pages per paper and 60 pages in total were scanned, '
    'with at most 240 blocks, 24000 source characters and 32 chunks considered per page. '
    'Each excerpt is at most 1200 original characters; source_start/source_end are '
    'offsets inside that block, and the block rectangle is a region, not exact word '
    'bounds. Prepared-page metadata comes from matching reading_pages plus only the '
    'three newest matching translation jobs (at most five completed or unavailable '
    'pages each); older matching translation history is not scanned, so prepared pages '
    'can be undercounted and unprepared_page_count is then unknown. This is not semantic '
    'or cross-language retrieval and not scientific verification. Prepared pages may be '
    'missing or partial and full_document_searched is false: a short excerpt is not a '
    'full-page or full-paper read, and no lexical match does not mean the paper does not '
    'report it. Use read_page for the current paper or read_reference_paper for a pinned '
    'paper when more context is needed.')
PREPARED_SCOPE_COMPLETE = (
    'Page descriptors come from matching reading_pages plus at most the three newest '
    'matching translation jobs (at most five completed or unavailable pages each). No '
    'older matching translation history was found, so the prepared page listing and '
    'unprepared_page_count are exact for this document.')
PREPARED_SCOPE_LIMITED = (
    'Page descriptors come from matching reading_pages plus only the three newest '
    'matching translation jobs (at most five completed or unavailable pages each). '
    'Older matching translation jobs exist and were not scanned, so some prepared pages '
    'may be missing from this listing: the prepared page count is a lower bound (searched '
    'pages remain the pages actually considered), unprepared_page_count is unknown, and '
    'pages_without_selected_cache_count counts pages without a selected cache row.')
EMPTY_NOTICE = (
    'No paper source is selected for this search in this turn: the captured context '
    'has no PDF paper or no pinned paper reference, and a dataset-only selection does '
    'not grant paper search. Ask the user to add a paper with Add references (添加资料), '
    'then search again. No other paper was searched and no library-wide search ran.')
PAGE_SCOPE_EXPLICIT = (
    'Only the page numbers explicitly requested for this paper were considered. Prepared, '
    'searched and unsearched page numbers describe that selected page scope only, never '
    'the whole document. For each requested page the matching reading_pages row wins; '
    'otherwise the newest matching eligible translation page for that exact page was '
    'checked. A requested page without either is reported as missing selected-page cache '
    'for this parser and source, which is not the same as an unprepared page. Pages '
    'outside the requested scope were not inspected, so whole-document prepared and '
    'unprepared counts are unknown and reported as null. full_document_searched is false.')
SCOPE_NOTICE_EXPLICIT = (
    'Bounded lexical search over ONLY the page numbers explicitly requested for each '
    'selected paper. Only text, title and caption blocks were searched; figures, tables, '
    'formulas, pixels and OCR were not analyzed. At most 240 blocks, 24000 source '
    'characters and 32 chunks were considered per page, and at most 20 pages per paper '
    'and 60 pages in total were scheduled. Each excerpt is at most 1200 original '
    'characters; source_start/source_end are offsets inside that block, and the block '
    'rectangle is a region, not exact word bounds. A requested page without a matching '
    'reading_pages row was checked once against the newest matching translation page for '
    'that exact page; a page still without a cache entry is reported as missing '
    'selected-page cache, not as unprepared, unavailable or as a negative finding, and '
    'no other page of that paper was inspected. Prepared, searched and unsearched page '
    'lists describe only the requested pages; whole-document prepared and unprepared '
    'counts are null because they are unknown. Missing, unavailable, partial, oversized '
    'and empty pages are reported separately, and full_document_searched is false: a '
    'short excerpt is not a full-page or full-paper read, and no lexical match does not '
    'mean the paper does not report it. This is not semantic or cross-language retrieval '
    'and not scientific verification. Use read_page for the current paper or '
    'read_reference_paper for a pinned paper when more context is needed.')


class EvidenceScopeTimeout(RuntimeError):
    """The owned explicit-scope SQLite work budget was exhausted.

    Raised only for a genuine SQLite interruption or an elapsed budget, so the
    tool boundary can report a safe timeout instead of empty or partial results.
    """


class ScopedReadBudget:
    """Cooperative 5-second SQLite work budget for one explicit-scope search.

    The deadline is shared by descriptor selection and the scoped page search of
    a single request.  ``tick`` is the SQLite progress handler (non-zero aborts
    the running statement); ``check`` aborts at explicit descriptor and page
    boundaries.  This is cooperative: it bounds checked VM steps and statements
    that actually run, never blocked file I/O or another connection, and it is
    not a promised hard wall-clock bound.
    """

    def __init__(self, seconds=SCOPE_BUDGET_SECONDS):
        self.seconds = seconds
        self.deadline = time.monotonic() + seconds
        self.exhausted = False

    def tick(self):
        if time.monotonic() >= self.deadline:
            self.exhausted = True
            return 1
        return 0

    def check(self):
        if time.monotonic() >= self.deadline:
            self.exhausted = True
            raise EvidenceScopeTimeout('explicit page-scope read budget exhausted')


def interrupted(error):
    """True only for SQLite's own statement interruption, never other errors.

    Uses the genuine ``SQLITE_INTERRUPT`` primary result code.  Only when the
    driver exposes no code at all is SQLite's own exact ``interrupted`` message
    accepted, and never as a substring: an error such as ``no such table:
    interrupted_cache`` is an unrelated SQL error.
    """
    code = getattr(error, 'sqlite_errorcode', None)
    if isinstance(code, int) and not isinstance(code, bool):
        return (code & 0xFF) == SQLITE_INTERRUPT
    return str(error or '').strip().casefold() == 'interrupted'


def query_terms(query):
    """Bounded deterministic query terms: Latin/digit runs and CJK bigrams."""
    folded = unicodedata.normalize('NFKC', query or '').casefold()
    terms, singles = [], []
    for match in _LATIN.finditer(folded):
        token = match.group(0)
        if len(token) >= 2:
            terms.append(token)
        else:
            singles.append(token)
    for match in _CJK.finditer(folded):
        run = match.group(0)
        if len(run) == 1:
            terms.append(run)
        else:
            terms.extend(run[index:index + 2] for index in range(len(run) - 1))
    if not terms:
        # A single Latin/digit character is permitted only when it is all that
        # remains after real words and CJK terms were extracted.
        terms = singles
    result = []
    for term in terms:
        if term and term not in result:
            result.append(term)
        if len(result) >= MAX_QUERY_TERMS:
            break
    return result


def fold_text(text):
    """Comparison-only normalization; literal source offsets are never rewritten."""
    return unicodedata.normalize('NFKC', text or '').casefold()


def block_rect(value):
    """Validated finite normalized block rectangle as [left,top,right,bottom]."""
    if not isinstance(value, dict) or set(value) != {'x', 'y', 'width', 'height'}:
        return None
    for key in ('x', 'y', 'width', 'height'):
        number = value[key]
        if isinstance(number, bool) or not isinstance(number, (int, float)):
            return None
        if not math.isfinite(number):
            return None
    x, y, width, height = (float(value[key]) for key in ('x', 'y', 'width', 'height'))
    if not (0.0 <= x < 1.0 and 0.0 <= y < 1.0 and 0 < width and 0 < height):
        return None
    right, bottom = x + width, y + height
    if right > 1.000001 or bottom > 1.000001:
        return None
    return [x, y, min(right, 1.0), min(bottom, 1.0)]


def page_blocks(value):
    """Parse one cached page body into bounded blocks or return None if invalid.

    Mirrors the frozen v0.47 reading_pages block shape: only the original source
    text is used, translated text is never read or returned.
    """
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None
    if not isinstance(value, list) or len(value) > MAX_BLOCKS:
        return None
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        identifier, text = item.get('id'), item.get('source_text')
        if not isinstance(identifier, str) or not identifier or not isinstance(text, str):
            continue
        kind = item.get('kind')
        order = item.get('order')
        result.append({'id': identifier,
                       'kind': kind if kind in KINDS else 'other',
                       'order': order if type(order) is int and order >= 0 else len(result),
                       'rect': block_rect(item.get('rect')),
                       'source_text': text,
                       'position': len(result)})
    return result


def chunk_ranges(length):
    """Deterministic chunk spans with bounded overlap and a hard 1200-char cap."""
    start = 0
    while start < length:
        end = min(start + MAX_CHUNK_CHARS, length)
        yield start, end
        if end >= length:
            break
        start = end - CHUNK_OVERLAP


def chunk_identity(document_id, source_sha256_value, page, block_id, start, end):
    """Stable chunk ID: document/hash/parser/schema/page/block/start/end."""
    parts = ('evidence-chunk-v1', str(document_id), source_sha256_value,
             PARSER_ID, PARSER_VERSION, str(RESULT_SCHEMA_VERSION),
             str(page), block_id, str(start), str(end))
    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()


def chunk_score(folded, terms, kind):
    """Safe deterministic relevance score; returns None when nothing matched."""
    matched, score = 0, 0.0
    for term in terms:
        count = folded.count(term)
        if not count:
            continue
        matched += 1
        score += 1.0 + min(count, 8) * 0.25
    if not matched:
        return None
    if kind == 'title':
        score += 0.5
    return round(score, 4)


def hit_key(hit):
    """Stable global ranking key; ties never depend on insertion order."""
    return (-hit['score'], hit['document_index'], hit['page'],
            hit['block_position'], hit['source_start'], hit['chunk_id'])


def round_robin(orders):
    """Fair deterministic page plan: one page per document per round."""
    plan = []
    counts = [0] * len(orders)
    index, total = 0, 0
    while total < MAX_SCAN_PAGES_TOTAL:
        added = False
        for document_index, pages in enumerate(orders):
            if index >= len(pages) or counts[document_index] >= MAX_SCAN_PAGES_PER_DOCUMENT:
                continue
            plan.append((document_index, pages[index]))
            counts[document_index] += 1
            total += 1
            added = True
            if total >= MAX_SCAN_PAGES_TOTAL:
                break
        if not added:
            break
        index += 1
    return plan


def listed(values):
    values = list(values)
    return values[:MAX_LISTED_PAGES], len(values), len(values) > MAX_LISTED_PAGES


class EvidenceService:
    """Read-only evidence service bound to the existing workspace Store."""

    def __init__(self, store):
        self.store = store

    # ----------------------------------------------------------- descriptors
    def prepared(self, document_id, source_sha256_value):
        """Metadata descriptors only: page/status/JSON character and byte size.

        ``reading_pages`` wins per page, including unavailable rows.  Missing
        pages fall back to at most the three newest matching translation jobs,
        each contributing at most five completed/unavailable pages, so a long
        job history can never be loaded.  One extra job id is read as metadata
        only to detect that older matching history exists; its page bodies are
        never loaded.
        """
        pages, history_limited = {}, False
        guards = (str(document_id), source_sha256_value, PARSER_ID, PARSER_VERSION,
                  RESULT_SCHEMA_VERSION)
        with self.store.connection() as connection:
            if not connection.in_transaction:
                connection.execute('BEGIN')
            rows = connection.execute(
                'SELECT page,status,length(blocks_json) AS json_chars,'
                'length(CAST(blocks_json AS BLOB)) AS json_bytes FROM reading_pages '
                'WHERE document_id=? AND source_sha256=? AND parser_id=? AND parser_version=? '
                'AND result_schema_version=? ORDER BY page LIMIT ?',
                (*guards, MAX_PREPARED_PAGES)).fetchall()
            for row in rows:
                if row['status'] not in PAGE_STATUSES:
                    continue
                if not 1 <= row['page'] <= MAX_PREPARED_PAGES:
                    continue
                pages[row['page']] = {'page': row['page'], 'origin': 'reading',
                                      'job_id': None, 'status': row['status'],
                                      'json_chars': row['json_chars'] or 0,
                                      'json_bytes': row['json_bytes'] or 0}
            jobs = connection.execute(
                'SELECT id FROM translation_jobs WHERE document_id=? AND source_sha256=? '
                'AND parser_id=? AND parser_version=? AND result_schema_version=? '
                'ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT ?',
                (*guards, MAX_REUSE_JOBS + 1)).fetchall()
            history_limited = len(jobs) > MAX_REUSE_JOBS
            for job in jobs[:MAX_REUSE_JOBS]:
                if len(pages) >= MAX_PREPARED_PAGES:
                    break
                rows = connection.execute(
                    "SELECT page,status,length(blocks_json) AS json_chars,"
                    "length(CAST(blocks_json AS BLOB)) AS json_bytes FROM translation_pages "
                    "WHERE job_id=? AND status IN (?,?) ORDER BY page LIMIT ?",
                    (job['id'], *REUSE_STATUSES, MAX_JOB_PAGES)).fetchall()
                for row in rows:
                    if len(pages) >= MAX_PREPARED_PAGES:
                        break
                    if row['page'] in pages:
                        continue
                    if not 1 <= row['page'] <= MAX_PREPARED_PAGES:
                        continue
                    pages[row['page']] = {'page': row['page'], 'origin': 'translation',
                                          'job_id': job['id'], 'status': row['status'],
                                          'json_chars': row['json_chars'] or 0,
                                          'json_bytes': row['json_bytes'] or 0}
        return pages, history_limited

    def page_order(self, document):
        """Prepared descriptors within the live page count plus history limit."""
        prepared, history_limited = self.prepared(document['document_id'],
                                                  document['source_sha256'])
        total = document['page_count']
        pages = [prepared[number] for number in sorted(prepared) if number <= total]
        return pages, history_limited

    # -------------------------------------------------------- explicit scopes
    def scoped_prepared(self, document_id, source_sha256_value, requested,
                        connection, budget=None):
        """Descriptors for exactly the requested pages of one document.

        No unscoped body is inspected: one bounded ``reading_pages`` metadata
        query covers the requested page set, then each still-missing requested
        page gets at most one parameterized metadata-only exact-page translation
        lookup (newest eligible job first).  A requested page with no matching
        row stays missing; this never falls back to another page or job and
        never fetches historical job/page bodies here.

        When ``budget`` is given, the shared deadline is checked at the explicit
        descriptor boundaries of this document: on entry, around its cache
        query and before every exact-page translation lookup, so a tiny query
        cannot slip past the deadline before the progress handler interval.
        """
        pages = {}
        wanted = []
        for number in requested:
            if type(number) is not int or number in wanted:
                continue
            if not 1 <= number <= MAX_SCOPE_PAGE_NUMBER:
                continue
            wanted.append(number)
        if not wanted:
            return pages
        if budget is not None:
            budget.check()
        guards = (str(document_id), source_sha256_value, PARSER_ID, PARSER_VERSION,
                  RESULT_SCHEMA_VERSION)
        # The placeholder list is built from the validated page count only; every
        # page value stays a bound parameter.
        placeholders = ','.join('?' * len(wanted))
        rows = connection.execute(
            'SELECT page,status,length(blocks_json) AS json_chars,'
            'length(CAST(blocks_json AS BLOB)) AS json_bytes FROM reading_pages '
            'WHERE document_id=? AND source_sha256=? AND parser_id=? AND parser_version=? '
            'AND result_schema_version=? AND page IN (' + placeholders + ')',
            (*guards, *wanted)).fetchall()
        if budget is not None:
            budget.check()
        for row in rows:
            if row['status'] not in PAGE_STATUSES:
                continue
            if row['page'] not in wanted:
                continue
            # A matching reading_pages row wins, including partial, unavailable
            # and oversized rows; their explicit status is reported later.
            pages[row['page']] = {'page': row['page'], 'origin': 'reading',
                                  'job_id': None, 'status': row['status'],
                                  'json_chars': row['json_chars'] or 0,
                                  'json_bytes': row['json_bytes'] or 0}
        for number in wanted:
            if number in pages:
                continue
            if budget is not None:
                budget.check()
            row = connection.execute(
                "SELECT p.job_id,p.page,p.status,length(p.blocks_json) AS json_chars,"
                "length(CAST(p.blocks_json AS BLOB)) AS json_bytes "
                "FROM translation_pages p JOIN translation_jobs j ON j.id=p.job_id "
                "WHERE j.document_id=? AND j.source_sha256=? AND j.parser_id=? "
                "AND j.parser_version=? AND j.result_schema_version=? AND p.page=? "
                "AND p.status IN (?,?) "
                "ORDER BY j.updated_at DESC,j.created_at DESC,j.id DESC LIMIT 1",
                (*guards, number, *REUSE_STATUSES)).fetchone()
            if row is None:
                continue
            pages[number] = {'page': number, 'origin': 'translation',
                             'job_id': row['job_id'], 'status': row['status'],
                             'json_chars': row['json_chars'] or 0,
                             'json_bytes': row['json_bytes'] or 0}
        return pages

    @contextmanager
    def scoped_connection(self, budget):
        """Owned, genuinely read-only connection with a short busy timeout.

        ``Store.database`` is an absolute path, so it is opened through a
        correctly encoded ``file:`` URI with ``mode=ro``: this connection can
        never write and can never create a missing database file.  A read
        transaction is started explicitly so descriptor metadata, each head row
        and each body row are read from one consistent snapshot.

        The progress handler and busy timeout belong to this connection only, so
        shared Store defaults, other connections and unscoped searches are
        unchanged.  The handler is always removed and the connection always
        closed.  Only a genuine SQLite interruption of this connection's own
        statement becomes ``EvidenceScopeTimeout``; every other SQL or
        programming error keeps propagating untouched, including errors that
        happen after the budget deadline was reached.
        """
        uri = Path(self.store.database).resolve().as_uri() + '?mode=ro'
        connection = sqlite3.connect(uri, uri=True, timeout=SCOPE_BUSY_TIMEOUT)
        connection.row_factory = sqlite3.Row
        try:
            connection.set_progress_handler(budget.tick, SCOPE_PROGRESS_STEPS)
            try:
                # Deferred read transaction: a stable snapshot for all metadata,
                # head and body reads of this scoped request.
                connection.execute('BEGIN')
                yield connection
            except sqlite3.OperationalError as error:
                if interrupted(error):
                    raise EvidenceScopeTimeout(
                        'explicit page-scope read budget exhausted') from None
                raise
        finally:
            try:
                connection.set_progress_handler(None, 0)
            finally:
                connection.close()

    # ---------------------------------------------------------------- loading
    def load(self, document_id, source_sha256_value, number, descriptor,
             connection=None):
        """Load exactly the selected row under matching source guards.

        The head row is inspected first (status plus both character and UTF-8
        byte size) so an oversized, changed or unavailable body is never loaded
        at all.  The body query repeats the same source guards and a byte/char
        bound as defense in depth.  A changed status or a vanished row is
        reported instead of silently switching to another page or job.
        """
        if connection is not None:
            return self.bounded_load(connection, document_id, source_sha256_value,
                                     number, descriptor)
        with self.store.connection() as store_connection:
            if not store_connection.in_transaction:
                store_connection.execute('BEGIN')
            return self.bounded_load(store_connection, document_id,
                                     source_sha256_value, number, descriptor)

    def bounded_load(self, connection, document_id, source_sha256_value, number,
                     descriptor):
        """Existing load guards over a caller-provided connection."""
        guards = (str(document_id), source_sha256_value, PARSER_ID, PARSER_VERSION,
                  RESULT_SCHEMA_VERSION)
        if descriptor['origin'] == 'reading':
            head = connection.execute(
                'SELECT status,length(blocks_json) AS json_chars,'
                'length(CAST(blocks_json AS BLOB)) AS json_bytes FROM reading_pages '
                'WHERE document_id=? AND source_sha256=? AND parser_id=? AND parser_version=? '
                'AND result_schema_version=? AND page=?',
                (*guards, number)).fetchone()
        else:
            head = connection.execute(
                "SELECT p.status,length(p.blocks_json) AS json_chars,"
                "length(CAST(p.blocks_json AS BLOB)) AS json_bytes "
                "FROM translation_pages p "
                "JOIN translation_jobs j ON j.id=p.job_id "
                "WHERE p.job_id=? AND p.page=? AND p.status IN ('completed','unavailable') "
                "AND j.document_id=? AND j.source_sha256=? AND j.parser_id=? "
                "AND j.parser_version=? AND j.result_schema_version=?",
                (descriptor['job_id'], number, *guards)).fetchone()
        if head is None:
            return {'state': 'changed'}
        if head['status'] != descriptor['status'] or head['status'] not in PAGE_STATUSES:
            return {'state': 'changed'}
        if head['status'] == 'unavailable':
            # An unavailable page is never evidence, even when a stale row
            # still carries text blocks from an older preparation attempt.
            return {'state': 'unavailable'}
        if ((head['json_bytes'] or 0) > MAX_PAGE_JSON_BYTES
                or (head['json_chars'] or 0) > MAX_PAGE_JSON_CHARS):
            return {'state': 'oversized'}
        if descriptor['origin'] == 'reading':
            body = connection.execute(
                'SELECT blocks_json FROM reading_pages WHERE document_id=? '
                'AND source_sha256=? AND parser_id=? AND parser_version=? '
                'AND result_schema_version=? AND page=? AND status=? '
                'AND COALESCE(length(CAST(blocks_json AS BLOB)),0)<=? '
                'AND COALESCE(length(blocks_json),0)<=?',
                (*guards, number, head['status'], MAX_PAGE_JSON_BYTES,
                 MAX_PAGE_JSON_CHARS)).fetchone()
        else:
            body = connection.execute(
                "SELECT p.blocks_json FROM translation_pages p "
                "JOIN translation_jobs j ON j.id=p.job_id "
                "WHERE p.job_id=? AND p.page=? AND p.status=? AND j.document_id=? "
                "AND j.source_sha256=? AND j.parser_id=? AND j.parser_version=? "
                "AND j.result_schema_version=? "
                "AND COALESCE(length(CAST(p.blocks_json AS BLOB)),0)<=? "
                "AND COALESCE(length(p.blocks_json),0)<=?",
                (descriptor['job_id'], number, head['status'], *guards,
                 MAX_PAGE_JSON_BYTES, MAX_PAGE_JSON_CHARS)).fetchone()
        if body is None:
            return {'state': 'changed'}
        raw = body['blocks_json']
        if not isinstance(raw, str) or len(raw.encode('utf-8')) > MAX_PAGE_JSON_BYTES:
            return {'state': 'oversized'}
        blocks = page_blocks(raw)
        if blocks is None:
            return {'state': 'invalid'}
        return {'state': 'ok', 'status': head['status'], 'blocks': blocks}

    # ---------------------------------------------------------------- search
    def search(self, documents, terms, limit, page_scopes=None):
        """Search cached pages, optionally restricted to explicit page scopes.

        ``page_scopes`` is a mapping ``document_id -> sorted page numbers``
        already validated by the tool boundary.  ``None`` keeps the previous
        unscoped behavior unchanged; otherwise only those exact pages are
        scheduled, so an explicit page can never be crowded out by lower
        prepared pages.
        """
        for index, document in enumerate(documents):
            document.setdefault('document_index', index)
        if page_scopes is None:
            return self.default_search(documents, terms, limit)
        return self.scoped_search(documents, terms, limit, page_scopes)

    def default_search(self, documents, terms, limit):
        """Unscoped v0.48 selection: reading pages plus the newest three jobs."""
        orders, histories = [], []
        for document in documents:
            pages, history_limited = self.page_order(document)
            orders.append(pages)
            histories.append(history_limited)
        plan = round_robin(orders)
        hits, states = self.run_plan(plan, documents, terms, limit)
        coverage = [self.coverage_entry(document, pages, state, history_limited)
                    for document, pages, state, history_limited
                    in zip(documents, orders, states, histories)]
        return {'items': hits, 'coverage': coverage, 'scanned': len(plan),
                'page_scope_mode': 'default'}

    def scoped_search(self, documents, terms, limit, page_scopes):
        """Exact requested pages only, under one owned budgeted connection."""
        scopes = {}
        for key, pages in page_scopes.items():
            scopes[str(key)] = sorted({page for page in pages if type(page) is int})
        budget = ScopedReadBudget()
        orders, requested_pages = [], []
        with self.scoped_connection(budget) as connection:
            for document in documents:
                # One explicit boundary per document, before its descriptor
                # selection starts, so no document is begun after the deadline.
                budget.check()
                requested = scopes.get(str(document['document_id']), [])
                requested_pages.append(list(requested))
                descriptors = self.scoped_prepared(document['document_id'],
                                                   document['source_sha256'],
                                                   requested, connection,
                                                   budget=budget)
                orders.append([descriptors[number] for number in requested
                               if number in descriptors])
            plan = round_robin(orders)
            hits, states = self.run_plan(plan, documents, terms, limit,
                                        connection=connection, budget=budget)
        # Unconditional final checkpoint: an empty plan, no descriptors or no
        # hits must not be reported as scoped success after the deadline.
        budget.check()
        coverage = [self.coverage_entry(document, pages, state, False, requested)
                    for document, pages, state, requested
                    in zip(documents, orders, states, requested_pages)]
        return {'items': hits, 'coverage': coverage, 'scanned': len(plan),
                'page_scope_mode': 'explicit'}

    def run_plan(self, plan, documents, terms, limit, connection=None, budget=None):
        """Execute the bounded round-robin page plan and rank retained hits."""
        states = [{'searched_pages': [], 'skipped': [], 'empty': [], 'truncated': [],
                   'unavailable': []} for _ in documents]
        retained = []
        for document_index, descriptor in plan:
            if budget is not None:
                # Cooperative budget boundary between pages: file I/O is not
                # hard-bounded, but the scoped phase cannot silently continue
                # past the deadline and return partial evidence as success.
                budget.check()
            document = documents[document_index]
            state = states[document_index]
            if descriptor['status'] == 'unavailable':
                # A stale or unavailable page is never searched and never
                # yields evidence, even when its cached row still has blocks.
                state['unavailable'].append(descriptor['page'])
                state['skipped'].append({'page': descriptor['page'],
                                         'reason': 'unavailable'})
                continue
            if (descriptor['json_bytes'] > MAX_PAGE_JSON_BYTES
                    or descriptor['json_chars'] > MAX_PAGE_JSON_CHARS):
                state['skipped'].append({'page': descriptor['page'], 'reason': 'oversized'})
                continue
            loaded = self.load(document['document_id'], document['source_sha256'],
                               descriptor['page'], descriptor, connection=connection)
            if loaded['state'] != 'ok':
                if loaded['state'] == 'unavailable':
                    state['unavailable'].append(descriptor['page'])
                state['skipped'].append({'page': descriptor['page'],
                                         'reason': loaded['state']})
                continue
            state['searched_pages'].append(descriptor['page'])
            hits, empty, truncated = self.page_hits(
                document, descriptor['page'], loaded['blocks'], terms)
            if empty:
                state['empty'].append(descriptor['page'])
            if truncated:
                state['truncated'].append(descriptor['page'])
            retained.extend(hits)
            if len(retained) > MAX_RETAINED_HITS:
                # Only a bounded global best list is retained while streaming
                # pages; a hit outside it can never enter the final top slots.
                retained.sort(key=hit_key)
                del retained[MAX_RETAINED_HITS:]
        return sorted(retained, key=hit_key)[:limit], states

    @staticmethod
    def page_hits(document, page, blocks, terms):
        """Chunk and score one page under all per-page bounds.

        Only the best chunk of each block is retained, so overlapping chunks of
        one paragraph cannot flood the answer.
        """
        best = {}
        considered, chunks, truncated = 0, 0, False
        for block in blocks:
            if block['kind'] not in READABLE_KINDS:
                continue
            text = block['source_text']
            if not text:
                continue
            remaining = MAX_PAGE_SOURCE_CHARS - considered
            if remaining <= 0:
                truncated = True
                break
            piece = text[:remaining]
            considered += len(piece)
            if len(piece) < len(text):
                truncated = True
            for start, end in chunk_ranges(len(piece)):
                if chunks >= MAX_CHUNKS_PER_PAGE:
                    truncated = True
                    break
                chunks += 1
                snippet = piece[start:end]
                score = chunk_score(fold_text(snippet), terms, block['kind'])
                if score is None:
                    continue
                previous = best.get(block['id'])
                if previous is not None and score <= previous['score']:
                    continue
                best[block['id']] = {
                    'document_id': document['document_id'],
                    'document_index': document['document_index'],
                    'title': document['title'], 'role': document['role'], 'page': page,
                    'source_sha256': document['source_sha256'],
                    'block_id': block['id'], 'block_position': block['position'],
                    'chunk_id': chunk_identity(document['document_id'],
                                               document['source_sha256'], page,
                                               block['id'], start, end),
                    'source_start': start, 'source_end': end, 'rect': block['rect'],
                    'score': score, 'snippet': snippet, 'excerpt': True}
            if chunks >= MAX_CHUNKS_PER_PAGE:
                truncated = True
                break
        empty = not any(block['kind'] in READABLE_KINDS and block['source_text']
                        for block in blocks)
        hits = sorted(best.values(), key=lambda hit: (
            -hit['score'], hit['block_position'], hit['source_start'], hit['chunk_id']))
        return hits, empty, truncated

    @staticmethod
    def coverage_entry(document, pages, state, history_limited, requested=None):
        """Per-document coverage; ``requested`` marks an explicit page scope."""
        prepared_numbers = [page['page'] for page in pages]
        searched_numbers = sorted(set(state['searched_pages']))
        searched_set = set(searched_numbers)
        unsearched_numbers = [number for number in prepared_numbers
                              if number not in searched_set]
        total = document['page_count']
        partial = [page['page'] for page in pages if page['status'] == 'partial']
        unavailable = [page['page'] for page in pages if page['status'] == 'unavailable']
        unavailable = sorted(set(unavailable) | set(state['unavailable'])
                             | set(state['empty']))
        empty = sorted(set(state['empty']))
        truncated = sorted(set(state['truncated']))
        skipped = list(state['skipped'])
        prepared_list, prepared_count, prepared_more = listed(prepared_numbers)
        searched_list, searched_count, searched_more = listed(searched_numbers)
        unsearched_list, unsearched_count, unsearched_more = listed(unsearched_numbers)
        partial_list, partial_count, partial_more = listed(partial)
        unavailable_list, unavailable_count, unavailable_more = listed(unavailable)
        empty_list, empty_count, empty_more = listed(empty)
        truncated_list, truncated_count, truncated_more = listed(truncated)
        skipped_list, skipped_count, skipped_more = listed(skipped)
        if requested is None:
            # Unscoped v0.48 behavior: whole-document counts stay exactly as
            # before, and the latest-three history notice is unchanged.
            mode = 'default'
            requested_numbers = []
            missing_numbers = []
            unprepared = None if history_limited else max(0, total - prepared_count)
            without_cache = max(0, total - prepared_count)
            prepared_history_limited = history_limited
            prepared_scope = (PREPARED_SCOPE_LIMITED if history_limited
                              else PREPARED_SCOPE_COMPLETE)
        else:
            # Explicit scope: only the requested pages were inspected, so a
            # whole-document unprepared count cannot be known or claimed.
            mode = 'explicit'
            requested_numbers = sorted({number for number in requested})
            prepared_set = set(prepared_numbers)
            missing_numbers = [number for number in requested_numbers
                               if number not in prepared_set]
            unprepared = None
            without_cache = None
            prepared_history_limited = False
            prepared_scope = PAGE_SCOPE_EXPLICIT
        requested_list, requested_count, requested_more = listed(requested_numbers)
        missing_list, missing_count, missing_more = listed(missing_numbers)
        return {
            'document_id': document['document_id'], 'title': document['title'],
            'role': document['role'], 'total_pages': total,
            'prepared_pages': prepared_count, 'searched_pages': searched_count,
            'unsearched_prepared_pages': unsearched_count,
            'prepared_page_numbers': prepared_list,
            'prepared_page_numbers_count': prepared_count,
            'prepared_page_numbers_truncated': prepared_more,
            'searched_page_numbers': searched_list,
            'searched_page_numbers_count': searched_count,
            'searched_page_numbers_truncated': searched_more,
            'unsearched_prepared_page_numbers': unsearched_list,
            'unsearched_prepared_page_numbers_count': unsearched_count,
            'unsearched_prepared_page_numbers_truncated': unsearched_more,
            'page_scope_mode': mode,
            'requested_page_numbers': requested_list,
            'requested_page_numbers_count': requested_count,
            'requested_page_numbers_truncated': requested_more,
            'missing_requested_cache_page_numbers': missing_list,
            'missing_requested_cache_page_numbers_count': missing_count,
            'missing_requested_cache_page_numbers_truncated': missing_more,
            'unprepared_page_count': unprepared,
            'pages_without_selected_cache_count': without_cache,
            'prepared_history_limited': prepared_history_limited,
            'prepared_scope': prepared_scope,
            'partial_pages': partial_list, 'partial_page_count': partial_count,
            'partial_pages_truncated': partial_more,
            'unavailable_pages': unavailable_list,
            'unavailable_page_count': unavailable_count,
            'unavailable_pages_truncated': unavailable_more,
            'empty_pages': empty_list, 'empty_page_count': empty_count,
            'empty_pages_truncated': empty_more,
            'skipped_pages': skipped_list, 'skipped_page_count': skipped_count,
            'skipped_pages_truncated': skipped_more,
            'truncated_pages': truncated_list, 'truncated_page_count': truncated_count,
            'truncated_pages_truncated': truncated_more,
            'full_document_searched': False,
            'note': ('Short excerpts only. Searched pages are cached prepared pages, '
                     'not proof that the whole page, figures, tables or formulas were read.')}
