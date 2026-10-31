const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_FRAME_AXIS = 2048;
const MAX_FRAME_PIXELS = 4_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_KINDS = new Set(["user_upload", "pdf_excerpt"]);
const PROPOSAL_KINDS = new Set([
  "create_image_annotation",
  "edit_image_annotation",
  "delete_image_annotation",
  "restore_image_annotation"
]);

const messages = {
  zh: {
    title: "图片批注",
    sourceUpload: "用户上传图片 · 非 PDF 截取。批注使用 EXIF 规范化预览图；原图保持不变，仍可下载。",
    sourceExcerpt: "已保存的 PDF 图片摘录。批注使用此 PNG，不代表 PDF 页面坐标。",
    original: "下载原图",
    parent: "返回 PDF 原文位置",
    clear: "清除助手图片上下文",
    zoomIn: "放大",
    zoomOut: "缩小",
    fit: "适应图片",
    pan: "平移",
    new: "新建矩形批注",
    retry: "重试",
    close: "关闭图片批注",
    textLabel: "批注说明",
    textPlaceholder: "描述此区域…",
    save: "保存批注",
    retrySave: "按原请求重试",
    cancel: "取消",
    savedAnnotations: "已保存批注",
    deletedAnnotations: "已删除批注",
    deletedHelp: "已删除批注可以恢复。",
    empty: "这张图片还没有批注。选择“新建矩形批注”并拖动框选。",
    edit: "编辑",
    delete: "删除",
    restore: "恢复",
    confirmDelete: "删除这条图片批注？之后可以在已删除列表中恢复。",
    loading: "正在验证并加载图片…",
    ready: "图片已验证。只有明确保存后才会写入批注。",
    loadFailed: "图片或批注组件无法加载。请重试。",
    frameFailed: "图片内容未通过完整性验证，未显示此图片。请重试。",
    invalidSource: "图片来源或批注数据无效，未显示此图片。",
    saving: "正在保存图片批注…",
    saved: "图片批注已保存。",
    saveFailed: "保存未完成。草稿和原请求已保留，请重试。",
    deleting: "正在删除图片批注…",
    deleted: "图片批注已删除，可以恢复。",
    restoring: "正在恢复图片批注…",
    restored: "图片批注已恢复。",
    validation: "请选择有效矩形，并填写不超过 2000 字的说明。",
    noChanges: "说明和矩形均未变化。",
    revision_conflict: "这条批注已在其他地方更新。草稿和原请求已保留；取消后可明确放弃草稿。",
    source_changed: "图片或来源已变化，未执行写入。草稿已保留。",
    annotation_deleted: "这条批注已删除，请先恢复再编辑。",
    network: "无法连接本地服务。草稿和原请求已保留。",
    not_found: "找不到此图片或批注。它可能已删除或不属于当前文献。",
    request_failed: "操作未完成，请重试。",
    draftRestored: "已恢复此图片的未保存草稿。",
    proposal: "提案预览 · 未保存。查看区域不会执行写入。",
    unknownAnnotation: "找不到链接指定的批注；图片仍可供查看。",
    contextCleared: "已清除助手图片上下文。",
    canvas: "图片批注画布"
  },
  en: {
    title: "Image annotations",
    sourceUpload: "User upload · not a PDF crop. Annotations use the EXIF-normalized preview; the original is preserved and downloadable.",
    sourceExcerpt: "Saved PDF image excerpt. Annotations use this PNG and are not PDF page coordinates.",
    original: "Download original",
    parent: "Return to PDF source",
    clear: "Clear assistant image context",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fit: "Fit image",
    pan: "Pan",
    new: "New rectangle annotation",
    retry: "Retry",
    close: "Close image annotations",
    textLabel: "Annotation description",
    textPlaceholder: "Describe this region…",
    save: "Save annotation",
    retrySave: "Retry exact request",
    cancel: "Cancel",
    savedAnnotations: "Saved annotations",
    deletedAnnotations: "Deleted annotations",
    deletedHelp: "Deleted annotations can be restored.",
    empty: "No annotations on this image yet. Choose “New rectangle annotation” and drag to select a region.",
    edit: "Edit",
    delete: "Delete",
    restore: "Restore",
    confirmDelete: "Delete this image annotation? You can restore it from the deleted list later.",
    loading: "Verifying and loading image…",
    ready: "Image verified. Annotations are written only when you explicitly save.",
    loadFailed: "The image or annotation component could not load. Try again.",
    frameFailed: "The image failed integrity verification and was not displayed. Try again.",
    invalidSource: "The image source or annotation data is invalid. The image was not displayed.",
    saving: "Saving image annotation…",
    saved: "Image annotation saved.",
    saveFailed: "The save was not completed. Your draft and exact request are retained; try again.",
    deleting: "Deleting image annotation…",
    deleted: "Image annotation deleted. It can be restored.",
    restoring: "Restoring image annotation…",
    restored: "Image annotation restored.",
    validation: "Choose a valid rectangle and enter a description of at most 2000 characters.",
    noChanges: "The description and rectangle have not changed.",
    revision_conflict: "This annotation changed elsewhere. Your draft and exact request are retained; Cancel explicitly discards the draft.",
    source_changed: "The image or source changed, so no write occurred. Your draft is retained.",
    annotation_deleted: "This annotation is deleted. Restore it before editing.",
    network: "Cannot connect to the local service. Your draft and exact request are retained.",
    not_found: "The image or annotation could not be found. It may be deleted or belong to another paper.",
    request_failed: "The action could not be completed. Try again.",
    draftRestored: "Your unsaved draft for this image was restored.",
    proposal: "Proposal preview · not saved. Viewing this region performs no write.",
    unknownAnnotation: "The linked annotation was not found; the image is still available.",
    contextCleared: "Assistant image context cleared.",
    canvas: "Image annotation canvas"
  }
};

