import * as pdfjsLib from "/vendor/pdfjs/build/pdf.mjs";
import { createImageLibrary } from "/image-library.js";
import { createImageViewer } from "/image-viewer.js";
import { createAnalysis } from "/analysis.js";
import { createDatasetSelection } from "/dataset-selection.js";
import { createDataImports } from "/data-imports.js";
import { createCharts } from "/charts.js";
import { createWorkspace } from "/workspace.js";
import { createAssistant } from "/assistant.js";
import { createRichText, renderRichHtml } from "/rich-text.js";
import { createResearchRecord } from "/research-record.js";
import { createStudy } from "/study.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/build/pdf.worker.mjs";

const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_CANVAS_AXIS = 8192;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;

const messages = {
  zh: {
    pageTitle: "文献与笔记",
    themeLabel: "主题",
    themeDefault: "默认中性",
    themeDoraemonBlue: "哆啦A梦蓝",
    documents: "文献",
    upload: "上传 PDF",
    emptyDocuments: "还没有文献。上传 PDF，或打开两页示例开始阅读。",
    sample: "试读示例",
    reader: "阅读器",
    emptyReader: "从左侧选择一篇文献开始阅读。",
    fitWidth: "适应宽度",
    page: "页码",
    notes: "笔记",
    noSource: "尚未选择原文位置",
    regionMode: "框选原文位置",
    cancelRegion: "取消框选",
    wholePage: "引用整页",
    anchorHelp: "框选页面区域，或引用当前整页。保存前可继续修改笔记。",
    noteLabel: "笔记内容",
    notePlaceholder: "记录你的想法…",
    saveNote: "保存笔记",
    retrySave: "重试保存",
    saveImageExcerpt: "保存图片摘录",
    retryImageExcerpt: "重试保存图片",
    createExcerpt: "生成图片摘录",
    creatingExcerpt: "正在生成图片摘录…",
    downloadImage: "下载图片",
    excerptImageAlt: "第 {page} 页的图片摘录",
    exportReadingRecord: "导出阅读记录",
    exporting: "正在导出阅读记录…",
    exported: "阅读记录已导出。",
    readingRecord: "阅读记录",
    savedNotes: "已保存笔记",
    emptyNotes: "这篇文献还没有笔记。",
    retry: "重试",
    previousPage: "上一页",
    nextPage: "下一页",
    zoomIn: "放大",
    zoomOut: "缩小",
    pdfPage: "PDF 页面",
    savedDocuments: "已保存文献",
    savedNotesLabel: "已保存笔记",
    readerControls: "阅读器控制",
    pageOf: "共 {count} 页",
    pageRegion: "第 {page} 页 · 选定区域",
    pageWhole: "第 {page} 页 · 整页",
    notePageRegion: "第 {page} 页 · 区域笔记",
    notePageWhole: "第 {page} 页 · 整页笔记",
    pages: "{count} 页",
    loadingDocuments: "正在加载文献…",
    loadingDocument: "正在打开文献…",
    loadingNotes: "正在加载笔记…",
    excerptsLoadFailed: "无法加载图片摘录，请重试。",
    rendering: "正在显示页面…",
    uploading: "正在上传 PDF…",
    uploadingSample: "正在准备示例…",
    saving: "正在保存笔记…",
    savingImage: "正在保存笔记和图片摘录…",
    saved: "笔记已保存。",
    savedImage: "笔记和图片摘录已保存。",
    noteSavedImageFailed: "笔记已保存，图片摘录未完成。请重试。",
    excerptCreated: "图片摘录已生成。",
    uploaded: "文献已上传。",
    selectSource: "请先框选原文位置或引用整页。",
    regionInstructions: "在页面上拖动以框选原文位置。",
    selectionTooSmall: "请拖动框选一个更大的区域。",
    missingDocument: "这篇文献不存在或已被删除。请选择另一篇文献。",
    documentOpenFailed: "无法打开这篇文献，请重试。",
    notesLoadFailed: "无法加载笔记，请重试。",
    renderFailed: "无法显示此页面，请重试。",
    network: "无法连接本地服务。请检查服务是否运行，然后重试。",
    invalid_pdf: "这不是有效的 PDF 文件，请选择其他文件。",
    encrypted_pdf: "不支持加密 PDF，请选择未加密的文件。",
    page_limit: "PDF 页数必须在 1 至 200 页之间。",
    file_too_large: "PDF 不能超过 20 MiB。",
    parser_busy: "PDF 处理正忙，请稍后重试。",
    parser_timeout: "PDF 处理超时，请重试或选择其他文件。",
    not_found: "请求的内容不存在或已被删除。",
    file_missing: "文献文件已缺失，无法打开。",
    invalid_page: "页码超出此文献的范围。",
    idempotency_conflict: "保存请求发生冲突，请检查后重试。",
    validation_error: "提交的内容无效，请检查笔记和原文位置。",
    storage_unavailable: "本地存储暂时不可用，请稍后重试。",
    local_only: "此应用仅在本机使用。",
    origin_rejected: "请求来源未被接受。",
    region_required: "只有区域笔记可以生成图片摘录。",
    source_changed: "原文文件已变化，无法完成此操作。",
    renderer_busy: "图片处理正忙，请稍后重试。",
    renderer_timeout: "图片生成超时，请重试。",
    renderer_failed: "图片生成失败，请重试。",
    renderer_unavailable: "图片生成暂时不可用，请稍后重试。",
    excerpt_missing: "图片文件已缺失，请重试。",
    excerpt_corrupt: "图片文件已损坏，无法使用。",
    export_too_large: "阅读记录过大，无法导出。",
    request_failed: "操作未完成，请重试。",
    invalidFileType: "请选择 PDF 文件。",
    unknownNote: "这条笔记不存在或已被删除。",
    invalidImageLink: "图片链接不完整或无效。请检查文献、图片来源和批注标识。",
    viewImage: "查看 / 批注",
    editMode: "编辑已保存笔记 · 来源位置保持不变",
    editCancel: "取消编辑",
    saveEdit: "保存修改",
    retryEdit: "重试保存修改",
    reviewExplainer: "“已核对原文”仅表示你检查了来源，不代表身份认证或科学验证。",
    reviewUnreviewed: "待核对",
    reviewChecked: "已核对原文",
    markChecked: "标记已核对",
    markUnchecked: "改为待核对",
    editNote: "编辑",
    deleteNote: "删除",
    restoreNote: "恢复",
    deletedNotes: "已删除笔记",
    deletedNotesHelp: "已删除笔记可恢复到原来的来源位置。",
    deletedNoteRecovery: "这条笔记已删除，可在“已删除笔记”中恢复。",
    editSaving: "正在保存笔记修改…",
    editSaved: "笔记修改已保存。",
    reviewSaving: "正在保存核对状态…",
    reviewSaved: "已记录你核对了原文。",
    reviewUnmarked: "已改为待核对。",
    deleteConfirm: "删除这条笔记？它将从当前列表和导出中隐藏，之后可以在“已删除笔记”中恢复。",
    deleting: "正在删除笔记…",
    deleted: "笔记已删除，可随时恢复。",
    restoring: "正在恢复笔记…",
    restored: "笔记已恢复。",
    revisionConflict: "这条笔记已在其他地方更新。你的草稿已保留；可查看最新已保存版本。取消后重新编辑可明确放弃当前草稿。",
    viewLatest: "查看最新",
    noteStatesLoadFailed: "无法加载笔记状态，请重试。",
    note_deleted: "这条笔记已删除，请先恢复再操作。",
    revision_conflict: "这条笔记已在其他地方更新。",
    searchLabel: "搜索研究、文献和笔记",
    searchPlaceholder: "搜索研究、标题、作者、DOI 或笔记",
    searchSubmit: "搜索",
    searchClear: "清除",
    searchResults: "搜索结果",
    searchStudies: "研究",
    searchPapers: "文献",
    searchNotes: "笔记",
    searchSourceStudy: "研究问题",
    searchSourceDataset: "当前数据",
    searchSourceAnalysis: "已保存分析",
    searchSourceChart: "已保存图表",
    searchSourceUnavailable: "来源不可用",
    searching: "正在搜索…",
    searchFailed: "搜索失败，请重试。",
    searchEmpty: "没有找到匹配的研究、文献或笔记。",
    searchResultCount: "找到 {studies} 项研究、{documents} 篇文献、{notes} 条笔记。",
    searchMore: "结果较多，仅显示部分匹配。请缩小搜索范围。",
    alreadyInLibrary: "这篇文献已在文库中，已打开原文。",
    bibliography: "书目信息",
    metadataTitle: "标题",
    metadataAuthors: "作者",
    metadataYear: "年份",
    metadataDoi: "DOI",
    metadataEdit: "编辑书目",
    metadataSave: "保存书目",
    metadataCancel: "取消",
    metadataLoading: "正在加载书目信息…",
    metadataLoadFailed: "无法加载书目信息，请重试。阅读和上传不受影响。",
    metadataSaving: "正在保存书目信息…",
    metadataSaved: "书目信息已保存。",
    metadataRetrySave: "保存未完成，草稿已保留。请使用相同内容重试。",
    metadataConflict: "书目信息已在其他地方更新。你的草稿已保留；可查看最新已保存内容。取消后重新编辑可明确放弃当前草稿。",
    metadataLatestHeading: "最新保存内容",
    metadataLatestLoaded: "已显示最新保存内容；你的草稿仍保留在上方。",
    metadataValidation: "请填写标题；年份须为 1 至 9999 的整数或留空。",
    research_record_source_mismatch: "请先返回该来源的文献和所选数据，再查看导出范围；当前工作区未切换。",
    research_record_invalid_source: "这条导出范围来源不完整，无法打开。",
    textSelectionNote: "选中文字加入笔记",
    selectTextFirst: "请先在当前页选中文字。若页面没有可选择文字，请使用“框选原文位置”保存图片摘录。",
    textSelectionTooLong: "选中文字超过 10000 字，请缩小选择范围。",
    noTextLayer: "此页没有可选择的文字。可框选原文位置并保存图片摘录。",
    textLayerUnavailable: "此页文字暂时无法选择。可重试，或框选原文位置保存图片摘录。",
    textDraftReady: "选中文字已加入未保存笔记，不会自动保存或发送。",
    replaceDraftConfirm: "当前有未保存或正在编辑的笔记。用新的原文选择替换当前草稿吗？此操作不会自动保存。",
    draftPending: "当前笔记操作尚未完成，请完成后再选择新的原文。",
    regionDraftUnsaved: "未保存，点击保存图片摘录",
    regionDraftCancel: "取消图片摘录",
    regionDraftCancelConfirm: "取消此图片摘录的原文位置和预览？笔记文字会保留。",
    regionCaption: "第 {page} 页图片摘录",
    libraryTrash: "文献回收站",
    libraryTrashHelp: "回收站中的文献可恢复；原文、笔记和图片都会保留。",
    libraryTrashEmpty: "回收站为空。",
    libraryTrashLoading: "正在加载回收站…",
    libraryTrashLoadFailed: "无法加载文献回收站，请重试。",
    documentMenu: "文献操作",
    renameDocument: "重命名",
    trashDocument: "移入回收站",
    restoreDocument: "恢复文献",
    documentRenameLoading: "正在读取文献标题…",
    documentRenameSaving: "正在保存新标题…",
    documentRenamed: "文献标题已保存，原 PDF 和文件名未改变。",
    documentRenameFailed: "标题保存结果尚未确认。请使用原请求重试。",
    documentMetadataDraft: "这篇文献有未保存的书目修改。请先保存或取消该修改，再重命名。",
    documentTrashConfirm: "将这篇文献移入回收站？原文、笔记和图片会保留，可从回收站恢复。",
    documentTrashing: "正在移入回收站…",
    documentTrashed: "文献已移入回收站，可从回收站恢复。",
    documentRestoring: "正在恢复文献…",
    documentRestored: "文献已恢复到文库，可重新打开。",
    documentTrashedLink: "这篇文献已在回收站中。恢复后可重新打开原文、笔记和图片。",
    viewTrash: "查看回收站",
    document_in_use: "这篇文献已关联研究，请先取消关联后再移入回收站。",
    document_busy: "这篇文献仍有正在进行的任务或助手操作，请完成或停止后再试。",
    document_revision_conflict: "文献已在其他地方更新。请刷新后重试。",
    document_trashed: "这篇文献已在回收站中，请先恢复。",
    purgeNote: "彻底删除",
    purgeConfirm: "彻底删除正文和图片摘录，无法恢复；已导出文件、备份和历史对话不受影响。",
    purging: "正在彻底删除笔记…",
    purged: "笔记正文和图片摘录已彻底删除，无法恢复。",
    purgeStorageUnavailable: "笔记内容已不可访问，但图片文件清理失败。请使用原请求重试完成清理。",
    notePurgedSource: "这条笔记的正文和图片摘录已彻底删除，无法恢复。",
    note_not_deleted: "只有已删除笔记才能彻底删除。",
    note_purged: "这条笔记已彻底删除，无法恢复。",
    untitled: "未命名文献"
  },
  en: {
    pageTitle: "Papers & notes",
    themeLabel: "Theme",
    themeDefault: "Default neutral",
    themeDoraemonBlue: "Doraemon blue",
    documents: "Papers",
    upload: "Upload PDF",
    emptyDocuments: "No papers yet. Upload a PDF or open the two-page sample to start reading.",
    sample: "Try the sample",
    reader: "Reader",
    emptyReader: "Choose a paper on the left to start reading.",
    fitWidth: "Fit width",
    page: "Page",
    notes: "Notes",
    noSource: "No source selected",
    regionMode: "Select source region",
    cancelRegion: "Cancel selection",
    wholePage: "Reference whole page",
    anchorHelp: "Select a region or reference the current whole page. You can edit the note before saving.",
    noteLabel: "Note",
    notePlaceholder: "Write your thoughts…",
    saveNote: "Save note",
    retrySave: "Retry save",
    saveImageExcerpt: "Save image excerpt",
    retryImageExcerpt: "Retry image save",
    createExcerpt: "Create image excerpt",
    creatingExcerpt: "Creating image excerpt…",
    downloadImage: "Download image",
    excerptImageAlt: "Image excerpt from page {page}",
    exportReadingRecord: "Export reading record",
    exporting: "Exporting reading record…",
    exported: "Reading record exported.",
    readingRecord: "Reading record",
    savedNotes: "Saved notes",
    emptyNotes: "This paper has no notes yet.",
    retry: "Retry",
    previousPage: "Previous page",
    nextPage: "Next page",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    pdfPage: "PDF page",
    savedDocuments: "Saved papers",
    savedNotesLabel: "Saved notes",
    readerControls: "Reader controls",
    pageOf: "{count} pages",
    pageRegion: "Page {page} · selected region",
    pageWhole: "Page {page} · whole page",
    notePageRegion: "Page {page} · region note",
    notePageWhole: "Page {page} · page note",
    pages: "{count} pages",
    loadingDocuments: "Loading papers…",
    loadingDocument: "Opening paper…",
    loadingNotes: "Loading notes…",
    excerptsLoadFailed: "Image excerpts could not be loaded. Try again.",
    rendering: "Rendering page…",
    uploading: "Uploading PDF…",
    uploadingSample: "Preparing sample…",
    saving: "Saving note…",
    savingImage: "Saving note and image excerpt…",
    saved: "Note saved.",
    savedImage: "Note and image excerpt saved.",
    noteSavedImageFailed: "Note saved, but the image was not completed. Try again.",
    excerptCreated: "Image excerpt created.",
    uploaded: "Paper uploaded.",
    selectSource: "Select a source region or reference the whole page first.",
    regionInstructions: "Drag on the page to select a source region.",
    selectionTooSmall: "Drag to select a larger region.",
    missingDocument: "This paper does not exist or was deleted. Choose another paper.",
    documentOpenFailed: "The paper could not be opened. Try again.",
    notesLoadFailed: "Notes could not be loaded. Try again.",
    renderFailed: "This page could not be displayed. Try again.",
    network: "Cannot connect to the local service. Check that it is running, then retry.",
    invalid_pdf: "This is not a valid PDF. Choose another file.",
    encrypted_pdf: "Encrypted PDFs are not supported. Choose an unencrypted file.",
    page_limit: "The PDF must contain between 1 and 200 pages.",
    file_too_large: "The PDF must be no larger than 20 MiB.",
    parser_busy: "PDF processing is busy. Try again shortly.",
    parser_timeout: "PDF processing timed out. Retry or choose another file.",
    not_found: "The requested content does not exist or was deleted.",
    file_missing: "The paper file is missing and cannot be opened.",
    invalid_page: "The page is outside this paper’s range.",
    idempotency_conflict: "The save request conflicted with another request. Check it and retry.",
    validation_error: "The submitted content is invalid. Check the note and source.",
    storage_unavailable: "Local storage is temporarily unavailable. Try again shortly.",
    local_only: "This application is for local use only.",
    origin_rejected: "The request origin was not accepted.",
    region_required: "Only region notes can have image excerpts.",
    source_changed: "The source file has changed, so this action cannot be completed.",
    renderer_busy: "Image processing is busy. Try again shortly.",
    renderer_timeout: "Image creation timed out. Try again.",
    renderer_failed: "The image could not be created. Try again.",
    renderer_unavailable: "Image creation is temporarily unavailable. Try again shortly.",
    excerpt_missing: "The image file is missing. Try again.",
    excerpt_corrupt: "The image file is damaged and cannot be used.",
    export_too_large: "The reading record is too large to export.",
    request_failed: "The action could not be completed. Try again.",
    invalidFileType: "Choose a PDF file.",
    unknownNote: "This note does not exist or was deleted.",
    invalidImageLink: "The image link is incomplete or invalid. Check the paper, image source, and annotation identifiers.",
    viewImage: "View / annotate",
    editMode: "Editing a saved note · source location stays unchanged",
    editCancel: "Cancel edit",
    saveEdit: "Save changes",
    retryEdit: "Retry saving changes",
    reviewExplainer: "“Source checked” only records that you checked the source; it is not authenticated review or scientific validation.",
    reviewUnreviewed: "Needs checking",
    reviewChecked: "Source checked",
    markChecked: "Mark source checked",
    markUnchecked: "Mark needs checking",
    editNote: "Edit",
    deleteNote: "Delete",
    restoreNote: "Restore",
    deletedNotes: "Deleted notes",
    deletedNotesHelp: "Restore a deleted note to its original source location.",
    deletedNoteRecovery: "This note is deleted. Restore it from “Deleted notes” to use its source and image.",
    editSaving: "Saving note changes…",
    editSaved: "Note changes saved.",
    reviewSaving: "Saving review status…",
    reviewSaved: "Your source check was recorded.",
    reviewUnmarked: "Marked as needing checking.",
    deleteConfirm: "Delete this note? It will be hidden from the active list and exports, and can be restored from “Deleted notes”.",
    deleting: "Deleting note…",
    deleted: "Note deleted. You can restore it later.",
    restoring: "Restoring note…",
    restored: "Note restored.",
    revisionConflict: "This note was updated elsewhere. Your draft is preserved; you can view the latest saved version. Cancel and edit again to explicitly discard this draft.",
    viewLatest: "View latest",
    noteStatesLoadFailed: "Note states could not be loaded. Try again.",
    note_deleted: "This note is deleted. Restore it before making changes.",
    revision_conflict: "This note was updated elsewhere.",
    searchLabel: "Search research, papers, and notes",
    searchPlaceholder: "Search research, title, authors, DOI, or notes",
    searchSubmit: "Search",
    searchClear: "Clear",
    searchResults: "Search results",
    searchStudies: "Research",
    searchPapers: "Papers",
    searchNotes: "Notes",
    searchSourceStudy: "Research question",
    searchSourceDataset: "Current data",
    searchSourceAnalysis: "Saved analysis",
    searchSourceChart: "Saved chart",
    searchSourceUnavailable: "Source unavailable",
    searching: "Searching…",
    searchFailed: "Search failed. Try again.",
    searchEmpty: "No matching research, papers, or notes found.",
    searchResultCount: "Found {studies} research entries, {documents} papers, and {notes} notes.",
    searchMore: "More matches are available. Narrow your search to see them.",
    alreadyInLibrary: "This paper is already in your library. The existing source is open.",
    bibliography: "Bibliography",
    metadataTitle: "Title",
    metadataAuthors: "Authors",
    metadataYear: "Year",
    metadataDoi: "DOI",
    metadataEdit: "Edit bibliography",
    metadataSave: "Save bibliography",
    metadataCancel: "Cancel",
    metadataLoading: "Loading bibliography…",
    metadataLoadFailed: "Bibliography could not be loaded. Try again. Reading and upload are still available.",
    metadataSaving: "Saving bibliography…",
    metadataSaved: "Bibliography saved.",
    metadataRetrySave: "The save was not completed. Your draft is preserved; retry with the same content.",
    metadataConflict: "The bibliography was updated elsewhere. Your draft is preserved; you can view the latest saved values. Cancel and edit again to explicitly discard this draft.",
    metadataLatestHeading: "Latest saved values",
    metadataLatestLoaded: "Latest saved values are shown below; your draft is still preserved above.",
    metadataValidation: "Enter a title. Year must be a whole number from 1 to 9999, or empty.",
    research_record_source_mismatch: "Return to the source paper and selected data to review this export scope. The current workspace was not changed.",
    research_record_invalid_source: "This export-scope source is incomplete and cannot be opened.",
    textSelectionNote: "Add selected text to note",
    selectTextFirst: "Select text on the current page first. If the page has no selectable text, use “Select source region” to save an image excerpt.",
    textSelectionTooLong: "The selected text exceeds 10,000 characters. Select a smaller passage.",
    noTextLayer: "This page has no selectable text. Select a source region to save an image excerpt instead.",
    textLayerUnavailable: "Text is temporarily unavailable on this page. Retry, or select a source region for an image excerpt.",
    textDraftReady: "The selected text is in an unsaved note. Nothing was saved or sent automatically.",
    replaceDraftConfirm: "There is an unsaved or edited note. Replace the current draft with the new source selection? Nothing will be saved automatically.",
    draftPending: "A note operation is still in progress. Finish it before choosing another source.",
    regionDraftUnsaved: "Unsaved — click Save image excerpt",
    regionDraftCancel: "Cancel image excerpt",
    regionDraftCancelConfirm: "Clear this image excerpt’s source and preview? Your note text will be kept.",
    regionCaption: "Page {page} image excerpt",
    libraryTrash: "Paper trash",
    libraryTrashHelp: "Papers in trash can be restored with their original PDF, notes, and images.",
    libraryTrashEmpty: "Trash is empty.",
    libraryTrashLoading: "Loading paper trash…",
    libraryTrashLoadFailed: "Paper trash could not be loaded. Try again.",
    documentMenu: "Paper actions",
    renameDocument: "Rename",
    trashDocument: "Move to trash",
    restoreDocument: "Restore paper",
    documentRenameLoading: "Loading the paper title…",
    documentRenameSaving: "Saving the new title…",
    documentRenamed: "Paper title saved. The original PDF and filename are unchanged.",
    documentRenameFailed: "The title save is unconfirmed. Retry the original request.",
    documentMetadataDraft: "This paper has unsaved bibliography changes. Save or cancel them before renaming.",
    documentTrashConfirm: "Move this paper to trash? Its PDF, notes, and images will be kept and can be restored.",
    documentTrashing: "Moving paper to trash…",
    documentTrashed: "Paper moved to trash. It can be restored from there.",
    documentRestoring: "Restoring paper…",
    documentRestored: "Paper restored to the library. You can open it again.",
    documentTrashedLink: "This paper is in trash. Restore it to reopen its PDF, notes, and images.",
    viewTrash: "View trash",
    document_in_use: "This paper is associated with research. Remove the association before moving it to trash.",
    document_busy: "This paper still has an active job or assistant operation. Finish or stop it before retrying.",
    document_revision_conflict: "The paper changed elsewhere. Refresh and retry.",
    document_trashed: "This paper is in trash. Restore it first.",
    purgeNote: "Delete permanently",
    purgeConfirm: "Permanently delete the note body and image excerpt; this cannot be undone. Exported files, backups, and past conversations are not affected.",
    purging: "Permanently deleting note…",
    purged: "The note body and image excerpt were permanently deleted and cannot be recovered.",
    purgeStorageUnavailable: "The note content is no longer accessible, but image-file cleanup failed. Retry the original request to finish cleanup.",
    notePurgedSource: "This note’s body and image excerpt were permanently deleted and cannot be recovered.",
    note_not_deleted: "Only a deleted note can be permanently deleted.",
    note_purged: "This note was permanently deleted and cannot be recovered.",
    untitled: "Untitled paper"
  }
};

