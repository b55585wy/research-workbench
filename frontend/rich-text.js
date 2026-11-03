const ALLOWED_TAGS = ["p", "h1", "h2", "strong", "em", "u", "ul", "ol", "li", "br", "a", "img"];
const ALLOWED_ATTR = ["href", "rel", "target", "src", "alt"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const LOCAL_IMAGE = /^\/api\/v1\/documents\/([0-9a-f-]{36})\/images\/([0-9a-f-]{36})\/preview$/i;
const TEXT_ATTRIBUTES = new Set(["bold", "italic", "underline", "header", "list", "link"]);
const renderSequences = new WeakMap();
const registeredEditors = new WeakSet();
let editorModule = null;
let editorModulePromise = null;
let editorModuleRetry = 0;
let editorStylesPromise = null;

const messages = {
  zh: {
    plain: "转为纯文本",
    draftHelp: "可直接在侧栏编辑。原文文字或截图会插入上次光标位置，保存后才会写入。",
    loading: "正在加载格式编辑器…",
    placeholder: "记录你的想法…",
    empty: "笔记内容不能为空。",
    tooLong: "笔记不能超过 10000 个字符。",
    tooManyOps: "格式操作不能超过 512 个，请减少分段或格式变化。",
    tooManyImages: "每篇笔记最多嵌入 8 张不同图片。",
    invalidOps: "笔记包含不支持的内容，只能保留文本、已有格式和已上传图片。",
    tooManyBytes: "格式内容不能超过 65536 个 UTF-8 字节，请精简后重试。",
    invalidLink: "链接必须是有效的绝对 HTTP(S) 地址，且不能包含空白字符或凭据。",
    loadFailed: "格式编辑器加载失败。纯文本草稿仍保留，可继续编辑或重试。",
    formatUnavailable: "格式无法显示，已保留纯文本。请稍后重试。",
    imageUnavailable: "内联图片编辑器尚未就绪，请稍后重试。",
    editorUnavailable: "格式编辑器尚未就绪，请稍后重试；也可明确转为纯文本后编辑。",
    staleInsertion: "笔记已切换，未插入原位置。请重新选择目标笔记。",
    staleReplacement: "所选文字已编辑，未执行替换。你的修改已保留，请重新选择插入位置。",
    insertionBusy: "笔记正在保存或更新，未插入内容。请完成后重新选择原文。",
    editorLabel: "富文本笔记",
    bold: "粗体",
    italic: "斜体",
    underline: "下划线",
    heading: "标题级别",
    normal: "正文",
    heading1: "标题 1",
    heading2: "标题 2",
    ordered: "有序列表",
    bullet: "无序列表",
    link: "链接",
    linkUrl: "HTTP(S) 链接地址"
  },
  en: {
    plain: "Convert to plain text",
    draftHelp: "Edit directly in the sidebar. Selected text or captures insert at the last caret and are not saved until you save.",
    loading: "Loading the formatting editor…",
    placeholder: "Write your thoughts…",
    empty: "Note text cannot be empty.",
    tooLong: "Notes cannot exceed 10,000 characters.",
    tooManyOps: "Formatted notes cannot exceed 512 operations. Reduce paragraphs or formatting changes.",
    tooManyImages: "A note can embed at most 8 different images.",
    invalidOps: "The note contains unsupported content. Keep only text, supported formatting, and uploaded images.",
    tooManyBytes: "Formatted notes cannot exceed 65,536 UTF-8 bytes. Shorten the note and try again.",
    invalidLink: "Links must be valid absolute HTTP(S) URLs without whitespace or credentials.",
    loadFailed: "The formatting editor could not load. Your plain-text draft is preserved and remains editable.",
    formatUnavailable: "Formatting cannot be displayed. Plain text is preserved; try again later.",
    imageUnavailable: "The inline image editor is not ready. Try again shortly.",
    editorUnavailable: "The formatting editor is not ready. Try again shortly, or explicitly convert to plain text to edit.",
    staleInsertion: "The note changed, so nothing was inserted. Choose the target note again.",
    staleReplacement: "The selected text changed, so it was not replaced. Your edits were preserved; choose the insertion position again.",
    insertionBusy: "The note is being saved or updated, so nothing was inserted. Try selecting the source again when it finishes.",
    editorLabel: "Rich-text note",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    heading: "Heading level",
    normal: "Normal text",
    heading1: "Heading 1",
    heading2: "Heading 2",
    ordered: "Ordered list",
    bullet: "Bulleted list",
    link: "Link",
    linkUrl: "HTTP(S) link URL"
  }
};

function t(language, key) {
  return messages[language]?.[key] || messages.en[key] || key;
}

function cloneRichContent(richContent) {
  return richContent ? JSON.parse(JSON.stringify(richContent)) : null;
}

function loadEditorModule() {
  if (editorModule) return Promise.resolve(editorModule);
  if (!editorModulePromise) {
    const retry = editorModuleRetry ? `?retry=${editorModuleRetry}` : "";
    editorModulePromise = import(`/vendor/rich-text/editor.js${retry}`).then((module) => {
      if (!module.Quill || !module.DOMPurify?.sanitize) throw new Error("Rich-text assets invalid");
      editorModule = module;
      return module;
    }).catch((error) => {
      editorModuleRetry += 1;
      throw error;
    }).finally(() => {
      editorModulePromise = null;
    });
  }
  return editorModulePromise;
}

function loadEditorStyles() {
  const existing = document.querySelector("link[data-rich-text-editor-css]");
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  if (!editorStylesPromise) {
    editorStylesPromise = new Promise((resolve, reject) => {
      const link = existing || document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/vendor/rich-text/editor.css";
      link.dataset.richTextEditorCss = "";
      link.addEventListener("load", () => {
        link.dataset.loaded = "true";
        resolve();
      }, { once: true });
      link.addEventListener("error", () => {
        link.remove();
        reject(new Error("Rich-text styles unavailable"));
      }, { once: true });
      if (!existing) document.head.append(link);
    }).finally(() => {
      editorStylesPromise = null;
    });
  }
  return editorStylesPromise;
}

function loadAssets() {
  return Promise.all([loadEditorModule(), loadEditorStyles()]).then(([module]) => module);
}

function showPlainText(container, text, language, failed) {
  const plain = document.createElement("div");
  plain.className = "rich-text-plain-fallback";
  plain.textContent = text;
  container.replaceChildren(plain);
  if (failed) {
    const status = document.createElement("p");
    status.className = "rich-text-format-error";
    status.setAttribute("role", "status");
    status.textContent = t(language, "formatUnavailable");
    container.append(status);
  }
}

function validHttpUrl(value) {
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f\u0085\u00a0\u1680\u2000-\u200a\u200e\u200f\u2028\u2029\u202f\u205f\u3000]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function imagePreviewPath(documentId, imageId) {
  return `/api/v1/documents/${encodeURIComponent(documentId)}/images/${encodeURIComponent(imageId)}/preview`;
}

function validResearchImage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !["document_id", "image_id", "sha256", "alt"].includes(key))) return null;
  if (!UUID.test(value.document_id || "") || !UUID.test(value.image_id || "") || !SHA256.test(value.sha256 || "")) return null;
  const alt = typeof value.alt === "string" ? value.alt.trim() : "";
  if (!alt || alt.length > 200) return null;
  return { document_id: value.document_id, image_id: value.image_id, sha256: value.sha256, alt };
}

