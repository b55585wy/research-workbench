import { renderRichHtml } from "/rich-text.js";
import { createProjectResources } from "/project-resources.js";

const SOURCE_KINDS = new Set(["study", "dataset", "analysis", "chart"]);
const HEX_64 = /^[0-9a-f]{64}$/i;

const messages = {
  zh: {
    studies: "项目",
    personalData: "我的数据",
    sourcePersonal: "我的数据",
    emptyPersonalNotes: "“我的数据”还没有笔记。",
    newStudy: "新建研究",
    hideCreate: "收起新建研究",
    name: "研究名称",
    question: "研究问题",
    reviewCreate: "核对并创建",
    confirmCreate: "确认创建研究",
    cancel: "取消",
    review: "请核对创建内容。创建后，本版本不能修改名称或研究问题。",
    creating: "正在创建研究…",
    created: "研究已创建。",
    createValidation: "请填写研究名称和研究问题。",
    createRetry: "创建结果尚未确认。请使用原请求重试，不要重复创建。",
    studyList: "研究列表",
    noStudies: "还没有研究。",
    untitled: "未命名研究",
    overview: "研究",
    papers: "关联论文",
    papersHelp: "关联只用于汇集论文，不会移动研究数据或笔记，也不会自动向助手提供论文内容。",
    paperSelect: "选择要关联的论文",
    noPaperOptions: "没有可关联的论文",
    linkPaper: "关联论文",
    linkingPaper: "正在关联论文…",
    linkedPaper: "论文已关联。",
    noPapers: "尚未关联论文。",
    openPaper: "打开论文",
    unlinkPaper: "取消关联",
    unlinkingPaper: "正在取消关联…",
    unlinkedPaper: "已取消关联，原论文仍保留在文库中。",
    papersLoadFailed: "无法加载关联论文。",
    personal_workspace_not_project: "“我的数据”不是项目，不能关联论文。可按需使用项目汇集论文；不创建项目也能分析数据。",
    paper_quota: "每个项目最多关联 20 篇论文。请先取消不再需要的关联。",
    invalid_paper: "请选择文库中有效的论文。",
    file_missing: "论文文件已缺失，无法关联。",
    document_trashed: "论文已在回收站中，请先恢复再关联。",
    document_purged: "论文已彻底删除，无法关联。",
    study_changed: "项目已变化，请重新加载后再关联论文。",
    loading: "正在加载…",
    retry: "重试",
    noteSource: "笔记来源",
    noteText: "笔记内容",
    notePlaceholder: "记录研究问题、数据或结果…",
    saveNote: "保存笔记",
    retrySave: "按原请求重试",
    saving: "正在保存笔记…",
    saved: "笔记已保存。",
    saveFailed: "保存结果尚未确认。笔记、来源和原请求已保留。",
    sourceStudy: "研究问题",
    sourceDataset: "当前数据",
    sourceAnalysis: "已保存分析",
    sourceChart: "已保存图表",
    sourceUnavailable: "来源不可用",
    sourceDetails: "来源标识与 SHA-256",
    citationUnavailable: "该结果的来源哈希尚不可用，未加入笔记。",
    editMode: "编辑已保存笔记 · 来源保持不变",
    editFormatted: "以纯文本保存将移除此笔记的现有格式。",
    cancelEdit: "取消编辑",
    saveEdit: "保存修改",
    retryEdit: "重试保存修改",
    editSaving: "正在保存笔记修改…",
    editSaved: "笔记修改已保存。",
    revisionConflict: "这条笔记已在其他地方更新。草稿已保留，请重新加载后再编辑。",
    viewLatest: "查看最新",
    savedNotes: "已保存笔记",
    emptyNotes: "这项研究还没有笔记。",
    reviewExplainer: "“已核对来源”仅表示你检查了来源，不代表身份认证或科学验证。",
    reviewUnreviewed: "待核对",
    reviewChecked: "已核对来源",
    markChecked: "标记已核对",
    markUnchecked: "改为待核对",
    reviewSaving: "正在保存核对状态…",
    reviewSaved: "已记录你核对了来源。",
    reviewUnmarked: "已改为待核对。",
    editNote: "编辑",
    deleteNote: "删除",
    restoreNote: "恢复",
    deleteConfirm: "删除这条笔记？之后可以在“已删除笔记”中恢复。",
    deleting: "正在删除笔记…",
    deleted: "笔记已删除，可随时恢复。",
    restoring: "正在恢复笔记…",
    restored: "笔记已恢复。",
    deletedNotes: "已删除笔记",
    deletedNotesHelp: "已删除笔记可恢复到原来的来源。",
    deletedNoteRecovery: "这条笔记已删除，可在“已删除笔记”中恢复。",
    unknownNote: "这条笔记不存在或已被删除。",
    purgeNote: "彻底删除",
    purgeConfirm: "彻底删除正文和图片摘录，无法恢复；已导出文件、备份和历史对话不受影响。",
    purging: "正在彻底删除笔记…",
    purged: "笔记正文和图片摘录已彻底删除，无法恢复。",
    purgeStorageUnavailable: "笔记内容已不可访问，但文件清理失败。请使用原请求重试完成清理。",
    notePurgedSource: "这条笔记的正文和图片摘录已彻底删除，无法恢复。",
    note_not_deleted: "只有已删除笔记才能彻底删除。",
    note_purged: "这条笔记已彻底删除，无法恢复。",
    request_failed: "操作未完成，请重试。",
    network: "无法连接本地服务。请检查服务后重试。",
    validation_error: "提交的内容无效，请检查后重试。",
    idempotency_conflict: "保存请求发生冲突，请检查后重试。",
    revision_conflict: "这条笔记已在其他地方更新。",
    source_changed: "来源已变化，请重新选择后再保存。",
    storage_unavailable: "本地存储暂时不可用，请稍后重试。",
    not_found: "请求的内容不存在或已被删除。"
  },
  en: {
    studies: "Projects",
    personalData: "My data",
    sourcePersonal: "My data",
    emptyPersonalNotes: "My data has no notes yet.",
    newStudy: "New research",
    hideCreate: "Close new research",
    name: "Research name",
    question: "Research question",
    reviewCreate: "Review and create",
    confirmCreate: "Confirm new research",
    cancel: "Cancel",
    review: "Review the details. The name and research question cannot be edited in this version after creation.",
    creating: "Creating research…",
    created: "Research created.",
    createValidation: "Enter a research name and research question.",
    createRetry: "Creation is unconfirmed. Retry the original request; do not create another research entry.",
    studyList: "Research list",
    noStudies: "No research yet.",
    untitled: "Untitled research",
    overview: "Research",
    papers: "Associated papers",
    papersHelp: "Association only collects papers. It does not move research data or notes, or automatically share paper content with the assistant.",
    paperSelect: "Choose a paper to associate",
    noPaperOptions: "No papers available to associate",
    linkPaper: "Associate paper",
    linkingPaper: "Associating paper…",
    linkedPaper: "Paper associated.",
    noPapers: "No associated papers yet.",
    openPaper: "Open paper",
    unlinkPaper: "Unlink",
    unlinkingPaper: "Unlinking paper…",
    unlinkedPaper: "Paper unlinked. The original remains in the library.",
    papersLoadFailed: "Associated papers could not be loaded.",
    personal_workspace_not_project: "My data is not a project and cannot associate papers. Use an optional project to organize papers; you do not need to create one to analyze data.",
    paper_quota: "A project can associate up to 20 papers. Unlink papers you no longer need first.",
    invalid_paper: "Choose a valid paper from the library.",
    file_missing: "The paper file is missing, so it cannot be associated.",
    document_trashed: "The paper is in trash. Restore it before associating it.",
    document_purged: "The paper was permanently deleted and cannot be associated.",
    study_changed: "The project changed. Reload it before changing paper associations.",
    loading: "Loading…",
    retry: "Retry",
    noteSource: "Note source",
    noteText: "Note",
    notePlaceholder: "Record the research question, data, or results…",
    saveNote: "Save note",
    retrySave: "Retry original request",
    saving: "Saving note…",
    saved: "Note saved.",
    saveFailed: "Saving is unconfirmed. The note, source, and original request are preserved.",
    sourceStudy: "Research question",
    sourceDataset: "Current data",
    sourceAnalysis: "Saved analysis",
    sourceChart: "Saved chart",
    sourceUnavailable: "Source unavailable",
    sourceDetails: "Source ID and SHA-256",
    citationUnavailable: "The result source hash is unavailable, so nothing was added to the note.",
    editMode: "Editing a saved note · source stays unchanged",
    editFormatted: "Saving as plain text will remove this note’s existing formatting.",
    cancelEdit: "Cancel edit",
    saveEdit: "Save changes",
    retryEdit: "Retry saving changes",
    editSaving: "Saving note changes…",
    editSaved: "Note changes saved.",
    revisionConflict: "This note changed elsewhere. The draft is preserved; reload it before editing again.",
    viewLatest: "View latest",
    savedNotes: "Saved notes",
    emptyNotes: "This research has no notes yet.",
    reviewExplainer: "“Source checked” records only that you checked the source; it is not authenticated review or scientific validation.",
    reviewUnreviewed: "Needs checking",
    reviewChecked: "Source checked",
    markChecked: "Mark source checked",
    markUnchecked: "Mark needs checking",
    reviewSaving: "Saving review status…",
    reviewSaved: "Your source check was recorded.",
    reviewUnmarked: "Marked as needing checking.",
    editNote: "Edit",
    deleteNote: "Delete",
    restoreNote: "Restore",
    deleteConfirm: "Delete this note? You can restore it later from “Deleted notes”.",
    deleting: "Deleting note…",
    deleted: "Note deleted. You can restore it later.",
    restoring: "Restoring note…",
    restored: "Note restored.",
    deletedNotes: "Deleted notes",
    deletedNotesHelp: "Restore a deleted note to its original source.",
    deletedNoteRecovery: "This note is deleted. Restore it from “Deleted notes”.",
    unknownNote: "This note does not exist or was deleted.",
    purgeNote: "Delete permanently",
    purgeConfirm: "Permanently delete the note body and image excerpt; this cannot be undone. Exported files, backups, and past conversations are not affected.",
    purging: "Permanently deleting note…",
    purged: "The note body and image excerpt were permanently deleted and cannot be recovered.",
    purgeStorageUnavailable: "The note content is no longer accessible, but file cleanup failed. Retry the original request to finish cleanup.",
    notePurgedSource: "This note’s body and image excerpt were permanently deleted and cannot be recovered.",
    note_not_deleted: "Only a deleted note can be permanently deleted.",
    note_purged: "This note was permanently deleted and cannot be recovered.",
    request_failed: "The action could not be completed. Try again.",
    network: "Cannot connect to the local service. Check it and retry.",
    validation_error: "The submitted content is invalid. Check it and retry.",
    idempotency_conflict: "The save request conflicted with another request. Check it and retry.",
    revision_conflict: "This note changed elsewhere.",
    source_changed: "The source changed. Select it again before saving.",
    storage_unavailable: "Local storage is temporarily unavailable. Try again shortly.",
    not_found: "The requested content does not exist or was deleted."
  }
};

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function validSource(source) {
  return Boolean(source && SOURCE_KINDS.has(source.kind) && typeof source.id === "string" && HEX_64.test(source.sha256 || ""));
}

