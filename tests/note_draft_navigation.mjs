import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createNoteDraftControls, createNoteDraftHistory } from "../frontend/note-draft-controls.js";

const appSource = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8");
const functions = ["makeEmptyDraft", "ensureDraft", "captureCurrentDraft", "noteDraftOwns", "currentNoteDraftContext",
  "renderNoteDraftCancel", "discardCurrentNoteDraft", "contextNavigationBlocker", "prepareContextNavigation",
  "cancelSelection", "setRegionMode", "cancelEditNote", "mutationKey"];
const lifecycleSource = functions.map((name) => {
  const match = appSource.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, `Missing lifecycle entry ${name}`);
  return match[0];
}).join("\n");

function fixture() {
  const events = { confirms: [], statuses: [], closes: 0, focus: 0, pointerRelease: 0,
    ranges: 0, resets: 0, writes: 0, renders: 0, shapeCancels: 0 };
  const flags = { accept: true, richError: false, editorActive: false, generation: 2 };
  const images = new Map([["a", []], ["b", ["other-image"]]]);
  const uploadedImages = ["image-a", "other-image"];
  const highlightNodes = ["draft-source-a", "reader-capture-a", "saved-note", "draft-source-b"].map((id) => ({
    dataset: { noteId: id }, removed: false, remove() { this.removed = true; }
  }));
  const attributes = () => ({ setAttribute() {} });
  const state = {
    document: { id: "a", sha256: "sha-a", kind: "pdf" }, pdf: {}, loadSequence: 1, drafts: new Map(),
    editDrafts: new Map(), pendingSaves: 0, pendingMutations: new Map(), pendingMetadata: new Map(), pendingExcerpts: new Set(),
    regionCapture: null, selection: null, capturedTextSelection: null, regionActive: false, regionDraftOwner: null,
    highlight: null, highlightRevealId: null, pointerDragPage: null, notes: [{ id: "saved-note", text: "saved content" }]
  };
  const browserSelection = { anchorNode: { reader: true }, removeAllRanges: () => { events.ranges += 1; } };
  const sandbox = {
    state, deviceMode: true, window: { location: { pathname: "/guest-a" }, getSelection: () => browserSelection },
    elements: { noteText: { value: "" }, noteCancel: {}, activeSelection: {}, anchorHelp: {},
      regionMode: attributes(), readerRegionMode: attributes(),
      readerStage: { contains: (node) => node?.reader, querySelectorAll: (selector) => selector === ".source-highlight"
        ? highlightNodes.filter((node) => !node.removed) : [] } },
    isStudy: () => false,
    richText: {
      isEditorActive: () => flags.editorActive, hasUnpreservedChanges: () => flags.richError,
      close: () => { events.closes += 1; flags.editorActive = false; }, focus: () => { events.focus += 1; }
    },
    workspace: { getNavigationGeneration: () => flags.generation, showNotes() {} },
    imageLibrary: {
      getNoteSelection: (id) => [...(images.get(id) || [])],
      clearNoteSelection: (id, ids) => images.set(id, images.get(id).filter((image) => !ids.includes(image)))
    },
    readerShapes: { updateControls() {}, cancel: () => { events.shapeCancels += 1; },
      hasUnsavedChanges: () => flags.shapeDirty },
    assistant: { contextChanged() {}, isClearPending: () => flags.clearPending },
    chartSkills: null,
    analysis: { hasPending: () => flags.analysisPending }, presentations: { hasPending: () => flags.presentationPending },
    dataImports: { isImportPending: () => flags.importPending }, study: { hasPending: () => flags.studyPending },
    selectionTranslation: { selectionChanged() {} },
    captureCurrentMetadataDraft() {}, renderReaderActionLabel() {},
    resetTextAnnotationToolbar: () => { events.resets += 1; },
    clearStatus: () => { events.statuses = []; }, setStatus: (key) => events.statuses.push(key), t: (key) => key,
    renderDocumentDetails() {}, renderNotes() {},
    renderDraft: () => {
      events.renders += 1;
      const draft = state.editDrafts.get(state.document?.id) || state.drafts.get(state.document?.id);
      sandbox.elements.noteText.value = draft?.text || "";
      sandbox.renderNoteDraftCancel();
    },
    api: () => { events.writes += 1; throw new Error("Unexpected persistence call"); },
    fetch: () => { throw new Error("Unexpected network"); }
  };
  vm.createContext(sandbox);
  vm.runInContext(lifecycleSource, sandbox);
  const draft = sandbox.ensureDraft("a");
  const otherDraft = sandbox.ensureDraft("b");
  otherDraft.text = "other document's draft";
  sandbox.noteDraftControls = createNoteDraftControls({
    capture: sandbox.captureCurrentDraft, getContext: sandbox.currentNoteDraftContext,
    confirm: (mode) => { events.confirms.push(mode); return typeof flags.accept === "function" ? flags.accept() : flags.accept; },
    blocked: sandbox.setStatus, discard: sandbox.discardCurrentNoteDraft
  });
  const setText = (text) => { draft.text = text; sandbox.elements.noteText.value = text; };
  const owned = (values = {}) => ({ documentId: "a", sourceSha: "sha-a", draftOwner: state.editDrafts.get("a") || draft, ...values });
  return { ...sandbox, sandbox, events, flags, draft, otherDraft, images, uploadedImages, highlightNodes,
    browserSelection, setText, owned };
}

