const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const context = vm.createContext({ Map });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/reader-fullscreen.js'), 'utf8').replaceAll('export ', ''), context);
const tick = () => new Promise((resolve) => setImmediate(resolve));

class Element extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.disabled = false;
    this.isConnected = true;
    this.inert = false;
    this.focusCount = 0;
    const classes = new Set();
    this.classList = { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) };
  }
  append(child) { this.children.push(child); child.parentElement = this; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  focus() { this.focusCount += 1; }
}

function fixture(native = 'absent', adapter = {}) {
  const browser = new EventTarget(), document = new EventTarget(), root = new Element(), body = new Element();
  const panel = new Element(), button = new Element(), outside = new Element(), alreadyInert = new Element();
  alreadyInert.inert = true;
  root.append(body); body.append(outside); body.append(panel); body.append(alreadyInert); panel.append(button);
  document.documentElement = root; document.defaultView = browser; document.activeElement = button; document.fullscreenElement = null;
  panel.ownerDocument = document;
  let enters = 0, exits = 0, resolveEntry;
  const notifications = [];
  const nativeEnter = () => { document.fullscreenElement = panel; document.dispatchEvent(new Event('fullscreenchange')); };
  if (native !== 'absent') panel.requestFullscreen = async () => {
    enters += 1;
    if (native === 'reject') throw new Error('unsupported');
    if (native === 'pending') await new Promise((resolve) => { resolveEntry = resolve; });
    nativeEnter();
  };
  document.exitFullscreen = async () => {
    exits += 1;
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  let language = 'zh';
  const controller = context.createReaderFullscreen({ panel, button,
    capture: adapter.capture || (() => ({ anchor: 'current-position' })),
    onChange: (value) => { notifications.push(value); adapter.onChange?.(value); },
    getLabel: (active) => language === 'zh' ? active ? '退出全屏' : '阅读全屏' : active ? 'Exit fullscreen' : 'Reading fullscreen',
  });
  return { controller, browser, document, root, panel, button, outside, alreadyInert, notifications,
    get enters() { return enters; }, get exits() { return exits; }, resolveEntry: () => resolveEntry(),
    language(value) { language = value; controller.update(); },
  };
}

test('unsupported native fullscreen uses an immediate immersive view and restores inert/focus on exit', async () => {
  const f = fixture();
  await f.controller.toggle(f.button);
  assert(f.controller.isActive());
  assert.equal(f.panel.dataset.fullscreenMode, 'immersive');
  assert(f.root.classList.contains('reader-fullscreen-active'));
  assert.equal(f.button.getAttribute('aria-pressed'), 'true');
  assert.equal(f.button.focusCount, 0);
  assert(f.outside.inert && f.alreadyInert.inert);
  await f.controller.toggle(f.button);
  assert(!f.controller.isActive());
  assert(!f.outside.inert && f.alreadyInert.inert);
  assert.equal(f.button.focusCount, 1);
  assert.equal(f.button.getAttribute('aria-pressed'), 'false');
});

test('native entry, button exit and system exit synchronize the same state', async () => {
  const f = fixture('native');
  await f.controller.toggle();
  assert.equal(f.panel.dataset.fullscreenMode, 'native');
  assert.equal(f.enters, 1);
  await f.controller.exit();
  assert.equal(f.exits, 1);
  assert(!f.controller.isActive());
  await f.controller.toggle();
  f.document.fullscreenElement = null;
  f.document.dispatchEvent(new Event('fullscreenchange'));
  assert(!f.controller.isActive());
  assert(!f.root.classList.contains('reader-fullscreen-active'));
});

test('native rejection stays immersive and Escape exits without touching another fullscreen', async () => {
  const f = fixture('reject');
  await f.controller.toggle();
  assert.equal(f.panel.dataset.fullscreenMode, 'immersive');
  const event = new Event('keydown', { cancelable: true });
  event.key = 'Escape'; f.browser.dispatchEvent(event);
  await tick();
  assert(event.defaultPrevented);
  assert(!f.controller.isActive());
  assert.equal(f.exits, 0);
  f.document.fullscreenElement = new Element();
  assert.equal(await f.controller.toggle(), false);
  assert.equal(f.exits, 0);
});

test('disabled entry and lost document availability cannot leave the immersive layout active', async () => {
  const f = fixture();
  f.button.disabled = true;
  assert.equal(await f.controller.toggle(), false);
  f.button.disabled = false;
  await f.controller.toggle();
  f.button.disabled = true;
  f.controller.update();
  await tick();
  assert(!f.controller.isActive());
  assert(!f.outside.inert);
  assert.equal(f.button.focusCount, 0);
});

test('a late native completion after exit cannot reactivate a stale reader', async () => {
  const f = fixture('pending');
  const entered = f.controller.toggle();
  assert(f.controller.isActive());
  await f.controller.exit({ restoreFocus: false });
  f.resolveEntry();
  await entered; await tick();
  assert.equal(f.document.fullscreenElement, null);
  assert(!f.controller.isActive());
  assert(!f.outside.inert);
  assert.equal(f.button.focusCount, 0);
});

test('exit failure keeps a usable exit control and a later retry succeeds', async () => {
  const f = fixture('native');
  await f.controller.toggle();
  const exit = f.document.exitFullscreen;
  f.document.exitFullscreen = async () => { throw new Error('denied'); };
  assert.equal(await f.controller.exit(), false);
  assert(f.controller.isActive());
  assert.equal(f.button.getAttribute('aria-label'), '退出全屏');
  f.document.exitFullscreen = exit;
  await f.controller.exit();
  assert(!f.controller.isActive());
});

test('language, prevented Escape and page lifecycle preserve accessible state', async () => {
  const f = fixture();
  await f.controller.toggle();
  f.language('en');
  assert.equal(f.button.getAttribute('aria-label'), 'Exit fullscreen');
  const event = new Event('keydown', { cancelable: true }); event.key = 'Escape'; event.preventDefault();
  f.browser.dispatchEvent(event);
  assert(f.controller.isActive());
  f.browser.dispatchEvent(new Event('pagehide'));
  await tick();
  assert(!f.controller.isActive());
  assert.equal(f.button.focusCount, 0);
  await f.controller.toggle();
  assert(f.controller.isActive());
});

test('destroy cleans state and handlers, including a pending native entry', async () => {
  const f = fixture('pending');
  const pending = f.controller.toggle();
  f.controller.destroy(); f.controller.destroy();
  f.resolveEntry(); await pending; await tick();
  assert(!f.controller.isActive());
  assert.equal(f.document.fullscreenElement, null);
  assert(!f.outside.inert);
  f.button.dispatchEvent(new Event('click'));
  assert.equal(await f.controller.toggle(), false);
});

test('flow paragraph anchoring preserves the visible offset through a layout change', () => {
  let blockTop = 80, rootTop = 100;
  const before = { isConnected: true, getBoundingClientRect: () => ({ top: -20, bottom: 0 }) };
  const visible = { isConnected: true, getBoundingClientRect: () => ({ top: blockTop, bottom: blockTop + 50 }) };
  const scroller = { isConnected: true, scrollTop: 400, contains: (block) => block === visible,
    getBoundingClientRect: () => ({ top: rootTop }), querySelectorAll: () => [before, visible] };
  const position = context.captureFlowPosition(scroller);
  assert.equal(position.block, visible);
  blockTop = 120; rootTop = 0;
  context.restoreFlowPosition(position);
  assert.equal(scroller.scrollTop, 540);
  visible.isConnected = false;
  scroller.scrollTop = 0;
  context.restoreFlowPosition(position);
  assert.equal(scroller.scrollTop, 400);
  scroller.isConnected = false;
  context.restoreFlowPosition(position);
  assert.equal(context.captureFlowPosition(null), null);
});

test('native promotion before the first frame preserves the original flow anchor', async () => {
  const owner = {}, frames = [];
  let blockTop = 80, rootTop = 100;
  const block = { isConnected: true, getBoundingClientRect: () => ({ top: blockTop, bottom: blockTop + 100 }) };
  const scroller = { isConnected: true, scrollTop: 400, contains: () => true,
    getBoundingClientRect: () => ({ top: rootTop }), querySelectorAll: () => [block] };
  const restorer = context.createFlowPositionRestorer({ isCurrent: () => true, requestFrame: (callback) => frames.push(callback), cancelFrame() {} });
  const f = fixture('native', {
    capture: () => ({ document: owner, position: context.captureFlowPosition(scroller) }),
    onChange: ({ snapshot }) => {
      blockTop = 120; rootTop = 0;
      restorer.schedule(snapshot);
    }
  });
  await f.controller.toggle();
  assert.equal(f.panel.dataset.fullscreenMode, 'native');
  assert.equal(f.notifications.length, 2);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(scroller.scrollTop, 540);
});

test('queued position restore is cancelled or rejected when its owner is obsolete', () => {
  const frames = [], cancelled = [];
  const scroller = { isConnected: true, scrollTop: 123 };
  const restorer = context.createFlowPositionRestorer({ isCurrent: () => false,
    requestFrame: (callback) => frames.push(callback), cancelFrame: (frame) => cancelled.push(frame) });
  restorer.schedule({ document: {}, position: { scroller, scrollTop: 10 } });
  frames[0]();
  assert.equal(scroller.scrollTop, 123);
  restorer.schedule({ document: {}, position: { scroller, scrollTop: 10 } });
  restorer.cancel();
  assert.equal(cancelled.length, 1);
});
