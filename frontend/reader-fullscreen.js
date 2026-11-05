export function captureFlowPosition(scroller) {
  if (!scroller) return null;
  const top = scroller.getBoundingClientRect().top;
  const block = [...scroller.querySelectorAll("[data-flow-block-id]")]
    .find((element) => element.getBoundingClientRect().bottom > top + 1);
  return { scroller, block, offset: block ? block.getBoundingClientRect().top - top : 0, scrollTop: scroller.scrollTop };
}

export function restoreFlowPosition(position) {
  if (!position?.scroller.isConnected) return;
  const { scroller, block } = position;
  if (block?.isConnected && scroller.contains(block)) {
    scroller.scrollTop += block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - position.offset;
  } else scroller.scrollTop = position.scrollTop;
}

export function createFlowPositionRestorer({ isCurrent, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let frame = null;
  let pending = null;
  return {
    schedule(snapshot) {
      if (!pending || pending.document !== snapshot.document) pending = snapshot;
      if (frame !== null) return;
      frame = requestFrame(() => {
        const position = pending;
        pending = null;
        frame = null;
        if (position && isCurrent(position)) restoreFlowPosition(position.position);
      });
    },
    cancel() {
      if (frame !== null) cancelFrame(frame);
      pending = null;
      frame = null;
    }
  };
}

export function createReaderFullscreen({ panel, button, capture, onChange, getLabel }) {
  const document = panel.ownerDocument;
  const browser = document.defaultView;
  const outside = new Map();
  let mode = "none";
  let wanted = false;
  let generation = 0;
  let destroyed = false;
  let returnFocus = null;
  let restoreOnExit = true;

  const isActive = () => mode !== "none";

  function refresh() {
    const active = isActive();
    const label = getLabel(active);
    button.dataset.i18n = active ? "exitFullscreen" : "readerFullscreen";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(active));
  }

  function isolate(active) {
    if (!active) {
      for (const [element, inert] of outside) element.inert = inert;
      outside.clear();
      return;
    }
    for (let branch = panel; branch.parentElement; branch = branch.parentElement) {
      for (const element of branch.parentElement.children) {
        if (element === branch || outside.has(element)) continue;
        outside.set(element, element.inert);
        element.inert = true;
      }
    }
  }

  function setMode(next, snapshot = capture(), notify = true, restoreFocus = true) {
    if (mode === next) return;
    const wasActive = isActive();
    mode = next;
    const active = isActive();
    document.documentElement.classList.toggle("reader-fullscreen-active", active);
    panel.classList.toggle("reader-fullscreen-panel", active);
    panel.dataset.fullscreenMode = mode;
    if (wasActive !== active) isolate(active);
    refresh();
    if (notify) onChange({ active, snapshot });
    if (!active && restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  async function exit({ restoreFocus = true } = {}) {
    wanted = false;
    restoreOnExit = restoreFocus;
    generation += 1;
    const snapshot = capture();
    if (document.fullscreenElement === panel) {
      try { await document.exitFullscreen(); } catch {
        if (document.fullscreenElement === panel) { wanted = true; return false; }
      }
    }
    setMode("none", snapshot, !destroyed, restoreFocus);
    return true;
  }

  async function toggle(trigger = button) {
    if (destroyed) return false;
    if (isActive()) return exit();
    if (button.disabled || document.fullscreenElement && document.fullscreenElement !== panel) return false;
    const ticket = ++generation;
    wanted = true;
    restoreOnExit = true;
    returnFocus = trigger;
    setMode("immersive");
    try { await panel.requestFullscreen?.(); } catch {
      // Mobile browsers without native fullscreen retain the immersive view.
    }
    if (destroyed || !wanted || ticket !== generation) {
      if (!wanted && document.fullscreenElement === panel) await exit({ restoreFocus: false });
      return false;
    }
    if (document.fullscreenElement === panel) setMode("native");
    return true;
  }

  function changed() {
    if (document.fullscreenElement === panel) {
      if (wanted && !destroyed) setMode("native");
      else void exit({ restoreFocus: false });
    } else if (mode === "native") {
      wanted = false;
      setMode("none", capture(), !destroyed, restoreOnExit);
    }
  }

  const clicked = () => void toggle(panel.contains(document.activeElement) ? document.activeElement : button);
  const keydown = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !isActive() || document.fullscreenElement === panel) return;
    event.preventDefault();
    void exit();
  };
  const pagehide = () => void exit({ restoreFocus: false });
  button.addEventListener("click", clicked);
  document.addEventListener("fullscreenchange", changed);
  browser.addEventListener("keydown", keydown);
  browser.addEventListener("pagehide", pagehide);
  refresh();

  return {
    isActive, toggle, exit,
    update() {
      refresh();
      if (button.disabled && isActive()) void exit({ restoreFocus: false });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      button.removeEventListener("click", clicked);
      document.removeEventListener("fullscreenchange", changed);
      browser.removeEventListener("keydown", keydown);
      browser.removeEventListener("pagehide", pagehide);
      void exit({ restoreFocus: false });
    }
  };
}
