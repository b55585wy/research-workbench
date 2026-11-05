// Small DOM fixture for node ownership/order, not a browser or Quill substitute.
class Node {
  constructor(document, tagName, id = "") {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    const classes = new Set();
    this.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) };
  }
  get children() { return this.childNodes.filter((node) => node.tagName !== "#COMMENT"); }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;
  }
  get hidden() { return this.attributes.has("hidden"); }
  set hidden(value) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  get open() { return this.attributes.has("open"); }
  set open(value) { if (value) this.setAttribute("open", ""); else this.removeAttribute("open"); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(node) { return this === node || this.childNodes.some((child) => child.contains(node)); }
  insertBefore(node, reference) {
    if (reference !== null && reference.parentNode !== this) throw new Error("Invalid reference");
    if (node === reference) return node;
    node.remove();
    const index = reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
}

function fixture() {
  const document = { createComment: () => new Node(document, "#comment") };
  const make = (tag, id) => new Node(document, tag, id);
  const root = make("main");
  const parent = make("aside");
  const container = make("section", "notes-workspace-host");
  root.append(parent, container);
  const hosts = { editor: make("details", "note-editor-group"), saved: make("details", "saved-notes-group"), images: make("details", "image-library") };
  const slots = {};
  for (const [section, host] of Object.entries(hosts)) {
    host.append(make("summary", `${section}-summary`), make("form", `${section}-content`));
    slots[section] = make("div");
    container.append(slots[section]);
  }
  parent.append(make("p", "before"), hosts.editor, make("p", "between"), hosts.saved, hosts.images, make("p", "after"));
  return { root, parent, container, hosts, slots, make };
}

function flatten(node) { return [node, ...node.childNodes.flatMap(flatten)]; }
module.exports = { fixture, flatten };
