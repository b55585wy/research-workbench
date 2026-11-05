const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../frontend/reader-capture-actions.js"), "utf8");
const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

// Geometry is supplied explicitly. Actual browser layout and action persistence are root acceptance.
function fixture() {
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    emit(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback(event); }
    listenerCount() { return [...this.listeners.values()].reduce((sum, list) => sum + list.size, 0); }
  }
  class Element extends Events {
    constructor(tag) {
      super();
      this.tagName = tag;
      this.ownerDocument = doc;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.attributes = {};
      this.hidden = false;
      this.clientLeft = 0;
      this.clientTop = 0;
      this.bounds = box(0, 0, 1000, 800);
    }
    append(child) { child.parentElement = this; this.children.push(child); }
    contains(child) { return this === child || this.children.some((node) => node.contains(child)); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    get isConnected() { return this === doc.documentElement || Boolean(this.parentElement?.isConnected); }
    get clientWidth() { return this.bounds.width; }
    get clientHeight() { return this.bounds.height; }
    getClientRects() {
      if (this.hidden || this.cssHidden || this.parentElement && !this.parentElement.getClientRects().length) return [];
      return [this.getBoundingClientRect()];
    }
    getBoundingClientRect() {
      if (!this.isConnected || this.cssHidden) return box(0, 0, 0, 0);
      if (this.className === "reader-capture-actions") {
        return this.hidden ? box(0, 0, 0, 0) : box(0, 0, this.dataset.compact === "true" ? 150 : 220, 54);
      }
      return this.bounds;
    }
    remove() {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
    focus() { doc.activeElement = this; }
  }
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
    notify() { this.callback([]); }
  }
  const doc = new Events();
  const browser = new Events();
  const observers = [];
  const frames = new Map();
  let sequence = 0;
  doc.documentElement = new Element("html");
  doc.createElement = (tag) => new Element(tag);
  doc.defaultView = browser;
  browser.innerWidth = 1000;
  browser.innerHeight = 800;
  browser.visualViewport = new Events();
  Object.assign(browser.visualViewport, { offsetLeft: 0, offsetTop: 0, width: 1000, height: 800 });
  browser.getComputedStyle = (node) => ({ visibility: node.visibility || "visible", display: node.cssHidden ? "none" : "block" });
  browser.requestAnimationFrame = (callback) => { frames.set(++sequence, callback); return sequence; };
  browser.cancelAnimationFrame = (id) => frames.delete(id);
  browser.ResizeObserver = Observer;
  browser.MutationObserver = Observer;
  const host = new Element("section");
  const stage = new Element("div");
  let surface = new Element("div");
  doc.documentElement.append(host);
  host.append(stage);
  stage.append(surface);
  stage.bounds = box(100, 100, 700, 700);
  surface.bounds = box(120, 120, 620, 920);
  let snapshot = {
    identity: {}, requestId: "capture-a", documentId: "doc-a", sourceSha: "hash-a", page: 1,
    rect: [0.1, 0.1, 0.4, 0.2], language: "en", disabled: false, pending: false, error: null
  };
  const calls = [];
  const visibility = [];
  const context = vm.createContext({});
  vm.runInContext(`${source.replaceAll("export ", "")}\nglobalThis.create = createReaderCaptureActions;`, context);
  const mount = () => context.create({
    host, stage, getSnapshot: () => snapshot, getSurface: () => surface,
    onNote: () => calls.push("note"), onAsk: () => calls.push("ask"), onCancel: () => calls.push("cancel"),
    onVisibilityChange: (value) => visibility.push(value)
  });
  const controller = mount();
  const bar = host.children.find((node) => node.className === "reader-capture-actions");
  const [note, ask, cancel] = bar.children;
  function flush() {
    let count = 0;
    while (frames.size) {
      assert.ok(++count < 8, "repositioning must settle without a continuous animation loop");
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    }
    return count;
  }
  function replaceSurface(bounds) {
    surface.remove();
    surface = new Element("div");
    surface.bounds = bounds;
    stage.append(surface);
  }
  return {
    doc, browser, host, stage, bar, note, ask, cancel, controller, calls, visibility, frames, observers,
    mount, flush, replaceSurface,
    get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; },
    get surface() { return surface; },
    show() { controller.update(snapshot); flush(); }
  };
}

