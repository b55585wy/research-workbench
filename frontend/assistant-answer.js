import { renderAssistantMarkdown } from "/assistant-markdown.js";

const MAX_COLUMNS = 20;
const MAX_ROWS = 200;

export function isPdfPageSource(source) {
  return Boolean(source && ["associated_pdf_page", "pdf_page", "reference_pdf_page"].includes(source.kind) &&
    typeof source.document_id === "string" && source.document_id &&
    Number.isInteger(source.page) && source.page >= 1);
}

export function pdfPageApplicationUrl(source) {
  if (!isPdfPageSource(source)) return null;
  return `/?document=${encodeURIComponent(source.document_id)}&page=${source.page}`;
}

export function onlineDatasetSourceUrl(source) {
  const url = source?.url;
  if (source?.kind !== "online_dataset" || typeof url !== "string" || !url || url.length > 500 || /[\\\s\u0000-\u001F\u007F-\u009F?#]/.test(url)) return null;
  if (!/^https:\/\/(doi\.org|zenodo\.org)\//.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.href !== url) return null;
  if (parsed.hostname === "doi.org") {
    if (!/^\/10\.\d{4,9}\/[^\s\\?#]+$/.test(parsed.pathname)) return null;
  } else if (parsed.hostname === "zenodo.org") {
    if (!/^\/records\/[1-9]\d{0,11}$/.test(parsed.pathname)) return null;
  } else {
    return null;
  }
  return url;
}

function backtickRun(text, index) {
  let end = index;
  while (text[end] === "`") end += 1;
  return end - index;
}

function closingBacktickRun(text, index, length) {
  let cursor = index;
  while (cursor < text.length) {
    const start = text.indexOf("`", cursor);
    if (start < 0) return -1;
    const run = backtickRun(text, start);
    if (run === length) return start;
    cursor = start + run;
  }
  return -1;
}

function tableRowCells(line) {
  const cells = [];
  let cell = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] === "\\" && index + 1 < line.length) {
      cell += line.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (line[index] === "`") {
      const run = backtickRun(line, index);
      const closing = closingBacktickRun(line, index + run, run);
      if (closing >= 0) {
        cell += line.slice(index, closing + run);
        index = closing + run;
      } else {
        cell += line.slice(index, index + run);
        index += run;
      }
      continue;
    }
    if (line[index] === "|") {
      cells.push(cell);
      cell = "";
      index += 1;
      continue;
    }
    cell += line[index];
    index += 1;
  }
  cells.push(cell);
  if (/^\s*\|/.test(line) && cells[0]?.trim() === "") cells.shift();
  const trailingPipe = /\|\s*$/.test(line) ? line.lastIndexOf("|") : -1;
  let precedingBackslashes = 0;
  while (trailingPipe - precedingBackslashes - 1 >= 0 && line[trailingPipe - precedingBackslashes - 1] === "\\") precedingBackslashes += 1;
  if (trailingPipe >= 0 && precedingBackslashes % 2 === 0 && cells.at(-1)?.trim() === "") cells.pop();
  return cells;
}

function tableProblem(table, rawSource) {
  const headerRows = [...(table.tHead?.rows || [])];
  const bodyRows = [...table.tBodies].flatMap((body) => [...body.rows]);
  const columns = headerRows.length === 1 ? headerRows[0].cells.length : 0;
  if (columns > MAX_COLUMNS || bodyRows.length > MAX_ROWS) return "tableTooLarge";
  if (!columns || bodyRows.some((row) => row.cells.length !== columns)) return "tableMalformed";
  if (rawSource) {
    const lines = rawSource.split("\n");
    if (lines.length - 2 > MAX_ROWS) return "tableTooLarge";
    if (lines.length < 2) return "tableMalformed";
    const headers = tableRowCells(lines[0]);
    const separator = tableRowCells(lines[1]);
    if (headers.length > MAX_COLUMNS) return "tableTooLarge";
    if (headers.length !== separator.length || lines.slice(2).some((line) => tableRowCells(line).length !== headers.length)) return "tableMalformed";
  }
  return null;
}

function sourceMap(sources) {
  const map = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source && typeof source.ref === "string" && !map.has(source.ref)) map.set(source.ref, source);
  }
  return map;
}

function resolvableSource(source, ref) {
  if (!source || source.ref !== ref || typeof source.document_id !== "string" || !source.document_id) return false;
  if (source.kind === "online_dataset") return Boolean(onlineDatasetSourceUrl(source));
  return !["associated_pdf_page", "pdf_page", "reference_pdf_page"].includes(source.kind) || isPdfPageSource(source);
}

function appendCitation(container, ref, source, options, usedSources) {
  if (!resolvableSource(source, ref)) {
    const unknown = document.createElement("span");
    unknown.className = "assistant-citation-unverified";
    unknown.textContent = ref;
    unknown.title = options.t("citationUnverified");
    unknown.setAttribute("aria-label", `${ref}: ${options.t("citationUnverified")}`);
    container.append(unknown);
    return;
  }
  const label = source.label || ref;
  const onlineDatasetUrl = onlineDatasetSourceUrl(source);
  let control;
  if (isPdfPageSource(source) || onlineDatasetUrl) {
    control = document.createElement("a");
    control.href = onlineDatasetUrl || pdfPageApplicationUrl(source);
    control.target = "_blank";
    control.rel = "noopener noreferrer";
    control.setAttribute("aria-label", options.t("citationNewTab", { ref, label }));
    control.title = options.t("citationNewTab", { ref, label });
  } else {
    control = document.createElement("button");
    control.type = "button";
    control.setAttribute("aria-label", options.t("citationOpen", { ref, label }));
    control.title = options.t("citationOpen", { ref, label });
    control.addEventListener("click", () => options.onOpenSource(source));
  }
  control.className = "assistant-citation";
  control.dataset.sourceRef = ref;
  control.textContent = ref;
  container.append(control);
  usedSources.add(source);
}

function appendCitationMarker(container, marker, options, usedSources) {
  let cursor = 0;
  for (const match of marker.matchAll(/R\d+/g)) {
    if (match.index > cursor) container.append(document.createTextNode(marker.slice(cursor, match.index)));
    appendCitation(container, match[0], options.sourceByRef.get(match[0]), options, usedSources);
    cursor = match.index + match[0].length;
  }
  if (cursor < marker.length) container.append(document.createTextNode(marker.slice(cursor)));
}

function appendCitations(container, text, options, usedSources) {
  let cursor = 0;
  const pattern = /\[R\d+(?:\s*,\s*R\d+)*\]/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
    appendCitationMarker(container, match[0], options, usedSources);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function enhanceCitations(root, options, usedSources, skipTables = false) {
  const citationLinks = [...root.querySelectorAll("a")].filter((link) => {
    if (!/^(?:R\d+(?:\s*,\s*R\d+)*|\[R\d+(?:\s*,\s*R\d+)*\])$/.test(link.textContent || "")) return false;
    if (link.closest("pre, code, .katex, .katex-error, .math, script, style")) return false;
    return !skipTables || !link.closest("table");
  });
  for (const link of citationLinks) {
    const fragment = document.createDocumentFragment();
    appendCitationMarker(fragment, link.textContent, options, usedSources);
    link.replaceWith(fragment);
  }
  const candidates = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !/\[R\d+(?:\s*,\s*R\d+)*\]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest("pre, code, a, .katex, .katex-error, .math, script, style")) return NodeFilter.FILTER_REJECT;
      if (skipTables && parent.closest("table")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let current = walker.nextNode();
  while (current) {
    candidates.push(current);
    current = walker.nextNode();
  }
  for (const node of candidates) {
    const fragment = document.createDocumentFragment();
    appendCitations(fragment, node.nodeValue, options, usedSources);
    node.replaceWith(fragment);
  }
}

function safeLink(href) {
  if (!href || href.length > 2048 || /[\u0000-\u001F\u007F]/.test(href)) return null;
  try {
    const parsed = new URL(href, window.location.origin);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function enhanceLinks(container) {
  for (const link of container.querySelectorAll("a")) {
    const parsed = safeLink(link.getAttribute("href") || "");
    if (!parsed) {
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.classList.add("assistant-answer-link-disabled");
      continue;
    }
    link.href = parsed.href;
    if (parsed.protocol === "mailto:" || parsed.origin !== window.location.origin) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.removeAttribute("target");
      link.removeAttribute("rel");
    }
  }
}

function sourceUrl(source) {
  return typeof source.url === "string" && source.url ? source.url : pdfPageApplicationUrl(source) || "";
}

function exportCell(cell) {
  const clone = cell.cloneNode(true);
  for (const math of clone.querySelectorAll(".katex")) {
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex) math.replaceWith(document.createTextNode(`$${tex}$`));
    else math.querySelectorAll(".katex-mathml").forEach((element) => element.remove());
  }
  for (const breakElement of clone.querySelectorAll("br")) breakElement.replaceWith(document.createTextNode("\n"));
  return clone.textContent.trim();
}

function exportRows(table, usedSources, options) {
  const rows = [];
  for (const row of [...(table.tHead?.rows || []), ...[...table.tBodies].flatMap((body) => [...body.rows])]) {
    rows.push([...row.cells].map(exportCell));
  }
  if (usedSources.size) {
    rows.push([], [options.t("provenance")], ["Ref", options.t("paper"), options.t("page"), options.t("sourceUrl")]);
    for (const source of usedSources) {
      rows.push([source.ref, source.label || source.ref, Number.isInteger(source.page) ? String(source.page) : "", sourceUrl(source)]);
    }
  }
  return rows;
}

function spreadsheetSafe(value) {
  const text = String(value ?? "");
  return /^\s*[=+\-@]|^\s*[\t\r\n]/.test(text) ? `'${text}` : text;
}

function tsvContent(rows) {
  return rows.map((row) => row.map((cell) => spreadsheetSafe(cell).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
}

function csvContent(rows) {
  return rows.map((row) => row.map((cell) => `"${spreadsheetSafe(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

function appendTableActions(container, table, usedSources, options) {
  const actions = document.createElement("div");
  actions.className = "assistant-answer-table-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "button button-quiet";
  copy.dataset.action = "copy-assistant-table";
  copy.textContent = options.t("copyTable");
  const download = document.createElement("button");
  download.type = "button";
  download.className = "button button-quiet";
  download.dataset.action = "download-assistant-table";
  download.textContent = options.t("downloadCsv");
  const status = document.createElement("span");
  status.className = "assistant-answer-table-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  copy.addEventListener("click", async () => {
    status.textContent = "";
    status.dataset.kind = "info";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(tsvContent(exportRows(table, usedSources, options)));
      status.dataset.kind = "success";
      status.textContent = options.t("tableCopied");
    } catch {
      status.dataset.kind = "error";
      status.textContent = options.t("copyFailed");
    }
  });
  download.addEventListener("click", () => {
    status.textContent = "";
    status.dataset.kind = "info";
    let url = null;
    let link = null;
    try {
      const blob = new Blob(["\ufeff", csvContent(exportRows(table, usedSources, options))], { type: "text/csv;charset=utf-8" });
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url;
      link.download = options.language === "zh" ? "助手表格.csv" : "assistant-table.csv";
      link.hidden = true;
      document.body.append(link);
      link.click();
    } catch {
      status.dataset.kind = "error";
      status.textContent = options.t("downloadFailed");
    } finally {
      link?.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  });
  actions.append(copy, download, status);
  container.append(actions);
}

function appendTableFallback(table, rawSource, problem, options) {
  const block = document.createElement("div");
  block.className = "assistant-answer-table-block assistant-answer-table-fallback";
  const notice = document.createElement("p");
  notice.className = "assistant-rendering-notice";
  notice.setAttribute("role", "note");
  notice.textContent = options.t(problem, { columns: MAX_COLUMNS, rows: MAX_ROWS });
  const content = document.createElement("pre");
  content.className = "assistant-answer-plain";
  content.tabIndex = 0;
  content.textContent = rawSource || table.textContent;
  block.append(notice, content);
  table.replaceWith(block);
}

function enhanceTable(table, rawSource, options) {
  const problem = tableProblem(table, rawSource);
  if (problem) {
    appendTableFallback(table, rawSource, problem, options);
    return;
  }
  const usedSources = new Set();
  enhanceCitations(table, options, usedSources);
  table.classList.add("assistant-answer-table");
  for (const row of table.tHead?.rows || []) {
    for (const cell of row.cells) cell.scope = "col";
  }
  const block = document.createElement("div");
  block.className = "assistant-answer-table-block";
  const scroll = document.createElement("div");
  scroll.className = "assistant-answer-table-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", options.t("tableScroll"));
  scroll.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
  table.before(block);
  scroll.append(table);
  block.append(scroll);
  appendTableActions(block, table, usedSources, options);
}

export function renderAssistantAnswer(container, { answer, sources, language, t, onOpenSource }) {
  const options = { sourceByRef: sourceMap(sources), language, t, onOpenSource };
  const normalized = String(answer).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const { fragment, tableSources } = renderAssistantMarkdown(normalized, { t });
  container.append(fragment);
  enhanceLinks(container);
  for (const code of container.querySelectorAll("pre")) code.tabIndex = 0;
  const tables = [...container.querySelectorAll("table")];
  tables.forEach((table, index) => enhanceTable(table, tableSources[index] || "", options));
  enhanceCitations(container, options, new Set(), true);
}
