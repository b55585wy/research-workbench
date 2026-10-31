# v0.9: original image viewer and source-bound rectangle annotations

## Constraints and decision

Do not assume image pixels are PDF page coordinates, browser EXIF handling is
uniform, or a library's in-memory events imply successful database persistence.
The component proof found raw oriented WebP size differs in Chrome. Existing
upload previews are already EXIF-normalized, metadata-free and bounded; saved
PDF excerpts are fixed PNGs. Use THESE as canonical frames, not raw upload grids.
Keep original downloads/bytes. Store normalized image-frame rectangles separately
from PDF notes. No original-image rewrites, measured values, OCR, polygon/freehand,
new cloud upload, shared-space objects or tFUS queue use.

Reuse original OpenSeadragon6.1.1 and @annotorious/openseadragon3.9.5 through native
JS APIs. Pinned local /vendor/image-annotations/viewer.js exports OpenSeadragon,
createOSDAnnotator,UserSelectAction,ShapeType, plus viewer.css. Upstream packages
are prebundled; preserve their licenses and installed runtime dependency notices.
This is independent library reuse, not RSpace business-code extraction.

## Source and coordinate contract

source_kind=user_upload|pdf_excerpt; source_id UUID (upload ID or parent note ID).
Source belongs to document UUID. Upload frame is existing normalized preview,
original SHA is source_sha256, frame SHA may differ. Excerpt source SHA is parent
PDF SHA and frame is its saved PNG. Deleted parent notes hide their excerpts and
annotations; restore re-exposes identical records. Do not auto-delete annotations.
No pixel/PDF mapping is inferred. Return actual frame dimensions, not raw EXIF
dimensions. Read/verify bounded bytes AFTER opening; frame<=8MiB,1..2048 per axis,
<=4MP; upload originals<=8MiB. Expected PDF size/hash checked for excerpts.

API prefix /api/v1/documents/{doc}/image-sources/{source_kind}/{source_id}
- GET prefix -> {source:descriptor,items:[annotation including deleted,...]} from
  one read snapshot. Descriptor: document_id,source_kind,source_id,label,
  source_sha256,frame_sha256,frame_width,frame_height,frame_byte_size,frame_mime_type,
  frame_url (prefix/frame),original_url (existing upload/file or note/excerpt),
  original_mime_type,original_byte_size,original_filename,page,rect,parent_note_id.
  page/rect for excerpts are PARENT PDF source only; null for uploaded images.
- GET prefix/frame -> verified exact bytes, image/png|image/jpeg, no-store,
  X-Content-Sha256 header. No arbitrary path/URL input, no regenerated frame.
- POST prefix/annotations -> {request_id,source_sha256,frame_sha256,rect,text}.
  rect=[left,top,right,bottom] normalized to THIS image frame, finite numeric
  fractions0..1, positive area; bool/string coordinates rejected. text.trim()
  nonempty<=2000,noNUL.201 created/200 same exact creation retry/current state;
  changed creation payload/origin409, retry deleted record409 annotation_deleted.
- PATCH prefix/annotations/{id} -> {request_id,expected_revision,source_sha256,
  frame_sha256,text? and/or rect?}; null/unknown fields rejected; require change.
- DELETE same path and POST same path/restore -> same version/hash mutation
  payload without text/rect. Recoverable deletion; unchanged restore/delete no-op.

Record: id,document_id,source_kind,source_id,source_sha256,frame_sha256,frame_width,
frame_height,rect,text,origin=manual|agent_proposal,revision,created_at,updated_at,
deleted_at,viewer_url. Original creation_hash remains internal. Source/frame stay
immutable. Changed text/rectangle/delete/restore advances revision exactly once;
no-op does not. Mutations have exact stable receipts; later state ->409
revision_conflict, conflicting UUID ->409 idempotency_conflict. Wrong paper/image
or annotation ->404. Missing/tampered/stale frame/source ->409, never a wrong view.
Quota100 total records per source and500 per paper (including recoverable trash).

Schema7->8 adds image_annotations and image_annotation_operations. Original17
tables/rows and bytes stay. Foreign keys and source-scope constraints bind rows to
existing uploads/excerpts. One transaction for state, receipts and Agent writes.
Do not create PDF notes from image-coordinate rectangles. No authenticated actor
is invented; origin records workflow provenance only.

## Export and Agent

Reading ZIP keeps existing files/JSON fields. With active annotations, add
image-annotations.json and optional image_annotations in notes.json. Include each
referenced frame and upload original once even without a PDF-note attachment;
omit deleted annotations/deleted-parent excerpts. HTML renders static SVG image+
rectangle overlays and escaped descriptions, no scripts/network. JSON retains
exact normalized rectangles, hashes, IDs, origins/revisions and relative paths.
Existing note/analysis exports and original image colors/bytes remain.

ReadingContext adds optional active_image {source_kind,source_id,annotation_id?}.
Server validates paper/source/annotation and captures descriptor+selected text,
not pixels. Omitted/null retains v0.5–v0.8 frozen request hashes. Viewer metadata
selection is distinct from providing pixels: only existing explicitly selected
uploaded-image previews are sent. Excerpt pixels are not automatically shared.
Badge should state current image and whether pixels are provided. Never claim
seeing unshared pixels. Closing viewer retains current image context per paper;
provide explicit clear action. Paper switches never share another paper's source.

