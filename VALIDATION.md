# Validation — 2026-10-31

## Current v0.8: original Quill, atomic rich notes and compatible lifecycle

419 backend cases passed with real Python/R, no skips: all367 old cases plus52
rich-note/document/Agent/migration/asset cases across three new test files. Verify
strict version1 Quill text Delta, exact plain-text match and UTF8/op/text boundaries;
safe links/format allowlist; atomic note/image/Agent writes and forced rollback;
format-only revisions, review reset, no-op, delete/restore; original creation and
legacy operation hashes; exact retries/conflicts; corrupt bodies; original16-table
migration to schema7; fresh-app recovery and unchanged source anchors.

166 real browser groups passed: all140 previous groups plus26 rich-note groups
(24 before restart, offline export, fresh browser/server). Actual upstream editor,
mouse add/remove and keyboard activation, headers/lists/links, Apply/Cancel/Escape,
separate drafts, image-note creation, format-only review reset, exact committed
lost create/edit retries, conflict preservation, explicit plain conversion, Agent
preview/confirm/removal warning, JS/CSS asset failure recovery, late close/paper/
note loads, clipboard and hostile HTML sanitation, size rejection,390px bilingual
blue theme and unchanged PDF pixels. No external runtime requests in acceptance.

One actual configured-provider check used only a labelled synthetic paper: rich
proposal stayed unapplied until explicit confirmation, persisted exact formatting
once and remained unreviewed. No original paper/model sends or cloud uploads.
Independent Quill2.0.3/DOMPurify3.4.17 assets retain upstream licenses and lock;
24 inventoried files plus manifest rebuilt byte-identically. No new Python
runtime dependency, rewritten editor, React or RSpace application code.

Integration fixes verified: corrected asset-template split; updated two old test
runner health versions and verified their abandoned listeners closed; contained
Snow-generated toolbar DOM; retry failed JS by new local module URL while reusing
successful JS after CSS failure; preserved selection before native toolbar
handlers so removing existing formatting works with mouse and keyboard. All host
bindings are disposed on close. No upstream editor sources were patched.

Evidence: E:/research-workbench-pilot-20261030/reader-v8/ (pytest-backend-final.xml,
accepted-runs.json,accepted-rich-run.json,notebook-final/,asset-reproducibility.json,
activation.json). Rich browser: private/reader-v8-rich-20261031T004449316098Z.
Actual provider: private/reader-v8-real-model-20261031T004752142961Z.
Deployment backs up latest live schema6 and source, adds one empty sparse table,
preserves every old16-table row and original source/image/data/output byte. The
four original notes stay unformatted/unreviewed. tFUS HEAD/index/global dispatcher
remain unchanged. Cloud storage policy only, not a connected cloud account or
multi-user database. See STORAGE-AND-BACKUP.md.

## Previous v0.7: original JupyterKit and verified saved-analysis Notebook

367 backend cases passed, no skips, with real Python and R4.6.2. All previous
328 remain. New requirements cover nbformat4.5 validation; exact archived code,
logs, result, provenance and deterministic bytes; every incomplete state;
missing/tampered/misbound artifacts and source drift; current-recipe changes;
read races, permission errors, hostile labels/fences,1MiB boundaries; identical
ZIP/API Notebook bytes; explicit shared analysis context and old frozen retries.
Three test files exercise notebook projection, context and local asset integrity.

140 browser groups passed on current code: all109 previous groups,18 strict
Notebook contract/fault groups and13 real Python/R viewing groups across hard
server restart. Check original renderer code/table/SVG; exact Download/Ctrl+S;
listener teardown and focus; local lazy assets; wrong document/job/dataset,
readonly/MIME/version/cell errors; declared and streamed oversize; delayed close,
paper/job responses; retry; Chinese/English390px/blue theme; unchanged PDF pixels
and drafts; exact active-analysis Send/frozen retry; no unexpected writes/model
or external requests while viewing. The two malformed test-run setups were
corrected outside product source: stale selected synthetic CSV, then a test
replacement that incorrectly reset both selection steps. Final suites all pass.

