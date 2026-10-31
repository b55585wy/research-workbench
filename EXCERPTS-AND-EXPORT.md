# v0.2: source-bound image excerpts and portable reading records

The original document/notes APIs and their JSON remain unchanged. This is an
additive feature for the local single-user research app. Changes are validated
in an isolated copy before integration; schema1 data is preserved by migration.

## Behavior

- User selects a PDF region and writes a note. “Save image excerpt” saves the
  note, then generates a PNG from the ORIGINAL stored PDF using that saved note's
  immutable page/rect. It is independent of browser zoom and screen resolution.
- Existing region notes also have “Create image excerpt”. Whole-page notes keep
  their existing behavior; image excerpt creation requires a non-null rectangle.
- Images are derived visual excerpts, not automatically recognized table data.
- Export downloads a ZIP with index.html (offline browser view), README.md,
  notes.json (original
  text, IDs, page/rect, timestamps), images/*.png, source.pdf, and manifest.json
  (document/source identity and SHA-256 of included files). Relative links work
  without the app. Source PDF links include #page=N; exact rectangles remain in
  notes.json. No credentials or absolute machine paths in the bundle.

## Additive API contract

- GET /api/v1/documents/{id}/excerpts -> {"items":[excerpt,...]}.
- POST /api/v1/documents/{id}/notes/{note_id}/excerpt (no request body): 201 for
  new, 200 for an existing verified image. One immutable image per note. A retry
  never creates a second note/image. Rendering runs in a bounded child process.
- GET /api/v1/documents/{id}/notes/{note_id}/excerpt -> image/png, with an inline
  filename. Missing or corrupt referenced bytes report an error, not false success.
- GET /api/v1/documents/{id}/export -> application/zip attachment.

Excerpt: note_id, document_id, page, rect, source_sha256, sha256, byte_size,
width, height, created_at, image_url (same-origin relative GET URL above).
The source identity and coordinates come from server records, not client image
bytes. PNG dimensions <=2048 per axis / <=4,000,000 pixels; at most 8 MiB. One
render at a time, 12-second timeout, 429 when busy. Export input bytes <=128 MiB;
build on disk and remove the owned temporary ZIP after response or on failure.

Errors keep the existing structure. New codes: region_required (422),
source_changed (409), renderer_busy (429), renderer_timeout/renderer_failed
(422), renderer_unavailable (503), excerpt_missing/excerpt_corrupt (409),
export_too_large (413). Missing objects 404; invalid UUIDs 422; storage failures
503. Export fails if referenced PDF/images are missing or changed.

Database upgrade is additive: schema1 -> schema2, new excerpts table referencing
notes(id). Preserve original documents/notes verbatim. Refuse future schema
versions. Back up the latest live database before activation.

## Frontend state contract

Actual Kimi owns frontend/index.html, styles.css and app.js for frontend work.
Add export in the current paper toolbar, image-save beside note-save, and an
image preview/action to each saved region note. Keep the existing layout/tokens,
Chinese/English, keyboard/mobile, stable selectors and all v0.1 behavior.

For note + image saving, capture document/page/rect/text/request_id and intent
once. If note creation succeeds but image generation fails, retain that draft and
request_id, show partial failure honestly, and retry BOTH idempotent steps. Clear
the draft only when all requested steps succeed. Add includeExcerpt intent to
per-document draft state; a plain retry must not silently drop image creation.
Existing-note image actions never overwrite/clear an unrelated draft.

GET excerpts is separate from GET notes, with the same document/sequence/abort
guards. Old delayed image responses cannot enter another document's view. Image
download and ZIP export capture the selected document; switching papers must not
retarget the request. Disable duplicate/pending conflicting actions and export
while the requested save/excerpt is pending. Use textContent for user text.

Stable selectors: excerpt-save, export-reading-record, excerpt-image (inside the
note li), data-action="create-excerpt" inside note li; preserve data-note-id on
li and all previous test IDs. Keep note-open as a real source button; don't nest
buttons/links inside it. Export uses checked fetch + blob download, with visible
failure and retry instead of opening raw JSON in a new tab.
