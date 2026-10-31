# v0.7: verified saved-analysis Notebook view

## Decision and boundary

Reuse @jupyter-kit/core and theme-default 3.0.0, the standalone renderer used by
RSpace's reviewed Notebook implementation. Actual upstream renderer, not a new
renderer or RSpace business-module extraction. Native JS/FastAPI stay. Do not
deploy RSpace/Jupyter Server, add React, editors, kernels, execution plugins,
arbitrary notebook upload or a new Notebook database object. Schema remains6.
Preserve current data, job JSON and all existing APIs; no tFUS changes.

Fundamental constraints: current jobs already store code/outputs with hashes;
viewing must not recalculate them or silently substitute current recipe code.
Serialize a deterministic nbformat4.5 projection and let the original component
render it. Keep the original result table and analysis export usable.

## Backend contract

GET /api/v1/documents/{doc}/analyses/{id}/notebook -> standard .ipynb JSON bytes,
Content-Type application/x-ipynb+json, Content-Disposition attachment with safe
UUID filename, Cache-Control no-store. Same request and immutable inputs -> same
bytes. Only succeeded, source/output-verified current fixed jobs are supported.
Wrong paper/unknown ID ->404; queued/running/failed/cancelled/interrupted ->409
analysis_not_complete. Missing/tampered/invalid artifact ->409
analysis_output_changed (source errors remain dataset_changed). Max1MiB notebook
JSON; oversized view ->413 notebook_too_large, never partial success.

No field changes to existing job JSON. Construct URL from bound doc/job UUIDs.
Notebook contains readonly cell metadata and language_info python|r; no claimed
installed kernel, no execution_count invented (null). Static bilingual overview,
literal/fenced source summary, exact saved analysis.py/R, actual saved stdout/
stderr, verified summary table and existing SVG count chart. Display-only cells
are labelled saved artifacts. Full source data/normalized TSV stay in analysis
ZIP; do not embed full CSV or credentials into Notebook. Full source/code/result
hashes, IDs, real engine version and timestamps live in metadata.workbench.

Validate returned bytes against stored sizes/hashes after reading. Verify saved
script against recipe SHA, parameters against job identity/intent, and actual
summary against persisted result. Do not require equality with today's recipe
body. Notebook API never changes a job, note, review state or calls a model.

Existing analysis ZIP adds analysis.ipynb and its manifest entry; existing files,
source bytes and offline index stay. Notebook bytes in ZIP match GET bytes.
Reading ZIP remains unchanged. No runtime Python dependency added; official
nbformat validation is a development-only dependency.

## Agent context

ReadingContext adds optional active_analysis_id default null. Only attach it when
the currently selected analysis belongs to the explicitly shared dataset.
Capture and validate doc/job/dataset scope server-side; no client actor/state
trust. Absent/null preserves v0.5/v0.6 request hashes and uncertain exact retry.
Capture job ID/status/engine/columns as context; full output/code still obtained
through validated read_analysis. Unshared or mismatched analysis ->409
agent_analysis_not_shared. Cross-paper analysis ->404.

read_analysis retains result/source fields and adds saved_code, saved_stdout,
saved_stderr (bounded strings) and notebook_url. No image/base64 notebook is sent
to the model, no additional write/run tools. User must send explicitly; opening a
view does not submit a turn. Existing analysis source/confirmation semantics stay.

## Frontend — actual Kimi only

Extend analysis.js with a Notebook view action for succeeded jobs. A small module
analysis-notebook.js/css hosts the actual renderer in an accessible native dialog.
Use provided /vendor/notebook/renderer.js exports createRenderer,python,r, and
/vendor/notebook/renderer.css. Core is lazy-imported only when opened. No custom
cell/table/image renderer, unsafe HTML, React, iframe or external CDN.
SDK options: supported languages, language from notebook metadata, filename.
No editor/executor/plugins. destroy() on close/disposal. SDK Ctrl+S listener is
root-local; keep keyboard behavior scoped and restore focus after close.

Dialog has localized title/read-only notice, loading/error/retry, Close and
Download .ipynb. Use the exact fetched verified bytes for download; no inferred
Notebook object serialization. Bound fetch body<=1MiB even without Content-Length.
Fail on invalid version/cells/metadata instead of showing a false success.
Keep source/metadata strings literal. Retain dataset/job name and scope captured
at Open; abort and discard stale results after close, switching paper or another
job. Viewing preserves manual note/metadata drafts, selection, current jobs,
theme, Chinese/English, 390px layout and original PDF/image pixels.

Keep the existing result table. Do not re-query a model or create a job to view.
Call current analysis selection as getActiveAnalysisId(): returns selected job ID
only if its dataset matches getSharedDatasetId(), else null. app.js/assistant.js
include optional active_analysis_id in frozen Send payload and a context badge.
No data-sharing checkbox is automatically checked by opening a view.

Hooks: data-action=view-notebook on result action; analysis-notebook-dialog,
analysis-notebook-title,analysis-notebook-status,analysis-notebook-content,
analysis-notebook-close,analysis-notebook-download,analysis-notebook-retry.
Dialog/content data-document-id/data-analysis-id for binding checks. Preserve all
old hooks. Add only frontend module/CSS and necessary index/app/analysis/assistant
glue. Root owns vendor build, backend/contracts/tests/servers/deployment.
