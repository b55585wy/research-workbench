import { missingPaperCitation, parsePaperPages } from "./presentation-paper.js";

const FORMAT = "research-agent-presentation-plan/v1";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const validUUID = (value) => typeof value === "string" && UUID.test(value);
const validHash = (value) => typeof value === "string" && SHA.test(value);
const PLAN_FIELDS = ["id", "format", "document_id", "file_sha256", "source_sha256", "title", "style", "page_count", "page_range", "text_chars", "empty_page_range"];
export const PRESENTATION_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const boundedText = (value, limit, required = false) => typeof value === "string" && [...value].length <= limit && (!required || Boolean(value.trim())) && !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value);

function compactPages(pages) {
  const ranges = [];
  for (let i = 0; i < pages.length; i += 1) {
    const start = pages[i];
    while (i + 1 < pages.length && pages[i + 1] === pages[i] + 1) i += 1;
    ranges.push(start === pages[i] ? String(start) : `${start}-${pages[i]}`);
  }
  return ranges.join(",");
}

function planPages(value, pageCount, allowEmpty = false) {
  if (allowEmpty && value === "") return [];
  if (typeof value !== "string" || !value) return null;
  const parsed = parsePaperPages(value, pageCount);
  return parsed.valid && parsed.pages && compactPages(parsed.pages) === value ? parsed.pages : null;
}

export function ordinaryPresentationPaper(paper) {
  return Boolean(paper && validUUID(paper.id) && paper.kind !== "study" && paper.kind !== "personal" &&
    (!paper.kind || ["paper", "pdf"].includes(paper.kind)) && validHash(paper.sha256) &&
    Number.isInteger(paper.page_count) && paper.page_count >= 1 && paper.page_count <= 200 &&
    !paper.deleted_at && !paper.trashed_at && !paper.purged);
}

export function presentationActionsEnabled(provider, paper, continueTask, installed = true) {
  return installed === true && provider?.agent_presentations === true && !continueTask && ordinaryPresentationPaper(paper);
}

export function negotiatePresentationActions(payload, provider, paper, installed) {
  if (presentationActionsEnabled(provider, paper, payload.continue_task, installed)) payload.context.presentation_actions = true;
  return payload;
}

export function validatePresentationPlan(value, documentId) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== PLAN_FIELDS.length ||
    !PLAN_FIELDS.every((key) => Object.hasOwn(value, key)) || value.format !== FORMAT || !validUUID(value.id) ||
    !validUUID(value.document_id) || value.document_id !== documentId || !validHash(value.file_sha256) || !validHash(value.source_sha256) ||
    !boundedText(value.title, 120, true) || /[\r\n\t]/.test(value.title) || !["default", "nature", "cell"].includes(value.style) ||
    !Number.isInteger(value.page_count) || value.page_count < 1 || value.page_count > 200 ||
    !Number.isInteger(value.text_chars) || value.text_chars < 1 || value.text_chars > 120000 ||
    JSON.stringify(value).length > 2000) return null;
  const pages = planPages(value.page_range, value.page_count);
  const empty = planPages(value.empty_page_range, value.page_count, true);
  if (!pages || !empty || empty.some((page) => !pages.includes(page)) || empty.length === pages.length) return null;
  return Object.freeze(clone(value));
}

function assertSource(body, plan) {
  const source = body?.sources?.[0];
  if (body?.source_sha256 !== plan.source_sha256 || !Array.isArray(body.sources) || body.sources.length !== 1 ||
    source?.kind !== "paper" || source.id !== plan.document_id || source.ref !== `paper:${plan.document_id}` ||
    source.file_sha256 !== plan.file_sha256 || !same(source.pages, planPages(plan.page_range, plan.page_count)) ||
    !same(source.empty_pages, planPages(plan.empty_page_range, plan.page_count, true)) || source.text_chars !== plan.text_chars) {
    throw Object.assign(new Error("source_changed"), { code: "source_changed" });
  }
}

export function validPresentationOutline(outline, plan) {
  const ref = `paper:${plan.document_id}`;
  if (!outline || Object.keys(outline).some((key) => !["title", "slides"].includes(key)) || !boundedText(outline.title, 120, true) ||
    !Array.isArray(outline.slides) || outline.slides.length < 1 || outline.slides.length > 8 ||
    missingPaperCitation(outline, [{ kind: "paper", ref }])) return false;
  return outline.slides.every((slide) => slide && Object.keys(slide).every((key) => ["title", "body", "source_refs", "chart_id"].includes(key)) &&
    boundedText(slide.title, 100, true) && Array.isArray(slide.body) && slide.body.length <= 5 && slide.body.every((line) => boundedText(line, 400)) &&
    Array.isArray(slide.source_refs) && slide.source_refs.length <= 1 && slide.source_refs.every((item) => item === ref) && slide.chart_id === null);
}

function selectors(plan) {
  return { title: plan.title, style: plan.style, include_paper: true, paper_pages: planPages(plan.page_range, plan.page_count),
    note_ids: [], chart_ids: [], analysis_ids: [] };
}