const $ = (id) => document.getElementById(id);
const elements = {
  language: $("language-toggle"),
  theme: $("theme-select"),
  status: $("app-status"),
  statusText: $("status-text"),
  statusRetry: $("status-retry"),
  documentsList: $("documents-list"),
  documentsEmpty: $("documents-empty"),
  uploadInput: $("upload-input"),
  uploadButton: $("upload-button"),
  sample: $("sample-open"),
  searchForm: $("library-search-form"),
  searchInput: $("library-search-input"),
  searchSubmit: $("library-search-submit"),
  searchClear: $("library-search-clear"),
  searchStatus: $("library-search-status"),
  searchStatusText: $("library-search-status-text"),
  searchRetry: $("library-search-retry"),
  searchResults: $("library-search-results"),
  documentTitle: $("document-title"),
  pageCount: $("page-count"),
  pagePrev: $("page-prev"),
  pageNext: $("page-next"),
  pageInput: $("page-input"),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  zoomFit: $("zoom-fit"),
  zoomLabel: $("zoom-label"),
  exportReadingRecord: $("export-reading-record"),
  metadataPanel: $("metadata-panel"),
  metadataForm: $("metadata-form"),
  metadataTitle: $("metadata-title"),
  metadataAuthors: $("metadata-authors"),
  metadataYear: $("metadata-year"),
  metadataDoi: $("metadata-doi"),
  metadataLatest: $("metadata-latest"),
  metadataStatus: $("metadata-status"),
  metadataEdit: $("metadata-edit"),
  metadataSave: $("metadata-save"),
  metadataCancel: $("metadata-cancel"),
  metadataRetry: $("metadata-retry"),
  metadataViewLatest: $("metadata-view-latest"),
  readerStage: $("reader-stage"),
  readerEmpty: $("reader-empty"),
  pageSurface: $("page-surface"),
  canvas: $("reader-canvas"),
  textLayer: $("reader-text-layer"),
  textStatus: $("reader-text-status"),
  textSelectionNote: $("text-selection-note"),
  readerRegionMode: $("reader-region-mode"),
  overlay: $("region-overlay"),
  activeSelection: $("active-selection"),
  noteForm: $("note-form"),
  noteText: $("note-text"),
  richTextOpen: $("rich-text-open"),
  richTextPlain: $("rich-text-plain"),
  richTextDraftStatus: $("rich-text-draft-status"),
  noteSave: $("note-save"),
  excerptSave: $("excerpt-save"),
  regionMode: $("region-mode"),
  pageNote: $("page-note"),
  activeSource: $("active-source"),
  anchorHelp: $("anchor-help"),
  regionDraft: $("region-draft"),
  regionPreview: $("region-draft-preview"),
  regionDraftCancel: $("region-draft-cancel"),
  characterCount: $("character-count"),
  notesPanel: $("notes-panel"),
  notesList: $("notes-list"),
  notesEmpty: $("notes-empty"),
  notesCount: $("notes-count"),
  editModeLabel: $("edit-mode-label"),
  editCancel: $("edit-cancel"),
  deletedNotes: $("deleted-notes"),
  deletedNotesList: $("deleted-notes-list"),
  deletedNotesCount: $("deleted-notes-count"),
  libraryTrash: $("library-trash"),
  libraryTrashList: $("library-trash-list"),
  libraryTrashCount: $("library-trash-count"),
  libraryTrashStatus: $("library-trash-status"),
  documentMenu: $("document-actions-menu"),
  renameDialog: $("document-rename-dialog"),
  renameForm: $("document-rename-form"),
  renameTitle: $("document-rename-title"),
  renameSave: $("document-rename-save"),
  renameCancel: $("document-rename-cancel"),
  renameRetry: $("document-rename-retry"),
  renameStatus: $("document-rename-status")
};

const state = {
  language: readLanguage(),
  theme: readTheme(),
  documents: [],
  studies: [],
  document: null,
  pdf: null,
  pdfTask: null,
  page: 1,
  notes: [],
  noteStates: [],
  noteStatesLoaded: false,
  excerpts: [],
  drafts: new Map(),
  editDrafts: new Map(),
  metadata: new Map(),
  search: {
    query: "",
    studies: [],
    documents: [],
    notes: [],
    hasMore: false,
    status: null,
    sequence: 0,
    controller: null
  },
  zoomMode: "fit",
  zoom: 1,
  fitScale: 1,
  effectiveScale: 1,
  loadSequence: 0,
  noteNavigationSequence: 0,
  renderSequence: 0,
  renderQueue: Promise.resolve(),
  renderTask: null,
  textLayerTask: null,
  capturedTextSelection: null,
  loadController: null,
  pendingUpload: false,
  pendingSaves: 0,
  pendingExcerpts: new Set(),
  pendingExports: new Set(),
  pendingMutations: new Map(),
  pendingMetadata: new Map(),
  failedMutations: new Map(),
  documentOperations: new Map(),
  librarySequence: 0,
  libraryTrash: {
    items: [],
    loaded: false,
    pending: false,
    status: null,
    sequence: 0,
    operations: new Map()
  },
  documentMenu: null,
  rename: null,
  lastUpload: null,
  highlight: null,
  highlightRevealId: null,
  regionActive: false,
  selection: null,
  status: null,
  resizeFrame: null
};

let imageLibrary = null;
let imageViewer = null;
let analysis = null;
let datasetSelection = null;
let dataImports = null;
let charts = null;
let workspace = null;
let assistant = null;
let richText = null;
let researchRecord = null;
let study = null;

function isStudy(document = state.document) {
  return document?.kind === "study";
}

