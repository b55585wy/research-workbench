const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { fixture } = require("./notes-workspace-dom.cjs");

const model = { language: "en", ownerId: "paper:1", noteCount: 2, hasDraft: false, editing: false, busy: false };
function setup(bundleURL) {
  const dom = fixture();
  const warnings = [];
  const requests = [];
  let resolve, reject;
  const bundle = new Promise((yes, no) => { resolve = yes; reject = no; });
  const source = fs.readFileSync(path.join(__dirname, "../../frontend/notes-workspace.js"), "utf8");
  assert.ok(source.includes("await import(localBundleURL(bundleURL))"));
  // Replace only the import transport; exercise the real bridge with a delayed module.
  const context = vm.createContext({
    URL, window: { location: { origin: "https://local.invalid" } },
    console: { warn: (...args) => warnings.push(args) },
    loadBundle: (url) => { requests.push(url); return bundle; }
  });
  vm.runInContext(source.replace("export function createNotesWorkspace", "function createNotesWorkspace")
    .replace("await import(localBundleURL(bundleURL))", "await loadBundle(localBundleURL(bundleURL))"), context);
  let opened = 0;
  const bridge = context.createNotesWorkspace({
    container: dom.container, hosts: dom.hosts, getModel: () => model,
    onOpenEditor: () => { opened += 1; }, ...(bundleURL === undefined ? {} : { bundleURL })
  });
  return { ...dom, bridge, resolve, reject, warnings, requests, opened: () => opened };
}

test("lazy loading keeps native controls usable and queues latest model + explicit editor insertion", async () => {
  const f = setup();
  const original = [...f.parent.childNodes];
  const latest = { ...model, language: "zh", ownerId: "study:2", noteCount: 7, hasDraft: true, busy: true };
  assert.equal(f.bridge.update(latest), true);
  latest.noteCount = 99;
  assert.equal(f.bridge.show("images"), true);
  assert.equal(f.bridge.show("editor"), true);
  assert.equal(f.hosts.editor.open, true);
  assert.deepEqual(f.parent.childNodes, original);
  let mounted;
  const shown = [];
  const updates = [];
  let destroyed = 0;
  f.resolve({ mountNotesWorkspace: (options) => {
    mounted = options;
    return { show: (section) => { shown.push(section); return true; }, update: (next) => { updates.push(next); return true; }, destroy: () => { destroyed += 1; } };
  } });
  assert.equal(await f.bridge.ready, true);
  assert.equal(mounted.hosts, f.hosts);
  assert.equal(mounted.model.noteCount, 7);
  assert.equal(mounted.model.ownerId, "study:2");
  assert.equal(mounted.model.language, "zh");
  assert.equal(mounted.model.busy, true);
  assert.deepEqual(shown, ["editor"]);
  assert.equal(f.opened(), 0);
  assert.equal(f.bridge.update(), true);
  assert.equal(updates[0].noteCount, 2);
  mounted.callbacks.onOpenEditor();
  assert.equal(f.opened(), 1);
  f.bridge.destroy(); f.bridge.destroy();
  assert.equal(destroyed, 1);
  assert.equal(f.bridge.show("saved"), false);
  assert.equal(f.bridge.update(model), false);
  assert.equal(await f.bridge.load(), false);
  assert.equal(f.requests.length, 1);
});

test("a queued tab from another owner cannot hide a newly resumed draft", async () => {
  const f = setup();
  f.bridge.show("images");
  f.bridge.update({ ...model, ownerId: "paper:2", hasDraft: true });
  const shown = [];
  let mounted;
  f.resolve({ mountNotesWorkspace: options => {
    mounted = options;
    return { show: section => { shown.push(section); return true; }, update: () => true, destroy() {} };
  } });
  assert.equal(await f.bridge.ready, true);
  assert.equal(mounted.model.ownerId, "paper:2");
  assert.equal(mounted.model.hasDraft, true);
  assert.deepEqual(shown, []);
});

test("failed bundle keeps original nodes, hidden/open flags and native actions available", async () => {
  const f = setup();
  const original = [...f.parent.childNodes];
  f.hosts.saved.hidden = true;
  let nativeActions = 0;
  f.hosts.editor.children[1].submit = () => { nativeActions += 1; };
  f.reject(new Error("bundle offline"));
  assert.equal(await f.bridge.ready, false);
  assert.deepEqual(f.parent.childNodes, original);
  assert.equal(f.hosts.saved.hidden, true);
  assert.equal(f.hosts.editor.open, false);
  f.hosts.editor.children[1].submit();
  assert.equal(nativeActions, 1);
  assert.equal(f.bridge.show("editor"), true);
  assert.equal(f.hosts.editor.open, true);
  assert.equal(await f.bridge.load(), false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.warnings.length, 1);
  f.bridge.destroy();
});

test("destroy during pending import cannot mount or alter the native fallback later", async () => {
  const f = setup();
  const original = [...f.parent.childNodes];
  let mounts = 0;
  f.bridge.destroy();
  f.resolve({ mountNotesWorkspace: () => { mounts += 1; throw new Error("must not mount"); } });
  assert.equal(await f.bridge.ready, false);
  assert.equal(mounts, 0);
  assert.deepEqual(f.parent.childNodes, original);
  assert.equal(f.warnings.length, 0);
});

test("incompatible or throwing mount fails without hiding native fallback", async () => {
  for (const module of [{}, { mountNotesWorkspace: () => { throw new Error("mount failed"); } }]) {
    const f = setup();
    const original = [...f.parent.childNodes];
    f.resolve(module);
    assert.equal(await f.bridge.ready, false);
    assert.deepEqual(f.parent.childNodes, original);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.bridge.show("invalid"), false);
    f.bridge.destroy();
  }
});

test("queued show failure destroys the mounted handle to restore its native ownership", async () => {
  const f = setup();
  let restored = 0;
  f.bridge.show("editor");
  f.resolve({ mountNotesWorkspace: () => ({ show: () => { throw new Error("render failed"); }, destroy: () => { restored += 1; } }) });
  assert.equal(await f.bridge.ready, false);
  assert.equal(restored, 1);
  f.bridge.destroy();
  assert.equal(restored, 1);
});

test("bundle paths are local, release queries are preserved, remote URLs are never requested", async () => {
  for (const url of ["https://other.invalid/ui.js", "//other.invalid/ui.js", "/\\other.invalid/ui.js", "/ui.js#fragment"]) {
    const f = setup(url);
    assert.equal(await f.bridge.ready, false);
    assert.equal(f.requests.length, 0);
    f.bridge.destroy();
  }
  const f = setup("/ui/releases/63/workspace-shell.js?v=63");
  f.resolve({ mountNotesWorkspace: () => ({ destroy() {} }) });
  assert.equal(await f.bridge.ready, true);
  assert.deepEqual(f.requests, ["/ui/releases/63/workspace-shell.js?v=63"]);
  f.bridge.destroy();
});
