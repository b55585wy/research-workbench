const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { stripTypeScriptTypes } = require("node:module");
const { Element } = require("./assistant-fixture.cjs");

// Contract doubles only. The coordinator owns the real backend/browser pipeline.
const root = path.resolve(__dirname, "../..");
const modulePromise = import(pathToFileURL(path.join(root, "frontend/assistant-presentations.js")));
const documentId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const turnId = "33333333-3333-4333-8333-333333333333";
const planId = "44444444-4444-4444-8444-444444444444";
const sha = "a".repeat(64), digest = "b".repeat(64);
const paper = { id: documentId, kind: "paper", sha256: sha, page_count: 20 };
const plan = { id: planId, format: "research-agent-presentation-plan/v1", document_id: documentId, file_sha256: sha,
  source_sha256: digest, title: "Paper presentation", style: "nature", page_count: 20, page_range: "1-3,5", text_chars: 5000, empty_page_range: "5" };
const source = { kind: "paper", id: documentId, ref: `paper:${documentId}`, title: "Paper", file_sha256: sha,
  pages: [1, 2, 3, 5], text_chars: 5000, empty_pages: [5] };
const outline = { title: plan.title, slides: [{ title: "Results", body: ["A source-linked finding"], source_refs: [source.ref], chart_id: null }] };
const context = () => structuredClone({ source_sha256: digest, sources: [source], text: "Only selected text", suggested_outline: outline });
const result = () => structuredClone({ source_sha256: digest, sources: [source], ai_generated: true, outline });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { await new Promise(setImmediate); };
const clone = (value) => structuredClone(value);
async function fixture(options = {}) {
  const { createAssistantPresentationController, PRESENTATION_MIME } = await modulePromise;
  const calls = [], exports = [], downloads = [];
  let current = true, sourceCurrent = true;
  const controller = createAssistantPresentationController({ plan, documentId,
    api: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return options.api ? options.api(url, init) : url.endsWith("/context") ? context() : result(); },
    exportFetch: async (url, init) => {
      exports.push({ url, init, body: JSON.parse(init.body) });
      return options.exportFetch ? options.exportFetch(url, init) : new Response(new Blob([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], { type: PRESENTATION_MIME }));
    }, isCurrent: () => current, sourceCurrent: () => sourceCurrent,
    download: (blob, filename) => downloads.push({ blob, filename }) });
  return { controller, calls, exports, downloads, setCurrent: (value) => { current = value; }, setSource: (value) => { sourceCurrent = value; } };
}

test("closed plan DTO: valid bounds, source owner and exact compact ranges", async () => {
  const { validatePresentationPlan } = await modulePromise;
  assert.deepEqual(validatePresentationPlan(plan, documentId), plan);
  assert.ok(Object.isFrozen(validatePresentationPlan(plan, documentId)));
  for (const patch of [
    { id: "bad" }, { id: [planId] }, { file_sha256: [sha] }, { source_sha256: [digest] },
    { document_id: conversationId }, { format: "v2" }, { file_sha256: "A".repeat(64) }, { source_sha256: "" },
    { title: " " }, { title: "x".repeat(121) }, { title: "new\nline" }, { style: "other" }, { page_count: 0 }, { page_count: 201 },
    { page_count: 1.5 }, { text_chars: 0 }, { text_chars: 120001 }, { page_range: "" }, { page_range: "2,1" },
    { page_range: "1,1" }, { page_range: "1,2,3" }, { page_range: "0" }, { page_range: "21" }, { page_range: "1-61", page_count: 200 },
    { empty_page_range: "4" }, { empty_page_range: "1-3,5" }, { empty_page_range: "5,5" }, { url: "https://example.org" },
    { page_range: [1, 2] }, { command: "generate" }, { secret: "hidden" }
  ]) assert.equal(validatePresentationPlan({ ...plan, ...patch }, documentId), null, JSON.stringify(patch));
  for (const value of [null, [], {}, "generate PPT", { ...plan, id: undefined }]) assert.equal(validatePresentationPlan(value, documentId), null);
  const maximal = { ...plan, title: "题".repeat(120), page_count: 200, page_range: "1-60", empty_page_range: "", text_chars: 120000 };
  assert.deepEqual(validatePresentationPlan(maximal, documentId), maximal);
  const disjoint = Array.from({ length: 60 }, (_, index) => index * 2 + 1).join(",");
  assert.ok(validatePresentationPlan({ ...maximal, page_range: disjoint }, documentId));
});

