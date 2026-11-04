const MAX_SOURCE_CHARACTERS = 3000;
const MAX_TRANSLATED_CHARACTERS = 12000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function copyRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return null;
  if (rect[0] < 0 || rect[1] < 0 || rect[2] > 1 || rect[3] > 1 || rect[2] <= rect[0] || rect[3] <= rect[1]) return null;
  return Object.freeze([...rect]);
}

function unionRects(rects) {
  if (!rects.length) return null;
  return copyRect([
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3]))
  ]);
}

function copyClientRect(rect, fallback) {
  const candidate = rect || fallback;
  if (!candidate) return null;
  const values = [candidate.left, candidate.top, candidate.right, candidate.bottom];
  if (!values.every(Number.isFinite)) return null;
  return Object.freeze({
    left: candidate.left,
    top: candidate.top,
    right: candidate.right,
    bottom: candidate.bottom
  });
}

function contextKey(context) {
  return JSON.stringify([
    context.documentId,
    context.sourceSha256,
    context.pageCount,
    context.page,
    context.loadSequence,
    context.mode,
    context.scope,
    context.selectedAnnotationId,
    context.hasPdf,
    context.isPaper,
    context.deviceMode
  ]);
}

function responseMatches(body, operation) {
  const source = operation.source;
  return Boolean(
    body && typeof body === "object" && !Array.isArray(body)
    && body.request_id === operation.requestId
    && body.document_id === source.documentId
    && body.source_sha256 === source.sourceSha256
    && Array.isArray(body.pages)
    && body.pages.length === source.pages.length
    && body.pages.every((page, index) => page === source.pages[index])
    && body.target_language === operation.targetLanguage
    && typeof body.translated_text === "string"
    && body.translated_text.trim().length > 0
    && body.translated_text.length <= MAX_TRANSLATED_CHARACTERS
  );
}

function svgIcon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const data of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}

