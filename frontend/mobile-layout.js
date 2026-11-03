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
  const libraryToggle = byId("workspace-library-toggle");
  const notesToggle = byId("workspace-notes-toggle");
  const readingToggle = byId("workspace-mode-reading");
  const assistantToggle = byId("assistant-toggle");
  const assistantClose = byId("assistant-close");
  const appStatus = byId("app-status");
  const navigation = byId("mobile-primary-navigation");
  const navigationButtons = Array.from(navigation.querySelectorAll("[data-mobile-pane]"));
  const labels = {
    zh: {
      navigation: "主要工作区",
      library: "资料",
      reader: "阅读",
      notes: "笔记",
      assistant: "助手",
      back: "返回",
      backLabel: "返回上一窗格",
      emptyNotes: "选择一篇文献后即可记录笔记。已有草稿和来源会保留。"
    },
    en: {
      navigation: "Primary workspace",
      library: "Papers",
      reader: "Read",
      notes: "Notes",
      assistant: "Assistant",
      back: "Back",
      backLabel: "Back to previous pane",
      emptyNotes: "Choose a paper to start taking notes. Existing drafts and sources are preserved."
    }
  };

  let phoneActive = false;
  let currentPane = "library";
  let libraryReturnPane = "reader";
  let notesReturnPane = "reader";
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
  libraryBar.append(libraryTitle, libraryBack);
  documents.prepend(libraryBar);

  const notesBack = document.createElement("button");
  notesBack.type = "button";
  notesBack.className = "mobile-pane-back";
  notesHeading.parentElement.append(notesBack);
  const notesEmpty = document.createElement("p");
  notesEmpty.className = "mobile-notes-empty";
  notesEmpty.id = "mobile-notes-empty";
  notesHeading.parentElement.after(notesEmpty);

  readerHeading.tabIndex = -1;
  notesHeading.tabIndex = -1;
  dataHeading.tabIndex = -1;

  function language() {
    return document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function applyLanguage() {
    const copy = labels[language()];
    navigation.setAttribute("aria-label", copy.navigation);
    for (const button of navigationButtons) {
      const key = button.dataset.mobilePane;
      button.textContent = copy[key];
      button.setAttribute("aria-label", copy[key]);
    }
    libraryTitle.textContent = copy.library;
    for (const button of [libraryBack, notesBack]) {
      button.textContent = copy.back;
      button.setAttribute("aria-label", copy.backLabel);
      button.title = copy.backLabel;
    }
    notesEmpty.textContent = copy.emptyNotes;
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
    const heading = pane === "notes" ? notesHeading : pane === "data" ? dataHeading : readerHeading;
    heading?.focus({ preventScroll: true });
  }

  function showPane(pane, options = {}) {
    if (!phoneActive) return;
    currentPane = pane;
    main.dataset.mobilePane = pane;
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

  function openLibrary() {
    if (currentPane !== "library") libraryReturnPane = currentPane;
    if (documents.hidden) libraryToggle.click();
    if (!documents.hidden) showPane("library");
  }

  function openNotes() {
    if (currentPane !== "notes") notesReturnPane = currentPane;
    if (notes.hidden) notesToggle.click();
    if (!notes.hidden) showPane("notes");
  }

  function closeFocusedPane(pane) {
    const remembered = pane === "library" ? libraryReturnPane : notesReturnPane;
    const target = remembered === "reader" || remembered === "data" ? basePane() : remembered;
    showPane(target || basePane(), { focus: "tab" });
  }

  function clearPendingDocument() {
    if (!pendingDocument) return;
    window.clearTimeout(pendingDocument.timeout);
    pendingDocument = null;
  }

  function resolvePendingDocument() {
    if (!pendingDocument) return;
    const pending = pendingDocument;
    const matches = matchesPendingDocument(pending);
    if (!matches) return;
    clearPendingDocument();
    if (pending.noteId) {
      if (notes.hidden) notesToggle.click();
      if (!notes.hidden) showPane("notes", { focus: "heading" });
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
    const matches = matchesPendingDocument(pendingDocument);
    if (matches) return;
    clearPendingDocument();
    if (appStatus.dataset.kind === "error" && hasDocument() && !notes.hidden && currentPane === "library") {
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
    resolvePendingDocument();
    if (!userNavigated && hasDocument() && !assistantOpen) showBasePane();
    renderNavigation();
  }

  function repairVisiblePane() {
    main.dataset.mobileHasDocument = String(hasDocument());
    if (currentPane === "library" && documents.hidden) showBasePane();
    else if (currentPane === "notes" && notes.hidden) showBasePane();
    else if (currentPane === "reader" && nativeMode() !== "reading") showBasePane();
    else if (currentPane === "data" && nativeMode() !== "data") showBasePane();
    renderNavigation();
  }

  for (const button of navigationButtons) {
    button.addEventListener("click", () => {
      const pane = button.dataset.mobilePane;
      userNavigated = true;
      if (assistantOpen && pane !== "assistant") closeAssistant();
      if (pane === "library") openLibrary();
      else if (pane === "notes") openNotes();
      else if (pane === "reader") {
        if (nativeMode() === "reading") showPane("reader");
        else {
          pendingMode = "reading";
          readingToggle.click();
        }
      } else if (pane === "assistant") {
        if (assistantOpen) closeAssistant();
        else assistantToggle.click();
      }
    });
  }

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

  libraryBack.addEventListener("click", () => closeFocusedPane("library"));
  notesBack.addEventListener("click", () => {
    if (!phoneActive) {
      if (!notes.hidden) notesToggle.click();
      notesToggle.focus({ preventScroll: true });
      return;
    }
    closeFocusedPane("notes");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !phoneActive || assistantOpen || document.querySelector("dialog[open]")) return;
    if (currentPane === "library" || currentPane === "notes") {
      event.preventDefault();
      closeFocusedPane(currentPane);
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
  new MutationObserver(repairVisiblePane).observe(documents, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(repairVisiblePane).observe(notes, { attributes: true, attributeFilter: ["hidden"] });
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
