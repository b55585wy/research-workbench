"""Bounded read-only catalog of saved translation records.

This is the additive read surface behind the reader's translation history: one
bounded query per requested page answers mixed continuous runs and legacy jobs,
so listing history never parses a PDF, calls a model, starts a supervisor,
creates a child/task, writes a row or spends credit.  Page result blocks are
never loaded; only the small frozen page lists and job/run metadata are read.

A record is visible only while its active PDF owner still exists and still has
the exact bytes the record was authorized for.  Trashed/purged documents,
studies (``page_count IS NULL``) and replaced sources are therefore hidden, and
a legacy job already owned by a continuous run is represented once by its run.
The query never guesses a column: it reads the deployed schema-27 relations and
the actual metadata title, so later renames are honored.
"""
from __future__ import annotations

import json

from .models import WorkspaceError

DEFAULT_LIMIT = 20
MAX_LIMIT = 50
MAX_OFFSET = 100000
MAX_QUERY = 200

# Legacy jobs already represented by a continuous run are excluded, whether the
# run created the child or reused an exactly compatible legacy job.
ENTRIES = '''
WITH entries AS (
    SELECT 'run' AS kind,id,document_id,source_sha256,pages_json,target_language,
           status,completed_pages,total_pages,created_at,updated_at
      FROM translation_runs
    UNION ALL
    SELECT 'job',j.id,j.document_id,j.source_sha256,j.pages_json,j.target_language,
           j.status,j.completed_pages,j.total_pages,j.created_at,j.updated_at
      FROM translation_jobs j
     WHERE NOT EXISTS (SELECT 1 FROM translation_run_jobs rj WHERE rj.job_id=j.id)
)
'''

# ``page_count IS NOT NULL`` is the deployed paper/study discriminator: study
# owners have no PDF byte claim at all.  ``document_trash`` holds the recoverable
# removal marker; purged documents no longer have a row.  A changed source hash
# means the record's authorization no longer matches the actual library item.
OWNER = '''
FROM entries e
JOIN documents d ON d.id=e.document_id
JOIN document_metadata m ON m.document_id=d.id
WHERE d.page_count IS NOT NULL
  AND d.sha256 IS NOT NULL
  AND d.sha256=e.source_sha256
  AND NOT EXISTS (SELECT 1 FROM document_trash t WHERE t.document_id=d.id)
  AND (?='' OR m.title LIKE ? ESCAPE '\\')
'''

PAGE = ('SELECT e.kind,e.id,e.document_id,e.source_sha256,m.title AS title,'
        'e.target_language,e.pages_json,e.status,e.completed_pages,e.total_pages,'
        'e.created_at,e.updated_at' + OWNER +
        ' ORDER BY e.created_at DESC,e.id DESC,e.kind LIMIT ? OFFSET ?')
TOTAL = ENTRIES + 'SELECT COUNT(*)' + OWNER


def like_pattern(query):
    """Literal, parameterized title search (no caller-supplied SQL)."""
    escaped = (query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_'))
    return f'%{escaped}%'


def item(row):
    return {'kind': row['kind'], 'id': row['id'], 'document_id': row['document_id'],
            'source_sha256': row['source_sha256'], 'title': row['title'],
            'target_language': row['target_language'],
            'pages': json.loads(row['pages_json']), 'status': row['status'],
            'completed_pages': row['completed_pages'],
            'total_pages': row['total_pages'],
            'created_at': row['created_at'], 'updated_at': row['updated_at']}


class TranslationLibrary:
    """Per-Store translation history reads for exactly the current owner."""

    def __init__(self, store):
        self.store = store

    def list(self, limit=DEFAULT_LIMIT, offset=0, query=''):
        limit = max(1, min(int(limit), MAX_LIMIT))
        offset = max(0, min(int(offset), MAX_OFFSET))
        query = (query or '').strip()
        if len(query) > MAX_QUERY:
            raise WorkspaceError('invalid_query', '搜索词过长，请缩短后重试。', 422)
        pattern = like_pattern(query) if query else ''
        with self.store.connection() as connection:
            # One deferred read transaction keeps the page and its total
            # consistent.  No write, receipt or cursor is created by a read.
            if not connection.in_transaction:
                connection.execute('BEGIN')
            total = connection.execute(TOTAL, (query, pattern)).fetchone()[0]
            rows = connection.execute(
                ENTRIES + PAGE, (query, pattern, limit, offset)).fetchall()
        return {'items': [item(row) for row in rows], 'total': int(total),
                'limit': limit, 'offset': offset}
