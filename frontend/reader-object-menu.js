const REGION_CACHE_LIMIT = 64;
const MIN_IMAGE_SIDE = 0.005;
const MIN_IMAGE_AREA = 0.0001;
const MAX_IMAGE_AREA = 0.95;

function normalizedRect(values) {
  if (!Array.isArray(values) || values.length !== 4 || !values.every(Number.isFinite)) return null;
  const left = Math.max(0, Math.min(1, values[0]));
  const top = Math.max(0, Math.min(1, values[1]));
  const right = Math.max(0, Math.min(1, values[2]));
  const bottom = Math.max(0, Math.min(1, values[3]));
  return right > left && bottom > top ? [left, top, right, bottom] : null;
}

function imageObjects(record) {
  const coordinates = record.page?.imageCoordinates;
  if (!coordinates || coordinates.length % 6 !== 0) return [];
  const objects = [];
  for (let index = 0; index < coordinates.length; index += 6) {
    const values = Array.from(coordinates.slice(index, index + 6));
    if (!values.every(Number.isFinite)) continue;
    const [x1, y1, x2, y2, x3, y3] = values;
    const xs = [x1, x2, x3, x2 + x3 - x1];
    const ys = [y1, y2, y3, y2 + y3 - y1];
    const rect = normalizedRect([
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys)
    ]);
    if (!rect) continue;
    const width = rect[2] - rect[0];
    const height = rect[3] - rect[1];
    const area = width * height;
    if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE || area < MIN_IMAGE_AREA || area > MAX_IMAGE_AREA) continue;
    objects.push({ id: `image-${index / 6 + 1}`, kind: "image", rect, area });
  }
  return objects;
}

function tableObjects(body, context) {
  if (body?.document_id !== context.documentId || body.page !== context.page || body.source_sha256 !== context.sourceSha || body.coordinate_space !== "display-normalized" || !Array.isArray(body.items)) {
    throw new Error("invalid regions response");
  }
  const objects = [];
  for (const item of body.items) {
    if (item?.kind !== "table" || typeof item.id !== "string") continue;
    const rect = normalizedRect(item.rect);
    if (!rect) continue;
    objects.push({ id: item.id, kind: "table", rect, area: (rect[2] - rect[0]) * (rect[3] - rect[1]) });
  }
  return objects;
}

function hitTest(objects, x, y) {
  return objects
    .filter((object) => x >= object.rect[0] && x <= object.rect[2] && y >= object.rect[1] && y <= object.rect[3])
    .sort((left, right) => left.area - right.area)[0] || null;
}

