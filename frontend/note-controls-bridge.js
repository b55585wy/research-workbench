function localBundleBase(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Note controls bundle base must be a same-origin absolute path");
  }
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.search || url.hash || url.username || url.password) {
    throw new Error("Note controls bundle base must be a same-origin path only");
  }
  return url.pathname.replace(/\/+$/, "");
}

export function createNoteControlsBridge({
  filterContainer,
  nativeFilterContainer,
  bundleBase = "/vendor/workspace-shell"
}) {
  let modulePromise = null;
  let filterHandle = null;
  let filterRequest = null;
  let filterGeneration = 0;
  let destroyed = false;
  let pendingNoteFocus = null;
  const notes = new Map();

  function noteControlKey(control) {
    if (!(control instanceof HTMLButtonElement)) return null;
    if (control.closest(".note-more-menu")) return "action:note-more:";
    if (control.dataset.masteryLevel !== undefined) return `mastery:${control.dataset.masteryLevel}`;
    if (!control.dataset.action) return null;
    return `action:${control.dataset.action}:${control.dataset.value || ""}`;
  }

  function captureNoteFocus() {
    const active = window.document.activeElement;
    const focused = [...notes.values()].find((registration) => active instanceof Node && registration.container.contains(active));
    if (focused) {
      const controlKey = noteControlKey(active);
      pendingNoteFocus = controlKey ? { noteId: focused.model.noteId, controlKey } : null;
      return;
    }
    if (active && active !== window.document.body && active !== window.document.documentElement) {
      pendingNoteFocus = null;
      return;
    }
    if (pendingNoteFocus && !notes.has(pendingNoteFocus.noteId)) pendingNoteFocus = null;
  }

  function restoreNoteFocus(registration) {
    if (!pendingNoteFocus || pendingNoteFocus.noteId !== registration.model.noteId) return;
    const active = window.document.activeElement;
    if (active && active !== window.document.body && active !== window.document.documentElement && !registration.container.contains(active)) {
      pendingNoteFocus = null;
      return;
    }
    const target = [...registration.container.querySelectorAll("button")].find((button) => (
      !button.disabled && noteControlKey(button) === pendingNoteFocus.controlKey
    ));
    if (!target) return;
    target.focus({ preventScroll: true });
    if (window.document.activeElement === target) pendingNoteFocus = null;
  }

  function load() {
    if (destroyed) return Promise.resolve(null);
    if (modulePromise) return modulePromise;
    modulePromise = (async () => {
      try {
        const base = localBundleBase(bundleBase);
        const module = await import(`${base}/workspace-shell.js`);
        if (destroyed || typeof module.mountNoteControls !== "function" || typeof module.mountNoteFilters !== "function") return null;
        return module;
      } catch {
        return null;
      } finally {
        modulePromise = null;
      }
    })();
    return modulePromise;
  }

  function mount(container, model, callbacks, onMounted) {
    if (destroyed || !(container instanceof HTMLElement)) return;
    const previous = notes.get(model.noteId);
    if (previous) {
      previous.active = false;
      previous.handle?.destroy();
    }
    const registration = { container, model, callbacks, onMounted, handle: null, active: true };
    notes.set(model.noteId, registration);
    void load().then((module) => {
      if (!module || !registration.active || destroyed || notes.get(model.noteId) !== registration || !container.isConnected) return;
      registration.handle = module.mountNoteControls({
        container,
        model: registration.model,
        callbacks: registration.callbacks,
        onMounted: () => {
          if (!registration.active || destroyed || notes.get(model.noteId) !== registration) return;
          registration.onMounted?.();
          restoreNoteFocus(registration);
        }
      });
    });
  }

  function updateFilters(model, onChange, onMounted) {
    if (destroyed) return false;
    const request = { model, onChange, onMounted };
    filterRequest = request;
    if (filterHandle) return filterHandle.update(model);
    const ticket = ++filterGeneration;
    void load().then((module) => {
      if (!module || destroyed || ticket !== filterGeneration || filterRequest !== request || !filterContainer.isConnected) return;
      filterHandle = module.mountNoteFilters({
        container: filterContainer,
        model: request.model,
        onChange: (field, value) => {
          if (!destroyed && filterRequest) filterRequest.onChange(field, value);
        },
        onMounted: request.onMounted
      });
    });
    return false;
  }

  function destroyNotes() {
    captureNoteFocus();
    for (const registration of notes.values()) {
      registration.active = false;
      registration.handle?.destroy();
    }
    notes.clear();
  }

  return {
    mount,
    updateFilters,
    destroyNotes,
    focusFilterQuery() {
      const input = filterHandle ? filterContainer.querySelector('input[type="search"]') : nativeFilterContainer?.querySelector('input[type="search"]');
      input?.focus({ preventScroll: true });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      filterGeneration += 1;
      filterRequest = null;
      destroyNotes();
      pendingNoteFocus = null;
      const ownedFilter = filterHandle;
      filterHandle = null;
      ownedFilter?.destroy();
      if (nativeFilterContainer) nativeFilterContainer.hidden = false;
    }
  };
}
