const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "../..");
function evaluate(file, globals, names) {
  const source = fs.readFileSync(path.join(root, file), "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/\bexport /g, "");
  return new Function(...Object.keys(globals), source + `\nreturn {${names.join(",")}}`)(...Object.values(globals));
}
const catalog = evaluate("frontend/teaching-catalog.js", {}, ["teachingCatalog", "teachingExample", "teachingDatasetMatches",
  "teachingExampleForDataset", "teachingJobMatches", "teachingChartMatches", "teachingPresentationTitle"]);
const { createTeachingWorkflow } = evaluate("frontend/teaching-workflow.js", catalog, ["createTeachingWorkflow"]);
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function dataset(example = catalog.teachingCatalog[0]) {
  return { id, document_id: owner, sha256: example.sha256, original_filename: example.filename,
    row_count: example.rowCount, column_count: example.fields.length,
    columns: example.fields.map(({ name, numeric, missing }) => ({ name, numeric, missing })) };
}
function job(example = catalog.teachingCatalog[0], data = dataset(example)) {
  const result = { id: "job", document_id: owner, dataset_id: data.id, dataset_sha256: data.sha256,
    status: "succeeded", method: example.analysis.method, columns: [...example.analysis.columns], engine: "r" };
  const options = { alternative: "two_sided", confidence: 0.95 };
  if (result.method === "ttest_independent") result.ttest = { ...options, group_column: "group", groups: ["A", "B"], variant: "welch" };
  if (result.method === "ttest_paired") result.paired = { ...options, unit_column: "record_id" };
  if (result.method === "correlation") result.correlation = { ...options, kind: "pearson" };
  return result;
}
function chart(example = catalog.teachingCatalog[0], data = dataset(example)) {
  return { id: "chart", document_id: owner, dataset_id: data.id, dataset_sha256: data.sha256, kind: example.chart.kind,
    spec: { x: example.chart.x, y: example.chart.y } };
}
function fixture() {
  const context = { ownerId: owner, sha256: "source", generation: 1, language: "zh", available: true, busy: false };
  const native = { ownerId: owner, dataset: null, jobs: [], revision: 0, busy: false,
    loading: false, engines: [{ id: "python", available: true }, { id: "r", available: true }],
    methods: catalog.teachingCatalog.map(item => ({ id: item.analysis.method, available: true, library: { available: true } })) };
  const calls = [], records = new Map(), charts = []; let area = "analysis", reply = async (_, form) => {
    const example = catalog.teachingCatalog.find(item => item.filename === form.get("file").name);
    const data = { ...dataset(example), id: form.get("request_id") }; records.set(data.id, data);
    return { ok: true, json: async () => data };
  };
  const adapter = { getContext: () => ({ ...context }), checkedFetch: async (url, options) => {
    calls.push(["POST", url, options]); return reply(url, options.body);
  }, analysis: { getTeachingState: () => native, openImportedDataset: (...args) => calls.push(["retain", ...args]),
    applyTeachingDataset: (ownerId, data, plan) => { calls.push(["apply", ownerId, data, plan]); native.dataset = data; return true; },
    openJob: async (...args) => calls.push(["openJob", ...args]), reload: async (...args) => calls.push(["refresh", ...args]) },
  charts: { getTeachingCharts: () => charts, getTeachingRevision: () => 0, getSkillModel: () => ({ busy: false }), reload: async () => calls.push(["reloadCharts"]),
    prepareTeachingChart: (...args) => { calls.push(["chart", ...args]); return true; } },
  presentations: { hasPending: () => false, prepareTeachingSources: async (...args) => { calls.push(["ppt", ...args]); return true; } },
  navigate: async action => { calls.push(["navigate", action]); area = action; return true; }, isArea: action => area === action,
  sourcesChanged: (...args) => calls.push(["sourcesChanged", ...args]) };
  return { workflow: createTeachingWorkflow(adapter), adapter, context, native, calls, charts, records,
    setReply: value => { reply = value; }, command: { ownerId: owner, exampleId: "measurements-v1", requestId: id } };
}
module.exports = { ...catalog, dataset, job, chart, fixture, owner, id };
