const COPY = {
  zh: { selected: "已选区域", note: "笔记", ask: "助手", addNote: "加入笔记", addAsk: "加入助手", cancel: "取消截图" },
  en: { selected: "Selected region", note: "Note", ask: "Ask", addNote: "Add to note", addAsk: "Add to assistant", cancel: "Cancel capture" }
};

const ICONS = {
  note: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9"/><path d="M8 8h4M8 12h4M8 16h8M18 2v6M15 5h6"/>',
  ask: '<rect x="4" y="6" width="16" height="14" rx="3"/><path d="M12 3v3M1 12h3M20 12h3M8 16h8"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/>',
  cancel: '<path d="m6 6 12 12M6 18 18 6"/>'
};

function intersection(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export function captureSelectionBounds(surface, rect) {
  if (!surface || !Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) ||
    rect[0] < 0 || rect[1] < 0 || rect[2] > 1 || rect[3] > 1 || rect[2] <= rect[0] || rect[3] <= rect[1] ||
    surface.width <= 0 || surface.height <= 0) return null;
  // Capture pixels and source highlights both use display-normalized, top-left coordinates.
  return {
    left: surface.left + rect[0] * surface.width,
    top: surface.top + rect[1] * surface.height,
    right: surface.left + rect[2] * surface.width,
    bottom: surface.top + rect[3] * surface.height
  };
}

