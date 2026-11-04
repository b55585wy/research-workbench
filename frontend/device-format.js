const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COLORS = new Set(["yellow", "green", "blue", "pink"]);

export class DeviceError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = "DeviceError";
    this.code = code;
    this.status = status;
  }
}

export function fail(code, message, status = 422) { throw new DeviceError(code, message, status); }
export function now() { return new Date().toISOString(); }
export function isUUID(value) { return typeof value === "string" && UUID.test(value); }
export function isSHA(value) { return typeof value === "string" && SHA256.test(value); }
export function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value instanceof Blob ? await value.arrayBuffer() : value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}

export function errorResponse(error) {
  const local = error instanceof DeviceError;
  const code = local ? error.code : error?.name === "QuotaExceededError" ? "storage_quota" : "storage_unavailable";
  const status = local ? error.status : error?.name === "QuotaExceededError" ? 507 : 503;
  const message = code === "storage_quota" ? "本机存储空间不足，请导出备份并清理空间后重试。" : local ? error.message : "本机资料存储暂时不可用，请保留草稿后重试。";
  return json({ detail: { code, message } }, status);
}

function object(value, allowed, required = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("validation_error", "请求内容格式不正确。");
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) fail("validation_error", "请求包含缺少或不受支持的字段。");
  return value;
}

export function text(value, label = "笔记", maximum = 10000) {
  if (typeof value !== "string" || value.length > maximum) fail("validation_error", `${label}长度超出限制。`);
  const result = value.trim();
  if (!result || result.includes("\0")) fail("validation_error", `${label}不能为空或包含 NUL。`);
  return result;
}

export function rect(value) {
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== "number" || !Number.isFinite(item) || item < 0 || item > 1) || value[0] >= value[2] || value[1] >= value[3]) fail("validation_error", "请选择有效的归一化页面区域。");
  return [...value];
}

function bounds(rects) {
  return [Math.min(...rects.map((item) => item[0])), Math.min(...rects.map((item) => item[1])), Math.max(...rects.map((item) => item[2])), Math.max(...rects.map((item) => item[3]))];
}

function sameRect(left, right) { return left.every((value, index) => Math.abs(value - right[index]) <= 1e-6); }

function annotation(value) {
  object(value, ["kind", "color", "quote", "rects"], ["kind", "color", "quote", "rects"]);
  if (!["highlight", "underline"].includes(value.kind) || !COLORS.has(value.color) || !Array.isArray(value.rects) || value.rects.length < 1 || value.rects.length > 256) fail("validation_error", "文字批注格式不正确。");
  return { kind: value.kind, color: value.color, quote: text(value.quote, "引用"), rects: value.rects.map(rect) };
}

function sourceSegments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail("validation_error", "跨页来源需要 1 到 20 个连续区段。");
  if (canonical(value).length > 262144) fail("validation_error", "跨页来源内容超出限制。", 413);
  let previous = 0;
  let total = 0;
  const result = value.map((item) => {
    object(item, ["page", "quote", "rects"], ["page", "quote", "rects"]);
    if (!Number.isInteger(item.page) || item.page <= previous || item.page > 200) fail("validation_error", "跨页来源页码必须递增且不能重复。");
    previous = item.page;
    const quote = text(item.quote, "引用");
    total += quote.length;
    if (total > 10000 || !Array.isArray(item.rects) || item.rects.length < 1 || item.rects.length > 256) fail("validation_error", "跨页来源内容超出限制。");
    return { page: item.page, quote, rects: item.rects.map(rect) };
  });
  return result;
}

function point(value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== "number" || !Number.isFinite(item) || item < 0 || item > 1)) fail("validation_error", "形状坐标必须是归一化数值。");
  return [...value];
}

export function shapeBounds(kind, points) {
  if (["rectangle", "textbox", "ellipse"].includes(kind) && (points[0][0] === points[1][0] || points[0][1] === points[1][1])) fail("validation_error", "形状需要两个不同的角点。");
  if (["arrow", "line"].includes(kind) && points[0][0] === points[1][0] && points[0][1] === points[1][1]) fail("validation_error", "线段端点不能相同。");
  let left = Math.min(...points.map((item) => item[0]));
  let right = Math.max(...points.map((item) => item[0]));
  let top = Math.min(...points.map((item) => item[1]));
  let bottom = Math.max(...points.map((item) => item[1]));
  if (["arrow", "line", "ink"].includes(kind)) {
    if (left === right) { left = Math.max(0, left - 0.0005); right = Math.min(1, right + 0.0005); }
    if (top === bottom) { top = Math.max(0, top - 0.0005); bottom = Math.min(1, bottom + 0.0005); }
  }
  return [left, top, right, bottom];
}

