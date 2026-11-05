function localBundleURL(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Chart skills bundle must use a same-origin absolute path");
  }
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.hash || url.username || url.password) {
    throw new Error("Chart skills bundle must use a same-origin path");
  }
  return url.pathname + url.search;
}

/** Explicit lazy load; this bridge never hides or moves the native chart controls. */
export function createChartSkills({ container, getModel, api, onSelect,
  bundleURL = "/vendor/workspace-shell/workspace-shell.js" }) {
  let handle = null;
  let latestModel = null;
  let loadPromise = null;
  let destroyed = false;
  function load() {
    if (destroyed) return Promise.resolve(false);
    if (handle) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const module = await import(localBundleURL(bundleURL));
        if (destroyed) return false;
        if (typeof module.mountChartSkills !== "function") throw new Error("Chart skills export unavailable");
        handle = module.mountChartSkills({ container, model: latestModel || getModel(), callbacks: { api, onSelect } });
        if (!handle || ["update", "destroy", "hasUnsavedWork", "prepareNavigation"].some((key) => typeof handle[key] !== "function")) {
          throw new Error("Chart skills lifecycle unavailable");
        }
        return true;
      } catch {
        try { handle?.destroy?.(); } catch { /* Keep the native chart controls available. */ }
        handle = null;
        console.warn("Figure skills unavailable; built-in presets remain available.");
        return false;
      } finally { loadPromise = null; }
    })();
    return loadPromise;
  }
  return {
    load,
    update(model = getModel()) {
      if (destroyed) return false;
      // Isolate queued inputs from callers while the module is loading.
      latestModel = structuredClone(model);
      return handle ? handle.update(latestModel) : true;
    },
    hasUnsavedWork() { return handle?.hasUnsavedWork() || false; },
    prepareNavigation() { return handle ? handle.prepareNavigation() : true; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const owned = handle; handle = null;
      owned?.destroy();
    }
  };
}
