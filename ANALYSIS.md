# v0.6 analysis contract preserved in v0.7: Python and R

## Scope and derivation

Unverified assumptions: no real study dataset is selected; R is not installed;
sharing a model connection does not confer script permissions or tFUS identity.
Verified constraints: a process can fail independently, inputs change unless
their bytes are checked, an acknowledged request can lose its response, and
computed numbers require a successful execution and validated outputs.
Therefore: immutable uploads, hash-bound explicit approval, persistent request
receipts, an independent OS worker and actual Python/R execution. Putting work
inside a web request would couple its lifetime to the browser/server handler.
No tFUS queue, script catalog, host rule, account database or routing change.

Deliver one operation: describe selected numeric columns of UTF-8 CSV/TSV.
Count/non-missing/missing, mean, median, sample SD (n-1), minimum and maximum.
Empty cells are missing; strings such as NA are text, not silently recoded.
Numeric columns require all nonempty cells to be finite decimal numbers, at
least one present value. No clinical interpretation or statistical inference.
Python and base R run fixed, reviewable versioned scripts on normalized numeric
TSV; no user/model-selected paths, commands, packages, URLs or arbitrary code.
Custom scripts and downloaded data remain separate future slices. The process
boundary/resource limits are not a general security sandbox.

## Data and worker

Additive schema5->6, preserve all 14 existing tables verbatim. New datasets and
analysis_jobs tables only. Originals immutable; preview literal/untrusted data.
Upload max5MiB, 1..50 unique trimmed headers (max100 chars, no controls),
1..50000 rows, max2048 chars/cell. UTF-8/BOM; delimiter by .csv/.tsv; reject
ragged rows, malformed quoting, invalid encoding and nonfinite numeric tokens.
Max20 datasets/100MiB per paper. Parser uses a bounded child process.

One independent OS worker for this data directory, separate from model worker.
SQLite queue max3 active globally, max20 records/paper; task max30 seconds,
bounded artifacts/logs and a minimal runtime environment with no model secrets.
Worker owns its engine child and terminates it on cancel/shutdown/timeout.
Startup marks unfinished queued/running tasks interrupted, without code replay.
Request UUID retries return the original job, including terminal outcomes.
Input and recipe checked at creation and again before execution. A stale or
tampered output is never downloadable as valid. Cancellation never publishes
a late success. Output data/receipts commit together after checks.

## API (all current local boundaries and error envelope unchanged)

GET /api/v1/analysis/status:
{engines:[{id:python|r,available,version,recipe_sha256}],recipe_id:"describe-v1",
recipe_version:1,limits:{file_bytes:5242880,rows:50000,columns:50,seconds:30},
worker_state:idle|running|unavailable,scope:"local_research",arbitrary_code:false}.
Version is actual probed version; unavailable engines have no fake success.
GET /api/v1/analysis/recipes/{engine} ->
{engine,id:"describe-v1",version:1,sha256,code}. Render code as literal text.

GET /api/v1/documents/{doc}/datasets -> {items:[dataset,...]} newest first.
POST same: multipart file,request_id(UUID). 201 new/200 identical replay;
409 conflicting UUID/doc/name/bytes. Dataset JSON: id,document_id,
original_filename,byte_size,sha256,created_at,row_count,column_count,
columns:[{name,numeric,nonempty,missing}],preview:[[string,...],...](max5 rows),
sample_truncated,file_url. No internal path. GET /.../datasets/{id}/file ->
verified original download. GET /.../datasets/{id} -> same dataset JSON.

GET /api/v1/documents/{doc}/analyses -> {items:[job,...]} newest first.
POST same JSON {request_id:UUID,dataset_id:UUID,dataset_sha256:hex64,
engine:python|r,columns:[unique names1..50],recipe_sha256:hex64}.
This POST is the explicit approval of the displayed exact input/parameters/code.
201 accepted/200 replay; stale dataset/recipe or busy queue ->409; invalid ->422.
GET /.../analyses/{id} -> job. POST /.../{id}/cancel with {} -> job;
terminal cancel is idempotent and cannot change a completed result.
GET /.../{id}/log -> {text,truncated}; safe bounded runtime output.
GET /.../{id}/files/{name} -> verified allowlisted artifact, never arbitrary path.
GET /.../{id}/export -> ZIP of original input, normalized input, exact code,
parameters/environment/provenance, logs, summary.json/summary.csv/chart.svg and
manifest hashes. Available only after successful validation. Reading ZIP stays
unchanged; analysis records have their own portable export.

