# v0.44 local guest / first React view slice

No business API, schema, authentication, grant or ownership changes. The local guest
badge identifies existing unverified single-machine use; no account/token/user_id
endpoint or credential is introduced. React receives catalogue snapshots and host
callbacks; actual selection uses the existing guarded document navigation. Native
PDF/note/Agent/analysis controllers and source routes remain. See REACT-GUEST.md.
Full-app embedding/API base-path adaptation is not claimed by this first view slice.

# v0.43 safe answer rendering and image-region preview

No API, schema, grants, source identities or analysis changes. Local browser rendering uses
markdown-it/texmath/KaTeX/DOMPurify. R-marked Markdown links resolve through server Source
records, never model-provided hrefs. Original-owner source routing and table CSV/TSV
provenance/limits remain. Image menu preview uses its existing normalized object rectangle;
it creates no note, draft or persistence operation. See CHAT-MARKDOWN.md.
No tests, syntax/import/build/browser/HTTP/model checks were run at the user's request.

# v0.42 frontend organization and paper-association feedback

No new API or schema. POST /api/v1/studies/{id}/papers still accepts {document_id,sha256}
and returns the exact paper record with201/200. Personal My data is not a project:
personal_workspace_not_project remains409; backend rejection is unchanged. Frontend now
explains this and other association errors, guards known personal-owner callbacks and
validates returned paper identity before updating its list. Retry retains the original
owner/paper/version rather than silently using a different selection. See DATA-WORKSPACE-CLARITY.md.

# v0.41 explicit referenced-dataset descriptive analysis

Dataset resource_refs additionally accepts strict optional allow_analysis:true. False/default is
omitted during nested serialization and capture to preserve older request fingerprints. Papers
reject this field. The grant is captured with that turn; catalogue/project membership never grants it.

Four tools require the captured grant and original owner/dataset/version checks:
- reference_analysis_capabilities(document_id,dataset_id): actual numeric-column metadata and Python/R availability.
- propose_reference_analysis(document_id,dataset_id,engine,columns): fixed describe; 1..20 unique numeric columns.
- list_reference_analyses(document_id,dataset_id): newest <=20 describe records, metadata/status only.
- read_reference_analysis(document_id,dataset_id,analysis_id): succeeded saved summary only; verifies actual
  summary.json bytes, size/SHA and saved JSON; returns <=20 stats with total/returned/truncated flags.

New closed proposal kind run_reference_analysis retains current-chat document_id/source_sha256;
adds server-derived target_document_id,target_source_sha256,target_title,dataset_id,dataset_sha256,
dataset_name,engine,columns,method:'describe',recipe_sha256,recipe_id,recipe_version. Confirmation
rechecks that persisted turn grant plus both owners/versions and recipe, then queues one existing
worker job in TARGET owner with the deterministic proposal request UUID. No computation before approval.
Applied/rejected replay remains idempotent. Receipt: {document_id:TARGET,analysis_id,dataset_id,status,url}.
Queued/running does not mean succeeded. Confirming does not automatically navigate away from chat.

Source kind reference_analysis_result carries original document_id,analysis_id,dataset_id,
dataset_sha256,source_sha256(owner),result_sha256(summary),page:null,rect:null,title,label,text,url.
Actual summary source text <=24000 chars; original URL /?document=OWNER&analysis=JOB. Publication
rechecks source/grant/result SHA; historical references require a fresh verified read. No broadened
Sources.get, arbitrary scripts, cross-owner notes/charts/cancel, new statistical method or continuous tasks.
Schema22 is a compatibility marker only; no added/altered tables. See REFERENCE-ANALYSIS.md.
No tests, browser/HTTP/model probes or imports/syntax checks were run in this increment.

# v0.40 non-owning project resource associations

All new endpoints use /api/v1/studies/{study_id}; only normal projects, excluding
the personal My data owner and PDF owners. Existing owner IDs/records are unchanged.

- GET /resources -> {items:[link]} (<=100), saved metadata/version/lifecycle only.
  Unavailable sources remain listed/removable. No file reads or supervisors on GET.
- GET /resource-candidates?kind=dataset|analysis|chart&q=...&limit=1..50&cursor=...
  -> {items,next_cursor}; metadata search, q<=200, cursor<=2048, newest-first.
  Analysis candidates require succeeded status and a saved summary.json identity.