test("negotiation is additive only for advertised, installed ordinary PDF chat; legacy JSON stays byte-identical", async () => {
  const { negotiatePresentationActions } = await modulePromise;
  const payload = { request_id: turnId, conversation_id: null, message: "Help", context: { page: 1, rect: null, language: "en" } };
  const baseline = JSON.stringify(payload);
  for (const provider of [{}, { agent_presentations: false }, { agent_presentations: "true" }]) {
    assert.equal(JSON.stringify(negotiatePresentationActions(clone(payload), provider, paper, true)), baseline);
  }
  for (const invalidPaper of [null, { ...paper, kind: "study" }, { ...paper, kind: "personal" }, { ...paper, sha256: "" }, { ...paper, deleted_at: "today" }]) {
    assert.equal(JSON.stringify(negotiatePresentationActions(clone(payload), { agent_presentations: true }, invalidPaper, true)), baseline);
  }
  assert.equal(JSON.stringify(negotiatePresentationActions(clone(payload), { agent_presentations: true }, paper, false)), baseline);
  const task = { ...clone(payload), continue_task: true };
  assert.equal(JSON.stringify(negotiatePresentationActions(clone(task), { agent_presentations: true }, paper, true)), JSON.stringify(task));
  assert.deepEqual(negotiatePresentationActions(clone(payload), { agent_presentations: true }, paper, true), {
    ...payload, context: { ...payload.context, presentation_actions: true }
  });
});

test("explicit click alone dispatches context then outline with exact selection and stable receipt", async () => {
  const f = await fixture(); const states = [];
  const unsubscribe = f.controller.subscribe((state) => states.push(state.phase));
  f.controller.setExpanded(true); await settle(); assert.equal(f.calls.length, 0);
  assert.equal(await f.controller.generate(), true);
  assert.deepEqual(states, ["prepared", "checking", "generating", "ready"]);
  const selected = { title: plan.title, style: "nature", include_paper: true, paper_pages: [1, 2, 3, 5], note_ids: [], chart_ids: [], analysis_ids: [] };
  assert.deepEqual(f.calls.map((call) => call.url), ["context", "outline"].map((action) => `/api/v1/documents/${documentId}/paper-presentations/${action}`));
  assert.deepEqual(f.calls[0].body, selected);
  assert.deepEqual(f.calls[1].body, { ...selected, source_sha256: digest, confirmed: true, request_id: planId });
  assert.deepEqual(f.controller.state.outline, outline);
  assert.ok(Object.isFrozen(f.controller.state.outline.slides[0].body));
  await f.controller.generate(); assert.equal(f.calls.length, 2);
  unsubscribe(); f.controller.destroy();
});

test("duplicate clicks dedupe both preflight and paid work; uncertain error retries use the same receipt", async () => {
  const gate = deferred(); let attempts = 0;
  const f = await fixture({ api: async (url) => {
    if (url.endsWith("/context")) return context();
    attempts += 1; if (attempts === 1) return gate.promise;
    return result();
  } });
  const first = f.controller.generate(); await f.controller.generate(); await settle();
  await f.controller.generate(); assert.equal(f.calls.length, 2);
  gate.reject(new Error("Disconnected after dispatch")); await first;
  assert.equal(f.controller.state.phase, "error"); await settle(); assert.equal(f.calls.length, 2);
  assert.equal(await f.controller.generate(), true);
  assert.deepEqual(f.calls.filter((call) => call.url.endsWith("/outline")).map((call) => call.body.request_id), [planId, planId]);
});

