# v0.4: searchable paper library and editable bibliographic metadata

Single-user local application. Preserve original PDF bytes, original document
records/IDs and all note/source/image/review records. No external fetching,
analysis execution, account or shared workspace in this iteration.

## API contract

Existing document JSON keeps its seven keys: id,title,original_filename,
page_count,byte_size,sha256,created_at. Its title reflects saved metadata.

- POST /api/v1/documents remains multipart `file`. Add optional multipart field
  `deduplicate=true` for the NEW UI. Omitted/false keeps legacy import behavior.
  With true:201 new document,200 existing exact-byte document; same seven keys.
  Same filename/title but different PDF bytes creates another document. Existing
  legacy duplicate records are never merged. Reuse the oldest exact-byte record,
  retain all original notes, verify its stored source before returning success.
  Concurrent opted-in imports must create at most one new record/file.
- GET /api/v1/documents/{id}/metadata returns seven effective document keys plus
  authors (free text,default empty,max2000), year (integer1..9999 or null), doi
  (free text,default empty,max255), revision(initial1),updated_at(UTC).
- PATCH same /metadata: request_id UUID,expected_revision strict positive int,
  and at least one of title/authors/year/doi. Title trimmed nonblank max180;
  authors/doi trimmed and can be cleared with empty string. year null clears it.
  Explicit null title/authors/doi, NUL and extra fields ->422. These are manually
  entered bibliography fields, not externally verified identifiers or identity.
  Successful response is full metadata. Meaningful change increments revision
  once; no-op preserves revision/time. Stale ->409 revision_conflict. Lost
  response retry MUST reuse captured exact request_id and payload. Conflicting
  reused IDs ->409 idempotency_conflict; superseded retries ->409 revision_conflict.
  Missing document404. Save is atomic with its retry receipt.
- GET /api/v1/search?q=...&limit=40; q max200 chars,limit1..100 per result group.
  Trim query; empty gives empty groups. Literal substring, Unicode casefold,
  SQL wildcard punctuation is literal. No PDF full-text/OCR search claim.
  Response {query,documents:[...],notes:[...],has_more:boolean}.
  Document hits contain full metadata plus matched_fields (title,authors,year,
  doi,original_filename). Note hits contain current full note state plus
  document_title. Search ONLY current active note text; exclude deleted notes
  and superseded original creation text. Stable newest-created ordering.
  Both groups come from one consistent read snapshot. Returned notes keep real
  document_id/id/page/rect for reopening the saved source.

Metadata title must update legacy document list/detail, exports, reader headers
and search consistently. Export includes saved authors/year/doi in JSON and
human-readable HTML/Markdown. It never exports unsaved frontend drafts.

## Storage and compatibility

Schema3 ->4 adds document_metadata and document_operations; backfill title from
original documents, empty authors/doi,year null,revision1. Existing document,
note,excerpt,note_state,note_operation rows remain byte-for-byte unchanged.
Support schema1/2 upgrades via existing migration chain. Reject future schemas.
No new dependencies. Search scans the small local library with bounded results;
no search server or generalized indexing framework.

## Frontend (actual Kimi owns only frontend/index.html,styles.css,app.js)

Keep the current neutral bilingual UI, upload button, local PDF.js and selectors.
Add search in the left library panel; explicit submit and clear, keyboard usable.
Results distinguish papers and notes; note result opens actual source using
existing document/note navigation. Keep full document inventory for navigation.
Abort/sequence-guard old searches and document metadata loads. Clearing query
cannot be overwritten by an old response. Search errors must visibly say failed
with retry; never present an old query's results as the new query's results.
Searching/opening a result must preserve existing creation/edit drafts.

Add a collapsible bibliography panel in the reader area with title,authors,year,
doi; explicit edit/save/cancel, visible loading/error/retry/conflict. Empty optional
values are acceptable. Keep edit drafts per paper across navigation; note drafts
must not change. Capture request UUID,expected revision and payload once for
uncertain retries. Conflict keeps draft, offers view-latest; never silently
advance expected_revision and overwrite. Explicit cancel/re-enter is required
to discard conflicting edits. Delayed saves cannot modify another paper's form.
Editing metadata or pending metadata mutations disables export; note editing
and metadata saving must not erase each other's drafts. Use saved metadata
snapshot for both title display and expected_revision, analogous to note state.
New metadata controls cannot block reader/upload if metadata load fails.

Upload UI uses multipart deduplicate=true. Read HTTP status before parsing body:
200 means already in library/opened existing paper;201 means imported. Do not
report success if the PDF could not be stored/verified. Retry same uploaded file
after committed response loss must not create another document. Exact duplicate
must retain notes/metadata and open existing source. Normal sample upload remains
usable; do not silently create duplicate sample documents.

All content uses textContent; safe literal titles/authors/DOI/notes. No external
fetch/CDN,innerHTML or identity claims. Native accessible forms,Chinese/English,
390px mobile, no page overflow. Use existing fonts/tokens; no redesign or new deps.

Stable new selectors:
data-testid=library-search-input / library-search-submit / library-search-clear /
library-search-results / library-search-status. Results data-document-id; note
results also data-note-id; each has one native open button.
data-testid=metadata-toggle / metadata-edit / metadata-title / metadata-authors /
metadata-year / metadata-doi / metadata-save / metadata-cancel / metadata-status /
metadata-retry. A metadata form can carry data-mode=view|edit. Normal labels hide
revision/UUID jargon. Root owns backend/tests/server/browser acceptance; do not
start servers or edit contract/tests/config/data.
