export const GUIDE_STORAGE_KEY = "research-workbench-first-use-v1";

const copy = {
  zh: {
    storage: ["资料保存在哪里", "本机资料保存在当前浏览器；服务器资料保存在当前服务器空间。切换不会自动搬移文件。"],
    library: ["从一篇论文开始", "在资料中导入 PDF，也可以先打开试读论文。"],
    reading: ["阅读与翻译", "在正文中阅读、查找和标注；翻译也从阅读区打开。"],
    notes: ["记录你的想法", "在笔记区整理摘录和图片，保留原文位置。"],
    assistant: ["向助手提问", "打开助手后再输入问题；发送前可以加入要讨论的资料。"],
    tools: ["分析、绘图与 PPT", "从这里切换数据分析、科研绘图和汇报 PPT。操作由你选择后执行。"]
  },
  en: {
    storage: ["Where your files live", "Device files stay in this browser; server files stay in the current server space. Switching does not move files."],
    library: ["Start with a paper", "Import a PDF from the library, or open the sample paper first."],
    reading: ["Read and translate", "Read, find and annotate in the reading area. Translation opens here too."],
    notes: ["Keep your ideas", "Collect excerpts and images in Notes, with links back to the original page."],
    assistant: ["Ask the assistant", "Open the assistant, then type your question. Add the material you want to discuss before sending."],
    tools: ["Analysis, charts and PPT", "Switch to data analysis, scientific charts or presentations here. You choose when to run an operation."]
  }
};

const targets = {
  storage: ["#device-storage-ui > details > summary", "#device-storage-ui summary", "#device-storage-ui button"],
  library: ["#upload-button", '#mobile-primary-navigation [data-mobile-pane="library"]', '#workspace-library-toggle'],
  reading: ['#mobile-primary-navigation [data-mobile-pane="reader"]', '[data-research-area="reading"]', "#reader-page-input", "#workspace-mode-reading"],
  notes: ['#mobile-primary-navigation [data-mobile-pane="notes"]', '#workspace-notes-toggle'],
  assistant: ['#mobile-primary-navigation [data-mobile-pane="assistant"]', '.research-shell-button[aria-controls="assistant-panel"]', '#assistant-toggle'],
  tools: [".research-shell-select", '[data-research-area="analysis"]', "#workspace-mode-data"]
};

export function guideSteps(device = false, language = "zh") {
  const text = copy[language === "en" ? "en" : "zh"];
  return Object.entries(targets).filter(([id]) => !device || id !== "tools")
    .map(([id, selectors]) => {
      const reading = device && id === "reading";
      const body = reading ? (language === "en" ? "Read, find and annotate in the reading area. Notes link back to the original page." : "在正文中阅读、查找和标注；笔记可回到原文位置。") : text[id][1];
      return { id, selectors, title: reading ? (language === "en" ? "Read and annotate" : "阅读与标注") : text[id][0], body };
    });
}

export function createGuideSession({ storage, getSteps, onChange = () => {} }) {
  let seen = false, destroyed = false;
  let state = { open: false, index: 0, steps: [] };
  const notify = () => onChange({ ...state, steps: [...state.steps] });
  function hasSeen() {
    if (seen) return true;
    try { seen = ["completed", "skipped"].includes(storage?.getItem(GUIDE_STORAGE_KEY)); } catch {}
    return seen;
  }
  return {
    get state() { return { ...state, steps: [...state.steps] }; },
    hasSeen,
    start(force = false) {
      if (destroyed || state.open) return false;
      if (!force && hasSeen()) return false;
      const steps = getSteps();
      if (!steps.length) return false;
      state = { open: true, index: 0, steps: [...steps] };
      notify();
      return true;
    },
    previous() {
      if (!state.open || state.index === 0 || destroyed) return;
      state.index -= 1; notify();
    },
    next() {
      if (!state.open || destroyed) return;
      if (state.index === state.steps.length - 1) { this.dismiss("completed"); return; }
      state.index += 1; notify();
    },
    dismiss(status = "skipped") {
      if (!state.open || destroyed) return;
      seen = true;
      try { storage?.setItem(GUIDE_STORAGE_KEY, status === "completed" ? "completed" : "skipped"); } catch {}
      state.open = false; notify();
    },
    stop() { if (!state.open) return; state.open = false; notify(); },
    destroy() { if (destroyed) return; this.stop(); destroyed = true; }
  };
}

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
const guides = new WeakMap();

