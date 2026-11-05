const owners = new WeakMap();

function localBundleURL(value, origin) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new TypeError("Research shell bundle must be a same-origin absolute path");
  }
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || url.hash) {
    throw new TypeError("Research shell bundle must be a same-origin path without a fragment");
  }
  return url.href;
}

export function createResearchShell({
  container, getModel, subscribe, onNavigate, onLibrary, onNotes, onAssistant,
  bundleURL = "/vendor/workspace-shell/workspace-shell.js"
}) {
  if (!container || container.nodeType !== 1) throw new TypeError("Research shell requires an element host");
  const documentRoot = container.ownerDocument.documentElement;
  owners.get(documentRoot)?.destroy();
  let handle = null;
  let unsubscribe = null;
  let loadPromise = null;
  let generation = 0;
  let destroyed = false;
  let lastError = null;
  container.classList.add("research-shell-host");
  container.hidden = true;

  function release() {
    const stop = unsubscribe;
    unsubscribe = null;
    const owned = handle;
    handle = null;
    try { if (typeof stop === "function") stop(); }
    catch (error) { console.warn("Research shell subscription cleanup failed.", error); }
    try { if (typeof owned?.destroy === "function") owned.destroy(); }
    catch (error) { console.warn("Research shell mount cleanup failed.", error); }
    if (owners.get(documentRoot) === bridge) documentRoot.removeAttribute("data-research-shell");
    container.hidden = true;
  }

  function fail(error) {
    lastError = error;
    release();
    console.warn("Research shell unavailable; native navigation retained.", error);
    return false;
  }

  function update(model) {
    if (destroyed || !handle) return false;
    try {
      if (model === undefined) model = getModel();
      if (handle.update(model) === false) throw new Error("Research shell no longer owns its host");
      return true;
    } catch (error) { return fail(error); }
  }

  function load() {
    if (destroyed) return Promise.resolve(false);
    if (handle) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    const ticket = ++generation;
    loadPromise = Promise.resolve().then(async () => {
      try {
        const url = localBundleURL(bundleURL, window.location.origin);
        const module = await import(url);
        if (destroyed || ticket !== generation) return false;
        if (typeof module.mountResearchShell !== "function") throw new TypeError("Research shell export is missing");
        let mounted = false;
        handle = module.mountResearchShell({
          container, model: getModel(),
          callbacks: {
            onNavigate: (area) => { if (!getModel().pending) return onNavigate(area); },
            onLibrary, onNotes, onAssistant
          },
          onMounted: () => { mounted = true; }
        });
        if (!mounted || typeof handle?.update !== "function" || typeof handle?.destroy !== "function") {
          throw new TypeError("Research shell did not complete its mount");
        }
        unsubscribe = subscribe?.(() => update()) || null;
        if (unsubscribe !== null && typeof unsubscribe !== "function") throw new TypeError("Research shell subscription must return a cleanup function");
        if (!update()) { release(); return false; }
        container.hidden = false;
        documentRoot.setAttribute("data-research-shell", "ready");
        lastError = null;
        return true;
      } catch (error) { return fail(error); }
    }).finally(() => { if (ticket === generation) loadPromise = null; });
    return loadPromise;
  }

  const bridge = {
    load, update,
    getError: () => lastError,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      release();
      if (owners.get(documentRoot) === bridge) owners.delete(documentRoot);
    }
  };
  owners.set(documentRoot, bridge);
  return bridge;
}
