const assert = require("node:assert/strict");
const vm = require("node:vm");
const test = require("node:test");
const { fixture, frontend } = require("./assistant-fixture.cjs");

// Requirement scenarios: Enter through the existing form once; empty/disabled/
// busy/held states; selection/caret/input sync for Ctrl and Shift; max length;
// Chinese composition lifecycle/isComposing/229 and post-commit Enter; normal
// editing/paste; current owner callback and retry object identity. No API calls.
function composerFixture(value = "draft") {
  const f = fixture();
  const message = f.el("textarea");
  Object.assign(message, { value, maxLength: 8000, selectionStart: value.length, selectionEnd: value.length });
  message.setRangeText = (text, start, end) => {
    message.value = message.value.slice(0, start) + text + message.value.slice(end);
    message.selectionStart = message.selectionEnd = start + text.length;
  };
  message.dispatchEvent = (event) => {
    assert.equal(event.type, "input");
    assert.equal(event.bubbles, true);
    message.dispatch(event.type, event);
  };
  const form = f.el("form");
  const sendButton = f.el("button");
  const panel = f.el("section");
  let owner = { paper: { id: "paper-a" }, entry: { draft: value } };
  const sends = [];
  const inputs = [];
  const elements = { message, form, send: sendButton, panel };
  form.requestSubmit = (button) => {
    assert.equal(button, sendButton);
    form.dispatch("submit");
  };
  Object.assign(f.context, { elements, Event: class { constructor(type, options) { Object.assign(this, { type }, options); } },
    current: () => owner,
    transformReaderActionRanges: (entry, previous, next) => inputs.push({ entry, previous, next }),
    render: () => { sendButton.disabled = !owner.entry.draft.trim(); },
    send: (id, entry) => { sends.push({ id, entry }); sendButton.disabled = true; } });
  vm.runInContext(frontend("assistant-composer-keys.js").replaceAll("export ", ""), f.context);
  const source = frontend("assistant.js");
  vm.runInContext(source.slice(source.indexOf('  elements.message.addEventListener("input"'), source.indexOf('  elements.cancel.addEventListener("click"')), f.context);
  const press = (init = {}) => message.dispatch("keydown", { key: "Enter", ...init });
  const release = () => message.dispatch("keyup", { key: "Enter" });
  return { ...f, message, form, sendButton, panel, sends, inputs, press, release, get owner() { return owner; }, set owner(next) { owner = next; } };
}

test("unmodified Enter uses the current form/send path once, including held Enter", () => {
  const f = composerFixture();
  assert.equal(f.press().defaultPrevented, true);
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].id, "paper-a");
  assert.equal(f.sends[0].entry, f.owner.entry);
  f.sendButton.disabled = false;
  f.press({ repeat: true });
  f.press();
  assert.equal(f.sends.length, 1);
  f.release();
  f.press();
  assert.equal(f.sends.length, 2);
  assert.equal(f.message.value, "draft");
});

test("empty, busy, disabled, readonly and hidden states retain draft without submitting", () => {
  for (const mode of ["empty", "busy", "disabled", "readonly", "hidden"]) {
    const f = composerFixture(mode === "empty" ? " \n " : "keep\nthis");
    if (["empty", "busy"].includes(mode)) f.sendButton.disabled = true;
    if (mode === "disabled") f.message.disabled = true;
    if (mode === "readonly") f.message.readOnly = true;
    if (mode === "hidden") f.panel.hidden = true;
    const before = f.message.value;
    f.press();
    f.press({ repeat: true });
    if (["disabled", "readonly", "hidden"].includes(mode)) f.press({ ctrlKey: true });
    assert.equal(f.sends.length, 0, mode);
    assert.equal(f.message.value, before);
    assert.equal(f.owner.entry.draft, before);
  }
});

for (const modifier of ["ctrlKey", "shiftKey"]) {
  test(`${modifier} Enter replaces selection or inserts at caret and emits input to sync the draft`, () => {
    for (const [start, end] of [[2, 2], [1, 4], [0, 5]]) {
      const f = composerFixture("ab中de");
      f.message.selectionStart = start;
      f.message.selectionEnd = end;
      const expected = "ab中de".slice(0, start) + "\n" + "ab中de".slice(end);
      f.press({ [modifier]: true });
      assert.equal(f.message.value, expected);
      assert.equal(f.message.selectionStart, start + 1);
      assert.equal(f.message.selectionEnd, start + 1);
      assert.equal(f.owner.entry.draft, expected);
      assert.equal(f.inputs.length, 1);
      assert.equal(f.sends.length, 0);
    }
  });
}

