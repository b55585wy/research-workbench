const translatableKinds = new Set(["text", "title", "caption"]);

function translatedText(block) {
  return translatableKinds.has(block?.kind) && typeof block.translated_text === "string" && block.translated_text.trim()
    ? block.translated_text
    : null;
}

function safeRect(rect) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function intersects(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function rectKey(rect) {
  return [rect.x, rect.y, rect.width, rect.height].join(":");
}

function planPage(page) {
  if (!page || page.status !== "completed" || !Array.isArray(page.blocks)) return { groups: [], status: "unavailable", hasContent: false };
  const blocks = page.blocks.map((block, index) => ({ block, index })).sort((first, second) => {
    const order = (first.block?.order ?? first.index) - (second.block?.order ?? second.index);
    return order || first.index - second.index;
  });
  const protectedRects = [];
  const grouped = new Map();
  let rejected = false;
  let unavailable = false;
  let hasContent = false;

  for (const { block } of blocks) {
    if (!block || typeof block !== "object") {
      unavailable = true;
      continue;
    }
    const rect = safeRect(block.rect);
    if (!translatableKinds.has(block.kind)) {
      if (!rect) unavailable = true;
      else protectedRects.push(rect);
      hasContent = true;
      continue;
    }
    const translated = translatedText(block);
    if (translated || (typeof block.source_text === "string" && block.source_text.trim())) hasContent = true;
    if (!rect) {
      if (translated) rejected = true;
      continue;
    }
    const key = rectKey(rect);
    if (!grouped.has(key)) grouped.set(key, { rect, members: [] });
    grouped.get(key).members.push(block);
  }

  if (unavailable) return { groups: [], status: "unavailable", hasContent };

  const candidates = [];
  for (const group of grouped.values()) {
    const translations = group.members.map(translatedText);
    if (translations.some((text) => !text)) {
      rejected = true;
      continue;
    }
    if (protectedRects.some((rect) => intersects(group.rect, rect))) {
      rejected = true;
      continue;
    }
    candidates.push({
      ...group,
      text: translations.join("\n\n"),
      title: group.members.some((block) => block.kind === "title")
    });
  }

  const overlapping = new Set();
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      if (intersects(candidates[first].rect, candidates[second].rect)) {
        overlapping.add(candidates[first]);
        overlapping.add(candidates[second]);
      }
    }
  }
  if (overlapping.size) rejected = true;
  const groups = candidates.filter((group) => !overlapping.has(group));
  const status = rejected && hasContent ? (groups.length ? "partial" : "unavailable") : null;
  return { groups, status, hasContent };
}

function stopPdfEvents(node) {
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"]) {
    node.addEventListener(name, (event) => event.stopPropagation());
  }
}

function presentationIdentity(snapshot) {
  return snapshot ? JSON.stringify([
    snapshot.documentId,
    snapshot.sourceSha256,
    snapshot.jobId,
    snapshot.currentPage,
    snapshot.language
  ]) : null;
}

function safeToolbarControl() {
  return document.querySelector(".translation-toggle:not(:disabled), .translation-mode-button:not(:disabled), .reader-toolbar button:not(:disabled)");
}