export function guidePosition(rect, viewport, cardHeight = 190) {
  const values = [rect.left, rect.top, rect.width, rect.height, viewport.left, viewport.top, viewport.width, viewport.height, cardHeight];
  if (!values.every(Number.isFinite) || values.slice(2, 4).some((v) => v <= 0)) return null;
  const pad = 8, gap = 24, width = Math.min(304, viewport.width - pad * 2);
  let height = Math.min(cardHeight, viewport.height - pad * 2);
  if (width < 128 || height < 64) return null;
  const left = Math.max(viewport.left, rect.left), top = Math.max(viewport.top, rect.top);
  const right = Math.min(viewport.left + viewport.width, rect.left + rect.width);
  const bottom = Math.min(viewport.top + viewport.height, rect.top + rect.height);
  if (right <= left || bottom <= top) return null;
  const room = { right: viewport.left + viewport.width - right - pad,
    left: left - viewport.left - pad, bottom: viewport.top + viewport.height - bottom - pad,
    top: top - viewport.top - pad };
  let side = ["right", "left", "bottom", "top"].find((key) => room[key] >= (key === "left" || key === "right" ? width : height) + gap);
  if (!side) {
    side = room.top >= room.bottom ? "top" : "bottom";
    height = Math.min(height, room[side] - gap);
    if (height < 64) return null;
  }
  const midX = (left + right) / 2, midY = (top + bottom) / 2;
  const x = clamp(side === "right" ? right + gap : side === "left" ? left - gap - width : midX - width / 2,
    viewport.left + pad, viewport.left + viewport.width - width - pad);
  const y = clamp(side === "bottom" ? bottom + gap : side === "top" ? top - gap - height : midY - height / 2,
    viewport.top + pad, viewport.top + viewport.height - height - pad);
  const horizontal = side === "right" || side === "left";
  const from = horizontal ? [side === "right" ? x - 3 : x + width + 3, clamp(midY, y + 16, y + height - 16)]
    : [clamp(midX, x + 16, x + width - 16), side === "bottom" ? y - 3 : y + height + 3];
  const to = horizontal ? [side === "right" ? right + 7 : left - 7, midY] : [midX, side === "bottom" ? bottom + 7 : top - 7];
  return { x, y, width, maxHeight: height, side, arrow: `M${from.join(",")} L${to.join(",")}`,
    target: { left: left - 3, top: top - 3, width: right - left + 6, height: bottom - top + 6 } };
}