test("preflight rejects stale digest, file, pages, empty pages, text size and cross-owner sources before paid work", async () => {
  const variants = [
    { ...context(), source_sha256: sha }, { ...context(), sources: [] },
    ...[{ file_sha256: digest }, { pages: [1, 2, 3] }, { pages: [1, 3, 2, 5] }, { empty_pages: [] }, { text_chars: 5001 },
      { id: conversationId }, { ref: `paper:${conversationId}` }, { kind: "note" }].map((patch) => ({ ...context(), sources: [{ ...source, ...patch }] }))
  ];
  for (const response of variants) {
    const f = await fixture({ api: async () => response });
    assert.equal(await f.controller.generate(), false); assert.equal(f.calls.length, 1);
    assert.equal(f.controller.state.error, "source_changed"); assert.equal(f.controller.state.outline, null);
  }
  const f = await fixture(); f.setSource(false);
  await f.controller.generate(); assert.equal(f.calls.length, 0); assert.equal(f.controller.state.error, "source_changed");
});

test("source/API/permission errors preserve the plan and never auto-retry", async () => {
  for (const code of ["not_found", "document_trashed", "file_missing", "forbidden", "network"]) {
    const f = await fixture({ api: async () => { throw { code }; } });
    await f.controller.generate(); await settle(); assert.equal(f.calls.length, 1);
    assert.deepEqual(f.controller.state.plan, plan); assert.equal(f.controller.state.phase, "error");
    assert.equal(f.exports.length, 0);
  }
});

test("outline response requires validated source, ai_generated, bounded plain slides and paper citations", async () => {
  for (const patch of [{ ai_generated: false }, { source_sha256: sha }, { outline: null },
    { outline: { ...outline, slides: [] } }, { outline: { ...outline, slides: Array(9).fill(outline.slides[0]) } },
    ...[{ source_refs: [] }, { source_refs: [`paper:${conversationId}`] }, { title: "" }, { title: "x".repeat(101) },
      { body: ["x".repeat(401)] }, { body: Array(6).fill("point") }, { chart_id: conversationId }, { url: "https://example.org" }]
      .map((slide) => ({ outline: { ...outline, slides: [{ ...outline.slides[0], ...slide }] } }))]) {
    const f = await fixture({ api: async (url) => url.endsWith("/context") ? context() : { ...result(), ...patch } });
    assert.equal(await f.controller.generate(), false, JSON.stringify(patch)); assert.equal(f.controller.state.outline, null);
  }
});

test("navigation before paid dispatch, including subscriber navigation, skips model work", async () => {
  for (const subscriber of [false, true]) {
    const gate = deferred(); const f = await fixture({ api: async () => gate.promise });
    if (subscriber) f.controller.subscribe((state) => { if (state.phase === "generating") { f.setCurrent(false); f.controller.deactivate(); } });
    const pending = f.controller.generate();
    if (!subscriber) f.setCurrent(false);
    gate.resolve(context()); assert.equal(await pending, false); assert.equal(f.calls.length, 1);
    assert.equal(f.controller.state.phase, "prepared");
  }
});

test("clear/navigation during a synchronous checking/exporting notification prevents any new request", async () => {
  for (const phase of ["checking", "exporting"]) {
    const f = await fixture();
    if (phase === "exporting") await f.controller.generate();
    f.controller.subscribe((state) => { if (state.phase === phase) f.controller.destroy(); });
    await (phase === "checking" ? f.controller.generate() : f.controller.download());
    assert.equal(f.calls.length, phase === "checking" ? 0 : 2); assert.equal(f.exports.length, 0);
  }
});

test("deactivation cancels delayed preflight across away-and-back; source change during preflight is refused", async () => {
  for (const change of ["navigation", "source"]) {
    const gate = deferred(); const f = await fixture({ api: async () => gate.promise });
    const pending = f.controller.generate();
    if (change === "navigation") { f.setCurrent(false); f.controller.deactivate(); f.setCurrent(true); }
    else f.setSource(false);
    gate.resolve(context()); await pending;
    assert.equal(f.calls.length, 1); assert.equal(f.controller.state.outline, null);
    if (change === "navigation") assert.equal(f.calls[0].init.signal.aborted, true);
  }
});