function registerResearchImage(Quill) {
  if (registeredEditors.has(Quill)) return;
  const Embed = Quill.import("blots/embed");
  class ResearchImage extends Embed {
    static create(value) {
      const image = validResearchImage(value);
      if (!image) throw new Error("Invalid research image");
      const node = super.create();
      node.setAttribute("src", imagePreviewPath(image.document_id, image.image_id));
      node.setAttribute("alt", image.alt);
      node.dataset.documentId = image.document_id;
      node.dataset.imageId = image.image_id;
      node.dataset.sha256 = image.sha256;
      return node;
    }

    static value(node) {
      return validResearchImage({
        document_id: node.dataset.documentId,
        image_id: node.dataset.imageId,
        sha256: node.dataset.sha256,
        alt: node.getAttribute("alt") || ""
      });
    }
  }
  ResearchImage.blotName = "research_image";
  ResearchImage.tagName = "img";
  ResearchImage.className = "research-inline-image";
  Quill.register(ResearchImage, true);
  registeredEditors.add(Quill);
}

function plainTextFromOps(ops) {
  return ops.map((op) => {
    if (typeof op.insert === "string") return op.insert;
    const image = validResearchImage(op.insert?.research_image);
    return image ? `[Image: ${image.alt}]` : "";
  }).join("").trim();
}

