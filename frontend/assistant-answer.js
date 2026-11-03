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

function splitTableRow(line) {
  const cells = [];
  let cell = "";
  let hasPipe = false;
  let index = 0;
  while (index < line.length) {
    if (line[index] === "\\" && line[index + 1] === "|") {
      cell += "\\|";
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
      hasPipe = true;
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
  if (/\|\s*$/.test(line) && cells.at(-1)?.trim() === "") cells.pop();
  return { cells: cells.map((value) => value.trim()), hasPipe };
}

function parseTable(lines, start) {
  if (start + 1 >= lines.length) return null;
  const header = splitTableRow(lines[start]);
  const separator = splitTableRow(lines[start + 1]);
  if (!header.hasPipe || !separator.hasPipe || !header.cells.length || header.cells.length !== separator.cells.length) return null;
  if (!separator.cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const alignments = separator.cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null);
  const rows = [];
  let malformed = header.cells.length > MAX_COLUMNS;
  let end = start + 2;
  while (end < lines.length && lines[end].trim()) {
    const row = splitTableRow(lines[end]);
    if (!row.hasPipe) break;
    if (row.cells.length !== header.cells.length) malformed = true;
    rows.push(row.cells);
    if (rows.length > MAX_ROWS) malformed = true;
    end += 1;
  }
  return { headers: header.cells, alignments, rows, malformed, end };
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

function appendInline(container, text, options, usedSources) {
  let plain = "";
  let index = 0;
  const flush = () => {
    if (!plain) return;
    appendCitations(container, plain, options, usedSources);
    plain = "";
  };
  while (index < text.length) {
    if (text[index] === "\\" && text[index + 1] === "|") {
      plain += "|";
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      const run = backtickRun(text, index);
      const closing = closingBacktickRun(text, index + run, run);
      if (closing >= 0) {
        flush();
        const code = document.createElement("code");
        code.textContent = text.slice(index + run, closing);
        container.append(code);
        index = closing + run;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  flush();
}

function plainInline(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\\" && text[index + 1] === "|") {
      result += "|";
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      const run = backtickRun(text, index);
      const closing = closingBacktickRun(text, index + run, run);
      if (closing >= 0) {
        result += text.slice(index + run, closing);
        index = closing + run;
        continue;
      }
    }
    result += text[index];
    index += 1;
  }
  return result;
}

function appendParagraph(container, lines, options) {
  const paragraph = document.createElement("p");
  paragraph.className = "assistant-answer-text";
  appendInline(paragraph, lines.join("\n"), options, new Set());
  container.append(paragraph);
}

function sourceUrl(source) {
  return typeof source.url === "string" && source.url ? source.url : pdfPageApplicationUrl(source) || "";
}

function exportRows(table, usedSources, options) {
  const rows = [table.headers, ...table.rows].map((row) => row.map(plainInline));
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

function appendTable(container, table, options) {
  const block = document.createElement("div");
  block.className = "assistant-answer-table-block";
  const scroll = document.createElement("div");
  scroll.className = "assistant-answer-table-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", options.t("tableScroll"));
  scroll.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
  const element = document.createElement("table");
  element.className = "assistant-answer-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const usedSources = new Set();
  for (const [index, value] of table.headers.entries()) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (table.alignments[index]) cell.style.textAlign = table.alignments[index];
    appendInline(cell, value, options, usedSources);
    headerRow.append(cell);
  }
  head.append(headerRow);
  const body = document.createElement("tbody");
  for (const row of table.rows) {
    const rowElement = document.createElement("tr");
    for (const [index, value] of row.entries()) {
      const cell = document.createElement("td");
      if (table.alignments[index]) cell.style.textAlign = table.alignments[index];
      appendInline(cell, value, options, usedSources);
      rowElement.append(cell);
    }
    body.append(rowElement);
  }
  element.append(head, body);
  scroll.append(element);
  block.append(scroll);
  appendTableActions(block, table, usedSources, options);
  container.append(block);
}

export function renderAssistantAnswer(container, { answer, sources, language, t, onOpenSource }) {
  const options = { sourceByRef: sourceMap(sources), language, t, onOpenSource };
  const lines = String(answer).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const table = parseTable(lines, index);
    if (table) {
      if (table.malformed) appendParagraph(container, lines.slice(index, table.end), options);
      else appendTable(container, table, options);
      index = table.end;
      continue;
    }
    const start = index;
    index += 1;
    while (index < lines.length && !parseTable(lines, index)) index += 1;
    appendParagraph(container, lines.slice(start, index), options);
  }
}