function readLanguage() {
  try {
    return localStorage.getItem("research-workbench-language") === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function readTheme() {
  try {
    return localStorage.getItem("research-workbench-theme") === "doraemon-blue" ? "doraemon-blue" : "default";
  } catch {
    return "default";
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  elements.theme.value = state.theme;
}

function t(key, values = {}) {
  let text = messages[state.language][key] || messages.en[key] || key;
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function setStatus(key, kind = "info", values = {}, retry = null, retryLabel = "retry") {
  state.status = { key, kind, values, retry, retryLabel };
  renderStatus();
}

function clearStatus() {
  state.status = null;
  renderStatus();
}

function renderStatus() {
  if (!state.status) {
    elements.status.hidden = true;
    elements.statusRetry.hidden = true;
    return;
  }
  elements.status.hidden = false;
  elements.status.dataset.kind = state.status.kind;
  elements.statusText.textContent = t(state.status.key, state.status.values);
  elements.statusRetry.hidden = typeof state.status.retry !== "function";
  elements.statusRetry.textContent = t(state.status.retryLabel || "retry");
}

function applyLanguage() {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.title = `${t("pageTitle")} · Synrise Neuro`;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  elements.language.textContent = state.language === "zh" ? "EN" : "中";
  elements.language.setAttribute("aria-label", state.language === "zh" ? "Switch to English" : "切换为中文");
  elements.pagePrev.setAttribute("aria-label", t("previousPage"));
  elements.pageNext.setAttribute("aria-label", t("nextPage"));
  elements.pageInput.setAttribute("aria-label", t("page"));
  elements.zoomIn.setAttribute("aria-label", t("zoomIn"));
  elements.zoomOut.setAttribute("aria-label", t("zoomOut"));
  elements.canvas.setAttribute("aria-label", t("pdfPage"));
  elements.documentsList.setAttribute("aria-label", t("savedDocuments"));
  elements.searchResults.setAttribute("aria-label", t("searchResults"));
  elements.notesList.setAttribute("aria-label", t("savedNotesLabel"));
  elements.deletedNotesList.setAttribute("aria-label", t("deletedNotes"));
  elements.libraryTrashList.setAttribute("aria-label", t("libraryTrash"));
  elements.textLayer.setAttribute("aria-label", t("pdfPage"));
  document.querySelector(".reader-toolbar").setAttribute("aria-label", t("readerControls"));
  elements.regionMode.textContent = t(state.regionActive ? "cancelRegion" : "regionMode");
  elements.readerRegionMode.textContent = t(state.regionActive ? "cancelRegion" : "regionMode");
  renderDocuments();
  renderSearch();
  renderLibraryTrash();
  renderRenameDialog();
  renderDocumentDetails();
  renderMetadata();
  renderDraft();
  renderNotes();
  renderStatus();
  imageLibrary?.applyLanguage(state.language);
  imageViewer?.applyLanguage(state.language);
  analysis?.applyLanguage(state.language);
  datasetSelection?.applyLanguage(state.language);
  dataImports?.applyLanguage(state.language);
  charts?.applyLanguage(state.language);
  workspace?.applyLanguage(state.language);
  assistant?.applyLanguage(state.language);
  richText?.applyLanguage(state.language);
  researchRecord?.applyLanguage(state.language);
  study?.applyLanguage(state.language);
}

class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function checkedFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("network");
  }
  if (response.ok) return response;

  let code = response.status === 404 ? "not_found" : response.status === 422 ? "validation_error" : "request_failed";
  try {
    const body = await response.json();
    if (body?.detail?.code) code = body.detail.code;
  } catch {
    // The user-facing message intentionally does not expose response internals.
  }
  throw new ApiError(code);
}

async function api(path, options = {}) {
  const response = await checkedFetch(path, options);
  try {
    return await response.json();
  } catch {
    throw new ApiError("request_failed");
  }
}

function setOwnerInUrl(url, documentId, studyOwner = isStudy()) {
  if (documentId) {
    url.searchParams.set(studyOwner ? "study" : "document", documentId);
    url.searchParams.delete(studyOwner ? "document" : "study");
  } else {
    url.searchParams.delete("document");
    url.searchParams.delete("study");
  }
}

function updateUrl(documentId, noteId = null, replace = false, mode = "reading", tool = "analysis") {
  workspace?.reveal(mode, { tool, showNotes: Boolean(noteId) });
  const url = new URL(window.location.href);
  setOwnerInUrl(url, documentId);
  if (noteId) url.searchParams.set("note", noteId);
  else url.searchParams.delete("note");
  url.searchParams.set("workspace", mode);
  if (mode === "data") url.searchParams.set("tool", tool);
  else url.searchParams.delete("tool");
  for (const key of ["analysis", "dataset", "chart", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  const method = replace || url.href === window.location.href ? "replaceState" : "pushState";
  window.history[method]({}, "", url);
}

function readImageLink(params) {
  const keys = ["image_kind", "image_source", "image_annotation"];
  if (!keys.some((key) => params.has(key))) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const documentId = params.get("document");
  const kind = params.get("image_kind");
  const sourceId = params.get("image_source");
  const annotationId = params.get("image_annotation");
  if (!uuid.test(documentId || "") || !uuid.test(sourceId || "") || !["user_upload", "pdf_excerpt"].includes(kind)) return false;
  if (annotationId && !uuid.test(annotationId)) return false;
  return { documentId, kind, sourceId, annotationId: annotationId || null };
}

function showImageInUrl(documentId, context) {
  if (state.document?.id !== documentId || !context) return;
  workspace?.reveal("reading", { showNotes: true });
  const url = new URL(window.location.href);
  setOwnerInUrl(url, documentId);
  url.searchParams.set("image_kind", context.source_kind);
  url.searchParams.set("image_source", context.source_id);
  url.searchParams.set("workspace", "reading");
  url.searchParams.delete("tool");
  if (context.annotation_id) url.searchParams.set("image_annotation", context.annotation_id);
  else url.searchParams.delete("image_annotation");
  for (const key of ["note", "analysis", "dataset", "chart"]) url.searchParams.delete(key);
  window.history.replaceState({}, "", url);
}

function clearImageInUrl(documentId) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("document") !== documentId) return;
  for (const key of ["image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history.replaceState({}, "", url);
}

async function openImageViewer(documentId, kind, sourceId, options = {}) {
  if (state.document?.id !== documentId) await openDocument(documentId);
  if (state.document?.id !== documentId) return;
  await imageViewer?.open(documentId, kind, sourceId, options);
}

function makeEmptyDraft() {
  return {
    text: "",
    richContent: null,
    page: null,
    rect: null,
    requestId: null,
    saveFailed: false,
    imageFailed: false,
    includeExcerpt: false,
    imageRequestIds: null,
    previewCanvas: null
  };
}

function ensureDraft(documentId) {
  if (!state.drafts.has(documentId)) state.drafts.set(documentId, makeEmptyDraft());
  return state.drafts.get(documentId);
}

function captureCurrentDraft() {
  if (!state.document) return;
  if (isStudy()) {
    study?.captureCurrentDraft();
    return;
  }
  const editDraft = state.editDrafts.get(state.document.id);
  if (editDraft) {
    if (!state.pendingMutations.has(mutationKey(state.document.id, editDraft.noteId))) {
      editDraft.text = elements.noteText.value;
    }
    return;
  }
  const draft = ensureDraft(state.document.id);
  if (state.pendingSaves === 0) draft.text = elements.noteText.value;
}

function invalidateRequestId(draft) {
  draft.requestId = null;
  draft.imageRequestIds = null;
  draft.saveFailed = false;
  draft.imageFailed = false;
}

function prepareDraftReplacement(documentId) {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.pendingExcerpts.size > 0) {
    setStatus("draftPending", "error");
    return false;
  }
  const draft = ensureDraft(documentId);
  const editDraft = state.editDrafts.get(documentId);
  const hasDraft = Boolean(editDraft || draft.text.trim() || draft.richContent || draft.page !== null || draft.rect);
  if (hasDraft && !window.confirm(t("replaceDraftConfirm"))) return false;
  richText?.close({ restoreFocus: false });
  state.editDrafts.delete(documentId);
  state.drafts.set(documentId, makeEmptyDraft());
  return true;
}

function highlightDraft(documentId, page, rect) {
  state.highlight = {
    id: `draft-source-${documentId}`,
    document_id: documentId,
    page,
    rect: rect ? [...rect] : null
  };
  state.highlightRevealId = null;
  drawHighlight();
}

function closeDocumentMenu(restoreFocus = false) {
  const menu = state.documentMenu;
  elements.documentMenu.hidden = true;
  elements.documentsList.querySelectorAll('[data-action="document-menu"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
  state.documentMenu = null;
  if (restoreFocus && menu?.returnFocus?.isConnected) menu.returnFocus.focus();
}

function openDocumentMenu(documentId, anchor, point = null) {
  closeDocumentMenu();
  state.documentMenu = { documentId, returnFocus: anchor };
  anchor.setAttribute("aria-expanded", "true");
  elements.documentMenu.hidden = false;
  elements.documentMenu.style.left = "0px";
  elements.documentMenu.style.top = "0px";
  const menuBounds = elements.documentMenu.getBoundingClientRect();
  const anchorBounds = anchor.getBoundingClientRect();
  const desiredLeft = point?.x ?? anchorBounds.right - menuBounds.width;
  const desiredTop = point?.y ?? anchorBounds.bottom + 4;
  const left = Math.max(8, Math.min(window.innerWidth - menuBounds.width - 8, desiredLeft));
  const top = Math.max(8, Math.min(window.innerHeight - menuBounds.height - 8, desiredTop));
  elements.documentMenu.style.left = `${left}px`;
  elements.documentMenu.style.top = `${top}px`;
  elements.documentMenu.querySelector("button")?.focus();
}

function renderDocuments() {
  closeDocumentMenu();
  elements.documentsList.replaceChildren();
  elements.documentsEmpty.hidden = state.documents.length > 0;
  for (const document of state.documents) {
    const item = window.document.createElement("li");
    item.className = "document-item";
    item.dataset.documentId = document.id;
    item.dataset.active = String(state.document?.id === document.id);

    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "document-open";
    button.addEventListener("click", () => openDocument(document.id));

    const name = window.document.createElement("span");
    name.className = "document-name";
    name.textContent = document.title || document.original_filename || t("untitled");
    const meta = window.document.createElement("span");
    meta.className = "document-meta";
    meta.textContent = t("pages", { count: document.page_count });
    button.append(name, meta);
    const menuButton = window.document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "document-menu-button";
    menuButton.dataset.action = "document-menu";
    menuButton.textContent = "⋯";
    menuButton.title = t("documentMenu");
    menuButton.setAttribute("aria-label", `${t("documentMenu")}: ${name.textContent}`);
    menuButton.setAttribute("aria-haspopup", "menu");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openDocumentMenu(document.id, menuButton);
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openDocumentMenu(document.id, menuButton, { x: event.clientX, y: event.clientY });
    });
    item.append(button, menuButton);
    elements.documentsList.append(item);
  }
}

async function refreshActiveLibrary() {
  const sequence = ++state.librarySequence;
  try {
    const [body, studyBody] = await Promise.all([api("/api/v1/documents"), api("/api/v1/studies")]);
    if (sequence !== state.librarySequence) return;
    state.documents = Array.isArray(body.items) ? body.items : [];
    state.studies = Array.isArray(studyBody.items) ? studyBody.items : [];
    study?.setStudies(state.studies);
    renderDocuments();
    if (state.search.query) void performSearch(state.search.query);
  } catch (error) {
    if (sequence === state.librarySequence) setStatus(error.code || "request_failed", "error", {}, refreshActiveLibrary);
  }
}

function renderLibraryTrash() {
  const trash = state.libraryTrash;
  elements.libraryTrashList.replaceChildren();
  elements.libraryTrashCount.textContent = trash.items.length ? String(trash.items.length) : "";
  elements.libraryTrashStatus.replaceChildren();
  if (trash.status) {
    elements.libraryTrashStatus.dataset.kind = trash.status.kind || "info";
    const text = window.document.createElement("span");
    text.textContent = t(trash.status.key);
    elements.libraryTrashStatus.append(text);
    if (trash.status.retry) {
      const retry = window.document.createElement("button");
      retry.type = "button";
      retry.className = "status-retry";
      retry.textContent = t("retry");
      retry.addEventListener("click", trash.status.retry);
      elements.libraryTrashStatus.append(retry);
    }
  } else {
    delete elements.libraryTrashStatus.dataset.kind;
  }
  if (trash.loaded && !trash.items.length) {
    const empty = window.document.createElement("li");
    empty.className = "library-trash-empty";
    empty.textContent = t("libraryTrashEmpty");
    elements.libraryTrashList.append(empty);
    return;
  }
  for (const document of trash.items) {
    const item = window.document.createElement("li");
    item.className = "document-item library-trash-item";
    item.dataset.documentId = document.id;
    const name = window.document.createElement("span");
    name.className = "document-name";
    name.textContent = document.title || document.original_filename || t("untitled");
    const meta = window.document.createElement("span");
    meta.className = "document-meta";
    meta.textContent = document.deleted_at || "";
    const restore = window.document.createElement("button");
    restore.type = "button";
    restore.className = "button button-quiet";
    restore.dataset.action = "restore-document";
    const operation = trash.operations.get(document.id);
    restore.disabled = Boolean(operation?.pending);
    restore.textContent = t(operation?.pending ? "documentRestoring" : operation ? "retry" : "restoreDocument");
    restore.addEventListener("click", () => restoreDocument(document.id));
    item.append(name, meta, restore);
    elements.libraryTrashList.append(item);
  }
}

async function loadLibraryTrash() {
  const trash = state.libraryTrash;
  if (trash.pending) return;
  const sequence = ++trash.sequence;
  trash.pending = true;
  trash.status = { key: "libraryTrashLoading", kind: "info" };
  renderLibraryTrash();
  try {
    const body = await api("/api/v1/documents/trash");
    if (sequence !== trash.sequence) return;
    trash.items = Array.isArray(body.items) ? body.items : [];
    trash.loaded = true;
    trash.status = null;
  } catch (error) {
    if (sequence !== trash.sequence) return;
    trash.status = { key: error.code === "network" ? "network" : "libraryTrashLoadFailed", kind: "error", retry: loadLibraryTrash };
  } finally {
    if (sequence === trash.sequence) {
      trash.pending = false;
      renderLibraryTrash();
    }
  }
}

function documentOperationError(operation, error) {
  const key = error.code === "revision_conflict" ? "document_revision_conflict" : error.code || "request_failed";
  const status = {
    key,
    kind: "error",
    retry: error.code === "revision_conflict" ? null : () => runDocumentOperation(operation)
  };
  if (operation.action === "restore") state.libraryTrash.status = status;
  else setStatus(status.key, status.kind, {}, status.retry);
}

async function runDocumentOperation(operation) {
  if (operation.pending) return;
  operation.pending = true;
  operation.conflicted = false;
  const operations = operation.action === "restore" ? state.libraryTrash.operations : state.documentOperations;
  operations.set(operation.documentId, operation);
  if (operation.action === "restore") state.libraryTrash.status = { key: "documentRestoring", kind: "info" };
  else setStatus("documentTrashing");
  renderDocuments();
  renderLibraryTrash();
  try {
    const result = await api(operation.path, {
      method: operation.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload)
    });
    operations.delete(operation.documentId);
    if (operation.action === "restore") {
      state.libraryTrash.items = state.libraryTrash.items.filter((item) => item.id !== operation.documentId);
      state.libraryTrash.status = { key: "documentRestored", kind: "success" };
      setStatus("documentRestored", "success");
    } else {
      state.documents = state.documents.filter((item) => item.id !== operation.documentId);
      state.search.documents = state.search.documents.filter((item) => item.id !== operation.documentId);
      state.search.notes = state.search.notes.filter((item) => item.document_id !== operation.documentId);
      if (state.document?.id === operation.documentId) {
        showMissingDocument();
        updateUrl(null, null, true, "reading");
      }
      setStatus("documentTrashed", "success");
      state.libraryTrash.loaded = false;
      if (elements.libraryTrash.open) void loadLibraryTrash();
    }
    void refreshActiveLibrary();
    return result;
  } catch (error) {
    operation.conflicted = error.code === "revision_conflict";
    documentOperationError(operation, error);
    return null;
  } finally {
    operation.pending = false;
    renderDocuments();
    renderLibraryTrash();
  }
}

async function trashDocument(documentId) {
  closeDocumentMenu();
  const existing = state.documentOperations.get(documentId);
  if (existing && !existing.conflicted) {
    await runDocumentOperation(existing);
    return;
  }
  if (existing) state.documentOperations.delete(documentId);
  const document = state.documents.find((item) => item.id === documentId);
  if (!document) return;
  try {
    let revision = document.revision ?? ensureMetadata(documentId).snapshot?.revision;
    if (!Number.isInteger(revision)) {
      const metadata = await api(`/api/v1/documents/${encodeURIComponent(documentId)}/metadata`);
      applyMetadataSnapshot(documentId, metadata);
      revision = metadata.revision;
    }
    if (!Number.isInteger(revision)) throw new ApiError("request_failed");
    if (!window.confirm(t("documentTrashConfirm"))) return;
    const requestId = crypto.randomUUID();
    await runDocumentOperation({
      documentId,
      action: "trash",
      method: "DELETE",
      path: `/api/v1/documents/${encodeURIComponent(documentId)}`,
      payload: { request_id: requestId, expected_revision: revision },
      pending: false
    });
  } catch (error) {
    setStatus(error.code || "request_failed", "error");
  }
}

async function restoreDocument(documentId) {
  const existing = state.libraryTrash.operations.get(documentId);
  if (existing && !existing.conflicted) {
    await runDocumentOperation(existing);
    return;
  }
  if (existing) state.libraryTrash.operations.delete(documentId);
  const document = state.libraryTrash.items.find((item) => item.id === documentId);
  if (!document || !Number.isInteger(document.revision)) return;
  const requestId = crypto.randomUUID();
  await runDocumentOperation({
    documentId,
    action: "restore",
    method: "POST",
    path: `/api/v1/documents/${encodeURIComponent(documentId)}/restore`,
    payload: { request_id: requestId, expected_revision: document.revision },
    pending: false
  });
}

function renderRenameDialog() {
  const rename = state.rename;
  if (!rename) return;
  elements.renameTitle.disabled = rename.pending || !rename.snapshot;
  elements.renameSave.disabled = rename.pending || !rename.snapshot || !elements.renameTitle.value.trim();
  elements.renameCancel.disabled = rename.pending;
  elements.renameSave.textContent = t(rename.pending ? "documentRenameSaving" : rename.operation ? "retrySave" : "metadataSave");
  elements.renameStatus.textContent = rename.status ? t(rename.status.key) : "";
  if (rename.status?.kind) elements.renameStatus.dataset.kind = rename.status.kind;
  else delete elements.renameStatus.dataset.kind;
  elements.renameRetry.hidden = !rename.status?.retry || rename.pending;
}

async function loadRenameMetadata(rename) {
  rename.pending = true;
  rename.status = { key: "documentRenameLoading", kind: "info" };
  renderRenameDialog();
  try {
    const metadata = await api(`/api/v1/documents/${encodeURIComponent(rename.documentId)}/metadata`);
    if (state.rename !== rename) return;
    rename.snapshot = metadata;
    rename.pending = false;
    rename.status = null;
    applyMetadataSnapshot(rename.documentId, metadata);
    if (elements.renameTitle.value !== metadata.title) elements.renameTitle.value = metadata.title || "";
    renderRenameDialog();
    elements.renameTitle.focus();
    elements.renameTitle.select();
  } catch (error) {
    if (state.rename !== rename) return;
    rename.pending = false;
    rename.status = { key: error.code || "request_failed", kind: "error", retry: true };
    renderRenameDialog();
  }
}

async function openRenameDialog(documentId) {
  closeDocumentMenu();
  if (ensureMetadata(documentId).draft) {
    setStatus("documentMetadataDraft", "error");
    return;
  }
  const rename = { documentId, snapshot: null, operation: null, pending: false, status: null };
  state.rename = rename;
  elements.renameTitle.value = "";
  if (!elements.renameDialog.open) elements.renameDialog.showModal();
  renderRenameDialog();
  await loadRenameMetadata(rename);
}

function closeRenameDialog() {
  if (!state.rename || state.rename.pending) return;
  state.rename = null;
  if (elements.renameDialog.open) elements.renameDialog.close();
}

async function submitRename() {
  const rename = state.rename;
  if (!rename?.snapshot || rename.pending) return;
  if (!rename.operation) {
    const title = elements.renameTitle.value.trim();
    if (!title) return;
    const requestId = crypto.randomUUID();
    rename.operation = {
      payload: {
        request_id: requestId,
        expected_revision: rename.snapshot.revision,
        title,
        authors: rename.snapshot.authors,
        year: rename.snapshot.year,
        doi: rename.snapshot.doi
      }
    };
  }
  const operation = rename.operation;
  rename.pending = true;
  rename.status = { key: "documentRenameSaving", kind: "info" };
  renderRenameDialog();
  try {
    const saved = await api(`/api/v1/documents/${encodeURIComponent(rename.documentId)}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload)
    });
    if (state.rename !== rename) return;
    applyMetadataSnapshot(rename.documentId, saved);
    rename.pending = false;
    state.rename = null;
    elements.renameDialog.close();
    setStatus("documentRenamed", "success");
  } catch (error) {
    if (state.rename !== rename) return;
    rename.pending = false;
    rename.status = {
      key: error.code === "revision_conflict" ? "document_revision_conflict" : error.code === "network" ? "documentRenameFailed" : error.code || "request_failed",
      kind: "error",
      retry: error.code !== "revision_conflict"
    };
    renderRenameDialog();
  }
}

function renderSearch() {
  const search = state.search;
  elements.searchClear.disabled = !elements.searchInput.value && !search.query && !search.status;
  elements.searchStatus.hidden = !search.status;
  elements.searchRetry.hidden = typeof search.status?.retry !== "function";
  if (search.status) {
    elements.searchStatus.dataset.kind = search.status.kind || "info";
    elements.searchStatusText.textContent = t(search.status.key, search.status.values || {});
  } else {
    elements.searchStatusText.textContent = "";
    delete elements.searchStatus.dataset.kind;
  }

  elements.searchResults.replaceChildren();
  elements.searchResults.hidden = !search.query;
  if (!search.query) return;

  const appendGroup = (label, items, renderItem) => {
    if (!items.length) return;
    const section = window.document.createElement("section");
    section.className = "search-group";
    const heading = window.document.createElement("h3");
    heading.className = "search-group-heading";
    heading.textContent = label;
    const list = window.document.createElement("ul");
    list.className = "documents-list";
    for (const item of items) list.append(renderItem(item));
    section.append(heading, list);
    elements.searchResults.append(section);
  };

  appendGroup(t("searchStudies"), search.studies, (study) => {
    const item = window.document.createElement("li");
    item.className = "search-result-item";
    item.dataset.studyId = study.id;
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "search-result-open";
    button.addEventListener("click", () => openDocument(study.id, { ownerKind: "study" }));
    const title = window.document.createElement("span");
    title.className = "search-result-title";
    title.textContent = study.name || study.title || t("searchStudies");
    const question = window.document.createElement("span");
    question.className = "search-result-meta";
    question.textContent = study.question || "";
    button.append(title, question);
    item.append(button);
    return item;
  });

  appendGroup(t("searchPapers"), search.documents, (document) => {
    const item = window.document.createElement("li");
    item.className = "search-result-item";
    item.dataset.documentId = document.id;
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "search-result-open";
    button.addEventListener("click", () => openDocument(document.id));
    const title = window.document.createElement("span");
    title.className = "search-result-title";
    title.textContent = document.title || document.original_filename || t("untitled");
    const meta = window.document.createElement("span");
    meta.className = "search-result-meta";
    meta.textContent = [document.authors, document.year, document.original_filename].filter(Boolean).join(" · ");
    button.append(title, meta);
    item.append(button);
    return item;
  });

  appendGroup(t("searchNotes"), search.notes, (note) => {
    const studyNote = note.owner_kind === "study";
    const item = window.document.createElement("li");
    item.className = "search-result-item";
    item.dataset.documentId = note.document_id;
    item.dataset.noteId = note.id;
    if (studyNote) item.dataset.ownerKind = "study";
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "search-result-open";
    button.addEventListener("click", () => openDocument(note.document_id, { noteId: note.id }));
    const title = window.document.createElement("span");
    title.className = "search-result-title";
    title.textContent = note.document_title || t("untitled");
    const source = window.document.createElement("span");
    source.className = "search-result-meta";
    if (studyNote) {
      const sourceType = {
        study: "searchSourceStudy",
        dataset: "searchSourceDataset",
        analysis: "searchSourceAnalysis",
        chart: "searchSourceChart"
      }[note.source?.kind] || "searchSourceUnavailable";
      source.textContent = [note.source?.label, t(sourceType)].filter(Boolean).join(" · ");
    } else {
      source.textContent = t(note.rect ? "notePageRegion" : "notePageWhole", { page: note.page });
    }
    const text = window.document.createElement("span");
    text.className = "search-result-note";
    text.textContent = note.text;
    button.append(title, source, text);
    item.append(button);
    return item;
  });

  if (search.hasMore) {
    const more = window.document.createElement("p");
    more.className = "search-more";
    more.textContent = t("searchMore");
    elements.searchResults.append(more);
  }
}

async function performSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    clearSearch();
    return;
  }
  state.search.controller?.abort();
  const sequence = ++state.search.sequence;
  const controller = new AbortController();
  state.search.controller = controller;
  state.search.query = trimmed;
  state.search.studies = [];
  state.search.documents = [];
  state.search.notes = [];
  state.search.hasMore = false;
  state.search.status = { key: "searching", kind: "info" };
  renderSearch();

  try {
    const params = new URLSearchParams({ q: trimmed, limit: "40", include_studies: "true" });
    const body = await api(`/api/v1/search?${params}`, { signal: controller.signal });
    if (sequence !== state.search.sequence || state.search.query !== trimmed) return;
    state.search.studies = Array.isArray(body.studies) ? body.studies : [];
    state.search.documents = Array.isArray(body.documents) ? body.documents : [];
    state.search.notes = Array.isArray(body.notes) ? body.notes : [];
    state.search.hasMore = Boolean(body.has_more);
    state.search.status = {
      key: state.search.studies.length || state.search.documents.length || state.search.notes.length ? "searchResultCount" : "searchEmpty",
      kind: "info",
      values: { studies: state.search.studies.length, documents: state.search.documents.length, notes: state.search.notes.length }
    };
  } catch (error) {
    if (error?.name === "AbortError" || sequence !== state.search.sequence || state.search.query !== trimmed) return;
    state.search.studies = [];
    state.search.documents = [];
    state.search.notes = [];
    state.search.hasMore = false;
    state.search.status = {
      key: "searchFailed",
      kind: "error",
      retry: () => performSearch(trimmed)
    };
  } finally {
    if (sequence === state.search.sequence) {
      state.search.controller = null;
      renderSearch();
    }
  }
}

function clearSearch() {
  state.search.sequence += 1;
  state.search.controller?.abort();
  state.search.controller = null;
  state.search.query = "";
  state.search.studies = [];
  state.search.documents = [];
  state.search.notes = [];
  state.search.hasMore = false;
  state.search.status = null;
  elements.searchInput.value = "";
  renderSearch();
}

function ensureMetadata(documentId) {
  if (!state.metadata.has(documentId)) {
    state.metadata.set(documentId, {
      snapshot: null,
      draft: null,
      loading: false,
      status: null,
      latestVisible: false
    });
  }
  return state.metadata.get(documentId);
}

function captureCurrentMetadataDraft() {
  if (!state.document) return;
  const entry = ensureMetadata(state.document.id);
  if (!entry.draft || state.pendingMetadata.has(state.document.id) || entry.draft.conflicted) return;
  entry.draft.title = elements.metadataTitle.value;
  entry.draft.authors = elements.metadataAuthors.value;
  entry.draft.year = elements.metadataYear.value;
  entry.draft.doi = elements.metadataDoi.value;
}

function renderMetadataLatest(entry) {
  elements.metadataLatest.replaceChildren();
  if (!entry?.latestVisible || !entry.snapshot) return;
  const heading = window.document.createElement("strong");
  heading.textContent = t("metadataLatestHeading");
  const list = window.document.createElement("dl");
  const values = [
    ["metadataTitle", entry.snapshot.title],
    ["metadataAuthors", entry.snapshot.authors],
    ["metadataYear", entry.snapshot.year],
    ["metadataDoi", entry.snapshot.doi]
  ];
  for (const [label, value] of values) {
    const term = window.document.createElement("dt");
    term.textContent = t(label);
    const description = window.document.createElement("dd");
    description.textContent = value === null || value === "" ? "—" : String(value);
    list.append(term, description);
  }
  elements.metadataLatest.append(heading, list);
}

function renderMetadata() {
  const document = state.document;
  const entry = document ? ensureMetadata(document.id) : null;
  const draft = entry?.draft || null;
  const pending = Boolean(document && state.pendingMetadata.has(document.id));
  const values = draft || entry?.snapshot || {
    title: document?.title || document?.original_filename || "",
    authors: "",
    year: null,
    doi: ""
  };
  elements.metadataForm.dataset.mode = draft ? "edit" : "view";
  const fields = [
    [elements.metadataTitle, values.title],
    [elements.metadataAuthors, values.authors],
    [elements.metadataYear, values.year],
    [elements.metadataDoi, values.doi]
  ];
  for (const [input, value] of fields) {
    const text = value === null || value === undefined ? "" : String(value);
    if (input.value !== text) input.value = text;
    input.disabled = !document;
    input.readOnly = !draft || pending || Boolean(draft?.conflicted);
  }

  elements.metadataEdit.hidden = Boolean(draft);
  elements.metadataEdit.disabled = !document || !entry?.snapshot || entry.loading || pending;
  elements.metadataSave.hidden = !draft;
  elements.metadataSave.disabled = !draft || pending || draft.conflicted;
  elements.metadataSave.textContent = t(draft?.saveFailed ? "retrySave" : "metadataSave");
  elements.metadataCancel.hidden = !draft;
  elements.metadataCancel.disabled = pending;
  elements.metadataViewLatest.hidden = !draft?.conflicted;
  elements.metadataViewLatest.disabled = entry?.loading || pending;
  elements.metadataRetry.hidden = !entry?.status?.retry || pending;
  elements.metadataStatus.textContent = entry?.status ? t(entry.status.key, entry.status.values || {}) : "";
  if (entry?.status?.kind) elements.metadataStatus.dataset.kind = entry.status.kind;
  else delete elements.metadataStatus.dataset.kind;
  elements.metadataLatest.hidden = !draft?.conflicted || !entry.latestVisible;
  renderMetadataLatest(entry);
}

function applyMetadataSnapshot(documentId, metadata) {
  const entry = ensureMetadata(documentId);
  if (entry.snapshot && metadata.revision < entry.snapshot.revision) return false;
  entry.snapshot = metadata;
  const index = state.documents.findIndex((item) => item.id === documentId);
  if (index >= 0) {
    const updated = {
      ...state.documents[index],
      id: metadata.id,
      title: metadata.title,
      original_filename: metadata.original_filename,
      page_count: metadata.page_count,
      byte_size: metadata.byte_size,
      sha256: metadata.sha256,
      created_at: metadata.created_at,
      revision: metadata.revision
    };
    state.documents[index] = updated;
    if (state.document?.id === documentId) state.document = updated;
  }
  state.search.documents = state.search.documents.map((item) => item.id === documentId ? { ...item, ...metadata } : item);
  state.search.notes = state.search.notes.map((item) => item.document_id === documentId ? { ...item, document_title: metadata.title } : item);
  renderDocuments();
  renderSearch();
  renderDocumentDetails();
  renderMetadata();
  return true;
}

async function loadMetadata(document, sequence, signal, options = {}) {
  const entry = ensureMetadata(document.id);
  entry.loading = true;
  entry.status = { key: "metadataLoading", kind: "info" };
  if (state.document?.id === document.id) renderMetadata();
  try {
    const metadata = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/metadata`, { signal });
    if (sequence !== state.loadSequence || state.document?.id !== document.id) return;
    applyMetadataSnapshot(document.id, metadata);
    if (options.viewLatest && entry.draft?.conflicted) {
      entry.latestVisible = true;
      entry.status = { key: "metadataLatestLoaded", kind: "info" };
    } else if (!entry.draft) {
      entry.status = null;
    } else if (entry.draft.conflicted) {
      entry.status = { key: "metadataConflict", kind: "error" };
    } else if (entry.draft.saveFailed) {
      entry.status = { key: "metadataRetrySave", kind: "error", retry: "save" };
    } else {
      entry.status = null;
    }
  } catch (error) {
    if (error?.name === "AbortError" || sequence !== state.loadSequence || state.document?.id !== document.id) return;
    entry.status = {
      key: "metadataLoadFailed",
      kind: "error",
      retry: options.viewLatest ? "latest" : "load"
    };
  } finally {
    if (sequence === state.loadSequence && state.document?.id === document.id) {
      entry.loading = false;
      renderMetadata();
    }
  }
}

function startMetadataEdit() {
  if (!state.document) return;
  const entry = ensureMetadata(state.document.id);
  if (!entry.snapshot || entry.loading || entry.draft || state.pendingMetadata.has(state.document.id)) return;
  const snapshot = entry.snapshot;
  entry.draft = {
    title: snapshot.title,
    authors: snapshot.authors,
    year: snapshot.year === null ? "" : String(snapshot.year),
    doi: snapshot.doi,
    expectedRevision: snapshot.revision,
    operation: null,
    saveFailed: false,
    conflicted: false
  };
  entry.status = null;
  entry.latestVisible = false;
  renderDocumentDetails();
  renderMetadata();
  elements.metadataTitle.focus();
}

function cancelMetadataEdit() {
  if (!state.document || state.pendingMetadata.has(state.document.id)) return;
  const entry = ensureMetadata(state.document.id);
  if (!entry.draft) return;
  entry.draft = null;
  entry.status = null;
  entry.latestVisible = false;
  renderDocumentDetails();
  renderMetadata();
  elements.metadataEdit.focus();
}

async function submitMetadataSave(documentId) {
  const entry = ensureMetadata(documentId);
  const draft = entry.draft;
  if (!draft || state.pendingMetadata.has(documentId)) return;
  if (draft.conflicted) {
    entry.status = { key: "metadataConflict", kind: "error" };
    renderMetadata();
    return;
  }
  if (state.document?.id === documentId) captureCurrentMetadataDraft();
  const title = draft.title.trim();
  const authors = draft.authors.trim();
  const doi = draft.doi.trim();
  const yearText = draft.year.trim();
  const year = yearText === "" ? null : Number(yearText);
  if (!title || (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))) {
    entry.status = { key: "metadataValidation", kind: "error" };
    renderMetadata();
    return;
  }

  if (!draft.operation) {
    const requestId = crypto.randomUUID();
    draft.operation = {
      documentId,
      requestId,
      expectedRevision: draft.expectedRevision,
      payload: {
        request_id: requestId,
        expected_revision: draft.expectedRevision,
        title,
        authors,
        year,
        doi
      }
    };
  }
  const operation = draft.operation;
  state.pendingMetadata.set(documentId, operation);
  draft.saveFailed = false;
  entry.status = { key: "metadataSaving", kind: "info" };
  renderDocumentDetails();
  renderMetadata();

  try {
    const saved = await api(`/api/v1/documents/${encodeURIComponent(documentId)}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload)
    });
    applyMetadataSnapshot(documentId, saved);
    if (entry.draft?.operation === operation) entry.draft = null;
    entry.latestVisible = false;
    entry.status = { key: "metadataSaved", kind: "success" };
  } catch (error) {
    if (entry.draft?.operation === operation) {
      draft.saveFailed = true;
      draft.conflicted = error.code === "revision_conflict";
      entry.latestVisible = false;
      entry.status = draft.conflicted
        ? { key: "metadataConflict", kind: "error" }
        : { key: "metadataRetrySave", kind: "error", retry: "save" };
    }
  } finally {
    if (state.pendingMetadata.get(documentId) === operation) state.pendingMetadata.delete(documentId);
    renderDocumentDetails();
    renderMetadata();
  }
}

function mutationKey(documentId, noteId) {
  return `${documentId}:${noteId}`;
}

function renderDocumentDetails() {
  const document = state.document;
  elements.documentTitle.textContent = document ? document.title || document.original_filename || t("untitled") : "";
  elements.pageCount.textContent = document && !isStudy(document) ? t("pageOf", { count: document.page_count }) : "";
  elements.readerEmpty.hidden = Boolean(document);
  if (!document) elements.pageSurface.hidden = true;
  const hasPdf = Boolean(state.pdf && document);
  elements.pageInput.disabled = !hasPdf;
  elements.pagePrev.disabled = !hasPdf || state.page <= 1;
  elements.pageNext.disabled = !hasPdf || state.page >= (document?.page_count || 1);
  elements.zoomIn.disabled = !hasPdf || state.effectiveScale >= ZOOM_MAX;
  elements.zoomOut.disabled = !hasPdf || state.effectiveScale <= ZOOM_MIN;
  elements.zoomFit.disabled = !hasPdf;
  elements.textSelectionNote.disabled = !hasPdf || state.pendingSaves > 0 || state.pendingMutations.size > 0;
  elements.pageInput.max = String(document?.page_count || 1);
  if (!hasPdf || window.document.activeElement !== elements.pageInput) {
    elements.pageInput.value = hasPdf ? String(state.page) : "";
  }
  elements.zoomLabel.textContent = `${Math.round(state.effectiveScale * 100)}%`;
  elements.sample.disabled = state.pendingUpload;
  elements.uploadButton.disabled = state.pendingUpload;
  elements.uploadInput.disabled = state.pendingUpload;
  elements.exportReadingRecord.disabled = !document || isStudy(document) || richText?.isOpen() || state.pendingSaves > 0 || state.pendingExcerpts.size > 0 || state.pendingExports.size > 0 || state.pendingMutations.size > 0 || state.pendingMetadata.size > 0 || state.editDrafts.has(document.id) || Boolean(document && !isStudy(document) && ensureMetadata(document.id).draft);
  elements.exportReadingRecord.textContent = t(state.pendingExports.size > 0 ? "exporting" : "exportReadingRecord");
  assistant?.contextChanged();
}

function renderDraft() {
  if (isStudy()) {
    elements.regionDraft.hidden = true;
    elements.readerRegionMode.disabled = true;
    study?.renderDocument();
    return;
  }
  if (!state.document) {
    elements.noteForm.dataset.mode = "create";
    elements.editModeLabel.hidden = true;
    elements.editCancel.hidden = true;
    elements.excerptSave.hidden = false;
    elements.regionDraft.hidden = true;
    elements.noteText.value = "";
    elements.noteText.disabled = true;
    elements.noteText.readOnly = false;
    elements.richTextOpen.disabled = true;
    elements.richTextPlain.disabled = true;
    elements.richTextPlain.hidden = true;
    elements.richTextDraftStatus.hidden = true;
    elements.noteSave.disabled = true;
    elements.excerptSave.disabled = true;
    elements.regionMode.disabled = true;
    elements.readerRegionMode.disabled = true;
    elements.pageNote.disabled = true;
    elements.activeSource.textContent = t("noSource");
    elements.characterCount.textContent = "0 / 10000";
    return;
  }

  const editDraft = state.editDrafts.get(state.document.id);
  const draft = editDraft || ensureDraft(state.document.id);
  const formatted = Boolean(draft.richContent);
  if (elements.noteText.value !== draft.text) elements.noteText.value = draft.text;
  elements.characterCount.textContent = `${draft.text.length} / 10000`;
  elements.noteText.readOnly = formatted;
  elements.richTextPlain.hidden = !formatted;
  elements.richTextDraftStatus.hidden = !formatted;
  elements.noteForm.dataset.mode = editDraft ? "edit" : "create";
  elements.editModeLabel.hidden = !editDraft;
  elements.editCancel.hidden = !editDraft;
  elements.excerptSave.hidden = Boolean(editDraft);
  elements.regionDraft.hidden = Boolean(editDraft) || !draft.previewCanvas;

  if (editDraft) {
    const note = state.notes.find((item) => item.id === editDraft.noteId) || editDraft.note;
    const pending = state.pendingMutations.has(mutationKey(state.document.id, editDraft.noteId));
    elements.activeSource.textContent = t(note.rect ? "pageRegion" : "pageWhole", { page: note.page });
    elements.noteText.disabled = pending;
    elements.richTextOpen.disabled = pending;
    elements.richTextPlain.disabled = pending;
    elements.regionMode.disabled = true;
    elements.readerRegionMode.disabled = true;
    elements.pageNote.disabled = true;
    elements.noteSave.disabled = pending || !editDraft.text.trim();
    elements.excerptSave.disabled = true;
    elements.editCancel.disabled = pending;
    elements.noteSave.textContent = t(editDraft.saveFailed ? "retryEdit" : "saveEdit");
    elements.anchorHelp.textContent = t("editMode");
    return;
  }

  if (draft.previewCanvas && elements.regionPreview.firstChild !== draft.previewCanvas) elements.regionPreview.replaceChildren(draft.previewCanvas);
  if (draft.page === null) elements.activeSource.textContent = t("noSource");
  else elements.activeSource.textContent = t(draft.rect ? "pageRegion" : "pageWhole", { page: draft.page });
  const pending = state.pendingSaves > 0;
  const mutationPending = state.pendingMutations.size > 0;
  const ready = Boolean(state.pdf);
  elements.noteText.disabled = pending;
  elements.richTextOpen.disabled = pending || mutationPending;
  elements.richTextPlain.disabled = pending || mutationPending;
  elements.regionMode.disabled = !ready || pending || mutationPending;
  elements.readerRegionMode.disabled = !ready || pending || mutationPending;
  elements.pageNote.disabled = !ready || pending || mutationPending;
  elements.regionDraftCancel.disabled = pending || mutationPending;
  elements.noteSave.disabled = pending || mutationPending || !ready || draft.page === null || !draft.text.trim();
  elements.excerptSave.disabled = pending || mutationPending || !ready || !draft.rect || !draft.text.trim();
  elements.noteSave.textContent = t(draft.saveFailed ? "retrySave" : "saveNote");
  elements.excerptSave.textContent = t(draft.imageFailed ? "retryImageExcerpt" : "saveImageExcerpt");
  elements.anchorHelp.textContent = state.regionActive ? t("regionInstructions") : t("anchorHelp");
}

function excerptPendingKey(documentId, noteId) {
  return `${documentId}:${noteId}`;
}

function noteStateFor(noteId) {
  return state.noteStates.find((item) => item.id === noteId) || null;
}

function makeNoteAction(action, label, handler, disabled) {
  const button = window.document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet";
  button.dataset.action = action;
  button.disabled = disabled;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function appendRichNoteBody(item, note, noteState) {
  if (!noteState?.rich_content || typeof noteState.rich_html !== "string") return false;
  const body = window.document.createElement("div");
  body.className = "note-rich-content";
  item.append(body);
  void renderRichHtml(body, { html: noteState.rich_html, text: note.text, language: state.language });
  return true;
}

function renderNotes() {
  if (isStudy()) {
    study?.renderNotes();
    return;
  }
  elements.notesList.replaceChildren();
  const document = state.document;
  const hasDocument = Boolean(document);
  elements.notesEmpty.hidden = !hasDocument || state.notes.length > 0;
  elements.notesEmpty.textContent = t("emptyNotes");
  elements.notesCount.textContent = hasDocument && state.notes.length ? String(state.notes.length) : "";
  const actionsLocked = state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.pendingExcerpts.size > 0 || (document && state.editDrafts.has(document.id));

  for (const note of state.notes) {
    const noteState = noteStateFor(note.id);
    const reviewStatus = noteState?.review_status || "unreviewed";
    const item = window.document.createElement("li");
    item.className = "note-item";
    item.dataset.noteId = note.id;
    item.dataset.reviewStatus = reviewStatus;
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "note-open";
    button.addEventListener("click", () => openNote(note.id));
    const source = window.document.createElement("span");
    source.className = "note-source";
    source.textContent = t(note.rect ? "notePageRegion" : "notePageWhole", { page: note.page });
    button.append(source);
    item.append(button);
    if (!appendRichNoteBody(item, note, noteState)) {
      const text = window.document.createElement("span");
      text.className = "note-text-preview";
      text.textContent = note.text;
      button.append(text);
    }
    imageLibrary?.appendNoteImages(item, note);

    const reviewRow = window.document.createElement("div");
    reviewRow.className = "note-review-row";
    const badge = window.document.createElement("span");
    badge.className = "review-badge";
    badge.dataset.status = reviewStatus;
    badge.textContent = t(reviewStatus === "source_checked" ? "reviewChecked" : "reviewUnreviewed");
    reviewRow.append(badge);
    item.append(reviewRow);

    const excerpt = state.excerpts.find((item) => item.note_id === note.id);
    if (note.rect && excerpt) {
      const preview = window.document.createElement("button");
      preview.type = "button";
      preview.className = "excerpt-preview";
      preview.addEventListener("click", () => openNote(note.id));
      const image = window.document.createElement("img");
      image.className = "excerpt-image";
      image.dataset.testid = "excerpt-image";
      image.src = excerpt.image_url;
      image.alt = t("excerptImageAlt", { page: note.page });
      preview.append(image);

      const excerptActions = window.document.createElement("div");
      excerptActions.className = "note-excerpt-actions";
      const download = window.document.createElement("a");
      download.className = "excerpt-download";
      download.href = excerpt.image_url;
      download.download = `page-${note.page}-excerpt-${note.id}.png`;
      download.textContent = t("downloadImage");
      const view = window.document.createElement("button");
      view.type = "button";
      view.className = "button button-quiet";
      view.dataset.action = "view-image";
      view.dataset.sourceKind = "pdf_excerpt";
      view.dataset.sourceId = note.id;
      view.textContent = t("viewImage");
      view.addEventListener("click", () => openImageViewer(document.id, "pdf_excerpt", note.id));
      excerptActions.append(view, download);
      item.append(preview, excerptActions);
    } else if (note.rect) {
      const create = window.document.createElement("button");
      create.type = "button";
      create.className = "button button-quiet";
      create.dataset.action = "create-excerpt";
      const pending = state.pendingExcerpts.has(excerptPendingKey(document.id, note.id));
      create.disabled = actionsLocked || pending;
      create.textContent = t(pending ? "creatingExcerpt" : "createExcerpt");
      create.addEventListener("click", () => createExcerpt(document, note));
      item.append(create);
    }

    const actions = window.document.createElement("div");
    actions.className = "note-actions";
    actions.append(
      makeNoteAction("edit-note", t("editNote"), () => startEditNote(document, note), actionsLocked || !noteState),
      makeNoteAction("review-note", t(reviewStatus === "source_checked" ? "markUnchecked" : "markChecked"), () => reviewNote(document, note), actionsLocked || !noteState),
      makeNoteAction("delete-note", t("deleteNote"), () => deleteNote(document, note), actionsLocked || !noteState)
    );
    item.append(actions);
    elements.notesList.append(item);
  }
  renderDeletedNotes();
}

function renderDeletedNotes() {
  elements.deletedNotesList.replaceChildren();
  const document = state.document;
  const deleted = document ? state.noteStates.filter((item) => item.deleted_at && !item.purged) : [];
  elements.deletedNotes.hidden = !deleted.length;
  elements.deletedNotesCount.textContent = deleted.length ? String(deleted.length) : "";
  if (!deleted.length) elements.deletedNotes.open = false;
  const disabled = state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.pendingExcerpts.size > 0 || state.editDrafts.has(document?.id);

  for (const note of deleted) {
    const item = window.document.createElement("li");
    item.className = "deleted-note-item";
    item.dataset.noteId = note.id;
    const sourceButton = window.document.createElement("button");
    sourceButton.type = "button";
    sourceButton.className = "note-open";
    sourceButton.addEventListener("click", () => openNote(note.id));
    const source = window.document.createElement("span");
    source.className = "note-source";
    source.textContent = t(note.rect ? "notePageRegion" : "notePageWhole", { page: note.page });
    sourceButton.append(source);
    item.append(sourceButton);
    if (!appendRichNoteBody(item, note, note)) {
      const text = window.document.createElement("span");
      text.className = "note-text-preview";
      text.textContent = note.text;
      sourceButton.append(text);
    }
    const restore = makeNoteAction("restore-note", t("restoreNote"), () => restoreNote(document, note), disabled);
    const failed = state.failedMutations.get(mutationKey(document.id, note.id));
    const purge = makeNoteAction("purge-note", t(failed?.action === "purge" ? "retry" : "purgeNote"), () => purgeNote(document, note), disabled);
    const actions = window.document.createElement("div");
    actions.className = "note-actions";
    actions.append(restore, purge);
    item.append(actions);
    elements.deletedNotesList.append(item);
  }
}

async function loadDocuments() {
  setStatus("loadingDocuments");
  try {
    const [body, studyBody] = await Promise.all([api("/api/v1/documents"), api("/api/v1/studies")]);
    state.documents = Array.isArray(body.items) ? body.items : [];
    state.studies = Array.isArray(studyBody.items) ? studyBody.items : [];
    study?.setStudies(state.studies);
    renderDocuments();
    const params = new URLSearchParams(window.location.search);
    const requestedStudy = params.get("study");
    const requestedDocument = requestedStudy || params.get("document");
    const requestedNote = params.get("note");
    const requestedAnalysis = params.get("analysis");
    const requestedDataset = params.get("dataset");
    const requestedChart = params.get("chart");
    const hasExplicitMode = params.has("workspace") || ["note", "analysis", "dataset", "chart", "image_source"].some((key) => params.has(key));
    const requestedMode = requestedStudy && !hasExplicitMode ? "data" : workspace?.modeForParams(params) || "reading";
    const imageLink = requestedStudy ? null : readImageLink(params);
    if (requestedDocument) {
      await openDocument(requestedDocument, {
        ownerKind: requestedStudy ? "study" : "paper",
        noteId: requestedMode === "reading" ? requestedNote : null,
        analysisId: requestedMode === "data" ? requestedAnalysis : null,
        datasetId: requestedMode === "data" ? requestedDataset : null,
        chartId: requestedMode === "data" ? requestedChart : null,
        imageLink: requestedMode === "reading" ? imageLink || null : null,
        workspace: requestedMode,
        tool: requestedChart ? "charts" : params.get("tool"),
        replaceUrl: true
      });
    } else if (state.documents.length) {
      await openDocument(state.documents[0].id, { replaceUrl: true });
    } else if (state.studies.length) {
      await openDocument(state.studies[0].id, { ownerKind: "study", workspace: "data", replaceUrl: true });
    } else {
      clearStatus();
    }
    if (imageLink === false) setStatus("invalidImageLink", "error");
  } catch (error) {
    setStatus(error.code || "request_failed", "error", {}, loadDocuments);
  }
}

function showMissingDocument() {
  captureCurrentMetadataDraft();
  cancelDocumentWork();
  state.document = null;
  state.pdf = null;
  state.notes = [];
  state.noteStates = [];
  state.noteStatesLoaded = false;
  state.excerpts = [];
  state.highlight = null;
  elements.pageSurface.hidden = true;
  elements.readerEmpty.hidden = false;
  study?.documentChanged(null);
  renderDocuments();
  renderDocumentDetails();
  renderMetadata();
  renderDraft();
  renderNotes();
  imageLibrary?.documentChanged(null);
  analysis?.reload(null);
  dataImports?.reload(null);
  charts?.reload(null);
  assistant?.documentChanged(null);
  workspace?.documentChanged();
  setStatus("missingDocument", "error");
}

function cancelDocumentWork() {
  richText?.close({ restoreFocus: false });
  imageViewer?.close({ restoreFocus: false });
  researchRecord?.documentChanged();
  state.loadSequence += 1;
  state.noteNavigationSequence += 1;
  state.renderSequence += 1;
  cancelTextLayer();
  state.loadController?.abort();
  state.loadController = null;
  if (state.renderTask) {
    try {
      state.renderTask.cancel();
    } catch {
      // Cancellation is best effort; stale results are also sequence checked.
    }
    state.renderTask = null;
  }
  if (state.pdfTask) {
    state.pdfTask.destroy().catch(() => {});
    state.pdfTask = null;
  }
  if (state.pdf) {
    state.pdf.loadingTask.destroy().catch(() => {});
    state.pdf = null;
  }
  state.highlightRevealId = null;
  setRegionMode(false);
  clearHighlights();
}

async function openDocument(documentId, options = {}) {
  let document = state.documents.find((item) => item.id === documentId) || state.studies.find((item) => item.id === documentId);
  if (!document) {
    const resolveSequence = ++state.loadSequence;
    state.loadController?.abort();
    let resolveError = null;
    try {
      document = await api(`/api/v1/documents/${encodeURIComponent(documentId)}`);
    } catch (error) {
      resolveError = error;
      document = null;
    }
    if (resolveSequence !== state.loadSequence) return;
    if (!document && !["not_found", "document_trashed"].includes(resolveError?.code)) {
      setStatus(resolveError?.code || "documentOpenFailed", "error", {}, () => openDocument(documentId, options));
      return;
    }
    if (!document) {
      showMissingDocument();
      if (resolveError?.code === "document_trashed") {
        setStatus("documentTrashedLink", "error", {}, () => {
          elements.libraryTrash.open = true;
          void loadLibraryTrash();
          elements.libraryTrash.scrollIntoView({ block: "nearest" });
        }, "viewTrash");
      }
      return;
    }
    if (isStudy(document)) {
      state.studies = [document, ...state.studies.filter((item) => item.id !== document.id)];
      study?.setStudies(state.studies);
    } else {
      state.documents = [document, ...state.documents.filter((item) => item.id !== document.id)];
    }
  }
  const studyOwner = isStudy(document);
  const mode = options.workspace || (options.noteId || options.imageLink ? "reading" : options.analysisId || options.datasetId || options.chartId ? "data" : studyOwner ? "data" : workspace?.getMode() || "reading");
  const tool = options.chartId || options.tool === "charts" ? "charts" : "analysis";
  workspace?.reveal(mode, { tool, showNotes: Boolean(options.noteId || options.imageLink) });
  if (state.document?.id === documentId && (studyOwner ? state.noteStatesLoaded : state.pdf) && !options.force) {
    if (options.imageLink && !studyOwner) await openImageViewer(documentId, options.imageLink.kind, options.imageLink.sourceId, { annotationId: options.imageLink.annotationId });
    else if (options.noteId) await openNote(options.noteId, { preserveUrl: options.preserveUrl });
    if (options.datasetId) analysis?.openDataset(options.datasetId, { preserveUrl: options.preserveUrl });
    if (options.analysisId) analysis?.openJob(options.analysisId, { preserveUrl: options.preserveUrl });
    if (options.chartId) charts?.openChart(documentId, options.chartId, { preserveUrl: options.preserveUrl });
    return;
  }

  captureCurrentDraft();
  captureCurrentMetadataDraft();
  cancelDocumentWork();
  const sequence = state.loadSequence;
  const controller = new AbortController();
  state.loadController = controller;
  state.document = document;
  state.page = 1;
  state.notes = [];
  state.noteStates = [];
  state.noteStatesLoaded = false;
  state.excerpts = [];
  state.highlight = null;
  state.zoomMode = "fit";
  state.effectiveScale = 1;
  elements.pageSurface.hidden = true;
  elements.readerEmpty.hidden = false;
  study?.documentChanged(document);
  if (!options.preserveUrl) updateUrl(documentId, options.noteId || null, Boolean(options.replaceUrl), mode, tool);
  renderDocuments();
  renderDocumentDetails();
  renderMetadata();
  renderDraft();
  renderNotes();
  imageLibrary?.documentChanged(studyOwner ? null : document);
  analysis?.reload(documentId);
  dataImports?.reload(documentId);
  charts?.reload(documentId);
  if (options.datasetId) analysis?.openDataset(options.datasetId, { preserveUrl: options.preserveUrl });
  if (options.analysisId) analysis?.openJob(options.analysisId, { preserveUrl: options.preserveUrl });
  if (options.chartId) charts?.openChart(documentId, options.chartId, { preserveUrl: options.preserveUrl });
  assistant?.documentChanged(document);
  workspace?.documentChanged();
  setStatus("loadingDocument");

  const pdfPromise = studyOwner ? Promise.resolve(null) : loadPdf(document, sequence, controller.signal);
  const notesPromise = loadNotes(document, sequence, controller.signal);
  const noteStatesPromise = loadNoteStates(document, sequence, controller.signal);
  const excerptsPromise = studyOwner ? Promise.resolve(null) : loadExcerpts(document, sequence, controller.signal);
  const metadataPromise = studyOwner ? Promise.resolve(null) : loadMetadata(document, sequence, controller.signal);
  const [pdfResult, notesResult, noteStatesResult, excerptsResult] = await Promise.allSettled([pdfPromise, notesPromise, noteStatesPromise, excerptsPromise, metadataPromise]);
  if (sequence !== state.loadSequence || state.document?.id !== documentId) return;

  if (pdfResult.status === "rejected") {
    elements.pageSurface.hidden = true;
    elements.readerEmpty.hidden = false;
    renderDocumentDetails();
    renderDraft();
    const key = pdfResult.reason?.name === "AbortError" ? null : pdfResult.reason?.code || "documentOpenFailed";
    if (key) setStatus(key, "error", {}, () => openDocument(documentId, { force: true }));
    return;
  }

  state.pdf = pdfResult.value;
  let noteLinkStatus = null;
  if (options.noteId && studyOwner) {
    await study?.openNote(options.noteId);
  } else if (options.noteId) {
    const note = state.notes.find((item) => item.id === options.noteId);
    if (note) {
      state.highlight = note;
      state.highlightRevealId = note.id;
      state.page = note.page;
    } else {
      noteLinkStatus = await openNote(options.noteId, { preserveUrl: true });
    }
  }
  if (sequence !== state.loadSequence || state.document?.id !== documentId) return;
  elements.readerEmpty.hidden = true;
  renderDocumentDetails();
  renderDraft();
  if (!studyOwner) await requestRender();
  if (!studyOwner && sequence === state.loadSequence && options.imageLink) {
    await openImageViewer(documentId, options.imageLink.kind, options.imageLink.sourceId, { annotationId: options.imageLink.annotationId });
  }

  if (sequence === state.loadSequence && noteLinkStatus) {
    setStatus(noteLinkStatus, "error");
  } else if (sequence === state.loadSequence && notesResult.status === "rejected" && notesResult.reason?.name !== "AbortError") {
    setStatus(notesResult.reason?.code || "notesLoadFailed", "error", {}, async () => {
      try {
        await loadNotes(state.document, state.loadSequence);
        clearStatus();
      } catch (error) {
        setStatus(error.code || "notesLoadFailed", "error");
      }
    });
  } else if (sequence === state.loadSequence && noteStatesResult.status === "rejected" && noteStatesResult.reason?.name !== "AbortError") {
    setStatus(noteStatesResult.reason?.code || "noteStatesLoadFailed", "error", {}, async () => {
      try {
        await loadNoteStates(document, state.loadSequence, state.loadController?.signal);
        clearStatus();
      } catch (error) {
        setStatus(error.code || "noteStatesLoadFailed", "error");
      }
    });
  } else if (!studyOwner && sequence === state.loadSequence && excerptsResult.status === "rejected" && excerptsResult.reason?.name !== "AbortError") {
    setStatus(excerptsResult.reason?.code || "excerptsLoadFailed", "error", {}, async () => {
      if (state.document?.id !== document.id) {
        await openDocument(document.id, { force: true });
        return;
      }
      try {
        await loadExcerpts(document, state.loadSequence, state.loadController?.signal);
        clearStatus();
      } catch (error) {
        setStatus(error.code || "excerptsLoadFailed", "error");
      }
    });
  } else if (sequence === state.loadSequence && state.status?.key === "loadingDocument") {
    clearStatus();
  }
}

async function loadPdf(document, sequence, signal) {
  const response = await checkedFetch(`/api/v1/documents/${encodeURIComponent(document.id)}/file`, { signal });
  const bytes = await response.arrayBuffer();
  if (sequence !== state.loadSequence) throw new DOMException("Stale request", "AbortError");
  const task = pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: "/vendor/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
    wasmUrl: "/vendor/pdfjs/wasm/"
  });
  state.pdfTask = task;
  const pdf = await task.promise;
  if (sequence !== state.loadSequence || state.document?.id !== document.id) {
    await task.destroy();
    throw new DOMException("Stale document", "AbortError");
  }
  state.pdfTask = null;
  return pdf;
}

async function loadNotes(document, sequence, signal) {
  const body = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/notes`, { signal });
  if (sequence !== state.loadSequence || state.document?.id !== document.id || state.noteStatesLoaded) return;
  state.notes = Array.isArray(body.items) ? body.items : [];
  renderNotes();
}

async function loadNoteStates(document, sequence, signal) {
  const body = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/note-states`, { signal });
  if (sequence !== state.loadSequence || state.document?.id !== document.id) return;
  state.noteStates = Array.isArray(body.items) ? body.items : [];
  state.noteStatesLoaded = true;
  state.notes = state.noteStates.filter((item) => !item.deleted_at && !item.purged);
  renderNotes();
}

async function loadExcerpts(document, sequence, signal) {
  const body = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/excerpts`, { signal });
  if (sequence !== state.loadSequence || state.document?.id !== document.id) return;
  state.excerpts = Array.isArray(body.items) ? body.items : [];
  renderNotes();
}

