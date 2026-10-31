const MAX_NOTEBOOK_BYTES = 1024 * 1024;

const messages = {
  zh: {
    title: "已保存分析 Notebook · {name}",
    notice: "只读视图：显示此任务已保存的代码和结果，不会执行或修改任何内容。",
    loading: "正在加载已保存的 Notebook…",
    ready: "已显示保存的 Notebook。",
    close: "关闭",
    download: "下载 .ipynb",
    retry: "重试",
    loadFailed: "无法加载已保存的 Notebook，请重试。",
    invalid_notebook: "Notebook 内容无效，无法显示。",
    notebook_too_large: "Notebook 超过 1 MiB，无法显示。",
    analysis_not_complete: "分析尚未完成，暂时无法查看 Notebook。",
    analysis_output_changed: "已保存的分析输出已变化，无法验证 Notebook。",
    dataset_changed: "数据已变化，无法验证此 Notebook。",
    not_found: "找不到此分析任务。",
    network: "无法连接本地服务，请重试。",
    request_failed: "操作未完成，请重试。"
  },
  en: {
    title: "Saved analysis Notebook · {name}",
    notice: "Read-only view: shows this task’s saved code and results. Nothing will be executed or changed.",
    loading: "Loading the saved Notebook…",
    ready: "Saved Notebook displayed.",
    close: "Close",
    download: "Download .ipynb",
    retry: "Retry",
    loadFailed: "The saved Notebook could not be loaded. Try again.",
    invalid_notebook: "The Notebook content is invalid and cannot be displayed.",
    notebook_too_large: "The Notebook is larger than 1 MiB and cannot be displayed.",
    analysis_not_complete: "The analysis is not complete, so its Notebook is not available yet.",
    analysis_output_changed: "The saved analysis output changed, so the Notebook cannot be verified.",
    dataset_changed: "The data changed, so this Notebook cannot be verified.",
    not_found: "The analysis task could not be found.",
    network: "Cannot connect to the local service. Try again.",
    request_failed: "The action was not completed. Try again."
  }
};

let rendererAssets = null;

function loadRendererAssets() {
  if (!rendererAssets) {
    const modulePromise = import("/vendor/notebook/renderer.js");
    const stylePromise = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/vendor/notebook/renderer.css";
      link.dataset.analysisNotebookRenderer = "";
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", () => {
        link.remove();
        reject(new Error("request_failed"));
      }, { once: true });
      document.head.append(link);
    });
    rendererAssets = Promise.all([modulePromise, stylePromise]).then(([module]) => module).catch((error) => {
      rendererAssets = null;
      throw error;
    });
  }
  return rendererAssets;
}

