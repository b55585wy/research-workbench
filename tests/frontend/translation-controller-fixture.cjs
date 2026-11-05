const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { randomUUID } = require("node:crypto");

// Execute the production controller bodies and hooks without JSX, a browser, or
// an installed compiler. DOM/layout acceptance remains with the integration owner.
function functionSource(source, name) {
  const match = new RegExp(`^(?:export )?(?:async )?function ${name}\\b`, "m").exec(source);
  if (!match) throw new Error(`Missing production function: ${name}`);
  return source.slice(match.index, source.indexOf("\n}", match.index) + 2).replace(/^export /, "");
}

function controller(file, name, boundary, helpers, exposed, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../../web/src", file), "utf8").replace(/\r\n/g, "\n");
  const stringsStart = source.indexOf("const strings = {");
  const strings = source.slice(stringsStart, source.indexOf("} as const;", stringsStart) + 11);
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(boundary, start);
  if (end < start) throw new Error(`Missing controller boundary: ${name}`);
  const body = source.slice(start, end);
  let cursor = 0;
  const slots = [];
  const queued = [];
  const equal = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const state = { dirty: true, value: null };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (update) => {
        const next = typeof update === "function" ? update(slots[index].value) : update;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; state.dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (slots[index] && equal(slots[index].deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps };
      queued.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    }
  };
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    ...hooks, ...globals, AbortController, CustomEvent, crypto: { randomUUID },
    requestAnimationFrame: (callback) => callback(),
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id)
  });
  const program = `${strings}\nconst activeStatuses = new Set(["queued", "running"]);\n${helpers.map((helper) => functionSource(source, helper)).join("\n")}\n${body}\nreturn { ${exposed} };\n}\nglobalThis.component = ${name};`;
  vm.runInContext(stripTypeScriptTypes(program), context, { filename: file });
  state.render = (props) => {
    cursor = 0;
    state.dirty = false;
    state.value = context.component(props);
    for (const effect of queued.splice(0)) effect();
  };
  state.dispose = () => slots.forEach((slot) => slot?.cleanup?.());
  state.tick = async () => {
    const pending = [...timers.values()];
    timers.clear();
    await Promise.all(pending.map((callback) => callback()));
  };
  state.context = context;
  return state;
}

const document = { id: "paper-1", sha256: "sha-1", pageCount: 10 };
const block = (page) => ({ id: `block-${page}`, kind: "text", order: 0, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 }, source_text: `Original ${page}`, translated_text: `Translated ${page}` });
const result = (page) => ({ page, status: "completed", warning: null, blocks: [block(page)], job_id: `job-${page}` });
function run(overrides = {}) {
  return {
    id: "run-1", document_id: document.id, source_sha256: document.sha256,
    pages: Array.from({ length: 10 }, (_, index) => index + 1), target_language: "en",
    status: "completed", stage: "finished", revision: 1, total_pages: 10,
    processed_pages: 10, completed_pages: 10, reused_pages: 0, active_job_id: null,
    created_at: "2026-11-05", updated_at: "2026-11-05", error: null,
    parser: { id: "parser", version: "1" }, model: { name: "fixture" },
    model_fingerprint: "model-1", prompt_version: "prompt-1", result_schema_version: 1,
    result_pages: Array.from({ length: 10 }, (_, index) => result(index + 1)), ...overrides
  };
}
function job(overrides = {}) {
  return {
    id: "old-job", document_id: document.id, source_sha256: document.sha256,
    pages: [1], target_language: "en", status: "completed", stage: "finished",
    completed_pages: 1, total_pages: 1, created_at: "2025-01-01", updated_at: "2025-01-01", error: null,
    result_pages: [{ ...result(1), job_id: undefined }], ...overrides
  };
}

