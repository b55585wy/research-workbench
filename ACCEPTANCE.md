# Requirement scenarios before implementation

Every scenario is checked against observable behavior, not source text alone.
The PDF fixture is synthetic; no research/scientific validity is claimed.

| ID | Required result | Verification |
|---|---|---|
| R01 | Upload a PDF, read pages, fetch original bytes unchanged | API + real browser |
| R02 | Save region and page notes; source belongs to the intended document/page | API + browser |
| R03 | Restart server / use a fresh browser; documents, notes and source links survive | process restart + browser |
| R04 | Return to the same highlighted region after zoom/resize | measured normalized browser geometry |
| R05 | Empty/invalid/encrypted/zero-page/too-many-page/oversized PDFs are rejected without a record | API + parser tests |
| R06 | Invalid/missing IDs, page boundaries, nonfinite/reversed rectangles, empty/long text, unknown fields are rejected | parameterized API tests |
| R07 | Repeating one note request returns one result; conflicting reuse is rejected | API + retry browser scenario |
| R08 | Storage permission/failure and missing files report failure; no false success | repository/API fault scenarios |
| R09 | Parser crash/timeout/busy is bounded and leaves the web app available | isolated validator tests + API |
| R10 | Navigation/render races do not mix documents or source anchors | controlled real API/browser response delays |
| R11 | Failed/uncertain save preserves draft and anchor; retry creates only one note | real browser network failure |
| R12 | Notes/titles containing markup display as text | API + browser DOM checks |
| R13 | Desktop/mobile and Chinese/English remain usable; keyboard can create a page note | browser + screenshots |
| R14 | All renderer assets load locally; no external application/CDN needed | browser request evidence |
| R15 | Nonlocal host/client/origin requests are rejected; upload stream is bounded | boundary API tests |
| R16 | tFUS runtime/source/index stay outside this slice | scope/evidence review |

Known bounds: local single user, PDF only, 20 MiB / 200 pages, no OCR, autonomous
analysis, PDF editing, rich text, account sharing or clinical use qualification.


v0.3 note lifecycle requirements and API are defined in
[NOTE-REVISION-AND-REVIEW.md](NOTE-REVISION-AND-REVIEW.md). Root scenario matrix:
E:/research-workbench-pilot-20261030/reader-v3/SCENARIOS.md.
The UI must display text and review metadata from the same state snapshot;
independent legacy note responses cannot change the text attached to a revision.


v0.4 library requirements: [LIBRARY-AND-SEARCH.md](LIBRARY-AND-SEARCH.md),
scenario matrix E:/research-workbench-pilot-20261030/reader-v4/SCENARIOS.md.
Theme selection must persist locally, preserve drafts and leave original PDF/PNG colors unchanged.

v0.5 requirements: [AGENT-AND-IMAGES.md](AGENT-AND-IMAGES.md), scenario matrix
E:/research-workbench-pilot-20261030/reader-v5/SCENARIOS.md (A01–A20). Verify image
bytes/provenance, atomic image-note creation/export, exact uncertain retries,
captured context and paper scoping, bounded model/tool execution, explicit write
approval, source/revision/hash drift, cancellation/restart, manual review safety,
configuration privacy, actual model text+vision behavior and unchanged legacy UI.
Scripted providers test reproducible faults; separate real-provider smoke tests
use only labelled synthetic documents/images, never automatic real-paper sends.

v0.6 requirements: [ANALYSIS.md](ANALYSIS.md), full scenario matrix
E:/research-workbench-pilot-20261030/reader-v6/SCENARIOS.md. Verify actual Python/R
numbers, literal bounded CSV previews, selection/privacy, input/code hashes,
atomic idempotent queue receipts, cancellations, process death and restart,
source/output drift, quota and permission failures, safe portable analysis ZIP,
concurrent polling/state commits and all previous reader/Agent behavior. Runtime
processes and fresh browsers are real; controlled failure hooks remain outside
deployed source. Synthetic data proves software behavior, not research findings.

v0.7 requirements: [NOTEBOOK-VIEW.md](NOTEBOOK-VIEW.md), scenario matrix
E:/research-workbench-pilot-20261030/reader-v7/SCENARIOS.md (N01–N09,A01–A03,U01–U07,C01–C03).
Validate real Python/R projections with official nbformat4.5, exact archived
code/output/hashes, all incomplete states, wrong scope, source/artifact drift,
read races, size boundaries, literal hostile metadata and ZIP byte equality.
Verify original local renderer, strict identity/readonly/output checks, delayed
responses, error/retry, exact Download/Ctrl+S, listener cleanup, 390px bilingual
themes, PDF/draft preservation and real-engine hard restart. Preserve old frozen
Agent retries and all 16 table rows/schema6. Rebuild assets identically and retain
upstream licenses. Opening a view must never execute code, call a model or write.