let sdkModule = null;
let sdkModulePromise = null;
let sdkModuleRetry = 0;
let sdkStylesPromise = null;

function loadSdkModule() {
  if (sdkModule) return Promise.resolve(sdkModule);
  if (!sdkModulePromise) {
    const suffix = sdkModuleRetry ? `?retry=${sdkModuleRetry}` : "";
    sdkModulePromise = import(`/vendor/image-annotations/viewer.js${suffix}`).then((module) => {
      if (!module.OpenSeadragon || !module.createOSDAnnotator || !module.UserSelectAction || !module.ShapeType) {
        throw new Error("Image annotation SDK invalid");
      }
      sdkModule = module;
      return module;
    }).catch((error) => {
      sdkModuleRetry += 1;
      throw error;
    }).finally(() => {
      sdkModulePromise = null;
    });
  }
  return sdkModulePromise;
}

function loadSdkStyles() {
  const existing = document.querySelector("link[data-image-viewer-sdk-css]");
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  if (!sdkStylesPromise) {
    sdkStylesPromise = new Promise((resolve, reject) => {
      const link = existing || document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/vendor/image-annotations/viewer.css";
      link.dataset.imageViewerSdkCss = "";
      link.addEventListener("load", () => {
        link.dataset.loaded = "true";
        resolve();
      }, { once: true });
      link.addEventListener("error", () => {
        link.remove();
        reject(new Error("Image annotation styles unavailable"));
      }, { once: true });
      if (!existing) document.head.append(link);
    }).finally(() => {
      sdkStylesPromise = null;
    });
  }
  return sdkStylesPromise;
}

function loadSdk() {
  return Promise.all([loadSdkModule(), loadSdkStyles(), loadOwnStyles()]).then(([module]) => module);
}

function loadOwnStyles() {
  const existing = document.querySelector("link[data-image-viewer-css]");
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = existing || document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/image-viewer.css";
    link.dataset.imageViewerCss = "";
    link.addEventListener("load", () => {
      link.dataset.loaded = "true";
      resolve();
    }, { once: true });
    link.addEventListener("error", () => {
      link.remove();
      reject(new Error("Image viewer styles unavailable"));
    }, { once: true });
    if (!existing) document.head.append(link);
  });
}

class ViewerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireValid(condition, code = "invalidSource") {
  if (!condition) throw new ViewerError(code);
}

function validRect(rect) {
  return Array.isArray(rect) && rect.length === 4 && rect.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
    && rect[2] > rect[0] && rect[3] > rect[1];
}

function sameRect(left, right) {
  return validRect(left) && validRect(right) && left.every((value, index) => value === right[index]);
}

function sourcePrefix(documentId, kind, sourceId) {
  return `/api/v1/documents/${encodeURIComponent(documentId)}/image-sources/${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}`;
}

function contextKey(documentId, kind, sourceId) {
  return `${documentId}:${kind}:${sourceId}`;
}

function validateDescriptor(source, session) {
  requireValid(source && typeof source === "object");
  requireValid(source.document_id === session.documentId && source.source_kind === session.kind && source.source_id === session.sourceId);
  requireValid(typeof source.label === "string" && source.label.length > 0 && source.label.length <= 500);
  requireValid(SHA256.test(source.source_sha256) && SHA256.test(source.frame_sha256));
  requireValid(Number.isInteger(source.frame_width) && Number.isInteger(source.frame_height));
  requireValid(source.frame_width >= 1 && source.frame_width <= MAX_FRAME_AXIS && source.frame_height >= 1 && source.frame_height <= MAX_FRAME_AXIS);
  requireValid(source.frame_width * source.frame_height <= MAX_FRAME_PIXELS);
  requireValid(Number.isInteger(source.frame_byte_size) && source.frame_byte_size >= 1 && source.frame_byte_size <= MAX_FRAME_BYTES);
  requireValid(["image/png", "image/jpeg"].includes(source.frame_mime_type));
  requireValid(source.frame_url === `${sourcePrefix(session.documentId, session.kind, session.sourceId)}/frame`);
  const expectedOriginal = session.kind === "user_upload"
    ? `/api/v1/documents/${encodeURIComponent(session.documentId)}/images/${encodeURIComponent(session.sourceId)}/file`
    : `/api/v1/documents/${encodeURIComponent(session.documentId)}/notes/${encodeURIComponent(session.sourceId)}/excerpt`;
  requireValid(source.original_url === expectedOriginal);
  if (session.kind === "user_upload") {
    requireValid(source.page === null && source.rect === null && source.parent_note_id === null);
    requireValid(typeof source.original_filename === "string" && source.original_filename.length > 0);
  } else {
    requireValid(Number.isInteger(source.page) && source.page >= 1 && validRect(source.rect));
    requireValid(source.parent_note_id === session.sourceId && source.frame_mime_type === "image/png");
  }
  return source;
}

