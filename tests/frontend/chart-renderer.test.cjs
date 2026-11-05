const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createDOM } = require("./workspace-dom.cjs");

const frontend = path.resolve(__dirname, "../../frontend");
const read = (file) => fs.readFileSync(path.join(frontend, file), "utf8");
const chartsSource = read("charts.js"), rendererSource = read("chart-renderer.js");
const origin = "https://workbench.invalid";
const canonicalPath = "/vendor/plotly/4.2.0/plotly-strict.min.js";
const metadata = Object.freeze({ id: "plotly-strict", version: "4.2.0", script_url: canonicalPath,
  sha256: "20bef6b52c6e4422d87b10c619aaaee4c14e27ff4295e1fec1b51bf3e192fa2b", byte_size: 5183835 });
const kinds = ["analysis_counts", "histogram", "scatter", "grouped_points"];
const capabilities = (renderer = metadata) => ({ arbitrary_code: false, renderer, custom_skills: true,
  limits: { data_bytes: 4 * 1024 * 1024 }, items: kinds.map(id => ({ id, recipe_sha256: "a".repeat(64) })) });

// Match the asset-root rewriting in ui_publish.py without building or publishing a release.
const reserved = new Set(["api", "device", "storage", "_ui", "device-sw.js"]);
// The source-only candidate omits vendor bytes that are present in a release.
const roots = [...new Set([...fs.readdirSync(frontend), "vendor"])].filter(name => !reserved.has(name) && path.extname(name) !== ".html")
  .sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const assetPattern = new RegExp("([\"'`]|url\\(\\s*)/(" + roots.join("|") + ")(?=/|[?#\"'`\\s)$])", "g");
const rewrite = (source, prefix) => source.replace(assetPattern, (_match, start, root) => `${start}${prefix}/${root}`);
const flush = () => new Promise(resolve => setImmediate(resolve));

function evaluate(context, source, names, moduleURL) {
  const script = source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")
    .replaceAll("import.meta.url", JSON.stringify(moduleURL));
  return vm.runInContext(`(() => {\n${script}\nreturn { ${names.join(", ")} };\n})()`, context);
}

function fixture({ prefix = "", packed = false, getCapabilities = () => capabilities(), chartError = null } = {}) {
  const { document } = createDOM(), requests = [], scripts = [], nodes = {};
  for (const [, id] of chartsSource.matchAll(/byId\("([^"]+)"\)/g)) {
    const node = document.createElement("div"); node.id = id;
    document.body.append(node); nodes[id] = node;
  }
  const panel = nodes["charts-panel"];
  panel.open = true; panel.hidden = true; panel.rects = 1;
  panel.getClientRects = () => panel.rects ? [{}] : [];
  document.head = document.createElement("head");
  const append = document.head.append.bind(document.head);
  document.head.append = script => { scripts.push(script); append(script); };
  const window = { location: { origin } };
  const context = vm.createContext({ document, window, URL, AbortController, btoa,
    localStorage: { getItem: () => null } });
  const moduleURL = `${origin}${prefix}/chart-renderer.js`;
  const source = text => packed ? rewrite(text, prefix) : text;
  const renderer = evaluate(context, source(rendererSource), ["isChartRenderer", "CHART_RENDERER_URL"], moduleURL);
  const skills = evaluate(context, read("chart-skill-state.js"), ["frozenChartSkill", "chartSkillReference",
    "chartSkillsMatch", "chartSkillAllows", "chartSkillImageOptions", "visibleChartSkill"], moduleURL);
  Object.assign(context, renderer, skills);
  const module = evaluate(context, source(chartsSource), ["createCharts", "loadRenderer"], moduleURL);
  const charts = module.createCharts({ getLanguage: () => "en", api: async (url, options) => {
    requests.push({ url, method: options?.method || "GET" });
    if (url === "/api/v1/charts/capabilities") return getCapabilities();
    if (url.endsWith("/charts") && chartError) throw chartError;
    return { items: url.endsWith("/datasets") ? [{ id: "dataset:a", original_filename: "sample.csv",
      sha256: "b".repeat(64), columns: [{ name: "value", numeric: true }, { name: "other", numeric: true }] }] : [] };
  } });
  return { ...renderer, ...module, charts, requests, scripts, nodes, panel, window };
}

