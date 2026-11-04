import { openDeviceDB } from "./device-db.js";
import { mapDeviceAssetUrl } from "./device-context.js";
import { createDeviceBackup, readDeviceBackup } from "./device-backup.js";
import { DeviceError, baseDocument, baseNote, canonical, clone, errorResponse, excerptRecord, fail, imageRecord, isSHA, isUUID, json, metadata, mutationFingerprint, noteState, now, plainText, richReferences, richText, sha256, shapeBounds, text, validateNoteCreate, validateShape } from "./device-format.js";

const MAX_PDF = 20 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;

async function write(db, stores, callback) {
  const tx = db.transaction(stores, "readwrite");
  try {
    const result = await callback(tx);
    await tx.done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already have committed. */ }
    try { await tx.done; } catch { /* Preserve the operation error. */ }
    throw error;
  }
}

async function records(tx, name, documentId) {
  return tx.objectStore(name).index("document_id").getAll(documentId);
}

async function documentRecord(tx, id, includeTrashed = false) {
  if (!isUUID(id)) fail("not_found", "找不到这篇文献。", 404);
  const record = await tx.objectStore("documents").get(id);
  if (!record) {
    const purged = await tx.objectStore("settings").get(`purge:${id}`);
    fail(purged ? "document_purged" : "not_found", purged ? "这篇文献已彻底删除。" : "找不到这篇文献。", purged ? 410 : 404);
  }
  if (record.deleted_at && !includeTrashed) fail("document_trashed", "这篇论文已移入回收站，请先恢复。", 410);
  return record;
}

async function noteRecord(tx, documentId, noteId, includeDeleted = true) {
  await documentRecord(tx, documentId);
  const record = await tx.objectStore("notes").get(noteId);
  if (!record || record.document_id !== documentId) fail("not_found", "找不到这条笔记。", 404);
  if (record.purged) fail("note_purged", "这条笔记已彻底删除，无法恢复。", 410);
  if (!includeDeleted && record.deleted_at) fail("not_found", "这条笔记已删除，可在已删除笔记中恢复。", 404);
  return record;
}

function fileResponse(blob, type, extra = {}) {
  return new Response(blob, { status: 200, headers: { "Content-Type": type || blob.type || "application/octet-stream", "Content-Length": String(blob.size), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", ...extra } });
}

function safeFilename(value, fallback) {
  const name = String(value || "").split(/[/\\]/).at(-1).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 180);
  return name || fallback;
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

async function validatePDF(pdfjsLib, file) {
  if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_PDF) fail("file_too_large", "目前支持不超过 20 MiB 的 PDF。", 413);
  if (!pdfjsLib?.getDocument) fail("parser_unavailable", "PDF 检查组件尚未就绪。", 503);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await sha256(bytes);
  let task;
  try {
    task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 200) fail("page_limit", "目前支持最多 200 页的 PDF。");
    return { bytes, sha256: digest, pageCount: pdf.numPages };
  } catch (error) {
    if (error instanceof DeviceError) throw error;
    if (error?.name === "PasswordException" || /password/i.test(error?.message || "")) fail("encrypted_pdf", "请先解除 PDF 密码保护，再添加资料。");
    fail("invalid_pdf", "无法读取这份 PDF，请检查文件后重试。");
  } finally {
    if (task) await task.destroy();
  }
}

async function decodeImage(file) {
  if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_IMAGE) fail(file.size > MAX_IMAGE ? "image_too_large" : "invalid_image", "图片需为 1 字节到 8 MiB。", file.size > MAX_IMAGE ? 413 : 422);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes.length > 24 && bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG";
  const jpeg = bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216;
  const webp = bytes.length > 24 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!png && !jpeg && !webp) fail("invalid_image", "请上传有效的静态 PNG、JPEG 或 WebP 图片。");
  if (png && bytes.includes(97) && new TextDecoder("latin1").decode(bytes).includes("acTL")) fail("invalid_image", "不支持动画图片。");
  if (webp && new TextDecoder("latin1").decode(bytes.slice(12, 16)) === "VP8X" && (bytes[20] & 2)) fail("invalid_image", "不支持动画图片。");
  const type = png ? "image/png" : jpeg ? "image/jpeg" : "image/webp";
  if (file.type && file.type !== type) fail("invalid_image", "图片扩展类型与内容不一致。");
  let bitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type })); } catch { fail("invalid_image", "无法解码这张图片。"); }
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height || Math.max(width, height) > 8192 || width * height > 16000000) fail("invalid_image", "图片尺寸超出限制。");
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    let canvas;
    if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(targetWidth, targetHeight);
    else {
      canvas = document.createElement("canvas");
      canvas.width = targetWidth; canvas.height = targetHeight;
    }
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) fail("image_unavailable", "无法生成图片预览。", 503);
    context.fillStyle = "white";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const toBlob = (mime, quality) => canvas.convertToBlob ? canvas.convertToBlob({ type: mime, quality }) : new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    let preview = await toBlob("image/png");
    let previewType = "image/png";
    if (!preview || preview.size > 2 * 1024 * 1024) { preview = await toBlob("image/jpeg", 0.88); previewType = "image/jpeg"; }
    if (!preview || preview.size < 1 || preview.size > 2 * 1024 * 1024) fail("invalid_image", "图片预览超过限制。");
    return { bytes, type, width, height, preview, previewType };
  } finally { bitmap.close(); }
}

