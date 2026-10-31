const MAX_FILE_BYTES = 5 * 1024 * 1024;

const messages = {
  zh: {
    heading: "SPSS 导入",
    help: "保留原始文件，核对字段和缺失处理后再确认。",
    upload: "导入 SPSS",
    uploading: "正在导入 SPSS…",
    imports: "导入记录",
    noImports: "尚无 SPSS 导入。",
    pending: "待核对",
    confirmed: "已确认",
    review: "SPSS 导入核对",
    original: "下载原始文件",
    file: "原始文件",
    status: "状态",
    rows: "行数",
    columns: "列数",
    bytes: "字节数",
    dictionary: "字段字典",
    rawPreview: "原始预览",
    analysisPreview: "分析预览",
    policy: "固定转换：编码保持为编码，不用值标签替换；系统缺失和声明的用户缺失在分析预览中为空；文本保留；日期和时间使用 ISO 文本。不会自动推断研究角色。",
    acknowledge: "我已核对字段含义、分组编码和缺失规则。",
    confirm: "确认并加入数据",
    defer: "稍后核对 / 返回",
    reviewSelected: "查看核对",
    confirming: "正在确认…",
    retryConfirm: "按原核对结果重试确认",
    name: "字段名",
    label: "标签",
    sourceType: "来源类型",
    sourceTypeDouble: "数值",
    sourceTypeString: "文本",
    sourceTypeDateTime: "日期和时间",
    format: "格式",
    measure: "测量级别",
    measureNominal: "名义（无序类别）",
    measureOrdinal: "有序（有序类别）",
    measureScale: "度量（数值测量）",
    measureUnknown: "未知（未指定）",
    valueLabels: "值标签（值 → 标签）",
    missingRanges: "缺失范围",
    systemMissing: "系统缺失",
    userMissing: "用户缺失",
    blankMissing: "空白缺失",
    nonmissing: "非缺失数",
    yes: "是",
    no: "否",
    sampleTruncated: "仅显示前 5 行预览；原始文件和字段字典仍可核对。",
    statusLoading: "正在检查 SPSS 导入是否可用…",
    unavailable: "SPSS 导入当前不可用。已有待核对记录仍可查看和确认。",
    statusFailed: "无法检查 SPSS 导入是否可用，请重试。已有记录仍可查看和确认。",
    loading: "正在加载 SPSS 导入记录…",
    loadFailed: "无法加载 SPSS 导入记录，请重试。",
    detailFailed: "无法加载这条导入的核对信息，请重试。",
    imported: "导入已完成，尚未加入数据。请核对后明确确认。",
    uploadRetry: "导入结果不确定。已保留原文件和请求标识，可按原请求重试。",
    confirmedReceipt: "已确认并加入数据；助手共享保持关闭。",
    confirmRetry: "确认结果不确定。已冻结本次核对内容，可按原请求重试，不会重复分析。",
    invalidType: "请选择 SAV 或 ZSAV 文件。",
    spss_too_large: "SPSS 原始文件不能超过 5 MiB。",
    file_too_large: "SPSS 原始文件不能超过 5 MiB。",
    import_too_large: "SPSS 原始文件或转换后的数据超过限制。",
    invalid_spss: "无法读取此 SPSS 文件，请选择有效的 SAV 或 ZSAV 文件。",
    invalid_spss_type: "请选择 SAV 或 ZSAV 文件。",
    import_unavailable: "SPSS 导入当前不可用。已有待核对记录仍可查看和确认。",
    import_limit: "此文献的 SPSS 导入数量或存储空间已达上限。",
    import_changed: "导入记录已变化。请重新导入并核对。",
    import_quota: "SPSS 导入数量已达上限。请减少现有导入记录后再试。",
    dataset_quota: "数据集数量已达上限。请减少现有数据集后再试。",
    dataset_too_large: "转换后的数据集超过大小限制。请减少数据量后重新导入。",
    parser_busy: "SPSS 解析服务正忙。请稍后重试导入。",
    parser_timeout: "SPSS 文件解析超时。请稍后重试，或改用较小的文件。",
    parser_failed: "无法解析此 SPSS 文件。请检查文件是否有效后重试。",
    review_changed: "核对内容已变化。请重新加载、核对并再次确认。",
    source_changed: "原始文件已变化。请重新导入并核对。",
    validation_error: "导入或确认请求无效，请重新核对。",
    idempotency_conflict: "请求标识发生冲突，原请求未被改写。请重新选择文件。",
    not_found: "这条导入记录不存在或已被删除。",
    storage_unavailable: "本地存储暂时不可用，请稍后重试。",
    network: "无法连接本地服务。原请求和选择已保留。",
    request_failed: "操作未完成，请重试。",
    retry: "重试"
  },
  en: {
    heading: "SPSS imports",
    help: "Keep the original file and review fields and missing-value handling before confirming.",
    upload: "Import SPSS",
    uploading: "Importing SPSS…",
    imports: "Imports",
    noImports: "No SPSS imports yet.",
    pending: "Needs review",
    confirmed: "Confirmed",
    review: "SPSS import review",
    original: "Download original",
    file: "Original file",
    status: "Status",
    rows: "Rows",
    columns: "Columns",
    bytes: "Bytes",
    dictionary: "Field dictionary",
    rawPreview: "Raw preview",
    analysisPreview: "Analysis preview",
    policy: "Fixed conversion: codes remain codes and are not replaced by value labels; system and declared user missing values become empty analysis cells; text is preserved; dates and times use ISO text. No research roles are inferred automatically.",
    acknowledge: "I have checked the field meanings, group codes, and missing-value rules.",
    confirm: "Confirm and add to data",
    defer: "Review later / Back",
    reviewSelected: "Review selected import",
    confirming: "Confirming…",
    retryConfirm: "Retry the same reviewed confirmation",
    name: "Name",
    label: "Label",
    sourceType: "Source type",
    sourceTypeDouble: "Numeric",
    sourceTypeString: "Text",
    sourceTypeDateTime: "Date and time",
    format: "Format",
    measure: "Measure",
    measureNominal: "Nominal (unordered categories)",
    measureOrdinal: "Ordinal (ordered categories)",
    measureScale: "Scale (numeric measurement)",
    measureUnknown: "Unknown (unspecified)",
    valueLabels: "Value labels (value → label)",
    missingRanges: "Missing ranges",
    systemMissing: "System missing",
    userMissing: "User missing",
    blankMissing: "Blank missing",
    nonmissing: "Nonmissing",
    yes: "Yes",
    no: "No",
    sampleTruncated: "Only the first 5 preview rows are shown; the original and field dictionary remain available for review.",
    statusLoading: "Checking SPSS import availability…",
    unavailable: "SPSS import is currently unavailable. Existing reviews can still be opened and confirmed.",
    statusFailed: "SPSS import availability could not be checked. Try again. Existing reviews remain available.",
    loading: "Loading SPSS imports…",
    loadFailed: "SPSS imports could not be loaded. Try again.",
    detailFailed: "This import’s review could not be loaded. Try again.",
    imported: "Import complete; it has not been added to data. Review it and explicitly confirm.",
    uploadRetry: "The import outcome is uncertain. The original file and request ID are retained for an exact retry.",
    confirmedReceipt: "Confirmed and added to data; assistant sharing remains off.",
    confirmRetry: "The confirmation outcome is uncertain. This review is frozen for an exact retry; no analysis will be repeated.",
    invalidType: "Choose a SAV or ZSAV file.",
    spss_too_large: "The SPSS original must be no larger than 5 MiB.",
    file_too_large: "The SPSS original must be no larger than 5 MiB.",
    import_too_large: "The SPSS original or converted data exceeds the size limit.",
    invalid_spss: "This SPSS file could not be read. Choose a valid SAV or ZSAV file.",
    invalid_spss_type: "Choose a SAV or ZSAV file.",
    import_unavailable: "SPSS import is currently unavailable. Existing reviews can still be opened and confirmed.",
    import_limit: "This paper has reached its SPSS import count or storage limit.",
    import_changed: "The import changed. Import and review the file again.",
    import_quota: "The SPSS import limit has been reached. Reduce the existing imports and try again.",
    dataset_quota: "The dataset limit has been reached. Reduce the existing datasets and try again.",
    dataset_too_large: "The converted dataset exceeds the size limit. Reduce the amount of data and import it again.",
    parser_busy: "The SPSS parser is busy. Try the import again shortly.",
    parser_timeout: "The SPSS file took too long to parse. Try again or use a smaller file.",
    parser_failed: "The SPSS file could not be parsed. Check that the file is valid and try again.",
    review_changed: "The review changed. Reload, review it again, and then confirm.",
    source_changed: "The original file changed. Import and review it again.",
    validation_error: "The import or confirmation request is invalid. Review it again.",
    idempotency_conflict: "The request ID conflicted; the original request was not changed. Choose the file again.",
    not_found: "This import no longer exists.",
    storage_unavailable: "Local storage is temporarily unavailable. Try again shortly.",
    network: "Cannot connect to the local service. The original request and choices are retained.",
    request_failed: "The action was not completed. Try again.",
    retry: "Retry"
  }
};

