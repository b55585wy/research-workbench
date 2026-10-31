# v0.3: editable notes, recoverable deletion and explicit source review

Local single-user only. Existing PDF bytes, note IDs/page/rect/created_at and PNG
bytes/metadata stay unchanged. Original creation text is retained internally;
editing changes a separate current-text state. No source/rectangle editing.

## User behavior

- Edit the text/optional rich formatting of an existing active note; save/cancel explicitly. Creating a new
  note remains separate, including any unsaved creation draft.
- Mark “I checked the original source” or return it to “Needs checking”. This is
  the caller's self-reported reading confirmation, not authenticated identity or
  scientific validation. Do not infer review from note text or automatically mark
  the existing four AI notes. Text/format changes reset review unless a request explicitly
  confirms the new text. The UI uses separate edit/save and review actions.
- Delete moves a note to a document-specific recoverable list. It hides the note
  and its image from active lists/source/image URLs and exports, but keeps bytes.
  Restore recovers the same note, source and image. No permanent deletion.
- Export only active notes, current text and review status in HTML/Markdown/JSON.

## Additive API (original note JSON keys remain the same)

- GET /api/v1/documents/{id}/note-states -> {"items":[state,...]}, including deleted.
- GET /api/v1/documents/{id}/notes/{note_id}/state -> state, including deleted.
- PATCH /api/v1/documents/{id}/notes/{note_id}: JSON
  {"request_id":"UUID","expected_revision":1,"text":"..."} and/or
  "review_status":"unreviewed" | "source_checked"; at least one change field.
- DELETE /api/v1/documents/{id}/notes/{note_id}: JSON
  {"request_id":"UUID","expected_revision":1}.
- POST /api/v1/documents/{id}/notes/{note_id}/restore: same mutation JSON.

State has the six original note fields plus revision (initial1), review_status,
reviewed_at (UTC or null), review_provenance ("self_reported" only if checked),
updated_at and deleted_at. Successful mutation returns state. Same-content/no-op
actions need not increase revision. Meaningful changes increase revision once.
Deleting/restoring unchanged text preserves its review status and timestamp.

expected_revision prevents lost updates; conflict409 revision_conflict. Reused
request_id with another payload/note/action -> idempotency_conflict409. A lost
response retry reuses the original request_id/expected_revision; no second change.
If a later mutation has happened, that older retry reports revision_conflict rather
than returning stale state. Invalid fields/null text/empty text/oversize ->422;
missing/wrong-document objects404; editing a deleted note -> note_deleted409.

GET notes returns active effective text using the original JSON keys. POST note
creation retains its original request-id comparison even after text is edited;
retries return the current active text, never overwrite it or restore a deletion.
Excerpt/image operations exclude deleted notes. An image begun before deletion
must not commit as an active image after deletion. Export takes one consistent
snapshot and omits deleted notes/images; original PDF remains included.

Database schema2 ->3 adds note_states and note_operations, preserving all existing
documents/notes/excerpts verbatim. State is backfilled as unreviewed, never parsed
from text. Future schemas are refused. Back up latest live data before activation.

## Frontend

Actual Kimi changes only frontend/index.html, styles.css, app.js in this candidate.
Root handles backend/tests/integration. Keep v0.2 layout/tokens and all selectors.

Load states separately with document/sequence/abort guards. Add an explicit status
badge and native per-note edit/review/delete buttons, plus a collapsed deleted
notes list with restore buttons. Use the existing editor in an explicit edit mode
or a small inline editor. Do not lose creation drafts when editing; no source
reselections during edit. Cancel returns to creation. Preserve edit drafts across
navigation; delayed old saves cannot alter another paper/editor.

Capture mutation payload, request_id and expected_revision once; retain them on
uncertain failure. A conflict keeps the draft; never silently refresh revision
and overwrite. Offer viewing refreshed notes without discarding the edit draft;
discard/reload requires explicit user action. Any pending mutation disables
conflicting note actions/export. An unsaved edit must be saved or cancelled before
exporting. Delete has a native confirmation explaining it can be restored.

Text-safe DOM, Chinese/English, keyboard/mobile, visible status/error/retry. Review
button confirms only persisted text, disabled during editing/pending saves. A
deleted URL should explain recovery rather than silently selecting another note.

Stable selectors: data-action="edit-note" / "review-note" / "delete-note" /
"restore-note" on buttons inside the corresponding data-note-id item;
data-testid="deleted-notes-toggle" / "deleted-notes-list" / "edit-cancel";
data-review-status on active note li. Keep .note-open as the source button and
all previous IDs; no nested buttons. Text editing may reuse note-text/note-save,
with an explicit edit-mode label. Internal revisions/UUIDs stay out of normal UI.

v0.8 adds optional structured formatting and one sparse table (schema7), without
rewriting original16-table rows. Rich content shares the note revision, conflict,
retry and deletion lifecycle. State text and rich content must be from the same
snapshot; never merge independently arriving bodies. HTML/JSON exports preserve
formatting, safe Markdown preserves text. See [RICH-NOTES.md](RICH-NOTES.md).
