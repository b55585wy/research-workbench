const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture, run, job, result, document } = require("./translation-controller-fixture.cjs");

test("existing per-page translations follow the current page without overriding explicit history or submitting", async (t) => {
  const runs = [2, 1].map((page) => run({ id: `run-${page}`, pages: [page], total_pages: 1,
    processed_pages: 1, completed_pages: 1, result_pages: [result(page)] }));
  const f = fixture({ runs });
  t.after(f.dispose);
  await f.settle();
  assert.equal(f.child.value.selectedRunId, "run-1");
  assert.equal(f.child.value.selectedPage, 1);
  f.update({ currentPage: 2 });
  await f.settle();
  assert.equal(f.child.value.selectedRunId, "run-2");
  assert.equal(f.child.value.selectedPage, 2);
  f.child.value.selectRun("run-1");
  await f.settle();
  assert.equal(f.child.value.selectedRunId, "run-1");
  assert.equal(f.child.value.selectedPage, 1);
  f.update({ currentPage: 1 });
  await f.settle();
  assert.equal(f.child.value.selectedRunId, "run-1");
  assert.equal(f.posts().length, 0);
});

test("empty reading and display/language changes never submit; explicit current-page translation submits once", async (t) => {
  const created = run({ pages: [1], total_pages: 1, completed_pages: 0, processed_pages: 0, status: "queued", stage: "queued", result_pages: [] });
  const f = fixture({ runs: [], api: (url, options) => options.method === "POST" ? created : undefined });
  t.after(f.dispose);
  await f.settle();
  assert.equal(f.parent.value.overlayNotice, "No translation yet");
  for (const mode of ["translated", "original", "dual"]) {
    f.parent.value.changeMode(mode);
    await f.settle();
  }
  f.child.value.refreshHistory();
  f.update({ language: "zh" });
  await f.settle();
  assert.equal(f.parent.value.overlayNotice, "暂无译文");
  assert.equal(f.child.value.copy.page(1), "第 1 页");
  assert.equal(f.posts().length, 0);
  f.child.value.startCurrentPage();
  await f.settle();
  assert.equal(f.posts().length, 1);
  assert.equal(JSON.stringify(f.posts()[0].body.pages), "[1]");
  assert.equal(f.posts()[0].body.target_language, "en");
  assert.equal(f.posts()[0].body.confirmed, true);
});

test("completed whole-run follows the reader in translated mode and retains its current page while reading another result", async (t) => {
  const f = fixture({ runs: [run()], model: { currentPage: 7 } });
  t.after(f.dispose);
  await f.settle();
  f.parent.value.changeMode("translated");
  await f.settle();
  assert.equal(f.snapshot().jobId, "job-7");
  assert.equal(f.snapshot().resultPages[0].page, 7);
  assert.equal(f.parent.value.overlayNotice, null);
  assert.ok(Object.isFrozen(f.snapshot().resultPages[0].blocks[0]));
  f.update({ currentPage: 8 });
  await f.settle();
  assert.equal(f.snapshot().jobId, "job-8");
  assert.equal(f.child.value.selectedPage, 8);
  f.child.value.selectPage(3);
  await f.settle();
  assert.equal(f.child.value.selectedPage, 3);
  assert.equal(f.snapshot().jobId, "job-8");
  assert.equal(f.parent.value.overlayNotice, null);
  f.child.value.selectPage(4);
  await f.settle();
  assert.equal(f.parent.value.selectedRun.result_pages.length, 2);
  assert.equal(f.snapshot().jobId, "job-8");
  assert.equal(f.child.value.copy.page(3), "Page 3");
  assert.equal(f.posts().length, 0);
});

test("target switches reject other-language results; explicit history selection restores its own language without POST", async (t) => {
  const f = fixture({ runs: [run()] });
  t.after(f.dispose);
  await f.settle();
  f.parent.value.changeMode("translated");
  f.child.value.selectTargetLanguage("zh");
  await f.settle();
  assert.equal(f.snapshot().jobId, "");
  assert.equal(f.parent.value.currentPageCompleted, false);
  f.child.value.selectRun("run-1");
  await f.settle();
  assert.equal(f.parent.value.targetLanguage, "en");
  assert.equal(f.snapshot().jobId, "job-1");
  assert.equal(f.posts().length, 0);
});