export function validateShape(value) {
  const kinds = ["rectangle", "arrow", "textbox", "line", "ellipse", "ink"];
  object(value, ["kind", "color", "line_width", "font_size", "points"], ["kind", "color", "points"]);
  if (!kinds.includes(value.kind)) fail("validation_error", "不支持这种形状批注。");
  const textbox = value.kind === "textbox";
  if (textbox ? !["black", "blue", "green", "red"].includes(value.color) : !COLORS.has(value.color)) fail("validation_error", "形状颜色不受支持。");
  if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > (value.kind === "ink" ? 512 : 2) || (value.kind !== "ink" && value.points.length !== 2)) fail("validation_error", "形状点数不正确。");
  const points = value.points.map(point);
  if (value.kind === "ink" && new Set(points.map((item) => item.join(","))).size < 2) fail("validation_error", "手绘轨迹需要不同坐标。");
  const result = { kind: value.kind, color: value.color, points };
  if (textbox) {
    if (!Number.isInteger(value.font_size) || value.font_size < 8 || value.font_size > 48 || value.line_width !== undefined) fail("validation_error", "文本框字号不正确。");
    result.font_size = value.font_size;
  } else {
    if (!Number.isInteger(value.line_width) || value.line_width < 1 || value.line_width > 4 || value.font_size !== undefined) fail("validation_error", "形状线宽不正确。");
    result.line_width = value.line_width;
  }
  shapeBounds(result.kind, result.points);
  return result;
}

function validLink(value) {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\x00-\x1f]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}

function richImage(value) {
  object(value, ["research_image"], ["research_image"]);
  const image = value.research_image;
  object(image, ["document_id", "image_id", "sha256", "alt"], ["document_id", "image_id", "sha256", "alt"]);
  if (!isUUID(image.document_id) || !isUUID(image.image_id) || !isSHA(image.sha256) || typeof image.alt !== "string" || !image.alt.trim() || image.alt.length > 180 || /[\x00-\x1f\x7f]/.test(image.alt)) fail("validation_error", "正文图片引用不正确。");
  return { research_image: clone(image) };
}

export function richReferences(content) {
  const result = new Map();
  for (const op of content?.ops || []) {
    if (typeof op.insert === "string") continue;
    const image = op.insert.research_image;
    const old = result.get(image.image_id);
    if (old && (old.document_id !== image.document_id || old.sha256 !== image.sha256)) fail("validation_error", "正文图片引用互相冲突。");
    result.set(image.image_id, image);
  }
  return result;
}