async function goToPage(page, options = {}) {
  if (!state.pdf || !state.document) return;
  const nextPage = Math.max(1, Math.min(state.document.page_count, Math.trunc(Number(page) || 1)));
  state.page = nextPage;
  if (!options.preserveHighlight) {
    state.highlight = null;
    state.highlightRevealId = null;
    updateUrl(state.document.id);
  }
  setRegionMode(false);
  renderDocumentDetails();
  await requestRender();
}

function cancelTextLayer() {
  const selection = window.getSelection();
  if (selection?.anchorNode && elements.textLayer.contains(selection.anchorNode)) selection.removeAllRanges();
  state.capturedTextSelection = null;
  if (state.textLayerTask) {
    try {
      state.textLayerTask.cancel();
    } catch {
      // Stale layers are also detached and rejected by the render sequence.
    }
    state.textLayerTask = null;
  }
  elements.textLayer.replaceChildren();
  delete elements.textLayer.dataset.documentId;
  delete elements.textLayer.dataset.page;
  elements.textStatus.hidden = true;
}

async function renderTextLayer(page, viewport, sequence, documentId, pageNumber) {
  const task = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container: elements.textLayer,
    viewport
  });
  state.textLayerTask = task;
  elements.textLayer.dataset.documentId = documentId;
  elements.textLayer.dataset.page = String(pageNumber);
  try {
    await task.render();
    if (state.textLayerTask !== task || sequence !== state.renderSequence || state.document?.id !== documentId || state.page !== pageNumber) return;
    const hasText = task.textContentItemsStr.some((text) => text.trim());
    elements.textStatus.hidden = hasText;
    if (!hasText) elements.textStatus.textContent = t("noTextLayer");
  } catch (error) {
    if (error?.name === "AbortException" || error?.name === "AbortError" || sequence !== state.renderSequence) return;
    if (state.textLayerTask === task && state.document?.id === documentId) {
      elements.textStatus.hidden = false;
      elements.textStatus.textContent = t("textLayerUnavailable");
    }
  }
}

function readPdfTextSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  if (elements.textLayer.dataset.documentId !== state.document?.id || elements.textLayer.dataset.page !== String(state.page)) return null;
  if (!elements.textLayer.contains(selection.anchorNode) || !elements.textLayer.contains(selection.focusNode)) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const bounds = elements.textLayer.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const rectangles = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!elements.textLayer.contains(range.commonAncestorContainer)) return null;
    rectangles.push(...range.getClientRects());
  }
  const left = Math.max(bounds.left, Math.min(...rectangles.map((rect) => rect.left)));
  const top = Math.max(bounds.top, Math.min(...rectangles.map((rect) => rect.top)));
  const right = Math.min(bounds.right, Math.max(...rectangles.map((rect) => rect.right)));
  const bottom = Math.min(bounds.bottom, Math.max(...rectangles.map((rect) => rect.bottom)));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return {
    documentId: state.document.id,
    page: state.page,
    sequence: state.renderSequence,
    text,
    rect: [
      (left - bounds.left) / bounds.width,
      (top - bounds.top) / bounds.height,
      (right - bounds.left) / bounds.width,
      (bottom - bounds.top) / bounds.height
    ].map((value) => Math.max(0, Math.min(1, value)))
  };
}

function addTextSelectionToNote() {
  if (!state.document || !state.pdf || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  const captured = state.capturedTextSelection;
  const selected = captured?.documentId === state.document.id && captured.page === state.page && captured.sequence === state.renderSequence
    ? captured
    : readPdfTextSelection();
  if (!selected) {
    setStatus("selectTextFirst", "error");
    return;
  }
  if (selected.text.length > 10000) {
    setStatus("textSelectionTooLong", "error");
    return;
  }
  if (!prepareDraftReplacement(state.document.id)) return;
  const draft = ensureDraft(state.document.id);
  draft.text = selected.text;
  draft.page = selected.page;
  draft.rect = [...selected.rect];
  draft.includeExcerpt = false;
  invalidateRequestId(draft);
  highlightDraft(state.document.id, selected.page, selected.rect);
  state.capturedTextSelection = null;
  window.getSelection()?.removeAllRanges();
  workspace?.showNotes();
  renderDraft();
  setStatus("textDraftReady", "success");
  assistant?.contextChanged();
  elements.noteText.focus();
}

function requestRender() {
  const sequence = ++state.renderSequence;
  cancelTextLayer();
  if (state.renderTask) {
    try {
      state.renderTask.cancel();
    } catch {
      // The queue still prevents simultaneous canvas rendering.
    }
  }
  state.renderQueue = state.renderQueue.catch(() => {}).then(() => renderCurrentPage(sequence));
  return state.renderQueue;
}

async function renderCurrentPage(sequence) {
  const pdf = state.pdf;
  const document = state.document;
  const pageNumber = state.page;
  if (!pdf || !document || sequence !== state.renderSequence || !elements.readerStage.clientWidth) return;

  clearHighlights();
  try {
    const page = await pdf.getPage(pageNumber);
    if (sequence !== state.renderSequence || state.pdf !== pdf || state.document?.id !== document.id || !elements.readerStage.clientWidth) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const stageStyle = getComputedStyle(elements.readerStage);
    const availableWidth = Math.max(160, elements.readerStage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight));
    state.fitScale = Math.max(0.1, availableWidth / baseViewport.width);
    const scale = state.zoomMode === "fit" ? state.fitScale : state.zoom;
    state.effectiveScale = scale;
    const cssViewport = page.getViewport({ scale });
    const cssWidth = Math.max(1, Math.floor(cssViewport.width));
    const cssHeight = Math.max(1, Math.floor(cssViewport.height));
    const ratioCap = Math.min(
      Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)),
      MAX_CANVAS_AXIS / cssWidth,
      MAX_CANVAS_AXIS / cssHeight
    );
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO, ratioCap);
    const outputViewport = page.getViewport({ scale: scale * pixelRatio });

    elements.canvas.width = Math.max(1, Math.floor(cssWidth * pixelRatio));
    elements.canvas.height = Math.max(1, Math.floor(cssHeight * pixelRatio));
    elements.canvas.style.width = `${cssWidth}px`;
    elements.canvas.style.height = `${cssHeight}px`;
    elements.pageSurface.style.width = `${cssWidth}px`;
    elements.pageSurface.style.height = `${cssHeight}px`;
    elements.pageSurface.style.setProperty("--scale-factor", String(scale));
    elements.pageSurface.style.setProperty("--total-scale-factor", String(scale));
    elements.pageSurface.style.setProperty("--scale-round-x", "1px");
    elements.pageSurface.style.setProperty("--scale-round-y", "1px");
    elements.pageSurface.hidden = false;
    elements.readerEmpty.hidden = true;
    renderDocumentDetails();

    const context = elements.canvas.getContext("2d", { alpha: false });
    const task = page.render({ canvasContext: context, viewport: outputViewport });
    state.renderTask = task;
    await task.promise;
    state.renderTask = null;
    if (sequence !== state.renderSequence || state.pdf !== pdf || state.document?.id !== document.id) return;

    elements.canvas.dataset.page = String(pageNumber);
    elements.canvas.dataset.documentId = document.id;
    elements.readerStage.dataset.page = String(pageNumber);
    elements.readerStage.dataset.documentId = document.id;
    void renderTextLayer(page, cssViewport, sequence, document.id, pageNumber);
    const highlight = drawHighlight();
    if (highlight && state.highlightRevealId === highlight.dataset.noteId) {
      state.highlightRevealId = null;
      highlight.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  } catch (error) {
    if (error?.name === "RenderingCancelledException" || error?.name === "AbortError" || sequence !== state.renderSequence) return;
    if (state.document?.id === document.id) {
      setStatus("renderFailed", "error", {}, () => requestRender());
    }
  }
}

