const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { base, deferred } = require("./teaching-data-fixture.cjs");

function setup(bundleURL) {
  const reply = deferred(), requests = [], warnings = [];
  let current = structuredClone(base), getModelFails = false;
  const container = { childNodes: [] }, native = { hidden: false, actions: 0 };
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/teaching-data.js"), "utf8");
  const context = vm.createContext({ URL, structuredClone, window: { location: { origin: "https://local.invalid" } },
    console: { warn: (...args) => warnings.push(args) }, loadBundle: url => { requests.push(url); return reply.promise; } });
  assert.ok(source.includes("await import(localBundleURL(bundleURL))"));
  vm.runInContext(source.replace("export function createTeachingData", "function createTeachingData")
    .replace("await import(localBundleURL(bundleURL))", "await loadBundle(localBundleURL(bundleURL))"), context);
  const callbacks = { onImport: async () => { throw new Error("Bridge cannot import data"); }, onContinue: () => true, onRefresh() {}, onLockChange() {} };
  const bridge = context.createTeachingData({ container, getModel: () => { if (getModelFails) throw new Error("model failed"); return current; },
    ...callbacks, ...(bundleURL === undefined ? {} : { bundleURL }) });
  return { bridge, reply, requests, warnings, container, native, callbacks, setModel: value => { current = value; }, failModel: value => { getModelFails = value; } };
}
const handle = (overrides = {}) => ({ update: () => true, destroy() {}, hasUnsavedWork: () => false, prepareNavigation: () => true, ...overrides });

test("explicit lazy load queues latest isolated model, forwards frozen callbacks and preserves synchronous navigation", async () => {
  const f = setup(); assert.deepEqual(f.requests, []); assert.equal(f.bridge.prepareNavigation(), true); assert.equal(f.bridge.hasUnsavedWork(), false);
  const loading = f.bridge.load(); assert.equal(f.bridge.load(), loading);
  const latest = structuredClone({ ...base, ownerId: "paper:b", language: "zh" });
  assert.equal(f.bridge.update(latest), true); latest.ownerId = "mutated"; latest.examples[0].title.en = "mutated";
  let mounted, destroyed = 0; const updates = [];
  f.reply.resolve({ mountTeachingData: options => { mounted = options; return handle({ update: model => { updates.push(model); return true; },
    destroy: () => { destroyed += 1; }, hasUnsavedWork: () => true, prepareNavigation: () => false }); } });
  assert.equal(await loading, true); assert.equal(mounted.model.ownerId, "paper:b"); assert.equal(mounted.model.language, "zh");
  assert.equal(mounted.model.examples[0].title.en, base.examples[0].title.en);
  for (const name of Object.keys(f.callbacks)) assert.equal(mounted.callbacks[name], f.callbacks[name]);
  assert.equal(f.bridge.prepareNavigation(), false); assert.equal(typeof f.bridge.prepareNavigation(), "boolean"); assert.equal(f.bridge.hasUnsavedWork(), true);
  f.setModel(base); assert.equal(f.bridge.update(), true); assert.equal(updates[0].ownerId, base.ownerId);
  assert.equal(await f.bridge.load(), true); assert.equal(f.requests.length, 1);
  f.bridge.destroy(); f.bridge.destroy(); assert.equal(destroyed, 1); assert.equal(f.bridge.update(base), false); assert.equal(await f.bridge.load(), false);
});

test("load-time snapshot cannot be changed by caller mutation without update, and reentrant updates are not lost", async () => {
  const input = structuredClone(base); const f = setup(); f.setModel(input); const loading = f.bridge.load(); input.ownerId = "mutated";
  let mounted; const updates = [];
  f.reply.resolve({ mountTeachingData: options => {
    mounted = options; f.bridge.update({ ...base, ownerId: "paper:c" });
    return handle({ update: model => { updates.push(model); model.ownerId = "handle mutated"; return true; } });
  } });
  assert.equal(await loading, true); assert.equal(mounted.model.ownerId, "paper:a"); assert.equal(updates.length, 1);
  assert.equal(updates[0].ownerId, "handle mutated"); f.bridge.destroy();
});

