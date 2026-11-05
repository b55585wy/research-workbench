const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { modules, evaluate, base, example, progress, deferred, fixture, choose, h, nodes, content, id } = require("./teaching-data-fixture.cjs");
let TeachingData;
test.before(async () => { TeachingData = evaluate("TeachingData.tsx", { h, ...await modules }, ["TeachingData"]).TeachingData; });
const render = c => TeachingData({ controller: c, state: c.state, idPrefix: "teaching-test" });
function find(tree, type, label) {
  return nodes(tree).find(node => node.type === type && (!label || node.props["aria-label"] === label || content(node) === label));
}
function button(tree, label) { const result = find(tree, "button", label); assert.ok(result, label); return result; }

test("compact bilingual closed view, explicit scenarios and read-only review cause no native calls", async () => {
  for (const language of ["en", "zh"]) {
    const f = await fixture({ ...base, language }); const text = (await modules).teachingCopy[language];
    let tree = render(f.controller);
    assert.equal(tree.type, "section"); assert.equal(tree.props.lang, language);
    assert.equal(nodes(tree).filter(node => node.type === "button").length, 1);
    const trigger = button(tree, text.trigger); assert.equal(trigger.props["aria-expanded"], false);
    const svg = find(tree, "svg"); assert.equal(svg.props["aria-hidden"], true); assert.equal(svg.props.focusable, "false");
    trigger.props.onClick(); tree = render(f.controller);
    const scenarios = nodes(tree).filter(node => node.props.className === "teaching-data-scenario");
    assert.equal(scenarios.length, 4);
    for (const scenario of scenarios) { assert.match(content(scenario), new RegExp(text.synthetic)); assert.ok(scenario.props["aria-label"]); }
    scenarios[0].props.onClick(); tree = render(f.controller);
    assert.match(content(tree), new RegExp(text.design)); assert.match(content(tree), new RegExp(text.rowMeaning));
    assert.match(content(tree), /Outcome|中 Outcome/); assert.match(content(tree), /points/); assert.match(content(tree), /Non-numeric|非数值/);
    assert.equal(nodes(tree).filter(node => node.type === "table").length, 2);
    assert.equal(nodes(tree).filter(node => node.type === "form" || node.type === "input").length, 0);
    for (const control of nodes(tree).filter(node => node.type === "button")) assert.equal(control.props.type, "button");
    let submits = 0; nodes(tree).find(node => node.props.id === "teaching-test-panel").props.onSubmit({ preventDefault: () => { submits += 1; } });
    assert.equal(submits, 1); button(tree, text.back).props.onClick(); button(render(f.controller), text.cancel).props.onClick();
    assert.equal(f.controller.state.open, false); assert.equal(f.calls.length, 0); assert.equal(f.continuations.length, 0); assert.equal(f.refreshes.length, 0);
  }
});

test("review renders literal hostile strings, zero/missing/unit values and at most supplied five aligned rows", async () => {
  const input = example(); input.title.en = "<img src=x onerror=alert(1)>";
  input.rowCount = 50; input.previewRows = Array.from({ length: 5 }, () => ["0", "<script>literal</script>"]);
  const f = await fixture({ ...base, examples: [input] }); choose(f.controller); let tree = render(f.controller);
  assert.match(content(tree), /<img src=x onerror=alert\(1\)>/); assert.match(content(tree), /<script>literal<\/script>/);
  assert.equal(nodes(tree).some(node => node.type === "script" || node.type === "img" || node.props.dangerouslySetInnerHTML), false);
  const tables = nodes(tree).filter(node => node.type === "table");
  assert.equal(nodes(tables[1]).filter(node => node.type === "tbody")[0].children.length, 5);
  assert.match(content(tables[0]), /—1/); assert.ok(nodes(tables[0]).some(node => node.type === "td" && content(node) === "0"));
  for (const scroll of nodes(tree).filter(node => node.props.className === "teaching-data-table-scroll")) {
    assert.equal(scroll.props.tabIndex, 0); assert.equal(scroll.props.role, "region"); assert.ok(scroll.props["aria-label"]);
  }
  f.controller.update({ ...base, examples: [{ ...example(), previewRows: [] }] }); tree = render(f.controller);
  assert.match(content(tree), /No preview rows supplied/);
});

