const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { modules, base, spec, record, snapshot, fixture, evaluate, h, nodes, content } = require("./chart-skills-fixture.cjs");
let ChartSkillPicker;
test.before(async () => {
  ChartSkillPicker = evaluate("ChartSkillPicker.tsx", { h, ...await modules }, ["ChartSkillPicker"]).ChartSkillPicker;
});
const render = controller => ChartSkillPicker({ controller, state: controller.state, idPrefix: "test-skills" });
const find = (tree, type, label) => nodes(tree).find(node => node.type === type && (!label || node.props["aria-label"] === label || content(node) === label));
const fieldInput = (tree, label) => nodes(tree).find(node => node.type === "label" && content(node.children[0]) === label)?.children[1];

test("compact bilingual selector exposes labeled outline actions; render and history updates issue no POST", async () => {
  for (const language of ["en", "zh"]) {
    const f = await fixture({ ...base, language, selected: snapshot(record(1)) }, async () => ({ items: [record(3)] }));
    await f.controller.load(); const tree = render(f.controller);
    assert.equal(tree.type, "section"); assert.equal(tree.props.lang, language);
    assert.equal(nodes(tree).filter(node => node.type === "form").length, 0);
    const picker = nodes(tree).find(node => node.props["data-skill-select"]);
    assert.equal(picker.children.length, 3); assert.match(content(picker.children[1]), /v1/); assert.match(content(picker.children[2]), /v3/);
    for (const button of nodes(tree).filter(node => node.props.className === "chart-skill-icon")) {
      assert.ok(button.props["aria-label"]); assert.equal(button.props.title, button.props["aria-label"]);
      assert.equal(button.children[0].props["aria-hidden"], true); assert.equal(button.children[0].props.focusable, "false");
    }
    const file = nodes(tree).find(node => node.props.type === "file"); assert.ok(file.props["aria-label"]);
    assert.equal(f.calls.length, 1); assert.equal(f.selections.length, 0);
  }
});

test("explicit editor actions expose all required fields, actual requirements and numeric bounds", async () => {
  const f = await fixture(); find(render(f.controller), "button", "New skill").props.onClick();
  let tree = render(f.controller); assert.equal(find(tree, "form").props["aria-label"], "Figure skill editor");
  assert.equal(fieldInput(tree, "Name").props.autoFocus, true);
  for (const label of ["Name", "Purpose", "Chart type", "Font", "Font size", "Line width", "Marker size", "Width", "Height", "Bins"]) {
    assert.ok(fieldInput(tree, label), label);
  }
  for (const [kind, expected] of [["analysis_counts", /saved analysis/], ["histogram", /one numeric X/], ["scatter", /distinct numeric/], ["grouped_points", /exactly two valid groups/]]) {
    fieldInput(tree, "Chart type").props.onChange({ currentTarget: { value: kind } }); tree = render(f.controller);
    assert.match(content(nodes(tree).find(node => node.props.id === "test-skills-requirement")), expected);
    assert.equal(f.controller.state.editor.spec.chart.bins, kind === "histogram" ? 20 : null);
  }
  const fontSize = fieldInput(tree, "Font size"); assert.equal(fontSize.props.min, 8); assert.equal(fontSize.props.max, 24);
  assert.equal(fieldInput(tree, "Font").props["aria-label"], "Font");
  assert.equal(fieldInput(tree, "Chart type").props["aria-label"], "Chart type");
  assert.equal(nodes(tree).filter(node => node.props.type === "checkbox").length, 3);
  assert.equal(nodes(tree).filter(node => node.props.type === "color").length, 4);
  assert.equal(f.calls.length, 0);
});

test("keyboard Escape respects discard cancellation and returns focus after confirmed close", async () => {
  const f = await fixture(); f.controller.newSkill(); f.controller.change(spec()); f.setConfirm(false);
  let focused = 0, prevented = 0, stopped = 0;
  const event = { key: "Escape", preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; },
    currentTarget: { closest: () => ({ querySelector: () => ({ focus: () => { focused += 1; } }) }) } };
  find(render(f.controller), "form").props.onKeyDown(event);
  assert.ok(f.controller.state.editor); assert.equal(focused, 0); f.setConfirm(true);
  find(render(f.controller), "form").props.onKeyDown(event);
  assert.equal(f.controller.state.editor, null); assert.equal(focused, 1); assert.equal(prevented, 2); assert.equal(stopped, 2);
});

