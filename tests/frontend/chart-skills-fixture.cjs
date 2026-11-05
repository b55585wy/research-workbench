const fs = require("node:fs");
const path = require("node:path");
const { stripTypeScriptTypes } = require("node:module");
const directory = path.resolve(__dirname, "../../web/src/features/chart-skills");
const modules = Promise.resolve().then(() => {
  const validation = evaluate("validation.ts", { TextEncoder }, ["SKILL_BYTES", "SKILL_KINDS", "SKILL_FONTS", "SKILL_EXPORTS",
    "SkillValidationError", "validateSkillSpec", "parseSkillImport", "validateSkillSnapshot", "validateSkillRecord", "validateChartSkillsModel", "defaultSkillSpec"]);
  const copy = evaluate("copy.ts", {}, ["skillCopy"]);
  const controller = evaluate("controller.ts", { ...validation, ...copy }, ["createChartSkillsController", "skillKey"]);
  return { ...validation, ...controller, ...copy };
});
const id = "12345678-1234-4234-8234-123456789abc";
const base = { language: "en", ownerId: "paper:a", available: true, busy: false, selected: null };
function spec() {
  return { format: "research-chart-skill/v1", name: "My figure", description: "Purpose", chart: { kind: "histogram", bins: 20 },
    style: { palette: ["#0072B2", "#D55E00"], font_family: "Arial, sans-serif", font_size: 12, line_width: 1,
      marker_size: 6, width: 900, height: 560 }, exports: ["png", "svg", "offline"] };
}
function record(revision = 1, input = spec(), skillId = id) {
  return { id: skillId, revision, sha256: "a".repeat(64), spec: input,
    created_at: "2026-11-05T00:00:00+00:00", updated_at: "2026-11-05T01:00:00+00:00" };
}
function snapshot(value = record()) { const { created_at, updated_at, ...result } = value; return result; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function fixture(model = base, api = async () => ({ items: [] })) {
  const { createChartSkillsController } = await modules;
  const calls = [], selections = [], confirmations = [], downloads = [];
  let confirm = true, ids = 0;
  const controller = createChartSkillsController(model, {
    api: (url, options) => { calls.push({ url, options }); return api(url, options); },
    onSelect: (selected) => selections.push(selected)
  }, { uuid: () => { ids += 1; return id; }, confirm: (message) => { confirmations.push(message); return confirm; },
    download: (value, skillId) => downloads.push({ value, id: skillId }) });
  return { controller, calls, selections, confirmations, downloads, setConfirm: (value) => { confirm = value; }, ids: () => ids };
}
function evaluate(file, globals, exports) {
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  const javascript = stripTypeScriptTypes(source).replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replace(/^export \{[^}]*\} from [^;]*;\s*/gm, "").replace(/\bexport (?=(?:class|function|const|let))/g, "");
  // The trusted source is stripped and evaluated in this realm so object/array assertions remain exact.
  return new Function(...Object.keys(globals), `${javascript}\nreturn {${exports.join(",")}};`)(...Object.values(globals));
}
function h(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter((value) => value !== null && value !== false && value !== undefined) }; }
function nodes(tree) { return !tree || typeof tree !== "object" ? [] : [tree, ...tree.children.flatMap(nodes)]; }
function content(tree) { return typeof tree === "string" || typeof tree === "number" ? String(tree) : tree.children.map(content).join(""); }
module.exports = { modules, base, id, spec, record, snapshot, deferred, fixture, evaluate, h, nodes, content };
