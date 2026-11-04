const ROOT_SCOPE = new URL("/", location.origin).href;
const LEGACY_SCOPE = new URL("/device/", location.origin).href;
const LEGACY_PATH = "/device-sw.js";
const WORKER_URL = new URL("./offline-worker.js", import.meta.url);
const ROOT_PATH_PATTERN = /^\/(?:_ui\/ui-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\/)?offline-worker\.js$/;

let state = { status: "preparing", release: null, completed: 0, total: 0, loadedBytes: 0, totalBytes: 0 };
let starting = null;
const listeners = new Set();

function pathOf(worker) {
  try {
    return new URL(worker?.scriptURL || worker).pathname;
  } catch {
    return "";
  }
}

function releaseOf(worker) {
  return /^\/_ui\/(ui-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95})\/offline-worker\.js$/.exec(pathOf(worker))?.[1] || null;
}

function isRootWorker(worker) {
  return ROOT_PATH_PATTERN.test(pathOf(worker));
}

function isLegacyWorker(worker) {
  return pathOf(worker) === LEGACY_PATH;
}

function publish(next) {
  state = { ...state, ...next };
  document.documentElement.dataset.offlineState = state.status;
  for (const listener of listeners) listener(state);
}

function workerMessage(worker, type, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Offline worker response timed out"));
    }, timeout);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data?.type === "offline-status") resolve(event.data);
      else reject(new Error("Invalid offline worker response"));
    };
    try {
      worker.postMessage({ type }, [channel.port2]);
    } catch (error) {
      clearTimeout(timer);
      channel.port1.close();
      reject(error);
    }
  });
}

async function registrations() {
  return navigator.serviceWorker.getRegistrations();
}

function rootRegistrations(values) {
  return values.filter((registration) => registration.scope === ROOT_SCOPE && registration.active && isRootWorker(registration.active));
}

async function readyRoot() {
  for (const registration of rootRegistrations(await registrations())) {
    try {
      const status = await workerMessage(registration.active, "offline-status-request");
      if (status.state === "ready" && status.release && (!releaseOf(registration.active) || releaseOf(registration.active) === status.release)) {
        return { registration, status };
      }
    } catch {
      // Another known registration may still be usable.
    }
  }
  return null;
}

function waitForController(predicate, timeout = 15000) {
  const current = navigator.serviceWorker.controller;
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      reject(new Error("Offline worker did not take control"));
    }, timeout);
    function changed() {
      const controller = navigator.serviceWorker.controller;
      if (!predicate(controller)) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      resolve(controller);
    }
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    changed();
  });
}

async function unregisterLegacy() {
  for (const registration of await registrations()) {
    if (registration.scope !== LEGACY_SCOPE) continue;
    const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
    if (workers.length && workers.every(isLegacyWorker)) await registration.unregister();
  }
}

async function claimRoot(registration, status) {
  await unregisterLegacy();
  await workerMessage(registration.active, "offline-claim");
  const controller = navigator.serviceWorker.controller;
  const retainLegacy = isLegacyWorker(controller) && !(await registrations()).some((candidate) => candidate.scope === LEGACY_SCOPE);
  // An unregistered legacy worker can serve this open tab until navigation; the ready root controls new navigations.
  if (!retainLegacy) {
    await waitForController((controller) => controller === registration.active || (
      controller && registration.active && controller.scriptURL === registration.active.scriptURL && isRootWorker(controller)
    ));
  }
  publish({
    status: "ready",
    release: status.release,
    completed: status.completed,
    total: status.total,
    loadedBytes: status.loadedBytes,
    totalBytes: status.totalBytes,
    error: null
  });
  return registration;
}

function waitForLegacyActive(registration) {
  if (registration.active && isLegacyWorker(registration.active)) return Promise.resolve(registration.active);
  return new Promise((resolve, reject) => {
    let observed = null;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Device worker did not activate"));
    }, 15000);
    function cleanup() {
      clearTimeout(timer);
      observed?.removeEventListener("statechange", check);
      registration.removeEventListener("updatefound", check);
    }
    function check() {
      const worker = registration.installing || registration.waiting || registration.active;
      if (worker !== observed) {
        observed?.removeEventListener("statechange", check);
        observed = worker;
        observed?.addEventListener("statechange", check);
      }
      if (registration.active && isLegacyWorker(registration.active)) {
        cleanup();
        resolve(registration.active);
      } else if (worker?.state === "redundant") {
        cleanup();
        reject(new Error("Device worker installation failed"));
      }
    }
    registration.addEventListener("updatefound", check);
    check();
  });
}