export function richText(content) {
  object(content, ["version", "ops"], ["version", "ops"]);
  if (![1, 2].includes(content.version) || !Number.isInteger(content.version) || !Array.isArray(content.ops) || content.ops.length < 1 || content.ops.length > 512) fail("validation_error", "富文本格式不受支持。");
  let length = 0;
  const clean = [];
  for (const op of content.ops) {
    object(op, ["insert", "attributes"], ["insert"]);
    if (content.version === 2 && op.insert && typeof op.insert === "object") {
      if (Object.keys(op).length !== 1) fail("validation_error", "图片不能带文字格式。");
      const item = richImage(op.insert);
      length += `[Image: ${item.research_image.alt}]`.length;
      clean.push({ insert: item });
    } else {
      if (typeof op.insert !== "string" || !op.insert || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(op.insert)) fail("validation_error", "富文本包含不支持的插入内容。");
      length += op.insert.length;
      const attrs = op.attributes === undefined ? {} : op.attributes;
      object(attrs, ["bold", "italic", "underline", "header", "list", "link"]);
      for (const key of ["bold", "italic", "underline"]) if (key in attrs && attrs[key] !== true) fail("validation_error", "富文本格式标记不正确。");
      if ("link" in attrs && !validLink(attrs.link)) fail("validation_error", "仅支持不带凭据的 HTTP(S) 链接。");
      if ("header" in attrs && ![1, 2].includes(attrs.header)) fail("validation_error", "标题级别不受支持。");
      if ("list" in attrs && !["bullet", "ordered"].includes(attrs.list)) fail("validation_error", "列表格式不受支持。");
      if ("header" in attrs && "list" in attrs) fail("validation_error", "同一行不能同时是标题和列表。");
      if (("header" in attrs || "list" in attrs) && op.insert.replaceAll("\n", "")) fail("validation_error", "行格式只能用于换行。");
      const item = { insert: op.insert };
      if (Object.keys(attrs).length) item.attributes = clone(attrs);
      const previous = clean.at(-1);
      if (previous && typeof previous.insert === "string" && canonical(previous.attributes) === canonical(item.attributes)) previous.insert += item.insert;
      else clean.push(item);
    }
    if (length > 10001) fail("validation_error", "富文本内容过长。");
  }
  if (typeof clean.at(-1)?.insert !== "string" || !clean.at(-1).insert.endsWith("\n")) fail("validation_error", "富文本必须以换行结束。");
  const result = { version: content.version, ops: clean };
  if (content.version === 2 && richReferences(result).size > 8) fail("validation_error", "正文图片过多。");
  if (!plainText(result) || new TextEncoder().encode(canonical(result)).byteLength > 65536) fail("validation_error", "富文本为空或超过 64 KiB。");
  return result;
}

export function plainText(content) {
  return content.ops.map((op) => typeof op.insert === "string" ? op.insert : `[Image: ${op.insert.research_image.alt}]`).join("").trim();
}

function escapeHTML(value) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

export function richHTML(content) {
  const lines = [];
  let pieces = "";
  for (const op of content.ops) {
    if (typeof op.insert !== "string") {
      const image = op.insert.research_image;
      pieces += `<img src="/api/v1/documents/${image.document_id}/images/${image.image_id}/preview" alt="${escapeHTML(image.alt)}" loading="lazy">`;
      continue;
    }
    const attrs = op.attributes || {};
    const parts = op.insert.split("\n");
    parts.forEach((part, index) => {
      if (part) {
        let body = escapeHTML(part);
        for (const [key, tag] of [["bold", "strong"], ["italic", "em"], ["underline", "u"]]) if (attrs[key]) body = `<${tag}>${body}</${tag}>`;
        if (attrs.link) body = `<a href="${escapeHTML(attrs.link)}" rel="noopener noreferrer">${body}</a>`;
        pieces += body;
      }
      if (index < parts.length - 1) { lines.push([attrs, pieces]); pieces = ""; }
    });
  }
  let listing = null;
  let output = "";
  for (const [attrs, body] of lines) {
    const kind = attrs.list === "bullet" ? "ul" : attrs.list === "ordered" ? "ol" : null;
    if (kind !== listing) { if (listing) output += `</${listing}>`; if (kind) output += `<${kind}>`; listing = kind; }
    const tag = kind ? "li" : attrs.header ? `h${attrs.header}` : "p";
    output += `<${tag}>${body || "<br>"}</${tag}>`;
  }
  if (listing) output += `</${listing}>`;
  return output;
}

