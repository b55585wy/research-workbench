import { openDB } from "./vendor/device-storage/device-storage.js";

const DATABASE_NAME = "research-workbench-server-pdf-cache-v1";
const METADATA_STORE_NAME = "metadata";
const PAYLOAD_STORE_NAME = "payloads";
const CONTROL_KEY = "__server_pdf_cache_epoch__";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BLOCKED_PROBE_CODES = new Set(["source_changed", "file_missing", "document_trashed", "not_found"]);

export class ServerPdfCacheProbeError extends Error {
  constructor(code) {
    super("Server PDF cache probe blocked");
    this.name = "ServerPdfCacheProbeError";
    this.code = code;
  }
}

export const SERVER_PDF_CACHE_LIMITS = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxEntries: 32
});

let opening;

function abortError() {
  return new DOMException("PDF cache operation aborted", "AbortError");
}

function checkCurrent(signal, isCurrent) {
  if (signal?.aborted || !isCurrent()) throw abortError();
}

function documentIdIsValid(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function snapshotIsValid(document) {
  return document && documentIdIsValid(document.id) && SHA256_PATTERN.test(document.sha256);
}

function copyBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return null;
}

async function copyPayloadBytes(payload, key) {
  if (payload?.key !== key || !(payload.bytes instanceof Blob)) return null;
  return new Uint8Array(await payload.bytes.arrayBuffer());
}

export function serverPdfCacheKey(cacheScope, documentId, sourceSha256) {
  if (!SHA256_PATTERN.test(cacheScope) || !documentIdIsValid(documentId) || !SHA256_PATTERN.test(sourceSha256)) {
    throw new TypeError("Invalid server PDF cache key");
  }
  return JSON.stringify([cacheScope, documentId, sourceSha256]);
}

export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable");
  const bytes = copyBytes(value);
  if (!bytes) throw new TypeError("Expected PDF bytes");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serverPdfCacheEvictions(records, incoming, limits = SERVER_PDF_CACHE_LIMITS) {
  const retained = records.filter((record) => record.key !== incoming.key);
  const candidates = [...retained].sort((left, right) => {
    const timeDifference = (Number(left.lastUsed) || 0) - (Number(right.lastUsed) || 0);
    return timeDifference || String(left.key).localeCompare(String(right.key));
  });
  let count = retained.length + 1;
  let totalBytes = retained.reduce((sum, record) => sum + Math.max(0, Number(record.byteSize) || 0), 0) + incoming.byteSize;
  const victims = [];
  while (candidates.length && (count > limits.maxEntries || totalBytes > limits.maxTotalBytes)) {
    const victim = candidates.shift();
    victims.push(victim.key);
    count -= 1;
    totalBytes -= Math.max(0, Number(victim.byteSize) || 0);
  }
  return victims;
}

export function openServerPdfCacheDB() {
  if (opening) return opening;
  let rejectBlocked;
  const blocked = new Promise((_, reject) => { rejectBlocked = reject; });
  const opened = openDB(DATABASE_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(METADATA_STORE_NAME, { keyPath: "key" });
      db.createObjectStore(PAYLOAD_STORE_NAME, { keyPath: "key" });
    },
    blocked() {
      rejectBlocked(Object.assign(new Error("Server PDF cache upgrade is blocked by another tab."), { name: "ServerPdfCacheBlockedError" }));
      opened.then((database) => database.close(), () => {});
    },
    blocking() {
      opening = null;
      opened.then((database) => database.close(), () => {});
    },
    terminated() { opening = null; }
  });
  opening = Promise.race([opened, blocked]).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

function probeResult(body, expectedDocumentId) {
  const document = body?.document;
  if (!SHA256_PATTERN.test(body?.cache_scope) || !snapshotIsValid(document) || document.id !== expectedDocumentId) return null;
  if (!Number.isSafeInteger(document.byte_size) || document.byte_size < 1 || document.kind === "study") return null;
  return { cacheScope: body.cache_scope, document };
}

function epochFromControl(record) {
  if (!record) return 0;
  return record.key === CONTROL_KEY && Number.isSafeInteger(record.epoch) && record.epoch >= 0 ? record.epoch : null;
}

function cachedRecords(records) {
  return records.filter((record) => record.key !== CONTROL_KEY);
}

function blockedProbeCode(status, body) {
  const code = body?.detail?.code;
  if (BLOCKED_PROBE_CODES.has(code)) return code;
  return [401, 403].includes(status) ? "documentUnauthorized" : null;
}

function sameSourceVersion(before, after) {
  if (before.sha256 !== after.sha256) return false;
  return !Number.isSafeInteger(before.byte_size) || before.byte_size === after.byte_size;
}

