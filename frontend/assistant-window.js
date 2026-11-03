const VIEWPORT_MARGIN = 8;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 420;
const KEY_STEP = 8;
const LARGE_KEY_STEP = 32;
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function createAssistantWindow({ panel, header, fullPageToggle, resizeHandle, leftResizeHandle, rightResizeHandle, help }) {
  let floatingRect = null;
  let fullPage = false;
  let interaction = null;
  let labels = {};
  const visualViewport = window.visualViewport;
  const edgeHandles = [leftResizeHandle, rightResizeHandle].filter(Boolean);

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
    const height = Math.min(760, Math.max(0, view.height - VIEWPORT_MARGIN * 2));
    return {
      x: view.x + view.width - VIEWPORT_MARGIN - width,
      y: view.y + view.height - VIEWPORT_MARGIN - height,
      width,
      height
    };
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
    header.setAttribute("aria-label", labels.window || "");
    header.title = labels.moveHelp || "";
    help.textContent = labels.help || "";
    fullPageToggle.textContent = toggleLabel || "";
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
  }

  function applyGeometry() {
    if (panel.hidden) return;
    const view = viewport();
    const compact = view.width <= 480;
    panel.dataset.fullPage = String(fullPage);
    panel.dataset.compact = String(compact);
    for (const handle of [resizeHandle, ...edgeHandles]) {
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
    if (!interaction) return;
    const current = interaction;
    interaction = null;
    delete panel.dataset.windowInteraction;
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
  }

  function startInteraction(type, event) {
    if (!event.isPrimary || event.button !== 0 || interaction || fullPage || viewport().width <= 480) return;
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

  function moveInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    const start = interaction.rect;
    const view = viewport();
    const candidate = interaction.type === "move"
      ? { ...start, x: start.x + dx, y: start.y + dy }
      : interaction.type === "resize-left" || interaction.type === "resize-right"
        ? resizeEdge(start, interaction.type, dx, view)
        : { ...start, width: start.width + dx, height: start.height + dy };
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
    event.preventDefault();
    if (fullPage || viewport().width <= 480) return;
    const delta = arrowDeltas(event.key, keyStep(event));
    floatingRect = clampFloating({ ...floatingRect, x: floatingRect.x + delta.x, y: floatingRect.y + delta.y }, viewport());
    writeRect(floatingRect);
  }

  function handleResizeKey(event) {
    if (!ARROW_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (fullPage || viewport().width <= 480) return;
    const delta = arrowDeltas(event.key, keyStep(event));
    floatingRect = clampFloating({ ...floatingRect, width: floatingRect.width + delta.x, height: floatingRect.height + delta.y }, viewport());
    writeRect(floatingRect);
  }

  function handleEdgeResizeKey(event) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const view = viewport();
    if (fullPage || view.width <= 480) return;
    const type = event.currentTarget === leftResizeHandle ? "resize-left" : "resize-right";
    const delta = arrowDeltas(event.key, keyStep(event));
    floatingRect = clampFloating(resizeEdge(floatingRect, type, delta.x, view), view);
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
  for (const target of [header, resizeHandle, ...edgeHandles]) {
    target.addEventListener("pointermove", moveInteraction);
    target.addEventListener("pointerup", endInteraction);
    target.addEventListener("pointercancel", endInteraction);
    target.addEventListener("lostpointercapture", endInteraction);
  }
  header.addEventListener("keydown", handleMoveKey);
  resizeHandle.addEventListener("keydown", handleResizeKey);
  for (const handle of edgeHandles) handle.addEventListener("keydown", handleEdgeResizeKey);
  fullPageToggle.addEventListener("click", () => {
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
