const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function fixture(loadBundle, bundleURL) {
  const attributes = new Map();
  const documentRoot = { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name) };
  const container = { nodeType: 1, ownerDocument: { documentElement: documentRoot }, classList: { add() {} } };
  let model = { language: "en", area: "reading", pending: false, libraryVisible: true, notesVisible: true };
  const listeners = new Set();
  const warnings = [];
  const commands = [];
  const context = vm.createContext({ URL, window: { location: { origin: "https://local.invalid" } },
    loadBundle, console: { warn: (...args) => warnings.push(args) } });
  const source = fs.readFileSync(path.join(__dirname, "../../frontend/research-shell.js"), "utf8");
  vm.runInContext(source.replace("export function createResearchShell", "function createResearchShell").replace("await import(url)", "await loadBundle(url)"), context);
  const options = {
    container, getModel: () => model, bundleURL,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    onNavigate: (area) => commands.push(area), onLibrary: () => commands.push("library"),
    onNotes: () => commands.push("notes"), onAssistant: () => commands.push("assistant")
  };
  return {
    bridge: context.createResearchShell(options), create: (changes = {}) => context.createResearchShell({ ...options, ...changes }),
    container, attributes, listeners, warnings, commands,
    setModel(next, notify = true) { model = { ...model, ...next }; if (notify) for (const listener of [...listeners]) listener(); }
  };
}

function mountModule({ throwUpdate = false, commit = true } = {}) {
  const calls = { mounts: [], updates: [], destroyed: 0, throwUpdate };
  return { calls, module: { mountResearchShell(options) {
    calls.mounts.push(options);
    if (commit) options.onMounted();
    return {
      update: (model) => { if (calls.throwUpdate) throw new Error("render failed"); calls.updates.push(model); return true; },
      destroy: () => { calls.destroyed += 1; }
    };
  } } };
}

test("load is lazy and deduplicated; only a committed mount suppresses native controls", async () => {
  const mounted = mountModule();
  let imports = 0;
  let resolve;
  const f = fixture((url) => {
    imports += 1;
    assert.equal(url, "https://local.invalid/vendor/workspace-shell/workspace-shell.js");
    return new Promise((done) => { resolve = done; });
  });
  assert.equal(imports, 0);
  assert.equal(f.attributes.has("data-research-shell"), false);
  const first = f.bridge.load();
  assert.equal(f.bridge.load(), first);
  await Promise.resolve();
  f.setModel({ area: "charts" });
  assert.equal(f.container.hidden, true);
  resolve(mounted.module);
  assert.equal(await first, true);
  assert.equal(imports, 1);
  assert.equal(mounted.calls.mounts[0].model.area, "charts");
  assert.equal(f.attributes.get("data-research-shell"), "ready");
  assert.equal(f.container.hidden, false);
  assert.equal(f.listeners.size, 1);
  f.setModel({ pending: true });
  assert.equal(mounted.calls.updates.at(-1).pending, true);
  assert.equal(f.commands.length, 0);
  assert.equal(await f.bridge.load(), true);
  f.bridge.destroy(); f.bridge.destroy();
  assert.equal(mounted.calls.destroyed, 1);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.attributes.has("data-research-shell"), false);
  assert.equal(f.container.hidden, true);
  assert.equal(f.bridge.update(), false);
  assert.equal(await f.bridge.load(), false);
});

test("each explicit callback dispatches once, and native pending rejects a stale-render command", async () => {
  const mounted = mountModule();
  const f = fixture(async () => mounted.module);
  await f.bridge.load();
  const callbacks = mounted.calls.mounts[0].callbacks;
  for (const area of ["reading", "analysis", "charts", "presentations"]) callbacks.onNavigate(area);
  callbacks.onLibrary(); callbacks.onNotes(); callbacks.onAssistant();
  assert.deepEqual(f.commands, ["reading", "analysis", "charts", "presentations", "library", "notes", "assistant"]);
  f.setModel({ pending: true }, false);
  callbacks.onNavigate("analysis");
  assert.equal(f.commands.length, 7);
  f.bridge.destroy();
});

test("import failure retains fallback and evidence; one explicit retry can recover", async () => {
  const mounted = mountModule();
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error("bundle unavailable"); return mounted.module; });
  assert.equal(await f.bridge.load(), false);
  assert.match(f.bridge.getError().message, /bundle unavailable/);
  assert.equal(f.attributes.has("data-research-shell"), false);
  assert.equal(f.listeners.size, 0);
  fail = false;
  assert.equal(await f.bridge.load(), true);
  assert.equal(f.bridge.getError(), null);
  assert.equal(f.warnings.length, 1);
  f.bridge.destroy();
});

test("missing export, missing commit and render failure never suppress fallback or leak subscriptions", async () => {
  for (const module of [{}, mountModule({ commit: false }).module, mountModule({ throwUpdate: true }).module]) {
    const f = fixture(async () => module);
    assert.equal(await f.bridge.load(), false);
    assert.equal(f.container.hidden, true);
    assert.equal(f.attributes.has("data-research-shell"), false);
    assert.equal(f.listeners.size, 0);
    assert.ok(f.bridge.getError());
    f.bridge.destroy();
  }
});

test("invalid or remote bundle paths are rejected before importing", async () => {
  for (const url of ["https://other.invalid/shell.js", "//other.invalid/shell.js", "/\\other.invalid/shell.js", "relative.js", "/shell.js#fragment"]) {
    let imports = 0;
    const f = fixture(async () => { imports += 1; }, url);
    assert.equal(await f.bridge.load(), false);
    assert.equal(imports, 0);
    assert.equal(f.attributes.has("data-research-shell"), false);
    f.bridge.destroy();
  }
});

test("destroy during import cannot mount later, and replacing a bridge retires the previous writer", async () => {
  const mounted = mountModule();
  let resolve;
  const f = fixture(() => new Promise((done) => { resolve = done; }));
  const pending = f.bridge.load();
  await Promise.resolve();
  f.bridge.destroy();
  const replacement = f.create();
  resolve(mounted.module);
  assert.equal(await pending, false);
  assert.equal(mounted.calls.mounts.length, 0);
  replacement.destroy();
  const live = fixture(async () => mounted.module);
  await live.bridge.load();
  const remounted = live.create();
  assert.equal(mounted.calls.destroyed, 1);
  assert.equal(live.listeners.size, 0);
  await remounted.load();
  live.bridge.destroy();
  assert.equal(live.attributes.get("data-research-shell"), "ready");
  assert.equal(live.listeners.size, 1);
  remounted.destroy();
});

test("post-mount update errors retire the mount and restore fallback", async () => {
  const mounted = mountModule();
  const f = fixture(async () => mounted.module);
  await f.bridge.load();
  f.setModel({ area: "presentations" });
  assert.equal(mounted.calls.updates.at(-1).area, "presentations");
  mounted.calls.throwUpdate = true;
  f.setModel({ area: "analysis" });
  assert.equal(f.attributes.has("data-research-shell"), false);
  assert.equal(f.listeners.size, 0);
  assert.equal(mounted.calls.destroyed, 1);
  assert.match(f.bridge.getError().message, /render failed/);
  const broken = f.create({ getModel: () => { throw new Error("model unavailable"); } });
  assert.equal(await broken.load(), false);
  assert.equal(f.attributes.has("data-research-shell"), false);
  assert.equal(f.listeners.size, 0);
  broken.destroy();
});