- POST /resources accepts exact {request_id,kind,document_id,resource_id,
  source_sha256,owner_sha256}. All IDs UUID; hashes lowercase64hex. New201, repeat200.
  Actual owner/bytes/source version is verified without running a supervisor or calculation.
  Link labels are resolved server-side; source ownership/files are never changed/copied.
- DELETE /resources/{link_id} accepts exact {request_id,source_sha256}; returns
  {id,removed}. Expected hash is the saved link version, so broken sources can be unlinked.

ResourceItem fields: id,study_id,kind,document_id,resource_id,source_sha256,owner_sha256,
title,owner_title,owner_kind,created_at,available,unavailable_reason,url.
Candidate omits link-only fields and carries the actual source version required by POST.
URLs target the original document_id. No raw profiles/results/logs/storage paths are returned.
Receipts are immutable by request UUID+canonical payload+project/action, with409 on conflicts;
old Add replay cannot resurrect a removed link. Client always reloads authoritative list.
Schema21 adds project_resources and project_resource_operations only. Only the targetproject
has an FK; original source IDs intentionally permit unavailable references after source purge.
Existing Agent grants, continuous tasks, analysis ownership and paper association APIs stay intact.
See PROJECT-RESOURCES.md. No functional, browser or model tests were run this increment.

# v0.39 explicit cross-project Agent references

ReadingContext.resource_refs is optional, at most8 unique closed references:
paper {kind:"paper",document_id,sha256}; dataset {kind:"dataset",document_id,dataset_id,sha256}.
IDs are UUIDs and hashes lowercase SHA256. Empty lists are omitted during compatible serialization,
preserving old submission fingerprints. Server captures actual owner and source identity; stale,
deleted, trashed, forged or changed references fail rather than retargeting.
GET /api/v1/agent/reference-catalog accepts kind=paper|dataset, q<=200, limit1..50(default20),
cursor<=2048; returns {items,next_cursor}. Metadata only, with real owner ID, title and hash.
The four read tools search_reference_materials, list_references, read_reference_paper and
read_reference_dataset discover metadata or read only captured references. PDF reads share the
existing page budget. Dataset sample is bounded to5 rows/20 columns and reports truncation.
The actual serialized sample text is capped at12000 characters per sample and24000 across a turn;
repeated reads of the same document/dataset/hash reuse one captured source and sample.
New source kinds reference_pdf_page and reference_dataset_sample use original owner URLs.
Foreign reads do not expand current-owner write/proposal authority. Cross-reference contexts
cannot start/resume continuous tasks in this increment. No new schema/table or arbitrary execution.
See AGENT-REFERENCES.md. No tests or model calls were run.

# v0.38 independent workspace entrances

GET /api/v1/data-workspace/personal -> {owner:null|record}, read-only.
POST /api/v1/data-workspace/personal accepts exact {}; creates singleton201 or returns same owner200.
Owner remains kind=study with workspace_role=personal_analysis; old owners have no added role field.
Schema20 adds personal_analysis_owner singleton marker only. Startup does not create an owner.
The personal owner is excluded from project lists/search/quota and cannot link/unlink papers.
GET /api/v1/data-workspace/catalog?kind=dataset|analysis|chart&limit=1..100&q=...&cursor=...
returns metadata items and next_cursor. Active real owners, dataset hashes/job status/chart revision,
stable newest-first pagination and query-bound cursors; no profiles/results/files or supervisors.
Existing source identities, URLs, owner-bound datasets/jobs/charts, local boundary and proposals remain.
See WORKSPACE-ENTRIES.md. No functional tests were run.

# v0.37 line, ellipse and freehand PDF annotations

shape_annotation additionally accepts exact input keys kind, color, line_width,
points. New kind is line, ellipse or ink; colors and strict integer line widths
1–4 reuse the existing shape palette. Line/ellipse require exactly 2 normalized
finite points; ink requires 2–512 points with at least two distinct positions.
Line permits horizontal/vertical geometry; ellipse has positive width and height.
Closed ink strokes are valid. Bounds for ink use every point; degenerate path axes
are padded only for the projected source rectangle. Paths are never reordered.
Existing kinds, request routes, source hashes, receipts and immutable creation
records remain unchanged. schema19 is a compatibility marker, with no new table.
PDF export emits Line, Circle and Ink annotations with explicit vector appearances;
the existing export budgets additionally limit total shape points to 16384.
New shapes support the same saved-state screenshot references and note lifecycle.
No functional or visual tests were run. See READER-DRAWING.md.