Tools: read_image_annotations(source_kind,source_id,annotation_id?); propose_image_
annotation(source_kind,source_id,rect,text); propose_image_annotation_edit
(annotation_id,expected_revision,text?/rect?); propose_image_annotation_delete /
restore(annotation_id,expected_revision). Paper-bound text/metadata may be read,
pixels obey separate explicit sharing. Read results cite persistent viewer URLs
and image_annotation source refs. These refs are NOT valid PDF note anchors.
Writes checkpoint for concrete confirmation; no automatic review/execution.
Agent proposal source_sha256 remains the PAPER hash; image_source_sha256 is a
separate field. Payload freezes source IDs, both image hashes, rectangle/text and
expected revision. Confirmation revalidates all. Previews are temporary, not saves.

## Frontend (actual Kimi only)

New image-viewer.js/css plus minimal index/app/image-library/assistant glue.
Use actual SDK, not custom canvas/selection engine. Accessible native dialog,
neutral/blue themes,Chinese/English390px. Add View/annotate buttons to uploaded
images, existing PDF excerpts and note-linked uploads. Keep all old selectors,
original downloads, image selections, PDF/rich drafts and underlying pixels.

Lazy local JS/CSS with successful-module cache separate from CSS. Retry failed
module using a new LOCAL query suffix. Bind session to doc/kind/source UUID; parse
returned identities/hashes/dimensions/records strictly. Frame body streamed<=8MiB,
exact size/SHA256 via WebCrypto; verify SDK content size. Use Blob URL only after
verification; revoke on close. Source/asset failure visible, no stale success.

OpenSeadragon({element,showNavigationControl:false,drawer:'canvas',...});
open({type:'image',url:blobURL,buildPyramid:false}). Public Point constructor is
SDK.OpenSeadragon.Point, not viewer.constructor.Point. Add accessible Zoom in/out,
Fit,Pan/New rectangle modes. createOSDAnnotator with drawingMode:'drag',autoSave:
true is LOCAL event delivery only; never persist on an SDK event. Choose rectangle
only. Empty clearAnnotations before first source is an upstream boundary bug:
skip an empty no-op; clear only nonempty state, then repopulate saved records.
Actual proof geometry in reader-v9/proof/actual-annotation.json; target selector
RECTANGLE geometry{x,y,w,h,bounds:{minX,minY,maxX,maxY}}. Pixel geometry converts to
normalized fractions using VERIFIED frame dimensions. Saved records convert back.
No use of raw upload dimensions or PDF rect in this transform.

Explicit Save/Cancel editing. New drawing creates a staged UUID/rectangle; text
must be supplied before POST. Edit existing text/rectangle with revision; plain
text only. Delete/restore list (recoverable). Source caption distinguishes uploaded
preview/non-PDF and saved PDF excerpt/page/source link. Warn visibly that upload
annotations use preview, original remains downloadable. List selections fitBounds.

Per-source drafts survive close/reopen/paper navigation, explicit Cancel discards
local edit. Freeze exact request UUID/body/hash/revision on uncertain failures;
retry cannot silently refresh revision or overwrite conflict. New source/version
cannot receive an old draft or late response. Close during pending save may leave
a committed server result; never clear another draft or undo it automatically.
Late module/source/frame/annotation responses cannot mount under another title.
Destroy anno/viewer, detach own handlers, remove DOM and revoke Blob URLs on close.
Guard native-dialog queued close events against fast reopen; restore focus.

getActiveContext(documentId) returns selected source/optional annotation or null;
clearActiveContext explicit UI. Last source context stays per paper, pixels only
through existing imageLibrary selections. App frozen Send includes active_image
and assistant badge. Deep links use ?document=...&image_kind=...&image_source=...
&image_annotation=... . Image source refs reopen exact source/annotation.
Agent cards show source label, proposed description and View region button before
confirm; source version checked, SDK ghost rectangle labelled Proposal/not saved,
viewer Save disabled for proposals. Closing preview returns focus to proposal.
Keep existing note/proposal/rich/Notebook behavior and contracts.

IDs: image-viewer-dialog,title,status,stage,close,retry,zoom-in,zoom-out,fit,pan,
image-annotation-new,text,save,cancel,list,deleted-toggle,deleted-list,
image-context-clear. Dialog/stage data-document-id/data-source-kind/data-source-id,
record li data-annotation-id with edit/delete/restore actions. Trigger data-action
view-image, source kind/id. Ordinary UI must not expose DB/version/hash internals.

## Verification

Use synthetic fixtures/private copies. Verify original pointer drawing/zoom,
EXIF-correct frame pixels, source scopes/hashes, all state transitions/noops,
exact/concurrent retry, stale revisions/source, quota/permission/rollback,
safe complete export/offline/no duplicated files, legacy request hashes, Agent
read/preview/confirm/reject/cancel and pixel privacy, native-dialog lifecycle,
late reads/writes/paper/source switching, per-source drafts, module/frame failure,
mobile/keyboard/theme, old419 backend/166 browser scenarios and all17 old tables.
No real-paper model send or cloud upload. Backup latest before live activation.
# CSP-compatible source build

The npm Annotorious JS distribution prebundles Pixi's dynamic shader compiler,
which the existing strict script-src blocks. Compile original source from npm
3.9.5 gitHead f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65, pinned Svelte4,
and install the original official @pixi/unsafe-eval7.4.3 compatibility module on
the shared ShaderSystem. No upstream source edits or relaxed CSP. Exact source
files/archive hash, dependency lock, licenses and runtime assets are retained.

