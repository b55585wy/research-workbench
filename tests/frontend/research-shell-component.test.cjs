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
const areas = ["reading", "analysis", "charts", "presentations"];
function nodes(tree, type) {
  if (!tree || typeof tree !== "object") return [];
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap((child) => nodes(child, type))];
}
function buttons(tree) { return nodes(tree, "button"); }
function recordCommands() {
  const commands = [];
  return { commands, callbacks: {
    onNavigate: (area) => commands.push(area), onLibrary: () => commands.push("library"),
    onNotes: () => commands.push("notes"), onAssistant: () => commands.push("assistant")
  } };
}
function change(select, value) {
  const currentTarget = { value };
  select.props.onChange({ currentTarget });
  return currentTarget.value;
}

test("desktop has four primary areas and one assistant, with no duplicate library/notes commands", () => {
  const { commands, callbacks } = recordCommands();
  const tree = ResearchShell({ model: baseModel, callbacks });
  const controls = buttons(tree);
  assert.equal(controls.length, 5);
  assert.deepEqual(controls.slice(0, 4).map((button) => button.props["data-research-area"]), areas);
  assert.equal(controls[4].props["aria-controls"], "assistant-panel");
  assert.equal(controls.some((button) => ["documents-panel", "notes-panel"].includes(button.props["aria-controls"])), false);
  assert.equal(commands.length, 0);
  for (const button of controls) button.props.onClick();
  assert.deepEqual(commands, [...areas, "assistant"]);
});

test("render, locale, metadata and model updates select exactly the supplied area without navigating", () => {
  const { commands, callbacks } = recordCommands();
  for (const language of ["zh", "en"]) {
    for (const area of areas) {
      const tree = ResearchShell({ model: { ...baseModel, language, area, ownerTitle: "<untrusted source>",
        libraryVisible: false, notesVisible: true }, callbacks });
      const selected = buttons(tree).filter((button) => button.props["aria-current"] === "page");
      assert.equal(selected.length, 1);
      assert.equal(selected[0].props["data-research-area"], area);
      assert.equal(nodes(tree, "select")[0].props.value, area);
      assert.equal(nodes(tree, "select").length, 1);
    }
  }
  assert.equal(commands.length, 0);
});

test("single-area device scope retains reading and assistant but omits the pointless mobile picker", () => {
  const { commands, callbacks } = recordCommands();
  const tree = ResearchShell({ model: { ...baseModel, availableAreas: ["reading"] }, callbacks });
  const controls = buttons(tree);
  assert.equal(controls.length, 2);
  assert.equal(controls[0].props["data-research-area"], "reading");
  assert.equal(controls[1].props["aria-controls"], "assistant-panel");
  assert.equal(nodes(tree, "select").length, 0);
  assert.equal(commands.length, 0);
  for (const button of controls) button.props.onClick();
  assert.deepEqual(commands, ["reading", "assistant"]);
});

test("capabilities gate and deduplicate desktop areas and mobile choices, including an empty scope", () => {
  const { commands, callbacks } = recordCommands();
  const restricted = ResearchShell({ model: { ...baseModel, area: "analysis", availableAreas: ["charts", "analysis", "charts"] }, callbacks });
  assert.deepEqual(buttons(restricted).slice(0, -1).map((button) => button.props["data-research-area"]), ["analysis", "charts"]);
  const select = nodes(restricted, "select")[0];
  assert.deepEqual(nodes(select, "option").map((option) => option.props.value), ["analysis", "charts"]);
  assert.equal(select.props.value, "analysis");
  for (const value of ["reading", "presentations"]) assert.equal(change(select, value), "analysis");
  assert.equal(commands.length, 0);
  assert.equal(change(select, "charts"), "analysis");
  assert.deepEqual(commands, ["charts"]);
  const empty = ResearchShell({ model: { ...baseModel, availableAreas: [] }, callbacks });
  assert.equal(buttons(empty).length, 1);
  assert.equal(nodes(empty, "select").length, 0);
  assert.deepEqual(commands, ["charts"]);
});

test("pending disables desktop and mobile area commands while assistant stays explicit and icons decorative", () => {
  const { commands, callbacks } = recordCommands();
  const tree = ResearchShell({ model: { ...baseModel, pending: true }, callbacks });
  assert.equal(tree.type, "nav");
  const select = nodes(tree, "select")[0];
  assert.equal(select.props.disabled, true);
  assert.equal(nodes(tree, "label")[0].props["aria-busy"], true);
  assert.equal(tree.children.find((child) => child?.props.className === "research-shell-areas").props["aria-busy"], true);
  assert.equal(change(select, "analysis"), "reading");
  for (const button of buttons(tree).slice(0, 4)) {
    assert.equal(button.props.disabled, true);
    button.props.onClick();
    assert.ok(button.props["aria-controls"]);
    assert.ok(button.props.title);
  }
  for (const svg of nodes(tree, "svg")) {
    assert.equal(svg.props["aria-hidden"], true);
    assert.equal(svg.props.focusable, "false");
  }
  assert.equal(commands.length, 0);
  assert.equal(buttons(tree)[4].props.disabled, undefined);
  buttons(tree)[4].props.onClick();
  assert.deepEqual(commands, ["assistant"]);
});