async function syncRichImages(tx, documentId, note) {
  const ids = new Set(note.attached_image_ids || []);
  for (const [id, reference] of richReferences(note.rich_content)) {
    if (reference.document_id !== documentId) fail("rich_image_scope", "正文图片必须属于当前文献。", 409);
    const image = await tx.objectStore("images").get(id);
    if (!image || image.document_id !== documentId) fail("not_found", "找不到正文图片。", 404);
    if (image.sha256 !== reference.sha256) fail("rich_image_changed", "正文图片版本已变化，请重新插入。", 409);
    ids.add(id);
  }
  for (const id of ids) {
    const image = await tx.objectStore("images").get(id);
    if (!image || image.document_id !== documentId) fail("not_found", "找不到笔记图片。", 404);
  }
  note.image_ids = [...ids].sort();
}

function publicImages(images, notes) { return images.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).map((image) => imageRecord(image, notes)); }

async function readBackupSnapshot(tx, id, includeTrashed = false) {
  const document = await documentRecord(tx, id, includeTrashed);
  return { document, notes: await records(tx, "notes", id), images: await records(tx, "images", id), excerpts: await records(tx, "excerpts", id) };
}

async function importBackup(db, backup, restoreProgress, validate) {
  const incoming = await readDeviceBackup(backup.file);
  const { document, notes, images, excerpts, progress } = incoming;
  const checked = await validate(document.blob);
  if (checked.sha256 !== document.sha256 || checked.pageCount !== document.page_count || checked.bytes.byteLength !== document.byte_size) fail("invalid_backup", "备份 PDF 与文献记录不一致。");
  const result = await write(db, ["documents", "notes", "images", "excerpts", "settings"], async (tx) => {
    const existing = await tx.objectStore("documents").get(document.id);
    if (existing) {
      const currentNotes = await records(tx, "notes", document.id);
      const currentImages = await records(tx, "images", document.id);
      const currentExcerpts = await records(tx, "excerpts", document.id);
      const strip = (record) => { const value = clone(record); delete value.blob; delete value.original; delete value.preview; delete value.request_hash; return value; };
      const comparable = (items, key = "id") => items.map(strip).sort((a, b) => a[key].localeCompare(b[key]));
      const exact = canonical(strip(existing)) === canonical(strip(document)) && canonical(comparable(currentNotes)) === canonical(comparable(notes)) && canonical(comparable(currentImages)) === canonical(comparable(images)) && canonical(comparable(currentExcerpts, "note_id")) === canonical(comparable(excerpts, "note_id"));
      if (!exact) fail("backup_conflict", "本机已有相同 ID 但内容不同的资料，未覆盖现有记录。", 409);
      return false;
    }
    for (const note of notes) if (await tx.objectStore("notes").get(note.id)) fail("backup_conflict", "笔记 ID 与现有资料冲突。", 409);
    for (const image of images) if (await tx.objectStore("images").get(image.id)) fail("backup_conflict", "图片 ID 与现有资料冲突。", 409);
    await tx.objectStore("documents").put(document);
    for (const note of notes) await tx.objectStore("notes").put(note);
    for (const image of images) await tx.objectStore("images").put(image);
    for (const excerpt of excerpts) await tx.objectStore("excerpts").put(excerpt);
    return true;
  });
  if (result && progress !== undefined && restoreProgress) await restoreProgress(baseDocument(document), clone(progress));
  return { created: result, document: baseDocument(document) };
}

