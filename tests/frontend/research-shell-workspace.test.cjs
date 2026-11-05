const assert = require("node:assert/strict");
const test = require("node:test");
const { workspaceFixture } = require("./research-shell-fixture.cjs");

test("snapshots are stable, immutable and publish only after native DOM state; unsubscribe is idempotent", () => {
  const f = workspaceFixture();
  const first = f.workspace.getSnapshot();
  assert.equal(first.mode, "reading");
  assert.equal(first.pending, false);
  assert.equal(Object.isFrozen(first), true);
  let calls = 0;
  const stop = f.workspace.subscribe((snapshot) => {
    calls += 1;
    assert.equal(f.document.querySelector(".workspace").dataset.workspaceMode, snapshot.mode);
    assert.equal(f.document.getElementById("data-workspace").dataset.tool, snapshot.tool);
    assert.equal(f.document.getElementById("documents-panel").hidden, !snapshot.libraryVisible);
  });
  f.workspace.documentChanged();
  assert.equal(f.workspace.getSnapshot(), first);
  assert.equal(calls, 0);
  f.workspace.reveal("data", { tool: "charts" });
  assert.equal(calls, 1);
  stop(); stop();
  f.workspace.reveal("reading");
  assert.equal(calls, 1);
  assert.throws(() => f.workspace.subscribe(null), /listener/);
});

test("native sidebars, pending, language and owner changes reach the model without navigation", () => {
  const f = workspaceFixture();
  const snapshots = [];
  f.workspace.subscribe((snapshot) => snapshots.push(snapshot));
  f.document.getElementById("workspace-library-toggle").click();
  f.document.getElementById("workspace-notes-toggle").click();
  assert.equal(f.workspace.getSnapshot().libraryVisible, false);
  assert.equal(f.workspace.getSnapshot().notesVisible, false);
  f.workspace.setModePending(true);
  for (const id of ["workspace-mode-reading", "workspace-mode-data", "data-tool-analysis", "data-tool-charts", "data-tool-presentations"]) {
    assert.equal(f.document.getElementById(id).disabled, true);
    f.document.getElementById(id).click();
  }
  assert.equal(f.workspace.getSnapshot().mode, "reading");
  f.workspace.setModePending(false);
  f.workspace.applyLanguage("zh");
  f.setOwner({ id: "paper-1", title: "<source title>", kind: "paper" });
  f.workspace.documentChanged();
  assert.equal(f.workspace.getSnapshot().ownerTitle, "<source title>");
  assert.equal(f.workspace.getSnapshot().language, "zh");
  assert.equal(snapshots.length, 6);
  assert.equal(f.commands.filter(([kind]) => ["mode", "notes", "charts"].includes(kind)).length, 0);
});

test("PPT is a standalone real panel, preserves source URLs/drafts and restores from explicit tool", () => {
  const f = workspaceFixture({ search: "?workspace=data&chart=chart-1&dataset=data-1", owner: { id: "paper-1", title: "Paper" } });
  const panel = f.document.getElementById("presentations-panel");
  const draft = f.document.getElementById("presentation-title");
  draft.value = "Retained outline title";
  f.workspace.setImportReview("paper-1", true, true);
  f.workspace.reveal("data", { tool: "presentations", updateUrl: true, reviewOpen: false });
  assert.equal(panel.hidden, false);
  assert.equal(panel.open, true);
  for (const id of ["analysis-panel", "charts-panel", "data-imports", "spss-import-review"]) assert.equal(f.document.getElementById(id).hidden, true);
  assert.equal(f.window.location.searchParams.get("chart"), "chart-1");
  assert.equal(f.window.location.searchParams.get("dataset"), "data-1");
  assert.equal(f.window.location.searchParams.get("tool"), "presentations");
  assert.equal(draft.value, "Retained outline title");
  const restored = workspaceFixture({ search: f.window.location.search });
  assert.equal(restored.workspace.getSnapshot().tool, "presentations");
  assert.equal(restored.workspace.getSnapshot().mode, "data");
  f.workspace.reveal("data", { tool: "charts" });
  assert.equal(panel.hidden, true);
  assert.equal(f.document.getElementById("charts-panel").hidden, false);
  f.workspace.reveal("data", { tool: "analysis" });
  assert.equal(f.document.getElementById("analysis-panel").hidden, false);
  assert.equal(f.document.getElementById("data-imports").hidden, false);
  f.workspace.reveal("data", { tool: "unknown" });
  assert.equal(f.workspace.getTool(), "analysis");
});

test("existing note/image/chart/analysis URL precedence survives the new PPT tool", () => {
  for (const [search, mode, tool] of [
    ["?tool=presentations", "data", "presentations"],
    ["?workspace=reading&tool=presentations", "reading", "presentations"],
    ["?note=note-1&tool=presentations", "reading", "presentations"],
    ["?image_source=image-1&workspace=data", "reading", "analysis"],
    ["?chart=chart-1&tool=analysis", "data", "charts"],
    ["?analysis=analysis-1", "data", "analysis"],
    ["?dataset=data-1", "data", "analysis"]
  ]) {
    const f = workspaceFixture({ search });
    assert.equal(f.workspace.getMode(), mode, search);
    assert.equal(f.workspace.getTool(), tool, search);
  }
});

test("notes section callback runs after existing reveal logic and absence preserves fallback", () => {
  for (const notesCallback of [true, false]) {
    const f = workspaceFixture({ notesCallback, search: "?workspace=data" });
    for (const section of ["saved", "editor", "unknown"]) {
      f.workspace.showNotes(section);
      const expected = section === "saved" ? "saved" : "editor";
      assert.equal(f.document.getElementById(expected === "saved" ? "saved-notes-group" : "note-editor-group").open, true);
      assert.equal(f.workspace.getSnapshot().notesVisible, true);
      assert.equal(f.document.getElementById("notes-panel").hidden, false);
      if (notesCallback) assert.deepEqual(f.commands.at(-1), ["notes", expected]);
    }
  }
});

test("legacy controls remain explicit fallback commands and subscriber errors are isolated", () => {
  const f = workspaceFixture();
  let notified = 0;
  f.workspace.subscribe(() => { throw new Error("external listener"); });
  f.workspace.subscribe(() => { notified += 1; });
  f.document.getElementById("workspace-mode-data").click();
  assert.deepEqual(f.commands.at(-1), ["mode", "data"]);
  assert.equal(f.workspace.getMode(), "reading");
  f.document.getElementById("data-tool-presentations").click();
  assert.equal(f.workspace.getTool(), "presentations");
  assert.equal(notified, 1);
  assert.equal(f.errors.length, 1);
  f.workspace.reveal("reading");
  assert.equal(f.workspace.getSnapshot().notesVisible, true);
  assert.equal(f.workspace.getSnapshot().libraryVisible, true);
});
