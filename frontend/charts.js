import { frozenChartSkill, chartSkillReference, chartSkillsMatch, chartSkillAllows, chartSkillImageOptions, visibleChartSkill } from "/chart-skill-state.js";
import { CHART_RENDERER_URL, isChartRenderer } from "/chart-renderer.js";

const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const HEX_64 = /^[0-9a-f]{64}$/;

const messages = {
  zh: {
    panel: "实验图表",
    help: "从已保存数据或分析结果生成可追溯图表。先预览，再明确保存；图表仅描述数据。",
    dataset: "数据",
    analysis: "已保存分析",
    noAnalysis: "请选择已完成的分析",
    kind: "图表类型",
    analysis_counts: "分析有效值 / 缺失值计数",
    histogram: "直方图",
    scatter: "散点图",
    grouped_points: "两组观测点",
    groupColumn: "分组标签（X）",
    outcomeColumn: "观测数值（Y）",
    chooseGroupedFields: "请选择不同的分组列和数值观测列。",
    invalid_grouped_points_data: "需要恰好两组完整观测，且分组标签有效。",
    groups: "分组计数",
    missingGroupOnly: "仅分组缺失",
    missingValueOnly: "仅观测值缺失",
    missingBoth: "分组和观测值均缺失",
    groupOverlap: "相同观测点可能重叠；图表数据与计数仍保留每一条原始记录。",
    title: "图表标题",
    titlePlaceholder: "输入图表标题",
    x: "X 列",
    y: "Y 列",
    bins: "分组数",
    preview: "预览",
    previewing: "正在预览…",
    save: "保存图表",
    retrySave: "按原请求重试保存",
    saving: "正在保存…",
    cancel: "取消",
    saved: "图表已保存。",
    previewReady: "预览已生成，尚未保存。",
    previewFailed: "预览未完成，请重试。",
    saveRetry: "保存结果不确定。已冻结原请求，可精确重试或明确取消。",
    loading: "正在加载图表…",
    loadFailed: "图表加载失败，请重试。",
    rendering: "正在加载本地图表组件…",
    renderFailed: "图表显示失败，请重试。",
    invalidArtifact: "图表数据未通过完整性或身份校验，未显示。",
    invalidCapabilities: "图表能力或渲染器信息无效。",
    network: "无法连接本地服务。草稿和原请求已保留。",
    validation_error: "请检查数据、分析、字段、标题和分组数。",
    request_failed: "操作未完成，请重试。",
    not_found: "请求的数据、分析或图表不存在。",
    chart_deleted: "图表已删除，请先恢复。",
    revision_conflict: "图表已在其他地方更新，未覆盖较新的版本。",
    source_changed: "数据来源已变化，请重新预览。",
    dataset_changed: "数据已变化，请重新预览。",
    chart_quota: "图表数量已达上限。",
    noDataset: "请先上传并选择数据。",
    noNumeric: "此数据没有可用于图表的数值列。",
    chooseAnalysis: "请选择一项已完成且属于此数据的分析。",
    chooseFields: "请选择所需数值列；散点图的 X 和 Y 必须不同。",
    savedCharts: "已保存图表",
    deletedCharts: "已删除图表",
    open: "查看",
    export: "导出离线包",
    exporting: "正在导出…",
    exported: "离线图表包已导出。",
    clone: "用作新草稿",
    note: "引用到新笔记草稿",
    noteAdded: "图表链接已追加到新笔记草稿，尚未保存。",
    delete: "删除",
    restore: "恢复",
    deleting: "正在删除…",
    restoring: "正在恢复…",
    deleted: "图表已删除，可恢复。",
    restored: "图表已恢复。",
    deleteConfirm: "删除此图表？图表记录会保留，可之后恢复。",
    lifecycleRetry: "操作结果不确定，可按原请求重试。",
    summary: "数据摘要",
    details: "来源与规格",
    rows: "原始行数",
    used: "使用行数",
    excluded: "排除行数",
    columns: "字段",
    source: "数据来源",
    chartKind: "类型",
    renderer: "渲染器",
    recipe: "配方 SHA-256",
    dataHash: "数据 SHA-256",
    previewBadge: "预览 · 未保存",
    savedBadge: "已保存 · 只读",
    empty: "还没有已保存图表。",
    png: "下载 PNG",
    svg: "下载 SVG",
    style: "图表风格",
    styleNote: "切换样式不会改变数据。",
    skillSnapshot: "使用保存时的 skill：{name} · v{revision}",
    chart_skill_invalid: "绘图 skill 配置无效，请重新选择。",
    chart_skill_changed: "绘图 skill 已更新或与当前图型不匹配，请重新选择并预览。",
    chart_skill_export_unavailable: "此 skill 未包含所选导出格式。",
    defaultStyle: "默认",
    activeChart: "当前图表",
    chartProposal: "图表提案",
    proposalDataset: "数据",
    proposalFields: "字段",
    proposalBins: "分组数",
    proposalPreview: "预览图表",
    proposalPreviewing: "正在预览…",
    proposalPreviewReady: "只读预览已生成，可确认原提案。",
    proposalPreviewFailed: "预览失败，请重试；尚未写入。",
    openChart: "打开已保存图表",
    chartRevision: "修订号",
    chartDataHash: "图表数据 SHA-256",
    draftLabel: "绘图草稿",
    assistantPreviewContext: "助手提案预览 · {kind}",
    draftPreviewContext: "草稿预览 · {kind}",
    savedChartContext: "已保存图表 · {kind}"
  },
  en: {
    panel: "Experiment charts",
    help: "Build traceable charts from saved data or analysis results. Preview first, then explicitly save. Charts only describe the data.",
    dataset: "Data",
    analysis: "Saved analysis",
    noAnalysis: "Choose a completed analysis",
    kind: "Chart type",
    analysis_counts: "Analysis valid / missing counts",
    histogram: "Histogram",
    scatter: "Scatter plot",
    grouped_points: "Two-group observations",
    groupColumn: "Group label (X)",
    outcomeColumn: "Observed numeric value (Y)",
    chooseGroupedFields: "Choose distinct grouping and numeric outcome columns.",
    invalid_grouped_points_data: "Exactly two complete groups with valid labels are required.",
    groups: "Group counts",
    missingGroupOnly: "Group only missing",
    missingValueOnly: "Observed value only missing",
    missingBoth: "Group and observed value missing",
    groupOverlap: "Identical points may overlap; the chart data and counts retain every original observation.",
    title: "Chart title",
    titlePlaceholder: "Enter a chart title",
    x: "X column",
    y: "Y column",
    bins: "Bins",
    preview: "Preview",
    previewing: "Previewing…",
    save: "Save chart",
    retrySave: "Retry exact save",
    saving: "Saving…",
    cancel: "Cancel",
    saved: "Chart saved.",
    previewReady: "Preview generated; not saved.",
    previewFailed: "Preview failed. Try again.",
    saveRetry: "The save outcome is uncertain. The original request is frozen for an exact retry or explicit cancellation.",
    loading: "Loading charts…",
    loadFailed: "Charts could not be loaded. Try again.",
    rendering: "Loading the local chart renderer…",
    renderFailed: "The chart could not be displayed. Try again.",
    invalidArtifact: "Chart data failed integrity or identity checks and was not displayed.",
    invalidCapabilities: "Chart capabilities or renderer details are invalid.",
    network: "Cannot connect to the local service. Your draft and original request are retained.",
    validation_error: "Check the data, analysis, fields, title, and bin count.",
    request_failed: "The action was not completed. Try again.",
    not_found: "The requested data, analysis, or chart does not exist.",
    chart_deleted: "This chart is deleted. Restore it first.",
    revision_conflict: "The chart changed elsewhere. A newer version was not overwritten.",
    source_changed: "The source changed. Preview again.",
    dataset_changed: "The data changed. Preview again.",
    chart_quota: "The chart limit has been reached.",
    noDataset: "Upload and choose a dataset first.",
    noNumeric: "This dataset has no numeric columns available for charts.",
    chooseAnalysis: "Choose a completed analysis belonging to this dataset.",
    chooseFields: "Choose the required numeric columns; scatter X and Y must differ.",
    savedCharts: "Saved charts",
    deletedCharts: "Deleted charts",
    open: "View",
    export: "Export offline bundle",
    exporting: "Exporting…",
    exported: "Offline chart bundle exported.",
    clone: "Use as new draft",
    note: "Add citation to new note draft",
    noteAdded: "The chart link was appended to the new note draft; it is not saved.",
    delete: "Delete",
    restore: "Restore",
    deleting: "Deleting…",
    restoring: "Restoring…",
    deleted: "Chart deleted; it can be restored.",
    restored: "Chart restored.",
    deleteConfirm: "Delete this chart? Its record will be retained and can be restored.",
    lifecycleRetry: "The outcome is uncertain. Retry the exact request.",
    summary: "Data summary",
    details: "Source and specification",
    rows: "Source rows",
    used: "Rows used",
    excluded: "Rows excluded",
    columns: "Fields",
    source: "Data source",
    chartKind: "Type",
    renderer: "Renderer",
    recipe: "Recipe SHA-256",
    dataHash: "Data SHA-256",
    previewBadge: "Preview · not saved",
    savedBadge: "Saved · read-only",
    empty: "No saved charts yet.",
    png: "Download PNG",
    svg: "Download SVG",
    style: "Chart style",
    styleNote: "Changing the style preserves the data.",
    skillSnapshot: "Saved skill: {name} · v{revision}",
    chart_skill_invalid: "The figure skill is invalid. Select it again.",
    chart_skill_changed: "The figure skill changed or does not match this chart. Select it again and preview.",
    chart_skill_export_unavailable: "This skill does not include the selected export format.",
    defaultStyle: "Default",
    activeChart: "Active chart",
    chartProposal: "Chart proposal",
    proposalDataset: "Data",
    proposalFields: "Fields",
    proposalBins: "Bins",
    proposalPreview: "Preview chart",
    proposalPreviewing: "Previewing…",
    proposalPreviewReady: "Read-only preview generated; the exact proposal can be confirmed.",
    proposalPreviewFailed: "Preview failed. Retry; nothing was written.",
    openChart: "Open saved chart",
    chartRevision: "Revision",
    chartDataHash: "Chart data SHA-256",
    draftLabel: "Chart draft",
    assistantPreviewContext: "Assistant proposal preview · {kind}",
    draftPreviewContext: "Draft preview · {kind}",
    savedChartContext: "Saved chart · {kind}"
  }
};

