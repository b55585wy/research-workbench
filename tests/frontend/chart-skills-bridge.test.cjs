const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { base, deferred } = require("./chart-skills-fixture.cjs");

function setup(bundleURL) {
  const pending = deferred(), requests = [], warnings = [];
  const native = { hidden: false, actions: 0 }; const container = { childNodes: [] };
  let current = { ...base };
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/chart-skills.js"), "utf8");
  assert.ok(source.includes("await import(localBundleURL(bundleURL))"));
  const context = vm.createContext({ URL, structuredClone, window: { location: { origin: "https://local.invalid" } },
    console: { warn: (...args) => warnings.push(args) },
    loadBundle: (url) => { requests.push(url); return pending.promise; } });
  vm.runInContext(source.replace("export function createChartSkills", "function createChartSkills")
    .replace("await import(localBundleURL(bundleURL))", "await loadBundle(localBundleURL(bundleURL))"), context);
  const api = async () => { throw new Error("Bridge must never call API itself"); }; const onSelect = () => {};
  const bridge = context.createChartSkills({ container, getModel: () => current, api, onSelect,
    ...(bundleURL === undefined ? {} : { bundleURL }) });
  return { bridge, pending, requests, warnings, native, container, api, onSelect, setModel: model => { current = model; } };
}
function handle(overrides = {}) {
  return { update: () => true, destroy() {}, hasUnsavedWork: () => false, prepareNavigation: async () => true, ...overrides };
}

test("explicit lazy load preserves synchronous shape, queues isolated latest model and forwards exact callbacks", async () => {
  const f = setup(); assert.equal(f.requests.length, 0);
  assert.equal(f.bridge.hasUnsavedWork(), false); assert.equal(await f.bridge.prepareNavigation(), true);
  const loading = f.bridge.load(); assert.equal(f.bridge.load(), loading);
  const latest = { ...base, language: "zh", ownerId: "paper:b" };
  assert.equal(f.bridge.update(latest), true); latest.ownerId = "mutated";
  let mounted, destroyed = 0; const updates = [];
  f.pending.resolve({ mountChartSkills: options => {
    mounted = options; return handle({ update: model => { updates.push(model); return true; },
      hasUnsavedWork: () => true, prepareNavigation: async () => false, destroy: () => { destroyed += 1; } });
  } });
  assert.equal(await loading, true); assert.equal(mounted.model.ownerId, "paper:b"); assert.equal(mounted.model.language, "zh");
  assert.equal(mounted.callbacks.api, f.api); assert.equal(mounted.callbacks.onSelect, f.onSelect);
  assert.equal(f.bridge.hasUnsavedWork(), true); assert.equal(await f.bridge.prepareNavigation(), false);
  f.setModel(base); assert.equal(f.bridge.update(), true); assert.equal(updates[0].ownerId, base.ownerId);
  assert.equal(await f.bridge.load(), true); assert.equal(f.requests.length, 1);
  f.bridge.destroy(); f.bridge.destroy(); assert.equal(destroyed, 1);
  assert.equal(f.bridge.update(base), false); assert.equal(await f.bridge.load(), false);
});

test("failed, missing and incompatible bundles keep native tools usable and allow explicit load retry", async () => {
  for (const module of [{}, { mountChartSkills: () => { throw new Error("render failed"); } }, { mountChartSkills: () => ({ destroy() {} }) }]) {
    const f = setup(); const load = f.bridge.load(); f.pending.resolve(module);
    assert.equal(await load, false); assert.equal(f.native.hidden, false);
    f.native.actions += 1; assert.equal(f.native.actions, 1); assert.equal(f.container.childNodes.length, 0);
    assert.equal(f.warnings.length, 1); assert.equal(f.bridge.hasUnsavedWork(), false);
    f.bridge.destroy();
  }
  const f = setup(); const loading = f.bridge.load(); f.pending.reject(new Error("offline"));
  assert.equal(await loading, false); assert.equal(await f.bridge.load(), false); assert.equal(f.requests.length, 2);
  f.bridge.destroy();
});

test("destroy while importing prevents late mount; a cleanup exception still leaves load resolved false", async () => {
  const f = setup(); const loading = f.bridge.load(); let mounts = 0;
  f.bridge.destroy(); f.pending.resolve({ mountChartSkills: () => { mounts += 1; return handle(); } });
  assert.equal(await loading, false); assert.equal(mounts, 0); assert.equal(f.warnings.length, 0);
  const g = setup(); const failing = g.bridge.load();
  g.pending.resolve({ mountChartSkills: () => ({ destroy: () => { throw new Error("cleanup"); } }) });
  assert.equal(await failing, false); assert.equal(g.native.hidden, false); g.bridge.destroy();
});

test("same-origin absolute bundle paths reject remote/credential/fragment/backslash escapes and preserve release queries", async () => {
  for (const url of ["https://remote.invalid/a.js", "//remote.invalid/a.js", "/\\remote.invalid/a.js", "relative.js", "/a.js#bad", "https://a:b@local.invalid/a.js"]) {
    const f = setup(url); assert.equal(await f.bridge.load(), false); assert.equal(f.requests.length, 0); f.bridge.destroy();
  }
  const f = setup("/ui/releases/64/workspace-shell.js?v=64"); const loading = f.bridge.load();
  f.pending.resolve({ mountChartSkills: () => handle() }); assert.equal(await loading, true);
  assert.deepEqual(f.requests, ["/ui/releases/64/workspace-shell.js?v=64"]); f.bridge.destroy();
});
