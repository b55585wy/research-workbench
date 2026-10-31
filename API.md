# Reader and source-linked notes: original contract preserved through v0.12

Reviewed .sav/.zsav imports and additive schema10 are documented in [DATA-IMPORTS.md](DATA-IMPORTS.md).

This slice is a single-user local application. The default listener is 127.0.0.1;
no account/shared-space or remote-access readiness is claimed. Data lives under
RESEARCH_WORKBENCH_DATA, default ./data. No tFUS imports or database access.

## Browser/API contract

All endpoints are same-origin. Errors: {"detail":{"code":"...","message":"..."}}.
UUIDs are canonical UUID strings. Times are UTC ISO 8601. JSON is UTF-8.

- GET /api/v1/health -> {"status":"ok","version":"0.12.0"}.
- GET /api/v1/documents/{doc}/analyses/{id}/notebook -> verified deterministic
  application/x-ipynb+json, attachment, no-store, <=1MiB. Only succeeded jobs;
  incomplete ->409 analysis_not_complete, output drift ->409
  analysis_output_changed, oversized ->413 notebook_too_large. Full v0.7
  projection/export and optional active_analysis_id contract: [NOTEBOOK-VIEW.md](NOTEBOOK-VIEW.md).
- GET /api/v1/documents -> {"items":[document,...]}, newest first.
- POST /api/v1/documents: multipart field `file`, PDF only, up to 20 MiB,
  1–200 pages, unencrypted. Respond 201 with document. PDF validation runs in a
  separate bounded child process; it is not a general security sandbox.
- GET /api/v1/documents/{id} -> document; missing -> 404.
- GET /api/v1/documents/{id}/file -> original PDF bytes; missing file -> 409.
- GET /api/v1/documents/{id}/notes -> {"items":[note,...]}, newest first.
- POST /api/v1/documents/{id}/notes: JSON as below; return 201 with note, or 200
  with the SAME note after retrying the same request_id and identical content.
  Reusing a request_id with different content/document returns 409.
- GET /assets/sample.pdf -> two-page synthetic reading fixture, clearly labelled.

Document: id, title, original_filename, page_count, byte_size, sha256, created_at.
Note: id, document_id, page, rect, text, created_at. Note id equals request_id.

Note creation: {"request_id":"UUID","page":1,"rect":[0.1,0.2,0.6,0.4],"text":"..."}.
v0.8 additionally accepts optional rich_content, a validated version1 Quill text
Delta matching text. Six-field note JSON stays unchanged; state APIs add optional
rich_content/server-derived rich_html from the same joined snapshot. Full format,
limits, PATCH/null semantics, atomicity and retries: [RICH-NOTES.md](RICH-NOTES.md).
page is a strict integer within the stored document page count. rect is optional
(null means whole-page reference). Its four finite numbers are [left, top, right,
bottom], relative to the displayed page at its PDF-defined rotation, each in
[0,1], with positive width and height. Neither browser zoom nor CSS canvas size
is stored. Rendering always uses the PDF's intrinsic page rotation, no user
rotation control in v0.1. Text is trimmed, nonempty, at most 10,000 characters.
Unknown fields and invalid inputs -> 422. No HTML interpretation of titles/notes.

Expected error codes: invalid_pdf, encrypted_pdf, page_limit, file_too_large,
parser_busy, parser_timeout, not_found, file_missing, invalid_page,
idempotency_conflict, validation_error, storage_unavailable, local_only,
origin_rejected, parser_failed, parser_unavailable. Do not expose OS paths or raw
exceptions in the UI.

## Frontend integration

Files: frontend/index.html, styles.css, app.js (Kimi-owned). Root supplies
frontend/theme-tokens.css, /assets/sample.pdf and local PDF.js assets under
/vendor/pdfjs/{build/pdf.mjs,build/pdf.worker.mjs,cmaps/,standard_fonts/,wasm/}.
Use native module imports and PDF.js getDocument, getPage, render. The worker,
CMaps, fonts and WASM must use those same-origin paths. No iframe or CDN.

Use ?document=UUID&note=UUID for a reopenable source link. Reloading and a fresh
browser context must recover persisted notes from API. A note click opens its
document/page and visibly highlights its rectangle, including after resizing or
zooming. A page-only note remains possible with keyboard/touch.

Protect against stale asynchronous document/render/notes requests. A save belongs
to the document and anchor captured when submitted, even if the user navigates.
Preserve unsaved drafts per document; changing pages does not silently retarget
the draft. A failed or uncertain save keeps its text/anchor/request_id for retry;
only confirmed success clears it. Render plain notes using textContent; optional
rich HTML uses the strict DOMPurify boundary described in RICH-NOTES.md.

Use a single PDF page canvas with capped pixel allocation, fit-to-width plus
zoom, accessible previous/next/page controls, clear load/save/failure states.
Cancelling an old PDF render is normal and must not display a false failure.

v0.2 adds separate excerpt and export endpoints without changing document/notes
JSON. See [EXCERPTS-AND-EXPORT.md](EXCERPTS-AND-EXPORT.md).


