function localBundleURL(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Notes workspace bundle must use a same-origin absolute path");
  }
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.hash || url.username || url.password) {
    throw new Error("Notes workspace bundle must use a same-origin path");
  }
  return url.pathname + url.search;
}

/** Lazy presentation bridge. Native controls remain usable until all slots mount. */
export function createNotesWorkspace({
  container,
  hosts,
  getModel,
  onOpenEditor,
  bundleURL = "/vendor/workspace-shell/workspace-shell.js"
}) {
  let handle = null;
  let destroyed = false;
  let latestModel = null;
  let requestedSection = null;
  let requestedOwner = null;
  let loadPromise = null;

  function load() {
    if (destroyed) return Promise.resolve(false);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const module = await import(localBundleURL(bundleURL));
        if (destroyed) return false;
        if (typeof module.mountNotesWorkspace !== "function") throw new Error("Notes workspace export unavailable");
        handle = module.mountNotesWorkspace({
          container, hosts, model: latestModel || getModel(), callbacks: { onOpenEditor }
        });
        if (requestedSection && requestedOwner === (latestModel || getModel()).ownerId && handle.show(requestedSection) === false) {
          throw new Error("Notes workspace section unavailable");
        }
        return true;
      } catch (error) {
        handle?.destroy();
        handle = null;
        console.warn("Notes workspace unavailable; native notes remain available.", error);
        return false;
      }
    })();
    return loadPromise;
  }

  return {
    ready: load(),
    load,
    update(model = getModel()) {
      if (destroyed) return false;
      if (requestedSection && requestedOwner !== model.ownerId) requestedSection = null;
      latestModel = { ...model };
      return handle ? handle.update(latestModel) : true;
    },
    show(section) {
      if (destroyed || !["saved", "editor", "images"].includes(section)) return false;
      requestedSection = section;
      requestedOwner = (latestModel || getModel()).ownerId;
      if (handle) return handle.show(section);
      // An explicit insertion/open request also works while the bundle is unavailable.
      if (hosts[section]?.tagName === "DETAILS") hosts[section].open = true;
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      handle?.destroy();
      handle = null;
    }
  };
}
