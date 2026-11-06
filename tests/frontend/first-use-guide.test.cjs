const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
const loaded = import(pathToFileURL(path.join(root, 'frontend/first-use-guide.js')));

function memory(seed) {
  const items = new Map(seed);
  return { getItem: (key) => items.get(key), setItem: (key, value) => items.set(key, value), items };
}

test('first visit advances through exact available steps, respects Back boundary and persists completion', async () => {
  const { createGuideSession, GUIDE_STORAGE_KEY } = await loaded;
  const storage = memory(), states = [];
  const session = createGuideSession({ storage, getSteps: () => ['storage', 'library'], onChange: (state) => states.push(state) });
  assert.equal(session.start(), true);
  assert.deepEqual(session.state, { open: true, index: 0, steps: ['storage', 'library'] });
  session.previous(); assert.equal(session.state.index, 0);
  assert.equal(session.start(true), false);
  session.next(); assert.equal(session.state.index, 1);
  session.previous(); assert.equal(session.state.index, 0);
  session.next(); session.next();
  assert.equal(session.state.open, false);
  assert.equal(storage.getItem(GUIDE_STORAGE_KEY), 'completed');
  assert.equal(session.start(), false);
  assert.equal(states.filter((state) => state.open).length, 4);
});

test('skip survives a new controller and mode change; explicit replay starts at the beginning', async () => {
  const { createGuideSession, GUIDE_STORAGE_KEY } = await loaded;
  const storage = memory();
  const first = createGuideSession({ storage, getSteps: () => ['storage', 'assistant'] });
  first.start(); first.dismiss();
  assert.equal(storage.getItem(GUIDE_STORAGE_KEY), 'skipped');
  const next = createGuideSession({ storage, getSteps: () => ['storage'] });
  assert.equal(next.start(), false);
  assert.equal(next.start(true), true);
  assert.equal(next.state.index, 0);
  next.next(); assert.equal(storage.getItem(GUIDE_STORAGE_KEY), 'completed');
});

test('unavailable targets and temporary stop do not mark completion; malformed markers do not hide the guide', async () => {
  const { createGuideSession, GUIDE_STORAGE_KEY } = await loaded;
  const storage = memory([[GUIDE_STORAGE_KEY, 'bad']]); let steps = [];
  const session = createGuideSession({ storage, getSteps: () => steps });
  assert.equal(session.start(), false); assert.equal(storage.getItem(GUIDE_STORAGE_KEY), 'bad');
  steps = ['storage']; assert.equal(session.start(), true);
  session.stop(); assert.equal(storage.getItem(GUIDE_STORAGE_KEY), 'bad');
  assert.equal(session.start(), true);
  const snapshot = session.state; snapshot.steps.push('wrong');
  assert.deepEqual(session.state.steps, ['storage']);
});

test('storage read/write denial still allows the tour and keeps dismissal in this page', async () => {
  const { createGuideSession } = await loaded;
  const storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const session = createGuideSession({ storage, getSteps: () => ['storage'] });
  assert.equal(session.start(), true); assert.doesNotThrow(() => session.dismiss());
  assert.equal(session.start(), false); assert.equal(session.start(true), true);
  session.next(); assert.equal(session.state.open, false);
});

test('destroy is idempotent, prevents later start and leaves persisted preference unchanged', async () => {
  const { createGuideSession, GUIDE_STORAGE_KEY } = await loaded;
  const storage = memory(); let calls = 0;
  const session = createGuideSession({ storage, getSteps: () => ['storage'], onChange: () => calls++ });
  session.start(); session.destroy(); session.destroy(); session.next(); session.previous(); session.dismiss();
  assert.equal(calls, 2); assert.equal(session.start(true), false);
  assert.equal(storage.getItem(GUIDE_STORAGE_KEY), undefined);
});

test('device/server and Chinese/English steps describe only available capabilities', async () => {
  const { guideSteps } = await loaded;
  const server = guideSteps(false, 'en'), device = guideSteps(true, 'zh');
  assert.deepEqual(server.map((step) => step.id), ['storage', 'library', 'reading', 'notes', 'assistant', 'tools']);
  assert.deepEqual(device.map((step) => step.id), ['storage', 'library', 'reading', 'notes', 'assistant']);
  assert.match(device.find((step) => step.id === 'reading').title, /标注/);
  assert.ok(server.every((step) => step.selectors.length && step.title && step.body));
});

