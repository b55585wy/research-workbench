const phoneQuery = window.matchMedia("(max-width: 820px)");
const readerPanel = document.getElementById("reader-panel");
const toolbar = readerPanel?.querySelector(".reader-toolbar");

if (readerPanel && toolbar) {
  const byId = (id) => document.getElementById(id);
  const workspace = document.querySelector(".workspace");
  const readerStage = byId("reader-stage");
  const readingControls = toolbar.querySelector(".reader-reading-controls");
  const viewLabel = toolbar.querySelector(".reader-view-label");
  const findToggle = byId("reader-find-toggle");
  const navigationToggle = byId("reader-navigation-toggle");
  const translationControls = byId("translation-controls");
  const svgNamespace = "http://www.w3.org/2000/svg";

  const copy = {
    zh: {
      annotations: "批注工具",
      more: "更多阅读工具",
      close: "关闭工具面板",
      page: "页面",
      view: "视图与翻译",
      export: "导出",
      currentZoom: "当前缩放",
      textSelectionHint: "先选中文字，再高亮或加下划线。"
    },
    en: {
      annotations: "Annotation tools",
      more: "More reader tools",
      close: "Close tools panel",
      page: "Page",
      view: "View and translation",
      export: "Export",
      currentZoom: "Current zoom",
      textSelectionHint: "Select text first, then highlight or underline it."
    }
  };

  const paths = {
    previous: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    first: '<path d="M6 5v14M18 5l-8 7 8 7"/>',
    last: '<path d="M18 5v14M6 5l8 7-8 7"/>',
    directory: '<path d="M5 6h14M5 12h9M5 18h14"/><path d="M17 10v4m-2-2h4"/>',
    annotation: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.5 8 3 3"/>',
    more: '<circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    zoomOut: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/>',
    zoomIn: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/>',
    fitWidth: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8m-3-3 3 3-3 3m-2-6-3 3 3 3"/>',
    fitPage: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    fullscreen: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
    undo: '<path d="m9 7-5 5 5 5M5 12h8a6 6 0 0 1 6 6"/>',
    redo: '<path d="m15 7 5 5-5 5M19 12h-8a6 6 0 0 0-6 6"/>',
    capture: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8z"/>',
    translate: '<path d="M4 5h10M9 3v2M6 5c.5 4 3 7 7 9M12 5c-.7 3-2.5 5.5-5 7"/><path d="m12 20 3-9 3 9m-5-3h4"/>',
    exportRecord: '<path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6M9 7h4"/>',
    exportPdf: '<path d="M6 3h9l3 3v15H6zM12 8v8m-3-3 3 3 3-3M9 7h4"/>',
    note: '<path d="M5 3h14v18H5zM9 3v18M12 8h4M12 12h4"/>',
    ask: '<path d="M4 4h16v12H9l-5 4z"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7M12 15h.01"/>',
    highlight: '<path d="m9 15-4 4 1 1 4-4M10 5l9 9-5 5-9-9zM3 22h10"/>',
    underline: '<path d="M6 3v7a6 6 0 0 0 12 0V3M5 21h14"/>',
    rectangle: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
    arrow: '<path d="M4 19 19 4m-7 0h7v7"/>',
    line: '<path d="M4 19 20 5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    ink: '<path d="M3 16c3-7 5-11 7-10s1 9 4 9 2-7 4-6c1 1 1 4 3 8"/>',
    textbox: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M8 10h8M8 14h5"/>'
  };

  function language() {
    return document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function text(key) {
    return copy[language()][key];
  }

  function icon(name, className = "") {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.dataset.readerMobileIcon = name;
    if (className) svg.setAttribute("class", className);
    svg.innerHTML = paths[name] || paths.more;
    return svg;
  }

  function setAttribute(node, name, value) {
    const next = String(value);
    if (node.getAttribute(name) !== next) node.setAttribute(name, next);
  }

  function nativeLabel(native, preferAria = false) {
    const aria = native.getAttribute("aria-label")?.trim() || "";
    const visible = native.textContent?.trim() || "";
    return (preferAria ? aria || visible : visible || aria).trim();
  }

  function ensureNativeIcon(native, name) {
    if (!native.querySelector(":scope > svg")) native.append(icon(name));
  }

  const nativeIcons = new Map([
    [byId("page-prev"), "previous"],
    [byId("page-next"), "next"],
    [navigationToggle, "directory"],
    [byId("text-selection-note"), "note"],
    [byId("text-selection-ask"), "ask"],
    [byId("text-selection-translate"), "translate"],
    [byId("text-annotation-highlight"), "highlight"],
    [byId("text-annotation-underline"), "underline"]
  ]);

  const primaryActions = document.createElement("div");
  primaryActions.className = "reader-mobile-primary-actions";
  const annotationTrigger = document.createElement("button");
  annotationTrigger.id = "reader-mobile-annotations-toggle";
  annotationTrigger.type = "button";
  annotationTrigger.className = "button button-quiet reader-mobile-trigger";
  annotationTrigger.setAttribute("aria-controls", "reader-mobile-annotations-panel");
  annotationTrigger.setAttribute("aria-expanded", "false");
  annotationTrigger.append(icon("annotation"));
  const moreTrigger = document.createElement("button");
  moreTrigger.id = "reader-mobile-more-toggle";
  moreTrigger.type = "button";
  moreTrigger.className = "button button-quiet reader-mobile-trigger";
  moreTrigger.setAttribute("aria-controls", "reader-mobile-more-panel");
  moreTrigger.setAttribute("aria-expanded", "false");
  moreTrigger.append(icon("more"));
  primaryActions.append(annotationTrigger, moreTrigger);
  toolbar.append(primaryActions);

  let openPanel = null;
  let returnFocus = null;

  function makePanel(id) {
    const panel = document.createElement("section");
    panel.id = id;
    panel.className = "reader-mobile-sheet";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.hidden = true;
    const header = document.createElement("header");
    header.className = "reader-mobile-sheet-header";
    const heading = document.createElement("h2");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "button button-quiet reader-mobile-close";
    close.append(icon("close"));
    close.addEventListener("click", () => closeTools());
    header.append(heading, close);
    panel.append(header);
    readerPanel.append(panel);
    return { panel, heading, close };
  }

  const annotations = makePanel("reader-mobile-annotations-panel");
  const more = makePanel("reader-mobile-more-panel");
  annotations.panel.setAttribute("aria-labelledby", "reader-mobile-annotations-heading");
  annotations.heading.id = "reader-mobile-annotations-heading";
  more.panel.setAttribute("aria-labelledby", "reader-mobile-more-heading");
  more.heading.id = "reader-mobile-more-heading";

  function makeSection(panel, labelKey) {
    const section = document.createElement("section");
    section.className = "reader-mobile-sheet-section";
    const heading = document.createElement("h3");
    heading.dataset.mobileLabel = labelKey;
    const grid = document.createElement("div");
    grid.className = "reader-mobile-tool-grid";
    section.append(heading, grid);
    panel.append(section);
    return { section, heading, grid };
  }

  const annotationSection = makeSection(annotations.panel, "annotations");
  const pageSection = makeSection(more.panel, "page");
  const viewSection = makeSection(more.panel, "view");
  const exportSection = makeSection(more.panel, "export");
  const viewModeSection = document.createElement("div");
  viewModeSection.className = "reader-mobile-view-mode";
  viewSection.section.append(viewModeSection);

  const proxies = [];
  const textAnnotationToolbar = toolbar.querySelector(".text-annotation-toolbar");
  let pdfSelectionSnapshot = null;
  const flowLockedIds = new Set([
    "page-first", "page-last", "zoom-out", "zoom-in", "zoom-fit", "zoom-fit-page", "reader-fullscreen",
    "annotation-undo", "annotation-redo", "reader-region-mode", "export-reading-record", "export-annotated-pdf",
    "reader-shape-rectangle", "reader-shape-arrow", "reader-shape-line", "reader-shape-ellipse", "reader-shape-ink", "reader-shape-textbox"
  ]);

  function translationToggle() {
    return translationControls.querySelector(".translation-toggle, #translation-fallback");
  }

  function pdfSelectionRange() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return null;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    const textLayer = element?.closest(".textLayer");
    return textLayer && readerStage?.contains(textLayer) ? range : null;
  }

  function selectionContext() {
    return {
      documentId: readerStage?.dataset.documentId || "",
      page: byId("page-input")?.value || ""
    };
  }

  function rememberPdfSelection(range = pdfSelectionRange()) {
    if (!range) return null;
    pdfSelectionSnapshot = { range: range.cloneRange(), ...selectionContext() };
    return pdfSelectionSnapshot;
  }

  function matchingPdfSelectionSnapshot() {
    if (!pdfSelectionSnapshot) return null;
    const context = selectionContext();
    if (pdfSelectionSnapshot.documentId !== context.documentId || pdfSelectionSnapshot.page !== context.page) {
      pdfSelectionSnapshot = null;
      return null;
    }
    return pdfSelectionSnapshot;
  }

  function availablePdfSelection() {
    const range = pdfSelectionRange();
    if (range) return rememberPdfSelection(range).range;
    const snapshot = matchingPdfSelectionSnapshot();
    return snapshot && textAnnotationToolbar?.dataset.contextual === "true" ? snapshot.range : null;
  }

  function preservePdfSelection(event) {
    if (event.button !== 0 || !availablePdfSelection()) return;
    event.preventDefault();
  }

  function restorePdfSelection() {
    if (pdfSelectionRange()) return true;
    const snapshot = matchingPdfSelectionSnapshot();
    const selection = window.getSelection();
    if (!snapshot || !selection || textAnnotationToolbar?.dataset.contextual !== "true") return false;
    selection.removeAllRanges();
    selection.addRange(snapshot.range.cloneRange());
    return Boolean(pdfSelectionRange());
  }

  function addProxy(container, nativeOrGetter, iconName, options = {}) {
    const proxy = document.createElement("button");
    proxy.type = "button";
    proxy.className = "button button-quiet reader-mobile-proxy";
    proxy.dataset.readerMobileProxy = "";
    proxy.append(icon(iconName));
    if (options.keepOpen) proxy.dataset.keepOpen = "true";
    if (options.preferAria) proxy.dataset.preferAria = "true";
    container.append(proxy);
    const definition = { proxy, nativeOrGetter, options };
    proxies.push(definition);
    if (options.textAction) {
      proxy.addEventListener("pointerdown", preservePdfSelection);
      proxy.addEventListener("mousedown", preservePdfSelection);
    }
    proxy.addEventListener("click", () => {
      const native = typeof nativeOrGetter === "function" ? nativeOrGetter() : nativeOrGetter;
      if (!native?.isConnected || native.disabled || native.hidden || native.getAttribute("aria-disabled") === "true" || native.closest("[hidden]")) return;
      const nativeId = native.id;
      if (readerPanel.dataset.flowActive === "true" && (options.flowLock || flowLockedIds.has(nativeId))) return;
      if (options.textAction && !availablePdfSelection()) return;
      if (!options.keepOpen) closeTools({ restoreFocus: !options.textAction });
      if (options.textAction && !restorePdfSelection()) return;
      native.click();
    });
    return proxy;
  }

  addProxy(annotationSection.grid, byId("annotation-undo"), "undo");
  addProxy(annotationSection.grid, byId("annotation-redo"), "redo");
  addProxy(annotationSection.grid, byId("text-annotation-highlight"), "highlight", { textAction: true, flowLock: true });
  addProxy(annotationSection.grid, byId("text-annotation-underline"), "underline", { textAction: true, flowLock: true });
  for (const kind of ["rectangle", "arrow", "line", "ellipse", "ink", "textbox"]) {
    addProxy(annotationSection.grid, byId(`reader-shape-${kind}`), kind);
  }
  addProxy(annotationSection.grid, byId("reader-region-mode"), "capture");
  const textSelectionHint = document.createElement("p");
  textSelectionHint.className = "reader-mobile-selection-hint";
  annotationSection.section.append(textSelectionHint);

  addProxy(pageSection.grid, byId("page-first"), "first", { preferAria: true });
  addProxy(pageSection.grid, byId("page-last"), "last", { preferAria: true });
  addProxy(viewSection.grid, byId("zoom-out"), "zoomOut", { keepOpen: true, preferAria: true });
  const zoomOutput = document.createElement("output");
  zoomOutput.className = "reader-mobile-zoom-value";
  viewSection.grid.append(zoomOutput);
  addProxy(viewSection.grid, byId("zoom-in"), "zoomIn", { keepOpen: true, preferAria: true });
  addProxy(viewSection.grid, byId("zoom-fit"), "fitWidth");
  addProxy(viewSection.grid, byId("zoom-fit-page"), "fitPage");
  const fullscreenProxy = addProxy(viewSection.grid, byId("reader-fullscreen"), "fullscreen", { preferAria: true });
  addProxy(viewSection.grid, translationToggle, "translate", { flowLock: true });
  addProxy(exportSection.grid, byId("export-reading-record"), "exportRecord");
  addProxy(exportSection.grid, byId("export-annotated-pdf"), "exportPdf");

  function syncNativeControls() {
    for (const [native, iconName] of nativeIcons) {
      if (!native) continue;
      const label = nativeLabel(native, native.id === "page-prev" || native.id === "page-next");
      if (label) {
        setAttribute(native, "aria-label", label);
        setAttribute(native, "title", label);
      }
      if (phoneQuery.matches) ensureNativeIcon(native, iconName);
    }
    if (findToggle) {
      const label = nativeLabel(findToggle);
      if (label) {
        setAttribute(findToggle, "aria-label", label);
        setAttribute(findToggle, "title", label);
      }
    }
    toolbar.querySelectorAll(".text-annotation-colors label").forEach((label) => {
      const input = label.querySelector("input");
      const name = label.textContent.trim();
      if (name) {
        setAttribute(label, "title", name);
        setAttribute(input, "aria-label", name);
      }
    });
  }

  function syncProxies() {
    const flowActive = readerPanel.dataset.flowActive === "true";
    for (const { proxy, nativeOrGetter, options } of proxies) {
      const native = typeof nativeOrGetter === "function" ? nativeOrGetter() : nativeOrGetter;
      if (!native) {
        proxy.disabled = true;
        continue;
      }
      const label = nativeLabel(native, options.preferAria);
      if (label) {
        setAttribute(proxy, "aria-label", label);
        setAttribute(proxy, "title", label);
      }
      const flowLocked = flowActive && (options.flowLock || flowLockedIds.has(native.id));
      const selectionMissing = options.textAction && !availablePdfSelection();
      const disabled = Boolean(native.disabled || native.getAttribute("aria-disabled") === "true" || flowLocked || selectionMissing);
      const hidden = options.textAction ? flowLocked : Boolean(native.hidden || native.closest("[hidden]") || flowLocked);
      if (proxy.disabled !== disabled) proxy.disabled = disabled;
      if (proxy.hidden !== hidden) proxy.hidden = hidden;
      const pressed = native.getAttribute("aria-pressed");
      if (pressed === null) proxy.removeAttribute("aria-pressed");
      else setAttribute(proxy, "aria-pressed", pressed);
    }
    setAttribute(fullscreenProxy, "aria-pressed", Boolean(document.fullscreenElement));
    const annotationNatives = [
      byId("annotation-undo"), byId("annotation-redo"), byId("text-annotation-highlight"), byId("text-annotation-underline"),
      byId("reader-region-mode"), ...Array.from(toolbar.querySelectorAll(".reader-shape-tools button"))
    ];
    const annotationsDisabled = flowActive || annotationNatives.every((native) => native.disabled);
    if (annotationTrigger.disabled !== annotationsDisabled) annotationTrigger.disabled = annotationsDisabled;
    const zoomLabel = byId("zoom-label").textContent;
    if (zoomOutput.textContent !== zoomLabel) zoomOutput.textContent = zoomLabel;
  }

  function syncLanguage() {
    setAttribute(annotationTrigger, "aria-label", text("annotations"));
    annotationTrigger.title = text("annotations");
    setAttribute(moreTrigger, "aria-label", text("more"));
    moreTrigger.title = text("more");
    annotations.heading.textContent = text("annotations");
    more.heading.textContent = text("more");
    textSelectionHint.textContent = text("textSelectionHint");
    for (const panel of [annotations, more]) {
      setAttribute(panel.close, "aria-label", text("close"));
      panel.close.title = text("close");
    }
    more.panel.querySelectorAll("[data-mobile-label]").forEach((heading) => {
      const label = text(heading.dataset.mobileLabel);
      if (heading.textContent !== label) heading.textContent = label;
    });
    setAttribute(zoomOutput, "aria-label", text("currentZoom"));
  }

  function syncState() {
    syncLanguage();
    syncNativeControls();
    syncProxies();
  }

  function focusableElements(panel) {
    return Array.from(panel.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']"))
      .filter((node) => !node.hidden && node.getClientRects().length);
  }

  function closeTools(options = {}) {
    if (!openPanel) return;
    const closing = openPanel;
    openPanel.hidden = true;
    openPanel = null;
    annotationTrigger.setAttribute("aria-expanded", "false");
    moreTrigger.setAttribute("aria-expanded", "false");
    if (options.restoreFocus !== false && returnFocus?.isConnected && phoneQuery.matches) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    if (closing.contains(document.activeElement)) document.activeElement.blur();
  }

  function openTools(panel, trigger) {
    if (!phoneQuery.matches || trigger.disabled) return;
    if (openPanel === panel) {
      closeTools();
      return;
    }
    closeTools({ restoreFocus: false });
    openPanel = panel;
    returnFocus = trigger;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const close = panel === annotations.panel ? annotations.close : more.close;
    close.focus({ preventScroll: true });
  }

  annotationTrigger.addEventListener("click", () => openTools(annotations.panel, annotationTrigger));
  moreTrigger.addEventListener("click", () => openTools(more.panel, moreTrigger));

  document.addEventListener("pointerdown", (event) => {
    if (!openPanel || openPanel.contains(event.target) || annotationTrigger.contains(event.target) || moreTrigger.contains(event.target)) return;
    closeTools({ restoreFocus: false });
  });

  document.addEventListener("keydown", (event) => {
    if (!openPanel) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeTools();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableElements(openPanel);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  navigationToggle.addEventListener("click", () => closeTools({ restoreFocus: false }));
  findToggle.addEventListener("click", () => closeTools({ restoreFocus: false }));
  byId("mobile-primary-navigation").addEventListener("click", () => closeTools({ restoreFocus: false }));

  let active = false;
  function updateViewport() {
    const nextActive = phoneQuery.matches;
    if (nextActive === active) return;
    active = nextActive;
    closeTools({ restoreFocus: false });
    document.documentElement.classList.toggle("reader-mobile-tools-active", active);
    if (active) viewModeSection.append(viewLabel);
    else readingControls.insertBefore(viewLabel, findToggle);
    syncState();
  }

  let previousPane = workspace?.dataset.mobilePane;
  let previousOwner = workspace?.dataset.ownerKind;
  let previousDocument = readerStage?.dataset.documentId;
  let previousFlow = readerPanel?.dataset.flowActive;
  const observer = new MutationObserver((records) => {
    let navigationChanged = false;
    for (const record of records) {
      if (record.target === workspace || record.target === readerStage || record.target === readerPanel) {
        const pane = workspace?.dataset.mobilePane;
        const owner = workspace?.dataset.ownerKind;
        const documentId = readerStage?.dataset.documentId;
        const flowActive = readerPanel?.dataset.flowActive;
        if (pane !== previousPane || owner !== previousOwner || documentId !== previousDocument || flowActive !== previousFlow) navigationChanged = true;
        previousPane = pane;
        previousOwner = owner;
        previousDocument = documentId;
        previousFlow = flowActive;
      }
    }
    if (navigationChanged) {
      pdfSelectionSnapshot = null;
      closeTools({ restoreFocus: false });
    }
    syncState();
  });
  observer.observe(toolbar, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["disabled", "hidden", "aria-label", "aria-pressed", "data-contextual"]
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  observer.observe(readerPanel, { attributes: true, attributeFilter: ["data-flow-active"] });
  if (workspace) observer.observe(workspace, { attributes: true, attributeFilter: ["data-mobile-pane", "data-owner-kind"] });
  if (readerStage) observer.observe(readerStage, { attributes: true, attributeFilter: ["data-document-id"] });

  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (pdfSelectionRange()) rememberPdfSelection();
    else if (selection?.rangeCount && !selection.isCollapsed) pdfSelectionSnapshot = null;
    syncProxies();
  });
  byId("page-input")?.addEventListener("change", () => {
    pdfSelectionSnapshot = null;
    syncProxies();
  });

  phoneQuery.addEventListener("change", updateViewport);
  syncState();
  updateViewport();
}
