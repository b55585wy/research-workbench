const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OWNER_KINDS = new Set(["paper", "project", "personal"]);

function text(value) {
  return typeof value === "string" ? value : "";
}

export function resourceReferenceKey(reference) {
  return reference?.kind === "dataset"
    ? `dataset:${reference.document_id}:${reference.dataset_id}`
    : `paper:${reference?.document_id}`;
}

export function normalizeResourceReference(item) {
  if (!item || !["paper", "dataset"].includes(item.kind)) return null;
  const documentId = text(item.document_id);
  const datasetId = item.kind === "dataset" ? text(item.dataset_id || item.id) : null;
  const sha256 = text(item.sha256);
  if (!UUID_PATTERN.test(documentId) || !SHA256_PATTERN.test(sha256)) return null;
  if (item.kind === "dataset" && !UUID_PATTERN.test(datasetId)) return null;
  const id = item.kind === "paper" ? documentId : datasetId;
  return Object.freeze({
    kind: item.kind,
    id,
    document_id: documentId,
    ...(item.kind === "dataset" ? { dataset_id: datasetId } : {}),
    title: text(item.title),
    sha256,
    owner_title: text(item.owner_title),
    owner_kind: OWNER_KINDS.has(item.owner_kind) ? item.owner_kind : "",
    created_at: text(item.created_at),
    ...(Number.isInteger(item.page_count) && item.page_count >= 1 ? { page_count: item.page_count } : {})
  });
}

export function catalogResourceReference(item) {
  const reference = normalizeResourceReference(item);
  if (!reference || text(item.id) !== reference.id) return null;
  return reference;
}

export function resourceReferencesFromTurn(turn) {
  const items = turn?.context?.resource_refs;
  if (!Array.isArray(items)) return [];
  const references = [];
  const keys = new Set();
  for (const item of items) {
    const reference = normalizeResourceReference(item);
    if (!reference) continue;
    const key = resourceReferenceKey(reference);
    if (keys.has(key)) continue;
    keys.add(key);
    references.push(reference);
    if (references.length === 8) break;
  }
  return references;
}

export function resourceReferenceWire(reference) {
  if (reference.kind === "dataset") {
    return Object.freeze({
      kind: "dataset",
      document_id: reference.document_id,
      dataset_id: reference.dataset_id,
      sha256: reference.sha256
    });
  }
  return Object.freeze({
    kind: "paper",
    document_id: reference.document_id,
    sha256: reference.sha256
  });
}