Job JSON: id,document_id,dataset_id,dataset_name,dataset_sha256,engine,columns,
recipe:{id,version,sha256,code_url},status:queued|running|succeeded|failed|
cancelled|interrupted,result:null or {row_count,stats:[{column,n,missing,mean,
median,sd,min,max}]},error:null or {code,message},created_at,started_at,
finished_at,engine_version,outputs:[{name,url,sha256,byte_size,media_type}],
log_url,export_url. Only succeeded jobs have result/outputs/export_url.
chart.svg shows non-missing counts, not comparisons of incompatible units.
CSV output escapes formula-like labels; JSON retains exact names.

## Agent integration

ReadingContext adds optional dataset_id (default null). UI selection for analysis
and "provide to assistant" are distinct. Only explicitly shared dataset at Send
contributes metadata and <=5-row preview to the configured model; never the full
CSV. Server validates paper/hash and captures the selected dataset snapshot.

Tools: list_datasets (metadata only), read_dataset (captured selection only),
propose_analysis (dataset_id,engine,columns), list_analyses (metadata only),
read_analysis (completed, verified result of selected dataset). All fixed tools.
run_analysis proposal payload includes document_id,source_sha256 (paper),
dataset_id,dataset_name,dataset_sha256,engine,columns,recipe_id,recipe_version,
recipe_sha256. Proposal hash and input/code are rechecked on confirmation.
Confirmed proposal atomically creates analysis_jobs + its receipt, using a stable
UUID. Receipt: {analysis_id,status:"queued",url:"/?document=...&analysis=..."};
queued is not completion. Agent confirmation wakes independent worker only after
commit. Existing notes/review/image behavior unchanged; source references expose
dataset_sample and analysis_result with actual file/result hashes. Result note
text can cite the persistent analysis ID/link; reading ZIP does not bundle jobs.

## Frontend contract (actual Kimi owns frontend only)

Extend existing neutral/blue native JS. New collapsed "数据与分析" section near
image library, no changes to ordinary reading flow. Upload CSV/TSV with progress,
clear errors and stable-UUID exact retry. Dataset selector, dimensions, literal
preview table with bounded own horizontal scroll; numeric column checkboxes;
Python/R choice and actual available/version status. Disabled engines explained.
Prepare action shows dataset/name/hash, columns, language and exact code before
"确认运行"; cancel preserves choices. Retain frozen request on uncertain errors.
Show actual task status/cancel, results table/count chart, safe log and export.
Persisted jobs load on reopen; only poll active jobs, sequence/paper guards.
Do not present queued/failed/cancelled/interrupted as successful analysis.

Add frontend/analysis.js/css; app.js adapts own shared state; assistant.js/css
renders new proposal concretely (data, language, columns, code SHA/code), polls
separately through analysis module after approval. Preserve existing 91 groups,
all old hooks, drafts, themes, keyboard, Chinese/English and 390px layout.
Expose module callbacks getSharedDatasetId(),reload(documentId),openJob(id).
Set optional dataset_id in assistant Send payload (or null), context badge.
Source navigation dataset_sample opens relevant dataset UI; analysis_result
opens exact job, including after paper navigation. No UI-selected arbitrary URL.

New stable IDs: analysis-panel,dataset-upload-input,dataset-upload-button,
dataset-upload-status,dataset-select,dataset-preview,dataset-columns,
dataset-share,analysis-engine,analysis-prepare,analysis-confirmation,
analysis-code,analysis-confirm,analysis-cancel-confirm,analysis-status,
analyses-list,analysis-result,analysis-log. Job items data-analysis-id,
cancel/export/open buttons data-action=cancel-analysis/export-analysis/open-analysis.
Column checkbox data-column. Stable request/paper binding; never insert HTML
from cells, source labels, model text or log output. No frontend server starts.

## v0.7 saved Notebook projection

GET /api/v1/documents/{doc}/analyses/{id}/notebook returns a verified,
deterministic nbformat4.5 projection, at most1MiB, not a new stored object.
Only succeeded jobs; archived code/output bytes and input hashes are checked.
Existing job JSON is unchanged. Analysis ZIP adds identical analysis.ipynb;
reading ZIP stays unchanged. See [NOTEBOOK-VIEW.md](NOTEBOOK-VIEW.md) for errors,
provenance, browser contract and the original JupyterKit component boundary.

ReadingContext additionally accepts optional active_analysis_id. At Send, UI
only includes a job belonging to the explicitly shared dataset. Server verifies
paper/job/dataset scope; no sharing ->409 agent_analysis_not_shared, wrong paper
->404. read_analysis adds bounded saved_code/saved_stdout/saved_stderr and a
notebook_url while preserving its old fields. Absent/null optional fields retain
v0.5/v0.6 frozen request hashes. Opening/downloading a Notebook never submits a
turn, queues a calculation or changes notes/review state. Schema remains6.