function escapePlotlyText(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function figureFor(artifact, labels = {}) {
  const spec = artifact.spec;
  const title = escapePlotlyText(artifact.title);
  const base = {
    title: { text: title },
    autosize: true,
    margin: { l: 64, r: 24, t: 64, b: 80 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { color: "#172033" },
    showlegend: artifact.kind === "analysis_counts",
    legend: { orientation: "h" },
    hovermode: "closest"
  };
  if (artifact.kind === "analysis_counts") {
    return {
      traces: [
        { type: "bar", name: escapePlotlyText(labels.valid || "Valid"), x: artifact.series.columns.map(escapePlotlyText), y: artifact.series.valid, marker: { color: "#1677b8" } },
        { type: "bar", name: escapePlotlyText(labels.missing || "Missing"), x: artifact.series.columns.map(escapePlotlyText), y: artifact.series.missing, marker: { color: "#d97706" } }
      ],
      layout: { ...base, barmode: "group", xaxis: { title: { text: "" }, automargin: true }, yaxis: { title: { text: escapePlotlyText(labels.rows || "Rows") }, rangemode: "tozero", fixedrange: false } }
    };
  }
  if (artifact.kind === "histogram") {
    return {
      traces: [{ type: "bar", x: artifact.series.labels.map(escapePlotlyText), y: artifact.series.counts, marker: { color: "#1677b8" }, hoverinfo: "x+y" }],
      layout: { ...base, bargap: 0, xaxis: { title: { text: escapePlotlyText(spec.x) }, automargin: true }, yaxis: { title: { text: escapePlotlyText(labels.rows || "Rows") }, rangemode: "tozero" } }
    };
  }
  if (artifact.kind === "grouped_points") {
    return {
      traces: [{
        type: "scatter",
        mode: "markers",
        x: artifact.series.x.map(escapePlotlyText),
        y: artifact.series.y,
        text: artifact.series.rows.map((row) => `Row ${row}`),
        marker: { color: "#1677b8", size: 7, opacity: 0.72 },
        hovertemplate: "%{x}, %{y}<br>%{text}<extra></extra>"
      }],
      layout: {
        ...base,
        xaxis: {
          type: "category",
          categoryorder: "array",
          categoryarray: artifact.summary.groups.map((group) => escapePlotlyText(group.label)),
          title: { text: escapePlotlyText(spec.x) },
          automargin: true
        },
        yaxis: { title: { text: escapePlotlyText(spec.y) }, automargin: true }
      }
    };
  }
  return {
    traces: [{
      type: "scatter",
      mode: "markers",
      x: artifact.series.x,
      y: artifact.series.y,
      text: artifact.series.rows.map((row) => `Row ${row}`),
      marker: { color: "#1677b8", size: 7, opacity: 0.72 },
      hovertemplate: "%{x}, %{y}<br>%{text}<extra></extra>"
    }],
    layout: { ...base, xaxis: { title: { text: escapePlotlyText(spec.x) }, automargin: true }, yaxis: { title: { text: escapePlotlyText(spec.y) }, automargin: true } }
  };
}

function isInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function validSummary(summary) {
  return summary && isInteger(summary.row_count) && isInteger(summary.used_rows) && isInteger(summary.excluded_rows) && stringArray(summary.columns);
}

function validGroupLabel(label) {
  return typeof label === "string" && Array.from(label).length >= 1 && Array.from(label).length <= 200 &&
    label.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(label);
}

function validGroupedPoints(artifact) {
  const { summary, series, spec } = artifact;
  if (artifact.kind !== "grouped_points" || artifact.analysis_id !== null || !spec || Array.isArray(spec) ||
    spec.kind !== artifact.kind || spec.title !== artifact.title || spec.analysis_id !== null || spec.bins !== null ||
    !exactKeys(summary, ["row_count", "columns", "groups", "missing_group_only", "missing_value_only", "missing_both", "used_rows", "excluded_rows"]) ||
    !exactKeys(series, ["x", "y", "rows"]) || !validSummary(summary) || summary.row_count > 50000 ||
    summary.columns.length !== 2 || summary.columns[0] !== spec.x || summary.columns[1] !== spec.y || spec.x === spec.y) return false;
  const missing = [summary.missing_group_only, summary.missing_value_only, summary.missing_both];
  if (!missing.every((value) => isInteger(value)) || summary.excluded_rows !== missing.reduce((total, value) => total + value, 0) ||
    summary.row_count !== summary.used_rows + summary.excluded_rows) return false;
  if (!Array.isArray(series.x) || !Array.isArray(series.y) || !Array.isArray(series.rows) || series.x.length < 2 || series.x.length > 50000 ||
    series.y.length !== series.x.length || series.rows.length !== series.x.length || summary.used_rows !== series.x.length ||
    !series.x.every(validGroupLabel) || !series.y.every(Number.isFinite) ||
    !series.rows.every((row, index) => isInteger(row, 1) && row <= summary.row_count && (index === 0 || row > series.rows[index - 1]))) return false;
  if (!Array.isArray(summary.groups) || summary.groups.length !== 2 || summary.groups.some((group) => !exactKeys(group, ["label", "count"]) ||
    !validGroupLabel(group.label) || !isInteger(group.count, 1))) return false;
  const firstSeen = [];
  const counts = new Map();
  for (const label of series.x) {
    if (!counts.has(label)) firstSeen.push(label);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return firstSeen.length === 2 && summary.groups.every((group, index) => group.label === firstSeen[index] && group.count === counts.get(group.label));
}

function validSeries(artifact) {
  const series = artifact.series;
  if (!series || typeof series !== "object") return false;
  if (artifact.kind === "analysis_counts") {
    return stringArray(series.columns) && series.columns.length > 0 && series.columns.length <= 50 &&
      Array.isArray(series.valid) && Array.isArray(series.missing) &&
      series.valid.length === series.columns.length && series.missing.length === series.columns.length &&
      [...series.valid, ...series.missing].every((value) => isInteger(value));
  }
  if (artifact.kind === "histogram") {
    return stringArray(series.labels) && series.labels.length > 0 && series.labels.length <= 50 &&
      stringArray(series.lower) && stringArray(series.upper) && Array.isArray(series.counts) &&
      series.lower.length === series.labels.length && series.upper.length === series.labels.length && series.counts.length === series.labels.length &&
      series.counts.every((value) => isInteger(value));
  }
  if (artifact.kind === "scatter") {
    return Array.isArray(series.x) && Array.isArray(series.y) && Array.isArray(series.rows) && series.x.length > 0 &&
      series.x.length <= 50000 && series.y.length === series.x.length && series.rows.length === series.x.length &&
      series.x.every(Number.isFinite) && series.y.every(Number.isFinite) && series.rows.every((value) => isInteger(value, 1));
  }
  if (artifact.kind === "grouped_points") return validGroupedPoints(artifact);
  return false;
}

function sameValue(left, right) {
  const fields = ["kind", "title", "analysis_id", "x", "y", "bins"];
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return false;
  if (Object.keys(left).length !== fields.length || Object.keys(right).length !== fields.length) return false;
  return fields.every((field) => {
    if (!Object.hasOwn(left, field) || !Object.hasOwn(right, field)) return false;
    const leftValue = left[field];
    const rightValue = right[field];
    const primitive = (value) => value === null || ["string", "number", "boolean"].includes(typeof value);
    return primitive(leftValue) && primitive(rightValue) && leftValue === rightValue;
  });
}

function validateArtifact(artifact, expected) {
  if (!artifact || artifact.format !== "research-chart/v1" || !expected) return false;
  const kind = expected.kind || expected.spec?.kind;
  const title = expected.title || expected.spec?.title;
  const spec = expected.spec || { kind, title, analysis_id: expected.analysis_id ?? null, x: expected.x ?? null, y: expected.y ?? null, bins: expected.bins ?? null };
  const recipeHash = expected.recipe_sha256 || expected.recipe?.sha256;
  const rendererHash = expected.renderer_sha256 || expected.renderer?.sha256;
  return artifact.document_id === expected.document_id && artifact.dataset_id === expected.dataset_id &&
    artifact.dataset_sha256 === expected.dataset_sha256 && artifact.analysis_id === (expected.analysis_id ?? null) &&
    artifact.kind === kind && artifact.title === title && sameValue(artifact.spec, spec) &&
    artifact.recipe_sha256 === recipeHash && artifact.renderer_sha256 === rendererHash &&
    validSummary(artifact.summary) && validSeries(artifact) && chartSkillsMatch(artifact, expected);
}

async function readBoundedJson(response, record) {
  const mime = String(response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  const suppliedHash = String(response.headers.get("X-Content-Sha256") || "").toLowerCase();
  const contentLength = response.headers.get("Content-Length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (mime !== "application/json" || !HEX_64.test(suppliedHash) || suppliedHash !== record.data_sha256 ||
    (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength !== record.data_byte_size)) ||
    !isInteger(record.data_byte_size, 1) || record.data_byte_size > MAX_ARTIFACT_BYTES) {
    throw new Error("invalidArtifact");
  }
  const chunks = [];
  let size = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARTIFACT_BYTES || size > record.data_byte_size) {
        await reader.cancel();
        throw new Error("invalidArtifact");
      }
      chunks.push(value);
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    size = buffer.byteLength;
    chunks.push(buffer);
  }
  if (size !== record.data_byte_size) throw new Error("invalidArtifact");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (hash !== record.data_sha256) throw new Error("invalidArtifact");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("invalidArtifact");
  }
}