test("skill editing is checked before navigation; declined or pending preparation preserves the current owner", () => {
  for (const allowed of [false, true]) {
    const f = fixture();
    let calls = 0;
    f.sandbox.chartSkills = { hasUnsavedWork: () => true, prepareNavigation: () => { calls++; return allowed; } };
    assert.equal(f.prepareContextNavigation(), allowed);
    assert.equal(calls, 1);
    assert.equal(f.state.document.id, "a");
    assert.equal(f.events.writes, 0);
  }
});

test("cancel clears only this draft, its pointer/capture/text/highlight and image choices; a new selection works", () => {
  const f = fixture();
  f.setText("new unsaved note");
  f.draft.page = 1;
  f.images.set("a", ["image-a"]);
  f.state.regionCapture = f.owned({ requestId: "capture-a", previewCanvas: { width: 20 }, pending: false });
  f.state.capturedTextSelection = f.owned({ text: "quote", sequence: 1 });
  f.state.regionActive = true;
  f.state.regionDraftOwner = f.draft;
  f.state.pointerDragPage = 1;
  const activeSelection = { hidden: false };
  f.state.selection = f.owned({ pointerId: 7, activeSelection, overlay: {
    hasPointerCapture: () => true, releasePointerCapture: () => { f.events.pointerRelease += 1; }
  } });
  f.state.highlight = f.owned({ id: "draft-source-a", document_id: "a" });
  assert.equal(f.noteDraftControls.cancel("create"), true);
  assert.equal(f.state.drafts.get("a").text, "");
  assert.equal(f.state.drafts.get("a").page, null);
  assert.equal(f.state.regionCapture, null);
  assert.equal(f.state.selection, null);
  assert.equal(f.state.capturedTextSelection, null);
  assert.equal(f.state.regionActive, false);
  assert.equal(f.state.pointerDragPage, null);
  assert.equal(activeSelection.hidden, true);
  assert.equal(f.events.pointerRelease, 1);
  assert.equal(f.events.ranges, 1);
  assert.deepEqual(f.images.get("a"), []);
  assert.deepEqual(f.images.get("b"), ["other-image"]);
  assert.deepEqual(f.uploadedImages, ["image-a", "other-image"]);
  assert.deepEqual(f.state.notes, [{ id: "saved-note", text: "saved content" }]);
  assert.equal(f.state.drafts.get("b"), f.otherDraft);
  assert.equal(f.otherDraft.text, "other document's draft");
  assert.equal(f.highlightNodes.find((node) => node.dataset.noteId === "draft-source-a").removed, true);
  assert.equal(f.highlightNodes.find((node) => node.dataset.noteId === "saved-note").removed, false);
  assert.equal(f.highlightNodes.find((node) => node.dataset.noteId === "draft-source-b").removed, false);
  assert.equal(f.events.writes, 0);
  assert.equal(f.events.focus, 1);
  assert.equal(f.events.shapeCancels, 0);
  f.setRegionMode(true);
  assert.equal(f.state.regionDraftOwner, f.state.drafts.get("a"));
  assert.equal(f.noteDraftControls.getState().disabled, false);
});

