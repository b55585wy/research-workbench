const assert = require("node:assert/strict");
const vm = require("node:vm");
const test = require("node:test");
const { fixture, frontend } = require("./assistant-fixture.cjs");

function windowFixture({ width = 1280, height = 900, visual, mobile = false } = {}) {
  const f = fixture();
  f.window.innerWidth = width;
  f.document.documentElement.clientHeight = height;
  f.document.body = { classList: { contains: () => mobile } };
  f.window.matchMedia = () => ({ matches: f.window.innerWidth <= 820 });
  if (visual) {
    f.window.visualViewport = { offsetLeft: 0, offsetTop: 0, width, height, listeners: {}, ...visual,
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); } };
  }
  vm.runInContext(frontend("assistant-window.js").replaceAll("export ", ""), f.context);
  const elements = Object.fromEntries(["panel", "header", "fullPageToggle", "resizeHandle", "leftResizeHandle", "rightResizeHandle", "topResizeHandle", "bottomResizeHandle", "help"]
    .map((name) => [name, f.el(name === "panel" ? "section" : name === "header" ? "div" : "button")]));
  for (const target of Object.values(elements)) {
    target.setPointerCapture = (id) => { target.capture = id; };
    target.hasPointerCapture = (id) => target.capture === id;
    target.releasePointerCapture = () => { target.capture = null; };
  }
  const controls = f.context.createAssistantWindow(elements);
  return { ...f, ...elements, controls };
}