test("already dispatched work stays with its original controller; clear/destroy discards late results", async () => {
  for (const destroy of [false, true]) {
    const gate = deferred(); const f = await fixture({ api: async (url) => url.endsWith("/context") ? context() : gate.promise });
    const other = await fixture(); let notifications = 0;
    f.controller.subscribe(() => { notifications += 1; });
    const pending = f.controller.generate(); await settle();
    f.setCurrent(false); f.controller.deactivate(); if (destroy) f.controller.destroy();
    const before = notifications; gate.resolve(result()); await pending;
    assert.equal(other.controller.state.phase, "prepared"); assert.equal(other.calls.length, 0);
    assert.equal(f.controller.state.outline !== null, !destroy);
    if (destroy) assert.equal(notifications, before);
    else { f.setCurrent(true); assert.equal(await f.controller.generate(), false); assert.equal(f.calls.length, 2); }
  }
});

test("download is explicit, fixed private endpoint, validated bytes; export does not call a model", async () => {
  const f = await fixture(); await f.controller.generate();
  assert.equal(f.exports.length, 0); assert.equal(await f.controller.download(), true);
  assert.equal(f.exports[0].url, `/api/v1/documents/${documentId}/paper-presentations/export`);
  assert.deepEqual(f.exports[0].body, { ...f.calls[0].body, source_sha256: digest, outline });
  assert.equal(f.calls.length, 2); assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].filename, "Paper presentation.pptx");
  assert.equal(f.controller.state.phase, "downloaded");
});

test("export errors, invalid MIME, empty/oversized/mislabeled bytes retain the generated preview for explicit retry", async () => {
  const { PRESENTATION_MIME } = await modulePromise;
  const bad = [
    () => { throw { code: "forbidden" }; },
    () => new Response(JSON.stringify({ detail: { code: "source_changed" } }), { status: 409 }),
    () => new Response("no", { headers: { "Content-Type": "text/html" } }),
    () => new Response(new Blob([], { type: PRESENTATION_MIME })),
    () => new Response(new Blob(["not a PPTX"], { type: PRESENTATION_MIME })),
    () => new Response(new Blob(["PK"], { type: PRESENTATION_MIME }), { headers: { "Content-Length": String(21 * 1024 * 1024) } }),
    () => ({ ok: true, headers: new Headers({ "Content-Type": PRESENTATION_MIME }), blob: async () => ({ type: PRESENTATION_MIME, size: 21 * 1024 * 1024 }) })
  ];
  for (const exportFetch of bad) {
    const f = await fixture({ exportFetch }); await f.controller.generate(); f.controller.setExpanded(true);
    assert.equal(await f.controller.download(), false); assert.equal(f.downloads.length, 0);
    assert.equal(f.controller.state.phase, "ready"); assert.deepEqual(f.controller.state.outline, outline);
    assert.equal(f.controller.state.expanded, true); assert.ok(f.controller.state.error); assert.equal(f.calls.length, 2);
  }
  let fail = true;
  const f = await fixture({ exportFetch: () => fail ? Promise.reject(new Error("network")) : new Response(new Blob([new Uint8Array([80, 75, 3, 4])], { type: PRESENTATION_MIME })) });
  await f.controller.generate(); await f.controller.download(); fail = false; await f.controller.download();
  assert.equal(f.downloads.length, 1); assert.equal(f.calls.length, 2);
  const stale = await fixture({ exportFetch: async () => new Response(JSON.stringify({ detail: { code: "source_changed" } }), { status: 409 }) });
  await stale.controller.generate(); await stale.controller.download();
  assert.equal(stale.controller.state.error, "source_changed"); assert.deepEqual(stale.controller.state.outline, outline);
});

test("export dedupes and cannot download late bytes after navigation or disposal", async () => {
  const { PRESENTATION_MIME } = await modulePromise;
  for (const dispose of [false, true]) {
    const gate = deferred(); const f = await fixture({ exportFetch: () => gate.promise });
    await f.controller.generate(); const pending = f.controller.download(); await f.controller.download();
    f.setCurrent(false); if (dispose) f.controller.destroy(); else f.controller.deactivate();
    gate.resolve(new Response(new Blob([new Uint8Array([80, 75, 3, 4])], { type: PRESENTATION_MIME })));
    await pending; assert.equal(f.downloads.length, 0); assert.equal(f.exports.length, 1); assert.deepEqual(f.controller.state.outline, outline);
  }
});

