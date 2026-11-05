const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture, settle } = require("./assistant-fixture.cjs");

const source = (extra = {}) => ({ kind: "reference_pdf_page", ref: "R1", label: "Paper A", document_id: "paper-a", page: 2,
  url: "/?document=paper-a&page=2", source_sha256: "a".repeat(64), ...extra });

// Requirement scenarios: both rendered entry points; bracket/Markdown refs and
// legacy file links; provenance mismatches/invalid records; modified and native
// keyboard clicks; external/sanitized links; absent/rejected/cancelled/pending
// adapter; unchanged table/math/code content and table provenance exports.
test("plain refs, actual nested Markdown form and legacy PDF links navigate once with the original source", async () => {
  for (const kind of ["pdf_page", "associated_pdf_page", "reference_pdf_page"]) {
    for (const form of ["plain", "nested", "legacy"]) {
      const opened = [];
      const f = fixture({ onOpenPdfSource: async (value) => { opened.push(value); return true; } });
      const record = source({ kind, rect: [0.1, 0.2, 0.5, 0.6], source: { kind: "paper", id: "paper-a", sha256: "a".repeat(64) } });
      const href = form === "legacy" ? "/api/v1/documents/paper-a/file#page=2" : record.url;
      const answer = form === "plain" ? "[R1]" : `[[R1](https://workbench.invalid${href})]`;
      const node = form === "plain" ? f.el("p", {}, "[R1]") : f.el("p", {}, "[", f.el("a", { href }, "R1"), "]");
      const root = f.render(answer, [node], [record]);
      const link = root.querySelector("a.assistant-citation") || root.querySelector(".assistant-citation");
      assert.equal(root.textContent, "[R1]");
      assert.equal(link.href, record.url);
      assert.equal(link.target, "");
      assert.equal(link.getAttribute("aria-label"), "citationOpen");
      assert.equal(link.dispatch("click", { detail: 0 }).defaultPrevented, true); // Enter's native click.
      await settle();
      assert.equal(opened.length, 1);
      assert.equal(opened[0], record);
      assert.deepEqual(record.rect, [0.1, 0.2, 0.5, 0.6]);
    }
  }
});

test("source-list controls share the PDF callback, pending guard, href and unmodified provenance", async () => {
  let resolve;
  const opened = [];
  const f = fixture({ onOpenPdfSource: (value) => { opened.push(value); return new Promise((done) => { resolve = done; }); },
    navigateSource: () => assert.fail("PDF bypassed the dedicated adapter") });
  const record = source();
  const list = f.el("ul");
  f.context.appendSourceItem(list, record, 0, new Set());
  const link = list.querySelector("a");
  assert.equal(link.href, record.url);
  assert.equal(link.getAttribute("aria-label"), "citationOpen");
  assert.equal(link.dispatch("click").defaultPrevented, true);
  await settle();
  const inline = f.render("[R1]", [f.el("p", {}, "[R1]")], [record]).querySelector("a");
  inline.dispatch("click");
  link.dispatch("click");
  await settle();
  assert.equal(opened.length, 1);
  resolve(false); // Root draft guard cancelled; no UI state is changed here.
  await settle();
  inline.dispatch("click");
  await settle();
  assert.equal(opened.length, 2);
  assert.equal(opened[0], record);
  resolve(true);
  await settle();
});

test("Ctrl/Cmd/Shift/Alt, middle/right clicks and already handled events preserve browser behavior", async () => {
  let calls = 0;
  const f = fixture({ onOpenPdfSource: async () => { calls += 1; return true; } });
  const link = f.render("[R1]", [f.el("p", {}, "[R1]")], [source()]).querySelector("a");
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
    assert.equal(link.dispatch("click", init).defaultPrevented, false);
  }
  link.dispatch("click", { defaultPrevented: true });
  assert.equal(link.dispatch("auxclick", { button: 1 }).defaultPrevented, false);
  await settle();
  assert.equal(calls, 0);
  assert.equal(link.href, "/?document=paper-a&page=2");
});

