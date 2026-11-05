const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripTypeScriptTypes } = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

// Exercise real component commands and mount ownership without installing deps or building.
// The renderer double does not verify React scheduling, browser semantics or layout.
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
function evaluate(file, globals) {
  const source = fs.readFileSync(path.join(__dirname, "../../web/src/features/research-shell", file), "utf8");
  const javascript = stripTypeScriptTypes(source).replace(/^import[^\n]*\n/gm, "").replace(/^export \{\};?\s*$/gm, "").replace(/export function /g, "function ");
  const context = vm.createContext(globals);
  vm.runInContext(javascript, context);
  return context;
}
const { ResearchShell } = evaluate("ResearchShell.ts", { h });
const baseModel = { language: "en", area: "reading", pending: false, libraryVisible: true, notesVisible: false };
function buttons(tree) { return tree.children.flatMap((child) => child.children).filter((child) => child.type === "button"); }

test("four real areas dispatch exactly one command each, while render and metadata updates dispatch none", () => {
  const commands = [];
  const callbacks = {
    onNavigate: (area) => commands.push(area), onLibrary: () => commands.push("library"),
    onNotes: () => commands.push("notes"), onAssistant: () => commands.push("assistant")
  };
  const tree = ResearchShell({ model: baseModel, callbacks });
  const controls = buttons(tree);
  assert.equal(controls.length, 7);
  assert.equal(commands.length, 0);
  for (const button of controls) button.props.onClick();
  assert.deepEqual(commands, ["reading", "analysis", "charts", "presentations", "library", "notes", "assistant"]);
  for (const area of ["reading", "analysis", "charts", "presentations"]) {
    const update = ResearchShell({ model: { ...baseModel, area, ownerTitle: "<untrusted source>" }, callbacks });
    assert.equal(buttons(update).filter((button) => button.props["aria-current"] === "page").length, 1);
    assert.equal(buttons(update).find((button) => button.props["aria-current"] === "page").props["data-research-area"], area);
  }
  assert.equal(commands.length, 7);
});

test("device capability scope exposes reading and panels without unavailable online areas", () => {
  const commands = [];
  const callbacks = { onNavigate: area => commands.push(area), onLibrary() {}, onNotes() {}, onAssistant() {} };
  const controls = buttons(ResearchShell({ model: { ...baseModel, availableAreas: ["reading"] }, callbacks }));
  const areas = controls.filter(button => button.props["data-research-area"]);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].props["data-research-area"], "reading");
  assert.equal(commands.length, 0);
  areas[0].props.onClick();
  assert.deepEqual(commands, ["reading"]);
});

test("native pending disables all area commands, panel actions remain explicit and icons decorative", () => {
  let navigations = 0;
  let panels = 0;
  const callbacks = { onNavigate: () => { navigations += 1; }, onLibrary: () => { panels += 1; }, onNotes() {}, onAssistant() {} };
  const tree = ResearchShell({ model: { ...baseModel, pending: true }, callbacks });
  assert.equal(tree.type, "nav");
  assert.equal(tree.children[0].props["aria-busy"], true);
  for (const button of buttons(tree).slice(0, 4)) {
    assert.equal(button.props.disabled, true);
    button.props.onClick();
    assert.equal(button.children[0].props["aria-hidden"], true);
    assert.equal(button.children[0].props.focusable, "false");
    assert.ok(button.props["aria-controls"]);
    assert.ok(button.props.title);
  }
  assert.equal(navigations, 0);
  buttons(tree)[4].props.onClick();
  assert.equal(panels, 1);
});

test("Chinese/English names and sidebar expanded states reflect the supplied model", () => {
  const callbacks = { onNavigate() {}, onLibrary() {}, onNotes() {}, onAssistant() {} };
  for (const language of ["zh", "en"]) {
    for (const visible of [true, false]) {
      const tree = ResearchShell({ model: { ...baseModel, language, libraryVisible: visible, notesVisible: visible }, callbacks });
      const controls = buttons(tree);
      assert.equal(controls[0].children[1].children[0], language === "zh" ? "阅读" : "Reading");
      for (const button of controls.slice(4, 6)) {
        assert.equal(button.props["aria-expanded"], visible);
        assert.ok(button.props["aria-label"].startsWith(language === "zh" ? visible ? "收起" : "展开" : visible ? "Collapse" : "Expand"));
      }
      assert.equal(controls[6].props["aria-expanded"], undefined);
    }
  }
});

test("mount/update run no commands; destroy/remount retires previous ownership and preserves the host", () => {
  const roots = [];
  let commands = 0;
  const context = evaluate("index.ts", {
    ResearchShell, createElement: (type, props) => type(props), flushSync: (callback) => callback(),
    createRoot: (container) => {
      const root = { container, renders: [], unmounts: 0, render(tree) { this.renders.push(tree); }, unmount() { this.unmounts += 1; } };
      roots.push(root);
      return root;
    }
  });
  const callbacks = { onNavigate: () => { commands += 1; }, onLibrary() {}, onNotes() {}, onAssistant() {} };
  const container = { nodeType: 1 };
  let committed = 0;
  const first = context.mountResearchShell({ container, model: baseModel, callbacks, onMounted: () => {
    assert.equal(roots[0].renders.length, 1);
    committed += 1;
  } });
  assert.equal(committed, 1);
  assert.equal(first.update({ ...baseModel, area: "presentations" }), true);
  assert.equal(roots.length, 1);
  const second = context.mountResearchShell({ container, model: baseModel, callbacks });
  assert.equal(roots[0].unmounts, 1);
  assert.equal(first.update(baseModel), false);
  first.destroy();
  assert.equal(roots[1].unmounts, 0);
  second.destroy(); second.destroy();
  assert.equal(roots[1].unmounts, 1);
  assert.equal(roots[1].container, container);
  assert.equal(commands, 0);
  assert.throws(() => context.mountResearchShell({ container: {}, model: baseModel, callbacks }), /host/);
});

test("mount notification errors clean up the root before propagating to the bridge", () => {
  let unmounts = 0;
  const context = evaluate("index.ts", { ResearchShell, createElement: h,
    flushSync: (callback) => callback(), createRoot: () => ({ render() {}, unmount() { unmounts += 1; } }) });
  assert.throws(() => context.mountResearchShell({ container: { nodeType: 1 }, model: baseModel, callbacks: {},
    onMounted() { throw new Error("notification failed"); } }), /notification failed/);
  assert.equal(unmounts, 1);
});
