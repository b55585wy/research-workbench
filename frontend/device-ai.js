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

export function createDeviceAIBridge({ getLanguage, bundleBase = "/vendor/workspace-shell" }) {
  let container = null;
  let source = null;
  let handle = null;
  let loadPromise = null;
  let generation = 0;

  function showFallback() {
    if (!container) return;
    const message = getLanguage() === "en"
      ? "The translation controls could not be loaded. Close and reopen the selection popup to retry; the original and notes are unaffected."
      : "翻译控件加载失败。请关闭并重新打开选区弹窗重试；原文和笔记不受影响。";
    const status = document.createElement("p");
    status.className = "selection-translation-status device-ai-fallback";
    status.dataset.kind = "error";
    status.setAttribute("role", "alert");
    status.textContent = message;
    container.replaceChildren(status);
  }

  function close() {
    generation += 1;
    loadPromise = null;
    const owned = handle;
    handle = null;
    owned?.destroy();
    container?.replaceChildren();
    container = null;
    source = null;
  }

  function show({ container: nextContainer, source: nextSource, callbacks }) {
    close();
    container = nextContainer;
    source = nextSource;
    const ticket = ++generation;
    const owner = container;
    loadPromise = (async () => {
      try {
        const base = localBundleBase(bundleBase);
        const module = await import(`${base}/workspace-shell.js`);
        if (ticket !== generation || owner !== container || typeof module.mountDeviceAI !== "function") {
          throw new Error("Device AI mount unavailable");
        }
        handle = module.mountDeviceAI({
          container: owner,
          model: { language: getLanguage() === "en" ? "en" : "zh", source },
          callbacks,
          onMounted: callbacks.onLayout
        });
        return true;
      } catch {
        if (ticket === generation && owner === container) showFallback();
        return false;
      } finally {
        if (ticket === generation) loadPromise = null;
      }
    })();
    return loadPromise;
  }

  return {
    show,
    close,
    applyLanguage() {
      if (handle && source) {
        handle.update({ language: getLanguage() === "en" ? "en" : "zh", source });
      } else if (container?.querySelector(".device-ai-fallback")) {
        showFallback();
      }
    }
  };
}
