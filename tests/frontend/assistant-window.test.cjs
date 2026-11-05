const assert = require("node:assert/strict");
const vm = require("node:vm");
const test = require("node:test");
const { fixture, frontend } = require("./assistant-fixture.cjs");

function windowFixture() {
  const f = fixture();
  vm.runInContext(frontend("assistant-window.js").replaceAll("export ", ""), f.context);
  const elements = Object.fromEntries(["panel", "header", "fullPageToggle", "resizeHandle", "leftResizeHandle", "rightResizeHandle", "help"]
    .map((name) => [name, f.el(name === "panel" ? "section" : "button")]));
  const controls = f.context.createAssistantWindow(elements);
  return { ...f, ...elements, controls };
}

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