function invalidRenderers() {
  const invalid = [["missing", undefined], ["null", null], ["empty", {}]];
  const fields = {
    id: [undefined, "plotly", ""], version: [undefined, "4.2.1", 4.2],
    script_url: [undefined, "vendor/plotly/4.2.0/plotly-strict.min.js", `https://remote.invalid${canonicalPath}`,
      `//remote.invalid${canonicalPath}`, `${canonicalPath}?v=1`, `${canonicalPath}#hash`,
      "/vendor/plotly/4.2.0/../4.2.0/plotly-strict.min.js", "/vendor/plotly/4.2.0/./plotly-strict.min.js",
      "/vendor/plotly/4.2.0/%70lotly-strict.min.js", `/_ui/arbitrary${canonicalPath}`, `/other${canonicalPath}`],
    sha256: [undefined, "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64),
      `${metadata.sha256}\n`, `${metadata.sha256}\r\n`, ` ${metadata.sha256}`, [metadata.sha256]],
    byte_size: [undefined, 0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "5183835", true, null]
  };
  for (const [field, values] of Object.entries(fields)) {
    values.forEach((value, index) => invalid.push([`${field}[${index}]`, { ...metadata, [field]: value }]));
  }
  return invalid;
}

function assertReadOnly(f) {
  assert.ok(f.requests.every(request => request.method === "GET"));
  assert.ok(f.requests.every(request => request.url === "/api/v1/charts/capabilities" ||
    /^\/api\/v1\/documents\/paper%3A[ab]\/(charts|datasets|analyses)$/.test(request.url)));
}

function draftState(f) {
  return { title: f.nodes["chart-title"].value, bins: f.nodes["chart-bins"].value,
    dataset: f.nodes["chart-dataset"].value, revision: f.charts.getTeachingRevision("paper:a"),
    status: f.nodes["chart-status"].textContent, statusKind: f.nodes["chart-status"].dataset.kind };
}

test("canonical identity survives asset rewriting and resolves root and immutable release-local scripts", async () => {
  for (const prefix of ["", "/_ui/ui-test-one", "/_ui/ui-test-two"]) {
    const f = fixture({ prefix, packed: Boolean(prefix) });
    assert.equal(f.isChartRenderer(metadata), true);
    assert.equal(f.CHART_RENDERER_URL, `${origin}${prefix}${canonicalPath}`);
    assert.equal(new URL(f.CHART_RENDERER_URL).origin, origin);
    for (const byte_size of [1, Number.MAX_SAFE_INTEGER]) assert.equal(f.isChartRenderer({ ...metadata, byte_size }), true);
    await f.charts.reload("paper:a");
    assert.equal(f.charts.getSkillModel().available, true);
    assert.equal(f.nodes["chart-status"].textContent, "");
    const loading = f.loadRenderer(metadata);
    assert.equal(f.scripts[0].src, `${origin}${prefix}${canonicalPath}`);
    f.window.Plotly = {}; f.scripts[0].emit("load"); await loading;
  }
  const prefix = "/_ui/ui-test-one";
  assert.equal(rewrite(`const old = "${canonicalPath}";`, prefix), `const old = "${prefix}${canonicalPath}";`);
  assert.ok(rewrite(chartsSource, prefix).includes(`from "${prefix}/chart-renderer.js"`));
});

test("both capabilities and loader reject every invalid renderer identity, SHA and byte boundary", async () => {
  for (const [name, renderer] of invalidRenderers()) {
    const f = fixture({ getCapabilities: () => ({ ...capabilities(), renderer }) });
    assert.equal(f.isChartRenderer(renderer), false, name);
    await assert.rejects(f.loadRenderer(renderer), /invalidCapabilities/, name);
    await f.charts.reload("paper:a");
    assert.equal(f.nodes["chart-status"].dataset.kind, "error", name);
    assert.match(f.nodes["chart-status"].textContent, /capabilities/i, name);
    assert.equal(f.scripts.length, 0, name);
  }
});

test("capability limits, required recipes and arbitrary-code restrictions remain enforced", async () => {
  const invalid = [null, { ...capabilities(), arbitrary_code: true }, { ...capabilities(), items: null },
    { ...capabilities(), limits: { data_bytes: 0 } }, { ...capabilities(), items: capabilities().items.slice(1) },
    { ...capabilities(), items: kinds.map(id => ({ id, recipe_sha256: "bad" })) }];
  for (const body of invalid) {
    const f = fixture({ getCapabilities: () => body });
    await f.charts.reload("paper:a");
    assert.equal(f.nodes["chart-status"].dataset.kind, "error");
    assert.equal(f.scripts.length, 0);
  }
});

test("SRI and same-module pending/completed promises are reused without trusting an existing Plotly global", async () => {
  const f = fixture(); f.window.Plotly = { unrelated: true };
  const pending = f.loadRenderer(metadata);
  assert.equal(f.loadRenderer(metadata), pending);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].integrity, `sha256-${Buffer.from(metadata.sha256, "hex").toString("base64")}`);
  assert.equal(f.scripts[0].dataset.chartRenderer, metadata.sha256);
  assert.equal(f.scripts[0].async, true);
  const plotly = {}; f.window.Plotly = plotly; f.scripts[0].emit("load");
  assert.equal(await pending, plotly);
  assert.equal(await f.loadRenderer(metadata), plotly);
  assert.equal(f.scripts.length, 1);
  const next = { ...metadata, sha256: "c".repeat(64) };
  const changed = f.loadRenderer(next);
  assert.notEqual(changed, pending); assert.equal(f.scripts.length, 2);
  f.scripts[1].emit("load"); await changed;
});

