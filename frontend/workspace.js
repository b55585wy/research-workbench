const messages = {
  zh: {
    reading: "阅读",
    data: "数据分析",
    analysis: "分析",
    charts: "图表",
    notes: "笔记",
    showNotes: "显示笔记",
    hideNotes: "隐藏笔记",
    dataTitle: "数据工作区",
    dataHelp: "数据、设置、结果和图表均属于当前文献。预览仅显示前 5 行，运行分析前仍需核对并明确确认。",
    prerequisite: "请先从左侧选择或上传一篇文献，再导入与该文献关联的数据。",
    imports: "数据导入记录",
    importsHelp: "SAV/ZSAV 原始文件和核对记录保留在此处。打开记录不会更改当前数据或运行设置。"
  },
  en: {
    reading: "Reading",
    data: "Data analysis",
    analysis: "Analysis",
    charts: "Charts",
    notes: "Notes",
    showNotes: "Show notes",
    hideNotes: "Hide notes",
    dataTitle: "Data workspace",
    dataHelp: "Data, settings, results, and charts belong to the current paper. Previews show only the first 5 rows; every analysis run still requires review and explicit confirmation.",
    prerequisite: "Choose or upload a paper on the left before importing data associated with that paper.",
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
  const notes = document.querySelector(".notes-panel");
  const analysis = byId("analysis-panel");
  const charts = byId("charts-panel");
  const imports = byId("data-imports");
  const modeReading = byId("workspace-mode-reading");
  const modeData = byId("workspace-mode-data");
  const notesToggle = byId("workspace-notes-toggle");
  const dataWorkspace = byId("data-workspace");
  const analysisTab = byId("data-tool-analysis");
  const chartsTab = byId("data-tool-charts");
  const prerequisite = byId("data-prerequisite");
  const analysisBody = analysis.querySelector(".analysis-body");
  const chartsBody = charts.querySelector(".charts-body");
  const importReview = byId("spss-import-review");
  const importStatus = byId("spss-import-status");
  const importSelect = byId("spss-import-select");
  const importSelectLabel = byId("spss-import-select-label");
  dataWorkspace.append(imports, analysis, charts);
  const importHistory = make("details", "data-import-history");
  const importSummary = make("summary");
  importHistory.id = "data-import-history";
  importHistory.append(importSummary, importSelectLabel, importSelect);
  imports.append(importHistory);
  imports.insertBefore(importStatus, importReview);

  const analysisOverview = make("div", "analysis-overview");
  const analysisSettings = make("section", "analysis-settings");
  const analysisResults = make("section", "analysis-results");
  const analysisLayout = make("div", "analysis-layout");
  analysisLayout.append(analysisOverview, analysisSettings, analysisResults);
  analysisBody.append(analysisLayout);
  moveMany(analysisOverview, [
    analysisBody.querySelector(".analysis-help"),
    analysisBody.querySelector(".analysis-upload-row"),
    byId("dataset-upload-status"),
    analysisBody.querySelector('label[for="dataset-select"]'),
    byId("dataset-select"),
    byId("dataset-preview"),
    byId("dataset-selection")
  ]);
  moveMany(analysisSettings, [
    byId("analysis-method-label"),
    byId("analysis-method"),
    byId("analysis-method-status"),
    byId("analysis-columns-fieldset"),
    analysisBody.querySelector('label[for="dataset-share"]'),
    byId("analysis-engine-label"),
    byId("analysis-engine"),
    byId("ttest-options"),
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
  let mode = modeForParams(params);
  let tool = params.get("chart") || params.get("tool") === "charts" ? "charts" : "analysis";
  let importReviewOpen = false;
  let notesVisible = mode === "reading";
  const notesVisibility = { reading: true, data: false };
  const focusByMode = new Map();
  let initialized = false;
  let navigationGeneration = 0;

  function t(key) {
    return messages[language]?.[key] || messages.en[key] || key;
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

  function render() {
    const reviewVisible = mode === "data" && tool === "analysis" && importReviewOpen;
    main.dataset.workspaceMode = mode;
    main.dataset.notesVisible = String(notesVisible);
    dataWorkspace.dataset.tool = tool;
    dataWorkspace.dataset.reviewOpen = String(reviewVisible);
    reader.hidden = mode !== "reading";
    dataWorkspace.hidden = mode !== "data";
    notes.hidden = !notesVisible;
    modeReading.setAttribute("aria-pressed", String(mode === "reading"));
    modeData.setAttribute("aria-pressed", String(mode === "data"));
    analysisTab.setAttribute("aria-pressed", String(tool === "analysis"));
    chartsTab.setAttribute("aria-pressed", String(tool === "charts"));
    analysis.hidden = tool !== "analysis" || reviewVisible;
    charts.hidden = tool !== "charts";
    byId("data-tool-switch").hidden = reviewVisible;
    imports.dataset.reviewOpen = String(reviewVisible);
    importReview.hidden = !reviewVisible || !byId("spss-import-summary").children.length;
    prerequisite.hidden = Boolean(adapter.getDocument());
    notesToggle.textContent = t(notesVisible ? "hideNotes" : "showNotes");
    notesToggle.setAttribute("aria-pressed", String(notesVisible));
    notesToggle.setAttribute("aria-label", t(notesVisible ? "hideNotes" : "showNotes"));
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

  function reveal(nextMode, options = {}) {
    navigationGeneration += 1;
    adapter.navigationChanged?.();
    const nextTool = options.tool === "charts" ? "charts" : options.tool === "analysis" ? "analysis" : tool;
    const changed = mode !== nextMode || tool !== nextTool;
    if (changed && initialized) rememberFocus();
    if (mode !== nextMode) {
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

  modeReading.addEventListener("click", () => reveal("reading", { updateUrl: true, clearSources: true }));
  modeData.addEventListener("click", () => reveal("data", { updateUrl: true, clearSources: true }));
  analysisTab.addEventListener("click", () => reveal("data", { tool: "analysis", updateUrl: true, clearSources: true, reviewOpen: false }));
  chartsTab.addEventListener("click", () => {
    reveal("data", { tool: "charts", updateUrl: true, clearSources: true, reviewOpen: false });
    const documentId = adapter.getDocument()?.id;
    if (documentId) adapter.chartsSelected?.(documentId);
  });
  notesToggle.addEventListener("click", () => {
    notesVisible = !notesVisible;
    notesVisibility[mode] = notesVisible;
    render();
    if (notesVisible) byId("note-text").focus({ preventScroll: true });
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
    reveal,
    showNotes() {
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
