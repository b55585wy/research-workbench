"""Append-only reusable chart recipes for one workspace database.

Version 29 is additive only.  A skill is created once and every later edit is a
new immutable version row; no existing table, row, receipt or hash is rewritten.
The two tables live in the same workspace SQLite file as the chart records so a
guest/owner workspace can never see another workspace's recipes.
"""
SCHEMA = '''
CREATE TABLE IF NOT EXISTS chart_skills (
 id TEXT PRIMARY KEY,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chart_skill_versions (
 skill_id TEXT NOT NULL REFERENCES chart_skills(id),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 100),
 request_id TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(skill_id,revision)
);
CREATE INDEX IF NOT EXISTS chart_skill_versions_latest
 ON chart_skill_versions(updated_at DESC,skill_id DESC);
'''