test('phone, desktop, rotated and visual-viewport offsets keep panel and spotlight anchored inside the screen', async () => {
  const { guidePosition } = await loaded;
  for (const view of [
    { left: 0, top: 0, width: 390, height: 844 }, { left: 0, top: 0, width: 1440, height: 900 },
    { left: 0, top: 0, width: 844, height: 390 }, { left: 24, top: 42, width: 320, height: 280 }
  ]) {
    for (const [x, y] of [[0, 0], [view.width - 48, 0], [0, view.height - 48], [view.width - 48, view.height - 48]]) {
      const rect = { left: view.left + x, top: view.top + y, width: 44, height: 44 };
      const layout = guidePosition(rect, view, 216);
      assert.ok(layout, JSON.stringify({ rect, view }));
      assert.ok(layout.x >= view.left && layout.y >= view.top);
      assert.ok(layout.x + layout.width <= view.left + view.width);
      assert.ok(layout.y + layout.maxHeight <= view.top + view.height);
      assert.equal(layout.target.left, rect.left - 3);
      assert.equal(layout.target.top, rect.top - 3);
      assert.match(layout.arrow, /^M[\d., -]+ L[\d., -]+$/);
      const overlapX = layout.x < rect.left + rect.width && layout.x + layout.width > rect.left;
      const overlapY = layout.y < rect.top + rect.height && layout.y + layout.maxHeight > rect.top;
      assert.equal(overlapX && overlapY, false);
    }
  }
});

test('offscreen, empty, nonfinite and unusably small targets/viewports never produce a floating pointer', async () => {
  const { guidePosition } = await loaded;
  const view = { left: 0, top: 0, width: 390, height: 844 };
  for (const rect of [{ left: 400, top: 10, width: 44, height: 44 }, { left: 0, top: 900, width: 44, height: 44 },
    { left: NaN, top: 0, width: 44, height: 44 }, { left: 0, top: 0, width: 0, height: 44 }]) assert.equal(guidePosition(rect, view), null);
  assert.equal(guidePosition({ left: 10, top: 10, width: 20, height: 20 }, { ...view, width: 80 }), null);
});

function component() {
  const filename = path.join(root, 'web/src/features/first-use-guide/index.tsx');
  const source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' })
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(Boolean) });
  return Function('h', 'useLayoutEffect', 'useRef', `${source}; return FirstUseGuide;`)(h, () => {}, () => ({ current: null }));
}
function nodes(tree) { return typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []; }

test('React guide exposes one nonmodal dialog, text, progress, actual arrow, keyboard buttons and explicit actions in both languages', async () => {
  const { guidePosition } = await loaded;
  const FirstUseGuide = component();
  const layout = guidePosition({ left: 10, top: 10, width: 44, height: 44 }, { left: 0, top: 0, width: 390, height: 844 });
  for (const language of ['zh', 'en']) {
    const actions = [];
    const tree = FirstUseGuide({ model: { language, title: '<plain title>', body: 'Short instruction', index: 0, total: 5, stepId: 'storage', layout }, onAction: (value) => actions.push(value) });
    const all = nodes(tree), dialog = all.find((node) => node.props.role === 'dialog');
    assert.equal(dialog.props['aria-modal'], false); assert.equal(dialog.props.tabIndex, -1);
    assert.equal(all.filter((node) => node.tag === 'input' || node.tag === 'textarea').length, 0);
    assert.ok(all.some((node) => node.tag === 'path' && node.props.markerEnd));
    assert.ok(all.some((node) => node.children.includes('<plain title>')));
    const buttons = all.filter((node) => node.tag === 'button');
    assert.equal(buttons.length, 4); assert.ok(buttons.every((node) => node.props.type === 'button'));
    assert.equal(buttons[2].props.disabled, true);
    buttons[0].props.onClick(); buttons[3].props.onClick(); assert.deepEqual(actions, ['skip', 'next']);
    const last = nodes(FirstUseGuide({ model: { language, title: 'Done', body: '', index: 4, total: 5, stepId: 'assistant', layout }, onAction: () => {} }));
    assert.ok(last.some((node) => node.tag === 'button' && node.children.includes(language === 'zh' ? '开始使用' : 'Get started')));
  }
});