export function createDataImports(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    section: byId("data-imports"),
    heading: byId("data-imports-heading"),
    help: byId("data-imports-help"),
    selectLabel: byId("spss-import-select-label"),
    select: byId("spss-import-select"),
    status: byId("spss-import-status"),
    review: byId("spss-import-review"),
    summary: byId("spss-import-summary"),
    original: byId("spss-import-original"),
    policy: byId("spss-import-policy"),
    dictionary: byId("spss-import-dictionary"),
    dictionaryContent: byId("spss-import-dictionary-content"),
    raw: byId("spss-import-raw"),
    rawContent: byId("spss-import-raw-content"),
    analysis: byId("spss-import-analysis"),
    analysisContent: byId("spss-import-analysis-content"),
    sampleNote: byId("spss-import-sample-note"),
    ackLabel: byId("spss-import-ack-label"),
    ack: byId("spss-import-ack"),
    confirm: byId("spss-import-confirm"),
    defer: byId("spss-import-defer")
  };
  elements.open = make("button", "button button-quiet");
  elements.open.id = "spss-import-open";
  elements.open.type = "button";
  elements.select.after(elements.open);
  const papers = new Map();
  let language = adapter.getLanguage();
  let currentId = null;
  let availability = null;
  let availabilityPending = false;
  let availabilitySequence = 0;
  let availabilityStatus = null;

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

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function entryFor(documentId) {
    if (!papers.has(documentId)) {
      papers.set(documentId, {
        documentId,
        items: [],
        selectedImportId: null,
        acknowledged: false,
        upload: null,
        confirmation: null,
        reviewOpen: false,
        status: null,
        loadSequence: 0,
        detailSequence: 0,
        loadController: null,
        detailController: null,
        detailPending: false
      });
    }
    return papers.get(documentId);
  }

  function currentEntry() {
    return currentId ? entryFor(currentId) : null;
  }

  function selectedImport(entry) {
    return entry?.items.find((item) => item.id === entry.selectedImportId) || null;
  }

  function isAmbiguous(error) {
    return !error?.code || ["network", "request_failed"].includes(error.code);
  }

  function literal(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return t(value ? "yes" : "no");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function dictionaryValue(field, value) {
    const key = {
      source_type: {
        double: "sourceTypeDouble",
        string: "sourceTypeString",
        date_time: "sourceTypeDateTime"
      },
      measure: {
        nominal: "measureNominal",
        ordinal: "measureOrdinal",
        scale: "measureScale",
        unknown: "measureUnknown"
      }
    }[field]?.[value];
    return key ? t(key) : literal(value);
  }

  function appendField(list, label, value) {
    list.append(make("dt", "", label), make("dd", "", literal(value)));
  }

  function upsert(entry, item) {
    entry.items = [item, ...entry.items.filter((existing) => existing.id !== item.id)];
  }

  function renderStatus() {
    elements.status.replaceChildren();
    const statuses = [availabilityStatus, currentEntry()?.status].filter(Boolean);
    if (!statuses.length) {
      delete elements.status.dataset.kind;
      return;
    }
    elements.status.dataset.kind = statuses.some((status) => status.kind === "error") ? "error" : statuses.some((status) => status.kind === "success") ? "success" : "info";
    for (const status of statuses) {
      const row = make("div", "data-imports-status-row");
      row.append(make("span", "", status.kind === "error" ? errorText(status) : t(status.key, status.values || {})));
      if (status.retry) {
        const button = make("button", "status-retry", t("retry"));
        button.type = "button";
        button.addEventListener("click", status.retry);
        row.append(button);
      }
      elements.status.append(row);
    }
  }

  function renderDictionary(review) {
    const columns = Array.isArray(review?.columns) ? review.columns : [];
    const table = make("table", "analysis-table data-imports-table data-imports-dictionary-table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    const fields = [
      ["name", "name"],
      ["label", "label"],
      ["source_type", "sourceType"],
      ["format", "format"],
      ["measure", "measure"]
    ];
    for (const [, label] of fields) header.append(make("th", "", t(label)));
    for (const key of ["valueLabels", "missingRanges", "systemMissing", "userMissing", "blankMissing", "nonmissing"]) header.append(make("th", "", t(key)));
    thead.append(header);
    const tbody = document.createElement("tbody");
    for (const column of columns) {
      const row = document.createElement("tr");
      for (const [field] of fields) row.append(make("td", "", dictionaryValue(field, column[field])));
      const valueLabels = (column.value_labels || []).map((item) => `${literal(item.value)} → ${literal(item.label)}`).join("\n") || "—";
      const missingRanges = (column.missing_ranges || []).map((item) => `${literal(item.lo)}..${literal(item.hi)}`).join("\n") || "—";
      row.append(
        make("td", "", valueLabels),
        make("td", "", missingRanges),
        make("td", "", literal(column.system_missing)),
        make("td", "", literal(column.user_missing)),
        make("td", "", literal(column.blank_missing)),
        make("td", "", literal(column.nonmissing))
      );
      tbody.append(row);
    }
    table.append(thead, tbody);
    elements.dictionaryContent.replaceChildren(table);
  }

  function renderPreview(container, review, analysisPreview) {
    const table = make("table", "analysis-table data-imports-table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    for (const column of review?.columns || []) header.append(make("th", "", literal(column.name)));
    thead.append(header);
    const tbody = document.createElement("tbody");
    const rows = analysisPreview ? review?.analysis_preview : review?.preview;
    for (const values of rows || []) {
      const row = document.createElement("tr");
      for (const value of values) {
        const missing = !analysisPreview && value === null;
        const cell = make("td", missing ? "data-imports-system-missing" : "", analysisPreview ? value === null || value === undefined ? "" : String(value) : missing ? t("systemMissing") : literal(value));
        if (missing) cell.dataset.missing = "system";
        row.append(cell);
      }
      tbody.append(row);
    }
    table.append(thead, tbody);
    container.replaceChildren(table);
  }

  function renderReview(entry) {
    const item = selectedImport(entry);
    elements.review.hidden = !item || !entry?.reviewOpen;
    elements.review.setAttribute("aria-label", t("review"));
    if (!item) {
      elements.summary.replaceChildren();
      elements.dictionaryContent.replaceChildren();
      elements.rawContent.replaceChildren();
      elements.analysisContent.replaceChildren();
      elements.original.hidden = true;
      return;
    }
    elements.review.dataset.status = item.status;
    elements.summary.replaceChildren();
    appendField(elements.summary, t("file"), item.original_filename);
    appendField(elements.summary, t("status"), t(item.status === "confirmed" ? "confirmed" : "pending"));
    appendField(elements.summary, t("rows"), item.review?.row_count);
    appendField(elements.summary, t("columns"), item.review?.column_count);
    appendField(elements.summary, t("bytes"), item.byte_size);
    elements.original.hidden = false;
    elements.original.textContent = t("original");
    elements.original.href = `/api/v1/documents/${encodeURIComponent(item.document_id)}/data-imports/${encodeURIComponent(item.id)}/file`;
    elements.original.download = item.original_filename || "original.sav";
    elements.policy.textContent = t("policy");
    elements.dictionary.querySelector("summary").textContent = t("dictionary");
    elements.raw.querySelector("summary").textContent = t("rawPreview");
    elements.analysis.querySelector("summary").textContent = t("analysisPreview");
    renderDictionary(item.review);
    renderPreview(elements.rawContent, item.review, false);
    renderPreview(elements.analysisContent, item.review, true);
    elements.sampleNote.hidden = !item.review?.sample_truncated;
    elements.sampleNote.textContent = t("sampleTruncated");

    const pending = item.status === "pending";
    const confirmation = entry.confirmation;
    elements.ackLabel.hidden = !pending;
    elements.ackLabel.querySelector("span").textContent = t("acknowledge");
    elements.ack.checked = pending && Boolean(confirmation || entry.acknowledged);
    elements.ack.disabled = !pending || !item.review || Boolean(confirmation) || entry.detailPending;
    elements.confirm.hidden = !pending;
    elements.confirm.disabled = !pending || !item.review || entry.detailPending || (confirmation ? confirmation.pending : !entry.acknowledged);
    elements.confirm.textContent = t(confirmation?.pending ? "confirming" : confirmation?.uncertain ? "retryConfirm" : "confirm");
  }

  function render(revealReview = false) {
    const entry = currentEntry();
    elements.section.hidden = !entry?.items.length && !entry?.upload && !entry?.status && !entry?.reviewOpen;
    elements.defer.textContent = t("defer");
    elements.defer.disabled = Boolean(entry?.confirmation);
    elements.selectLabel.textContent = t("imports");
    elements.select.replaceChildren();
    if (!entry?.items.length) {
      const option = make("option", "", t("noImports"));
      option.value = "";
      elements.select.append(option);
    } else {
      for (const item of entry.items) {
        const option = make("option", "", `${item.original_filename} · ${t(item.status === "confirmed" ? "confirmed" : "pending")}`);
        option.value = item.id;
        option.dataset.status = item.status;
        elements.select.append(option);
      }
      elements.select.value = entry.selectedImportId || "";
    }
    elements.select.disabled = !entry?.items.length || Boolean(entry.confirmation);
    elements.open.hidden = !selectedImport(entry);
    elements.open.disabled = !selectedImport(entry) || Boolean(entry.confirmation);
    elements.open.textContent = t("reviewSelected");
    renderReview(entry);
    renderStatus();
    adapter.reviewVisibilityChanged?.(currentId, Boolean(entry?.reviewOpen && selectedImport(entry)), revealReview);
    adapter.importStateChanged?.();
  }

  async function loadAvailability() {
    const sequence = ++availabilitySequence;
    availabilityPending = true;
    availabilityStatus = { key: "statusLoading", kind: "info" };
    render();
    try {
      const response = await adapter.checkedFetch("/api/v1/data-imports/status");
      const body = await response.json();
      if (sequence !== availabilitySequence) return;
      availability = body;
      availabilityStatus = body.available === true ? null : { key: "unavailable", kind: "error", retry: loadAvailability };
    } catch (error) {
      if (sequence !== availabilitySequence) return;
      availability = { available: false };
      availabilityStatus = {
        key: error.code === "network" ? "statusFailed" : "unavailable",
        kind: "error",
        retry: loadAvailability
      };
    } finally {
      if (sequence === availabilitySequence) {
        availabilityPending = false;
        render();
      }
    }
  }

  async function loadDetail(entry, importId) {
    if (!entry || !importId || entry.confirmation) return;
    const sequence = ++entry.detailSequence;
    entry.detailController?.abort();
    const controller = new AbortController();
    entry.detailController = controller;
    entry.detailPending = true;
    if (entry === currentEntry()) render();
    try {
      const item = await adapter.api(`/api/v1/documents/${encodeURIComponent(entry.documentId)}/data-imports/${encodeURIComponent(importId)}`, { signal: controller.signal });
      if (sequence !== entry.detailSequence || entry.selectedImportId !== importId || entry.confirmation) return;
      const previous = entry.items.find((existing) => existing.id === importId);
      upsert(entry, item);
      if (previous?.review_sha256 !== item.review_sha256) entry.acknowledged = false;
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== entry.detailSequence) return;
      entry.status = { key: error.code || "detailFailed", kind: "error", retry: () => loadDetail(entry, importId) };
    } finally {
      if (sequence === entry.detailSequence) {
        entry.detailPending = false;
        entry.detailController = null;
        if (entry === currentEntry()) render();
      }
    }
  }

  async function reload(documentId) {
    if (currentId && currentId !== documentId) {
      const previous = entryFor(currentId);
      previous.loadController?.abort();
      previous.detailController?.abort();
    }
    currentId = documentId || null;
    const entry = currentEntry();
    if (!entry) {
      render();
      return;
    }
    const sequence = ++entry.loadSequence;
    entry.detailSequence += 1;
    entry.loadController?.abort();
    entry.detailController?.abort();
    const controller = new AbortController();
    entry.loadController = controller;
    entry.detailPending = false;
    if (!entry.upload?.pending && !entry.confirmation) entry.status = { key: "loading", kind: "info" };
    render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/data-imports`, { signal: controller.signal });
      if (sequence !== entry.loadSequence || entry !== currentEntry()) return;
      entry.items = Array.isArray(body.items) ? body.items : [];
      if (!entry.items.some((item) => item.id === entry.selectedImportId)) {
        entry.selectedImportId = (entry.items.find((item) => item.status === "pending") || entry.items[0])?.id || null;
        entry.acknowledged = false;
      }
      if (!entry.upload?.pending && !entry.confirmation) entry.status = null;
      render();
      if (entry.selectedImportId && !entry.confirmation) await loadDetail(entry, entry.selectedImportId);
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== entry.loadSequence || entry !== currentEntry()) return;
      entry.status = { key: error.code || "loadFailed", kind: "error", retry: () => reload(documentId) };
      render();
    } finally {
      if (sequence === entry.loadSequence) entry.loadController = null;
    }
  }

  async function uploadImport(entry, upload) {
    if (!entry || entry.upload !== upload || upload.pending) return;
    upload.pending = true;
    upload.navigationGeneration = adapter.getNavigationGeneration?.();
    entry.status = { key: "uploading", kind: "info" };
    if (entry === currentEntry()) render();
    const form = new FormData();
    form.append("file", upload.file, upload.file.name);
    form.append("request_id", upload.requestId);
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(entry.documentId)}/data-imports`, { method: "POST", body: form });
      if (![200, 201].includes(response.status)) throw new Error("request_failed");
      const item = await response.json();
      if (!item?.id || !item.review) throw new Error("request_failed");
      if (entry.upload !== upload) return;
      entry.loadSequence += 1;
      upsert(entry, item);
      entry.selectedImportId = item.id;
      entry.reviewOpen = upload.navigationGeneration === adapter.getNavigationGeneration?.();
      entry.acknowledged = false;
      entry.upload = null;
      entry.status = { key: "imported", kind: "success" };
    } catch (error) {
      if (entry.upload !== upload) return;
      upload.pending = false;
      const ambiguous = isAmbiguous(error);
      entry.status = {
        key: ambiguous ? "uploadRetry" : error.code || "request_failed",
        kind: "error",
        retry: ambiguous ? () => uploadImport(entry, upload) : null
      };
    } finally {
      if (entry.upload === upload) upload.pending = false;
      if (entry === currentEntry()) render();
    }
  }

  async function confirmImport(entry) {
    const item = selectedImport(entry);
    if (!entry || !item || item.status !== "pending" || !item.review || entry.detailPending) return;
    let confirmation = entry.confirmation;
    if (confirmation?.pending) return;
    if (!confirmation) {
      if (!entry.acknowledged) return;
      confirmation = {
        importId: item.id,
        body: {
          source_sha256: item.sha256,
          review_sha256: item.review_sha256,
          acknowledge: true
        },
        pending: false,
        uncertain: false
      };
    }
    entry.confirmation = confirmation;
    entry.acknowledged = true;
    confirmation.pending = true;
    confirmation.uncertain = false;
    confirmation.navigationGeneration = adapter.getNavigationGeneration?.();
    entry.status = { key: "confirming", kind: "info" };
    render();
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(entry.documentId)}/data-imports/${encodeURIComponent(confirmation.importId)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmation.body)
      });
      if (![200, 201].includes(response.status)) throw new Error("request_failed");
      const dataset = await response.json();
      if (!dataset?.id) throw new Error("request_failed");
      if (entry.confirmation !== confirmation) return;
      entry.loadSequence += 1;
      const current = entry.items.find((existing) => existing.id === confirmation.importId);
      if (current) {
        current.status = "confirmed";
        current.dataset_id = dataset.id;
      }
      entry.confirmation = null;
      entry.reviewOpen = false;
      entry.acknowledged = false;
      entry.status = { key: "confirmedReceipt", kind: "success" };
      adapter.datasetConfirmed?.(entry.documentId, dataset, confirmation.navigationGeneration);
    } catch (error) {
      if (entry.confirmation !== confirmation) return;
      confirmation.pending = false;
      if (isAmbiguous(error)) {
        confirmation.uncertain = true;
        entry.status = { key: "confirmRetry", kind: "error" };
      } else {
        entry.confirmation = null;
        entry.acknowledged = false;
        entry.status = { key: error.code || "request_failed", kind: "error", retry: () => reload(entry.documentId) };
      }
    } finally {
      if (entry === currentEntry()) render();
    }
  }

  function startImport(file) {
    const entry = currentEntry();
    if (!entry || !file || entry.upload?.pending) return false;
    const upload = { file, requestId: crypto.randomUUID(), pending: false };
    entry.upload = upload;
    entry.reviewOpen = false;
    if (!/\.(sav|zsav)$/i.test(file.name)) {
      entry.status = { key: "invalidType", kind: "error" };
      render();
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      entry.status = { key: "spss_too_large", kind: "error" };
      render();
      return false;
    }
    if (availability?.available !== true) {
      entry.status = { key: "unavailable", kind: "error", retry: loadAvailability };
      render();
      return false;
    }
    uploadImport(entry, upload);
    return true;
  }

  elements.select.addEventListener("change", () => {
    const entry = currentEntry();
    if (!entry || entry.confirmation) return;
    entry.selectedImportId = elements.select.value || null;
    entry.reviewOpen = Boolean(entry.selectedImportId);
    entry.acknowledged = false;
    entry.status = null;
    render(true);
    loadDetail(entry, entry.selectedImportId);
  });
  elements.open.addEventListener("click", () => {
    const entry = currentEntry();
    if (!entry || entry.confirmation || !selectedImport(entry)) return;
    entry.reviewOpen = true;
    render(true);
    loadDetail(entry, entry.selectedImportId);
  });
  elements.defer.addEventListener("click", () => {
    const entry = currentEntry();
    if (!entry || entry.confirmation) return;
    entry.reviewOpen = false;
    render();
  });
  elements.ack.addEventListener("change", () => {
    const entry = currentEntry();
    if (!entry || entry.confirmation) return;
    entry.acknowledged = elements.ack.checked;
    renderReview(entry);
  });
  elements.confirm.addEventListener("click", () => {
    const entry = currentEntry();
    if (entry) confirmImport(entry);
  });

  loadAvailability();

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.heading.textContent = t("heading");
      elements.help.textContent = t("help");
      elements.section.setAttribute("aria-label", t("heading"));
      render();
    },
    reload,
    startImport,
    isImportPending() {
      return Boolean(currentEntry()?.upload?.pending);
    }
  };
}