v0.8: RICH-NOTES.md and E:/research-workbench-pilot-20261030/reader-v8/SCENARIOS.md.
Verify original Quill; strict Delta/text agreement and limits; format-only revision,
review/reset/no-op; atomic creation/edit/image/Agent writes; rollback; old hashes;
conflict and exact retry; schema1–6/all16 old tables; restart; single-snapshot state;
safe HTML/JSON/offline export. Browser checks add/remove formats by mouse/keyboard,
selection/focus, disposal, JS/CSS retry, late paper/note switching, clipboard/HTML
sanitation, draft preservation,390px bilingual themes. No cloud upload or live DB
synchronization is added. Preserve all367 backend/140 browser regression groups.
# v0.9 image annotation acceptance

Open an upload or saved excerpt via its adjacent View/annotate button. Pan/zoom,
draw a rectangle, type a description, verify draft-only state, then Save. Reopen,
edit/delete/restore, cancel or switch sources without losing another source's
draft. Simulated committed-but-lost responses must retry identical requests;
conflicts keep drafts and never overwrite a later revision. Delayed module/frame/
write responses must not mount or retarget the next source. Failed JS/CSS/hash/
oversize frames fail closed and allow retry. Source files remain exact.

Agent context includes source/selected annotation but no automatic pixel sharing.
Preview a concrete proposal without writing, confirm it once, then export. With
the application stopped, open the exported HTML and verify exact images/static
rectangles/literal text. Restart and verify unchanged annotations/revisions.
390px English blue layout, Chinese desktop, deep links, PDF source navigation and
all166 previous browser groups remain covered. See IMAGE-ANNOTATIONS.md.

## v0.10 traceable charts

Requirements and preimplementation scenarios: CHARTS.md and
E:/research-workbench-pilot-20261030/reader-v10/SCENARIOS.md.
Check exact histogram bins, complete scatter pairs, and counts from actual saved
Python/R analyses; frozen input/projection/renderer hashes; bounded child workers;
atomic saves, duplicate/conflicting retries, quotas, revisioned delete/restore and
schema8 to9 preservation. Verify explicit Agent dataset sharing, concrete preview,
no write before confirmation, exact confirmation receipts and persistent note links.

Use actual pinned Plotly under unchanged CSP, hover/zoom/reset/PNG, source selection,
draft preservation, failed SDK/integrity/data hash/render, late paper switches and
committed-but-lost save. Stop the app and open the exported ZIP independently,
then restart and verify unchanged chart bytes. Cover desktop Chinese and390px
English blue, and all191 previous browser groups. Synthetic inputs prove software
behavior only; no new inferential statistical method or SPSS engine is included.
# v0.11 statistical methods acceptance

Requirements/scenarios are enumerated before implementation in reader-v11/
SCENARIOS.md. Verify14 independently calculated50-digit Student distribution
reference cases against actual R, including Student/Welch,three alternatives,
group reversal and confidence levels. Verify closed parameters,design declaration,
group/cardinality/numeric/constant/singleton boundaries,disjoint exclusions,
preview without writes,source/code/library drift,exact retry/conflict,cancel,
restart,timeout,invalid output,permission failure,hash-verified Notebook/ZIP and
saved source citation. Agent must require explicit data sharing and confirmation.
Repeat all previous217 browser groups and actual new UI/Agent/portable export;
use synthetic materials only. Statistical applicability is not established by
these software tests. Components and rejected jmv evidence: STATISTICAL-TESTS.md.


## Task-oriented workspace acceptance

See WORKSPACE-WORKFLOW.md and external workspace-v1/SCENARIOS.md (W01-W10).
Verify central analysis width, real previews/results/Plotly, one four-format chooser,
contextual review/defer/confirm, exact uncertain retries and cross-paper responses.
Keep drafts/page/zoom and frozen operations across task switches. Align chart and
analysis sources without implicit Agent sharing. Test old links, browser history,
keyboard, 390/1060/1500px and bilingual neutral/blue. Background completion must
not move the active task. Use synthetic workspaces; verify unchanged live data,
backend/vendor/runtime/schema, tFUS source/index and global routing before release.

## v0.13 task continuation