function notebookError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function readExactBytes(response) {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > MAX_NOTEBOOK_BYTES) {
    await response.body?.cancel();
    throw notebookError("notebook_too_large");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_NOTEBOOK_BYTES) throw notebookError("notebook_too_large");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_NOTEBOOK_BYTES) {
      await reader.cancel();
      throw notebookError("notebook_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validSource(source) {
  return typeof source === "string" || Array.isArray(source) && source.every((line) => typeof line === "string");
}

function validOutput(output) {
  if (!isObject(output)) return false;
  if (output.output_type === "stream") {
    return ["stdout", "stderr"].includes(output.name) && validSource(output.text);
  }
  if (output.output_type === "display_data") {
    return isObject(output.metadata) && isObject(output.data) && Object.entries(output.data).every(([mime, value]) => {
      return ["text/plain", "text/html", "image/svg+xml"].includes(mime) && validSource(value);
    });
  }
  return false;
}

function parseNotebook(bytes, session) {
  let notebook;
  try {
    notebook = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw notebookError("invalid_notebook");
  }
  const validVersion = isObject(notebook) && notebook.nbformat === 4 && notebook.nbformat_minor === 5;
  if (!validVersion || !isObject(notebook.metadata) || !Array.isArray(notebook.cells) || notebook.cells.length > 20) {
    throw notebookError("invalid_notebook");
  }
  const workbench = notebook.metadata.workbench;
  const validIdentity = isObject(workbench)
    && typeof workbench.document_id === "string" && workbench.document_id === session.documentId
    && typeof workbench.analysis_id === "string" && workbench.analysis_id === session.analysisId
    && typeof workbench.dataset_id === "string" && workbench.dataset_id === session.datasetId
    && workbench.read_only === true && workbench.code_executed_in_view === false;
  if (!validIdentity) throw notebookError("invalid_notebook");
  const language = notebook.metadata.language_info?.name;
  if (language !== "python" && language !== "r") throw notebookError("invalid_notebook");
  const cellIds = new Set();
  for (const cell of notebook.cells) {
    if (!isObject(cell) || !["markdown", "code"].includes(cell.cell_type) || !validSource(cell.source) || !isObject(cell.metadata)
      || typeof cell.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(cell.id) || cellIds.has(cell.id)
      || cell.metadata.editable !== false || cell.metadata.deletable !== false) {
      throw notebookError("invalid_notebook");
    }
    cellIds.add(cell.id);
    if (cell.cell_type === "code") {
      if (cell.execution_count !== null || !Array.isArray(cell.outputs) || !cell.outputs.every(validOutput)) {
        throw notebookError("invalid_notebook");
      }
    }
  }
  return { notebook, language };
}

export function createAnalysisNotebook(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    dialog: byId("analysis-notebook-dialog"),
    title: byId("analysis-notebook-title"),
    notice: byId("analysis-notebook-notice"),
    status: byId("analysis-notebook-status"),
    content: byId("analysis-notebook-content"),
    close: byId("analysis-notebook-close"),
    download: byId("analysis-notebook-download"),
    retry: byId("analysis-notebook-retry")
  };
  let language = adapter.getLanguage();
  let active = null;
  let returnFocus = null;

  function t(key, values = {}) {
    let text = messages[language][key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function isCurrent(session) {
    return active === session && elements.dialog.open && adapter.getDocument()?.id === session.documentId;
  }

  function renderText() {
    elements.close.textContent = t("close");
    elements.download.textContent = t("download");
    elements.retry.textContent = t("retry");
    elements.notice.textContent = t("notice");
    elements.title.textContent = active ? t("title", { name: active.datasetName }) : t("title", { name: "—" });
    if (active?.status) {
      elements.status.dataset.kind = active.status.kind;
      elements.status.textContent = t(active.status.key);
    } else {
      elements.status.textContent = "";
      delete elements.status.dataset.kind;
    }
  }

  function destroyActive() {
    const session = active;
    active = null;
    if (!session) return;
    session.controller.abort();
    session.renderer?.destroy();
    elements.content.replaceChildren();
    elements.download.disabled = true;
    elements.retry.hidden = true;
  }

  function restoreFocus() {
    const target = returnFocus?.isConnected
      ? returnFocus
      : document.querySelector('#analysis-result [data-action="view-notebook"]') || document.querySelector("#analysis-panel > summary");
    returnFocus = null;
    target?.focus();
  }

  function close(options = {}) {
    destroyActive();
    if (elements.dialog.open) elements.dialog.close();
    if (options.restoreFocus !== false) restoreFocus();
    else returnFocus = null;
  }

  function download(session) {
    if (!isCurrent(session) || !session.bytes) return;
    const blob = new Blob([session.bytes], { type: "application/x-ipynb+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = session.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function load(session) {
    if (!isCurrent(session) || session.pending) return;
    session.pending = true;
    session.bytes = null;
    session.status = { key: "loading", kind: "info" };
    elements.download.disabled = true;
    elements.retry.hidden = true;
    renderText();
    const url = `/api/v1/documents/${encodeURIComponent(session.documentId)}/analyses/${encodeURIComponent(session.analysisId)}/notebook`;
    try {
      const [response, sdk] = await Promise.all([
        adapter.checkedFetch(url, { signal: session.controller.signal }),
        loadRendererAssets()
      ]);
      if (!isCurrent(session)) return;
      const bytes = await readExactBytes(response);
      if (!isCurrent(session)) return;
      const { notebook, language: notebookLanguage } = parseNotebook(bytes, session);
      elements.content.replaceChildren();
      const renderer = sdk.createRenderer({
        languages: [sdk.python, sdk.r],
        language: notebookLanguage,
        filename: session.filename,
        onSave: () => download(session)
      });
      session.renderer = renderer.mount(elements.content, notebook);
      if (!isCurrent(session)) {
        session.renderer.destroy();
        return;
      }
      session.bytes = bytes;
      session.status = { key: "ready", kind: "success" };
      elements.download.disabled = false;
    } catch (error) {
      if (error?.name === "AbortError" || !isCurrent(session)) return;
      session.renderer?.destroy();
      session.renderer = null;
      elements.content.replaceChildren();
      session.status = { key: error.code || (error.message === "request_failed" ? "request_failed" : "loadFailed"), kind: "error" };
      elements.retry.hidden = false;
      elements.download.disabled = true;
    } finally {
      if (active === session) {
        session.pending = false;
        renderText();
      }
    }
  }

  function open(documentId, job) {
    if (!documentId || !job?.id || job.status !== "succeeded") return;
    const wasOpen = elements.dialog.open;
    if (!wasOpen) returnFocus = document.activeElement;
    destroyActive();
    const session = {
      documentId,
      analysisId: job.id,
      datasetId: job.dataset_id,
      datasetName: job.dataset_name || job.id,
      filename: `analysis-${job.id}.ipynb`,
      controller: new AbortController(),
      renderer: null,
      bytes: null,
      pending: false,
      status: null
    };
    active = session;
    elements.dialog.dataset.documentId = documentId;
    elements.dialog.dataset.analysisId = job.id;
    elements.content.dataset.documentId = documentId;
    elements.content.dataset.analysisId = job.id;
    if (!wasOpen) elements.dialog.showModal();
    renderText();
    elements.close.focus();
    load(session);
  }

  elements.close.addEventListener("click", () => close());
  elements.retry.addEventListener("click", () => {
    if (active) load(active);
  });
  elements.download.addEventListener("click", () => {
    if (active) download(active);
  });
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  elements.dialog.addEventListener("close", () => {
    if (active && !elements.dialog.open) {
      destroyActive();
      restoreFocus();
    }
  });

  return {
    open,
    close,
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      renderText();
    }
  };
}
