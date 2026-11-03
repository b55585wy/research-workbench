const BATCH = 12;

export function createReaderNavigation({ elements, t, goToPage, goToDestination, onChange }) {
  let pdf = null;
  let sequence = 0;
  let tab = "outline";
  let batch = 0;
  let outline = [];
  let observer = null;
  let active = 0;
  const queue = [];
  const queued = new Set();

  function currentPage() { return Number(elements.pageInput.value) || 1; }
  function visible() { return !elements.panel.hidden; }
  function current() { return visible() && tab === "thumbnails"; }

  function positionPanel() {
    if (!visible()) return;
    const panel = elements.panel;
    if (window.matchMedia("(max-width: 480px)").matches) {
      panel.style.left = panel.style.top = panel.style.width = panel.style.maxHeight = "";
      return;
    }
    const stage = panel.parentElement.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, stage.left + 12));
    const top = Math.max(8, Math.min(window.innerHeight - 80, stage.top + 12));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(80, window.innerHeight - top - 8)}px`;
  }

  function update() {
    positionPanel();
    elements.toggle.setAttribute("aria-expanded", String(visible()));
    elements.outlineTab.setAttribute("aria-selected", String(tab === "outline"));
    elements.thumbnailsTab.setAttribute("aria-selected", String(tab === "thumbnails"));
    elements.outline.hidden = tab !== "outline";
    elements.thumbnailsPanel.hidden = tab !== "thumbnails";
    elements.previous.disabled = batch === 0;
    elements.next.disabled = !pdf || (batch + 1) * BATCH >= pdf.numPages;
    elements.range.textContent = pdf ? `${batch * BATCH + 1}–${Math.min(pdf.numPages, (batch + 1) * BATCH)} / ${pdf.numPages}` : "";
    elements.thumbnails.querySelectorAll("[data-page]").forEach((button) => {
      const selected = Number(button.dataset.page) === currentPage();
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    onChange?.();
  }

  let thumbnailSequence = 0;

  function stopThumbnails() {
    thumbnailSequence += 1;
    observer?.disconnect();
    observer = null;
    queue.length = 0;
    queued.clear();
    for (const button of elements.thumbnails.querySelectorAll("[data-page]")) {
      try { button._thumbnailTask?.cancel(); } catch { /* stale render is detached */ }
      button._thumbnailTask = null;
      const canvas = button.querySelector("canvas");
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
  }

  async function renderThumbnail(button, token) {
    const pageNumber = Number(button.dataset.page);
    const canvas = button.querySelector("canvas");
    const ownerPdf = pdf;
    if (!canvas || !ownerPdf) return;
    active += 1;
    let task = null;
    try {
      const page = await ownerPdf.getPage(pageNumber);
      if (token !== thumbnailSequence || pdf !== ownerPdf || !button.isConnected) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(120 / base.width, 180 / base.height, Math.sqrt(50000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      task = page.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: false }), viewport, background: "#ffffff" });
      button._thumbnailTask = task;
      await task.promise;
    } catch (error) {
      if (token === thumbnailSequence && pdf === ownerPdf && !["RenderingCancelledException", "AbortException"].includes(error?.name)) canvas.replaceWith(document.createElement("canvas"));
    } finally {
      if (button._thumbnailTask === task) button._thumbnailTask = null;
      active -= 1;
      pump(thumbnailSequence);
    }
  }

  function pump(token) {
    if (token !== thumbnailSequence || !current()) return;
    while (active < 2 && queue.length) {
      const button = queue.shift();
      queued.delete(button);
      if (button.isConnected && !button.dataset.rendered) {
        button.dataset.rendered = "true";
        void renderThumbnail(button, token);
      }
    }
  }

  function request(button) {
    if (queued.has(button) || button.dataset.rendered) return;
    queued.add(button);
    queue.push(button);
    pump(thumbnailSequence);
  }

  function renderBatch() {
    stopThumbnails();
    elements.thumbnails.replaceChildren();
    if (!pdf) return;
    const token = thumbnailSequence;
    observer = new IntersectionObserver((observations) => {
      for (const observation of observations) if (observation.isIntersecting) request(observation.target);
    }, { root: elements.thumbnails, rootMargin: "120px" });
    const end = Math.min(pdf.numPages, (batch + 1) * BATCH);
    for (let page = batch * BATCH + 1; page <= end; page += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reader-thumbnail";
      button.dataset.page = String(page);
      button.setAttribute("aria-label", `${t("pdfPage")} ${page}`);
      button.addEventListener("click", () => goToPage(page));
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = String(page);
      button.append(canvas, label);
      elements.thumbnails.append(button);
      observer.observe(button);
    }
    update();
  }

  function outlineButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-outline-link";
    button.textContent = item.title || t("untitled");
    if (item.url) {
      let safe = false;
      try { safe = ["http:", "https:"].includes(new URL(item.url).protocol); } catch { safe = false; }
      if (!safe) { button.disabled = true; return button; }
      button.addEventListener("click", () => window.open(item.url, "_blank", "noopener,noreferrer"));
    } else {
      button.disabled = !item.dest;
      button.addEventListener("click", () => goToDestination(item.dest));
    }
    return button;
  }

  function appendOutline(items, container, depth = 0) {
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "reader-outline-item";
      row.style.paddingInlineStart = `${depth * 12}px`;
      row.append(outlineButton(item));
      container.append(row);
      if (item.items?.length) appendOutline(item.items, container, depth + 1);
    }
  }

  let outlineRequest = null;

  async function loadOutline() {
    const ownerPdf = pdf;
    if (!ownerPdf || outlineRequest?.pdf === ownerPdf) return;
    const token = sequence;
    elements.outlineStatus.textContent = t("outlineLoading");
    elements.outlineList.replaceChildren();
    elements.outlineRetry.hidden = true;
    const request = ownerPdf.getOutline();
    outlineRequest = { pdf: ownerPdf, request };
    try {
      const result = await request || [];
      if (token !== sequence || pdf !== ownerPdf) return;
      outline = result;
      elements.outlineList.replaceChildren();
      elements.outlineStatus.textContent = outline.length ? "" : t("outlineEmpty");
      appendOutline(outline, elements.outlineList);
    } catch {
      if (token !== sequence || pdf !== ownerPdf) return;
      outline = [];
      elements.outlineStatus.textContent = t("outlineFailed");
      elements.outlineRetry.hidden = false;
    } finally {
      if (outlineRequest?.request === request) outlineRequest = null;
    }
  }

  function setDocument(nextPdf) {
    sequence += 1;
    stopThumbnails();
    pdf = nextPdf;
    batch = 0;
    outline = [];
    elements.panel.hidden = true;
    elements.outlineList.replaceChildren();
    elements.thumbnails.replaceChildren();
    if (pdf) void loadOutline();
    update();
  }

  function show(value) {
    elements.panel.hidden = !value;
    if (value && pdf) {
      if (tab === "thumbnails") renderBatch();
      else if (!outline.length && !elements.outlineList.childNodes.length) void loadOutline();
    } else stopThumbnails();
    update();
  }

  elements.toggle.addEventListener("click", () => show(!visible()));
  elements.close.addEventListener("click", () => { show(false); elements.toggle.focus({ preventScroll: true }); });
  elements.outlineTab.addEventListener("click", () => { tab = "outline"; stopThumbnails(); update(); });
  elements.thumbnailsTab.addEventListener("click", () => { tab = "thumbnails"; renderBatch(); });
  elements.previous.addEventListener("click", () => { batch = Math.max(0, batch - 1); renderBatch(); });
  elements.next.addEventListener("click", () => { if (pdf) batch = Math.min(Math.ceil(pdf.numPages / BATCH) - 1, batch + 1); renderBatch(); });
  elements.outlineRetry.addEventListener("click", loadOutline);

  return { setDocument, update, close: () => show(false) };
}
