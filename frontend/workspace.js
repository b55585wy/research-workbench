const messages = {
  zh: {
    reading: "阅读",
    data: "数据分析",
    analysis: "分析",
    charts: "图表",
    notes: "笔记",
    noteEditor: "编辑笔记",
    showLibrary: "展开资料栏",
    hideLibrary: "收起资料栏",
    showNotes: "展开笔记栏",
    hideNotes: "收起笔记栏",
    dataTitle: "数据工作区",
    dataSection: "数据",
    resultsSection: "结果",
    manualSettings: "手动设置分析",
    projectMaterials: "项目资料",
    dataHelp: "导入或选择当前文献的数据并核对前 5 行预览。助手仅使用你明确共享的预览。",
    studyDataHelp: "导入或选择当前项目的数据并核对前 5 行预览。助手仅使用你明确共享的预览。",
    personalDataHelp: "导入或选择“我的数据”中的数据并核对前 5 行预览。助手仅使用你明确共享的预览。",
    prerequisite: "请点击“我的数据”开始，或从目录打开已有数据、分析或图表。",
    paperContext: "当前文献：{title}",
    projectContext: "当前项目：{title}",
    personalContext: "我的数据",
    imports: "数据导入记录",
    importsHelp: "SAV/ZSAV 原始文件和核对记录保留在此处。打开记录不会更改当前数据或运行设置。"
  },
  en: {
    reading: "Reading",
    data: "Data analysis",
    analysis: "Analysis",
    charts: "Charts",
    notes: "Notes",
    noteEditor: "Edit note",
    showLibrary: "Expand library sidebar",
    hideLibrary: "Collapse library sidebar",
    showNotes: "Expand notes sidebar",
    hideNotes: "Collapse notes sidebar",
    dataTitle: "Data workspace",
    dataSection: "Data",
    resultsSection: "Results",
    manualSettings: "Manual analysis settings",
    projectMaterials: "Project materials",
    dataHelp: "Import or choose data for the current paper and review the 5-row preview. The assistant receives only the preview you explicitly share.",
    studyDataHelp: "Import or choose data for the current project and review the 5-row preview. The assistant receives only the preview you explicitly share.",
    personalDataHelp: "Import or choose data in My data and review the 5-row preview. The assistant receives only the preview you explicitly share.",
    prerequisite: "Choose My data to begin, or open an existing dataset, analysis, or chart from the catalog.",
    paperContext: "Current paper: {title}",
    projectContext: "Current project: {title}",
    personalContext: "My data",
    imports: "Data import history",
    importsHelp: "SAV/ZSAV originals and reviews remain available here. Opening a review does not change the current data or run settings."
  }
};