test("declining cancel or leave preserves every draft, editor, source and image choice without notices", () => {
  const f = fixture();
  f.setText("retain plain and rich");
  f.draft.richContent = { ops: [{ insert: "retain plain and rich\n", attributes: { bold: true } }] };
  f.draft.page = 1;
  f.state.regionCapture = f.owned({ requestId: "capture-a" });
  f.state.highlight = f.owned({ id: "reader-capture-a", document_id: "a" });
  f.images.set("a", ["image-a"]);
  f.flags.editorActive = true;
  f.flags.accept = false;
  const snapshot = JSON.stringify(f.draft);
  const capture = f.state.regionCapture;
  const highlight = f.state.highlight;
  assert.equal(f.noteDraftControls.cancel("create"), false);
  assert.equal(f.prepareContextNavigation(), false);
  assert.equal(JSON.stringify(f.draft), snapshot);
  assert.equal(f.state.drafts.get("a"), f.draft);
  assert.equal(f.state.regionCapture, capture);
  assert.equal(f.state.highlight, highlight);
  assert.deepEqual(f.images.get("a"), ["image-a"]);
  assert.deepEqual(f.events.statuses, []);
  assert.equal(f.events.closes, 0);
  assert.equal(f.events.writes, 0);
});

test("source-only, screenshot-only and image-only drafts can be cancelled", () => {
  for (const kind of ["source", "capture", "image"]) {
    const f = fixture();
    if (kind === "source") { f.draft.page = 1; f.draft.rect = [0.1, 0.2, 0.4, 0.6]; }
    if (kind === "capture") f.state.regionCapture = f.owned({ requestId: "capture-a" });
    if (kind === "image") f.images.set("a", ["image-a"]);
    f.renderNoteDraftCancel();
    assert.equal(f.elements.noteCancel.disabled, false);
    assert.equal(f.noteDraftControls.cancel("create"), true);
    assert.equal(f.events.confirms.length, 1);
    assert.equal(f.events.writes, 0);
  }
});

function startEdit(f) {
  const edit = { noteId: "saved-note", note: { text: "saved content" }, text: "edited content",
    richContent: null, originalRichContent: null, expectedRevision: 3, conflicted: false };
  f.state.editDrafts.set("a", edit);
  f.elements.noteText.value = edit.text;
  return edit;
}

test("cancel edit preserves saved content, parked create draft, its images and foreign temporary state", () => {
  const f = fixture();
  f.setText("parked creation");
  f.images.set("a", ["image-a"]);
  const capture = f.owned({ requestId: "create-capture" });
  f.state.regionCapture = capture;
  const edit = startEdit(f);
  f.state.highlight = { id: "saved-note", document_id: "a" };
  f.cancelEditNote();
  assert.equal(f.state.editDrafts.has("a"), false);
  assert.equal(f.state.drafts.get("a"), f.draft);
  assert.equal(f.draft.text, "parked creation");
  assert.equal(f.state.regionCapture, capture);
  assert.equal(f.state.highlight.id, "saved-note");
  assert.deepEqual(f.images.get("a"), ["image-a"]);
  assert.equal(edit.note.text, "saved content");
  assert.equal(f.events.confirms.length, 1);
  assert.equal(f.events.writes, 0);
});

test("one leave confirms an edit once and preserves the parked creation across repeated navigation guards", () => {
  const f = fixture();
  f.setText("parked creation");
  startEdit(f);
  const ticket = {};
  assert.equal(f.prepareContextNavigation(ticket), true);
  f.flags.generation += 1;
  f.state.loadSequence += 1;
  assert.equal(f.prepareContextNavigation(ticket), true);
  assert.equal(f.events.confirms.length, 1);
  assert.equal(f.draft.text, "parked creation");
  f.flags.accept = false;
  assert.equal(f.prepareContextNavigation({}), false);
  assert.equal(f.events.confirms.length, 2);
  assert.equal(f.events.writes, 0);
});

test("saved active highlights survive cancellation; edit-owned temporary highlights do not", () => {
  for (const saved of [true, false]) {
    const f = fixture();
    f.setText("creation");
    if (!saved) startEdit(f);
    f.state.highlight = saved ? { id: "saved-note", document_id: "a" }
      : f.owned({ id: "draft-source-a", document_id: "a" });
    assert.equal(f.noteDraftControls.cancel(saved ? "create" : "edit"), true);
    assert.equal(f.state.highlight?.id || null, saved ? "saved-note" : null);
    assert.equal(f.highlightNodes.find((node) => node.dataset.noteId === "saved-note").removed, false);
  }
});

