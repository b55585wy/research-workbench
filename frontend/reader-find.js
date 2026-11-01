const MAX_RESULTS = 2000;
const MAX_PAGE_CHARACTERS = 100000;
const MAX_TOTAL_CHARACTERS = 4000000;

function normalizedWithMap(text) {
  let normalized = "";
  const map = [];
  let pendingSpace = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) {
      if (normalized.length) pendingSpace = index;
      continue;
    }
    if (pendingSpace !== null && normalized.length && !normalized.endsWith(" ")) {
      normalized += " ";
      map.push(pendingSpace);
    }
    pendingSpace = null;
    normalized += character;
    map.push(index);
  }
  return { normalized, map };
}

function normalizedQuery(query) {
  return normalizedWithMap(query).normalized.toLocaleLowerCase();
}

function textFromItems(items) {
  return items.map((item) => `${item.str || ""}${item.hasEOL ? "\n" : ""}`).join("");
}

function domTextModel(layer) {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === "BR" && !node.closest(".endOfContent")) text += "\n";
      continue;
    }
    if (node.parentElement?.closest(".endOfContent")) continue;
    nodes.push({ node, start: text.length, end: text.length + node.data.length });
    text += node.data;
  }
  return { text, nodes };
}

function findOccurrences(text, query) {
  const foldedText = text.toLocaleLowerCase();
  const foldedQuery = normalizedQuery(query);
  if (!foldedQuery) return [];
  const matches = [];
  let offset = 0;
  while (offset <= foldedText.length - foldedQuery.length) {
    const index = foldedText.indexOf(foldedQuery, offset);
    if (index < 0) break;
    matches.push({ start: index, end: index + foldedQuery.length });
    offset = index + Math.max(1, foldedQuery.length);
  }
  return matches;
}