# v0.36 PDF textbox annotations

The existing shape_annotation input additionally accepts the closed textbox type:
`{kind:"textbox",color:"black"|"blue"|"green"|"red",font_size:8..48,points:[[x1,y1],[x2,y2]]}`.
Font size is a strict integer in PDF user-space units. No line_width, source SHA
or second text field is accepted. note.text remains the sole body (nonblank, at
most 2000 Unicode codepoints for textbox; existing note types unchanged). Geometry
is a positive-area normalized display rectangle; normal note routes, request
receipts, revisions, source guards, undo and purge remain unchanged. Old shape
models and serialized payloads retain their prior field sets.
Schema18 is a compatibility version marker without new tables or destructive
migration. Text/font size/geometry changes reset source review.
Annotated PDF uses FreeText with full Unicode Contents and a bounded RGB raster
appearance from an installed CJK font. textbox_font_unavailable and textbox_overflow
are explicit export failures; normal PDF resource limits also apply. Browser and
server font measurements can differ across platforms. See READER-TEXTBOX.md.
No functional or visual tests were run in this increment.

# v0.35 PDF shape annotations

Additive schema17 adds `note_shape_annotations` with immutable original and mutable
current JSON. Existing POST notes and PATCH `/api/v1/documents/{doc}/notes/{note}`
accept optional `shape_annotation` (GET `/state` remains read-only):
`{kind:"rectangle"|"arrow",color:"yellow"|"green"|"blue"|"pink",line_width:1|2|3|4,points:[[x1,y1],[x2,y2]]}`.
Exactly two finite normalized display coordinates; rectangle needs positive area,
arrow keeps endpoint order and accepts horizontal/vertical lines. Degenerate arrow
bounds are padded by 0.0005 per side and clipped to the page. Create derives null
rect or checks supplied bounds; PDF page and text required, study source/text
annotation cannot coexist. PATCH preserves kind; explicit null is rejected.
Detailed state adds server-owned source_sha256 and projects current rect. Stored
notes.rect remains the immutable creation bounds; request receipts/revisions stay
unchanged. Omitted shape fields preserve legacy serialized request hashes.
Shape notes cannot use legacy note-linked excerpts: `shape_annotation_excerpt_unsupported`.
Sharing creates a separate frozen annotated PNG; source link records document,
page, crop, source hash, shape note and captured revision. Existing draft/send and
rich-note save boundaries apply. Annotated PDF and reading exports include saved
shape geometry/style. See [READER-SHAPES.md](READER-SHAPES.md).
This increment received static source review only; no functional tests were run.

# v0.34 read-only PDF table regions

`GET /api/v1/documents/{identifier}/pages/{page}/regions` returns
`{document_id,page,source_sha256,coordinate_space:"display-normalized",items,limited_to:"ruled-tables"}`.
Each item is `{id:"table-N",kind:"table",rect:[left,top,right,bottom]}` relative to
the displayed PDF crop at intrinsic rotation, with finite 0..1 coordinates.
Empty results are valid; unsupported geometry may include `unavailable_reason`.
This local read-only endpoint adds no schema or model calls. Busy/timeout/unavailable
and parse failures use the existing error envelope. See [READER-OBJECTS.md](READER-OBJECTS.md).
Functional validation for this increment was skipped at the user's explicit request.

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



## v0.14 two-group observations

ChartCreate.kind adds grouped_points with existing x/y fields: exact group x,
distinct numeric y, null bins/analysis_id. Artifact series remains x/y/rows;
summary adds ordered groups(label,count) and three disjoint missing counts.
Exactly two complete groups, label<=200Unicode characters without C0/C1 controls.
Preview, explicit confirmation, hashes, lifecycle and old request fingerprints
retain their semantics. Invalid groups/labels return invalid_grouped_points_data.
No schema change. Full contract: [GROUPED-OBSERVATIONS.md](GROUPED-OBSERVATIONS.md).


## v0.15 Dataset selections

