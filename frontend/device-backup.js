import { Zip, ZipPassThrough, Unzip, strToU8, strFromU8 } from "./vendor/device-storage/device-storage.js";
import { DeviceError, baseDocument, canonical, clone, fail, isSHA, isUUID, masteryLevel, metadata, noteState, sha256, validateNoteCreate, validateShape } from "./device-format.js";

export const DEVICE_BACKUP_FORMAT = "research-workspace-device/v1";
const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_JSON = 16 * 1024 * 1024;
const MAX_IMAGES = 200;
const MAX_NOTES = 2000;
const MAX_EXCERPTS = 2000;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_PREVIEW = 2 * 1024 * 1024;
const MAX_EXCERPT = 8 * 1024 * 1024;
const MAX_FILES = 2404;

function zipBytes(entries) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const zip = new Zip((error, data, final) => {
      if (error) { reject(error); return; }
      size += data.byteLength;
      if (size > MAX_ARCHIVE) { reject(new DeviceError("backup_too_large", "备份超过 64 MiB 限制。", 413)); return; }
      chunks.push(data);
      if (final) resolve(new Blob(chunks, { type: "application/zip" }));
    });
    for (const [name, bytes] of entries) {
      const file = new ZipPassThrough(name);
      zip.add(file);
      file.push(bytes, true);
    }
    zip.end();
  });
}

async function unzipStored(blob) {
  if (!(blob instanceof Blob) || blob.size > MAX_ARCHIVE) fail("backup_too_large", "备份超过 64 MiB 限制。", 413);
  return new Promise((resolve, reject) => {
    const entries = new Map();
    const pending = new Set();
    const names = new Set();
    let ended = false;
    let failed = false;
    let declaredTotal = 0;
    let actualTotal = 0;
    const rejectOnce = (error) => { if (!failed) { failed = true; reject(error instanceof DeviceError ? error : new DeviceError("invalid_backup", "备份 ZIP 无法读取。")); } };
    const finish = () => { if (ended && pending.size === 0 && !failed) resolve(entries); };
    const unzip = new Unzip((file) => {
      try {
        const name = file.name;
        if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..") || /[\x00-\x1f\x7f]/.test(name) || names.has(name)) fail("invalid_backup", "备份包含重复或不安全路径。");
        if (names.size >= MAX_FILES) fail("invalid_backup", "备份文件数量超出限制。");
        if (file.compression !== 0) fail("unsupported_backup_compression", "本机备份仅接受 method 0（未压缩）ZIP。");
        for (const declared of [file.size, file.originalSize]) {
          if (declared === undefined) continue;
          if (!Number.isFinite(declared) || !Number.isSafeInteger(declared) || declared < 0) fail("invalid_backup", "备份条目声明长度无效。");
          if (declared > MAX_ARCHIVE) fail("backup_too_large", "备份展开后超过 64 MiB 限制。", 413);
        }
        if (file.size !== undefined && file.originalSize !== undefined && file.size !== file.originalSize) fail("invalid_backup", "备份条目声明长度不一致。");
        const declaredSize = file.originalSize ?? file.size;
        if (declaredSize !== undefined) {
          declaredTotal += declaredSize;
          if (declaredTotal > MAX_ARCHIVE) fail("backup_too_large", "备份展开后超过 64 MiB 限制。", 413);
        }
        names.add(name);
        pending.add(name);
        const chunks = [];
        let size = 0;
        file.ondata = (error, data, final) => {
          if (failed) return;
          if (error) { rejectOnce(error); return; }
          size += data.byteLength;
          actualTotal += data.byteLength;
          if (size > MAX_ARCHIVE || actualTotal > MAX_ARCHIVE) { rejectOnce(new DeviceError("backup_too_large", "备份展开后超过 64 MiB 限制。", 413)); return; }
          if (declaredSize !== undefined && size > declaredSize) { rejectOnce(new DeviceError("invalid_backup", "备份条目长度不一致。")); return; }
          chunks.push(data.slice());
          if (final) {
            if (declaredSize !== undefined && size !== declaredSize) { rejectOnce(new DeviceError("invalid_backup", "备份条目长度不一致。")); return; }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            entries.set(name, bytes);
            pending.delete(name);
            finish();
          }
        };
        file.start();
      } catch (error) { rejectOnce(error); }
    });
    unzip.onerror = rejectOnce;
    (async () => {
      const reader = blob.stream().getReader();
      while (!failed) {
        const { done, value } = await reader.read();
        if (done) break;
        unzip.push(value, false);
      }
      if (failed) { await reader.cancel(); return; }
      ended = true;
      unzip.push(new Uint8Array(), true);
      if (!failed && pending.size) { rejectOnce(new DeviceError("invalid_backup", "备份 ZIP 不完整或已截断。")); return; }
      finish();
    })().catch(rejectOnce);
  });
}