function defaultIdle(callback) {
  if (typeof globalThis.requestIdleCallback === "function") {
    const id = globalThis.requestIdleCallback(callback, { timeout: 2000 });
    return () => globalThis.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, 50);
  return () => globalThis.clearTimeout(id);
}

export function createServerPdfCache(options = {}) {
  const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
  const openDatabase = options.openDatabase || openServerPdfCacheDB;
  const digest = options.digest || sha256Hex;
  const now = options.now || Date.now;
  const idle = options.idle || defaultIdle;
  const pendingCaptures = new Map();
  let writeQueue = Promise.resolve();
  let generation = 0;

  function enqueue(operation) {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    return result;
  }

  function captureGeneration(isCurrent) {
    const capturedGeneration = generation;
    return () => {
      try {
        return generation === capturedGeneration && isCurrent();
      } catch {
        return false;
      }
    };
  }

  async function probe(documentId, signal) {
    try {
      const response = await fetchImpl(`/api/v1/documents/${encodeURIComponent(documentId)}/reader-source`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal
      });
      if (!response.ok) {
        let body = null;
        try { body = await response.json(); } catch {}
        const code = blockedProbeCode(response.status, body);
        if (code) throw new ServerPdfCacheProbeError(code);
        return null;
      }
      return probeResult(await response.json(), documentId);
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw abortError();
      if (error instanceof ServerPdfCacheProbeError) throw error;
      return null;
    }
  }

  async function captureEpoch() {
    try {
      const db = await openDatabase();
      const transaction = db.transaction(METADATA_STORE_NAME, "readonly");
      const control = await transaction.store.get(CONTROL_KEY);
      await transaction.done;
      return epochFromControl(control);
    } catch {
      return null;
    }
  }

  function makeTicket(probed, epoch) {
    const { cacheScope, document } = probed;
    return {
      cacheScope,
      documentId: document.id,
      sourceSha256: document.sha256,
      byteSize: document.byte_size,
      epoch,
      key: serverPdfCacheKey(cacheScope, document.id, document.sha256)
    };
  }

  function ticketIsValid(ticket) {
    try {
      return ticket && Number.isSafeInteger(ticket.epoch) && ticket.epoch >= 0
        && ticket.byteSize > 0 && ticket.byteSize <= SERVER_PDF_CACHE_LIMITS.maxFileBytes
        && ticket.key === serverPdfCacheKey(ticket.cacheScope, ticket.documentId, ticket.sourceSha256);
    } catch {
      return false;
    }
  }

  function metadataIsValid(record, ticket) {
    return record?.key === ticket.key
      && record.cacheScope === ticket.cacheScope
      && record.documentId === ticket.documentId
      && record.sourceSha256 === ticket.sourceSha256
      && record.byteSize === ticket.byteSize;
  }

  function remove(key, epoch, isCurrent) {
    return enqueue(async () => {
      if (!isCurrent()) return false;
      const db = await openDatabase();
      if (!isCurrent()) return false;
      const transaction = db.transaction([METADATA_STORE_NAME, PAYLOAD_STORE_NAME], "readwrite");
      const metadata = transaction.objectStore(METADATA_STORE_NAME);
      const payloads = transaction.objectStore(PAYLOAD_STORE_NAME);
      const control = await metadata.get(CONTROL_KEY);
      if (epochFromControl(control) !== epoch || !isCurrent()) {
        await transaction.done;
        return false;
      }
      await Promise.all([metadata.delete(key), payloads.delete(key)]);
      await transaction.done;
      return true;
    }).catch(() => false);
  }

  function invalidate(cacheScope, documentId, epoch, isCurrent) {
    return enqueue(async () => {
      if (!isCurrent()) return false;
      const db = await openDatabase();
      if (!isCurrent()) return false;
      const transaction = db.transaction([METADATA_STORE_NAME, PAYLOAD_STORE_NAME], "readwrite");
      const metadata = transaction.objectStore(METADATA_STORE_NAME);
      const payloads = transaction.objectStore(PAYLOAD_STORE_NAME);
      const [control, records] = await Promise.all([metadata.get(CONTROL_KEY), metadata.getAll()]);
      if (epochFromControl(control) !== epoch || !isCurrent()) {
        await transaction.done;
        return false;
      }
      const requests = [];
      for (const record of cachedRecords(records)) {
        if (record.cacheScope === cacheScope && record.documentId === documentId) {
          requests.push(metadata.delete(record.key), payloads.delete(record.key));
        }
      }
      await Promise.all(requests);
      await transaction.done;
      return true;
    }).catch(() => false);
  }

  function touch(record, epoch, isCurrent) {
    if (!pendingCaptures.has(record.key) && isCurrent()) {
      void enqueue(async () => {
        if (!isCurrent()) return;
        const db = await openDatabase();
        if (!isCurrent()) return;
        const transaction = db.transaction(METADATA_STORE_NAME, "readwrite");
        const metadata = transaction.store;
        const [control, existing] = await Promise.all([metadata.get(CONTROL_KEY), metadata.get(record.key)]);
        if (existing && epochFromControl(control) === epoch && isCurrent()) {
          await metadata.put({ ...record, lastUsed: now() });
        }
        await transaction.done;
      }).catch(() => {});
    }
  }

  async function write(ticket, value, isCurrent) {
    if (!ticketIsValid(ticket) || !isCurrent()) return false;
    const bytes = copyBytes(value);
    if (!bytes || bytes.length !== ticket.byteSize || bytes.length > SERVER_PDF_CACHE_LIMITS.maxFileBytes) return false;
    let sourceSha256;
    try {
      sourceSha256 = await digest(bytes);
    } catch {
      return false;
    }
    if (sourceSha256 !== ticket.sourceSha256 || !isCurrent()) return false;
    const record = {
      key: ticket.key,
      cacheScope: ticket.cacheScope,
      documentId: ticket.documentId,
      sourceSha256: ticket.sourceSha256,
      byteSize: bytes.length,
      lastUsed: now()
    };
    const payload = { key: ticket.key, bytes: new Blob([bytes.buffer], { type: "application/pdf" }) };
    return enqueue(async () => {
      if (!isCurrent()) return false;
      const db = await openDatabase();
      if (!isCurrent()) return false;
      const transaction = db.transaction([METADATA_STORE_NAME, PAYLOAD_STORE_NAME], "readwrite");
      const metadata = transaction.objectStore(METADATA_STORE_NAME);
      const payloads = transaction.objectStore(PAYLOAD_STORE_NAME);
      const [control, records] = await Promise.all([metadata.get(CONTROL_KEY), metadata.getAll()]);
      if (epochFromControl(control) !== ticket.epoch || !isCurrent()) {
        await transaction.done;
        return false;
      }
      const victims = serverPdfCacheEvictions(cachedRecords(records), record);
      const requests = [];
      for (const key of victims) requests.push(metadata.delete(key), payloads.delete(key));
      requests.push(metadata.put(record), payloads.put(payload));
      await Promise.all(requests);
      await transaction.done;
      if (!isCurrent()) {
        const cleanup = db.transaction([METADATA_STORE_NAME, PAYLOAD_STORE_NAME], "readwrite");
        const cleanupMetadata = cleanup.objectStore(METADATA_STORE_NAME);
        const cleanupPayloads = cleanup.objectStore(PAYLOAD_STORE_NAME);
        const cleanupControl = await cleanupMetadata.get(CONTROL_KEY);
        if (epochFromControl(cleanupControl) === ticket.epoch) {
          await Promise.all([cleanupMetadata.delete(ticket.key), cleanupPayloads.delete(ticket.key)]);
        }
        await cleanup.done;
        return false;
      }
      return true;
    }).catch(() => false);
  }

  async function prepare(document, { signal, isCurrent = () => true } = {}) {
    const current = captureGeneration(isCurrent);
    if (!snapshotIsValid(document)) return null;
    const epoch = await captureEpoch();
    checkCurrent(signal, current);
    const probed = await probe(document.id, signal);
    if (!probed) return null;
    checkCurrent(signal, current);
    const fresh = probed.document;
    if (!sameSourceVersion(document, fresh)) {
      if (epoch !== null) await invalidate(probed.cacheScope, document.id, epoch, current);
      checkCurrent(signal, current);
      return { sourceChanged: true, document: fresh, data: null, ticket: null };
    }
    const cacheable = epoch !== null && fresh.byte_size <= SERVER_PDF_CACHE_LIMITS.maxFileBytes;
    const ticket = cacheable ? makeTicket(probed, epoch) : null;
    const miss = { sourceChanged: false, document: fresh, data: null, ticket };
    if (!ticket) return miss;
    let record;
    let payload;
    try {
      const db = await openDatabase();
      const transaction = db.transaction([METADATA_STORE_NAME, PAYLOAD_STORE_NAME], "readonly");
      const metadata = transaction.objectStore(METADATA_STORE_NAME);
      const [control, cached] = await Promise.all([metadata.get(CONTROL_KEY), metadata.get(ticket.key)]);
      record = cached;
      if (epochFromControl(control) !== epoch) {
        await transaction.done;
        return { ...miss, ticket: null };
      }
      if (metadataIsValid(record, ticket)) {
        payload = await transaction.objectStore(PAYLOAD_STORE_NAME).get(ticket.key);
      }
      await transaction.done;
    } catch {
      return miss;
    }
    checkCurrent(signal, current);
    if (!record) return miss;
    if (!metadataIsValid(record, ticket) || !payload) {
      void remove(ticket.key, epoch, current);
      return miss;
    }
    let bytes;
    try {
      bytes = await copyPayloadBytes(payload, ticket.key);
    } catch {
      void remove(ticket.key, epoch, current);
      return miss;
    }
    if (bytes?.length !== ticket.byteSize) {
      void remove(ticket.key, epoch, current);
      return miss;
    }
    let sourceSha256;
    try {
      sourceSha256 = await digest(bytes);
    } catch {
      return miss;
    }
    checkCurrent(signal, current);
    if (sourceSha256 !== ticket.sourceSha256) {
      void remove(ticket.key, epoch, current);
      return miss;
    }
    touch(record, epoch, current);
    return { sourceChanged: false, document: fresh, data: bytes, ticket: null };
  }

  async function capture(ticket, pdf, isCurrent) {
    if (!ticketIsValid(ticket) || typeof pdf?.getData !== "function" || !isCurrent()) return false;
    if (await captureEpoch() !== ticket.epoch || !isCurrent()) return false;
    let bytes;
    try {
      bytes = copyBytes(await pdf.getData());
    } catch {
      return false;
    }
    return write(ticket, bytes, isCurrent);
  }

  function schedule(ticket, pdf, isCurrent = () => true) {
    if (!ticketIsValid(ticket)) return () => {};
    pendingCaptures.get(ticket.key)?.cancel();
    const current = captureGeneration(isCurrent);
    const pending = { cancel: null };
    pending.cancel = idle(() => {
      if (pendingCaptures.get(ticket.key) !== pending) return;
      pendingCaptures.delete(ticket.key);
      void capture(ticket, pdf, current).catch(() => {});
    });
    pendingCaptures.set(ticket.key, pending);
    return () => {
      pending.cancel();
      if (pendingCaptures.get(ticket.key) === pending) pendingCaptures.delete(ticket.key);
    };
  }

  async function admitUpload(file, document, { signal, isCurrent = () => true } = {}) {
    const fallback = { admitted: false, sourceChanged: false, document: null };
    const current = captureGeneration(() => !signal?.aborted && isCurrent());
    try {
      if (!file || !snapshotIsValid(document) || file.size < 1 || file.size > SERVER_PDF_CACHE_LIMITS.maxFileBytes) return fallback;
      const epoch = await captureEpoch();
      checkCurrent(signal, current);
      const bytes = copyBytes(await file.arrayBuffer());
      if (!bytes || bytes.length !== file.size) return fallback;
      checkCurrent(signal, current);
      if (await digest(bytes) !== document.sha256) return fallback;
      checkCurrent(signal, current);
      const probed = await probe(document.id, signal);
      if (!probed) return fallback;
      checkCurrent(signal, current);
      const fresh = probed.document;
      if (fresh.sha256 !== document.sha256 || fresh.byte_size !== bytes.length || !sameSourceVersion(document, fresh)) {
        if (epoch !== null) await invalidate(probed.cacheScope, document.id, epoch, current);
        checkCurrent(signal, current);
        return { admitted: false, sourceChanged: true, document: fresh };
      }
      const admitted = epoch === null ? false : await write(makeTicket(probed, epoch), bytes, current);
      return { admitted, sourceChanged: false, document: fresh };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw abortError();
      return fallback;
    }
  }

  async function getStats() {
    const db = await openDatabase();
    const records = cachedRecords(await db.getAll(METADATA_STORE_NAME));
    return {
      entries: records.length,
      bytes: records.reduce((sum, record) => sum + Math.max(0, Number(record.byteSize) || 0), 0),
      maxBytes: SERVER_PDF_CACHE_LIMITS.maxTotalBytes,
      maxEntries: SERVER_PDF_CACHE_LIMITS.maxEntries
    };
  }

  async function clear() {
    generation += 1;
    for (const pending of pendingCaptures.values()) pending.cancel();
    pendingCaptures.clear();
    await enqueue(async () => {
      const db = await openDatabase();
      const transaction = db.transaction([METADATA_STORE_NAME, PAYLOAD_STORE_NAME], "readwrite");
      const metadata = transaction.objectStore(METADATA_STORE_NAME);
      const payloads = transaction.objectStore(PAYLOAD_STORE_NAME);
      const control = await metadata.get(CONTROL_KEY);
      const currentEpoch = epochFromControl(control);
      const epoch = currentEpoch === null ? 1 : currentEpoch + 1;
      await Promise.all([metadata.clear(), payloads.clear()]);
      await metadata.put({ key: CONTROL_KEY, epoch });
      await transaction.done;
    });
  }

  return { prepare, schedule, admitUpload, getStats, clear };
}

export const serverPdfCache = createServerPdfCache();