One additional actual configured-provider check on labelled synthetic data
consumed the captured R analysis ID and called read_analysis. It returned saved
code with matching SHA, actual stdout and exact Notebook URL; no rerun/proposal
or note/job changes. No automatic real-paper sends. Model connection remains an
external private snapshot; no credential is shipped in Notebook/export/assets.

Original @jupyter-kit/core and theme-default3.0.0 (Apache-2.0), not a rewritten
renderer or RSpace business-code extraction. Pinned lock, package licenses and
205 inventoried files plus manifest retained. Independent repeated builds of
all206 physical files were byte-identical. Runtime Python dependencies unchanged;
nbformat is a dev-only validator. No editor, executor, kernel, React or CDN.

Evidence: E:/research-workbench-pilot-20261030/reader-v7/
(`pytest-backend-first.xml`, `accepted-runs.json`, `frontend-browser-final.json`,
`notebook-final/result.json`, `notebook-final/real/notebook-browser-*.json`,
`asset-reproducibility.json`, `activation.json`). Actual provider:
E:/research-workbench-pilot-20261030/private/reader-v7-real-model-20261030T235538453049Z/result.json.
Deployment retains schema6/all16 table rows and original PDF/PNG/dataset/analysis
bytes, verified against a consistent pre-upgrade backup. tFUS main source/index
remain outside the update. Opening/downloading Notebook is read-only; arbitrary
code, notebook import/editing, shared workspace and tFUS identity are not added.

## Previous v0.6: immutable tables and confirmed Python/R descriptive analysis

328 backend cases passed, with actual Python and R 4.6.2 execution (no skipped
R cases). All 248 previous cases remain included. Added scenarios cover UTF-8
CSV/TSV parsing, exact byte/row/column/cell limits, Unicode/missing/non-numeric
values, crashes/timeouts/permissions, quota/queue limits, exact concurrent retries,
source/recipe/output drift, real engine cancellation, process ownership, hard
worker death reaping its actual child, restart interruption without replay,
credential environment isolation, portable manifests and additive schema5
migration preserving all 14 old tables. Older schema migration remains covered.
An enforced interleaving verifies concurrent list reads and state commits finish.

109 browser groups passed: all previous 91 plus 18 analysis groups. Actual file
uploads, Python/R worker results, concrete code review, log/export, committed
response loss, stable request retry, paper/draft separation, Agent confirmation,
actual result note, source drift/abandon, sharing revocation, queued cancellation,
fresh browser/server interruption, keyboard, Chinese/English 390px/blue theme and
offline analysis HTML are covered. Fault controls are outside product source;
successful computations use actual language runtimes, not invented output.

Two separate real-model checks passed on synthetic material only: the model
proposed the exact R task, approval executed it once with independently expected
mean/SD, then the model read the verified result and cited its actual source.
Original paper/notes were not automatically sent to a model. No scientific
experiment, medical conclusion or downloaded study data is claimed.

Evidence: E:/research-workbench-pilot-20261030/reader-v6/pytest-backend-final.xml,
accepted-runs.json, r-runtime.json and final-acceptance.json. Actual Kimi jobs
01–02 implemented frontend and completed with verified cleanup. A browser run
exposed nested SQLite reads blocking worker commits; list materialization now
uses one joined snapshot and closes reads before formatting. The failure and
deterministic concurrency regression remain recorded. Raw parent-pipe monitoring
avoids a buffered-stdin shutdown fault; transient claim locking retries once.

Upgrade backs up latest data/source, checks all 14 old tables and original
PDF/excerpt/image bytes, and creates only datasets/analysis_jobs. Existing model
connection stays read-only; tFUS main source/index/runtime and global dispatcher
remain unchanged. Successful outputs carry exact source/code/parameter/runtime
metadata and downloadable hashes. Original source review remains manual.

Limits: Windows local single user; fixed descriptive code, not arbitrary scripts;
no online data downloads, package installation, shared-space or tFUS account
integration. R is optional and availability/version is actually probed. Process
limits are not a general-purpose sandbox. Reading and analysis exports are
separate. The existing Starlette/httpx test-client deprecation warning remains.

## Historical v0.5: uploaded images and context-aware reading Agent