test("late source-bound details cannot repopulate a changed document/source", async (t) => {
  let resolveOld;
  const old = new Promise((resolve) => { resolveOld = resolve; });
  const f = fixture({ runs: [run()], api: (url) => url.includes("/translation-runs/run-1?") ? old : undefined });
  t.after(f.dispose);
  await f.settle();
  f.update({ document: { ...document, sha256: "replacement-sha" } });
  await f.settle();
  resolveOld({ ...run(), result_pages: [result(1)] });
  await f.settle();
  f.parent.value.changeMode("translated");
  await f.settle();
  assert.equal(f.snapshot().sourceSha256, "replacement-sha");
  assert.equal(f.snapshot().jobId, "");
  assert.equal(f.parent.value.visibleJob, null);
  assert.equal(f.posts().length, 0);
});

test("page cache never mixes revisions or frozen prompt/parser/model/schema versions", async (t) => {
  const f = fixture({ runs: [run()] });
  t.after(f.dispose);
  await f.settle();
  f.parent.value.changeMode("translated");
  await f.settle();
  for (const version of [
    { revision: 2 }, { prompt_version: "prompt-2" }, { parser: { id: "parser", version: "2" } },
    { model_fingerprint: "model-2" }, { model: { name: "other-model" } }, { result_schema_version: 2 }
  ]) {
    f.parent.value.handleRunSelection({ ...run(version), result_pages: [result(2)] });
    await f.settle();
    assert.equal(f.snapshot().jobId, "");
    assert.equal(f.snapshot().resultPages.length, 0);
    f.parent.value.handleRunSelection({ ...run(), result_pages: [result(1)] });
    await f.settle();
  }
  assert.equal(f.posts().length, 0);
});

test("older jobs need no new version fields; note/assistant excerpts and source jump retain source identity", async (t) => {
  const old = job();
  const f = fixture({ jobs: [old] });
  t.after(f.dispose);
  await f.settle();
  await f.parent.value.openSaved(old.id);
  await f.settle();
  f.parent.value.changeMode("translated");
  await f.settle();
  assert.equal(f.snapshot().jobId, old.id);
  const originalBlock = old.result_pages[0].blocks[0];
  for (const action of ["note", "ask"]) {
    await f.parent.value.excerpt(action, originalBlock, 1);
    await f.settle();
  }
  assert.equal(f.excerpts.length, 2);
  for (const { value } of f.excerpts) {
    assert.equal(value.jobId, old.id);
    assert.equal(value.sourceSha256, document.sha256);
    assert.equal(value.sourceText, originalBlock.source_text);
    assert.equal(value.translatedText, originalBlock.translated_text);
  }
  f.parent.value.source(1, originalBlock.rect);
  await f.settle();
  assert.equal(f.sources[0][2], document.id);
  assert.equal(f.sources[0][3], document.sha256);
  assert.equal(f.parent.value.mode, "original");
  assert.equal(f.posts().length, 0);
});

test("run excerpts use the result page's job ID; failed/invalid excerpts do not create work", async (t) => {
  const f = fixture({ runs: [run()], model: { currentPage: 7 }, excerpt: () => false });
  t.after(f.dispose);
  await f.settle();
  const block = result(7).blocks[0];
  await f.parent.value.excerpt("ask", block, 7);
  await f.settle();
  assert.equal(f.excerpts[0].value.jobId, "job-7");
  assert.equal(f.parent.value.operationError, "excerpt");
  await f.parent.value.excerpt("note", { ...block, rect: { x: -1, y: 0, width: 1, height: 1 } }, 7);
  assert.equal(f.excerpts.length, 1);
  assert.equal(f.posts().length, 0);
});
