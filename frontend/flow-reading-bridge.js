const MAX_VISUALS = 6;
const MAX_PAGE_EDGE = 1600;
const MAX_PAGE_PIXELS = 2_600_000;
const MAX_BLOB_BYTES = 4 * 1024 * 1024;

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

function safeRect(rect) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function visualKey(input) {
  return [
    input.documentId,
    input.sourceSha256,
    input.page,
    input.rect.x,
    input.rect.y,
    input.rect.width,
    input.rect.height
  ].join(":");
}

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function createFlowReadingBridge({
  container,
  getModel,
  api,
  getPdf,
  getDocument,
  goToSource,
  onPageViewed,
  onRequestTranslation,
  onMounted,
  bundleBase = "/vendor/workspace-shell"
}) {
  let handle = null;
  let loadPromise = null;
  let loadGeneration = 0;
  let visualGeneration = 0;
  let destroyed = false;
  let renderQueue = Promise.resolve();
  const cache = new Map();
  const renders = new Set();

  function identityMatches(input, pdf = null) {
    const document = getDocument();
    return Boolean(
      !destroyed
      && document
      && document.id === input.documentId
      && document.sha256 === input.sourceSha256
      && Number.isInteger(input.page)
      && input.page >= 1
      && input.page <= document.page_count
      && (!pdf || getPdf() === pdf)
    );
  }

  function revoke(entry) {
    if (entry.revoked) return;
    entry.revoked = true;
    URL.revokeObjectURL(entry.url);
  }

  function clearVisuals() {
    visualGeneration += 1;
    for (const record of renders) {
      try {
        record.task?.cancel();
      } catch {
        // Stale visual results are also rejected by identity and generation checks.
      }
    }
    for (const entry of cache.values()) revoke(entry);
    cache.clear();
  }

  function acquire(entry) {
    entry.references += 1;
    entry.used = performance.now();
    let released = false;
    return {
      url: entry.url,
      width: entry.width,
      height: entry.height,
      release() {
        if (released) return;
        released = true;
        entry.references = Math.max(0, entry.references - 1);
        entry.used = performance.now();
      }
    };
  }

  function makeRoom() {
    if (cache.size < MAX_VISUALS) return true;
    const reusable = [...cache.values()].filter((entry) => entry.references === 0)
      .sort((first, second) => first.used - second.used);
    if (!reusable.length) return false;
    const entry = reusable[0];
    cache.delete(entry.key);
    revoke(entry);
    return true;
  }

  async function renderVisual(input, generation) {
    const rect = safeRect(input.rect);
    if (!rect || !identityMatches(input)) return null;
    const key = visualKey(input);
    const cached = cache.get(key);
    if (cached) return acquire(cached);
    if (!makeRoom()) return null;
    const pdf = getPdf();
    if (!pdf || !identityMatches(input, pdf)) return null;
    const record = { task: null };
    let canvas = null;
    const cancel = () => {
      try {
        record.task?.cancel();
      } catch {
        // Cancellation is best effort; stale results are discarded below.
      }
    };
    renders.add(record);
    input.signal.addEventListener("abort", cancel, { once: true });
    try {
      const page = await pdf.getPage(input.page);
      if (input.signal.aborted || generation !== visualGeneration || !identityMatches(input, pdf)) return null;
      const base = page.getViewport({ scale: 1 });
      if (!(base.width > 0 && base.height > 0)) return null;
      const scale = Math.min(2, MAX_PAGE_EDGE / Math.max(base.width, base.height), Math.sqrt(MAX_PAGE_PIXELS / (base.width * base.height)));
      if (!(scale > 0 && Number.isFinite(scale))) return null;
      const viewport = page.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(rect.width * viewport.width));
      canvas.height = Math.max(1, Math.floor(rect.height * viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      record.task = page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: "#ffffff",
        transform: [1, 0, 0, 1, -rect.x * viewport.width, -rect.y * viewport.height]
      });
      await record.task.promise;
      if (input.signal.aborted || generation !== visualGeneration || !identityMatches(input, pdf)) return null;
      const blob = await canvasBlob(canvas);
      if (!blob || blob.size > MAX_BLOB_BYTES || input.signal.aborted || generation !== visualGeneration || !identityMatches(input, pdf)) return null;
      const entry = {
        key,
        url: URL.createObjectURL(blob),
        width: Math.max(1, Math.floor(rect.width * viewport.width)),
        height: Math.max(1, Math.floor(rect.height * viewport.height)),
        references: 0,
        used: performance.now(),
        revoked: false
      };
      cache.set(key, entry);
      return acquire(entry);
    } catch {
      return null;
    } finally {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      input.signal.removeEventListener("abort", cancel);
      renders.delete(record);
    }
  }

  function getVisual(input) {
    const rect = safeRect(input?.rect);
    if (!rect || !identityMatches(input)) return Promise.resolve(null);
    const normalized = { ...input, rect };
    const cached = cache.get(visualKey(normalized));
    if (cached) return Promise.resolve(acquire(cached));
    const generation = visualGeneration;
    const result = renderQueue.catch(() => null).then(() => {
      if (normalized.signal.aborted || generation !== visualGeneration) return null;
      return renderVisual(normalized, generation);
    });
    renderQueue = result.catch(() => null);
    return result;
  }

  function load() {
    if (destroyed) return Promise.resolve(false);
    if (handle) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    const ticket = ++loadGeneration;
    loadPromise = (async () => {
      try {
        const base = localBundleBase(bundleBase);
        const module = await import(`${base}/workspace-shell.js`);
        if (destroyed || ticket !== loadGeneration || typeof module.mountFlowReader !== "function") return false;
        handle = module.mountFlowReader({
          container,
          model: getModel(),
          callbacks: {
            api,
            getVisual,
            onOpenOriginal: goToSource,
            onPageViewed,
            onRequestTranslation
          },
          onMounted
        });
        return true;
      } catch {
        return false;
      } finally {
        if (ticket === loadGeneration) loadPromise = null;
      }
    })();
    return loadPromise;
  }

  return {
    load,
    update(model) {
      return handle?.update(model) || false;
    },
    clearVisuals,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loadGeneration += 1;
      clearVisuals();
      const owned = handle;
      handle = null;
      owned?.destroy();
    }
  };
}
