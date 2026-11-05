const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// A small DOM/event model exercises both real controllers at mutation checkpoints.
// Browser layout, native details painting and fullscreen remain root acceptance.
function readerTools(width) {
  const observers = [];
  const queries = [];
  let document;
  class Node {}
  class Element extends Node {
    constructor(tag) {
      super();
      this.tagName = tag;
      this.children = [];
      this.attributes = new Map();
      this.listeners = [];
      this.dataset = {};
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    addEventListener(type, listener, options) {
      this.listeners.push({ type, listener, capture: options === true || Boolean(options?.capture) });
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) {
      if (this.getAttribute(name) === String(value)) return;
      this.attributes.set(name, String(value));
      this.changed(name);
    }
    removeAttribute(name) {
      if (this.attributes.delete(name)) this.changed(name);
    }
    changed(name) {
      for (const observer of observers) {
        if (observer.targets.some(({ target, options }) =>
          (target === this || (options.subtree && target.contains(this))) && options.attributeFilter.includes(name))) {
          observer.records.push({ target: this, attributeName: name });
        }
      }
    }
    get disabled() { return this.attributes.has("disabled"); }
    set disabled(value) { value ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
    focus() { document.activeElement = this; }
    matches(selector) {
      if (selector === ".reader-shape-tool-menu button") return this.tagName === "button" && this.parentElement?.matches(".reader-shape-tool-menu");
      if (selector.startsWith(".")) return (this.getAttribute("class") || "").split(" ").includes(selector.slice(1));
      if (selector.startsWith("[")) return this.attributes.has(selector.slice(1, -1));
      return this.tagName === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    cloneNode(deep) {
      const copy = new Element(this.tagName);
      copy.attributes = new Map(this.attributes);
      if (deep) copy.append(...this.children.map((child) => child.cloneNode(true)));
      return copy;
    }
    replaceWith(node) {
      const parent = this.parentElement;
      parent.children[parent.children.indexOf(this)] = node;
      node.parentElement = parent;
    }
  }
  class Details extends Element {
    constructor() { super("details"); }
    get open() { return this.attributes.has("open"); }
    set open(value) { value ? this.setAttribute("open", "") : this.removeAttribute("open"); }
  }
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = []; this.records = []; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
  }
  document = new Element("document");
  const tools = new Details();
  const summary = new Element("summary");
  const panel = new Element("div");
  const draw = new Details();
  const drawSummary = new Element("summary");
  const icon = new Element("svg");
  icon.setAttribute("data-reader-draw-icon", "");
  drawSummary.append(icon);
  const menu = new Element("div");
  menu.setAttribute("class", "reader-shape-tool-menu");
  const buttons = ["rectangle", "textbox"].map((kind) => {
    const button = new Element("button");
    button.id = `reader-shape-${kind}`;
    button.disabled = true;
    button.append(new Element("svg"));
    return button;
  });
  menu.append(...buttons);
  draw.append(drawSummary, menu);
  panel.append(draw);
  tools.append(summary, panel);
  const outside = new Element("button");
  document.append(tools, outside);
  document.activeElement = outside;
  document.getElementById = (id) => ({ "reader-secondary-tools": tools, "reader-draw-menu": draw })[id] || null;
  const window = {
    matchMedia(media) {
      const query = { media, matches: media.includes("min-width") ? width >= 821 : width <= 820, listeners: [] };
      query.addEventListener = (_, callback) => query.listeners.push(callback);
      queries.push(query);
      return query;
    }
  };
  const context = vm.createContext({ document, window, Node, HTMLElement: Element, HTMLDetailsElement: Details, MutationObserver: Observer });
  for (const file of ["reader-annotation-tools.js", "reader-clean-tools.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../../frontend", file), "utf8");
    vm.runInContext(`{\n${source}\n}`, context, { filename: file });
  }
  function flush() {
    for (let turn = 0; turn < 12; turn += 1) {
      const pending = observers.filter((observer) => observer.records.length);
      if (!pending.length) return;
      for (const observer of pending) observer.callback(observer.records.splice(0));
    }
    assert.fail("menu observers did not settle");
  }
  function dispatch(target, type, properties = {}) {
    const event = {
      target, type, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...properties
    };
    const ancestors = [];
    for (let node = target; node; node = node.parentElement) ancestors.push(node);
    for (const capture of [true, false]) {
      for (const node of capture ? [...ancestors].reverse() : ancestors) {
        for (const listener of node.listeners.filter((entry) => entry.type === type && entry.capture === capture)) listener.listener(event);
        if (event.stopped) return event;
      }
    }
    return event;
  }
  function resize(nextWidth, reverse = false) {
    const changed = queries.filter((query) => query.matches !== (query.media.includes("min-width") ? nextWidth >= 821 : nextWidth <= 820));
    for (const query of changed) query.matches = !query.matches;
    for (const query of reverse ? changed.reverse() : changed) for (const callback of query.listeners) callback();
    flush();
  }
  flush();
  return { tools, draw, summary, drawSummary, buttons, document, outside, flush, dispatch, resize };
}

test("desktop exposes both tool groups even when all shape actions start disabled", () => {
  const view = readerTools(821);
  assert.equal(view.tools.open, true);
  assert.equal(view.draw.open, true);
  assert.equal(view.drawSummary.getAttribute("aria-disabled"), "true");
});

test("desktop outside pointer and focus keep both groups open", () => {
  const view = readerTools(1100);
  for (const type of ["pointerdown", "focusin"]) {
    view.dispatch(view.outside, type);
    view.flush();
    assert.equal(view.tools.open && view.draw.open, true);
    assert.equal(view.document.activeElement, view.outside);
  }
});

test("desktop tool selection preserves nodes, one handler invocation and expansion", () => {
  const view = readerTools(1100);
  const button = view.buttons[0];
  const parent = button.parentElement;
  button.disabled = false;
  let selections = 0;
  button.addEventListener("click", () => { selections += 1; button.setAttribute("aria-pressed", "true"); });
  view.dispatch(button, "click");
  view.flush();
  assert.equal(selections, 1);
  assert.equal(button.parentElement, parent);
  assert.equal(view.draw.open && view.tools.open, true);
  assert.equal(view.draw.dataset.activeTool, "rectangle");
});

test("desktop Escape never focuses the hidden draw disclosure", () => {
  const view = readerTools(1100);
  view.buttons[0].disabled = false;
  view.flush();
  for (const isComposing of [false, true]) {
    view.buttons[0].focus();
    const event = view.dispatch(view.buttons[0], "keydown", { key: "Escape", isComposing });
    view.flush();
    assert.equal(view.document.activeElement, view.buttons[0]);
    assert.equal(view.draw.open && view.tools.open, true);
    assert.equal(event.defaultPrevented, !isComposing);
  }
});

test("desktop disabled-state and direct-close changes restore expansion at the mutation checkpoint", () => {
  const view = readerTools(1100);
  view.buttons[0].disabled = false;
  view.flush();
  view.buttons[0].disabled = true;
  view.flush();
  assert.equal(view.draw.open, true);
  view.tools.open = false;
  view.draw.open = false;
  view.flush();
  assert.equal(view.draw.open && view.tools.open, true);
});

test("mobile retains compact close and Escape focus behavior", () => {
  const view = readerTools(820);
  assert.equal(view.tools.open || view.draw.open, false);
  view.tools.open = true;
  view.draw.open = true;
  view.flush();
  view.dispatch(view.outside, "pointerdown");
  view.flush();
  assert.equal(view.tools.open || view.draw.open, false);
  view.tools.open = true;
  view.dispatch(view.summary, "keydown", { key: "Escape" });
  view.flush();
  assert.equal(view.tools.open, false);
  assert.equal(view.document.activeElement, view.summary);
  view.tools.open = true;
  view.draw.open = true;
  view.dispatch(view.buttons[0], "keydown", { key: "Escape" });
  view.flush();
  assert.equal(view.draw.open, false);
  assert.equal(view.document.activeElement, view.drawSummary);
});

test("820/821 repeated crossings preserve nodes and handlers in either media listener order", () => {
  const view = readerTools(820);
  const parent = view.buttons[0].parentElement;
  let clicks = 0;
  view.buttons[0].disabled = false;
  view.buttons[0].addEventListener("click", () => { clicks += 1; });
  for (let index = 0; index < 4; index += 1) {
    view.resize(821, Boolean(index % 2));
    assert.equal(view.tools.open && view.draw.open, true);
    view.dispatch(view.buttons[0], "click");
    view.flush();
    view.resize(820, Boolean(index % 2));
    assert.equal(view.tools.open || view.draw.open, false);
  }
  assert.equal(view.buttons[0].parentElement, parent);
  assert.equal(clicks, 4);
});
