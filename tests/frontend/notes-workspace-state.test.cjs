const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const base = { language: "en", ownerId: "paper:a", noteCount: 0, hasDraft: false, editing: false, busy: false };
let createState;
test.before(async () => {
  ({ createNotesWorkspaceState: createState } = await import(pathToFileURL(path.join(__dirname, "../../web/src/features/notes-workspace/state.ts"))));
});

test("clean first view is saved; dirty and existing-note edit sessions start in editor", () => {
  assert.equal(createState(base).section, "saved");
  assert.equal(createState({ ...base, hasDraft: true }).section, "editor");
  assert.equal(createState({ ...base, editing: true }).section, "editor");
});

test("tab navigation and count/language/busy updates never change draft or edit flags", () => {
  const state = createState({ ...base, hasDraft: true, editing: true });
  for (const section of ["saved", "images", "editor", "saved"]) {
    assert.equal(state.show(section), true);
    state.update({ ...state.model, language: "zh", noteCount: 32, busy: true });
    assert.equal(state.section, section);
    assert.deepEqual(state.model, { ...base, language: "zh", noteCount: 32, hasDraft: true, editing: true, busy: true });
  }
  assert.equal(state.show("invalid"), false);
  assert.equal(state.section, "saved");
});

test("owner switches remember presentation; pristine sources do not turn into editing", () => {
  const state = createState(base);
  state.show("images");
  state.update({ ...base, ownerId: "study:b", noteCount: 4 });
  assert.equal(state.section, "saved");
  assert.equal(state.model.hasDraft, false);
  assert.equal(state.model.editing, false);
  state.show("editor");
  state.update(base);
  assert.equal(state.section, "images");
  state.update({ ...base, ownerId: "study:b", hasDraft: true });
  assert.equal(state.section, "editor");
  state.show("saved");
  state.update({ ...state.model, busy: true });
  assert.equal(state.section, "saved");
});

test("newly resumed drafts/edits reveal editor; clearing a draft never navigates or creates one", () => {
  for (const flag of ["hasDraft", "editing"]) {
    const state = createState(base);
    state.show("images");
    state.update({ ...base, [flag]: true });
    assert.equal(state.section, "editor");
    state.update(base);
    assert.equal(state.section, "editor");
    assert.deepEqual(state.model, base);
  }
});

test("explicit repeated show reopens its group, while ordinary updates retain native collapse state", () => {
  const state = createState(base);
  const initial = state.revealVersion;
  state.show("saved");
  assert.equal(state.revealVersion, initial + 1);
  state.show("saved");
  assert.equal(state.revealVersion, initial + 2);
  state.update({ ...base, noteCount: 5, busy: true, language: "zh" });
  assert.equal(state.revealVersion, initial + 2);
  state.update({ ...base, ownerId: "paper:new" });
  assert.equal(state.revealVersion, initial + 3);
});

test("null/local and named owners remain distinct, and model inputs are isolated snapshots", () => {
  const input = { ...base, ownerId: null };
  const state = createState(input);
  state.show("images");
  input.hasDraft = true;
  state.model.editing = true;
  assert.equal(state.model.hasDraft, false);
  assert.equal(state.model.editing, false);
  state.update({ ...base, ownerId: "null" });
  assert.equal(state.section, "saved");
  state.update({ ...base, ownerId: null });
  assert.equal(state.section, "images");
});

test("zero, fractional and invalid counts remain bounded; invalid model updates preserve state", () => {
  const state = createState(base);
  for (const [count, expected] of [[-1, 0], [1.9, 1], [NaN, 0], [Infinity, 0], [1e30, Number.MAX_SAFE_INTEGER]]) {
    state.update({ ...base, noteCount: count });
    assert.equal(state.model.noteCount, expected);
  }
  const previous = state.model;
  assert.throws(() => state.update({ ...base, language: "bad" }), /Invalid/);
  assert.throws(() => state.update({ ...base, ownerId: 42 }), /Invalid/);
  assert.deepEqual(state.model, previous);
});