function h(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter((value) => value !== null && value !== false && value !== undefined) }; }
function nodes(tree) { return !tree || typeof tree !== "object" ? [] : [tree, ...tree.children.flatMap(nodes)]; }
function content(tree) { return typeof tree === "string" || typeof tree === "number" ? String(tree) : tree.children.map(content).join(""); }
function viewModule(rootFactory = () => ({ render() {}, unmount() {} })) {
  const source = fs.readFileSync(path.join(root, "web/src/features/assistant-presentations/index.tsx"), "utf8");
  const js = stripTypeScriptTypes(source).replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  return new Function("h", "flushSync", "createRoot", `${js}\nreturn { AssistantPresentation, mountAssistantPresentation };`)(h, (fn) => fn(), rootFactory);
}

test("React card: bilingual independent status, one Generate, no autofocus; ready preview is read-only and expansion persists", async () => {
  const { AssistantPresentation } = viewModule();
  for (const language of ["en", "zh"]) {
    const f = await fixture(); let tree = AssistantPresentation({ controller: f.controller, state: f.controller.state, language });
    assert.equal(tree.type, "section"); assert.equal(tree.props.lang, language);
    assert.equal(nodes(tree).filter((node) => node.type === "button").length, 1);
    assert.equal(nodes(tree).find((node) => node.type === "h3").children[0], plan.title);
    assert.ok(content(tree).includes(plan.page_range));
    assert.equal(nodes(tree).some((node) => node.props.autoFocus || node.type === "input" || node.type === "textarea"), false);
    assert.ok(nodes(tree).find((node) => node.props.role === "status")); assert.equal(f.calls.length, 0);
    nodes(tree).find((node) => node.type === "button").props.onClick(); await settle();
    tree = AssistantPresentation({ controller: f.controller, state: f.controller.state, language });
    const details = nodes(tree).find((node) => node.type === "details"); assert.equal(details.props.open, false);
    details.props.onToggle({ currentTarget: { open: true } }); assert.equal(f.controller.state.expanded, true);
    assert.equal(nodes(tree).filter((node) => node.type === "button").length, 1);
    assert.equal(nodes(tree).filter((node) => node.type === "input" || node.type === "textarea").length, 0);
    assert.ok(content(tree).includes(outline.slides[0].body[0])); assert.equal(f.exports.length, 0);
  }
});

test("React mount claims dedicated empty host, unsubscribes before unmount, preserves controller across remount", async () => {
  const f = await fixture(); const events = [];
  const { mountAssistantPresentation } = viewModule(() => ({ render() { events.push("render"); }, unmount() { events.push("unmount"); } }));
  const host = { childNodes: [] };
  const handle = mountAssistantPresentation({ container: host, controller: f.controller, language: "en" });
  assert.throws(() => mountAssistantPresentation({ container: host, controller: f.controller, language: "en" }));
  assert.throws(() => mountAssistantPresentation({ container: { childNodes: [{}] }, controller: f.controller, language: "en" }));
  handle.destroy(); handle.destroy(); const before = events.length;
  await f.controller.generate(); assert.equal(events.length, before);
  const again = mountAssistantPresentation({ container: host, controller: f.controller, language: "zh" });
  assert.equal(f.calls.length, 2); assert.equal(f.controller.state.phase, "ready"); again.destroy();
});

async function bridgeFixture(options = {}) {
  const { createAssistantPresentationsBridge } = await modulePromise;
  let owner = { document: paper, conversationId, navigationGeneration: 1 };
  const mounts = [], events = [], downloads = [], calls = [], links = [];
  const body = new Element("body");
  const dom = { body, createElement: (tag) => {
    const element = new Element(tag);
    if (tag === "a") { element.click = () => links.push(element); element.remove = () => { body.children = body.children.filter((child) => child !== element); }; }
    return element;
  } };
  const bridge = createAssistantPresentationsBridge({ api: async (url) => { calls.push(url); return options.api ? options.api(url) : url.endsWith("/context") ? context() : result(); },
    exportFetch: options.exportFetch, getOwner: () => owner, document: dom,
    download: options.nativeDownload ? undefined : (...args) => downloads.push(args),
    loadView: options.loadView || (async () => ({ mountAssistantPresentation(input) {
      mounts.push(input); events.push("mount"); return { destroy() { events.push("unmount"); } };
    } })) });
  const container = new Element("article");
  const turn = { id: turnId, document_id: documentId, conversation_id: conversationId, presentation_plans: [plan] };
  return { bridge, mounts, events, downloads, calls, links, container, turn, setOwner(value) { owner = value; } };
}

