const VIEWPORT_MARGIN = 8;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 300;
const KEY_STEP = 8;
const LARGE_KEY_STEP = 32;
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function createAssistantWindow({ panel, header, fullPageToggle, resizeHandle, leftResizeHandle, rightResizeHandle, topResizeHandle, bottomResizeHandle, help }) {
  let floatingRect = null;
  let fullPage = false;
  let interaction = null;
  let labels = {};
  const visualViewport = window.visualViewport;
  const edgeHandles = [leftResizeHandle, rightResizeHandle].filter(Boolean);
  const heightHandles = [topResizeHandle, bottomResizeHandle].filter(Boolean);
  const resizeHandles = [resizeHandle, ...edgeHandles, ...heightHandles];

  function viewport() {
    return {
      x: visualViewport?.offsetLeft || 0,
      y: visualViewport?.offsetTop || 0,
      width: visualViewport?.width || window.innerWidth,
      height: visualViewport?.height || document.documentElement.clientHeight
    };
  }

  function defaultRect(view) {
    const width = Math.min(420, Math.max(0, view.width - VIEWPORT_MARGIN * 2));
    const height = Math.min(560, Math.max(MIN_HEIGHT, view.height * 0.68), Math.max(0, view.height - VIEWPORT_MARGIN * 2));
    return {
      x: view.x + view.width - VIEWPORT_MARGIN - width,
      y: view.y + view.height - VIEWPORT_MARGIN - height,
      width,
      height
    };
  }

  function isCompact(view) {
    return view.width <= 480 || Boolean(document.body?.classList.contains("mobile-layout-active") && window.matchMedia("(max-width: 820px)").matches);
  }

  function canManipulate() {
    return !panel.hidden && !fullPage && !isCompact(viewport());
  }

  function clampFloating(rect, view) {
    const availableWidth = Math.max(0, view.width - VIEWPORT_MARGIN * 2);
    const availableHeight = Math.max(0, view.height - VIEWPORT_MARGIN * 2);
    const width = clamp(rect.width, Math.min(MIN_WIDTH, availableWidth), availableWidth);
    const height = clamp(rect.height, Math.min(MIN_HEIGHT, availableHeight), availableHeight);
    return {
      x: clamp(rect.x, view.x + VIEWPORT_MARGIN, view.x + VIEWPORT_MARGIN + availableWidth - width),
      y: clamp(rect.y, view.y + VIEWPORT_MARGIN, view.y + VIEWPORT_MARGIN + availableHeight - height),
      width,
      height
    };
  }

  function writeRect(rect) {
    panel.style.left = `${rect.x}px`;
    panel.style.top = `${rect.y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panel.style.maxHeight = "none";
  }

  function updateLabels() {
    const toggleLabel = fullPage ? labels.exitFullPage : labels.fullPage;
    const fixed = fullPage || isCompact(viewport());
    header.setAttribute("aria-label", (fixed ? labels.panel : labels.window) || "");
    header.title = (fixed ? labels.fixedHelp : labels.moveHelp) || "";
    if (fixed) header.removeAttribute("aria-keyshortcuts");
    else header.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown");
    help.textContent = labels.help || "";
    const icon = fullPage ? "restore" : "expand";
    fullPageToggle.classList.add("assistant-icon-button");
    if (fullPageToggle.dataset.icon !== icon) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", fullPage
        ? "M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5"
        : "M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5");
      svg.append(path);
      fullPageToggle.replaceChildren(svg);
      fullPageToggle.dataset.icon = icon;
    }
    fullPageToggle.setAttribute("aria-label", toggleLabel || "");
    fullPageToggle.title = toggleLabel || "";
    fullPageToggle.setAttribute("aria-pressed", String(fullPage));
    resizeHandle.setAttribute("aria-label", labels.resize || "");
    resizeHandle.title = labels.resizeHelp || labels.resize || "";
    for (const handle of edgeHandles) {
      const label = handle === leftResizeHandle ? labels.resizeLeft : labels.resizeRight;
      handle.setAttribute("aria-label", label || "");
      handle.title = labels.resizeEdgeHelp || label || "";
    }
    for (const handle of heightHandles) {
      const label = handle === topResizeHandle ? labels.resizeTop : labels.resizeBottom;
      handle.setAttribute("aria-label", label || "");
      handle.title = labels.resizeHeightHelp || label || "";
    }
  }

  function applyGeometry() {
    if (panel.hidden) return;
    const view = viewport();
    const compact = isCompact(view);
    panel.dataset.fullPage = String(fullPage);
    panel.dataset.compact = String(compact);
    for (const handle of resizeHandles) {
      handle.hidden = fullPage || compact;
      handle.disabled = fullPage || compact;
    }
    updateLabels();
    if (fullPage || compact) {
      writeRect({ x: view.x, y: view.y, width: view.width, height: view.height });
      return;
    }
    floatingRect = clampFloating(floatingRect || defaultRect(view), view);
    writeRect(floatingRect);
  }

  function cancelInteraction() {
    if (!interaction) return false;
    const current = interaction;
    interaction = null;
    delete panel.dataset.windowInteraction;
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    return true;
  }

  function startInteraction(type, event) {
    if (!event.isPrimary || event.button !== 0 || interaction || !canManipulate()) return;
    if (type === "move" && event.target.closest?.("button, input, textarea, select, a, summary, [contenteditable='true']")) return;
    applyGeometry();
    const target = event.currentTarget;
    interaction = {
      type,
      target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: { ...floatingRect }
    };
    panel.dataset.windowInteraction = type;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function resizeEdge(start, type, dx, view) {
    const availableWidth = Math.max(0, view.width - VIEWPORT_MARGIN * 2);
    const minimum = Math.min(MIN_WIDTH, availableWidth);
    if (type === "resize-left") {
      const right = start.x + start.width;
      const maximum = Math.max(minimum, Math.min(availableWidth, right - view.x - VIEWPORT_MARGIN));
      const width = clamp(start.width - dx, minimum, maximum);
      return { ...start, x: right - width, width };
    }
    const maximum = Math.max(minimum, Math.min(availableWidth, view.x + VIEWPORT_MARGIN + availableWidth - start.x));
    return { ...start, width: clamp(start.width + dx, minimum, maximum) };
  }

  function resizeHeight(start, type, dy, view) {
    const minimum = Math.min(MIN_HEIGHT, Math.max(0, view.height - VIEWPORT_MARGIN * 2));
    const bottom = start.y + start.height;
    const fromTop = type === "resize-top";
    const maximum = fromTop ? bottom - view.y - VIEWPORT_MARGIN : view.y + view.height - VIEWPORT_MARGIN - start.y;
    const height = clamp(start.height + (fromTop ? -dy : dy), minimum, Math.max(minimum, maximum));
    return { ...start, y: fromTop ? bottom - height : start.y, height };
  }

  function moveInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    if (!canManipulate()) {
      cancelInteraction();
      return;
    }
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    const start = interaction.rect;
    const view = viewport();
    let candidate = { ...start, width: start.width + dx, height: start.height + dy };
    if (interaction.type === "move") candidate = { ...start, x: start.x + dx, y: start.y + dy };
    if (interaction.type === "resize-left" || interaction.type === "resize-right") candidate = resizeEdge(start, interaction.type, dx, view);
    if (interaction.type === "resize-top" || interaction.type === "resize-bottom") candidate = resizeHeight(start, interaction.type, dy, view);
    floatingRect = clampFloating(candidate, view);
    writeRect(floatingRect);
    event.preventDefault();
  }

  function endInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    cancelInteraction();
    event.preventDefault();
  }

  function keyStep(event) {
    return event.shiftKey ? LARGE_KEY_STEP : KEY_STEP;
  }

  function arrowDeltas(key, step) {
    return {
      x: key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0,
      y: key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0
    };
  }

  function handleMoveKey(event) {
    if (event.target !== header || !ARROW_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!canManipulate() || interaction) return;
    event.preventDefault();
    applyGeometry();
    const delta = arrowDeltas(event.key, keyStep(event));
    floatingRect = clampFloating({ ...floatingRect, x: floatingRect.x + delta.x, y: floatingRect.y + delta.y }, viewport());
    writeRect(floatingRect);
  }

  function handleResizeKey(event) {
    if (!ARROW_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!canManipulate() || interaction) return;
    event.preventDefault();
    applyGeometry();
    const delta = arrowDeltas(event.key, keyStep(event));
    floatingRect = clampFloating({ ...floatingRect, width: floatingRect.width + delta.x, height: floatingRect.height + delta.y }, viewport());
    writeRect(floatingRect);
  }

  function handleEdgeResizeKey(event) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!canManipulate() || interaction) return;
    event.preventDefault();
    applyGeometry();
    const view = viewport();
    const type = event.currentTarget === leftResizeHandle ? "resize-left" : "resize-right";
    const delta = arrowDeltas(event.key, keyStep(event));
    floatingRect = clampFloating(resizeEdge(floatingRect, type, delta.x, view), view);
    writeRect(floatingRect);
  }

  function handleHeightResizeKey(event) {
    if (!["ArrowUp", "ArrowDown"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!canManipulate() || interaction) return;
    event.preventDefault();
    applyGeometry();
    const type = event.currentTarget === topResizeHandle ? "resize-top" : "resize-bottom";
    const delta = arrowDeltas(event.key, keyStep(event));
    floatingRect = clampFloating(resizeHeight(floatingRect, type, delta.y, viewport()), viewport());
    writeRect(floatingRect);
  }

  function viewportChanged() {
    cancelInteraction();
    applyGeometry();
  }

  header.addEventListener("pointerdown", (event) => startInteraction("move", event));
  resizeHandle.addEventListener("pointerdown", (event) => startInteraction("resize", event));
  leftResizeHandle?.addEventListener("pointerdown", (event) => startInteraction("resize-left", event));
  rightResizeHandle?.addEventListener("pointerdown", (event) => startInteraction("resize-right", event));
  topResizeHandle?.addEventListener("pointerdown", (event) => startInteraction("resize-top", event));
  bottomResizeHandle?.addEventListener("pointerdown", (event) => startInteraction("resize-bottom", event));
  for (const target of [header, ...resizeHandles]) {
    target.addEventListener("pointermove", moveInteraction);
    target.addEventListener("pointerup", endInteraction);
    target.addEventListener("pointercancel", endInteraction);
    target.addEventListener("lostpointercapture", endInteraction);
  }
  header.addEventListener("keydown", handleMoveKey);
  resizeHandle.addEventListener("keydown", handleResizeKey);
  for (const handle of edgeHandles) handle.addEventListener("keydown", handleEdgeResizeKey);
  for (const handle of heightHandles) handle.addEventListener("keydown", handleHeightResizeKey);
  fullPageToggle.addEventListener("click", () => {
    if (panel.hidden) return;
    cancelInteraction();
    fullPage = !fullPage;
    applyGeometry();
  });
  window.addEventListener("resize", viewportChanged);
  visualViewport?.addEventListener("resize", viewportChanged);
  visualViewport?.addEventListener("scroll", viewportChanged);

  return {
    applyLanguage(nextLabels) {
      labels = nextLabels;
      updateLabels();
    },
    show: applyGeometry,
    cancelInteraction,
    isFullPage() {
      return fullPage;
    },
    exitFullPage() {
      if (!fullPage) return false;
      cancelInteraction();
      fullPage = false;
      applyGeometry();
      return true;
    }
  };
}