test("network/integrity errors and missing Plotly reset the load and allow a checked retry", async () => {
  for (const event of ["error", "load"]) {
    const f = fixture();
    if (event === "error") f.window.Plotly = { unrelated: true };
    const failed = f.loadRenderer(metadata);
    const rejected = assert.rejects(failed, /renderFailed/);
    f.scripts[0].emit(event); await rejected;
    assert.equal(f.scripts[0].parentNode, null);
    const retry = f.loadRenderer(metadata);
    assert.notEqual(retry, failed); assert.equal(f.scripts.length, 2);
    assert.equal(f.loadRenderer(metadata), retry);
    f.window.Plotly = {}; f.scripts[1].emit("load"); await retry;
  }
});

test("paper-open and capabilities loading do not warm; hidden, closed, layout-hidden and ownerless refreshes do not warm", async () => {
  const empty = fixture(); empty.panel.hidden = false;
  empty.charts.refreshLayout(); await flush();
  assert.equal(empty.requests.length, 0); assert.equal(empty.scripts.length, 0);
  const f = fixture(); await f.charts.reload("paper:a"); await flush();
  assert.equal(f.scripts.length, 0);
  f.charts.refreshLayout();
  f.panel.hidden = false; f.panel.open = false; f.charts.refreshLayout();
  f.panel.open = true; f.panel.rects = 0; f.charts.refreshLayout(); await flush();
  assert.equal(f.scripts.length, 0);
  assert.equal(f.requests.filter(request => request.url.endsWith("/capabilities")).length, 1);
  assertReadOnly(f);
});

test("visible explicit refresh warms before a view exists, stays nonblocking and reuses pending/completed loads", async () => {
  const f = fixture({ prefix: "/_ui/ui-test-visible", packed: true });
  await f.charts.reload("paper:a"); f.panel.hidden = false;
  assert.equal(f.charts.refreshLayout(), undefined);
  f.nodes["chart-title"].value = "My draft"; f.nodes["chart-title"].emit("input");
  const before = draftState(f);
  f.charts.refreshLayout(); f.charts.refreshLayout(); await flush();
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].src, `${origin}/_ui/ui-test-visible${canonicalPath}`);
  assert.equal(f.nodes["chart-title"].disabled, false);
  assert.deepEqual(draftState(f), before);
  f.window.Plotly = {}; f.scripts[0].emit("load"); await flush();
  f.charts.refreshLayout(); await flush();
  assert.equal(f.scripts.length, 1); assert.deepEqual(draftState(f), before);
  assert.equal(f.requests.filter(request => request.url.endsWith("/capabilities")).length, 1);
  assertReadOnly(f);
});

test("delayed capabilities cannot start a download after hiding, closing or changing the owner", async () => {
  for (const change of [f => { f.panel.hidden = true; }, f => { f.panel.open = false; },
    f => { f.panel.rects = 0; }, f => f.charts.reload(null), f => f.charts.reload("paper:b")]) {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const f = fixture({ getCapabilities: () => pending });
    const opening = f.charts.reload("paper:a"); f.panel.hidden = false;
    f.charts.refreshLayout(); const changed = change(f);
    resolve(capabilities()); await opening; await changed; await flush();
    assert.equal(f.scripts.length, 0); assertReadOnly(f);
  }
});

test("background script failures preserve edited draft and existing error, remain handled and permit explicit retry", async () => {
  const f = fixture({ chartError: new Error("loadFailed") });
  await f.charts.reload("paper:a"); f.panel.hidden = false;
  f.nodes["chart-title"].value = "Keep this draft"; f.nodes["chart-title"].emit("input");
  f.nodes["chart-bins"].value = "37"; f.nodes["chart-bins"].emit("input");
  const before = draftState(f); assert.equal(before.statusKind, "error");
  f.charts.refreshLayout(); await flush(); f.scripts[0].emit("error"); await flush();
  assert.deepEqual(draftState(f), before);
  f.charts.refreshLayout(); await flush(); assert.equal(f.scripts.length, 2);
  f.window.Plotly = {}; f.scripts[1].emit("load"); await flush();
  assert.deepEqual(draftState(f), before); assertReadOnly(f);
});

test("background capability failures preserve status and draft without unhandled rejections or writes", async () => {
  const f = fixture({ getCapabilities: () => { throw new Error("offline"); } });
  await f.charts.reload("paper:a"); f.panel.hidden = false;
  const before = draftState(f);
  f.charts.refreshLayout(); f.charts.refreshLayout(); await flush();
  assert.equal(f.requests.filter(request => request.url.endsWith("/capabilities")).length, 2);
  assert.equal(f.scripts.length, 0); assert.deepEqual(draftState(f), before); assertReadOnly(f);
});