248 backend cases passed, including all 174 previous cases. New requirements
cover static image validation/limits, original and preview integrity, real decoder
crash/timeout, quota/storage rollback, cross-paper scoping, atomic linked notes,
idempotent response-loss retries, portable exports, model configuration privacy,
HTTPS transport/redirect restrictions, fixed validated tools, current context,
whole-page versus position-only references, explicit completion, confirmation
hash/revision/source drift, cancellation, interruption and additive schema1–4
migration. No new runtime dependencies were introduced.

91 browser scenario groups passed: all 72 previous groups plus 19 image/Agent
groups. These exercise actual file pickers, actual storage and child parsers,
retained exact requests after response loss, concrete confirmation/rejection,
concurrent manual edits, delayed results after paper navigation, disabled vision,
model failure, cancellation, private model form, keyboard/page-input behavior,
Chinese/English 390px layout, blue theme, fresh server/browser and offline images.
Reproducible faults use a labelled scripted provider. Two separate real-provider
checks passed using only synthetic material: reading actual page2 then confirming
one note, and recognizing a red square/blue circle from selected image pixels.
The actual user paper and notes were not automatically sent to a model.

Evidence: E:/research-workbench-pilot-20261030/reader-v5/pytest-backend-final.xml,
accepted-runs.json and final-acceptance.json. Actual Kimi frontend workers 01–03
completed with verified process cleanup. Browser screenshots were inspected.
Temporary-runner cleanup escaping and mismatched retry/context selectors were
corrected; failures remain recorded. Theme pixel comparisons wait for a settled
form layout and retain exact-pixel equality. A focused page input overwritten on
layout refresh and uploaded-image source navigation were corrected by Kimi.

Before activation, back up the latest database and original files; afterward,
compare all seven existing tables and original PDF/excerpt bytes verbatim. New
tables are empty until used. Live checks are read-only, including a source ZIP
hash check. Model connection reuse is a private read-only snapshot, not tFUS
account federation; no tFUS source/index/runtime or global dispatcher is changed.

Limits: local single user; fixed reading tools; no Python/R, downloads, OCR,
automatic selected-region pixels or authenticated shared workspace. User source
review stays manual. Parser subprocesses are bounded, not a general sandbox.
Unsent drafts survive current-session navigation, not a browser restart.
One existing Starlette/httpx test-client deprecation warning remains.

## Historical v0.4: paper library, metadata, search and optional blue theme

174 backend cases passed. Requirements include opt-in exact-byte duplicate
imports and concurrent commits, legacy upload compatibility, source verification,
failed-import cleanup, bibliographic field boundaries, edit/no-op/clear,
revision conflicts and idempotency, storage rollback, literal Unicode search,
current active note filtering, bounded stable results, source-safe export,
and schema1/2/3 additive migration preserving original records.

72 browser scenario groups passed:16 reader,12 excerpt/export,8 cross-renderer
coordinate checks,16 note lifecycle and20 library/theme groups. Library tests
include real-file-picker upload of the selected paper, exact-byte reuse, distinct
same-name PDFs, committed response loss/retry, invalid input, metadata edit/cancel,
independent drafts, lost-response exact retry, two-tab conflicts, delayed saves,
search fields/source navigation, stale query and errors, keyboard export,
390px Chinese/English layout, hard restart/fresh context and offline bibliography.
Blue theme tests cover draft/pixel preservation, preference reload, language
switch and primary-control text contrast. Actual screenshots were reviewed.

Evidence: E:/research-workbench-pilot-20261030/reader-v4/pytest-backend-final.xml
and accepted-runs.json. User data never served as a mutation test target.
All original document/note/excerpt/note-state/operation rows and PDF/PNG bytes
are compared against backups before and after activation.

Early harness failures are retained: Markdown-escaped punctuation, original
library filename versus download filename, mobile canvas width, and two runners
sharing a timestamp directory. The multipart fault test now uses a buffer-backed
File because Playwright route.fetch omitted file-backed stream bytes; ordinary
disk-file upload is verified separately. No mocked successful responses are used.
The development Starlette/httpx deprecation warning remains unchanged.

Scope: no online dataset discovery/download, Python/R execution, Agent runtime,
authentication or shared workspace is delivered. These are explicitly future
items in ROADMAP.md, including reference-first storage and opt-in downloads.
Both actual Kimi frontend jobs exited with verified process cleanup; global
routing/auth and the tFUS main worktree are outside this change.