test("pending operations, uncertain saves and screenshot failures retain original retry identities", () => {
  for (const kind of ["save", "mutation", "screenshot-pending", "save-failed", "image-failed", "screenshot-failed", "edit-failed"]) {
    const f = fixture();
    f.setText("retry content");
    const draft = kind === "edit-failed" ? startEdit(f) : f.draft;
    draft.requestId = "retry-id";
    draft.imageRequestIds = ["image-a"];
    if (kind === "save") f.state.pendingSaves = 1;
    if (kind === "mutation") f.state.pendingMutations.set("a:saved-note", {});
    if (kind === "save-failed" || kind === "edit-failed") draft.saveFailed = true;
    if (kind === "image-failed") draft.imageFailed = true;
    if (kind.startsWith("screenshot-")) f.state.regionCapture = f.owned({ requestId: "capture-retry", pending: kind.endsWith("pending"), error: kind.endsWith("failed") ? "request_failed" : null });
    assert.equal(f.noteDraftControls.cancel(), false, kind);
    assert.equal(f.prepareContextNavigation(), false, kind);
    assert.equal(draft.requestId, "retry-id");
    assert.deepEqual(draft.imageRequestIds, ["image-a"]);
    assert.equal(f.events.confirms.length, 0);
    assert.equal(f.events.closes, 0);
    assert.equal(f.events.writes, 0);
  }
});

test("confirmed revision conflicts remain explicitly discardable", () => {
  const f = fixture();
  const edit = startEdit(f);
  edit.conflicted = true;
  edit.saveFailed = true;
  assert.equal(f.noteDraftControls.cancel("edit"), true);
  assert.equal(f.state.editDrafts.size, 0);
});

test("metadata, analysis, import, conversation, drawing and rich-error navigation guards stay intact", () => {
  for (const kind of ["metadata", "analysisPending", "presentationPending", "studyPending", "importPending", "clearPending", "shapeDirty", "richError"]) {
    const f = fixture();
    f.setText("protected");
    if (kind === "metadata") f.state.pendingMetadata.set("a", {});
    else f.flags[kind] = true;
    assert.equal(f.prepareContextNavigation(), false, kind);
    assert.equal(f.events.confirms.length, 0);
    assert.equal(f.state.drafts.get("a"), f.draft);
  }
});

test("new metadata writes or source/scope changes during the dialog prevent stale clearing", () => {
  for (const kind of ["metadata", "source", "scope"]) {
    const f = fixture();
    f.setText("keep me");
    f.flags.accept = () => {
      if (kind === "metadata") f.state.pendingMetadata.set("a", {});
      if (kind === "source") f.state.document.sha256 = "replacement-source";
      if (kind === "scope") f.window.location.pathname = "/guest-b";
      return true;
    };
    assert.equal(f.prepareContextNavigation(), false);
    assert.equal(f.state.drafts.get("a"), f.draft);
    assert.equal(f.events.closes, 0);
    assert.equal(f.events.writes, 0);
  }
});