test("newline respects maxlength, allows replacement at the limit, and remains editable while send is busy", () => {
  const f = composerFixture("abcde");
  f.message.maxLength = 5;
  f.press({ ctrlKey: true });
  assert.equal(f.message.value, "abcde");
  assert.equal(f.inputs.length, 0);
  f.release();
  f.message.selectionStart = 2;
  f.message.selectionEnd = 4;
  f.sendButton.disabled = true;
  f.press({ ctrlKey: true });
  assert.equal(f.message.value, "ab\ne");
  assert.equal(f.owner.entry.draft, "ab\ne");
});

test("Chinese composition lifecycle, isComposing and keyCode 229 never submit candidate confirmation", async () => {
  const f = composerFixture("中文");
  f.message.dispatch("compositionstart");
  assert.equal(f.press().defaultPrevented, false);
  f.press({ ctrlKey: true });
  assert.equal(f.message.value, "中文");
  f.message.dispatch("compositionend");
  f.press(); // Safari-style compositionend before the confirming keydown.
  assert.equal(f.sends.length, 0);
  f.release();
  f.press({ isComposing: true });
  f.press({ keyCode: 229 });
  assert.equal(f.sends.length, 0);
  f.release();
  f.press();
  assert.equal(f.sends.length, 1);
  const mouseCommit = composerFixture("选词");
  mouseCommit.message.dispatch("compositionstart");
  mouseCommit.message.dispatch("compositionend");
  await new Promise((resolve) => setTimeout(resolve, 5));
  mouseCommit.press();
  assert.equal(mouseCommit.sends.length, 1);
});

test("paste, ordinary editing, modifier shortcuts and blur preserve normal textarea behavior", () => {
  const f = composerFixture();
  for (const event of [{ key: "a" }, { key: "Backspace" }, { key: "ArrowLeft" }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }]) {
    assert.equal(f.press(event).defaultPrevented, Boolean(event.defaultPrevented));
  }
  f.message.value = "pasted\n多行\ntext";
  f.message.dispatch("input");
  assert.equal(f.owner.entry.draft, f.message.value);
  assert.equal(f.sends.length, 0);
  f.press();
  f.message.dispatch("blur");
  f.sendButton.disabled = false;
  f.press();
  assert.equal(f.sends.length, 2);
});

test("owner callbacks and retry state stay on the existing send/input paths", () => {
  const f = composerFixture("retry draft");
  const retry = { request_id: "existing-id", pending: false, payload: { frozen: true } };
  f.owner = { paper: { id: "paper-b" }, entry: { draft: "retry draft", pendingSend: retry } };
  f.press();
  assert.equal(f.sends[0].id, "paper-b");
  assert.equal(f.sends[0].entry.pendingSend, retry);
  f.release();
  f.press({ ctrlKey: true });
  assert.equal(f.owner.entry.pendingSend, null); // Existing input invalidates an editable retry.
  assert.equal(f.inputs[0].entry, f.owner.entry);
  assert.equal(retry.request_id, "existing-id");
});

test("shortcut and minimize labels are bilingual and exposed without extra visible instructions", () => {
  const source = frontend("assistant.js");
  const labels = vm.runInNewContext(source.slice(source.indexOf("const messages ="), source.indexOf("export function createAssistant")) + "messages;");
  assert.equal(labels.zh.close, "收起助手");
  assert.equal(labels.en.close, "Minimize assistant");
  for (const language of ["zh", "en"]) {
    assert.match(labels[language].composerKeys, /Ctrl\+Enter/);
    assert.ok(labels[language].resizeTop && labels[language].resizeBottom && labels[language].assistantRunning);
  }
  assert.match(frontend("index.html"), /id="assistant-message"[^>]*aria-keyshortcuts="Enter Control\+Enter Shift\+Enter"/);
});
