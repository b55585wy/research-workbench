const ALLOWED_TAGS = ["p", "h1", "h2", "strong", "em", "u", "ul", "ol", "li", "br", "a"];
const ALLOWED_ATTR = ["href", "rel", "target"];
const renderSequences = new WeakMap();
let editorModule = null;
let editorModulePromise = null;
let editorModuleRetry = 0;
let editorStylesPromise = null;

const messages = {
  zh: {
    open: "格式编辑",
    plain: "转为纯文本",
    draftHelp: "此草稿包含格式。文本为只读；可继续格式编辑，或明确转为纯文本。",
    title: "格式编辑",
    apply: "应用到草稿",
    cancel: "取消",
    loading: "正在加载格式编辑器…",
    ready: "修改只会应用到当前草稿，点击保存后才会写入。",
    empty: "笔记内容不能为空。",
    tooLong: "笔记不能超过 10000 个字符。",
    tooManyOps: "格式操作不能超过 512 个，请减少分段或格式变化。",
    invalidOps: "笔记包含不支持的内容，只能保留文本及已有格式。",
    tooManyBytes: "格式内容不能超过 65536 个 UTF-8 字节，请精简后重试。",
    invalidLink: "链接必须是有效的绝对 HTTP(S) 地址，且不能包含空白字符或凭据。",
    loadFailed: "格式编辑器加载失败。草稿未更改，请取消并重新打开以重试。",
    formatUnavailable: "格式无法显示，已保留纯文本。请稍后重试。",
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
    open: "Format text",
    plain: "Convert to plain text",
    draftHelp: "This draft has formatting. Its text is read-only; keep formatting or explicitly convert it to plain text.",
    title: "Format text",
    apply: "Apply to draft",
    cancel: "Cancel",
    loading: "Loading the formatting editor…",
    ready: "Changes apply only to this draft. Save separately to persist them.",
    empty: "Note text cannot be empty.",
    tooLong: "Notes cannot exceed 10,000 characters.",
    tooManyOps: "Formatted notes cannot exceed 512 text operations. Reduce paragraphs or formatting changes.",
    invalidOps: "The note contains unsupported content. Keep only text and the supported formatting.",
    tooManyBytes: "Formatted notes cannot exceed 65,536 UTF-8 bytes. Shorten the note and try again.",
    invalidLink: "Links must be valid absolute HTTP(S) URLs without whitespace or credentials.",
    loadFailed: "The formatting editor could not load. Your draft is unchanged; Cancel and reopen to retry.",
    formatUnavailable: "Formatting cannot be displayed. Plain text is preserved; try again later.",
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
    open: byId("rich-text-open"),
    plain: byId("rich-text-plain"),
    draftStatus: byId("rich-text-draft-status"),
    dialog: byId("rich-text-dialog"),
    title: byId("rich-text-title"),
    editor: byId("rich-text-editor"),
    status: byId("rich-text-status"),
    apply: byId("rich-text-apply"),
    cancel: byId("rich-text-cancel")
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
    if (editable) editable.setAttribute("aria-label", t(language, "editorLabel"));
  }

  function localize() {
    elements.dialog.dataset.language = language;
    elements.open.textContent = t(language, "open");
    elements.plain.textContent = t(language, "plain");
    elements.draftStatus.textContent = t(language, "draftHelp");
    elements.title.textContent = t(language, "title");
    elements.apply.textContent = t(language, "apply");
    elements.cancel.textContent = t(language, "cancel");
    localizeToolbar();
  }

  function bindToolbarSelection(quill, toolbar) {
    let savedRange = quill.getSelection();
    const rememberRange = (range) => {
      if (range) savedRange = { index: range.index, length: range.length };
    };
    const rememberCurrentRange = () => rememberRange(quill.getSelection());
    const restoreRange = () => {
      if (savedRange) quill.setSelection(savedRange, "silent");
    };
    quill.on("selection-change", rememberRange);
    toolbar.addEventListener("pointerdown", rememberCurrentRange, true);
    toolbar.addEventListener("mousedown", rememberCurrentRange, true);
    toolbar.addEventListener("click", restoreRange, true);
    toolbar.addEventListener("change", restoreRange, true);
    return () => {
      quill.off("selection-change", rememberRange);
      toolbar.removeEventListener("pointerdown", rememberCurrentRange, true);
      toolbar.removeEventListener("mousedown", rememberCurrentRange, true);
      toolbar.removeEventListener("click", restoreRange, true);
      toolbar.removeEventListener("change", restoreRange, true);
    };
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
  }

  function close({ restoreFocus = true } = {}) {
    if (!session && !elements.dialog.open) return;
    const closing = session;
    session = null;
    disposeEditor(closing);
    delete elements.editor.dataset.documentId;
    delete elements.editor.dataset.noteId;
    delete elements.editor.dataset.revision;
    elements.apply.disabled = true;
    if (elements.dialog.open) elements.dialog.close();
    adapter.onOpenChange(false);
    if (restoreFocus && closing?.opener?.isConnected) closing.opener.focus();
  }

  async function open() {
    if (session) return;
    const scope = adapter.getScope();
    const draft = scope ? adapter.getDraft(scope) : null;
    if (!scope || !draft) return;
    session = {
      scope: { ...scope },
      opener: document.activeElement,
      quill: null,
      toolbarCleanup: null
    };
    elements.editor.dataset.documentId = scope.documentId;
    elements.editor.dataset.noteId = scope.noteId || "";
    elements.editor.dataset.revision = scope.revision ? String(scope.revision) : "";
    elements.editor.replaceChildren();
    elements.status.dataset.kind = "info";
    elements.status.textContent = t(language, "loading");
    elements.apply.disabled = true;
    localize();
    elements.dialog.showModal();
    adapter.onOpenChange(true);
    const opening = session;
    try {
      const { Quill } = await loadAssets();
      if (session !== opening) return;
      if (!scopeMatches(opening.scope)) {
        close({ restoreFocus: false });
        return;
      }
      const host = document.createElement("div");
      elements.editor.append(host);
      const quill = new Quill(host, {
        theme: "snow",
        formats: ["bold", "italic", "underline", "header", "list", "link"],
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
      opening.quill = quill;
      if (draft.richContent) quill.setContents(cloneRichContent(draft.richContent).ops, "silent");
      else quill.setText(draft.text, "silent");
      opening.toolbarCleanup = bindToolbarSelection(quill, elements.editor.querySelector(".ql-toolbar"));
      localizeToolbar();
      elements.status.dataset.kind = "info";
      elements.status.textContent = t(language, "ready");
      elements.apply.disabled = false;
      quill.focus();
    } catch {
      if (session !== opening) return;
      disposeEditor(opening);
      elements.status.dataset.kind = "error";
      elements.status.textContent = t(language, "loadFailed");
      elements.apply.disabled = true;
    }
  }

  function apply() {
    if (!session?.quill || !scopeMatches(session.scope)) {
      close({ restoreFocus: false });
      return;
    }
    const text = session.quill.getText().trim();
    if (!text) {
      elements.status.dataset.kind = "error";
      elements.status.textContent = t(language, "empty");
      return;
    }
    if ([...text].length > 10000) {
      elements.status.dataset.kind = "error";
      elements.status.textContent = t(language, "tooLong");
      return;
    }
    const ops = session.quill.getContents().ops;
    if (ops.length > 512) {
      elements.status.dataset.kind = "error";
      elements.status.textContent = t(language, "tooManyOps");
      return;
    }
    if (ops.some((op) => typeof op.insert !== "string" || Object.keys(op).some((key) => !["insert", "attributes"].includes(key)))) {
      elements.status.dataset.kind = "error";
      elements.status.textContent = t(language, "invalidOps");
      return;
    }
    if (ops.some((op) => op.attributes?.link && !validHttpUrl(op.attributes.link))) {
      elements.status.dataset.kind = "error";
      elements.status.textContent = t(language, "invalidLink");
      return;
    }
    const richContent = { version: 1, ops: JSON.parse(JSON.stringify(ops)) };
    if (new TextEncoder().encode(JSON.stringify(richContent)).length > 65536) {
      elements.status.dataset.kind = "error";
      elements.status.textContent = t(language, "tooManyBytes");
      return;
    }
    const applied = adapter.applyDraft(session.scope, { text, richContent });
    close({ restoreFocus: applied });
  }

  elements.open.addEventListener("click", open);
  elements.plain.addEventListener("click", () => adapter.convertToPlain());
  elements.apply.addEventListener("click", apply);
  elements.cancel.addEventListener("click", () => close());
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  elements.dialog.addEventListener("close", () => {
    if (session && !elements.dialog.open) close();
  });

  localize();

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      localize();
    },
    close,
    isOpen: () => Boolean(session)
  };
}