let rendererPromise = null;
let rendererHash = null;

function loadRenderer(renderer) {
  if (!isChartRenderer(renderer)) {
    return Promise.reject(new Error("invalidCapabilities"));
  }
  if (rendererPromise && rendererHash === renderer.sha256) return rendererPromise;
  rendererHash = renderer.sha256;
  rendererPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHART_RENDERER_URL;
    script.async = true;
    const bytes = Uint8Array.from(renderer.sha256.match(/.{2}/g), (pair) => parseInt(pair, 16));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    script.integrity = `sha256-${btoa(binary)}`;
    script.dataset.chartRenderer = renderer.sha256;
    script.addEventListener("load", () => {
      if (window.Plotly) resolve(window.Plotly);
      else {
        script.remove();
        rendererPromise = null;
        reject(new Error("renderFailed"));
      }
    }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      rendererPromise = null;
      reject(new Error("renderFailed"));
    }, { once: true });
    document.head.append(script);
  });
  return rendererPromise;
}

export function createCharts(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    panel: byId("charts-panel"),
    draftLabel: byId("chart-draft-label"),
    viewContext: byId("chart-view-context"),
    dataset: byId("chart-dataset"),
    analysis: byId("chart-analysis"),
    kind: byId("chart-kind"),
    title: byId("chart-title"),
    x: byId("chart-x"),
    y: byId("chart-y"),
    bins: byId("chart-bins"),
    preview: byId("chart-preview"),
    save: byId("chart-save"),
    cancel: byId("chart-cancel"),
    status: byId("chart-status"),
    list: byId("charts-list"),
    deleted: byId("charts-deleted"),
    deletedList: byId("charts-deleted-list"),
    plot: byId("chart-plot"),
    summary: byId("chart-summary"),
    details: byId("chart-details"),
    style: byId("chart-style"),
    styleLabel: byId("chart-style-label"),
    styleNote: byId("chart-style-note"),
    png: byId("chart-png"),
    svg: byId("chart-svg")
  };
  const papers = new Map();
  let currentId = null;
  let language = adapter.getLanguage();
  let styleId = "default";
  try {
    const stored = localStorage.getItem("research-chart-style");
    if (window.ResearchChartStyles?.ids.includes(stored)) styleId = stored;
  } catch {
    // The default visual preset still applies when storage is unavailable.
  }
  let capabilitiesPromise = null;
  let skillSupport = false;
  let resizeObserver = null;
  let plotHost = null;
  let plotView = null;

  function t(key, values = {}) {
    let text = messages[language][key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function entryFor(documentId) {
    if (!papers.has(documentId)) {
      papers.set(documentId, {
        charts: [],
        datasets: [],
        jobs: [],
        draft: null,
        activeChartId: null,
        view: null,
        status: null,
        loadSequence: 0,
        openSequence: 0,
        loadController: null,
        ready: null,
        exporting: new Set(),
        lifecycle: new Map(),
        failedLifecycle: new Map(),
        proposalPreviews: new Map()
      });
    }
    return papers.get(documentId);
  }

  function currentEntry() {
    return currentId ? entryFor(currentId) : null;
  }

  function selectedDataset(entry, datasetId = entry?.draft?.datasetId) {
    return entry?.datasets.find((item) => item.id === datasetId) || null;
  }

  function isDescriptiveJob(job) {
    return (!job.method || job.method === "describe") && (!job.recipe?.id || job.recipe.id === "describe-v1");
  }

  function selectedJob(entry) {
    return entry?.jobs.find((job) => job.id === entry.draft?.analysisId && job.dataset_id === entry.draft.datasetId && job.status === "succeeded" && isDescriptiveJob(job)) || null;
  }

  function allColumns(entry) {
    return (selectedDataset(entry)?.columns || []).map((column) => column.name);
  }

  function numericColumns(entry) {
    return (selectedDataset(entry)?.columns || []).filter((column) => column.numeric).map((column) => column.name);
  }

  function syncFields(entry, draft, reset = false) {
    const numeric = numericColumns(entry);
    const xColumns = draft.kind === "grouped_points" ? allColumns(entry) : numeric;
    draft.x = !reset && xColumns.includes(draft.x) ? draft.x : xColumns[0] || "";
    draft.y = !reset && numeric.includes(draft.y) && draft.y !== draft.x ? draft.y : numeric.find((name) => name !== draft.x) || "";
  }

  function ensureDraft(entry) {
    if (!entry.draft) {
      const selectedId = adapter.getSelectedDatasetId?.();
      const dataset = entry.datasets.find((item) => item.id === selectedId) || entry.datasets[0] || null;
      const numeric = (dataset?.columns || []).filter((column) => column.numeric).map((column) => column.name);
      entry.draft = {
        datasetId: dataset?.id || null,
        analysisId: null,
        kind: "histogram",
        title: "",
        x: numeric[0] || "",
        y: numeric[1] || "",
        bins: 20,
        skillSnapshot: null,
        version: 0,
        previewOperation: null,
        saveOperation: null,
        pendingPreview: false,
        pendingSave: false,
        saveFailed: false,
        status: null
      };
    }
    return entry.draft;
  }

  function syncDataset(documentId, datasetId, analysisId = null) {
    if (currentId !== documentId || !datasetId) return;
    const entry = currentEntry();
    const draft = ensureDraft(entry);
    if (draft.pendingPreview || draft.pendingSave || draft.saveFailed) return;
    if (draft.datasetId === datasetId && (!analysisId || draft.analysisId === analysisId)) return;
    invalidateDraft(draft, false);
    draft.datasetId = datasetId;
    syncFields(entry, draft);
    draft.analysisId = entry.jobs.find((job) => job.id === analysisId && job.dataset_id === datasetId && job.status === "succeeded" && isDescriptiveJob(job))?.id ||
      entry.jobs.find((job) => job.dataset_id === datasetId && job.status === "succeeded" && isDescriptiveJob(job))?.id || null;
    render();
  }

  function invalidateDraft(draft, invalidateOpen = true) {
    const entry = currentEntry();
    if (invalidateOpen && entry?.draft === draft) entry.openSequence += 1;
    draft.version += 1;
    draft.previewOperation?.controller?.abort();
    draft.previewOperation = null;
    if (!draft.pendingSave) draft.saveOperation = null;
    draft.saveFailed = false;
    draft.status = null;
    if (entry?.draft === draft && entry.view?.kind === "preview") {
      entry.view = null;
      purgePlot();
      renderArtifactDetails(null);
    }
  }

  function draftBody(entry, capabilities) {
    const draft = entry.draft;
    const dataset = selectedDataset(entry);
    const recipe = capabilities?.items?.find((item) => item.id === draft.kind);
    if (!dataset || !recipe || !capabilities.renderer) throw new Error("validation_error");
    const title = draft.title.trim();
    if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) throw new Error("validation_error");
    if (draft.kind === "analysis_counts" && !selectedJob(entry)) throw new Error("chooseAnalysis");
    if (["histogram", "scatter"].includes(draft.kind) && !numericColumns(entry).includes(draft.x)) throw new Error("chooseFields");
    if (draft.kind === "scatter" && (!numericColumns(entry).includes(draft.y) || draft.x === draft.y)) throw new Error("chooseFields");
    if (draft.kind === "grouped_points" && (!allColumns(entry).includes(draft.x) || !numericColumns(entry).includes(draft.y) || draft.x === draft.y)) throw new Error("chooseGroupedFields");
    if (draft.kind === "histogram" && (!Number.isInteger(draft.bins) || draft.bins < 2 || draft.bins > 50)) throw new Error("validation_error");
    return {
      request_id: draft.saveOperation?.body.request_id || draft.previewOperation?.body.request_id || crypto.randomUUID(),
      dataset_id: dataset.id,
      dataset_sha256: dataset.sha256,
      kind: draft.kind,
      title,
      analysis_id: draft.kind === "analysis_counts" ? draft.analysisId : null,
      x: ["histogram", "scatter", "grouped_points"].includes(draft.kind) ? draft.x : null,
      y: ["scatter", "grouped_points"].includes(draft.kind) ? draft.y : null,
      bins: draft.kind === "histogram" ? draft.bins : null,
      recipe_sha256: recipe.recipe_sha256,
      renderer_sha256: capabilities.renderer.sha256,
      ...(draft.skillSnapshot ? { skill: chartSkillReference(draft) } : {})
    };
  }

  function getCapabilities() {
    if (!capabilitiesPromise) {
      capabilitiesPromise = adapter.api("/api/v1/charts/capabilities").then((body) => {
        if (!body || body.arbitrary_code !== false || !Array.isArray(body.items) || body.limits?.data_bytes !== MAX_ARTIFACT_BYTES ||
          !isChartRenderer(body.renderer) ||
          !["analysis_counts", "histogram", "scatter", "grouped_points"].every((kind) => body.items.some((item) => item.id === kind && HEX_64.test(item.recipe_sha256 || "")))) {
          throw new Error("invalidCapabilities");
        }
        skillSupport = body.custom_skills === true;
        adapter.skillsChanged?.();
        return body;
      }).catch((error) => {
        capabilitiesPromise = null;
        throw error;
      });
    }
    return capabilitiesPromise;
  }

  function chartWorkspaceVisible() {
    return elements.panel.open && !elements.panel.hidden && elements.panel.getClientRects().length > 0;
  }

  function errorStatus(error, fallback = "request_failed", retry = null) {
    return { key: error?.code || error?.message || fallback, kind: "error", retry };
  }

  function renderStatus(entry) {
    elements.status.replaceChildren();
    const status = entry?.draft?.status || entry?.status;
    if (!status) return;
    elements.status.dataset.kind = status.kind || "info";
    const known = Object.hasOwn(messages[language], status.key) || Object.hasOwn(messages.en, status.key);
    elements.status.append(make("span", "", known ? t(status.key, status.values || {}) : t("request_failed")));
    if (status.retry) {
      const button = make("button", "status-retry", t("retrySave"));
      button.type = "button";
      button.addEventListener("click", status.retry);
      elements.status.append(button);
    }
  }

  function fillSelect(select, items, value, placeholder = null) {
    select.replaceChildren();
    if (placeholder) {
      const option = make("option", "", placeholder);
      option.value = "";
      select.append(option);
    }
    for (const item of items) {
      const option = make("option", "", item.label);
      option.value = item.value;
      select.append(option);
    }
    select.value = value || "";
  }

  function renderForm(entry) {
    const draft = entry ? ensureDraft(entry) : null;
    const locked = !draft || draft.pendingPreview || draft.pendingSave || draft.saveFailed;
    fillSelect(elements.dataset, (entry?.datasets || []).map((dataset) => ({ value: dataset.id, label: dataset.original_filename })), draft?.datasetId, entry?.datasets.length ? null : t("noDataset"));
    const jobs = (entry?.jobs || []).filter((job) => job.dataset_id === draft?.datasetId && job.status === "succeeded" && isDescriptiveJob(job));
    fillSelect(elements.analysis, jobs.map((job) => ({ value: job.id, label: `${job.dataset_name} · ${job.engine} · ${String(job.created_at || "").slice(0, 19)}` })), draft?.analysisId, t("noAnalysis"));
    fillSelect(elements.kind, ["analysis_counts", "histogram", "scatter", "grouped_points"].map((kind) => ({ value: kind, label: t(kind) })), draft?.kind);
    const numeric = numericColumns(entry);
    const grouped = draft?.kind === "grouped_points";
    fillSelect(elements.x, (grouped ? allColumns(entry) : numeric).map((name) => ({ value: name, label: name })), draft?.x);
    fillSelect(elements.y, numeric.map((name) => ({ value: name, label: name })), draft?.y);
    const xLabel = document.querySelector('label[for="chart-x"] .chart-field-label');
    const yLabel = document.querySelector('label[for="chart-y"] .chart-field-label');
    if (xLabel) xLabel.textContent = t(grouped ? "groupColumn" : "x");
    if (yLabel) yLabel.textContent = t(grouped ? "outcomeColumn" : "y");
    if (elements.title.value !== (draft?.title || "")) elements.title.value = draft?.title || "";
    elements.bins.value = String(draft?.bins || 20);
    for (const control of [elements.dataset, elements.analysis, elements.kind, elements.title, elements.x, elements.y, elements.bins]) control.disabled = locked;
    if (draft?.skillSnapshot) { elements.kind.disabled = true; elements.bins.disabled = true; }
    elements.analysis.hidden = draft?.kind !== "analysis_counts";
    elements.analysis.labels?.[0] && (elements.analysis.labels[0].hidden = elements.analysis.hidden);
    elements.x.hidden = draft?.kind === "analysis_counts";
    elements.x.labels?.[0] && (elements.x.labels[0].hidden = elements.x.hidden);
    elements.y.hidden = !["scatter", "grouped_points"].includes(draft?.kind);
    elements.y.labels?.[0] && (elements.y.labels[0].hidden = elements.y.hidden);
    elements.bins.hidden = draft?.kind !== "histogram";
    elements.bins.labels?.[0] && (elements.bins.labels[0].hidden = elements.bins.hidden);
    elements.preview.disabled = locked || !selectedDataset(entry);
    elements.preview.textContent = t(draft?.pendingPreview ? "previewing" : "preview");
    elements.save.disabled = !draft || draft.pendingPreview || draft.pendingSave || !draft.previewOperation?.artifact ||
      entry.view !== draft.previewOperation?.view || !draft.previewOperation?.renderReady;
    elements.save.textContent = t(draft?.pendingSave ? "saving" : draft?.saveFailed ? "retrySave" : "save");
    elements.cancel.disabled = !draft || draft.pendingSave || (!draft.previewOperation && !draft.saveFailed && !draft.status);
  }

  function chartButton(action, label, handler, disabled = false, primary = false) {
    const button = make("button", `button ${primary ? "button-secondary" : "button-quiet"}`, label);
    button.type = "button";
    button.dataset.action = action;
    button.disabled = disabled;
    button.addEventListener("click", handler);
    return button;
  }

  function renderChartItem(entry, chart) {
    const item = make("li", "chart-item");
    item.dataset.chartId = chart.id;
    const heading = make("div", "chart-item-heading");
    const open = chartButton("open-chart", chart.title, () => openChart(currentId, chart.id), Boolean(chart.deleted_at));
    heading.append(open, make("span", "chart-item-kind", t(chart.kind)));
    item.append(heading, make("p", "chart-item-source", chart.dataset_name));
    const actions = make("div", "chart-item-actions");
    const pending = entry.lifecycle.has(chart.id);
    const exporting = entry.exporting.has(chart.id);
    if (chart.deleted_at) {
      actions.append(chartButton("restore-chart", t(pending ? "restoring" : "restore"), () => mutateLifecycle(entry, chart, "restore"), pending));
    } else {
      actions.append(
        chartButton("export-chart", t(exporting ? "exporting" : "export"), () => exportChart(entry, chart), exporting || !chartSkillAllows(chart.skill_snapshot, "offline")),
        chartButton("clone-chart", t("clone"), () => cloneChart(entry, chart), pending),
        chartButton("chart-note", t("note"), () => citeChart(entry, chart), pending),
        chartButton("delete-chart", t(pending ? "deleting" : "delete"), () => mutateLifecycle(entry, chart, "delete"), pending)
      );
    }
    item.append(actions);
    const failed = entry.failedLifecycle.get(chart.id);
    if (failed) item.append(make("p", "chart-item-error", t(failed.conflicted ? "revision_conflict" : "lifecycleRetry")));
    return item;
  }

  function renderLists(entry) {
    elements.list.replaceChildren();
    elements.deletedList.replaceChildren();
    const active = (entry?.charts || []).filter((chart) => !chart.deleted_at);
    const deleted = (entry?.charts || []).filter((chart) => chart.deleted_at);
    for (const chart of active) elements.list.append(renderChartItem(entry, chart));
    if (!active.length) elements.list.append(make("li", "chart-empty", t("empty")));
    elements.deleted.hidden = !deleted.length;
    for (const chart of deleted) elements.deletedList.append(renderChartItem(entry, chart));
  }

  function renderViewContext(entry) {
    const view = entry?.view;
    if (!view?.artifact) {
      elements.viewContext.hidden = true;
      elements.viewContext.textContent = "";
      return;
    }
    const key = view.kind === "saved" ? "savedChartContext" : view.origin === "assistant" ? "assistantPreviewContext" : "draftPreviewContext";
    elements.viewContext.hidden = false;
    elements.viewContext.textContent = t(key, { kind: t(view.artifact.kind) });
  }

  function render() {
    const entry = currentEntry();
    renderForm(entry);
    renderStatus(entry);
    renderLists(entry);
    renderViewContext(entry);
    const unavailable = !entry?.view?.renderReady || entry.view.pending || !entry.view.host?.isConnected;
    elements.style.value = styleId;
    const snapshot = entry?.view?.artifact?.skill_snapshot;
    elements.style.disabled = !entry?.view?.artifact || Boolean(entry.view.pending) || Boolean(snapshot);
    elements.styleNote.textContent = snapshot ? t("skillSnapshot", { name: snapshot.spec.name, revision: snapshot.revision }) : t("styleNote");
    elements.png.disabled = unavailable || !chartSkillAllows(snapshot, "png");
    elements.svg.disabled = unavailable || !chartSkillAllows(snapshot, "svg");
    adapter.skillsChanged?.();
    adapter.teachingChanged?.();
  }

  function appendField(list, label, value) {
    list.append(make("dt", "", label), make("dd", "", value ?? "—"));
  }

  function renderArtifactDetails(view) {
    elements.summary.replaceChildren();
    elements.details.replaceChildren();
    if (!view?.artifact) return;
    const artifact = view.artifact;
    elements.summary.append(make("h3", "", t("summary")));
    const summary = make("dl", "chart-summary-list");
    appendField(summary, t("rows"), artifact.summary.row_count);
    appendField(summary, t("used"), artifact.summary.used_rows);
    appendField(summary, t("excluded"), artifact.summary.excluded_rows);
    if (artifact.kind === "grouped_points") {
      appendField(summary, t("groups"), artifact.summary.groups.map((group) => `${group.label}: ${group.count}`).join(" · "));
      appendField(summary, t("missingGroupOnly"), artifact.summary.missing_group_only);
      appendField(summary, t("missingValueOnly"), artifact.summary.missing_value_only);
      appendField(summary, t("missingBoth"), artifact.summary.missing_both);
    }
    appendField(summary, t("columns"), artifact.summary.columns.join(", "));
    elements.summary.append(summary);
    if (artifact.kind === "grouped_points") elements.summary.append(make("p", "charts-help", t("groupOverlap")));
    elements.details.append(make("h3", "", t("details")), make("p", view.kind === "preview" ? "chart-badge chart-badge-preview" : "chart-badge", t(view.kind === "preview" ? "previewBadge" : "savedBadge")));
    const details = make("dl", "chart-details-list");
    appendField(details, t("source"), view.record?.dataset_name || selectedDataset(entryFor(artifact.document_id))?.original_filename || artifact.dataset_id);
    appendField(details, t("chartKind"), t(artifact.kind));
    appendField(details, t("renderer"), `Plotly strict 4.2.0`);
    appendField(details, t("recipe"), artifact.recipe_sha256);
    appendField(details, t("dataHash"), artifact.dataset_sha256);
    elements.details.append(details);
  }

  function purgePlot() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    const host = plotHost;
    const view = plotView;
    plotHost = null;
    plotView = null;
    if (view) {
      view.pending = false;
      view.renderReady = false;
      if (view.host === host) view.host = null;
    }
    if (window.Plotly && host) {
      try { window.Plotly.purge(host); } catch { /* Already detached. */ }
    }
    elements.plot.replaceChildren();
  }

  async function displayArtifact(entry, view) {
    const documentId = view?.artifact?.document_id;
    if (!entry || entry.view !== view || entry !== currentEntry() || currentId !== documentId) return false;
    view.sequence = (view.sequence || 0) + 1;
    const sequence = view.sequence;
    purgePlot();
    view.pending = true;
    view.renderReady = false;
    if (view.operation) view.operation.renderReady = false;
    const host = make("div", "chart-render-host");
    view.host = host;
    plotHost = host;
    plotView = view;
    elements.plot.append(host);
    const isCurrentRender = () => entry.view === view && view.sequence === sequence && entry === currentEntry() &&
      currentId === documentId && plotHost === host && plotView === view && host.isConnected;
    renderArtifactDetails(view);
    entry.status = { key: "rendering", kind: "info" };
    render();
    const deferHiddenRender = () => {
      view.pending = false;
      view.renderReady = false;
      entry.status = null;
      render();
      return false;
    };
    if (!host.clientWidth) return deferHiddenRender();
    try {
      const Plotly = await loadRenderer(view.renderer);
      if (!isCurrentRender()) return false;
      if (!host.clientWidth) return deferHiddenRender();
      const figure = figureFor(view.artifact, { valid: language === "zh" ? "非缺失" : "Valid", missing: language === "zh" ? "缺失" : "Missing", rows: t("rows") });
      if (!window.ResearchChartStyles?.apply) throw new Error("renderFailed");
      const snapshot = view.artifact.skill_snapshot;
      const styled = window.ResearchChartStyles.apply(figure, snapshot || styleId, host.clientWidth);
      await Plotly.react(host, styled.traces, styled.layout, {
        responsive: true,
        displaylogo: false,
        scrollZoom: true,
        showTips: false,
        modeBarButtonsToRemove: snapshot && !chartSkillAllows(snapshot, "png") ? ["toImage"] : [],
        toImageButtonOptions: { format: "png", filename: "research-chart", ...(!snapshot || chartSkillAllows(snapshot, "png") ? chartSkillImageOptions(snapshot, "png") : { scale: 2 }) }
      });
      if (!isCurrentRender()) {
        try { Plotly.purge(host); } catch { /* Already detached. */ }
        host.remove();
        return false;
      }
      resizeObserver = new ResizeObserver(() => {
        if (!isCurrentRender() || !host.clientWidth) return;
        if (!snapshot) { Plotly.Plots.resize(host); return; }
        const fit = window.ResearchChartStyles.apply(figure, snapshot, host.clientWidth).layout;
        Plotly.relayout(host, { width: fit.width, height: fit.height });
      });
      resizeObserver.observe(host);
      view.pending = false;
      view.renderReady = true;
      if (view.operation) view.operation.renderReady = true;
      entry.status = view.kind === "preview" ? { key: "previewReady", kind: "success" } : null;
      render();
      return true;
    } catch (error) {
      if (!isCurrentRender()) {
        host.remove();
        return false;
      }
      purgePlot();
      entry.status = errorStatus(error, "renderFailed", () => displayArtifact(entry, view));
      render();
      return false;
    }
  }

  async function preview(entry) {
    const draft = entry?.draft;
    if (!draft || draft.pendingPreview || draft.pendingSave || draft.saveFailed) return;
    const documentId = entry === currentEntry() ? currentId : null;
    if (!documentId) return;
    const version = draft.version;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const sequence = ++entry.openSequence;
    const isCurrent = () => entry.draft === draft && draft.version === version && currentId === documentId && sequence === entry.openSequence && navigationGeneration === adapter.getNavigationGeneration?.();
    let body;
    let capabilities;
    const previewStatus = { key: "previewing", kind: "info" };
    const clearStatus = () => {
      if (draft.status === previewStatus) draft.status = null;
    };
    draft.status = previewStatus;
    render();
    try {
      capabilities = await getCapabilities();
      if (!isCurrent()) {
        clearStatus();
        if (entry === currentEntry()) render();
        return;
      }
      body = draftBody(entry, capabilities);
    } catch (error) {
      if (!isCurrent()) {
        clearStatus();
        if (entry === currentEntry()) render();
        return;
      }
      draft.status = errorStatus(error, "previewFailed");
      if (entry === currentEntry()) render();
      return;
    }
    const operation = { body, version, controller: new AbortController(), artifact: null, descriptor: null, renderer: capabilities.renderer, view: null, renderReady: false };
    const clearAbandoned = () => {
      if (draft.previewOperation === operation) draft.previewOperation = null;
      clearStatus();
    };
    draft.previewOperation = operation;
    draft.saveOperation = null;
    draft.pendingPreview = true;
    try {
      const response = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/charts/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: operation.controller.signal
      });
      if (!isCurrent() || draft.previewOperation !== operation) {
        clearAbandoned();
        return;
      }
      if (!response?.chart || response.chart.id !== body.request_id || response.chart.origin !== "preview" || response.chart.revision !== 0 ||
        !validateArtifact(response.data, { ...body, document_id: documentId, skill_snapshot: draft.skillSnapshot || undefined }) ||
        !chartSkillsMatch(response.data, response.chart)) throw new Error("invalidArtifact");
      operation.artifact = response.data;
      operation.descriptor = response.chart;
      const view = { kind: "preview", origin: "draft", artifact: response.data, record: response.chart, renderer: capabilities.renderer, pending: true, renderReady: false, host: null, operation };
      operation.view = view;
      entry.view = view;
      entry.activeChartId = null;
      adapter.contextChanged?.();
      draft.status = null;
      await displayArtifact(entry, view);
    } catch (error) {
      if (error?.name === "AbortError" || draft.previewOperation !== operation || !isCurrent()) {
        clearAbandoned();
        return;
      }
      draft.previewOperation = null;
      draft.status = errorStatus(error, "previewFailed");
    } finally {
      draft.pendingPreview = false;
      if (entry === currentEntry()) render();
    }
  }

  async function save(entry) {
    const draft = entry?.draft;
    const previewOperation = draft?.previewOperation;
    if (!draft || !previewOperation?.artifact || draft.pendingSave || draft.pendingPreview ||
      entry.view !== previewOperation.view || !previewOperation.renderReady) return;
    if (!draft.saveOperation) draft.saveOperation = { body: { ...previewOperation.body } };
    const operation = draft.saveOperation;
    const documentId = entry === currentEntry() ? currentId : null;
    if (!documentId) return;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const sequence = entry.openSequence;
    const view = previewOperation.view;
    draft.pendingSave = true;
    draft.saveFailed = false;
    draft.status = { key: "saving", kind: "info" };
    render();
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}/charts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      if (![200, 201].includes(response.status)) throw new Error("request_failed");
      const chart = await response.json();
      if (!chart || chart.id !== operation.body.request_id || chart.document_id !== documentId || chart.deleted_at ||
        !validateArtifact(previewOperation.artifact, chart)) throw new Error("request_failed");
      entry.charts = [chart, ...entry.charts.filter((item) => item.id !== chart.id)];
      adapter.sourcesChanged?.(documentId);
      if (currentId === documentId && entry.view === view && entry.draft === draft && draft.saveOperation === operation && sequence === entry.openSequence && navigationGeneration === adapter.getNavigationGeneration?.()) {
        entry.activeChartId = chart.id;
        view.kind = "saved";
        view.record = chart;
        view.renderer = previewOperation.renderer;
        entry.view = view;
        entry.status = { key: "saved", kind: "success" };
        entry.draft = null;
        adapter.contextChanged?.();
        adapter.chartOpened?.(documentId, chart.id);
        renderArtifactDetails(entry.view);
        render();
      } else {
        draft.status = { key: "saved", kind: "success" };
        if (sequence === entry.openSequence && entry.status?.key === "saving") entry.status = null;
      }
    } catch (error) {
      draft.pendingSave = false;
      draft.saveFailed = true;
      draft.status = { ...errorStatus(error, "saveRetry"), key: error?.code && Object.hasOwn(messages.en, error.code) ? error.code : "saveRetry", retry: () => save(entry) };
      if (entry === currentEntry()) render();
      return;
    }
    draft.pendingSave = false;
    if (entry === currentEntry()) render();
  }

  function cancelDraft(entry) {
    const draft = entry?.draft;
    if (!draft || draft.pendingSave) return;
    entry.openSequence += 1;
    draft.previewOperation?.controller?.abort();
    entry.draft = null;
    ensureDraft(entry);
    if (entry.view?.kind === "preview") {
      entry.view = null;
      purgePlot();
      renderArtifactDetails(null);
    }
    entry.status = null;
    adapter.contextChanged?.();
    render();
    elements.preview.focus();
  }

  async function reload(documentId) {
    const previous = currentId;
    currentId = documentId || null;
    if (previous !== currentId) purgePlot();
    const entry = currentEntry();
    if (!entry) {
      render();
      renderArtifactDetails(null);
      return;
    }
    if (previous !== currentId) entry.openSequence += 1;
    entry.loadController?.abort();
    const controller = new AbortController();
    entry.loadController = controller;
    const sequence = ++entry.loadSequence;
    entry.status = { key: "loading", kind: "info" };
    render();
    const base = `/api/v1/documents/${encodeURIComponent(documentId)}`;
    entry.ready = Promise.allSettled([
      getCapabilities(),
      adapter.api(`${base}/charts`, { signal: controller.signal }),
      adapter.api(`${base}/datasets`, { signal: controller.signal }),
      adapter.api(`${base}/analyses`, { signal: controller.signal })
    ]).then(([capabilities, charts, datasets, jobs]) => {
      if (sequence !== entry.loadSequence || entry !== currentEntry()) return;
      if (charts.status === "fulfilled") entry.charts = Array.isArray(charts.value.items) ? charts.value.items : [];
      if (datasets.status === "fulfilled") {
        entry.datasets = Array.isArray(datasets.value.items) ? datasets.value.items : [];
        ensureDraft(entry);
      }
      if (jobs.status === "fulfilled") entry.jobs = Array.isArray(jobs.value.items) ? jobs.value.items : [];
      const failure = [capabilities, charts, datasets, jobs].find((result) => result.status === "rejected" && result.reason?.name !== "AbortError");
      entry.status = failure ? errorStatus(failure.reason, "loadFailed", () => reload(documentId)) : null;
      entry.loadController = null;
      render();
    });
    return entry.ready;
  }

  async function openChart(documentId, chartId, options = {}) {
    if (!documentId || !chartId || currentId !== documentId) return;
    const entry = entryFor(documentId);
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const sequence = ++entry.openSequence;
    const isCurrent = () => currentId === documentId && sequence === entry.openSequence && navigationGeneration === adapter.getNavigationGeneration?.();
    await entry.ready;
    if (!isCurrent()) return;
    let chart = entry.charts.find((item) => item.id === chartId);
    try {
      if (!chart) chart = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/charts/${encodeURIComponent(chartId)}`);
      if (!isCurrent()) return;
      if (chart.document_id !== documentId || chart.deleted_at) throw new Error("chart_deleted");
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}/charts/${encodeURIComponent(chartId)}/data`);
      const artifact = await readBoundedJson(response, chart);
      if (!isCurrent()) return;
      if (!validateArtifact(artifact, chart)) throw new Error("invalidArtifact");
      entry.charts = [chart, ...entry.charts.filter((item) => item.id !== chart.id)];
      entry.activeChartId = chart.id;
      const view = { kind: "saved", artifact, record: chart, renderer: chart.renderer, pending: true, renderReady: false, host: null };
      entry.view = view;
      entry.status = null;
      syncDataset(documentId, chart.dataset_id, chart.analysis_id);
      adapter.datasetContextChanged?.(documentId, chart.dataset_id, chart.analysis_id);
      adapter.contextChanged?.();
      if (!options.preserveUrl) adapter.chartOpened?.(documentId, chart.id);
      elements.panel.open = true;
      render();
      await displayArtifact(entry, view);
    } catch (error) {
      if (!isCurrent()) return;
      entry.status = errorStatus(error, "loadFailed", () => openChart(documentId, chartId));
      render();
    }
  }

  function cloneChart(entry, chart) {
    if (!entry || chart.deleted_at) return;
    entry.openSequence += 1;
    invalidateDraft(ensureDraft(entry));
    entry.draft = {
      datasetId: chart.dataset_id,
      analysisId: chart.analysis_id,
      kind: chart.kind,
      title: chart.title,
      x: chart.spec.x || "",
      y: chart.spec.y || "",
      bins: chart.spec.bins || 20,
      skillSnapshot: frozenChartSkill(chart.skill_snapshot),
      version: 0,
      previewOperation: null,
      saveOperation: null,
      pendingPreview: false,
      pendingSave: false,
      saveFailed: false,
      status: null
    };
    entry.view = null;
    entry.activeChartId = null;
    purgePlot();
    renderArtifactDetails(null);
    adapter.contextChanged?.();
    render();
    elements.title.focus();
  }

  async function citeChart(entry, chart) {
    if (!entry || chart.deleted_at) return;
    const added = await adapter.addChartCitation?.(entry === currentEntry() ? currentId : chart.document_id, chart);
    if (added && entry === currentEntry()) {
      entry.status = { key: "noteAdded", kind: "success" };
      renderStatus(entry);
    }
  }

  async function exportChart(entry, chart) {
    if (!entry || chart.deleted_at || entry.exporting.has(chart.id)) return;
    if (!chartSkillAllows(chart.skill_snapshot, "offline")) return;
    const documentId = chart.document_id;
    entry.exporting.add(chart.id);
    entry.status = { key: "exporting", kind: "info" };
    render();
    try {
      const query = chart.skill_snapshot ? "" : `?style=${encodeURIComponent(styleId)}`;
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}/charts/${encodeURIComponent(chart.id)}/export${query}`);
      const url = URL.createObjectURL(await response.blob());
      const link = make("a");
      link.href = url;
      link.download = `chart-${chart.id}.zip`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      entry.status = { key: "exported", kind: "success" };
    } catch (error) {
      entry.status = errorStatus(error, "request_failed", () => exportChart(entry, chart));
    } finally {
      entry.exporting.delete(chart.id);
      if (entry === currentEntry()) render();
    }
  }

  async function mutateLifecycle(entry, chart, action) {
    if (!entry || entry.lifecycle.has(chart.id)) return;
    if (action === "delete" && !window.confirm(t("deleteConfirm"))) return;
    let operation = entry.failedLifecycle.get(chart.id);
    if (!operation || operation.action !== action || operation.conflicted) {
      operation = {
        action,
        body: { request_id: crypto.randomUUID(), expected_revision: chart.revision, data_sha256: chart.data_sha256 }
      };
    }
    entry.failedLifecycle.delete(chart.id);
    entry.lifecycle.set(chart.id, operation);
    entry.status = { key: action === "delete" ? "deleting" : "restoring", kind: "info" };
    render();
    const base = `/api/v1/documents/${encodeURIComponent(chart.document_id)}/charts/${encodeURIComponent(chart.id)}`;
    try {
      const updated = await adapter.api(action === "delete" ? base : `${base}/restore`, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      entry.charts = entry.charts.map((item) => item.id === chart.id ? updated : item);
      adapter.sourcesChanged?.(chart.document_id);
      if (updated.deleted_at && entry.activeChartId === updated.id) {
        entry.activeChartId = null;
        if (entry.view?.record?.id === updated.id) {
          entry.view = null;
          purgePlot();
          renderArtifactDetails(null);
        }
        adapter.contextChanged?.();
      }
      entry.status = { key: action === "delete" ? "deleted" : "restored", kind: "success" };
    } catch (error) {
      operation.conflicted = error.code === "revision_conflict";
      entry.failedLifecycle.set(chart.id, operation);
      entry.status = errorStatus(error, "lifecycleRetry", () => mutateLifecycle(entry, chart, action));
    } finally {
      entry.lifecycle.delete(chart.id);
      if (entry === currentEntry()) render();
    }
  }

  async function previewProposal(documentId, proposal) {
    const entry = entryFor(documentId);
    const payload = proposal?.payload || {};
    const body = {
      request_id: payload.request_id,
      dataset_id: payload.dataset_id,
      dataset_sha256: payload.dataset_sha256,
      kind: payload.kind,
      title: payload.title,
      analysis_id: payload.analysis_id ?? null,
      x: payload.x ?? null,
      y: payload.y ?? null,
      bins: payload.bins ?? null,
      recipe_sha256: payload.recipe_sha256,
      renderer_sha256: payload.renderer_sha256
    };
    const key = proposal.sha256 || proposal.id;
    if (proposal.kind !== "create_chart" || !key || entry.proposalPreviews.get(key)?.pending) return false;
    const state = { pending: true, ready: false };
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const sequence = ++entry.openSequence;
    const isCurrent = () => currentId === documentId && entry.proposalPreviews.get(key) === state && sequence === entry.openSequence && navigationGeneration === adapter.getNavigationGeneration?.();
    entry.proposalPreviews.set(key, state);
    try {
      const capabilities = await getCapabilities();
      if (!isCurrent()) return false;
      const response = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/charts/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!isCurrent()) return false;
      if (!response?.chart || !validateArtifact(response.data, { ...body, document_id: documentId }) ||
        body.recipe_sha256 !== capabilities.items.find((item) => item.id === body.kind)?.recipe_sha256 ||
        body.renderer_sha256 !== capabilities.renderer.sha256) throw new Error("invalidArtifact");
      const view = { kind: "preview", origin: "assistant", artifact: response.data, record: response.chart, renderer: capabilities.renderer, pending: true, renderReady: false, host: null };
      entry.view = view;
      entry.activeChartId = null;
      elements.panel.open = true;
      adapter.chartPreviewed?.(documentId);
      adapter.contextChanged?.();
      state.ready = await displayArtifact(entry, view);
      return state.ready;
    } catch {
      state.ready = false;
      return false;
    } finally {
      state.pending = false;
    }
  }

  for (const [control, field] of [[elements.title, "title"], [elements.x, "x"], [elements.y, "y"]]) {
    control.addEventListener(control === elements.title ? "input" : "change", () => {
      const entry = currentEntry();
      const draft = entry?.draft;
      if (!draft || draft.pendingSave || draft.saveFailed) return;
      invalidateDraft(draft);
      draft[field] = control.value;
      render();
    });
  }
  elements.bins.addEventListener("input", () => {
    const draft = currentEntry()?.draft;
    if (!draft || draft.pendingSave || draft.saveFailed) return;
    invalidateDraft(draft);
    draft.bins = Number(elements.bins.value);
    render();
  });
  elements.kind.addEventListener("change", () => {
    const entry = currentEntry();
    const draft = entry?.draft;
    if (!draft || draft.pendingSave || draft.saveFailed) return;
    invalidateDraft(draft);
    draft.kind = elements.kind.value;
    syncFields(entry, draft);
    if (draft.kind === "analysis_counts") {
      const job = entry.jobs.find((item) => item.dataset_id === draft.datasetId && item.status === "succeeded" && isDescriptiveJob(item));
      draft.analysisId = job?.id || null;
    }
    render();
  });
  elements.dataset.addEventListener("change", () => {
    const entry = currentEntry();
    const draft = entry?.draft;
    if (!draft || draft.pendingSave || draft.saveFailed) return;
    invalidateDraft(draft);
    draft.datasetId = elements.dataset.value || null;
    syncFields(entry, draft, true);
    draft.analysisId = entry.jobs.find((job) => job.dataset_id === draft.datasetId && job.status === "succeeded" && isDescriptiveJob(job))?.id || null;
    adapter.datasetContextChanged?.(currentId, draft.datasetId, draft.analysisId);
    render();
  });
  elements.analysis.addEventListener("change", () => {
    const draft = currentEntry()?.draft;
    if (!draft || draft.pendingSave || draft.saveFailed) return;
    invalidateDraft(draft);
    draft.analysisId = elements.analysis.value || null;
    render();
  });
  elements.preview.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry) preview(entry);
  });
  elements.save.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry) save(entry);
  });
  elements.cancel.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry) cancelDraft(entry);
  });
  function downloadChart(format) {
    const view = currentEntry()?.view;
    if (!view?.renderReady || view.pending || !view.host?.isConnected || !window.Plotly) return;
    if (!chartSkillAllows(view.artifact.skill_snapshot, format)) return;
    window.Plotly.downloadImage(view.host, { format, ...chartSkillImageOptions(view.artifact.skill_snapshot, format), filename: `research-chart-${view.artifact.skill_snapshot ? "custom" : styleId}` });
  }
  elements.png.addEventListener("click", () => downloadChart("png"));
  elements.svg.addEventListener("click", () => downloadChart("svg"));
  elements.style.addEventListener("change", () => {
    if (!window.ResearchChartStyles?.ids.includes(elements.style.value)) return;
    styleId = elements.style.value;
    try { localStorage.setItem("research-chart-style", styleId); } catch { /* Session preference remains applied. */ }
    const entry = currentEntry();
    if (entry?.view?.artifact) displayArtifact(entry, entry.view);
  });

  return {
    getSkillModel() {
      const entry = currentEntry(), draft = entry?.draft;
      return { language, ownerId: currentId, available: skillSupport && Boolean(currentId),
        busy: Boolean(draft?.pendingPreview || draft?.pendingSave || draft?.saveFailed || entry?.view?.pending),
        selected: visibleChartSkill(draft, entry?.view?.artifact) };
    },
    getTeachingCharts(documentId) {
      return papers.get(documentId)?.charts.slice() || [];
    },
    getTeachingRevision(documentId) {
      const entry = papers.get(documentId);
      return `${entry?.openSequence || 0}/${entry?.draft?.version || 0}/${entry?.activeChartId || ""}`;
    },
    prepareTeachingChart(documentId, dataset, plan, title) {
      if (currentId !== documentId) return false;
      const entry = currentEntry();
      if (!entry.datasets.some((item) => item.id === dataset.id && item.sha256 === dataset.sha256)) return false;
      const draft = ensureDraft(entry);
      if (draft.pendingPreview || draft.pendingSave || draft.saveFailed || entry.view?.pending) return false;
      const same = draft.datasetId === dataset.id && draft.kind === plan.kind && draft.title === title &&
        draft.x === plan.x && draft.y === (plan.y || "") && !draft.skillSnapshot;
      if (same) return true;
      if ((draft.title || draft.skillSnapshot || entry.view?.kind === "preview") &&
          !window.confirm(language === "zh" ? "用教学示例替换当前图表草稿？已保存的图表不受影响。" : "Replace the current chart draft with this teaching example? Saved charts are retained.")) return false;
      invalidateDraft(draft);
      Object.assign(draft, { datasetId: dataset.id, analysisId: null, kind: plan.kind, title,
        x: plan.x, y: plan.y || "", bins: plan.bins || 20, skillSnapshot: null });
      entry.view = null;
      entry.activeChartId = null;
      purgePlot();
      renderArtifactDetails(null);
      adapter.contextChanged?.();
      render();
      return true;
    },
    selectSkill(value) {
      const entry = currentEntry();
      if (!entry || !skillSupport) return false;
      const draft = ensureDraft(entry);
      if (draft.pendingPreview || draft.pendingSave || draft.saveFailed) return false;
      const snapshot = frozenChartSkill(value);
      invalidateDraft(draft);
      draft.skillSnapshot = snapshot;
      if (snapshot) { draft.kind = snapshot.spec.chart.kind; draft.bins = snapshot.spec.chart.bins || 20; }
      syncFields(entry, draft);
      if (draft.kind === "analysis_counts") draft.analysisId = entry.jobs.find((job) => job.dataset_id === draft.datasetId && job.status === "succeeded" && isDescriptiveJob(job))?.id || null;
      entry.view = null;
      entry.activeChartId = null;
      purgePlot();
      renderArtifactDetails(null);
      adapter.contextChanged?.();
      render();
      return true;
    },
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.panel.querySelector("summary").textContent = t("panel");
      elements.panel.querySelector(".charts-help").textContent = t("help");
      elements.draftLabel.textContent = t("draftLabel");
      for (const [id, key] of [["chart-dataset", "dataset"], ["chart-analysis", "analysis"], ["chart-kind", "kind"], ["chart-title", "title"], ["chart-x", "x"], ["chart-y", "y"], ["chart-bins", "bins"]]) {
        const label = document.querySelector(`label[for="${id}"] .chart-field-label`);
        if (label) label.textContent = t(key);
      }
      elements.title.placeholder = t("titlePlaceholder");
      elements.styleLabel.firstChild.textContent = t("style");
      elements.style.querySelector('option[value="default"]').textContent = t("defaultStyle");
      elements.styleNote.textContent = t("styleNote");
      elements.png.textContent = t("png");
      elements.svg.textContent = t("svg");
      render();
      const entry = currentEntry();
      if (entry?.view?.artifact) displayArtifact(entry, entry.view);
    },
    getActiveChartId(documentId) {
      const entry = entryFor(documentId);
      const chart = entry.charts.find((item) => item.id === entry.activeChartId && !item.deleted_at);
      return chart && chart.dataset_id === adapter.getSharedDatasetId?.() ? chart.id : null;
    },
    getActiveChart(documentId) {
      const entry = entryFor(documentId);
      const chart = entry.charts.find((item) => item.id === entry.activeChartId && !item.deleted_at);
      return chart && chart.dataset_id === adapter.getSharedDatasetId?.() ? chart : null;
    },
    getCurrentChart(documentId) {
      const entry = entryFor(documentId);
      return entry.charts.find((item) => item.id === entry.activeChartId && !item.deleted_at) || null;
    },
    clearActiveChart(documentId) {
      const entry = entryFor(documentId);
      entry.activeChartId = null;
      adapter.contextChanged?.();
    },
    syncDataset,
    refreshLayout() {
      const entry = currentEntry();
      if (!entry || !chartWorkspaceVisible()) return;
      void getCapabilities().then((capabilities) => {
        if (entry === currentEntry() && chartWorkspaceVisible()) return loadRenderer(capabilities.renderer);
      }).catch(() => { /* Foreground rendering owns status and retry. */ });
      const view = entry.view;
      if (!view?.artifact || view.pending) return;
      if (!view.renderReady || !view.host?.isConnected) {
        displayArtifact(entry, view);
      } else if (view.host.clientWidth && window.Plotly) {
        window.Plotly.Plots.resize(view.host);
      }
    },
    reload,
    openChart,
    previewProposal
  };
}