GET `/api/v1/dataset-selections/capabilities` returns fixed recipe SHA and limits.
POST `/api/v1/documents/{doc}/dataset-selections/values` accepts dataset_id, dataset_sha256,
column, optional query/offset/limit (50 max). Read-only raw value counts, paginated.
POST same prefix `/preview` accepts dataset_id, dataset_sha256, column, exact string
value, optional name and recipe_sha256. Returns saved:false, source, condition,
counts, sample (5 rows/200 chars per cell), columns, recipe, result/source_rows and
preview SHA-256. Zero hits allowed in preview only.
POST prefix accepts the same fields plus request_id and preview_sha256;201 new,200
exact replay. Returns normal dataset record with selection_provenance.409 drift,
quota or conflicting retry;422 invalid/empty;429 busy;503 storage unavailable.
GET `/documents/{doc}/datasets/{id}/selection` returns verified lineage steps,
immediate-parent 1-based source_rows and calculation_sources. Existing dataset
file/analysis/chart endpoints consume selected tables. Schema12 adds only one
table. Agent uses dataset_values, preview_dataset_selection, propose_dataset_selection;
new child requires fresh explicit sharing, continuous tasks cannot retarget.
See [behavior and integrity contract](DATASET-SELECTION.md).


## v0.16 research record export

Prefix `/api/v1/documents/{doc}/research-records`. GET `/options` requires dataset_id
and dataset_sha256; returns succeeded same-source analyses, active charts, reading
counts and128MiB expanded-byte limit. POST `/preview` accepts strict dataset_id,
dataset_sha256, optional analysis_id/chart_id (null), include_reading (strict bool,
defaulttrue). Returns saved:false, spec, scope summaries, preview_sha256 and frozen
download_url. No ZIP or database write. GET `/download?token=...` revalidates scope,
streams original component artifacts into one ZIP and checks final scope again.
Token is canonical bounded version1 JSON/base64url, not authentication.409 drift,
scope/result mismatch or corruption;413 expanded limit;429 busy;422 malformed;
503 storage unavailable. Existing ExportResponse removes temporary ZIP even on
disconnect. No schema change. Agent prepare_research_record requires explicit
dataset sharing, returns summary and a research_record source for human review.
Full scope, resource and offline behavior: [RESEARCH-RECORD.md](RESEARCH-RECORD.md).

## v0.17 data-first study

Explicit paperless owners use POST/GET /api/v1/studies; papers have separate,
hash-bound association endpoints. Existing owned data/result/note routes accept
study IDs without creating a PDF. Null-page notes require typed source anchors;
PDF APIs retain their old shapes and reject study page/file operations.
Contract, limits and schema13 migration: [DATA-FIRST-STUDY.md](DATA-FIRST-STUDY.md).

## v0.18 opt-in unified search

GET /api/v1/search adds include_studies=true for saved study names/questions and
active null-page study notes. Default/false preserves legacy response keys and
PDF-only results. One read snapshot, bounded literal casefold matching, no model
invocation or writes. Full fields and scope: [UNIFIED-SEARCH.md](UNIFIED-SEARCH.md).

## v0.19 paired t-test

AnalysisCreate adds method=ttest_paired and mutually exclusive paired options.
POST .../analyses/paired/preview validates explicit unique unit ID plus two ordered
numeric columns and reports complete/excluded pairs without job/p values. Runs
use the existing confirmed analyses endpoint; old payload serialization and recipes
remain exact. New Agent tools preview_paired_t_test/propose_paired_t_test and
run_paired_t_test proposal retain source hashes and explicit confirmations.
Full fields/result/artifacts: [PAIRED-T-TEST.md](PAIRED-T-TEST.md).


v0.21 adds recoverable paper trash and confirmed note-content purge, with strict
versioned idempotent requests. Original document/note JSON and methods remain
compatible; trash/purge responses and schema14 are in [READER-LIBRARY.md](READER-LIBRARY.md).


v0.22 adds optional note annotation/annotation_style and Agent context.note_refs;
empty/absent refs preserve prior serialized request hashes. Schema15 adds a single
annotation table. Full shape and limits: [TEXT-ANNOTATIONS.md](TEXT-ANNOTATIONS.md).


## v0.23 client-side reading tools