export function createSelectionTranslation(adapter) {
  const root = document.createElement("section");
  root.className = "selection-translation-popover";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-labelledby", "selection-translation-heading");

  const header = document.createElement("header");
  header.className = "selection-translation-header";
  const heading = document.createElement("h2");
  heading.id = "selection-translation-heading";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "selection-translation-icon-button";
  closeButton.textContent = "×";
  header.append(heading, closeButton);

  const controls = document.createElement("div");
  controls.className = "selection-translation-controls";
  const languageLabel = document.createElement("label");
  const languageText = document.createElement("span");
  const languageSelect = document.createElement("select");
  for (const value of ["zh", "en"]) {
    const option = document.createElement("option");
    option.value = value;
    languageSelect.append(option);
  }
  languageLabel.append(languageText, languageSelect);
  const translateButton = document.createElement("button");
  translateButton.type = "button";
  translateButton.className = "button button-primary";
  controls.append(languageLabel, translateButton);

  const meta = document.createElement("p");
  meta.className = "selection-translation-meta";
  const status = document.createElement("p");
  status.className = "selection-translation-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const result = document.createElement("div");
  result.className = "selection-translation-result";
  result.setAttribute("tabindex", "0");
  result.hidden = true;

  const actions = document.createElement("div");
  actions.className = "selection-translation-actions";
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "button button-secondary";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "selection-translation-icon-button";
  copyButton.append(svgIcon(["M8 8h12v12H8z", "M16 8V4H4v12h4"]));
  const sourceButton = document.createElement("button");
  sourceButton.type = "button";
  sourceButton.className = "button button-quiet selection-translation-source";
  actions.append(retryButton, copyButton, sourceButton);
  root.append(header, controls, meta, status, result, actions);

  let active = null;
  let generation = 0;

  function t(key, values) {
    return adapter.t(key, values);
  }

  function errorKey(code) {
    return {
      agent_not_configured: "selectionTranslationAgentNotConfigured",
      selection_translation_pending: "selectionTranslationPending",
      selection_translation_busy: "selectionTranslationBusy",
      selection_translation_conflict: "selectionTranslationConflict",
      source_changed: "selectionTranslationSourceChanged",
      network: "selectionTranslationNetwork"
    }[code] || "selectionTranslationFailed";
  }

  function currentContext() {
    return adapter.getContext() || {};
  }

  function contextIsCurrent(operation) {
    const context = currentContext();
    return contextKey(context) === operation.contextKey
      && context.deviceMode !== true
      && context.hasPdf === true
      && context.isPaper === true
      && context.mode === "reading"
      && (!operation.source?.annotationId || adapter.isAnnotationCurrent?.(operation.source.annotationId));
  }

  function operationIsCurrent(operation, requestId = null) {
    return active === operation
      && operation.generation === generation
      && (!requestId || operation.requestId === requestId)
      && contextIsCurrent(operation);
  }

  function freezeSource(value, kind, context, trigger) {
    if (!value || (context.deviceMode !== true && (!context.hasPdf || !context.isPaper || context.mode !== "reading"))) return { error: "selectionTranslationUnavailable" };
    if (context.deviceMode === true) return { error: "selectionTranslationDeviceUnavailable" };
    if (value.documentId !== context.documentId || (kind === "selection" && value.sequence !== context.loadSequence)) return { error: "selectionTranslationSourceChanged" };
    if (!UUID.test(context.documentId || "") || !SHA256.test(context.sourceSha256 || "")) return { error: "selectionTranslationSourceChanged" };

    const storedSegments = (adapter.sourceSegmentsFor(value) || []).map((segment) => ({
      page: segment.page,
      quote: segment.quote,
      rects: segment.rects.map(copyRect)
    }));
    const segments = storedSegments.length ? storedSegments : [{
      page: value.page,
      quote: kind === "annotation" ? value.annotation?.quote : value.text,
      rects: Array.isArray(value.rects) ? value.rects.map(copyRect) : []
    }];
    const pages = [...new Set(segments.map((segment) => segment.page))].sort((left, right) => left - right);
    const text = segments.map((segment) => segment.quote).join("\n");
    if (!pages.length || pages.length > 20 || pages.some((page) => !Number.isInteger(page) || page < 1 || page > context.pageCount)) {
      return { error: "selectionTranslationPages" };
    }
    if (segments.some((segment) => segment.rects.some((rect) => !rect))) return { error: "selectionTranslationUnavailable" };
    if (typeof text !== "string" || !text.trim()) return { error: "selectionTranslationEmpty" };
    if (text.length > MAX_SOURCE_CHARACTERS) return { error: "selectionTranslationTooLong" };

    const firstSegment = segments.find((segment) => segment.page === pages[0]);
    const rect = pages.length === 1 && pages[0] === value.page
      ? copyRect(value.rect) || unionRects(firstSegment.rects)
      : unionRects(firstSegment.rects);
    const source = Object.freeze({
      kind,
      annotationId: kind === "annotation" ? value.id : null,
      documentId: context.documentId,
      sourceSha256: context.sourceSha256,
      loadSequence: context.loadSequence,
      pages: Object.freeze(pages),
      text,
      page: pages[0],
      rect,
      segments: Object.freeze(segments.map((segment) => Object.freeze(segment))),
      clientRect: copyClientRect(value.clientRect, trigger?.getBoundingClientRect())
    });
    if (!source.rect) return { error: "selectionTranslationUnavailable" };
    return { source };
  }

  function render() {
    const operation = active;
    root.dataset.language = adapter.getLanguage();
    heading.textContent = t("selectionTranslationHeading");
    closeButton.setAttribute("aria-label", t("close"));
    closeButton.title = t("close");
    languageText.textContent = t("selectionTranslationTarget");
    languageSelect.options[0].textContent = t("selectionTranslationChinese");
    languageSelect.options[1].textContent = t("selectionTranslationEnglish");
    translateButton.textContent = t(operation?.status === "loading" ? "selectionTranslationLoading" : "translateSelection");
    retryButton.textContent = t("retry");
    copyButton.setAttribute("aria-label", t("selectionTranslationCopy"));
    copyButton.title = t("selectionTranslationCopy");
    if (!operation) return;

    languageSelect.value = operation.targetLanguage;
    languageSelect.disabled = operation.status === "loading";
    translateButton.disabled = operation.status === "loading" || !operation.source || (operation.status === "error" && !operation.canRetry);
    retryButton.hidden = operation.status !== "error" || !operation.canRetry;
    copyButton.hidden = !operation.translatedText;
    sourceButton.hidden = !operation.source;
    sourceButton.textContent = operation.source ? t("selectionTranslationSource", { pages: operation.source.pages.join(", ") }) : "";
    meta.textContent = operation.source ? t("selectionTranslationLength", {
      pages: operation.source.pages.join(", "),
      count: operation.source.text.length
    }) : "";
    status.dataset.kind = operation.status === "error" ? "error" : "info";
    if (operation.status === "loading") status.textContent = t("selectionTranslationLoadingStatus");
    else if (operation.status === "error") status.textContent = t(operation.errorKey);
    else if (operation.notice) status.textContent = t(operation.notice);
    else if (operation.status === "success") status.textContent = t("selectionTranslationReady");
    else status.textContent = t("selectionTranslationExplicit");
    result.hidden = !operation.translatedText;
    result.textContent = operation.translatedText;
  }

  function position() {
    if (!active || root.hidden) return;
    const viewport = window.visualViewport;
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    if (narrow) {
      const keyboardInset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      root.style.setProperty("--selection-translation-keyboard-inset", `${keyboardInset}px`);
      root.style.maxHeight = `${Math.max(220, (viewport?.height || window.innerHeight) - 88)}px`;
      root.style.left = "";
      root.style.top = "";
      return;
    }
    root.style.removeProperty("--selection-translation-keyboard-inset");
    root.style.maxHeight = "";
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const offsetLeft = viewport?.offsetLeft || 0;
    const offsetTop = viewport?.offsetTop || 0;
    const anchor = active.source?.clientRect || active.trigger?.getBoundingClientRect();
    const desiredLeft = anchor ? anchor.left : offsetLeft + 8;
    const below = anchor ? anchor.bottom + 8 : offsetTop + 8;
    const above = anchor ? anchor.top - height - 8 : offsetTop + 8;
    const left = Math.max(offsetLeft + 8, Math.min(offsetLeft + viewportWidth - width - 8, desiredLeft));
    const top = below + height <= offsetTop + viewportHeight - 8
      ? below
      : Math.max(offsetTop + 8, Math.min(offsetTop + viewportHeight - height - 8, above));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  function close(options = {}) {
    const operation = active;
    if (!operation) return;
    generation += 1;
    operation.controller?.abort();
    operation.controller = null;
    active = null;
    root.hidden = true;
    root.remove();
    if (options.restoreFocus !== false && operation.trigger?.isConnected && !operation.trigger.disabled) {
      operation.trigger.focus({ preventScroll: true });
    }
  }

  async function requestTranslation() {
    const operation = active;
    if (!operation?.source || operation.status === "loading") return;
    if (!contextIsCurrent(operation)) {
      close({ restoreFocus: false });
      return;
    }
    operation.targetLanguage = languageSelect.value === "en" ? "en" : "zh";
    operation.requestId = crypto.randomUUID();
    operation.controller = new AbortController();
    operation.status = "loading";
    operation.errorKey = null;
    operation.notice = null;
    operation.translatedText = "";
    operation.canRetry = false;
    const requestId = operation.requestId;
    const controller = operation.controller;
    render();
    try {
      const source = operation.source;
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(source.documentId)}/selection-translation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          source_sha256: source.sourceSha256,
          pages: [...source.pages],
          text: source.text,
          target_language: operation.targetLanguage
        }),
        signal: controller.signal
      });
      if (!operationIsCurrent(operation, requestId)) return;
      if (!responseMatches(body, operation)) throw new Error("invalid_translation_response");
      operation.translatedText = body.translated_text;
      operation.status = "success";
      operation.controller = null;
      render();
    } catch (error) {
      if (error?.name === "AbortError" || !operationIsCurrent(operation, requestId)) return;
      operation.controller = null;
      operation.status = "error";
      operation.errorKey = errorKey(error?.code);
      operation.canRetry = true;
      render();
    }
  }

  function open(value, kind, trigger) {
    close({ restoreFocus: false });
    const context = currentContext();
    const frozen = freezeSource(value, kind, context, trigger);
    const operation = {
      kind,
      source: frozen.source || null,
      contextKey: contextKey(context),
      trigger,
      generation: generation + 1,
      targetLanguage: adapter.getLanguage() === "en" ? "en" : "zh",
      status: frozen.error ? "error" : "idle",
      errorKey: frozen.error || null,
      canRetry: false,
      requestId: null,
      controller: null,
      translatedText: "",
      notice: null
    };
    active = operation;
    generation = operation.generation;
    (document.fullscreenElement || document.body).append(root);
    root.hidden = false;
    languageSelect.value = operation.targetLanguage;
    render();
    position();
    root.tabIndex = -1;
    root.focus({ preventScroll: true });
    if (!frozen.error) void requestTranslation();
  }

  closeButton.addEventListener("click", () => close());
  retryButton.addEventListener("click", () => void requestTranslation());
  translateButton.addEventListener("click", () => void requestTranslation());
  languageSelect.addEventListener("change", () => {
    if (!active || active.status === "loading") return;
    active.targetLanguage = languageSelect.value === "en" ? "en" : "zh";
    active.status = "idle";
    active.errorKey = null;
    active.notice = null;
    active.translatedText = "";
    active.canRetry = false;
    render();
  });
  copyButton.addEventListener("click", async () => {
    const operation = active;
    if (!operation?.translatedText) return;
    try {
      await navigator.clipboard.writeText(operation.translatedText);
      if (active === operation) {
        operation.notice = "selectionTranslationCopied";
        render();
      }
    } catch {
      if (active === operation) {
        operation.notice = "selectionTranslationCopyFailed";
        render();
      }
    }
  });
  sourceButton.addEventListener("click", () => {
    const operation = active;
    if (!operation?.source || !contextIsCurrent(operation)) return;
    const source = operation.source;
    close({ restoreFocus: false });
    void adapter.goToSource(source);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("mousedown", (event) => event.stopPropagation());
  window.addEventListener("resize", position);
  window.visualViewport?.addEventListener("resize", position);

  return {
    openSelection(trigger) {
      const selection = adapter.currentSelection();
      if (!selection) {
        adapter.selectionRequired?.();
        return;
      }
      open(selection, "selection", trigger);
    },
    openAnnotation(note, trigger) {
      if (note) open(note, "annotation", trigger);
    },
    selectionChanged(selection) {
      if (!active || active.source?.kind !== "selection") return;
      if (!selection && root.contains(document.activeElement)) return;
      if (!selection) {
        close({ restoreFocus: false });
        return;
      }
      const pages = selection.source_segments?.map((segment) => segment.page) || [selection.page];
      if (selection.documentId !== active.source.documentId
        || selection.sequence !== active.source.loadSequence
        || selection.text !== active.source.text
        || pages.length !== active.source.pages.length
        || pages.some((page, index) => page !== active.source.pages[index])) {
        close({ restoreFocus: false });
      }
    },
    contextChanged() {
      if (active && !contextIsCurrent(active)) close({ restoreFocus: false });
    },
    applyLanguage() {
      if (active) render();
    },
    position,
    close
  };
}