export function createTranslationOverlay({ getPageRecords, getIdentity, onPageStatus }) {
  let presentation = null;
  let destroyed = false;
  let layers = new Set();
  let expanded = null;

  function identityMatches() {
    const identity = getIdentity();
    return Boolean(presentation && identity && presentation.documentId === identity.id && presentation.sourceSha256 === identity.sha256);
  }

  function closeExpanded(restoreFocus = true) {
    const current = expanded;
    if (!current) return;
    expanded = null;
    const focusTarget = current.trigger?.isConnected ? current.trigger : safeToolbarControl();
    if (current.dialog.open && typeof current.dialog.close === "function") current.dialog.close();
    else current.dialog.removeAttribute("open");
    current.dialog.remove();
    if (restoreFocus && focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
  }

  function clearLayers() {
    for (const layer of layers) layer.remove();
    layers = new Set();
  }

  function report(status) {
    if (!onPageStatus) return;
    if (!status || !presentation || !identityMatches()) {
      onPageStatus(null);
      return;
    }
    onPageStatus(Object.freeze({
      documentId: presentation.documentId,
      sourceSha256: presentation.sourceSha256,
      jobId: presentation.jobId,
      page: presentation.currentPage,
      kind: status
    }));
  }

  function openExpanded(text, trigger, page, key) {
    closeExpanded(false);
    const language = presentation?.language === "en" ? "en" : "zh";
    const dialog = document.createElement("dialog");
    dialog.className = "translation-overlay-expanded";
    dialog.setAttribute("aria-label", language === "en" ? "Full translated paragraph" : "完整段落译文");
    const header = document.createElement("header");
    const heading = document.createElement("h2");
    heading.textContent = language === "en" ? "Translated paragraph" : "段落译文";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "button button-quiet";
    close.textContent = "×";
    close.setAttribute("aria-label", language === "en" ? "Close" : "关闭");
    close.title = language === "en" ? "Close" : "关闭";
    close.addEventListener("click", () => closeExpanded());
    header.append(heading, close);
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    dialog.append(header, paragraph);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeExpanded();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeExpanded();
    });
    stopPdfEvents(dialog);
    expanded = { dialog, trigger, page, key };
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    close.focus({ preventScroll: true });
  }

  function renderGroup(layer, group, language, pageNumber) {
    const surfaceWidth = layer.clientWidth;
    const surfaceHeight = layer.clientHeight;
    const width = group.rect.width * surfaceWidth;
    const height = group.rect.height * surfaceHeight;
    if (width < 32 || height < 18) return false;

    const block = document.createElement("div");
    block.className = "translation-overlay-block";
    block.style.left = `${group.rect.x * 100}%`;
    block.style.top = `${group.rect.y * 100}%`;
    block.style.width = `${group.rect.width * 100}%`;
    block.style.height = `${group.rect.height * 100}%`;
    block.dataset.translationOverlay = "text";
    const content = document.createElement("div");
    content.className = "translation-overlay-text";
    content.textContent = group.text;
    block.append(content);
    stopPdfEvents(block);
    layer.append(block);

    let fontSize = group.title ? 16 : 14;
    content.style.fontSize = `${fontSize}px`;
    while (fontSize > 10 && (content.scrollHeight > content.clientHeight || content.scrollWidth > content.clientWidth)) {
      fontSize = Math.max(10, fontSize - 0.5);
      content.style.fontSize = `${fontSize}px`;
    }
    if (content.scrollHeight > content.clientHeight || content.scrollWidth > content.clientWidth) {
      block.classList.add("translation-overlay-clipped");
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "translation-overlay-expand";
      expand.textContent = language === "en" ? "Expand" : "展开";
      expand.setAttribute("aria-label", language === "en" ? "Expand full translated paragraph" : "展开完整段落译文");
      expand.dataset.translationPage = String(pageNumber);
      expand.dataset.translationRect = rectKey(group.rect);
      expand.addEventListener("click", () => openExpanded(group.text, expand, pageNumber, rectKey(group.rect)));
      block.append(expand);

      const blockBounds = block.getBoundingClientRect();
      const textBounds = content.getBoundingClientRect();
      const controlBounds = expand.getBoundingClientRect();
      const measuredLineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
      const lineHeight = Number.isFinite(measuredLineHeight) ? measuredLineHeight : fontSize * 1.35;
      const contained = (bounds) => bounds.left >= blockBounds.left
        && bounds.top >= blockBounds.top
        && bounds.right <= blockBounds.right
        && bounds.bottom <= blockBounds.bottom;
      const readableLine = content.clientWidth > 0 && content.clientHeight >= lineHeight;
      const accessibleControl = controlBounds.width >= 24 && controlBounds.height >= 24;
      if (!readableLine || !accessibleControl || !contained(textBounds) || !contained(controlBounds)) {
        block.remove();
        return false;
      }
    }
    return true;
  }

  function refresh() {
    if (destroyed) return;
    clearLayers();
    if (!presentation || !identityMatches()) {
      closeExpanded(false);
      report(null);
      return;
    }
    const pages = new Map(presentation.resultPages.map((page) => [page.page, page]));
    const currentPlan = planPage(pages.get(presentation.currentPage));
    let currentStatus = currentPlan.status;
    let renderedCurrent = 0;
    let rejectedCurrent = false;
    const language = presentation.language === "en" ? "en" : "zh";

    for (const record of getPageRecords()) {
      const page = pages.get(record.pageNumber);
      if (!page || page.status !== "completed" || record.rendered !== true || !record.surface?.isConnected) continue;
      const plan = planPage(page);
      if (!plan.groups.length) continue;
      const layer = document.createElement("div");
      layer.className = "translation-overlay-layer";
      layer.dataset.documentId = presentation.documentId;
      layer.dataset.sourceSha256 = presentation.sourceSha256;
      layer.dataset.jobId = presentation.jobId;
      layer.dataset.page = String(record.pageNumber);
      layer.setAttribute("aria-label", language === "en" ? `Translated page ${record.pageNumber}` : `第 ${record.pageNumber} 页译文`);
      record.surface.append(layer);
      layers.add(layer);
      let rendered = 0;
      for (const group of plan.groups) {
        if (renderGroup(layer, group, language, record.pageNumber)) rendered += 1;
        else if (record.pageNumber === presentation.currentPage) rejectedCurrent = true;
      }
      if (!rendered) {
        layer.remove();
        layers.delete(layer);
      }
      if (record.pageNumber === presentation.currentPage) renderedCurrent += rendered;
    }

    if (expanded) {
      let replacement = null;
      for (const layer of layers) {
        replacement = Array.from(layer.querySelectorAll(".translation-overlay-expand")).find((button) => (
          button.dataset.translationPage === String(expanded.page) && button.dataset.translationRect === expanded.key
        )) || null;
        if (replacement) break;
      }
      expanded.trigger = replacement || safeToolbarControl();
    }
    if (rejectedCurrent) currentStatus = renderedCurrent ? "partial" : "unavailable";
    report(currentStatus);
  }

  return {
    setPresentation(snapshot) {
      if (destroyed) return;
      if (presentationIdentity(presentation) !== presentationIdentity(snapshot)) closeExpanded(false);
      presentation = snapshot;
      refresh();
    },
    refresh,
    clear() {
      if (destroyed) return;
      closeExpanded(false);
      presentation = null;
      clearLayers();
      report(null);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeExpanded(false);
      presentation = null;
      clearLayers();
    }
  };
}