No new HTTP fields/endpoints or migration. PDF find uses the existing locally
loaded PDF.js document; filters use saved note states; batch insertion uses the
unchanged context.note_refs contract. Continuous pages keep the actual active
page/selection in the existing reading context. See [READING-TOOLS.md](READING-TOOLS.md).


## v0.24 browser-local reading progress

No server API or schema changes (schema15). Browser-local version1 preferences are bound to document UUID and original SHA256; strict bounded page/normalized center fields contain no research text. Explicit sources outrank progress. See [READING-PROGRESS.md](READING-PROGRESS.md). Health version is 0.24.0.


## v0.25 annotated PDF derivative

GET `/api/v1/documents/{id}/export/annotated.pdf` -> application/pdf attachment, no-store. Server resolves active saved notes in one read transaction; no request body or research-record write. Highlight/underline retain quads/colors/quote/comment, region notes are Square annotations, page notes are Text comments. Original PDF/old ZIP are preserved.

One concurrent generator,20-second timeout,512MiB child memory limit; source<=20MiB/200pages,<=1000notes/16384rectangles,<=8MiB UTF8 snapshot, output<=64MiB. Codes: pdf_export_empty409; pdf_export_invalid409; pdf_export_too_large413; pdf_export_busy429; pdf_export_timeout422; pdf_export_failed422; pdf_export_unavailable503. Existing file_missing/source_changed/document_trashed/not_found/source_has_no_pdf and structured storage errors remain. No partial output; request-owned temporary files removed after response/disconnect/failure. Schema15/31tables unchanged. Health version0.25.0. See [ANNOTATED-PDF.md](ANNOTATED-PDF.md).


## v0.26 generic study-paper reading and table messages

No new HTTP endpoints, outgoing request fields or schema changes. A study turn captures associated_papers metadata (up to20 existing links). list_study_papers returns that directory; read_study_paper(document_id,page,page_count) reads1–4 actual associated PDF pages,<=4000chars/page, checking the captured SHA and current association before/after. Associated page refs have kind=associated_pdf_page and their actual document_id/page/source_sha256. Historical paper sources are reused only while still associated/version-valid and bounded to8pages/24000chars; old turn-local R refs are remapped before model context reuse. Cross-paper refs do not become study-note write anchors. Existing confirmation/sharing/request hashes remain. Health version0.26.0; schema15/31tables. See [AGENT-READING.md](AGENT-READING.md).


## v0.27 correlation in existing analysis jobs

AnalysisCreate accepts additive method=correlation with engine=r, exactly2numeric columns, correlation={kind:pearson|spearman,alternative,confidence,missing:complete_pairs,independent_pairs_confirmed:true}, and verified library_sha256. Pearson requires confidence0.5–0.999; Spearman requires null and uses asymptotic p. POST .../analyses/correlation/preview returns complete-pair counts/stats/ties and code/library without a job or p value. Original .../analyses performs approved execution; recipe id=correlation-rstats-v1. Result.test has actual estimate/r-or-rho/statistic/explicit infinity/df/p/available CI and p method; null is not0. Correlation results verify all artifacts on read. Old describe/ttest payloads/recipe hashes unchanged; schema15/31tables. Health0.27.0. See [CORRELATION.md](CORRELATION.md).


## v0.28 · online metadata and source-reference notes

No new HTTP routes or submission fields; schema15 / 31tables. Health version0.28.0.
Agent tools:
- find_online_datasets(kind:paper_doi|dataset_identifier|keywords,query:1..180chars,source_ref:Rn).
  Anchor must be a current paper page, still-associated paper page, or study context. Returns
  saved:false,status:found|not_found|partial|unavailable,query,items,providers,files_downloaded:false.
  Each retained Dataset has actual metadata identity, canonical landing_url, authors/year/version/
  licenses, access with explicitly unknown fields, association basis/relation_types, metadata_url,
  retrieval time and raw-record metadata_sha256; source_ref resolves to kind=online_dataset.
  Sources are appended to the existing turn.sources; no dataset file is created. Three distinct
  queries per turn, <=3 results/provider, repeat query/anchor reuses its captured response.