function validateRecord(record, source) {
  requireValid(record && typeof record === "object" && UUID.test(record.id));
  requireValid(record.document_id === source.document_id && record.source_kind === source.source_kind && record.source_id === source.source_id);
  requireValid(record.source_sha256 === source.source_sha256 && record.frame_sha256 === source.frame_sha256);
  requireValid(record.frame_width === source.frame_width && record.frame_height === source.frame_height);
  requireValid(validRect(record.rect));
  requireValid(typeof record.text === "string" && record.text.trim().length > 0 && record.text.length <= 2000 && !record.text.includes("\0"));
  requireValid(Number.isInteger(record.revision) && record.revision >= 1);
  requireValid(["manual", "agent_proposal"].includes(record.origin));
  requireValid(record.deleted_at === null || typeof record.deleted_at === "string");
  return record;
}

function validateSnapshot(body, session) {
  const source = validateDescriptor(body?.source, session);
  requireValid(Array.isArray(body.items));
  const items = body.items.map((record) => validateRecord(record, source));
  requireValid(new Set(items.map((record) => record.id)).size === items.length);
  return { source, items };
}

async function readFrame(response, source) {
  requireValid(response.headers.get("X-Content-Sha256")?.toLowerCase() === source.frame_sha256, "frameFailed");
  requireValid(response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() === source.frame_mime_type, "frameFailed");
  requireValid(response.body?.getReader, "frameFailed");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FRAME_BYTES || size > source.frame_byte_size) {
        await reader.cancel();
        throw new ViewerError("frameFailed");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  requireValid(size === source.frame_byte_size, "frameFailed");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  requireValid(hash === source.frame_sha256, "frameFailed");
  return bytes;
}

function sdkAnnotation(record, source, sdk) {
  const [left, top, right, bottom] = record.rect;
  const x = left * source.frame_width;
  const y = top * source.frame_height;
  const w = (right - left) * source.frame_width;
  const h = (bottom - top) * source.frame_height;
  return {
    id: record.id,
    bodies: record.text ? [{ purpose: "describing", value: record.text }] : [],
    target: {
      annotation: record.id,
      selector: {
        type: sdk.ShapeType.RECTANGLE,
        geometry: {
          rot: 0,
          x,
          y,
          w,
          h,
          bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }
        }
      }
    }
  };
}

function normalizedRect(annotation, source) {
  const selector = annotation?.target?.selector;
  const geometry = selector?.geometry;
  if (selector?.type !== "RECTANGLE" || !geometry) return null;
  const values = [geometry.x, geometry.y, geometry.w, geometry.h];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const rect = [
    geometry.x / source.frame_width,
    geometry.y / source.frame_height,
    (geometry.x + geometry.w) / source.frame_width,
    (geometry.y + geometry.h) / source.frame_height
  ];
  return validRect(rect) ? rect : null;
}

function errorKey(error, fallback = "request_failed") {
  const code = error?.code;
  return code && Object.hasOwn(messages.en, code) ? code : fallback;
}

