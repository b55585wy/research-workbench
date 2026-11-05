import "/device-sw.js?v=0.55.0";

const FORMAT = "research-workspace-offline-v1";
const RELEASE_PATTERN = /^ui-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const CACHE_PREFIX = "research-workspace-offline-v1:";
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ASSETS = 5000;
const DOWNLOAD_CONCURRENCY = 4;
const REUSE_CACHE_LIMIT = 2;
const REUSE_SCAN_LIMIT = 8;
const NAVIGATION_TIMEOUT = 4000;
const WORKER_PATH = new URL(self.location.href).pathname;
const MANIFEST_URL = new URL("./offline-manifest.json", import.meta.url);
const ALLOWED_SUFFIXES = new Set([".js", ".mjs", ".css", ".json", ".bcmap", ".pfb", ".ttf", ".woff", ".woff2", ".wasm", ".pdf"]);

let preparedContext = null;
let contextPromise = null;
let progress = { state: "preparing", release: null, completed: 0, total: 0, loadedBytes: 0, totalBytes: 0 };
let lastProgressPost = 0;

function releaseFromPath(pathname) {
  const match = /^\/_ui\/(ui-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95})\/offline-worker\.js$/.exec(pathname);
  return match?.[1] || null;
}

function cacheName(release) {
  return `${CACHE_PREFIX}${release}`;
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function postProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastProgressPost < 250) return;
  lastProgressPost = now;
  await broadcast({ type: "offline-progress", ...progress }).catch(() => {});
}

function responseError(code) {
  return Object.assign(new Error(code), { code });
}

async function fetchBounded(url, maximumBytes, cachePolicy = "no-store") {
  const response = await fetch(url, {
    cache: cachePolicy,
    credentials: "same-origin",
    redirect: "error"
  });
  if (response.status !== 200 || response.redirected) throw responseError("response");
  const responseURL = new URL(response.url);
  const expectedURL = new URL(url, self.location.origin);
  if (responseURL.origin !== expectedURL.origin || responseURL.pathname !== expectedURL.pathname || responseURL.search !== expectedURL.search) {
    throw responseError("response_url");
  }
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw responseError("oversized");
  const body = await response.arrayBuffer();
  if (body.byteLength > maximumBytes) throw responseError("oversized");
  return { response, body };
}

function validateEntry(entry, url, device) {
  if (!entry || typeof entry !== "object" || entry.url !== url || typeof entry.html !== "string") {
    throw responseError("entry");
  }
  if (!entry.html.includes("<html") || entry.html.length > MAX_MANIFEST_BYTES) throw responseError("entry");
  if (device !== entry.html.includes('data-storage-mode="device"')) throw responseError("entry_mode");
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || manifest.format !== FORMAT || !RELEASE_PATTERN.test(manifest.release)) {
    throw responseError("manifest");
  }
  const workerRelease = releaseFromPath(WORKER_PATH);
  if (WORKER_PATH !== "/offline-worker.js" && (!workerRelease || workerRelease !== manifest.release)) {
    throw responseError("release");
  }
  const prefix = `/_ui/${manifest.release}/`;
  validateEntry(manifest.entries?.device, "/device/", true);
  validateEntry(manifest.entries?.choice, "/", false);
  if (!Array.isArray(manifest.assets) || manifest.assets.length < 1 || manifest.assets.length > MAX_ASSETS) {
    throw responseError("assets");
  }
  const paths = new Set();
  let totalBytes = 0;
  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== "object" || typeof asset.url !== "string" || !asset.url.startsWith(prefix)) {
      throw responseError("asset_path");
    }
    const url = new URL(asset.url, self.location.origin);
    if (url.origin !== self.location.origin || url.href !== `${self.location.origin}${asset.url}` || url.search || url.hash || paths.has(url.pathname)) {
      throw responseError("asset_path");
    }
    const name = url.pathname.slice(prefix.length);
    const suffix = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
    if (!name || name.includes("..") || !ALLOWED_SUFFIXES.has(suffix) || name === "offline-manifest.json" || name === "device-sw.js") {
      throw responseError("asset_path");
    }
    if (typeOfInteger(asset.bytes) === false || asset.bytes < 0 || asset.bytes > MAX_ASSET_BYTES || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
      throw responseError("asset_metadata");
    }
    totalBytes += asset.bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw responseError("asset_total");
    paths.add(url.pathname);
  }
  if (workerRelease && !paths.has(WORKER_PATH)) throw responseError("worker_missing");
  return { manifest, prefix, paths, totalBytes };
}

function typeOfInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

async function digest(body) {
  const hash = await crypto.subtle.digest("SHA-256", body);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function reuseCandidates() {
  try {
    const candidates = [];
    const names = (await caches.keys()).filter((name) => /^research-workspace-offline-v1:ui-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}:[0-9a-f-]{36}$/.test(name)).slice(-REUSE_SCAN_LIMIT);
    for (const name of names.reverse()) {
      const release = name.slice(CACHE_PREFIX.length).split(":")[0];
      if (!RELEASE_PATTERN.test(release)) continue;
      const cache = await caches.open(name);
      if (!await cache.match("/device/") || !await cache.match("/")) continue;
      candidates.push({ cache, prefix: `/_ui/${release}/` });
      if (candidates.length === REUSE_CACHE_LIMIT) break;
    }
    return candidates;
  } catch {
    return [];
  }
}

async function cachedBody(response, expectedBytes) {
  const reader = response.body?.getReader();
  if (!reader) return expectedBytes === 0 ? new ArrayBuffer(0) : null;
  const body = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedBytes) {
        await reader.cancel();
        return null;
      }
      body.set(value, offset);
      offset += value.byteLength;
    }
    return offset === expectedBytes ? body.buffer : null;
  } finally {
    reader.releaseLock();
  }
}

async function reusedAsset(asset, prefix, candidates) {
  const name = asset.url.slice(prefix.length);
  for (const candidate of candidates) {
    try {
      const response = await candidate.cache.match(`${candidate.prefix}${name}`);
      if (!response || response.status !== 200) continue;
      const body = await cachedBody(response, asset.bytes);
      if (body && await digest(body) === asset.sha256) return { response, body };
    } catch {
      // Cache eviction or unreadable bytes keep the normal download path.
    }
  }
  return null;
}

async function cacheAsset(cache, asset, prefix, candidates) {
  const { response, body } = await reusedAsset(asset, prefix, candidates)
    || await fetchBounded(asset.url, MAX_ASSET_BYTES, "default");
  if (body.byteLength !== asset.bytes || await digest(body) !== asset.sha256) throw responseError("asset_verification");
  const headers = {
    "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff"
  };
  await cache.put(asset.url, new Response(body, { status: 200, headers }));
  progress.completed += 1;
  progress.loadedBytes += asset.bytes;
  await postProgress();
}

async function prepare() {
  const { body } = await fetchBounded(MANIFEST_URL.href, MAX_MANIFEST_BYTES);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw responseError("manifest_json");
  }
  const validated = validateManifest(manifest);
  const release = manifest.release;
  const candidates = await reuseCandidates();
  const name = `${cacheName(release)}:${crypto.randomUUID()}`;
  progress = { state: "preparing", release, completed: 0, total: manifest.assets.length, loadedBytes: 0, totalBytes: validated.totalBytes };
  await postProgress(true);
  const cache = await caches.open(name);
  try {
    let next = 0;
    let failure = null;
    async function download() {
      while (!failure && next < manifest.assets.length) {
        const index = next;
        next += 1;
        try {
          await cacheAsset(cache, manifest.assets[index], validated.prefix, candidates);
        } catch (error) {
          failure ||= error;
          throw error;
        }
      }
    }
    const downloads = await Promise.allSettled(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, manifest.assets.length) }, () => download()));
    if (failure) throw failure;
    const rejected = downloads.find((result) => result.status === "rejected");
    if (rejected) throw rejected.reason;
    for (const entry of [manifest.entries.device, manifest.entries.choice]) {
      await cache.put(entry.url, new Response(entry.html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
      }));
    }
    const context = { release, cache, paths: validated.paths };
    preparedContext = context;
    contextPromise = Promise.resolve(context);
    await postProgress(true);
    return context;
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

