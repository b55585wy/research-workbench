const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const messages = {
  zh: {
    library: "图片库",
    help: "上传 PNG、JPEG 或 WebP 图片，并明确选择用于新笔记或助手。图片批注使用 EXIF 规范化预览图；原图保留并可下载。",
    upload: "上传图片",
    uploading: "正在上传图片…",
    uploaded: "图片已上传。",
    retry: "重试上传",
    empty: "这篇文献还没有上传图片。",
    list: "已上传图片",
    chat: "提供给助手",
    note: "加入新笔记",
    source: "用户上传 · 非 PDF 截取",
    download: "下载原图",
    view: "查看 / 批注",
    dimensions: "{width} × {height} 像素",
    invalidType: "请选择 PNG、JPEG 或 WebP 图片。",
    file_too_large: "图片不能超过 8 MiB。",
    image_limit: "图片尺寸或总存储量超出限制。",
    idempotency_conflict: "上传请求发生冲突，请重新选择图片。",
    validation_error: "图片或上传请求无效。",
    network: "无法连接本地服务，上传内容已保留。请重试。",
    request_failed: "图片上传未完成，请重试。",
    loadFailed: "无法加载图片库。",
    noteImageAlt: "笔记中的用户上传图片：{name}"
  },
  en: {
    library: "Image library",
    help: "Upload PNG, JPEG, or WebP images and explicitly choose them for a new note or the assistant. Annotations use the EXIF-normalized preview; the original is preserved and downloadable.",
    upload: "Upload image",
    uploading: "Uploading image…",
    uploaded: "Image uploaded.",
    retry: "Retry upload",
    empty: "No uploaded images for this paper yet.",
    list: "Uploaded images",
    chat: "Provide to assistant",
    note: "Add to new note",
    source: "User upload · not a PDF crop",
    download: "Download original",
    view: "View / annotate",
    dimensions: "{width} × {height} pixels",
    invalidType: "Choose a PNG, JPEG, or WebP image.",
    file_too_large: "Images must be no larger than 8 MiB.",
    image_limit: "The image dimensions or total storage limit was exceeded.",
    idempotency_conflict: "The upload request conflicted. Choose the image again.",
    validation_error: "The image or upload request is invalid.",
    network: "Cannot connect to the local service. The upload is retained; try again.",
    request_failed: "The image upload was not completed. Try again.",
    loadFailed: "The image library could not be loaded.",
    noteImageAlt: "User-uploaded image in note: {name}"
  }
};