test("bridge history/polls/minimize: same controller/receipt and preview survive host remount without requests", async () => {
  const f = await bridgeFixture(); assert.equal(f.bridge.installed, false);
  await f.bridge.load(); assert.equal(f.bridge.installed, true);
  f.bridge.mountTurn(f.container, f.turn, "en"); const controller = f.mounts[0].controller;
  assert.equal(f.calls.length, 0); await controller.generate(); controller.setExpanded(true);
  f.bridge.unmountViews(); f.container.replaceChildren(); f.bridge.mountTurn(f.container, clone(f.turn), "zh");
  assert.equal(f.mounts[1].controller, controller); assert.equal(controller.state.expanded, true);
  assert.equal(controller.state.phase, "ready"); assert.equal(f.calls.length, 2);
  f.bridge.destroy(); assert.deepEqual(f.events, ["mount", "unmount", "mount", "unmount"]);
});

test("bridge ignores malformed, duplicate and wrong-owner/history records; never infers plans from events or prose", async () => {
  const f = await bridgeFixture(); await f.bridge.load();
  for (const turn of [{ ...f.turn, document_id: conversationId }, { ...f.turn, conversation_id: turnId },
    { ...f.turn, presentation_plans: [{ ...plan, document_id: conversationId }] }, { ...f.turn, presentation_plans: undefined, events: [{ kind: "presentation_plan", summary: JSON.stringify(plan) }], answer: "Generate PPT" }]) {
    f.bridge.mountTurn(f.container, turn, "en");
  }
  assert.equal(f.mounts.length, 0); f.bridge.mountTurn(f.container, { ...f.turn, presentation_plans: [plan, plan, { ...plan, page_range: "0" }] }, "en");
  assert.equal(f.mounts.length, 1); assert.equal(f.calls.length, 0);
  f.bridge.destroy();
});

test("clearing another conversation leaves the current host/controller intact", async () => {
  const f = await bridgeFixture(); await f.bridge.load(); f.bridge.mountTurn(f.container, f.turn, "en");
  const controller = f.mounts[0].controller;
  f.bridge.clearConversation(documentId, turnId);
  assert.deepEqual(f.events, ["mount"]); assert.equal(await controller.generate(), true);
  assert.equal(f.calls.length, 2); f.bridge.destroy();
});

