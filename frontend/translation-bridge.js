function localBundleBase(value) {
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
  ) throw new Error("Workspace shell bundle base must be a same-origin absolute path");
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.search || url.hash || url.username || url.password) {
    throw new Error("Workspace shell bundle base must be a same-origin path only");
  }
  return url.pathname.replace(/\/+$/, "");
}

export function createTranslationBridge({
  controlsContainer,
  panelContainer,
  getModel,
  api,
  onOpenChange,
  goToSource,
  onOpenSettings,
  onMounted,
  bundleBase = "/vendor/workspace-shell"
}) {
  let handle = null;
  let loadPromise = null;
  let generation = 0;
  let destroyed = false;

  function load() {
    if (destroyed) return Promise.resolve(false);
    if (handle) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    const ticket = ++generation;
    loadPromise = (async () => {
      try {
        const base = localBundleBase(bundleBase);
        const module = await import(`${base}/workspace-shell.js`);
        if (destroyed || ticket !== generation || typeof module.mountTranslationPanel !== "function") return false;
        handle = module.mountTranslationPanel({
          controlsContainer,
          panelContainer,
          model: getModel(),
          callbacks: { api, onOpenChange, goToSource, onOpenSettings },
          onMounted
        });
        return true;
      } catch {
        return false;
      } finally {
        if (ticket === generation) loadPromise = null;
      }
    })();
    return loadPromise;
  }

  return {
    load,
    update(model) {
      return handle?.update(model) || false;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      const owned = handle;
      handle = null;
      owned?.destroy();
    }
  };
}
