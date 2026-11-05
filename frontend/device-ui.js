import { isDeviceMode } from "/device-context.js";
import { offlineSupport } from "/offline-client.js";
import { serverPdfCache } from "/server-pdf-cache.js";

const copy = {
  zh: {
    storage: "当前资料位置",
    chooseWorkspace: "比较资料位置与功能",
    switchDeviceAction: "切换到本机资料",
    switchServerAction: "切换到服务器资料",
    offlineReady: "离线阅读已就绪",
    offlinePreparing: "正在准备离线阅读",
    offlineFailed: "离线准备未完成",
    offlineUnsupported: "此浏览器不支持离线启动",
    offlineServerReady: "离线程序已准备",
    offlineServerPreparing: "正在准备离线程序",
    offlineServerFailed: "离线程序准备未完成",
    offlineServerNote: "离线阅读仅打开本机资料；服务器资料仍需联网。",
    offlineRetry: "重试准备",
    device: "本机资料",
    server: "服务器资料",
    switchDevice: "切换到本机资料（不移动数据）",
    switchServer: "切换到服务器资料（不移动数据）",
    import: "导入备份",
    export: "导出备份",
    working: "正在处理备份…",
    imported: "备份已导入。",
    exported: "备份已导出。",
    failed: "备份操作未完成，请重试。",
    backupConflict: "本机已有不同内容，未覆盖现有资料。",
    hashMismatch: "备份校验失败，请选择完整、未修改的备份。",
    unsupportedBackup: "仅支持本应用导出的本机 v1 备份。",
    storageQuota: "本机空间不足，现有资料未改动；请清理空间后重试。",
    invalidBackup: "备份无效或已截断，请选择完整备份。",
    localOnly: "仅保存在此浏览器，不会静默上传。",
    serverCache: "服务器 PDF 阅读缓存",
    clearCache: "清除阅读缓存",
    cacheWorking: "正在清除阅读缓存…",
    cacheCleared: "阅读缓存已清除。",
    cacheFailed: "阅读缓存操作未完成，请重试。"
  },
  en: {
    storage: "Current workspace",
    chooseWorkspace: "Compare workspace capabilities",
    switchDeviceAction: "Switch to device storage",
    switchServerAction: "Switch to server storage",
    offlineReady: "Offline reading is ready",
    offlinePreparing: "Preparing offline reading",
    offlineFailed: "Offline preparation did not finish",
    offlineUnsupported: "Offline startup is not supported by this browser",
    offlineServerReady: "Offline program is ready",
    offlineServerPreparing: "Preparing the offline program",
    offlineServerFailed: "Offline program preparation did not finish",
    offlineServerNote: "Offline reading opens device materials; server materials still require a network connection.",
    offlineRetry: "Retry preparation",
    device: "On this device",
    server: "On server",
    switchDevice: "Switch to device storage (data is not moved)",
    switchServer: "Switch to server storage (data is not moved)",
    import: "Import backup",
    export: "Export backup",
    working: "Processing backup…",
    imported: "Backup imported.",
    exported: "Backup exported.",
    failed: "The backup operation did not finish. Try again.",
    backupConflict: "Different local content exists; nothing was overwritten.",
    hashMismatch: "Backup verification failed. Choose a complete, unmodified backup.",
    unsupportedBackup: "Only device v1 backups exported by this app are supported.",
    storageQuota: "Device storage is full. Your data is unchanged; free space and retry.",
    invalidBackup: "The backup is invalid or truncated. Choose a complete backup.",
    localOnly: "Stored only in this browser; never uploaded silently.",
    serverCache: "Server PDF read cache",
    clearCache: "Clear read cache",
    cacheWorking: "Clearing read cache…",
    cacheCleared: "Read cache cleared.",
    cacheFailed: "The read-cache operation did not finish. Try again."
  }
};

const backupErrorKeys = {
  backup_conflict: "backupConflict",
  hash_mismatch: "hashMismatch",
  backup_hash_mismatch: "hashMismatch",
  unsupported_backup: "unsupportedBackup",
  storage_quota: "storageQuota",
  invalid_backup: "invalidBackup"
};

function backupFilename(document) {
  const base = (document?.title || document?.original_filename || "reading-backup")
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, "_").trim().slice(0, 80);
  return `${base || "reading-backup"}.zip`;
}

function formatCacheBytes(value, language) {
  const units = ["B", "KiB", "MiB"];
  let amount = Math.max(0, Number(value) || 0);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en", { maximumFractionDigits: unit ? 1 : 0 }).format(amount)} ${units[unit]}`;
}

function storageIcon(className, path) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", className);
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.7");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  icon.append(shape);
  return icon;
}

