# v0.10: traceable interactive experiment charts

Account status: local single-user only. There is no login/multi-user authorization
API or implemented transferable authenticated actor contract. Local initiator and
manual/agent_proposal origins are workflow metadata, not authenticated identities.
The tFUS main worktree's W10-A documents already confirm tFUS local member
accounts as the first authoritative directory. Its Actor contract and account/
project/research base authorization source exist, but full-entry authorization is
unfinished and undeployed. The research workbench has not integrated them. Reuse
that identity source and validate server resource access when implementing shared
use; do not introduce a second user directory or treat unverified actor JSON as
authentication. This slice retains the loopback boundary.

First-principles decision: descriptive summaries cannot reconstruct distributions
or paired observations. Therefore analysis_counts reads an existing verified
successful analysis; histogram/scatter read the exact original dataset in a
bounded isolated Python process. The model chooses a registered capability and
fields, not a renderer script/package/command/URL. One original Plotly strict
renderer4.2.0 is enough for all three; no new platform or framework is deployed.

Charts are immutable derived records. Redraw creates a new record; delete/restore
only changes lifecycle/revision. Bounded canonical chart JSON is an SQLite BLOB,
so figure, lifecycle and Agent receipt commit atomically. Schema8→9 adds charts
and chart_operations only, retaining all19 previous tables.20 charts/paper,
4MiB/chart, source dataset limits5MiB/50000rows/50columns remain. No cloud setup.

## Public API

GET `/api/v1/charts/capabilities` -> `{items:[{id,title,recipe_sha256}],renderer,
limits:{data_bytes:4194304,charts_per_document:20,rows:50000},arbitrary_code:false}`.
Kinds: analysis_counts, histogram, scatter. renderer is
`{id:"plotly-strict",version:"4.2.0",sha256,byte_size,
script_url:"/vendor/plotly/4.2.0/plotly-strict.min.js"}`.

Prefix P=`/api/v1/documents/{document_id}/charts`.
GET P -> `{items:[record,...]}` newest first, including recoverable trash.
POST P/preview -> `{chart:preview_descriptor,data:artifact}`, read-only.
POST P ->201 created /200 exact retry. Both take the same closed JSON:
`{request_id:UUID,dataset_id:UUID,dataset_sha256:hex64,kind,title,
analysis_id:null|UUID,x:null|string,y:null|string,bins:null|integer,
recipe_sha256:hex64,renderer_sha256:hex64}`.
Title trimmed1..120 without controls. analysis_counts requires analysis_id and
null x/y/bins. histogram requires numeric x, null y/analysis_id, bins2..50(default20).
scatter requires distinct numeric x/y and null bins/analysis_id. Unknown fields,
bool numbers, conflicting irrelevant fields fail422. No implicit transformations,
aggregation, smoothing, inference or unit conversion. Empty cells only missing.
Histogram bins are equal-width on IEEE754-converted source values, computed with
Decimal boundaries; left closed/right open except final bin includes maximum;
all-equal data uses one bin. Scatter excludes any pair with an empty cell and
reports exact used/excluded counts. No complete pairs ->422.

GET P/{id} -> record; GET P/{id}/data -> exact canonical artifact JSON, no-store,
X-Content-Sha256 header. Deleted record data/export unavailable409; metadata and
list retain it. DELETE P/{id} and POST P/{id}/restore take
`{request_id:UUID,expected_revision:integer>=1,data_sha256:hex64}`. Exact retries
match action/content/revision; conflicts409. GET P/{id}/export -> ZIP.

Record: `{id,document_id,source_sha256,dataset_id,dataset_name,dataset_sha256,
analysis_id,kind,title,spec:{kind,title,analysis_id,x,y,bins},recipe:{id,version:1,
sha256},renderer,summary,origin:manual|agent_proposal,revision,created_at,updated_at,
deleted_at,data_sha256,data_byte_size,data_url,viewer_url,export_url}`.
viewer_url=`/?document=...&chart=...`. Preview descriptor uses request_id as id,
origin preview, revision0, created_at/updated_at null and URLs null. It is never
an authenticated identity or a saved record. All provenance appears in details.