- propose_data_reference(source_ref:Rn). Only current online_dataset refs; server constructs text/
  rich_content, adds online_reference snapshot to existing create_note payload and retains the
  original owner paper/study source_ref. Existing proposal hash/approval/idempotency applies.
  Confirmation revalidates original source/association and canonical note content without
  network access. Study notes retain a study anchor plus persistent paper/page provenance in text.

Unsupported identifiers/invalid input are422; invented/stale refs, source/association changes and
query cap are409. Public-provider failures are per-provider typed status, not fake empty success;
404/not_dataset and actual successful empty results stay distinct. No arbitrary endpoint, auth,
redirect or file access; only fixed GET metadata queries. Historical online citation numbers are
masked before model history reuse. See [full limits](ONLINE-DATA.md).


## v0.28.1 · readonly bibliography lookup

POST /api/v1/documents/{id}/metadata/lookup with {doi:string|null}, extra fields forbidden.
null/omitted uses saved DOI then PDF discovery; empty string requests PDF discovery.
Ready returns saved:false,status:ready,fields (known valid title/authors/year/doi only),
metadata_revision,source_sha256,source:{provider,url,retrieved_at,metadata_sha256,record_type},warnings.
Multiple PDF DOI candidates return status:choose_doi,candidates; empty embedded metadata yields
status:not_found,fields:{}. No writes or model call. Existing PATCH metadata/save receipt and
revision conflicts remain. DOI identity/field limits/source hash are checked; fixed public HTTPS
GET metadata only, no redirects or file uploads. Health0.28.1; schema15 / 31tables unchanged.
Reading note visibility reflows the grid; fit/custom scale semantics remain. See BIBLIOGRAPHY-AND-LAYOUT.md.


## v0.30 · confirmed permanent paper deletion

GET /api/v1/documents/{id}/purge-preview is readonly, trash-only, idle/unlinked-only;
returns id,title,expected_revision,preview_sha256,counts and excluded. POST .../purge
accepts request_id,expected_revision,preview_sha256; checks the exact snapshot in a
write transaction, erases only owned rows, then cleans registered primary files.
Success is {id,purged:true,files_removed:true}; repeat exact payload after uncertainty.
503 document_purge_pending is NOT success: GET /documents/trash includes a body-free
pending row with purge_request for explicit retry; startup also resumes cleanup.
Stale snapshots/revisions, active jobs/study links and foreign references reject atomically.
Purged document access/restore returns410. Schema16 adds document_purges without changing
the old31 table fields. Original APIs and note purge remain. No secure-wipe/export-copy/
backup deletion claim. Health0.30.0. See [full contract](PAPER-PURGE.md).


## v0.31 · inline images and bounded ordinary reading

No new HTTP routes/submission fields or schema changes; schema16/32tables. rich_content v1
is unchanged; v2 allows insert:{research_image:{document_id,image_id,sha256,alt}} among text
ops, max8unique assets within existing512ops/64KiB/10000chars. Plaintext uses [Image: ALT].
Server checks same-owner immutable original/preview, syncs note_images atomically and exports
local offline images in order. Agent pixels still require explicit context.image_ids; embeds
alone share no pixels. Save/approval/revision/idempotency semantics remain.

Ordinary reading uses at most8 new page-read attempts,110s soft reading budget and a reserved
tools-free final response within the existing round cap. Overview seed/actual coverage is
server-bound. agent_reading_budget is an embedded tool error stopping expansion. A failed turn
may now retain nonempty answer excerpts with error.code=agent_answer_incomplete; it remains
failed, not a completed overview. Existing task_id analysis flows retain their confirmation
state machine. Health0.31.0. See READING-EXPERIENCE.md.


# v0.45 selected-page translation

Local-guest/same-origin boundary is unchanged. No authenticated account is added.
`GET /api/v1/translation-capabilities` reads parser/model readiness only.
`POST /api/v1/documents/{id}/translations` accepts request_id (UUID), source_sha256,
pages (1-based distinct sorted 1..5 pages), and target_language (zh or en). Exact
request UUID retries are idempotent; different payload is a conflict. The fixed
local parser and existing model connection execute in independent owned workers.
`GET /api/v1/documents/{id}/translations?limit=20` lists saved jobs;
`GET /api/v1/translations/{id}` includes saved page/block results;
`POST /api/v1/translations/{id}/cancel` cancels only the identified task.
GET never parses PDFs, downloads models or submits translation work.