function moveMany(target, nodes) {
  for (const node of nodes.filter(Boolean)) target.append(node);
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createWorkspace(adapter) {
  const byId = (id) => document.getElementById(id);
  const main = document.querySelector(".workspace");
  const reader = document.querySelector(".reader-panel");
  const documents = byId("documents-panel");
  const notes = document.querySelector(".notes-panel");
  const analysis = byId("analysis-panel");
  const charts = byId("charts-panel");
  const imports = byId("data-imports");
  const modeReading = byId("workspace-mode-reading");
  const modeData = byId("workspace-mode-data");
  const libraryToggle = byId("workspace-library-toggle");
  const notesToggle = byId("workspace-notes-toggle");
  const dataWorkspace = byId("data-workspace");
  const studyView = byId("study-view");
  const studyMaterials = byId("study-materials");
  const analysisTab = byId("data-tool-analysis");
  const chartsTab = byId("data-tool-charts");
  const prerequisite = byId("data-prerequisite");
  const analysisBody = analysis.querySelector(".analysis-body");
  const chartsBody = charts.querySelector(".charts-body");
  const importReview = byId("spss-import-review");
  const importStatus = byId("spss-import-status");
  const importSelect = byId("spss-import-select");
  const importSelectLabel = byId("spss-import-select-label");
  byId("note-editor-group").append(byId("note-form"));
  moveMany(byId("saved-notes-group"), [
    byId("notes-filter-panel"),
    notes.querySelector(".review-explainer:not(#study-review-explainer)"),
    byId("notes-empty"),
    byId("notes-list")
  ]);
  dataWorkspace.append(imports, analysis, charts);
  const importHistory = make("details", "data-import-history");
  const importSummary = make("summary");
  importHistory.id = "data-import-history";
  importHistory.append(importSummary, byId("data-imports-heading"), byId("data-imports-help"), importSelectLabel, importSelect);
  imports.append(importHistory);
  imports.insertBefore(importStatus, importReview);

  const analysisOverview = make("section", "analysis-overview");
  const dataHeading = make("h3", "analysis-section-heading", "数据");
  dataHeading.id = "data-section-heading";
  analysisOverview.setAttribute("aria-labelledby", dataHeading.id);
  analysisOverview.append(dataHeading);
  const analysisSettings = make("details", "analysis-settings");
  const analysisSettingsSummary = make("summary", "", "手动设置分析");
  const analysisSettingsBody = make("div", "analysis-settings-body");
  analysisSettings.append(analysisSettingsSummary, analysisSettingsBody);
  const analysisResults = make("section", "analysis-results");
  const resultsHeading = make("h3", "analysis-section-heading", "结果");
  resultsHeading.id = "analysis-results-heading";
  analysisResults.setAttribute("aria-labelledby", resultsHeading.id);
  analysisResults.append(resultsHeading);
  const analysisLayout = make("div", "analysis-layout");
  analysisLayout.append(analysisOverview, analysisSettings, analysisResults);
  analysisBody.append(analysisLayout);
  moveMany(analysisOverview, [
    analysisBody.querySelector(".analysis-help"),
    analysisBody.querySelector(".analysis-upload-row"),
    byId("dataset-upload-status"),
    analysisBody.querySelector('label[for="dataset-select"]'),
    byId("dataset-select"),
    analysisBody.querySelector('label[for="dataset-share"]'),
    byId("analysis-assistant-plan"),
    byId("analysis-assistant-plan-help"),
    byId("dataset-preview"),
    byId("dataset-selection")
  ]);
  moveMany(analysisSettingsBody, [
    byId("analysis-method-label"),
    byId("analysis-method"),
    byId("analysis-method-status"),
    byId("analysis-columns-fieldset"),
    byId("analysis-engine-label"),
    byId("analysis-engine"),
    byId("ttest-options"),
    byId("analysis-paired-fields"),
    byId("analysis-correlation-fields"),
    analysisBody.querySelector(".analysis-runtime"),
    byId("analysis-prepare"),
    byId("analysis-confirmation")
  ]);
  moveMany(analysisResults, [byId("analysis-status"), byId("analyses-list"), byId("analysis-result"), byId("analysis-log")]);
  analysis.open = true;

  const chartBuilder = make("section", "charts-builder");
  const chartOutput = make("section", "charts-output");
  const chartsLayout = make("div", "charts-layout");
  chartsLayout.append(chartBuilder, chartOutput);
  chartsBody.append(chartsLayout);
  moveMany(chartBuilder, [
    chartsBody.querySelector(".charts-help"),
    ...chartsBody.querySelectorAll(":scope > .chart-field"),
    chartsBody.querySelector(".chart-draft-actions"),
    byId("chart-status")
  ]);
  moveMany(chartOutput, [
    chartsBody.querySelector(".chart-view"),
    chartsBody.querySelector(".charts-list-heading"),
    byId("charts-list"),
    byId("charts-deleted")
  ]);
  charts.open = true;

  const params = new URLSearchParams(window.location.search);
  let language = adapter.getLanguage();
  dataHeading.textContent = t("dataSection");
  resultsHeading.textContent = t("resultsSection");
  analysisSettingsSummary.textContent = t("manualSettings");
  byId("study-materials-summary").textContent = t("projectMaterials");
  importSummary.textContent = t("imports");
  let mode = modeForParams(params);
  let tool = params.get("chart") || params.get("tool") === "charts" ? "charts" : "analysis";
  let importReviewOpen = false;
  let libraryVisible = true;
  const libraryVisibility = { reading: true, data: true };
  let notesVisible = mode === "reading";
  const notesVisibility = { reading: true, data: false };
  const focusByMode = new Map();
  let initialized = false;
  let navigationGeneration = 0;
  let modePending = false;

  function t(key, values = {}) {
    let text = messages[language]?.[key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function renderOwnerCopy() {
    const owner = adapter.getDocument();
    const studyOwner = owner?.kind === "study";
    const personalOwner = studyOwner && owner.workspace_role === "personal_analysis";
    main.dataset.ownerKind = personalOwner ? "personal" : studyOwner ? "study" : owner ? "paper" : "none";
    modeReading.textContent = t("reading");
    byId("data-workspace-help").textContent = t(personalOwner ? "personalDataHelp" : studyOwner ? "studyDataHelp" : "dataHelp");
    prerequisite.textContent = t("prerequisite");
    const context = byId("data-owner-context");
    context.textContent = !owner ? "" : personalOwner ? t("personalContext") : t(studyOwner ? "projectContext" : "paperContext", {
      title: owner.title || owner.name || owner.original_filename || owner.id
    });
  }

  function modeForParams(search) {
    const explicit = search.get("workspace");
    if (explicit === "reading") return "reading";
    if (search.has("note") || search.has("image_source")) return "reading";
    if (["analysis", "dataset", "chart"].some((key) => search.has(key))) return "data";
    return explicit === "data" ? "data" : "reading";
  }

  function isVisible(node) {
    return Boolean(node?.isConnected && node.getClientRects().length && !node.closest("[hidden]"));
  }

  function confirmationNeedsReveal() {
    const confirmation = byId("analysis-confirmation");
    return !confirmation.hidden || confirmation.contains(document.activeElement);
  }

  function revealManualSettings() {
    if (confirmationNeedsReveal()) analysisSettings.open = true;
  }

  function associationNeedsReveal() {
    const paperStatus = byId("study-papers-status");
    const resourceWriteStatus = byId("study-resources-write-status");
    return Boolean(
      studyView.querySelector('.study-status[data-kind="error"]:not(:empty)') ||
      paperStatus.dataset.kind === "info" && paperStatus.childElementCount ||
      resourceWriteStatus.dataset.kind === "info" && resourceWriteStatus.childElementCount ||
      resourceWriteStatus.querySelector(".study-resource-write-operation")
    );
  }

  function revealProjectMaterials() {
    const owner = adapter.getDocument();
    const normalProject = owner?.kind === "study" && owner.workspace_role !== "personal_analysis";
    if (mode === "data" && normalProject && !studyView.hidden && associationNeedsReveal()) studyMaterials.open = true;
  }

  function render() {
    renderOwnerCopy();
    const reviewVisible = mode === "data" && tool === "analysis" && importReviewOpen;
    const owner = adapter.getDocument();
    const dataStudy = mode === "data" && owner?.kind === "study";
    if (dataStudy) {
      if (studyView.parentElement !== studyMaterials) studyMaterials.append(studyView);
      if (studyMaterials.parentElement !== dataWorkspace) dataWorkspace.insertBefore(studyMaterials, imports);
    } else if (studyView.parentElement !== reader) {
      reader.insertBefore(studyView, byId("metadata-panel"));
    }
    studyMaterials.hidden = !dataStudy || studyView.hidden;
    main.dataset.workspaceMode = mode;
    main.dataset.libraryVisible = String(libraryVisible);
    main.dataset.notesVisible = String(notesVisible);
    dataWorkspace.dataset.tool = tool;
    dataWorkspace.dataset.reviewOpen = String(reviewVisible);
    documents.hidden = !libraryVisible;
    reader.hidden = mode !== "reading";
    dataWorkspace.hidden = mode !== "data";
    notes.hidden = !notesVisible;
    byId("reading-sidebar").hidden = mode !== "reading";
    modeReading.setAttribute("aria-pressed", String(mode === "reading"));
    modeData.setAttribute("aria-pressed", String(mode === "data"));
    modeReading.disabled = modePending;
    modeData.disabled = modePending;
    analysisTab.setAttribute("aria-pressed", String(tool === "analysis"));
    chartsTab.setAttribute("aria-pressed", String(tool === "charts"));
    analysisTab.disabled = modePending;
    chartsTab.disabled = modePending;
    analysis.hidden = tool !== "analysis" || reviewVisible;
    charts.hidden = tool !== "charts";
    byId("data-tool-switch").hidden = reviewVisible;
    imports.dataset.reviewOpen = String(reviewVisible);
    importReview.hidden = !reviewVisible || !byId("spss-import-summary").children.length;
    prerequisite.hidden = Boolean(owner);
    const libraryToggleLabel = t(libraryVisible ? "hideLibrary" : "showLibrary");
    libraryToggle.textContent = libraryToggleLabel;
    libraryToggle.setAttribute("aria-expanded", String(libraryVisible));
    libraryToggle.setAttribute("aria-pressed", String(libraryVisible));
    libraryToggle.setAttribute("aria-label", libraryToggleLabel);
    libraryToggle.title = libraryToggleLabel;
    const notesToggleLabel = t(notesVisible ? "hideNotes" : "showNotes");
    notesToggle.textContent = notesToggleLabel;
    notesToggle.setAttribute("aria-expanded", String(notesVisible));
    notesToggle.setAttribute("aria-pressed", String(notesVisible));
    notesToggle.setAttribute("aria-label", notesToggleLabel);
    notesToggle.title = notesToggleLabel;
    revealManualSettings();
    revealProjectMaterials();
    adapter.modeRendered?.(mode);
    if (initialized) {
      if (mode === "reading") adapter.readingVisible?.();
      else adapter.toolVisible?.(tool);
    }
  }

  function rememberFocus() {
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest(".workspace-modebar")) focusByMode.set(mode, active);
  }

  function restoreFocus() {
    const previous = focusByMode.get(mode);
    if (isVisible(previous)) previous.focus({ preventScroll: true });
    else (mode === "reading" ? modeReading : modeData).focus({ preventScroll: true });
  }

  main.addEventListener("focusin", (event) => {
    focusByMode.set(mode, event.target);
  });
  analysisSettings.addEventListener("focusin", revealManualSettings);
  analysisSettings.addEventListener("toggle", () => {
    if (!analysisSettings.open && confirmationNeedsReveal()) analysisSettings.open = true;
  });
  new MutationObserver(revealManualSettings).observe(byId("analysis-confirmation"), { attributes: true, attributeFilter: ["hidden"] });
  studyMaterials.addEventListener("toggle", () => {
    if (!studyMaterials.open && mode === "data" && associationNeedsReveal()) studyMaterials.open = true;
  });
  new MutationObserver(revealProjectMaterials).observe(studyView, {
    attributes: true,
    attributeFilter: ["data-kind"],
    childList: true,
    subtree: true
  });
  const richTextStatus = byId("rich-text-status");
  function revealRichTextError() {
    if (richTextStatus.dataset.kind === "error") byId("note-editor-group").open = true;
  }
  new MutationObserver(revealRichTextError).observe(richTextStatus, {
    attributes: true,
    attributeFilter: ["data-kind"],
    childList: true
  });

  function reveal(nextMode, options = {}) {
    navigationGeneration += 1;
    adapter.navigationChanged?.();
    const nextTool = options.tool === "charts" ? "charts" : options.tool === "analysis" ? "analysis" : tool;
    const changed = mode !== nextMode || tool !== nextTool;
    if (changed && initialized) rememberFocus();
    if (mode !== nextMode) {
      libraryVisibility[mode] = libraryVisible;
      libraryVisible = libraryVisibility[nextMode];
      notesVisibility[mode] = notesVisible;
      notesVisible = notesVisibility[nextMode];
    }
    mode = nextMode;
    tool = nextTool;
    if (options.showNotes) notesVisible = true;
    if (options.reviewOpen !== undefined) importReviewOpen = Boolean(options.reviewOpen);
    if (options.updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("workspace", mode);
      if (mode === "data") {
        url.searchParams.set("tool", tool);
        for (const key of ["note", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
        if (options.clearSources) for (const key of ["analysis", "dataset", "chart"]) url.searchParams.delete(key);
      } else {
        url.searchParams.delete("tool");
        for (const key of ["analysis", "dataset", "chart"]) url.searchParams.delete(key);
      }
      window.history[options.replace ? "replaceState" : "pushState"]({}, "", url);
    }
    render();
    if (changed && initialized && options.focus !== false) requestAnimationFrame(restoreFocus);
  }

  modeReading.addEventListener("click", () => void adapter.modeSelected?.("reading"));
  modeData.addEventListener("click", () => void adapter.modeSelected?.("data"));
  analysisTab.addEventListener("click", () => reveal("data", { tool: "analysis", updateUrl: true, clearSources: true, reviewOpen: false }));
  chartsTab.addEventListener("click", () => {
    reveal("data", { tool: "charts", updateUrl: true, clearSources: true, reviewOpen: false });
    const documentId = adapter.getDocument()?.id;
    if (documentId) adapter.chartsSelected?.(documentId);
  });
  libraryToggle.addEventListener("click", () => {
    libraryVisible = !libraryVisible;
    libraryVisibility[mode] = libraryVisible;
    render();
    const previous = focusByMode.get(mode);
    if (!libraryVisible) libraryToggle.focus({ preventScroll: true });
    else if (documents.contains(previous) && isVisible(previous)) previous.focus({ preventScroll: true });
    else libraryToggle.focus({ preventScroll: true });
  });
  notesToggle.addEventListener("click", () => {
    notesVisible = !notesVisible;
    notesVisibility[mode] = notesVisible;
    render();
    const previous = focusByMode.get(mode);
    const fallback = byId(adapter.getDocument()?.kind === "study" ? "study-note-text" : "note-text");
    if (!notesVisible) notesToggle.focus({ preventScroll: true });
    else if (notes.contains(previous) && isVisible(previous)) previous.focus({ preventScroll: true });
    else if (isVisible(fallback) && !fallback.disabled) fallback.focus({ preventScroll: true });
    else notesToggle.focus({ preventScroll: true });
  });

  render();
  initialized = true;

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      modeReading.textContent = t("reading");
      modeData.textContent = t("data");
      analysisTab.textContent = t("analysis");
      chartsTab.textContent = t("charts");
      byId("data-workspace-title").textContent = t("dataTitle");
      byId("data-workspace-help").textContent = t("dataHelp");
      dataHeading.textContent = t("dataSection");
      resultsHeading.textContent = t("resultsSection");
      analysisSettingsSummary.textContent = t("manualSettings");
      byId("note-editor-summary").textContent = t("noteEditor");
      byId("study-materials-summary").textContent = t("projectMaterials");
      prerequisite.textContent = t("prerequisite");
      byId("data-imports-heading").textContent = t("imports");
      byId("data-imports-help").textContent = t("importsHelp");
      importSummary.textContent = t("imports");
      dataWorkspace.setAttribute("aria-label", t("dataTitle"));
      byId("workspace-mode-controls").setAttribute("aria-label", `${t("reading")} / ${t("data")}`);
      byId("data-tool-switch").setAttribute("aria-label", `${t("analysis")} / ${t("charts")}`);
      render();
    },
    documentChanged() {
      render();
    },
    modeForParams,
    getMode() {
      return mode;
    },
    getTool() {
      return tool;
    },
    getNavigationGeneration() {
      return navigationGeneration;
    },
    setModePending(pending) {
      modePending = Boolean(pending);
      adapter.modePendingChanged?.(modePending);
      render();
    },
    reveal,
    showNotes(section = "editor") {
      if (section === "saved") byId("saved-notes-group").open = true;
      else byId("note-editor-group").open = true;
      notesVisible = true;
      notesVisibility[mode] = true;
      render();
    },
    setImportReview(documentId, open, revealReview = false) {
      const currentDocumentId = adapter.getDocument()?.id || null;
      if ((open && currentDocumentId !== documentId) || (!open && documentId && currentDocumentId !== documentId)) return;
      if (open && revealReview && mode === "data") {
        reveal("data", { tool: "analysis", reviewOpen: true });
        byId("spss-import-defer")?.focus({ preventScroll: true });
        return;
      }
      const changed = importReviewOpen !== Boolean(open);
      importReviewOpen = Boolean(open);
      render();
      const reviewVisible = mode === "data" && tool === "analysis" && importReviewOpen;
      if (changed && open && reviewVisible) byId("spss-import-defer")?.focus({ preventScroll: true });
      else if (changed && !open && mode === "data" && tool === "analysis" && importReview.contains(document.activeElement)) analysisTab.focus({ preventScroll: true });
    }
  };
}
