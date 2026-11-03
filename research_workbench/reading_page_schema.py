"""Additive schema for model-free paragraph reading, version 24.

One row per document page: the parsed source flow for the active source.  Rows
are additive and deletable; no existing table is altered or rebuilt, and the
reading flow never writes into translation tables.
"""

SCHEMA = '''
CREATE TABLE IF NOT EXISTS reading_pages (
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 200),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
 parser_id TEXT NOT NULL,parser_version TEXT NOT NULL,
 result_schema_version INTEGER NOT NULL CHECK(result_schema_version=1),
 status TEXT NOT NULL CHECK(status IN ('completed','partial','unavailable')),
 warning TEXT,
 blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(document_id,page)
);
CREATE INDEX IF NOT EXISTS reading_pages_source ON reading_pages(document_id,source_sha256);
'''
