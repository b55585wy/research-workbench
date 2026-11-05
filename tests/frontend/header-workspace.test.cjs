const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createDOM } = require("./workspace-dom.cjs");

const read = (name) => fs.readFileSync(path.join(__dirname, "../..", name), "utf8");
const settingsSource = read("web/src/header-settings.tsx");
// Execute the production imperative slot effect without a TSX compiler or React/browser dependency.
const slotBody = settingsSource.match(/function NativeControlsSlot[\s\S]+?useLayoutEffect\(\(\) => \{([\s\S]+?)\n  \}, \[controls\]\);/)[1];
const mountSlot = vm.compileFunction(slotBody, ["controls", "slotRef", "document"]);

test("settings mount/unmount moves the original appearance controls and leaves one workspace host in place", () => {
  const f = createDOM();
  const theme = f.document.createElement("select");
  const language = f.document.createElement("button");
  f.controls.append(theme, language);
  let changes = 0;
  theme.addEventListener("change", () => { changes += 1; });
  const original = [...f.header.children];
  for (let mount = 0; mount < 3; mount += 1) {
    const cleanup = mountSlot(f.controls, { current: f.slot }, f.document);
    assert.equal(f.controls.parentNode, f.slot);
    assert.equal(f.root.parentNode, f.header);
    assert.equal(f.settings.contains(f.root), false);
    assert.equal(f.document.body.querySelectorAll("#device-storage-ui").length, 1);
    assert.equal(f.controls.children[0], theme);
    assert.equal(f.controls.children[1], language);
    theme.emit("change");
    cleanup();
    assert.deepEqual(f.header.children, original);
    assert.equal(f.slot.children.length, 0);
  }
  assert.equal(changes, 3);
  assert.equal(mountSlot(f.controls, { current: null }, f.document), undefined);
});

test("recovery focuses the settings trigger before forwarding the existing guest action", () => {
  const f = createDOM();
  const gear = f.document.createElement("button");
  const nativeRecovery = f.document.createElement("button");
  let open = true;
  const timers = [];
  const closeBody = settingsSource.match(/function closePanel\(restoreFocus = true\) \{([\s\S]+?)\n  \}/)[1];
  const close = vm.compileFunction(closeBody, ["restoreFocus", "setOpen", "gearRef"]);
  const recoveryBody = settingsSource.match(/function openSpaceAction\(\) \{([\s\S]+?)\n  \}/)[1].replace("querySelector<HTMLButtonElement>", "querySelector");
  const recovery = vm.compileFunction(recoveryBody, ["closePanel", "recoveryTimerRef", "window", "identity"]);
  recovery(() => close(true, (value) => { open = value; }, { current: gear }), { current: null }, {
    clearTimeout() {}, setTimeout(callback) { timers.push(callback); return 1; }
  }, { querySelector: () => nativeRecovery });
  assert.equal(open, false);
  assert.equal(f.document.activeElement, gear);
  assert.equal(nativeRecovery.clicks, undefined);
  timers[0]();
  assert.equal(nativeRecovery.clicks, 1);
});

test("first entry compares implemented capabilities with the original explicit entry and recovery links", () => {
  const html = read("frontend/storage-choice.html");
  const cards = [...html.matchAll(/<section class="storage-option"[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1]);
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.deepEqual([...card.matchAll(/<dt>(.*?)<\/dt>/g)].map((match) => match[1]), ["保存", "阅读", "在线", "限制", "找回"]);
    assert.match(card, /PDF 阅读、批注与笔记/);
    assert.match(card, /<a class="storage-option-action" href=/);
  }
  assert.match(cards[0], /PDF、图片和笔记仅保存在此浏览器/);
  assert.match(cards[0], /准备就绪后可离线/);
  assert.match(cards[0], /选中文字翻译与明确提交的文字问答，需联网和模型连接/);
  assert.match(cards[0], /暂不支持整篇翻译、数据导入、分析及 PPT 工作流/);
  assert.match(cards[0], /导出备份；清理浏览器会丢失资料/);
  assert.match(cards[1], /每位访客空间独立/);
  assert.match(cards[1], /需联网/);
  assert.match(cards[1], /整篇翻译、研究助手、数据分析、图表与 PPT 工作流/);
  assert.match(cards[1], /不跨服务器同步，也不自动备份/);
  assert.match(cards[1], /保存恢复码，换浏览器返回此服务器空间时需要/);
  assert.match(html, /切换存储位置不会迁移、移动或删除已有资料/);
  assert.deepEqual([...html.matchAll(/<a[^>]+href="([^"]+)"/g)].map((match) => match[1]), ["/device/", "/?storage=server", "/recover.html"]);
  assert.match(html, /<script type="module" src="\/offline-prepare.js\?v=0.55.4"><\/script>/);
  assert.equal([...html.matchAll(/<script/g)].length, 2);
  assert.doesNotMatch(html, /\bonclick=|<form/);
});