export function createReferencePicker({ api, elements, t, getTarget, canEdit, onAdd }) {
  let generation = 0;
  let controller = null;
  let target = null;
  let kind = "paper";
  let query = "";
  let cursor = null;
  let previousCursors = [];
  let items = [];
  let nextCursor = null;
  let loading = false;
  let error = null;
  let notice = null;

  function currentTarget() {
    const current = getTarget();
    return current && target && current.paperId === target.paperId && current.entry === target.entry && current.conversationId === target.conversationId ? current : null;
  }

  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = null;
    loading = false;
  }

  function close() {
    invalidate();
    target = null;
    if (elements.dialog.open) elements.dialog.close();
  }

  function setStatus(kindName, key = null, retry = false) {
    elements.status.replaceChildren();
    elements.status.dataset.kind = kindName || "info";
    if (key) {
      const label = document.createElement("span");
      label.textContent = t(key);
      elements.status.append(label);
    }
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "status-retry";
      button.textContent = t("retry");
      button.addEventListener("click", () => load(cursor));
      elements.status.append(button);
    }
  }

  function renderStatus() {
    if (loading) setStatus("info", "referenceCatalogLoading");
    else if (error) setStatus("error", error, true);
    else if (notice) setStatus("success", notice);
    else if (!items.length) setStatus("info", "referenceCatalogEmpty");
    else setStatus(null);
  }

  function renderItems() {
    elements.list.replaceChildren();
    const entry = target?.entry;
    const keys = new Set(entry?.resourceRefs.map(resourceReferenceKey) || []);
    const editable = Boolean(currentTarget() && canEdit(target));
    for (const item of items) {
      const row = document.createElement("li");
      row.className = "assistant-reference-result";
      row.dataset.referenceKey = resourceReferenceKey(item);
      const description = document.createElement("div");
      description.className = "assistant-reference-result-description";
      const title = document.createElement("strong");
      title.textContent = item.title || t("referenceUntitled");
      const owner = document.createElement("span");
      const details = [item.kind === "paper" ? t("referencePaper") : t("referenceDataset"), item.owner_title || t("referenceOwnerUnknown")];
      if (item.kind === "paper" && item.page_count) details.push(t("referencePages", { count: item.page_count }));
      owner.textContent = details.join(" · ");
      description.append(title, owner);
      const add = document.createElement("button");
      add.type = "button";
      add.className = "button button-secondary assistant-reference-result-add";
      const added = keys.has(resourceReferenceKey(item));
      add.textContent = t(added ? "referenceAdded" : "referenceAdd");
      add.disabled = added || !editable || entry.resourceRefs.length >= 8;
      add.setAttribute("aria-label", `${t(added ? "referenceAdded" : "referenceAdd")}: ${title.textContent}`);
      const clickGeneration = generation;
      const clickTarget = target;
      add.addEventListener("click", () => {
        if (clickGeneration !== generation || clickTarget !== target || !currentTarget() || !canEdit(target)) return;
        const result = onAdd(target, item);
        notice = result === "added" ? "referenceAddedNotice" : result === "duplicate" ? "referenceDuplicate" : result === "limit" ? "resourceReferenceLimit" : "resourceReferenceBusy";
        renderItems();
        renderStatus();
      });
      row.append(description, add);
      elements.list.append(row);
    }
    elements.previous.disabled = loading || !previousCursors.length;
    elements.next.disabled = loading || !nextCursor;
  }

  function renderTabs() {
    for (const [name, button] of Object.entries(elements.tabs)) {
      const selected = name === kind;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  async function load(nextCursorValue) {
    if (!currentTarget() || !canEdit(target)) {
      close();
      return;
    }
    invalidate();
    const requestGeneration = generation;
    const requestTarget = target;
    const requestKind = kind;
    const requestQuery = query;
    const requestCursor = nextCursorValue;
    cursor = requestCursor;
    error = null;
    notice = null;
    items = [];
    nextCursor = null;
    loading = true;
    controller = new AbortController();
    const requestController = controller;
    renderItems();
    renderStatus();
    const params = new URLSearchParams({ kind: requestKind, q: requestQuery, limit: "20" });
    if (requestCursor) params.set("cursor", requestCursor);
    try {
      const body = await api(`/api/v1/agent/reference-catalog?${params.toString()}`, { signal: requestController.signal });
      if (requestGeneration !== generation || requestTarget !== target || requestKind !== kind || requestQuery !== query || requestCursor !== cursor || !currentTarget() || !canEdit(target)) return;
      items = (Array.isArray(body?.items) ? body.items : []).map(catalogResourceReference).filter(Boolean);
      nextCursor = typeof body?.next_cursor === "string" && body.next_cursor ? body.next_cursor : null;
      loading = false;
      renderItems();
      renderStatus();
    } catch (requestError) {
      if (requestError?.name === "AbortError" || requestGeneration !== generation || requestTarget !== target || !currentTarget() || !canEdit(target)) return;
      loading = false;
      error = "referenceCatalogFailed";
      renderItems();
      renderStatus();
    } finally {
      if (controller === requestController) controller = null;
    }
  }

  function selectKind(nextKind, focus = false) {
    if (!elements.tabs[nextKind]) return;
    kind = nextKind;
    previousCursors = [];
    cursor = null;
    renderTabs();
    if (focus) elements.tabs[kind].focus();
    load(null);
  }

  function open() {
    const nextTarget = getTarget();
    if (!nextTarget || !canEdit(nextTarget) || elements.dialog.open) return false;
    invalidate();
    target = nextTarget;
    kind = "paper";
    query = "";
    cursor = null;
    previousCursors = [];
    items = [];
    nextCursor = null;
    error = null;
    notice = null;
    elements.search.value = "";
    renderTabs();
    renderItems();
    elements.dialog.showModal();
    load(null);
    return true;
  }

  elements.add.addEventListener("click", open);
  elements.close.addEventListener("click", close);
  elements.dialog.addEventListener("close", invalidate);
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    query = elements.search.value.trim().slice(0, 200);
    previousCursors = [];
    load(null);
  });
  for (const [name, button] of Object.entries(elements.tabs)) {
    button.addEventListener("click", () => selectKind(name));
    button.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = name === "paper" ? "dataset" : "paper";
      else if (event.key === "Home") next = "paper";
      else if (event.key === "End") next = "dataset";
      if (!next) return;
      event.preventDefault();
      selectKind(next, true);
    });
  }
  elements.previous.addEventListener("click", () => {
    if (!previousCursors.length || loading) return;
    load(previousCursors.pop());
  });
  elements.next.addEventListener("click", () => {
    if (!nextCursor || loading) return;
    previousCursors.push(cursor);
    load(nextCursor);
  });

  return {
    close,
    isOpen: () => elements.dialog.open,
    render() {
      const current = getTarget();
      elements.add.disabled = !current || !canEdit(current);
      if (elements.dialog.open && (!currentTarget() || !canEdit(target))) close();
      else if (elements.dialog.open) {
        renderItems();
        elements.previous.disabled = loading || !previousCursors.length;
        elements.next.disabled = loading || !nextCursor;
      }
    },
    applyLanguage() {
      elements.add.textContent = t("addReferences");
      elements.dialog.setAttribute("aria-label", t("referencePickerTitle"));
      elements.heading.textContent = t("referencePickerTitle");
      elements.close.textContent = t("closeReferences");
      elements.close.setAttribute("aria-label", t("closeReferences"));
      elements.searchLabel.textContent = t("referenceSearch");
      elements.search.setAttribute("aria-label", t("referenceSearch"));
      elements.search.placeholder = t("referenceSearchPlaceholder");
      elements.searchSubmit.textContent = t("referenceSearchSubmit");
      elements.tabs.paper.textContent = t("referencePapers");
      elements.tabs.dataset.textContent = t("referenceDatasets");
      elements.scope.textContent = t("referencePickerScope");
      elements.list.setAttribute("aria-label", t("referenceResults"));
      elements.previous.textContent = t("referencePrevious");
      elements.next.textContent = t("referenceNext");
      renderTabs();
      if (elements.dialog.open) {
        renderItems();
        renderStatus();
      }
    }
  };
}
