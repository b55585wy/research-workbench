const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createDOM } = require("./workspace-dom.cjs");

const source = fs.readFileSync(path.join(__dirname, "../../frontend/device-ui.js"), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(device, language = "zh") {
  const dom = createDOM();
  const state = { language, paper: { id: "paper/1", title: "Paper" }, offline: { status: "ready" } };
  const calls = { requests: [], imported: [], starts: 0, stats: 0, clears: 0, urls: [], revoked: [] };
  const subscribers = [];
  const timers = [];
  const offlineSupport = {
    getState: () => state.offline,
    subscribe: (callback) => subscribers.push(callback),
    start: () => { calls.starts += 1; }
  };
  const serverPdfCache = {
    getStats: async () => { calls.stats += 1; if (state.cacheError) throw Error("unavailable"); return { entries: 2, bytes: 2048 }; },
    clear: async () => { calls.clears += 1; if (state.clearError) throw Error("unavailable"); }
  };
  const checkedFetch = async (url, options) => {
    calls.requests.push({ url, options });
    if (state.backupError) throw { code: state.backupError };
    return { json: async () => ({ id: "restored" }), blob: async () => new Blob(["backup"]) };
  };
  const context = vm.createContext({
    document: dom.document, window: { document: dom.document }, isDeviceMode: () => device,
    offlineSupport, serverPdfCache, Intl, Blob,
    FormData: class { append(...values) { this.values = values; } },
    URL: { createObjectURL: (blob) => { calls.urls.push(blob); return "blob:backup"; }, revokeObjectURL: (url) => calls.revoked.push(url) },
    setTimeout: (callback) => timers.push(callback)
  });
  vm.runInContext(source.replace(/^import .+;\r?\n/gm, "").replaceAll("export ", ""), context);
  const controller = context.createDeviceUI({
    getLanguage: () => state.language, getDocument: () => state.paper, checkedFetch,
    imported: async (result) => calls.imported.push(result)
  });
  controller.render();
  return {
    ...dom, controller, state, calls,
    menu: () => dom.root.querySelector("details"), summary: () => dom.root.querySelector("summary"),
    button: (label) => dom.root.querySelectorAll("button").find((button) => button.textContent === label),
    offline: (next) => { state.offline = next; subscribers.forEach((callback) => callback(next)); },
    flushTimers: () => timers.splice(0).forEach((callback) => callback())
  };
}

test("both modes expose one current workspace in the header, outside native settings controls", () => {
  for (const device of [true, false]) {
    const f = fixture(device);
    f.settings.hidden = true;
    assert.equal(f.root.parentNode, f.header);
    assert.equal(f.controls.contains(f.root), false);
    for (let ancestor = f.root; ancestor; ancestor = ancestor.parentNode) assert.equal(ancestor.hidden, false);
    assert.equal(f.document.body.querySelectorAll("#device-storage-ui").length, 1);
    assert.equal(f.root.querySelector(".device-storage-name").textContent, device ? "本机资料" : "服务器资料");
    assert.equal(f.summary().querySelectorAll("svg").length, 2);
    assert.equal(f.summary().querySelector("svg").getAttribute("aria-hidden"), "true");
    assert.match(f.summary().getAttribute("aria-label"), device ? /当前资料位置: 本机资料/ : /当前资料位置: 服务器资料/);
    assert.equal(f.root.querySelector(".device-storage-switch").href, device ? "/?storage=server" : "/device/");
    assert.equal(f.root.querySelector(".device-storage-help").href, "/storage");
    assert.equal(f.calls.requests.length + f.calls.starts + f.calls.stats + f.calls.clears, 0);
  }
});

test("language and offline changes preserve the disclosure and never perform data operations", () => {
  for (const device of [true, false]) {
    const f = fixture(device);
    f.menu().open = true;
    f.state.language = "en";
    f.controller.render();
    assert.equal(f.menu().open, true);
    assert.equal(f.root.querySelector(".device-storage-name").textContent, device ? "On this device" : "On server");
    const summary = f.summary();
    f.offline({ status: "preparing", completed: 2, total: 5 });
    assert.equal(f.summary(), summary);
    assert.match(summary.getAttribute("aria-label"), /2\/5/);
    assert.equal(f.root.querySelector("progress").value, 2);
    f.offline({ status: "failed" });
    assert.match(f.root.querySelector(".offline-status-text").textContent, /did not finish/);
    assert.equal(f.root.querySelector(".offline-status-text").getAttribute("role"), "alert");
    assert.equal(f.calls.requests.length + f.calls.starts + f.calls.clears, 0);
    f.button("Retry preparation").click();
    assert.equal(f.calls.starts, 1);
    f.offline({ status: "unsupported" });
    assert.match(f.root.querySelector(".offline-status-text").textContent, /not supported by this browser/);
    assert.equal(f.root.querySelector("progress"), null);
    f.offline({ status: "ready" });
    assert.match(summary.getAttribute("aria-label"), /ready/);
    if (device) assert.equal(summary.querySelector(".offline-status-icon").dataset.state, "ready");
  }
});

test("Escape restores summary focus and leaving the workspace closes it without switching", () => {
  const f = fixture(true);
  f.menu().open = true;
  const key = f.root.emit("keydown", { key: "Escape" });
  assert.equal(key.prevented, true);
  assert.equal(key.stopped, true);
  assert.equal(f.menu().open, false);
  assert.equal(f.document.activeElement, f.summary());
  f.menu().open = true;
  f.root.emit("focusout", { relatedTarget: f.button("导入备份") });
  assert.equal(f.menu().open, true);
  f.root.emit("focusout", { relatedTarget: f.controls });
  assert.equal(f.menu().open, false);
  assert.equal(f.calls.requests.length + f.calls.starts + f.calls.clears, 0);
});

test("backup selection and export remain explicit, with absent or unsupported documents disabled", async () => {
  const f = fixture(true);
  f.menu().open = true;
  f.button("导入备份").click();
  assert.equal(f.input.clicks, 1);
  assert.equal(f.calls.requests.length, 0);
  f.input.emit("change");
  await settle();
  assert.equal(f.calls.requests.length, 0);
  f.input.files = [{ name: "backup.zip" }];
  f.input.emit("change");
  assert.equal(f.button("导入备份").disabled, true);
  await settle();
  assert.equal(f.calls.requests[0].url, "/api/v1/device/backups");
  assert.equal(f.calls.requests[0].options.method, "POST");
  assert.equal(f.calls.imported[0].id, "restored");
  assert.equal(f.menu().open, true);
  f.button("导出备份").click();
  await settle();
  assert.equal(f.calls.requests[1].url, "/api/v1/documents/paper%2F1/export");
  assert.equal(f.calls.urls.length, 1);
  f.flushTimers();
  assert.deepEqual(f.calls.revoked, ["blob:backup"]);
  for (const paper of [null, { kind: "study", id: "study-1" }]) {
    f.state.paper = paper;
    f.controller.render();
    assert.equal(f.button("导出备份").disabled, true);
    f.button("导出备份").click();
  }
  assert.equal(f.calls.requests.length, 2);
});

test("invalid and full-storage backups report errors without reporting an import", async () => {
  for (const [code, message] of [["invalid_backup", /备份无效/], ["storage_quota", /空间不足/], ["backup_conflict", /未覆盖/]]) {
    const f = fixture(true);
    f.state.backupError = code;
    f.input.files = [{ name: "backup.zip" }];
    f.input.emit("change");
    await settle();
    const status = f.root.querySelector(".device-storage-status");
    assert.equal(status.getAttribute("role"), "alert");
    assert.match(status.textContent, message);
    assert.equal(f.calls.imported.length, 0);
    assert.equal(f.button("导入备份").disabled, false);
  }
});

test("server cache is read only on disclosure; clearing remains explicit and stats survive render", async () => {
  const f = fixture(false, "en");
  assert.equal(f.calls.stats, 0);
  f.menu().open = true;
  f.menu().emit("toggle");
  await settle();
  assert.equal(f.calls.stats, 1);
  assert.match(f.root.textContent, /2 KiB · 2 PDF/);
  assert.match(f.root.textContent, /server materials still require a network/);
  assert.equal(f.calls.clears, 0);
  f.controller.render();
  f.menu().emit("toggle");
  assert.equal(f.calls.stats, 1);
  f.button("Clear read cache").click();
  assert.equal(f.button("Clear read cache").disabled, true);
  await settle();
  assert.equal(f.calls.clears, 1);
  assert.match(f.root.textContent, /0 B · 0 PDF/);
  assert.equal(f.button("Clear read cache").disabled, true);
  assert.equal(f.calls.requests.length, 0);
});

test("unavailable cache and failed explicit clearing retain a usable workspace panel", async () => {
  const f = fixture(false);
  f.state.cacheError = true;
  f.menu().open = true;
  f.menu().emit("toggle");
  await settle();
  assert.match(f.root.textContent, /阅读缓存操作未完成/);
  assert.equal(f.calls.clears, 0);
  assert.equal(f.root.querySelector(".device-storage-switch").href, "/device/");
  const g = fixture(false);
  g.menu().open = true;
  g.menu().emit("toggle");
  await settle();
  g.state.clearError = true;
  g.button("清除阅读缓存").click();
  await settle();
  assert.equal(g.root.querySelector(".device-storage-status").getAttribute("role"), "alert");
  assert.match(g.root.textContent, /2 KiB · 2 PDF/);
  assert.equal(g.menu().open, true);
});