export function createFirstUseGuide({ getLanguage, isDevice = () => false,
  bundleURL = "/vendor/workspace-shell/workspace-shell.js" }) {
  guides.get(document)?.destroy();
  const host = document.createElement("div");
  host.id = "first-use-guide"; host.hidden = true;
  document.body.append(host);
  let destroyed = false, view = null, loading = null, frame = null, timer = null, manualFrame = null;
  let autoAllowed = false, autoAttempted = false, previousFocus = null, lastModel = "";
  let storage = null;
  try { storage = window.localStorage; } catch {}

  function viewport() {
    const v = window.visualViewport;
    return { left: v?.offsetLeft || 0, top: v?.offsetTop || 0,
      width: v?.width || window.innerWidth, height: v?.height || window.innerHeight };
  }

  function visible(element) {
    if (!element?.isConnected || element.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || !element.getClientRects().length) return false;
    const r = element.getBoundingClientRect(), v = viewport();
    return r.width > 0 && r.height > 0 && r.right > v.left && r.bottom > v.top
      && r.left < v.left + v.width && r.top < v.top + v.height;
  }

  function target(step) {
    for (const selector of step.selectors) {
      const element = [...document.querySelectorAll(selector)].find(visible);
      if (element) return element;
    }
    return null;
  }

  function blocked() {
    if (!document.getElementById("startup-status")?.hidden || document.visibilityState === "hidden" || document.fullscreenElement) return true;
    return [...document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"], .device-storage-menu[open]')]
      .some((element) => !host.contains(element) && visible(element));
  }

  function editing() {
    return !host.contains(document.activeElement) && Boolean(document.activeElement?.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function release() {
    const restore = host.contains(document.activeElement);
    view?.destroy(); view = null; host.hidden = true; lastModel = "";
    if (!restore) return;
    const destination = visible(previousFocus) ? previousFocus : document.querySelector(".header-settings-gear");
    if (visible(destination)) destination.focus({ preventScroll: true });
  }

  const session = createGuideSession({ storage,
    getSteps: () => guideSteps(isDevice(), getLanguage()).filter((step) => target(step)).map((step) => step.id),
    onChange: () => { if (!session.state.open) release(); else schedule(); }
  });

  async function render() {
    if (destroyed || !session.state.open) return;
    if (blocked() || editing()) { session.stop(); return; }
    const state = session.state;
    const step = guideSteps(isDevice(), getLanguage()).find((step) => step.id === state.steps[state.index]);
    const anchor = step && target(step);
    if (!anchor) { session.stop(); return; }
    const card = host.querySelector(".first-use-card");
    const height = card ? Math.max(card.getBoundingClientRect().height, card.scrollHeight + 2) : 224;
    const layout = guidePosition(anchor.getBoundingClientRect(), viewport(), height);
    if (!layout) { session.stop(); return; }
    const model = { title: step.title, body: step.body, language: getLanguage() === "en" ? "en" : "zh",
      stepId: step.id, index: state.index, total: state.steps.length, layout };
    if (lastModel === JSON.stringify(model)) return;
    if (view) { lastModel = JSON.stringify(model); view.update(model); schedule(); return; }
    if (loading) return;
    const url = new URL(bundleURL, window.location.origin);
    if (!bundleURL.startsWith("/") || bundleURL.startsWith("//") || bundleURL.includes("\\")
        || url.origin !== window.location.origin || url.hash || url.username || url.password) throw new TypeError("Guide bundle must be a local path");
    loading = import(url.href).then((module) => {
      if (destroyed || !session.state.open) return;
      if (blocked() || editing()) { session.stop(); return; }
      if (typeof module.mountFirstUseGuide !== "function") throw new Error("Guide view unavailable");
      host.hidden = false;
      view = module.mountFirstUseGuide({ container: host, model, onAction(action) {
        if (action === "previous") session.previous();
        else if (action === "next") session.next();
        else if (action === "skip") session.dismiss();
      } });
      schedule();
    }).catch((error) => { session.stop(); console.warn("First-use guide unavailable.", error); })
      .finally(() => { loading = null; });
    await loading;
  }

  function schedule() {
    if (destroyed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      void render().catch((error) => { session.stop(); console.warn("First-use guide unavailable.", error); });
    });
  }

  function start(force = false) {
    if (destroyed || blocked() || editing() || (!force && window.getSelection()?.toString())) return false;
    previousFocus = document.activeElement;
    const opened = session.start(force);
    if (opened) autoAttempted = true;
    return opened;
  }

  function auto() {
    if (!autoAllowed || autoAttempted || destroyed || session.state.open) return;
    if (session.hasSeen()) { autoAttempted = true; return; }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = null; start(); }, 1000);
  }

  function changed() { if (session.state.open) schedule(); else auto(); }
  function request() {
    cancelAnimationFrame(manualFrame);
    manualFrame = requestAnimationFrame(() => { manualFrame = null; if (!destroyed) start(true); });
  }
  function keys(event) {
    if (!session.state.open) { auto(); return; }
    if (event.key !== "Escape" || !session.state.open) return;
    event.preventDefault(); event.stopImmediatePropagation(); session.dismiss();
  }
  function focus() { if (session.state.open && editing()) session.stop(); else auto(); }
  function fullscreen() { if (document.fullscreenElement) session.stop(); else changed(); }
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !host.contains(record.target))) changed();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open", "class", "style"] });
  const languageObserver = new MutationObserver(changed);
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  const events = [[window, "resize", changed], [window, "scroll", changed], [window, "workbench:guide-request", request],
    [document, "keydown", keys], [document, "pointerdown", auto], [document, "focusin", focus],
    [document, "focusout", auto], [document, "visibilitychange", changed], [document, "fullscreenchange", fullscreen]];
  if (window.visualViewport) events.push([window.visualViewport, "resize", changed], [window.visualViewport, "scroll", changed]);
  for (const [node, name, handler] of events) node.addEventListener(name, handler, true);
  const bridge = {
    startAutomatically() { autoAllowed = true; auto(); },
    start: () => start(true),
    destroy() {
      if (destroyed) return;
      destroyed = true; window.clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(manualFrame);
      observer.disconnect(); languageObserver.disconnect();
      for (const [node, name, handler] of events) node.removeEventListener(name, handler, true);
      session.destroy(); release(); host.remove();
      if (guides.get(document) === bridge) guides.delete(document);
    }
  };
  guides.set(document, bridge);
  return bridge;
}