test("a different source reaches root immediately and an older completion cannot clear its pending guard", async () => {
  const opened = [];
  const pending = [];
  const f = fixture({ onOpenPdfSource: (value) => { opened.push(value); return new Promise((resolve) => pending.push(resolve)); } });
  const a = source();
  const b = source({ document_id: "paper-b", url: "/?document=paper-b&page=2" });
  const first = f.context.openTurnSource(a);
  const second = f.context.openTurnSource(b);
  assert.deepEqual(opened, [a, b]);
  pending[0](false); // Older root navigation was superseded.
  assert.equal(await first, false);
  assert.equal(await f.context.openTurnSource(b), false);
  assert.equal(opened.length, 2);
  pending[1](true);
  assert.equal(await second, true);
});

test("missing, false, thrown and rejected adapters stay in place, settle safely and permit a later retry", async () => {
  for (const onOpenPdfSource of [undefined, () => false, () => { throw new Error("guard"); }, () => Promise.reject(new Error("missing"))]) {
    const f = fixture({ onOpenPdfSource, navigateSource: () => assert.fail("Unsafe legacy fallback") });
    const link = f.render("[R1]", [f.el("p", {}, "[R1]")], [source()]).querySelector("a");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal(link.dispatch("click").defaultPrevented, true);
      await settle();
    }
    assert.equal(f.window.location.origin, "https://workbench.invalid");
  }
  const f = fixture();
  const link = f.el("a");
  f.context.bindPdfSourceLink(link, source());
  assert.equal(link.dispatch("click").defaultPrevented, true);
  await settle();
});

test("only matching citation targets are enhanced; external, unknown, unsafe and mismatched Markdown refs are untouched", async () => {
  const hrefs = ["https://outside.invalid/?document=paper-a&page=2", "/?document=paper-b&page=2", "/?document=paper-a&page=3",
    "/?document=paper-a&page=2&space=other", "/?document=paper-a&page=2&page=2", "/other?document=paper-a&page=2", "javascript:alert(1)"];
  for (const href of hrefs) {
    const f = fixture({ onOpenPdfSource: () => assert.fail("Unverified link routed internally") });
    const root = f.render(`[[R1](${href})]`, [f.el("p", {}, "[", f.el("a", { href }, "R1"), "]")], [source()]);
    assert.equal(root.querySelector(".assistant-citation"), null);
    const link = root.querySelector("a");
    assert.equal(link.dispatch("click").defaultPrevented, false);
    if (href.startsWith("javascript:")) assert.equal(link.getAttribute("href"), null);
    if (href.startsWith("https://outside")) assert.equal(link.target, "_blank");
  }
  const f = fixture();
  const root = f.render("[R99](https://workbench.invalid/?document=paper-a&page=2)",
    [f.el("a", { href: source().url }, "R99")], [source()]);
  assert.equal(root.querySelector(".assistant-citation"), null);
  const duplicates = f.render("[R1] [R99]", [f.el("p", {}, "[R1] [R99]")], [source(), source({ document_id: "paper-b", url: "/?document=paper-b&page=2" })]);
  assert.equal(duplicates.querySelector(".assistant-citation"), null);
  assert.equal(duplicates.querySelectorAll(".assistant-citation-unverified").length, 2);
  await settle();
});