test("availability/loading/global busy are distinct; explicit refresh and import actions have correct gates", async () => {
  for (const availability of ["ready", "loading", "unavailable"]) {
    const f = await fixture({ ...base, examples: [example("describe", availability)] }); choose(f.controller);
    const tree = render(f.controller); assert.equal(button(tree, "Import and continue").props.disabled, availability !== "ready");
    if (availability === "loading") assert.match(content(tree), /Checking availability/);
    if (availability === "unavailable") assert.match(content(tree), /Runtime unavailable/);
    assert.equal(button(tree, "Refresh availability").props.disabled, false);
    button(tree, "Refresh availability").props.onClick(); await Promise.resolve();
    assert.equal(f.refreshes.length, 1); assert.equal(f.calls.length, 0);
  }
  for (const model of [{ ...base, busy: true }, { ...base, available: false }, { ...base, ownerId: null }]) {
    const f = await fixture(model); choose(f.controller); const tree = render(f.controller);
    assert.equal(button(tree, "Import and continue").props.disabled, true); assert.equal(button(tree, "Refresh availability").props.disabled, true);
  }
});

test("pending disables discard; errors expose exact retry/discard and detached requests hide unrelated preview", async () => {
  const reply = deferred(); const f = await fixture(base, { onImport: () => reply.promise }); choose(f.controller);
  const importing = f.controller.importSelected(); let tree = render(f.controller);
  assert.match(content(tree), /Importing/); assert.equal(find(tree, "button", "Discard request"), undefined);
  assert.equal(find(tree, "button", "Import and continue"), undefined);
  reply.reject(new Error("unknown")); await importing; tree = render(f.controller);
  assert.ok(button(tree, "Retry exact import")); assert.ok(button(tree, "Discard request"));
  assert.ok(nodes(tree).some(node => node.props.role === "alert"));
  f.setConfirm(false); button(tree, "Discard request").props.onClick(); assert.equal(f.controller.hasUnsavedWork(), true);
  f.controller.update({ ...base, ownerId: "paper:b" }); tree = render(f.controller);
  assert.match(content(tree), /another workspace/); assert.equal(nodes(tree).filter(node => node.type === "table").length, 0);
  assert.equal(button(tree, "Retry exact import").props.disabled, true); assert.equal(button(tree, "Discard request").props.disabled, false);
});

test("Escape closes passive review and restores trigger focus; pending/uncertain requests remain open", async () => {
  let focused = 0, prevented = 0, stopped = 0;
  const event = { key: "Escape", preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; },
    currentTarget: { querySelector: () => ({ focus: () => { focused += 1; } }) } };
  const f = await fixture(); choose(f.controller); render(f.controller).props.onKeyDown(event);
  assert.equal(f.controller.state.open, false); assert.equal(focused, 1); assert.deepEqual(f.confirmations, []);
  const reply = deferred(); const g = await fixture(base, { onImport: () => reply.promise }); choose(g.controller);
  const importing = g.controller.importSelected(); render(g.controller).props.onKeyDown(event);
  assert.equal(g.controller.state.open, true); assert.equal(focused, 1);
  reply.reject(new Error()); await importing; render(g.controller).props.onKeyDown(event);
  assert.equal(g.controller.state.open, true); assert.equal(focused, 1); assert.equal(prevented, 3); assert.equal(stopped, 3);
});

test("compact synthetic progress shows actual stages and explicit ready actions, hides unknown examples", async () => {
  for (const [stage, actions, label] of [["imported", ["Open analysis"], "Imported"],
    ["analyzed", ["Open analysis", "Open charts"], "Analysis ready"],
    ["charted", ["Open analysis", "Open charts", "Open presentations"], "Chart saved"]]) {
    const f = await fixture({ ...base, progress: progress(stage) }); const tree = render(f.controller);
    assert.match(content(tree), /Synthetic data/); assert.match(content(tree), new RegExp(label));
    for (const action of ["Open analysis", "Open charts", "Open presentations"]) assert.equal(!!find(tree, "button", action), actions.includes(action));
    assert.deepEqual(f.continuations, []); button(tree, actions.at(-1)).props.onClick(); await Promise.resolve();
    assert.equal(f.continuations.length, 1); assert.equal(f.calls.length, 0);
  }
  const f = await fixture({ ...base, progress: progress("charted", { exampleId: "unknown" }) });
  assert.equal(nodes(render(f.controller)).filter(node => node.type === "button").length, 1);
});

