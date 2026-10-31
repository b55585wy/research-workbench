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