function fixture({ runs = [], jobs = [], api: customApi, model = {}, excerpt = () => true, ready = true, runSupport = true } = {}) {
  const requests = [], snapshots = [], excerpts = [], sources = [];
  const controlsContainer = new EventTarget();
  controlsContainer.addEventListener("translation-presentation-change", (event) => snapshots.push(event.detail));
  let opener;
  const props = {
    model: { language: "en", open: true, reading: true, document, currentPage: 1, ...model },
    controlsContainer, panelContainer: { id: "translation-panel", querySelector: () => ({ focus() {} }) },
    registerOpener: (value) => { opener = value; }
  };
  async function api(url, options = {}) {
    requests.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    const custom = customApi?.(url, options, requests);
    if (custom !== undefined) return custom;
    if (url.includes("translation-capabilities")) return { ready, model_ready: ready, run_support: runSupport, max_pages: 5 };
    if (url.includes("/translation-runs?")) return { items: runs.map((item) => ({ ...item, result_pages: [] })) };
    if (url.includes("/translations?")) return { items: jobs };
    if (url.includes("/translation-runs/")) {
      const id = url.split("/translation-runs/")[1].split("?")[0];
      const item = runs.find((value) => value.id === id);
      if (!item) throw new Error(`Unknown fixture run: ${url}`);
      const page = Number(new URL(url, "http://fixture.invalid").searchParams.get("page"));
      return { ...item, result_pages: item.result_pages.filter((value) => value.page === page) };
    }
    if (url.includes("/translations/")) return jobs.find((item) => url.endsWith(`/${item.id}`));
    throw new Error(`Unexpected request: ${url}`);
  }
  props.callbacks = {
    api, onOpenChange: (open) => { props.model = { ...props.model, open }; parent.dirty = true; },
    onOpenSettings() {}, goToSource: (...args) => sources.push(args),
    onExcerpt: (action, value) => { excerpts.push({ action, value }); return excerpt(action, value); }
  };
  const runHelpers = ["errorCode", "isAbort", "failed", "runInScope", "validRunDetail", "formatRunPages", "parsePages", "upsertRun", "preferredPage"];
  const child = controller("translation-runs.tsx", "TranslationRunPanel", "  return (\n    <div className=\"translation-run-view\">", runHelpers,
    "selectedRun, selectedRunId, selectedPage, runs, targetLanguage, copy, requestDraft, confirmation, pendingAction, operationError, detailError, startCurrentPage, reviewCreate, confirmOperation, pauseSelected, reviewResume, selectRun, selectPage, selectTargetLanguage, refreshHistory, submitDraft, setSelectionMode, setPageInput, setDetailRetry");
  const parent = controller("translation.tsx", "TranslationExperience", "  const controls = (", ["isActive", "formatPages", "parsePages", "errorCode", "isAbort", "jobInScope", "jobResults", "frozenCompletedPages", "upsertJob"],
    "mode, copy, visibleJob, visibleSourceJobId, currentPageCompleted, overlayNotice, selectedRun, externalRun, runView, targetLanguage, requestDraft, pendingAction, operationError, changeMode, openSaved, openExternalRecord, handleRunSelection, source, excerpt, setTargetLanguage",
    { runInScope: child.context.runInScope });
  let childMounted = false;
  async function settle() {
    for (let turn = 0; turn < 30; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      const parentRendered = parent.dirty;
      if (parentRendered) parent.render(props);
      const shouldMount = props.model.document && props.model.reading && parent.value?.runView;
      if (!shouldMount) {
        if (childMounted) child.dispose();
        childMounted = false;
        continue;
      }
      if (parentRendered || child.dirty || !childMounted) {
        childMounted = true;
        child.render({
          document: props.model.document, currentPage: props.model.currentPage, language: props.model.language,
          targetLanguage: parent.value.targetLanguage, onTargetLanguageChange: parent.value.setTargetLanguage,
          capabilities: { ready, model_ready: ready, run_support: runSupport }, api,
          onOpenSettings() {}, onSelectionChange: parent.value.handleRunSelection, externalRun: parent.value.externalRun
        });
      }
    }
  }
  return {
    parent, child, requests, snapshots, excerpts, sources, settle,
    posts: () => requests.filter((item) => item.method === "POST"),
    snapshot: () => snapshots.at(-1),
    openRecord: (request) => opener(request),
    update: (model) => { props.model = { ...props.model, ...model }; parent.dirty = true; },
    dispose: () => { parent.dispose(); if (childMounted) child.dispose(); }
  };
}

module.exports = { fixture, run, job, result, block, document };