Job records include document/source identity, requested pages/language,
queued/running/completed/partial/failed/cancelled/interrupted state, stage,
completed/total pages, error, parser version, nonsecret model name and result_pages.
Results retain 1-based original page, ordered typed blocks, source text and
translated text; verified source rectangles use display-normalized 0..1 geometry
or null when conversion is unavailable. Nontext visual/formula bodies are retained
as original markers, not fabricated translations. SQLite schema advances 22 to23.
The trusted local `--translation-runtime` directory contains runtime.json; client
requests cannot select executables, files, endpoints or parser models.
See [PAGE-TRANSLATION.md](PAGE-TRANSLATION.md) for limits and verification scope.


# v0.46 saved translation presentation

Original / parallel / translated-overlay modes consume the existing source-bound saved translation results. No new endpoints, model calls, parser jobs or schema changes occur when changing mode. Independent worker contention handling now retries claims only, while execution failures reach recovery. No functional acceptance claimed; see OVERLAY-TRANSLATION.md.


# v0.47 model-free paragraph source pages

`GET /api/v1/reading-capabilities` reports parser readiness only:
`{ready, parser_ready, reason, max_pages:5, parser:{id:"mineru-flash-txt",version:"4.1.5"}, result_schema_version:1}`.
It does not inspect model credentials or start the parser.

`GET /api/v1/documents/{id}/reading-pages?source_sha256=<64-lowercase-hex>&pages=1,2,3`
reads matching cached source pages only. The active document and stored hash/file stat
are checked; no digest computation, parsing, worker or model call occurs on GET.

`POST /api/v1/documents/{id}/reading-pages/prepare` takes exactly
`{source_sha256:"<64-lowercase-hex>",pages:[1,2,3]}`. Pages are 1-based, unique,
inside the document and limited to five (source document bound 200 pages / 100 MiB).
Only missing pages are prepared. Concurrent preparation returns 429
`reading_prepare_busy`; no shared scoring/analysis/translation queue is used.
Abort/disconnect or shutdown cancels owned parsing; publication rechecks source
identity, digest and cancellation in its transaction. Preparation timeout is 150 s,
inner parser timeout 120 s, output 4 MiB, owned process tree 4 GiB / 8 processes.

Both page routes return
`{document_id,source_sha256,parser,result_schema_version,requested_pages,cached_pages,missing_pages,result_pages}`.
Each result page is `{page,status,warning,blocks}`, with status
`completed|partial|unavailable`. A block is
`{id,kind,order,rect,source_text,translated_text:null}`. Rectangles are optional,
normalized display coordinates. Partial/unavailable results retain original-page
fallbacks; no OCR or semantic layout recovery is claimed. Failed parses are not cached.

Schema 24 adds `reading_pages`, keyed by `(document_id,page)` and source/parser/schema
identity, with document FK cascade. Existing translation sources may be reused
read-only, at most the newest matching row per requested page; saved translations
are never rewritten. Cache GET never writes and remains available without parser/model
readiness. No authentication, ownership, original-file or tFUS contract changes.
See FLOW-READING.md for the explicit unverified interaction scope.


# v0.48 cached-source evidence tool

No new HTTP route, schema, dependency or permission grant. ReadingTools registers
`search_paper_evidence(query,document_ids?,limit=4)`; query is1..200 trimmed searchable
characters, document_ids is an optional unique1..9 UUID subset of server-captured
current PDF plus explicit pinned paper refs, and strict limit is1..6. Default scope
is pinned papers when any resource refs exist, otherwise the bound PDF; study or
dataset-only empty scopes do not search other owners. Metadata/project links do not
expand this tool's scope. Maximum three executions per turn; returned unique hit
pages count against existing reading budgets.

The read-only result is `{items,coverage,scope,notice}`. Items carry existing R source
refs, original snippets up to1200 chars, document/hash/page/block, stable chunk IDs,
source offsets, optional normalized block rectangles, scores and excerpt:true.
Current sources use pdf_page and pinned sources reference_pdf_page with truncated:true
and evidence_excerpt:true. Existing publication verification and history masking apply.
Coverage describes prepared/searched/unsearched/unavailable/partial/skipped pages,
bounded page-number lists and explicit counts/limits. When more than three matching
translation jobs exist, prepared_history_limited is true and unprepared_page_count
is null; pages_without_selected_cache_count describes only this bounded source view.
An excerpt is not a complete page or full-document review. This first tool is exposed
to ordinary reading chat; the separate ongoing research-task whitelist is unchanged.