## Historical v0.3: editable notes, recovery and explicit source review

127 backend cases passed. Added requirement checks cover immutable source/raw
creation records, text/review transitions and no-ops, soft delete/restore,
validation boundaries, wrong-document access, stale/concurrent changes,
transaction rollback, exact-payload request retries, image/delete races,
consistent export/delete snapshots and schema1/2 migration to schema3.

52 real browser scenario groups passed: 16 original reader, 12 excerpt/export,
8 PDF.js/PNG coordinate comparisons, and 16 note lifecycle groups. Lifecycle
checks use an isolated copy of the actual paper and cover independent creation
and edit drafts, two-tab conflicts, lost committed responses for all four
mutation actions, delayed saves during navigation, source/PNG preservation,
recoverable deletion, current-text/review export, restart/fresh context,
keyboard/390px bilingual layout, and offline HTML with the app stopped.

Two additional response-order checks reproduced and then verified the fix for a
real race: independent legacy note and state requests could show text from one
revision while reviewing another. The loaded note-state snapshot now supplies
both displayed text and review/deletion/revision metadata; a stale whole snapshot
correctly conflicts instead of checking a different text. Tests cover both orders.

Source rows, PDF and PNG bytes were compared against the pre-upgrade copy.
Production notes are not edited or marked checked by acceptance. All existing
AI notes remain unreviewed after migration. Review is self-reported local reading
confirmation, with no authenticated or scientific validation claim.

Final evidence: E:/research-workbench-pilot-20261030/reader-v3/pytest-backend-final.xml
and accepted-runs.json. Failed runs are retained. Early browser-script corrections
used the explicit source button, real upload entry, error state and correct image
primary key. Screenshot waits verify opaque rendered ink after resize.

Actual Kimi owns frontend code; Codex owns backend/integration/acceptance. One
bounded correction run lost its OAuth TLS connection after editing; a single
retry completed validation. All worker process cleanup is verified, global
routing/auth files stayed untouched. One pre-existing Starlette/httpx deprecation
warning remains in the development test client; it does not affect runtime.

## Historical v0.2: excerpts and portable export

92 backend cases passed, including the original 61 cases. New cases cover visual
crop coordinates at intrinsic rotations 0/90/180/270 and nonzero crop boxes,
idempotent/concurrent excerpt creation, real child-process crash/timeout recovery,
source/image integrity, storage errors, safe portable ZIP/HTML/Markdown, cancelled
download cleanup and schema1 migration. Original document/note JSON is unchanged.

36 real browser scenarios passed: the original 16 reader groups, plus 12
excerpt/export groups on an isolated copy of the user's actual selected paper.
The latter includes note+image partial failure, lost committed responses, document
switches, delayed excerpt lists, keyboard export, bilingual mobile layout, fresh
browser/server restart and opening exported HTML/images while the app is stopped.
All four original note records were compared verbatim after migration and tests.
Bundle file hashes, original PDF bytes and portable source links were checked.
Eight additional browser cases compared actual PDF.js canvas pixels with server
PNG pixels at rotations 0/90/180/270, with and without a nonzero crop box.

Evidence roots:
- E:/research-workbench-pilot-20261030/reader-v2/pytest-backend-final.xml
- E:/research-workbench-pilot-20261030/reader-v2/legacy-20261030T122326911468Z/
- E:/research-workbench-pilot-20261030/private/reader-v2-acceptance-20261030T122326912442Z/
- E:/research-workbench-pilot-20261030/private/reader-v2-acceptance-20261030T123400284699Z/

Two initial coordinate checks sampled the brief blank canvas during a layout
redraw. Independent PDF.js rendering and the saved PNG agreed; the corrected
check waits for observed rendered pixels instead of stale page metadata. Failed
receipts are retained; no product code change was needed for that test timing.

Real materials stayed local. The screenshots/images are visual excerpts, not
reproduced experiments, recognized table data or new scientific validation.

## Historical v0.1: first reading slice

Scope: our own single-user local PDF reader and source-linked notes. Synthetic
materials only; no completed research study, shared-space or tFUS account/UI
integration is claimed.

