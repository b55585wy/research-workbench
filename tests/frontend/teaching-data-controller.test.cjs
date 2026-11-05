const assert = require("node:assert/strict");
const test = require("node:test");
const { modules, base, example, progress, deferred, fixture, choose, id } = require("./teaching-data-fixture.cjs");

test("passive open/select/back/cancel/locale/read updates never import, refresh, navigate or lock", async () => {
  const f = await fixture(); const { controller: c } = f;
  assert.equal(c.state.open, false); assert.equal(c.hasUnsavedWork(), false);
  choose(c); assert.equal(c.state.selectedId, "describe"); assert.equal(c.back(), true);
  assert.equal(c.select("unknown"), false); c.select("groups");
  c.update({ ...base, language: "zh" }); assert.equal(c.state.selectedId, "groups");
  assert.equal(c.prepareNavigation(), true); assert.equal(c.state.open, false);
  c.open(); c.close(); c.update({ ...base, ownerId: "paper:b" });
  for (const list of [f.calls, f.continuations, f.refreshes, f.locks, f.confirmations]) assert.deepEqual(list, []);
  assert.equal(f.ids(), 0);
});

test("model snapshots are isolated/frozen; invalid ranges, shape, duplicate names and invalid updates are rejected", async () => {
  const { validateTeachingModel } = await modules;
  const input = structuredClone(base); const output = validateTeachingModel(input);
  input.examples[0].previewRows[0][0] = "changed";
  assert.equal(output.examples[0].previewRows[0][0], "0"); assert.ok(Object.isFrozen(output.examples[0].fields));
  const changes = [value => { value.language = "fr"; }, value => { value.ownerId = ""; }, value => { value.busy = 0; },
    value => { value.examples.push(value.examples[0]); }, value => { value.examples[0].rowCount = 0; },
    value => { value.examples[0].rowCount = 51; }, value => { value.examples[0].fields = []; },
    value => { value.examples[0].fields = Array(9).fill(value.examples[0].fields[0]); },
    value => { value.examples[0].fields[1].name = "score"; }, value => { value.examples[0].fields[0].missing = -1; },
    value => { value.examples[0].fields[0].missing = 6; }, value => { value.examples[0].fields[0].numeric = null; },
    value => { value.examples[0].previewRows = [["misaligned"]]; }, value => { value.examples[0].previewRows = Array(6).fill(["0", "A"]); },
    value => { value.examples[0].title.en = "x".repeat(161); }, value => { value.examples[0].availability = "guessed"; },
    value => { value.progress = progress("unknown"); }, value => { value.examples[0].previewRows[0][0] = "\0"; }];
  const f = await fixture(); choose(f.controller);
  for (const change of changes) {
    const invalid = structuredClone(base); change(invalid);
    assert.throws(() => validateTeachingModel(invalid)); assert.equal(f.controller.update(invalid), false);
    assert.equal(f.controller.state.selectedId, "describe");
  }
  const max = example(); max.rowCount = 50;
  max.fields = Array.from({ length: 8 }, (_, index) => ({ ...max.fields[0], name: `v${index}`, missing: 50 }));
  max.previewRows = Array.from({ length: 5 }, () => Array(8).fill(""));
  assert.equal(validateTeachingModel({ ...base, examples: [max] }).examples[0].fields.length, 8);
  assert.deepEqual(validateTeachingModel({ ...base, examples: [], progress: null }).examples, []);
  assert.deepEqual(validateTeachingModel({ ...base, examples: [{ ...example(), previewRows: [] }] }).examples[0].previewRows, []);
});