async function contextFromCache(name, release) {
  const cache = await caches.open(name);
  if (!await cache.match(`${self.location.origin}/device/`) || !await cache.match(`${self.location.origin}/`)) return null;
  const keys = await cache.keys();
  const paths = new Set(keys.map((key) => new URL(key.url).pathname).filter((path) => path.startsWith(`/_ui/${release}/`)));
  return { release, cache, paths };
}

async function contextForActiveWorker() {
  if (preparedContext) return preparedContext;
  const release = releaseFromPath(WORKER_PATH);
  const prefix = release ? `${cacheName(release)}:` : CACHE_PREFIX;
  const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
  for (const name of names.reverse()) {
    const candidateRelease = release || name.slice(CACHE_PREFIX.length).split(":")[0];
    if (!RELEASE_PATTERN.test(candidateRelease)) continue;
    const context = await contextFromCache(name, candidateRelease);
    if (context) return context;
  }
  throw responseError("ready_cache_missing");
}

function activeContext() {
  if (!contextPromise) contextPromise = contextForActiveWorker();
  return contextPromise;
}

async function status() {
  const active = self.registration.active;
  if (!active || new URL(active.scriptURL).pathname !== WORKER_PATH) return { type: "offline-status", ...progress };
  const context = await activeContext();
  return {
    type: "offline-status",
    state: "ready",
    release: context.release,
    completed: progress.total || context.paths.size,
    total: progress.total || context.paths.size,
    loadedBytes: progress.loadedBytes,
    totalBytes: progress.totalBytes
  };
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      await prepare();
      await self.skipWaiting();
    } catch (error) {
      progress = { ...progress, state: "failed", error: error?.code || "preparation" };
      await postProgress(true);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const context = await activeContext();
    progress = { ...progress, state: "ready", release: context.release };
    await self.clients.claim();
    await postProgress(true);
  })());
});

self.addEventListener("message", (event) => {
  const port = event.ports?.[0];
  if (!port) return;
  if (event.data?.type === "offline-status-request") {
    event.waitUntil(status().then((value) => port.postMessage(value)).catch(() => port.postMessage({ type: "offline-status", state: "failed" })));
  } else if (event.data?.type === "offline-claim") {
    event.waitUntil(self.clients.claim().then(status).then((value) => port.postMessage(value)).catch(() => port.postMessage({ type: "offline-status", state: "failed" })));
  }
});

function unavailable() {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>离线不可用 · Offline unavailable</title></head><body><main><h1>当前无法连接服务器</h1><p>Server unavailable. This page was not prepared for offline use.</p><p><a href="/device/">打开本机资料 / Open on this device</a></p></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function navigationEntry(url) {
  if (url.searchParams.has("storage") && url.searchParams.get("storage") !== "device") return null;
  if (url.pathname === "/device" || url.pathname === "/device/") return "/device/";
  if (["/", "/storage", "/storage/"].includes(url.pathname)) return "/";
  return null;
}

async function navigation(request, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT);
  const entry = navigationEntry(url);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (!entry || response.status < 500 || response.status > 599) {
      clearTimeout(timer);
      return response;
    }
  } catch {
    if (!entry) {
      clearTimeout(timer);
      return unavailable();
    }
  }
  try {
    const context = await activeContext();
    return await context.cache.match(`${self.location.origin}${entry}`) || unavailable();
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}

async function staticAsset(request, url) {
  const release = /^\/_ui\/(ui-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95})\//.exec(url.pathname)?.[1];
  try {
    if (release) {
      const prefix = `${cacheName(release)}:`;
      const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
      for (const name of names.reverse()) {
        const context = await contextFromCache(name, release);
        if (!context?.paths.has(url.pathname)) continue;
        const cached = await context.cache.match(`${self.location.origin}${url.pathname}`, { ignoreSearch: true });
        if (cached) return cached;
      }
    }
  } catch {
    // An uncached or invalid release request keeps normal network behavior.
  }
  return fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/device/files/")) return;
  if (request.mode === "navigate") {
    event.respondWith(navigation(request, url));
  } else if (url.pathname.startsWith("/_ui/")) {
    event.respondWith(staticAsset(request, url));
  }
});