function clearHighlights() {
  elements.overlay.querySelectorAll(".source-highlight").forEach((node) => node.remove());
}

function drawHighlight() {
  clearHighlights();
  const note = state.highlight;
  if (!note || !state.document || note.document_id !== state.document.id || note.page !== state.page) return null;
  const highlight = window.document.createElement("div");
  highlight.className = "source-highlight";
  highlight.dataset.noteId = note.id;
  const rect = note.rect || [0, 0, 1, 1];
  highlight.dataset.wholePage = String(!note.rect);
  highlight.style.left = `${rect[0] * 100}%`;
  highlight.style.top = `${rect[1] * 100}%`;
  highlight.style.width = `${(rect[2] - rect[0]) * 100}%`;
  highlight.style.height = `${(rect[3] - rect[1]) * 100}%`;
  elements.overlay.append(highlight);
  return highlight;
}

async function openNote(noteId, options = {}) {
  const navigationSequence = ++state.noteNavigationSequence;
  if (isStudy()) {
    await study?.openNote(noteId);
    return null;
  }
  if (!state.document) {
    setStatus("unknownNote", "error");
    return "unknownNote";
  }
  const owner = state.document;
  const loadSequence = state.loadSequence;
  const note = state.notes.find((item) => item.id === noteId);
  if (note) {
    state.highlight = note;
    state.highlightRevealId = note.id;
    if (!options.preserveUrl) updateUrl(owner.id, note.id);
    goToPage(note.page, { preserveHighlight: true });
    return null;
  }

  function showMissingStatus(key) {
    state.highlight = null;
    state.highlightRevealId = null;
    clearHighlights();
    if (key === "deletedNoteRecovery") elements.deletedNotes.open = true;
    if (!options.preserveUrl) updateUrl(owner.id, noteId);
    setStatus(key, "error");
    return key;
  }

  if (noteStateFor(noteId)?.deleted_at) return showMissingStatus("deletedNoteRecovery");

  let missingState;
  try {
    missingState = await api(`/api/v1/documents/${encodeURIComponent(owner.id)}/notes/${encodeURIComponent(noteId)}/state`, { signal: state.loadController?.signal });
  } catch (error) {
    if (error?.name === "AbortError" || navigationSequence !== state.noteNavigationSequence || loadSequence !== state.loadSequence || state.document?.id !== owner.id) return null;
    return showMissingStatus(error?.code === "note_purged" ? "notePurgedSource" : error?.code === "not_found" ? "unknownNote" : error?.code || "request_failed");
  }
  if (navigationSequence !== state.noteNavigationSequence || loadSequence !== state.loadSequence || state.document?.id !== owner.id) return null;
  if (missingState?.deleted_at) return showMissingStatus("deletedNoteRecovery");
  if (missingState?.id !== noteId || missingState?.document_id !== owner.id) return showMissingStatus("unknownNote");

  state.highlight = missingState;
  state.highlightRevealId = missingState.id;
  if (!options.preserveUrl) updateUrl(owner.id, missingState.id);
  goToPage(missingState.page, { preserveHighlight: true });
  return null;
}

function setRegionMode(active) {
  state.regionActive = Boolean(active && state.pdf && state.document);
  elements.regionMode.setAttribute("aria-pressed", String(state.regionActive));
  elements.regionMode.textContent = t(state.regionActive ? "cancelRegion" : "regionMode");
  elements.readerRegionMode.setAttribute("aria-pressed", String(state.regionActive));
  elements.readerRegionMode.textContent = t(state.regionActive ? "cancelRegion" : "regionMode");
  elements.overlay.dataset.active = String(state.regionActive);
  elements.anchorHelp.textContent = state.regionActive ? t("regionInstructions") : t("anchorHelp");
  if (!state.regionActive) cancelSelection();
}

function eventPoint(event) {
  const bounds = elements.overlay.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    width: bounds.width,
    height: bounds.height
  };
}

function paintSelection(selection) {
  const left = Math.min(selection.startX, selection.currentX);
  const top = Math.min(selection.startY, selection.currentY);
  const width = Math.abs(selection.currentX - selection.startX);
  const height = Math.abs(selection.currentY - selection.startY);
  elements.activeSelection.hidden = false;
  elements.activeSelection.style.left = `${left}px`;
  elements.activeSelection.style.top = `${top}px`;
  elements.activeSelection.style.width = `${width}px`;
  elements.activeSelection.style.height = `${height}px`;
}

function cancelSelection() {
  state.selection = null;
  elements.activeSelection.hidden = true;
}

function makeRegionPreview(rect) {
  const preview = window.document.createElement("canvas");
  const left = Math.max(0, Math.floor(rect[0] * elements.canvas.width));
  const top = Math.max(0, Math.floor(rect[1] * elements.canvas.height));
  const right = Math.min(elements.canvas.width, Math.ceil(rect[2] * elements.canvas.width));
  const bottom = Math.min(elements.canvas.height, Math.ceil(rect[3] * elements.canvas.height));
  preview.width = Math.max(1, right - left);
  preview.height = Math.max(1, bottom - top);
  preview.setAttribute("role", "img");
  preview.setAttribute("aria-label", t("excerptImageAlt", { page: state.page }));
  const context = preview.getContext("2d");
  context.drawImage(elements.canvas, left, top, preview.width, preview.height, 0, 0, preview.width, preview.height);
  return preview;
}

function cancelRegionDraft() {
  if (!state.document || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  const draft = ensureDraft(state.document.id);
  if (!draft.previewCanvas && !draft.rect) return;
  if (draft.text.trim() && !window.confirm(t("regionDraftCancelConfirm"))) return;
  draft.page = null;
  draft.rect = null;
  draft.includeExcerpt = false;
  draft.previewCanvas = null;
  invalidateRequestId(draft);
  state.highlight = null;
  state.highlightRevealId = null;
  clearHighlights();
  clearStatus();
  renderDraft();
  assistant?.contextChanged();
  elements.noteText.focus();
}

function finishSelection(event) {
  const selection = state.selection;
  if (!selection || selection.pointerId !== event.pointerId) return;
  const point = eventPoint(event);
  selection.currentX = point.x;
  selection.currentY = point.y;
  paintSelection(selection);
  const left = Math.min(selection.startX, selection.currentX);
  const top = Math.min(selection.startY, selection.currentY);
  const width = Math.abs(selection.currentX - selection.startX);
  const height = Math.abs(selection.currentY - selection.startY);
  state.selection = null;
  elements.activeSelection.hidden = true;
  if (width < 4 || height < 4 || !point.width || !point.height) {
    setStatus("selectionTooSmall", "error");
    return;
  }
  const documentId = state.document?.id;
  const page = state.page;
  if (!documentId || !prepareDraftReplacement(documentId)) {
    setRegionMode(false);
    renderDraft();
    return;
  }
  const rect = [left / point.width, top / point.height, (left + width) / point.width, (top + height) / point.height];
  const draft = ensureDraft(documentId);
  draft.page = page;
  draft.rect = rect;
  draft.previewCanvas = makeRegionPreview(rect);
  draft.includeExcerpt = false;
  if (!draft.text.trim()) draft.text = t("regionCaption", { page });
  invalidateRequestId(draft);
  setRegionMode(false);
  highlightDraft(documentId, page, rect);
  workspace?.showNotes();
  clearStatus();
  renderDraft();
  assistant?.contextChanged();
  elements.noteText.focus();
}

function revealSavedNote(noteId) {
  const item = elements.notesList.querySelector(`[data-note-id="${noteId}"]`);
  if (!item) return;
  if (window.matchMedia("(max-width: 820px)").matches) {
    item.scrollIntoView({ block: "nearest" });
    return;
  }

  const pane = elements.notesPanel;
  const focused = window.document.activeElement;
  const keepKeyboardFocus = focused && pane.contains(focused) && focused.matches(":focus-visible");
  const paneBounds = pane.getBoundingClientRect();
  const itemBounds = item.getBoundingClientRect();
  const itemTop = itemBounds.top - paneBounds.top + pane.scrollTop - 4;
  const itemBottom = itemBounds.bottom - paneBounds.top + pane.scrollTop + 4;
  if (itemTop < pane.scrollTop) pane.scrollTop = itemTop;
  else if (itemBottom > pane.scrollTop + pane.clientHeight) pane.scrollTop = itemBottom - pane.clientHeight;

  if (keepKeyboardFocus) {
    const focusedBounds = focused.getBoundingClientRect();
    if (focusedBounds.top < paneBounds.top || focusedBounds.bottom > paneBounds.bottom) {
      item.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    }
  }
}

async function submitSave(includeExcerpt = false) {
  if (!state.document || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  if (state.editDrafts.has(state.document.id)) {
    await submitEditSave();
    return;
  }
  captureCurrentDraft();
  const document = state.document;
  const draft = ensureDraft(document.id);
  if (draft.page === null) {
    setStatus("selectSource", "error");
    return;
  }
  if (!draft.text.trim()) return;
  const includeImage = draft.includeExcerpt || includeExcerpt;
  if (includeImage && !draft.rect) {
    setStatus("region_required", "error");
    return;
  }
  draft.includeExcerpt = includeImage;
  if (!draft.requestId) {
    draft.requestId = crypto.randomUUID();
    draft.imageRequestIds = imageLibrary?.getNoteSelection(document.id) || [];
  }

  const requestId = draft.requestId;
  const imageIds = [...(draft.imageRequestIds || [])];
  const payload = {
    request_id: requestId,
    page: draft.page,
    rect: draft.rect ? [...draft.rect] : null,
    text: draft.text.trim()
  };
  if (draft.richContent) payload.rich_content = JSON.parse(JSON.stringify(draft.richContent));
  if (imageIds.length) payload.image_ids = imageIds;
  let noteSaved = false;
  state.pendingSaves += 1;
  draft.saveFailed = false;
  draft.imageFailed = false;
  renderDocumentDetails();
  renderDraft();
  setStatus(includeImage ? "savingImage" : "saving");

  try {
    const endpoint = imageIds.length ? "image-notes" : "notes";
    const note = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    noteSaved = true;
    if (state.document?.id === document.id) {
      state.notes = [note, ...state.notes.filter((item) => item.id !== note.id)];
      const existingState = noteStateFor(note.id);
      const noteState = existingState || {
        ...note,
        revision: 1,
        review_status: "unreviewed",
        reviewed_at: null,
        review_provenance: null,
        updated_at: note.created_at,
        deleted_at: null
      };
      state.noteStates = [noteState, ...state.noteStates.filter((item) => item.id !== note.id)];
      renderNotes();
      if (payload.rich_content) await loadNoteStates(document, state.loadSequence, state.loadController?.signal);
    }

    if (includeImage) {
      setStatus("creatingExcerpt");
      const excerpt = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/notes/${encodeURIComponent(note.id)}/excerpt`, {
        method: "POST"
      });
      if (state.document?.id === document.id) {
        state.excerpts = [excerpt, ...state.excerpts.filter((item) => item.note_id !== note.id)];
      }
    }

    const currentDraft = ensureDraft(document.id);
    if (currentDraft.requestId === requestId) {
      state.drafts.set(document.id, makeEmptyDraft());
      imageLibrary?.clearNoteSelection(document.id, imageIds);
    }
    if (imageIds.length || includeImage) imageLibrary?.reload(document.id);
    if (state.document?.id === document.id) {
      state.highlight = note;
      renderNotes();
      renderDraft();
      drawHighlight();
      if (includeImage) {
        workspace?.showNotes();
        requestAnimationFrame(() => {
          if (state.document?.id === document.id) revealSavedNote(note.id);
        });
      }
    }
    setStatus(includeImage ? "savedImage" : "saved", "success");
  } catch (error) {
    const currentDraft = ensureDraft(document.id);
    const imageFailed = noteSaved && includeImage;
    if (currentDraft.requestId === requestId) {
      currentDraft.saveFailed = true;
      currentDraft.imageFailed = imageFailed;
      currentDraft.includeExcerpt = includeImage;
    }
    setStatus(imageFailed ? "noteSavedImageFailed" : error.code || "request_failed", "error", {}, async () => {
      if (state.document?.id !== document.id) await openDocument(document.id, { force: true });
      await submitSave(includeImage);
    });
  } finally {
    state.pendingSaves -= 1;
    renderDocumentDetails();
    renderDraft();
    renderNotes();
  }
}

function startEditNote(document, note) {
  const noteState = noteStateFor(note.id);
  if (!noteState || state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.pendingExcerpts.size > 0 || state.editDrafts.has(document.id)) return;
  richText?.close({ restoreFocus: false });
  captureCurrentDraft();
  setRegionMode(false);
  state.editDrafts.set(document.id, {
    noteId: note.id,
    note: { ...note },
    text: note.text,
    richContent: noteState.rich_content ? JSON.parse(JSON.stringify(noteState.rich_content)) : null,
    richContentChanged: false,
    expectedRevision: noteState.revision,
    requestId: null,
    saveFailed: false,
    conflicted: false
  });
  clearStatus();
  renderDocumentDetails();
  renderDraft();
  renderNotes();
  elements.noteText.focus();
}

function cancelEditNote() {
  if (!state.document) return;
  const editDraft = state.editDrafts.get(state.document.id);
  if (!editDraft || state.pendingMutations.has(mutationKey(state.document.id, editDraft.noteId))) return;
  richText?.close({ restoreFocus: false });
  state.editDrafts.delete(state.document.id);
  clearStatus();
  renderDocumentDetails();
  renderDraft();
  renderNotes();
  elements.noteText.focus();
}

async function submitEditSave() {
  if (!state.document || state.pendingMutations.size > 0) return;
  captureCurrentDraft();
  const document = state.document;
  const draft = state.editDrafts.get(document.id);
  if (!draft || !draft.text.trim()) return;
  if (draft.conflicted) {
    setStatus("revisionConflict", "error", {}, () => refreshLatest(document), "viewLatest");
    return;
  }
  if (!draft.requestId) draft.requestId = crypto.randomUUID();
  const operation = {
    document,
    noteId: draft.noteId,
    action: "edit",
    method: "PATCH",
    path: `/api/v1/documents/${encodeURIComponent(document.id)}/notes/${encodeURIComponent(draft.noteId)}`,
    payload: {
      request_id: draft.requestId,
      expected_revision: draft.expectedRevision,
      text: draft.text.trim()
    },
    pendingStatus: "editSaving",
    successStatus: "editSaved"
  };
  if (draft.richContentChanged) operation.payload.rich_content = draft.richContent ? JSON.parse(JSON.stringify(draft.richContent)) : null;
  await runMutation(operation);
}

function makeLifecycleMutation(document, note, action, change = {}) {
  const noteState = noteStateFor(note.id);
  if (!noteState) return null;
  const basePath = `/api/v1/documents/${encodeURIComponent(document.id)}/notes/${encodeURIComponent(note.id)}`;
  const labels = {
    review: ["reviewSaving", noteState.review_status === "source_checked" ? "reviewUnmarked" : "reviewSaved"],
    delete: ["deleting", "deleted"],
    restore: ["restoring", "restored"],
    purge: ["purging", "purged"]
  }[action];
  return {
    document,
    noteId: note.id,
    action,
    method: action === "delete" ? "DELETE" : ["restore", "purge"].includes(action) ? "POST" : "PATCH",
    path: ["restore", "purge"].includes(action) ? `${basePath}/${action}` : basePath,
    payload: {
      request_id: crypto.randomUUID(),
      expected_revision: noteState.revision,
      ...change
    },
    pendingStatus: labels[0],
    successStatus: labels[1]
  };
}

async function reviewNote(document, note) {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(document.id)) return;
  const key = mutationKey(document.id, note.id);
  const failed = state.failedMutations.get(key);
  if (failed?.action === "review" && !failed.conflicted) {
    await runMutation(failed);
    return;
  }
  if (failed?.conflicted) state.failedMutations.delete(key);
  const noteState = noteStateFor(note.id);
  if (!noteState) return;
  const reviewStatus = noteState.review_status === "source_checked" ? "unreviewed" : "source_checked";
  const operation = makeLifecycleMutation(document, note, "review", { review_status: reviewStatus });
  if (operation) await runMutation(operation);
}

async function deleteNote(document, note) {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(document.id)) return;
  const key = mutationKey(document.id, note.id);
  const failed = state.failedMutations.get(key);
  if (failed?.action === "delete" && !failed.conflicted) {
    await runMutation(failed);
    return;
  }
  if (failed?.conflicted) state.failedMutations.delete(key);
  if (!window.confirm(t("deleteConfirm"))) return;
  const operation = makeLifecycleMutation(document, note, "delete");
  if (operation) await runMutation(operation);
}

async function restoreNote(document, note) {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(document.id)) return;
  const key = mutationKey(document.id, note.id);
  const failed = state.failedMutations.get(key);
  if (failed?.action === "restore" && !failed.conflicted) {
    await runMutation(failed);
    return;
  }
  if (failed?.conflicted) state.failedMutations.delete(key);
  const operation = makeLifecycleMutation(document, note, "restore");
  if (operation) await runMutation(operation);
}

async function purgeNote(document, note) {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(document.id)) return;
  const key = mutationKey(document.id, note.id);
  const failed = state.failedMutations.get(key);
  if (failed?.action === "purge" && !failed.conflicted) {
    await runMutation(failed);
    return;
  }
  if (failed?.conflicted) state.failedMutations.delete(key);
  if (!window.confirm(t("purgeConfirm"))) return;
  const operation = makeLifecycleMutation(document, note, "purge");
  if (operation) await runMutation(operation);
}

function applyNotePurge(document, noteId) {
  state.search.notes = state.search.notes.filter((item) => item.id !== noteId || item.document_id !== document.id);
  imageViewer?.clearSource(document.id, "pdf_excerpt", noteId);
  imageLibrary?.reload(document.id);
  if (state.document?.id !== document.id) return;
  state.noteStates = state.noteStates.filter((item) => item.id !== noteId);
  state.notes = state.notes.filter((item) => item.id !== noteId);
  state.excerpts = state.excerpts.filter((item) => item.note_id !== noteId);
  if (state.highlight?.id === noteId) {
    state.highlight = null;
    state.highlightRevealId = null;
    clearHighlights();
  }
  const urlNoteId = new URLSearchParams(window.location.search).get("note");
  if (urlNoteId === noteId) updateUrl(document.id);
}

function applyMutationState(operation, savedState) {
  const { document, noteId, action } = operation;
  if (state.document?.id !== document.id) return;
  state.noteStates = [savedState, ...state.noteStates.filter((item) => item.id !== noteId)];
  if (savedState.deleted_at) {
    state.notes = state.notes.filter((item) => item.id !== noteId);
    if (state.highlight?.id === noteId) {
      state.highlight = null;
      state.highlightRevealId = null;
      clearHighlights();
    }
    const urlNoteId = new URLSearchParams(window.location.search).get("note");
    if (urlNoteId === noteId) updateUrl(document.id);
  } else {
    const note = {
      id: savedState.id,
      document_id: savedState.document_id,
      page: savedState.page,
      rect: savedState.rect,
      text: savedState.text,
      created_at: savedState.created_at
    };
    state.notes = [note, ...state.notes.filter((item) => item.id !== noteId)];
    if (state.highlight?.id === noteId) state.highlight = note;
  }
  renderNotes();
  renderDraft();
  if (action === "restore") {
    const retry = async () => {
      try {
        await loadExcerpts(document, state.loadSequence, state.loadController?.signal);
        clearStatus();
      } catch (error) {
        setStatus(error.code || "excerptsLoadFailed", "error", {}, retry);
      }
    };
    loadExcerpts(document, state.loadSequence, state.loadController?.signal).catch((error) => {
      setStatus(error.code || "excerptsLoadFailed", "error", {}, retry);
    });
  }
}

async function runMutation(operation) {
  const { document, noteId, action } = operation;
  const key = mutationKey(document.id, noteId);
  if (state.pendingMutations.has(key)) return;
  state.pendingMutations.set(key, operation);
  const editDraft = state.editDrafts.get(document.id);
  if (action === "edit" && editDraft?.noteId === noteId) editDraft.saveFailed = false;
  renderDocumentDetails();
  renderDraft();
  renderNotes();
  setStatus(operation.pendingStatus);

  try {
    const savedState = await api(operation.path, {
      method: operation.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload)
    });
    if (action === "purge") {
      if (savedState?.purged !== true || savedState.id !== noteId || savedState.document_id !== document.id) throw new ApiError("request_failed");
      applyNotePurge(document, noteId);
    } else {
      applyMutationState(operation, savedState);
    }
    state.failedMutations.delete(key);
    if (action === "edit") {
      const currentDraft = state.editDrafts.get(document.id);
      if (currentDraft?.requestId === operation.payload.request_id) state.editDrafts.delete(document.id);
    }
    renderDocumentDetails();
    renderDraft();
    renderNotes();
    setStatus(operation.successStatus, "success");
  } catch (error) {
    const conflicted = error.code === "revision_conflict";
    if (action === "edit") {
      const currentDraft = state.editDrafts.get(document.id);
      if (currentDraft?.requestId === operation.payload.request_id) {
        currentDraft.saveFailed = true;
        currentDraft.conflicted = conflicted;
      }
    } else {
      state.failedMutations.set(key, { ...operation, conflicted });
    }
    if (conflicted) {
      setStatus("revisionConflict", "error", {}, () => refreshLatest(document), "viewLatest");
    } else {
      const key = action === "purge" && error.code === "storage_unavailable" ? "purgeStorageUnavailable" : error.code || "request_failed";
      setStatus(key, "error", {}, () => retryMutation(operation));
    }
  } finally {
    state.pendingMutations.delete(key);
    renderDocumentDetails();
    renderDraft();
    renderNotes();
  }
}

async function retryMutation(operation) {
  if (state.document?.id !== operation.document.id) {
    await openDocument(operation.document.id, { force: true });
  }
  await runMutation(operation);
}

async function refreshLatest(document) {
  if (state.document?.id !== document.id) {
    await openDocument(document.id, { force: true });
    return;
  }
  const sequence = state.loadSequence;
  try {
    await Promise.all([
      loadNotes(document, sequence, state.loadController?.signal),
      loadNoteStates(document, sequence, state.loadController?.signal),
      loadExcerpts(document, sequence, state.loadController?.signal)
    ]);
    clearStatus();
    renderDraft();
  } catch (error) {
    setStatus(error.code || "request_failed", "error", {}, () => refreshLatest(document), "viewLatest");
  }
}

async function createExcerpt(document, note) {
  if (!note.rect) {
    setStatus("region_required", "error");
    return;
  }
  const key = excerptPendingKey(document.id, note.id);
  if (state.pendingExcerpts.has(key) || state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(document.id)) return;
  state.pendingExcerpts.add(key);
  renderDocumentDetails();
  renderNotes();
  setStatus("creatingExcerpt");
  try {
    const excerpt = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/notes/${encodeURIComponent(note.id)}/excerpt`, {
      method: "POST"
    });
    if (state.document?.id === document.id) {
      state.excerpts = [excerpt, ...state.excerpts.filter((item) => item.note_id !== note.id)];
      renderNotes();
    }
    setStatus("excerptCreated", "success");
  } catch (error) {
    setStatus(error.code || "request_failed", "error", {}, () => createExcerpt(document, note));
  } finally {
    state.pendingExcerpts.delete(key);
    renderDocumentDetails();
    renderNotes();
  }
}

async function exportReadingRecord(document) {
  if (!document || isStudy(document) || richText?.isOpen() || state.pendingExports.size > 0 || state.pendingSaves > 0 || state.pendingExcerpts.size > 0 || state.pendingMutations.size > 0 || state.pendingMetadata.size > 0 || state.editDrafts.has(document.id) || ensureMetadata(document.id).draft) return;
  state.pendingExports.add(document.id);
  renderDocumentDetails();
  setStatus("exporting");
  try {
    const response = await checkedFetch(`/api/v1/documents/${encodeURIComponent(document.id)}/export`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    const base = (document.title || document.original_filename || t("readingRecord"))
      .replace(/[<>:"/\\|?*]/g, "_")
      .trim()
      .slice(0, 80);
    link.href = url;
    link.download = `${base || t("readingRecord")}.zip`;
    link.hidden = true;
    window.document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("exported", "success");
  } catch (error) {
    setStatus(error.code || "request_failed", "error", {}, () => exportReadingRecord(document));
  } finally {
    state.pendingExports.delete(document.id);
    renderDocumentDetails();
  }
}

async function uploadFile(file) {
  if (!file || state.pendingUpload) return;
  if (file.size > MAX_FILE_BYTES) {
    state.lastUpload = file;
    setStatus("file_too_large", "error", {}, () => uploadFile(file));
    return;
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("invalidFileType", "error");
    return;
  }

  state.pendingUpload = true;
  state.lastUpload = file;
  renderDocumentDetails();
  setStatus("uploading");
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("deduplicate", "true");
  try {
    const response = await checkedFetch("/api/v1/documents", { method: "POST", body: form });
    const status = response.status;
    if (status !== 200 && status !== 201) throw new ApiError("request_failed");
    let document;
    try {
      document = await response.json();
    } catch {
      throw new ApiError("request_failed");
    }
    state.lastUpload = null;
    if (status === 201) {
      state.documents = [document, ...state.documents.filter((item) => item.id !== document.id)];
    } else if (state.documents.some((item) => item.id === document.id)) {
      state.documents = state.documents.map((item) => item.id === document.id ? document : item);
    } else {
      state.documents = [document, ...state.documents];
    }
    renderDocuments();
    await openDocument(document.id, { force: true });
    setStatus(status === 200 ? "alreadyInLibrary" : "uploaded", "success");
  } catch (error) {
    setStatus(error.code || "request_failed", "error", {}, () => uploadFile(file));
  } finally {
    state.pendingUpload = false;
    renderDocumentDetails();
  }
}

async function openSample() {
  if (state.pendingUpload) return;
  state.pendingUpload = true;
  renderDocumentDetails();
  setStatus("uploadingSample");
  try {
    const response = await checkedFetch("/assets/sample.pdf");
    const blob = await response.blob();
    const file = new File([blob], "synrise-neuro-synthetic-sample.pdf", { type: "application/pdf" });
    state.pendingUpload = false;
    await uploadFile(file);
  } catch (error) {
    state.pendingUpload = false;
    renderDocumentDetails();
    setStatus(error.code || "request_failed", "error", {}, openSample);
  }
}

elements.language.addEventListener("click", () => {
  state.language = state.language === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("research-workbench-language", state.language);
  } catch {
    // Language still changes for this session when storage is unavailable.
  }
  applyLanguage();
});

elements.theme.addEventListener("change", () => {
  state.theme = elements.theme.value === "doraemon-blue" ? "doraemon-blue" : "default";
  applyTheme();
  try {
    localStorage.setItem("research-workbench-theme", state.theme);
  } catch {
    // Theme still changes for this session when storage is unavailable.
  }
});

elements.statusRetry.addEventListener("click", () => {
  const retry = state.status?.retry;
  if (retry) retry();
});

elements.documentMenu.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const documentId = state.documentMenu?.documentId;
  if (!documentId) return;
  if (action === "rename-document") void openRenameDialog(documentId);
  else if (action === "trash-document") void trashDocument(documentId);
});
document.addEventListener("pointerdown", (event) => {
  if (state.documentMenu && !elements.documentMenu.contains(event.target) && !event.target.closest('[data-action="document-menu"]')) closeDocumentMenu();
});
elements.libraryTrash.addEventListener("toggle", () => {
  if (elements.libraryTrash.open && !state.libraryTrash.loaded && !state.libraryTrash.pending) void loadLibraryTrash();
});
elements.renameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitRename();
});
elements.renameTitle.addEventListener("input", () => {
  const rename = state.rename;
  if (!rename || rename.pending) return;
  if (rename.operation && rename.operation.payload.title !== elements.renameTitle.value.trim()) rename.operation = null;
  rename.status = null;
  renderRenameDialog();
});
elements.renameCancel.addEventListener("click", closeRenameDialog);
elements.renameRetry.addEventListener("click", () => {
  const rename = state.rename;
  if (!rename || rename.pending) return;
  if (rename.operation) void submitRename();
  else void loadRenameMetadata(rename);
});
elements.renameDialog.addEventListener("cancel", (event) => {
  if (state.rename?.pending) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  closeRenameDialog();
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  performSearch(elements.searchInput.value);
});
elements.searchClear.addEventListener("click", clearSearch);
elements.searchRetry.addEventListener("click", () => {
  const retry = state.search.status?.retry;
  if (retry) retry();
});
elements.searchInput.addEventListener("input", () => {
  if (elements.searchInput.value.trim() === state.search.query) {
    renderSearch();
    return;
  }
  state.search.sequence += 1;
  state.search.controller?.abort();
  state.search.controller = null;
  state.search.query = "";
  state.search.documents = [];
  state.search.notes = [];
  state.search.hasMore = false;
  state.search.status = null;
  renderSearch();
});