Requirements were enumerated before implementation in agent-task-v1/SCENARIOS.md,
T01-T12. Backend scenarios live in test_agent_tasks.py, test_agent_task_control.py,
test_agent_task_recovery.py and test_agent_task_integrity.py; helpers in task_support.py.
Require real successful analysis output before chart continuation, then concrete
chart confirmation before a note with both actual record links. No write before
confirmation; exact retries, concurrent starts, stop/confirm races, stale callbacks,
source/output/image drift, restart, failed analysis retry and eight-turn/five-task
bounds preserve prior work. Old request hashes and all original22 tables must survive.

Exercise actual Chrome controls, lost stop receipts, restored frozen proposals,
unchanged draft/focus, unsharing, fresh browser, mobile English/blue and actual
model one-goal flow. Rehearse live schema10 migration on a private copy and verify
all old rows/files before service upgrade. Published Table2 aggregates validate
software flow only, not independent trials or scientific reproducibility.


## v0.14 grouped observations

Requirements preceded implementation in grouped-observations-v1/SCENARIOS.md,
G01-G12. New cases: test_grouped_points.py, test_grouped_integrity.py,
test_grouped_agent.py. All753backend scenarios pass with real R/statistics/import
runtimes. Check exact labels, duplicate points, constants/subnormals, missing
partitions,2group/200character/50000row/4MiB bounds, malformed protocol, source
hashes, atomic saves, lifecycle, restart and source snapshots. Old recipe hashes
remain exact. Actual R task continuation confirms analysis, chart and source note.

Five native browser groups cover categorical numeric-looking labels, exact lost
save retry, delete/restore/export, literal hostile labels,390px English blue and
keyboard. Actual model9calls/one goal/three approvals on public ToothGrowth
fixed-dose20records;13numeric fields agree with independent60digit references.
All32export files verified. With server stopped, offline plot shows20points/2groups,
rejects14malformed cases and makes no HTTP requests. Old chart/other regression
receipts and live preservation checks remain external beside this task.


## v0.15 精确筛选验收

按[筛选契约](DATASET-SELECTION.md)验证：原表不变、原字符串精确匹配、源行顺序、
零命中阻止生成、预览漂移/原请求重试、事务和回执共同回滚、有界解析/配额、缓存
恢复与损坏拒绝、schema11原24表保留、SPSS说明和祖先导出、Agent新表重新授权、
连续任务不切源；另跑完整后端和旧界面回归。公开60→20行再接实际R/图表/笔记。


## v0.16 unified research record

Scenarios R01-R12 were enumerated in research-record-v1/SCENARIOS.md before edits.
Require all8 optional scope combinations, strict IDs/hash/bool/token/path limits,
same-source and analysis-linked chart checks, included/excluded reading drift,
metadata/material mutation, final-snapshot race, byte-exact existing artifacts,
manifest hashes, exact128MiB expanded boundary, concurrent slot/permission/
disconnect cleanup and no DB writes. Agent gets summary only for explicitly shared
data and a human review entry. Native retry/repreview/source races, stale Agent
scope, mobile/keyboard/bilingual/default-blue, old workflows and public offline
20-point replay are required. Schema12 and all25 original tables remain.

## v0.17 data-first study acceptance

Create/retry/reopen without a PDF; actual Python/R, reviewed SPSS imports,
selection ancestry, grouped chart and typed source notes; explicit Agent sharing
and each write confirmation; PDF-free export and later real-paper association.
Verify cross-owner/hash/page errors, atomic receipts, migration rollback, all25
old table values, original files and conditional nullability constraints.
Concurrent writer plus nested reads must complete; outer failures roll back all
nested writes. Native mobile/zh-en, actual provider and old PDF paths are required.
Details: [DATA-FIRST-STUDY.md](DATA-FIRST-STUDY.md).

## v0.18 unified search

Verify default/false response compatibility, literal Unicode matching, per-group
bounds and order, current edits/deletion/restoration, typed null-page anchors,
one-snapshot concurrent reads and zero material writes. Native tests require
study/PDF source navigation, drafts, late query/clear/retry, safe literal markup,
keyboard/zh-en/390px/blue, no automatic sharing/model calls and no study PDF request.

## v0.19 paired t-test

Requirements S01–S10 are recorded before implementation in paired-ttest-v1/SCENARIOS.md.
Require strict paired ID/two-column/design parameters, complete-pair counts and
exclusions, exact IDs, missing/duplicate/constant/nonfinite boundaries, independent
60-digit numeric references, old hashes, actual worker and failure cleanup, all
artifact checks, Notebook/export and confirmed Agent/task flow. Native UI covers
review/retry/source notes/method labels, real configured model/public sleep and
old method workflows. schema13/all28 live rows and source bytes must be preserved.