v0.3 returns current text and active notes through the same six-field note JSON.
Creation retries compare original immutable input and never overwrite edits or
restore deleted notes. Separate versioned note-state, edit, delete and restore
endpoints are specified in [NOTE-REVISION-AND-REVIEW.md](NOTE-REVISION-AND-REVIEW.md).


v0.4 adds opt-in multipart deduplication, bibliographic metadata and bounded
local library/note search. Legacy upload behavior and document JSON keys remain
compatible; saved metadata supplies the effective title. See
[LIBRARY-AND-SEARCH.md](LIBRARY-AND-SEARCH.md).

v0.5 adds image library/image-note endpoints and an independent bounded reading
Agent. Existing note/document responses remain compatible. Concrete proposals
require explicit confirmation; no arbitrary scripts, URLs or authenticated actor
claims are accepted. See [AGENT-AND-IMAGES.md](AGENT-AND-IMAGES.md).

v0.6 adds immutable CSV/TSV datasets, fixed descriptive Python/R jobs in an
independent worker, actual result/log/export endpoints and confirmed Agent
analysis tools. ReadingContext adds optional dataset_id; absent/null preserves
v0.5 request hash semantics for exact retries. See [ANALYSIS.md](ANALYSIS.md).
# v0.9 source-bound image annotations

v0.10 adds `/api/v1/charts/capabilities` and document-scoped chart preview,
save/list/read/data/delete/restore/export endpoints. Closed typed parameters,
hash-bound source/recipe/renderer and exact request receipts apply. The full
contract and limits are in [CHARTS.md](CHARTS.md). Schema9 adds charts and
chart_operations; all19 original tables remain unchanged. No authentication API
is introduced, and local workflow origin fields are not authenticated actors.

Prefix: `/api/v1/documents/{document_id}/image-sources/{source_kind}/{source_id}`.
source_kind is user_upload or pdf_excerpt, IDs are UUIDs.

- GET prefix returns `{source,items}` including recoverable deleted annotations.
- GET prefix/frame returns exact verified preview/PNG bytes, no-store and SHA header.
- POST prefix/annotations: request_id, source_sha256, frame_sha256, rect, text.
- PATCH prefix/annotations/{id}: same hashes, request_id, expected_revision and
  at least one non-null rect/text field.
- DELETE same and POST same/restore: request_id, hashes, expected_revision.

Image rect is normalized frame `[left,top,right,bottom]`, finite numeric values
0..1 with positive area, never PDF coordinates. Text is plain, trimmed 1..2000
characters without NUL. Server owns origin. Exact retries return current matching
receipts; changed payload or stale revision fails with409. Missing/changed source
fails closed. Limits include trash:100/source,500/document. Excerpt parent deletion
hides the source, restoration recovers its unchanged annotations.

Schema8 adds image_annotations and image_annotation_operations (19 tables total).
Original17 tables and six-field PDF note wire format remain intact. The optional
active_image Agent context is omitted from old submission fingerprints when absent.

# v0.11 statistical methods

GET /api/v1/analysis/methods discovers describe and the optionally configured
ttest_independent method. GET /api/v1/analysis/recipes/r?method=ttest_independent
returns exact fixed R code/version/hash. The ordinary recipe URL stays descriptive.

POST /api/v1/documents/{document_id}/analyses/ttest/groups accepts dataset_id,
dataset_sha256,group_column and returns exactly two nonempty group labels/counts.
POST .../analyses/ttest/preview accepts the new analysis payload and validates full
data without computing p values or writing jobs. It reports total/used/excluded,
disjoint empty-outcome/empty-group/both counts, group summaries and warnings.

POST .../analyses remains the actual queue entry. New method fields: method=
ttest_independent,engine=r,columns=[one numeric outcome],library_sha256 and ttest={
group_column,groups:[group1,group2],variant:student|welch,alternative:two_sided|less|
greater,confidence:0.5..0.999,missing:complete_cases,independent_samples_confirmed:true}.
Existing request_id,dataset_id,dataset_sha256,recipe_sha256 remain required.
Old describe requests strip optional defaults before storage/hash, preserving retries.

Saved result.test contains statistic,df,p_value,difference,standard_error and CI,
including explicit null/unbounded flags for single-sided intervals. Contrast is
group1 minus group2. Source/code/component drift fails closed; no arbitrary script,
library path, remote data or SPSS commands are accepted. Existing cancel/log/files/
Notebook/export work with both methods. Agent tools: analysis_methods,
read_t_test_groups,preview_t_test,propose_t_test,propose_analysis_cancel; writes
require explicit proposal confirmation. See STATISTICAL-TESTS.md.

## v0.13 opt-in task continuation

AgentSubmission adds strict boolean continue_task (default false, excluded from
legacy false fingerprints). Document-scoped Agent tasks list/read/control endpoints
persist a bounded analysis -> chart -> source-note checkpoint. Every write still
uses the existing concrete proposal confirmation. Stop/resume controls use frozen
UUID receipts and expected_generation; stage/revision/source guards prevent late
callbacks or retries from duplicating business operations. Restart pauses active
tasks. Schema11 adds exactly two tables. Full fields, states and errors:
[AGENT-TASKS.md](AGENT-TASKS.md).

