"""Additive schema for local selected-page translation, version 23."""

SCHEMA = '''
CREATE TABLE IF NOT EXISTS translation_jobs (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 target_language TEXT NOT NULL CHECK(target_language IN ('zh','en')),
 pages_json TEXT NOT NULL CHECK(json_valid(pages_json)),
 request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','completed','partial','failed','cancelled','interrupted')),
 stage TEXT NOT NULL CHECK(stage IN ('queued','parsing','translating','finished')),
 parser_id TEXT NOT NULL,parser_version TEXT NOT NULL,prompt_version TEXT NOT NULL,
 result_schema_version INTEGER NOT NULL,model_name TEXT NOT NULL,model_fingerprint TEXT NOT NULL,
 completed_pages INTEGER NOT NULL DEFAULT 0 CHECK(completed_pages BETWEEN 0 AND 5),
 total_pages INTEGER NOT NULL CHECK(total_pages BETWEEN 1 AND 5),
 error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
 created_at TEXT NOT NULL,started_at TEXT,updated_at TEXT NOT NULL,finished_at TEXT
);
CREATE INDEX IF NOT EXISTS translation_document_created ON translation_jobs(document_id,created_at DESC);
CREATE INDEX IF NOT EXISTS translation_pending ON translation_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS translation_pages (
 job_id TEXT NOT NULL REFERENCES translation_jobs(id) ON DELETE CASCADE,
 page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 200),
 status TEXT NOT NULL CHECK(status IN ('completed','unavailable','failed')),
 warning TEXT,blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)),
 PRIMARY KEY(job_id,page)
);
'''
