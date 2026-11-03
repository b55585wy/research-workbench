const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

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

function normalizeModel(model) {
  const papers = [];
  const keys = new Set();
  for (const item of Array.isArray(model?.papers) ? model.papers : []) {
    if (!item || !UUID_PATTERN.test(item.documentId) || !SHA256_PATTERN.test(item.sourceSha256)
      || !Number.isInteger(item.pageCount) || item.pageCount < 1 || item.pageCount > 200) continue;
    const key = `${item.documentId}:${item.sourceSha256}`;
    if (keys.has(key)) continue;
    keys.add(key);
    papers.push(Object.freeze({
      documentId: item.documentId,
      sourceSha256: item.sourceSha256,
      title: typeof item.title === "string" ? item.title : "",
      pageCount: item.pageCount,
      initialPage: Number.isInteger(item.initialPage) && item.initialPage >= 1 && item.initialPage <= item.pageCount ? item.initialPage : 1
    }));
  }
  return Object.freeze({
    language: model?.language === "en" ? "en" : "zh",
    visible: model?.visible === true,
    contextKey: typeof model?.contextKey === "string" && model.contextKey.length <= 512 ? model.contextKey : "",
    editable: model?.editable === true,
    papers: Object.freeze(papers),
    preferredDocumentId: UUID_PATTERN.test(model?.preferredDocumentId || "") ? model.preferredDocumentId : null
  });
}

export function createSourcePreparationBridge({
  container,
  getModel,
  api,
  onMounted,
  bundleBase = "/vendor/workspace-shell"
}) {
  let handle = null;
  let loadPromise = null;
  let generation = 0;
  let destroyed = false;
  let loadFailed = false;
  let resetPending = false;

  function fallbackCopy() {
    return getModel()?.language === "en"
      ? { title: "Prepare paper pages", message: "The page-preparation controls could not be loaded. Native chat remains available.", retry: "Retry loading" }
      : { title: "准备论文页面", message: "页面准备控件加载失败；原有对话功能仍可使用。", retry: "重试加载" };
  }

  function clearFallback() {
    if (!handle) container.replaceChildren();
  }

  function showFallback() {
    if (destroyed || handle || !loadFailed) return;
    const copy = fallbackCopy();
    const existing = container.firstElementChild;
    if (existing instanceof HTMLDetailsElement && existing.classList.contains("source-preparation-fallback")) {
      existing.querySelector("summary").textContent = copy.title;
      existing.querySelector(".source-preparation-status").textContent = copy.message;
      existing.querySelector("button").textContent = copy.retry;
      return;
    }
    const details = document.createElement("details");
    details.className = "source-preparation source-preparation-fallback";
    const summary = document.createElement("summary");
    summary.textContent = copy.title;
    const body = document.createElement("div");
    body.className = "source-preparation-body";
    const message = document.createElement("p");
    message.className = "source-preparation-status";
    message.dataset.kind = "error";
    message.setAttribute("role", "status");
    message.textContent = copy.message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button button-secondary";
    retry.textContent = copy.retry;
    retry.addEventListener("click", () => {
      retry.disabled = true;
      void load().finally(() => {
        if (retry.isConnected) retry.disabled = false;
      });
    });
    body.append(message, retry);
    details.append(summary, body);
    container.replaceChildren(details);
  }

  function load() {
    if (destroyed) return Promise.resolve(false);
    if (handle) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    const ticket = ++generation;
    loadFailed = false;
    loadPromise = (async () => {
      try {
        const base = localBundleBase(bundleBase);
        const module = await import(`${base}/workspace-shell.js`);
        if (destroyed || ticket !== generation || typeof module.mountSourcePreparation !== "function") throw new Error("Source preparation mount unavailable");
        clearFallback();
        handle = module.mountSourcePreparation({
          container,
          model: normalizeModel(getModel()),
          callbacks: { api },
          onMounted
        });
        loadFailed = false;
        if (resetPending) {
          resetPending = false;
          handle.reset();
        }
        return true;
      } catch {
        loadFailed = true;
        showFallback();
        return false;
      } finally {
        if (ticket === generation) loadPromise = null;
      }
    })();
    return loadPromise;
  }

  function reset() {
    if (handle) {
      resetPending = false;
      handle.reset();
    } else {
      resetPending = true;
      const fallback = container.querySelector("details.source-preparation-fallback");
      if (fallback) fallback.open = false;
    }
  }

  function onPageHide() {
    reset();
  }

  window.addEventListener("pagehide", onPageHide);

  return {
    load,
    update(model) {
      const normalized = normalizeModel(model);
      if (handle) return handle.update(normalized);
      if (loadFailed) showFallback();
      return false;
    },
    reset,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      window.removeEventListener("pagehide", onPageHide);
      const owned = handle;
      handle = null;
      owned?.destroy();
      container.replaceChildren();
    }
  };
}