elements.metadataEdit.addEventListener("click", startMetadataEdit);
elements.metadataCancel.addEventListener("click", cancelMetadataEdit);
elements.metadataForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.document) submitMetadataSave(state.document.id);
});
elements.metadataRetry.addEventListener("click", () => {
  if (!state.document) return;
  const entry = ensureMetadata(state.document.id);
  if (entry.status?.retry === "save") submitMetadataSave(state.document.id);
  else if (entry.status?.retry === "latest") loadMetadata(state.document, state.loadSequence, state.loadController?.signal, { viewLatest: true });
  else loadMetadata(state.document, state.loadSequence, state.loadController?.signal);
});
elements.metadataViewLatest.addEventListener("click", () => {
  if (state.document) loadMetadata(state.document, state.loadSequence, state.loadController?.signal, { viewLatest: true });
});
for (const [input, field] of [
  [elements.metadataTitle, "title"],
  [elements.metadataAuthors, "authors"],
  [elements.metadataYear, "year"],
  [elements.metadataDoi, "doi"]
]) {
  input.addEventListener("input", () => {
    if (!state.document) return;
    const entry = ensureMetadata(state.document.id);
    if (!entry.draft || entry.draft.conflicted || state.pendingMetadata.has(state.document.id)) return;
    entry.draft[field] = input.value;
    entry.draft.operation = null;
    entry.draft.saveFailed = false;
    entry.status = null;
    entry.latestVisible = false;
    renderDocumentDetails();
    renderMetadata();
  });
}

elements.uploadInput.addEventListener("change", () => {
  const file = elements.uploadInput.files?.[0];
  elements.uploadInput.value = "";
  if (file) uploadFile(file);
});

elements.uploadButton.addEventListener("click", () => {
  if (!state.pendingUpload) elements.uploadInput.click();
});
elements.sample.addEventListener("click", openSample);
elements.pagePrev.addEventListener("click", () => goToPage(state.page - 1));
elements.pageNext.addEventListener("click", () => goToPage(state.page + 1));
elements.pageInput.addEventListener("change", () => {
  if (!state.document) return;
  const page = Number(elements.pageInput.value);
  if (!Number.isInteger(page) || page < 1 || page > state.document.page_count) {
    elements.pageInput.value = String(state.page);
    setStatus("invalid_page", "error");
    return;
  }
  goToPage(page);
});
elements.pageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") elements.pageInput.blur();
});

function changeZoom(factor) {
  if (!state.pdf) return;
  state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.effectiveScale * factor));
  state.zoomMode = "manual";
  requestRender();
}

elements.zoomIn.addEventListener("click", () => changeZoom(1.2));
elements.zoomOut.addEventListener("click", () => changeZoom(1 / 1.2));
elements.zoomFit.addEventListener("click", () => {
  state.zoomMode = "fit";
  requestRender();
});
elements.exportReadingRecord.addEventListener("click", () => {
  if (state.document) exportReadingRecord(state.document);
});
elements.regionMode.addEventListener("click", () => setRegionMode(!state.regionActive));
elements.readerRegionMode.addEventListener("click", () => elements.regionMode.click());
elements.textSelectionNote.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || elements.textSelectionNote.disabled) return;
  event.preventDefault();
  state.capturedTextSelection = readPdfTextSelection();
});
elements.textSelectionNote.addEventListener("click", addTextSelectionToNote);
elements.regionDraftCancel.addEventListener("click", cancelRegionDraft);
elements.pageNote.addEventListener("click", () => {
  if (!state.document || !state.pdf || !prepareDraftReplacement(state.document.id)) return;
  const draft = ensureDraft(state.document.id);
  draft.page = state.page;
  draft.rect = null;
  draft.includeExcerpt = false;
  invalidateRequestId(draft);
  setRegionMode(false);
  highlightDraft(state.document.id, state.page, null);
  clearStatus();
  renderDraft();
  assistant?.contextChanged();
  elements.noteText.focus();
});
elements.noteText.addEventListener("input", () => {
  if (!state.document) return;
  const editDraft = state.editDrafts.get(state.document.id);
  if (editDraft) {
    editDraft.text = elements.noteText.value;
    editDraft.requestId = null;
    editDraft.saveFailed = false;
    clearStatus();
    elements.characterCount.textContent = `${editDraft.text.length} / 10000`;
    renderDraft();
    return;
  }
  const draft = ensureDraft(state.document.id);
  draft.text = elements.noteText.value;
  invalidateRequestId(draft);
  elements.characterCount.textContent = `${draft.text.length} / 10000`;
  renderDraft();
});
elements.noteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitSave();
});
elements.editCancel.addEventListener("click", cancelEditNote);
elements.excerptSave.addEventListener("click", () => submitSave(true));

elements.overlay.addEventListener("pointerdown", (event) => {
  if (!state.regionActive || event.button !== 0 || !state.document) return;
  event.preventDefault();
  const point = eventPoint(event);
  state.selection = {
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y
  };
  elements.overlay.setPointerCapture(event.pointerId);
  paintSelection(state.selection);
});
elements.overlay.addEventListener("pointermove", (event) => {
  const selection = state.selection;
  if (!selection || selection.pointerId !== event.pointerId) return;
  const point = eventPoint(event);
  selection.currentX = point.x;
  selection.currentY = point.y;
  paintSelection(selection);
});
elements.overlay.addEventListener("pointerup", finishSelection);
elements.overlay.addEventListener("pointercancel", cancelSelection);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.documentMenu) {
    event.preventDefault();
    closeDocumentMenu(true);
  } else if (state.regionActive) {
    setRegionMode(false);
  }
});

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const studyId = params.get("study");
  const documentId = studyId || params.get("document");
  const noteId = params.get("note");
  const analysisId = params.get("analysis");
  const datasetId = params.get("dataset");
  const chartId = params.get("chart");
  const hasExplicitMode = params.has("workspace") || ["note", "analysis", "dataset", "chart", "image_source"].some((key) => params.has(key));
  const mode = studyId && !hasExplicitMode ? "data" : workspace?.modeForParams(params) || "reading";
  const tool = chartId || params.get("tool") === "charts" ? "charts" : "analysis";
  const imageLink = studyId ? null : readImageLink(params);
  workspace?.reveal(mode, { tool, showNotes: mode === "reading" && Boolean(noteId || imageLink), focus: false });
  if (!documentId) {
    captureCurrentDraft();
    captureCurrentMetadataDraft();
    cancelDocumentWork();
    state.document = null;
    state.notes = [];
    state.noteStates = [];
    state.noteStatesLoaded = false;
    state.excerpts = [];
    state.highlight = null;
    study?.documentChanged(null);
    renderDocuments();
    renderDocumentDetails();
    renderMetadata();
    renderDraft();
    renderNotes();
    imageLibrary?.documentChanged(null);
    analysis?.reload(null);
    dataImports?.reload(null);
    charts?.reload(null);
    assistant?.documentChanged(null);
    workspace?.documentChanged();
    if (imageLink === false) setStatus("invalidImageLink", "error");
    return;
  }
  if (imageLink === false) setStatus("invalidImageLink", "error");
  if (state.document?.id === documentId) {
    if (mode === "reading" && imageLink) openImageViewer(documentId, imageLink.kind, imageLink.sourceId, { annotationId: imageLink.annotationId });
    else {
      imageViewer?.close({ restoreFocus: false });
      if (mode === "reading" && noteId) openNote(noteId, { preserveUrl: true });
    }
    if (mode === "data" && datasetId) analysis?.openDataset(datasetId, { preserveUrl: true, preserveFocus: true });
    if (mode === "data" && analysisId) analysis?.openJob(analysisId, { preserveUrl: true, preserveFocus: true });
    if (mode === "data" && chartId) charts?.openChart(documentId, chartId, { preserveUrl: true });
  } else {
    openDocument(documentId, {
      ownerKind: studyId ? "study" : "paper",
      noteId: mode === "reading" ? noteId : null,
      analysisId: mode === "data" ? analysisId : null,
      datasetId: mode === "data" ? datasetId : null,
      chartId: mode === "data" ? chartId : null,
      imageLink: mode === "reading" ? imageLink || null : null,
      workspace: mode,
      tool,
      preserveUrl: true
    });
  }
});

let observedStageWidth = null;
const resizeObserver = new ResizeObserver(() => {
  if (state.resizeFrame) cancelAnimationFrame(state.resizeFrame);
  state.resizeFrame = requestAnimationFrame(() => {
    const width = elements.readerStage.clientWidth;
    if (width === observedStageWidth) return;
    observedStageWidth = width;
    if (!width) return;
    if (state.zoomMode === "fit" && state.pdf) requestRender();
    else drawHighlight();
  });
});
resizeObserver.observe(elements.readerStage);

function assistantContext() {
  const studyOwner = isStudy();
  const context = { page: studyOwner ? null : state.page, rect: null, activeNoteId: null, activeImage: null, dataset_id: analysis?.getSharedDatasetId() || null, activeAnalysisId: analysis?.getActiveAnalysisId() || null, activeChartId: null };
  if (!state.document) return context;
  if (!studyOwner) context.activeImage = imageViewer?.getActiveContext(state.document.id) || null;
  context.activeChartId = charts?.getActiveChartId(state.document.id) || null;
  if (studyOwner) return context;
  if (state.highlight?.document_id === state.document.id && state.highlight.page === state.page) {
    context.rect = state.highlight.rect ? [...state.highlight.rect] : null;
    context.activeNoteId = state.notes.some((note) => note.id === state.highlight.id) ? state.highlight.id : null;
    return context;
  }
  const draft = ensureDraft(state.document.id);
  if (draft.page === state.page) context.rect = draft.rect ? [...draft.rect] : null;
  return context;
}

