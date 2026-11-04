"""Additive schema and frozen request DTOs for continuous translation runs.

Schema 27 adds four relations only.  No existing table, row, receipt or hash is
altered, and the legacy ``translation_jobs`` five-page CHECK stays exactly as
deployed.  A run owns an explicitly authorized page list; each child still uses
the existing one-to-five-page translation job so dense five-page batches cannot
exhaust the existing eight-call budget.
"""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator

MAX_RUN_PAGES = 200
TARGET_LANGUAGES = ('zh', 'en')
RUN_STATUSES = ('queued', 'running', 'paused', 'completed', 'partial', 'failed', 'interrupted')
RUN_STAGES = ('queued', 'parsing', 'translating', 'finished')
CONTROL_ACTIONS = ('pause', 'resume')

SCHEMA = '''
CREATE TABLE IF NOT EXISTS translation_runs (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
 pages_json TEXT NOT NULL CHECK(json_valid(pages_json) AND json_type(pages_json)='array'
  AND json_array_length(pages_json) BETWEEN 1 AND 200),
 target_language TEXT NOT NULL CHECK(target_language IN ('zh','en')),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 status TEXT NOT NULL CHECK(status IN ('queued','running','paused','completed','partial','failed','interrupted')),
 stage TEXT NOT NULL CHECK(stage IN ('queued','parsing','translating','finished')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 total_pages INTEGER NOT NULL CHECK(typeof(total_pages)='integer' AND total_pages BETWEEN 1 AND 200),
 processed_pages INTEGER NOT NULL DEFAULT 0 CHECK(typeof(processed_pages)='integer' AND processed_pages BETWEEN 0 AND 200),
 completed_pages INTEGER NOT NULL DEFAULT 0 CHECK(typeof(completed_pages)='integer' AND completed_pages BETWEEN 0 AND 200),
 reused_pages INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reused_pages)='integer' AND reused_pages BETWEEN 0 AND 200),
 active_job_id TEXT REFERENCES translation_jobs(id),
 parser_id TEXT NOT NULL,parser_version TEXT NOT NULL,
 prompt_version TEXT NOT NULL,result_schema_version INTEGER NOT NULL,
 model_name TEXT NOT NULL,model_fingerprint TEXT NOT NULL,
 error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(processed_pages<=total_pages AND completed_pages<=processed_pages AND reused_pages<=processed_pages)
);
CREATE INDEX IF NOT EXISTS translation_runs_document_created ON translation_runs(document_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS translation_runs_status ON translation_runs(status,created_at);
CREATE TABLE IF NOT EXISTS translation_run_jobs (
 run_id TEXT NOT NULL REFERENCES translation_runs(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL REFERENCES translation_jobs(id) ON DELETE CASCADE,
 page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 200),
 attempt_revision INTEGER NOT NULL CHECK(typeof(attempt_revision)='integer' AND attempt_revision>=1),
 reused INTEGER NOT NULL CHECK(reused IN (0,1)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(run_id,job_id)
);
CREATE INDEX IF NOT EXISTS translation_run_jobs_job ON translation_run_jobs(job_id);
CREATE TABLE IF NOT EXISTS translation_run_pages (
 run_id TEXT NOT NULL REFERENCES translation_runs(id) ON DELETE CASCADE,
 page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 200),
 job_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('completed','unavailable','failed')),
 reused INTEGER NOT NULL CHECK(reused IN (0,1)),
 mapped_at TEXT NOT NULL,
 PRIMARY KEY(run_id,page),
 FOREIGN KEY(job_id,page) REFERENCES translation_pages(job_id,page) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS translation_run_pages_job ON translation_run_pages(job_id);
CREATE TABLE IF NOT EXISTS translation_run_operations (
 request_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES translation_runs(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK(action IN ('pause','resume')),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL
);
'''


class TranslationRunCreate(BaseModel):
    """Explicit whole-document-range authorization; no model configuration."""

    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    pages: list[StrictInt] = Field(min_length=1, max_length=MAX_RUN_PAGES)
    target_language: Literal['zh', 'en']
    confirmed: StrictBool

    @field_validator('pages')
    @classmethod
    def canonical_pages(cls, value):
        if any(page < 1 or page > MAX_RUN_PAGES for page in value):
            raise ValueError('Pages must be within the document page bound')
        if len(set(value)) != len(value):
            raise ValueError('Pages must be distinct')
        return sorted(value)

    @field_validator('confirmed')
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError('Explicit confirmation is required')
        return value


class TranslationRunControl(BaseModel):
    """Frozen pause/resume control receipt; the revision is a control version."""

    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    expected_revision: StrictInt = Field(gt=0)
    confirmed: StrictBool

    @field_validator('confirmed')
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError('Explicit confirmation is required')
        return value