export function validateNoteCreate(payload, document, imageNote = false) {
  const allowed = ["request_id", "page", "source", "rect", "text", "rich_content", "annotation", "shape_annotation", "source_segments"];
  if (imageNote) allowed.push("image_ids");
  object(payload, allowed, ["request_id", "page", "text"]);
  if (!isUUID(payload.request_id) || !Number.isInteger(payload.page) || payload.page < 1 || payload.page > document.page_count || (payload.source !== undefined && payload.source !== null)) fail("validation_error", "笔记请求或页码不正确。");
  const result = { id: payload.request_id, document_id: document.id, page: payload.page, rect: payload.rect == null ? null : rect(payload.rect), text: text(payload.text), created_at: now() };
  if (payload.rich_content != null) {
    result.rich_content = richText(payload.rich_content);
    if (plainText(result.rich_content) !== result.text) fail("validation_error", "富文本与纯文本内容不一致。");
  }
  if (payload.source_segments !== undefined) {
    if (payload.shape_annotation) fail("validation_error", "形状批注不能使用跨页文字来源。");
    result.source_segments = sourceSegments(payload.source_segments);
    if (result.source_segments.some((segment) => segment.page > document.page_count)) fail("invalid_page", "来源页码超出文件范围。");
    const primaryRect = bounds(result.source_segments[0].rects);
    if (result.page !== result.source_segments[0].page || (result.rect && !sameRect(result.rect, primaryRect))) fail("validation_error", "笔记主锚点必须与第一个来源区段一致。");
    result.rect = primaryRect;
  }
  if (payload.annotation != null) {
    const value = annotation(payload.annotation);
    const source = result.source_segments?.[0];
    if (!result.rect || (source ? value.quote !== source.quote || canonical(value.rects) !== canonical(source.rects) : value.quote !== result.text) || !sameRect(bounds(value.rects), result.rect)) fail("validation_error", "文字批注与来源位置不一致。");
    result.annotation = { ...value, source_sha256: document.sha256 };
  }
  if (payload.shape_annotation != null) {
    if (result.annotation) fail("validation_error", "形状批注不能同时是文字批注。");
    const value = validateShape(payload.shape_annotation);
    const shapeRect = shapeBounds(value.kind, value.points);
    if (result.rect && !sameRect(shapeRect, result.rect)) fail("validation_error", "形状边界与笔记区域不一致。");
    result.rect = shapeRect;
    result.shape_annotation = { ...value, source_sha256: document.sha256 };
    if (value.kind === "textbox" && result.text.length > 2000) fail("validation_error", "文本框内容过长。");
  }
  if (imageNote) {
    if (!Array.isArray(payload.image_ids) || payload.image_ids.length < 1 || payload.image_ids.length > 4 || payload.image_ids.some((id) => !isUUID(id)) || new Set(payload.image_ids).size !== payload.image_ids.length) fail("validation_error", "笔记图片选择不正确。");
    result.image_ids = [...payload.image_ids].sort();
  }
  return result;
}

export function baseDocument(record) {
  const result = {};
  for (const key of ["id", "title", "original_filename", "page_count", "byte_size", "sha256", "created_at"]) result[key] = record[key];
  return result;
}

export function metadata(record) {
  const result = { ...baseDocument(record) };
  for (const key of ["authors", "year", "doi", "revision", "updated_at"]) result[key] = record[key];
  return result;
}

export function baseNote(record) {
  const result = {};
  for (const key of ["id", "document_id", "page", "rect", "text", "created_at"]) result[key] = clone(record[key]);
  if (record.source_segments) result.source_segments = clone(record.source_segments);
  return result;
}

export function noteState(record) {
  const result = { ...baseNote(record) };
  for (const key of ["revision", "review_status", "reviewed_at", "updated_at", "deleted_at", "annotation", "shape_annotation"]) result[key] = clone(record[key]);
  result.review_provenance = record.review_status === "source_checked" ? "self_reported" : null;
  if (record.rich_content) { result.rich_content = clone(record.rich_content); result.rich_html = richHTML(record.rich_content); }
  return result;
}

export function imageRecord(record, notes) {
  const result = {};
  for (const key of ["id", "document_id", "original_filename", "mime_type", "byte_size", "sha256", "width", "height", "preview_mime_type", "preview_byte_size", "preview_sha256", "created_at"]) result[key] = record[key];
  const prefix = `/api/v1/documents/${record.document_id}/images/${record.id}`;
  return { ...result, source_kind: "user_upload", file_url: `${prefix}/file`, preview_url: `${prefix}/preview`, note_ids: notes.filter((note) => !note.deleted_at && !note.purged && note.image_ids?.includes(record.id)).map((note) => note.id).sort() };
}

export function excerptRecord(record, note) {
  const result = {};
  for (const key of ["note_id", "source_sha256", "sha256", "byte_size", "width", "height", "created_at"]) result[key] = record[key];
  return { ...result, document_id: note.document_id, page: note.page, rect: clone(note.rect), image_url: `/api/v1/documents/${note.document_id}/notes/${note.id}/excerpt` };
}

export function mutationFingerprint(scope, target, kind, payload) {
  const data = clone(payload);
  delete data.request_id;
  return canonical({ scope, target, kind, data });
}