function failureCode(error) {
  const code = error?.code || error?.message;
  if (["source_changed", "presentation_changed", "presentation_source_changed"].includes(code)) return "source_changed";
  if (["not_found", "file_missing", "document_trashed", "document_purged", "paper_required"].includes(code)) return "source_unavailable";
  return "request_failed";
}

// One controller survives view replacement. Only its explicit methods can dispatch.
export function createAssistantPresentationController({ plan: input, documentId, api, exportFetch, isCurrent, sourceCurrent = () => true, download }) {
  const plan = validatePresentationPlan(input, documentId);
  if (!plan) throw new TypeError("Invalid presentation plan");
  let state = Object.freeze({ plan, phase: "prepared", outline: null, error: null, expanded: false });
  let disposed = false;
  let operation = null;
  const listeners = new Set();
  function publish(patch) {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener(state);
  }
  function live(op) { return !disposed && operation === op; }
  function endpoint(action) { return `/api/v1/documents/${plan.document_id}/paper-presentations/${action}`; }
  function post(action, body, signal) {
    return api(endpoint(action), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  }
  async function generate() {
    if (disposed || operation || state.outline || !isCurrent()) return false;
    if (!sourceCurrent()) { publish({ phase: "error", error: "source_changed" }); return false; }
    const op = { controller: new AbortController(), paid: false };
    operation = op;
    publish({ phase: "checking", error: null });
    try {
      if (!live(op) || !isCurrent()) return false;
      const context = await post("context", selectors(plan), op.controller.signal);
      if (!live(op)) return false;
      assertSource(context, plan);
      if (!isCurrent()) { publish({ phase: "prepared", error: "owner_changed" }); return false; }
      if (!sourceCurrent()) throw Object.assign(new Error("source_changed"), { code: "source_changed" });
      publish({ phase: "generating" });
      // A synchronous subscription can change ownership too; check at dispatch.
      if (!live(op) || !isCurrent()) return false;
      if (!sourceCurrent()) throw Object.assign(new Error("source_changed"), { code: "source_changed" });
      op.paid = true;
      const body = await post("outline", { ...selectors(plan), source_sha256: plan.source_sha256, confirmed: true, request_id: plan.id }, op.controller.signal);
      if (!live(op)) return false;
      assertSource(body, plan);
      if (body.ai_generated !== true || !validPresentationOutline(body.outline, plan)) throw new Error("invalid_response");
      const outline = clone(body.outline);
      for (const slide of outline.slides) { Object.freeze(slide.body); Object.freeze(slide.source_refs); Object.freeze(slide); }
      Object.freeze(outline.slides); Object.freeze(outline);
      publish({ phase: "ready", outline, error: null });
      return true;
    } catch (error) {
      if (live(op)) publish({ phase: "error", error: failureCode(error) });
      return false;
    } finally {
      if (live(op)) {
        operation = null;
        if (["checking", "generating"].includes(state.phase)) publish({ phase: "prepared", error: "owner_changed" });
      }
    }
  }
  async function exportPresentation() {
    if (disposed || operation || !state.outline || !isCurrent()) return false;
    if (!sourceCurrent()) { publish({ error: "source_changed" }); return false; }
    const op = { controller: new AbortController(), paid: false };
    operation = op;
    publish({ phase: "exporting", error: null });
    try {
      if (!live(op) || !isCurrent()) return false;
      const response = await exportFetch(endpoint("export"), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selectors(plan), source_sha256: plan.source_sha256, outline: state.outline }), signal: op.controller.signal });
      if (!live(op) || !isCurrent()) return false;
      if (!response?.ok) {
        const body = await response?.json().catch(() => null);
        throw Object.assign(new Error("export_failed"), { code: body?.detail?.code });
      }
      const mime = String(response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
      const length = Number(response.headers.get("Content-Length"));
      if (mime !== PRESENTATION_MIME || length > MAX_EXPORT_BYTES) throw new Error("invalid_response");
      const blob = await response.blob();
      if (!live(op) || !isCurrent()) return false;
      if (blob.type.split(";", 1)[0].trim().toLowerCase() !== PRESENTATION_MIME || !blob.size || blob.size > MAX_EXPORT_BYTES) throw new Error("invalid_response");
      // A PPTX is a ZIP package. Refuse mislabeled JSON/HTML before creating a download.
      const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (!live(op) || !isCurrent()) return false;
      if (!sourceCurrent()) throw Object.assign(new Error("source_changed"), { code: "source_changed" });
      if (!same([...signature], [80, 75, 3, 4])) throw new Error("invalid_response");
      download(blob, `${plan.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().slice(0, 80) || "presentation"}.pptx`);
      publish({ phase: "downloaded", error: null });
      return true;
    } catch (error) {
      if (live(op)) publish({ phase: "ready", error: failureCode(error) });
      return false;
    } finally {
      if (live(op)) {
        operation = null;
        if (state.phase === "exporting") publish({ phase: "ready", error: "owner_changed" });
      }
    }
  }
  return {
    get state() { return state; },
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    generate, download: exportPresentation,
    setExpanded(expanded) { publish({ expanded: Boolean(expanded) }); },
    deactivate() {
      if (!operation || operation.paid) return;
      operation.controller.abort(); operation = null;
      publish({ phase: state.outline ? "ready" : "prepared", error: "owner_changed" });
    },
    destroy() {
      disposed = true; operation?.controller.abort(); operation = null; listeners.clear();
    }
  };
}