export function createImageViewer(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    dialog: byId("image-viewer-dialog"),
    title: byId("image-viewer-title"),
    source: byId("image-viewer-source"),
    status: byId("image-viewer-status"),
    stage: byId("image-viewer-stage"),
    close: byId("image-viewer-close"),
    retry: byId("image-viewer-retry"),
    zoomIn: byId("image-viewer-zoom-in"),
    zoomOut: byId("image-viewer-zoom-out"),
    fit: byId("image-viewer-fit"),
    pan: byId("image-viewer-pan"),
    new: byId("image-annotation-new"),
    original: byId("image-viewer-original"),
    parent: byId("image-viewer-parent-source"),
    preview: byId("image-annotation-preview"),
    editor: byId("image-annotation-editor"),
    text: byId("image-annotation-text"),
    save: byId("image-annotation-save"),
    cancel: byId("image-annotation-cancel"),
    listHeading: byId("image-annotation-list-heading"),
    list: byId("image-annotation-list"),
    deletedToggle: byId("image-annotation-deleted-toggle"),
    deletedList: byId("image-annotation-deleted-list")
  };
  const entries = new Map();
  const contexts = new Map();
  let active = null;
  let language = adapter.getLanguage();
  let returnFocus = null;
  let returnProposalId = null;

  function t(key, values = {}) {
    let text = messages[language]?.[key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function entryFor(documentId, kind, sourceId) {
    const key = contextKey(documentId, kind, sourceId);
    if (!entries.has(key)) {
      entries.set(key, {
        key,
        source: null,
        items: [],
        draft: null,
        operations: new Map(),
        pending: 0,
        mutationVersion: 0
      });
    }
    return entries.get(key);
  }

  function isCurrent(session) {
    return active === session && elements.dialog.open;
  }

  function operationSession(session) {
    if (isCurrent(session)) return session;
    if (active && elements.dialog.open && active.documentId === session.documentId && active.kind === session.kind && active.sourceId === session.sourceId) return active;
    return null;
  }

  function currentEntry(session) {
    return entryFor(session.documentId, session.kind, session.sourceId);
  }

  function setStatus(session, key, kind = "info") {
    if (!session) return;
    session.status = key ? { key, kind } : null;
    if (isCurrent(session)) renderStatus();
  }

  function renderStatus() {
    const status = active?.status;
    elements.status.textContent = status ? t(status.key) : "";
    if (status) elements.status.dataset.kind = status.kind;
    else delete elements.status.dataset.kind;
  }

  function updateContext(session, annotationId = null) {
    if (!session.source || session.proposal) {
      if (session.proposal) {
        contexts.set(session.documentId, {
          source_kind: session.kind,
          source_id: session.sourceId,
          label: session.source?.label || session.sourceId
        });
      }
    } else {
      const context = {
        source_kind: session.kind,
        source_id: session.sourceId,
        label: session.source.label
      };
      if (annotationId && UUID.test(annotationId)) context.annotation_id = annotationId;
      contexts.set(session.documentId, context);
      adapter.imageOpened?.(session.documentId, contexts.get(session.documentId));
    }
    adapter.contextChanged?.();
  }

  function renderText() {
    const session = active;
    elements.close.setAttribute("aria-label", t("close"));
    elements.zoomIn.setAttribute("aria-label", t("zoomIn"));
    elements.zoomOut.setAttribute("aria-label", t("zoomOut"));
    elements.fit.textContent = t("fit");
    elements.pan.textContent = t("pan");
    elements.new.textContent = t("new");
    elements.retry.textContent = t("retry");
    elements.original.textContent = t("original");
    elements.parent.textContent = t("parent");
    elements.stage.setAttribute("aria-label", t("canvas"));
    elements.text.previousElementSibling.textContent = t("textLabel");
    elements.text.placeholder = t("textPlaceholder");
    elements.cancel.textContent = t("cancel");
    elements.listHeading.textContent = t("savedAnnotations");
    elements.deletedToggle.querySelector("summary").textContent = t("deletedAnnotations");
    elements.deletedToggle.querySelector("p").textContent = t("deletedHelp");
    elements.dialog.querySelector('[data-action="clear-image-context"]').textContent = t("clear");
    elements.title.textContent = session?.source?.label || t("title");
    elements.source.textContent = session?.source ? t(session.kind === "user_upload" ? "sourceUpload" : "sourceExcerpt") : "";
    renderStatus();
  }

  function actionButton(action, label, handler, disabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-quiet";
    button.dataset.action = action;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", handler);
    return button;
  }

  function renderRecordList(session, records, deleted) {
    const list = deleted ? elements.deletedList : elements.list;
    list.replaceChildren();
    for (const record of records) {
      const item = document.createElement("li");
      item.className = "image-annotation-item";
      item.dataset.annotationId = record.id;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "image-annotation-open";
      open.dataset.action = deleted ? "view-deleted-image-annotation" : "select-image-annotation";
      const text = document.createElement("span");
      text.className = "image-annotation-text-preview";
      text.textContent = record.text;
      open.append(text);
      open.disabled = deleted || !session.ready;
      open.addEventListener("click", () => selectRecord(session, record));
      item.append(open);
      const actions = document.createElement("div");
      actions.className = "image-annotation-item-actions";
      const operation = currentEntry(session).operations.get(record.id);
      if (deleted) {
        actions.append(actionButton("restore-image-annotation", operation ? t("retry") : t("restore"), () => runLifecycle(session, record, "restore"), Boolean(session.proposal) || !session.ready || currentEntry(session).pending > 0 || operation?.conflicted));
      } else {
        actions.append(
          actionButton("edit-image-annotation", t("edit"), () => startEdit(session, record), Boolean(session.proposal) || !session.ready || currentEntry(session).pending > 0),
          actionButton("delete-image-annotation", operation ? t("retry") : t("delete"), () => runLifecycle(session, record, "delete"), Boolean(session.proposal) || !session.ready || currentEntry(session).pending > 0 || operation?.conflicted)
        );
      }
      item.append(actions);
      list.append(item);
    }
  }

  function render() {
    const session = active;
    if (!session) return;
    renderText();
    const entry = currentEntry(session);
    const draft = entry.draft;
    const preview = session.proposalPreview;
    const pending = entry.pending > 0;
    const editable = session.ready && !session.proposal && !pending;
    for (const control of [elements.zoomIn, elements.zoomOut, elements.fit, elements.pan]) control.disabled = !session.ready;
    elements.new.disabled = !editable;
    elements.new.setAttribute("aria-pressed", String(session.mode === "new"));
    elements.pan.setAttribute("aria-pressed", String(session.mode !== "new"));
    elements.retry.hidden = !session.retryable || pending;
    elements.original.hidden = !session.source;
    if (session.source) {
      elements.original.href = session.source.original_url;
      elements.original.download = session.source.original_filename || `excerpt-${session.sourceId}.png`;
    }
    elements.parent.hidden = session.kind !== "pdf_excerpt" || !session.source;
    elements.preview.hidden = !preview;
    elements.preview.textContent = t("proposal");
    elements.editor.hidden = !draft && !preview;
    const editorText = preview ? preview.text : draft?.text || "";
    if (elements.text.value !== editorText && document.activeElement !== elements.text) elements.text.value = editorText;
    else if (document.activeElement !== elements.text) elements.text.value = editorText;
    elements.text.readOnly = Boolean(preview) || Boolean(draft?.conflicted);
    elements.text.disabled = pending;
    elements.save.disabled = Boolean(preview) || !draft || pending || Boolean(draft.conflicted) || !draft.text.trim();
    elements.save.textContent = t(draft?.saveFailed ? "retrySave" : "save");
    elements.cancel.disabled = pending;
    elements.cancel.hidden = Boolean(preview);
    const activeRecords = entry.items.filter((record) => !record.deleted_at);
    const deletedRecords = entry.items.filter((record) => record.deleted_at);
    renderRecordList(session, activeRecords, false);
    renderRecordList(session, deletedRecords, true);
    elements.deletedToggle.hidden = deletedRecords.length === 0;
    elements.list.querySelectorAll(".image-annotation-empty").forEach((node) => node.remove());
    if (session.ready && !activeRecords.length) {
      const empty = document.createElement("li");
      empty.className = "image-annotation-empty";
      empty.textContent = t("empty");
      elements.list.append(empty);
    }
  }

  function teardownRuntime(session) {
    if (!session) return;
    session.ready = false;
    session.controller?.abort();
    if (session.anno) {
      for (const [event, handler] of session.annotationHandlers || []) session.anno.off(event, handler);
      session.anno.destroy();
      session.anno = null;
    }
    if (session.viewer) {
      session.viewer.destroy();
      session.viewer = null;
    }
    session.stageHost?.remove();
    session.stageHost = null;
    if (session.objectUrl) {
      URL.revokeObjectURL(session.objectUrl);
      session.objectUrl = null;
    }
    session.annotationHandlers = [];
  }

  function focusTarget() {
    if (returnFocus?.isConnected) return returnFocus;
    if (returnProposalId) {
      return document.querySelector(`[data-proposal-id="${CSS.escape(returnProposalId)}"] [data-action="view-image-region"]`);
    }
    return null;
  }

  function restoreFocus() {
    const target = focusTarget();
    returnFocus = null;
    returnProposalId = null;
    target?.focus();
  }

  function close(options = {}) {
    const session = active;
    if (!session) {
      if (elements.dialog.open) elements.dialog.close();
      return;
    }
    active = null;
    teardownRuntime(session);
    if (elements.dialog.open) elements.dialog.close();
    adapter.imageClosed?.(session.documentId);
    if (options.restoreFocus === false) {
      returnFocus = null;
      returnProposalId = null;
    } else {
      restoreFocus();
    }
  }

  function annotationsFor(session) {
    const entry = currentEntry(session);
    const records = entry.items.filter((record) => !record.deleted_at);
    if (session.proposalPreview) return [...records, session.proposalPreview];
    if (entry.draft) return [...records.filter((record) => record.id !== entry.draft.id), entry.draft];
    return records;
  }

  function syncAnnotations(session) {
    if (!isCurrent(session) || !session.anno || !session.source) return;
    const entry = currentEntry(session);
    session.syncing = true;
    try {
      session.anno.setSelected([]);
      if (session.anno.getAnnotations().length) session.anno.clearAnnotations();
      const annotations = annotationsFor(session).map((record) => sdkAnnotation(record, session.source, session.sdk));
      if (annotations.length) session.anno.setAnnotations(annotations);
      const selected = session.proposalPreview || entry.draft;
      if (selected) {
        const editable = !session.proposal && entry.draft && !entry.draft.conflicted && session.mode !== "new";
        session.anno.setSelected(selected.id, Boolean(editable));
      }
    } finally {
      session.syncing = false;
    }
  }

  function fitAnnotation(session, id) {
    if (!isCurrent(session) || !session.ready || !session.anno?.getAnnotationById(id)) return;
    session.anno.fitBounds(id, { padding: 32, immediately: true });
  }

  function selectRecord(session, record) {
    if (!isCurrent(session) || session.proposal || record.deleted_at) return;
    updateContext(session, record.id);
    fitAnnotation(session, record.id);
    session.anno?.setSelected(record.id, currentEntry(session).draft?.id === record.id && !currentEntry(session).draft.conflicted);
  }

  function setMode(session, mode) {
    if (!isCurrent(session) || !session.ready || session.proposal) return;
    session.mode = mode;
    const entry = currentEntry(session);
    if (mode === "new" && !entry.draft) {
      session.anno.setSelected([]);
      session.anno.setDrawingTool("rectangle");
      session.anno.setDrawingEnabled(true);
      setStatus(session, null);
    } else {
      session.mode = "pan";
      session.anno.setDrawingEnabled(false);
      if (entry.draft) {
        session.anno.setSelected(entry.draft.id, !entry.draft.conflicted);
        fitAnnotation(session, entry.draft.id);
      } else {
        session.anno.setSelected([]);
      }
    }
    render();
  }

  function startEdit(session, record) {
    if (!isCurrent(session) || session.proposal || record.deleted_at || currentEntry(session).pending) return;
    const entry = currentEntry(session);
    if (entry.draft) {
      setStatus(session, "draftRestored");
      fitAnnotation(session, entry.draft.id);
      elements.text.focus();
      return;
    }
    entry.draft = {
      type: "edit",
      id: record.id,
      annotationId: record.id,
      text: record.text,
      rect: [...record.rect],
      baseText: record.text,
      baseRect: [...record.rect],
      expectedRevision: record.revision,
      operation: null,
      saveFailed: false,
      conflicted: false
    };
    session.mode = "pan";
    updateContext(session, record.id);
    syncAnnotations(session);
    fitAnnotation(session, record.id);
    setStatus(session, null);
    render();
    elements.text.focus();
  }

  function cancelDraft(session) {
    if (!isCurrent(session) || session.proposal || currentEntry(session).pending) return;
    const entry = currentEntry(session);
    if (!entry.draft) return;
    entry.draft = null;
    session.mode = "pan";
    syncAnnotations(session);
    setStatus(session, null);
    render();
  }

  function createDraft(session, annotation) {
    const entry = currentEntry(session);
    if (entry.draft || session.proposal || session.syncing) return;
    const rect = normalizedRect(annotation, session.source);
    session.syncing = true;
    try {
      session.anno.removeAnnotation(annotation.id);
    } finally {
      session.syncing = false;
    }
    if (!rect) {
      setStatus(session, "validation", "error");
      render();
      return;
    }
    const id = crypto.randomUUID();
    entry.draft = {
      type: "create",
      id,
      annotationId: null,
      text: "",
      rect,
      baseText: "",
      baseRect: null,
      expectedRevision: null,
      operation: null,
      saveFailed: false,
      conflicted: false
    };
    session.mode = "pan";
    session.anno.setDrawingEnabled(false);
    syncAnnotations(session);
    setStatus(session, null);
    render();
    elements.text.focus();
  }

  function updateDraftRect(session, annotation) {
    const entry = currentEntry(session);
    const draft = entry.draft;
    if (!draft || draft.id !== annotation.id || session.syncing || draft.conflicted) return;
    const rect = normalizedRect(annotation, session.source);
    if (!rect) return;
    draft.rect = rect;
    draft.operation = null;
    draft.saveFailed = false;
    render();
  }

  async function mount(session, bytes) {
    const { OpenSeadragon, createOSDAnnotator, UserSelectAction } = session.sdk;
    session.objectUrl = URL.createObjectURL(new Blob([bytes], { type: session.source.frame_mime_type }));
    session.stageHost = document.createElement("div");
    session.stageHost.className = "image-viewer-stage-host";
    elements.stage.replaceChildren(session.stageHost);
    const opened = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new ViewerError("loadFailed")), 20000);
      session.viewer = OpenSeadragon({
        element: session.stageHost,
        showNavigationControl: false,
        drawer: "canvas",
        constrainDuringPan: true
      });
      session.viewer.addOnceHandler("open", () => {
        clearTimeout(timeout);
        const item = session.viewer.world.getItemAt(0);
        const size = item?.getContentSize();
        if (!size || size.x !== session.source.frame_width || size.y !== session.source.frame_height) {
          reject(new ViewerError("frameFailed"));
          return;
        }
        resolve();
      });
      session.viewer.addOnceHandler("open-failed", () => {
        clearTimeout(timeout);
        reject(new ViewerError("frameFailed"));
      });
      session.viewer.open({ type: "image", url: session.objectUrl, buildPyramid: false });
    });
    await opened;
    if (!isCurrent(session)) return;
    session.anno = createOSDAnnotator(session.viewer, {
      drawingEnabled: false,
      drawingMode: "drag",
      autoSave: true,
      userSelectAction: UserSelectAction.SELECT,
      disableUndoRedoKeys: true
    });
    session.anno.setDrawingTool("rectangle");
    session.anno.setUserSelectAction((annotation) => {
      const draft = currentEntry(session).draft;
      return !session.proposal && draft?.id === annotation.id && !draft.conflicted ? UserSelectAction.EDIT : UserSelectAction.SELECT;
    });
    const handlers = [
      ["createAnnotation", (annotation) => {
        if (!session.syncing && session.mode === "new") createDraft(session, annotation);
      }],
      ["updateAnnotation", (annotation) => updateDraftRect(session, annotation)],
      ["selectionChanged", (selected) => {
        if (session.syncing || session.proposal || selected.length !== 1) return;
        const record = currentEntry(session).items.find((item) => item.id === selected[0].id && !item.deleted_at);
        if (record) updateContext(session, record.id);
      }]
    ];
    session.annotationHandlers = handlers;
    for (const [event, handler] of handlers) session.anno.on(event, handler);
    session.ready = true;
    session.mode = currentEntry(session).draft ? "pan" : session.mode;
    syncAnnotations(session);
    const selectedId = session.proposalPreview?.id || session.annotationId || currentEntry(session).draft?.id;
    if (selectedId && session.anno.getAnnotationById(selectedId)) fitAnnotation(session, selectedId);
    else session.viewer.viewport.goHome(true);
  }

  function proposalPreview(session, paper) {
    if (!session.proposal) return null;
    const proposal = session.proposal;
    const payload = proposal.payload;
    requireValid(proposal && PROPOSAL_KINDS.has(proposal.kind) && payload && typeof payload === "object");
    requireValid(payload.source_sha256 === paper.sha256 && payload.image_source_sha256 === session.source.source_sha256 && payload.frame_sha256 === session.source.frame_sha256);
    requireValid(payload.source_kind === session.kind && payload.source_id === session.sourceId);
    let base = null;
    if (proposal.kind !== "create_image_annotation") {
      requireValid(UUID.test(payload.annotation_id) && Number.isInteger(payload.expected_revision) && payload.expected_revision >= 1);
      base = currentEntry(session).items.find((record) => record.id === payload.annotation_id);
      requireValid(base, "not_found");
      requireValid(base.revision === payload.expected_revision, "revision_conflict");
      if (proposal.kind === "restore_image_annotation") requireValid(Boolean(base.deleted_at), "revision_conflict");
      else requireValid(!base.deleted_at, "annotation_deleted");
    }
    const rect = proposal.kind === "create_image_annotation" || proposal.kind === "edit_image_annotation" && payload.rect
      ? payload.rect
      : base?.rect;
    const text = typeof payload.text === "string" ? payload.text : base?.text;
    requireValid(validRect(rect) && typeof text === "string" && text.trim().length > 0 && text.length <= 2000 && !text.includes("\0"));
    return {
      id: `proposal-${proposal.id}`,
      text,
      rect: [...rect],
      revision: base?.revision || 0,
      origin: "agent_proposal",
      deleted_at: null,
      preview: true
    };
  }

  async function load(session) {
    if (!isCurrent(session) || session.loading) return;
    teardownRuntime(session);
    session.controller = new AbortController();
    session.loading = true;
    session.retryable = false;
    session.status = { key: "loading", kind: "info" };
    elements.stage.replaceChildren();
    render();
    try {
      requireValid(UUID.test(session.documentId) && UUID.test(session.sourceId) && IMAGE_KINDS.has(session.kind));
      requireValid(adapter.getDocument()?.id === session.documentId, "not_found");
      const prefix = sourcePrefix(session.documentId, session.kind, session.sourceId);
      const entry = currentEntry(session);
      const mutationVersion = entry.mutationVersion;
      const [body, sdk] = await Promise.all([
        adapter.api(prefix, { signal: session.controller.signal }),
        loadSdk()
      ]);
      if (!isCurrent(session)) return;
      const { source, items } = validateSnapshot(body, session);
      session.source = source;
      session.sdk = sdk;
      entry.source = source;
      if (entry.mutationVersion === mutationVersion) entry.items = items;
      session.proposalPreview = proposalPreview(session, adapter.getDocument());
      updateContext(session, session.annotationId);
      render();
      const response = await adapter.checkedFetch(`${prefix}/frame`, { signal: session.controller.signal });
      const bytes = await readFrame(response, source);
      if (!isCurrent(session)) return;
      await mount(session, bytes);
      if (!isCurrent(session)) return;
      const draft = currentEntry(session).draft;
      if (draft?.annotationId && !entry.items.some((record) => record.id === draft.annotationId && !record.deleted_at)) {
        draft.conflicted = true;
        setStatus(session, "revision_conflict", "error");
        syncAnnotations(session);
      } else if (session.annotationId && !entry.items.some((record) => record.id === session.annotationId)) {
        setStatus(session, "unknownAnnotation", "error");
      } else {
        setStatus(session, session.proposal ? "proposal" : draft ? "draftRestored" : "ready", session.proposal ? "info" : "success");
      }
    } catch (error) {
      if (error?.name === "AbortError" || !isCurrent(session)) return;
      teardownRuntime(session);
      session.controller = new AbortController();
      session.retryable = true;
      setStatus(session, errorKey(error, error instanceof ViewerError ? error.code : "loadFailed"), "error");
    } finally {
      if (active === session) {
        session.loading = false;
        render();
      }
    }
  }

  function operationPayload(session, draft) {
    const base = {
      request_id: null,
      source_sha256: session.source.source_sha256,
      frame_sha256: session.source.frame_sha256
    };
    if (draft.type === "create") {
      return {
        ...base,
        rect: [...draft.rect],
        text: draft.text.trim()
      };
    }
    const payload = {
      ...base,
      expected_revision: draft.expectedRevision
    };
    if (draft.text.trim() !== draft.baseText) payload.text = draft.text.trim();
    if (!sameRect(draft.rect, draft.baseRect)) payload.rect = [...draft.rect];
    return payload;
  }

  async function saveDraft(session) {
    if (!isCurrent(session) || session.proposal || !session.ready) return;
    const entry = currentEntry(session);
    const draft = entry.draft;
    if (!draft || entry.pending || draft.conflicted) return;
    draft.text = elements.text.value;
    const text = draft.text.trim();
    if (!text || text.length > 2000 || text.includes("\0") || !validRect(draft.rect)) {
      setStatus(session, "validation", "error");
      return;
    }
    if (!draft.operation) {
      const payload = operationPayload(session, draft);
      if (draft.type === "edit" && !Object.hasOwn(payload, "text") && !Object.hasOwn(payload, "rect")) {
        setStatus(session, "noChanges", "error");
        return;
      }
      const requestId = crypto.randomUUID();
      payload.request_id = requestId;
      const basePath = `${sourcePrefix(session.documentId, session.kind, session.sourceId)}/annotations`;
      draft.operation = {
        type: draft.type,
        requestId,
        payload,
        path: draft.type === "create" ? basePath : `${basePath}/${encodeURIComponent(draft.annotationId)}`,
        method: draft.type === "create" ? "POST" : "PATCH"
      };
    }
    const operation = draft.operation;
    entry.pending += 1;
    draft.saveFailed = false;
    setStatus(session, "saving");
    render();
    try {
      const saved = await adapter.api(operation.path, {
        method: operation.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.payload)
      });
      const record = validateRecord(saved, session.source);
      entry.items = [record, ...entry.items.filter((item) => item.id !== record.id)];
      entry.mutationVersion += 1;
      if (entry.draft?.operation === operation) entry.draft = null;
      const current = operationSession(session);
      if (current) {
        if (!current.proposal) {
          current.annotationId = record.id;
          updateContext(current, record.id);
        }
        if (current.ready) {
          syncAnnotations(current);
          fitAnnotation(current, record.id);
        }
        setStatus(current, "saved", "success");
      }
    } catch (error) {
      if (entry.draft?.operation === operation) {
        entry.draft.saveFailed = true;
        entry.draft.conflicted = ["revision_conflict", "source_changed", "annotation_deleted"].includes(error.code);
      }
      const current = operationSession(session);
      if (current) setStatus(current, errorKey(error, "saveFailed"), "error");
    } finally {
      entry.pending = Math.max(0, entry.pending - 1);
      const current = operationSession(session);
      if (current) render();
    }
  }

  async function runLifecycle(session, record, action) {
    if (!isCurrent(session) || session.proposal || !session.ready) return;
    const entry = currentEntry(session);
    if (entry.pending) return;
    let operation = entry.operations.get(record.id);
    if (operation?.conflicted) return;
    if (!operation) {
      if (action === "delete" && !window.confirm(t("confirmDelete"))) return;
      const requestId = crypto.randomUUID();
      const path = `${sourcePrefix(session.documentId, session.kind, session.sourceId)}/annotations/${encodeURIComponent(record.id)}${action === "restore" ? "/restore" : ""}`;
      operation = {
        action,
        requestId,
        path,
        method: action === "delete" ? "DELETE" : "POST",
        payload: {
          request_id: requestId,
          expected_revision: record.revision,
          source_sha256: session.source.source_sha256,
          frame_sha256: session.source.frame_sha256
        },
        conflicted: false
      };
      entry.operations.set(record.id, operation);
    }
    entry.pending += 1;
    setStatus(session, action === "delete" ? "deleting" : "restoring");
    render();
    try {
      const saved = await adapter.api(operation.path, {
        method: operation.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.payload)
      });
      const updated = validateRecord(saved, session.source);
      entry.items = [updated, ...entry.items.filter((item) => item.id !== updated.id)];
      entry.mutationVersion += 1;
      entry.operations.delete(record.id);
      const current = operationSession(session);
      if (current) {
        if (current.ready) syncAnnotations(current);
        setStatus(current, action === "delete" ? "deleted" : "restored", "success");
      }
    } catch (error) {
      operation.conflicted = ["revision_conflict", "source_changed", "annotation_deleted"].includes(error.code);
      if (operation.conflicted) entry.operations.delete(record.id);
      const current = operationSession(session);
      if (current) setStatus(current, errorKey(error), "error");
    } finally {
      entry.pending = Math.max(0, entry.pending - 1);
      const current = operationSession(session);
      if (current) render();
    }
  }

  async function open(documentId, kind, sourceId, options = {}) {
    const wasOpen = elements.dialog.open;
    if (!wasOpen) {
      returnFocus = document.activeElement;
      returnProposalId = options.proposal?.id || null;
    } else if (options.proposal) {
      returnProposalId = options.proposal.id || returnProposalId;
    }
    if (active) teardownRuntime(active);
    const session = {
      documentId,
      kind,
      sourceId,
      annotationId: options.annotationId || null,
      proposal: options.proposal || null,
      proposalPreview: null,
      source: null,
      sdk: null,
      controller: new AbortController(),
      viewer: null,
      anno: null,
      stageHost: null,
      objectUrl: null,
      annotationHandlers: [],
      ready: false,
      loading: false,
      retryable: false,
      status: null,
      mode: "pan"
    };
    active = session;
    for (const element of [elements.dialog, elements.stage]) {
      element.dataset.documentId = documentId;
      element.dataset.sourceKind = kind;
      element.dataset.sourceId = sourceId;
    }
    if (!wasOpen) elements.dialog.showModal();
    render();
    elements.close.focus();
    await load(session);
  }

  elements.close.addEventListener("click", () => close());
  elements.retry.addEventListener("click", () => {
    if (active) load(active);
  });
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  elements.dialog.addEventListener("close", () => {
    if (active && !elements.dialog.open) close();
  });
  elements.dialog.querySelector('[data-action="clear-image-context"]').addEventListener("click", () => {
    if (active) {
      clearActiveContext(active.documentId);
      setStatus(active, "contextCleared", "success");
    }
  });
  elements.parent.addEventListener("click", () => {
    const session = active;
    if (!session?.source?.parent_note_id) return;
    const documentId = session.documentId;
    const noteId = session.source.parent_note_id;
    close({ restoreFocus: false });
    adapter.navigateNote?.(documentId, noteId);
  });
  elements.zoomIn.addEventListener("click", () => {
    if (active?.ready) {
      active.viewer.viewport.zoomBy(1.25);
      active.viewer.viewport.applyConstraints();
    }
  });
  elements.zoomOut.addEventListener("click", () => {
    if (active?.ready) {
      active.viewer.viewport.zoomBy(0.8);
      active.viewer.viewport.applyConstraints();
    }
  });
  elements.fit.addEventListener("click", () => {
    if (active?.ready) active.viewer.viewport.goHome(true);
  });
  elements.pan.addEventListener("click", () => {
    if (active) setMode(active, "pan");
  });
  elements.new.addEventListener("click", () => {
    if (active) setMode(active, "new");
  });
  elements.text.addEventListener("input", () => {
    if (!active || active.proposal) return;
    const draft = currentEntry(active).draft;
    if (!draft || currentEntry(active).pending || draft.conflicted) return;
    draft.text = elements.text.value;
    draft.operation = null;
    draft.saveFailed = false;
    setStatus(active, null);
    render();
  });
  elements.save.addEventListener("click", () => {
    if (active) saveDraft(active);
  });
  elements.cancel.addEventListener("click", () => {
    if (active) cancelDraft(active);
  });

  function clearActiveContext(documentId) {
    const id = documentId || active?.documentId || adapter.getDocument()?.id;
    if (!id) return;
    contexts.delete(id);
    adapter.imageClosed?.(id);
    adapter.contextChanged?.();
  }

  return {
    open,
    close,
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      if (active) render();
    },
    refreshIfCurrent(documentId) {
      if (active?.documentId === documentId && active.ready && !currentEntry(active).pending) return load(active);
      return Promise.resolve();
    },
    getActiveContext(documentId) {
      const context = contexts.get(documentId);
      if (!context) return null;
      const result = { source_kind: context.source_kind, source_id: context.source_id };
      if (context.annotation_id) result.annotation_id = context.annotation_id;
      return result;
    },
    getActiveImage(documentId) {
      const context = contexts.get(documentId);
      if (!context) return null;
      return {
        ...this.getActiveContext(documentId),
        label: context.label,
        pixelsShared: context.source_kind === "user_upload" && Boolean(adapter.isImageShared?.(documentId, context.source_id))
      };
    },
    clearActiveContext,
    isOpen() {
      return Boolean(active && elements.dialog.open);
    }
  };
}