// Run the registered handler against a stack: replaceState cannot impersonate traversal restoration.
function historyFixture({ nativeIndexes = false, legacyEntry = false } = {}) {
  const f = fixture();
  const location = new URL("https://workbench.test/guest-a?workspace=reading");
  f.window.location = location;
  f.sandbox.URLSearchParams = URLSearchParams;
  const entries = [{ url: location.href, state: { existing: "preserved" } }];
  let cursor = 0;
  const queued = [];
  const effects = [];
  const history = {
    get state() { return entries[cursor].state; },
    pushState(data, title, url) {
      entries.splice(cursor + 1);
      entries.push({ url: new URL(url, location).href, state: structuredClone(data) });
      cursor += 1;
      location.href = entries[cursor].url;
    },
    replaceState(data, title, url = location.href) {
      entries[cursor] = { url: new URL(url, location).href, state: structuredClone(data) };
      location.href = entries[cursor].url;
    },
    go(delta) { queued.push(delta); }
  };
  f.window.history = history;
  if (nativeIndexes) f.window.navigation = { get currentEntry() { return { index: cursor }; } };
  if (legacyEntry) {
    entries.push({ url: `${location.origin}/guest-a?document=a&workspace=reading&page=1`, state: null });
    cursor = 1;
    location.href = entries[cursor].url;
  }
  f.sandbox.noteDraftHistory = createNoteDraftHistory(f.window);
  let mode = "reading";
  f.workspace.getMode = () => mode;
  f.workspace.modeForParams = (params) => params.get("workspace") || "reading";
  f.workspace.reveal = (next) => { effects.push("reveal"); mode = next; f.flags.generation += 1; };
  f.workspace.documentChanged = () => effects.push("workspace");
  f.sandbox.invalidateWorkspaceModeIntent = () => effects.push("invalidate");
  f.sandbox.cancelReaderProgressRestore = () => effects.push("progress");
  f.sandbox.cancelDocumentWork = () => effects.push("cancel");
  for (const name of ["study", "imageLibrary", "assistant"]) f.sandbox[name].documentChanged = () => effects.push(name);
  for (const name of ["analysis", "dataImports", "presentations"]) f.sandbox[name].reload = () => effects.push(name);
  f.sandbox.charts = { reload: () => effects.push("charts") };
  f.sandbox.renderDocuments = () => effects.push("documents");
  f.sandbox.renderMetadata = () => effects.push("metadata");
  f.sandbox.imageViewer = { close: () => effects.push("image-close") };
  f.sandbox.goToPage = (page) => { effects.push("page"); f.state.page = page; };
  f.sandbox.readImageLink = () => null;
  f.sandbox.readPageParam = (params) => Number(params.get("page")) || null;
  f.state.document.page_count = 4;
  f.sandbox.openDocument = (id, options) => {
    // Use openDocument's actual ticket selection and repeat its later guard.
    const ticketDeclaration = appSource.match(/^  const draftNavigation = options\.[^\n]+;/m)[0];
    const ticket = vm.runInNewContext(`${ticketDeclaration}\ndraftNavigation`, { options, workspaceDraftNavigation: null });
    assert.equal(f.prepareContextNavigation(ticket), true);
    effects.push("open");
    f.state.document = { id, sha256: `sha-${id}`, page_count: 4 };
  };
  let handler;
  f.window.addEventListener = (type, callback) => { assert.equal(type, "popstate"); handler = callback; };
  const source = appSource.match(/^window.addEventListener\("popstate",[^]*?^\}\);/m)[0];
  vm.runInContext(source, f.sandbox);
  const travel = (delta) => {
    assert.ok(cursor + delta >= 0 && cursor + delta < entries.length, "traversal stays in stack");
    cursor += delta;
    location.href = entries[cursor].url;
    handler({ state: history.state });
  };
  const flush = () => {
    let count = 0;
    while (queued.length) { assert.ok(count++ < 5, "restoration must not loop"); travel(queued.shift()); }
  };
  const push = (query) => history.pushState({}, "", `/guest-a?${query}`);
  if (!legacyEntry) push("document=a&workspace=reading&page=1");
  return { ...f, entries, effects, history, push, travel, flush, queued, location, getMode: () => mode,
    getCursor: () => cursor };
}

for (const [name, target] of [
  ["library", null], ["same-owner workspace", "document=a&workspace=data"],
  ["other document", "document=b&workspace=reading"]
]) {
  test(`popstate decline to ${name} retains UI, owner, draft and visible address`, () => {
    const f = historyFixture();
    if (target) { f.push(target); f.push("document=a&workspace=reading&page=1"); }
    f.setText("keep history draft");
    f.state.regionCapture = f.owned({ requestId: "keep-capture" });
    const capture = f.state.regionCapture;
    const address = f.location.href;
    const stack = JSON.stringify(f.entries);
    f.flags.accept = false;
    f.travel(-1);
    assert.deepEqual(f.effects, [], "nothing is revealed or cancelled before approval");
    f.flush();
    assert.equal(f.location.href, address);
    assert.equal(f.getCursor(), f.entries.length - 1);
    assert.equal(JSON.stringify(f.entries), stack);
    assert.equal(f.getMode(), "reading");
    assert.equal(f.state.document.id, "a");
    assert.equal(f.state.drafts.get("a"), f.draft);
    assert.equal(f.draft.text, "keep history draft");
    assert.equal(f.state.regionCapture, capture);
    assert.equal(f.events.confirms.length, 1);
    assert.equal(f.events.writes, 0);
  });
}

for (const failure of ["pending write", "failed save"]) {
  test(`popstate ${failure} blocks without confirmation and restores address`, () => {
    const f = historyFixture();
    f.setText("retry content");
    f.draft.requestId = "retry-history";
    if (failure === "pending write") f.state.pendingSaves = 1;
    else f.draft.saveFailed = true;
    const address = f.location.href;
    f.travel(-1);
    f.flush();
    assert.equal(f.location.href, address);
    assert.deepEqual(f.effects, []);
    assert.equal(f.draft.text, "retry content");
    assert.equal(f.draft.requestId, "retry-history");
    assert.equal(f.events.confirms.length, 0);
    assert.equal(f.events.statuses.length, 1);
  });
}