const rect = (f) => Object.fromEntries(["left", "top", "width", "height"].map((key) => [key, parseFloat(f.panel.style[key])]));
const drag = (target, dx, dy, end = "pointerup") => {
  target.dispatch("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
  target.dispatch("pointermove", { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  target.dispatch(end, { pointerId: 1 });
};

// Requirements before tests: compact defaults with real two-axis travel at all
// assigned sizes; anchored top/bottom min/max and Shift steps; left/right/corner;
// capture/cancel/Escape and hidden/fullpage guards; keyboard/viewport/orientation
// clamps; mobile pane navigation; minimize/restore without task/draft mutation.
for (const [width, height] of [[1440, 900], [1024, 600], [844, 390]]) {
  test(`default ${width}x${height} float has vertical travel and stays inside the viewport`, () => {
    const f = windowFixture({ width, height });
    f.controls.show();
    const start = rect(f);
    assert.equal(start.width, 420);
    assert.ok(start.height <= 560 && start.height >= 300);
    assert.ok(start.height < height - 16);
    drag(f.header, -40, -32);
    assert.equal(rect(f).left, start.left - 40);
    assert.equal(rect(f).top, start.top - 32);
    drag(f.header, 16, 16);
    assert.equal(rect(f).top, start.top - 16);
    f.header.dispatch("keydown", { key: "ArrowUp", shiftKey: true });
    assert.equal(rect(f).top, start.top - 48);
    f.header.dispatch("keydown", { key: "ArrowDown" });
    assert.equal(rect(f).top, start.top - 40);
    drag(f.header, -10000, -10000);
    assert.equal(rect(f).left, 8);
    assert.equal(rect(f).top, 8);
    drag(f.header, 10000, 10000);
    assert.equal(rect(f).top + rect(f).height, height - 8);
    assert.equal(rect(f).left + rect(f).width, width - 8);
  });
}

test("top and bottom handles resize actual height, anchor opposite edges and honor bounds", () => {
  for (const side of ["top", "bottom"]) {
    const f = windowFixture();
    f.controls.show();
    drag(f.header, -40, -100);
    const handle = f[`${side}ResizeHandle`];
    const start = rect(f);
    const anchor = () => side === "top" ? rect(f).top + rect(f).height : rect(f).top;
    const fixed = anchor();
    drag(handle, 0, side === "top" ? 40 : -40);
    assert.equal(rect(f).height, start.height - 40);
    assert.equal(anchor(), fixed);
    handle.dispatch("keydown", { key: side === "top" ? "ArrowUp" : "ArrowDown", shiftKey: true });
    assert.equal(rect(f).height, start.height - 8);
    assert.equal(anchor(), fixed);
    handle.dispatch("keydown", { key: side === "top" ? "ArrowDown" : "ArrowUp" });
    assert.equal(rect(f).height, start.height - 16);
    drag(handle, 0, side === "top" ? 10000 : -10000);
    assert.equal(rect(f).height, 300);
    assert.equal(anchor(), fixed);
    drag(handle, 0, side === "top" ? -10000 : 10000);
    assert.equal(anchor(), fixed);
    assert.equal(side === "top" ? rect(f).top : rect(f).top + rect(f).height, side === "top" ? 8 : 892);
    assert.equal(handle.dispatch("keydown", { key: "ArrowLeft" }).defaultPrevented, false);
    assert.equal(rect(f).width, start.width);
  }
});

test("left/right width anchors and corner width/height behavior remain available", () => {
  const f = windowFixture();
  f.controls.show();
  drag(f.header, -100, -100);
  let start = rect(f);
  drag(f.leftResizeHandle, -32, 70);
  assert.equal(rect(f).width, start.width + 32);
  assert.equal(rect(f).left + rect(f).width, start.left + start.width);
  assert.equal(rect(f).height, start.height);
  start = rect(f);
  f.leftResizeHandle.dispatch("keydown", { key: "ArrowRight", shiftKey: true });
  assert.equal(rect(f).width, start.width - 32);
  start = rect(f);
  drag(f.rightResizeHandle, 24, 70);
  assert.equal(rect(f).left, start.left);
  assert.equal(rect(f).width, start.width + 24);
  f.rightResizeHandle.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(rect(f).width, start.width + 16);
  start = rect(f);
  drag(f.resizeHandle, 8, 16);
  assert.equal(rect(f).width, start.width + 8);
  assert.equal(rect(f).height, start.height + 16);
});

test("pointer identity, controls, capture, cancel, hidden and interaction keyboard guards", () => {
  const f = windowFixture();
  f.controls.show();
  const start = rect(f);
  const button = f.el("button");
  assert.equal(f.header.dispatch("pointerdown", { target: button, pointerId: 1 }).defaultPrevented, false);
  for (const invalid of [{ button: 2 }, { isPrimary: false }]) {
    f.header.dispatch("pointerdown", { pointerId: 1, ...invalid });
    assert.equal(f.panel.dataset.windowInteraction, undefined);
  }
  f.header.dispatch("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
  assert.equal(f.header.capture, 1);
  f.header.dispatch("pointermove", { pointerId: 2, clientX: 20, clientY: 20 });
  assert.deepEqual(rect(f), start);
  f.header.dispatch("keydown", { key: "ArrowUp" });
  assert.deepEqual(rect(f), start);
  assert.equal(f.controls.cancelInteraction(), true); // Escape uses this API first.
  assert.equal(f.header.capture, null);
  assert.equal(f.controls.cancelInteraction(), false);
  for (const ending of ["pointercancel", "lostpointercapture"]) {
    drag(f.header, -8, -8, ending);
    assert.equal(f.panel.dataset.windowInteraction, undefined);
  }
  f.header.dispatch("pointerdown", { pointerId: 1 });
  f.panel.hidden = true;
  f.header.dispatch("pointermove", { pointerId: 1, clientX: 0, clientY: 0 });
  assert.equal(f.header.capture, null);
  const hidden = rect(f);
  f.header.dispatch("keydown", { key: "ArrowUp" });
  f.topResizeHandle.dispatch("keydown", { key: "ArrowDown" });
  f.resizeHandle.dispatch("pointerdown", { pointerId: 1 });
  f.fullPageToggle.dispatch("click");
  assert.deepEqual(rect(f), hidden);
  assert.equal(f.controls.isFullPage(), false);
});

test("visual keyboard offsets, resize, orientation and very short viewports clamp the full rect", () => {
  const f = windowFixture({ width: 1024, height: 600, visual: {} });
  f.controls.show();
  const view = f.window.visualViewport;
  f.header.dispatch("pointerdown", { pointerId: 1 });
  Object.assign(view, { offsetLeft: 20, offsetTop: 40, width: 844, height: 240 });
  view.listeners.resize.forEach((listener) => listener());
  assert.equal(f.header.capture, null);
  assert.equal(rect(f).height, 224);
  assert.ok(rect(f).top >= 48 && rect(f).top + rect(f).height <= 272);
  assert.ok(rect(f).left >= 28 && rect(f).left + rect(f).width <= 856);
  Object.assign(view, { offsetTop: 85, offsetLeft: 30 });
  view.listeners.scroll.forEach((listener) => listener());
  assert.equal(rect(f).top, 93);
  Object.assign(view, { offsetTop: 0, offsetLeft: 0, width: 390, height: 844 });
  view.listeners.resize.forEach((listener) => listener());
  assert.equal(f.panel.dataset.compact, "true");
  assert.deepEqual(rect(f), { left: 0, top: 0, width: 390, height: 844 });
  Object.assign(view, { width: 844, height: 390 });
  view.listeners.resize.forEach((listener) => listener());
  assert.equal(f.panel.dataset.compact, "false");
  assert.ok(rect(f).height <= 374);
  for (const handle of [f.topResizeHandle, f.bottomResizeHandle]) assert.equal(handle.disabled, false);
});

test("mobile full-page pane and explicit fullpage disable all manipulation and restore saved float", () => {
  const f = windowFixture({ width: 844, height: 390, mobile: true });
  f.controls.applyLanguage({ panel: "Research assistant", window: "Move assistant window", fixedHelp: "Full-page panel" });
  f.controls.show();
  const start = rect(f);
  f.fullPageToggle.dispatch("click");
  assert.equal(f.header.getAttribute("aria-label"), "Research assistant");
  assert.equal(f.header.getAttribute("aria-keyshortcuts"), null);
  for (const handle of [f.resizeHandle, f.leftResizeHandle, f.rightResizeHandle, f.topResizeHandle, f.bottomResizeHandle]) {
    assert.equal(handle.hidden, true);
    assert.equal(handle.disabled, true);
    handle.dispatch("keydown", { key: "ArrowUp" });
  }
  drag(f.header, -20, -20);
  assert.deepEqual(rect(f), { left: 0, top: 0, width: 844, height: 390 });
  f.controls.exitFullPage();
  assert.equal(f.header.getAttribute("aria-label"), "Move assistant window");
  assert.match(f.header.getAttribute("aria-keyshortcuts"), /ArrowUp/);
  assert.deepEqual(rect(f), start);
  f.window.innerWidth = 700;
  f.window.listeners.resize.forEach((listener) => listener());
  assert.equal(f.panel.dataset.compact, "true");
  assert.equal(f.topResizeHandle.hidden, true);
  const full = rect(f);
  drag(f.header, 20, 20);
  assert.deepEqual(rect(f), full);
  f.window.innerWidth = 844;
  f.window.listeners.resize.forEach((listener) => listener());
  assert.deepEqual(rect(f), start);
});

test("480px compact boundary is a real full-page panel; 481px remains a bounded float", () => {
  for (const width of [480, 481]) {
    const f = windowFixture({ width, height: 600 });
    f.controls.show();
    assert.equal(f.panel.dataset.compact, String(width === 480));
    assert.equal(rect(f).width, width === 480 ? 480 : 420);
    assert.equal(f.bottomResizeHandle.hidden, width === 480);
    assert.ok(Math.abs(rect(f).height - (width === 480 ? 600 : 408)) < 0.001);
  }
});

test("minimizing preserves live task, messages, draft and geometry; launcher restores without focus", () => {
  const f = windowFixture();
  f.controls.show();
  drag(f.header, -40, -40);
  const start = rect(f);
  const entry = { draft: "未发送\nDraft", turns: [{ id: "turn", state: "running" }], pendingSend: { request_id: "same" } };
  const before = JSON.stringify(entry);
  const elements = { panel: f.panel, toggle: f.el("button"), close: f.el("button"), clearDialog: { open: false } };
  elements.toggle.focus = () => { throw new Error("Unexpected autofocus"); };
  const listeners = {};
  f.document.addEventListener = (type, listener) => { listeners[type] = listener; };
  Object.assign(f.context, { elements, windowControls: f.controls, referencePicker: { close() {}, isOpen: () => false },
    sourcePreparation: { reset() {}, update() {} }, sourcePreparationModel: () => ({}), entry });
  const source = frontend("assistant.js");
  vm.runInContext(source.slice(source.indexOf("  function minimizeAssistant()"), source.indexOf('  elements.clear.addEventListener("click"')), f.context);
  elements.close.dispatch("click");
  assert.equal(f.panel.hidden, true);
  assert.equal(elements.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(JSON.stringify(entry), before);
  elements.toggle.dispatch("click");
  assert.equal(f.panel.hidden, false);
  assert.deepEqual(rect(f), start);
  assert.equal(JSON.stringify(entry), before);
  f.header.dispatch("pointerdown", { pointerId: 1 });
  listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(f.panel.hidden, false);
  assert.equal(f.header.capture, null);
  f.fullPageToggle.dispatch("click");
  listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(f.panel.hidden, false);
  assert.equal(f.controls.isFullPage(), false);
  listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(f.panel.hidden, true);
  assert.equal(JSON.stringify(entry), before);
  assert.ok(!source.includes("focusAssistant") && !source.includes("elements.message.focus"));
});

// Requirement scenarios: initial icon; localized labels without text overwrite;
// expand/restore/Esc exit API; saved geometry; keyboard and narrow-screen resize.
test("fullscreen remains an outlined decorative icon through localization, toggles and Escape's restore API", () => {
  const f = windowFixture();
  const languages = [{ fullPage: "Fullscreen", exitFullPage: "Restore" }, { fullPage: "全屏", exitFullPage: "退出全屏" }];
  const check = (fullPage, label) => {
    const svg = f.fullPageToggle.querySelector("svg");
    assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.equal(svg.getAttribute("focusable"), "false");
    assert.equal(f.fullPageToggle.querySelectorAll("svg").length, 1);
    assert.equal(f.fullPageToggle.textContent, "");
    assert.equal(f.fullPageToggle.getAttribute("aria-label"), label);
    assert.equal(f.fullPageToggle.title, label);
    assert.equal(f.fullPageToggle.getAttribute("aria-pressed"), String(fullPage));
    assert.equal(f.fullPageToggle.dataset.icon, fullPage ? "restore" : "expand");
    return svg.querySelector("path").getAttribute("d");
  };
  for (const labels of languages) {
    f.controls.applyLanguage(labels);
    f.controls.show();
    const expand = check(false, labels.fullPage);
    const rect = { ...f.panel.style };
    f.fullPageToggle.dispatch("click");
    assert.equal(f.controls.isFullPage(), true);
    assert.notEqual(check(true, labels.exitFullPage), expand);
    f.controls.applyLanguage(labels);
    check(true, labels.exitFullPage);
    assert.equal(f.resizeHandle.disabled, true);
    assert.equal(f.controls.exitFullPage(), true);
    assert.equal(f.controls.exitFullPage(), false);
    check(false, labels.fullPage);
    assert.deepEqual(f.panel.style, rect);
    assert.equal(f.resizeHandle.disabled, false);
    f.fullPageToggle.dispatch("click");
    f.fullPageToggle.dispatch("click");
    check(false, labels.fullPage);
  }
});

test("move, resize, viewport changes and compact state keep window controls functional", () => {
  const f = windowFixture();
  f.controls.applyLanguage({ fullPage: "Fullscreen", exitFullPage: "Restore" });
  f.controls.show();
  const width = parseFloat(f.panel.style.width);
  assert.equal(f.resizeHandle.dispatch("keydown", { key: "ArrowRight" }).defaultPrevented, true);
  assert.equal(parseFloat(f.panel.style.width), width + 8);
  const left = parseFloat(f.panel.style.left);
  f.header.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(parseFloat(f.panel.style.left), left - 8);
  f.window.innerWidth = 390;
  for (const listener of f.window.listeners.resize) listener();
  assert.equal(f.panel.dataset.compact, "true");
  assert.equal(f.panel.style.width, "390px");
  assert.equal(f.resizeHandle.hidden, true);
  assert.equal(f.leftResizeHandle.disabled, true);
  assert.ok(f.fullPageToggle.querySelector("svg"));
  f.fullPageToggle.dispatch("click");
  assert.equal(f.controls.isFullPage(), true);
  assert.equal(f.controls.exitFullPage(), true);
  f.window.innerWidth = 1280;
  for (const listener of f.window.listeners.resize) listener();
  assert.equal(f.panel.dataset.compact, "false");
  assert.equal(f.resizeHandle.hidden, false);
  assert.equal(parseFloat(f.panel.style.width), width + 8);
});
