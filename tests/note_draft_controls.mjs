import test from "node:test";
import assert from "node:assert/strict";
import { createNoteDraftControls, noteDraftState } from "../frontend/note-draft-controls.js";

function fixture(change = {}) {
  const draft = { text: "", page: null, richContent: null, requestId: null, ...change };
  const context = {
    document: { id: "paper-a" }, documentId: "paper-a", sourceSha: "source-a", scope: "device:guest-a",
    loadGeneration: 1, navigationGeneration: 2, mode: "create", draft, imageIds: [],
    capture: null, selection: null, textSelection: null, highlight: null, regionActive: false,
    richError: false, pending: false, retryRequired: false
  };
  const events = { confirm: [], discard: [], blocked: [], captures: 0 };
  let current = context;
  let answer = () => true;
  const controls = createNoteDraftControls({
    capture: () => { events.captures += 1; },
    getContext: () => current,
    confirm: (mode) => { events.confirm.push(mode); return answer(); },
    blocked: (reason) => events.blocked.push(reason),
    discard: (value, options) => {
      events.discard.push({ value, options });
      current = { ...value, draft: { text: "", page: null }, capture: null, selection: null,
        textSelection: null, highlight: null, imageIds: [], regionActive: false };
    }
  });
  return { context, controls, events, setContext: (value) => { current = value; },
    answer: (callback) => { answer = callback; } };
}

test("empty creation is disabled and a cancellation is a no-op", () => {
  const f = fixture();
  assert.equal(f.controls.getState().disabled, true);
  assert.equal(f.controls.cancel("create"), false);
  assert.equal(f.controls.prepareNavigation(), true);
  assert.deepEqual(f.events.confirm, []);
  assert.deepEqual(f.events.discard, []);
  assert.equal(noteDraftState(null).disabled, true);
  f.setContext(null);
  assert.equal(f.controls.cancel(), false);
  assert.equal(f.controls.prepareNavigation(), true);
});

const dirtyScenarios = {
  text: (f) => { f.context.draft.text = "未保存的文字"; },
  "maximum text": (f) => { f.context.draft.text = "x".repeat(10000); },
  "explicit page only": (f) => { f.context.draft.page = 1; },
  "rectangle source only": (f) => { f.context.draft.page = 1; f.context.draft.rect = [0.1, 0.2, 0.3, 0.4]; },
  "rich image only": (f) => { f.context.draft.richContent = { ops: [{ insert: { research_image: { image_id: "image-a" } } }, { insert: "\n" }] }; },
  "rich formatting only": (f) => { f.context.draft.richContent = { ops: [{ insert: "\n", attributes: { header: 1 } }] }; },
  "selected image only": (f) => { f.context.imageIds = ["image-a"]; },
  "capture only": (f) => { f.context.capture = { requestId: "capture-a", pending: false }; },
  "region pointer only": (f) => { f.context.selection = { pointerId: 7, currentX: 10, currentY: 12 }; },
  "PDF text selection only": (f) => { f.context.textSelection = { page: 1, text: "source quote" }; },
  "region mode only": (f) => { f.context.regionActive = true; },
  "draft highlight only": (f) => { f.context.highlight = { id: "draft-source-paper-a" }; }
};

for (const [name, setup] of Object.entries(dirtyScenarios)) {
  test(`${name}: decline preserves all choices; accept discards once`, () => {
    const f = fixture();
    setup(f);
    const snapshot = JSON.stringify(f.context);
    f.answer(() => false);
    assert.equal(f.controls.getState().disabled, false);
    assert.equal(f.controls.cancel("create"), false);
    assert.equal(JSON.stringify(f.context), snapshot);
    assert.equal(f.events.discard.length, 0);
    assert.deepEqual(f.events.blocked, []);
    f.answer(() => true);
    assert.equal(f.controls.cancel("create"), true);
    assert.equal(f.events.discard.length, 1);
    assert.equal(f.controls.getState().disabled, true);
  });
}

test("Quill's empty newline is not an unsaved note", () => {
  const f = fixture({ richContent: { ops: [{ insert: "\n" }] } });
  assert.equal(f.controls.getState().disabled, true);
  assert.equal(f.controls.prepareNavigation(), true);
  assert.equal(f.events.confirm.length, 0);
});

