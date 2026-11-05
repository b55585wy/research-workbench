const { test } = require("node:test"), assert = require("node:assert/strict");
const { fixture, dataset, job, chart, id, owner } = require("./teaching-workflow-fixture.cjs");
test("reading models/availability and refreshing make no import/analysis/chart/PPT request", async () => {
  const f = fixture(); f.workflow.getModel(); f.workflow.getModel(); assert.equal(f.calls.length, 0);
  await f.workflow.refresh(); assert.deepEqual(f.calls, [["refresh", owner]]);
});
test("runtime and verified library availability gate each example independently, without method fallback", () => {
  const f = fixture(); f.native.engines[1].available = false;
  assert.deepEqual(f.workflow.getModel().examples.map(x => x.availability), ["ready", "unavailable", "unavailable", "unavailable"]);
  f.native.engines = null; f.native.loading = true; assert(f.workflow.getModel().examples.every(x => x.availability === "loading"));
  f.native.loading = false; assert(f.workflow.getModel().examples.every(x => x.availability === "unavailable"));
});
test("invalid IDs, unknown example, wrong owner, missing native owner and busy/unavailable contexts send nothing", async () => {
  for (const change of [f => f.command.requestId = "bad", f => f.command.exampleId = "unknown", f => f.command.ownerId = "other",
    f => f.native.ownerId = "other", f => f.context.available = false, f => f.native.busy = true, f => f.context.busy = true,
    f => f.native.engines[0].available = false]) {
    const f = fixture(); change(f); await assert.rejects(f.workflow.importExample(f.command)); assert.equal(f.calls.length, 0);
  }
});
test("explicit import sends approved exact CSV with frozen UUID; retries preserve bytes/name/owner and one record", async () => {
  const f = fixture();
  assert.deepEqual(await f.workflow.importExample(f.command), { status: "imported", datasetId: id });
  assert.deepEqual(await f.workflow.importExample(f.command), { status: "imported", datasetId: id });
  const sent = f.calls.filter(c => c[0] === "POST"); assert.equal(sent.length, 2); assert.equal(f.records.size, 1);
  assert.equal(sent[0][2].body.get("request_id"), id);
  assert.equal(await sent[0][2].body.get("file").text(), await sent[1][2].body.get("file").text());
  assert.equal(f.calls.filter(c => c[0] === "apply").length, 2);
  assert(!f.calls.some(c => ["navigate", "chart", "ppt", "openJob"].includes(c[0])));
});
test("wrong response ID, owner, bytes/profile and failed status never select a dataset or assert success", async () => {
  for (const change of [d => d.id = "wrong", d => d.document_id = "wrong", d => d.sha256 = "wrong", d => d.columns[1].missing = 0]) {
    const f = fixture(), data = dataset(); change(data); f.setReply(async () => ({ ok: true, json: async () => data }));
    await assert.rejects(f.workflow.importExample(f.command)); assert(!f.calls.some(c => c[0] === "apply" || c[0] === "retain"));
  }
});
test("owner/source/navigation/plan drift retains verified record in origin without taking over current work", async () => {
  for (const change of [f => f.context.ownerId = "other", f => f.context.sha256 = "changed", f => f.context.generation++, f => f.native.revision++, f => f.native.busy = true]) {
    const f = fixture(); f.setReply(async () => { change(f); return { ok: true, json: async () => dataset() }; });
    assert.equal((await f.workflow.importExample(f.command)).status, "stale");
    assert.deepEqual(f.calls.find(c => c[0] === "retain").slice(1), [owner, dataset(), { select: false }]);
    assert(!f.calls.some(c => c[0] === "apply"));
  }
});
test("progress and explicit continuation follow only current verified records, never another dataset's results", async () => {
  const f = fixture(); assert.equal(f.workflow.getModel().progress, null);
  await f.workflow.importExample(f.command); assert.equal(f.workflow.getModel().progress.stage, "imported");
  assert.equal(await f.workflow.continueExample("charts"), false);
  f.native.jobs = [job()]; assert.equal(f.workflow.getModel().progress.stage, "analyzed");
  assert.equal(await f.workflow.continueExample("analysis"), true); assert(f.calls.some(c => c[0] === "openJob"));
  assert.equal(await f.workflow.continueExample("charts"), true); assert(f.calls.some(c => c[0] === "chart"));
  f.charts.push(chart()); assert.equal(f.workflow.getModel().progress.stage, "charted");
  assert.equal(await f.workflow.continueExample("presentations"), true);
  const sent = f.calls.find(c => c[0] === "ppt"); assert.equal(sent[1], owner); assert.equal(sent[3].id, "job"); assert.equal(sent[4].id, "chart"); assert(sent[5].startsWith("合成教学："));
  f.native.dataset = { ...dataset(), sha256: "changed" }; assert.equal(f.workflow.getModel().progress, null);
});
test("declined navigation and source changes during navigation never overwrite chart or PPT drafts", async () => {
  for (const mode of ["decline", "owner", "dataset"]) {
    const f = fixture(); f.native.dataset = dataset(); f.native.jobs = [job()]; f.charts.push(chart());
    f.adapter.navigate = async () => { if (mode === "decline") return false; if (mode === "owner") f.context.ownerId = "other"; else f.native.dataset = { ...dataset(), id: "other" }; return true; };
    assert.equal(await f.workflow.continueExample("charts"), false); assert(!f.calls.some(c => c[0] === "chart" || c[0] === "ppt"));
  }
});
test("returning to an unfinished analysis preserves native field choices and prerequisite acknowledgements", async () => {
  const f = fixture(); f.native.dataset = dataset();
  assert.equal(await f.workflow.continueExample("analysis"), true);
  assert(!f.calls.some(c => c[0] === "apply"));
});
test("navigation round trips, source/plan changes and native chart edits during reload cancel stale continuation", async () => {
  for (const mode of ["generation", "source", "plan", "chart"]) {
    const f = fixture(); f.native.dataset = dataset(); f.native.jobs = [job()]; let revision = 0;
    f.adapter.charts.getTeachingRevision = () => revision;
    f.adapter.charts.reload = async () => {
      if (mode === "generation") f.context.generation += 2;
      if (mode === "source") f.context.sha256 = "changed";
      if (mode === "plan") f.native.revision++;
      if (mode === "chart") revision++;
    };
    assert.equal(await f.workflow.continueExample("charts"), false);
    assert(!f.calls.some(c => c[0] === "chart"));
  }
});