function rangeForMatch(layer, match) {
  const { text, nodes } = domTextModel(layer);
  const { normalized, map } = normalizedWithMap(text);
  const occurrences = findOccurrences(normalized, match.query);
  const occurrence = occurrences[match.occurrence];
  if (!occurrence) return null;
  const locate = (normalizedOffset, end = false) => {
    const rawIndex = map[Math.max(0, Math.min(map.length - 1, normalizedOffset))] + (end ? 1 : 0);
    for (const entry of nodes) {
      if (rawIndex >= entry.start && rawIndex <= entry.end) return { node: entry.node, offset: rawIndex - entry.start };
    }
    return null;
  };
  const start = locate(occurrence.start);
  const end = locate(occurrence.end - 1, true);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

export function createReaderFind(adapter) {
  const elements = {
    toggle: document.getElementById("reader-find-toggle"),
    panel: document.getElementById("reader-find-panel"),
    input: document.getElementById("reader-find-input"),
    previous: document.getElementById("reader-find-prev"),
    next: document.getElementById("reader-find-next"),
    close: document.getElementById("reader-find-close"),
    retry: document.getElementById("reader-find-retry"),
    status: document.getElementById("reader-find-status"),
    results: document.getElementById("reader-find-results")
  };
  const state = {
    open: false,
    enabled: false,
    generation: 0,
    query: "",
    results: [],
    activeIndex: -1,
    searching: false,
    scanned: 0,
    emptyPages: 0,
    failedPages: 0,
    partial: false,
    error: false
  };

  function t(key, values) {
    return adapter.t(key, values);
  }

  function clearHighlights() {
    document.querySelectorAll("[data-find-match]").forEach((node) => node.remove());
  }

  function currentOwner() {
    return adapter.getDocument()?.id || null;
  }

  function isCurrent(generation, ownerId, query = state.query) {
    return generation === state.generation && currentOwner() === ownerId && state.query === query && adapter.getPdf();
  }

  function statusText() {
    if (state.searching) return t("findSearching", { page: Math.min(state.scanned + 1, adapter.getDocument()?.page_count || 1), total: adapter.getDocument()?.page_count || 1 });
    if (!state.query) return t("findEmpty");
    if (!state.results.length) return t("findNoMatches", { scanned: state.scanned });
    const key = state.partial && state.results.length >= MAX_RESULTS ? "findCountPartial" : "findCount";
    return t(key, {
      current: state.activeIndex + 1,
      count: state.results.length,
      page: state.results[state.activeIndex]?.page || state.results[0].page,
      scanned: state.scanned
    });
  }

  function render() {
    elements.panel.hidden = !state.open;
    elements.toggle.setAttribute("aria-expanded", String(state.open));
    elements.toggle.disabled = !state.enabled;
    elements.previous.disabled = !state.results.length || state.searching;
    elements.next.disabled = !state.results.length || state.searching;
    elements.retry.hidden = !state.error && !state.failedPages;
    elements.status.textContent = state.open ? statusText() : "";
    elements.status.dataset.kind = state.error || state.failedPages ? "error" : "info";
    const notes = [];
    if (state.partial && state.results.length < MAX_RESULTS) notes.push(t("findPartial", { scanned: state.scanned }));
    if (state.emptyPages) notes.push(t("findScanned", { count: state.emptyPages }));
    if (state.failedPages) notes.push(t("findFailed", { count: state.failedPages }));
    if (notes.length) elements.status.textContent += ` ${notes.join(" ")}`;
    elements.results.replaceChildren();
    if (!state.open) return;
    state.results.forEach((result, index) => {
      const item = document.createElement("li");
      item.className = "reader-find-result";
      item.dataset.active = String(index === state.activeIndex);
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => void activate(index));
      const page = document.createElement("span");
      page.className = "reader-find-result-page";
      page.textContent = `${result.page}.`;
      const excerpt = document.createElement("span");
      excerpt.textContent = result.excerpt;
      button.append(page, excerpt);
      item.append(button);
      elements.results.append(item);
    });
  }

  async function search(query) {
    const generation = ++state.generation;
    const ownerId = currentOwner();
    const pdf = adapter.getPdf();
    const trimmed = query.trim().slice(0, 200);
    clearHighlights();
    Object.assign(state, {
      query: trimmed,
      results: [],
      activeIndex: -1,
      searching: Boolean(trimmed && pdf && ownerId),
      scanned: 0,
      emptyPages: 0,
      failedPages: 0,
      partial: false,
      error: false
    });
    render();
    if (!state.searching) return;
    let totalCharacters = 0;
    let stop = false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages && !stop; pageNumber += 1) {
      if (!isCurrent(generation, ownerId, trimmed)) return;
      try {
        const page = await pdf.getPage(pageNumber);
        if (!isCurrent(generation, ownerId, trimmed)) return;
        const content = await page.getTextContent();
        if (!isCurrent(generation, ownerId, trimmed)) return;
        let raw = textFromItems(content.items || []);
        if (raw.length > MAX_PAGE_CHARACTERS) {
          raw = raw.slice(0, MAX_PAGE_CHARACTERS);
          state.partial = true;
        }
        const remaining = MAX_TOTAL_CHARACTERS - totalCharacters;
        if (raw.length > remaining) {
          raw = raw.slice(0, Math.max(0, remaining));
          state.partial = true;
          stop = true;
        }
        totalCharacters += raw.length;
        const normalized = normalizedWithMap(raw).normalized;
        if (!normalized.trim()) state.emptyPages += 1;
        const matches = findOccurrences(normalized, trimmed);
        for (const [occurrence, match] of matches.entries()) {
          if (state.results.length >= MAX_RESULTS) {
            state.partial = true;
            stop = true;
            break;
          }
          const excerptStart = Math.max(0, match.start - 60);
          const excerptEnd = Math.min(normalized.length, match.end + 100);
          state.results.push({
            page: pageNumber,
            occurrence,
            query: trimmed,
            excerpt: `${excerptStart ? "…" : ""}${normalized.slice(excerptStart, excerptEnd)}${excerptEnd < normalized.length ? "…" : ""}`
          });
        }
        state.scanned += 1;
        if (totalCharacters >= MAX_TOTAL_CHARACTERS && pageNumber < pdf.numPages) {
          state.partial = true;
          stop = true;
        }
      } catch {
        if (!isCurrent(generation, ownerId, trimmed)) return;
        state.failedPages += 1;
        state.partial = true;
        state.scanned += 1;
      }
      if (!isCurrent(generation, ownerId, trimmed)) return;
      render();
    }
    if (!isCurrent(generation, ownerId, trimmed)) return;
    state.searching = false;
    state.activeIndex = state.results.length ? 0 : -1;
    render();
    if (state.activeIndex >= 0) await activate(0);
  }

  function showActiveMatch(reveal = false) {
    clearHighlights();
    if (!state.open || state.activeIndex < 0) return;
    const activeMatch = state.results[state.activeIndex];
    const layer = adapter.getTextLayer(activeMatch.page);
    const surface = adapter.getPageSurface(activeMatch.page);
    if (!layer || !surface || !layer.childNodes.length) return;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    let findLayer = surface.querySelector(".reader-find-layer");
    if (!findLayer) {
      findLayer = document.createElement("div");
      findLayer.className = "reader-find-layer";
      findLayer.setAttribute("aria-hidden", "true");
      surface.append(findLayer);
    }
    const activeHighlights = [];
    state.results.forEach((match, index) => {
      if (match.page !== activeMatch.page) return;
      const range = rangeForMatch(layer, match);
      if (!range) return;
      for (const rect of range.getClientRects()) {
        const left = Math.max(bounds.left, rect.left);
        const top = Math.max(bounds.top, rect.top);
        const right = Math.min(bounds.right, rect.right);
        const bottom = Math.min(bounds.bottom, rect.bottom);
        if (right <= left || bottom <= top) continue;
        const highlight = document.createElement("div");
        highlight.className = "reader-find-match";
        highlight.dataset.findMatch = String(index);
        highlight.dataset.findActive = String(index === state.activeIndex);
        highlight.style.left = `${left - bounds.left}px`;
        highlight.style.top = `${top - bounds.top}px`;
        highlight.style.width = `${right - left}px`;
        highlight.style.height = `${bottom - top}px`;
        findLayer.append(highlight);
        if (index === state.activeIndex) activeHighlights.push(highlight);
      }
    });
    if (reveal) activeHighlights[0]?.scrollIntoView({ block: "center", inline: "nearest" });
  }

  async function activate(index) {
    if (index < 0 || index >= state.results.length) return;
    const generation = state.generation;
    const ownerId = currentOwner();
    state.activeIndex = index;
    render();
    clearHighlights();
    const match = state.results[index];
    await adapter.goToPage(match.page, { preserveHighlight: true });
    if (!isCurrent(generation, ownerId) || state.activeIndex !== index) return;
    showActiveMatch(true);
    const active = elements.results.children[index];
    active?.scrollIntoView({ block: "nearest" });
  }

  function open() {
    if (!state.enabled) return;
    state.open = true;
    render();
    elements.input.focus();
    elements.input.select();
  }

  function close() {
    state.generation += 1;
    state.open = false;
    state.searching = false;
    state.results = [];
    state.activeIndex = -1;
    clearHighlights();
    render();
    elements.toggle.focus({ preventScroll: true });
  }

  elements.toggle.addEventListener("click", () => state.open ? close() : open());
  elements.close.addEventListener("click", close);
  elements.retry.addEventListener("click", () => void search(elements.input.value));
  elements.previous.addEventListener("click", () => void activate((state.activeIndex - 1 + state.results.length) % state.results.length));
  elements.next.addEventListener("click", () => void activate((state.activeIndex + 1) % state.results.length));
  elements.input.addEventListener("input", () => void search(elements.input.value));
  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && state.results.length) {
      event.preventDefault();
      const offset = event.shiftKey ? -1 : 1;
      void activate((state.activeIndex + offset + state.results.length) % state.results.length);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open && event.target !== elements.input) {
      close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f" && state.enabled) {
      if (event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return;
      if (!adapter.isReadingVisible()) return;
      event.preventDefault();
      open();
    }
  });

  return {
    applyLanguage() {
      elements.panel.setAttribute("aria-label", t("findInPdf"));
      elements.previous.setAttribute("aria-label", t("findPrevious"));
      elements.next.setAttribute("aria-label", t("findNext"));
      elements.results.setAttribute("aria-label", t("findInPdf"));
      render();
    },
    update() {
      const enabled = Boolean(adapter.getPdf() && currentOwner() && !adapter.isStudy());
      state.enabled = enabled;
      if (!enabled && state.open) {
        state.generation += 1;
        state.open = false;
        state.results = [];
        state.activeIndex = -1;
        clearHighlights();
      }
      render();
    },
    documentChanged() {
      state.generation += 1;
      state.open = false;
      state.searching = false;
      state.query = "";
      state.results = [];
      state.activeIndex = -1;
      elements.input.value = "";
      clearHighlights();
      render();
    },
    pageRendered(page) {
      if (state.open && state.results[state.activeIndex]?.page === page) showActiveMatch();
    },
    clearHighlights
  };
}
