const KINDS = ["dataset", "analysis", "chart"];

const messages = {
  zh: {
    title: "数据目录",
    myData: "我的数据",
    search: "搜索数据、分析和图表",
    searchPlaceholder: "按标题或所属文献、项目搜索",
    refresh: "刷新",
    datasets: "数据集",
    analyses: "分析",
    charts: "图表",
    loadMore: "加载更多",
    loading: "正在加载…",
    loadingMore: "正在加载更多…",
    empty: "没有匹配的记录。",
    loadFailed: "目录加载失败，请重试。",
    retry: "重试",
    paper: "文献",
    project: "项目",
    personal: "我的数据",
    untitled: "未命名记录",
    queued: "已排队",
    running: "正在运行",
    succeeded: "已完成",
    failed: "未完成",
    cancelled: "已取消",
    interrupted: "已中断",
    waiting_confirmation: "等待确认"
  },
  en: {
    title: "Data catalog",
    myData: "My data",
    search: "Search datasets, analyses, and charts",
    searchPlaceholder: "Search by title or owning paper/project",
    refresh: "Refresh",
    datasets: "Datasets",
    analyses: "Analyses",
    charts: "Charts",
    loadMore: "Load more",
    loading: "Loading…",
    loadingMore: "Loading more…",
    empty: "No matching records.",
    loadFailed: "The catalog could not be loaded. Try again.",
    retry: "Retry",
    paper: "Paper",
    project: "Project",
    personal: "My data",
    untitled: "Untitled record",
    queued: "Queued",
    running: "Running",
    succeeded: "Completed",
    failed: "Not completed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
    waiting_confirmation: "Waiting for confirmation"
  }
};

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createDataNavigation(adapter) {
  const root = document.getElementById("data-navigation");
  const headingRow = make("div", "panel-heading data-navigation-heading");
  const heading = make("h2");
  heading.id = "data-navigation-heading";
  const myData = make("button", "button button-primary");
  myData.type = "button";
  myData.dataset.action = "open-personal-data";
  headingRow.append(heading, myData);

  const searchForm = make("form", "data-catalog-search");
  searchForm.setAttribute("role", "search");
  const searchLabel = make("label", "data-catalog-search-label");
  const searchLabelText = make("span");
  const searchInput = make("input", "data-catalog-search-input");
  searchInput.type = "search";
  searchInput.maxLength = 200;
  searchInput.autocomplete = "off";
  const refresh = make("button", "button button-secondary", "");
  refresh.type = "submit";
  searchLabel.append(searchLabelText, searchInput);
  searchForm.append(searchLabel, refresh);

  const lists = new Map();
  const states = new Map();
  const body = make("div", "data-catalog-groups");
  for (const kind of KINDS) {
    const section = make("section", "data-catalog-group");
    const groupHeading = make("h3", "data-catalog-group-heading");
    const list = make("ul", "documents-list data-catalog-list");
    const status = make("div", "data-catalog-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const more = make("button", "button button-quiet data-catalog-more");
    more.type = "button";
    more.addEventListener("click", () => load(kind, true));
    section.append(groupHeading, list, status, more);
    body.append(section);
    lists.set(kind, { section, groupHeading, list, status, more });
    states.set(kind, {
      items: [],
      nextCursor: null,
      loaded: false,
      pending: false,
      error: null,
      retryAppend: false,
      generation: 0,
      controller: null
    });
  }
  root.replaceChildren(headingRow, searchForm, body);

  let language = adapter.getLanguage();
  let active = false;
  let entered = false;
  let stale = true;
  let query = "";
  let queryTimer = null;
  let refreshTimer = null;
  let navigationPending = false;

  function t(key) {
    return messages[language]?.[key] || messages.en[key] || key;
  }

  function kindLabel(kind) {
    return t({ dataset: "datasets", analysis: "analyses", chart: "charts" }[kind]);
  }

  function ownerLabel(item) {
    const kind = item.owner_kind === "personal" ? "personal" : item.owner_kind === "project" ? "project" : "paper";
    const title = kind === "personal" ? t("personal") : item.owner_title || t(kind);
    return `${t(kind)} · ${title}`;
  }

  function renderStatus(kind) {
    const state = states.get(kind);
    const ui = lists.get(kind);
    ui.status.replaceChildren();
    if (state.pending) {
      ui.status.textContent = t(state.items.length ? "loadingMore" : "loading");
      return;
    }
    if (state.error) {
      ui.status.append(make("span", "", t("loadFailed")));
      const retry = make("button", "status-retry", t("retry"));
      retry.type = "button";
      retry.addEventListener("click", () => load(kind, state.retryAppend));
      ui.status.append(retry);
      return;
    }
    if (state.loaded && !state.items.length) ui.status.textContent = t("empty");
  }

  function render() {
    root.hidden = !active;
    heading.textContent = t("title");
    myData.textContent = t("myData");
    myData.disabled = navigationPending;
    searchLabelText.textContent = t("search");
    searchInput.placeholder = t("searchPlaceholder");
    searchInput.setAttribute("aria-label", t("search"));
    searchInput.disabled = navigationPending;
    refresh.textContent = t("refresh");
    refresh.disabled = navigationPending;
    if (searchInput.value !== query) searchInput.value = query;
    for (const kind of KINDS) {
      const state = states.get(kind);
      const ui = lists.get(kind);
      ui.groupHeading.textContent = state.items.length ? `${kindLabel(kind)} (${state.items.length})` : kindLabel(kind);
      ui.list.setAttribute("aria-label", kindLabel(kind));
      ui.list.replaceChildren();
      for (const item of state.items) {
        const row = make("li", "document-item data-catalog-item");
        row.dataset.catalogKind = kind;
        row.dataset.catalogId = item.id;
        row.dataset.ownerId = item.document_id;
        const open = make("button", "document-open data-catalog-open");
        open.type = "button";
        open.disabled = navigationPending;
        open.addEventListener("click", () => void adapter.openCatalogItem(item));
        const meta = [ownerLabel(item)];
        if (kind === "analysis" && item.status) meta.push(t(item.status));
        if (kind === "chart" && Number.isInteger(item.revision)) meta.push(`v${item.revision}`);
        open.append(
          make("span", "document-name", item.title || t("untitled")),
          make("span", "document-meta", meta.join(" · "))
        );
        row.append(open);
        ui.list.append(row);
      }
      renderStatus(kind);
      ui.more.textContent = t("loadMore");
      ui.more.hidden = !state.nextCursor;
      ui.more.disabled = navigationPending || state.pending;
    }
  }

  async function load(kind, append = false) {
    if (!active) {
      stale = true;
      return;
    }
    const state = states.get(kind);
    state.controller?.abort();
    const generation = ++state.generation;
    const controller = new AbortController();
    state.controller = controller;
    const requestQuery = query;
    const cursor = append ? state.nextCursor : null;
    state.pending = true;
    state.error = null;
    state.retryAppend = false;
    render();
    const params = new URLSearchParams({ kind, limit: "20" });
    if (requestQuery) params.set("q", requestQuery);
    if (cursor) params.set("cursor", cursor);
    try {
      const body = await adapter.api(`/api/v1/data-workspace/catalog?${params}`, { signal: controller.signal });
      if (!active || generation !== state.generation || query !== requestQuery) return;
      const items = Array.isArray(body.items) ? body.items : [];
      const merged = append ? [...state.items, ...items] : items;
      state.items = [...new Map(merged.map((item) => [item.id, item])).values()];
      state.nextCursor = typeof body.next_cursor === "string" ? body.next_cursor : null;
      state.loaded = true;
      stale = false;
    } catch (error) {
      if (error?.name === "AbortError" || generation !== state.generation) return;
      state.error = error.code || "request_failed";
      state.retryAppend = append;
    } finally {
      if (generation === state.generation) {
        state.pending = false;
        state.controller = null;
        render();
      }
    }
  }

  function refreshAll() {
    if (!active) {
      stale = true;
      return;
    }
    for (const kind of KINDS) void load(kind, false);
  }

  function cancelPending() {
    if (queryTimer) clearTimeout(queryTimer);
    if (refreshTimer) clearTimeout(refreshTimer);
    queryTimer = null;
    refreshTimer = null;
    if ([...states.values()].some((state) => state.pending || !state.loaded || state.error)) stale = true;
    for (const state of states.values()) {
      state.generation += 1;
      state.controller?.abort();
      state.controller = null;
      state.pending = false;
    }
  }

  function changeQuery(next) {
    if (next === query) return;
    query = next;
    for (const state of states.values()) {
      state.items = [];
      state.nextCursor = null;
      state.loaded = false;
      state.error = null;
      state.retryAppend = false;
    }
  }

  myData.addEventListener("click", () => void adapter.openPersonalData());
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = null;
    changeQuery(searchInput.value.trim().slice(0, 200));
    refreshAll();
  });
  searchInput.addEventListener("input", () => {
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      queryTimer = null;
      const next = searchInput.value.trim().slice(0, 200);
      if (next === query) return;
      changeQuery(next);
      refreshAll();
    }, 250);
  });

  render();

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      render();
    },
    setMode(mode) {
      const nextActive = mode === "data";
      if (active === nextActive) return;
      active = nextActive;
      if (!active) cancelPending();
      render();
      if (active && (!entered || stale)) refreshAll();
      if (active) entered = true;
    },
    setNavigationPending(pending) {
      navigationPending = Boolean(pending);
      render();
    },
    sourcesChanged() {
      stale = true;
      if (!active || refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshAll();
      }, 150);
    },
    documentChanged: render
  };
}
