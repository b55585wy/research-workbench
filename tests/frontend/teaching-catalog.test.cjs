const { test } = require("node:test"), assert = require("node:assert/strict"), { createHash } = require("node:crypto");
const { teachingCatalog: examples, teachingExample, teachingDatasetMatches, teachingExampleForDataset,
  teachingJobMatches, teachingChartMatches, dataset, job, chart } = require("./teaching-workflow-fixture.cjs");
test("four immutable synthetic examples have exact bytes, bounded previews, real missing counts and unique fields", () => {
  assert.equal(examples.length, 4); assert(Object.isFrozen(examples));
  for (const item of examples) {
    assert.equal(createHash("sha256").update(item.csv).digest("hex"), item.sha256);
    assert(item.filename.startsWith("synthetic-teaching-")); assert.equal(item.rowCount, item.rows.length);
    assert.equal(new Set(item.fields.map(column => column.name)).size, item.fields.length);
    assert(item.previewRows.length <= 5); assert(Object.isFrozen(item.analysis));
    item.fields.forEach((column, index) => assert.equal(column.missing, item.rows.filter(row => !row[index]).length));
    assert.equal(teachingExampleForDataset(dataset(item)), item);
  }
  assert.equal(teachingExample("unknown"), null);
});
test("descriptive teaching oracle includes seven complete values, one missing, mean/median12", () => {
  const values = examples[0].rows.map(row => row[1]).filter(Boolean).map(Number).sort((a,b) => a-b);
  assert.equal(values.length, 7); assert.equal(values.reduce((a,b) => a+b, 0)/7, 12);
  assert.equal(values[3], 12); assert.equal(values[0], 9); assert.equal(values[6], 15);
});
test("a changed hash, filename, row/column count, schema, numeric flag or missing count loses recognition", () => {
  for (const change of [d => d.sha256 = "other", d => d.original_filename = "own.csv", d => d.row_count++,
    d => d.column_count++, d => d.columns.pop(), d => d.columns[0].name = "other",
    d => d.columns[1].numeric = false, d => d.columns[1].missing++]) {
    const data = dataset(); change(data); assert.equal(teachingDatasetMatches(data, examples[0]), false);
  }
});
test("only succeeded analyses from the exact source, method, column order and inferential options advance progress", () => {
  for (const item of examples) {
    const data = dataset(item), analysis = job(item, data);
    assert(teachingJobMatches(analysis, data, item));
    for (const change of [j => j.status = "failed", j => j.document_id = "other", j => j.dataset_id = "other",
      j => j.dataset_sha256 = "other", j => j.method = "other", j => j.columns = []]) {
      const next = structuredClone(analysis); change(next); assert.equal(teachingJobMatches(next, data, item), false);
    }
    if (item.id === "correlation-v1") { analysis.correlation.kind = "spearman"; assert(!teachingJobMatches(analysis, data, item)); }
    if (item.id === "paired-v1") { analysis.paired.unit_column = "after"; assert(!teachingJobMatches(analysis, data, item)); }
    if (item.id === "independent-v1") { analysis.ttest.groups.reverse(); assert(!teachingJobMatches(analysis, data, item)); }
  }
});
test("only saved, active charts of this source and actual x/y specification advance to PPT", () => {
  const item = examples[0], data = dataset(), saved = chart(); assert(teachingChartMatches(saved, data, item));
  for (const change of [c => c.deleted_at = "now", c => c.document_id = "other", c => c.dataset_id = "other",
    c => c.dataset_sha256 = "other", c => c.kind = "scatter", c => c.spec.x = "other"]) {
    const next = structuredClone(saved); change(next); assert.equal(teachingChartMatches(next, data, item), false);
  }
});
