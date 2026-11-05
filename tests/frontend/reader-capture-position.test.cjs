const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../frontend/reader-capture-actions.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(`${source.replaceAll("export ", "")}\nglobalThis.geometry = { captureSelectionBounds, captureActionPlacement };`, context);
const { captureSelectionBounds, captureActionPlacement } = context.geometry;
const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const reader = box(100, 80, 700, 700);
const viewport = box(0, 0, 1000, 800);
const place = (selection, overrides = {}) => captureActionPlacement({ selection, reader, viewport, width: 200, height: 46, ...overrides });
const plain = (value) => JSON.parse(JSON.stringify(value));

test("capture projection uses the rendered surface's top-left normalized convention", () => {
  assert.deepEqual(plain(captureSelectionBounds(box(120, -100, 520, 500), [0.1, 0.2, 0.6, 0.8])), {
    left: 160, top: 20, right: 360, bottom: 380
  });
  assert.deepEqual(plain(captureSelectionBounds(box(0, 0, 200, 300), [0, 0, 1, 1])), {
    left: 0, top: 0, right: 200, bottom: 300
  });
});

test("invalid, empty and out-of-source selections cannot produce an anchor", () => {
  for (const rect of [null, [], [0, 0, 0, 1], [0, 1, 1, 0], [-0.1, 0, 1, 1], [0, 0, 1.1, 1], [0, 0, NaN, 1]]) {
    assert.equal(captureSelectionBounds(box(0, 0, 200, 300), rect), null);
  }
  assert.equal(captureSelectionBounds(box(0, 0, 0, 100), [0, 0, 1, 1]), null);
  assert.equal(captureSelectionBounds(null, [0, 0, 1, 1]), null);
});

test("visible selection gets a small gap below, or above when the bottom clips", () => {
  assert.deepEqual(plain(place(box(200, 200, 300, 260))), { left: 200, top: 268, docked: false });
  assert.deepEqual(plain(place(box(200, 630, 300, 680))), { left: 200, top: 576, docked: false });
});

test("left and right clipping keep every control within the reader", () => {
  assert.equal(place(box(0, 200, 250, 260)).left, 108);
  assert.equal(place(box(650, 200, 800, 260)).left, 492);
});

test("offscreen selections dock at the matching visible reader edge", () => {
  assert.deepEqual(plain(place(box(200, -100, 300, -50))), { left: 200, top: 88, docked: true });
  assert.deepEqual(plain(place(box(200, 900, 300, 950))), { left: 200, top: 646, docked: true });
  assert.equal(place(box(-100, 200, -50, 260)).left, 108);
  assert.equal(place(box(900, 200, 950, 260)).left, 492);
  assert.deepEqual(plain(place(null)), { left: 108, top: 646, docked: true });
});

test("oversized visible selection remains actionable with an edge dock", () => {
  const position = place(box(110, 82, 690, 698));
  assert.deepEqual(plain(position), { left: 110, top: 88, docked: true });
});

test("narrow desktop and mobile reader controls avoid sidebars and bottom navigation", () => {
  const narrow = place(box(430, 250, 560, 300), { reader: box(400, 80, 580, 600), width: 126 });
  assert.deepEqual(plain(narrow), { left: 430, top: 308, docked: false });
  const mobile = place(box(320, 570, 380, 620), {
    reader: box(0, 120, 390, 650), viewport: box(0, 0, 390, 640), width: 220, height: 54
  });
  assert.deepEqual(plain(mobile), { left: 162, top: 508, docked: false });
});

test("visual viewport offsets and a smaller keyboard viewport constrain placement", () => {
  const position = place(box(120, 380, 320, 440), { viewport: box(140, 150, 500, 460) });
  assert.deepEqual(plain(position), { left: 148, top: 326, docked: false });
});

test("zero, hidden, disjoint or too-small viewports request the legacy fallback", () => {
  assert.equal(place(null, { reader: box(0, 0, 0, 0) }), null);
  assert.equal(place(null, { viewport: box(800, 0, 1000, 800) }), null);
  assert.equal(place(null, { reader: box(100, 80, 250, 200) }), null);
  assert.equal(place(null, { height: 700 }), null);
  assert.equal(place(null, { width: NaN }), null);
  assert.equal(place(null, { width: 0 }), null);
});