test("busy/unavailable UI is disabled, pending exposes exact retry/discard, and export is spec only", async () => {
  const f = await fixture({ ...base, selected: snapshot() }, async () => { throw new Error("offline"); });
  f.controller.editSelected(); await f.controller.save(); let tree = render(f.controller);
  assert.ok(find(tree, "button", "Retry exact save")); assert.ok(find(tree, "button", "Discard save request"));
  assert.equal(nodes(tree).find(node => node.props["data-skill-select"]).props.disabled, true);
  assert.ok(nodes(tree).some(node => node.props.role === "alert"));
  find(tree, "button", "Export skill JSON").props.onClick(); assert.deepEqual(f.downloads[0].value, spec());
  f.controller.update({ ...base, available: false, selected: snapshot() }); tree = render(f.controller);
  assert.match(content(tree), /unavailable/); assert.equal(find(tree, "button", "New skill").props.disabled, true);
  assert.equal(find(tree, "button", "Retry exact save").props.disabled, true);
});

test("320/390px layout rules use wrapping actions, shrinkable fields and bounded two-column controls", () => {
  // Structural smoke only: root acceptance owns actual browser layout and screenshots.
  const css = fs.readFileSync(path.resolve(__dirname, "../../frontend/chart-skills.css"), "utf8");
  assert.match(css, /flex-wrap:\s*wrap/); assert.match(css, /min-width:\s*0/);
  assert.match(css, /repeat\(2,\s*minmax\(0,\s*1fr\)\)/); assert.match(css, /max-width:\s*100%/);
  assert.match(css, /@media \(max-width: 480px\)/); assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /min-width:\s*\d+px/); assert.doesNotMatch(css, /@import|https?:|url\(/);
});

test("mount ownership, beforeunload, object URLs and destroy/remount clean up without real React/browser claims", async () => {
  const callbacks = { api: async () => ({ items: [] }), onSelect() {} };
  const listeners = new Map(), timers = new Map(), revoked = [], blobs = [];
  const view = { confirm: () => true, crypto: { randomUUID: () => record().id },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setTimeout: (fn, timeout) => { timers.set(1, { fn, timeout }); return 1; }, clearTimeout: id => timers.delete(id) };
  let clicks = 0, last, shouldFail = false;
  const container = { childNodes: [], ownerDocument: { defaultView: view, body: { append() {} },
    createElement: () => ({ click: () => { clicks += 1; }, remove() {} }) } };
  const roots = [];
  const createRoot = () => {
    const root = { render: tree => { if (shouldFail) throw new Error("renderer failed"); last = tree; container.childNodes = [tree]; },
      unmount: () => { container.childNodes = []; } }; roots.push(root); return root;
  };
  const { mountChartSkills } = evaluate("index.tsx", {
    h, flushSync: fn => fn(), createRoot, ChartSkillPicker, ...await modules, queueMicrotask,
    URL: { createObjectURL: blob => { blobs.push(blob); return "blob:skill"; }, revokeObjectURL: url => revoked.push(url) }, Blob
  }, ["mountChartSkills"]);
  let mounts = 0;
  const mounted = mountChartSkills({ container, model: { ...base, selected: snapshot() }, callbacks, onMounted: () => { mounts += 1; } });
  assert.equal(mounts, 1); assert.equal(listeners.size, 1);
  assert.throws(() => mountChartSkills({ container, model: base, callbacks }), /empty/);
  let prevented = 0; const event = { preventDefault: () => { prevented += 1; } };
  listeners.get("beforeunload")(event); assert.equal(prevented, 0);
  last.props.controller.newSkill(); last.props.controller.change(spec());
  listeners.get("beforeunload")(event); assert.equal(prevented, 1); assert.equal(event.returnValue, "");
  assert.equal(mounted.hasUnsavedWork(), true); assert.equal(await mounted.prepareNavigation(), true);
  last.props.controller.exportSelected(); assert.equal(clicks, 1); assert.equal(timers.size, 1);
  const exported = JSON.parse(await blobs[0].text()); assert.deepEqual(exported, spec());
  mounted.destroy(); mounted.destroy(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0);
  assert.deepEqual(revoked, ["blob:skill"]); assert.equal(container.childNodes.length, 0);
  assert.equal(mounted.update(base), false);
  const remount = mountChartSkills({ container, model: base, callbacks }); shouldFail = true;
  assert.equal(remount.update({ ...base, language: "zh" }), false); assert.equal(listeners.size, 0);
  assert.equal(container.childNodes.length, 0); shouldFail = false;
  assert.throws(() => mountChartSkills({ container, model: base, callbacks, onMounted: () => { throw new Error("callback"); } }), /callback/);
  assert.equal(listeners.size, 0); assert.equal(container.childNodes.length, 0);
});