export function createImageLibrary(adapter) {
  const elements = {
    root: document.getElementById("image-library"),
    summary: document.getElementById("image-library-toggle"),
    help: document.getElementById("image-library-help"),
    input: document.getElementById("image-upload-input"),
    button: document.getElementById("image-upload-button"),
    status: document.getElementById("image-upload-status"),
    list: document.getElementById("images-list")
  };
  const papers = new Map();
  let language = adapter.getLanguage();

  function t(key, values = {}) {
    let text = messages[language][key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function entryFor(documentId) {
    if (!papers.has(documentId)) {
      papers.set(documentId, {
        items: [],
        chat: new Set(),
        note: new Set(),
        upload: null,
        status: null,
        sequence: 0,
        controller: null,
        loaded: false
      });
    }
    return papers.get(documentId);
  }

  function current() {
    const paper = adapter.getDocument();
    return paper ? { paper, entry: entryFor(paper.id) } : { paper: null, entry: null };
  }

  function setStatus(entry, status) {
    entry.status = status;
  }

  function renderStatus(entry) {
    elements.status.replaceChildren();
    elements.status.dataset.kind = entry?.status?.kind || "info";
    if (!entry?.status) return;
    const text = document.createElement("span");
    text.textContent = t(entry.status.key, entry.status.values || {});
    elements.status.append(text);
    if (entry.status.retry) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "status-retry";
      retry.dataset.action = "retry-image-upload";
      retry.textContent = t("retry");
      retry.addEventListener("click", () => upload(entry.status.retry.paperId));
      elements.status.append(retry);
    }
  }

  function imageUrl(paperId, imageId, kind) {
    return `/api/v1/documents/${encodeURIComponent(paperId)}/images/${encodeURIComponent(imageId)}/${kind}`;
  }

  function viewButton(paperId, imageId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-quiet";
    button.dataset.action = "view-image";
    button.dataset.sourceKind = "user_upload";
    button.dataset.sourceId = imageId;
    button.textContent = t("view");
    button.addEventListener("click", () => adapter.openImage(paperId, "user_upload", imageId));
    return button;
  }

  function render() {
    const { paper, entry } = current();
    elements.button.disabled = !paper || Boolean(entry?.upload?.pending);
    elements.input.disabled = !paper || Boolean(entry?.upload?.pending);
    elements.list.replaceChildren();
    elements.list.setAttribute("aria-label", t("list"));
    renderStatus(entry);
    if (!paper || !entry) return;

    for (const image of entry.items) {
      const item = document.createElement("li");
      item.className = "image-item";
      item.dataset.imageId = image.id;

      const preview = document.createElement("img");
      preview.className = "image-thumbnail";
      preview.src = imageUrl(paper.id, image.id, "preview");
      preview.alt = image.original_filename;
      preview.loading = "lazy";

      const body = document.createElement("div");
      body.className = "image-item-body";
      const name = document.createElement("span");
      name.className = "image-name";
      name.textContent = image.original_filename;
      name.title = image.original_filename;
      const source = document.createElement("span");
      source.className = "image-source";
      source.textContent = `${t("source")} · ${t("dimensions", { width: image.width, height: image.height })}`;

      const selections = document.createElement("div");
      selections.className = "image-selections";
      for (const [action, selection, label] of [
        ["select-chat-image", entry.chat, t("chat")],
        ["select-note-image", entry.note, t("note")]
      ]) {
        const wrapper = document.createElement("label");
        wrapper.className = "image-selection";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.action = action;
        checkbox.dataset.imageId = image.id;
        checkbox.checked = selection.has(image.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selection.add(image.id);
          else selection.delete(image.id);
          if (action === "select-note-image") adapter.invalidateDraftRequest(paper.id);
          adapter.contextChanged();
        });
        const text = document.createElement("span");
        text.textContent = label;
        wrapper.append(checkbox, text);
        selections.append(wrapper);
      }

      const download = document.createElement("a");
      download.className = "image-download";
      download.href = imageUrl(paper.id, image.id, "file");
      download.download = image.original_filename;
      download.textContent = t("download");
      const actions = document.createElement("div");
      actions.className = "note-excerpt-actions";
      actions.append(viewButton(paper.id, image.id), download);
      body.append(name, source, selections, actions);
      item.append(preview, body);
      elements.list.append(item);
    }

    if (!entry.items.length && entry.loaded) {
      const empty = document.createElement("li");
      empty.className = "images-empty";
      empty.textContent = t("empty");
      elements.list.append(empty);
    }
  }

  async function load(documentId) {
    const entry = entryFor(documentId);
    const sequence = ++entry.sequence;
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/images`, { signal: controller.signal });
      if (sequence !== entry.sequence) return;
      entry.items = Array.isArray(body.items) ? body.items : [];
      entry.loaded = true;
      const ids = new Set(entry.items.map((image) => image.id));
      entry.chat = new Set([...entry.chat].filter((id) => ids.has(id)));
      entry.note = new Set([...entry.note].filter((id) => ids.has(id)));
      if (entry.status?.key === "loadFailed") entry.status = null;
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== entry.sequence) return;
      entry.status = { key: error.code === "network" ? "network" : "loadFailed", kind: "error" };
    } finally {
      if (sequence === entry.sequence) {
        entry.controller = null;
        render();
        adapter.notesChanged();
        adapter.contextChanged();
      }
    }
  }

  function validate(file) {
    const extension = file.name.toLowerCase().split(".").pop();
    const allowedType = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    const allowedExtension = ["png", "jpg", "jpeg", "webp"].includes(extension);
    if ((!file.type && !allowedExtension) || (file.type && !allowedType && !allowedExtension)) return "invalidType";
    if (file.size > MAX_IMAGE_BYTES) return "file_too_large";
    return null;
  }

  async function upload(documentId) {
    const entry = entryFor(documentId);
    const operation = entry.upload;
    if (!operation || operation.pending) return;
    operation.pending = true;
    entry.status = { key: "uploading", kind: "info" };
    render();
    const form = new FormData();
    form.append("file", operation.file, operation.file.name);
    form.append("request_id", operation.requestId);
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}/images`, { method: "POST", body: form });
      if (![200, 201].includes(response.status)) throw new Error("Unexpected upload response");
      const image = await response.json();
      entry.items = [image, ...entry.items.filter((item) => item.id !== image.id)];
      entry.loaded = true;
      entry.upload = null;
      entry.status = { key: "uploaded", kind: "success" };
    } catch (error) {
      operation.pending = false;
      entry.status = {
        key: error.code || "request_failed",
        kind: "error",
        retry: { paperId: documentId }
      };
    }
    render();
    adapter.notesChanged();
    adapter.contextChanged();
  }

  elements.button.addEventListener("click", () => {
    if (!elements.button.disabled) elements.input.click();
  });
  elements.input.addEventListener("change", () => {
    const file = elements.input.files?.[0];
    elements.input.value = "";
    const { paper, entry } = current();
    if (!file || !paper) return;
    const invalid = validate(file);
    if (invalid) {
      entry.upload = null;
      entry.status = { key: invalid, kind: "error" };
      render();
      return;
    }
    entry.upload = { file, requestId: crypto.randomUUID(), pending: false };
    upload(paper.id);
  });

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.summary.textContent = t("library");
      elements.help.textContent = t("help");
      elements.button.textContent = t("upload");
      render();
    },
    documentChanged(document) {
      if (!document) {
        render();
        return;
      }
      render();
      load(document.id);
    },
    reload(documentId) {
      return load(documentId);
    },
    getNoteSelection(documentId) {
      return [...entryFor(documentId).note];
    },
    getChatSelection(documentId) {
      return [...entryFor(documentId).chat];
    },
    getChatImages(documentId) {
      const entry = entryFor(documentId);
      return entry.items.filter((image) => entry.chat.has(image.id));
    },
    getImages(documentId, imageIds) {
      const images = new Map(entryFor(documentId).items.map((image) => [image.id, image]));
      return imageIds.map((imageId) => images.get(imageId)).filter(Boolean);
    },
    clearNoteSelection(documentId, imageIds) {
      const entry = entryFor(documentId);
      for (const imageId of imageIds) entry.note.delete(imageId);
      render();
      adapter.contextChanged();
    },
    appendNoteImages(container, note) {
      const paper = adapter.getDocument();
      if (!paper || paper.id !== note.document_id) return;
      const linked = entryFor(paper.id).items.filter((image) => Array.isArray(image.note_ids) && image.note_ids.includes(note.id));
      if (!linked.length) return;
      const group = document.createElement("div");
      group.className = "note-uploaded-images";
      for (const image of linked) {
        const figure = document.createElement("figure");
        figure.className = "note-uploaded-image";
        figure.dataset.imageId = image.id;
        const preview = document.createElement("img");
        preview.src = imageUrl(paper.id, image.id, "preview");
        preview.alt = t("noteImageAlt", { name: image.original_filename });
        preview.loading = "lazy";
        const caption = document.createElement("figcaption");
        const name = document.createElement("span");
        name.textContent = `${image.original_filename} · ${t("source")}`;
        const download = document.createElement("a");
        download.href = imageUrl(paper.id, image.id, "file");
        download.download = image.original_filename;
        download.textContent = t("download");
        caption.append(name, viewButton(paper.id, image.id), download);
        figure.append(preview, caption);
        group.append(figure);
      }
      container.append(group);
    },
    render
  };
}