export function createReaderObjectMenu({
  stage,
  api,
  t,
  getDocument,
  getRecord,
  getRenderSequence,
  onAction,
  onManualCapture
}) {
  const menu = document.createElement("div");
  menu.className = "reader-object-menu";
  menu.setAttribute("role", "menu");
  menu.tabIndex = -1;
  menu.hidden = true;
  document.body.append(menu);

  const cache = new Map();
  const pending = new Map();
  let current = null;
  let openSequence = 0;
  let returnFocus = null;

  function isCurrent(context) {
    const owner = getDocument();
    return Boolean(
      owner?.id === context.documentId &&
      owner.sha256 === context.sourceSha &&
      getRecord(context.page) === context.record &&
      getRenderSequence() === context.renderSequence &&
      context.record.rendered &&
      context.record.sequence === context.renderSequence
    );
  }

  function close(restoreFocus = false) {
    openSequence += 1;
    current?.controller.abort();
    current = null;
    menu.hidden = true;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function reset() {
    close();
    for (const entry of pending.values()) entry.controller.abort();
    pending.clear();
    cache.clear();
  }

  function cacheTables(key, items) {
    cache.delete(key);
    cache.set(key, items);
    while (cache.size > REGION_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }

  async function loadTables(context) {
    const key = `${context.documentId}:${context.sourceSha}:${context.page}`;
    if (cache.has(key)) {
      const items = cache.get(key);
      cache.delete(key);
      cache.set(key, items);
      return items;
    }
    let entry = pending.get(key);
    if (entry?.controller.signal.aborted) {
      pending.delete(key);
      entry = null;
    }
    if (!entry) {
      const controller = context.controller;
      const promise = api(`/api/v1/documents/${encodeURIComponent(context.documentId)}/pages/${context.page}/regions`, { signal: controller.signal })
        .then((body) => {
          const items = tableObjects(body, context);
          cacheTables(key, items);
          return items;
        })
        .finally(() => {
          if (pending.get(key)?.promise === promise) pending.delete(key);
        });
      entry = { controller, promise };
      pending.set(key, entry);
    }
    return entry.promise;
  }

  function positionMenu(x, y) {
    menu.style.left = "0px";
    menu.style.top = "0px";
    const bounds = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, x));
    const top = Math.max(8, Math.min(window.innerHeight - bounds.height - 8, y));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function appendAction(labelKey, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-quiet";
    button.setAttribute("role", "menuitem");
    button.textContent = t(labelKey);
    button.addEventListener("click", () => {
      const context = current;
      close();
      if (!context || !isCurrent(context)) return;
      if (action === "manual") onManualCapture();
      else void onAction(context.record, context.object, action);
    });
    menu.append(button);
  }

  function renderMenu(context, { loading = false, error = null } = {}) {
    menu.setAttribute("aria-label", t("objectActions"));
    menu.replaceChildren();
    if (loading || error || !context.object) {
      const status = document.createElement("p");
      status.className = "reader-object-menu-status";
      status.setAttribute("role", "status");
      if (error) status.dataset.kind = "error";
      status.textContent = t(loading ? "objectLoading" : error || "objectNone");
      menu.append(status);
    }
    if (context.object && !loading && !error) {
      appendAction("captureAddAgent", "agent");
      appendAction("captureAddNote", "note");
      appendAction("objectCopy", "copy");
    } else if (!loading) {
      appendAction("objectManualCapture", "manual");
    }
    menu.hidden = false;
    positionMenu(context.x, context.y);
    const focusTarget = menu.querySelector("[role='menuitem']") || menu;
    focusTarget.focus({ preventScroll: true });
  }

  async function open(event) {
    const surface = event.target.closest(".page-surface");
    if (!surface || !stage.contains(surface) || event.target.closest("a") || event.target.closest(".region-overlay")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && stage.contains(selection.anchorNode)) return;
    const page = Number(surface.dataset.readerPage);
    const record = getRecord(page);
    const owner = getDocument();
    const renderSequence = getRenderSequence();
    if (!owner?.sha256 || !record || record.surface !== surface || !record.rendered || record.sequence !== renderSequence || record.canvas.dataset.documentId !== owner.id) return;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    const imageHit = hitTest(imageObjects(record), x, y);
    if (!imageHit && event.target.closest(".textLayerImagePlaceholder")) return;

    event.preventDefault();
    close();
    const sequence = openSequence;
    returnFocus = document.activeElement;
    const context = {
      documentId: owner.id,
      sourceSha: owner.sha256,
      page,
      record,
      renderSequence,
      controller: new AbortController(),
      object: imageHit,
      x: event.clientX,
      y: event.clientY
    };
    current = context;
    renderMenu(context, { loading: !context.object });
    if (context.object) return;

    try {
      const tables = await loadTables(context);
      if (current !== context || sequence !== openSequence) return;
      if (!isCurrent(context)) {
        close();
        return;
      }
      context.object = hitTest(tables, x, y);
      renderMenu(context);
    } catch (error) {
      if (error?.name === "AbortError" || current !== context || sequence !== openSequence) return;
      if (!isCurrent(context)) {
        close();
        return;
      }
      const key = ["regions_busy", "regions_timeout", "regions_unavailable", "regions_failed"].includes(error?.code) ? error.code : "objectReadFailed";
      renderMenu(context, { error: key });
    }
  }

  stage.addEventListener("contextmenu", open);
  stage.addEventListener("scroll", () => close());
  window.addEventListener("resize", () => close());
  document.addEventListener("pointerdown", (event) => {
    if (current && !menu.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (!current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const items = [...menu.querySelectorAll("[role='menuitem']")];
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1 + items.length) % items.length : (index - 1 + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  });

  return { close, reset };
}
