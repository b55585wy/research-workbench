const RESOURCE_KINDS = new Set(["dataset", "analysis", "chart"]);
const OWNER_KINDS = new Set(["paper", "project", "personal"]);
const KIND_ORDER = ["dataset", "analysis", "chart"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const messages = {
  zh: {
    linkedResources: "关联数据与结果",
    resourcesHelp: "仅保存指向原数据、已完成分析和图表的关联；不会复制、移动或自动运行，也不会向助手共享内容。",
    addExisting: "添加现有资料",
    addLink: "添加关联",
    refresh: "刷新",
    loading: "正在加载…",
    noResources: "尚未关联数据或结果。",
    resourcesLoadFailed: "无法加载关联数据与结果。",
    resourceDataset: "数据",
    resourceAnalysis: "已完成分析",
    resourceChart: "图表",
    untitled: "未命名资料",
    ownerUnknown: "来源未知",
    openOriginal: "打开原始资料",
    removeLink: "移除关联",
    removing: "正在移除关联…",
    adding: "正在添加关联…",
    added: "关联已添加。",
    removed: "已移除关联，原始资料仍保留。",
    alreadyLinked: "已关联",
    resourceUnavailable: "原始资料当前不可用，仍可移除关联。",
    resourceLimit: "每个项目最多关联 100 项数据或结果。",
    pickerTitle: "添加现有数据与结果",
    pickerHelp: "这里只读取原始资料的元数据。添加关联不会复制、移动或运行资料。",
    close: "关闭",
    searchLabel: "搜索标题或来源",
    searchPlaceholder: "搜索标题或来源",
    search: "搜索",
    datasets: "数据",
    analyses: "已完成分析",
    charts: "图表",
    candidatesEmpty: "没有可添加的匹配资料。",
    candidatesFailed: "无法加载可选资料。",
    candidateResults: "可选数据与结果",
    previous: "上一页",
    next: "下一页",
    retry: "重试",
    retryOriginal: "按原请求重试",
    discardRetry: "放弃重试",
    discardRetryNote: "放弃重试不会撤销已提交的操作；请刷新列表以确认结果。",
    writeUnconfirmed: "操作结果尚未确认。请使用原请求重试，不要重复提交。",
    request_failed: "操作未完成，请重试。",
    network: "无法连接本地服务。请检查服务后重试。",
    validation_error: "提交的内容无效，请检查后重试。",
    idempotency_conflict: "请求发生冲突，请检查后重试。",
    source_changed: "原始资料已变化，请重新选择。",
    resource_limit: "每个项目最多关联 100 项数据或结果。",
    not_found: "请求的内容不存在或已被删除。"
  },
  en: {
    linkedResources: "Linked data and results",
    resourcesHelp: "These are links to existing data, completed analyses, and charts. Nothing is copied, moved, run, or shared with the assistant.",
    addExisting: "Add existing",
    addLink: "Add link",
    refresh: "Refresh",
    loading: "Loading…",
    noResources: "No linked data or results yet.",
    resourcesLoadFailed: "Linked data and results could not be loaded.",
    resourceDataset: "Data",
    resourceAnalysis: "Completed analysis",
    resourceChart: "Chart",
    untitled: "Untitled resource",
    ownerUnknown: "Unknown source",
    openOriginal: "Open original",
    removeLink: "Remove link",
    removing: "Removing link…",
    adding: "Adding link…",
    added: "Link added.",
    removed: "Link removed. The original resource remains unchanged.",
    alreadyLinked: "Linked",
    resourceUnavailable: "The original is currently unavailable. You can still remove the link.",
    resourceLimit: "A project can link up to 100 data and result items.",
    pickerTitle: "Add existing data and results",
    pickerHelp: "Only original-resource metadata is read. Adding a link does not copy, move, or run anything.",
    close: "Close",
    searchLabel: "Search titles or sources",
    searchPlaceholder: "Search titles or sources",
    search: "Search",
    datasets: "Data",
    analyses: "Completed analyses",
    charts: "Charts",
    candidatesEmpty: "No matching resources are available to link.",
    candidatesFailed: "Available resources could not be loaded.",
    candidateResults: "Available data and results",
    previous: "Previous",
    next: "Next",
    retry: "Retry",
    retryOriginal: "Retry original request",
    discardRetry: "Discard retry",
    discardRetryNote: "Discarding retry does not undo an already submitted operation; refresh the list to check the outcome.",
    writeUnconfirmed: "The result is unconfirmed. Retry the original request; do not submit a duplicate.",
    request_failed: "The action could not be completed. Try again.",
    network: "Cannot connect to the local service. Check it and retry.",
    validation_error: "The submitted content is invalid. Check it and retry.",
    idempotency_conflict: "The request conflicted with another request. Check it and retry.",
    source_changed: "The original resource changed. Select it again.",
    resource_limit: "A project can link up to 100 data and result items.",
    not_found: "The requested content does not exist or was deleted."
  }
};

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function normalProject(owner) {
  return owner?.kind === "study" && owner.workspace_role !== "personal_analysis" ? owner : null;
}

function resourceKey(item) {
  return `${item.kind}:${item.document_id}:${item.resource_id}`;
}

function normalizeCandidate(item, expectedKind) {
  if (!item || item.kind !== expectedKind || !RESOURCE_KINDS.has(item.kind)) return null;
  if (!UUID_PATTERN.test(text(item.document_id)) || !UUID_PATTERN.test(text(item.resource_id))) return null;
  if (!SHA256_PATTERN.test(text(item.source_sha256)) || !SHA256_PATTERN.test(text(item.owner_sha256))) return null;
  return Object.freeze({
    kind: item.kind,
    document_id: item.document_id,
    resource_id: item.resource_id,
    source_sha256: item.source_sha256,
    owner_sha256: item.owner_sha256,
    title: text(item.title),
    owner_title: text(item.owner_title),
    owner_kind: OWNER_KINDS.has(item.owner_kind) ? item.owner_kind : "",
    created_at: text(item.created_at)
  });
}

function normalizeLink(item, ownerId) {
  if (!item || item.study_id !== ownerId || !RESOURCE_KINDS.has(item.kind)) return null;
  if (![item.id, item.document_id, item.resource_id].every((value) => UUID_PATTERN.test(text(value)))) return null;
  if (!SHA256_PATTERN.test(text(item.source_sha256)) || !SHA256_PATTERN.test(text(item.owner_sha256))) return null;
  return Object.freeze({
    id: item.id,
    study_id: item.study_id,
    kind: item.kind,
    document_id: item.document_id,
    resource_id: item.resource_id,
    source_sha256: item.source_sha256,
    owner_sha256: item.owner_sha256,
    title: text(item.title),
    owner_title: text(item.owner_title),
    owner_kind: OWNER_KINDS.has(item.owner_kind) ? item.owner_kind : "",
    created_at: text(item.created_at),
    available: item.available === true
  });
}

export function createProjectResources(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    section: byId("study-resources-details"),
    heading: byId("study-resources-heading"),
    count: byId("study-resources-count"),
    help: byId("study-resources-help"),
    add: byId("study-resource-add"),
    refresh: byId("study-resource-refresh"),
    status: byId("study-resources-status"),
    writeStatus: byId("study-resources-write-status"),
    list: byId("study-resources"),
    dialog: byId("study-resource-picker"),
    pickerHeading: byId("study-resource-picker-heading"),
    pickerHelp: byId("study-resource-picker-help"),
    close: byId("study-resource-picker-close"),
    searchForm: byId("study-resource-search-form"),
    searchLabel: byId("study-resource-search-label"),
    search: byId("study-resource-search"),
    searchSubmit: byId("study-resource-search-submit"),
    tabs: {
      dataset: byId("study-resource-tab-dataset"),
      analysis: byId("study-resource-tab-analysis"),
      chart: byId("study-resource-tab-chart")
    },
    candidatesStatus: byId("study-resource-candidates-status"),
    pickerWriteStatus: byId("study-resource-picker-write-status"),
    candidates: byId("study-resource-candidates"),
    previous: byId("study-resource-previous"),
    next: byId("study-resource-next")
  };
  const entries = new Map();
  let language = adapter.getLanguage();
  let currentOwner = null;
  let dialogTarget = null;
  let dialogGeneration = 0;
  let dialogController = null;
  let kind = "dataset";
  let query = "";
  let cursor = null;
  let previousCursors = [];
  let candidates = [];
  let nextCursor = null;
  let candidatesLoading = false;
  let candidatesFailed = false;

  function t(key) {
    return messages[language]?.[key] || messages.en[key] || key;
  }

  function errorKey(error) {
    return Object.hasOwn(messages.en, error?.code) ? error.code : "request_failed";
  }

  function entryFor(ownerId) {
    if (!entries.has(ownerId)) {
      entries.set(ownerId, {
        items: [],
        loaded: false,
        listPending: false,
        listController: null,
        listGeneration: 0,
        listStatus: null,
        writeStatus: null,
        operations: new Map(),
        open: false
      });
    }
    return entries.get(ownerId);
  }

  function captureTarget() {
    const owner = normalProject(adapter.getDocument());
    if (!owner || currentOwner?.id !== owner.id) return null;
    return {
      ownerId: owner.id,
      scopeHash: text(owner.scope_sha256),
      navigationGeneration: adapter.getNavigationGeneration?.(),
      entry: entryFor(owner.id)
    };
  }

  function canEdit(target) {
    const owner = normalProject(adapter.getDocument());
    const generation = adapter.getNavigationGeneration?.();
    return Boolean(
      target &&
      currentOwner?.id === target.ownerId &&
      owner?.id === target.ownerId &&
      text(owner.scope_sha256) === target.scopeHash &&
      (generation ?? target.navigationGeneration) === target.navigationGeneration &&
      entries.get(target.ownerId) === target.entry
    );
  }

  function hasActiveWrites(entry) {
    return [...entry.operations.values()].some((operation) => operation.pending);
  }

  function statusInto(container, status) {
    container.replaceChildren();
    if (!status) {
      container.removeAttribute("data-kind");
      return;
    }
    container.dataset.kind = status.kind || "info";
    container.append(make("span", "", t(status.key)));
    if (status.retry) {
      const retry = make("button", "button button-quiet", t(status.retryLabel || "retry"));
      retry.type = "button";
      retry.addEventListener("click", status.retry);
      container.append(retry);
    }
  }

  async function discardOperation(entry, operation) {
    if (operation.pending || !operation.error || entry.operations.get(operation.key) !== operation) return;
    entry.operations.delete(operation.key);
    renderEntry(entry);
    await loadList({ id: operation.ownerId }, { force: true });
  }

  function writeStatusInto(container, entry, visible) {
    statusInto(container, visible ? entry?.writeStatus || null : null);
    if (!visible || !entry) return;
    const activeWrites = hasActiveWrites(entry);
    const failed = [...entry.operations.values()].filter((operation) => !operation.pending && operation.error);
    for (const operation of failed) {
      const material = operation.action === "add" ? operation.candidate : operation.link;
      const row = make("div", "study-resource-write-operation");
      row.append(
        make("span", "study-resource-write-material", material?.title || t("untitled")),
        make("span", "study-resource-write-error", t(operation.error?.code === "network" ? "writeUnconfirmed" : errorKey(operation.error)))
      );
      const retry = make("button", "button button-quiet", t("retryOriginal"));
      retry.type = "button";
      retry.disabled = activeWrites;
      retry.addEventListener("click", () => void runOperation(entry, operation));
      const discard = make("button", "button button-quiet", t("discardRetry"));
      discard.type = "button";
      discard.disabled = activeWrites;
      discard.addEventListener("click", () => void discardOperation(entry, operation));
      row.append(retry, discard);
      container.append(row);
    }
    if (failed.length) container.append(make("span", "study-resource-write-note", t("discardRetryNote")));
  }

  function renderWriteStatus(entry) {
    writeStatusInto(elements.writeStatus, entry, Boolean(currentOwner && entries.get(currentOwner.id) === entry));
    writeStatusInto(elements.pickerWriteStatus, entry, dialogTarget?.entry === entry);
  }

  function renderList() {
    const owner = currentOwner;
    elements.section.hidden = !owner;
    if (!owner) {
      elements.count.textContent = "0";
      elements.list.replaceChildren();
      statusInto(elements.status, null);
      statusInto(elements.writeStatus, null);
      return;
    }
    const entry = entryFor(owner.id);
    const activeWrites = hasActiveWrites(entry);
    elements.section.open = entry.open;
    elements.count.textContent = String(entry.items.length);
    elements.refresh.disabled = entry.listPending;
    elements.add.disabled = activeWrites || entry.items.length >= 100;
    elements.add.title = entry.items.length >= 100 ? t("resourceLimit") : "";
    elements.list.replaceChildren();
    if (!entry.loaded && entry.listPending) {
      elements.list.append(make("li", "study-list-empty", t("loading")));
    } else if (entry.loaded && !entry.items.length) {
      elements.list.append(make("li", "study-list-empty", t("noResources")));
    }
    for (const item of entry.items) {
      const row = make("li", "study-resource-item");
      row.dataset.linkId = item.id;
      const description = make("div", "study-resource-description");
      description.append(
        make("strong", "study-resource-title", item.title || t("untitled")),
        make("span", "study-resource-meta", `${t(`resource${item.kind[0].toUpperCase()}${item.kind.slice(1)}`)} · ${item.owner_title || t("ownerUnknown")}`)
      );
      if (!item.available) description.append(make("span", "study-resource-unavailable", t("resourceUnavailable")));
      const actions = make("div", "study-resource-actions");
      const open = make("button", "button button-quiet", t("openOriginal"));
      open.type = "button";
      open.disabled = activeWrites || !item.available;
      open.addEventListener("click", () => {
        const target = captureTarget();
        if (!item.available || target?.ownerId !== item.study_id || target.entry !== entry || !canEdit(target)) return;
        adapter.openStudySource(item.document_id, { kind: item.kind, id: item.resource_id, sha256: item.source_sha256 });
      });
      const operation = entry.operations.get(`remove:${item.id}`);
      const remove = make("button", "button button-quiet", t(operation && !operation.pending ? "retryOriginal" : operation?.pending ? "removing" : "removeLink"));
      remove.type = "button";
      remove.disabled = activeWrites;
      remove.addEventListener("click", () => {
        const target = captureTarget();
        if (target?.ownerId === item.study_id && target.entry === entry && canEdit(target)) beginRemove(target, item);
      });
      actions.append(open, remove);
      row.append(description, actions);
      elements.list.append(row);
    }
    statusInto(elements.status, entry.listStatus);
    renderWriteStatus(entry);
  }

  function renderTabs() {
    for (const name of KIND_ORDER) {
      const selected = name === kind;
      elements.tabs[name].setAttribute("aria-selected", String(selected));
      elements.tabs[name].tabIndex = selected ? 0 : -1;
    }
  }

  function renderCandidates() {
    elements.candidates.replaceChildren();
    const target = dialogTarget;
    const entry = target?.entry;
    const editable = canEdit(target);
    const activeWrites = entry ? hasActiveWrites(entry) : false;
    const linkedKeys = new Set(entry?.items.map(resourceKey) || []);
    for (const item of candidates) {
      const key = resourceKey(item);
      const operation = entry?.operations.get(`add:${key}`);
      const row = make("li", "study-resource-candidate");
      row.dataset.resourceKey = key;
      const description = make("div", "study-resource-description");
      const title = item.title || t("untitled");
      description.append(
        make("strong", "study-resource-title", title),
        make("span", "study-resource-meta", `${t(`resource${item.kind[0].toUpperCase()}${item.kind.slice(1)}`)} · ${item.owner_title || t("ownerUnknown")}`)
      );
      const duplicate = linkedKeys.has(key);
      const add = make("button", "button button-secondary", t(operation?.pending ? "adding" : operation ? "retryOriginal" : duplicate ? "alreadyLinked" : "addLink"));
      add.type = "button";
      add.disabled = !editable || activeWrites || (!operation && (!entry?.loaded || duplicate || entry.items.length >= 100));
      add.setAttribute("aria-label", `${add.textContent}: ${title}`);
      const clickGeneration = dialogGeneration;
      const clickTarget = target;
      add.addEventListener("click", () => {
        if (clickGeneration !== dialogGeneration || clickTarget !== dialogTarget || !canEdit(clickTarget)) return;
        beginAdd(clickTarget, item, clickGeneration);
      });
      row.append(description, add);
      elements.candidates.append(row);
    }
    elements.previous.disabled = candidatesLoading || !previousCursors.length;
    elements.next.disabled = candidatesLoading || !nextCursor;
  }

  function renderCandidatesStatus() {
    if (candidatesLoading) {
      statusInto(elements.candidatesStatus, { key: "loading", kind: "info" });
    } else if (candidatesFailed) {
      statusInto(elements.candidatesStatus, { key: "candidatesFailed", kind: "error", retry: () => loadCandidates(cursor) });
    } else if (!candidates.length) {
      statusInto(elements.candidatesStatus, { key: "candidatesEmpty", kind: "info" });
    } else {
      statusInto(elements.candidatesStatus, null);
    }
  }

  function renderDialog() {
    renderTabs();
    renderCandidates();
    renderCandidatesStatus();
    renderWriteStatus(dialogTarget?.entry);
  }

  function render() {
    renderList();
    if (elements.dialog.open && dialogTarget) renderDialog();
  }

  function renderEntry(entry) {
    if (currentOwner && entries.get(currentOwner.id) === entry) render();
  }

  function invalidateDialog() {
    dialogGeneration += 1;
    dialogController?.abort();
    dialogController = null;
    candidatesLoading = false;
  }

  function closeDialog(restoreFocus = true) {
    const returnFocus = dialogTarget?.returnFocus;
    invalidateDialog();
    dialogTarget = null;
    if (elements.dialog.open) elements.dialog.close();
    statusInto(elements.pickerWriteStatus, null);
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }

  async function loadList(owner, { force = false } = {}) {
    const entry = entryFor(owner.id);
    if (entry.listPending && !force) return;
    entry.listController?.abort();
    const generation = ++entry.listGeneration;
    const controller = new AbortController();
    entry.listController = controller;
    entry.listPending = true;
    entry.listStatus = null;
    renderEntry(entry);
    try {
      const body = await adapter.api(`/api/v1/studies/${encodeURIComponent(owner.id)}/resources`, { signal: controller.signal });
      if (entry.listGeneration !== generation || entry.listController !== controller) return;
      entry.items = (Array.isArray(body?.items) ? body.items : []).map((item) => normalizeLink(item, owner.id)).filter(Boolean).slice(0, 100);
      entry.loaded = true;
      entry.listStatus = null;
    } catch (error) {
      if (error?.name === "AbortError" || entry.listGeneration !== generation || entry.listController !== controller) return;
      entry.listStatus = { key: "resourcesLoadFailed", kind: "error", retry: () => loadList(owner) };
    } finally {
      if (entry.listGeneration === generation && entry.listController === controller) {
        entry.listPending = false;
        entry.listController = null;
        renderEntry(entry);
      }
    }
  }

  async function loadCandidates(nextCursorValue) {
    const target = dialogTarget;
    if (!target || !canEdit(target)) {
      if (elements.dialog.open) closeDialog(false);
      return;
    }
    invalidateDialog();
    const requestGeneration = dialogGeneration;
    const requestTarget = target;
    const requestKind = kind;
    const requestQuery = query;
    const requestCursor = nextCursorValue;
    cursor = requestCursor;
    candidates = [];
    nextCursor = null;
    candidatesFailed = false;
    candidatesLoading = true;
    const controller = new AbortController();
    dialogController = controller;
    renderDialog();
    const params = new URLSearchParams({ kind: requestKind, limit: "20" });
    if (requestQuery) params.set("q", requestQuery);
    if (requestCursor) params.set("cursor", requestCursor);
    try {
      const body = await adapter.api(`/api/v1/studies/${encodeURIComponent(target.ownerId)}/resource-candidates?${params.toString()}`, { signal: controller.signal });
      if (
        requestGeneration !== dialogGeneration ||
        requestTarget !== dialogTarget ||
        dialogController !== controller ||
        requestKind !== kind ||
        requestQuery !== query ||
        requestCursor !== cursor ||
        !elements.dialog.open ||
        !canEdit(target)
      ) return;
      candidates = (Array.isArray(body?.items) ? body.items : []).map((item) => normalizeCandidate(item, requestKind)).filter(Boolean);
      nextCursor = typeof body?.next_cursor === "string" && body.next_cursor ? body.next_cursor : null;
      candidatesLoading = false;
      renderDialog();
    } catch (error) {
      if (error?.name === "AbortError" || requestGeneration !== dialogGeneration || requestTarget !== dialogTarget || dialogController !== controller) return;
      candidatesLoading = false;
      candidatesFailed = true;
      renderDialog();
    } finally {
      if (dialogController === controller) dialogController = null;
    }
  }

  async function runOperation(entry, operation) {
    if (entry.operations.get(operation.key) !== operation || operation.pending || hasActiveWrites(entry)) return;
    operation.pending = true;
    operation.error = null;
    entry.writeStatus = { key: operation.action === "add" ? "adding" : "removing", kind: "info" };
    renderEntry(entry);
    try {
      await adapter.api(operation.path, {
        method: operation.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      operation.pending = false;
      entry.operations.delete(operation.key);
      entry.writeStatus = { key: operation.action === "add" ? "added" : "removed", kind: "success" };
      renderEntry(entry);
      await loadList({ id: operation.ownerId }, { force: true });
    } catch (error) {
      operation.pending = false;
      operation.error = error;
      entry.writeStatus = null;
      renderEntry(entry);
    }
  }

  function beginAdd(target, candidate, requestGeneration) {
    if (requestGeneration !== dialogGeneration || !canEdit(target)) return;
    const entry = target.entry;
    const key = `add:${resourceKey(candidate)}`;
    const existing = entry.operations.get(key);
    if (existing) {
      void runOperation(entry, existing);
      return;
    }
    if (hasActiveWrites(entry) || !entry.loaded || entry.items.length >= 100 || entry.items.some((item) => resourceKey(item) === resourceKey(candidate))) return;
    const body = Object.freeze({
      request_id: crypto.randomUUID(),
      kind: candidate.kind,
      document_id: candidate.document_id,
      resource_id: candidate.resource_id,
      source_sha256: candidate.source_sha256,
      owner_sha256: candidate.owner_sha256
    });
    const operation = {
      key,
      action: "add",
      ownerId: target.ownerId,
      scopeHash: target.scopeHash,
      navigationGeneration: target.navigationGeneration,
      candidate,
      method: "POST",
      path: `/api/v1/studies/${encodeURIComponent(target.ownerId)}/resources`,
      body,
      pending: false,
      error: null
    };
    entry.operations.set(key, operation);
    void runOperation(entry, operation);
  }

  function beginRemove(target, item) {
    if (!canEdit(target)) return;
    const entry = target.entry;
    const key = `remove:${item.id}`;
    const existing = entry.operations.get(key);
    if (existing) {
      void runOperation(entry, existing);
      return;
    }
    if (hasActiveWrites(entry)) return;
    const body = Object.freeze({ request_id: crypto.randomUUID(), source_sha256: item.source_sha256 });
    const operation = {
      key,
      action: "remove",
      ownerId: target.ownerId,
      scopeHash: target.scopeHash,
      navigationGeneration: target.navigationGeneration,
      link: item,
      method: "DELETE",
      path: `/api/v1/studies/${encodeURIComponent(target.ownerId)}/resources/${encodeURIComponent(item.id)}`,
      body,
      pending: false,
      error: null
    };
    entry.operations.set(key, operation);
    void runOperation(entry, operation);
  }

  function openDialog() {
    const target = captureTarget();
    if (!target || elements.dialog.open || target.entry.items.length >= 100 || hasActiveWrites(target.entry)) return;
    invalidateDialog();
    target.returnFocus = document.activeElement;
    dialogTarget = target;
    kind = "dataset";
    query = "";
    cursor = null;
    previousCursors = [];
    candidates = [];
    nextCursor = null;
    candidatesFailed = false;
    elements.search.value = "";
    elements.dialog.showModal();
    renderDialog();
    if (!target.entry.loaded && !target.entry.listPending) void loadList({ id: target.ownerId });
    void loadCandidates(null);
  }

  function selectKind(nextKind, focus = false) {
    if (!RESOURCE_KINDS.has(nextKind) || nextKind === kind) return;
    kind = nextKind;
    previousCursors = [];
    cursor = null;
    renderTabs();
    if (focus) elements.tabs[kind].focus();
    void loadCandidates(null);
  }

  elements.add.addEventListener("click", openDialog);
  elements.refresh.addEventListener("click", () => {
    if (currentOwner) void loadList(currentOwner);
  });
  elements.section.addEventListener("toggle", () => {
    if (currentOwner) entryFor(currentOwner.id).open = elements.section.open;
  });
  elements.close.addEventListener("click", () => closeDialog());
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  elements.dialog.addEventListener("close", () => {
    invalidateDialog();
    dialogTarget = null;
    statusInto(elements.pickerWriteStatus, null);
  });
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canEdit(dialogTarget)) return;
    query = elements.search.value.trim().slice(0, 200);
    previousCursors = [];
    void loadCandidates(null);
  });
  for (const name of KIND_ORDER) {
    elements.tabs[name].addEventListener("click", () => selectKind(name));
    elements.tabs[name].addEventListener("keydown", (event) => {
      const index = KIND_ORDER.indexOf(name);
      let next = null;
      if (event.key === "ArrowLeft") next = KIND_ORDER[(index + KIND_ORDER.length - 1) % KIND_ORDER.length];
      else if (event.key === "ArrowRight") next = KIND_ORDER[(index + 1) % KIND_ORDER.length];
      else if (event.key === "Home") next = KIND_ORDER[0];
      else if (event.key === "End") next = KIND_ORDER[KIND_ORDER.length - 1];
      if (!next) return;
      event.preventDefault();
      selectKind(next, true);
    });
  }
  elements.previous.addEventListener("click", () => {
    if (!previousCursors.length || candidatesLoading) return;
    void loadCandidates(previousCursors.pop());
  });
  elements.next.addEventListener("click", () => {
    if (!nextCursor || candidatesLoading) return;
    previousCursors.push(cursor);
    void loadCandidates(nextCursor);
  });

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.heading.textContent = t("linkedResources");
      elements.help.textContent = t("resourcesHelp");
      elements.add.textContent = t("addExisting");
      elements.refresh.textContent = t("refresh");
      elements.list.setAttribute("aria-label", t("linkedResources"));
      elements.pickerHeading.textContent = t("pickerTitle");
      elements.pickerHelp.textContent = t("pickerHelp");
      elements.close.textContent = t("close");
      elements.close.setAttribute("aria-label", t("close"));
      elements.searchLabel.textContent = t("searchLabel");
      elements.search.setAttribute("aria-label", t("searchLabel"));
      elements.search.placeholder = t("searchPlaceholder");
      elements.searchSubmit.textContent = t("search");
      elements.dialog.querySelector(".study-resource-tabs").setAttribute("aria-label", t("linkedResources"));
      elements.tabs.dataset.textContent = t("datasets");
      elements.tabs.analysis.textContent = t("analyses");
      elements.tabs.chart.textContent = t("charts");
      elements.candidates.setAttribute("aria-label", t("candidateResults"));
      elements.previous.textContent = t("previous");
      elements.next.textContent = t("next");
      render();
    },
    documentChanged(document) {
      const previous = currentOwner;
      currentOwner = normalProject(document);
      if (previous && previous.id !== currentOwner?.id) {
        const entry = entries.get(previous.id);
        if (entry) {
          entry.listController?.abort();
          entry.listGeneration += 1;
          entry.listPending = false;
          entry.listController = null;
        }
      }
      if (dialogTarget && !canEdit(dialogTarget)) closeDialog(false);
      render();
      if (currentOwner) void loadList(currentOwner);
    },
    hasPending(ownerId) {
      const entry = entries.get(ownerId);
      return Boolean(entry && hasActiveWrites(entry));
    }
  };
}
