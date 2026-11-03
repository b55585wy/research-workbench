const messages = {
  zh: {
    open: "导出研究记录",
    title: "导出研究记录",
    help: "原始 PDF 和所选数据始终包含。可选择一项已完成的分析和一项已保存图表。",
    studyHelp: "研究问题、所选数据和明确关联的论文将包含在导出包中。可选择一项已完成的分析和一项已保存图表。",
    close: "关闭",
    analysis: "已完成的分析",
    chart: "已保存图表",
    none: "不包含",
    reading: "包含本篇全部有效笔记、摘录与图片标注",
    studyReading: "包含本研究全部有效笔记与图片",
    readingCounts: "笔记 {notes} 条 · 摘录 {excerpts} 条 · 图片标注 {annotations} 条",
    preview: "预览导出范围",
    retry: "重试",
    previewing: "正在核对导出范围…",
    download: "下载研究记录",
    downloading: "正在准备下载…",
    downloadStarted: "研究记录下载已开始。",
    loadingOptions: "正在读取可导出的范围…",
    chooseScope: "核对范围后，先预览再下载。",
    previewReady: "导出范围已核对。点击下载后才会生成并下载研究记录。",
    previewRequired: "范围已修改，请重新预览后再下载。",
    scopeChanged: "与助手准备范围时相比，导出范围已变化。请明确重新预览后再下载。",
    summary: "导出范围",
    summaryAria: "导出范围",
    document: "文献",
    studyDocument: "研究",
    question: "研究问题",
    papers: "关联论文",
    paperCount: "{count} 篇",
    dataset: "所选数据",
    rows: "数据行数",
    analysisValue: "分析",
    chartValue: "图表",
    readingValue: "阅读记录",
    readingExcluded: "不包含",
    alwaysIncluded: "导出包包含原始PDF和所选数据；此处仅预览范围，不展示数据行或笔记正文。",
    studyAlwaysIncluded: "导出包包含研究问题、所选数据和明确关联的论文；没有关联论文时不包含 PDF。此处仅预览范围，不展示数据行或笔记正文。",
    limit: "导出上限",
    limitValue: "{count} MiB",
    unavailable: "当前不可用",
    describe: "描述统计",
    ttest_independent: "独立样本 t 检验",
    ttest_paired: "配对样本 t 检验",
    correlation: "相关分析",
    analysis_counts: "分析计数",
    histogram: "直方图",
    scatter: "散点图",
    grouped_points: "两组观测点",
    researchRecord: "研究记录",
    network: "无法连接本地服务。请使用相同范围重试。",
    record_scope_changed: "文献、数据、分析或图表已变化。请重新预览后再下载。",
    record_result_mismatch: "所选图表已关联到其他分析。请重新选择图表并预览。",
    record_export_busy: "研究记录导出正忙，请稍后使用相同范围重试。",
    record_component_changed: "分析或图表产物未通过完整性检查。请重新预览后再下载。",
    dataset_changed: "所选数据已变化。请重新预览后再下载。",
    chart_deleted: "所选图表已删除。请重新选择图表并预览。",
    image_missing: "导出所需的图片已缺失。请重新预览后再下载。",
    invalid_record_token: "下载凭证无效或已过期。请重新预览后再下载。",
    source_changed: "来源已变化。请重新预览后再下载。",
    artifact_changed: "分析或图表产物已变化。请重新预览后再下载。",
    analysis_output_changed: "分析产物已变化。请重新预览后再下载。",
    record_too_large: "研究记录超过导出上限，请减少可选内容后重新预览。",
    research_record_too_large: "研究记录超过导出上限，请减少可选内容后重新预览。",
    export_too_large: "研究记录超过导出上限，请减少可选内容后重新预览。",
    busy: "导出服务正忙，请稍后重试。",
    export_busy: "导出服务正忙，请稍后重试。",
    storage_unavailable: "本地存储暂时不可用，请稍后重试。",
    not_found: "所选文献、数据、分析或图表已不可用，请重新选择。",
    validation_error: "导出范围无效，请重新选择后预览。",
    request_failed: "操作未完成，请重试。"
  },
  en: {
    open: "Export research record",
    title: "Export research record",
    help: "The original PDF and selected data are always included. Optionally choose one completed analysis and one saved chart.",
    studyHelp: "The research question, selected data, and explicitly associated papers are included. Optionally choose one completed analysis and one saved chart.",
    close: "Close",
    analysis: "Completed analysis",
    chart: "Saved chart",
    none: "None",
    reading: "Include all active notes, excerpts, and image annotations from this paper",
    studyReading: "Include all active notes and images from this research",
    readingCounts: "{notes} notes · {excerpts} excerpts · {annotations} image annotations",
    preview: "Preview export scope",
    retry: "Retry",
    previewing: "Reviewing export scope…",
    download: "Download research record",
    downloading: "Preparing download…",
    downloadStarted: "Research record download started.",
    loadingOptions: "Loading available export scope…",
    chooseScope: "Review the scope, then preview it before downloading.",
    previewReady: "Export scope reviewed. The research record is generated only after you click Download.",
    previewRequired: "The scope changed. Preview it again before downloading.",
    scopeChanged: "The export scope changed since the assistant prepared the scope. Explicitly preview it again before downloading.",
    summary: "Export scope",
    summaryAria: "Export scope",
    document: "Paper",
    studyDocument: "Research",
    question: "Research question",
    papers: "Associated papers",
    paperCount: "{count} papers",
    dataset: "Selected data",
    rows: "Data rows",
    analysisValue: "Analysis",
    chartValue: "Chart",
    readingValue: "Reading record",
    readingExcluded: "Not included",
    alwaysIncluded: "The package includes the original PDF and selected data. This preview shows scope only, without data rows or note text.",
    studyAlwaysIncluded: "The package includes the research question, selected data, and explicitly associated papers. With no associated papers, it contains no PDF. This preview shows scope only, without data rows or note text.",
    limit: "Export limit",
    limitValue: "{count} MiB",
    unavailable: "Currently unavailable",
    describe: "Descriptive analysis",
    ttest_independent: "Independent-samples t-test",
    ttest_paired: "Paired-samples t-test",
    correlation: "Correlation analysis",
    analysis_counts: "Analysis counts",
    histogram: "Histogram",
    scatter: "Scatter plot",
    grouped_points: "Grouped observations",
    researchRecord: "research-record",
    network: "Cannot connect to the local service. Retry with the same scope.",
    record_scope_changed: "The paper, data, analysis, or chart changed. Preview again before downloading.",
    record_result_mismatch: "The selected chart is linked to a different analysis. Reselect the chart and preview again.",
    record_export_busy: "Research record export is busy. Try again later with the same scope.",
    record_component_changed: "An analysis or chart artifact failed its integrity check. Preview again before downloading.",
    dataset_changed: "The selected dataset changed. Preview again before downloading.",
    chart_deleted: "The selected chart was deleted. Reselect the chart and preview again.",
    image_missing: "An image required for the export is missing. Preview again before downloading.",
    invalid_record_token: "The download token is invalid or expired. Preview again before downloading.",
    source_changed: "A source changed. Preview again before downloading.",
    artifact_changed: "An analysis or chart artifact changed. Preview again before downloading.",
    analysis_output_changed: "An analysis artifact changed. Preview again before downloading.",
    record_too_large: "The research record exceeds the export limit. Remove optional content and preview again.",
    research_record_too_large: "The research record exceeds the export limit. Remove optional content and preview again.",
    export_too_large: "The research record exceeds the export limit. Remove optional content and preview again.",
    busy: "The export service is busy. Try again shortly.",
    export_busy: "The export service is busy. Try again shortly.",
    storage_unavailable: "Local storage is temporarily unavailable. Try again shortly.",
    not_found: "The selected paper, data, analysis, or chart is unavailable. Choose the scope again.",
    validation_error: "The export scope is invalid. Review the selections and preview again.",
    request_failed: "The operation could not be completed. Try again."
  }
};

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createResearchRecord(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    open: byId("research-record-open"),
    dialog: byId("research-record-dialog"),
    analysis: byId("research-record-analysis"),
    chart: byId("research-record-chart"),
    reading: byId("research-record-reading"),
    preview: byId("research-record-preview"),
    download: byId("research-record-download"),
    status: byId("research-record-status"),
    summary: byId("research-record-summary"),
    close: byId("research-record-close")
  };
  let language = adapter.getLanguage();
  let active = null;
  let controller = null;
  let returnFocus = null;

  function t(key, values = {}) {
    let text = messages[language]?.[key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function currentSource() {
    const document = adapter.getDocument();
    const dataset = adapter.getSelectedDataset();
    return { document, dataset };
  }

  function syncOpenState() {
    const { document, dataset } = currentSource();
    elements.open.disabled = !(document?.id && dataset?.id && dataset?.sha256);
  }

  function methodName(method) {
    return t(["ttest_independent", "ttest_paired", "correlation"].includes(method) ? method : "describe");
  }

  function kindName(kind) {
    return messages[language]?.[kind] || messages.en[kind] || kind || "";
  }

  function engineName(engine) {
    return engine === "r" ? "R" : "Python";
  }

  function formatAnalysisLabel(analysis) {
    const label = `${methodName(analysis.method)} · ${engineName(analysis.engine)}`;
    if (!analysis.created_at) return label;
    const createdAt = new Date(analysis.created_at);
    const timestamp = Number.isNaN(createdAt.getTime()) ? String(analysis.created_at) : createdAt.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3
    });
    return `${label} · ${timestamp}`;
  }

  function normalizedSpec(spec) {
    if (!spec || typeof spec !== "object" || typeof spec.dataset_id !== "string" || !/^[0-9a-f]{64}$/i.test(spec.dataset_sha256 || "") || typeof spec.include_reading !== "boolean") return null;
    const validOptionalId = (value) => value === null || typeof value === "string";
    if (!validOptionalId(spec.analysis_id) || !validOptionalId(spec.chart_id)) return null;
    return {
      dataset_id: spec.dataset_id,
      dataset_sha256: spec.dataset_sha256,
      analysis_id: spec.analysis_id || null,
      chart_id: spec.chart_id || null,
      include_reading: spec.include_reading
    };
  }

  function specsEqual(left, right) {
    return Boolean(left && right) && ["dataset_id", "dataset_sha256", "analysis_id", "chart_id", "include_reading"].every((key) => left[key] === right[key]);
  }

  function specFromControls(scope) {
    return {
      dataset_id: scope.datasetId,
      dataset_sha256: scope.datasetSha256,
      analysis_id: elements.analysis.value || null,
      chart_id: elements.chart.value || null,
      include_reading: elements.reading.checked
    };
  }

  function isCurrent(scope) {
    if (active !== scope || !elements.dialog.open) return false;
    const { document, dataset } = currentSource();
    return document?.id === scope.documentId && dataset?.id === scope.datasetId && dataset?.sha256 === scope.datasetSha256 &&
      (adapter.getNavigationGeneration?.() ?? scope.navigationGeneration) === scope.navigationGeneration;
  }

  function closeIfStale(scope) {
    if (active === scope) closeDialog({ restoreFocus: false });
  }

  function fillSelect(select, items, selectedId, label) {
    select.replaceChildren(make("option", "", t("none")));
    select.firstChild.value = "";
    for (const item of items) {
      const option = make("option", "", label(item));
      option.value = item.id;
      select.append(option);
    }
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      const option = make("option", "", `${selectedId} · ${t("unavailable")}`);
      option.value = selectedId;
      select.append(option);
    }
    select.value = selectedId || "";
  }

  function fillPickers(scope, spec) {
    fillSelect(elements.analysis, Array.isArray(scope.options?.analyses) ? scope.options.analyses : [], spec.analysis_id,
      formatAnalysisLabel);
    fillSelect(elements.chart, Array.isArray(scope.options?.charts) ? scope.options.charts : [], spec.chart_id,
      (item) => `${item.title || item.id} · ${kindName(item.kind)}`);
    elements.reading.checked = spec.include_reading;
  }

  function appendField(list, label, value) {
    list.append(make("dt", "", label), make("dd", "", String(value)));
  }

  function renderSummary() {
    elements.summary.replaceChildren();
    const scope = active;
    const result = scope?.preview || scope?.options;
    if (!scope || !result) return;
    const reading = result.reading || { notes: 0, excerpts: 0, annotations: 0 };
    const readingIncluded = scope.preview ? Boolean(reading.included) : elements.reading.checked;
    const analyses = Array.isArray(scope.options?.analyses) ? scope.options.analyses : [];
    const charts = Array.isArray(scope.options?.charts) ? scope.options.charts : [];
    const analysis = analyses.find((item) => item.id === elements.analysis.value) || (scope.preview ? result.analysis : null) || (elements.analysis.value ? { id: elements.analysis.value } : null);
    const chart = scope.preview ? result.chart : charts.find((item) => item.id === elements.chart.value) || (elements.chart.value ? { id: elements.chart.value } : null);
    const analysisLabel = analysis?.method ? formatAnalysisLabel(analysis) : analysis?.id || t("none");
    const chartLabel = chart?.kind ? `${chart.title || chart.id} · ${kindName(chart.kind)}` : chart?.title || chart?.id || t("none");
    const maxBytes = Number(result.limits?.max_bytes || 0);
    const studyOwner = scope.kind === "study" || result.document?.kind === "study";
    const heading = make("h3", "", t("summary"));
    const list = make("dl");
    appendField(list, t(studyOwner ? "studyDocument" : "document"), result.document?.title || result.document?.name || result.document?.id || "");
    if (studyOwner) {
      appendField(list, t("question"), result.document?.question || "—");
      const paperCount = Array.isArray(result.papers) ? result.papers.length : Number(result.papers || 0);
      appendField(list, t("papers"), t("paperCount", { count: paperCount }));
    }
    appendField(list, t("dataset"), result.dataset?.name || result.dataset?.id || scope.datasetId);
    appendField(list, t("rows"), result.dataset?.row_count ?? "—");
    appendField(list, t("analysisValue"), analysisLabel);
    appendField(list, t("chartValue"), chartLabel);
    appendField(list, t("readingValue"), readingIncluded ? t(studyOwner ? "studyReading" : "reading") : t("readingExcluded"));
    appendField(list, t("limit"), t("limitValue", { count: Math.floor(maxBytes / 1048576) }));
    elements.summary.append(heading, list, make("p", "research-record-summary-note", t(studyOwner ? "studyAlwaysIncluded" : "alwaysIncluded")));
  }

  function renderStatus() {
    elements.status.replaceChildren();
    const status = active?.status;
    if (!status) {
      elements.status.removeAttribute("data-kind");
      return;
    }
    elements.status.dataset.kind = status.kind;
    elements.status.append(make("span", "", t(status.key, status.values || {})));
    if (status.retry) {
      const retry = make("button", "button button-quiet research-record-retry", t("retry"));
      retry.type = "button";
      retry.addEventListener("click", () => {
        if (active && !active.pending && !active.downloadPending) status.retry();
      });
      elements.status.append(retry);
    }
  }

  function setStatus(scope, key, kind = "info", values = {}, retry = null) {
    if (active !== scope) return;
    scope.status = { key, kind, values, retry };
    renderStatus();
  }

  function errorStatus(scope, error, retry) {
    if (error?.name === "AbortError") return;
    const code = error?.code;
    const key = code && (Object.hasOwn(messages[language], code) || Object.hasOwn(messages.en, code)) ? code : "request_failed";
    setStatus(scope, key, "error", {}, retry);
  }

  function render() {
    syncOpenState();
    const scope = active;
    const studyOwner = scope?.kind === "study" || currentSource().document?.kind === "study";
    byId("research-record-help").textContent = t(studyOwner ? "studyHelp" : "help");
    byId("research-record-reading-label").textContent = t(studyOwner ? "studyReading" : "reading");
    const busy = Boolean(scope?.pending || scope?.downloadPending);
    elements.analysis.disabled = !scope?.options || busy;
    elements.chart.disabled = !scope?.options || busy;
    elements.reading.disabled = !scope?.options || busy;
    elements.preview.disabled = !scope?.options || busy;
    elements.download.disabled = !scope?.preview || scope.requiresExplicitPreview || busy;
    const reading = (scope?.preview || scope?.options)?.reading;
    byId("research-record-reading-help").textContent = reading ? t("readingCounts", {
      notes: reading.notes || 0,
      excerpts: reading.excerpts || 0,
      annotations: reading.annotations || 0
    }) : "";
    renderSummary();
    renderStatus();
  }

  async function loadOptions(scope) {
    if (active !== scope) return;
    scope.pending = true;
    scope.options = null;
    scope.preview = null;
    controller?.abort();
    controller = new AbortController();
    setStatus(scope, "loadingOptions");
    render();
    const path = `/api/v1/documents/${encodeURIComponent(scope.documentId)}/research-records/options?dataset_id=${encodeURIComponent(scope.datasetId)}&dataset_sha256=${encodeURIComponent(scope.datasetSha256)}`;
    try {
      const options = await adapter.api(path, { signal: controller.signal });
      if (!isCurrent(scope)) {
        closeIfStale(scope);
        return;
      }
      scope.options = options;
      fillPickers(scope, scope.requestedSpec || { analysis_id: null, chart_id: null, include_reading: true });
      scope.pending = false;
      setStatus(scope, "chooseScope");
      render();
      if (scope.requestedSpec) await previewScope(scope, { automatic: true });
    } catch (error) {
      if (!isCurrent(scope)) {
        if (error?.name !== "AbortError") closeIfStale(scope);
        return;
      }
      scope.pending = false;
      errorStatus(scope, error, () => loadOptions(scope));
      render();
    }
  }

  async function openDialog(request = null) {
    const { document, dataset } = currentSource();
    if (!document?.id || !dataset?.id || !dataset?.sha256) {
      syncOpenState();
      return;
    }
    if (elements.dialog.open) closeDialog({ restoreFocus: false });
    returnFocus = request?.returnFocus || window.document.activeElement;
    active = {
      documentId: document.id,
      kind: document.kind === "study" ? "study" : "paper",
      datasetId: dataset.id,
      datasetSha256: dataset.sha256,
      navigationGeneration: adapter.getNavigationGeneration?.(),
      requestedSpec: request?.spec || null,
      originalPreviewSha256: request?.originalPreviewSha256 || null,
      requiresExplicitPreview: false,
      options: null,
      preview: null,
      pending: true,
      downloadPending: false,
      status: null
    };
    elements.analysis.replaceChildren();
    elements.chart.replaceChildren();
    elements.reading.checked = active.requestedSpec?.include_reading ?? true;
    elements.summary.replaceChildren();
    elements.dialog.showModal();
    window.document.documentElement.classList.add("research-record-modal-open");
    render();
    await loadOptions(active);
  }

  async function previewScope(scope, { automatic = false } = {}) {
    if (active !== scope || !scope.options || scope.pending || scope.downloadPending) return;
    const spec = specFromControls(scope);
    scope.pending = true;
    scope.preview = null;
    if (!automatic) {
      scope.originalPreviewSha256 = null;
      scope.requiresExplicitPreview = false;
    }
    controller?.abort();
    controller = new AbortController();
    setStatus(scope, "previewing");
    render();
    try {
      const preview = await adapter.api(`/api/v1/documents/${encodeURIComponent(scope.documentId)}/research-records/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
        signal: controller.signal
      });
      if (!isCurrent(scope)) {
        closeIfStale(scope);
        return;
      }
      if (typeof preview?.download_url !== "string" || !preview.download_url || typeof preview?.preview_sha256 !== "string" || !specsEqual(normalizedSpec(preview.spec), spec)) {
        const error = new Error("Invalid preview");
        error.code = "request_failed";
        throw error;
      }
      scope.preview = preview;
      scope.pending = false;
      if (automatic && scope.originalPreviewSha256 !== preview.preview_sha256) {
        scope.requiresExplicitPreview = true;
        setStatus(scope, "scopeChanged", "warning");
      } else {
        scope.requiresExplicitPreview = false;
        setStatus(scope, "previewReady", "success");
      }
      render();
    } catch (error) {
      if (!isCurrent(scope)) {
        if (error?.name !== "AbortError") closeIfStale(scope);
        return;
      }
      scope.pending = false;
      scope.preview = null;
      errorStatus(scope, error, () => previewScope(scope));
      render();
    }
  }

  async function downloadPreview(scope, preview) {
    if (active !== scope || scope.preview !== preview || scope.requiresExplicitPreview || scope.pending || scope.downloadPending) return;
    scope.downloadPending = true;
    controller?.abort();
    controller = new AbortController();
    setStatus(scope, "downloading");
    render();
    try {
      const response = await adapter.checkedFetch(preview.download_url, { signal: controller.signal });
      const blob = await response.blob();
      if (!isCurrent(scope) || scope.preview !== preview) {
        closeIfStale(scope);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      const base = (preview.document?.title || t("researchRecord")).replace(/[<>:"/\\|?*]/g, "_").trim().slice(0, 80);
      link.href = url;
      link.download = `${base || t("researchRecord")}-research-record.zip`;
      link.hidden = true;
      window.document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      scope.downloadPending = false;
      setStatus(scope, "downloadStarted", "success");
      render();
    } catch (error) {
      if (!isCurrent(scope)) {
        if (error?.name !== "AbortError") closeIfStale(scope);
        return;
      }
      scope.downloadPending = false;
      const scopeDrift = [
        "record_scope_changed", "record_result_mismatch", "record_component_changed", "dataset_changed", "chart_deleted",
        "image_missing", "invalid_record_token", "source_changed", "artifact_changed", "analysis_output_changed"
      ].includes(error?.code);
      if (scopeDrift) scope.preview = null;
      errorStatus(scope, error, scopeDrift ? () => previewScope(scope) : () => downloadPreview(scope, preview));
      render();
    }
  }

  function closeDialog({ restoreFocus = true } = {}) {
    controller?.abort();
    controller = null;
    active = null;
    if (elements.dialog.open) elements.dialog.close();
    window.document.documentElement.classList.remove("research-record-modal-open");
    const target = returnFocus;
    returnFocus = null;
    syncOpenState();
    if (restoreFocus) {
      if (target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
      else if (!elements.open.disabled) elements.open.focus({ preventScroll: true });
    }
  }

  function sourceChanged() {
    if (active || elements.dialog.open) closeDialog({ restoreFocus: false });
    syncOpenState();
  }

  elements.open.addEventListener("click", () => openDialog());
  elements.close.addEventListener("click", () => closeDialog());
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  elements.dialog.addEventListener("close", () => {
    window.document.documentElement.classList.remove("research-record-modal-open");
    if (active) closeDialog({ restoreFocus: false });
  });
  for (const control of [elements.analysis, elements.chart, elements.reading]) {
    control.addEventListener("change", () => {
      if (!active || active.pending || active.downloadPending) return;
      active.preview = null;
      active.originalPreviewSha256 = null;
      active.requiresExplicitPreview = false;
      setStatus(active, "previewRequired");
      render();
    });
  }
  elements.preview.addEventListener("click", () => {
    if (active) previewScope(active);
  });
  elements.download.addEventListener("click", () => {
    if (active?.preview) downloadPreview(active, active.preview);
  });

  syncOpenState();

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.open.textContent = t("open");
      byId("research-record-title").textContent = t("title");
      byId("research-record-help").textContent = t("help");
      elements.close.setAttribute("aria-label", t("close"));
      byId("research-record-analysis-label").textContent = t("analysis");
      byId("research-record-chart-label").textContent = t("chart");
      byId("research-record-reading-label").textContent = t("reading");
      elements.preview.textContent = t("preview");
      elements.download.textContent = t("download");
      elements.summary.setAttribute("aria-label", t("summaryAria"));
      if (active?.options) fillPickers(active, specFromControls(active));
      render();
    },
    documentChanged: sourceChanged,
    sourceChanged,
    navigationChanged: sourceChanged,
    reviewSource(source) {
      const spec = normalizedSpec(source?.spec);
      const { document, dataset } = currentSource();
      if (!spec || !source?.document_id || !source?.dataset_id) {
        adapter.sourceMismatch?.("research_record_invalid_source");
        return;
      }
      if (document?.id !== source.document_id || dataset?.id !== source.dataset_id || dataset?.id !== spec.dataset_id || dataset?.sha256 !== spec.dataset_sha256) {
        adapter.sourceMismatch?.("research_record_source_mismatch");
        return;
      }
      openDialog({
        spec,
        originalPreviewSha256: typeof source.preview_sha256 === "string" ? source.preview_sha256 : null,
        returnFocus: window.document.activeElement
      });
    }
  };
}
