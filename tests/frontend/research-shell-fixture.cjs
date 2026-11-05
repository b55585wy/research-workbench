const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Only DOM ownership/events are modeled. Geometry, native details events and PDF stay with root.
function workspaceFixture({ search = "", owner = null, notesCallback = true } = {}) {
  let document;
  class Element {
    constructor(tagName) {
      Object.assign(this, { tagName, children: [], attributes: {}, dataset: {}, listeners: {}, textContent: "", hidden: false, open: false, disabled: false });
      this.classList = { add: (...names) => { this.className = [...new Set([...(this.className || "").split(" "), ...names])].join(" "); } };
    }
    get childElementCount() { return this.children.length; }
    get isConnected() { return document.contains(this); }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") this.className = String(value);
      if (name === "id") this.id = String(value);
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    prepend(...nodes) { for (const node of [...nodes].reverse()) { node.remove(); node.parentElement = this; this.children.unshift(node); } }
    insertBefore(node, before) {
      if (node === before) return;
      node.remove();
      const index = this.children.indexOf(before);
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
      node.parentElement = this;
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.textContent = ""; this.append(...nodes); }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    matches(selector) {
      if (selector === "[hidden]") return this.hidden;
      const exclusions = [...selector.matchAll(/:not\((#[\w-]+|:empty)\)/g)].map((match) => match[1]);
      if (exclusions.some((item) => item === ":empty" ? !this.children.length && !this.textContent.trim() : this.matches(item))) return false;
      const base = selector.replace(/:not\((?:#[\w-]+|:empty)\)/g, "");
      const tag = base.match(/^[\w-]+/)?.[0];
      if (tag && this.tagName !== tag) return false;
      const id = base.match(/#([\w-]+)/)?.[1];
      if (id && this.id !== id) return false;
      if ([...base.matchAll(/\.([\w-]+)/g)].some((match) => !(this.className || "").split(" ").includes(match[1]))) return false;
      return [...base.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every((match) => match[2] === undefined
        ? this.getAttribute(match[1]) !== null : this.getAttribute(match[1]) === match[2]);
    }
    querySelectorAll(selector) {
      if (selector.startsWith(":scope > ")) return this.children.filter((child) => child.matches(selector.slice(9)));
      return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    click() { if (!this.disabled) for (const callback of this.listeners.click || []) callback({ target: this }); }
    focus() { document.activeElement = this; }
    getClientRects() { return this.hidden ? [] : [{}]; }
  }
  document = new Element("document");
  document.createElement = (tag) => new Element(tag);
  document.createElementNS = (_, tag) => new Element(tag);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  const html = fs.readFileSync(path.join(__dirname, "../../frontend/index.html"), "utf8");
  const stack = [document];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  for (const token of html.match(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<![^>]*>|<\/?[\w-]+\b[^>]*>|[^<]+/gi) || []) {
    if (token.startsWith("<!") || /^<script\b/i.test(token)) continue;
    if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
    if (!token.startsWith("<")) { stack.at(-1).textContent += token; continue; }
    const tag = token.match(/^<([\w-]+)/)[1].toLowerCase();
    const element = new Element(tag);
    for (const match of token.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      element.setAttribute(match[1], match[2] ?? match[3] ?? match[4] ?? "");
      if (["hidden", "open", "disabled"].includes(match[1])) element[match[1]] = true;
    }
    stack.at(-1).append(element);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(element);
  }
  document.body = document.querySelector("body");
  document.activeElement = document.body;
  document.documentElement = document.querySelector("html");
  const location = new URL(`https://local.invalid/${search}`);
  const window = { location, history: {} };
  for (const method of ["pushState", "replaceState"]) window.history[method] = (_, __, url) => { window.location = new URL(url); };
  const commands = [];
  const errors = [];
  const adapter = {
    getDocument: () => owner, getLanguage: () => "en",
    modeSelected: (mode) => commands.push(["mode", mode]),
    modeRendered: (mode) => commands.push(["render", mode]),
    toolVisible: (tool) => commands.push(["tool", tool]),
    chartsSelected: (id) => commands.push(["charts", id]),
    ...(notesCallback ? { notesSectionRequested: (section) => commands.push(["notes", section]) } : {})
  };
  const context = vm.createContext({ document, window, URL, URLSearchParams,
    console: { error: (...args) => errors.push(args) },
    requestAnimationFrame: (callback) => callback(), MutationObserver: class { observe() {} }
  });
  const source = fs.readFileSync(path.join(__dirname, "../../frontend/workspace.js"), "utf8");
  vm.runInContext(source.replace("export function createWorkspace", "function createWorkspace"), context);
  const workspace = context.createWorkspace(adapter);
  return { workspace, document, window, commands, errors, setOwner: (next) => { owner = next; } };
}

module.exports = { workspaceFixture };
