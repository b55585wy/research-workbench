import { createAnalysisNotebook } from "/analysis-notebook.js";

const ACTIVE_JOBS = new Set(["queued", "running"]);

const messages = {
  zh: {
    panel: "数据与分析",
    help: "导入 CSV、TSV、SAV 或 ZSAV，选择描述统计或独立样本 t 检验，并核对固定分析代码。结果不构成科学结论。",
    upload: "导入数据",
    selectDataset: "选择数据",
    noDataset: "尚未选择数据",
    noDatasets: "请先导入 CSV、TSV、SAV 或 ZSAV 数据。",
    columns: "分析数值列",
    share: "向助手提供此数据的预览",
    engine: "分析语言",
    prepare: "查看并准备运行",
    confirm: "确认运行",
    retry: "按原请求重试",
    cancel: "取消",
    confirmation: "运行确认",
    dataset: "数据",
    datasetHash: "数据 SHA-256",
    selectedColumns: "所选列",
    language: "语言",
    recipe: "固定代码版本",
    recipeHash: "代码 SHA-256",
    dimensions: "{rows} 行 · {columns} 列 · {bytes} 字节",
    sampleTruncated: "仅显示前 5 行；上传的完整数据不会发送给助手。",
    noNumericColumns: "此数据没有可分析的数值列。",
    chooseColumns: "请至少选择一个数值列。",
    runtimeUnavailable: "{engine} 当前不可用，无法运行。",
    runtimeAvailable: "{engine} {version} · 固定代码 describe-v1",
    worker: "任务服务：{state}",
    worker_idle: "空闲",
    worker_running: "运行中",
    worker_unavailable: "不可用",
    uploading: "正在上传… {progress}%",
    uploaded: "数据已上传。",
    uploadRetry: "上传结果不确定。已保留原文件和请求标识，可按原请求重试。",
    invalidDatasetType: "请选择 CSV、TSV、SAV 或 ZSAV 文件。",
    dataset_too_large: "数据文件不能超过 5 MiB。",
    preparing: "正在读取固定代码…",
    prepareFailed: "无法读取固定代码，请重试。",
    recipeMismatch: "代码版本已变化，请重新查看后再运行。",
    runningRequest: "正在提交运行请求…",
    queuedReceipt: "任务已排队，尚未完成。",
    loading: "正在加载数据与分析任务…",
    loadFailed: "无法加载数据或分析任务，请重试。",
    statusFailed: "无法读取可用语言，请重试。",
    jobs: "分析任务",
    open: "打开",
    cancelJob: "取消任务",
    cancelling: "正在取消…",
    export: "导出分析包",
    viewNotebook: "查看 Notebook",
    exporting: "正在导出…",
    exported: "分析包已导出。",
    queued: "已排队，尚未完成",
    running: "正在运行",
    succeeded: "已完成",
    failed: "未完成",
    cancelled: "已取消",
    interrupted: "服务重启后已中断",
    jobError: "任务未完成：{message}",
    resultNote: "以下数值仅为所选数据的描述，不构成科学结论。",
    nonMissingCounts: "非缺失值数量",
    statistic_n: "非缺失",
    statistic_missing: "缺失",
    statistic_mean: "均值",
    statistic_median: "中位数",
    statistic_sd: "样本标准差",
    statistic_min: "最小值",
    statistic_max: "最大值",
    log: "运行日志",
    logTruncated: "日志较长，仅显示已保存的部分。",
    noLog: "暂无日志。",
    network: "无法连接本地服务。原请求和选择已保留。",
    validation_error: "请求无效，请检查数据、列和语言。",
    request_failed: "操作未完成，请重试。",
    not_found: "请求的数据或任务不存在。",
    idempotency_conflict: "请求标识发生冲突，原请求未被改写。",
    dataset_changed: "数据已变化，请重新查看后再运行。",
    recipe_changed: "固定代码已变化，请重新查看后再运行。",
    analysis_queue_busy: "任务队列正忙，请稍后按原请求重试。",
    analysis_unavailable: "分析服务当前不可用。",
    method: "分析方法",
    describe: "描述统计",
    ttestIndependent: "独立样本 t 检验（r-stats）",
    methodLoading: "正在读取可用分析方法…",
    methodFailed: "无法读取分析方法，请重试。",
    methodUnavailable: "独立样本 t 检验当前不可用。",
    libraryUnavailable: "r-stats 库当前不可用，无法预览或运行。",
    libraryAvailable: "R · r-stats {version} · 固定代码 {recipe}",
    outcome: "数值结果变量",
    groupColumn: "分组列",
    loadGroups: "读取两个实际分组",
    loadingGroups: "正在读取实际分组…",
    groupsLoaded: "已读取两个实际分组；请明确选择第 1 组和第 2 组。",
    groupsFailed: "分组列必须恰好包含两个不同的非空标签。",
    chooseGroup: "请选择分组",
    group1: "第 1 组",
    group2: "第 2 组",
    differenceDirection: "差值方向始终为第 1 组减去第 2 组。",
    variant: "方差处理",
    welch: "Welch（不假定等方差）",
    student: "Student（假定等方差）",
    alternative: "备择方向",
    two_sided: "双侧（两组不相等）",
    greater: "第 1 组大于第 2 组",
    less: "第 1 组小于第 2 组",
    confidence: "置信水平",
    independentLabel: "我确认两组为独立样本，且一个观测不会同时属于两组。",
    independentStatement: "独立样本声明已确认；一个观测不会同时属于两组。",
    assumptions: "运行前请检查独立设计、异常值和所选方法的前提；此工具不会自动确认前提成立。",
    preview: "预览完整数据与固定代码",
    previewing: "正在验证完整数据并生成预览…",
    previewReady: "完整数据预览成功，尚未创建任务。请核对后明确确认运行。",
    previewFailed: "预览未完成，尚未创建任务。",
    previewRequired: "输入变化后必须重新成功预览，才能运行。",
    counts: "样本计数与排除",
    total: "总行数",
    used: "使用行数",
    excluded: "排除行数",
    missingOutcomeOnly: "仅结果缺失",
    missingGroupOnly: "仅分组缺失",
    missingBoth: "结果和分组均缺失",
    groupSummaries: "实际分组摘要",
    testResult: "独立样本 t 检验结果",
    statistic: "t 统计量",
    df: "自由度",
    pValue: "p 值",
    difference: "均值差（第 1 组 − 第 2 组）",
    standardError: "差值标准误",
    confidenceInterval: "{confidence}% 置信区间",
    software: "实际计算软件",
    resultTtestNote: "以下结果不包含显著性结论，也不表示正态性或其他前提已得到验证。",
    warnings: "保存的提醒",
    note: "引用到新笔记草稿",
    noteAdded: "分析链接已追加到新笔记草稿，尚未保存。",
    missingCompleteCases: "缺失处理：仅使用结果和分组均完整的行",
    ttest_preview_required: "必须先成功预览当前完整请求。",
    ttest_groups_invalid: "请从实际标签中选择两个不同的分组。",
    library_unavailable: "r-stats 库当前不可用。"
  },
  en: {
    panel: "Data & analysis",
    help: "Import CSV, TSV, SAV, or ZSAV, choose descriptive statistics or an independent-samples t-test, and review the fixed code. Results are not scientific conclusions.",
    upload: "Import data",
    selectDataset: "Choose data",
    noDataset: "No data selected",
    noDatasets: "Import CSV, TSV, SAV, or ZSAV data first.",
    columns: "Numeric columns to analyze",
    share: "Provide a preview of this data to the assistant",
    engine: "Analysis language",
    prepare: "Review and prepare run",
    confirm: "Confirm run",
    retry: "Retry exact request",
    cancel: "Cancel",
    confirmation: "Run confirmation",
    dataset: "Data",
    datasetHash: "Data SHA-256",
    selectedColumns: "Selected columns",
    language: "Language",
    recipe: "Fixed code version",
    recipeHash: "Code SHA-256",
    dimensions: "{rows} rows · {columns} columns · {bytes} bytes",
    sampleTruncated: "Only the first 5 rows are shown; the full upload is never sent to the assistant.",
    noNumericColumns: "This dataset has no numeric columns to analyze.",
    chooseColumns: "Choose at least one numeric column.",
    runtimeUnavailable: "{engine} is unavailable, so it cannot run.",
    runtimeAvailable: "{engine} {version} · fixed code describe-v1",
    worker: "Task service: {state}",
    worker_idle: "idle",
    worker_running: "running",
    worker_unavailable: "unavailable",
    uploading: "Uploading… {progress}%",
    uploaded: "Data uploaded.",
    uploadRetry: "The upload outcome is uncertain. The original file and request ID are retained for an exact retry.",
    invalidDatasetType: "Choose a CSV, TSV, SAV, or ZSAV file.",
    dataset_too_large: "The data file must be no larger than 5 MiB.",
    preparing: "Loading fixed code…",
    prepareFailed: "The fixed code could not be loaded. Try again.",
    recipeMismatch: "The code version changed. Review it again before running.",
    runningRequest: "Submitting the run request…",
    queuedReceipt: "The task is queued, not complete.",
    loading: "Loading data and analysis tasks…",
    loadFailed: "Data or analysis tasks could not be loaded. Try again.",
    statusFailed: "Available languages could not be read. Try again.",
    jobs: "Analysis tasks",
    open: "Open",
    cancelJob: "Cancel task",
    cancelling: "Cancelling…",
    export: "Export analysis bundle",
    viewNotebook: "View Notebook",
    exporting: "Exporting…",
    exported: "Analysis bundle exported.",
    queued: "Queued, not complete",
    running: "Running",
    succeeded: "Completed",
    failed: "Not completed",
    cancelled: "Cancelled",
    interrupted: "Interrupted by a service restart",
    jobError: "Task not completed: {message}",
    resultNote: "These values only describe the selected data; they are not scientific conclusions.",
    nonMissingCounts: "Non-missing value counts",
    statistic_n: "Non-missing",
    statistic_missing: "Missing",
    statistic_mean: "Mean",
    statistic_median: "Median",
    statistic_sd: "Sample SD",
    statistic_min: "Minimum",
    statistic_max: "Maximum",
    log: "Run log",
    logTruncated: "The log is long; only the saved portion is shown.",
    noLog: "No log is available yet.",
    network: "Cannot connect to the local service. The original request and choices are retained.",
    validation_error: "The request is invalid. Check the data, columns, and language.",
    request_failed: "The action was not completed. Try again.",
    not_found: "The requested data or task does not exist.",
    idempotency_conflict: "The request ID conflicted; the original request was not changed.",
    dataset_changed: "The data changed. Review it again before running.",
    recipe_changed: "The fixed code changed. Review it again before running.",
    analysis_queue_busy: "The task queue is busy. Retry the exact request shortly.",
    analysis_unavailable: "The analysis service is currently unavailable.",
    method: "Analysis method",
    describe: "Descriptive statistics",
    ttestIndependent: "Independent-samples t-test (r-stats)",
    methodLoading: "Loading available analysis methods…",
    methodFailed: "Analysis methods could not be loaded. Try again.",
    methodUnavailable: "The independent-samples t-test is currently unavailable.",
    libraryUnavailable: "The r-stats library is unavailable, so preview and run are disabled.",
    libraryAvailable: "R · r-stats {version} · fixed code {recipe}",
    outcome: "Numeric outcome",
    groupColumn: "Grouping column",
    loadGroups: "Load the two actual groups",
    loadingGroups: "Loading actual groups…",
    groupsLoaded: "Two actual groups loaded. Explicitly choose group 1 and group 2.",
    groupsFailed: "The grouping column must contain exactly two distinct nonempty labels.",
    chooseGroup: "Choose a group",
    group1: "Group 1",
    group2: "Group 2",
    differenceDirection: "The difference is always group 1 minus group 2.",
    variant: "Variance method",
    welch: "Welch (equal variances not assumed)",
    student: "Student (equal variances assumed)",
    alternative: "Alternative direction",
    two_sided: "Two-sided (groups differ)",
    greater: "Group 1 greater than group 2",
    less: "Group 1 less than group 2",
    confidence: "Confidence level",
    independentLabel: "I confirm that the groups are independent samples and no observation belongs to both groups.",
    independentStatement: "Independent-samples design confirmed; no observation belongs to both groups.",
    assumptions: "Check the independent design, outliers, and prerequisites for the chosen method; this tool does not verify them automatically.",
    preview: "Preview full data and fixed code",
    previewing: "Validating the full data and generating a preview…",
    previewReady: "Full-data preview succeeded; no task was created. Review it and explicitly confirm the run.",
    previewFailed: "Preview was not completed; no task was created.",
    previewRequired: "Changed inputs require a new successful preview before running.",
    counts: "Sample counts and exclusions",
    total: "Total rows",
    used: "Rows used",
    excluded: "Rows excluded",
    missingOutcomeOnly: "Outcome only missing",
    missingGroupOnly: "Group only missing",
    missingBoth: "Outcome and group missing",
    groupSummaries: "Actual group summaries",
    testResult: "Independent-samples t-test result",
    statistic: "t statistic",
    df: "Degrees of freedom",
    pValue: "p value",
    difference: "Mean difference (group 1 − group 2)",
    standardError: "SE of difference",
    confidenceInterval: "{confidence}% confidence interval",
    software: "Actual computation software",
    resultTtestNote: "These results include no significance verdict and do not claim that normality or other assumptions have been verified.",
    warnings: "Saved reminders",
    note: "Add citation to new note draft",
    noteAdded: "The analysis link was appended to the new note draft; it is not saved.",
    missingCompleteCases: "Missing data: only rows with both outcome and group present are used",
    ttest_preview_required: "The exact current request must be previewed successfully first.",
    ttest_groups_invalid: "Choose two different groups from the actual labels.",
    library_unavailable: "The r-stats library is currently unavailable."
  }
};