export function createDeviceUI(adapter) {
  const root = document.getElementById("device-storage-ui");
  const input = document.getElementById("device-backup-input");
  // This native host stays in the header; React only moves the appearance controls.
  let pending = false;
  let status = null;
  let cacheStats = null;
  let cacheStatsPending = false;
  let offlineState = offlineSupport.getState();

  function text(key) {
    return copy[adapter.getLanguage()]?.[key] || copy.en[key];
  }

  async function refreshCacheStats() {
    if (cacheStatsPending || isDeviceMode()) return;
    cacheStatsPending = true;
    try {
      cacheStats = await serverPdfCache.getStats();
    } catch {
      cacheStats = { entries: 0, bytes: 0, unavailable: true };
    } finally {
      cacheStatsPending = false;
      render();
    }
  }

  async function clearServerCache() {
    if (pending || cacheStatsPending || isDeviceMode()) return;
    pending = true;
    setStatus("info", "cacheWorking");
    try {
      await serverPdfCache.clear();
      cacheStats = { entries: 0, bytes: 0 };
      setStatus("success", "cacheCleared");
    } catch {
      setStatus("error", "cacheFailed");
    } finally {
      pending = false;
      render();
    }
  }

  function renderServerCache(panel, menu) {
    const row = window.document.createElement("div");
    row.className = "device-storage-actions";
    const label = window.document.createElement("p");
    label.className = "device-storage-note";
    label.textContent = cacheStats?.unavailable ? text("cacheFailed") : cacheStats
      ? `${text("serverCache")}: ${formatCacheBytes(cacheStats.bytes, adapter.getLanguage())} · ${cacheStats.entries} PDF`
      : text("serverCache");
    const clear = window.document.createElement("button");
    clear.type = "button";
    clear.className = "button button-quiet";
    clear.textContent = text("clearCache");
    clear.disabled = pending || cacheStatsPending || cacheStats?.entries === 0;
    clear.addEventListener("click", () => void clearServerCache());
    row.append(label, clear);
    panel.append(row);
    menu.addEventListener("toggle", () => {
      if (menu.open && !cacheStats && !cacheStatsPending) void refreshCacheStats();
    });
  }

  function offlineText(device) {
    const key = {
      ready: device ? "offlineReady" : "offlineServerReady",
      preparing: device ? "offlinePreparing" : "offlineServerPreparing",
      failed: device ? "offlineFailed" : "offlineServerFailed",
      unsupported: "offlineUnsupported"
    }[offlineState.status] || (device ? "offlinePreparing" : "offlineServerPreparing");
    const label = text(key);
    return offlineState.status === "preparing" && offlineState.total > 0
      ? `${label} ${offlineState.completed}/${offlineState.total}`
      : label;
  }

  function renderOffline() {
    const device = isDeviceMode();
    const offlineLabel = offlineText(device);
    const summary = root.querySelector(".device-storage-summary");
    if (summary) {
      const workspaceLabel = `${text("storage")}: ${text(device ? "device" : "server")}`;
      summary.setAttribute("aria-label", `${workspaceLabel}. ${offlineLabel}`);
      summary.title = `${workspaceLabel}\n${offlineLabel}`;
      const icon = summary.querySelector(".offline-status-icon");
      if (icon) icon.dataset.state = offlineState.status;
    }
    const offline = root.querySelector(".offline-status");
    if (!offline) return;
    offline.replaceChildren();
    const offlineRow = window.document.createElement("div");
    offlineRow.className = "offline-status-row";
    const offlineMessage = window.document.createElement("p");
    offlineMessage.className = "offline-status-text";
    offlineMessage.setAttribute("role", offlineState.status === "failed" ? "alert" : "status");
    offlineMessage.textContent = offlineLabel;
    offlineRow.append(offlineMessage);
    if (offlineState.status === "failed") {
      const retry = window.document.createElement("button");
      retry.type = "button";
      retry.className = "button button-quiet offline-retry";
      retry.textContent = text("offlineRetry");
      retry.addEventListener("click", () => void offlineSupport.start());
      offlineRow.append(retry);
    }
    offline.append(offlineRow);
    if (offlineState.status === "preparing" && offlineState.total > 0) {
      const progress = window.document.createElement("progress");
      progress.max = offlineState.total;
      progress.value = Math.min(Math.max(offlineState.completed, 0), offlineState.total);
      progress.setAttribute("aria-label", offlineLabel);
      offline.append(progress);
    }
    if (!device) {
      const note = window.document.createElement("p");
      note.className = "device-storage-note";
      note.textContent = text("offlineServerNote");
      offline.append(note);
    }
  }

  function render() {
    const device = isDeviceMode();
    const paper = adapter.getDocument();
    const wasOpen = root.querySelector("details")?.open || false;
    root.setAttribute("aria-label", text("storage"));
    root.replaceChildren();
    const menu = window.document.createElement("details");
    menu.className = "device-storage-menu";
    menu.open = wasOpen;
    const summary = window.document.createElement("summary");
    summary.className = "device-storage-summary";
    const mode = window.document.createElement("span");
    mode.className = "device-storage-mode";
    mode.append(storageIcon("device-storage-mode-icon", device
      ? "M5 4h14v12H5zM2 20h20l-3-4H5z"
      : "M4 3h16v7H4zM4 14h16v7H4zM7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"));
    if (device) {
      const icon = window.document.createElement("span");
      icon.className = "offline-status-icon";
      icon.setAttribute("aria-hidden", "true");
      mode.append(icon);
    }
    const label = window.document.createElement("span");
    label.className = "device-storage-name";
    label.textContent = text(device ? "device" : "server");
    summary.append(mode, label, storageIcon("device-storage-chevron", "m8 10 4 4 4-4"));
    const panel = window.document.createElement("div");
    panel.className = "device-storage-panel";
    const switchLink = window.document.createElement("a");
    switchLink.className = "button button-quiet device-storage-switch";
    switchLink.href = device ? "/?storage=server" : "/device/";
    switchLink.textContent = device ? text("switchServerAction") : text("switchDeviceAction");
    switchLink.title = device ? text("switchServer") : text("switchDevice");
    switchLink.setAttribute("aria-label", switchLink.title);
    panel.append(switchLink);
    if (!device) renderServerCache(panel, menu);
    if (device) {
      const actions = window.document.createElement("div");
      actions.className = "device-storage-actions";
      const importButton = window.document.createElement("button");
      importButton.type = "button";
      importButton.className = "button button-quiet";
      importButton.textContent = text("import");
      importButton.disabled = pending;
      importButton.addEventListener("click", () => input.click());
      const exportButton = window.document.createElement("button");
      exportButton.type = "button";
      exportButton.className = "button button-quiet";
      exportButton.textContent = text("export");
      exportButton.disabled = pending || !paper || paper.kind === "study";
      exportButton.addEventListener("click", () => void exportBackup());
      actions.append(importButton, exportButton);
      const help = window.document.createElement("p");
      help.className = "device-storage-note";
      help.textContent = text("localOnly");
      panel.append(actions, help);
    }
    const offline = window.document.createElement("div");
    offline.className = "offline-status";
    panel.append(offline);
    const chooseLink = window.document.createElement("a");
    chooseLink.className = "device-storage-help";
    chooseLink.href = "/storage";
    chooseLink.textContent = text("chooseWorkspace");
    panel.append(chooseLink);
    if (status) {
      const message = window.document.createElement("p");
      message.className = "device-storage-status";
      message.dataset.kind = status.kind;
      message.setAttribute("role", status.kind === "error" ? "alert" : "status");
      message.textContent = status.text;
      panel.append(message);
    }
    menu.append(summary, panel);
    root.append(menu);
    renderOffline();
  }

  offlineSupport.subscribe((next) => {
    offlineState = next;
    renderOffline();
  });

  root.addEventListener("keydown", (event) => {
    const menu = root.querySelector("details");
    if (event.key !== "Escape" || !menu?.open) return;
    event.preventDefault();
    event.stopPropagation();
    menu.open = false;
    root.querySelector("summary")?.focus({ preventScroll: true });
  });

  root.addEventListener("focusout", (event) => {
    if (!event.relatedTarget || root.contains(event.relatedTarget)) return;
    const menu = root.querySelector("details");
    if (menu) menu.open = false;
  });

  function setStatus(kind, key) {
    status = key ? { kind, text: text(key) } : null;
    render();
  }

  function setBackupError(error) {
    setStatus("error", backupErrorKeys[error?.code] || "failed");
  }

  async function exportBackup() {
    const document = adapter.getDocument();
    if (pending || !document || document.kind === "study") return;
    pending = true;
    setStatus("info", "working");
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(document.id)}/export`);
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = backupFilename(document);
      link.hidden = true;
      window.document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("success", "exported");
    } catch (error) {
      setBackupError(error);
    } finally {
      pending = false;
      render();
    }
  }

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file || pending) return;
    void (async () => {
      pending = true;
      setStatus("info", "working");
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const response = await adapter.checkedFetch("/api/v1/device/backups", { method: "POST", body: form });
        const result = await response.json();
        setStatus("success", "imported");
        await adapter.imported(result);
      } catch (error) {
        setBackupError(error);
      } finally {
        pending = false;
        render();
      }
    })();
  });

  return { render };
}

export function applyDeviceCapabilities() {
  if (!isDeviceMode()) return;
  for (const selector of [
    "#workspace-mode-controls", "#data-navigation", "#project-library", "#analysis-panel",
    "#charts-panel", "#translation-controls",
    "#research-record-open", ".annotated-pdf-export", "#metadata-lookup", "#document-metadata-lookup",
    "#region-add-agent"
  ]) {
    const node = document.querySelector(selector);
    if (node) node.hidden = true;
  }
  const flow = document.querySelector('#reader-view-mode option[value="flow"]');
  if (flow) flow.hidden = true;
}