v0.20 presentation and entry requirements: [RESULT-WORKFLOW.md](RESULT-WORKFLOW.md).
Scenario matrix: E:/research-workbench-pilot-20261030/result-workflow-v1/SCENARIOS.md.
Verify compact and exact result values, p/null/unbounded CI boundaries, per-owner
disclosure state, explicit sharing, draft-only assistant entry, source-note actions,
Chinese/English mobile UI and affected prior workspace/task paths.


v0.21 reading/library requirements: [READER-LIBRARY.md](READER-LIBRARY.md).
Scenario matrix: E:/research-workbench-pilot-20261030/reader-library-v1/SCENARIOS.md.
Check actual PDF selection geometry, visible unsaved/saved excerpt destination,
content purge and reference retention, menu/metadata retries, recoverable paper
trash, late-owner safety, schema migration, storage failures and bilingual mobile.


v0.22 text markup and pinned-source requirements: [TEXT-ANNOTATIONS.md](TEXT-ANNOTATIONS.md).
Matrix: E:/research-workbench-pilot-20261030/text-annotations-v1/SCENARIOS.md.
Verify native multi-line geometry, style/comment/quote separation, lifecycle and
export, atomic retries, explicit removable Agent pins, server-resolved versioned
sources, legacy hash compatibility, real configured-provider synthetic acceptance
and unchanged old table/file/runtime boundaries.


## v0.23 reading tools

Scenarios were enumerated before changes in reading-tools-v1/SCENARIOS.md.
Require literal full-document find/no-hit/limits/error/cancellation, exact page
and per-line focus, current-text/original-quote filters, visible-only multi-select,
atomic eight-reference budget and explicit source-resolved Agent send. Exercise
native continuous scrolling, non-first-page text/region anchors, mixed rotation,
200-page canvas budgets, single-page fallback, zoom/source navigation, keyboard,
mobile/bilingual/theme and old note/task/data workflows. Preserve schema15/31
tables, materials, runtime recipes and independent tFUS boundary.


## v0.24 reading continuity

P01 continuous page/within-page restore after reload/reopen, no bootstrap overwrite; P02 independent positions for identical filenames/different bytes; P03 single-page, boundaries and mode changes; P04 explicit note/image/page/data/analysis/chart precedence; P05 corrupt/oversized/wrong owner or SHA/invalid bounds ignored; P06 denied/quota storage failure remains usable; P07 delayed owner switches and hidden reader retain lifetime ownership; P08 mobile/rotated/blank/200-page bounded rendering; P09 existing annotation, excerpt, find, filters, drafts, batch Agent and task/grant regressions; P10 local-only bilingual accessible status and fresh-browser defaults; P11 backend regression and guarded preservation of live data/tFUS boundaries. See [READING-PROGRESS.md](READING-PROGRESS.md).


## v0.25 portable native PDF annotations

A01 real file/pages/text/original integrity; A02 multiline gaps/four colors/revised comment/immutable quote/Unicode/existing annotations; A03 all rotations/crops/nonzero origins/inherited rotation/UserUnit/short and last pages; A04 active saved lifecycle and old ZIP; A05 empty/missing/trashed/study/corrupt record/source; A06 strict note/rectangle/payload/input/output/protocol limits; A07 busy/timeout/crash/spawn/storage/disconnect cleanup and continued reading; A08 fixed snapshot under concurrent edits and rechecked source; A09 actual browser download/draft/pending/owner identity; A10 visible retry/keyboard/mobile/themes/bilingual; A11 reading/find/filters/references/progress/analysis/tasks compatibility; A12 guarded backup and complete live table/file/source/tFUS preservation. See [ANNOTATED-PDF.md](ANNOTATED-PDF.md).


## v0.26 generic Agent reading and table replies — scoped smoke

Follow the user's smoke-only instruction. Verify ordinary chat over two associated synthetic PDFs, follow-up columns, actual source/page bindings and historical-ref remapping; reject unrelated/unlinked/changed papers and preserve note-write scope; mark empty/truncated pages. Verify inline table rendering, source links/new tabs, history reload, copy/CSV provenance and formula handling, failed clipboard, literal hostile HTML/unknown refs/malformed/oversized tables, local overflow, existing window controls and bilingual/mobile themes. Actual-provider pilot uses only labelled synthetic sources. No dedicated comparison UI/schema. Scenario/result evidence: E:/research-workbench-pilot-20261030/agent-reading-v1.


## v0.27 correlation — scoped smoke only