export function createDeviceRepository({ pdfjsLib, renderExcerpt, readProgress, restoreProgress } = {}) {
  let database;
  const ready = async () => { database = await openDeviceDB(); };
  const db = async () => { if (!database) await ready(); return database; };

  async function importDocument(file, deduplicate) {
    const checked = await validatePDF(pdfjsLib, file);
    const filename = safeFilename(file.name, "document.pdf");
    const title = filename.replace(/\.pdf$/i, "") || filename;
    return write(await db(), ["documents"], async (tx) => {
      const store = tx.objectStore("documents");
      if (deduplicate) {
        const matches = await store.index("sha256").getAll(checked.sha256);
        const existing = matches.filter((item) => !item.deleted_at && item.byte_size === checked.bytes.byteLength).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
        if (existing) return { document: baseDocument(existing), created: false };
      }
      const stamp = now();
      const record = { id: crypto.randomUUID(), title, original_filename: filename, page_count: checked.pageCount, byte_size: checked.bytes.byteLength, sha256: checked.sha256, created_at: stamp, authors: null, year: null, doi: null, revision: 1, updated_at: stamp, deleted_at: null, blob: new Blob([checked.bytes], { type: "application/pdf" }) };
      await store.add(record);
      return { document: baseDocument(record), created: true };
    });
  }

  async function createNote(documentId, payload, imageNote) {
    const readTx = (await db()).transaction("documents", "readonly");
    const document = await documentRecord(readTx, documentId);
    await readTx.done;
    const note = validateNoteCreate(payload, document, imageNote);
    const fingerprintPayload = clone(payload);
    delete fingerprintPayload.request_id;
    if (imageNote) fingerprintPayload.image_ids = [...fingerprintPayload.image_ids].sort();
    note.request_hash = await sha256(canonical({ document_id: documentId, data: fingerprintPayload }));
    return write(await db(), ["documents", "notes", "images"], async (tx) => {
      await documentRecord(tx, documentId);
      const existing = await tx.objectStore("notes").get(note.id);
      if (existing) {
        if (existing.document_id !== documentId || existing.request_hash !== note.request_hash) fail("idempotency_conflict", "笔记请求与已有记录冲突。", 409);
        if (existing.purged) fail("note_purged", "这条笔记已彻底删除。", 410);
        if (existing.deleted_at) fail("note_deleted", "这条笔记已删除，可恢复后再查看。", 409);
        return { note: baseNote(existing), created: false };
      }
      note.attached_image_ids = [...(note.image_ids || [])].sort();
      await syncRichImages(tx, documentId, note);
      Object.assign(note, { revision: 1, review_status: "unreviewed", reviewed_at: null, updated_at: note.created_at, deleted_at: null });
      await tx.objectStore("notes").add(note);
      return { note: baseNote(note), created: true };
    });
  }

  async function mutateNote(documentId, noteId, kind, payload) {
    const fingerprint = await sha256(mutationFingerprint(documentId, noteId, kind, payload));
    return write(await db(), ["documents", "notes", "images", "excerpts", "mutations"], async (tx) => {
      const receipt = await tx.objectStore("mutations").get(payload.request_id);
      if (receipt) {
        if (receipt.target !== noteId || receipt.fingerprint !== fingerprint) fail("idempotency_conflict", "这次操作与已有记录冲突，请保留内容后重试。", 409);
        if (kind === "purge") return receipt.response;
        const current = await noteRecord(tx, documentId, noteId);
        if (receipt.result_revision !== current.revision) fail("revision_conflict", "这条笔记已在其他页面更新。", 409);
        return current;
      }
      const current = await noteRecord(tx, documentId, noteId);
      if (!isUUID(payload.request_id) || !Number.isInteger(payload.expected_revision) || current.revision !== payload.expected_revision) fail("revision_conflict", "这条笔记已在其他页面更新。", 409);
      const updated = clone(current);
      const stamp = now();
      if (kind === "patch") {
        if (current.deleted_at) fail("note_deleted", "请先恢复这条笔记，再修改或核对。", 409);
        const allowed = ["request_id", "expected_revision", "text", "rich_content", "review_status", "annotation_style", "shape_annotation"];
        if (Object.keys(payload).some((key) => !allowed.includes(key)) || !["text", "rich_content", "review_status", "annotation_style", "shape_annotation"].some((key) => Object.hasOwn(payload, key))) fail("validation_error", "没有可保存的笔记修改。");
        if (Object.hasOwn(payload, "source_segments")) fail("validation_error", "来源区段创建后不可修改。");
        if (Object.hasOwn(payload, "annotation_style")) {
          const style = payload.annotation_style;
          if (!current.annotation || !style || !["highlight", "underline"].includes(style.kind) || !["yellow", "green", "blue", "pink"].includes(style.color) || Object.keys(style).some((key) => !["kind", "color"].includes(key))) fail("text_annotation_required", "这条笔记没有可修改样式的文字批注。", 409);
          updated.annotation = { ...current.annotation, kind: style.kind, color: style.color };
        }
        let geometryChanged = false;
        let fontChanged = false;
        if (Object.hasOwn(payload, "shape_annotation")) {
          if (!current.shape_annotation) fail("shape_annotation_required", "这条笔记没有可修改的形状批注。", 409);
          const shape = validateShape(payload.shape_annotation);
          if (shape.kind !== current.shape_annotation.kind) fail("shape_kind_immutable", "形状类型不能更改。", 409);
          if (current.shape_annotation.source_sha256 !== (await documentRecord(tx, documentId)).sha256) fail("shape_annotation_changed", "形状批注对应的原文版本已变化。", 409);
          geometryChanged = canonical(shape.points) !== canonical(current.shape_annotation.points);
          fontChanged = shape.font_size !== current.shape_annotation.font_size;
          updated.shape_annotation = { ...shape, source_sha256: current.shape_annotation.source_sha256 };
          updated.rect = shapeBounds(shape.kind, shape.points);
        } else if (current.shape_annotation && current.shape_annotation.source_sha256 !== (await documentRecord(tx, documentId)).sha256) fail("shape_annotation_changed", "形状批注对应的原文版本已变化。", 409);
        if (Object.hasOwn(payload, "text")) updated.text = text(payload.text);
        const textChanged = updated.text !== current.text;
        if (Object.hasOwn(payload, "rich_content")) {
          if (!Object.hasOwn(payload, "text")) fail("validation_error", "富文本修改必须同时提供纯文本。");
          updated.rich_content = payload.rich_content == null ? undefined : richText(payload.rich_content);
          if (updated.rich_content && plainText(updated.rich_content) !== updated.text) fail("validation_error", "富文本与纯文本不一致。");
          if (!updated.rich_content) delete updated.rich_content;
        } else if (textChanged) delete updated.rich_content;
        if (updated.shape_annotation?.kind === "textbox" && updated.text.length > 2000) fail("textbox_text_too_long", "文本框内容不能超过 2000 个字符。");
        if (Object.hasOwn(payload, "review_status") && !["unreviewed", "source_checked"].includes(payload.review_status)) fail("validation_error", "核对状态无效。");
        const contentChanged = textChanged || canonical(updated.rich_content) !== canonical(current.rich_content) || geometryChanged;
        if (geometryChanged || fontChanged || (textChanged && current.shape_annotation?.kind === "textbox")) {
          updated.review_status = "unreviewed"; updated.reviewed_at = null;
        } else {
          updated.review_status = Object.hasOwn(payload, "review_status") ? payload.review_status : contentChanged ? "unreviewed" : current.review_status;
          updated.reviewed_at = updated.review_status === "source_checked" ? current.review_status === "source_checked" && !contentChanged ? current.reviewed_at : stamp : null;
        }
        await syncRichImages(tx, documentId, updated);
      } else if (kind === "delete") updated.deleted_at = current.deleted_at || stamp;
      else if (kind === "restore") updated.deleted_at = null;
      else if (kind === "purge") {
        if (!current.deleted_at) fail("note_not_deleted", "请先将笔记移入已删除列表。", 409);
        const response = { id: noteId, document_id: documentId, purged: true, files_removed: true };
        await tx.objectStore("excerpts").delete(noteId);
        const tombstone = { id: noteId, document_id: documentId, purged: true, revision: current.revision + 1 };
        await tx.objectStore("notes").put(tombstone);
        await tx.objectStore("mutations").add({ request_id: payload.request_id, target: noteId, fingerprint, result_revision: tombstone.revision, response, created_at: stamp });
        return response;
      } else fail("validation_error", "不支持这种笔记操作。");
      const changed = ["text", "review_status", "reviewed_at", "deleted_at", "rich_content", "annotation", "shape_annotation", "rect", "image_ids"].some((key) => canonical(updated[key]) !== canonical(current[key]));
      if (changed) { updated.revision = current.revision + 1; updated.updated_at = stamp; }
      await tx.objectStore("notes").put(updated);
      await tx.objectStore("mutations").add({ request_id: payload.request_id, target: noteId, fingerprint, result_revision: updated.revision, created_at: stamp });
      return updated;
    });
  }

  async function mutateDocument(documentId, kind, payload) {
    const fingerprint = await sha256(mutationFingerprint(documentId, documentId, kind, payload));
    return write(await db(), ["documents", "mutations"], async (tx) => {
      const current = await documentRecord(tx, documentId, true);
      const receipt = await tx.objectStore("mutations").get(payload.request_id);
      if (receipt) {
        if (receipt.target !== documentId || receipt.fingerprint !== fingerprint || receipt.result_revision !== current.revision) fail("idempotency_conflict", "这次保存请求与已有记录冲突。", 409);
        return current;
      }
      if (!isUUID(payload.request_id) || current.revision !== payload.expected_revision) fail("revision_conflict", "文献信息已在其他页面更新。", 409);
      const stamp = now();
      if (kind === "trash" && !current.deleted_at) { current.deleted_at = stamp; current.revision += 1; current.updated_at = stamp; }
      else if (kind === "restore" && current.deleted_at) { current.deleted_at = null; current.revision += 1; current.updated_at = stamp; }
      await tx.objectStore("documents").put(current);
      await tx.objectStore("mutations").add({ request_id: payload.request_id, target: documentId, fingerprint, result_revision: current.revision, created_at: stamp });
      return current;
    });
  }

  async function purgePreview(documentId) {
    const tx = (await db()).transaction(["documents", "notes", "images", "excerpts"], "readonly");
    const document = await documentRecord(tx, documentId, true);
    if (!document.deleted_at) fail("document_not_deleted", "请先将文献移入回收站。", 409);
    const snapshot = await readBackupSnapshot(tx, documentId, true);
    await tx.done;
    const planInput = purgePlanInput(snapshot);
    return { id: documentId, title: document.title, expected_revision: document.revision, preview_sha256: await sha256(canonical(planInput)), counts: { notes: snapshot.notes.filter((note) => !note.purged).length, images: snapshot.images.length, datasets: 0, analyses: 0, charts: 0, imports: 0, conversations: 0, files: 1 + snapshot.images.length * 2 + snapshot.excerpts.length, bytes: document.byte_size + snapshot.images.reduce((sum, image) => sum + image.byte_size + image.preview_byte_size, 0) + snapshot.excerpts.reduce((sum, item) => sum + item.byte_size, 0), missing_files: 0 }, excluded: ["exported_copies", "backups"], planInput };
  }

  function purgePlanInput(snapshot) {
    return { document: metadata(snapshot.document), deleted_at: snapshot.document.deleted_at, notes: snapshot.notes.map((note) => [note.id, note.revision, note.purged || false]), images: snapshot.images.map((image) => [image.id, image.sha256, image.preview_sha256]), excerpts: snapshot.excerpts.map((item) => [item.note_id, item.sha256]) };
  }

  async function purgeDocument(documentId, payload) {
    const fingerprint = await sha256(mutationFingerprint(documentId, documentId, "purge", payload));
    const receiptTx = (await db()).transaction("mutations", "readonly");
    const previous = await receiptTx.objectStore("mutations").get(payload.request_id);
    await receiptTx.done;
    if (previous) {
      if (previous.target !== documentId || previous.fingerprint !== fingerprint) fail("idempotency_conflict", "删除请求与原确认不一致。", 409);
      return previous.response;
    }
    const preview = await purgePreview(documentId);
    return write(await db(), ["documents", "notes", "images", "excerpts", "mutations", "settings"], async (tx) => {
      const receipt = await tx.objectStore("mutations").get(payload.request_id);
      if (receipt) {
        if (receipt.target !== documentId || receipt.fingerprint !== fingerprint) fail("idempotency_conflict", "删除请求与原确认不一致。", 409);
        return receipt.response;
      }
      const current = await documentRecord(tx, documentId, true);
      if (!current.deleted_at || current.revision !== payload.expected_revision || current.revision !== preview.expected_revision) fail("revision_conflict", "文献状态已改变，请重新查看清理预览。", 409);
      const snapshot = await readBackupSnapshot(tx, documentId, true);
      if (canonical(purgePlanInput(snapshot)) !== canonical(preview.planInput) || !isSHA(payload.preview_sha256) || payload.preview_sha256 !== preview.preview_sha256) fail("document_purge_changed", "关联资料已改变，请重新查看清理预览。", 409);
      for (const note of snapshot.notes) { await tx.objectStore("notes").delete(note.id); await tx.objectStore("excerpts").delete(note.id); }
      for (const image of snapshot.images) await tx.objectStore("images").delete(image.id);
      await tx.objectStore("documents").delete(documentId);
      const response = { id: documentId, purged: true, files_removed: true };
      await tx.objectStore("settings").put({ key: `purge:${documentId}`, created_at: now() });
      await tx.objectStore("mutations").add({ request_id: payload.request_id, target: documentId, fingerprint, result_revision: current.revision, response, created_at: now() });
      return response;
    });
  }

  async function createExcerpt(documentId, noteId) {
    const tx = (await db()).transaction(["documents", "notes", "excerpts"], "readonly");
    const document = await documentRecord(tx, documentId);
    const note = await noteRecord(tx, documentId, noteId, false);
    const existing = await tx.objectStore("excerpts").get(noteId);
    await tx.done;
    if (existing) {
      if (existing.source_sha256 !== document.sha256) fail("source_changed", "图表摘录与原 PDF 版本不一致。", 409);
      return { record: excerptRecord(existing, note), created: false };
    }
    if (note.shape_annotation) fail("shape_annotation_excerpt_unsupported", "形状批注不能生成图表摘录。", 409);
    if (!note.rect) fail("region_required", "请先框选要摘录的图表区域。");
    if (!renderExcerpt) fail("local_feature_unavailable", "本机图表渲染尚未就绪。", 501);
    const rendered = await renderExcerpt({ document_id: documentId, page: note.page, rect: clone(note.rect), source_sha256: document.sha256 });
    if (!(rendered?.blob instanceof Blob) || rendered.blob.size < 1 || rendered.blob.size > 8 * 1024 * 1024 || !Number.isInteger(rendered.width) || !Number.isInteger(rendered.height) || rendered.width < 1 || rendered.height < 1 || rendered.width > 2048 || rendered.height > 2048 || rendered.width * rendered.height > 4000000) fail("renderer_failed", "图表图片未正确生成。");
    const blob = rendered.blob.type === "image/png" ? rendered.blob : new Blob([rendered.blob], { type: "image/png" });
    const digest = await sha256(blob);
    return write(await db(), ["documents", "notes", "excerpts"], async (writeTx) => {
      const currentDocument = await documentRecord(writeTx, documentId);
      const currentNote = await noteRecord(writeTx, documentId, noteId, false);
      if (currentDocument.sha256 !== document.sha256 || canonical(currentNote.rect) !== canonical(note.rect) || currentNote.page !== note.page) fail("source_changed", "原文或来源位置已变化，请重试。", 409);
      const repeated = await writeTx.objectStore("excerpts").get(noteId);
      if (repeated) return { record: excerptRecord(repeated, currentNote), created: false };
      const record = { note_id: noteId, document_id: documentId, source_sha256: document.sha256, sha256: digest, byte_size: blob.size, width: rendered.width, height: rendered.height, created_at: now(), blob };
      await writeTx.objectStore("excerpts").add(record);
      return { record: excerptRecord(record, currentNote), created: true };
    });
  }

  async function route(path, init) {
    const url = new URL(path, "http://device.local");
    if (url.origin !== "http://device.local") fail("route_unsupported", "本机适配器不支持跨源请求。", 404);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const method = (init.method || "GET").toUpperCase();
    const bodyJSON = async () => {
      try {
        const value = typeof init.body === "string" ? JSON.parse(init.body) : init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) ? init.body : {};
        return value && typeof value === "object" && !Array.isArray(value) ? value : fail("validation_error", "请求 JSON 无效。");
      } catch (error) { if (error instanceof DeviceError) throw error; fail("validation_error", "请求 JSON 无效。"); }
    };
    if (method === "GET" && pathname === "/api/v1/access") return json({ mode: "device", storage: "browser", registration_available: false });
    if (method === "GET" && pathname === "/api/v1/reader-capabilities") return json({ source_segments: true, storage: "device" });
    if (method === "GET" && pathname === "/api/v1/reading-capabilities") return json({ ready: false, parser_ready: false, reason: "本机模式仅提供 PDF 原文与笔记，不提供段落解析。", max_pages: 5, parser: null, result_schema_version: 1 });
    if (method === "GET" && pathname === "/api/v1/health") return json({ status: "ok", storage: "device" });
    if (method === "GET" && pathname === "/api/v1/studies") return json({ items: [] });
    if (method === "GET" && pathname === "/api/v1/documents") {
      const items = (await (await db()).getAll("documents")).filter((item) => !item.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).map(baseDocument);
      return json({ items });
    }
    if (method === "GET" && pathname === "/api/v1/documents/trash") {
      const items = (await (await db()).getAll("documents")).filter((item) => item.deleted_at).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at) || a.id.localeCompare(b.id)).map((item) => ({ ...baseDocument(item), revision: item.revision, deleted_at: item.deleted_at }));
      return json({ items });
    }
    if (method === "POST" && pathname === "/api/v1/documents") {
      if (!(init.body instanceof FormData)) fail("validation_error", "请选择 PDF 文件。");
      const file = init.body.get("file");
      const result = await importDocument(file, init.body.get("deduplicate") === "true");
      return json(result.document, result.created ? 201 : 200);
    }
    if (["GET", "POST"].includes(method) && pathname === "/documents/sample") {
      let response;
      try { response = await fetch("/assets/sample.pdf", { cache: "no-store", credentials: "same-origin" }); } catch { fail("sample_unavailable", "示例资料暂时不可用。", 503); }
      if (!response.ok) fail("sample_unavailable", "示例资料暂时不可用。", 503);
      const blob = await response.blob();
      const result = await importDocument(new File([blob], "synrise-neuro-synthetic-sample.pdf", { type: "application/pdf" }), true);
      return json(result.document, result.created ? 201 : 200);
    }
    if (method === "POST" && pathname === "/api/v1/device/backups") {
      if (!(init.body instanceof FormData) || !(init.body.get("file") instanceof Blob)) fail("validation_error", "请选择本机备份 ZIP。");
      const result = await importBackup(await db(), { file: init.body.get("file") }, restoreProgress, (file) => validatePDF(pdfjsLib, file));
      return json({ ...result.document, id: result.document.id, document: result.document, created: result.created, imported: result.created }, result.created ? 201 : 200);
    }
    if (method === "GET" && pathname === "/api/v1/search") {
      const query = (url.searchParams.get("q") || "").trim();
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 40));
      const result = { query, documents: [], notes: [], has_more: false };
      if (url.searchParams.get("include_studies") === "true") result.studies = [];
      if (query) {
        const folded = query.toLocaleLowerCase();
        const documents = (await (await db()).getAll("documents")).filter((item) => !item.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        for (const document of documents) {
          const matched_fields = ["title", "authors", "year", "doi", "original_filename"].filter((key) => document[key] != null && String(document[key]).toLocaleLowerCase().includes(folded));
          if (matched_fields.length && result.documents.length <= limit) result.documents.push({ ...metadata(document), matched_fields });
        }
        const tx = (await db()).transaction(["notes", "documents"], "readonly");
        const notes = await tx.objectStore("notes").getAll();
        for (const note of notes.sort((a, b) => b.created_at?.localeCompare(a.created_at) || b.id.localeCompare(a.id))) {
          if (note.deleted_at || note.purged || !note.text?.toLocaleLowerCase().includes(folded)) continue;
          const owner = documents.find((item) => item.id === note.document_id);
          if (owner && result.notes.length <= limit) result.notes.push({ ...noteState(note), document_title: owner.title });
        }
        await tx.done;
        result.has_more = result.documents.length > limit || result.notes.length > limit;
        result.documents = result.documents.slice(0, limit); result.notes = result.notes.slice(0, limit);
        if (result.studies) result.studies = result.studies.slice(0, limit);
      }
      return json(result);
    }
    let match = /^\/api\/v1\/documents\/([^/]+)(?:\/(.*))?$/.exec(pathname);
    if (match) {
      const documentId = decodeURIComponent(match[1]);
      const rest = match[2] || "";
      if (method === "GET" && !rest) { const tx = (await db()).transaction("documents", "readonly"); return json(baseDocument(await documentRecord(tx, documentId))); }
      if (method === "GET" && rest === "file") { const tx = (await db()).transaction("documents", "readonly"); const document = await documentRecord(tx, documentId); return fileResponse(document.blob, "application/pdf", { "Content-Disposition": `inline; filename="${encodeURIComponent(document.original_filename)}"` }); }
      if (method === "GET" && rest === "metadata") { const tx = (await db()).transaction("documents", "readonly"); return json(metadata(await documentRecord(tx, documentId))); }
      if (method === "PATCH" && rest === "metadata") {
        const payload = await bodyJSON();
        const fingerprint = await sha256(mutationFingerprint(documentId, documentId, "metadata", payload));
        const result = await write(await db(), ["documents", "mutations"], async (tx) => {
          const current = await documentRecord(tx, documentId);
          const receipt = await tx.objectStore("mutations").get(payload.request_id);
          if (receipt) { if (receipt.target !== documentId || receipt.fingerprint !== fingerprint || receipt.result_revision !== current.revision) fail("idempotency_conflict", "这次保存请求与已有记录冲突。", 409); return current; }
          if (!isUUID(payload.request_id) || current.revision !== payload.expected_revision || Object.keys(payload).some((key) => !["request_id", "expected_revision", "title", "authors", "year", "doi"].includes(key)) || !["title", "authors", "year", "doi"].some((key) => Object.hasOwn(payload, key))) fail("revision_conflict", "文献信息已在其他页面更新。", 409);
          if (Object.hasOwn(payload, "title")) current.title = text(payload.title, "标题", 180);
          for (const key of ["authors", "doi"]) if (Object.hasOwn(payload, key)) { if (payload[key] != null && typeof payload[key] !== "string") fail("validation_error", "文献信息无效。"); current[key] = payload[key] == null ? null : payload[key].trim(); if (current[key]?.includes("\0") || (current[key]?.length || 0) > (key === "authors" ? 2000 : 255)) fail("validation_error", "文献信息无效。"); }
          if (Object.hasOwn(payload, "year")) { if (payload.year != null && (!Number.isInteger(payload.year) || payload.year < 1 || payload.year > 9999)) fail("validation_error", "年份无效。"); current.year = payload.year; }
          const stamp = now(); current.revision += 1; current.updated_at = stamp;
          await tx.objectStore("documents").put(current);
          await tx.objectStore("mutations").add({ request_id: payload.request_id, target: documentId, fingerprint, result_revision: current.revision, created_at: stamp });
          return current;
        });
        return json(metadata(result));
      }
      if (method === "DELETE" && !rest) { const result = await mutateDocument(documentId, "trash", await bodyJSON()); return json({ ...baseDocument(result), revision: result.revision, deleted_at: result.deleted_at }); }
      if (method === "POST" && rest === "restore") { const result = await mutateDocument(documentId, "restore", await bodyJSON()); return json({ ...baseDocument(result), revision: result.revision, deleted_at: null }); }
      if (method === "GET" && rest === "purge-preview") { const { planInput, ...preview } = await purgePreview(documentId); return json(preview); }
      if (method === "POST" && rest === "purge") return json(await purgeDocument(documentId, await bodyJSON()));
      if (method === "GET" && rest === "notes") { const tx = (await db()).transaction(["documents", "notes"], "readonly"); await documentRecord(tx, documentId); const items = (await records(tx, "notes", documentId)).filter((note) => !note.deleted_at && !note.purged).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).map(baseNote); return json({ items }); }
      if (method === "POST" && (rest === "notes" || rest === "image-notes")) { const result = await createNote(documentId, await bodyJSON(), rest === "image-notes"); return json(result.note, result.created ? 201 : 200); }
      if (method === "GET" && rest === "note-states") { const tx = (await db()).transaction(["documents", "notes"], "readonly"); await documentRecord(tx, documentId); const items = (await records(tx, "notes", documentId)).filter((note) => !note.purged).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).map(noteState); return json({ items }); }
      if (method === "GET" && rest === "images") { const tx = (await db()).transaction(["documents", "notes", "images"], "readonly"); await documentRecord(tx, documentId); return json({ items: publicImages(await records(tx, "images", documentId), await records(tx, "notes", documentId)) }); }
      if (method === "POST" && rest === "images") {
        if (!(init.body instanceof FormData) || !isUUID(init.body.get("request_id"))) fail("validation_error", "图片请求编号无效。");
        const file = init.body.get("file");
        if (!(file instanceof Blob)) fail("validation_error", "请选择图片文件。");
        const requestId = init.body.get("request_id");
        const name = safeFilename(file.name, "image");
        const digest = await sha256(file);
        const checkTx = (await db()).transaction(["documents", "images", "notes"], "readonly");
        await documentRecord(checkTx, documentId);
        const repeated = await checkTx.objectStore("images").get(requestId);
        if (repeated) { if (repeated.document_id !== documentId || repeated.sha256 !== digest || repeated.original_filename !== name) fail("idempotency_conflict", "图片上传请求与已有记录冲突。", 409); return json(imageRecord(repeated, await records(checkTx, "notes", documentId)), 200); }
        const decoded = await decodeImage(file);
        const previewSha = await sha256(decoded.preview);
        const result = await write(await db(), ["documents", "images", "notes"], async (tx) => {
          await documentRecord(tx, documentId);
          const existing = await tx.objectStore("images").get(requestId);
          if (existing) { if (existing.document_id !== documentId || existing.sha256 !== digest || existing.original_filename !== name) fail("idempotency_conflict", "图片上传请求与已有记录冲突。", 409); return { record: existing, created: false }; }
          const record = { id: requestId, document_id: documentId, original_filename: name, mime_type: decoded.type, byte_size: decoded.bytes.byteLength, sha256: digest, width: decoded.width, height: decoded.height, preview_mime_type: decoded.previewType, preview_byte_size: decoded.preview.size, preview_sha256: previewSha, created_at: now(), original: new Blob([decoded.bytes], { type: decoded.type }), preview: decoded.preview };
          await tx.objectStore("images").add(record);
          return { record, created: true };
        });
        const tx = (await db()).transaction("notes", "readonly");
        return json(imageRecord(result.record, await records(tx, "notes", documentId)), result.created ? 201 : 200);
      }
      let child = /^images\/([^/]+)\/(file|original|preview)$/.exec(rest);
      if (method === "GET" && child) { const tx = (await db()).transaction(["documents", "images"], "readonly"); await documentRecord(tx, documentId); const image = await tx.objectStore("images").get(decodeURIComponent(child[1])); if (!image || image.document_id !== documentId) fail("not_found", "找不到这张图片。", 404); const preview = child[2] === "preview"; return fileResponse(preview ? image.preview : image.original, preview ? image.preview_mime_type : image.mime_type); }
      child = /^pages\/([^/]+)\/regions$/.exec(rest);
      if (method === "GET" && child) { const tx = (await db()).transaction("documents", "readonly"); const document = await documentRecord(tx, documentId); const page = Number(child[1]); if (!Number.isInteger(page) || page < 1 || page > document.page_count) fail("invalid_page", "页码超出文件范围。"); return json({ document_id: documentId, page, source_sha256: document.sha256, coordinate_space: "display-normalized", items: [], limited_to: "ruled-tables", unavailable_reason: "local-feature-unavailable" }); }
      child = /^notes\/([^/]+)(?:\/(.*))?$/.exec(rest);
      if (child) {
        const noteId = decodeURIComponent(child[1]);
        const action = child[2] || "";
        if (method === "GET" && action === "state") { const tx = (await db()).transaction(["documents", "notes"], "readonly"); return json(noteState(await noteRecord(tx, documentId, noteId))); }
        if (["PATCH", "DELETE"].includes(method) && !action) return json(noteState(await mutateNote(documentId, noteId, method === "PATCH" ? "patch" : "delete", await bodyJSON())));
        if (method === "POST" && action === "restore") return json(noteState(await mutateNote(documentId, noteId, "restore", await bodyJSON())));
        if (method === "POST" && action === "purge") return json(await mutateNote(documentId, noteId, "purge", await bodyJSON()));
        if (method === "POST" && action === "excerpt") { const result = await createExcerpt(documentId, noteId); return json(result.record, result.created ? 201 : 200); }
        if (method === "GET" && action === "excerpt") { const tx = (await db()).transaction(["documents", "notes", "excerpts"], "readonly"); const document = await documentRecord(tx, documentId); const note = await noteRecord(tx, documentId, noteId, false); const excerpt = await tx.objectStore("excerpts").get(noteId); if (!excerpt) fail("not_found", "这条笔记尚无图表摘录。", 404); if (excerpt.source_sha256 !== document.sha256) fail("source_changed", "图表摘录与原 PDF 版本不一致。", 409); return fileResponse(excerpt.blob, "image/png"); }
      }
      if (method === "GET" && rest === "excerpts") { const tx = (await db()).transaction(["documents", "notes", "excerpts"], "readonly"); await documentRecord(tx, documentId); const notes = await records(tx, "notes", documentId); const byId = new Map(notes.map((note) => [note.id, note])); const items = (await records(tx, "excerpts", documentId)).filter((item) => byId.has(item.note_id) && !byId.get(item.note_id).deleted_at && !byId.get(item.note_id).purged).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.note_id.localeCompare(b.note_id)).map((item) => excerptRecord(item, byId.get(item.note_id))); return json({ items }); }
      if (method === "GET" && rest === "export") {
        const tx = (await db()).transaction(["documents", "notes", "images", "excerpts"], "readonly");
        const snapshot = await readBackupSnapshot(tx, documentId, false);
        await tx.done;
        const progress = readProgress ? await readProgress(baseDocument(snapshot.document)) : undefined;
        const blob = await createDeviceBackup({ ...snapshot, progress });
        return fileResponse(blob, "application/zip", { "Content-Disposition": `attachment; filename="${encodeURIComponent(snapshot.document.title.slice(0, 120))} - reading-record.zip"` });
      }
    }
    match = /^\/documents\/([^/]+)\/export$/.exec(pathname);
    if (method === "GET" && match) return route(`/api/v1/documents/${match[1]}/export`, init);
    fail("local_feature_unavailable", "本机模式不支持此功能，且不会将资料上传到服务器。", 501);
  }

  return {
    ready,
    async request(path, init = {}) {
      abortIfNeeded(init.signal);
      try {
        await ready();
        const response = await route(String(path), init);
        abortIfNeeded(init.signal);
        return response;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return errorResponse(error);
      }
    }
  };
}

export { mapDeviceAssetUrl };