export function createAssistantPresentationsBridge({ api, getOwner, exportFetch, loadView, download, document: dom = globalThis.document }) {
  const records = new Map();
  const mounts = new Set();
  const resources = new Map();
  let destroyed = false;
  let installed = false;
  let loading = null;
  let viewModule = null;
  let activeScope = null;
  const loadModule = loadView || (() => import(new URL("./vendor/workspace-shell/workspace-shell.js", import.meta.url).href));
  const fetchExport = exportFetch || ((url, options) => fetch(url, { ...options, credentials: "same-origin", redirect: "error" }));
  function scope(owner) { return owner ? `${owner.document?.id}:${owner.conversationId || ""}:${owner.navigationGeneration ?? ""}` : null; }
  function ownerCurrent(owner) {
    const current = getOwner();
    return !destroyed && scope(current) === scope(owner) && ordinaryPresentationPaper(current?.document);
  }
  function downloadBlob(blob, filename) {
    if (download) { download(blob, filename); return; }
    const url = URL.createObjectURL(blob);
    const link = dom.createElement("a");
    link.href = url; link.download = filename; link.hidden = true;
    try { dom.body.append(link); link.click(); }
    finally {
      link.remove();
      resources.set(url, setTimeout(() => { URL.revokeObjectURL(url); resources.delete(url); }, 1000));
    }
  }
  function unmountViews(matches = () => true) {
    for (const mount of mounts) {
      if (!matches(mount.record)) continue;
      mount.active = false; mount.handle?.destroy(); mounts.delete(mount);
    }
  }
  function reset() {
    unmountViews();
    for (const record of records.values()) record.controller.destroy();
    records.clear();
    for (const [url, timer] of resources) { clearTimeout(timer); URL.revokeObjectURL(url); }
    resources.clear();
  }
  function contextChanged() {
    const next = scope(getOwner());
    if (activeScope !== next) for (const record of records.values()) record.controller.deactivate();
    activeScope = next;
  }
  function attach(mount) {
    if (!mount.active || destroyed || !viewModule) return;
    try {
      mount.handle = viewModule.mountAssistantPresentation({ container: mount.container, controller: mount.record.controller, language: mount.language });
    } catch {
      mount.container.textContent = mount.language === "en" ? "PPT actions are unavailable." : "PPT 操作暂不可用。";
    }
  }
  return {
    load() {
      if (destroyed) return Promise.resolve(false);
      if (loading) return loading;
      loading = Promise.resolve().then(loadModule).then((module) => {
        if (destroyed || typeof module.mountAssistantPresentation !== "function") return false;
        viewModule = module; installed = true;
        for (const mount of mounts) attach(mount);
        return true;
      }).catch(() => false);
      return loading;
    },
    get installed() { return installed; },
    contextChanged, unmountViews,
    mountTurn(container, turn, language) {
      contextChanged();
      const owner = getOwner();
      if (destroyed || !ordinaryPresentationPaper(owner?.document) || turn.document_id !== owner.document.id ||
        turn.conversation_id !== owner.conversationId || !validUUID(turn.id) || !Array.isArray(turn.presentation_plans)) return;
      const seen = new Set();
      for (const raw of turn.presentation_plans) {
        const plan = validatePresentationPlan(raw, owner.document.id);
        if (!plan || seen.has(plan.id)) continue;
        seen.add(plan.id);
        const key = `${plan.document_id}:${turn.conversation_id}:${turn.id}:${plan.id}`;
        let record = records.get(key);
        if (record && !same(record.plan, plan)) continue;
        if (!record) {
          record = { plan, owner, controller: null };
          const held = record;
          record.controller = createAssistantPresentationController({ plan, documentId: owner.document.id, api, exportFetch: fetchExport,
            isCurrent: () => ownerCurrent(held.owner),
            sourceCurrent: () => getOwner()?.document?.sha256 === plan.file_sha256 && getOwner()?.document?.page_count === plan.page_count,
            download: downloadBlob });
          records.set(key, record);
        }
        record.owner = owner;
        const host = dom.createElement("div");
        host.className = "assistant-presentation-host";
        host.dataset.planId = plan.id;
        container.append(host);
        const mount = { container: host, record, language, active: true, handle: null };
        mounts.add(mount); attach(mount);
      }
    },
    clearConversation(documentId, conversationId) {
      unmountViews((record) => record.plan.document_id === documentId && record.owner.conversationId === conversationId);
      for (const [key, record] of records) {
        if (record.plan.document_id !== documentId || record.owner.conversationId !== conversationId) continue;
        record.controller.destroy(); records.delete(key);
      }
      for (const [url, timer] of resources) { clearTimeout(timer); URL.revokeObjectURL(url); }
      resources.clear();
    },
    reset,
    destroy() { destroyed = true; installed = false; reset(); }
  };
}
