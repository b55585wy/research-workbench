const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePromise = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../../frontend/assistant-pdf-navigation.js')).toString('base64'));
const sha = 'a'.repeat(64);
const source = { kind: 'pdf_page', document_id: 'paper-a', page: 2, source_sha256: sha, rect: [.1, .2, .3, .4] };
const document = { id: 'paper-a', kind: 'paper', page_count: 3, sha256: sha };

async function fixture(overrides = {}) {
  const { createAssistantPdfNavigator } = await modulePromise;
  const calls = [], errors = [];
  let state = { ownerId: 'paper-a', page: 1, loadSequence: 1 };
  const navigator = createAssistantPdfNavigator({
    getSnapshot: () => state,
    readDocument: async id => { calls.push(['read', id]); return document; },
    navigate: async (metadata, reference) => { calls.push(['navigate', metadata, reference]); return true; },
    report: error => errors.push(error),
    ...overrides
  });
  return { navigator, calls, errors, change: next => { state = next; } };
}

test('current and cross-paper references reach guarded navigation with unchanged provenance and no writes', async () => {
  const f = await fixture();
  assert.equal(await f.navigator.open(source), true);
  assert.deepEqual(f.calls[1], ['navigate', document, source]);
  assert.notEqual(f.calls[1][2].rect, source.rect);
  assert.deepEqual(f.errors, []);
});

test('malformed sources and rectangles cannot trigger metadata reads or navigation', async () => {
  for (const invalid of [null, { ...source, kind: 'online_dataset' }, { ...source, page: 0 },
    { ...source, source_sha256: 'wrong' }, { ...source, rect: [.5, .2, .3, .4] },
    { ...source, rect: [0, 0, 1.1, 1] }, { ...source, rect: [0, 0, NaN, 1] }]) {
    const f = await fixture();
    assert.equal(await f.navigator.open(invalid), false);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.errors, ['validation_error']);
  }
});

test('missing, deleted, non-PDF, out-of-range and changed source files stay in place', async () => {
  for (const result of [null, { ...document, id: 'other' }, { ...document, deleted_at: 'now' },
    { ...document, kind: 'study' }, { ...document, page_count: 1 }, { ...document, sha256: 'b'.repeat(64) }]) {
    const f = await fixture({ readDocument: async () => result });
    assert.equal(await f.navigator.open(source), false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.errors.length, 1);
  }
});

test('legacy PDF refs without a hash validate against current accessible document metadata', async () => {
  const f = await fixture();
  assert.equal(await f.navigator.open({ ...source, source_sha256: undefined, rect: null }), true);
  assert.equal(f.calls[1][1], document);
});

test('cancelled guarded navigation and read failures settle without a fallback browser launch', async () => {
  const cancelled = await fixture({ navigate: async () => false });
  assert.equal(await cancelled.navigator.open(source), false);
  assert.deepEqual(cancelled.errors, []);
  const failed = await fixture({ readDocument: async () => { throw { code: 'documentUnauthorized' }; } });
  assert.equal(await failed.navigator.open(source), false);
  assert.deepEqual(failed.errors, ['documentUnauthorized']);
});

test('late metadata replies, replaced navigation and destroy cannot navigate or report into a new owner', async () => {
  let finish;
  const f = await fixture({ readDocument: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.navigator.open(source);
  f.change({ ownerId: 'other', page: 1, loadSequence: 2 });
  finish(document);
  assert.equal(await pending, false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.errors, []);
  let complete;
  const g = await fixture({ readDocument: () => new Promise(resolve => { complete = resolve; }) });
  const stopped = g.navigator.open(source);
  g.navigator.destroy();
  complete(document);
  assert.equal(await stopped, false);
  assert.equal(await g.navigator.open(source), false);
  assert.deepEqual(g.calls, []);
});

test('latest citation wins while the guarded document/page navigation itself is pending', async () => {
  const ready = [], applied = [];
  const f = await fixture({ navigate: async (metadata, reference, isLatest) => {
    await new Promise(resolve => ready.push(resolve));
    if (!isLatest()) return false;
    applied.push(reference.page);
    return true;
  } });
  const first = f.navigator.open({ ...source, page: 1 });
  await new Promise(resolve => setImmediate(resolve));
  const second = f.navigator.open({ ...source, page: 2 });
  await new Promise(resolve => setImmediate(resolve));
  ready[1]();
  assert.equal(await second, true);
  ready[0]();
  assert.equal(await first, false);
  assert.deepEqual(applied, [2]);
});