function serializeQuill(quill) {
  const ops = quill.getContents().ops;
  const text = plainTextFromOps(ops);
  if ([...text].length > 10000) return { error: "tooLong" };
  if (ops.length > 512) return { error: "tooManyOps" };
  const imageIds = new Set();
  let hasImages = false;
  for (const op of ops) {
    const keys = Object.keys(op);
    if (keys.some((key) => !["insert", "attributes"].includes(key))) return { error: "invalidOps" };
    if (typeof op.insert === "string") {
      if (Object.keys(op.attributes || {}).some((key) => !TEXT_ATTRIBUTES.has(key))) return { error: "invalidOps" };
      if (op.attributes?.link && !validHttpUrl(op.attributes.link)) return { error: "invalidLink" };
      continue;
    }
    const image = validResearchImage(op.insert?.research_image);
    if (!image || op.attributes || Object.keys(op.insert).length !== 1) return { error: "invalidOps" };
    hasImages = true;
    imageIds.add(image.image_id);
  }
  if (imageIds.size > 8) return { error: "tooManyImages" };
  const last = ops.at(-1);
  if (typeof last?.insert !== "string" || !last.insert.endsWith("\n")) return { error: "invalidOps" };
  const richContent = { version: hasImages ? 2 : 1, ops: JSON.parse(JSON.stringify(ops)) };
  if (new TextEncoder().encode(JSON.stringify(richContent)).length > 65536) return { error: "tooManyBytes" };
  return { text, richContent };
}