export function createAnalysis(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    panel: byId("analysis-panel"),
    uploadInput: byId("dataset-upload-input"),
    uploadButton: byId("dataset-upload-button"),
    uploadStatus: byId("dataset-upload-status"),
    datasetSelect: byId("dataset-select"),
    preview: byId("dataset-preview"),
    columns: byId("dataset-columns"),
    share: byId("dataset-share"),
    method: byId("analysis-method"),
    methodStatus: byId("analysis-method-status"),
    engine: byId("analysis-engine"),
    engineLabel: byId("analysis-engine-label"),
    prepare: byId("analysis-prepare"),
    ttestOptions: byId("ttest-options"),
    ttestOutcome: byId("ttest-outcome"),
    ttestGroupColumn: byId("ttest-group-column"),
    ttestGroupsLoad: byId("ttest-groups-load"),
    ttestGroupsStatus: byId("ttest-groups-status"),
    ttestGroup1: byId("ttest-group1"),
    ttestGroup2: byId("ttest-group2"),
    ttestDirection: byId("ttest-direction"),
    ttestVariant: byId("ttest-variant"),
    ttestAlternative: byId("ttest-alternative"),
    ttestConfidence: byId("ttest-confidence"),
    ttestIndependent: byId("ttest-independent-confirmed"),
    ttestPreview: byId("ttest-preview"),
    confirmation: byId("analysis-confirmation"),
    confirmationDetails: document.querySelector(".analysis-confirmation-details"),
    code: byId("analysis-code"),
    confirm: byId("analysis-confirm"),
    cancelConfirm: byId("analysis-cancel-confirm"),
    status: byId("analysis-status"),
    jobs: byId("analyses-list"),
    result: byId("analysis-result"),
    log: byId("analysis-log"),
    logContent: document.querySelector(".analysis-log-content"),
    runtime: document.querySelector(".analysis-runtime"),
    fieldset: byId("analysis-columns-fieldset")
  };
  const papers = new Map();
  const recipes = new Map();
  let methodCatalog = null;
  let methodCatalogPromise = null;
  let language = adapter.getLanguage();
  let currentId = null;
  const notebook = createAnalysisNotebook(adapter);

  function t(key, values = {}) {
    let text = messages[language][key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function errorText(error, fallback = "request_failed") {
    const code = typeof error === "string" ? error : error?.code || error?.key;
    if (code && (Object.hasOwn(messages[language], code) || Object.hasOwn(messages.en, code))) return t(code);
    return t(fallback);
  }

  function entryFor(documentId) {
    if (!papers.has(documentId)) {
      papers.set(documentId, {
        datasets: [],
        jobs: [],
        jobVersion: 0,
        jobDetails: new Map(),
        logs: new Map(),
        selectedDatasetId: null,
        datasetRequestSequence: 0,
        selectedColumns: new Set(),
        shared: false,
        method: "describe",
        methodStatus: null,
        ttestDrafts: new Map(),
        engine: "python",
        runtime: null,
        confirmation: null,
        upload: null,
        status: null,
        selectedJobId: null,
        jobRequestSequence: 0,
        cancelling: new Set(),
        exporting: new Set(),
        loadSequence: 0,
        loadController: null,
        pollToken: 0,
        pollTimer: null,
        polling: false
      });
    }
    return papers.get(documentId);
  }

  function currentEntry() {
    return currentId ? entryFor(currentId) : null;
  }

  function selectedDataset(entry) {
    return entry?.datasets.find((dataset) => dataset.id === entry.selectedDatasetId) || null;
  }

  function engineInfo(entry, engine = entry?.engine) {
    return entry?.runtime?.engines?.find((item) => item.id === engine) || null;
  }

  function engineName(engine) {
    return engine === "r" ? "R" : "Python";
  }

  function methodInfo(entry, method = entry?.method) {
    return methodCatalog?.items?.find((item) => item.id === method) || null;
  }

  function methodName(method) {
    return method === "ttest_independent" ? t("ttestIndependent") : t("describe");
  }

  function ttestDraft(entry) {
    const dataset = selectedDataset(entry);
    if (!entry || !dataset) return null;
    if (!entry.ttestDrafts.has(dataset.id)) {
      entry.ttestDrafts.set(dataset.id, {
        outcome: (dataset.columns || []).find((column) => column.numeric)?.name || "",
        groupColumn: "",
        groups: [],
        group1: "",
        group2: "",
        variant: "welch",
        alternative: "two_sided",
        confidence: 0.95,
        independentConfirmed: false,
        groupsPending: false,
        groupsSequence: 0,
        groupsController: null,
        groupsStatus: null
      });
    }
    return entry.ttestDrafts.get(dataset.id);
  }

  function clearTtestGroups(draft) {
    if (!draft) return;
    draft.groupsSequence += 1;
    draft.groupsController?.abort();
    draft.groupsController = null;
    draft.groupsPending = false;
    draft.groups = [];
    draft.group1 = "";
    draft.group2 = "";
    draft.groupsStatus = null;
  }

  function ttestReady(entry, draft) {
    const dataset = selectedDataset(entry);
    const info = methodInfo(entry, "ttest_independent");
    const labels = draft?.groups.map((group) => group.label) || [];
    return Boolean(dataset && draft && info?.available && info.library?.available && engineInfo(entry, "r")?.available && draft.outcome && draft.groupColumn &&
      draft.outcome !== draft.groupColumn && labels.length === 2 && labels.includes(draft.group1) && labels.includes(draft.group2) &&
      draft.group1 !== draft.group2 && draft.independentConfirmed && Number.isFinite(draft.confidence) &&
      draft.confidence > 0 && draft.confidence < 1 && !draft.groupsPending && !entry.confirmation?.pending);
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
      option.disabled = Boolean(item.disabled);
      select.append(option);
    }
    select.value = value || "";
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendField(list, label, value) {
    list.append(make("dt", "", label), make("dd", "", value));
  }

  function setStatus(entry, status) {
    entry.status = status;
    if (entry === currentEntry()) renderStatus();
  }

  function renderStatus() {
    const entry = currentEntry();
    elements.status.replaceChildren();
    const status = entry?.status;
    if (!status) return;
    elements.status.dataset.kind = status.kind || "info";
    elements.status.append(make("span", "", status.kind === "error" ? errorText(status) : t(status.key, status.values || {})));
    if (status.retry) {
      const button = make("button", "status-retry", t("retry"));
      button.type = "button";
      button.addEventListener("click", status.retry);
      elements.status.append(button);
    }
  }

  function renderUpload(entry) {
    elements.uploadStatus.replaceChildren();
    const upload = entry?.upload;
    elements.uploadButton.disabled = !entry || Boolean(upload?.pending) || Boolean(adapter.isImportPending?.());
    elements.uploadButton.textContent = t("upload");
    if (!upload?.status) return;
    const status = upload.status;
    elements.uploadStatus.dataset.kind = status.kind || "info";
    elements.uploadStatus.append(make("span", "", status.kind === "error" ? errorText(status, "uploadRetry") : t(status.key, status.values || {})));
    if (status.retry) {
      const button = make("button", "status-retry", t("retry"));
      button.type = "button";
      button.addEventListener("click", () => uploadDataset(entry));
      elements.uploadStatus.append(button);
    }
  }

  function renderDataset(entry) {
    elements.datasetSelect.replaceChildren();
    const dataset = selectedDataset(entry);
    if (!entry?.datasets.length) {
      const option = make("option", "", t("noDatasets"));
      option.value = "";
      elements.datasetSelect.append(option);
    } else {
      for (const item of entry.datasets) {
        const option = make("option", "", item.original_filename);
        option.value = item.id;
        elements.datasetSelect.append(option);
      }
      elements.datasetSelect.value = entry.selectedDatasetId || "";
    }
    elements.datasetSelect.disabled = !entry?.datasets.length || Boolean(entry?.confirmation?.pending);
    elements.preview.replaceChildren();
    if (!dataset) return;
    elements.preview.append(make("p", "analysis-dimensions", t("dimensions", {
      rows: dataset.row_count,
      columns: dataset.column_count,
      bytes: dataset.byte_size
    })));
    const scroll = make("div", "analysis-table-scroll");
    const table = make("table", "analysis-table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    for (const column of dataset.columns || []) header.append(make("th", "", column.name));
    thead.append(header);
    const tbody = document.createElement("tbody");
    for (const row of dataset.preview || []) {
      const tr = document.createElement("tr");
      for (const value of row) tr.append(make("td", "", value));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    scroll.append(table);
    elements.preview.append(scroll, make("p", "analysis-sample-note", t("sampleTruncated")));
  }

  function renderColumns(entry) {
    elements.columns.replaceChildren();
    const dataset = selectedDataset(entry);
    elements.fieldset.disabled = !dataset || Boolean(entry?.confirmation?.pending);
    elements.fieldset.querySelector("legend").textContent = t("columns");
    if (!dataset) return;
    const numeric = (dataset.columns || []).filter((column) => column.numeric);
    if (!numeric.length) {
      elements.columns.append(make("p", "analysis-muted", t("noNumericColumns")));
      return;
    }
    for (const column of numeric) {
      const label = make("label", "analysis-column");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.column = column.name;
      checkbox.checked = entry.selectedColumns.has(column.name);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) entry.selectedColumns.add(column.name);
        else entry.selectedColumns.delete(column.name);
        invalidateConfirmation(entry);
        render();
      });
      label.append(checkbox, make("span", "", `${column.name} (${column.nonempty}/${dataset.row_count})`));
      elements.columns.append(label);
    }
  }

  function renderMethod(entry) {
    const isTTest = entry?.method === "ttest_independent";
    const info = methodInfo(entry, "ttest_independent");
    fillSelect(elements.method, [
      { value: "describe", label: t("describe") },
      { value: "ttest_independent", label: t("ttestIndependent"), disabled: Boolean(methodCatalog && !info?.available) }
    ], entry?.method || "describe");
    elements.method.disabled = !entry || Boolean(entry?.confirmation?.pending);
    elements.fieldset.hidden = isTTest;
    elements.engine.hidden = isTTest;
    elements.engineLabel.hidden = isTTest;
    elements.prepare.hidden = isTTest;
    elements.ttestOptions.hidden = !isTTest;
    elements.methodStatus.replaceChildren();
    const status = entry?.methodStatus || (methodCatalog && (!info?.available || !info.library?.available) ? { key: info?.available ? "libraryUnavailable" : "methodUnavailable", kind: "error", retry: () => discoverMethods(entry, true) } : null);
    if (status) {
      elements.methodStatus.dataset.kind = status.kind || "info";
      elements.methodStatus.append(make("span", "", errorText(status, "methodFailed")));
      if (status.retry) {
        const retry = make("button", "status-retry", t("retry"));
        retry.type = "button";
        retry.addEventListener("click", status.retry);
        elements.methodStatus.append(retry);
      }
    } else {
      delete elements.methodStatus.dataset.kind;
    }
  }

  function renderTtest(entry) {
    const draft = ttestDraft(entry);
    const dataset = selectedDataset(entry);
    const locked = !dataset || Boolean(entry?.confirmation?.pending);
    const numeric = (dataset?.columns || []).filter((column) => column.numeric).map((column) => ({ value: column.name, label: column.name }));
    const columns = (dataset?.columns || []).map((column) => ({ value: column.name, label: column.name }));
    fillSelect(elements.ttestOutcome, numeric, draft?.outcome, t("chooseColumns"));
    fillSelect(elements.ttestGroupColumn, columns, draft?.groupColumn, t("groupColumn"));
    const groups = (draft?.groups || []).map((group) => ({ value: group.label, label: `${group.label} (${group.rows})` }));
    fillSelect(elements.ttestGroup1, groups, draft?.group1, t("chooseGroup"));
    fillSelect(elements.ttestGroup2, groups, draft?.group2, t("chooseGroup"));
    elements.ttestVariant.value = draft?.variant || "welch";
    elements.ttestAlternative.value = draft?.alternative || "two_sided";
    if (document.activeElement !== elements.ttestConfidence) elements.ttestConfidence.value = String(draft?.confidence ?? 0.95);
    elements.ttestIndependent.checked = Boolean(draft?.independentConfirmed);
    for (const control of [elements.ttestOutcome, elements.ttestGroupColumn, elements.ttestVariant, elements.ttestAlternative, elements.ttestConfidence, elements.ttestIndependent]) control.disabled = locked;
    elements.ttestGroupsLoad.disabled = locked || !draft?.outcome || !draft?.groupColumn || draft.outcome === draft.groupColumn || draft.groupsPending;
    elements.ttestGroupsLoad.textContent = t(draft?.groupsPending ? "loadingGroups" : "loadGroups");
    elements.ttestGroup1.disabled = locked || !draft?.groups.length;
    elements.ttestGroup2.disabled = locked || !draft?.groups.length;
    elements.ttestDirection.textContent = `${t("differenceDirection")}${draft?.group1 && draft?.group2 ? ` ${draft.group1} − ${draft.group2}` : ""}`;
    elements.ttestPreview.disabled = !ttestReady(entry, draft);
    elements.ttestPreview.textContent = t(entry?.confirmation?.method === "ttest_independent" && entry.confirmation.pending && entry.confirmation.phase === "preview" ? "previewing" : "preview");
    elements.ttestGroupsStatus.replaceChildren();
    const status = draft?.groupsStatus;
    if (status) {
      elements.ttestGroupsStatus.dataset.kind = status.kind || "info";
      elements.ttestGroupsStatus.append(make("span", "", status.kind === "error" ? errorText(status, "groupsFailed") : t(status.key, status.values || {})));
      if (status.retry) {
        const retry = make("button", "status-retry", t("retry"));
        retry.type = "button";
        retry.addEventListener("click", status.retry);
        elements.ttestGroupsStatus.append(retry);
      }
    } else {
      delete elements.ttestGroupsStatus.dataset.kind;
    }
  }

  function renderRuntime(entry) {
    if (entry?.method === "ttest_independent") {
      const info = methodInfo(entry, "ttest_independent");
      const runtime = engineInfo(entry, "r");
      elements.runtime.replaceChildren();
      elements.runtime.dataset.kind = info?.available && info.library?.available && runtime?.available ? "info" : "error";
      elements.runtime.append(make("p", "", info?.available && info.library?.available
        ? t("libraryAvailable", { version: info.library.version || "—", recipe: info.recipe_id || "ttest-independent-rstats-v1" })
        : t("libraryUnavailable")));
      if (entry.runtime) elements.runtime.append(make("p", "", t("worker", { state: t(`worker_${entry.runtime.worker_state || "unavailable"}`) })));
      return;
    }
    elements.engine.replaceChildren();
    for (const id of ["python", "r"]) {
      const info = engineInfo(entry, id);
      const option = make("option", "", info?.available
        ? `${engineName(id)} · ${info.version || "—"}`
        : `${engineName(id)} · ${t("worker_unavailable")}`);
      option.value = id;
      option.disabled = !info?.available;
      elements.engine.append(option);
    }
    elements.engine.value = entry?.engine || "python";
    elements.engine.disabled = !entry?.runtime || Boolean(entry?.confirmation?.pending);
    elements.runtime.replaceChildren();
    if (!entry?.runtime) {
      elements.runtime.dataset.kind = "error";
      elements.runtime.textContent = t("statusFailed");
      return;
    }
    const info = engineInfo(entry);
    elements.runtime.dataset.kind = info?.available ? "info" : "error";
    elements.runtime.append(make("p", "", info?.available
      ? t("runtimeAvailable", { engine: engineName(entry.engine), version: info.version || "—" })
      : t("runtimeUnavailable", { engine: engineName(entry.engine) })));
    const worker = entry.runtime.worker_state || "unavailable";
    elements.runtime.append(make("p", "", t("worker", { state: t(`worker_${worker}`) })));
  }

  function appendTtestCounts(container, counts) {
    if (!counts) return;
    container.append(make("h4", "ttest-preview-heading", t("counts")));
    const list = make("dl", "ttest-counts");
    for (const [field, key] of [["total", "total"], ["used", "used"], ["excluded", "excluded"], ["missing_outcome_only", "missingOutcomeOnly"], ["missing_group_only", "missingGroupOnly"], ["missing_both", "missingBoth"]]) {
      appendField(list, t(key), counts[field] ?? "—");
    }
    container.append(list);
  }

  function appendTtestStats(container, stats) {
    container.append(make("h4", "ttest-preview-heading", t("groupSummaries")));
    const scroll = make("div", "analysis-table-scroll");
    const table = make("table", "analysis-table analysis-result-table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    header.append(make("th", "", t("groupColumn")));
    for (const key of ["n", "missing", "mean", "median", "sd", "min", "max"]) header.append(make("th", "", t(`statistic_${key}`)));
    thead.append(header);
    const tbody = document.createElement("tbody");
    for (const stat of stats || []) {
      const row = document.createElement("tr");
      row.append(make("th", "", stat.column));
      for (const key of ["n", "missing", "mean", "median", "sd", "min", "max"]) row.append(make("td", "", stat[key] ?? "—"));
      tbody.append(row);
    }
    table.append(thead, tbody);
    scroll.append(table);
    container.append(scroll);
  }

  function renderConfirmation(entry) {
    const confirmation = entry?.confirmation;
    elements.confirmation.hidden = !confirmation;
    elements.confirmationDetails.replaceChildren();
    if (!confirmation) {
      elements.code.textContent = "";
      return;
    }
    const list = make("dl", confirmation.method === "ttest_independent" ? "analysis-confirmation-list ttest-confirmation-list" : "analysis-confirmation-list");
    appendField(list, t("dataset"), confirmation.datasetName);
    appendField(list, t("datasetHash"), confirmation.datasetHash);
    if (confirmation.method === "ttest_independent") {
      const options = confirmation.body.ttest;
      appendField(list, t("method"), t("ttestIndependent"));
      appendField(list, t("outcome"), confirmation.body.columns[0]);
      appendField(list, t("groupColumn"), options.group_column);
      appendField(list, t("group1"), options.groups[0]);
      appendField(list, t("group2"), options.groups[1]);
      appendField(list, t("difference"), `${options.groups[0]} − ${options.groups[1]}`);
      appendField(list, t("variant"), t(options.variant));
      appendField(list, t("alternative"), t(options.alternative));
      appendField(list, t("confidence"), `${Number(options.confidence) * 100}%`);
      appendField(list, t("independentStatement"), t("missingCompleteCases"));
      appendField(list, "r-stats SHA-256", confirmation.body.library_sha256);
    } else {
      appendField(list, t("selectedColumns"), confirmation.columns.join(", "));
      appendField(list, t("language"), engineName(confirmation.engine));
    }
    appendField(list, t("recipe"), `${confirmation.recipe.id} · v${confirmation.recipe.version}`);
    appendField(list, t("recipeHash"), confirmation.recipe.sha256);
    elements.confirmationDetails.append(list);
    if (confirmation.preview) {
      const preview = make("div", "ttest-preview-summary");
      appendTtestCounts(preview, confirmation.preview.counts);
      appendTtestStats(preview, confirmation.preview.stats);
      for (const warning of confirmation.preview.warnings || []) preview.append(make("p", "ttest-assumptions", warning));
      elements.confirmationDetails.append(preview);
    }
    elements.code.textContent = confirmation.recipe.code;
    const needsPreview = confirmation.method === "ttest_independent" && !confirmation.preview;
    elements.confirm.disabled = confirmation.pending || needsPreview;
    elements.confirm.textContent = t(confirmation.pending
      ? confirmation.phase === "preview" ? "previewing" : "runningRequest"
      : confirmation.runFailed || confirmation.method !== "ttest_independent" && confirmation.requestId ? "retry" : "confirm");
    elements.cancelConfirm.disabled = confirmation.pending;
    elements.cancelConfirm.textContent = t("cancel");
  }

  function jobFor(entry, jobId) {
    return entry?.jobs.find((job) => job.id === jobId) || entry?.jobDetails.get(jobId) || null;
  }

  function jobButton(action, label, handler, disabled = false) {
    const button = make("button", "button button-quiet", label);
    button.type = "button";
    button.dataset.action = action;
    button.disabled = disabled;
    button.addEventListener("click", handler);
    return button;
  }

  function renderJobs(entry) {
    elements.jobs.replaceChildren();
    elements.jobs.setAttribute("aria-label", t("jobs"));
    for (const job of entry?.jobs || []) {
      const item = make("li", "analysis-job");
      item.dataset.analysisId = job.id;
      item.dataset.status = job.status;
      const open = jobButton("open-analysis", `${job.dataset_name} · ${methodName(job.method)} · ${engineName(job.engine)}`, () => openJob(job.id));
      const status = make("span", "analysis-job-status", t(job.status));
      const actions = make("div", "analysis-job-actions");
      actions.append(open, status);
      if (ACTIVE_JOBS.has(job.status)) {
        actions.append(jobButton("cancel-analysis", entry.cancelling.has(job.id) ? t("cancelling") : t("cancelJob"), () => cancelJob(entry, job), entry.cancelling.has(job.id)));
      }
      if (job.status === "succeeded" && job.export_url) {
        actions.append(jobButton("export-analysis", entry.exporting.has(job.id) ? t("exporting") : t("export"), () => exportJob(entry, job), entry.exporting.has(job.id)));
      }
      item.append(actions);
      elements.jobs.append(item);
    }
  }

  function confidenceBound(ci, lower) {
    if (lower && ci?.lower_unbounded || !lower && ci?.upper_unbounded) return lower ? "−∞" : "+∞";
    const value = lower ? ci?.lower : ci?.upper;
    if (value === null || value === undefined) return lower ? "−∞" : "+∞";
    return String(value);
  }

  function softwareText(job) {
    const software = job.result?.software || {};
    const parts = [];
    const engine = software.engine || job.engine;
    const engineLabel = typeof engine === "string" && !["r", "python"].includes(engine) ? engine : engineName(engine);
    const engineVersion = software.engine_version || software.r_version || software.r || job.engine_version;
    if (engine || engineVersion) parts.push(`${engineLabel} ${engineVersion || ""}`.trim());
    const library = software.library && typeof software.library === "object" ? software.library : software.packages?.find((item) => item.id === "r-stats" || item.name === "r-stats") || null;
    const libraryId = library?.id || library?.name || software.library_id || (software.stats ? "r-stats" : null);
    const libraryVersion = library?.version || software.library_version || software.stats || null;
    const libraryHash = library?.sha256 || software.library_sha256 || null;
    if (libraryId || libraryVersion) parts.push(`${libraryId || "r-stats"} ${libraryVersion || ""}`.trim());
    if (libraryHash) parts.push(`SHA-256 ${libraryHash}`);
    if (!parts.length && software.name) parts.push(`${software.name} ${software.version || ""}`.trim());
    return parts.join(" · ") || "—";
  }

  function renderTtestResult(container, job) {
    const result = job.result;
    const test = result.test || {};
    const groups = Array.isArray(test.groups) ? test.groups : [];
    container.append(make("p", "analysis-result-note", t("resultTtestNote")), make("p", "ttest-assumptions", t("assumptions")));
    const definition = make("dl", "ttest-definition");
    appendField(definition, t("outcome"), test.outcome || job.columns?.[0] || "—");
    appendField(definition, t("groupColumn"), test.group_column || job.ttest?.group_column || "—");
    appendField(definition, t("group1"), groups[0] || "—");
    appendField(definition, t("group2"), groups[1] || "—");
    appendField(definition, t("variant"), t(test.variant || job.ttest?.variant || "welch"));
    appendField(definition, t("alternative"), t(test.alternative || job.ttest?.alternative || "two_sided"));
    appendField(definition, t("missingCompleteCases"), groups.join(" − "));
    container.append(definition);
    appendTtestCounts(container, result.counts);
    appendTtestStats(container, result.stats);
    container.append(make("h4", "ttest-result-heading", t("testResult")));
    const values = make("dl", "ttest-test-values");
    appendField(values, t("statistic"), test.statistic ?? "—");
    appendField(values, t("df"), test.df ?? "—");
    appendField(values, t("pValue"), test.p_value ?? "—");
    appendField(values, `${t("difference")}: ${groups[0] || "—"} − ${groups[1] || "—"}`, test.difference ?? "—");
    appendField(values, t("standardError"), test.standard_error ?? "—");
    const confidence = Number(test.confidence ?? job.ttest?.confidence ?? 0.95) * 100;
    appendField(values, t("confidenceInterval", { confidence }), `[${confidenceBound(test.ci, true)}, ${confidenceBound(test.ci, false)}]`);
    appendField(values, t("software"), softwareText(job));
    container.append(values);
    if (result.warnings?.length) {
      container.append(make("h4", "ttest-result-heading", t("warnings")));
      const warnings = make("ul", "ttest-warning-list");
      for (const warning of result.warnings) warnings.append(make("li", "", warning));
      container.append(warnings);
    }
  }

  function renderDescriptiveResult(container, job) {
    container.append(make("p", "analysis-result-note", t("resultNote")));
    const scroll = make("div", "analysis-table-scroll");
    const table = make("table", "analysis-table analysis-result-table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    header.append(make("th", "", t("selectedColumns")));
    for (const key of ["n", "missing", "mean", "median", "sd", "min", "max"]) header.append(make("th", "", t(`statistic_${key}`)));
    thead.append(header);
    const tbody = document.createElement("tbody");
    for (const stat of job.result.stats || []) {
      const row = document.createElement("tr");
      row.append(make("th", "", stat.column));
      for (const key of ["n", "missing", "mean", "median", "sd", "min", "max"]) row.append(make("td", "", stat[key] ?? "—"));
      tbody.append(row);
    }
    table.append(thead, tbody);
    scroll.append(table);
    container.append(scroll);
    const chart = make("div", "analysis-chart");
    chart.append(make("h4", "", t("nonMissingCounts")));
    const maximum = Math.max(1, ...(job.result.stats || []).map((stat) => Number(stat.n) || 0));
    for (const stat of job.result.stats || []) {
      const row = make("div", "analysis-chart-row");
      const label = make("span", "analysis-chart-label", stat.column);
      const track = make("div", "analysis-chart-track");
      const bar = make("div", "analysis-chart-bar");
      bar.style.width = `${Math.max(0, Math.min(100, ((Number(stat.n) || 0) / maximum) * 100))}%`;
      track.append(bar);
      row.append(label, track, make("span", "analysis-chart-value", String(stat.n)));
      chart.append(row);
    }
    container.append(chart);
  }

  function renderResult(entry) {
    elements.result.replaceChildren();
    const job = jobFor(entry, entry?.selectedJobId);
    elements.result.hidden = !job;
    elements.log.hidden = !job;
    if (!job) {
      elements.logContent.replaceChildren();
      return;
    }
    elements.result.append(make("h3", "", job.dataset_name), make("p", "analysis-job-result-status", `${t(job.status)} · ${methodName(job.method)} · ${engineName(job.engine)}`));
    if (job.status === "succeeded") {
      const actions = make("div", "analysis-result-actions");
      actions.append(jobButton("view-notebook", t("viewNotebook"), () => notebook.open(currentId, job)));
      if (job.method === "ttest_independent") {
        actions.append(jobButton("analysis-note", t("note"), async () => {
          const added = await adapter.addAnalysisCitation?.(currentId, job);
          if (added && entry === currentEntry()) {
            entry.status = { key: "noteAdded", kind: "success" };
            renderStatus();
          }
        }));
      }
      elements.result.append(actions);
    }
    if (job.error) elements.result.append(make("p", "analysis-error", t("jobError", { message: job.error.message || job.error.code || "—" })));
    if (job.status === "succeeded" && job.result) {
      if (job.method === "ttest_independent" || job.result.method === "ttest_independent") renderTtestResult(elements.result, job);
      else renderDescriptiveResult(elements.result, job);
    }
    renderLog(entry, job);
  }

  function renderLog(entry, job) {
    elements.log.querySelector("summary").textContent = t("log");
    const log = entry.logs.get(job.id);
    elements.logContent.replaceChildren();
    if (!log) {
      elements.logContent.append(make("p", "analysis-muted", t("noLog")));
      return;
    }
    elements.logContent.append(make("pre", "analysis-log-text", log.text || ""));
    if (log.truncated) elements.logContent.append(make("p", "analysis-muted", t("logTruncated")));
  }

  function render() {
    const entry = currentEntry();
    renderUpload(entry);
    renderDataset(entry);
    renderMethod(entry);
    renderColumns(entry);
    elements.share.checked = Boolean(entry?.shared && selectedDataset(entry));
    elements.share.disabled = !selectedDataset(entry);
    elements.share.nextElementSibling.textContent = t("share");
    renderTtest(entry);
    renderRuntime(entry);
    const dataset = selectedDataset(entry);
    elements.prepare.disabled = entry?.method !== "describe" || !dataset || !entry?.selectedColumns.size || !engineInfo(entry)?.available || Boolean(entry?.confirmation?.pending);
    elements.prepare.textContent = t("prepare");
    renderConfirmation(entry);
    renderStatus();
    renderJobs(entry);
    renderResult(entry);
  }

  function invalidateConfirmation(entry) {
    if (entry.confirmation && !entry.confirmation.pending) {
      entry.confirmation = null;
      if (["previewing", "previewReady", "previewFailed", "ttest_preview_required"].includes(entry.status?.key)) entry.status = null;
    }
  }

  async function discoverMethods(entry, force = false) {
    if (!entry) return null;
    if (methodCatalog && !force) {
      entry.methodStatus = null;
      if (entry === currentEntry()) renderMethod(entry);
      return methodCatalog;
    }
    entry.methodStatus = { key: "methodLoading", kind: "info" };
    if (entry === currentEntry()) renderMethod(entry);
    if (!methodCatalogPromise || force) {
      methodCatalogPromise = adapter.api("/api/v1/analysis/methods").then((body) => {
        if (!body || !Array.isArray(body.items)) throw new Error("methodFailed");
        methodCatalog = body;
        return body;
      }).catch((error) => {
        methodCatalog = null;
        throw error;
      });
    }
    const request = methodCatalogPromise;
    try {
      const catalog = await request;
      entry.methodStatus = null;
      return catalog;
    } catch (error) {
      entry.methodStatus = { key: error.code || "methodFailed", kind: "error", retry: () => discoverMethods(entry, true) };
      return null;
    } finally {
      if (methodCatalogPromise === request) methodCatalogPromise = null;
      if (entry === currentEntry()) render();
    }
  }

  async function loadTtestGroups(entry, draft) {
    const dataset = selectedDataset(entry);
    const documentId = currentId;
    if (!entry || !draft || !dataset || !documentId || draft.groupsPending || !draft.groupColumn || draft.outcome === draft.groupColumn) return;
    const sequence = ++draft.groupsSequence;
    const controller = new AbortController();
    draft.groupsController = controller;
    draft.groupsPending = true;
    draft.groupsStatus = { key: "loadingGroups", kind: "info" };
    invalidateConfirmation(entry);
    render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/analyses/ttest/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id: dataset.id, dataset_sha256: dataset.sha256, group_column: draft.groupColumn }),
        signal: controller.signal
      });
      if (entry.ttestDrafts.get(dataset.id) !== draft || sequence !== draft.groupsSequence) return;
      if (!Array.isArray(body.groups) || body.groups.length !== 2 || body.groups.some((group) => typeof group.label !== "string" || !group.label || !Number.isInteger(group.rows)) || body.groups[0].label === body.groups[1].label) {
        throw new Error("groupsFailed");
      }
      draft.groups = body.groups.map((group) => ({ label: group.label, rows: group.rows }));
      draft.group1 = "";
      draft.group2 = "";
      draft.groupsStatus = { key: "groupsLoaded", kind: "success" };
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== draft.groupsSequence) return;
      draft.groups = [];
      draft.group1 = "";
      draft.group2 = "";
      draft.groupsStatus = { key: error.code || "groupsFailed", kind: "error", retry: () => loadTtestGroups(entry, draft) };
    } finally {
      if (sequence === draft.groupsSequence) {
        draft.groupsPending = false;
        draft.groupsController = null;
        if (entry === currentEntry()) render();
      }
    }
  }

  async function getRecipe(engine, method = "describe") {
    const key = `${engine}:${method}`;
    if (!recipes.has(key)) {
      const query = method === "describe" ? "" : `?method=${encodeURIComponent(method)}`;
      recipes.set(key, adapter.api(`/api/v1/analysis/recipes/${encodeURIComponent(engine)}${query}`).catch((error) => {
        recipes.delete(key);
        throw error;
      }));
    }
    return recipes.get(key);
  }

  async function previewTtest(entry) {
    const dataset = selectedDataset(entry);
    const draft = ttestDraft(entry);
    const documentId = currentId;
    if (!entry || !dataset || !draft || !documentId || entry.confirmation?.pending) return;
    let confirmation = entry.confirmation?.method === "ttest_independent" ? entry.confirmation : null;
    if (confirmation) confirmation.preview = null;
    entry.status = { key: "previewing", kind: "info" };
    render();
    try {
      if (!methodCatalog) await discoverMethods(entry);
      const info = methodInfo(entry, "ttest_independent");
      if (!info?.available || !info.library?.available) throw new Error("library_unavailable");
      if (!confirmation) {
        if (!ttestReady(entry, draft)) throw new Error("ttest_preview_required");
        const recipe = await getRecipe("r", "ttest_independent");
        if (entry !== currentEntry() || currentId !== documentId || ttestDraft(entry) !== draft) return;
        if (recipe.sha256 !== info.recipe_sha256) throw new Error("recipeMismatch");
        const requestId = crypto.randomUUID();
        const body = {
          request_id: requestId,
          dataset_id: dataset.id,
          dataset_sha256: dataset.sha256,
          engine: "r",
          columns: [draft.outcome],
          recipe_sha256: recipe.sha256,
          method: "ttest_independent",
          library_sha256: info.library.sha256,
          ttest: {
            group_column: draft.groupColumn,
            groups: [draft.group1, draft.group2],
            variant: draft.variant,
            alternative: draft.alternative,
            confidence: draft.confidence,
            missing: "complete_cases",
            independent_samples_confirmed: true
          }
        };
        confirmation = {
          method: "ttest_independent",
          documentId,
          datasetId: dataset.id,
          datasetName: dataset.original_filename,
          datasetHash: dataset.sha256,
          engine: "r",
          recipe,
          requestId,
          body,
          preview: null,
          phase: "preview",
          pending: false,
          runFailed: false
        };
        entry.confirmation = confirmation;
      }
      confirmation.phase = "preview";
      confirmation.pending = true;
      entry.status = { key: "previewing", kind: "info" };
      render();
      const preview = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/analyses/ttest/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmation.body)
      });
      if (entry.confirmation !== confirmation || ttestDraft(entry) !== draft) return;
      if (preview?.saved !== false || JSON.stringify(canonical(preview.parameters)) !== JSON.stringify(canonical(confirmation.body)) ||
        preview.recipe?.sha256 !== confirmation.body.recipe_sha256 || preview.library?.sha256 !== confirmation.body.library_sha256 ||
        !preview.counts || !Array.isArray(preview.stats)) throw new Error("previewFailed");
      confirmation.preview = preview;
      confirmation.pending = false;
      entry.status = { key: "previewReady", kind: "success" };
    } catch (error) {
      const currentAttempt = confirmation
        ? entry.confirmation === confirmation
        : !entry.confirmation && entry === currentEntry() && currentId === documentId;
      if (currentAttempt && ttestDraft(entry) === draft) {
        if (confirmation) {
          confirmation.preview = null;
          confirmation.pending = false;
        }
        entry.status = { key: error.code || error.message || "previewFailed", kind: "error", retry: () => previewTtest(entry) };
      }
    }
    if (entry === currentEntry()) render();
  }

  async function prepare(entry) {
    const documentId = currentId;
    const dataset = selectedDataset(entry);
    const info = engineInfo(entry);
    const engine = entry.engine;
    const columns = [...entry.selectedColumns];
    if (entry.method !== "describe" || !dataset || !columns.length || !info?.available || entry.confirmation?.pending) return;
    entry.status = { key: "preparing", kind: "info" };
    render();
    const unchanged = () => entry === currentEntry() && currentId === documentId && selectedDataset(entry)?.id === dataset.id && entry.engine === engine && columns.length === entry.selectedColumns.size && columns.every((column) => entry.selectedColumns.has(column));
    try {
      const recipe = await getRecipe(engine);
      if (!unchanged()) return;
      if (recipe.sha256 !== info.recipe_sha256) {
        entry.status = { key: "recipeMismatch", kind: "error", retry: () => prepare(entry) };
      } else {
        entry.confirmation = {
          documentId,
          datasetId: dataset.id,
          datasetName: dataset.original_filename,
          datasetHash: dataset.sha256,
          columns,
          engine,
          recipe,
          requestId: null,
          pending: false
        };
        entry.status = null;
      }
    } catch (error) {
      if (unchanged()) entry.status = { key: error.code || "prepareFailed", kind: "error", retry: () => prepare(entry) };
    }
    if (entry === currentEntry()) render();
  }

  async function confirmRun(entry) {
    const confirmation = entry.confirmation;
    if (!confirmation || confirmation.pending || confirmation.method === "ttest_independent" && !confirmation.preview) return;
    const documentId = confirmation.documentId;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const requestSequence = ++entry.jobRequestSequence;
    entry.datasetRequestSequence += 1;
    const isTTest = confirmation.method === "ttest_independent";
    if (!confirmation.requestId) confirmation.requestId = crypto.randomUUID();
    const body = isTTest ? confirmation.body : {
      request_id: confirmation.requestId,
      dataset_id: confirmation.datasetId,
      dataset_sha256: confirmation.datasetHash,
      engine: confirmation.engine,
      columns: [...confirmation.columns],
      recipe_sha256: confirmation.recipe.sha256
    };
    confirmation.phase = "run";
    confirmation.pending = true;
    confirmation.runFailed = false;
    entry.status = { key: "runningRequest", kind: "info" };
    render();
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}/analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (![200, 201].includes(response.status)) throw new Error("request_failed");
      const job = await response.json();
      entry.jobVersion += 1;
      entry.jobs = [job, ...entry.jobs.filter((item) => item.id !== job.id)];
      entry.jobDetails.set(job.id, job);
      if (entry.confirmation === confirmation) entry.confirmation = null;
      if (requestSequence === entry.jobRequestSequence && navigationGeneration === adapter.getNavigationGeneration?.()) {
        if (entry.selectedJobId !== job.id) notebook.close({ restoreFocus: false });
        entry.selectedJobId = job.id;
        adapter.contextChanged?.();
        entry.status = {
          key: job.status === "queued" ? "queuedReceipt" : job.status,
          kind: job.status === "succeeded" ? "success" : ["failed", "cancelled", "interrupted"].includes(job.status) ? "error" : "info"
        };
        adapter.onJobOpened?.(documentId, job.id);
      } else if (entry.status?.key === "runningRequest") {
        entry.status = null;
      }
      if (job.status === "succeeded") adapter.sourcesChanged?.(documentId);
      schedulePolling(entry);
    } catch (error) {
      confirmation.pending = false;
      confirmation.runFailed = true;
      entry.status = { key: error.code || "network", kind: "error", retry: () => confirmRun(entry) };
    }
    if (entry === currentEntry()) render();
  }

  function stopPolling(entry) {
    entry.pollToken += 1;
    if (entry.pollTimer) clearTimeout(entry.pollTimer);
    entry.pollTimer = null;
    entry.polling = false;
  }

  function schedulePolling(entry) {
    if (entry !== currentEntry() || entry.polling || !entry.jobs.some((job) => ACTIVE_JOBS.has(job.status))) return;
    entry.polling = true;
    const token = ++entry.pollToken;
    const poll = async () => {
      if (token !== entry.pollToken || entry !== currentEntry()) return;
      const active = entry.jobs.filter((job) => ACTIVE_JOBS.has(job.status));
      if (!active.length) {
        stopPolling(entry);
        render();
        return;
      }
      const results = await Promise.allSettled(active.map((job) => adapter.api(`/api/v1/documents/${encodeURIComponent(currentId)}/analyses/${encodeURIComponent(job.id)}`)));
      if (token !== entry.pollToken || entry !== currentEntry()) return;
      let failed = false;
      let completed = false;
      if (results.some((result) => result.status === "fulfilled")) entry.jobVersion += 1;
      for (const result of results) {
        if (result.status === "fulfilled") {
          const job = result.value;
          const previous = entry.jobs.find((item) => item.id === job.id);
          if (previous?.status !== job.status) entry.logs.delete(job.id);
          if (job.status === "succeeded" && previous?.status !== "succeeded") completed = true;
          entry.jobs = entry.jobs.map((item) => item.id === job.id ? job : item);
          entry.jobDetails.set(job.id, job);
        } else {
          failed = true;
        }
      }
      if (completed) adapter.sourcesChanged?.(currentId);
      if (failed) entry.status = { key: "network", kind: "error", retry: () => schedulePolling(entry) };
      else if (entry.status?.key === "network") entry.status = null;
      render();
      if (elements.log.open && entry.selectedJobId) loadLog(entry, jobFor(entry, entry.selectedJobId));
      if (entry.jobs.some((job) => ACTIVE_JOBS.has(job.status))) entry.pollTimer = setTimeout(poll, failed ? 2000 : 1000);
      else stopPolling(entry);
    };
    poll();
  }

  async function cancelJob(entry, job) {
    if (!ACTIVE_JOBS.has(job.status) || entry.cancelling.has(job.id)) return;
    const documentId = currentId;
    entry.cancelling.add(job.id);
    render();
    try {
      const updated = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/analyses/${encodeURIComponent(job.id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      entry.jobVersion += 1;
      entry.logs.delete(updated.id);
      entry.jobs = entry.jobs.map((item) => item.id === updated.id ? updated : item);
      entry.jobDetails.set(updated.id, updated);
    } catch (error) {
      entry.status = { key: error.code || "request_failed", kind: "error" };
    } finally {
      entry.cancelling.delete(job.id);
      if (entry === currentEntry()) render();
    }
  }

  async function exportJob(entry, job) {
    if (job.status !== "succeeded" || !job.export_url || entry.exporting.has(job.id)) return;
    entry.exporting.add(job.id);
    entry.status = { key: "exporting", kind: "info" };
    render();
    try {
      const response = await adapter.checkedFetch(job.export_url);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `analysis-${job.id}.zip`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      entry.status = { key: "exported", kind: "success" };
    } catch (error) {
      entry.status = { key: error.code || "request_failed", kind: "error", retry: () => exportJob(entry, job) };
    } finally {
      entry.exporting.delete(job.id);
      if (entry === currentEntry()) render();
    }
  }

  async function loadLog(entry, job) {
    if (!job || entry.logs.has(job.id)) return;
    const documentId = currentId;
    try {
      const log = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/analyses/${encodeURIComponent(job.id)}/log`);
      entry.logs.set(job.id, log);
    } catch (error) {
      entry.logs.set(job.id, { text: errorText(error), truncated: false });
    }
    if (entry === currentEntry() && entry.selectedJobId === job.id) renderResult(entry);
  }

  function selectDataset(entry, dataset, options = {}) {
    if (!entry || !dataset) return;
    const changed = entry.selectedDatasetId !== dataset.id;
    entry.datasetRequestSequence += 1;
    entry.jobRequestSequence += 1;
    entry.selectedDatasetId = dataset.id;
    if (changed || options.resetColumns) {
      entry.selectedColumns = new Set((dataset.columns || []).filter((column) => column.numeric).map((column) => column.name));
    }
    if (changed) entry.shared = false;
    if (!options.preserveConfirmation) invalidateConfirmation(entry);
    adapter.contextChanged?.();
    const documentId = options.documentId || (entry === currentEntry() ? currentId : null);
    if (documentId) adapter.datasetContextChanged?.(documentId, dataset.id, options.analysisId || null);
  }

  async function openJob(jobId, options = {}) {
    const entry = currentEntry();
    if (!entry) return;
    const documentId = currentId;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const requestSequence = ++entry.jobRequestSequence;
    entry.datasetRequestSequence += 1;
    const isCurrent = () => entry === currentEntry() && requestSequence === entry.jobRequestSequence && entry.selectedJobId === jobId && navigationGeneration === adapter.getNavigationGeneration?.();
    elements.panel.open = true;
    if (entry.selectedJobId !== jobId) notebook.close({ restoreFocus: false });
    entry.selectedJobId = jobId;
    adapter.contextChanged?.();
    if (!options.preserveUrl) adapter.onJobOpened?.(documentId, jobId);
    render();
    let job = jobFor(entry, jobId);
    if (job && ACTIVE_JOBS.has(job.status)) entry.logs.delete(job.id);
    if (!job) {
      try {
        job = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/analyses/${encodeURIComponent(jobId)}`);
        if (!isCurrent()) return;
        entry.jobVersion += 1;
        entry.jobs = [job, ...entry.jobs.filter((item) => item.id !== job.id)];
        entry.jobDetails.set(job.id, job);
      } catch (error) {
        if (isCurrent()) entry.status = { key: error.code || "not_found", kind: "error" };
      }
    }
    if (isCurrent()) {
      let dataset = entry.datasets.find((item) => item.id === job?.dataset_id);
      if (job?.dataset_id && !dataset) {
        try {
          dataset = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/datasets/${encodeURIComponent(job.dataset_id)}`);
          if (!isCurrent()) return;
          entry.datasets = [dataset, ...entry.datasets.filter((item) => item.id !== dataset.id)];
        } catch {
          dataset = null;
        }
      }
      if (!isCurrent()) return;
      if (dataset) selectDataset(entry, dataset, { preserveConfirmation: true, analysisId: job.id });
      adapter.contextChanged?.();
      render();
      schedulePolling(entry);
      if (elements.log.open && entry.selectedJobId === jobId) loadLog(entry, jobFor(entry, jobId));
      if (!options.preserveFocus) elements.result.scrollIntoView({ block: "nearest" });
    }
  }

  async function openDataset(datasetId, options = {}) {
    const entry = currentEntry();
    if (!entry || !datasetId) return;
    const documentId = currentId;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const requestSequence = ++entry.datasetRequestSequence;
    entry.jobRequestSequence += 1;
    const isCurrent = () => entry === currentEntry() && requestSequence === entry.datasetRequestSequence && navigationGeneration === adapter.getNavigationGeneration?.();
    elements.panel.open = true;
    let dataset = entry.datasets.find((item) => item.id === datasetId);
    if (!dataset) {
      try {
        dataset = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/datasets/${encodeURIComponent(datasetId)}`);
        if (!isCurrent()) return;
        entry.datasets = [dataset, ...entry.datasets.filter((item) => item.id !== dataset.id)];
      } catch (error) {
        if (isCurrent()) entry.status = { key: error.code || "not_found", kind: "error" };
      }
    }
    if (dataset && isCurrent()) {
      selectDataset(entry, dataset, { resetColumns: true, preserveConfirmation: options.preserveConfirmation });
      if (!options.preserveUrl) adapter.onDatasetOpened?.(documentId, dataset.id);
      render();
      if (!options.preserveFocus) elements.datasetSelect.focus();
    }
  }

  function openImportedDataset(documentId, dataset, options = {}) {
    if (!documentId || !dataset?.id) return;
    const entry = entryFor(documentId);
    entry.datasets = [dataset, ...entry.datasets.filter((item) => item.id !== dataset.id)];
    if (options.select !== false) selectDataset(entry, dataset, { resetColumns: true, documentId });
    if (entry === currentEntry()) render();
  }

  function uploadDataset(entry) {
    const upload = entry?.upload;
    const documentId = currentId;
    if (!entry || !upload || upload.pending) return;
    const file = upload.file;
    upload.pending = true;
    upload.progress = 0;
    upload.status = { key: "uploading", kind: "info", values: { progress: 0 } };
    renderUpload(entry);
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("request_id", upload.requestId);
    const request = new XMLHttpRequest();
    request.open("POST", `/api/v1/documents/${encodeURIComponent(documentId)}/datasets`);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || entry.upload !== upload) return;
      upload.progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
      upload.status = { key: "uploading", kind: "info", values: { progress: upload.progress } };
      if (entry === currentEntry()) renderUpload(entry);
    });
    request.addEventListener("load", () => {
      if (entry.upload !== upload) return;
      let body = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }
      if (request.status === 200 || request.status === 201) {
        if (!body) {
          upload.pending = false;
          upload.status = { key: "uploadRetry", kind: "error", retry: true };
        } else {
          entry.datasets = [body, ...entry.datasets.filter((item) => item.id !== body.id)];
          entry.datasetRequestSequence += 1;
          entry.selectedDatasetId = body.id;
          entry.selectedColumns = new Set((body.columns || []).filter((column) => column.numeric).map((column) => column.name));
          entry.shared = false;
          entry.upload = null;
          invalidateConfirmation(entry);
          adapter.contextChanged?.();
          adapter.datasetContextChanged?.(documentId, body.id);
          adapter.sourcesChanged?.(documentId);
          if (entry === currentEntry()) render();
        }
      } else {
        upload.pending = false;
        upload.status = { key: body?.detail?.code || "uploadRetry", kind: "error", retry: true };
        if (entry === currentEntry()) renderUpload(entry);
      }
    });
    request.addEventListener("error", () => {
      if (entry.upload !== upload) return;
      upload.pending = false;
      upload.status = { key: "uploadRetry", kind: "error", retry: true };
      if (entry === currentEntry()) renderUpload(entry);
    });
    request.addEventListener("abort", () => {
      if (entry.upload !== upload) return;
      upload.pending = false;
      upload.status = { key: "uploadRetry", kind: "error", retry: true };
      if (entry === currentEntry()) renderUpload(entry);
    });
    request.send(form);
  }

  async function reload(documentId) {
    if (currentId && currentId !== documentId) stopPolling(entryFor(currentId));
    if (currentId !== documentId) notebook.close({ restoreFocus: false });
    currentId = documentId || null;
    const entry = currentEntry();
    if (!entry) {
      render();
      return;
    }
    stopPolling(entry);
    const sequence = ++entry.loadSequence;
    const jobVersion = entry.jobVersion;
    const datasetRequestSequence = entry.datasetRequestSequence;
    entry.loadController?.abort();
    const controller = new AbortController();
    entry.loadController = controller;
    entry.status = { key: "loading", kind: "info" };
    render();
    const base = `/api/v1/documents/${encodeURIComponent(documentId)}`;
    const [runtime, datasets, jobs] = await Promise.allSettled([
      adapter.api("/api/v1/analysis/status", { signal: controller.signal }),
      adapter.api(`${base}/datasets`, { signal: controller.signal }),
      adapter.api(`${base}/analyses`, { signal: controller.signal })
    ]);
    if (sequence !== entry.loadSequence || entry !== currentEntry()) return;
    if (runtime.status === "fulfilled") entry.runtime = runtime.value;
    else entry.runtime = null;
    if (datasets.status === "fulfilled") {
      const fetched = Array.isArray(datasets.value.items) ? datasets.value.items : [];
      if (datasetRequestSequence === entry.datasetRequestSequence) {
        entry.datasets = fetched;
      } else {
        const current = new Map(entry.datasets.map((dataset) => [dataset.id, dataset]));
        const fetchedIds = new Set(fetched.map((dataset) => dataset.id));
        entry.datasets = [
          ...fetched.map((dataset) => current.get(dataset.id) || dataset),
          ...entry.datasets.filter((dataset) => !fetchedIds.has(dataset.id))
        ];
      }
      if (datasetRequestSequence === entry.datasetRequestSequence && !entry.datasets.some((dataset) => dataset.id === entry.selectedDatasetId)) {
        entry.datasetRequestSequence += 1;
        entry.selectedDatasetId = entry.datasets[0]?.id || null;
        entry.selectedColumns = new Set((entry.datasets[0]?.columns || []).filter((column) => column.numeric).map((column) => column.name));
        entry.shared = false;
        invalidateConfirmation(entry);
        adapter.contextChanged?.();
        adapter.datasetContextChanged?.(documentId, entry.selectedDatasetId);
      }
    }
    if (jobs.status === "fulfilled") {
      const fetched = Array.isArray(jobs.value.items) ? jobs.value.items : [];
      if (jobVersion === entry.jobVersion) {
        entry.jobs = fetched;
      } else {
        const current = new Map(entry.jobs.map((job) => [job.id, job]));
        const fetchedIds = new Set(fetched.map((job) => job.id));
        entry.jobs = [
          ...fetched.map((job) => current.get(job.id) || job),
          ...entry.jobs.filter((job) => !fetchedIds.has(job.id))
        ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      }
      if (entry.selectedJobId && !entry.jobs.some((job) => job.id === entry.selectedJobId)) {
        notebook.close({ restoreFocus: false });
        entry.selectedJobId = null;
        adapter.contextChanged?.();
      }
    }
    const failed = [runtime, datasets, jobs].find((result) => result.status === "rejected" && result.reason?.name !== "AbortError");
    entry.status = failed
      ? { key: failed.reason?.code || (runtime === failed ? "statusFailed" : "loadFailed"), kind: "error", retry: () => reload(documentId) }
      : null;
    entry.loadController = null;
    render();
    if (elements.panel.open) discoverMethods(entry);
    schedulePolling(entry);
  }

  elements.panel.addEventListener("toggle", () => {
    const entry = currentEntry();
    if (elements.panel.open && entry) discoverMethods(entry);
  });
  elements.method.addEventListener("change", () => {
    const entry = currentEntry();
    if (!entry) return;
    entry.method = elements.method.value === "ttest_independent" ? "ttest_independent" : "describe";
    invalidateConfirmation(entry);
    if (entry.method === "ttest_independent") discoverMethods(entry);
    render();
  });
  elements.ttestOutcome.addEventListener("change", () => {
    const entry = currentEntry();
    const draft = ttestDraft(entry);
    if (!draft) return;
    draft.outcome = elements.ttestOutcome.value;
    if (draft.groupColumn === draft.outcome) draft.groupColumn = "";
    clearTtestGroups(draft);
    invalidateConfirmation(entry);
    render();
  });
  elements.ttestGroupColumn.addEventListener("change", () => {
    const entry = currentEntry();
    const draft = ttestDraft(entry);
    if (!draft) return;
    draft.groupColumn = elements.ttestGroupColumn.value;
    clearTtestGroups(draft);
    invalidateConfirmation(entry);
    render();
  });
  elements.ttestGroupsLoad.addEventListener("click", () => {
    const entry = currentEntry();
    loadTtestGroups(entry, ttestDraft(entry));
  });
  for (const [control, field] of [[elements.ttestGroup1, "group1"], [elements.ttestGroup2, "group2"], [elements.ttestVariant, "variant"], [elements.ttestAlternative, "alternative"]]) {
    control.addEventListener("change", () => {
      const entry = currentEntry();
      const draft = ttestDraft(entry);
      if (!draft) return;
      draft[field] = control.value;
      invalidateConfirmation(entry);
      render();
    });
  }
  elements.ttestConfidence.addEventListener("input", () => {
    const entry = currentEntry();
    const draft = ttestDraft(entry);
    if (!draft) return;
    draft.confidence = Number(elements.ttestConfidence.value);
    invalidateConfirmation(entry);
    render();
  });
  elements.ttestIndependent.addEventListener("change", () => {
    const entry = currentEntry();
    const draft = ttestDraft(entry);
    if (!draft) return;
    draft.independentConfirmed = elements.ttestIndependent.checked;
    invalidateConfirmation(entry);
    render();
  });
  elements.ttestPreview.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry) previewTtest(entry);
  });
  elements.uploadButton.addEventListener("click", () => elements.uploadInput.click());
  elements.uploadInput.addEventListener("change", () => {
    const entry = currentEntry();
    const file = elements.uploadInput.files?.[0];
    elements.uploadInput.value = "";
    if (!entry || !file) return;
    if (/\.(sav|zsav)$/i.test(file.name)) {
      adapter.startImport?.(file);
      return;
    }
    const validExtension = /\.(csv|tsv)$/i.test(file.name);
    if (!validExtension) {
      entry.upload = { file, requestId: crypto.randomUUID(), pending: false, status: { key: "invalidDatasetType", kind: "error" } };
      renderUpload(entry);
      return;
    }
    entry.upload = {
      file,
      requestId: crypto.randomUUID(),
      pending: false,
      status: file.size > 5 * 1024 * 1024
        ? { key: "dataset_too_large", kind: "error" }
        : null
    };
    if (!entry.upload.status) uploadDataset(entry);
    else renderUpload(entry);
  });
  elements.datasetSelect.addEventListener("change", () => {
    const entry = currentEntry();
    if (!entry) return;
    entry.datasetRequestSequence += 1;
    entry.jobRequestSequence += 1;
    entry.selectedDatasetId = elements.datasetSelect.value || null;
    entry.selectedColumns = new Set((selectedDataset(entry)?.columns || []).filter((column) => column.numeric).map((column) => column.name));
    entry.shared = false;
    invalidateConfirmation(entry);
    adapter.contextChanged?.();
    adapter.datasetContextChanged?.(currentId, entry.selectedDatasetId);
    render();
  });
  elements.share.addEventListener("change", () => {
    const entry = currentEntry();
    if (!entry) return;
    entry.shared = elements.share.checked;
    adapter.contextChanged?.();
    render();
  });
  elements.engine.addEventListener("change", () => {
    const entry = currentEntry();
    if (!entry) return;
    entry.engine = elements.engine.value === "r" ? "r" : "python";
    invalidateConfirmation(entry);
    render();
  });
  elements.prepare.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry) prepare(entry);
  });
  elements.confirm.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry) confirmRun(entry);
  });
  elements.cancelConfirm.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry?.confirmation && !entry.confirmation.pending) {
      entry.confirmation = null;
      entry.status = null;
      render();
      (entry.method === "ttest_independent" ? elements.ttestPreview : elements.prepare).focus();
    }
  });
  elements.log.addEventListener("toggle", () => {
    const entry = currentEntry();
    if (elements.log.open && entry?.selectedJobId) loadLog(entry, jobFor(entry, entry.selectedJobId));
  });

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.panel.querySelector("summary").textContent = t("panel");
      elements.panel.querySelector(".analysis-help").textContent = t("help");
      elements.panel.querySelector('label[for="dataset-select"]').textContent = t("selectDataset");
      elements.panel.querySelector('label[for="analysis-method"]').textContent = t("method");
      elements.panel.querySelector('label[for="analysis-engine"]').textContent = t("engine");
      elements.panel.querySelector('label[for="ttest-outcome"]').textContent = t("outcome");
      elements.panel.querySelector('label[for="ttest-group-column"]').textContent = t("groupColumn");
      elements.panel.querySelector('label[for="ttest-group1"]').textContent = t("group1");
      elements.panel.querySelector('label[for="ttest-group2"]').textContent = t("group2");
      elements.panel.querySelector('label[for="ttest-variant"]').textContent = t("variant");
      elements.panel.querySelector('label[for="ttest-alternative"]').textContent = t("alternative");
      elements.panel.querySelector('label[for="ttest-confidence"]').textContent = t("confidence");
      elements.ttestVariant.querySelector('option[value="welch"]').textContent = t("welch");
      elements.ttestVariant.querySelector('option[value="student"]').textContent = t("student");
      elements.ttestAlternative.querySelector('option[value="two_sided"]').textContent = t("two_sided");
      elements.ttestAlternative.querySelector('option[value="greater"]').textContent = t("greater");
      elements.ttestAlternative.querySelector('option[value="less"]').textContent = t("less");
      elements.ttestIndependent.nextElementSibling.textContent = t("independentLabel");
      elements.ttestOptions.querySelector(".ttest-assumptions").textContent = t("assumptions");
      elements.ttestOptions.setAttribute("aria-label", t("ttestIndependent"));
      elements.confirmation.setAttribute("aria-label", t("confirmation"));
      elements.result.setAttribute("aria-label", t("jobs"));
      notebook.applyLanguage(nextLanguage);
      render();
    },
    getSelectedDatasetId() {
      return selectedDataset(currentEntry())?.id || null;
    },
    refreshUpload() {
      renderUpload(currentEntry());
    },
    getSharedDatasetId() {
      const entry = currentEntry();
      return entry?.shared && selectedDataset(entry) ? entry.selectedDatasetId : null;
    },
    getActiveAnalysisId() {
      const entry = currentEntry();
      const sharedDatasetId = entry?.shared && selectedDataset(entry) ? entry.selectedDatasetId : null;
      const job = jobFor(entry, entry?.selectedJobId);
      return sharedDatasetId && job?.dataset_id === sharedDatasetId ? job.id : null;
    },
    reload,
    openJob,
    openDataset,
    alignDataset(datasetId) {
      return openDataset(datasetId, { preserveConfirmation: true, preserveFocus: true, preserveUrl: true });
    },
    openImportedDataset,
    getRecipe
  };
}
