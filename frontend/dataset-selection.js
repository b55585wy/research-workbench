const messages = {
  zh: {
    title: "筛选数据",
    help: "按某一列的原始文本精确筛选，不去除空格、不进行数值转换。源数据保持不变；SPSS 规范化字段字典仍随源数据保存。",
    column: "筛选列",
    chooseColumn: "请选择列",
    search: "搜索可选值（仅用于查找）",
    searchValues: "查找值",
    value: "精确匹配值",
    chooseValue: "请先从目录中选择值",
    selectedValue: "当前精确值",
    previousValues: "上一批",
    nextValues: "下一批",
    resultName: "结果名称（可选）",
    preview: "预览筛选结果",
    previewing: "正在生成只读预览…",
    create: "生成分析表",
    creating: "正在生成分析表…",
    retry: "按原请求重试",
    edit: "返回编辑",
    rule: "精确规则：{column} = {value}",
    noRule: "选择列和目录值后，此处会显示精确规则。搜索框不会成为筛选规则。",
    total: "源数据行数",
    matched: "匹配行数",
    excluded: "排除行数",
    valuesSummary: "共 {distinct} 个不同值，搜索匹配 {matches} 个值；目录位置 {from}–{to}。",
    valuesEmpty: "此列没有可显示的值。",
    valuesLoading: "正在读取值目录…",
    valuesFailed: "无法读取值目录，请重试。",
    previewReady: "只读预览已生成，尚未创建分析表。请核对精确规则和计数。",
    previewZero: "筛选有效，但没有匹配行；不会生成空分析表。",
    previewFailed: "预览未完成，尚未创建分析表。",
    saveRetry: "生成结果不确定。已保留相同请求标识和内容，可按原请求重试，或明确返回编辑。",
    saved: "分析表已生成并加入当前文献的数据列表；尚未向助手共享。",
    drift: "源数据或预览已变化。请返回编辑并重新预览，原请求不会自动改写。",
    capabilitiesFailed: "筛选功能暂时不可用，请重试。",
    recipe: "固定筛选配方：{id} · v{version} · SHA-256 {sha256}",
    network: "无法连接本地服务。草稿和原请求已保留。",
    validation_error: "筛选请求无效，请检查列、精确值和结果名称。",
    dataset_changed: "源数据已变化，请重新预览。",
    source_changed: "源数据已变化，请重新预览。",
    recipe_changed: "筛选配方已变化，请重新预览。",
    preview_changed: "预览已变化，请重新预览。",
    selection_preview_changed: "预览已变化，请重新预览。",
    selection_source_changed: "源数据已变化，请重新预览。",
    selection_recipe_changed: "筛选配方已变化，请重新预览。",
    selection_empty: "筛选结果为空，不会生成空分析表。",
    selection_busy: "筛选操作正在进行，请稍后重试。",
    selection_timeout: "筛选操作超时，请重试。",
    selection_failed: "筛选操作未完成，请重试。",
    invalid_selection: "筛选请求无效，请检查筛选列和精确值。",
    dataset_quota: "数据表数量已达上限，请删除不再需要的数据表后重试。",
    idempotency_conflict: "请求标识发生冲突，原请求未被改写。",
    request_failed: "操作未完成，请重试。"
  },
  en: {
    title: "Filter data",
    help: "Filter by exact raw text equality in one column, without trimming or numeric conversion. The source is unchanged; normalized SPSS dictionary metadata remains with the source.",
    column: "Filter column",
    chooseColumn: "Choose a column",
    search: "Search catalog values (picker only)",
    searchValues: "Find values",
    value: "Exact match value",
    chooseValue: "Choose a value from the catalog",
    selectedValue: "Current exact value",
    previousValues: "Previous batch",
    nextValues: "Next batch",
    resultName: "Result name (optional)",
    preview: "Preview filtered result",
    previewing: "Generating read-only preview…",
    create: "Generate analysis table",
    creating: "Generating analysis table…",
    retry: "Retry exact request",
    edit: "Return to editing",
    rule: "Exact rule: {column} = {value}",
    noRule: "Choose a column and catalog value to see the exact rule. Search text never becomes the rule.",
    total: "Source rows",
    matched: "Matched rows",
    excluded: "Excluded rows",
    valuesSummary: "{distinct} distinct values, {matches} catalog values match the search; catalog positions {from}–{to}.",
    valuesEmpty: "This column has no catalog values to display.",
    valuesLoading: "Loading value catalog…",
    valuesFailed: "The value catalog could not be loaded. Try again.",
    previewReady: "Read-only preview created; no analysis table has been saved. Review the exact rule and counts.",
    previewZero: "The filter is valid but matched zero rows; an empty analysis table will not be generated.",
    previewFailed: "Preview did not complete; no analysis table was created.",
    saveRetry: "The generation outcome is uncertain. The same request ID and body are retained for an exact retry, or you can explicitly return to editing.",
    saved: "The analysis table was added to this paper’s data list and has not been shared with the assistant.",
    drift: "The source or preview changed. Return to editing and preview again; the original request will not be rewritten automatically.",
    capabilitiesFailed: "Filtering is temporarily unavailable. Try again.",
    recipe: "Fixed selection recipe: {id} · v{version} · SHA-256 {sha256}",
    network: "Cannot connect to the local service. Your draft and exact request are retained.",
    validation_error: "The filter request is invalid. Check the column, exact value, and result name.",
    dataset_changed: "The source data changed. Preview again.",
    source_changed: "The source data changed. Preview again.",
    recipe_changed: "The selection recipe changed. Preview again.",
    preview_changed: "The preview changed. Preview again.",
    selection_preview_changed: "The preview changed. Preview again.",
    selection_source_changed: "The source data changed. Preview again.",
    selection_recipe_changed: "The selection recipe changed. Preview again.",
    selection_empty: "The selection is empty; an empty analysis table will not be generated.",
    selection_busy: "A selection operation is already in progress. Try again shortly.",
    selection_timeout: "The selection operation timed out. Try again.",
    selection_failed: "The selection operation did not complete. Try again.",
    invalid_selection: "The selection request is invalid. Check the filter column and exact value.",
    dataset_quota: "The data table limit has been reached. Remove unneeded data tables and try again.",
    idempotency_conflict: "The request ID conflicted; the original request was not changed.",
    request_failed: "The action was not completed. Try again."
  }
};