function safeProgress(value) {
  if (value === undefined) return undefined;
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > 65536) fail("backup_invalid_progress", "阅读位置记录过大。");
  return clone(value);
}

export async function createDeviceBackup({ document, notes, images, excerpts, progress }) {
  const exported = metadata(document);
  const data = {
    format: DEVICE_BACKUP_FORMAT,
    document: exported,
    notes: notes.filter((note) => !note.purged).map((note) => ({ ...noteState(note), image_ids: [...(note.image_ids || [])].sort(), attached_image_ids: [...(note.attached_image_ids || [])].sort() })),
    images: images.map((image) => {
      const result = {};
      for (const key of ["id", "document_id", "original_filename", "mime_type", "byte_size", "sha256", "width", "height", "preview_mime_type", "preview_byte_size", "preview_sha256", "created_at"]) result[key] = image[key];
      result.image_ids = undefined;
      delete result.image_ids;
      return result;
    }),
    excerpts: excerpts.map((item) => {
      const result = {};
      for (const key of ["note_id", "document_id", "source_sha256", "sha256", "byte_size", "width", "height", "created_at"]) result[key] = item[key];
      return result;
    })
  };
  const position = safeProgress(progress);
  if (position !== undefined) data.reading_progress = position;
  if (data.notes.length > MAX_NOTES || data.images.length > MAX_IMAGES || data.excerpts.length > MAX_EXCERPTS) fail("backup_too_large", "备份记录数量超出限制。", 413);
  const dataBytes = strToU8(JSON.stringify(data));
  if (dataBytes.byteLength > MAX_JSON) fail("backup_too_large", "备份数据超过 16 MiB 限制。", 413);
  const sourceBytes = new Uint8Array(await document.blob.arrayBuffer());
  if (sourceBytes.byteLength !== document.byte_size || await sha256(sourceBytes) !== document.sha256) fail("source_changed", "原 PDF 已变化，请检查后重试。", 409);
  const files = new Map([["data.json", dataBytes], ["source.pdf", sourceBytes]]);
  for (const image of images) {
    const original = new Uint8Array(await image.original.arrayBuffer());
    const preview = new Uint8Array(await image.preview.arrayBuffer());
    if (original.byteLength !== image.byte_size || preview.byteLength !== image.preview_byte_size || await sha256(original) !== image.sha256 || await sha256(preview) !== image.preview_sha256) fail("image_missing", "图片缺失或已变化，请检查后重试。", 409);
    files.set(`images/${image.id}/original`, original);
    files.set(`images/${image.id}/preview`, preview);
  }
  for (const excerpt of excerpts) {
    const bytes = new Uint8Array(await excerpt.blob.arrayBuffer());
    if (bytes.byteLength !== excerpt.byte_size || await sha256(bytes) !== excerpt.sha256) fail("excerpt_corrupt", "图表图片缺失或已变化。", 409);
    files.set(`excerpts/${excerpt.note_id}.png`, bytes);
  }
  const manifest = { format: DEVICE_BACKUP_FORMAT, document_id: document.id, source_sha256: document.sha256, files: {} };
  let total = 0;
  for (const [name, bytes] of files) {
    total += bytes.byteLength;
    if (total > MAX_ARCHIVE) fail("backup_too_large", "备份超过 64 MiB 限制。", 413);
    manifest.files[name] = { byte_size: bytes.byteLength, sha256: await sha256(bytes) };
  }
  files.set("manifest.json", strToU8(JSON.stringify(manifest)));
  return zipBytes(files);
}

function jsonEntry(files, name) {
  const bytes = files.get(name);
  if (!bytes || bytes.byteLength > MAX_JSON) fail("invalid_backup", `备份缺少有效的 ${name}。`);
  try { return JSON.parse(strFromU8(bytes)); } catch { fail("invalid_backup", `备份 ${name} 不是有效 JSON。`); }
}

