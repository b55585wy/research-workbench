import { createAssistantWindow } from "/assistant-window.js";
import { renderAssistantAnswer } from "/assistant-answer.js";

const copy = {
  zh: {
    assistant: "本机助手",
    close: "关闭本机助手",
    clear: "清空对话",
    window: "移动助手窗口",
    fullPage: "全屏",
    exitFullPage: "退出全屏",
    resize: "调整助手窗口大小",
    resizeLeft: "从左侧调整助手窗口宽度",
    resizeRight: "从右侧调整助手窗口宽度",
    moveHelp: "拖动标题栏移动；聚焦后使用方向键移动。",
    resizeHelp: "拖动或使用方向键调整窗口大小；按住 Shift 加速。",
    resizeEdgeHelp: "拖动或使用左右方向键调整宽度；按住 Shift 加速，另一侧边缘保持不动。",
    windowHelp: "拖动标题栏空白区域移动窗口。聚焦标题栏后使用方向键移动，按住 Shift 加速。左右边缘手柄用于调整宽度，右下角手柄用于调整宽度和高度；也可聚焦手柄使用方向键。全屏或窄屏时不能手动移动或调整大小。",
    loadFailed: "本机助手控件加载失败。问题、PDF 和笔记未改动；请刷新页面后重试。",
    markdownUnavailable: "富文本组件不可用；以下保留原始 Markdown 文本。",
    mathUnavailable: "公式组件不可用；公式按原始文本显示。",
    copyTable: "复制表格",
    downloadCsv: "下载 CSV",
    tableCopied: "表格已复制。",
    copyFailed: "复制失败。回答内容未更改，请重试。",
    downloadFailed: "下载失败，请重试。",
    tableScroll: "表格，可水平滚动",
    tableTooLarge: "表格超过 {columns} 列或 {rows} 行上限，已保留原文且禁用导出。",
    tableMalformed: "表格行列不完整，已保留原文且禁用导出。",
    citationUnverified: "未核实的来源引用",
    provenance: "引用来源",
    paper: "文献",
    sourceUrl: "来源 URL"
  },
  en: {
    assistant: "Device assistant",
    close: "Close device assistant",
    clear: "Clear conversation",
    window: "Move assistant window",
    fullPage: "Full screen",
    exitFullPage: "Exit full screen",
    resize: "Resize assistant window",
    resizeLeft: "Resize assistant width from the left",
    resizeRight: "Resize assistant width from the right",
    moveHelp: "Drag the header to move; focus it and use the arrow keys.",
    resizeHelp: "Drag or use the arrow keys to resize; hold Shift for larger steps.",
    resizeEdgeHelp: "Drag or use Left/Right Arrow to resize width; hold Shift for larger steps. The opposite edge stays fixed.",
    windowHelp: "Drag a free area of the header to move the window. Focus the header and use the arrow keys to move; hold Shift for larger steps. Drag the left or right edge to adjust width, or the bottom-right corner to adjust width and height. Focus a handle to use arrow keys. Manual moving and resizing are unavailable in full-screen or narrow-screen mode.",
    loadFailed: "The device assistant controls could not be loaded. Your question, PDFs, and notes are unchanged; refresh the page to retry.",
    markdownUnavailable: "Rich-text rendering is unavailable; the original Markdown is preserved below.",
    mathUnavailable: "Math rendering is unavailable; formulas are shown as source text.",
    copyTable: "Copy table",
    downloadCsv: "Download CSV",
    tableCopied: "Table copied.",
    copyFailed: "Copy failed. The answer is unchanged; try again.",
    downloadFailed: "Download failed. Try again.",
    tableScroll: "Table, horizontally scrollable",
    tableTooLarge: "The table exceeds {columns} columns or {rows} rows. The source is preserved and export is disabled.",
    tableMalformed: "The table rows are incomplete. The source is preserved and export is disabled.",
    citationUnverified: "Unverified source reference",
    provenance: "Source",
    paper: "Paper",
    sourceUrl: "Source URL"
  }
};

function localBundleBase(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Device assistant bundle base must be a same-origin absolute path");
  }
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.search || url.hash || url.username || url.password) {
    throw new Error("Device assistant bundle base must be a same-origin path only");
  }
  return url.pathname.replace(/\/+$/, "");
}