function copySource(source) {
  return validSource(source) ? { kind: source.kind, id: source.id, sha256: source.sha256 } : null;
}

export function createStudy(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    main: document.querySelector(".workspace"),
    newButton: byId("study-new"),
    createForm: byId("study-create-form"),
    name: byId("study-name"),
    question: byId("study-question"),
    review: byId("study-create-review"),
    create: byId("study-create"),
    createCancel: byId("study-create-cancel"),
    createStatus: byId("study-create-status"),
    list: byId("study-list"),
    listEmpty: byId("study-list-empty"),
    view: byId("study-view"),
    viewTitle: byId("study-view-title"),
    viewQuestion: byId("study-view-question"),
    papersDetails: byId("study-papers-details"),
    papersCount: byId("study-papers-count"),
    papers: byId("study-papers"),
    paperSelect: byId("study-paper-select"),
    paperLink: byId("study-paper-link"),
    papersStatus: byId("study-papers-status"),
    noteForm: byId("study-note-form"),
    noteEditLabel: byId("study-note-edit-label"),
    noteSource: byId("study-note-source"),
    noteSourceDetails: byId("study-note-source-details"),
    noteSourceDetail: byId("study-note-source-detail"),
    noteText: byId("study-note-text"),
    noteCount: byId("study-note-character-count"),
    noteSave: byId("study-note-save"),
    noteEditCancel: byId("study-note-edit-cancel"),
    noteStatus: byId("study-note-status"),
    notesHeading: byId("study-notes-heading"),
    notesCount: byId("study-notes-count"),
    reviewExplainer: byId("study-review-explainer"),
    notesEmpty: byId("study-notes-empty"),
    notesList: byId("study-notes-list"),
    deletedNotes: byId("study-deleted-notes"),
    deletedNotesCount: byId("study-deleted-notes-count"),
    deletedNotesList: byId("study-deleted-notes-list")
  };
  let language = adapter.getLanguage();
  let studies = [];
  let currentId = null;
  let sequence = 0;
  let noteNavigationSequence = 0;
  let createReviewed = false;
  let createOperation = null;
  let createStatus = null;
  const entries = new Map();
  const projectResources = createProjectResources(adapter);

  function t(key, values = {}) {
    let text = messages[language]?.[key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function currentDocument() {
    const owner = adapter.getDocument();
    return owner?.kind === "study" ? owner : null;
  }

  function isPersonal(owner = currentDocument()) {
    return owner?.kind === "study" && owner?.workspace_role === "personal_analysis";
  }

  function entryFor(studyId) {
    if (!entries.has(studyId)) {
      entries.set(studyId, {
        draft: null,
        edit: null,
        notePending: false,
        noteStatus: null,
        mutations: new Map(),
        failedMutations: new Map(),
        papers: [],
        papersLoaded: false,
        papersPending: false,
        papersStatus: null,
        papersOpen: false,
        paperOperation: null,
        draftSourceOpen: false,
        noteSourcesOpen: new Map(),
        selectedPaperId: ""
      });
    }
    return entries.get(studyId);
  }

  function defaultSource(owner) {
    return copySource({ kind: "study", id: owner.id, sha256: owner.scope_sha256 });
  }

  function ensureDraft(owner) {
    const entry = entryFor(owner.id);
    if (!entry.draft) {
      entry.draft = { text: "", source: defaultSource(owner), operation: null, saveFailed: false };
    }
    return entry.draft;
  }

  function captureCurrentDraft() {
    const owner = currentDocument();
    if (!owner) return;
    const entry = entryFor(owner.id);
    if (entry.edit) {
      if (!entry.mutations.has(entry.edit.noteId)) entry.edit.text = elements.noteText.value;
    } else if (!entry.notePending) {
      ensureDraft(owner).text = elements.noteText.value;
    }
  }

  function statusInto(container, status) {
    container.replaceChildren();
    if (!status) {
      container.removeAttribute("data-kind");
      return;
    }
    container.dataset.kind = status.kind || "info";
    container.append(make("span", "", t(status.key, status.values || {})));
    if (status.retry) {
      const retry = make("button", "button button-quiet", t(status.retryLabel || "retry"));
      retry.type = "button";
      retry.addEventListener("click", status.retry);
      container.append(retry);
    }
  }

  function setNoteStatus(entry, status) {
    entry.noteStatus = status;
    if (currentId && entries.get(currentId) === entry) statusInto(elements.noteStatus, status);
  }

  function errorKey(error) {
    return Object.hasOwn(messages.en, error?.code) ? error.code : "request_failed";
  }

  function renderCreate() {
    elements.newButton.textContent = t(elements.createForm.hidden ? "newStudy" : "hideCreate");
    elements.newButton.setAttribute("aria-expanded", String(!elements.createForm.hidden));
    elements.createForm.querySelector('label[for="study-name"]').textContent = t("name");
    elements.createForm.querySelector('label[for="study-question"]').textContent = t("question");
    elements.createCancel.textContent = t("cancel");
    elements.create.textContent = t(createOperation || createReviewed ? "confirmCreate" : "reviewCreate");
    if (createOperation?.pending) elements.create.textContent = t("creating");
    elements.name.disabled = Boolean(createOperation?.pending);
    elements.question.disabled = Boolean(createOperation?.pending);
    elements.createCancel.disabled = Boolean(createOperation?.pending);
    elements.create.disabled = Boolean(createOperation?.pending);
    elements.review.hidden = !createReviewed;
    if (createReviewed) {
      elements.review.replaceChildren(
        make("strong", "", t("review")),
        make("span", "", `${t("name")}: ${createOperation?.body.name || elements.name.value.trim()}\n${t("question")}: ${createOperation?.body.question || elements.question.value.trim()}`)
      );
    } else {
      elements.review.replaceChildren();
    }
    statusInto(elements.createStatus, createStatus);
  }

  function renderList() {
    elements.list.replaceChildren();
    elements.list.setAttribute("aria-label", t("studyList"));
    elements.listEmpty.textContent = t("noStudies");
    elements.listEmpty.hidden = studies.length > 0;
    for (const study of studies) {
      const item = make("li", "document-item study-item");
      item.dataset.studyId = study.id;
      item.dataset.active = String(currentId === study.id);
      const open = make("button", "document-open");
      open.type = "button";
      open.addEventListener("click", () => adapter.openDocument(study.id, { ownerKind: "study" }));
      open.append(
        make("span", "document-name", study.name || study.title || t("untitled")),
        make("span", "document-meta", study.question || "")
      );
      item.append(open);
      elements.list.append(item);
    }
  }

  function sourceName(source) {
    if (source?.kind === "study" && isPersonal()) return t("sourcePersonal");
    return t(source?.kind === "dataset" ? "sourceDataset" : source?.kind === "analysis" ? "sourceAnalysis" : source?.kind === "chart" ? "sourceChart" : source?.kind === "study" ? "sourceStudy" : "sourceUnavailable");
  }

  function sourceDetail(source) {
    return validSource(source) ? `${sourceName(source)} · ${source.id}\nSHA-256 ${source.sha256}` : t("sourceUnavailable");
  }

  function renderSourceOptions(owner, draft) {
    const selected = draft.source?.kind || "study";
    const options = [];
    if (validSource(defaultSource(owner))) options.push({ value: "study", label: sourceName(defaultSource(owner)), source: defaultSource(owner) });
    const dataset = adapter.getSelectedDataset?.();
    if (draft.source?.kind === "dataset" && validSource(draft.source)) {
      options.push({ value: "dataset", label: t("sourceDataset"), source: draft.source });
    } else if (dataset?.id && HEX_64.test(dataset.sha256 || "")) {
      options.push({ value: "dataset", label: `${t("sourceDataset")} · ${dataset.name || dataset.id}`, source: { kind: "dataset", id: dataset.id, sha256: dataset.sha256 } });
    }
    if (["analysis", "chart"].includes(draft.source?.kind) && validSource(draft.source)) {
      options.push({ value: draft.source.kind, label: sourceName(draft.source), source: draft.source });
    }
    elements.noteSource.replaceChildren();
    for (const option of options) {
      const node = make("option", "", option.label);
      node.value = option.value;
      elements.noteSource.append(node);
    }
    elements.noteSource.value = options.some((option) => option.value === selected) ? selected : "study";
    elements.noteSourceDetail.textContent = sourceDetail(draft.source);
  }

  function renderDraft() {
    const owner = currentDocument();
    elements.noteForm.hidden = !owner;
    if (!owner) return;
    const entry = entryFor(owner.id);
    elements.noteSourceDetails.open = entry.draftSourceOpen;
    const draft = ensureDraft(owner);
    const edit = entry.edit;
    const active = edit || draft;
    const pending = entry.notePending || Boolean(edit && entry.mutations.has(edit.noteId));
    if (elements.noteText.value !== active.text) elements.noteText.value = active.text;
    elements.noteText.placeholder = t("notePlaceholder");
    elements.noteText.disabled = pending;
    elements.noteCount.textContent = `${active.text.length} / 10000`;
    elements.noteEditLabel.hidden = !edit;
    elements.noteEditLabel.textContent = t(edit?.note?.rich_content ? "editFormatted" : "editMode");
    elements.noteEditCancel.hidden = !edit;
    elements.noteEditCancel.disabled = pending;
    elements.noteEditCancel.textContent = t("cancelEdit");
    elements.noteSource.disabled = Boolean(edit) || pending;
    elements.noteForm.querySelector('label[for="study-note-source"]').textContent = t("noteSource");
    elements.noteForm.querySelector('label[for="study-note-text"]').textContent = t("noteText");
    if (edit) {
      elements.noteSource.replaceChildren(make("option", "", sourceName(edit.note.source)));
      elements.noteSourceDetail.textContent = sourceDetail(edit.note.source);
    } else {
      renderSourceOptions(owner, draft);
    }
    elements.noteSave.disabled = pending || entry.mutations.size > 0 || !active.text.trim() || !validSource(edit?.note.source || draft.source);
    elements.noteSave.textContent = t(edit ? (edit.saveFailed ? "retryEdit" : "saveEdit") : (draft.saveFailed ? "retrySave" : "saveNote"));
    statusInto(elements.noteStatus, entry.noteStatus);
  }

  function appendRichBody(container, note, noteState) {
    if (!noteState?.rich_content || typeof noteState.rich_html !== "string") return false;
    const body = make("div", "note-rich-content");
    container.append(body);
    void renderRichHtml(body, { html: noteState.rich_html, text: note.text, language });
    return true;
  }

  function noteSource(note, owner) {
    return copySource(note?.source) || null;
  }

  function navigateNoteSource(owner, note) {
    const source = noteSource(note, owner);
    if (!source) return;
    adapter.openStudySource(owner.id, source);
  }

  function actionButton(action, label, handler, disabled = false) {
    const button = make("button", "button button-quiet", label);
    button.type = "button";
    button.dataset.action = action;
    button.disabled = disabled;
    button.addEventListener("click", handler);
    return button;
  }

  function renderNoteItem(note, owner, entry, deleted = false) {
    const noteState = adapter.getNoteStates().find((item) => item.id === note.id) || note;
    const item = make("li", deleted ? "deleted-note-item" : "note-item");
    item.dataset.noteId = note.id;
    const source = noteSource(note, owner);
    const open = make("button", "study-note-open-source");
    open.type = "button";
    open.disabled = !source;
    open.addEventListener("click", () => navigateNoteSource(owner, note));
    open.append(make("span", "note-source", sourceName(source)));
    item.append(open);
    const sourceDetails = make("details", "study-note-source-details");
    sourceDetails.open = entry.noteSourcesOpen.get(note.id) === true;
    sourceDetails.append(
      make("summary", "", t("sourceDetails")),
      make("span", "study-note-source-hash", validSource(source) ? `${source.id}\nSHA-256 ${source.sha256}` : t("sourceUnavailable"))
    );
    sourceDetails.addEventListener("toggle", () => entry.noteSourcesOpen.set(note.id, sourceDetails.open));
    item.append(sourceDetails);
    const textButton = make("button", "note-open");
    textButton.type = "button";
    textButton.disabled = !source;
    textButton.addEventListener("click", () => navigateNoteSource(owner, note));
    if (!appendRichBody(item, note, noteState)) textButton.append(make("span", "note-text-preview", note.text));
    if (textButton.children.length) item.append(textButton);
    if (deleted) {
      const disabled = entry.notePending || entry.mutations.size > 0;
      const failed = entry.failedMutations.get(note.id);
      const actions = make("div", "note-actions");
      actions.append(
        actionButton("restore-note", t("restoreNote"), () => restoreNote(owner, note), disabled),
        actionButton("purge-note", t(failed?.action === "purge" ? "retry" : "purgeNote"), () => purgeNote(owner, note), disabled)
      );
      item.append(actions);
      return item;
    }
    const reviewStatus = noteState.review_status || "unreviewed";
    const reviewRow = make("div", "note-review-row");
    const badge = make("span", "review-badge", t(reviewStatus === "source_checked" ? "reviewChecked" : "reviewUnreviewed"));
    badge.dataset.status = reviewStatus;
    reviewRow.append(badge);
    item.append(reviewRow);
    const locked = entry.notePending || entry.mutations.size > 0 || Boolean(entry.edit);
    const actions = make("div", "note-actions");
    actions.append(
      actionButton("edit-note", t("editNote"), () => startEdit(owner, note), locked || !noteState.revision),
      actionButton("review-note", t(reviewStatus === "source_checked" ? "markUnchecked" : "markChecked"), () => reviewNote(owner, note), locked || !noteState.revision),
      actionButton("delete-note", t("deleteNote"), () => deleteNote(owner, note), locked || !noteState.revision)
    );
    item.append(actions);
    return item;
  }

  function renderNotes() {
    const owner = currentDocument();
    for (const node of [elements.notesHeading, elements.reviewExplainer, elements.notesEmpty, elements.notesList]) node.hidden = !owner;
    elements.deletedNotes.hidden = true;
    if (!owner) {
      elements.notesList.replaceChildren();
      elements.deletedNotesList.replaceChildren();
      return;
    }
    const entry = entryFor(owner.id);
    const notes = adapter.getNotes();
    const states = adapter.getNoteStates();
    elements.notesHeading.querySelector("h3").textContent = t("savedNotes");
    elements.notesCount.textContent = notes.length ? String(notes.length) : "";
    elements.reviewExplainer.textContent = t("reviewExplainer");
    elements.notesEmpty.textContent = t(isPersonal(owner) ? "emptyPersonalNotes" : "emptyNotes");
    elements.notesEmpty.hidden = notes.length > 0;
    elements.notesList.replaceChildren();
    for (const note of notes) elements.notesList.append(renderNoteItem(note, owner, entry));
    const deleted = states.filter((note) => note.deleted_at && !note.purged);
    elements.deletedNotes.hidden = !deleted.length;
    elements.deletedNotesCount.textContent = deleted.length ? String(deleted.length) : "";
    elements.deletedNotesList.replaceChildren();
    for (const note of deleted) elements.deletedNotesList.append(renderNoteItem(note, owner, entry, true));
    elements.deletedNotes.querySelector("summary > span:first-child").textContent = t("deletedNotes");
    elements.deletedNotes.querySelector(".deleted-notes-help").textContent = t("deletedNotesHelp");
  }

  function renderPapers() {
    const owner = currentDocument();
    if (!owner) return;
    const entry = entryFor(owner.id);
    elements.papersDetails.open = entry.papersOpen;
    elements.papersCount.textContent = String(entry.papers.length);
    elements.papers.replaceChildren();
    const documents = adapter.getDocuments().filter((paper) => paper.kind !== "study");
    const linkedIds = new Set(entry.papers.map((paper) => paper.id));
    const available = documents.filter((paper) => !linkedIds.has(paper.id));
    elements.paperSelect.replaceChildren();
    if (!available.length) elements.paperSelect.append(make("option", "", t("noPaperOptions")));
    for (const paper of available) {
      const option = make("option", "", paper.title || paper.original_filename || paper.id);
      option.value = paper.id;
      elements.paperSelect.append(option);
    }
    if (available.some((paper) => paper.id === entry.selectedPaperId)) elements.paperSelect.value = entry.selectedPaperId;
    entry.selectedPaperId = elements.paperSelect.value || "";
    elements.paperSelect.disabled = entry.papersPending || !available.length;
    elements.paperLink.disabled = entry.papersPending || !entry.selectedPaperId;
    elements.paperLink.textContent = t("linkPaper");
    if (!entry.papersLoaded && !entry.papersPending) elements.papers.append(make("li", "study-list-empty", t("loading")));
    else if (!entry.papers.length) elements.papers.append(make("li", "study-list-empty", t("noPapers")));
    for (const paper of entry.papers) {
      const item = make("li", "study-paper-item");
      item.dataset.paperId = paper.id;
      const open = make("button", "study-paper-open");
      open.type = "button";
      open.addEventListener("click", () => adapter.openDocument(paper.id));
      open.append(
        make("span", "study-paper-title", paper.title || paper.original_filename || paper.id),
        make("span", "study-paper-meta", [paper.authors, paper.year, paper.page_count ? `${paper.page_count}` : null].filter(Boolean).join(" · "))
      );
      const actions = make("div", "study-paper-actions");
      actions.append(
        actionButton("open-study-paper", t("openPaper"), () => adapter.openDocument(paper.id)),
        actionButton("unlink-study-paper", t("unlinkPaper"), () => unlinkPaper(owner, paper), entry.papersPending)
      );
      item.append(open, actions);
      elements.papers.append(item);
    }
    statusInto(elements.papersStatus, entry.papersStatus);
  }

  function renderDocument() {
    const owner = currentDocument();
    const personal = isPersonal(owner);
    elements.main.dataset.ownerKind = personal ? "personal" : owner ? "study" : adapter.getDocument() ? "paper" : "none";
    elements.view.hidden = !owner || personal;
    elements.papersDetails.hidden = !owner || personal;
    if (!owner || personal) {
      elements.paperSelect.disabled = true;
      elements.paperLink.disabled = true;
      for (const button of elements.papers.querySelectorAll("button")) button.disabled = true;
    }
    if (owner && !personal) {
      elements.viewTitle.textContent = owner.name || owner.title || t("untitled");
      elements.viewQuestion.textContent = owner.question || "";
    } else {
      elements.viewTitle.textContent = "";
      elements.viewQuestion.textContent = "";
    }
    renderList();
    renderDraft();
    renderNotes();
    if (owner && !personal) renderPapers();
  }

  async function loadPapers(owner) {
    if (!owner || isPersonal(owner) || isPersonal() || currentDocument()?.id !== owner.id) return;
    const entry = entryFor(owner.id);
    if (entry.papersPending) return;
    entry.papersPending = true;
    entry.papersStatus = null;
    const requestSequence = sequence;
    if (currentId === owner.id) renderPapers();
    try {
      const body = await adapter.api(`/api/v1/studies/${encodeURIComponent(owner.id)}/papers`);
      entry.papers = Array.isArray(body.items) ? body.items.filter((paper) => paper.kind !== "study") : [];
      entry.papersLoaded = true;
      entry.papersStatus = null;
    } catch (error) {
      entry.papersStatus = { key: errorKey(error) === "request_failed" ? "papersLoadFailed" : errorKey(error), kind: "error", retry: () => loadPapers(owner) };
    } finally {
      entry.papersPending = false;
      if (requestSequence === sequence && currentId === owner.id && !isPersonal()) renderPapers();
    }
  }

  async function linkPaper(operation = null) {
    if (!operation) {
      const owner = currentDocument();
      if (!owner || isPersonal(owner)) return;
      const entry = entryFor(owner.id);
      const paper = adapter.getDocuments().find((item) => item.id === entry.selectedPaperId && item.kind !== "study");
      if (!paper?.sha256 || entry.papersPending) return;
      operation = { owner, entry, paperId: paper.id, sha256: paper.sha256 };
      entry.paperOperation = operation;
    }
    const { owner, entry, paperId, sha256 } = operation;
    if (entry.paperOperation !== operation || entry.papersPending || isPersonal(owner) || isPersonal() || currentDocument()?.id !== owner.id) return;
    entry.papersPending = true;
    entry.papersStatus = { key: "linkingPaper", kind: "info" };
    renderPapers();
    try {
      const linked = await adapter.api(`/api/v1/studies/${encodeURIComponent(owner.id)}/papers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: paperId, sha256 })
      });
      if (linked?.id !== paperId || linked?.sha256 !== sha256) {
        const error = new Error("request_failed");
        error.code = "request_failed";
        throw error;
      }
      entry.papers = [linked, ...entry.papers.filter((item) => item.id !== linked.id)];
      entry.papersLoaded = true;
      if (entry.selectedPaperId === paperId) entry.selectedPaperId = "";
      entry.paperOperation = null;
      entry.papersStatus = { key: "linkedPaper", kind: "success" };
    } catch (error) {
      entry.papersStatus = { key: errorKey(error), kind: "error", retry: () => linkPaper(operation) };
    } finally {
      entry.papersPending = false;
      if (currentId === owner.id && !isPersonal()) renderPapers();
    }
  }

  async function unlinkPaper(owner, paper) {
    const paperId = paper?.id;
    const sha256 = paper?.sha256;
    if (!owner || isPersonal(owner) || isPersonal() || currentDocument()?.id !== owner.id) return;
    const entry = entryFor(owner.id);
    if (entry.papersPending || !paperId || !sha256) return;
    entry.papersPending = true;
    entry.papersStatus = { key: "unlinkingPaper", kind: "info" };
    if (currentId === owner.id) renderPapers();
    try {
      await adapter.api(`/api/v1/studies/${encodeURIComponent(owner.id)}/papers/${encodeURIComponent(paperId)}?sha256=${encodeURIComponent(sha256)}`, { method: "DELETE" });
      entry.papers = entry.papers.filter((item) => item.id !== paperId);
      entry.papersStatus = { key: "unlinkedPaper", kind: "success" };
    } catch (error) {
      entry.papersStatus = { key: errorKey(error), kind: "error", retry: () => unlinkPaper(owner, { id: paperId, sha256 }) };
    } finally {
      entry.papersPending = false;
      if (currentId === owner.id && !isPersonal()) renderPapers();
    }
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (createOperation?.pending) return;
    if (!createOperation) {
      const name = elements.name.value.trim();
      const question = elements.question.value.trim();
      if (!name || !question) {
        createStatus = { key: "createValidation", kind: "error" };
        createReviewed = false;
        renderCreate();
        return;
      }
      if (!createReviewed) {
        createReviewed = true;
        createStatus = null;
        renderCreate();
        elements.create.focus();
        return;
      }
      createOperation = {
        navigationGeneration: adapter.getNavigationGeneration?.(),
        body: { request_id: crypto.randomUUID(), name, question },
        pending: false
      };
    }
    const operation = createOperation;
    operation.pending = true;
    createStatus = { key: "creating", kind: "info" };
    renderCreate();
    try {
      const study = await adapter.api("/api/v1/studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      studies = [study, ...studies.filter((item) => item.id !== study.id)];
      adapter.studyCreated(study);
      createOperation = null;
      createReviewed = false;
      createStatus = { key: "created", kind: "success" };
      elements.name.value = "";
      elements.question.value = "";
      elements.createForm.hidden = true;
      renderList();
      renderCreate();
      if ((adapter.getNavigationGeneration?.() ?? operation.navigationGeneration) === operation.navigationGeneration) {
        await adapter.openDocument(study.id, { ownerKind: "study" });
      }
    } catch (error) {
      operation.pending = false;
      createStatus = { key: error?.code === "network" ? "createRetry" : errorKey(error), kind: "error", retry: () => submitCreate(new Event("submit")) };
      renderCreate();
    }
  }

  async function submitNote(event) {
    event.preventDefault();
    const owner = currentDocument();
    if (!owner) return;
    captureCurrentDraft();
    const entry = entryFor(owner.id);
    if (entry.notePending || entry.mutations.size) return;
    if (entry.edit) {
      await submitEdit(owner, entry);
      return;
    }
    const draft = ensureDraft(owner);
    if (!draft.text.trim() || !validSource(draft.source)) return;
    if (!draft.operation) {
      draft.operation = {
        body: {
          request_id: crypto.randomUUID(),
          page: null,
          rect: null,
          text: draft.text.trim(),
          source: copySource(draft.source)
        }
      };
    }
    const operation = draft.operation;
    entry.notePending = true;
    draft.saveFailed = false;
    setNoteStatus(entry, { key: "saving", kind: "info" });
    renderDraft();
    renderNotes();
    try {
      const note = await adapter.api(`/api/v1/documents/${encodeURIComponent(owner.id)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      adapter.noteCreated(owner, note);
      if (entry.draft?.operation === operation) entry.draft = null;
      setNoteStatus(entry, { key: "saved", kind: "success" });
    } catch (error) {
      if (currentId === owner.id) byId("note-editor-group").open = true;
      if (entry.draft?.operation === operation) entry.draft.saveFailed = true;
      setNoteStatus(entry, { key: error?.code === "network" ? "saveFailed" : errorKey(error), kind: "error", retry: () => submitNote(new Event("submit")) });
    } finally {
      entry.notePending = false;
      if (currentId === owner.id) {
        renderDraft();
        renderNotes();
      }
    }
  }

  function startEdit(owner, note) {
    const entry = entryFor(owner.id);
    const noteState = adapter.getNoteStates().find((item) => item.id === note.id);
    if (!noteState || entry.notePending || entry.mutations.size || entry.edit) return;
    byId("note-editor-group").open = true;
    captureCurrentDraft();
    entry.edit = {
      noteId: note.id,
      note: { ...noteState, source: copySource(noteState.source) },
      text: noteState.text,
      expectedRevision: noteState.revision,
      operation: null,
      saveFailed: false
    };
    setNoteStatus(entry, null);
    renderDraft();
    renderNotes();
    elements.noteText.focus();
  }

  function cancelEdit() {
    const owner = currentDocument();
    if (!owner) return;
    const entry = entryFor(owner.id);
    if (!entry.edit || entry.mutations.has(entry.edit.noteId)) return;
    entry.edit = null;
    setNoteStatus(entry, null);
    renderDraft();
    renderNotes();
    elements.noteText.focus();
  }

  async function submitEdit(owner, entry) {
    const edit = entry.edit;
    if (!edit?.text.trim()) return;
    if (!edit.operation) {
      const body = { request_id: crypto.randomUUID(), expected_revision: edit.expectedRevision, text: edit.text.trim() };
      if (edit.note.rich_content) body.rich_content = null;
      edit.operation = {
        method: "PATCH",
        path: `/api/v1/documents/${encodeURIComponent(owner.id)}/notes/${encodeURIComponent(edit.noteId)}`,
        body,
        pendingStatus: "editSaving",
        successStatus: "editSaved",
        action: "edit"
      };
    }
    await runMutation(owner, edit.noteId, edit.operation);
  }

  function lifecycleOperation(owner, note, action) {
    const noteState = adapter.getNoteStates().find((item) => item.id === note.id);
    if (!noteState) return null;
    const base = `/api/v1/documents/${encodeURIComponent(owner.id)}/notes/${encodeURIComponent(note.id)}`;
    const change = action === "review" ? { review_status: noteState.review_status === "source_checked" ? "unreviewed" : "source_checked" } : {};
    return {
      method: action === "delete" ? "DELETE" : ["restore", "purge"].includes(action) ? "POST" : "PATCH",
      path: ["restore", "purge"].includes(action) ? `${base}/${action}` : base,
      body: { request_id: crypto.randomUUID(), expected_revision: noteState.revision, ...change },
      pendingStatus: action === "delete" ? "deleting" : action === "restore" ? "restoring" : action === "purge" ? "purging" : "reviewSaving",
      successStatus: action === "delete" ? "deleted" : action === "restore" ? "restored" : action === "purge" ? "purged" : noteState.review_status === "source_checked" ? "reviewUnmarked" : "reviewSaved",
      action
    };
  }

  async function reviewNote(owner, note) {
    const entry = entryFor(owner.id);
    if (entry.notePending || entry.mutations.size || entry.edit) return;
    const failed = entry.failedMutations.get(note.id);
    const operation = failed?.action === "review" ? failed : lifecycleOperation(owner, note, "review");
    if (operation) await runMutation(owner, note.id, operation);
  }

  async function deleteNote(owner, note) {
    const entry = entryFor(owner.id);
    if (entry.notePending || entry.mutations.size || entry.edit || !window.confirm(t("deleteConfirm"))) return;
    const failed = entry.failedMutations.get(note.id);
    const operation = failed?.action === "delete" ? failed : lifecycleOperation(owner, note, "delete");
    if (operation) await runMutation(owner, note.id, operation);
  }

  async function restoreNote(owner, note) {
    const entry = entryFor(owner.id);
    if (entry.notePending || entry.mutations.size || entry.edit) return;
    const failed = entry.failedMutations.get(note.id);
    const operation = failed?.action === "restore" ? failed : lifecycleOperation(owner, note, "restore");
    if (operation) await runMutation(owner, note.id, operation);
  }

  async function purgeNote(owner, note) {
    const entry = entryFor(owner.id);
    if (entry.notePending || entry.mutations.size || entry.edit) return;
    const failed = entry.failedMutations.get(note.id);
    if (failed?.action === "purge") {
      await runMutation(owner, note.id, failed);
      return;
    }
    if (!window.confirm(t("purgeConfirm"))) return;
    const operation = lifecycleOperation(owner, note, "purge");
    if (operation) await runMutation(owner, note.id, operation);
  }

  async function refreshLatest(owner) {
    const entry = entryFor(owner.id);
    try {
      await adapter.refreshNotes(owner);
      if (currentId === owner.id) {
        setNoteStatus(entry, null);
        renderDraft();
        renderNotes();
      }
    } catch (error) {
      setNoteStatus(entry, { key: errorKey(error), kind: "error", retry: () => refreshLatest(owner), retryLabel: "viewLatest" });
    }
  }

  async function runMutation(owner, noteId, operation) {
    const entry = entryFor(owner.id);
    if (entry.mutations.has(noteId)) return;
    entry.mutations.set(noteId, operation);
    entry.failedMutations.delete(noteId);
    setNoteStatus(entry, { key: operation.pendingStatus, kind: "info" });
    if (currentId === owner.id) {
      renderDraft();
      renderNotes();
    }
    try {
      const saved = await adapter.api(operation.path, {
        method: operation.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      if (operation.action === "purge") {
        if (saved?.purged !== true || saved.id !== noteId || saved.document_id !== owner.id) {
          const error = new Error("request_failed");
          error.code = "request_failed";
          throw error;
        }
        adapter.notePurged(owner, noteId);
      } else {
        adapter.noteStateChanged(owner, saved, operation.action);
      }
      if (operation.action === "edit" && entry.edit?.operation === operation) entry.edit = null;
      setNoteStatus(entry, { key: operation.successStatus, kind: "success" });
    } catch (error) {
      if (operation.action === "edit" && currentId === owner.id) byId("note-editor-group").open = true;
      if (operation.action === "edit" && entry.edit?.operation === operation) entry.edit.saveFailed = true;
      else entry.failedMutations.set(noteId, operation);
      setNoteStatus(entry, {
        key: error?.code === "revision_conflict" ? "revisionConflict" : operation.action === "purge" && error?.code === "storage_unavailable" ? "purgeStorageUnavailable" : errorKey(error),
        kind: "error",
        retry: error?.code === "revision_conflict" ? () => refreshLatest(owner) : () => runMutation(owner, noteId, operation),
        retryLabel: error?.code === "revision_conflict" ? "viewLatest" : "retry"
      });
    } finally {
      entry.mutations.delete(noteId);
      if (currentId === owner.id) {
        renderDraft();
        renderNotes();
      }
    }
  }

  function addCitation(kind, item, text) {
    const owner = currentDocument();
    if (!owner) return false;
    const entry = entryFor(owner.id);
    if (entry.notePending || entry.mutations.size || entry.edit) return false;
    byId("note-editor-group").open = true;
    const summary = kind === "analysis" && Array.isArray(item?.outputs)
      ? item.outputs.find((output) => output?.name === "summary.json")
      : null;
    const hash = kind === "analysis" ? summary?.sha256 : item?.data_sha256;
    const source = copySource({ kind, id: item?.id, sha256: hash });
    if (!source) {
      setNoteStatus(entry, { key: "citationUnavailable", kind: "error" });
      renderDraft();
      return false;
    }
    const draft = ensureDraft(owner);
    if (draft.text.includes(`${kind}=${item.id}`)) return true;
    const separator = draft.text ? (draft.text.endsWith("\n") ? "\n" : "\n\n") : "";
    draft.text += `${separator}${text}`;
    draft.source = source;
    draft.operation = null;
    draft.saveFailed = false;
    setNoteStatus(entry, null);
    renderDraft();
    elements.noteText.focus();
    return true;
  }

  async function openNote(noteId) {
    const navigationSequence = ++noteNavigationSequence;
    const owner = currentDocument();
    if (!owner) return;
    byId("saved-notes-group").open = true;
    const note = adapter.getNotes().find((item) => item.id === noteId);
    if (note) {
      navigateNoteSource(owner, note);
      return;
    }
    const entry = entryFor(owner.id);
    const ownerSequence = sequence;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const showMissingStatus = (key) => {
      if (key === "deletedNoteRecovery") elements.deletedNotes.open = true;
      setNoteStatus(entry, { key, kind: "error" });
    };
    const isCurrent = () => navigationSequence === noteNavigationSequence && ownerSequence === sequence && (adapter.getNavigationGeneration?.() ?? navigationGeneration) === navigationGeneration && currentId === owner.id && currentDocument()?.id === owner.id;
    const noteState = adapter.getNoteStates().find((item) => item.id === noteId);
    if (noteState?.deleted_at) {
      showMissingStatus("deletedNoteRecovery");
      return;
    }

    let missingState;
    try {
      missingState = await adapter.api(`/api/v1/documents/${encodeURIComponent(owner.id)}/notes/${encodeURIComponent(noteId)}/state`);
    } catch (error) {
      if (!isCurrent() || error?.name === "AbortError") return;
      showMissingStatus(error?.code === "note_purged" ? "notePurgedSource" : error?.code === "not_found" ? "unknownNote" : errorKey(error));
      return;
    }
    if (!isCurrent()) return;
    if (missingState?.deleted_at) {
      showMissingStatus("deletedNoteRecovery");
      return;
    }
    if (missingState?.id !== noteId || missingState?.document_id !== owner.id || !noteSource(missingState, owner)) {
      showMissingStatus("unknownNote");
      return;
    }
    navigateNoteSource(owner, missingState);
  }

  elements.newButton.addEventListener("click", () => {
    elements.createForm.hidden = !elements.createForm.hidden;
    if (!elements.createForm.hidden) elements.name.focus();
    renderCreate();
  });
  elements.createCancel.addEventListener("click", () => {
    if (createOperation?.pending) return;
    elements.createForm.hidden = true;
    renderCreate();
    elements.newButton.focus();
  });
  elements.createForm.addEventListener("submit", submitCreate);
  for (const input of [elements.name, elements.question]) {
    input.addEventListener("input", () => {
      if (createOperation?.pending) return;
      createOperation = null;
      createReviewed = false;
      createStatus = null;
      renderCreate();
    });
  }
  elements.paperSelect.addEventListener("change", () => {
    const entry = entryFor(currentId);
    if (entry) entry.selectedPaperId = elements.paperSelect.value;
  });
  elements.paperLink.addEventListener("click", () => linkPaper());
  elements.noteText.addEventListener("input", () => {
    const owner = currentDocument();
    if (!owner) return;
    const entry = entryFor(owner.id);
    if (entry.edit) {
      entry.edit.text = elements.noteText.value;
      entry.edit.operation = null;
      entry.edit.saveFailed = false;
    } else {
      const draft = ensureDraft(owner);
      draft.text = elements.noteText.value;
      draft.operation = null;
      draft.saveFailed = false;
    }
    setNoteStatus(entry, null);
    renderDraft();
  });
  elements.noteSource.addEventListener("change", () => {
    const owner = currentDocument();
    if (!owner) return;
    const entry = entryFor(owner.id);
    if (entry.edit || entry.notePending) return;
    const draft = ensureDraft(owner);
    if (elements.noteSource.value === "study") draft.source = defaultSource(owner);
    else if (elements.noteSource.value === "dataset") {
      const dataset = adapter.getSelectedDataset?.();
      draft.source = copySource({ kind: "dataset", id: dataset?.id, sha256: dataset?.sha256 });
    }
    draft.operation = null;
    draft.saveFailed = false;
    setNoteStatus(entry, null);
    renderDraft();
  });
  elements.noteForm.addEventListener("submit", submitNote);
  elements.noteEditCancel.addEventListener("click", cancelEdit);
  elements.papersDetails.addEventListener("toggle", () => {
    const owner = currentDocument();
    if (owner) entryFor(owner.id).papersOpen = elements.papersDetails.open;
  });
  elements.noteSourceDetails.addEventListener("toggle", () => {
    const owner = currentDocument();
    if (owner) entryFor(owner.id).draftSourceOpen = elements.noteSourceDetails.open;
  });

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      byId("study-library-heading").textContent = t("studies");
      byId("study-papers-heading").textContent = t("papers");
      byId("study-papers-help").textContent = t("papersHelp");
      byId("study-paper-select").setAttribute("aria-label", t("paperSelect"));
      byId("study-note-source-details-summary").textContent = t("sourceDetails");
      elements.papers.setAttribute("aria-label", t("papers"));
      elements.notesList.setAttribute("aria-label", t("savedNotes"));
      elements.deletedNotesList.setAttribute("aria-label", t("deletedNotes"));
      document.querySelector(".study-view-kicker").textContent = t("overview");
      renderCreate();
      renderDocument();
      projectResources.applyLanguage(nextLanguage);
    },
    setStudies(items) {
      studies = Array.isArray(items) ? items.filter((item) => item?.kind === "study" && item.workspace_role !== "personal_analysis") : [];
      renderList();
    },
    getStudies() {
      return studies;
    },
    documentChanged(document) {
      currentId = document?.kind === "study" ? document.id : null;
      sequence += 1;
      noteNavigationSequence += 1;
      projectResources.documentChanged(document);
      renderDocument();
      if (currentId && !isPersonal(document)) loadPapers(document);
    },
    captureCurrentDraft,
    renderDocument,
    renderNotes,
    sourceContextChanged() {
      if (currentId) renderDraft();
    },
    addCitation,
    openNote,
    hasPending(documentId) {
      const entry = entries.get(documentId);
      return Boolean(entry?.notePending || entry?.mutations.size || projectResources.hasPending(documentId));
    }
  };
}
