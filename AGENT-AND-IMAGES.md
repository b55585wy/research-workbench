# v0.5 contract retained in v0.8: reading Agent and uploaded image notes

Local single-user research workbench. Do not change tFUS source, API manifests,
actor/auth/host boundaries, global routing or scoring queue. Existing tFUS Agent
rejects research views and simulation project IDs cannot substitute paper IDs.
This is an independent research Agent with fixed tools and an optional read-only
model-connection adapter, not completed tFUS account/business integration.

## Product slice and reasoning

Actual context is a selected document, page, optional rectangle/active note and
explicitly selected images. A filename, typed user ID or model answer is not
proof of source or identity. Bind document/context at submission; derive source
records and paths on the server. Paper/image text is untrusted data, never new
instructions. Model tools cannot choose scripts, URLs, files or credentials.

Deliver: upload PNG/JPEG/WebP into the current paper's image library; select
images for a new note or for Agent; preserve uploads and their provenance; ask
about the current page/images, search saved notes and propose/save notes through
the same storage services. Persist conversations, source references, tool traces,
concrete write proposals and actual receipts. Support create/edit/delete/restore
note proposals and bibliography edits. Human source-check status stays manual.
Arbitrary user code, online downloads and account federation remain future items.
v0.6 adds fixed descriptive Python/R recipes and explicit dataset sharing;
the additive contract is [ANALYSIS.md](ANALYSIS.md).

Agent architecture checklist: fixed atomic read/search/propose/complete tools;
same document/note/image data as UI; dynamic bounded context and capability list;
explicit completion or waiting-for-confirmation checkpoint; bounded multi-step
loop; persisted progress/restart interruption; no automatic uncertain writes;
source links and visible results; no hidden script/URL/file tools. CRUD parity
for existing notes/metadata is provided with concrete write confirmation. Image
upload uses the browser's explicit file picker, not arbitrary model filesystem
access. PDF upload/export, human review and theme stay direct UI capabilities;
these parity gaps are explicit, not claimed as autonomous agent functions.
No iOS/iCloud/background-mobile or self-modifying-agent framework is introduced.

## Existing API compatibility

Existing document/note JSON and APIs remain. Schema4 ->5 is additive and preserves
all seven existing tables/rows, PDF/PNG bytes, review and metadata. No new deps.
Image parsing and PDF text extraction run in bounded short-lived child processes.
Agent model transport has its own bounded worker, separate from tFUS jobs.

### Image library

- GET /api/v1/documents/{doc}/images -> {items:[image,...]} newest first.
- POST same: multipart file + request_id(UUID), max8MiB, actual static PNG/JPEG/
  WebP, no SVG/GIF/animated or decompression bombs. Return201 new or200 replay.
  Same request with different bytes/document/name ->409 idempotency_conflict.
  Original bytes retained; stripped normalized bounded preview for model/UI.
  max16 million pixels/8192px axis, preview max1600px axis/2MiB; max256MiB stored
  image bytes per document. Verify size/type; failures clean only owned temp files.
- GET /api/v1/documents/{doc}/images/{image}/file -> checked original bytes.
- GET /.../{image}/preview -> checked normalized preview image.
- Image JSON: id,document_id,original_filename,mime_type,byte_size,sha256,width,
  height,preview_mime_type,preview_byte_size,preview_sha256,created_at,
  file_url,preview_url,note_ids(active linked note IDs). source_kind="user_upload".
  Uploaded images are not PDF crops; associating them with a reading page is
  user-provided context, not proof they came from that PDF.
- POST /api/v1/documents/{doc}/image-notes: existing NoteCreate fields plus
  image_ids(unique1..4 UUIDs). Same base six-field note response,201 new/200 retry.
  One transaction saves note+image links+receipt, deterministic note_id=request_id.
  Retry compares original full input and never overwrites an edited/deleted note.
  Image IDs must belong to the paper. Existing notes cannot be silently attached
  using this create endpoint. New uploaded-image notes default unreviewed.
- Export includes active notes' linked image originals/previews and provenance,
  deduplicated in the ZIP; excludes unattached images and deleted notes' links.
  Original PDF/excerpt export stays. HTML/Markdown label images as user uploads.

### Model connection

- GET /api/v1/agent/status -> configured,model,image_input,connection_state,
  connection_source (local|inherited|none),tools:[{name,title,risk}],scope=local_research,
  multi_user_auth=false. No key/path/raw model messages returned.