async function navigateAssistantSource(source) {
  if (!source?.document_id) return;
  const attached = source.source;
  if (attached?.kind === "study") {
    await openDocument(source.document_id, { ownerKind: "study", workspace: "reading" });
    return;
  }
  if (attached?.kind === "dataset") source = { ...source, kind: "dataset_sample", dataset_id: attached.id };
  else if (attached?.kind === "analysis") source = { ...source, kind: "analysis_result", analysis_id: attached.id };
  else if (attached?.kind === "chart") source = { ...source, kind: "chart_result", chart_id: attached.id };
  if (source.kind === "study_context") {
    await openDocument(source.document_id, { ownerKind: "study", workspace: "reading" });
    return;
  }
  if (source.kind === "data") source = { ...source, kind: "dataset_sample", dataset_id: source.dataset_id || source.id };
  if (source.kind === "analysis") source = { ...source, kind: "analysis_result", analysis_id: source.analysis_id || source.id };
  if (source.kind === "chart") source = { ...source, kind: "chart_result", chart_id: source.chart_id || source.id };
  if (source.kind === "dataset_sample") {
    if (!source.dataset_id) return;
    if (state.document?.id !== source.document_id) await openDocument(source.document_id, { datasetId: source.dataset_id });
    else {
      workspace?.reveal("data", { tool: "analysis" });
      await analysis?.openDataset(source.dataset_id);
    }
    return;
  }
  if (source.kind === "analysis_result") {
    if (!source.analysis_id) return;
    await openAnalysisJob(source.document_id, source.analysis_id);
    return;
  }
  if (source.kind === "chart_result") {
    if (!source.chart_id) return;
    await openChart(source.document_id, source.chart_id);
    return;
  }
  if (source.kind === "image_annotation") {
    if (!source.source_kind || !source.source_id) return;
    await openImageViewer(source.document_id, source.source_kind, source.source_id, { annotationId: source.annotation_id || null });
    return;
  }
  if (source.kind === "user_upload") {
    if (!source.image_id) return;
    const previewPath = `/api/v1/documents/${encodeURIComponent(source.document_id)}/images/${encodeURIComponent(source.image_id)}/preview`;
    window.open(new URL(previewPath, window.location.origin).href, "_blank", "noopener,noreferrer");
    return;
  }
  if (state.document?.id !== source.document_id) {
    await openDocument(source.document_id, { noteId: source.note_id || null });
  }
  if (state.document?.id !== source.document_id) return;
  if (source.note_id) {
    openNote(source.note_id);
    return;
  }
  state.highlight = {
    id: `assistant-source-${crypto.randomUUID()}`,
    document_id: source.document_id,
    page: source.page,
    rect: source.rect ? [...source.rect] : null
  };
  state.highlightRevealId = null;
  updateUrl(source.document_id);
  await goToPage(source.page, { preserveHighlight: true });
}

async function openImageProposal(documentId, proposal) {
  const payload = proposal?.payload;
  if (!payload?.source_kind || !payload?.source_id) return;
  await openImageViewer(documentId, payload.source_kind, payload.source_id, {
    annotationId: payload.annotation_id || null,
    proposal
  });
}

async function refreshAfterAgent(documentId) {
  const studyOwner = state.document?.id === documentId && isStudy();
  const tasks = studyOwner ? [] : [imageLibrary?.reload(documentId), imageViewer?.refreshIfCurrent(documentId)];
  tasks.push(state.document?.id === documentId ? analysis?.reload(documentId) : null, state.document?.id === documentId ? charts?.reload(documentId) : null);
  if (state.document?.id === documentId) {
    const document = state.document;
    const sequence = state.loadSequence;
    const signal = state.loadController?.signal;
    tasks.push(loadNoteStates(document, sequence, signal));
    if (!studyOwner) tasks.push(loadExcerpts(document, sequence, signal), loadMetadata(document, sequence, signal));
  }
  const results = await Promise.allSettled(tasks.filter(Boolean));
  if (state.document?.id === documentId && results.some((result) => result.status === "rejected")) {
    setStatus("request_failed", "error", {}, () => refreshAfterAgent(documentId));
  }
  await assistant?.refreshConversations(documentId);
}

function showDatasetInUrl(documentId, datasetId) {
  if (state.document?.id !== documentId || workspace?.getMode() !== "data" || workspace?.getTool() !== "analysis") return;
  const url = new URL(window.location.href);
  const replace = url.searchParams.get(isStudy() ? "study" : "document") === documentId && url.searchParams.get("dataset") === datasetId;
  setOwnerInUrl(url, documentId);
  url.searchParams.set("dataset", datasetId);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "analysis");
  for (const key of ["note", "analysis", "chart", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

function showAnalysisInUrl(documentId, analysisId) {
  if (state.document?.id !== documentId || workspace?.getMode() !== "data" || workspace?.getTool() !== "analysis") return;
  const url = new URL(window.location.href);
  const replace = url.searchParams.get(isStudy() ? "study" : "document") === documentId && url.searchParams.get("analysis") === analysisId;
  setOwnerInUrl(url, documentId);
  url.searchParams.set("analysis", analysisId);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "analysis");
  for (const key of ["dataset", "note", "chart", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

async function openAnalysisJob(documentId, analysisId) {
  if (!analysisId) return;
  if (state.document?.id !== documentId) await openDocument(documentId, { analysisId });
  else {
    workspace?.reveal("data", { tool: "analysis" });
    await analysis?.openJob(analysisId);
  }
}

function showChartInUrl(documentId, chartId) {
  if (state.document?.id !== documentId || workspace?.getMode() !== "data" || workspace?.getTool() !== "charts") return;
  const url = new URL(window.location.href);
  const replace = url.searchParams.get(isStudy() ? "study" : "document") === documentId && url.searchParams.get("chart") === chartId;
  setOwnerInUrl(url, documentId);
  url.searchParams.set("chart", chartId);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "charts");
  for (const key of ["note", "analysis", "dataset", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

async function openChart(documentId, chartId) {
  if (!chartId) return;
  if (state.document?.id !== documentId) await openDocument(documentId, { chartId });
  else {
    workspace?.reveal("data", { tool: "charts" });
    await charts?.openChart(documentId, chartId);
  }
}

async function addAnalysisCitation(documentId, job) {
  if (state.document?.id !== documentId) await openDocument(documentId);
  if (state.document?.id !== documentId || state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(documentId)) return false;
  const url = new URL(window.location.origin + "/");
  setOwnerInUrl(url, documentId);
  url.searchParams.set("analysis", job.id);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "analysis");
  const isPaired = job.method === "ttest_paired";
  const method = job.method === "ttest_independent" ? "Independent-samples t-test" : isPaired ? "Paired t-test" : "Descriptive analysis";
  let citation = `Analysis: ${method} · ${job.dataset_name}\n${url.pathname}${url.search}`;
  if (isPaired) {
    const result = job.result || {};
    const test = result.test || {};
    const pairing = result.pairing || {};
    const columns = Array.isArray(test.columns) ? test.columns : Array.isArray(pairing.columns) ? pairing.columns : job.columns || [];
    const first = columns[0] || "—";
    const second = columns[1] || "—";
    const unit = test.unit_column || pairing.unit_column || job.paired?.unit_column || "—";
    const counts = result.counts || {};
    citation = `Analysis: ${method} · ${job.dataset_name}\nPaired columns: ${first}, ${second}\nUnit ID: ${unit}\nDifference (first − second): ${first} − ${second}\nComplete pairs: ${counts.used ?? "—"} · Excluded pairs: ${counts.excluded ?? "—"}\n${url.pathname}${url.search}`;
  }
  if (isStudy()) {
    workspace?.showNotes();
    return study?.addCitation("analysis", job, citation) || false;
  }
  const draft = ensureDraft(documentId);
  if (draft.text.includes(`analysis=${job.id}`)) return true;
  const separator = draft.text ? (draft.text.endsWith("\n") ? "\n" : "\n\n") : "";
  draft.text += `${separator}${citation}`;
  if (draft.richContent && Array.isArray(draft.richContent.ops)) {
    const ops = JSON.parse(JSON.stringify(draft.richContent.ops));
    const last = ops.at(-1);
    if (typeof last?.insert === "string" && last.insert.endsWith("\n")) {
      last.insert = last.insert.slice(0, -1);
      if (!last.insert && !last.attributes) ops.pop();
    }
    ops.push({ insert: `${separator}${citation}\n` });
    draft.richContent.ops = ops;
  }
  invalidateRequestId(draft);
  workspace?.showNotes();
  renderDraft();
  elements.noteText.focus();
  return true;
}

async function addChartCitation(documentId, chart) {
  if (state.document?.id !== documentId) await openDocument(documentId);
  if (state.document?.id !== documentId || state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(documentId)) return false;
  const url = new URL(window.location.origin + "/");
  setOwnerInUrl(url, documentId);
  url.searchParams.set("chart", chart.id);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "charts");
  const citation = `Chart: ${chart.title}\n${url.pathname}${url.search}`;
  if (isStudy()) {
    workspace?.showNotes();
    return study?.addCitation("chart", chart, citation) || false;
  }
  const draft = ensureDraft(documentId);
  if (draft.text.includes(`chart=${chart.id}`)) return true;
  const separator = draft.text ? (draft.text.endsWith("\n") ? "\n" : "\n\n") : "";
  draft.text += `${separator}${citation}`;
  if (draft.richContent && Array.isArray(draft.richContent.ops)) {
    const ops = JSON.parse(JSON.stringify(draft.richContent.ops));
    const last = ops.at(-1);
    if (typeof last?.insert === "string" && last.insert.endsWith("\n")) {
      last.insert = last.insert.slice(0, -1);
      if (!last.insert && !last.attributes) ops.pop();
    }
    ops.push({ insert: `${separator}${citation}\n` });
    draft.richContent.ops = ops;
  }
  invalidateRequestId(draft);
  workspace?.showNotes();
  renderDraft();
  elements.noteText.focus();
  return true;
}

function currentRichTextScope() {
  if (!state.document) return null;
  const editDraft = state.editDrafts.get(state.document.id);
  return {
    documentId: state.document.id,
    noteId: editDraft?.noteId || null,
    revision: editDraft?.expectedRevision || null
  };
}

function matchingRichTextDraft(scope) {
  const current = currentRichTextScope();
  if (!scope || !current || scope.documentId !== current.documentId || scope.noteId !== current.noteId || scope.revision !== current.revision) return null;
  return state.editDrafts.get(state.document.id) || ensureDraft(state.document.id);
}

function applyRichTextDraft(scope, result) {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0) return false;
  const draft = matchingRichTextDraft(scope);
  if (!draft) return false;
  const editDraft = state.editDrafts.get(state.document.id);
  draft.text = result.text;
  draft.richContent = JSON.parse(JSON.stringify(result.richContent));
  if (editDraft) {
    draft.richContentChanged = true;
    draft.requestId = null;
    draft.saveFailed = false;
  } else {
    invalidateRequestId(draft);
  }
  clearStatus();
  renderDocumentDetails();
  renderDraft();
  return true;
}

function convertRichDraftToPlain() {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  const draft = matchingRichTextDraft(currentRichTextScope());
  if (!draft?.richContent) return;
  const editDraft = state.editDrafts.get(state.document.id);
  draft.richContent = null;
  if (editDraft) {
    draft.richContentChanged = true;
    draft.requestId = null;
    draft.saveFailed = false;
  } else {
    invalidateRequestId(draft);
  }
  clearStatus();
  renderDraft();
  elements.noteText.focus();
}

workspace = createWorkspace({
  getDocument: () => state.document,
  getLanguage: () => state.language,
  readingVisible: () => {
    if (state.pdf) requestRender();
  },
  toolVisible: (tool) => {
    if (tool === "charts") charts?.refreshLayout();
  },
  chartsSelected: (documentId) => charts?.reload(documentId),
  navigationChanged: () => researchRecord?.navigationChanged()
});

richText = createRichText({
  getLanguage: () => state.language,
  getScope: currentRichTextScope,
  getDraft: matchingRichTextDraft,
  applyDraft: applyRichTextDraft,
  convertToPlain: convertRichDraftToPlain,
  onOpenChange: () => {
    renderDocumentDetails();
    renderDraft();
  }
});

imageLibrary = createImageLibrary({
  api,
  checkedFetch,
  getDocument: () => state.document,
  getLanguage: () => state.language,
  invalidateDraftRequest: (documentId) => {
    const draft = ensureDraft(documentId);
    invalidateRequestId(draft);
    if (state.document?.id === documentId) renderDraft();
  },
  notesChanged: () => renderNotes(),
  contextChanged: () => assistant?.contextChanged(),
  openImage: openImageViewer
});

imageViewer = createImageViewer({
  api,
  checkedFetch,
  getDocument: () => state.document,
  getLanguage: () => state.language,
  isImageShared: (documentId, imageId) => imageLibrary.getChatSelection(documentId).includes(imageId),
  contextChanged: () => assistant?.contextChanged(),
  imageOpened: showImageInUrl,
  imageClosed: clearImageInUrl,
  navigateNote: async (documentId, noteId) => {
    if (state.document?.id !== documentId) await openDocument(documentId, { noteId });
    else openNote(noteId);
  }
});

analysis = createAnalysis({
  api,
  checkedFetch,
  getDocument: () => state.document,
  getLanguage: () => state.language,
  getNavigationGeneration: () => workspace.getNavigationGeneration(),
  contextChanged: () => assistant?.contextChanged(),
  onJobOpened: showAnalysisInUrl,
  onDatasetOpened: showDatasetInUrl,
  startImport: (file) => dataImports?.startImport(file),
  isImportPending: () => dataImports?.isImportPending() || false,
  datasetContextChanged: (documentId, datasetId, analysisId) => {
    researchRecord?.sourceChanged();
    charts?.syncDataset(documentId, datasetId, analysisId);
    if (state.document?.id === documentId && isStudy()) study?.sourceContextChanged();
  },
  datasetSelectionChanged: (documentId, dataset) => datasetSelection?.sync(documentId, dataset),
  addAnalysisCitation,
  planAnalysis(documentId, datasetId, navigationGeneration) {
    if (state.document?.id !== documentId || analysis.getSelectedDatasetId() !== datasetId || analysis.getSharedDatasetId() !== datasetId || navigationGeneration !== workspace.getNavigationGeneration()) return false;
    return assistant?.planAnalysis(documentId, datasetId, navigationGeneration) || false;
  },
  sourcesChanged: (documentId) => {
    if (state.document?.id === documentId) charts?.reload(documentId);
  }
});

datasetSelection = createDatasetSelection({
  api,
  checkedFetch,
  getLanguage: () => state.language,
  acceptDataset: (documentId, dataset, options) => {
    analysis.openImportedDataset(documentId, dataset, options);
    if (state.document?.id === documentId) charts?.reload(documentId);
  }
});

dataImports = createDataImports({
  api,
  checkedFetch,
  getLanguage: () => state.language,
  getNavigationGeneration: () => workspace.getNavigationGeneration(),
  reviewVisibilityChanged: (documentId, open, reveal) => workspace.setImportReview(documentId, open, reveal),
  importStateChanged: () => analysis.refreshUpload(),
  datasetConfirmed: (documentId, dataset, navigationGeneration) => {
    analysis.openImportedDataset(documentId, dataset, { select: navigationGeneration === workspace.getNavigationGeneration() });
    if (state.document?.id === documentId) charts?.reload(documentId);
  }
});

charts = createCharts({
  api,
  checkedFetch,
  getDocument: () => state.document,
  getLanguage: () => state.language,
  getNavigationGeneration: () => workspace.getNavigationGeneration(),
  getSelectedDatasetId: () => analysis.getSelectedDatasetId(),
  getSharedDatasetId: () => analysis.getSharedDatasetId(),
  datasetContextChanged: (documentId, datasetId) => {
    if (state.document?.id === documentId && datasetId) analysis.alignDataset(datasetId);
  },
  contextChanged: () => assistant?.contextChanged(),
  chartOpened: showChartInUrl,
  addChartCitation
});

researchRecord = createResearchRecord({
  api,
  checkedFetch,
  getDocument: () => state.document,
  getSelectedDataset: () => analysis.getSelectedDataset(),
  getLanguage: () => state.language,
  getNavigationGeneration: () => workspace.getNavigationGeneration(),
  sourceMismatch: (key) => setStatus(key, "error")
});

study = createStudy({
  api,
  getDocument: () => state.document,
  getDocuments: () => state.documents,
  getLanguage: () => state.language,
  getNavigationGeneration: () => workspace.getNavigationGeneration(),
  getSelectedDataset: () => analysis.getSelectedDataset(),
  getNotes: () => state.notes,
  getNoteStates: () => state.noteStates,
  openDocument,
  openStudySource: (documentId, source) => navigateAssistantSource({ document_id: documentId, source }),
  async refreshNotes(owner) {
    if (state.document?.id !== owner.id) return;
    await loadNoteStates(owner, state.loadSequence, state.loadController?.signal);
  },
  studyCreated(owner) {
    state.studies = [owner, ...state.studies.filter((item) => item.id !== owner.id)];
  },
  noteCreated(owner, note) {
    if (state.document?.id !== owner.id) return;
    state.notes = [note, ...state.notes.filter((item) => item.id !== note.id)];
    const noteState = {
      ...note,
      revision: note.revision || 1,
      review_status: note.review_status || "unreviewed",
      reviewed_at: note.reviewed_at || null,
      review_provenance: note.review_provenance || null,
      updated_at: note.updated_at || note.created_at,
      deleted_at: note.deleted_at || null
    };
    state.noteStates = [noteState, ...state.noteStates.filter((item) => item.id !== note.id)];
  },
  noteStateChanged(owner, savedState) {
    if (state.document?.id !== owner.id) return;
    state.noteStates = [savedState, ...state.noteStates.filter((item) => item.id !== savedState.id)];
    state.notes = savedState.deleted_at
      ? state.notes.filter((item) => item.id !== savedState.id)
      : [{ ...savedState }, ...state.notes.filter((item) => item.id !== savedState.id)];
  },
  notePurged(owner, noteId) {
    applyNotePurge(owner, noteId);
  }
});

$("charts-panel").addEventListener("toggle", (event) => {
  const documentId = state.document?.id;
  if (event.currentTarget.open && documentId) charts.reload(documentId);
});

assistant = createAssistant({
  api,
  getDocument: () => state.document,
  getLanguage: () => state.language,
  getNavigationGeneration: () => workspace.getNavigationGeneration(),
  getContext: assistantContext,
  getSharedDatasetId: () => analysis.getSharedDatasetId(),
  getSelectedDatasetId: () => analysis.getSelectedDatasetId(),
  acceptDatasetSelection: (documentId, dataset, options) => {
    analysis.openImportedDataset(documentId, dataset, options);
    if (state.document?.id === documentId) charts?.reload(documentId);
  },
  getActiveAnalysisId: () => analysis.getActiveAnalysisId(),
  getActiveChart: (documentId) => charts.getActiveChart(documentId),
  clearActiveChart: (documentId) => charts.clearActiveChart(documentId),
  getAnalysisRecipe: (engine, method) => analysis.getRecipe(engine, method),
  openAnalysisJob,
  openChart,
  previewChartProposal: (documentId, proposal) => {
    if (state.document?.id === documentId) workspace.reveal("data", { tool: "charts" });
    return charts.previewProposal(documentId, proposal);
  },
  getChatImages: (documentId) => documentId ? imageLibrary.getChatImages(documentId) : [],
  getImages: (documentId, imageIds) => documentId ? imageLibrary.getImages(documentId, imageIds) : [],
  getActiveImage: (documentId) => imageViewer.getActiveImage(documentId),
  clearActiveImage: (documentId) => imageViewer.clearActiveContext(documentId),
  openImageProposal,
  navigateSource: navigateAssistantSource,
  reviewResearchRecord: (source) => researchRecord.reviewSource(source),
  refreshAfterAgent
});

applyTheme();
applyLanguage();
loadDocuments();
