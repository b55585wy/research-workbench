# v0.8: source-linked rich notes using original Quill

## Decision

Unverified assumptions: an upstream ELN editor is a standalone module; HTML is
safe to store/render verbatim; a sync folder can provide database transactions.
Verified constraints: notes already have immutable source anchors and creation
text, revision-checked effective state and exact retries. Plain text is used for
search, Agent context and existing APIs. File synchronization does not coordinate
SQLite transactions across machines. Reuse a standalone editor and add structured
formatting to this existing note lifecycle. Do not migrate the ELN data model.

Use original Quill2.0.3 (BSD-3-Clause), DOMPurify3.4.17, local pinned assets.
This is independent component reuse, not RSpace business-source extraction.
Preserve native JS/FastAPI, themes, original textarea/hooks, PDF and image bytes.
No tables, embedded images/video/formula, colors, arbitrary HTML or collaborative
editing in this slice. Existing image attachments/excerpts remain separate.

## Data/API

NoteCreate and NoteUpdate accept optional rich_content:
{"version":1,"ops":[{"insert":"Hello","attributes":{"bold":true}},{"insert":"\n"}]}.
Only insert strings,1–512 operations, total<=10001 characters including final
newline, serialized UTF8<=65536 bytes. Allowed inline attributes bold/italic/
underline:true and link:absolute HTTP(S) URL<=2048, no credentials/controls.
Block attributes header:1|2 or list:bullet|ordered only on newline-only inserts;
header/list mutually exclusive. All documents end in newline; normalized plain
text (join inserts then strip) must equal text. Unknown attributes/operations,
embeds, dangerous links, excessive sizes and mismatched text ->422.

For PATCH, rich_content (including explicit null to remove formatting) requires
text. Omission with unchanged text preserves formatting; omission with changed
text switches to plain text. Review-only mutations preserve formatting.
Formatting changes advance the same note revision and reset review. Existing
explicit review action remains separate. Original notes rows/IDs/anchors stay.

Schema6->7 adds one sparse note_rich_content table, original_json/current_json.
No old rows rewritten or old notes auto-converted/reviewed. Original rich JSON
participates in note-creation retry comparison even after later editing.
Current rich JSON is written in the SAME transaction as note state, image-note
creation or confirmed Agent writes. All old plain operation/request hashes stay.

Existing six-field notes JSON unchanged. State APIs add rich_content and
rich_html only when current formatting exists, from ONE joined snapshot, not a
second independently arriving body response. Rich HTML is server-generated from
the allowlisted structure; never accept client HTML. Corrupt stored rich content
fails visibly. Search and legacy notes keep effective plain text. Delete/restore
retain formatting and images. Export HTML/JSON retain format and exact structure;
Markdown keeps safe readable plain text. Deleted notes stay excluded.

Agent read/list/context include structured formatting where available, omit the
derived HTML. propose_note/propose_note_edit accept optional rich_content, use
the same validators/transactions and require concrete confirmation. Display
formatting in proposal previews; warn if an edit changes rich text to plain.
Never auto-review. Old pending proposals/frozen submissions remain valid.

## Frontend: actual Kimi only

Add rich-text.js/css, minimal index/app/assistant glue. Existing plain textarea
remains the default and keeps all old hooks. Add a localized "格式编辑" button
opening a native dialog, lazy import /vendor/rich-text/editor.js exporting Quill
and DOMPurify, and editor.css. Reuse actual Quill toolbar/editor/history/clipboard.
Allowed formats bold,italic,underline,header,list,link; toolbar corresponding.
No editor rewrite, React, CDN, iframe, execution or external images.

Modal buttons Apply to draft / Cancel. Local changes only commit on Apply, then
existing Save persists atomically. Quill.getContents().ops wraps version1;
text=Quill.getText().trim(). Snapshot document/create-or-edit scope and revision
at Open; close/discard late assets/results on paper/editor switch or Escape.
Cancel changes nothing, restores focus. Clear/dispose listeners on close.

Creation and edit drafts retain richContent across navigation/conflicts/retries.
While formatted, plain textarea is readOnly (still readable/copyable) with a
localized explanation and explicit "转为纯文本" draft action; Cancel edit can
recover saved formatting. Keep draft text and richContent together, freeze both
in uncertain requests, include rich_content only when needed (null for explicit
conversion). Image-note/excerpt flows must carry it too. Other paper late saves
cannot clear/replace current draft. Exports blocked for an open uncommitted editor.

Render saved rich_html only after original DOMPurify with exact allowed tags
p,h1,h2,strong,em,u,ul,ol,li,br,a and attributes href,rel,target; HTTP(S) links only,
no data attrs/images/SVG/scripts/iframes/styles/events. Restore noopener/noreferrer
on links. If assets fail, preserve plain text and visibly explain format failure;
no false saved/applied state. Keep note source button separate from rich body.
Match one state snapshot/revision. Proposal previews follow same sanitation.

Expose module callbacks without global mutable application state. Stable IDs:
rich-text-open,rich-text-plain,rich-text-dialog,rich-text-editor,rich-text-status,
rich-text-apply,rich-text-cancel. Editor root data-document-id/data-note-id scope;
saved rich body .note-rich-content within the existing data-note-id item.
Chinese/English,390px,blue theme, keyboard/focus, unchanged PDF pixels/drafts.

## Files and backup

Keep live SQLite/local referenced files under one workbench owner. A future
Jianguoyun/WebDAV target may store immutable files or completed consistent backup
packages, not an active multi-writer database directory. No cloud account/path is
configured by this change and no user data is automatically uploaded.
Full workspace backup must use SQLite backup API plus referenced source files,
verify a manifest, exclude model credentials by default, and restore to a separate
directory before switching. Reading ZIP alone is not a full database backup.