test("empty host enforced; failed imports/mount/update/destroy cannot hide or move native controls", async () => {
  for (const module of [{}, { mountTeachingData: () => { throw new Error("mount failure"); } },
    { mountTeachingData: () => ({ destroy() {} }) }]) {
    const f = setup(); const loading = f.bridge.load(); f.reply.resolve(module);
    assert.equal(await loading, false); assert.equal(f.native.hidden, false); f.native.actions += 1; assert.equal(f.native.actions, 1);
    assert.equal(f.container.childNodes.length, 0); assert.ok(f.warnings.length); f.bridge.destroy();
  }
  const f = setup(); const existing = {}; f.container.childNodes = [existing];
  assert.equal(await f.bridge.load(), false); assert.equal(f.requests.length, 0); assert.equal(f.container.childNodes[0], existing);
  f.container.childNodes = []; const loading = f.bridge.load(); f.reply.resolve({ mountTeachingData: () => handle() }); assert.equal(await loading, true); f.bridge.destroy();
  const g = setup(); const failed = g.bridge.load(); let destroys = 0;
  g.reply.resolve({ mountTeachingData: () => handle({ update: () => { throw new Error(); }, destroy: () => { destroys += 1; throw new Error(); },
    prepareNavigation: () => { throw new Error(); }, hasUnsavedWork: () => { throw new Error(); } }) });
  assert.equal(await failed, true); assert.equal(g.bridge.update(base), false); assert.equal(destroys, 0);
  assert.equal(g.bridge.prepareNavigation(), false); assert.equal(g.bridge.hasUnsavedWork(), true);
  assert.doesNotThrow(() => g.bridge.destroy()); assert.equal(destroys, 1); assert.equal(g.native.hidden, false);
});

test("failed bundle/model reads allow explicit retry; clone failure is contained", async () => {
  const f = setup(); const loading = f.bridge.load(); f.reply.reject(new Error("offline"));
  assert.equal(await loading, false); assert.equal(await f.bridge.load(), false); assert.equal(f.requests.length, 2); f.bridge.destroy();
  const g = setup(); g.failModel(true); assert.equal(await g.bridge.load(), false); assert.equal(g.requests.length, 0);
  g.failModel(false); const retrying = g.bridge.load(); g.reply.resolve({ mountTeachingData: () => handle() }); assert.equal(await retrying, true);
  g.failModel(true); assert.equal(g.bridge.update(), false); assert.equal(g.bridge.update({ fn() {} }), false); g.bridge.destroy();
});

test("destroy during module load or reentrant mount prevents stale attachment, even if cleanup throws", async () => {
  const f = setup(); const loading = f.bridge.load(); let mounts = 0;
  f.bridge.destroy(); f.reply.resolve({ mountTeachingData: () => { mounts += 1; return handle(); } });
  assert.equal(await loading, false); assert.equal(mounts, 0);
  const g = setup(); const mounting = g.bridge.load(); let destroys = 0;
  g.reply.resolve({ mountTeachingData: () => { g.bridge.destroy(); return handle({ destroy: () => { destroys += 1; throw new Error(); } }); } });
  assert.equal(await mounting, false); assert.equal(destroys, 1); assert.equal(g.bridge.hasUnsavedWork(), false);
});

test("same-origin absolute bundle paths reject escapes and retain explicit release query", async () => {
  for (const url of ["https://remote.invalid/a.js", "//remote.invalid/a.js", "/\\remote.invalid/a.js", "relative.js", "/a.js#bad", "https://u:p@local.invalid/a.js"]) {
    const f = setup(url); assert.equal(await f.bridge.load(), false); assert.equal(f.requests.length, 0); f.bridge.destroy();
  }
  const f = setup("/ui/releases/64/workspace-shell.js?v=64"); const loading = f.bridge.load();
  f.reply.resolve({ mountTeachingData: () => handle() }); assert.equal(await loading, true);
  assert.deepEqual(f.requests, ["/ui/releases/64/workspace-shell.js?v=64"]); f.bridge.destroy();
});

test("legacy async or nonboolean navigation results fail closed synchronously", async () => {
  for (const result of [Promise.resolve(true), "yes", undefined, false]) {
    const f = setup(); const loading = f.bridge.load();
    f.reply.resolve({ mountTeachingData: () => handle({ prepareNavigation: () => result }) }); assert.equal(await loading, true);
    assert.equal(f.bridge.prepareNavigation(), false); assert.equal(typeof f.bridge.prepareNavigation(), "boolean"); f.bridge.destroy();
  }
});