test("native download object URLs and subscriptions are released on clear/reset/destroy", async () => {
  const { PRESENTATION_MIME } = await modulePromise;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const created = [], revoked = [];
  URL.createObjectURL = () => { const url = `blob:private-${created.length}`; created.push(url); return url; };
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    for (const action of ["clear", "reset", "destroy"]) {
      const f = await bridgeFixture({ nativeDownload: true, exportFetch: async () => new Response(new Blob([new Uint8Array([80, 75, 3, 4])], { type: PRESENTATION_MIME })) });
      await f.bridge.load(); f.bridge.mountTurn(f.container, f.turn, "en"); const controller = f.mounts[0].controller;
      await controller.generate(); assert.equal(await controller.download(), true); assert.equal(f.links.length, 1);
      assert.ok(f.links[0].href.startsWith("blob:private-")); assert.equal(f.links[0].download, "Paper presentation.pptx");
      if (action === "clear") f.bridge.clearConversation(documentId, conversationId);
      else f.bridge[action]();
      assert.equal(await controller.generate(), false); f.bridge.destroy();
    }
    assert.deepEqual(revoked, created);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test("bridge navigation, clear and mode reset prevent delayed paid work; late view load cannot mount removed hosts", async () => {
  for (const action of ["navigate", "clear", "reset", "destroy"]) {
    const gate = deferred(); const f = await bridgeFixture({ api: () => gate.promise }); await f.bridge.load();
    f.bridge.mountTurn(f.container, f.turn, "en"); const controller = f.mounts[0].controller; const pending = controller.generate();
    if (action === "navigate") { f.setOwner({ document: { ...paper, id: conversationId }, conversationId: null, navigationGeneration: 2 }); f.bridge.contextChanged(); }
    if (action === "clear") f.bridge.clearConversation(documentId, conversationId);
    if (action === "reset") f.bridge.reset();
    if (action === "destroy") f.bridge.destroy();
    gate.resolve(context()); await pending; assert.equal(f.calls.length, 1); assert.equal(controller.state.outline, null);
    if (action !== "navigate") assert.equal(await controller.generate(), false);
    f.bridge.destroy();
  }
  const gate = deferred(); let mounts = 0;
  const f = await bridgeFixture({ loadView: () => gate.promise }); const loading = f.bridge.load();
  f.bridge.mountTurn(f.container, f.turn, "en"); f.bridge.unmountViews();
  gate.resolve({ mountAssistantPresentation() { mounts += 1; return { destroy() {} }; } }); await loading;
  assert.equal(mounts, 0); f.bridge.destroy();
  const unavailable = await bridgeFixture({ loadView: async () => { throw new Error("bundle missing"); } });
  assert.equal(await unavailable.bridge.load(), false); assert.equal(unavailable.bridge.installed, false);
});

test("native message replacement unmounts first; machine events stay hidden while other logs and answer rendering survive", async () => {
  const sourceText = fs.readFileSync(path.join(root, "frontend/assistant.js"), "utf8");
  const body = sourceText.slice(sourceText.indexOf("  function renderMessages("), sourceText.indexOf("  function appendSourceExcerpt("));
  const order = []; const messages = new Element("div");
  const replace = messages.replaceChildren.bind(messages); messages.replaceChildren = (...args) => { order.push("replace"); replace(...args); };
  const fn = new Function("elements", "presentations", "document", "deviceMode", "t", "statusText", "renderAssistantAnswer", "language", "openTurnSource", "errorText", `${body}; return renderMessages;`)(
    { messages }, { contextChanged() {}, unmountViews() { order.push("unmount"); }, mountTurn() { order.push("mount"); } },
    { createElement: (tag) => new Element(tag) }, false, (key) => key, (state) => state,
    (target, { answer }) => { target.textContent = answer; }, "en", () => {}, () => "error");
  fn({ turns: [{ id: turnId, message: "Help", answer: "Existing answer", status: "completed", events: [
    { kind: "presentation_plan", title: "Machine plan", summary: JSON.stringify(plan) },
    { kind: "tool", title: "Read source", summary: "Ordinary event" }
  ] }] });
  assert.deepEqual(order, ["unmount", "replace", "mount"]);
  assert.ok(messages.textContent.includes("Existing answer")); assert.ok(messages.textContent.includes("Ordinary event"));
  assert.equal(messages.textContent.includes("Machine plan"), false); assert.equal(messages.textContent.includes("file_sha256"), false);
});

test("scoped integration keeps task/hotkey/draft hooks and wires dispose/negotiation after continuation is known", () => {
  const native = fs.readFileSync(path.join(root, "frontend/assistant.js"), "utf8");
  assert.ok(native.indexOf("negotiatePresentationActions(payload") > native.indexOf("payload.continue_task = true"));
  assert.ok(native.indexOf("negotiatePresentationActions(payload") < native.indexOf("Object.freeze(payload.context)"));
  for (const marker of ["bindAssistantComposerKeys({", "tasks.acceptTurn(", "renderProposals(paper, entry, turn)", "renderSources(turn)",
    "presentations.clearConversation(paperId, conversationId)", "destroy: destroyAssistant", 'attributeFilter: ["data-storage-mode"]']) assert.ok(native.includes(marker), marker);
  const minimize = native.slice(native.indexOf("  function minimizeAssistant()"), native.indexOf('  elements.toggle.addEventListener("click"'));
  assert.doesNotMatch(minimize, /presentations\.(reset|destroy)/);
  const html = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8"); assert.ok(html.includes('href="/assistant-presentations.css"'));
  const css = fs.readFileSync(path.join(root, "frontend/assistant-presentations.css"), "utf8");
  for (const rule of [/min-height:\s*44px/, /min-width:\s*0/, /max-width:\s*100%/, /:focus-visible/, /overflow-wrap:\s*anywhere/]) assert.match(css, rule);
  assert.doesNotMatch(css, /@import|https?:|url\(/);
});