- Backend: 61 requirement-driven pytest cases passed. Includes PDF byte readback,
  persistence across app recreation, page/rectangle/text boundaries, encrypted/
  invalid/oversized files, exact file-size/page limits, storage permission failure,
  duplicate/concurrent saves, real parser crash/timeout recovery and local boundary.
- Browser: 13 scenario groups before restart and 3 after a hard server restart
  passed with real API responses, a fresh browser context and actual PDF rendering.
  Includes keyboard upload, region/page notes, zoom/resize geometry, below-fold
  source reveal, XSS text display, a committed-but-lost response and idempotent
  retry, delayed document loading, save completion after switching documents,
  per-document drafts, Chinese/English, 390px/1440px layouts and a tall-page canvas
  budget. No uncaught JavaScript errors or external page requests were observed.
- Both acceptance server processes were stopped and verified; browser contexts
  closed. Each actual Kimi worker exited with verified owned-process cleanup.
- Actual environment: Windows, Python 3.12, Node 24.22.0, Chrome 156.0.8078.79.
  Existing Playwright tooling used the installed Chrome; no browser was downloaded.
- A Starlette test-client deprecation warning about httpx was observed; cases pass.

Evidence: E:/research-workbench-pilot-20261030/reader-v1/acceptance-20261030T101130204306Z/
contains checks-before.json, checks-after.json, process results and screenshots.
Earlier failed runs and Kimi dispatch/correction receipts are retained alongside
it. The initial CLI compatibility failure and two browser-detected integration
defects were corrected before this accepted run; no deployment bug in the old rwv
environment was repaired.

Known limits: local single user, 20 MiB / 200 pages, no encrypted PDFs, OCR,
automatic figure extraction, online analysis, rich-text editing or authentication.
Unsubmitted drafts survive document switches in the current session; only saved
notes are promised to survive closing the browser. Parser subprocess limits are
not a general sandbox. Real user task validation is still required.
# v0.9 validation record

Requirement scenarios are recorded before implementation in the task's
reader-v9/SCENARIOS.md. Backend requirement tests cover image frames/geometry/
revisions/retries/quotas/rollback/source isolation, migration7→8, fresh startup,
Agent privacy/proposals/confirmation/conflict and portable safe export, alongside
the full existing suite and real R runtime.

Browser acceptance uses original SDKs and actual app/API/SQLite/files on synthetic
data. All166 previous groups and25 new image groups pass. Ten independent EXIF/
PNG/WebP coordinate/pixel fixtures pass against the final source-built component.
The configured model also produced an image proposal from explicitly shared
synthetic data and persisted it only after exact confirmation. No real-paper
content was sent. Build repeats produce368 identical files including the manifest.

The npm prebundle failed strict CSP; the final build uses unchanged same-release
source plus Pixi's official CSP compatibility installer, keeping CSP unchanged.
Harness environment/selector/old-call-signature failures were corrected and rerun.
Evidence, owned process cleanup and final live row/file checks are retained under
E:/research-workbench-pilot-20261030/reader-v9. Existing real notes remain plain
and unreviewed; cloud accounts/storage are not connected.

## v0.10 validation

All553 backend tests pass, including actual Python/base R execution and66 new
chart/Agent/storage/export cases. Three original Plotly component checks pass
under unchanged strict CSP. Repeated asset preparation produces5 identical files.

The final new-chart browser run passes26 scenario groups:24 application groups,
one app-stopped offline export group and one hard-restart persistence group.
It verifies exact bins/pairs/counts, native interaction/PNG, manual and Agent
confirmation, frozen retries/lifecycle/notes, bilingual layouts and asynchronous
failure/navigation boundaries. No external browser requests or uncaught JS errors
were observed. Evidence: private/reader-v10-charts-20261031T032734059130Z under
E:/research-workbench-pilot-20261030/. All owned test servers stopped and verified.

The actual configured deepseek-flash model selected a scatter from synthetic user
intent, previewed5 complete pairs with1 excluded row, and saved exactly once only
after explicit approval. It received a bounded5-row preview and summary, not the
whole dataset. Real paper content was not sent. SPSS-like package review is
documented separately in STATISTICS-SOURCES.md; those packages are not integrated.

