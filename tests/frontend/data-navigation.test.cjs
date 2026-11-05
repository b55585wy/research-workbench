const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Exercise the real generator/controller; native keyboard and geometry stay with root.
function fixture(apiResponse = () => ({ items: [] })) {
  class Element {
    constructor(tagName, namespaceURI = "http://www.w3.org/1999/xhtml") {
      Object.assign(this, { tagName, namespaceURI, children: [], attributes: {}, listeners: {}, dataset: {}, value: "", textContent: "" });
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; this.textContent = ""; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    dispatch(name) { for (const listener of this.listeners[name] || []) listener({ preventDefault() {} }); }
  }
  const root = new Element("section");
  const requests = [];
  const opened = [];
  let personalOpens = 0;
  const document = {
    getElementById(id) { assert.equal(id, "data-navigation"); return root; },
    createElement: (tag) => new Element(tag),
    createElementNS: (namespace, tag) => new Element(tag, namespace)
  };
  const context = vm.createContext({ document, AbortController, URLSearchParams, setTimeout, clearTimeout });
  const source = fs.readFileSync(path.join(__dirname, "../../frontend/data-navigation.js"), "utf8");
  vm.runInContext(source.replace("export function createDataNavigation", "function createDataNavigation"), context);
  const navigation = context.createDataNavigation({
    getLanguage: () => "en",
    api: async (url) => { requests.push(url); return apiResponse(new URL(url, "https://local.invalid").searchParams); },
    openCatalogItem: (item) => opened.push(item),
    openPersonalData: () => { personalOpens += 1; }
  });
  return { root, groups: root.children[2].children, navigation, requests, opened, personalOpens: () => personalOpens };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("all data groups use one native summary with a decorative chevron, icon and original h3", () => {
  const f = fixture();
  assert.deepEqual(f.groups.map((group) => group.open), [true, false, false]);
  for (const [index, group] of f.groups.entries()) {
    assert.equal(group.tagName, "details");
    const [summary, list] = group.children;
    assert.equal(summary.tagName, "summary");
    assert.equal(summary.className, "data-catalog-group-summary sidebar-group-summary");
    assert.deepEqual(summary.children.map((node) => node.tagName), ["svg", "svg", "h3"]);
    assert.deepEqual(summary.children.slice(0, 2).map((node) => node.getAttribute("class")), ["sidebar-chevron", "sidebar-nav-icon"]);
    for (const icon of summary.children.slice(0, 2)) {
      assert.equal(icon.namespaceURI, "http://www.w3.org/2000/svg");
      assert.equal(icon.getAttribute("aria-hidden"), "true");
      assert.equal(icon.getAttribute("focusable"), "false");
      assert.equal(icon.getAttribute("stroke"), "currentColor");
      assert.ok(icon.children[0].getAttribute("d"));
    }
    const title = ["Datasets", "Analyses", "Charts"][index];
    assert.equal(summary.children[2].textContent, title);
    assert.equal(list.getAttribute("aria-label"), title);
    assert.deepEqual(Object.keys(summary.listeners), []);
    assert.deepEqual(Object.keys(group.listeners), []);
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.opened.length + f.personalOpens(), 0);
});

test("fold state and summary identity survive language, pending and document renders without actions", () => {
  const f = fixture();
  const summaries = f.groups.map((group) => group.children[0]);
  f.groups.forEach((group, index) => { group.open = index !== 0; });
  for (const language of ["zh", "en", "zh"]) {
    f.navigation.applyLanguage(language);
    f.navigation.setNavigationPending(true);
    f.navigation.documentChanged();
    f.navigation.setNavigationPending(false);
    assert.deepEqual(f.groups.map((group) => group.open), [false, true, true]);
    f.groups.forEach((group, index) => assert.equal(group.children[0], summaries[index]));
  }
  assert.deepEqual(f.groups.map((group) => group.children[0].children[2].textContent), ["数据集", "分析", "图表"]);
  f.groups.forEach((group) => { group.open = !group.open; group.dispatch("toggle"); });
  assert.equal(f.requests.length, 0);
  assert.equal(f.opened.length + f.personalOpens(), 0);
});

test("catalog pagination, item and personal callbacks remain explicit and folding never loads", async () => {
  const item = { id: "dataset-1", document_id: "paper-1", owner_kind: "paper", title: "<long data title>" };
  const f = fixture((params) => params.get("kind") === "dataset"
    ? { items: [item], next_cursor: params.has("cursor") ? null : "page-2" } : { items: [] });
  f.navigation.setMode("data");
  await settle();
  assert.equal(f.requests.length, 3);
  const dataset = f.groups[0];
  const rowButton = dataset.children[1].children[0].children[0];
  assert.equal(rowButton.children[0].textContent, item.title);
  rowButton.dispatch("click");
  assert.equal(f.opened[0], item);
  f.root.children[0].children[1].dispatch("click");
  assert.equal(f.personalOpens(), 1);
  dataset.open = false;
  dataset.dispatch("toggle");
  f.navigation.applyLanguage("zh");
  f.navigation.documentChanged();
  assert.equal(f.requests.length, 3);
  dataset.children[3].dispatch("click");
  await settle();
  assert.equal(f.requests.length, 4);
  assert.match(f.requests[3], /cursor=page-2/);
  assert.equal(dataset.children[1].children.length, 1);
  assert.equal(dataset.children[3].hidden, true);
  assert.equal(dataset.open, false);
});

test("an existing failure retry stays explicit across language and fold changes", async () => {
  let fail = true;
  const f = fixture((params) => {
    if (params.get("kind") === "analysis" && fail) throw new Error("catalog unavailable");
    return { items: [] };
  });
  f.navigation.setMode("data");
  await settle();
  const analysis = f.groups[1];
  assert.equal(analysis.open, true);
  analysis.open = false;
  analysis.dispatch("toggle");
  f.navigation.applyLanguage("zh");
  assert.equal(f.requests.length, 3);
  assert.equal(analysis.open, false);
  fail = false;
  analysis.children[2].children[1].dispatch("click");
  await settle();
  assert.equal(f.requests.length, 4);
  assert.equal(analysis.children[2].textContent, "没有匹配的记录。");
  assert.equal(analysis.open, false);
});
