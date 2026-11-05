const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const origin = 'https://workbench.test';
const release = 'ui-new';
const prefix = `/_ui/${release}/`;
const workerURL = `${origin}${prefix}offline-worker.js`;
const cacheName = (id, index = 1) => `research-workspace-offline-v1:${id}:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const sha = (body) => createHash('sha256').update(body).digest('hex');
const key = (value) => new URL(typeof value === 'string' ? value : value.url, origin).href;

function harness(files = { 'shared.js': 'same', 'changed.js': 'new' }) {
  const payload = { ...files, 'offline-worker.js': 'new worker' };
  const manifest = {
    format: 'research-workspace-offline-v1', release,
    entries: {
      device: { url: '/device/', html: '<html data-storage-mode="device">new device</html>' },
      choice: { url: '/', html: '<html>new choice</html>' },
    },
    assets: Object.entries(payload).map(([name, body]) => ({ url: prefix + name, bytes: Buffer.byteLength(body), sha256: sha(body) })),
  };
  const stores = new Map(), listeners = new Map(), requests = [], events = [], opened = [];
  let inFlight = 0, peak = 0, skipped = 0;
  const control = { failFetch: null, failPut: false, failNotify: false, delay: 0 };
  class Cache {
    constructor(name) { this.name = name; this.items = new Map(); this.failMatch = false; }
    async put(url, response) {
      if (control.failPut && this.name.includes(`:${release}:`)) throw new Error('quota');
      const body = Buffer.from(await response.arrayBuffer());
      this.items.set(key(url), { body, headers: [...response.headers], status: response.status });
      events.push(['put', this.name, key(url)]);
    }
    async match(url) {
      if (this.failMatch) throw new Error('evicted');
      const item = this.items.get(key(url));
      return item && new Response(item.body, { status: item.status, headers: item.headers });
    }
    async keys() { return [...this.items.keys()].map((url) => new Request(url)); }
  }
  const caches = {
    async keys() { return [...stores.keys()]; },
    async open(name) {
      opened.push(name);
      if (!stores.has(name)) stores.set(name, new Cache(name));
      return stores.get(name);
    },
    async delete(name) { events.push(['delete', name]); return stores.delete(name); },
  };
  async function fetch(url, options) {
    const href = key(url), pathname = new URL(href).pathname;
    requests.push({ pathname, cache: options.cache });
    inFlight += 1; peak = Math.max(peak, inFlight);
    try {
      if (control.delay && !pathname.endsWith('offline-manifest.json')) await new Promise((resolve) => setTimeout(resolve, control.delay));
      if (pathname === control.failFetch) throw new Error('network');
      const body = pathname.endsWith('offline-manifest.json') ? JSON.stringify(manifest) : payload[pathname.slice(prefix.length)];
      const response = new Response(body ?? 'missing', { status: body === undefined ? 404 : 200, headers: { 'Content-Type': 'text/javascript' } });
      Object.defineProperty(response, 'url', { value: href });
      return response;
    } finally { inFlight -= 1; events.push(['fetch-finished', pathname]); }
  }
  const self = {
    location: { href: workerURL, origin }, registration: { active: { scriptURL: workerURL } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    clients: {
      async matchAll() { return [{ postMessage() { if (control.failNotify) throw new Error('closed client'); } }]; },
      async claim() {},
    },
    async skipWaiting() { skipped += 1; },
  };
  const context = vm.createContext({ self, caches, fetch, crypto: webcrypto, URL, Response, Request, TextDecoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, AbortController });
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/offline-worker.js'), 'utf8')
    .replace(/^import .+;\r?\n/, '').replaceAll('import.meta.url', JSON.stringify(workerURL));
  vm.runInContext(source, context);
  async function install() {
    let pending;
    listeners.get('install')({ waitUntil(value) { pending = value; } });
    await pending;
  }
  async function seed(id, assets, { complete = true, index = 1 } = {}) {
    const cache = await caches.open(cacheName(id, index));
    for (const [name, body] of Object.entries(assets)) await cache.put(`/_ui/${id}/${name}`, new Response(body, { headers: { 'Content-Type': 'text/javascript', 'X-Untrusted': 'drop' } }));
    await cache.put('/device/', new Response('<html data-storage-mode="device">old</html>'));
    if (complete) await cache.put('/', new Response('<html>old choice</html>'));
    return cache;
  }
  return { context, install, seed, manifest, payload, stores, requests, events, opened, control, get peak() { return peak; }, get skipped() { return skipped; } };
}

test('first install verifies all files, keeps the manifest fresh, and completes both new entries', async () => {
  const h = harness({ 'empty.json': '', 'shared.js': 'same' });
  await h.install();
  assert.equal(h.skipped, 1);
  assert.equal(h.requests[0].cache, 'no-store');
  assert(h.requests.slice(1).every((request) => request.cache === 'default'));
  const current = [...h.stores.values()][0];
  assert.equal(await (await current.match('/device/')).text(), h.manifest.entries.device.html);
  assert.equal(await (await current.match('/')).text(), h.manifest.entries.choice.html);
  const status = await h.context.status();
  assert.equal(status.state, 'ready');
  assert.equal(status.completed, h.manifest.assets.length);
  assert(h.peak <= 4);
});

test('upgrade reuses identical same-path bytes, downloads changed files, and preserves old requests', async () => {
  const h = harness();
  const old = await h.seed('ui-old', { 'shared.js': 'same', 'changed.js': 'old' });
  await h.install();
  assert(!h.requests.some((request) => request.pathname === prefix + 'shared.js'));
  assert(h.requests.some((request) => request.pathname === prefix + 'changed.js'));
  const response = await h.context.staticAsset(new Request(`${origin}/_ui/ui-old/changed.js`), new URL(`${origin}/_ui/ui-old/changed.js`));
  assert.equal(await response.text(), 'old');
  assert.equal(await (await old.match('/')).text(), '<html>old choice</html>');
  const current = [...h.stores.values()].at(-1);
  const copied = await current.match(prefix + 'shared.js');
  assert.equal(await copied.text(), 'same');
  assert.equal(copied.headers.get('X-Untrusted'), null);
  assert.equal(await (await current.match('/')).text(), h.manifest.entries.choice.html);
});

test('bad hash, oversized/short bytes, and missing cached files all fall back to the network', async () => {
  for (const body of ['oops', 'oversized cache', '', null]) {
    const h = harness();
    await h.seed('ui-old', body === null ? {} : { 'shared.js': body });
    await h.install();
    assert(h.requests.some((request) => request.pathname === prefix + 'shared.js'));
    assert.equal((await h.context.status()).state, 'ready');
  }
});

test('a cache read error is a miss and does not prevent a valid network install', async () => {
  const h = harness();
  const old = await h.seed('ui-old', { 'shared.js': 'same' });
  old.failMatch = true;
  await h.install();
  assert(h.requests.some((request) => request.pathname === prefix + 'shared.js'));
  assert(h.stores.has(old.name));
});

test('incomplete caches, unrelated namespaces, and another relative path are never reused', async () => {
  const h = harness();
  await h.seed('ui-incomplete', { 'shared.js': 'same' }, { complete: false });
  await h.seed('ui-old', { 'other/shared.js': 'same', 'shared.js?query=1': 'same' });
  const unrelated = new Map(h.stores).values().next().value;
  h.stores.set('unrelated-program-cache', unrelated);
  await h.install();
  assert(h.requests.some((request) => request.pathname === prefix + 'shared.js'));
});

test('candidate lookup bounds complete caches and incomplete cache scans', async () => {
  const h = harness();
  await h.seed('ui-oldest', { 'shared.js': 'same' });
  await h.seed('ui-middle', {});
  await h.seed('ui-latest', {});
  h.opened.length = 0;
  await h.install();
  assert(h.requests.some((request) => request.pathname === prefix + 'shared.js'));
  assert.equal(h.opened.filter((name) => name.includes('ui-oldest')).length, 0);
  const sparse = harness();
  await sparse.seed('ui-oldest', { 'shared.js': 'same' });
  for (let i = 0; i < 10; i += 1) await sparse.seed(`ui-partial-${i}`, {}, { complete: false });
  sparse.opened.length = 0;
  await sparse.install();
  assert.equal(sparse.opened.length, 9); // Eight candidates and one new staging cache.
  assert(sparse.requests.some((request) => request.pathname === prefix + 'shared.js'));
});

test('a rejected download drains siblings before removing staging and never replaces the old package', async () => {
  const h = harness({ 'bad.js': 'bad', 'slow.js': 'slow', 'later.js': 'later', 'never.js': 'never', 'last.js': 'last' });
  const old = await h.seed('ui-old', { 'shared.js': 'same' });
  h.control.delay = 15;
  h.control.failFetch = prefix + 'bad.js';
  await assert.rejects(h.install(), /network/);
  assert.equal(h.skipped, 0);
  assert.deepEqual([...h.stores.keys()], [old.name]);
  const cleanup = h.events.findIndex((event) => event[0] === 'delete');
  assert(h.events.slice(cleanup + 1).every((event) => event[0] !== 'put' && event[0] !== 'fetch-finished'));
  assert(!h.requests.some((request) => request.pathname === prefix + 'last.js'));
  assert.equal(await (await old.match('/device/')).text(), '<html data-storage-mode="device">old</html>');
});

test('network hash failure and cache quota failure retain the old complete package', async () => {
  for (const quota of [false, true]) {
    const h = harness();
    const old = await h.seed('ui-old', {});
    if (quota) h.control.failPut = true;
    else h.manifest.assets[0].sha256 = '0'.repeat(64);
    await assert.rejects(h.install(), quota ? /quota/ : /asset_verification/);
    assert.deepEqual([...h.stores.keys()], [old.name]);
    assert.equal(h.skipped, 0);
  }
});

test('invalid manifest paths and bounds are rejected before any asset or cache read', async () => {
  for (const mutation of [
    (asset) => { asset.url = '/api/v1/documents'; },
    (asset) => { asset.url = prefix + 'shared.js?query=1'; },
    (asset) => { asset.bytes = 20 * 1024 * 1024 + 1; },
    (asset) => { asset.sha256 = 'invalid'; },
  ]) {
    const h = harness();
    mutation(h.manifest.assets[0]);
    await assert.rejects(h.install());
    assert.equal(h.requests.length, 1);
    assert.equal(h.opened.length, 0);
  }
});

test('closed progress recipients cannot turn a verified package into a deleted ready cache', async () => {
  const h = harness();
  h.control.failNotify = true;
  await h.install();
  assert.equal((await h.context.status()).state, 'ready');
  assert.equal(h.stores.size, 1);
  assert.equal(h.events.filter((event) => event[0] === 'delete').length, 0);
});