test("actual selected availability, owner, available and native busy gate imports while retaining readable review", async () => {
  for (const model of [{ ...base, ownerId: null }, { ...base, available: false }, { ...base, busy: true },
    { ...base, examples: [example("describe", "loading")] }, { ...base, examples: [example("describe", "unavailable")] }]) {
    const f = await fixture(model); choose(f.controller);
    assert.equal(f.controller.state.selectedId, "describe"); assert.equal(await f.controller.importSelected(), false);
    assert.equal(f.calls.length, 0); assert.equal(f.ids(), 0);
  }
  const f = await fixture({ ...base, examples: [example(), example("groups", "unavailable")] });
  choose(f.controller); assert.equal(await f.controller.importSelected(), true);
});

test("one explicit frozen import, double click suppression, pending block and lock notifications after state changes", async () => {
  const reply = deferred(); const f = await fixture(base, { onImport: () => reply.promise }); const c = f.controller;
  choose(c); const importing = c.importSelected();
  assert.equal(await c.importSelected(), false); assert.equal(await c.retry(), false);
  assert.equal(c.discardRequest(), false); assert.equal(c.close(), false); assert.equal(c.back(), false); assert.equal(c.select("groups"), false);
  assert.equal(c.prepareNavigation(), false); assert.equal(typeof c.prepareNavigation(), "boolean");
  assert.equal(c.hasUnsavedWork(), true); assert.equal(f.confirmations.length, 0);
  assert.equal(f.calls.length, 1); assert.equal(f.ids(), 1); assert.ok(Object.isFrozen(f.calls[0]));
  assert.deepEqual(f.calls[0], { ownerId: "paper:a", exampleId: "describe", requestId: id });
  assert.deepEqual(f.locks, [{ locked: true, pending: true, unsaved: true }]);
  c.update({ ...base, language: "zh" }); assert.equal(f.locks.length, 1);
  reply.resolve({ status: "imported", datasetId: "dataset:a" }); assert.equal(await importing, true);
  assert.equal(c.hasUnsavedWork(), false); assert.equal(c.state.open, false); assert.equal(await c.importSelected(), false);
  assert.deepEqual(f.locks[1], { locked: false, pending: false, unsaved: false }); assert.deepEqual(f.continuations, []);
});

test("uncertain failure retries the identical object/UUID, never creates a replacement command", async () => {
  let attempt = 0; const f = await fixture(base, { onImport: () => { if (++attempt === 1) throw new Error("offline"); return Promise.resolve({ status: "imported", datasetId: "dataset:a" }); } });
  choose(f.controller); assert.equal(await f.controller.importSelected(), false);
  assert.equal(f.controller.state.feedback, "failed"); assert.equal(f.controller.prepareNavigation(), false);
  assert.equal(await f.controller.importSelected(), false);
  assert.equal(await f.controller.retry(), true); assert.equal(f.calls[0], f.calls[1]); assert.equal(f.ids(), 1);
  assert.deepEqual(f.locks.map(item => item.locked), [true, false]);
});

test("explicit discard decline or confirm failure retains request; confirmation releases it without deleting data", async () => {
  const f = await fixture(base, { onImport: async () => { throw new Error("unknown"); } }); choose(f.controller);
  await f.controller.importSelected(); const op = f.controller.state.command;
  f.setConfirm(false); assert.equal(f.controller.discardRequest(), false); assert.equal(f.controller.state.command, op);
  assert.match(f.confirmations[0], /may already have imported/);
  f.setConfirm(true); assert.equal(f.controller.discardRequest(), true); assert.equal(f.controller.state.command, null);
  assert.equal(f.controller.prepareNavigation(), true); assert.equal(f.calls.length, 1);
  const g = await fixture(base, { onImport: async () => { throw new Error(); } }, { confirm: () => { throw new Error("blocked"); } });
  choose(g.controller); await g.controller.importSelected(); assert.equal(g.controller.discardRequest(), false); assert.equal(g.controller.hasUnsavedWork(), true);
});