test("one source-local action set appears without uploads, actions or initial focus changes", () => {
  const f = fixture();
  f.doc.activeElement = f.stage;
  f.show();
  assert.equal(f.bar.parentElement, f.host);
  assert.equal(f.bar.hidden, false);
  assert.equal(f.bar.style.left, "170px");
  assert.equal(f.bar.style.top, "288px");
  assert.deepEqual(f.visibility, [true]);
  assert.deepEqual(f.calls, []);
  assert.equal(f.doc.activeElement, f.stage);
  f.note.onclick(); f.ask.onclick(); f.cancel.onclick();
  assert.deepEqual(f.calls, ["note", "ask", "cancel"]);
});

test("Chinese and English use short labels and full accessible names", () => {
  const f = fixture();
  f.show();
  assert.equal(f.note.children[0].textContent, "Note");
  assert.equal(f.ask.children[0].textContent, "Ask");
  assert.equal(f.note.getAttribute("aria-label"), "Add to note");
  assert.equal(f.ask.title, "Add to assistant");
  assert.equal(f.cancel.title, "Cancel capture");
  f.snapshot.language = "zh";
  f.controller.update(f.snapshot); f.flush();
  assert.equal(f.note.children[0].textContent, "笔记");
  assert.equal(f.ask.children[0].textContent, "助手");
  assert.equal(f.note.title, "加入笔记");
  assert.equal(f.ask.getAttribute("aria-label"), "加入助手");
  assert.equal(f.cancel.getAttribute("aria-label"), "取消截图");
});

test("scroll and zoom read the replacement surface without invoking actions or stealing focus", () => {
  const f = fixture();
  f.show();
  f.note.focus();
  const oldSurface = f.surface;
  f.replaceSurface(box(160, 100, 860, 1220));
  f.doc.emit("scroll"); f.browser.emit("resize"); f.controller.position();
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.bar.style.left, "230px");
  assert.equal(f.bar.style.top, "332px");
  assert.ok(f.observers[0].targets.has(f.surface));
  assert.equal(f.observers[0].targets.has(oldSurface), false);
  assert.equal(f.doc.activeElement, f.note);
  assert.deepEqual(f.calls, []);
  assert.equal(f.frames.size, 0);
});

test("resize observers, visual viewport and offscreen capture keep a bounded reader dock", () => {
  const f = fixture();
  f.show();
  f.surface.bounds = box(120, -1000, 620, -200);
  f.observers[0].notify(); f.flush();
  assert.equal(f.bar.dataset.docked, "true");
  assert.equal(f.bar.style.top, "108px");
  f.stage.bounds = box(100, 100, 280, 700);
  f.browser.visualViewport.height = 500;
  f.browser.visualViewport.emit("resize"); f.flush();
  assert.equal(f.bar.dataset.compact, "true");
  assert.ok(parseFloat(f.bar.style.left) + 150 <= 272);
  assert.ok(parseFloat(f.bar.style.top) + 54 <= 492);
});

test("fullscreen stays in the reader subtree and unrelated fullscreen hides the bar", () => {
  const f = fixture();
  f.show();
  f.doc.fullscreenElement = f.host;
  f.doc.emit("fullscreenchange"); f.flush();
  assert.equal(f.bar.hidden, false);
  assert.equal(f.host.contains(f.bar), true);
  f.doc.fullscreenElement = f.doc.createElement("section");
  f.doc.emit("fullscreenchange"); f.flush();
  assert.equal(f.bar.hidden, true);
  assert.equal(f.visibility.at(-1), false);
  f.doc.fullscreenElement = null;
  f.doc.emit("fullscreenchange"); f.flush();
  assert.equal(f.bar.hidden, false);
});

test("hidden mobile reader restores legacy retry/cancel and blocks callbacks immediately", () => {
  const f = fixture();
  f.show();
  const previousClick = f.note.onclick;
  f.host.cssHidden = true;
  previousClick();
  assert.deepEqual(f.calls, []);
  f.observers[1].notify(); f.flush();
  assert.equal(f.bar.hidden, true);
  assert.equal(f.visibility.at(-1), false);
  f.snapshot.error = "request_failed";
  f.controller.update(f.snapshot); f.flush();
  assert.equal(f.bar.hidden, true);
  f.host.cssHidden = false;
  f.observers[1].notify(); f.flush();
  assert.equal(f.bar.hidden, false);
  assert.equal(f.note.disabled, false);
  f.note.onclick();
  assert.deepEqual(f.calls, ["note"]);
});