test("edit cancellation asks only for actual changes, including formatting and removed content", () => {
  for (const kind of ["unchanged", "text", "format", "empty"]) {
    const f = fixture({ text: "saved", note: { text: "saved" }, originalRichContent: null });
    f.context.mode = "edit";
    if (kind === "text") f.context.draft.text = "changed";
    if (kind === "format") f.context.draft.richContent = { ops: [{ insert: "saved", attributes: { bold: true } }, { insert: "\n" }] };
    if (kind === "empty") f.context.draft.text = "";
    assert.equal(f.controls.cancel("edit"), true);
    assert.equal(f.events.confirm.length, kind === "unchanged" ? 0 : 1);
    assert.equal(f.context.draft.note.text, "saved");
  }
});

test("pending and unresolved-save receipts block both cancel and leave without a confirmation", () => {
  for (const field of ["pending", "retryRequired"]) {
    const f = fixture({ text: "retry text", requestId: "original-request", imageRequestIds: ["original-image"] });
    f.context[field] = true;
    assert.equal(f.controls.cancel("create"), false);
    assert.equal(f.controls.prepareNavigation(), false);
    assert.equal(f.events.confirm.length, 0);
    assert.equal(f.events.discard.length, 0);
    assert.equal(f.context.draft.requestId, "original-request");
    assert.deepEqual(f.context.draft.imageRequestIds, ["original-image"]);
    assert.equal(f.events.blocked.length, 2);
  }
});

test("navigation rich errors remain protected, while explicit cancellation can discard them", () => {
  const f = fixture({ text: "recoverable" });
  f.context.richError = true;
  assert.equal(f.controls.prepareNavigation(), false);
  assert.deepEqual(f.events.blocked, ["navigationRichDraftError"]);
  assert.equal(f.controls.cancel("create"), true);
});

for (const field of ["scope", "documentId", "sourceSha", "loadGeneration", "navigationGeneration", "draft", "imageIds", "capture", "selection", "textSelection", "highlight"]) {
  test(`changed ${field} during confirmation prevents stale clearing`, () => {
    const f = fixture({ text: "keep me" });
    f.answer(() => {
      const replacement = ["draft", "capture", "selection", "textSelection", "highlight"].includes(field) ? {} : field === "imageIds" ? ["new-image"] : "different";
      f.setContext({ ...f.context, [field]: replacement });
      return true;
    });
    assert.equal(f.controls.cancel("create"), false);
    assert.equal(f.events.discard.length, 0);
  });
}

test("content mutation and newly pending work are checked again after confirmation", () => {
  for (const change of ["text", "pending", "navigationBlocked"]) {
    const f = fixture({ text: "before dialog" });
    f.answer(() => {
      if (change === "text") f.context.draft.text = "new content";
      else f.context[change] = change === "pending" ? true : "navigationDrawing";
      return true;
    });
    assert.equal(f.controls.prepareNavigation(), false);
    assert.equal(f.events.discard.length, 0);
  }
});

test("navigation is synchronous; decline is silent and accept resets a fresh creation", () => {
  const f = fixture({ text: "leave test" });
  f.answer(() => false);
  assert.equal(f.controls.prepareNavigation(), false);
  assert.deepEqual(f.events.blocked, []);
  f.answer(() => true);
  assert.equal(f.controls.prepareNavigation(), true);
  assert.equal(f.events.discard[0].options.navigation, true);
  assert.equal(f.controls.prepareNavigation(), true);
  assert.equal(f.events.confirm.length, 2);
});

test("reentrant and asynchronous confirmation cannot discard a draft", () => {
  const f = fixture({ text: "keep" });
  f.answer(() => {
    assert.equal(f.controls.cancel("create"), false);
    return Promise.resolve(true);
  });
  assert.equal(f.controls.cancel("create"), false);
  assert.equal(f.events.discard.length, 0);
});

test("a navigation ticket cannot authorize an unrelated changed draft", () => {
  const f = fixture({ text: "changed edit", note: { text: "saved" } });
  f.context.mode = "edit";
  const parked = { ...f.context, mode: "create", draft: { text: "parked new note", page: 1 } };
  const ticket = {};
  const originalGet = f.controls.prepareNavigation;
  f.answer(() => true);
  assert.equal(originalGet(ticket), true);
  f.setContext(parked);
  f.answer(() => false);
  assert.equal(originalGet(ticket), false);
  assert.equal(f.events.confirm.length, 2);
});
