// Minimal DOM for native lifecycle checks; it does not simulate browser layout.
function createDOM() {
  const document = { activeElement: null };
  class Element {
    constructor(tagName) {
      Object.assign(this, { tagName, children: [], parentNode: null, attributes: {}, listeners: {}, dataset: {}, className: "", open: false, hidden: false, disabled: false, value: "", files: [] });
      this.ownText = "";
    }
    get parentElement() { return this.parentNode; }
    get textContent() { return this.ownText + this.children.map((node) => node.textContent).join(""); }
    set textContent(value) { this.replaceChildren(); this.ownText = value; }
    append(...nodes) {
      for (const node of nodes) {
        node.remove();
        node.parentNode = this;
        this.children.push(node);
      }
    }
    appendChild(node) { this.append(node); return node; }
    prepend(node) { this.insertBefore(node, this.children[0]); }
    insertBefore(node, reference) {
      node.remove();
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
      node.parentNode = this;
    }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
      this.parentNode = null;
    }
    replaceChildren(...nodes) {
      this.children.forEach((node) => { node.parentNode = null; });
      this.children = [];
      this.ownText = "";
      this.append(...nodes);
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") this.className = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    matches(selector) {
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
      return this.tagName === selector;
    }
    querySelectorAll(selector) {
      return this.children.flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    emit(type, values = {}) {
      const event = { target: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
      for (const callback of this.listeners[type] || []) callback(event);
      return event;
    }
    click() { if (!this.disabled) { this.clicks = (this.clicks || 0) + 1; this.emit("click"); } }
    focus() { document.activeElement = this; }
  }
  document.body = new Element("body");
  document.createElement = (tag) => new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.createComment = () => new Element("#comment");
  document.getElementById = (id) => document.body.querySelector(`#${id}`);
  document.querySelector = (selector) => document.body.querySelector(selector);
  const header = document.createElement("header");
  header.className = "app-header";
  const root = document.createElement("div");
  root.id = "device-storage-ui";
  const input = document.createElement("input");
  input.id = "device-backup-input";
  const controls = document.createElement("div");
  controls.className = "header-controls";
  const settings = document.createElement("div");
  const slot = document.createElement("div");
  settings.append(slot);
  header.append(root, input, controls, settings);
  document.body.append(header);
  return { document, header, root, input, controls, settings, slot };
}

module.exports = { createDOM };
