# v0.12: reviewed SPSS data import

The existing analysis accepts immutable UTF-8 tables. SPSS originals carry labels,
formats and missing-value rules that a plain table does not encode. Preserve the
source, review its dictionary, and explicitly confirm a deterministic analysis
table rather than silently replacing the source with CSV. No project/shared-space
model or tFUS execution/identity boundary changes.

The independent pyreadstat/ReadStat reader is pinned in an isolated runtime.
`RESEARCH_IMPORT_ROOT` or `--import-root` points at its manifest. No source paths,
URLs, commands or package choices come from the user or Agent. The parser is a
bounded child with a minimal environment, not a general security sandbox.
The verified Windows child has a 512MiB commit-memory limit and a 12-second timeout.

API, same local boundary/error envelope:
- GET /api/v1/data-imports/status -> available, adapter/version, limits; no paths.
- GET /api/v1/documents/{doc}/data-imports -> {items:[import,...]}.
- POST same: file (.sav/.zsav), request_id(UUID); 201 new/200 exact replay.
- GET /.../data-imports/{id} -> import with metadata and preview.
- GET /.../data-imports/{id}/file -> verified unchanged original.
- POST /.../data-imports/{id}/confirm: {source_sha256,review_sha256,acknowledge:true}.
  201 first/200 repeat, returns the ordinary immutable dataset. Review/source
  drift ->409. Unknown fields and absent explicit acknowledgment ->422.

An import has id,document_id,original_filename,byte_size,sha256,created_at,
status:pending|confirmed,dataset_id:null|UUID,file_url,review_sha256 and review.
Review: row_count,column_count,encoding,reader,policy,columns,preview,
analysis_preview,sample_truncated. Dictionary columns contain name,label,
source_type,format,measure,value_labels:[{value,label}],missing_ranges:[{lo,hi}],
system_missing,user_missing,blank_missing,nonmissing,numeric.

The fixed policy retains codes without replacing them with labels, maps system
and declared user missing values to empty analysis cells, preserves text, and
uses the reader's ISO date/time representation as nonnumeric text. Whitespace-
only text remains original text but is treated as empty by the existing table
analysis. Raw source preview and dictionary remain available. No automatic
study-design, unit, ID or group-role inference; the user checks field meanings.

Original <=5MiB, expanded table <=5MiB, 1..50 unique columns, 1..50000 rows,
cells <=2048 chars, preview 5 rows/200 chars, dictionary <=512KiB. Imports max20
and original+staged normalized bytes <=100MiB per paper. Existing dataset quota
continues independently. A pending import cannot be analyzed. Confirmation
atomically inserts the dataset and links it, keeping original/dictionary and
conversion provenance. Confirmation retries and concurrent requests create one
dataset. Originals and normalized artifacts are checked against stored hashes.

Additive schema9->10 adds only data_imports. Existing 21 tables retain rows.
Old CSV/TSV API, analysis/Agent tools and jobs remain valid. Analysis exports for
imported datasets add original.sav (or .zsav), data-dictionary.json and
import-provenance.json with manifest hashes. No automatic model upload.

Frontend: text-only Synrise Neuro branding; separate "Import SPSS" entry in the
data panel, bounded literal dictionary/preview, missing policy and acknowledgment,
explicit confirm, exact uncertain retries, persisted pending review, original
download, no automatic analysis or sharing. Confirmed data enters the existing
dataset selector. Chinese/English, keyboard and 390px must work.

Sources: https://github.com/Roche/pyreadstat and
https://ofajardo.github.io/pyreadstat_documentation/_build/html/index.html .
haven remains an alternative; this slice uses the direct Python file
component, not a whole application or the unstable jmv package.