test("Chinese/English accessible names, concise rail labels and full native choices reflect the model", () => {
  const { commands, callbacks } = recordCommands();
  for (const language of ["zh", "en"]) {
    const names = language === "zh" ? ["阅读", "数据分析", "科研绘图", "汇报 PPT"]
      : ["Reading", "Data analysis", "Scientific charts", "Presentation (PPT)"];
    const compact = language === "zh" ? ["阅读", "分析", "绘图", "PPT"] : ["Read", "Analyze", "Charts", "PPT"];
    for (const area of areas) {
      const tree = ResearchShell({ model: { ...baseModel, language, area }, callbacks });
      const controls = buttons(tree);
      const select = nodes(tree, "select")[0];
      assert.equal(tree.props["aria-label"], language === "zh" ? "研究工作区" : "Research workspace");
      assert.equal(select.props["aria-label"], language === "zh" ? "切换工作区" : "Switch workspace");
      assert.equal(select.props.title, names[areas.indexOf(area)]);
      assert.equal(select.props["aria-controls"], "reader-panel data-workspace");
      assert.deepEqual(nodes(select, "option").map((option) => option.children[0]), names);
      for (const [index, button] of controls.slice(0, 4).entries()) {
        assert.equal(button.props["aria-label"], names[index]);
        assert.equal(button.props.title, names[index]);
        assert.equal(button.children[1].children[0], compact[index]);
      }
      assert.equal(controls[4].props["aria-label"], language === "zh" ? "助手" : "Assistant");
      assert.equal(controls[4].props["aria-expanded"], undefined);
    }
  }
  assert.equal(commands.length, 0);
});

test("native picker dispatches each explicit area transition once and waits for an accepted model", () => {
  for (const from of areas) {
    for (const to of areas) {
      const { commands, callbacks } = recordCommands();
      const tree = ResearchShell({ model: { ...baseModel, area: from }, callbacks });
      const select = nodes(tree, "select")[0];
      assert.equal(change(select, to), from);
      assert.equal(select.props.value, from);
      assert.deepEqual(commands, from === to ? [] : [to]);
      const accepted = ResearchShell({ model: { ...baseModel, area: to }, callbacks });
      assert.equal(nodes(accepted, "select")[0].props.value, to);
      assert.deepEqual(commands, from === to ? [] : [to]);
    }
  }
});

test("invalid native picker values never dispatch and restore the supplied selection", () => {
  const { commands, callbacks } = recordCommands();
  const select = nodes(ResearchShell({ model: baseModel, callbacks }), "select")[0];
  for (const value of ["", "unknown", "library", "notes", "assistant", "Reading", "__proto__", null, undefined]) {
    assert.equal(change(select, value), "reading");
  }
  assert.deepEqual(commands, []);
});

test("blocked or asynchronous navigation retains selection until the parent supplies a changed model", async () => {
  const commands = [];
  const callbacks = { onNavigate: async (area) => { commands.push(area); }, onLibrary() {}, onNotes() {}, onAssistant() {} };
  const select = nodes(ResearchShell({ model: baseModel, callbacks }), "select")[0];
  assert.equal(change(select, "charts"), "reading");
  await Promise.resolve();
  const blocked = ResearchShell({ model: { ...baseModel, ownerTitle: "metadata only" }, callbacks });
  assert.equal(nodes(blocked, "select")[0].props.value, "reading");
  const pending = ResearchShell({ model: { ...baseModel, pending: true }, callbacks });
  assert.equal(nodes(pending, "select")[0].props.value, "reading");
  const accepted = ResearchShell({ model: { ...baseModel, area: "charts" }, callbacks });
  assert.equal(nodes(accepted, "select")[0].props.value, "charts");
  assert.deepEqual(commands, ["charts"]);
});

test("a model outside the capability scope never silently selects or navigates to the first choice", () => {
  const { commands, callbacks } = recordCommands();
  const model = { ...baseModel, availableAreas: ["analysis", "charts"] };
  const tree = ResearchShell({ model, callbacks });
  const select = nodes(tree, "select")[0];
  assert.equal(select.props.value, "");
  assert.equal(nodes(select, "option")[0].props.disabled, true);
  assert.equal(nodes(select, "option")[0].props.value, "");
  assert.equal(buttons(tree).filter((button) => button.props["aria-current"] === "page").length, 0);
  assert.equal(change(select, "reading"), "");
  assert.deepEqual(commands, []);
  assert.equal(change(select, "analysis"), "");
  assert.deepEqual(commands, ["analysis"]);
  const accepted = ResearchShell({ model: { ...model, area: "analysis" }, callbacks });
  assert.equal(nodes(accepted, "select")[0].props.value, "analysis");
  assert.equal(nodes(nodes(accepted, "select")[0], "option").length, 2);
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