test("320/390px structural layout: bounded internal scrolling, sticky actions, wrap/focus and 44px coarse targets", () => {
  // These assertions do not measure browser layout. Root owns screenshots and integration.
  const css = fs.readFileSync(path.resolve(__dirname, "../../frontend/teaching-data.css"), "utf8");
  for (const rule of [/min-width:\s*0/, /max-width:\s*100%/, /flex-wrap:\s*wrap/, /overflow-x:\s*auto/,
    /overflow-y:\s*auto/, /max-height:.*100dvh/, /position:\s*sticky/, /z-index:\s*60/,
    /:focus-visible/, /@media \(max-width: 480px\), \(pointer: coarse\)/, /min-height:\s*44px/]) assert.match(css, rule);
  assert.doesNotMatch(css, /min-width:\s*\d+px|@import|https?:|url\(/);
});

async function mountFixture() {
  let last, fail = false, unmountFails = false, focus = [];
  const listeners = new Map(); const roots = [];
  const view = { crypto: { randomUUID: () => id }, confirm: () => true,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const container = { childNodes: [], ownerDocument: { defaultView: view },
    querySelector: selector => ({ focus: () => { focus.push(selector); } }) };
  const createRoot = () => {
    const root = { render: tree => { if (fail) throw new Error("render failure"); last = tree; container.childNodes = [tree]; },
      unmount: () => { container.childNodes = []; if (unmountFails) throw new Error("unmount failure"); } };
    roots.push(root); return root;
  };
  const mount = evaluate("index.tsx", { h, flushSync: fn => fn(), createRoot, TeachingData, ...await modules }, ["mountTeachingData"]).mountTeachingData;
  return { mount, container, listeners, roots, last: () => last, focus: () => focus, setFail: value => { fail = value; }, setUnmountFail: value => { unmountFails = value; } };
}

test("mount enforces empty single-owner host, synchronous navigation, beforeunload and focus/cleanup/remount", async () => {
  const f = await mountFixture(); let mounted = 0, imports = 0, refreshes = 0; const locks = [];
  const callbacks = { onImport: async () => { imports += 1; throw new Error(); }, onContinue: () => true,
    onRefresh: () => { refreshes += 1; }, onLockChange: value => locks.push(value) };
  const options = { container: f.container, model: base, callbacks, onMounted: () => { mounted += 1; } };
  const handle = f.mount(options); assert.equal(mounted, 1); assert.equal(imports, 0); assert.equal(refreshes, 0);
  assert.equal(f.listeners.size, 1); assert.throws(() => f.mount(options), /empty/);
  const c = f.last().props.controller; let prevented = 0; const event = { preventDefault: () => { prevented += 1; } };
  choose(c); f.listeners.get("beforeunload")(event); assert.equal(prevented, 0);
  assert.ok(f.focus().includes("[data-teaching-review-heading]"));
  assert.equal(handle.prepareNavigation(), true); assert.equal(f.focus().at(-1), "[data-teaching-trigger]");
  choose(c); await c.importSelected(); f.listeners.get("beforeunload")(event);
  assert.equal(prevented, 1); assert.equal(event.returnValue, ""); assert.equal(handle.prepareNavigation(), false);
  assert.equal(typeof handle.prepareNavigation(), "boolean"); assert.equal(handle.hasUnsavedWork(), true);
  c.discardRequest(); assert.equal(f.focus().at(-1), "[data-teaching-trigger]");
  handle.destroy(); handle.destroy(); assert.equal(f.listeners.size, 0); assert.equal(f.container.childNodes.length, 0);
  assert.equal(handle.update(base), false); assert.deepEqual(locks, [true, false]);
  const remounted = f.mount(options); remounted.destroy();
  f.container.childNodes = [{}]; assert.throws(() => f.mount(options), /empty/);
});

test("mount/update/render failures preserve native boundaries and retain pending request guard until explicit destroy", async () => {
  const f = await mountFixture(); const reply = deferred(); const callbacks = { onImport: () => reply.promise, onContinue: () => true, onRefresh() {} };
  const options = { container: f.container, model: base, callbacks };
  assert.throws(() => f.mount({ ...options, callbacks: {} }), /callbacks/);
  f.setFail(true); assert.throws(() => f.mount(options), /render/); assert.equal(f.listeners.size, 0); assert.equal(f.container.childNodes.length, 0);
  f.setFail(false); assert.throws(() => f.mount({ ...options, onMounted: () => { throw new Error("host callback"); } }), /host callback/);
  assert.equal(f.listeners.size, 0); assert.equal(f.container.childNodes.length, 0);
  const handle = f.mount(options); const c = f.last().props.controller; choose(c); const importing = c.importSelected();
  f.setFail(true); assert.equal(handle.update({ ...base, language: "zh" }), false);
  assert.equal(handle.hasUnsavedWork(), true); assert.equal(handle.prepareNavigation(), false); assert.equal(f.listeners.size, 1);
  f.setFail(false); assert.equal(handle.update(base), true);
  f.setUnmountFail(true); assert.throws(() => handle.destroy(), /unmount/); assert.equal(f.listeners.size, 0);
  f.setUnmountFail(false); const remounted = f.mount(options); remounted.destroy();
  reply.resolve({ status: "imported", datasetId: "dataset:a" }); assert.equal(await importing, false);
});