function checkTimestamp(value) {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) fail("invalid_backup", "备份时间记录无效。");
}

function checkDocument(value) {
  if (!value || typeof value !== "object" || !isUUID(value.id) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 180 || typeof value.original_filename !== "string" || value.original_filename.length > 180 || !Number.isInteger(value.page_count) || value.page_count < 1 || value.page_count > 200 || !Number.isInteger(value.byte_size) || value.byte_size < 1 || value.byte_size > 20 * 1024 * 1024 || !isSHA(value.sha256) || !Number.isInteger(value.revision) || value.revision < 1) fail("invalid_backup", "备份文献记录无效。");
  if (value.authors != null && (typeof value.authors !== "string" || value.authors.length > 2000)) fail("invalid_backup", "备份作者记录无效。");
  if (value.year != null && (!Number.isInteger(value.year) || value.year < 1 || value.year > 9999)) fail("invalid_backup", "备份年份无效。");
  if (value.doi != null && (typeof value.doi !== "string" || value.doi.length > 255)) fail("invalid_backup", "备份 DOI 无效。");
  checkTimestamp(value.created_at); checkTimestamp(value.updated_at);
  return { ...clone(value), authors: value.authors ?? null, year: value.year ?? null, doi: value.doi ?? null, deleted_at: null };
}

function checkImage(value, document) {
  if (!value || typeof value !== "object" || !isUUID(value.id) || value.document_id !== document.id || typeof value.original_filename !== "string" || value.original_filename.length > 180 || !["image/png", "image/jpeg", "image/webp"].includes(value.mime_type) || !Number.isInteger(value.byte_size) || value.byte_size < 1 || value.byte_size > MAX_IMAGE || !isSHA(value.sha256) || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || Math.max(value.width, value.height) > 8192 || value.width * value.height > 16000000 || !["image/png", "image/jpeg"].includes(value.preview_mime_type) || !Number.isInteger(value.preview_byte_size) || value.preview_byte_size < 1 || value.preview_byte_size > MAX_PREVIEW || !isSHA(value.preview_sha256)) fail("invalid_backup", "备份图片记录无效。");
  checkTimestamp(value.created_at);
  return clone(value);
}

function checkNote(value, document, imageIds) {
  if (!value || typeof value !== "object" || !isUUID(value.id) || value.document_id !== document.id || !Number.isInteger(value.revision) || value.revision < 1 || !["unreviewed", "source_checked"].includes(value.review_status) || (value.deleted_at != null && typeof value.deleted_at !== "string")) fail("invalid_backup", "备份笔记生命周期无效。");
  checkTimestamp(value.created_at); checkTimestamp(value.updated_at);
  if (value.reviewed_at != null) checkTimestamp(value.reviewed_at);
  if (value.deleted_at != null) checkTimestamp(value.deleted_at);
  if (!Array.isArray(value.image_ids) || !Array.isArray(value.attached_image_ids) || [...value.image_ids, ...value.attached_image_ids].some((id) => !isUUID(id))) fail("invalid_backup", "备份笔记图片引用无效。");
  const attached = [...new Set(value.attached_image_ids)].sort();
  const linked = [...attached];
  for (const op of value.rich_content?.ops || []) if (typeof op.insert !== "string") linked.push(op.insert.research_image.image_id);
  const unique = [...new Set(linked)];
  if (canonical(unique.slice().sort()) !== canonical(value.image_ids.slice().sort())) fail("invalid_backup", "备份笔记图片链接清单不一致。");
  const payload = { request_id: value.id, page: value.page, rect: value.rect, text: value.text };
  if (value.rich_content) payload.rich_content = value.rich_content;
  if (value.source_segments) payload.source_segments = value.source_segments;
  if (value.annotation) {
    const { source_sha256, ...annotation } = value.annotation;
    if (source_sha256 !== document.sha256) fail("invalid_backup", "文字批注来源哈希不一致。");
    payload.annotation = annotation;
  }
  if (value.shape_annotation) {
    const { source_sha256, ...shape } = value.shape_annotation;
    if (source_sha256 !== document.sha256) fail("invalid_backup", "形状批注来源哈希不一致。");
    payload.shape_annotation = shape;
  }
  if (attached.length) payload.image_ids = attached;
  const checked = validateNoteCreate(payload, document, attached.length > 0);
  return { ...checked, created_at: value.created_at, image_ids: unique.sort(), attached_image_ids: attached, revision: value.revision, mastery_level: value.mastery_level === undefined ? 0 : masteryLevel(value.mastery_level), review_status: value.review_status, reviewed_at: value.reviewed_at ?? null, updated_at: value.updated_at, deleted_at: value.deleted_at ?? null };
}