- POST /api/v1/agent/settings: {base_url:https URL without credentials/query/
  fragment,model,api_key,supports_images:boolean}. Save ONLY workbench private
  configuration, never tFUS config. Return sanitized status. UI clears key only
  after confirmed save; no key in localStorage/history/public JSON/logs.
- Optional server RESEARCH_AGENT_CONFIG / CLI --agent-config points to an
  operator-selected existing model JSON, read-only fallback when no own config.
  Reuse tFUS-compatible HTTPS transport semantics with no credentialed redirects,
  time/response bounds, one transient transport retry. No provider/vision claim
  without configuration and actual acceptance. Vision disabled/unknown rejects
  image-bearing turns visibly and retains draft; upload/save remains available.

### Conversations and turns

- GET /api/v1/documents/{doc}/agent/conversations -> {items:[{id,document_id,
  title,created_at,updated_at},...]}. No cross-paper conversation reuse.
- GET /api/v1/documents/{doc}/agent/conversations/{id} -> {conversation,turns:[turn,...]}.
- POST /api/v1/documents/{doc}/agent/turns: {request_id(UUID),conversation_id(UUID
  or null),message(max8000),context:{page(strict1..page_count),rect(optional
  normalized fractions),active_note_id(optional UUID),image_ids(unique0..4 UUIDs),
  language:zh|en}}. Message may be empty only when images are selected. Server
  owns doc binding, page source, metadata, note/image validation and timestamps.
  Return202 turn (same payload/request retry returns same turn). Conflicting UUID
  ->409; another active turn in same conversation ->409 agent_busy. Missing model
  ->409 agent_not_configured; unsupported images ->409 agent_vision_disabled.
- GET /api/v1/documents/{doc}/agent/turns/{id} -> turn.
- POST /.../turns/{id}/cancel with {}: no further proposals/writes after cancel;
  already committed receipts remain; terminal cancellation is idempotent.
- POST /.../turns/{id}/proposals/{proposal}/confirm:
  {approved:boolean,proposal_sha256:64 lowercase hex}. Applies exact saved proposal
  using existing note/lifecycle/library services with version checks. Never trust
  client actor or substitute target IDs. Success returns updated turn; repeated
  identical decision reuses receipt. Contradictory decisions or changed payload
  fail409. Source/record/version drift must fail without losing the proposal.

Turn JSON: id,document_id,conversation_id,message,status(queued|running|
waiting_confirmation|completed|failed|cancelled|interrupted),answer,error(null
or {code,message}),context(server-captured document/page/rect/active note/image
summaries),sources:[{ref,label,kind,document_id,page,rect,note_id?,image_id?,url,
text?,truncated?}],events:[{id,kind,title,status,created_at,summary}],
proposals:[{id,kind,title,payload,sha256,status(pending|applied|rejected|conflict),
result(null or receipt),error(null or {code,message})}],created_at,updated_at.
Proposal payload exposes concrete note text/source/images or metadata changes,
plus target ID/revision needed to assess it; no arbitrary paths or private keys.
Receipts expose actual saved note/document ID, outcome and public URLs.

Tool loop supports bounded read_context,read_page,search_library,list_notes,
read_note,list_images,read_image(selected images only),propose_note,
propose_note_edit,propose_note_delete,propose_note_restore,propose_metadata_edit,
complete_task. Server binds the paper. Source refs are generated from real reads;
propose_note must use a supplied ref, never invented source IDs. Tools validate
fields with existing models. No auto review, metadata truth inference or claims
of experiments/clinical validation. A proposed write is NOT a saved record.
After proposals, checkpoint waiting_confirmation; concrete confirmation persists
business write and receipt together. A completed assistant message or explicit
complete_task is the completion signal; time/step/transport failure is not success.
Restart marks queued/running turns interrupted, preserves pending confirmations
and completed operations; no automatic write/model replay. History is paper-bound
and bounded; current context refresh is available through tools.

Page-text sources refer to the whole page (`rect=null`). A selected rectangle has
a separate `display_selection` reference, explicitly position-only; its pixels
and region text are not automatically extracted. Uploaded selected image previews
are the supported visual inputs. Text extraction unavailable on scanned pages is
visible, not represented as successful OCR. Source rows remain as captured, even
when the UI language is later changed. This release inherits a private connection
snapshot; upstream credential rotation does not automatically refresh that file.

## Frontend (actual Kimi owns frontend HTML/JS/CSS)

Keep existing UI/blue theme and all old selectors. May add assistant.js/css and
image-library.js/css to avoid expanding the existing app.js monolith. Expose
context/service callbacks from app.js; no direct dependency on tFUS frontend.

