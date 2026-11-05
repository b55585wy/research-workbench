import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SERVER_PDF_CACHE_LIMITS,
  createServerPdfCache,
  serverPdfCacheEvictions,
  serverPdfCacheKey
} from "../frontend/server-pdf-cache.js";

const METADATA = "metadata";
const PAYLOADS = "payloads";
const CACHE_SCOPE = "a".repeat(64);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeDocument(id, bytes) {
  return { id, sha256: digest(bytes), byte_size: bytes.length, kind: "pdf" };
}

function makeFile(bytes) {
  return {
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

class FakeTransaction {
  constructor(db, names, mode) {
    this.db = db;
    this.names = Array.isArray(names) ? names : [names];
    this.mode = mode;
    this.requests = [];
    this.snapshots = new Map(this.names.map((name) => [name, new Map(db.stores.get(name))]));
    db.transactions.push(this);
    this.store = this.names.length === 1 ? this.objectStore(this.names[0]) : undefined;
  }

  objectStore(name) {
    if (!this.names.includes(name)) throw new Error(`Store ${name} is outside the transaction`);
    const db = this.db;
    const transaction = this;
    const request = (operation, action) => {
      db.calls.push({ store: name, operation });
      const pending = (async () => {
        await Promise.resolve();
        return action();
      })();
      transaction.requests.push(pending);
      pending.catch(() => transaction.rollback());
      return pending;
    };
    return {
      async get(key) {
        db.calls.push({ store: name, operation: "get" });
        return db.stores.get(name).get(key);
      },
      async getAll() {
        db.calls.push({ store: name, operation: "getAll" });
        if (name === PAYLOADS) throw new Error("Payload getAll is forbidden");
        return [...db.stores.get(name).values()];
      },
      put(value) {
        return request("put", () => {
          if (name === PAYLOADS && db.failNextPayloadPut) {
            db.failNextPayloadPut = false;
            throw new DOMException("Injected quota failure", "QuotaExceededError");
          }
          db.stores.get(name).set(value.key, value);
        });
      },
      delete(key) {
        return request("delete", () => db.stores.get(name).delete(key));
      },
      clear() {
        return request("clear", () => db.stores.get(name).clear());
      }
    };
  }

  rollback() {
    for (const [name, snapshot] of this.snapshots) this.db.stores.set(name, new Map(snapshot));
  }

  get done() {
    return (async () => {
      const results = await Promise.allSettled([...this.requests]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure) {
        this.rollback();
        throw failure.reason;
      }
      if (this.db.beforeCommit) await this.db.beforeCommit(this);
    })();
  }
}

class FakeDB {
  constructor() {
    this.stores = new Map([[METADATA, new Map()], [PAYLOADS, new Map()]]);
    this.calls = [];
    this.transactions = [];
    this.failNextPayloadPut = false;
    this.beforeCommit = null;
  }

  transaction(names, mode) {
    return new FakeTransaction(this, names, mode);
  }

  async getAll(name) {
    this.calls.push({ store: name, operation: "getAll" });
    if (name === PAYLOADS) throw new Error("Payload getAll is forbidden");
    return [...this.stores.get(name).values()];
  }
}

function makeHarness() {
  const db = new FakeDB();
  const documents = new Map();
  const requests = [];
  const idleCallbacks = [];
  let clock = 1;
  let digestPause = null;
  let fetchHandler = null;
  const createCache = (overrides = {}) => createServerPdfCache({
    openDatabase: async () => db,
    digest: async (bytes) => {
      if (digestPause) {
        const pause = digestPause;
        digestPause = null;
        pause.entered.resolve();
        await pause.release.promise;
      }
      return digest(bytes);
    },
    now: () => clock,
    idle(callback) {
      const pending = { callback, cancelled: false };
      idleCallbacks.push(pending);
      return () => { pending.cancelled = true; };
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (fetchHandler) return fetchHandler(url, init);
      const id = decodeURIComponent(url.split("/").at(-2));
      const document = documents.get(id);
      return {
        ok: Boolean(document),
        async json() {
          return { cache_scope: CACHE_SCOPE, document };
        }
      };
    },
    ...overrides
  });
  const cache = createCache();
  return {
    db,
    cache,
    createCache,
    documents,
    requests,
    set fetchHandler(value) { fetchHandler = value; },
    tick(value) { clock = value; },
    pauseDigest() {
      digestPause = { entered: deferred(), release: deferred() };
      return digestPause;
    },
    runIdle() {
      const pending = idleCallbacks.shift();
      assert(pending, "Expected a scheduled capture");
      if (!pending.cancelled) pending.callback();
      return pending;
    }
  };
}

async function save(harness, id, bytes) {
  const document = makeDocument(id, bytes);
  harness.documents.set(id, document);
  const result = await harness.cache.admitUpload(makeFile(bytes), document);
  assert.equal(result.admitted, true);
  return document;
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function keyFor(document) {
  return serverPdfCacheKey(CACHE_SCOPE, document.id, document.sha256);
}

test("stats, LRU reads and hit touches use metadata only; hits return verified copies", async () => {
  const harness = makeHarness();
  const original = new Uint8Array([1, 2, 3, 4]);
  const document = await save(harness, "copy", original);
  harness.db.calls.length = 0;

  assert.deepEqual(await harness.cache.getStats(), {
    entries: 1,
    bytes: original.length,
    maxBytes: SERVER_PDF_CACHE_LIMITS.maxTotalBytes,
    maxEntries: SERVER_PDF_CACHE_LIMITS.maxEntries
  });
  assert.deepEqual(harness.db.calls, [{ store: METADATA, operation: "getAll" }]);

  harness.db.calls.length = 0;
  harness.tick(20);
  const hit = await harness.cache.prepare(document);
  await flush();
  assert.deepEqual(hit.data, original);
  assert.notStrictEqual(hit.data, original);
  assert.equal(harness.db.calls.filter((call) => call.store === PAYLOADS && call.operation === "get").length, 1);
  assert.equal(harness.db.calls.some((call) => call.store === PAYLOADS && call.operation === "put"), false);
  assert.equal(harness.db.calls.some((call) => call.store === METADATA && call.operation === "put"), true);
  assert.equal(harness.db.stores.get(METADATA).get(keyFor(document)).lastUsed, 20);

  hit.data[0] = 99;
  const secondHit = await harness.cache.prepare(document);
  assert.deepEqual(secondHit.data, original);
  for (const record of harness.db.stores.get(METADATA).values()) {
    assert.equal(Object.hasOwn(record, "bytes"), false);
  }
  assert(harness.db.stores.get(PAYLOADS).get(keyFor(document)).bytes instanceof Blob);
});

test("count and byte bounds evict LRU metadata together with its payload", async () => {
  const harness = makeHarness();
  const documents = [];
  for (let index = 0; index < 32; index += 1) {
    harness.tick(index + 1);
    documents.push(await save(harness, `doc-${index}`, new Uint8Array([index + 1, 2])));
  }
  harness.tick(100);
  await harness.cache.prepare(documents[0]);
  await flush();
  harness.tick(200);
  documents.push(await save(harness, "doc-32", new Uint8Array([33, 2])));

  assert.equal((await harness.cache.getStats()).entries, 32);
  assert.equal(harness.db.stores.get(METADATA).has(keyFor(documents[0])), true);
  for (const store of [METADATA, PAYLOADS]) {
    assert.equal(harness.db.stores.get(store).has(keyFor(documents[1])), false);
    assert.equal(harness.db.stores.get(store).has(keyFor(documents[32])), true);
  }

  const records = [
    { key: "old", byteSize: 4, lastUsed: 1 },
    { key: "next", byteSize: 5, lastUsed: 2 },
    { key: "newest", byteSize: 2, lastUsed: 3 }
  ];
  assert.deepEqual(serverPdfCacheEvictions(records, { key: "incoming", byteSize: 6 }, {
    maxEntries: 10,
    maxTotalBytes: 10
  }), ["old", "next"]);
  assert.deepEqual(SERVER_PDF_CACHE_LIMITS, {
    maxFileBytes: 20 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024,
    maxEntries: 32
  });

  let readOversize = false;
  const tooLarge = makeDocument("large", new Uint8Array([1]));
  const rejected = await harness.cache.admitUpload({
    size: SERVER_PDF_CACHE_LIMITS.maxFileBytes + 1,
    async arrayBuffer() { readOversize = true; }
  }, tooLarge);
  assert.equal(rejected.admitted, false);
  assert.equal(readOversize, false);
});

test("corrupt payloads fall back to a miss and quota failures roll back both stores", async () => {
  const harness = makeHarness();
  const document = await save(harness, "corrupt", new Uint8Array([5, 6, 7]));
  const key = keyFor(document);
  harness.db.stores.get(PAYLOADS).set(key, {
    key,
    bytes: new Blob([new Uint8Array([8, 8, 8])], { type: "application/pdf" })
  });

  const miss = await harness.cache.prepare(document);
  assert.equal(miss.data, null);
  assert(miss.ticket);
  await flush();
  assert.equal(harness.db.stores.get(METADATA).has(key), false);
  assert.equal(harness.db.stores.get(PAYLOADS).has(key), false);

  await save(harness, "retained", new Uint8Array([9, 9]));
  const before = await harness.cache.getStats();
  harness.db.failNextPayloadPut = true;
  const rejected = await harness.cache.admitUpload(makeFile(new Uint8Array([10, 10])),
    makeDocument("quota", new Uint8Array([10, 10])));
  assert.equal(rejected.admitted, false);
  assert.deepEqual(await harness.cache.getStats(), before);
  assert.equal(harness.db.stores.get(METADATA).has(keyFor(makeDocument("quota", new Uint8Array([10, 10])))), false);
});

test("clear atomically empties cached records and permits new operations", async () => {
  const harness = makeHarness();
  const first = await save(harness, "first", new Uint8Array([1]));
  await save(harness, "second", new Uint8Array([2]));
  await harness.cache.clear();
  assert.equal((await harness.cache.getStats()).entries, 0);
  assert.equal(harness.db.stores.get(PAYLOADS).size, 0);
  const clearTransaction = harness.db.transactions.at(-1);
  assert.deepEqual(clearTransaction.names, [METADATA, PAYLOADS]);
  assert.equal(clearTransaction.mode, "readwrite");

  const after = await save(harness, "after", new Uint8Array([3]));
  const hit = await harness.cache.prepare(after);
  assert.deepEqual(hit.data, new Uint8Array([3]));
  assert.equal((await harness.cache.getStats()).entries, 1);
  assert.equal((await harness.cache.getStats()).bytes, 1);
  assert.equal(harness.db.stores.get(METADATA).has(keyFor(first)), false);
});

test("a delayed prepare digest cannot touch an entry back after clear", async () => {
  const harness = makeHarness();
  const document = await save(harness, "delayed-hit", new Uint8Array([4, 5]));
  const pause = harness.pauseDigest();
  const preparing = harness.cache.prepare(document);
  await pause.entered.promise;
  await harness.cache.clear();
  pause.release.resolve();
  await assert.rejects(preparing, { name: "AbortError" });
  await flush();
  assert.equal((await harness.cache.getStats()).entries, 0);
  assert.equal(harness.db.stores.get(PAYLOADS).size, 0);
});

test("delayed upload admission and in-flight scheduled saves cannot repopulate after clear", async () => {
  const uploadHarness = makeHarness();
  const bytes = new Uint8Array([7, 8]);
  const document = makeDocument("delayed-upload", bytes);
  uploadHarness.documents.set(document.id, document);
  const entered = deferred();
  const release = deferred();
  const uploading = uploadHarness.cache.admitUpload({
    size: bytes.length,
    async arrayBuffer() {
      entered.resolve();
      await release.promise;
      return bytes.buffer.slice(0);
    }
  }, document);
  await entered.promise;
  await uploadHarness.cache.clear();
  release.resolve();
  await assert.rejects(uploading, { name: "AbortError" });
  assert.equal((await uploadHarness.cache.getStats()).entries, 0);
  assert.equal(uploadHarness.db.stores.get(PAYLOADS).size, 0);

  const captureHarness = makeHarness();
  const captureDocument = makeDocument("delayed-capture", bytes);
  captureHarness.documents.set(captureDocument.id, captureDocument);
  const miss = await captureHarness.cache.prepare(captureDocument);
  const dataEntered = deferred();
  const dataRelease = deferred();
  captureHarness.cache.schedule(miss.ticket, {
    async getData() {
      dataEntered.resolve();
      await dataRelease.promise;
      return bytes;
    }
  });
  captureHarness.runIdle();
  await dataEntered.promise;
  await captureHarness.cache.clear();
  dataRelease.resolve();
  await flush();
  assert.equal((await captureHarness.cache.getStats()).entries, 0);
  assert.equal(captureHarness.db.stores.get(PAYLOADS).size, 0);
});

test("clear cancels pending idle captures", async () => {
  const harness = makeHarness();
  const bytes = new Uint8Array([11]);
  const document = makeDocument("idle", bytes);
  harness.documents.set(document.id, document);
  const miss = await harness.cache.prepare(document);
  let reads = 0;
  harness.cache.schedule(miss.ticket, { async getData() { reads += 1; return bytes; } });
  await harness.cache.clear();
  harness.runIdle();
  await flush();
  assert.equal(reads, 0);
  assert.equal((await harness.cache.getStats()).entries, 0);
});

test("persistent epoch blocks held work from a second cache instance across clear", async () => {
  const harness = makeHarness();
  const cacheA = harness.cache;
  const cacheB = harness.createCache();
  assert.notStrictEqual(cacheA, cacheB);

  const idleBytes = new Uint8Array([21]);
  const idleDocument = makeDocument("other-tab-idle", idleBytes);
  harness.documents.set(idleDocument.id, idleDocument);
  const idleMiss = await cacheB.prepare(idleDocument);
  let idleReads = 0;
  cacheB.schedule(idleMiss.ticket, { async getData() { idleReads += 1; return idleBytes; } });
  await cacheA.clear();
  harness.runIdle();
  await flush();
  assert.equal(idleReads, 0);
  assert.equal((await cacheB.getStats()).entries, 0);

  const captureBytes = new Uint8Array([22, 23]);
  const captureDocument = makeDocument("other-tab-capture", captureBytes);
  harness.documents.set(captureDocument.id, captureDocument);
  const captureMiss = await cacheB.prepare(captureDocument);
  const dataEntered = deferred();
  const dataRelease = deferred();
  cacheB.schedule(captureMiss.ticket, {
    async getData() {
      dataEntered.resolve();
      await dataRelease.promise;
      return captureBytes;
    }
  });
  harness.runIdle();
  await dataEntered.promise;
  await cacheA.clear();
  dataRelease.resolve();
  await flush();
  assert.equal((await cacheB.getStats()).entries, 0);
  assert.equal(harness.db.stores.get(PAYLOADS).size, 0);

  const uploadBytes = new Uint8Array([24, 25]);
  const uploadDocument = makeDocument("other-tab-upload", uploadBytes);
  harness.documents.set(uploadDocument.id, uploadDocument);
  const uploadEntered = deferred();
  const uploadRelease = deferred();
  const uploading = cacheB.admitUpload({
    size: uploadBytes.length,
    async arrayBuffer() {
      uploadEntered.resolve();
      await uploadRelease.promise;
      return uploadBytes.buffer.slice(0);
    }
  }, uploadDocument);
  await uploadEntered.promise;
  await cacheA.clear();
  uploadRelease.resolve();
  assert.equal((await uploading).admitted, false);
  assert.equal((await cacheB.getStats()).entries, 0);

  const touchDocument = await save(harness, "other-tab-touch", new Uint8Array([26]));
  const touchEntered = deferred();
  const touchRelease = deferred();
  let holdTouch = false;
  const touchingCache = harness.createCache({
    async openDatabase() {
      if (holdTouch) {
        touchEntered.resolve();
        await touchRelease.promise;
      }
      return harness.db;
    }
  });
  const digestPause = harness.pauseDigest();
  const preparing = touchingCache.prepare(touchDocument);
  await digestPause.entered.promise;
  holdTouch = true;
  digestPause.release.resolve();
  await touchEntered.promise;
  await cacheA.clear();
  touchRelease.resolve();
  assert.deepEqual((await preparing).data, new Uint8Array([26]));
  await flush();
  assert.equal((await cacheB.getStats()).entries, 0);
  assert.equal(harness.db.stores.get(PAYLOADS).size, 0);

  const afterBytes = new Uint8Array([27]);
  const afterDocument = makeDocument("other-tab-after", afterBytes);
  harness.documents.set(afterDocument.id, afterDocument);
  assert.equal((await cacheB.admitUpload(makeFile(afterBytes), afterDocument)).admitted, true);
  assert.equal((await cacheB.getStats()).entries, 1);
});

test("stale navigation cleans a committed save without leaving either record", async () => {
  const harness = makeHarness();
  const bytes = new Uint8Array([12, 13]);
  const document = makeDocument("navigation", bytes);
  harness.documents.set(document.id, document);
  const entered = deferred();
  const release = deferred();
  harness.db.beforeCommit = async (transaction) => {
    if (transaction.mode !== "readwrite" || transaction.names.length !== 2) return;
    harness.db.beforeCommit = null;
    entered.resolve();
    await release.promise;
  };
  let active = true;
  const saving = harness.cache.admitUpload(makeFile(bytes), document, { isCurrent: () => active });
  await entered.promise;
  active = false;
  release.resolve();
  const result = await saving;
  assert.equal(result.admitted, false);
  assert.equal(harness.db.stores.get(METADATA).size, 0);
  assert.equal(harness.db.stores.get(PAYLOADS).size, 0);
});

test("clear invalidates a second tab prepare held in the source probe", async () => {
  const harness = makeHarness();
  const document = makeDocument("held-probe", new Uint8Array([31, 32]));
  const entered = deferred();
  const release = deferred();
  const cacheB = harness.createCache({
    async fetchImpl() {
      entered.resolve();
      await release.promise;
      return { ok: true, async json() { return { cache_scope: CACHE_SCOPE, document }; } };
    }
  });
  const preparing = cacheB.prepare(document);
  await entered.promise;
  await harness.cache.clear();
  release.resolve();
  const result = await preparing;
  assert.equal(result.data, null);
  assert.equal(result.ticket, null);
  assert.equal((await cacheB.getStats()).entries, 0);
  assert.equal(harness.db.stores.get(PAYLOADS).size, 0);
});

test("reader-source no-hit responses preserve the normal file path", async () => {
  const guarded = makeHarness();
  const document = makeDocument("guarded", new Uint8Array([14]));
  guarded.fetchHandler = async () => ({
    ok: false,
    status: 404,
    async json() { return { detail: { message: "unsupported route" } }; }
  });
  assert.equal(await guarded.cache.prepare(document), null);
  guarded.fetchHandler = async () => { throw new TypeError("offline"); };
  assert.equal(await guarded.cache.prepare(document), null);
  guarded.fetchHandler = async () => ({
    ok: true,
    async json() { return { cache_scope: "invalid", document }; }
  });
  assert.equal(await guarded.cache.prepare(document), null);
  assert(guarded.db.calls.every((call) => call.store === METADATA && call.operation === "get"));
  assert(guarded.db.transactions.every((tx) => tx.mode === "readonly"));
});

test("reader-source recognized refusals throw bounded blocked errors", async () => {
  const cases = [
    { status: 409, bodyCode: "source_changed", code: "source_changed" },
    { status: 409, bodyCode: "file_missing", code: "file_missing" },
    { status: 410, bodyCode: "document_trashed", code: "document_trashed" },
    { status: 404, bodyCode: "not_found", code: "not_found" },
    { status: 401, bodyCode: null, code: "documentUnauthorized" },
    { status: 403, bodyCode: "unrecognized", code: "documentUnauthorized" }
  ];
  for (const { status, bodyCode, code } of cases) {
    const harness = makeHarness();
    const document = makeDocument(`blocked-${status}-${code}`, new Uint8Array([28]));
    harness.fetchHandler = async () => ({
      ok: false,
      status,
      async json() { return { detail: { code: bodyCode, message: "private server detail" } }; }
    });
    await assert.rejects(harness.cache.prepare(document), (error) => {
      assert.equal(error.name, "ServerPdfCacheProbeError");
      assert.equal(error.code, code);
      assert.equal(error.message, "Server PDF cache probe blocked");
      assert.equal(error.message.includes("private server detail"), false);
      return true;
    });
    assert(harness.db.calls.every((call) => call.store === METADATA && call.operation === "get"));
    assert(harness.db.transactions.every((tx) => tx.mode === "readonly"));
  }
});

test("reader-source source changes invalidate both stores", async () => {
  const changed = makeHarness();
  const oldBytes = new Uint8Array([15]);
  const oldDocument = await save(changed, "changed", oldBytes);
  const newDocument = makeDocument("changed", new Uint8Array([16]));
  changed.documents.set(newDocument.id, newDocument);
  const result = await changed.cache.prepare(oldDocument);
  assert.equal(result.sourceChanged, true);
  assert.equal(result.document.sha256, newDocument.sha256);
  assert.equal(changed.db.stores.get(METADATA).size, 0);
  assert.equal(changed.db.stores.get(PAYLOADS).size, 0);
  assert.equal(changed.requests.at(-1).init.cache, "no-store");
  assert.equal(changed.requests.at(-1).init.headers.Accept, "application/json");
});