export async function renderRichHtml(container, { html, text, language = "zh" }) {
  const sequence = (renderSequences.get(container) || 0) + 1;
  renderSequences.set(container, sequence);
  showPlainText(container, text, language, false);
  try {
    const { DOMPurify } = await loadAssets();
    if (renderSequences.get(container) !== sequence || !container.isConnected) return false;
    const fragment = DOMPurify.sanitize(String(html), {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true
    });
    for (const link of [...fragment.querySelectorAll("a")]) {
      const url = validHttpUrl(link.getAttribute("href") || "");
      if (!url) {
        link.replaceWith(...link.childNodes);
        continue;
      }
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    for (const image of [...fragment.querySelectorAll("img")]) {
      const source = image.getAttribute("src") || "";
      const match = LOCAL_IMAGE.exec(source);
      if (!match || !UUID.test(match[1]) || !UUID.test(match[2]) || source !== imagePreviewPath(match[1], match[2])) {
        image.remove();
        continue;
      }
      image.removeAttribute("srcset");
      image.loading = "lazy";
      image.decoding = "async";
    }
    container.replaceChildren(fragment);
    return true;
  } catch {
    if (renderSequences.get(container) !== sequence || !container.isConnected) return false;
    showPlainText(container, text, language, true);
    return false;
  }
}

export function createRichText(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    noteText: byId("note-text"),
    plain: byId("rich-text-plain"),
    draftStatus: byId("rich-text-draft-status"),
    editor: byId("rich-text-editor"),
    status: byId("rich-text-status")
  };
  let language = adapter.getLanguage();
  let session = null;

  function scopeMatches(scope) {
    const current = adapter.getScope();
    return Boolean(current && scope &&
      current.documentId === scope.documentId &&
      (current.noteId || null) === (scope.noteId || null) &&
      (current.revision || null) === (scope.revision || null));
  }

  function sameScope(left, right) {
    return Boolean(left && right && left.documentId === right.documentId &&
      (left.noteId || null) === (right.noteId || null) &&
      (left.revision || null) === (right.revision || null));
  }

  function setStatus(target, kind, key) {
    if (session !== target) return;
    elements.status.dataset.kind = kind;
    elements.status.textContent = key ? t(language, key) : "";
  }

  function localizeToolbar() {
    const toolbar = elements.editor.querySelector(".ql-toolbar");
    if (!toolbar) return;
    for (const [selector, key] of [
      [".ql-bold", "bold"],
      [".ql-italic", "italic"],
      [".ql-underline", "underline"],
      [".ql-list[value='ordered']", "ordered"],
      [".ql-list[value='bullet']", "bullet"],
      [".ql-link", "link"]
    ]) {
      const button = toolbar.querySelector(selector);
      if (button) {
        button.setAttribute("aria-label", t(language, key));
        button.title = t(language, key);
      }
    }
    const header = toolbar.querySelector("select.ql-header");
    if (header) {
      header.setAttribute("aria-label", t(language, "heading"));
      header.title = t(language, "heading");
      const labels = { "": "normal", "1": "heading1", "2": "heading2" };
      for (const option of header.options) option.textContent = t(language, labels[option.value] || "normal");
      for (const item of toolbar.querySelectorAll(".ql-picker-item")) {
        const label = t(language, labels[item.dataset.value || ""] || "normal");
        item.dataset.label = label;
        item.setAttribute("aria-label", label);
      }
      const pickerLabel = toolbar.querySelector(".ql-picker-label");
      if (pickerLabel) {
        pickerLabel.dataset.label = t(language, labels[header.value] || "normal");
        pickerLabel.setAttribute("aria-label", t(language, "heading"));
      }
    }
    const linkInput = elements.editor.querySelector(".ql-tooltip input");
    if (linkInput) {
      linkInput.setAttribute("aria-label", t(language, "linkUrl"));
      linkInput.placeholder = "https://…";
    }
    const editable = elements.editor.querySelector(".ql-editor");
    if (editable) {
      editable.setAttribute("aria-label", t(language, "editorLabel"));
      editable.dataset.placeholder = t(language, "placeholder");
    }
  }

  function localize() {
    elements.editor.dataset.language = language;
    elements.plain.textContent = t(language, "plain");
    elements.draftStatus.textContent = t(language, "draftHelp");
    localizeToolbar();
  }

  function disposeEditor(target) {
    const quill = target?.quill;
    target?.toolbarCleanup?.();
    if (target) {
      target.quill = null;
      target.toolbarCleanup = null;
    }
    quill?.enable(false);
    elements.editor.replaceChildren();
    elements.noteText.hidden = false;
  }

  function close() {
    if (!session) return;
    const closing = session;
    session = null;
    disposeEditor(closing);
    delete elements.editor.dataset.documentId;
    delete elements.editor.dataset.noteId;
    delete elements.editor.dataset.revision;
    elements.status.textContent = "";
  }

  function deltaTouchesRange(delta, range) {
    if (!range.length) return false;
    const end = range.index + range.length;
    let index = 0;
    for (const op of delta.ops) {
      if (Object.hasOwn(op, "insert")) {
        if (op.insert !== "" && index >= range.index && index <= end) return true;
        continue;
      }
      const length = op.delete || op.retain || 0;
      if (length && (op.delete || op.attributes) && index < end && index + length > range.index) return true;
      index += length;
    }
    return false;
  }

  function transformBookmarks(target, delta) {
    for (const bookmark of target.bookmarks) {
      if (deltaTouchesRange(delta, bookmark.range)) bookmark.stale = true;
      const start = delta.transformPosition(bookmark.range.index, false);
      const end = delta.transformPosition(bookmark.range.index + bookmark.range.length, true);
      bookmark.range.index = start;
      bookmark.range.length = Math.max(0, end - start);
    }
  }

  function transformPlainBookmarks(target, previous, next) {
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
    const oldEnd = previous.length - suffix;
    const insertedLength = next.length - prefix - suffix;
    const transform = (position) => {
      if (position <= prefix) return position;
      if (position >= oldEnd) return position + insertedLength - (oldEnd - prefix);
      return prefix + Math.min(position - prefix, insertedLength);
    };
    for (const bookmark of target.bookmarks) {
      const end = bookmark.range.index + bookmark.range.length;
      if (bookmark.range.length && (
        insertedLength > 0 && prefix >= bookmark.range.index && prefix <= end ||
        oldEnd > prefix && prefix < end && oldEnd > bookmark.range.index
      )) bookmark.stale = true;
      const start = transform(bookmark.range.index);
      const transformedEnd = transform(end);
      bookmark.range.index = start;
      bookmark.range.length = Math.max(0, transformedEnd - start);
    }
  }

  function bindToolbarSelection(target, toolbar) {
    const restoreRange = () => {
      if (target.savedRange) target.quill?.setSelection(target.savedRange, "silent");
    };
    const rememberCurrentRange = () => {
      const range = target.quill?.getSelection();
      if (range) target.savedRange = { index: range.index, length: range.length };
    };
    toolbar.addEventListener("pointerdown", rememberCurrentRange, true);
    toolbar.addEventListener("mousedown", rememberCurrentRange, true);
    toolbar.addEventListener("click", restoreRange, true);
    toolbar.addEventListener("change", restoreRange, true);
    return () => {
      toolbar.removeEventListener("pointerdown", rememberCurrentRange, true);
      toolbar.removeEventListener("mousedown", rememberCurrentRange, true);
      toolbar.removeEventListener("click", restoreRange, true);
      toolbar.removeEventListener("change", restoreRange, true);
    };
  }

  async function initialize(target) {
    try {
      const { Quill } = await loadAssets();
      if (session !== target || !scopeMatches(target.scope)) return;
      const draft = adapter.getDraft(target.scope);
      if (!draft) return;
      registerResearchImage(Quill);
      const host = document.createElement("div");
      elements.editor.append(host);
      const quill = new Quill(host, {
        theme: "snow",
        formats: ["bold", "italic", "underline", "header", "list", "link", "research_image"],
        placeholder: t(language, "placeholder"),
        modules: {
          toolbar: [
            [{ header: [1, 2, false] }],
            ["bold", "italic", "underline"],
            [{ list: "ordered" }, { list: "bullet" }],
            ["link"]
          ],
          clipboard: { matchVisual: false },
          history: { delay: 500, maxStack: 100, userOnly: true }
        }
      });
      target.quill = quill;
      target.Delta = Quill.import("delta");
      if (draft.richContent && Array.isArray(draft.richContent.ops)) quill.setContents(cloneRichContent(draft.richContent).ops, "silent");
      else quill.setText(draft.text, "silent");
      const hadFocus = document.activeElement === elements.noteText;
      elements.noteText.hidden = true;
      target.toolbarCleanup = bindToolbarSelection(target, elements.editor.querySelector(".ql-toolbar"));
      quill.on("selection-change", (range) => {
        if (session === target && range) target.savedRange = { index: range.index, length: range.length };
      });
      quill.on("text-change", (delta, _old, source) => {
        if (session !== target || source === "silent") return;
        transformBookmarks(target, delta);
        const result = serializeQuill(quill);
        if (result.error) {
          target.changeError = result.error;
          if (source === "user") {
            target.reverting = true;
            quill.history.undo();
            target.reverting = false;
          }
          setStatus(target, "error", result.error);
          return;
        }
        if (!target.reverting) target.changeError = null;
        if (!adapter.applyDraft(target.scope, result)) {
          target.changeError = "staleInsertion";
          if (source === "user") {
            target.reverting = true;
            quill.history.undo();
            target.reverting = false;
          }
          return;
        }
        if (!target.reverting) setStatus(target, "info", null);
      });
      quill.enable(!adapter.isBusy?.());
      localizeToolbar();
      setStatus(target, "info", null);
      if (hadFocus) quill.focus();
      adapter.onOpenChange(true);
    } catch {
      if (session !== target) return;
      disposeEditor(target);
      const draft = adapter.getDraft(target.scope);
      elements.noteText.readOnly = Boolean(draft?.richContent);
      setStatus(target, "error", "loadFailed");
      adapter.onOpenChange(false);
    }
  }

  function sync() {
    const scope = adapter.getScope();
    const draft = scope ? adapter.getDraft(scope) : null;
    if (!scope || !draft) {
      close();
      return;
    }
    if (session && sameScope(session.scope, scope)) {
      session.quill?.enable(!adapter.isBusy?.());
      return;
    }
    close();
    session = {
      scope: { ...scope },
      quill: null,
      Delta: null,
      savedRange: null,
      plainRange: {
        index: elements.noteText.selectionStart ?? draft.text.length,
        length: Math.max(0, (elements.noteText.selectionEnd ?? draft.text.length) - (elements.noteText.selectionStart ?? draft.text.length))
      },
      plainValue: draft.text,
      bookmarks: new Set(),
      toolbarCleanup: null,
      changeError: null
    };
    elements.editor.dataset.documentId = scope.documentId;
    elements.editor.dataset.noteId = scope.noteId || "";
    elements.editor.dataset.revision = scope.revision ? String(scope.revision) : "";
    elements.noteText.hidden = false;
    elements.noteText.readOnly = Boolean(draft.richContent);
    localize();
    setStatus(session, "info", "loading");
    void initialize(session);
  }

  function getBookmark() {
    if (!session || !scopeMatches(session.scope)) return null;
    let range;
    if (session.quill) {
      range = session.savedRange || session.quill.getSelection() || { index: Math.max(0, session.quill.getLength() - 1), length: 0 };
    } else {
      range = session.plainRange || { index: elements.noteText.value.length, length: 0 };
    }
    const bookmark = { session, scope: { ...session.scope }, range: { index: range.index, length: range.length }, stale: false };
    session.bookmarks.add(bookmark);
    return bookmark;
  }

  function validBookmark(bookmark) {
    return Boolean(bookmark && session === bookmark.session && scopeMatches(bookmark.scope));
  }

  function insertDelta(bookmark, buildDelta) {
    if (!validBookmark(bookmark)) {
      if (session) setStatus(session, "error", "staleInsertion");
      return false;
    }
    const target = session;
    if (bookmark.stale) {
      target.bookmarks.delete(bookmark);
      setStatus(target, "error", "staleReplacement");
      return false;
    }
    if (adapter.isBusy?.()) {
      setStatus(target, "error", "insertionBusy");
      return false;
    }
    const range = bookmark.range;
    target.bookmarks.delete(bookmark);
    if (!target.quill) {
      if (adapter.getDraft(target.scope)?.richContent) {
        setStatus(target, "error", "editorUnavailable");
        return false;
      }
      const current = elements.noteText.value;
      const addition = buildDelta(null);
      if (typeof addition !== "string" || [...current.slice(0, range.index) + addition + current.slice(range.index + range.length)].length > 10000) {
        setStatus(target, "error", "tooLong");
        return false;
      }
      elements.noteText.focus();
      elements.noteText.setRangeText(addition, range.index, range.index + range.length, "end");
      elements.noteText.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    target.changeError = null;
    target.quill.history.cutoff();
    target.quill.updateContents(buildDelta(target.Delta), "user");
    target.quill.history.cutoff();
    if (target.changeError) return false;
    return true;
  }

  function validProvenance(value) {
    if (value == null) return null;
    if (typeof value !== "object" || Array.isArray(value)) return null;
    const label = typeof value.label === "string" ? value.label.trim() : "";
    const url = validHttpUrl(value.url);
    if (!label || label.length > 200 || /[\r\n]/.test(label) || !url) return null;
    return { label, url: url.href };
  }

  function insertText(bookmark, text, provenance = null) {
    const source = validProvenance(provenance);
    if (typeof text !== "string" || !text || provenance != null && !source) return false;
    const inserted = insertDelta(bookmark, (Delta) => {
      if (!Delta) return source ? `${text}${source.label}\n${source.url}\n` : text;
      const delta = new Delta().retain(bookmark.range.index).delete(bookmark.range.length).insert(text);
      if (source) delta.insert(source.label, { link: source.url }).insert("\n");
      return delta;
    });
    const insertedLength = text.length + (source ? source.label.length + 1 : 0);
    if (inserted && session?.quill) session.quill.setSelection(bookmark.range.index + insertedLength, 0, "silent");
    return inserted;
  }

  function insertImage(bookmark, value, provenance = null, caption = "") {
    const image = validResearchImage(value);
    const source = validProvenance(provenance);
    if (!image || image.document_id !== bookmark?.scope?.documentId || provenance != null && !source || typeof caption !== "string") return false;
    if (!session?.quill || !validBookmark(bookmark)) {
      if (session) setStatus(session, "error", validBookmark(bookmark) ? "imageUnavailable" : "staleInsertion");
      return false;
    }
    const inserted = insertDelta(bookmark, (Delta) => {
      const delta = new Delta().retain(bookmark.range.index).delete(bookmark.range.length).insert({ research_image: image });
      if (caption || source) delta.insert("\n");
      if (caption) delta.insert(caption).insert("\n");
      if (source) delta.insert(source.label, { link: source.url }).insert("\n");
      return delta;
    });
    const suffixLength = caption || source ? 1 + (caption ? caption.length + 1 : 0) + (source ? source.label.length + 1 : 0) : 0;
    if (inserted && session?.quill) session.quill.setSelection(bookmark.range.index + 1 + suffixLength, 0, "silent");
    return inserted;
  }

  elements.plain.addEventListener("click", () => adapter.convertToPlain());
  for (const eventName of ["click", "keyup", "select"]) {
    elements.noteText.addEventListener(eventName, () => {
      if (!session || session.quill) return;
      session.plainRange = {
        index: elements.noteText.selectionStart,
        length: elements.noteText.selectionEnd - elements.noteText.selectionStart
      };
    });
  }
  elements.noteText.addEventListener("input", () => {
    if (!session || session.quill) return;
    transformPlainBookmarks(session, session.plainValue, elements.noteText.value);
    session.plainValue = elements.noteText.value;
    session.plainRange = {
      index: elements.noteText.selectionStart,
      length: elements.noteText.selectionEnd - elements.noteText.selectionStart
    };
  });

  localize();

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      localize();
      if (session && !session.quill) setStatus(session, "info", "loading");
      else if (session) setStatus(session, "info", null);
    },
    close,
    sync,
    getBookmark,
    insertText,
    insertImage,
    isEditorActive: () => Boolean(session?.quill),
    hasUnpreservedChanges: () => {
      const target = session;
      if (!target?.quill || !target.changeError) return false;
      try {
        const actual = serializeQuill(target.quill);
        const draft = adapter.getDraft(target.scope);
        if (actual.error || !draft) return true;
        const expectedOps = draft.richContent
          ? (Array.isArray(draft.richContent.ops) ? draft.richContent.ops : null)
          : [{ insert: `${draft.text}${draft.text.endsWith("\n") ? "" : "\n"}` }];
        return actual.text !== draft.text || !expectedOps || JSON.stringify(actual.richContent.ops) !== JSON.stringify(expectedOps);
      } catch {
        return true;
      }
    },
    focus() {
      if (session?.quill) {
        session.quill.focus();
        if (session.savedRange) session.quill.setSelection(session.savedRange, "silent");
      } else {
        elements.noteText.focus();
      }
    }
  };
}