Image library near notes: native file picker, thumbnail/name/source label,
upload pending/error/retry, original download; separate explicit selection for
"提供给助手" and "加入新笔记". Preserve per-paper selections and upload request UUID
across lost responses; selection changes invalidate new-note request ID, not
retarget an existing draft anchor. If note image selection exists, submitSave
uses image-notes atomically, preserving existing text/anchor/request retry. On
confirmed save clear only that captured draft's image selection. Render linked
uploads below saved note text with original source label and download; PDF crops
stay distinct. No note deletion can erase original uploaded bytes.

Add a collapsible/floating "研究助手" accessible panel; current paper/page/selection
and selected-image badges visible before Send. It can be closed without losing
chat draft or job state. Native message textarea, send/cancel/new-conversation,
conversation selection, persisted messages, status/tool history, source buttons,
concrete proposal cards with confirm/reject. Source buttons reuse actual paper/
page/rectangle/note navigation. Model text rendered literally with textContent;
no unsafe Markdown/innerHTML or remote image URLs. No invisible automatic send.

GET status first; clear not-configured/vision-disabled state. Provide an optional
collapsed model settings form with base URL,model,password-type key,vision checkbox
and save. Key stays only in form/request and is cleared on successful save.
Settings are workbench-local. Never read keys into public state/localStorage.

Capture context and request_id once on Send, retain exact payload on uncertain
failure; stale results/polling cannot replace another document/conversation's UI.
Per-paper chat drafts/history; status polling only active runs with cancellation
and sequence guards, stops on terminal states/disposal. Navigating cannot retarget
pending note/proposal. On applied proposal, reload the affected paper's note-state,
images or metadata; preserve existing creation/edit drafts. Human review never
automatically checked. If old save conflicts with concurrent manual edit, show
conflict with original proposal intact; do not silently freshen revision.

Stable new selectors (element IDs; old data-testid hooks preserved): image-upload-input,image-upload-button,images-list,
image-upload-status; image items data-image-id; checkboxes data-action=select-chat-
image / select-note-image. assistant-toggle,assistant-panel,assistant-context,
assistant-message,assistant-send,assistant-cancel,assistant-new,assistant-history,
assistant-messages,assistant-status,assistant-sources,assistant-proposals.
Proposal items data-proposal-id, buttons data-action=confirm-proposal/reject-proposal.
assistant-settings-toggle,assistant-provider-url,assistant-provider-model,
assistant-provider-key,assistant-provider-images,assistant-provider-save.
Keyboard,Chinese/English,390px mobile,existing tokens,visible progress/errors.
Root owns backend/contracts/tests/servers/browser/activation. No external calls,
server startup or writes outside the assigned frontend files.

v0.7 adds optional active_analysis_id, validated against the current paper and
explicitly shared dataset. Send freezes it; uncertain retry preserves the old
payload even after UI selection changes. read_analysis includes verified saved
code/output and Notebook URL, not Notebook image data or a new execution tool.
See [NOTEBOOK-VIEW.md](NOTEBOOK-VIEW.md). All write confirmations remain.

## v0.8 structured rich notes

Note tools accept optional validated rich_content and retain confirmation,
revision and source guards. Read/list/captured active notes provide the structured
document; derived rich_html stays out of model context. UI previews show sanitized
formatting and warn when a plain edit removes formatting. Confirmed body and
image-note writes are atomic. No automatic review or extra send. See RICH-NOTES.md.
# v0.9 active image and annotation tools

Optional `context.active_image` carries source_kind/source_id and annotation_id.
Capture validates same-paper source/version and selected annotation in a read
snapshot. It adds descriptor and selected annotation text, not implicit pixels.
Only explicitly selected uploaded previews become model image parts; excerpt
pixels are not provided. Image source refs have image_rect, never a PDF rect/page.
They cannot be promoted into a PDF-anchored note.

`read_image_annotations` reads verified text/rectangles. `propose_image_annotation`
and edit/delete/restore variants freeze concrete hashes, geometry and revision.
Proposal preview does not write. Confirmation verifies proposal hash, current
source and revision and atomically writes the annotation and receipt. Origin
manual/agent_proposal describes the workflow, not an authenticated user identity.



## v0.26：研究内的多论文读取

研究任务发送时可提供关联论文目录，正文由 Agent 按任务调用 list_study_papers/read_study_paper 读取。关联不会自动发送全部 PDF，跨研究正文、图片像素和数据共享权限不因此扩大。表格作为普通对话消息渲染、保留和导出。引用复用检查关联及原文版本并重映射编号；笔记保存仍需原有确认。见 [AGENT-READING.md](AGENT-READING.md)。
