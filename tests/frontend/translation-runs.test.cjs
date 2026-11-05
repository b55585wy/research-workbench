const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture, run, result, document } = require("./translation-controller-fixture.cjs");

test("active, missing, failed and unavailable pages expose only their relevant reading status", async (t) => {
  const cases = [
    { value: run({ status: "running", stage: "translating", completed_pages: 0, processed_pages: 0, result_pages: [] }), expected: "This page is being translated. The original remains readable." },
    { value: run({ pages: [2], total_pages: 1, status: "running", completed_pages: 0, processed_pages: 0, result_pages: [] }), expected: "No translation for this page yet" },
    { value: run({ status: "failed", completed_pages: 0, result_pages: [{ ...result(1), status: "failed" }] }), expected: "This page could not be translated." },
    { value: run({ result_pages: [{ ...result(1), status: "unavailable" }] }), expected: "A translation is unavailable for this page." },
    { value: run({ status: "running", stage: "translating" }), expected: null }
  ];
  for (const { value, expected } of cases) {
    const f = fixture({ runs: [value] });
    t.after(f.dispose);
    await f.settle();
    assert.equal(f.parent.value.overlayNotice, expected);
    assert.equal(f.posts().length, 0);
  }
});

test("pause is explicit and a paused/failed run resumes only after sending confirmation", async (t) => {
  const active = run({ status: "running", stage: "translating", completed_pages: 3, processed_pages: 3 });
  let current = active;
  const f = fixture({ runs: [active], api: (url, options) => {
    if (options.method === "POST" && url.endsWith("/pause")) return current = { ...active, status: "paused", revision: 2 };
    if (options.method === "POST" && url.endsWith("/resume")) return current = { ...active, revision: 3 };
    if (url.includes("/translation-runs/run-1?")) return { ...current, result_pages: [result(1)] };
  } });
  t.after(f.dispose);
  await f.settle();
  assert.equal(f.child.value.copy.completedProgress(3, 10), "Translated 3/10 pages");
  assert.equal(f.posts().length, 0);
  f.child.value.pauseSelected();
  await f.settle();
  assert.equal(f.posts().length, 1);
  assert.equal(f.child.value.selectedRun.status, "paused");
  f.child.value.reviewResume();
  await f.settle();
  assert.equal(f.child.value.confirmation.kind, "resume");
  assert.equal(f.posts().length, 1);
  f.child.value.confirmOperation();
  await f.settle();
  assert.equal(f.posts().length, 2);
  assert.equal(f.posts()[1].body.expected_revision, 2);
  assert.equal(f.posts()[1].body.confirmed, true);
});

test("uncertain create retains exactly one request and retries only after an explicit retry", async (t) => {
  let attempts = 0;
  const created = run({ pages: [1], total_pages: 1, result_pages: [result(1)] });
  const f = fixture({ api: (url, options) => {
    if (options.method !== "POST") return;
    attempts += 1;
    if (attempts === 1) return Promise.reject({ code: "network" });
    return created;
  } });
  t.after(f.dispose);
  await f.settle();
  f.child.value.startCurrentPage();
  await f.settle();
  const retained = f.child.value.requestDraft;
  assert.equal(retained.kind, "create");
  assert.equal(f.child.value.operationError, "network");
  f.child.value.startCurrentPage();
  f.child.value.selectTargetLanguage("zh");
  f.child.value.refreshHistory();
  await f.settle();
  assert.equal(f.posts().length, 1);
  await f.child.value.submitDraft(retained);
  await f.settle();
  assert.equal(f.posts().length, 2);
  assert.deepEqual(f.posts()[1].body, f.posts()[0].body);
});

test("range validation rejects invalid/beyond-limit inputs; valid whole/range needs explicit confirmation", async (t) => {
  const f = fixture();
  t.after(f.dispose);
  await f.settle();
  for (const pages of ["", "0", "11", "3-1", "a", "1-201"]) {
    f.child.value.setSelectionMode("range");
    f.child.value.setPageInput(pages);
    await f.settle();
    f.child.value.reviewCreate();
    await f.settle();
    assert.equal(f.child.value.operationError, "invalid_pages");
  }
  f.child.value.setPageInput("1,3-5");
  await f.settle();
  f.child.value.reviewCreate();
  await f.settle();
  assert.equal(JSON.stringify(f.child.value.confirmation.pages), "[1,3,4,5]");
  assert.equal(f.posts().length, 0);
  const large = fixture({ model: { document: { ...document, pageCount: 201 } } });
  t.after(large.dispose);
  await large.settle();
  large.child.value.setSelectionMode("whole");
  await large.settle();
  large.child.value.reviewCreate();
  await large.settle();
  assert.equal(large.child.value.operationError, "whole_too_large");
  assert.equal(large.posts().length, 0);
});

test("detail permission failure stays read-only and an explicit retry can recover", async (t) => {
  let denied = true;
  const value = run();
  const f = fixture({ runs: [value], api: (url) => {
    if (url.includes("/translation-runs/run-1?")) return denied
      ? Promise.reject({ code: "permission_denied" })
      : { ...value, result_pages: [result(1)] };
  } });
  t.after(f.dispose);
  await f.settle();
  assert.equal(f.child.value.detailError, true);
  assert.equal(f.parent.value.visibleJob, null);
  denied = false;
  f.child.value.setDetailRetry((value) => value + 1);
  await f.settle();
  assert.equal(f.child.value.detailError, false);
  assert.equal(f.parent.value.currentPageCompleted, true);
  assert.equal(f.posts().length, 0);
});
