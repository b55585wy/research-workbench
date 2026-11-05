const assert = require("node:assert/strict");
const test = require("node:test");
const { modules, base, id, spec, record, snapshot, deferred, fixture } = require("./chart-skills-fixture.cjs");
const flush = () => new Promise(resolve => setImmediate(resolve));
const saved = (options, revision = 1) => record(revision, JSON.parse(options.body).spec);

test("mount/read, locale, busy and selected-prop updates never POST or replace selected history", async () => {
  const f = await fixture({ ...base, selected: snapshot(record(1)) }, async () => ({ items: [record(3)] }));
  await f.controller.load();
  for (const patch of [{ language: "zh" }, { busy: true }, { busy: false }, { selected: snapshot(record(2)) }]) {
    f.controller.update({ ...f.controller.state.model, ...patch });
  }
  assert.equal(f.controller.state.model.selected.revision, 2);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options.method, undefined); assert.equal(f.selections.length, 0);
  const { skillKey } = await modules;
  f.controller.select(skillKey(record(3))); f.controller.select("");
  assert.equal(f.selections[0].revision, 3); assert.equal(f.selections[1], null);
  assert.equal(f.calls.length, 1);
});

test("new save creates one skill; edit appends expected selected revision with isolated inputs", async () => {
  const f = await fixture(base, async (_url, options) => saved(options));
  f.controller.newSkill(); assert.equal(f.controller.hasUnsavedWork(), false);
  f.controller.change(spec()); assert.equal(f.controller.hasUnsavedWork(), true);
  assert.equal(await f.controller.save(), true);
  const first = JSON.parse(f.calls[0].options.body);
  assert.deepEqual(Object.keys(first), ["request_id", "spec"]); assert.equal(first.request_id, id);
  assert.equal(f.selections[0].revision, 1); assert.equal(f.controller.hasUnsavedWork(), false);
  const selected = snapshot(record(4));
  const edit = await fixture({ ...base, selected }, async (_url, options) => saved(options, 5));
  edit.controller.editSelected();
  const changed = structuredClone(edit.controller.state.editor.spec); changed.name = "Revised";
  edit.controller.change(changed); changed.name = "Caller mutation";
  assert.equal(await edit.controller.save(), true);
  assert.equal(edit.calls[0].url, `/api/v1/chart-skills/${id}/versions`);
  assert.equal(JSON.parse(edit.calls[0].options.body).expected_revision, 4);
  assert.equal(edit.selections[0].spec.name, "Revised"); assert.equal(selected.spec.name, "My figure");
});

test("unconfirmed writes keep UUID/body, block navigation and edits, and only explicit retry replays", async () => {
  let attempts = 0;
  const f = await fixture({ ...base, selected: snapshot(record(2)) }, async (_url, options) => {
    if (!options.method) return { items: [record(9)] };
    if (++attempts === 1) throw new Error("connection lost after commit");
    return saved(options, 3);
  });
  f.controller.editSelected(); f.controller.change({ ...spec(), name: "Version 3" });
  assert.equal(await f.controller.save(), false); assert.equal(f.controller.state.pending, true);
  assert.equal(f.controller.state.running, false); assert.equal(await f.controller.prepareNavigation(), false);
  assert.equal(f.controller.closeEditor(), false); assert.equal(f.controller.newSkill(), false);
  assert.equal(f.controller.change(spec()), false); assert.equal(await f.controller.save(), false);
  f.controller.update({ ...f.controller.state.model, language: "zh" }); await f.controller.load();
  assert.equal(attempts, 1); assert.equal(f.ids(), 1); assert.equal(f.confirmations.length, 0);
  assert.equal(await f.controller.retry(), true);
  const posts = f.calls.filter(call => call.options.method === "POST");
  assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]);
  assert.equal(f.ids(), 1); assert.equal(f.selections[0].revision, 3);
});

test("pending saves cannot be discarded and old success cannot select into a new owner", async () => {
  const write = deferred();
  const f = await fixture(base, async (_url, options) => options.method ? write.promise : { items: [] });
  f.controller.newSkill(); f.controller.change(spec()); const saving = f.controller.save();
  assert.equal(f.controller.state.running, true); assert.equal(await f.controller.retry(), false);
  assert.equal(f.controller.discardRequest(), false); assert.equal(await f.controller.prepareNavigation(), false);
  f.controller.update({ ...base, ownerId: "paper:b" });
  assert.equal(f.controller.state.detached, true); assert.equal(f.controller.newSkill(), false);
  write.resolve(record()); assert.equal(await saving, true);
  assert.equal(f.selections.length, 0); assert.equal(f.controller.state.items.length, 0);
  assert.equal(f.controller.state.model.ownerId, "paper:b");
  assert.equal(f.calls[0].options.signal, undefined);
});

test("owner changes abort old reads; delayed old replies never populate current list", async () => {
  const old = deferred(), current = deferred(); let reads = 0;
  const f = await fixture(base, async () => ++reads === 1 ? old.promise : current.promise);
  const first = f.controller.load(); const signal = f.calls[0].options.signal;
  f.controller.update({ ...base, ownerId: "paper:b" }); assert.equal(signal.aborted, true);
  current.resolve({ items: [record(2)] }); await flush();
  old.resolve({ items: [record(1)] }); await first;
  assert.equal(f.controller.state.items[0].revision, 2); assert.equal(f.controller.state.loading, false);
  assert.equal(f.selections.length, 0);
});

