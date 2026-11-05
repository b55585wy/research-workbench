const phoneQuery = window.matchMedia("(max-width: 820px)");
const byId = (id) => document.getElementById(id);
const main = document.querySelector(".workspace");
const documents = byId("documents-panel");
const notes = byId("notes-panel");
const assistant = byId("assistant-panel");

if (main && documents && notes && assistant) {
  const readerHeading = byId("reader-heading");
  const notesHeading = byId("notes-heading");
  const dataHeading = byId("data-workspace-title");
  const notesToggle = byId("workspace-notes-toggle");
  const readingToggle = byId("workspace-mode-reading");
  const assistantToggle = byId("assistant-toggle");
  const assistantClose = byId("assistant-close");
  const appStatus = byId("app-status");
  const navigation = byId("mobile-primary-navigation");
  const navigationButtons = Array.from(navigation.querySelectorAll("[data-mobile-pane]"));
  const svgNamespace = "http://www.w3.org/2000/svg";
  const labels = {
    zh: {
      navigation: "主要工作区",
      library: "资料",
      reader: "阅读",
      notes: "笔记",
      assistant: "助手",
      backReading: "返回阅读",
      backData: "返回数据分析",
      emptyNotes: "请先在资料中选择一篇文献，再编辑或查看笔记。已有草稿和来源会保留。",
      chooseDocument: "选择文献"
    },
    en: {
      navigation: "Primary workspace",
      library: "Library",
      reader: "Read",
      notes: "Notes",
      assistant: "Assistant",
      backReading: "Back to reading",
      backData: "Back to data analysis",
      emptyNotes: "Choose a paper in Library to edit or view notes. Existing drafts and sources are preserved.",
      chooseDocument: "Choose a paper"
    }
  };
  const iconPaths = {
    library: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 6V4h7l2 2"/>',
    reader: '<path d="M3 5c4-1 7 0 9 2 2-2 5-3 9-2v14c-4-1-7 0-9 2-2-2-5-3-9-2z"/><path d="M12 7v14"/>',
    notes: '<path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    assistant: '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    back: '<path d="m15 18-6-6 6-6"/>'
  };

  function makeIcon(name) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML = iconPaths[name];
    return svg;
  }

  let phoneActive = false;
  let currentPane = "library";
  let pendingDocument = null;
  let pendingMode = null;
  let assistantOpen = !assistant.hidden;
  let suppressAssistantFocus = false;
  let userNavigated = false;
  let lastMode = main.dataset.workspaceMode === "data" ? "data" : "reading";

  const libraryBar = document.createElement("div");
  libraryBar.className = "mobile-pane-bar";
  const libraryTitle = document.createElement("strong");
  const libraryBack = document.createElement("button");
  libraryBack.type = "button";
  libraryBack.className = "mobile-pane-back";
  libraryBack.append(makeIcon("back"));
  libraryBar.append(libraryTitle, libraryBack);
  documents.prepend(libraryBar);

  const notesBack = document.createElement("button");
  notesBack.type = "button";
  notesBack.className = "mobile-pane-back";
  notesBack.append(makeIcon("back"));
  notesHeading.parentElement.append(notesBack);
  const notesEmpty = document.createElement("p");
  notesEmpty.className = "mobile-notes-empty";
  notesEmpty.id = "mobile-notes-empty";
  const notesEmptyText = document.createElement("span");
  const notesChooseDocument = document.createElement("button");
  notesChooseDocument.type = "button";
  notesChooseDocument.className = "button button-secondary mobile-notes-library";
  notesEmpty.append(notesEmptyText, notesChooseDocument);
  notesHeading.parentElement.after(notesEmpty);

  for (const button of navigationButtons) {
    const label = document.createElement("span");
    label.className = "mobile-primary-label";
    label.textContent = button.textContent;
    button.replaceChildren(makeIcon(button.dataset.mobilePane), label);
  }

  libraryTitle.tabIndex = -1;
  readerHeading.tabIndex = -1;
  notesHeading.tabIndex = -1;
  dataHeading.tabIndex = -1;

  function language() {
    return document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function applyLanguage() {
    const copy = labels[language()];
    const backLabel = nativeMode() === "data" ? copy.backData : copy.backReading;
    navigation.setAttribute("aria-label", copy.navigation);
    for (const button of navigationButtons) {
      const key = button.dataset.mobilePane;
      button.querySelector(".mobile-primary-label").textContent = copy[key];
      button.setAttribute("aria-label", copy[key]);
    }
    libraryTitle.textContent = copy.library;
    libraryBack.setAttribute("aria-label", backLabel);
    libraryBack.title = backLabel;
    const notesBackLabel = phoneActive ? backLabel : notesToggle.getAttribute("aria-label") || backLabel;
    notesBack.setAttribute("aria-label", notesBackLabel);
    notesBack.title = notesBackLabel;
    notesEmptyText.textContent = copy.emptyNotes;
    notesChooseDocument.textContent = copy.chooseDocument;
  }

  function nativeMode() {
    return main.dataset.workspaceMode === "data" ? "data" : "reading";
  }

  function basePane() {
    return nativeMode() === "data" ? "data" : "reader";
  }

  function hasDocument() {
    return Boolean(main.dataset.ownerKind && main.dataset.ownerKind !== "none");
  }

  function activeDocumentId() {
    return documents.querySelector('#documents-list [data-active="true"]')?.dataset.documentId || null;
  }

  function activeStudyId() {
    return byId("study-list").querySelector('[data-active="true"]')?.dataset.studyId || null;
  }

  function matchesPendingDocument(pending) {
    return pending.study ? activeStudyId() === pending.id : activeDocumentId() === pending.id;
  }

  function renderNavigation() {
    for (const button of navigationButtons) {
      const pane = button.dataset.mobilePane;
      const selected = assistantOpen
        ? pane === "assistant"
        : pane === currentPane && (pane !== "reader" || nativeMode() === "reading");
      button.setAttribute("aria-pressed", String(selected));
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  function focusPane(pane, target) {
    if (target === "tab") {
      navigationButtons.find((button) => button.dataset.mobilePane === (pane === "data" ? "reader" : pane))?.focus({ preventScroll: true });
      return;
    }
    const heading = pane === "library" ? libraryTitle : pane === "notes" ? notesHeading : pane === "data" ? dataHeading : readerHeading;
    heading?.focus({ preventScroll: true });
  }

  function showPane(pane, options = {}) {
    if (!phoneActive) return;
    currentPane = pane;
    if (main.dataset.mobilePane !== pane) main.dataset.mobilePane = pane;
    main.dataset.mobileHasDocument = String(hasDocument());
    renderNavigation();
    if (options.focus) focusPane(pane, options.focus);
  }

  function showBasePane(options = {}) {
    showPane(basePane(), options);
  }

  function closeAssistant() {
    if (assistant.hidden) return;
    suppressAssistantFocus = true;
    assistantClose.click();
  }

  function closeFocusedPane() {
    clearPendingDocument();
    showBasePane({ focus: "heading" });
  }

  function clearPendingDocument() {
    if (!pendingDocument) return;
    window.clearTimeout(pendingDocument.timeout);
    pendingDocument = null;
  }

  function resolvePendingDocument() {
    if (!pendingDocument) return;
    const pending = pendingDocument;
    if (!matchesPendingDocument(pending)) return;
    clearPendingDocument();
    if (pending.noteId) {
      showPane("notes", { focus: "heading" });
      return;
    }
    showBasePane({ focus: "heading" });
  }

  function handleNativeStatus() {
    if (!["error", "info"].includes(appStatus.dataset.kind)) return;
    const rejectedMode = pendingMode !== null;
    pendingMode = null;
    if (rejectedMode && appStatus.dataset.kind === "error" && hasDocument() && !notes.hidden && currentPane === "library") {
      showPane("notes", { focus: "heading" });
    }
    if (!pendingDocument) return;
    const pending = pendingDocument;
    if (matchesPendingDocument(pending)) return;
    clearPendingDocument();
    if (appStatus.dataset.kind === "error" && hasDocument() && pending.noteId && currentPane === "library") {
      showPane("notes", { focus: "heading" });
    }
  }

  function handleModeChange() {
    const mode = nativeMode();
    main.dataset.mobileHasDocument = String(hasDocument());
    if (mode !== lastMode) {
      lastMode = mode;
      const revealMode = pendingMode === mode || currentPane !== "library";
      pendingMode = null;
      if (revealMode) showBasePane();
    }
    applyLanguage();
    resolvePendingDocument();
    if (!userNavigated && hasDocument() && !assistantOpen) showBasePane();
    renderNavigation();
  }

  function repairVisiblePane() {
    main.dataset.mobileHasDocument = String(hasDocument());
    if (currentPane === "reader" && nativeMode() !== "reading") showBasePane();
    else if (currentPane === "data" && nativeMode() !== "data") showBasePane();
    renderNavigation();
  }

  for (const button of navigationButtons) {
    button.addEventListener("click", () => {
      const pane = button.dataset.mobilePane;
      userNavigated = true;
      clearPendingDocument();
      if (!assistant.hidden && pane !== "assistant") closeAssistant();
      if (pane === "library") showPane("library");
      else if (pane === "notes") showPane("notes");
      else if (pane === "reader") {
        if (nativeMode() === "reading") showPane("reader");
        else {
          pendingMode = "reading";
          readingToggle.click();
        }
      } else if (pane === "assistant" && assistant.hidden) assistantToggle.click();
    });
  }

  byId("translation-library-open").addEventListener("click", () => {
    if (!phoneActive || nativeMode() !== "reading") return;
    userNavigated = true;
    clearPendingDocument();
    if (!assistant.hidden) closeAssistant();
    showPane("reader");
  });

  documents.addEventListener("click", (event) => {
    const button = event.target.closest(".document-open, .search-result-open");
    if (!button || button.disabled || !phoneActive) return;
    const item = button.closest("[data-document-id], [data-study-id]");
    const id = item?.dataset.documentId || item?.dataset.studyId;
    if (!id) return;
    userNavigated = true;
    clearPendingDocument();
    pendingDocument = {
      id,
      study: Boolean(item.dataset.studyId),
      noteId: item.dataset.noteId || null,
      timeout: window.setTimeout(() => {
        pendingDocument = null;
      }, 30000)
    };
    queueMicrotask(resolvePendingDocument);
    requestAnimationFrame(resolvePendingDocument);
  });

  libraryBack.addEventListener("click", closeFocusedPane);
  notesBack.addEventListener("click", () => {
    if (!phoneActive) {
      if (!notes.hidden) notesToggle.click();
      notesToggle.focus({ preventScroll: true });
      return;
    }
    closeFocusedPane();
  });
  notesChooseDocument.addEventListener("click", () => showPane("library", { focus: "heading" }));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !phoneActive || assistantOpen || document.querySelector("dialog[open]")) return;
    if (currentPane === "library" || currentPane === "notes") {
      event.preventDefault();
      closeFocusedPane();
    }
  });

  new MutationObserver(handleModeChange).observe(main, {
    attributes: true,
    attributeFilter: ["data-workspace-mode", "data-owner-kind"]
  });
  new MutationObserver(resolvePendingDocument).observe(byId("documents-list"), {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["data-active", "data-document-id"]
  });
  new MutationObserver(resolvePendingDocument).observe(byId("study-list"), {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["data-active", "data-study-id"]
  });
  new MutationObserver(handleNativeStatus).observe(appStatus, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["data-kind"]
  });
  new MutationObserver(() => {
    const open = !assistant.hidden;
    const changed = open !== assistantOpen;
    assistantOpen = open;
    renderNavigation();
    if (changed && !open) {
      if (suppressAssistantFocus) suppressAssistantFocus = false;
      else if (phoneActive) focusPane(currentPane, "tab");
      repairVisiblePane();
    }
  }).observe(assistant, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(applyLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  const readerPanel = byId("reader-panel");
  const readerStage = byId("reader-stage");
  const zoomFit = byId("zoom-fit");
  let autoFitDocumentId = null;
  let pendingAutoFitDocumentId = null;
  let fitPhoneSessionActive = false;

  function cancelPendingAutoFit() {
    if (!pendingAutoFitDocumentId) return;
    autoFitDocumentId = pendingAutoFitDocumentId;
    pendingAutoFitDocumentId = null;
  }

  function fitPhonePdf() {
    if (!phoneActive || nativeMode() !== "reading" || readerPanel.dataset.flowActive === "true") return;
    const id = activeDocumentId();
    if (pendingAutoFitDocumentId && pendingAutoFitDocumentId !== id) pendingAutoFitDocumentId = null;
    if (!id || autoFitDocumentId === id) return;
    if (Math.abs((window.visualViewport?.scale || 1) - 1) > 0.01) {
      autoFitDocumentId = id;
      pendingAutoFitDocumentId = null;
      return;
    }
    pendingAutoFitDocumentId = id;
    if (zoomFit.disabled || readerStage.dataset.documentId !== id || !readerStage.clientWidth) return;
    autoFitDocumentId = id;
    pendingAutoFitDocumentId = null;
    zoomFit.click();
  }

  const fitObserver = new MutationObserver(fitPhonePdf);
  fitObserver.observe(byId("documents-list"), {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["data-active", "data-document-id"]
  });
  fitObserver.observe(main, { attributes: true, attributeFilter: ["data-workspace-mode", "data-owner-kind", "data-mobile-pane"] });
  fitObserver.observe(readerPanel, { attributes: true, attributeFilter: ["data-flow-active"] });
  fitObserver.observe(readerStage, { attributes: true, attributeFilter: ["data-document-id"] });
  fitObserver.observe(zoomFit, { attributes: true, attributeFilter: ["disabled"] });
  new MutationObserver(() => {
    if (phoneActive && !fitPhoneSessionActive) {
      autoFitDocumentId = null;
      pendingAutoFitDocumentId = null;
    }
    fitPhoneSessionActive = phoneActive;
    fitPhonePdf();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  zoomFit.parentElement.addEventListener("click", (event) => {
    if (event.target.closest("#zoom-in, #zoom-out, #zoom-fit-page")) cancelPendingAutoFit();
  }, true);
  window.visualViewport?.addEventListener("resize", () => {
    if (Math.abs((window.visualViewport?.scale || 1) - 1) > 0.01) cancelPendingAutoFit();
  });

  function updateViewport() {
    const viewport = window.visualViewport;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--mobile-viewport-width", `${viewport?.width || window.innerWidth}px`);
    rootStyle.setProperty("--mobile-viewport-height", `${viewport?.height || window.innerHeight}px`);
    rootStyle.setProperty("--mobile-viewport-left", `${viewport?.offsetLeft || 0}px`);
    rootStyle.setProperty("--mobile-viewport-top", `${viewport?.offsetTop || 0}px`);
    const nextPhoneActive = phoneQuery.matches;
    if (nextPhoneActive === phoneActive) return;
    phoneActive = nextPhoneActive;
    document.documentElement.classList.toggle("mobile-layout-active", phoneActive);
    document.body.classList.toggle("mobile-layout-active", phoneActive);
    applyLanguage();
    if (phoneActive) {
      if (hasDocument() && !userNavigated) showBasePane();
      else showPane(currentPane);
      repairVisiblePane();
    }
  }

  applyLanguage();
  updateViewport();
  window.addEventListener("resize", updateViewport);
  window.visualViewport?.addEventListener("resize", updateViewport);
  window.visualViewport?.addEventListener("scroll", updateViewport);
  phoneQuery.addEventListener("change", updateViewport);
}