test("owner switch retains origin command, rejects retry there, then allows exact retry only after returning", async () => {
  const reply = deferred(); let attempt = 0;
  const f = await fixture(base, { onImport: () => ++attempt === 1 ? reply.promise : Promise.resolve({ status: "imported", datasetId: "dataset:a" }) });
  choose(f.controller); const importing = f.controller.importSelected(); const op = f.controller.state.command;
  f.controller.update({ ...base, ownerId: "paper:b" }); assert.equal(f.controller.state.detached, true);
  assert.equal(f.controller.state.selectedId, null); assert.equal(f.controller.state.command, op); assert.equal(f.controller.prepareNavigation(), false);
  reply.reject(new Error("late error")); assert.equal(await importing, false); assert.equal(f.controller.state.feedback, "uncertain");
  assert.equal(await f.controller.retry(), false); assert.equal(f.calls.length, 1);
  f.controller.update({ ...base, examples: [example("describe", "loading")] }); assert.equal(await f.controller.retry(), false);
  f.controller.update(base); assert.equal(f.controller.state.command, op); assert.equal(f.controller.state.detached, false);
  assert.equal(await f.controller.retry(), true); assert.equal(f.calls[1], op); assert.equal(f.ids(), 1);
});

test("stale replies and owner round trips release confirmed records without current-source success or navigation", async () => {
  for (const mode of ["stale", "other-owner", "round-trip"]) {
    const reply = deferred(); const f = await fixture(base, { onImport: () => reply.promise }); choose(f.controller);
    const importing = f.controller.importSelected();
    if (mode !== "stale") f.controller.update({ ...base, ownerId: "paper:b" });
    if (mode === "round-trip") f.controller.update(base);
    reply.resolve({ status: mode === "stale" ? "stale" : "imported", datasetId: "dataset:a" });
    assert.equal(await importing, false); assert.equal(f.controller.hasUnsavedWork(), false);
    assert.equal(f.controller.state.feedback, mode === "stale" ? "stale" : null);
    assert.equal(f.controller.state.model.progress, null); assert.deepEqual(f.continuations, []);
  }
});

test("late import success/failure after destroy is inert and releases the host lock exactly once", async () => {
  for (const fails of [false, true]) {
    const reply = deferred(); const f = await fixture(base, { onImport: () => reply.promise }); choose(f.controller);
    const importing = f.controller.importSelected(); f.controller.destroy(); f.controller.destroy();
    if (fails) reply.reject(new Error("late")); else reply.resolve({ status: "imported", datasetId: "dataset:a" });
    assert.equal(await importing, false); assert.equal(f.controller.update(base), false); assert.equal(f.controller.open(), false);
    assert.deepEqual(f.locks.map(item => item.locked), [true, false]); assert.deepEqual(f.continuations, []);
  }
});

test("only supplied recognized progress/stage/record IDs enable explicit continuation; no automatic callbacks", async () => {
  const { progressAllows, teachingProgress } = await modules;
  const scenarios = [ [null, []], [progress("imported"), ["analysis"]],
    [progress("analyzed"), ["analysis", "charts"]], [progress("charted"), ["analysis", "charts", "presentations"]],
    [progress("charted", { analysisId: null }), ["analysis"]], [progress("charted", { chartId: null }), ["analysis", "charts"]],
    [progress("charted", { exampleId: "unknown" }), []] ];
  for (const [record, allowed] of scenarios) {
    const model = { ...base, progress: record }; const f = await fixture(model);
    assert.deepEqual(f.continuations, []);
    if (record?.exampleId === "unknown") assert.equal(teachingProgress(model), null);
    for (const action of ["analysis", "charts", "presentations"]) {
      assert.equal(progressAllows(model, action), allowed.includes(action));
      assert.equal(await f.controller.continueTo(action), allowed.includes(action));
    }
    assert.deepEqual(f.continuations, allowed); assert.equal(f.calls.length, 0); assert.equal(f.controller.hasUnsavedWork(), false);
  }
});

