function localBundleURL(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Teaching data bundle must use a same-origin absolute path");
  }
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.hash || url.username || url.password) {
    throw new Error("Teaching data bundle must use a same-origin path");
  }
  return url.pathname + url.search;
}

/** Root opts into loading. Native import and analysis controls are never moved or hidden. */
export function createTeachingData({ container, getModel, onImport, onContinue, onRefresh, onLockChange,
  bundleURL = "/vendor/workspace-shell/workspace-shell.js" }) {
  let handle = null;
  let latestModel = null;
  let revision = 0;
  let loadPromise = null;
  let destroyed = false;
  const warn = () => console.warn("Teaching examples unavailable; native data tools remain available.");
  function cleanup(owned) { try { owned?.destroy?.(); } catch { warn(); } }
  function load() {
    if (destroyed) return Promise.resolve(false);
    if (handle) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      let candidate = null;
      try {
        if (!container || container.childNodes.length) throw new Error("Teaching data require an empty host");
        if (!latestModel) latestModel = structuredClone(getModel());
        const module = await import(localBundleURL(bundleURL));
        if (destroyed) return false;
        if (typeof module.mountTeachingData !== "function") throw new Error("Teaching data export unavailable");
        const mountedRevision = revision;
        candidate = module.mountTeachingData({ container, model: structuredClone(latestModel),
          callbacks: { onImport, onContinue, onRefresh, onLockChange } });
        if (!candidate || ["update", "destroy", "hasUnsavedWork", "prepareNavigation"].some(key => typeof candidate[key] !== "function")) {
          throw new Error("Teaching data lifecycle unavailable");
        }
        if (destroyed) { cleanup(candidate); return false; }
        if (revision !== mountedRevision && candidate.update(structuredClone(latestModel)) !== true) {
          throw new Error("Teaching data initial update failed");
        }
        handle = candidate;
        return true;
      } catch {
        cleanup(candidate); warn(); return false;
      }
    })();
    // Cleanup is attached outside the async body so synchronous failures also permit retry.
    const current = loadPromise;
    void current.finally(() => { if (loadPromise === current) loadPromise = null; });
    return current;
  }
  return {
    load,
    update(model) {
      if (destroyed) return false;
      try {
        const isolated = structuredClone(model === undefined ? getModel() : model);
        latestModel = isolated; revision += 1;
        return handle ? handle.update(structuredClone(isolated)) === true : true;
      } catch { warn(); return false; }
    },
    hasUnsavedWork() {
      try { return handle ? handle.hasUnsavedWork() !== false : false; }
      catch { return true; }
    },
    prepareNavigation() {
      try { return handle ? handle.prepareNavigation() === true : true; }
      catch { return false; }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; latestModel = null;
      const owned = handle; handle = null;
      cleanup(owned);
    }
  };
}