test("malformed PDF records never route through generic source navigation or create source-list links", async () => {
  const invalid = [{ page: 0 }, { page: -1 }, { page: 1.5 }, { page: "2" }, { page: Number.MAX_SAFE_INTEGER + 1 },
    { document_id: "" }, { document_id: "bad id" }, { document_id: "\ud800" }, { source_sha256: "stale-format" },
    { url: {} },
    { url: "/?document=wrong&page=2" }, { url: "https://outside.invalid/?document=paper-a&page=2" },
    { rect: [0, 0, 2, 1] }, { rect: [0.7, 0, 0.2, 1] }, { rect: [0, 0, 1] }, { rect: [0, NaN, 1, 1] }];
  const f = fixture({ onOpenPdfSource: () => assert.fail("Invalid PDF accepted"), navigateSource: () => assert.fail("Invalid PDF fell through") });
  for (const extra of invalid) {
    const record = source(extra);
    const list = f.el("ul");
    f.context.appendSourceItem(list, record, 0, new Set());
    assert.equal(list.querySelector("a"), null);
    assert.ok(list.querySelector(".assistant-citation-unverified"));
    assert.equal(await f.context.openTurnSource(record), false);
    const root = f.render("[R1]", [f.el("p", {}, "[R1]")], [record]);
    assert.equal(root.querySelector(".assistant-citation"), null);
  }
});

test("valid-format stale hashes and missing/out-of-range papers reach root unchanged for scoped validation", async () => {
  const opened = [];
  const f = fixture({ onOpenPdfSource: async (value) => { opened.push(value); return false; } });
  const record = source({ document_id: "deleted-paper", page: 999, url: "/?document=deleted-paper&page=999", source_sha256: "b".repeat(64) });
  const link = f.render("[R1]", [f.el("p", {}, "[R1]")], [record]).querySelector("a");
  link.dispatch("click");
  await settle();
  assert.equal(opened[0], record);
  assert.equal(opened.length, 1);
  assert.equal(record.rect, undefined);
});

test("online dataset, ordinary HTTP links and non-PDF source callbacks retain their behavior", async () => {
  const navigated = [];
  const f = fixture({ navigateSource: (value) => navigated.push(value) });
  const online = source({ kind: "online_dataset", url: "https://zenodo.org/records/123" });
  const root = f.render("[R1]", [f.el("p", {}, "[R1]"), f.el("a", { href: "https://example.org/article" }, "Article")], [online]);
  for (const link of root.querySelectorAll("a")) {
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.dispatch("click").defaultPrevented, false);
  }
  const list = f.el("ul");
  f.context.appendSourceItem(list, online, 0, new Set());
  assert.equal(list.querySelector("a").target, "_blank");
  const note = source({ kind: "note", note_id: "note-a" });
  const noteRoot = f.render("[R1]", [f.el("p", {}, "[R1]")], [note]);
  noteRoot.querySelector("button").dispatch("click");
  await settle();
  assert.deepEqual(navigated, [note]);
});

test("table citation, math/code exclusions, column structure and CSV provenance remain intact", async () => {
  const opened = [];
  const f = fixture({ onOpenPdfSource: async (value) => { opened.push(value); return true; } });
  const table = f.el("table", {}, f.el("thead", {}, f.el("tr", {}, f.el("th", {}, "Result"), f.el("th", {}, "Source"))),
    f.el("tbody", {}, f.el("tr", {}, f.el("td", {}, "42"), f.el("td", {}, "[R1]"))));
  const math = f.el("span", { class: "katex" }, "[R1]");
  const code = f.el("pre", {}, f.el("code", {}, "[R1]"));
  const record = source();
  const raw = "| Result | Source |\n| --- | --- |\n| 42 | [R1] |";
  const root = f.render(raw, [table, math, code], [record], [raw]);
  assert.equal(root.querySelectorAll(".assistant-citation").length, 1);
  assert.equal(math.textContent, "[R1]");
  assert.equal(code.textContent, "[R1]");
  assert.equal(table.tHead.rows[0].cells[0].scope, "col");
  assert.equal(root.querySelectorAll(".assistant-answer-table-actions").length, 1);
  const rows = f.context.exportRows(table, new Set([record]), { t: (key) => key });
  assert.deepEqual(Array.from(rows[1]), ["42", "[R1]"]);
  assert.deepEqual(Array.from(rows.at(-1)), ["R1", "Paper A", "2", record.url]);
  table.querySelector("a").dispatch("click");
  await settle();
  assert.equal(opened.length, 1);
});