All191 previous browser groups were repeated successfully after the final frontend
changes. Ten owned test controllers and all their servers completed cleanup.
The18 Notebook contract checks are recorded separately from its13 real-runtime
checks. Final paths/counts are enumerated in reader-v10/accepted-evidence.json.
An evidence collector initially omitted that separate18-check file; the collector
was corrected against the controller output, without changing any product behavior.
# v0.11 statistical-method validation

All611 backend tests pass with actual R4.6.2, including58 new statistics cases.
Fourteen cases compare Student/Welch,three alternatives,group reversal and
confidence levels against an independent50-digit incomplete-Beta reference.
New tests also cover explicit scientific parameters,complete-case counts,
source/code/component drift,preview without writes,retries/conflicts,cancellation,
restart/timeout,invalid output,storage denial,verified exports and Agent citations.

All217 earlier browser groups pass (191 reader/analysis/Notebook/image groups plus
26 charts). After the final scoped t-test preview/layout fix,the18 descriptive
analysis groups were repeated successfully. The new real-backend browser suite
passes19 groups including manual runs,Agent confirmation/citation,lost-response
retry,group literals,390px English blue,per-paper drafts,late previews,mismatched
parameters,unavailable component,app-stopped export and hard-restart persistence.
No uncaught JS errors or external browser requests occur in the accepted runs.

Actual configured deepseek-flash proposed the explicitly specified Welch test on
synthetic data,queued nothing before approval,then completed R stats execution
once after confirmation. It received a bounded5-row sample and verified summary;
real-paper content was not sent. Final run paths: reader-v11/accepted-evidence.json.

jmv is not deployed: isolated loading/computation produced Windows access violation
on exit. The fixed method directly reuses its underlying R stats::t.test component;
diagnostics and rationale are retained in STATISTICAL-TESTS.md. Runtime remains
under the existing256MiB worker cap; no arbitrary code or full SPSS claim.

Browser work caught an initial no-paper null dereference and stale successful
preview surviving a failed re-preview. Actual Kimi corrected both before release;
four bounded frontend attempts finished with verified process cleanup. Test-only
startup/input/selector/fixture issues were corrected separately; one owned test
listener required verified manual cleanup after its shutdown route was shadowed.
All controls/fault hooks remain outside product source. Schema9/21tables unchanged;
original rows/files and tFUS/global routing boundaries are verified during activation.

# Doraemon-elements theme verification

The opt-in theme adds blue/white rounded controls,pocket contours and small yellow
bell details without character art. Default neutral computed styles match the
prior live version exactly for representative header,brand,input and controls.
Business JavaScript,backend and vendor files retain their accepted v0.11 bytes.

Nine focused actual-browser groups pass: neutral↔blue and reload persistence,
visible noninteractive motifs,primary contrast ≥4.5,keyboard focus,reduced motion,
1500px Chinese and390px English,actual image viewer,Agent panel,saved Notebook,
original Plotly trace colors and exact Notebook/chart bytes. No page errors or
external application requests were observed; all21 synthetic workspace tables
remain exact. The existing25 image-annotation groups also pass,including native
geometry,source switches,lifecycle,offline export and restart.

Actual Kimi implemented only scoped CSS and one stylesheet link,and exited with
verified owned-process cleanup. Test selector/localized-label mistakes were fixed
in the acceptance harness only. Source/evidence is retained under
E:/research-workbench-pilot-20261030/theme-v1/. Original live data/files and tFUS
HEAD/index/global routing are checked around deployment. No backend unit tests
were added or repeated for this reversible styling change.

# Theme refinement: remove arcs and restore logo

The follow-up user correction removes heading/empty-state pocket arcs and logo
bell/shape overrides. The original square outlined SN mark comes from base CSS.
Focused browser checks cover populated desktop Chinese, 390px mobile English,
empty-library states, original logo geometry, absent decorative pseudo-elements,
theme reload persistence and switching back to neutral. Actual PDF pixels render
after viewport resizing, with no page errors, external requests or data writes.
The tested candidate and live stylesheet hashes must match before Git save.
Evidence is in E:/research-workbench-pilot-20261030/theme-v2/.