function ensureStyles() {
  if (document.querySelector('link[data-device-assistant-styles="true"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/device-assistant.css";
  link.dataset.deviceAssistantStyles = "true";
  document.head.append(link);
}

function setClearIcon(button, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const data of ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  const text = document.createElement("span");
  text.className = "sr-only";
  text.textContent = label;
  button.replaceChildren(svg, text);
  button.classList.add("assistant-icon-button");
  button.setAttribute("aria-label", label);
  button.title = label;
}

export async function createDeviceAssistant(adapter) {
  const byId = (id) => document.getElementById(id);
  const panel = byId("assistant-panel");
  const toggle = byId("assistant-toggle");
  const closeButton = byId("assistant-close");
  const clearButton = byId("assistant-new");
  const heading = byId("assistant-heading");
  const historyLabel = document.querySelector('label[for="assistant-history"]');
  const host = document.createElement("div");
  host.id = "device-assistant-body";
  host.className = "assistant-scroll device-assistant-host";
  host.tabIndex = 0;
  panel.dataset.deviceAssistant = "true";
  panel.insertBefore(host, byId("assistant-resize-left"));
  for (const element of [
    byId("assistant-history"), byId("assistant-clear"), byId("assistant-management"),
    byId("assistant-scroll"), byId("assistant-status"), byId("assistant-form"), historyLabel
  ]) {
    if (element) element.hidden = true;
  }
  clearButton.hidden = false;
  ensureStyles();

  let language = adapter.getLanguage() === "en" ? "en" : "zh";
  let handle = null;
  const windowControls = createAssistantWindow({
    panel,
    header: document.querySelector(".assistant-header"),
    fullPageToggle: byId("assistant-full-page"),
    resizeHandle: byId("assistant-resize"),
    leftResizeHandle: byId("assistant-resize-left"),
    rightResizeHandle: byId("assistant-resize-right"),
    help: byId("assistant-window-help")
  });

  function t(key, values = {}, requestedLanguage = language) {
    let text = copy[requestedLanguage]?.[key] || copy.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function model() {
    return { language, owner: adapter.getOwner() };
  }

  function applyWindowLanguage() {
    toggle.textContent = t("assistant");
    heading.textContent = t("assistant");
    closeButton.setAttribute("aria-label", t("close"));
    closeButton.title = t("close");
    setClearIcon(clearButton, t("clear"));
    windowControls.applyLanguage({
      window: t("window"),
      fullPage: t("fullPage"),
      exitFullPage: t("exitFullPage"),
      resize: t("resize"),
      resizeLeft: t("resizeLeft"),
      resizeRight: t("resizeRight"),
      moveHelp: t("moveHelp"),
      resizeHelp: t("resizeHelp"),
      resizeEdgeHelp: t("resizeEdgeHelp"),
      help: t("windowHelp")
    });
  }

  function setOpen(open, options = {}) {
    if (open) {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      windowControls.show();
      handle?.update(model());
      if (options.focus !== false) host.querySelector("textarea")?.focus({ preventScroll: true });
      return;
    }
    handle?.suspend();
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (options.focus !== false) toggle.focus({ preventScroll: true });
  }

  function showFallback() {
    const message = document.createElement("p");
    message.className = "device-assistant-fallback";
    message.setAttribute("role", "alert");
    message.textContent = t("loadFailed");
    host.replaceChildren(message);
  }

  const callbacks = {
    isCurrent: (owner) => adapter.isCurrent(owner),
    revalidate: (owner, materials, signal) => adapter.revalidate(owner, materials, signal),
    saveNote: (save) => adapter.saveNote(save),
    onSource(material) {
      if (!adapter.isCurrent(material)) return;
      setOpen(false, { focus: false });
      void adapter.onSource(material);
    },
    renderAnswer(container, answer, answerLanguage) {
      renderAssistantAnswer(container, {
        answer,
        sources: [],
        language: answerLanguage,
        t: (key, values) => t(key, values, answerLanguage),
        onOpenSource: () => {}
      });
    },
    onLayout() {
      if (!panel.hidden) windowControls.show();
    }
  };

  try {
    const base = localBundleBase(adapter.bundleBase || "/vendor/workspace-shell");
    const module = await import(`${base}/workspace-shell.js`);
    if (typeof module.mountDeviceAssistant !== "function") throw new Error("Device assistant mount unavailable");
    handle = module.mountDeviceAssistant({ container: host, model: model(), callbacks });
  } catch {
    showFallback();
  }

  applyWindowLanguage();
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  closeButton.addEventListener("click", () => setOpen(false));
  clearButton.addEventListener("click", () => handle?.clearConversation());
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden || event.target.closest?.("dialog")) return;
    event.preventDefault();
    setOpen(false);
  });

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage === "en" ? "en" : "zh";
      applyWindowLanguage();
      handle?.update(model());
    },
    contextChanged() {
      handle?.update(model());
    },
    documentChanged() {
      handle?.update(model());
    },
    prepareReaderAction(documentId, action) {
      const result = handle?.prepareReaderAction(documentId, action) || "unavailable";
      if (result === "added") setOpen(true);
      return result;
    },
    addNoteReference(documentId, note) {
      return this.addNoteReferences(documentId, [note]) === "added";
    },
    addNoteReferences(documentId, notes) {
      const result = handle?.addNoteReferences(documentId, notes) || "unavailable";
      if (result === "added") setOpen(true);
      return result;
    },
    isClearPending() {
      return false;
    },
    refreshConversations() {
      return false;
    },
    planAnalysis() {
      return false;
    },
    render() {
      handle?.update(model());
    }
  };
}