export async function readDeviceBackup(blob) {
  const files = await unzipStored(blob);
  const manifest = jsonEntry(files, "manifest.json");
  const data = jsonEntry(files, "data.json");
  if (manifest?.format !== DEVICE_BACKUP_FORMAT || data?.format !== DEVICE_BACKUP_FORMAT || manifest.document_id !== data.document?.id || manifest.source_sha256 !== data.document?.sha256 || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) fail("unsupported_backup", "仅支持本机 v1 备份。");
  if (files.size !== Object.keys(manifest.files).length + 1 || files.has("manifest.json") === false || Object.keys(manifest.files).some((name) => name === "manifest.json" || !files.has(name)) || [...files.keys()].some((name) => name !== "manifest.json" && !Object.hasOwn(manifest.files, name))) fail("invalid_backup", "备份清单与文件集合不一致。");
  for (const [name, bytes] of files) {
    if (name === "manifest.json") continue;
    const expected = manifest.files[name];
    if (!expected || expected.byte_size !== bytes.byteLength || !isSHA(expected.sha256) || await sha256(bytes) !== expected.sha256) fail("backup_hash_mismatch", "备份文件长度或 SHA-256 校验失败。", 409);
  }
  const document = checkDocument(data.document);
  if (!Array.isArray(data.notes) || data.notes.length > MAX_NOTES || !Array.isArray(data.images) || data.images.length > MAX_IMAGES || !Array.isArray(data.excerpts) || data.excerpts.length > MAX_EXCERPTS) fail("invalid_backup", "备份记录数量超出限制。");
  const images = data.images.map((item) => checkImage(item, document));
  const imageIds = new Set(images.map((item) => item.id));
  if (imageIds.size !== images.length) fail("invalid_backup", "备份图片 ID 重复。");
  const notes = data.notes.map((item) => checkNote(item, document, imageIds));
  const noteIds = new Set(notes.map((item) => item.id));
  if (noteIds.size !== notes.length) fail("invalid_backup", "备份笔记 ID 重复。");
  for (const note of notes) for (const id of note.image_ids) if (!imageIds.has(id)) fail("invalid_backup", "笔记引用了不存在的图片。");
  for (const image of images) {
    image.original = new Blob([files.get(`images/${image.id}/original`)], { type: image.mime_type });
    image.preview = new Blob([files.get(`images/${image.id}/preview`)], { type: image.preview_mime_type });
  }
  const excerpts = data.excerpts.map((item) => {
    if (!item || !isUUID(item.note_id) || !noteIds.has(item.note_id) || item.document_id !== document.id || item.source_sha256 !== document.sha256 || !isSHA(item.sha256) || !Number.isInteger(item.byte_size) || item.byte_size < 1 || item.byte_size > MAX_EXCERPT || !Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 2048 || item.height > 2048 || item.width * item.height > 4000000) fail("invalid_backup", "备份图表摘录无效。");
    checkTimestamp(item.created_at);
    return { ...clone(item), blob: new Blob([files.get(`excerpts/${item.note_id}.png`)], { type: "image/png" }) };
  });
  if (new Set(excerpts.map((item) => item.note_id)).size !== excerpts.length) fail("invalid_backup", "备份图表摘录 ID 重复。");
  const required = ["source.pdf", ...images.flatMap((image) => [`images/${image.id}/original`, `images/${image.id}/preview`]), ...excerpts.map((item) => `excerpts/${item.note_id}.png`)];
  const allowed = new Set(["data.json", ...required]);
  if (required.some((name) => !files.has(name)) || [...files.keys()].some((name) => name !== "manifest.json" && !allowed.has(name))) fail("invalid_backup", "备份缺少记录引用的文件或包含未引用文件。");
  const source = files.get("source.pdf");
  if (source.byteLength !== document.byte_size || await sha256(source) !== document.sha256) fail("backup_hash_mismatch", "原 PDF 校验失败。", 409);
  document.blob = new Blob([source], { type: "application/pdf" });
  return { document, notes, images, excerpts, progress: safeProgress(data.reading_progress) };
}