export function captureActionPlacement({ selection, reader, viewport, width, height }) {
  const clip = intersection(reader, viewport);
  if (!clip || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const gap = 8;
  const left = clip.left + gap;
  const top = clip.top + gap;
  const right = clip.right - gap - width;
  const bottom = clip.bottom - gap - height;
  if (right < left || bottom < top) return null;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const visible = selection && intersection(selection, clip);
  let y = selection ? selection.bottom + gap : bottom;
  if (visible && y > bottom) y = selection.top - gap - height;
  if (!visible) y = selection && selection.bottom < clip.top ? top : bottom;
  return {
    left: clamp(selection?.left ?? left, left, right),
    top: clamp(y, top, bottom),
    docked: !visible || y < top || y > bottom
  };
}

function signature(model) {
  return JSON.stringify([
    model.requestId, model.documentId, model.sourceSha, model.page, model.rect,
    model.disabled, model.pending, model.error, model.imageId, model.language
  ]);
}

export function createReaderCaptureActions({ host, stage, getSnapshot, getSurface, onNote, onAsk, onCancel, onVisibilityChange }) {
  const doc = host.ownerDocument;
  const browser = doc.defaultView;
  const bar = doc.createElement("div");
  bar.className = "reader-capture-actions";
  bar.setAttribute("role", "group");
  bar.hidden = true;
  host.append(bar);
  const buttons = {};
  const labels = {};
  for (const action of ["note", "ask", "cancel"]) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "button button-quiet reader-capture-action";
    button.dataset.captureAction = action;
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[action]}</svg>`;
    if (action !== "cancel") {
      labels[action] = doc.createElement("span");
      button.append(labels[action]);
    }
    buttons[action] = button;
    bar.append(button);
  }

  let model = null;
  let modelSignature = "";
  let revision = 0;
  let frame = null;
  let destroyed = false;
  let visible = false;
  let observedSurface = null;
  const listeners = [];

  function setVisible(value) {
    bar.hidden = !value;
    if (visible === value) return;
    visible = value;
    onVisibilityChange?.(value);
  }

  function current(expected, expectedSignature, expectedRevision) {
    if (destroyed || !visible || !readerVisible() || revision !== expectedRevision || model !== expected) return false;
    const fresh = getSnapshot();
    return Boolean(fresh && fresh.identity === expected.identity && !fresh.disabled && signature(fresh) === expectedSignature);
  }

  function update(next) {
    if (destroyed) return;
    if (!next) { hide(); return; }
    model = { ...next, rect: [...next.rect] };
    modelSignature = signature(model);
    const expected = model;
    const expectedSignature = modelSignature;
    const expectedRevision = ++revision;
    const copy = COPY[model.language] || COPY.en;
    bar.setAttribute("aria-label", copy.selected);
    bar.setAttribute("aria-busy", String(Boolean(model.pending)));
    bar.dataset.error = String(Boolean(model.error));
    labels.note.textContent = copy.note;
    labels.ask.textContent = copy.ask;
    for (const [action, callback, title] of [
      ["note", onNote, copy.addNote], ["ask", onAsk, copy.addAsk], ["cancel", onCancel, copy.cancel]
    ]) {
      const button = buttons[action];
      button.disabled = Boolean(model.disabled);
      button.title = title;
      button.setAttribute("aria-label", title);
      button.onclick = () => {
        if (current(expected, expectedSignature, expectedRevision)) callback();
      };
    }
    position();
  }

  function observeSurface(surface) {
    if (observedSurface === surface) return;
    if (observedSurface) resizeObserver?.unobserve(observedSurface);
    observedSurface = surface;
    if (surface) resizeObserver?.observe(surface);
  }

  function hide() {
    model = null;
    revision += 1;
    if (frame !== null) browser.cancelAnimationFrame(frame);
    frame = null;
    observeSurface(null);
    setVisible(false);
  }

  function readerVisible() {
    const fullscreen = doc.fullscreenElement;
    const style = browser.getComputedStyle(stage);
    return Boolean(stage.isConnected && stage.getClientRects().length && !stage.hidden &&
      style.visibility === "visible" && style.display !== "none" && (!fullscreen || fullscreen.contains(host)));
  }

  function reposition() {
    frame = null;
    if (destroyed || !model) return;
    const fresh = getSnapshot();
    if (!fresh) { hide(); return; }
    if (fresh.identity !== model.identity || signature(fresh) !== modelSignature) update(fresh);
    if (!readerVisible()) {
      setVisible(false);
      return;
    }
    const bounds = stage.getBoundingClientRect();
    const reader = {
      left: bounds.left + stage.clientLeft, top: bounds.top + stage.clientTop,
      right: bounds.left + stage.clientLeft + stage.clientWidth,
      bottom: bounds.top + stage.clientTop + stage.clientHeight
    };
    const visual = browser.visualViewport;
    const viewport = intersection(host.getBoundingClientRect(), {
      left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0,
      right: Math.min(doc.documentElement.clientWidth, (visual?.offsetLeft || 0) + (visual?.width ?? browser.innerWidth)),
      bottom: Math.min(doc.documentElement.clientHeight, (visual?.offsetTop || 0) + (visual?.height ?? browser.innerHeight))
    });
    const clip = viewport && intersection(reader, viewport);
    if (!clip) { setVisible(false); return; }
    bar.dataset.compact = String(clip.right - clip.left < 240);
    bar.style.maxWidth = `${Math.max(0, clip.right - clip.left - 16)}px`;
    // Measure without announcing a second visible action set during layout.
    bar.hidden = false;
    const size = bar.getBoundingClientRect();
    const surface = getSurface(model);
    observeSurface(surface);
    const selection = surface?.isConnected && surface.getClientRects().length
      ? captureSelectionBounds(surface.getBoundingClientRect(), model.rect) : null;
    const placement = captureActionPlacement({ selection, reader, viewport, width: size.width, height: size.height });
    if (!placement) { setVisible(false); return; }
    bar.style.left = `${placement.left}px`;
    bar.style.top = `${placement.top}px`;
    bar.dataset.docked = String(placement.docked);
    setVisible(true);
  }

  function position() {
    if (!destroyed && model && frame === null) frame = browser.requestAnimationFrame(reposition);
  }

  function listen(target, event, callback, options) {
    target?.addEventListener(event, callback, options);
    listeners.push(() => target?.removeEventListener(event, callback, options));
  }

  listen(doc, "scroll", position, { capture: true, passive: true });
  listen(browser, "resize", position);
  listen(doc, "fullscreenchange", position);
  listen(browser.visualViewport, "resize", position);
  listen(browser.visualViewport, "scroll", position);
  listen(bar, "keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !bar.contains(event.target) || buttons.cancel.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    buttons.cancel.onclick();
  });
  const resizeObserver = browser.ResizeObserver ? new browser.ResizeObserver(position) : null;
  for (const element of [host, stage, bar]) resizeObserver?.observe(element);
  const visibilityObserver = browser.MutationObserver ? new browser.MutationObserver(position) : null;
  for (let ancestor = stage; ancestor; ancestor = ancestor.parentElement) {
    visibilityObserver?.observe(ancestor, {
      attributes: true,
      attributeFilter: ["hidden", "class", "style", "data-mobile-pane", "data-workspace-mode", "data-flow-active"]
    });
  }

  return {
    update, hide, position,
    destroy() {
      if (destroyed) return;
      hide();
      destroyed = true;
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      listeners.forEach((remove) => remove());
      Object.values(buttons).forEach((button) => { button.onclick = null; });
      bar.remove();
    }
  };
}