test("capture upload, note saves and mutations disable every action, then allow explicit retry", () => {
  const f = fixture();
  f.show();
  for (const pending of [true, false]) {
    f.snapshot = { ...f.snapshot, disabled: true, pending };
    f.controller.update(f.snapshot); f.flush();
    for (const button of [f.note, f.ask, f.cancel]) {
      assert.equal(button.disabled, true);
      button.onclick();
    }
  }
  assert.deepEqual(f.calls, []);
  const requestId = f.snapshot.requestId;
  f.snapshot = { ...f.snapshot, disabled: false, pending: false, error: "request_failed" };
  f.controller.update(f.snapshot); f.flush();
  assert.equal(f.snapshot.requestId, requestId);
  assert.equal(f.bar.dataset.error, "true");
  assert.equal(f.bar.getAttribute("aria-busy"), "false");
  assert.deepEqual(f.calls, []);
  f.ask.onclick();
  assert.deepEqual(f.calls, ["ask"]);
});

test("replaced captures, changed source snapshots and old callbacks cannot execute", () => {
  const f = fixture();
  f.show();
  for (const change of [
    { identity: {} }, { sourceSha: "hash-b" }, { documentId: "doc-b" }, { requestId: "capture-b" },
    { rect: [0.2, 0.2, 0.4, 0.4] }, { page: 2 }, { disabled: true }, { error: "request_failed" }, { imageId: "uploaded" }
  ]) {
    const before = f.snapshot;
    const stale = f.note.onclick;
    f.snapshot = { ...before, ...change };
    stale();
    assert.deepEqual(f.calls, []);
    f.snapshot = before;
    f.controller.update(f.snapshot); f.flush();
    stale();
    assert.deepEqual(f.calls, []);
  }
  f.snapshot = null;
  f.note.onclick(); f.controller.position(); f.flush();
  assert.equal(f.bar.hidden, true);
  assert.deepEqual(f.calls, []);
});

test("success, cancel and no-document/study cleanup invalidate queued work", () => {
  const f = fixture();
  f.show();
  const stale = f.cancel.onclick;
  f.controller.position();
  f.controller.update(null);
  assert.equal(f.frames.size, 0);
  assert.equal(f.bar.hidden, true);
  assert.equal(f.visibility.at(-1), false);
  stale();
  assert.deepEqual(f.calls, []);
  f.show();
  f.controller.hide();
  assert.equal(f.bar.hidden, true);
  f.cancel.onclick();
  assert.deepEqual(f.calls, []);
});

test("Escape is scoped to the action bar and pending state prevents cancellation", () => {
  const f = fixture();
  f.show();
  let prevented = 0;
  let stopped = 0;
  const event = (target, key = "Escape") => ({ target, key, preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  f.bar.emit("keydown", event(f.note, "Enter"));
  f.bar.emit("keydown", event(f.stage));
  assert.deepEqual(f.calls, []);
  f.bar.emit("keydown", event(f.note));
  assert.deepEqual(f.calls, ["cancel"]);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  f.snapshot.disabled = true;
  f.controller.update(f.snapshot); f.flush();
  f.bar.emit("keydown", event(f.note));
  assert.deepEqual(f.calls, ["cancel"]);
});

test("destroy removes events, observers, descendants and queued frames across repeated mounts", () => {
  const f = fixture();
  f.show();
  const stale = f.note.onclick;
  f.controller.position();
  f.controller.destroy(); f.controller.destroy();
  assert.equal(f.frames.size, 0);
  assert.equal(f.doc.listenerCount(), 0);
  assert.equal(f.browser.listenerCount(), 0);
  assert.equal(f.browser.visualViewport.listenerCount(), 0);
  assert.equal(f.bar.listenerCount(), 0);
  assert.ok(f.observers.every((observer) => observer.disconnected && observer.targets.size === 0));
  assert.equal(f.host.contains(f.bar), false);
  stale(); f.controller.update(f.snapshot); f.doc.emit("scroll");
  assert.deepEqual(f.calls, []);
  assert.equal(f.frames.size, 0);
  const next = f.mount();
  next.update(f.snapshot); f.flush();
  assert.equal(f.host.children.filter((node) => node.className === "reader-capture-actions").length, 1);
  next.destroy();
  assert.equal(f.doc.listenerCount(), 0);
});
