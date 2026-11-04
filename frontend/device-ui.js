import { isDeviceMode } from "/device-context.js";
import { offlineSupport } from "/offline-client.js";

const copy = {
  zh: {
    storage: "存储",
    offlineReady: "离线阅读已就绪",
    offlinePreparing: "正在准备离线阅读",
    offlineFailed: "离线准备未完成",
    offlineUnsupported: "此浏览器不支持离线启动",
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
    localOnly: "仅保存在此浏览器，不会静默上传。"
  },
  en: {
    storage: "Storage",
    offlineReady: "Offline reading is ready",
    offlinePreparing: "Preparing offline reading",
    offlineFailed: "Offline preparation did not finish",
    offlineUnsupported: "Offline startup is not supported by this browser",
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
    localOnly: "Stored only in this browser; never uploaded silently."
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

export function createDeviceUI(adapter) {
  const root = document.getElementById("device-storage-ui");
  const input = document.getElementById("device-backup-input");
  const controls = document.querySelector(".header-controls");
  if (controls && root.parentElement !== controls) controls.prepend(root);
  let pending = false;
  let status = null;
  let offlineState = offlineSupport.getState();

  function text(key) {
    return copy[adapter.getLanguage()]?.[key] || copy.en[key];
  }

  function offlineText() {
    const key = {
      ready: "offlineReady",
      preparing: "offlinePreparing",
      failed: "offlineFailed",
      unsupported: "offlineUnsupported"
    }[offlineState.status] || "offlinePreparing";
    const label = text(key);
    return offlineState.status === "preparing" && offlineState.total > 0
      ? `${label} ${offlineState.completed}/${offlineState.total}`
      : label;
  }

  function renderOffline() {
    const device = isDeviceMode();
    const offlineLabel = device ? offlineText() : "";
    const summary = root.querySelector(".device-storage-summary");
    if (summary) {
      summary.setAttribute("aria-label", device ? `${text("storage")}: ${offlineLabel}` : text("storage"));
      summary.title = device ? offlineLabel : text("storage");
      const icon = summary.querySelector(".offline-status-icon");
      if (icon) icon.dataset.state = offlineState.status;
    }
    const offline = root.querySelector(".offline-status");
    if (!device || !offline) return;
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
      progress.value = offlineState.completed;
      progress.setAttribute("aria-label", offlineLabel);
      offline.append(progress);
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
    if (device) {
      const icon = window.document.createElement("span");
      icon.className = "offline-status-icon";
      icon.setAttribute("aria-hidden", "true");
      summary.append(icon);
    }
    const label = window.document.createElement("span");
    label.textContent = text("storage");
    summary.append(label);
    const panel = window.document.createElement("div");
    panel.className = "device-storage-panel";
    const switchLink = window.document.createElement("a");
    switchLink.className = "button button-quiet device-storage-switch";
    switchLink.href = device ? "/?storage=server" : "/device/";
    switchLink.textContent = device ? text("server") : text("device");
    switchLink.title = device ? text("switchServer") : text("switchDevice");
    switchLink.setAttribute("aria-label", switchLink.title);
    panel.append(switchLink);
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
      const offline = window.document.createElement("div");
      offline.className = "offline-status";
      panel.append(offline);
    }
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
    "#charts-panel", "#assistant-toggle", "#assistant-panel", "#translation-controls",
    "#research-record-open", ".annotated-pdf-export", "#metadata-lookup", "#document-metadata-lookup",
    "#text-selection-ask", "#text-selection-translate", "#region-add-agent",
    "#selected-annotation-agent", "#notes-batch-agent"
  ]) {
    const node = document.querySelector(selector);
    if (node) node.hidden = true;
  }
  const flow = document.querySelector('#reader-view-mode option[value="flow"]');
  if (flow) flow.hidden = true;
}
