const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Dependency-free DOM fixture. Browser layout and the installed Markdown/sanitizer
// remain root acceptance; answer tests inject their sanitized DOM boundary.
class Element {
  constructor(tagName, namespaceURI = "http://www.w3.org/1999/xhtml") {
    Object.assign(this, { tagName, namespaceURI, children: [], attributes: {}, dataset: {}, listeners: {}, style: {}, hidden: false });
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); }
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get textContent() { return this.tagName === "#text" ? this.nodeValue : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) {
    if (this.tagName === "#text") this.nodeValue = String(value);
    else this.replaceChildren(new Text(String(value)));
  }
  get parentElement() { return this.parent?.tagName.startsWith("#") ? null : this.parent; }
  get href() { return this.getAttribute("href") || ""; }
  set href(value) { this.setAttribute("href", value); }
  get target() { return this.getAttribute("target") || ""; }
  set target(value) { this.setAttribute("target", value); }
  get rel() { return this.getAttribute("rel") || ""; }
  set rel(value) { this.setAttribute("rel", value); }
  get tHead() { return this.querySelector("thead"); }
  get tBodies() { return this.querySelectorAll("tbody"); }
  get rows() { return this.children.filter((child) => child.tagName === "tr"); }
  get cells() { return this.children.filter((child) => ["th", "td"].includes(child.tagName)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) {
    for (let node of nodes) {
      if (typeof node === "string") node = new Text(node);
      if (node.tagName === "#fragment") { this.append(...[...node.children]); continue; }
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parent = null; });
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  before(node) {
    node.remove();
    node.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this), 0, node);
  }
  replaceWith(node) {
    this.before(node);
    this.remove();
    if (node.tagName === "#fragment") {
      [...node.children].forEach((child) => node.before(child));
      node.remove();
    }
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      const item = part.trim();
      if (item.startsWith(".")) return this.className.split(/\s+/).includes(item.slice(1));
      const [tag, attribute] = item.split("[");
      if (tag && tag !== this.tagName) return false;
      if (!attribute) return true;
      const [name, value] = attribute.slice(0, -1).split("=");
      return value ? this.getAttribute(name) === value.replaceAll('"', "").replaceAll("'", "") : this.getAttribute(name) !== null;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.tagName !== "#text" && child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  cloneNode(deep) {
    if (this.tagName === "#text") return new Text(this.nodeValue);
    const copy = new Element(this.tagName, this.namespaceURI);
    copy.attributes = { ...this.attributes };
    if (deep) copy.append(...this.children.map((child) => child.cloneNode(true)));
    return copy;
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, init = {}) {
    const event = { button: 0, isPrimary: true, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...init };
    for (const listener of this.listeners[type] || []) listener(event);
    return event;
  }
  focus() {}
  hasPointerCapture() { return false; }
}

class Text extends Element {
  constructor(value) { super("#text"); this.nodeValue = value; }
}

const frontend = (file) => fs.readFileSync(path.join(__dirname, "../../frontend", file), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(adapter = {}) {
  const document = {
    createElement: (tag) => new Element(tag),
    createElementNS: (namespace, tag) => new Element(tag, namespace),
    createTextNode: (value) => new Text(value),
    createDocumentFragment: () => new Element("#fragment"),
    documentElement: { clientHeight: 900 },
    createTreeWalker(root, _, filter) {
      const nodes = [];
      const visit = (element) => element.children.forEach((child) => {
        if (child.tagName === "#text" && filter.acceptNode(child) === 1) nodes.push(child);
        visit(child);
      });
      visit(root);
      return { nextNode: () => nodes.shift() || null };
    }
  };
  const window = { location: { origin: "https://workbench.invalid" }, innerWidth: 1280, listeners: {},
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    open() { throw new Error("Unexpected window.open"); } };
  const context = vm.createContext({ document, window, URL, NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    setTimeout, clearTimeout, navigator: {}, Blob, adapter, t: (key) => key });
  vm.runInContext(frontend("assistant-answer.js").replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
  // Run the actual source-list and turn-navigation functions without creating the
  // unrelated assistant/network/task UI or issuing any API/model/save calls.
  const assistant = frontend("assistant.js");
  const open = assistant.slice(assistant.indexOf("  let pdfSourceOpening = null;"), assistant.indexOf("  function renderMessages("));
  const list = assistant.slice(assistant.indexOf("  function appendSourceExcerpt("), assistant.indexOf("  function renderSources("));
  vm.runInContext(open + list, context);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    node.append(...children);
    return node;
  };
  function render(answer, nodes, sources, tableSources = [], onOpenSource = context.openTurnSource) {
    const fragment = document.createDocumentFragment();
    fragment.append(...nodes);
    context.renderAssistantMarkdown = (normalized) => {
      if (normalized !== answer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")) throw new Error("Wrong Markdown input");
      return { fragment, tableSources };
    };
    const container = el("div");
    context.renderAssistantAnswer(container, { answer, sources, language: "en", t: (key) => key, onOpenSource });
    return container;
  }
  return { context, document, window, el, render };
}

module.exports = { Element, fixture, frontend, settle };