async function legacyController() {
  const existing = (await registrations()).find((registration) => registration.scope === LEGACY_SCOPE && registration.active && isLegacyWorker(registration.active));
  const registration = existing || await navigator.serviceWorker.register("/device-sw.js?v=0.55.0", { type: "module", scope: "/device/" });
  if (registration.scope !== LEGACY_SCOPE) throw new Error("Device worker scope mismatch");
  const worker = await waitForLegacyActive(registration);
  await waitForController((controller) => controller?.scriptURL === worker.scriptURL);
  return registration;
}

function waitForRootActive(registration) {
  if (!registration.installing && !registration.waiting && registration.active && pathOf(registration.active) === WORKER_URL.pathname) {
    return Promise.resolve(registration.active);
  }
  return new Promise((resolve, reject) => {
    let observed = null;
    let sawTarget = false;
    function cleanup() {
      observed?.removeEventListener("statechange", check);
      registration.removeEventListener("updatefound", check);
    }
    function check() {
      const candidate = registration.installing || registration.waiting;
      if (candidate && candidate !== observed) {
        observed?.removeEventListener("statechange", check);
        observed = candidate;
        sawTarget = true;
        candidate.addEventListener("statechange", check);
      }
      if (candidate?.state === "activated" && pathOf(candidate) === WORKER_URL.pathname) {
        cleanup();
        resolve(candidate);
      } else if (sawTarget && !candidate && registration.active && pathOf(registration.active) === WORKER_URL.pathname) {
        cleanup();
        resolve(registration.active);
      } else if (observed?.state === "redundant") {
        cleanup();
        reject(new Error("Offline preparation failed"));
      }
    }
    registration.addEventListener("updatefound", check);
    check();
  });
}

async function start() {
  if (starting) return starting;
  starting = (async () => {
    if (!("serviceWorker" in navigator) || !("caches" in window) || !("MessageChannel" in window)) {
      publish({ status: "unsupported", error: "unsupported" });
      return null;
    }
    publish({ status: "preparing", error: null });
    try {
      const existing = await readyRoot();
      const existingPath = existing?.registration.active ? pathOf(existing.registration.active) : null;
      if (existing && (existingPath === WORKER_URL.pathname || navigator.onLine === false)) {
        return await claimRoot(existing.registration, existing.status);
      }
      if (navigator.onLine === false) throw new Error("Offline preparation has not completed");
      const registration = await navigator.serviceWorker.register(WORKER_URL.href, { type: "module", scope: "/" });
      if (registration.scope !== ROOT_SCOPE) throw new Error("Offline worker scope mismatch");
      const worker = await waitForRootActive(registration);
      if (!registration.active || worker.scriptURL !== registration.active.scriptURL || !isRootWorker(worker)) {
        throw new Error("Offline worker activation mismatch");
      }
      const status = await workerMessage(worker, "offline-status-request");
      if (status.state !== "ready" || !status.release || (releaseOf(worker) && releaseOf(worker) !== status.release)) {
        throw new Error("Offline worker is not ready");
      }
      return await claimRoot(registration, status);
    } catch (error) {
      publish({ status: "failed", error: error?.message || "preparation" });
      return null;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

navigator.serviceWorker?.addEventListener("message", (event) => {
  if (!isRootWorker(event.source)) return;
  const release = releaseOf(event.source);
  if (event.data?.type === "offline-progress" && event.data.release && (!release || release === event.data.release)) {
    if (event.data.state === "ready") {
      publish({ status: "preparing", release: event.data.release });
      return;
    }
    publish({
      status: event.data.state === "failed" ? "failed" : "preparing",
      release: event.data.release,
      completed: event.data.completed || 0,
      total: event.data.total || 0,
      loadedBytes: event.data.loadedBytes || 0,
      totalBytes: event.data.totalBytes || 0,
      error: event.data.error || null
    });
  }
});

publish(state);

export const offlineSupport = {
  getState() {
    return state;
  },
  subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  },
  start,
  async ensureDeviceController() {
    if (!("serviceWorker" in navigator)) throw new Error("Service workers unavailable");
    const root = await readyRoot();
    if (root) {
      try {
        await claimRoot(root.registration, root.status);
        return root.registration;
      } catch {
        // The known legacy worker remains a first-load fallback.
      }
    }
    try {
      return await legacyController();
    } catch (error) {
      const fallback = await readyRoot();
      if (!fallback) throw error;
      await claimRoot(fallback.registration, fallback.status);
      return fallback.registration;
    }
  }
};