test("same-owner page-only Back/Forward retains the draft without a discard dialog", () => {
  const f = historyFixture();
  f.push("document=a&workspace=reading&page=2");
  f.setText("draft survives page travel");
  f.flags.accept = false;
  f.travel(-1);
  assert.equal(f.state.page, 1);
  f.travel(1);
  assert.equal(f.state.page, 2);
  assert.equal(f.state.drafts.get("a"), f.draft);
  assert.equal(f.draft.text, "draft survives page travel");
  assert.equal(f.events.confirms.length, 0);
  assert.deepEqual(f.queued, []);
});

test("declined multi-step Back and Forward restore the exact entry; later acceptance traverses the original stack", () => {
  const f = historyFixture();
  f.push("document=b&workspace=reading");
  f.push("document=a&workspace=reading&page=3");
  f.setText("protected");
  f.flags.accept = false;
  const stack = JSON.stringify(f.entries);
  const address = f.location.href;
  f.travel(-3);
  f.flush();
  assert.equal(f.location.href, address);
  assert.equal(f.getCursor(), 3);
  f.flags.accept = true;
  f.travel(-2); // same owner/page only
  assert.equal(f.getCursor(), 1);
  f.flags.accept = false;
  f.travel(1); // declined Forward to b
  f.flush();
  assert.equal(f.getCursor(), 1);
  assert.equal(JSON.stringify(f.entries), stack);
  f.flags.accept = true;
  f.travel(1);
  assert.equal(f.getCursor(), 2);
  assert.equal(f.state.document.id, "b");
  assert.equal(f.events.confirms.length, 3);
  assert.deepEqual(f.queued, []);
});

test("accepted cross-document history shares one ticket and retains a parked creation draft", () => {
  const f = historyFixture();
  f.push("document=b&workspace=reading");
  f.push("document=a&workspace=reading");
  f.setText("parked creation");
  startEdit(f);
  f.travel(-1);
  assert.equal(f.state.document.id, "b");
  assert.equal(f.state.editDrafts.has("a"), false);
  assert.equal(f.draft.text, "parked creation");
  assert.equal(f.events.confirms.length, 1);
  assert.deepEqual(f.queued, []);
});

test("accepted library and same-document workspace traversal run after one discard", () => {
  for (const dataTarget of [false, true]) {
    const f = historyFixture();
    if (dataTarget) { f.push("document=a&workspace=data"); f.push("document=a&workspace=reading"); }
    f.setText("discard accepted");
    f.travel(-1);
    assert.equal(f.state.document?.id || null, dataTarget ? "a" : null);
    assert.equal(f.getMode(), dataTarget ? "data" : "reading");
    assert.equal(f.state.drafts.get("a").text, "");
    assert.equal(f.events.confirms.length, 1);
    assert.equal(f.events.writes, 0);
  }
});

test("history replacement retains entry identity, caller state and the original Forward entry", () => {
  const f = historyFixture();
  assert.equal(f.entries[0].state.existing, "preserved");
  f.push("document=a&workspace=reading&page=2");
  f.travel(-1);
  f.history.replaceState({ callerState: "kept" }, "", "/guest-a?document=a&workspace=reading&page=3");
  assert.equal(f.history.state.callerState, "kept");
  f.setText("protected after replacement");
  f.flags.accept = false;
  const address = f.location.href;
  f.travel(-1);
  f.flush();
  assert.equal(f.location.href, address);
  assert.equal(f.getCursor(), 1);
  f.travel(1);
  assert.equal(f.state.page, 2);
  assert.equal(f.entries.length, 3);
  assert.equal(f.events.confirms.length, 1);
});

test("native browser entry indexes restore an unmarked pre-upgrade history entry", () => {
  const f = historyFixture({ nativeIndexes: true, legacyEntry: true });
  f.setText("keep existing session draft");
  f.flags.accept = false;
  const stack = JSON.stringify(f.entries);
  const address = f.location.href;
  f.travel(-1);
  f.flush();
  assert.equal(f.location.href, address);
  assert.equal(JSON.stringify(f.entries), stack);
  assert.equal(f.events.confirms.length, 1);
  assert.deepEqual(f.effects, []);
});