test("uncertain operation survives a forced owner switch and can retry only back in its original owner", async () => {
  let attempts = 0;
  const f = await fixture(base, async (_url, options) => {
    if (!options.method) return { items: [] };
    if (++attempts === 1) throw new Error("offline");
    return saved(options);
  });
  f.controller.newSkill(); f.controller.change(spec()); await f.controller.save();
  f.controller.update({ ...base, ownerId: "paper:b" }); assert.equal(await f.controller.retry(), false);
  assert.equal(f.controller.state.pending, true); assert.equal(f.ids(), 1);
  f.controller.update(base); assert.equal(await f.controller.retry(), true);
  const posts = f.calls.filter(call => call.options.method); assert.equal(posts[0].options.body, posts[1].options.body);
  assert.equal(f.selections.length, 1);
});

test("discard cancellation preserves drafts and confirmed navigation clears them; busy updates do not save", async () => {
  const f = await fixture(); f.controller.newSkill(); f.controller.change(spec()); f.setConfirm(false);
  assert.equal(await f.controller.prepareNavigation(), false); assert.equal(f.controller.closeEditor(), false);
  assert.equal(f.controller.select(""), false); assert.equal(f.controller.hasUnsavedWork(), true);
  f.controller.update({ ...base, busy: true }); assert.equal(await f.controller.save(), false);
  f.setConfirm(true); assert.equal(await f.controller.prepareNavigation(), true);
  assert.equal(f.controller.state.editor, null); assert.equal(f.calls.length, 0);
});

test("explicit discard retains editable draft after conflict; request discard can be cancelled", async () => {
  const f = await fixture(base, async () => { throw { code: "revision_conflict" }; });
  f.controller.newSkill(); f.controller.change(spec()); await f.controller.save();
  assert.equal(f.controller.state.error, "changed"); f.setConfirm(false);
  assert.equal(f.controller.discardRequest(), false); assert.equal(f.controller.hasUnsavedWork(), true);
  f.setConfirm(true); assert.equal(f.controller.discardRequest(), true);
  assert.equal(f.controller.state.pending, false); assert.equal(f.controller.state.editor.spec.name, "My figure");
  assert.equal(f.controller.change({ ...spec(), name: "Another version" }), true);
});

test("valid import creates an editable new skill; oversize/malformed/stale imports never write", async () => {
  const f = await fixture({ ...base, selected: snapshot(record(3)) }, async (_url, options) => saved(options));
  const json = JSON.stringify(spec());
  assert.equal(await f.controller.importFile({ size: Buffer.byteLength(json), text: async () => json }), true);
  assert.equal(f.controller.state.editor.id, null); assert.equal(f.controller.state.dirty, true); assert.equal(f.calls.length, 0);
  await f.controller.save(); assert.equal(f.calls[0].url, "/api/v1/chart-skills");
  assert.equal(JSON.parse(f.calls[0].options.body).expected_revision, undefined);
  assert.equal(await f.controller.importFile({ size: 16385, text: () => { throw new Error("must not read"); } }), false);
  assert.equal(await f.controller.importFile({ size: 2, text: async () => "[]" }), false);
  const reading = deferred(); const importing = f.controller.importFile({ size: json.length, text: () => reading.promise });
  f.controller.update({ ...base, ownerId: "paper:b", available: false }); reading.resolve(json);
  assert.equal(await importing, false); assert.equal(f.controller.state.editor, null);
});

test("unavailable capabilities and failed/invalid reads never fake success; export includes only spec", async () => {
  const f = await fixture({ ...base, available: false, selected: snapshot() });
  assert.equal(await f.controller.load(), false); assert.equal(f.controller.newSkill(), false);
  assert.equal(f.controller.exportSelected(), true); assert.equal(f.calls.length, 0);
  assert.deepEqual(Object.keys(f.downloads[0].value), Object.keys(spec()));
  for (const result of [null, { items: [record(), record()] }, { items: [snapshot()] }, { items: Array(101).fill(record()) }]) {
    const f = await fixture(base, async () => result); assert.equal(await f.controller.load(), false);
    assert.equal(f.controller.state.listError, true); assert.equal(f.selections.length, 0);
  }
});

test("malformed successful saves remain uncertain and destroy retires callbacks and reads", async () => {
  for (const response of [null, record(2), record(1, { ...spec(), name: "Unexpected" }), { ...record(), id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]) {
    const f = await fixture(base, async () => response); f.controller.newSkill(); f.controller.change(spec());
    assert.equal(await f.controller.save(), false); assert.equal(f.controller.state.pending, true); assert.equal(f.selections.length, 0);
  }
  const write = deferred(); const f = await fixture(base, async () => write.promise);
  f.controller.newSkill(); f.controller.change(spec()); const saving = f.controller.save(); f.controller.destroy();
  write.resolve(record()); assert.equal(await saving, false); assert.equal(f.selections.length, 0);
  assert.equal(f.controller.update(base), false); assert.equal(f.controller.newSkill(), false);
  const read = deferred(); const g = await fixture(base, async () => read.promise);
  const loading = g.controller.load(); g.controller.destroy(); assert.equal(g.calls[0].options.signal.aborted, true);
  read.resolve({ items: [record()] }); await loading; assert.equal(g.controller.state.items.length, 0);
});