test("continuation is not unsaved, allows synchronous reentrant navigation, and blocks duplicate actions", async () => {
  const reply = deferred(); let c;
  const f = await fixture({ ...base, progress: progress("charted") }, { onContinue: () => {
    assert.equal(c.hasUnsavedWork(), false); assert.equal(c.prepareNavigation(), true); return reply.promise;
  } }); c = f.controller; c.open();
  const continuing = c.continueTo("charts"); assert.equal(c.state.open, false); assert.equal(c.state.continuing, "charts");
  assert.equal(await c.continueTo("charts"), false); assert.equal(await c.continueTo("presentations"), false);
  reply.resolve(true); assert.equal(await continuing, true); assert.equal(c.state.continuing, null); assert.equal(f.continuations.length, 1);
});

test("continuation failures are bounded; owner/destroy invalidates late continuation feedback", async () => {
  for (const result of [false, "throw"]) {
    const f = await fixture({ ...base, progress: progress() }, { onContinue: () => { if (result === "throw") throw new Error(); return false; } });
    assert.equal(await f.controller.continueTo("analysis"), false); assert.equal(f.controller.state.feedback, "continueFailed");
    assert.equal(f.controller.state.continuing, null); assert.equal(f.controller.prepareNavigation(), true);
  }
  for (const mode of ["owner", "destroy"]) {
    const reply = deferred(); const f = await fixture({ ...base, progress: progress() }, { onContinue: () => reply.promise });
    const continuing = f.controller.continueTo("analysis");
    if (mode === "owner") f.controller.update({ ...base, ownerId: "paper:b" }); else f.controller.destroy();
    reply.reject(new Error("late")); assert.equal(await continuing, false); assert.equal(f.controller.state.feedback, null);
  }
});

test("refresh is explicit, duplicate/busy/retained gates apply, failures recover and stale replies are suppressed", async () => {
  const reply = deferred(); const f = await fixture(base, { onRefresh: () => reply.promise });
  choose(f.controller); assert.equal(f.refreshes.length, 0); const refreshing = f.controller.refresh();
  assert.equal(await f.controller.refresh(), false); assert.equal(await f.controller.importSelected(), false);
  f.controller.update({ ...base, ownerId: "paper:b" }); reply.reject(new Error("late")); assert.equal(await refreshing, false);
  assert.equal(f.controller.state.feedback, null); assert.equal(f.controller.state.refreshing, false);
  const g = await fixture(base, { onRefresh: () => { throw new Error(); }, onImport: async () => { throw new Error(); } });
  assert.equal(await g.controller.refresh(), false); assert.equal(g.controller.state.feedback, "refreshFailed");
  choose(g.controller); await g.controller.importSelected(); assert.equal(await g.controller.refresh(), false); assert.equal(g.refreshes.length, 1);
  const busy = await fixture({ ...base, busy: true, progress: progress() });
  assert.equal(await busy.controller.refresh(), false); assert.equal(await busy.controller.continueTo("analysis"), false);
});

test("UUID failures send nothing; malformed import replies retain the exact command; host lock errors cannot lose it", async () => {
  for (const uuid of [() => { throw new Error("crypto unavailable"); }, () => "not-a-uuid"]) {
    const f = await fixture(base, {}, { uuid }); choose(f.controller);
    assert.equal(await f.controller.importSelected(), false); assert.equal(f.controller.state.feedback, "invalid");
    assert.equal(f.calls.length, 0); assert.equal(f.controller.hasUnsavedWork(), false); assert.deepEqual(f.locks, []);
  }
  for (const result of [null, { status: "wrong", datasetId: "dataset:a" }, { status: "imported", datasetId: "" }]) {
    const f = await fixture(base, { onImport: async () => result, onLockChange: () => { throw new Error("host"); } }); choose(f.controller);
    assert.equal(await f.controller.importSelected(), false); assert.equal(f.controller.hasUnsavedWork(), true);
    await f.controller.retry(); assert.equal(f.calls[0], f.calls[1]); assert.equal(f.controller.discardRequest(), true);
  }
});
