const fs = require("node:fs");
const path = require("node:path");
const { stripTypeScriptTypes } = require("node:module");
const directory = path.resolve(__dirname, "../../web/src/features/teaching-data");
function evaluate(file, globals, names) {
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  const javascript = stripTypeScriptTypes(source).replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replace(/\bexport (?=(?:function|const|let))/g, "");
  return new Function(...Object.keys(globals), `${javascript}\nreturn {${names.join(",")}};`)(...Object.values(globals));
}
const modules = Promise.resolve().then(() => {
  const validation = evaluate("validation.ts", {}, ["validateTeachingModel"]);
  const copy = evaluate("copy.ts", {}, ["teachingCopy"]);
  const controller = evaluate("controller.ts", { ...validation, ...copy },
    ["createTeachingDataController", "teachingProgress", "progressAllows"]);
  return { ...validation, ...copy, ...controller };
});
const id = "12345678-1234-4234-8234-123456789abc";
const localized = value => ({ zh: `中 ${value}`, en: value });
function example(exampleId = "describe", availability = "ready") {
  return { id: exampleId, title: localized(`Example ${exampleId}`), question: localized("What is the distribution?"),
    design: localized("Synthetic observations"), rowMeaning: localized("One synthetic observation"), rowCount: 5,
    fields: [
      { name: "score", label: localized("Score"), meaning: localized("Outcome"), unit: localized("points"), numeric: true, missing: 0 },
      { name: "group", label: localized("Group"), meaning: localized("Group label"), unit: null, numeric: false, missing: 1 }
    ], previewRows: [["0", "A"], ["12", ""]], availability };
}
const base = { language: "en", ownerId: "paper:a", available: true, busy: false,
  examples: [example(), example("groups"), example("paired"), example("correlation")], progress: null };
function progress(stage = "imported", overrides = {}) {
  return { exampleId: "describe", datasetId: "dataset:a", stage,
    analysisId: stage === "imported" ? null : "analysis:a", chartId: stage === "charted" ? "chart:a" : null, ...overrides };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function fixture(model = base, overrides = {}, environment = {}) {
  const { createTeachingDataController } = await modules;
  const calls = [], continuations = [], refreshes = [], locks = [], confirmations = [];
  let confirmed = true, uuids = 0, controller;
  controller = createTeachingDataController(model, {
    onImport: command => { calls.push(command); return overrides.onImport ? overrides.onImport(command) : Promise.resolve({ status: "imported", datasetId: "dataset:a" }); },
    onContinue: action => { continuations.push(action); return overrides.onContinue ? overrides.onContinue(action) : true; },
    onRefresh: () => { refreshes.push(true); return overrides.onRefresh?.(); },
    onLockChange: locked => { locks.push({ locked, pending: controller.state.pending, unsaved: controller.hasUnsavedWork() }); overrides.onLockChange?.(locked); }
  }, { uuid: () => { uuids += 1; return id; }, confirm: message => { confirmations.push(message); return confirmed; }, ...environment });
  return { controller, calls, continuations, refreshes, locks, confirmations, ids: () => uuids, setConfirm: value => { confirmed = value; } };
}
function choose(controller, exampleId = "describe") { controller.open(); controller.select(exampleId); }
function h(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter(value => value !== null && value !== false && value !== undefined) }; }
function nodes(tree) { return !tree || typeof tree !== "object" ? [] : [tree, ...tree.children.flatMap(nodes)]; }
function content(tree) { return typeof tree === "string" || typeof tree === "number" ? String(tree) : tree.children.map(content).join(""); }
module.exports = { modules, evaluate, id, localized, example, base, progress, deferred, fixture, choose, h, nodes, content };