Reads are bounded to20 prepared pages per document,60 total with round-robin selection,
at most three recent matching translation jobs as source fallback,256KiB JSON and240
blocks per loaded page,24000 original characters/32 chunks considered per page.
There is no automatic preparation, pixel read, persistent index, vector search or model
request by this tool. No lexical match cannot support a negative scientific finding.
See EVIDENCE-SEARCH.md and the actual backend report for limitations; interactions
and retrieval quality have not been functionally tested.


# v0.49 explicit page preparation in assistant context

No backend/API/schema/grant changes. A React section in the existing assistant
context area calls v0.47 GET reading-capabilities and document reading-pages only,
and explicit user preparation calls POST reading-pages/prepare for missing pages.
Every operation freezes the actual context/source hash and up to5 unique1-based pages;
client validation precedes requests. Cache reads never imply preparation or sharing.
Source IDs are restricted in this UI to the bound PDF and explicit pinned papers;
this convenience filter is not a new authentication or server permission layer.

Responses are checked against source/hash/parser/schema/page sets before display.
Context/source changes and dismissal invalidate/abort owned work; late responses
cannot update another chat. Cached page states can survive a missing-page error.
No automatic message send, translation, whole-document prefetch or POST retry occurs.
The source cache and retrieval/page-read budgets remain unchanged. See
ASSISTANT-PAGE-PREPARATION.md for current workflow and unverified interactions.


# v0.50 explicit per-paper evidence page scopes

`search_paper_evidence` adds optional
`page_scopes:[{document_id:<UUID>,pages:[35,36,37,38]}]`. Omission/None retains existing
default selection. An explicit scope is nonempty, has1..9 distinct paper IDs,1..20
unique strict1-based integer pages per paper within its captured/live page count,
and at most60 pages total. Its paper ID set must exactly match the selected documents
resolved by the existing document_ids/default rules. It cannot add another owner,
source version or grant; invalid scopes fail before cache-body reads.

Explicit scopes filter descriptors before scheduling, preserving existing20/paper,
60total,3calls,reading/snippet/source-verification limits. Matching reading cache has
precedence. For a requested missing-cache page, one metadata-only newest matching
translation page can be selected beyond the default three-job window, with LIMIT1;
bounded bodies are loaded only for the chosen requested pages. Explicit SQLite read
work has a cooperative5-second execution budget on owned connections, with handler
cleanup and a short local busy timeout. Genuine budget failures return
evidence_search_timeout409, not partial evidence or a negative finding. Unrelated SQL
errors are not disguised. No automatic retry/parse/model call or business write.

Scope/coverage add page_scope_mode, requested page numbers/counts and missing requested
cache page numbers/counts. In explicit mode prepared/searched/unsearched page lists
refer only to those requested pages; whole-document unprepared_page_count and
pages_without_selected_cache_count are null, and full_document_searched remains false.
Existing result items, source kinds, chunk identities and final/history checks remain.

No new HTTP endpoint, context/submission field, frontend, schema or dependency.
This remains literal keyword retrieval, not full-text/semantic/OCR verification.
Functional, browser, HTTP, PDF and model checks were not run at the user's request.
# v0.51 isolated server guests

Opt-in `--guest-root` starts a separate loopback guest service; the default local
and existing owner service remain unchanged. Each opaque HttpOnly guest credential
selects a stable, isolated Store and service graph. Existing document/notes/files/
search/export/analysis/Agent APIs retain their paths and operate only in that space.

`GET /api/v1/access` returns guest space metadata; credential-gated
`POST /api/v1/access/recovery-code` returns a newly rotated recovery credential.
`POST /api/v1/access/recover` accepts only `{recovery_code}` and returns
`{workspace_id}` plus a rotated Secure HttpOnly cookie. Recovery consumes its code,
revokes the prior cookie and preserves record IDs. It never registers a person or
merges spaces. Recovery/access responses are no-store. Invalid API credentials get
401; invalid homepage credentials redirect to `/recover.html`. See GUEST-SPACES.md.