Artifact: `{format:"research-chart/v1",document_id,dataset_id,dataset_sha256,
analysis_id,kind,title,spec,recipe_sha256,renderer_sha256,summary,series}`.
Summary: `{row_count,used_rows,excluded_rows,columns:[names],...}`.
analysis_counts series `{columns:[names],valid:[ints],missing:[ints]}`.
histogram series `{labels:[interval strings],counts:[ints],lower:[decimal strings],
upper:[decimal strings]}`. Equal-width bins include empty bins; labels are literal.
scatter series `{x:[finite numbers],y:[finite numbers],rows:[1-based record index]}`.
Series are tightly validated; never pass arbitrary traces/layout/HTML to Plotly.

ZIP includes source.csv/tsv,chart.json,specification.json,provenance.json,
chart.html,plotly-strict.min.js,chart-export.js,LICENSE and manifest hashes.
The fixed chart-projection.py/tabular.py calculation source snapshots are retained
at save time and included, with their combined recipe hash checked on export.
analysis_counts additionally includes an analysis-record.json with its verified
result/code provenance. The chart's own exact data plus pinned original renderer
reproduces its figure offline. Plain static table remains available on JS failure.

## Agent and notes

Tools: chart_capabilities,list_charts,read_chart,preview_chart,propose_chart,
propose_chart_delete,propose_chart_restore. Read/propose/preview require the exact
dataset explicitly shared at Send. preview_chart returns bounded summary (not full
series), never writes. propose_chart freezes all API fields; existing confirmation
transaction invokes the same service, creates origin agent_proposal. Lifecycle
tools use exact revision/hash. Rejection/cancel/conflict cannot silently save.
Optional context.active_chart_id requires the explicitly shared matching dataset;
absent/null keeps old frozen request fingerprints. Capture provides record metadata
and summary, not full raw data. read_chart adds a chart_result source ref with
chart id/hash and persistent URL. A proposed result note appends that URL.

## Frontend scope: actual Kimi via OMP only

Add `frontend/charts.js`,charts.css,chart-export.js (classic offline script), plus
minimal index/app/assistant/analysis glue. Root owns APIs/assets/tests/acceptance.
Collapsed charts section near current analysis, selected dataset and saved analysis
source controls, kind/title/x/y/bins controls, explicit Preview then Save. Show source
name, selected fields and excluded rows; avoid claiming units or scientific evidence.
Use original lazy Plotly4.2.0 with script SRI matching renderer hash. Existing strict
CSP remains. Native browser interactions need no model calls. Saved list includes
View, Export, Use as new draft, Add citation to new note, Delete/recover. Saved
figures never edited in-place. New note link should preserve existing drafts and
source anchors; never overwrite an editing note or auto-review it.

Plot rendering uses only built-in safe traces/layout: grouped bars for counts,
contiguous bars for histogram, scatter markers for paired raw observations. Escape
all user titles/column labels because Plotly interprets text markup. No external
URLs/templates/map/mathjax/download services. Hover, zoom/pan/reset and local PNG
download. Both themes preserve data colors, zh/en,390px/focus/keyboard. Destroy with
Plotly.purge, observer/listener teardown, object URLs revoked. Capability/SDK/data/
preview/save responses must remain bound to captured paper/request; preserve per-
paper drafts and exact uncertain-save body until explicit cancellation. Changed
inputs invalidate successful preview; no Save before matching preview exists.

Saved data streaming limit4MiB, exact SHA/byte size/MIME and identity/spec checks.
No arbitrary URLs from replies. Failed SDK loads remove failed script and retry;
successful module reused. Active chart captured at Send only when dataset shared;
badge states metadata/summary only. Proposal card shows title/kind/fields/data source,
Preview button invokes read-only preview, then existing explicit Confirm/Reject.
Saved result opens exact chart/deep link; chart_result source refs navigate to it.
Current Python/R/image/rich/Notebook/PDF workflows and191 browser groups preserved.

Stable IDs: charts-panel,chart-kind,chart-title,chart-x,chart-y,chart-bins,
chart-dataset,chart-analysis,chart-preview,chart-save,chart-cancel,chart-status,
charts-list,charts-deleted,chart-plot,chart-summary,chart-details. Chart items carry
data-chart-id; actions open-chart,export-chart,clone-chart,chart-note,delete-chart,
restore-chart. Proposal preview action preview-chart. Expose module callbacks for
getActiveChartId(documentId),getActiveChart(documentId),clearActiveChart(documentId),
reload(documentId),openChart(documentId,id),previewProposal(documentId,proposal).
Offline chart-export.js reads #chart-data application/json and uses window.Plotly;
classic script with no module imports/fetch supports file://. root generates HTML.