Requirement scenarios at E:/research-workbench-pilot-20261030/correlation-v1/SCENARIOS.md. Verify actual Pearson/Spearman R output with independent numeric references, complete-pair exclusions/ties, negative/perfect/small-n behavior, invalid/constant/unconfirmed/stale data, preview-vs-run and exact retry, full artifact integrity/Notebook/export, old payload/recipe fingerprints, explicit Agent sharing/approval and continuous analysis→scatter→note. Existing panel/Agent card, invalid metadata rejection and mobile bilingual themes receive scoped browser checks; no full regression suite.


## v0.28 · online data references — scoped smoke

D01 metadata identity/provenance/access; D02 exact relationship evidence versus keyword candidates;
D03 invalid/missing/non-dataset/malformed/oversized responses; D04 fixed GET hosts/no redirects or
files/bounded retry and query cache; D05 provider failures/partial/empty distinction; D06 pending/
confirm/reject/retry/reopen; D07 forged/historical refs, cancellation and changed source/association;
D08 safe citation/list new-tab links without render-time external traffic; D09 rich note/export/
bilingual/mobile preservation; D10 configured-model public metadata -> explicit note confirmation;
D11 schema/materials/tFUS boundary preservation. Scenarios and evidence are at
E:/research-workbench-pilot-20261030/online-data-v1. No full regression suite.


## v0.28.1 · scoped bibliography/layout smoke

B01/B02 verified DOI or bounded local PDF metadata -> unsaved fields -> explicit existing Save;
B03 fixed public transport/invalid IDs/provider/worker/source failures with no writes; B04 manual
edits, async field/document changes and revision/exact retry protection. R01 actual pane widths,
fit/custom scale, page/drafts/mobile; R02 white canvas margins through rapid zoom, fractional DPR
and single/continuous views, preserving real black content. C01 schema/material/legacy/tFUS
boundary checks. 8 backend +9 main browser +3 edge groups and public metadata smoke passed.
No full regression. Evidence: E:/research-workbench-pilot-20261030/bibliography-layout-v1.


## v0.30 · paper purge scoped smoke

P01 readonly preview/cancel; P02 complete owned paper/notes/assets/data/results/Agent erasure;
P03 revision/content/restore/busy/link/foreign-reference atomic rejection; P04 stable idempotent
retry and410 access; P05 occupied-file pending rows/reload/restart recovery; P06 missing files,
unsafe keys and Windows junction isolation; P07 late upload/cache publication; P08 browser
confirmation, lost committed response, bilingual/keyboard/mobile and unrelated draft preservation;
P09 schema15→16 old31table/material/tFUS preservation. Synthetic-only deletion. No full regression.
See E:/research-workbench-pilot-20261030/paper-purge-v1/SCENARIOS.md and PAPER-PURGE.md.


## v0.31 · five-group scoped acceptance

N01–N04 actual selection/crop/inline caret/save/reopen/export and async/Undo/Redo/fallback;
A01 frozen/removable Agent draft refs, manual edits/images, limits, explicit sharing and send;
W01 anchored left/right pointer/keyboard/viewport/cancel/fullpage/compact;
S01–S03 bounded overview, actual coverage, empty/failed/provider/cancel/source integrity and
unchanged task approvals; V01 meaningful collapsed history, lazy cited/uncited evidence,
tables/proposals/partial errors/language/polling; C01 v0.30 compatibility, schema/material/tFUS.
Synthetic-only; no full regression. Evidence: E:/research-workbench-pilot-20261030/reader-experience-v2.

## v0.55.1 bibliography menu

The paper menu exposes Update bibliography in server mode, beside Rename and Trash.
It opens the clicked paper through guarded navigation, reveals bibliography on desktop
and mobile, then reuses lookup's unsaved draft and explicit Save flow. No API/schema change.
Device mode keeps network lookup unavailable; no implicit file upload is introduced.
Scoped browser smoke used two synthetic PDFs and intercepted lookup responses: current
and other-paper targeting, manual field preservation, explicit save persistence, query
failure/retry, blocked navigation with an unsaved drawing, mobile/English, and device
network isolation passed. No live DOI provider/model/analysis or full regression run.

## v0.55.2 startup feedback (not deployed)

A static status precedes the main app module, with a small independent script and
same-origin stylesheet. Actual initialization reports tools/workspace/library/paper
stages. Success hides it; 20s waiting offers explicit reload without forcing navigation.
Script failure offers retry. Saved English, keyboard access, phone layout and reduced
motion are supported. Existing library/PDF error recovery and data paths remain.
Scoped synthetic browser smoke passed delayed modules/library/PDF, late success,
script failure and successful explicit reload, server/device completion, English and reduced motion.
No public services were restarted: user requested batching updates to protect active use.