const DRIFT_CODES = new Set(["dataset_changed", "source_changed", "recipe_changed", "preview_changed", "selection_preview_changed", "selection_source_changed", "selection_recipe_changed"]);

export function createDatasetSelection(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    panel: byId("dataset-selection"),
    form: byId("dataset-selection-form"),
    help: byId("dataset-selection-help"),
    column: byId("dataset-selection-column"),
    search: byId("dataset-selection-search"),
    searchButton: byId("dataset-selection-values-search"),
    value: byId("dataset-selection-value"),
    previous: byId("dataset-selection-values-previous"),
    next: byId("dataset-selection-values-next"),
    valuesStatus: byId("dataset-selection-values-status"),
    name: byId("dataset-selection-name"),
    rule: byId("dataset-selection-rule"),
    counts: byId("dataset-selection-counts"),
    preview: byId("dataset-selection-preview"),
    recipe: byId("dataset-selection-recipe"),
    status: byId("dataset-selection-status"),
    edit: byId("dataset-selection-edit"),
    previewButton: byId("dataset-selection-preview-button"),
    create: byId("dataset-selection-create")
  };
  const papers = new Map();
  let language = adapter.getLanguage();
  let currentDocumentId = null;
  let currentDataset = null;
  let capabilitiesPromise = null;

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

  function paperFor(documentId) {
    if (!papers.has(documentId)) papers.set(documentId, { drafts: new Map() });
    return papers.get(documentId);
  }

  function draftFor(documentId, dataset) {
    if (!documentId || !dataset?.id) return null;
    const drafts = paperFor(documentId).drafts;
    if (!drafts.has(dataset.id)) {
      drafts.set(dataset.id, {
        parentDatasetId: dataset.id,
        parentSha256: dataset.sha256,
        inputRevision: 0,
        column: "",
        value: null,
        valueSelected: false,
        name: "",
        query: "",
        offset: 0,
        limit: 50,
        items: [],
        totalDistinct: 0,
        totalMatches: 0,
        hasMore: false,
        valuesSequence: 0,
        valuesController: null,
        valuesPending: false,
        valuesLoaded: false,
        valuesStatus: null,
        preview: null,
        previewOperation: null,
        saveOperation: null,
        status: null
      });
    }
    return drafts.get(dataset.id);
  }

  function currentDraft() {
    return draftFor(currentDocumentId, currentDataset);
  }

  function isCurrentContext(documentId, datasetId) {
    return currentDocumentId === documentId && currentDataset?.id === datasetId;
  }

  function appendField(list, label, value) {
    list.append(make("dt", "", label), make("dd", "", String(value)));
  }

  function renderColumns(draft) {
    elements.column.replaceChildren();
    const placeholder = make("option", "", t("chooseColumn"));
    placeholder.value = "";
    elements.column.append(placeholder);
    const columns = currentDataset?.columns || [];
    let selectedToken = "";
    columns.forEach((column, index) => {
      const token = `c${index}`;
      const option = make("option", "", column.name);
      option.value = token;
      if (draft?.column === column.name) selectedToken = token;
      elements.column.append(option);
    });
    elements.column.value = selectedToken;
  }

  function renderValues(draft) {
    elements.value.replaceChildren();
    const placeholder = make("option", "", t("chooseValue"));
    placeholder.value = "";
    elements.value.append(placeholder);
    let selectedToken = "";
    if (draft?.valueSelected && !draft.items.some((item) => item.value === draft.value)) {
      const selected = make("option", "", `${t("selectedValue")}: ${JSON.stringify(draft.value)}`);
      selected.value = "selected";
      selectedToken = "selected";
      elements.value.append(selected);
    }
    draft?.items.forEach((item, index) => {
      const token = `v${index}`;
      const option = make("option", "", `${JSON.stringify(item.value)} (${item.count})`);
      option.value = token;
      if (draft.valueSelected && draft.value === item.value) selectedToken = token;
      elements.value.append(option);
    });
    elements.value.value = selectedToken;
  }

  function renderValuesStatus(draft) {
    elements.valuesStatus.replaceChildren();
    if (!draft) return;
    const status = draft.valuesStatus;
    if (status) {
      elements.valuesStatus.dataset.kind = status.kind || "info";
      elements.valuesStatus.append(make("span", "", status.kind === "error" ? errorText(status, "valuesFailed") : t(status.key)));
      if (status.retry) {
        const retry = make("button", "status-retry", t("retry"));
        retry.type = "button";
        retry.addEventListener("click", status.retry);
        elements.valuesStatus.append(retry);
      }
      return;
    }
    delete elements.valuesStatus.dataset.kind;
    if (!draft.valuesLoaded || !draft.column) return;
    if (!draft.totalDistinct) {
      elements.valuesStatus.textContent = t("valuesEmpty");
      return;
    }
    const from = draft.offset + 1;
    const to = draft.offset + draft.items.length;
    elements.valuesStatus.textContent = t("valuesSummary", { distinct: draft.totalDistinct, matches: draft.totalMatches, from, to });
  }

  function renderPreview(draft) {
    elements.counts.replaceChildren();
    elements.preview.replaceChildren();
    elements.recipe.textContent = "";
    const preview = draft?.preview?.body;
    if (!preview) return;
    for (const [field, key] of [["total", "total"], ["matched", "matched"], ["excluded", "excluded"]]) appendField(elements.counts, t(key), preview.counts[field]);
    if (preview.columns.length && preview.preview.length) {
      const scroll = make("div", "analysis-table-scroll dataset-selection-table-scroll");
      scroll.tabIndex = 0;
      const table = make("table", "analysis-table");
      const thead = document.createElement("thead");
      const header = document.createElement("tr");
      for (const column of preview.columns) header.append(make("th", "", column.name ?? column));
      thead.append(header);
      const tbody = document.createElement("tbody");
      for (const row of preview.preview) {
        const tr = document.createElement("tr");
        for (const value of row) tr.append(make("td", "", value ?? ""));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      scroll.append(table);
      elements.preview.append(scroll);
    }
    elements.recipe.textContent = t("recipe", {
      id: preview.recipe.id,
      version: preview.recipe.version,
      sha256: preview.recipe.sha256
    });
  }

  function renderStatus(draft) {
    elements.status.replaceChildren();
    const status = draft?.status;
    if (!status) {
      delete elements.status.dataset.kind;
      return;
    }
    elements.status.dataset.kind = status.kind || "info";
    elements.status.append(make("span", "", status.kind === "error" ? errorText(status) : t(status.key)));
    if (status.retry) {
      const retry = make("button", "status-retry", t("retry"));
      retry.type = "button";
      retry.addEventListener("click", status.retry);
      elements.status.append(retry);
    }
  }

  function render() {
    const draft = currentDraft();
    elements.form.hidden = !draft;
    renderColumns(draft);
    renderValues(draft);
    if (document.activeElement !== elements.search) elements.search.value = draft?.query || "";
    if (document.activeElement !== elements.name) elements.name.value = draft?.name || "";
    elements.rule.textContent = draft?.valueSelected
      ? t("rule", { column: draft.column, value: JSON.stringify(draft.value) })
      : t("noRule");
    renderPreview(draft);
    renderValuesStatus(draft);
    renderStatus(draft);
    const previewPending = Boolean(draft?.previewOperation?.pending);
    const saveOperation = draft?.saveOperation;
    const inputsLocked = !draft || previewPending || Boolean(saveOperation);
    const valuesPending = Boolean(draft?.valuesPending);
    elements.column.disabled = inputsLocked || valuesPending;
    elements.search.disabled = inputsLocked || !draft.column;
    elements.searchButton.disabled = inputsLocked || valuesPending || !draft.column;
    elements.value.disabled = inputsLocked || valuesPending || !draft.valuesLoaded;
    elements.previous.disabled = inputsLocked || valuesPending || !draft.valuesLoaded || draft.offset <= 0;
    elements.next.disabled = inputsLocked || valuesPending || !draft.valuesLoaded || !draft.hasMore;
    elements.name.disabled = inputsLocked;
    elements.previewButton.disabled = inputsLocked || !draft.column || !draft.valueSelected;
    elements.previewButton.textContent = t(previewPending ? "previewing" : "preview");
    const previewReady = Boolean(draft?.preview && draft.preview.inputRevision === draft.inputRevision);
    const matched = draft?.preview?.body.counts.matched || 0;
    elements.create.disabled = saveOperation
      ? saveOperation.pending || saveOperation.completed || !saveOperation.failed || saveOperation.requiresPreview
      : !previewReady || previewPending || matched <= 0;
    elements.create.textContent = t(saveOperation?.pending ? "creating" : saveOperation?.failed ? "retry" : "create");
    elements.edit.hidden = !saveOperation || saveOperation.pending;
    elements.previous.textContent = t("previousValues");
    elements.next.textContent = t("nextValues");
    elements.searchButton.textContent = t("searchValues");
    elements.create.setAttribute("aria-label", elements.create.textContent);
  }

  function invalidateInput(draft) {
    draft.inputRevision += 1;
    draft.preview = null;
    draft.status = null;
  }

  function resetValues(draft) {
    draft.valuesSequence += 1;
    draft.valuesController?.abort();
    draft.valuesController = null;
    draft.valuesPending = false;
    draft.valuesLoaded = false;
    draft.valuesStatus = null;
    draft.items = [];
    draft.totalDistinct = 0;
    draft.totalMatches = 0;
    draft.hasMore = false;
    draft.offset = 0;
    draft.value = null;
    draft.valueSelected = false;
  }

  async function loadValues(documentId, dataset, draft, offset = draft.offset) {
    if (!draft.column || draft.valuesPending || draft.saveOperation || draft.previewOperation?.pending) return;
    const sequence = ++draft.valuesSequence;
    const controller = new AbortController();
    const revision = draft.inputRevision;
    const column = draft.column;
    const query = draft.query;
    draft.valuesController = controller;
    draft.valuesPending = true;
    draft.valuesStatus = { key: "valuesLoading", kind: "info" };
    if (isCurrentContext(documentId, dataset.id)) render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/dataset-selections/values`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: dataset.id,
          dataset_sha256: dataset.sha256,
          column,
          query,
          offset,
          limit: draft.limit
        }),
        signal: controller.signal
      });
      if (sequence !== draft.valuesSequence || draft.inputRevision !== revision || draft.column !== column) return;
      if (!Array.isArray(body.items) || body.items.some((item) => typeof item.value !== "string" || !Number.isInteger(item.count))) throw new Error("valuesFailed");
      draft.items = body.items;
      draft.totalDistinct = body.total_distinct;
      draft.totalMatches = body.total_matches;
      draft.offset = body.offset;
      draft.hasMore = Boolean(body.has_more);
      draft.valuesLoaded = true;
      draft.valuesStatus = null;
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== draft.valuesSequence) return;
      draft.items = [];
      draft.valuesLoaded = false;
      draft.valuesStatus = { key: error.code || "valuesFailed", kind: "error", retry: () => loadValues(documentId, dataset, draft, offset) };
    } finally {
      if (sequence === draft.valuesSequence) {
        draft.valuesPending = false;
        draft.valuesController = null;
        if (isCurrentContext(documentId, dataset.id)) render();
      }
    }
  }

  async function capabilities() {
    if (!capabilitiesPromise) {
      capabilitiesPromise = adapter.api("/api/v1/dataset-selections/capabilities").then((body) => {
        if (body?.arbitrary_code !== false || !body.recipe?.id || !body.recipe?.version || !body.recipe?.sha256) throw new Error("capabilitiesFailed");
        return body;
      }).catch((error) => {
        capabilitiesPromise = null;
        throw error;
      });
    }
    return capabilitiesPromise;
  }

  function specFor(dataset, draft, recipeSha256) {
    return {
      dataset_id: dataset.id,
      dataset_sha256: dataset.sha256,
      column: draft.column,
      value: draft.value,
      name: draft.name === "" ? null : draft.name,
      recipe_sha256: recipeSha256
    };
  }

  async function previewSelection(documentId, dataset, draft) {
    if (!draft.column || !draft.valueSelected || draft.previewOperation?.pending || draft.saveOperation) return;
    const revision = draft.inputRevision;
    const operation = { pending: true, revision, controller: new AbortController() };
    draft.previewOperation = operation;
    draft.preview = null;
    draft.status = { key: "previewing", kind: "info" };
    if (isCurrentContext(documentId, dataset.id)) render();
    try {
      const capability = await capabilities();
      if (draft.previewOperation !== operation || draft.inputRevision !== revision) return;
      const spec = specFor(dataset, draft, capability.recipe.sha256);
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/dataset-selections/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
        signal: operation.controller.signal
      });
      if (draft.previewOperation !== operation || draft.inputRevision !== revision) return;
      const valid = body?.saved === false && body.source?.id === dataset.id && body.source?.sha256 === dataset.sha256 &&
        body.condition?.column === spec.column && body.condition?.value === spec.value && body.recipe?.sha256 === spec.recipe_sha256 &&
        typeof body.preview_sha256 === "string" && body.preview_sha256 && Array.isArray(body.columns) && Array.isArray(body.preview) &&
        Number.isInteger(body.counts?.total) && Number.isInteger(body.counts?.matched) && Number.isInteger(body.counts?.excluded);
      if (!valid) throw new Error("previewFailed");
      draft.preview = { body, spec, inputRevision: revision };
      draft.status = { key: body.counts.matched > 0 ? "previewReady" : "previewZero", kind: "success" };
    } catch (error) {
      if (error?.name === "AbortError" || draft.previewOperation !== operation) return;
      draft.preview = null;
      draft.status = { key: error.code || error.message || "previewFailed", kind: "error", retry: () => previewSelection(documentId, dataset, draft) };
    } finally {
      if (draft.previewOperation === operation) {
        draft.previewOperation = null;
        if (isCurrentContext(documentId, dataset.id)) render();
      }
    }
  }

  async function createSelection(documentId, dataset, draft) {
    let operation = draft.saveOperation;
    if (operation?.pending || operation?.completed || operation?.requiresPreview) return;
    if (!operation) {
      const preview = draft.preview;
      if (!preview || preview.inputRevision !== draft.inputRevision || preview.body.counts.matched <= 0) return;
      operation = {
        requestId: crypto.randomUUID(),
        body: {
          ...preview.spec,
          request_id: null,
          preview_sha256: preview.body.preview_sha256
        },
        pending: false,
        failed: false,
        completed: false,
        requiresPreview: false
      };
      operation.body.request_id = operation.requestId;
      draft.saveOperation = operation;
    } else if (!operation.failed) {
      return;
    }
    operation.pending = true;
    operation.failed = false;
    draft.status = { key: "creating", kind: "info" };
    if (isCurrentContext(documentId, dataset.id)) render();
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}/dataset-selections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      if (![200, 201].includes(response.status)) throw new Error("request_failed");
      const child = await response.json();
      if (!child?.id) throw new Error("network");
      operation.pending = false;
      operation.completed = true;
      draft.status = { key: "saved", kind: "success" };
      const select = isCurrentContext(documentId, dataset.id);
      adapter.acceptDataset(documentId, child, { select });
    } catch (error) {
      operation.pending = false;
      operation.failed = true;
      operation.requiresPreview = DRIFT_CODES.has(error?.code);
      draft.status = { key: operation.requiresPreview ? "drift" : error.code || "saveRetry", kind: "error" };
    } finally {
      if (isCurrentContext(documentId, dataset.id)) render();
    }
  }

  elements.panel.addEventListener("toggle", () => {
    const draft = currentDraft();
    if (elements.panel.open && draft?.column && !draft.valuesLoaded && !draft.valuesPending) loadValues(currentDocumentId, currentDataset, draft);
  });
  elements.column.addEventListener("change", () => {
    const draft = currentDraft();
    if (!draft || draft.saveOperation) return;
    const index = Number(elements.column.value.slice(1));
    draft.column = elements.column.value ? currentDataset.columns[index].name : "";
    resetValues(draft);
    invalidateInput(draft);
    render();
    if (draft.column) loadValues(currentDocumentId, currentDataset, draft);
  });
  elements.value.addEventListener("change", () => {
    const draft = currentDraft();
    if (!draft || draft.saveOperation) return;
    if (elements.column.value === "") return;
    if (elements.value.value === "selected") return;
    if (!elements.value.value) {
      draft.value = null;
      draft.valueSelected = false;
    } else {
      const index = Number(elements.value.value.slice(1));
      draft.value = draft.items[index].value;
      draft.valueSelected = true;
    }
    invalidateInput(draft);
    render();
  });
  elements.search.addEventListener("input", () => {
    const draft = currentDraft();
    if (draft) draft.query = elements.search.value;
  });
  elements.searchButton.addEventListener("click", () => {
    const draft = currentDraft();
    if (draft) loadValues(currentDocumentId, currentDataset, draft, 0);
  });
  elements.previous.addEventListener("click", () => {
    const draft = currentDraft();
    if (draft) loadValues(currentDocumentId, currentDataset, draft, Math.max(0, draft.offset - draft.limit));
  });
  elements.next.addEventListener("click", () => {
    const draft = currentDraft();
    if (draft?.hasMore) loadValues(currentDocumentId, currentDataset, draft, draft.offset + draft.limit);
  });
  elements.name.addEventListener("input", () => {
    const draft = currentDraft();
    if (!draft || draft.saveOperation) return;
    draft.name = elements.name.value;
    invalidateInput(draft);
    render();
  });
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = currentDraft();
    if (draft) previewSelection(currentDocumentId, currentDataset, draft);
  });
  elements.create.addEventListener("click", () => {
    const draft = currentDraft();
    if (draft) createSelection(currentDocumentId, currentDataset, draft);
  });
  elements.edit.addEventListener("click", () => {
    const draft = currentDraft();
    if (!draft?.saveOperation || draft.saveOperation.pending) return;
    const requiresPreview = draft.saveOperation.requiresPreview;
    draft.saveOperation = null;
    if (requiresPreview) {
      draft.inputRevision += 1;
      draft.preview = null;
    }
    draft.status = null;
    render();
    elements.column.focus();
  });

  return {
    sync(documentId, dataset) {
      currentDocumentId = documentId || null;
      currentDataset = dataset || null;
      render();
    },
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.panel.querySelector("summary").textContent = t("title");
      elements.help.textContent = t("help");
      elements.form.querySelector('label[for="dataset-selection-column"]').textContent = t("column");
      elements.form.querySelector('label[for="dataset-selection-search"]').textContent = t("search");
      elements.form.querySelector('label[for="dataset-selection-value"]').textContent = t("value");
      elements.form.querySelector('label[for="dataset-selection-name"]').textContent = t("resultName");
      render();
    }
  };
}
