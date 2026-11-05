const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../frontend/reader-textbox.js"), "utf8");
const context = vm.createContext({
  document: {
    createElement() {
      return { getContext: () => ({ measureText: (text) => ({ width: Array.from(text).length * 8 }) }) };
    }
  }
});
vm.runInContext(`${source.replaceAll("export ", "")}\nglobalThis.textbox = { layoutTextbox, drawTextboxCanvas, TEXTBOX_COLORS };`, context);
const { layoutTextbox, drawTextboxCanvas, TEXTBOX_COLORS } = context.textbox;

function captureContext() {
  const calls = [];
  const state = { fillStyle: "#345678", font: "original", textBaseline: "top" };
  const drawing = {
    ...state,
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); Object.assign(this, state); },
    beginPath() { calls.push(["beginPath"]); },
    rect(...args) { calls.push(["rect", ...args]); },
    clip() { calls.push(["clip"]); },
    fillText(...args) { calls.push(["text", this.fillStyle, ...args]); },
    // These operations would erase or paint over underlying PDF pixels.
    fillRect() { assert.fail("textbox painted a background"); },
    clearRect() { assert.fail("textbox erased underlying PDF content"); },
    fill() { assert.fail("textbox filled its clipping path"); }
  };
  return { drawing, calls, state };
}

test("transparent capture paints only glyphs in every supported text color", () => {
  const layout = layoutTextbox("中文 Text\n第二行", 12, 160, 60);
  assert.equal(layout.overflow, false);
  for (const color of Object.values(TEXTBOX_COLORS)) {
    const { drawing, calls, state } = captureContext();
    drawTextboxCanvas(drawing, layout, 10, 20, 2, color);
    assert.deepEqual(calls, [
      ["save"], ["beginPath"], ["rect", 10, 20, 320, 120], ["clip"],
      ["text", color, "中文 Text", 18, 52],
      ["text", color, "第二行", 18, 85.6], ["restore"]
    ]);
    for (const [key, value] of Object.entries(state)) assert.equal(drawing[key], value);
  }
});

test("empty capture leaves existing pixels untouched and keeps clipping bounds", () => {
  const { drawing, calls } = captureContext();
  const layout = { lines: [], fontSize: 12, padding: 4, lineHeight: 16.8, width: 80, height: 40 };
  drawTextboxCanvas(drawing, layout, -5, 3, 0.5, TEXTBOX_COLORS.black);
  assert.deepEqual(calls, [["save"], ["beginPath"], ["rect", -5, 3, 40, 20], ["clip"], ["restore"]]);
});

test("wrapping, line normalization and overflow boundaries remain available", () => {
  const normalized = layoutTextbox("A\r\n中\rB\tC", 12, 160, 80);
  assert.deepEqual(Array.from(normalized.lines), ["A", "中", "B    C"]);
  assert.equal(normalized.overflow, false);
  assert.deepEqual(Array.from(layoutTextbox("中文文本", 12, 24, 100).lines), ["中文", "文本"]);
  assert.equal(layoutTextbox("A", 12, 16, 20).overflow, false);
  assert.equal(layoutTextbox("A", 12, 15, 20).overflow, true);
  assert.equal(layoutTextbox("A", 12, 16, 19).overflow, true);
  assert.equal(layoutTextbox("", 12, 16, 20).overflow, false);
});
