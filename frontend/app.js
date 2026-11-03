import * as pdfjsLib from "/vendor/pdfjs/build/pdf.mjs";
import { createImageLibrary } from "/image-library.js";
import { createImageViewer } from "/image-viewer.js";
import { createAnalysis } from "/analysis.js";
import { createDatasetSelection } from "/dataset-selection.js";
import { createDataImports } from "/data-imports.js";
import { createCharts } from "/charts.js";
import { createWorkspace } from "/workspace.js";
import { createDataNavigation } from "/data-navigation.js";
import { createAssistant } from "/assistant.js";
import { createRichText, renderRichHtml } from "/rich-text.js";
import { createResearchRecord } from "/research-record.js";
import { createStudy } from "/study.js";
import { createReaderFind } from "/reader-find.js";
import { clearReaderProgress, readReaderProgress, writeReaderProgress } from "/reader-progress.js";
import { pdfSelectionGeometry } from "/pdf-selection-geometry.js";
import { createPdfReaderLinks } from "/pdf-reader-links.js";
import { createAnnotationHistory } from "/reader-annotation-history.js";
import { createReaderNavigation } from "/reader-navigation.js";
import { createReaderObjectMenu } from "/reader-object-menu.js";
import { createReaderShapes, shapeBounds } from "/reader-shapes.js";

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
    noSource: "输入后默认关联当前页",
    regionMode: "截取图片",
    cancelRegion: "取消截图",
    wholePage: "引用当前整页",
    sourceOptions: "来源选项",
    anchorHelp: "新笔记默认关联当前页；也可明确引用整页。截图需另行选择加入笔记或助手。",
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
    exportAnnotatedPdf: "下载批注 PDF",
    exportingAnnotatedPdf: "正在生成批注 PDF…",
    exportedAnnotatedPdf: "批注 PDF 已下载。",
    annotatedPdf: "批注 PDF",
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
    source_has_no_pdf: "这项内容没有可导出的 PDF 原文。",
    storage_failure: "本地存储暂时不可用，请稍后重试。",
    renderer_busy: "图片处理正忙，请稍后重试。",
    renderer_timeout: "图片生成超时，请重试。",
    renderer_failed: "图片生成失败，请重试。",
    renderer_unavailable: "图片生成暂时不可用，请稍后重试。",
    excerpt_missing: "图片文件已缺失，请重试。",
    excerpt_corrupt: "图片文件已损坏，无法使用。",
    export_too_large: "阅读记录过大，无法导出。",
    pdf_export_empty: "没有可导出的已保存 PDF 笔记或标注。",
    pdf_export_invalid: "文献或笔记记录无效，无法生成批注 PDF。",
    pdf_export_too_large: "批注 PDF 超出导出限制，请减少笔记或标注后重试。",
    pdf_export_busy: "另一个批注 PDF 正在生成，请稍后重试。",
    pdf_export_timeout: "批注 PDF 生成超时，请重试。",
    pdf_export_failed: "批注 PDF 生成失败，请重试。",
    pdf_export_unavailable: "批注 PDF 导出暂时不可用，请稍后重试。",
    textbox_font_unavailable: "文本框字体不可用，无法生成批注 PDF。",
    textbox_overflow: "文本框内容超出边界，无法生成批注 PDF。请调整文本框大小或字号后重试。",
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
    metadataLookup: "自动更新条目",
    metadataLookupLoading: "正在查找书目…",
    metadataLookupReady: "已将查找到的字段填入未保存草稿；不会自动保存，请核对后点击保存。",
    metadataLookupNotFound: "未找到书目信息。请填写 DOI 后重试，或手动编辑书目；现有内容已保留。",
    metadataLookupChooseDoi: "找到多个 DOI。请选择或输入一个 DOI，然后再次点击“自动更新条目”；未自动选择。",
    metadataDoiCandidates: "选择查找到的 DOI",
    metadataDoiCandidatePlaceholder: "请选择 DOI",
    metadataLookupSource: "来源：{provider}",
    metadataLookupSourceLink: "查看来源",
    bibliography_invalid_doi: "DOI 格式无效，请检查后重试。",
    bibliography_unavailable: "书目服务暂时不可用，请稍后重试；草稿已保留。",
    bibliography_probe_failed: "无法读取原文中的书目信息，请填写 DOI 或手动编辑。",
    bibliography_probe_timeout: "书目查找超时，请重试或手动编辑；草稿已保留。",
    bibliography_scope: "当前文献不支持书目查找。",
    research_record_source_mismatch: "请先返回该来源的文献和所选数据，再查看导出范围；当前工作区未切换。",
    research_record_invalid_source: "这条导出范围来源不完整，无法打开。",
    textSelectionNote: "加入笔记",
    askSelection: "提问",
    translateSelection: "翻译",
    selectTextFirst: "请先在当前页选中文字。若页面没有可选择文字，请使用“截取图片”。",
    textSelectionTooLong: "选中文字超过 10000 字，请缩小选择范围。",
    noTextLayer: "此页没有可选择的文字。可改用“截取图片”。",
    textLayerUnavailable: "此页文字暂时无法选择。可重试，或改用“截取图片”。",
    textDraftReady: "选中文字已插入未保存笔记的光标位置，不会自动保存或发送。",
    replaceDraftConfirm: "当前有未保存或正在编辑的笔记。用新的原文选择替换当前草稿吗？此操作不会自动保存。",
    draftPending: "当前笔记操作尚未完成，请完成后再选择新的原文。",
    regionDraftUnsaved: "已截取所选区域的 PDF 画面，尚未加入笔记或助手。",
    regionDraftCancel: "取消截图",
    regionDraftCancelConfirm: "取消此截图和预览？笔记文字会保留。",
    regionCaption: "第 {page} 页区域截图",
    captureAddNote: "加入笔记",
    captureAddAgent: "加入助手",
    captureUploading: "正在上传截图…",
    captureNoteReady: "截图已插入未保存笔记，不会自动保存。",
    captureInsertFailed: "截图未插入；目标笔记或编辑器状态已变化。",
    readerActionReady: "已加入助手草稿和固定来源，尚未发送。",
    readerActionLimit: "加入后会超过 8000 字，未更改助手草稿。",
    readerActionImageLimit: "助手最多选择 4 张图片；未更改原有选择。",
    readerActionOwner: "原文操作未加入，请确认仍位于同一篇文献。",
    readerActionPending: "上一条助手消息仍在提交，请完成后重试；原文选择和助手草稿已保留。",
    readerActionUnavailable: "助手尚未就绪，请稍后重试；原文选择和助手草稿已保留。",
    readerActionInvalid: "原文选择无效或已失效，请重新选择；助手草稿未更改。",
    libraryTrash: "文献回收站",
    libraryTrashHelp: "回收站中的文献可恢复。彻底删除会清理原文及关联资料，无法撤销。",
    libraryTrashEmpty: "回收站为空。",
    libraryTrashLoading: "正在加载回收站…",
    libraryTrashLoadFailed: "无法加载文献回收站，请重试。",
    documentMenu: "文献操作",
    renameDocument: "重命名",
    trashDocument: "移入回收站",
    restoreDocument: "恢复文献",
    purgeDocument: "彻底删除",
    documentPurgePreviewLoading: "正在准备彻底删除预览…",
    documentPurgePreviewFailed: "无法加载彻底删除预览，尚未删除任何内容。请重试。",
    documentPurgeConfirm: "彻底删除“{title}”？\n\n将删除：{counts}。\n存储空间：{size}。\n\n此操作无法撤销。此前下载的导出副本和备份不会删除。",
    documentPurgeCounts: "笔记 {notes} 条、图片 {images} 个、数据集 {datasets} 个、分析 {analyses} 项、图表 {charts} 个、导入 {imports} 项、对话 {conversations} 个、文件 {files} 个、缺失文件 {missing_files} 个",
    documentPurging: "正在彻底删除文献并清理文件…",
    documentPurged: "文献已彻底删除，文件清理完成。",
    documentPurgeRetry: "删除结果尚未确认，请重试；无需再次确认。",
    documentPurgeCleanupRetry: "文献已移除，文件清理尚未完成，请重试。",
    documentPurgePendingTitle: "文件清理待完成",
    documentPurgePendingMeta: "文件清理待完成；不可恢复。",
    documentPurgeChanged: "文献或删除预览已变化。已取消本次删除并刷新回收站；请重新预览并确认。",
    documentPurgeConflict: "彻底删除与另一项操作冲突。已取消本次操作，请重新预览并确认。",
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
    document_in_use: "这篇文献已关联研究，请先取消关联后再试。",
    document_busy: "这篇文献仍有正在进行的任务或助手操作，请完成或停止后再试。",
    document_revision_conflict: "文献已在其他地方更新。请刷新后重试。",
    document_trashed: "这篇文献已在回收站中，请先恢复。",
    document_not_deleted: "只有回收站中的文献才能彻底删除。",
    document_purge_changed: "文献或删除预览已变化，请重新预览并确认。",
    document_purged: "这篇文献已彻底删除。",
    document_purge_pending: "文献已移除，文件清理尚未完成，请重试。",
    document_purge_unsafe: "无法安全彻底删除这篇文献。请刷新回收站后重试。",
    document_purge_too_large: "这篇文献的内容过大，暂时无法彻底删除。",
    purgeNote: "彻底删除",
    purgeConfirm: "彻底删除正文和图片摘录，无法恢复；已导出文件、备份和历史对话不受影响。",
    purging: "正在彻底删除笔记…",
    purged: "笔记正文和图片摘录已彻底删除，无法恢复。",
    purgeStorageUnavailable: "笔记内容已不可访问，但图片文件清理失败。请使用原请求重试完成清理。",
    notePurgedSource: "这条笔记的正文和图片摘录已彻底删除，无法恢复。",
    note_not_deleted: "只有已删除笔记才能彻底删除。",
    note_purged: "这条笔记已彻底删除，无法恢复。",
    annotationHighlight: "保存高亮",
    annotationUnderline: "保存下划线",
    annotationTools: "保存文字标注",
    annotationKindHighlight: "高亮",
    annotationKindUnderline: "下划线",
    annotationColor: "标注颜色",
    colorYellow: "黄色",
    colorGreen: "绿色",
    colorBlue: "蓝色",
    colorPink: "粉色",
    colorBlack: "黑色",
    colorRed: "红色",
    annotationSaving: "正在保存文字标注…",
    annotationSaved: "文字标注和笔记已保存。",
    annotationSaveFailed: "文字标注的保存结果尚未确认。请按原请求重试，不会重复创建。",
    annotationTooManyRects: "选中文字的几何区域过于复杂，请缩小选择范围。",
    annotationRetryRequired: "请先重试尚未确认的文字标注保存请求。",
    annotationKind: "标注类型",
    annotationStyleSaving: "正在保存标注样式…",
    annotationStyleSaved: "标注样式已保存。",
    shapeRectangle: "矩形",
    shapeArrow: "箭头",
    shapeLine: "直线",
    shapeEllipse: "圆形",
    shapeInk: "手绘",
    shapeEllipseHint: "拖动绘制椭圆；按住 Shift 绘制正圆。",
    shapeTextbox: "文本框",
    shapeTextboxBody: "文本框内容",
    shapeTextboxFontSize: "字号",
    shapeTextboxPlaceholder: "输入文本框内容…",
    shapeTextboxOverflow: "文本超出文本框，请调整文本框大小或字号。",
    shapeTextboxTooLong: "文本框内容不能超过 2000 个字符。",
    shapeTextboxEmpty: "请输入文本框内容。",
    textboxColorBlack: "黑色",
    textboxColorBlue: "蓝色",
    textboxColorGreen: "绿色",
    textboxColorRed: "红色",
    shapeLayer: "PDF 图形批注层",
    shapeSelect: "选择图形批注",
    shapeEndpoint: "箭头端点，可用方向键微调",
    shapeCorner: "矩形角点，可用方向键微调",
    shapeNewLabel: "新图形批注",
    shapeEditLabel: "编辑图形批注",
    shapeDescription: "批注说明",
    shapeLineWidth: "线宽（PDF 单位）",
    shapeSave: "保存批注",
    shapeCancel: "取消",
    shapeDefaultRectangle: "矩形批注",
    shapeDefaultArrow: "箭头批注",
    shapeDefaultLine: "直线批注",
    shapeDefaultEllipse: "圆形批注",
    shapeDefaultInk: "手绘批注",
    shapeSaving: "正在保存图形批注…",
    shapeSaved: "图形批注已保存。",
    shapeSaveFailed: "图形批注的保存结果尚未确认。请按原请求重试，不会重复创建。",
    shapeInkLimit: "已达到 512 点上限，本笔已结束。请保存后继续绘制下一笔。",
    shapeTooSmall: "请拖出有效的图形。",
    shapeStale: "页面或批注已变化，未保存本地修改。",
    shapeCaptureAlt: "第 {page} 页图形批注截图",
    shapeRegionDraftUnsaved: "已冻结所选图形和 PDF 画面，尚未加入笔记或助手。",
    notePageShape: "第 {page} 页 · {kind}批注",
    shape_annotation_excerpt_unsupported: "图形批注请使用独立截图分享，不能生成笔记图片摘录。",
    addToAssistant: "加入助手",
    notePageAnnotation: "第 {page} 页 · 文字标注",
    viewMode: "阅读模式",
    viewContinuous: "连续滚动",
    viewSingle: "单页",
    findInPdf: "查找正文",
    findPlaceholder: "在当前 PDF 中查找",
    findClose: "关闭",
    findPrevious: "上一个匹配",
    findNext: "下一个匹配",
    findSearching: "正在检索第 {page} / {total} 页…",
    findEmpty: "输入文字以查找当前 PDF。",
    findNoMatches: "没有找到匹配文字，共检索 {scanned} 页。",
    findCount: "{current} / {count} 个匹配 · 第 {page} 页 · 已检索 {scanned} 页",
    findCountPartial: "{current} / {count} 个匹配 · 第 {page} 页 · 结果已达上限，检索不完整",
    findPartial: "部分页面未检索或内容已截断；已检索 {scanned} 页。",
    findScanned: "其中 {count} 页没有可检索文字；未进行 OCR。",
    findFailed: "有 {count} 页文字读取失败，结果不完整。请重试。",
    findRetry: "查找未完成，请重试。",
    crossPageSelection: "不支持跨页选择；请在一页内重新选择文字。",
    pageRenderRetry: "此页显示失败。",
    notesFilterText: "筛选笔记",
    notesFilterPlaceholder: "搜索正文或原始引文",
    filterAll: "全部",
    selectVisible: "选择当前显示",
    clearSelection: "清除选择",
    batchAddAssistant: "将所选加入助手",
    notesVisibleCount: "显示 {visible} / {total} 条",
    notesNoMatch: "没有符合筛选条件的笔记。",
    notesSelectedCount: "已选择 {count} 条",
    notesBatchLimit: "最多向助手加入 8 条唯一笔记（包含已有引用）；请减少选择。",
    notesBatchAdded: "已将 {count} 条笔记加入助手，尚未发送。",
    notesBatchInvalid: "所选笔记已变化或不可用，未加入任何引用。请刷新选择。",
    readerProgressRestored: "已恢复上次阅读位置。",
    readerProgressStorageUnavailable: "无法读取或保存浏览器中的阅读进度；阅读不受影响。",
    firstPage: "第一页",
    lastPage: "最后一页",
    close: "关闭",
    navigationPanel: "目录 / 缩略图",
    pdfOutline: "PDF 目录",
    pageThumbnails: "页面缩略图",
    outlineLoading: "正在加载目录…",
    outlineEmpty: "此 PDF 没有目录。",
    outlineFailed: "目录加载失败。",
    fitPage: "适应整页",
    readerFullscreen: "阅读器全屏",
    exitFullscreen: "退出全屏",
    fullscreenFailed: "无法进入阅读器全屏。",
    annotationUndo: "撤销批注",
    annotationRedo: "重做批注",
    annotationHistoryStale: "批注已变化，相关历史已失效。",
    copyQuote: "复制引文",
    quoteCopied: "引文已复制。",
    copyFailed: "复制失败，请重试。",
    selectedAnnotationActions: "已选批注操作",
    annotationAction: "批注操作",
    objectActions: "PDF 对象操作",
    objectLoading: "正在识别此页表格…",
    objectNone: "此处未识别到图片或表格，可手动截取。",
    objectReadFailed: "无法读取此页表格，请重试或手动截取。",
    objectManualCapture: "手动截取区域",
    objectCopy: "复制图片",
    objectCopied: "图片已复制。",
    objectCopyFailed: "复制图片失败，请重试或手动截取。",
    objectCapturePending: "请先完成或取消当前截图，再添加其他对象。",
    objectStale: "页面已变化，请重新右键选择对象。",
    regions_busy: "表格识别正忙，请稍后重试。",
    regions_timeout: "表格识别超时，请重试或手动截取。",
    regions_unavailable: "表格识别暂时不可用，请手动截取。",
    regions_failed: "表格识别失败，请重试或手动截取。",
    navigationSaveOrCancel: "有未保存的批注、截图或正在保存的修改。请先保存或取消，再切换工作区。",
    navigationPendingWrite: "有修改正在保存或处理。请等待保存完成，再切换工作区。",
    navigationDrawing: "有未保存的批注。请先保存或取消当前批注，再切换工作区。",
    navigationScreenshot: "有截图预览尚未处理。请先添加或取消截图，再切换工作区。",
    navigationSelection: "正在框选区域。请先完成或取消当前选择，再切换工作区。",
    navigationRichDraftError: "当前笔记有无法保存的富文本修改。请先修复、保存或取消当前笔记，再切换工作区。",
    personalOpenFailed: "无法打开“我的数据”。请重试；现有工作区未更改。",
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
    noSource: "Typing anchors this note to the current page",
    regionMode: "Capture image",
    cancelRegion: "Cancel capture",
    wholePage: "Anchor to current whole page",
    sourceOptions: "Source options",
    anchorHelp: "New notes default to the current page; you can explicitly anchor the whole page. Choose where each capture goes separately.",
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
    exportAnnotatedPdf: "Download annotated PDF",
    exportingAnnotatedPdf: "Generating annotated PDF…",
    exportedAnnotatedPdf: "Annotated PDF downloaded.",
    annotatedPdf: "Annotated PDF",
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
    source_has_no_pdf: "This item has no source PDF to export.",
    storage_failure: "Local storage is temporarily unavailable. Try again shortly.",
    renderer_busy: "Image processing is busy. Try again shortly.",
    renderer_timeout: "Image creation timed out. Try again.",
    renderer_failed: "The image could not be created. Try again.",
    renderer_unavailable: "Image creation is temporarily unavailable. Try again shortly.",
    excerpt_missing: "The image file is missing. Try again.",
    excerpt_corrupt: "The image file is damaged and cannot be used.",
    export_too_large: "The reading record is too large to export.",
    pdf_export_empty: "There are no saved PDF notes or marks to export.",
    pdf_export_invalid: "The paper or note records are invalid, so an annotated PDF cannot be generated.",
    pdf_export_too_large: "The annotated PDF exceeds the export limit. Reduce the notes or marks and try again.",
    pdf_export_busy: "Another annotated PDF is being generated. Try again shortly.",
    pdf_export_timeout: "Annotated PDF generation timed out. Try again.",
    pdf_export_failed: "The annotated PDF could not be generated. Try again.",
    pdf_export_unavailable: "Annotated PDF export is temporarily unavailable. Try again shortly.",
    textbox_font_unavailable: "The text box font is unavailable, so the annotated PDF cannot be generated.",
    textbox_overflow: "Text box content exceeds its bounds. Resize the text box or reduce the font size before exporting the annotated PDF.",
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
    metadataLookup: "Update bibliography",
    metadataLookupLoading: "Looking up bibliography…",
    metadataLookupReady: "Lookup fields were added to the UNSAVED draft. Nothing was saved automatically; review and click Save.",
    metadataLookupNotFound: "No bibliography was found. Enter a DOI and retry, or edit manually; existing values were preserved.",
    metadataLookupChooseDoi: "Multiple DOIs were found. Choose or enter a DOI, then click Update bibliography again. Nothing was selected automatically.",
    metadataDoiCandidates: "Choose a discovered DOI",
    metadataDoiCandidatePlaceholder: "Choose a DOI",
    metadataLookupSource: "Source: {provider}",
    metadataLookupSourceLink: "View source",
    bibliography_invalid_doi: "The DOI is invalid. Check it and try again.",
    bibliography_unavailable: "The bibliography service is temporarily unavailable. Try again later; your draft is preserved.",
    bibliography_probe_failed: "Bibliography could not be read from the PDF. Enter a DOI or edit manually.",
    bibliography_probe_timeout: "Bibliography lookup timed out. Retry or edit manually; your draft is preserved.",
    bibliography_scope: "Bibliography lookup is not available for this paper.",
    research_record_source_mismatch: "Return to the source paper and selected data to review this export scope. The current workspace was not changed.",
    research_record_invalid_source: "This export-scope source is incomplete and cannot be opened.",
    textSelectionNote: "Add to note",
    askSelection: "Ask",
    translateSelection: "Translate",
    selectTextFirst: "Select text on the current page first. If the page has no selectable text, use “Capture image”.",
    textSelectionTooLong: "The selected text exceeds 10,000 characters. Select a smaller passage.",
    noTextLayer: "This page has no selectable text. Use “Capture image” instead.",
    textLayerUnavailable: "Text is temporarily unavailable on this page. Retry, or use “Capture image”.",
    textDraftReady: "The selected text was inserted at the note caret. Nothing was saved or sent automatically.",
    replaceDraftConfirm: "There is an unsaved or edited note. Replace the current draft with the new source selection? Nothing will be saved automatically.",
    draftPending: "A note operation is still in progress. Finish it before choosing another source.",
    regionDraftUnsaved: "Captured pixels from the selected PDF region. Not added to a note or the assistant yet.",
    regionDraftCancel: "Cancel capture",
    regionDraftCancelConfirm: "Clear this capture and preview? Your note text will be kept.",
    regionCaption: "Page {page} region capture",
    captureAddNote: "Add to note",
    captureAddAgent: "Add to Agent",
    captureUploading: "Uploading capture…",
    captureNoteReady: "Capture inserted into the unsaved note. Nothing was saved automatically.",
    captureInsertFailed: "The capture was not inserted because the target note or editor state changed.",
    readerActionReady: "Added to the Agent draft with a frozen source. Nothing was sent.",
    readerActionLimit: "The addition would exceed 8,000 characters. The Agent draft was not changed.",
    readerActionImageLimit: "The Agent can select at most 4 images. Existing selections were not changed.",
    readerActionOwner: "The reader action was not added. Confirm that the same paper is still open.",
    readerActionPending: "The previous Agent message is still being submitted. Retry when it finishes; the source selection and Agent draft were preserved.",
    readerActionUnavailable: "The Agent is not ready. Retry shortly; the source selection and Agent draft were preserved.",
    readerActionInvalid: "The source selection is invalid or stale. Select it again; the Agent draft was not changed.",
    libraryTrash: "Paper trash",
    libraryTrashHelp: "Papers in trash can be restored. Permanent deletion removes the PDF and related records and cannot be undone.",
    libraryTrashEmpty: "Trash is empty.",
    libraryTrashLoading: "Loading paper trash…",
    libraryTrashLoadFailed: "Paper trash could not be loaded. Try again.",
    documentMenu: "Paper actions",
    renameDocument: "Rename",
    trashDocument: "Move to trash",
    restoreDocument: "Restore paper",
    purgeDocument: "Permanently delete",
    documentPurgePreviewLoading: "Preparing the permanent-deletion preview…",
    documentPurgePreviewFailed: "The permanent-deletion preview could not be loaded. Nothing was deleted. Try again.",
    documentPurgeConfirm: "Permanently delete “{title}”?\n\nThis will delete {counts}.\nStorage: {size}.\n\nThis cannot be undone. Previously downloaded exports and backups are not deleted.",
    documentPurgeCounts: "{notes} notes, {images} images, {datasets} datasets, {analyses} analyses, {charts} charts, {imports} imports, {conversations} conversations, {files} files, and {missing_files} missing files",
    documentPurging: "Permanently deleting the paper and cleaning up files…",
    documentPurged: "The paper was permanently deleted and file cleanup is complete.",
    documentPurgeRetry: "The deletion outcome is unconfirmed. Retry; no new confirmation is needed.",
    documentPurgeCleanupRetry: "The paper is removed, but file cleanup is incomplete. Retry cleanup.",
    documentPurgePendingTitle: "File cleanup pending",
    documentPurgePendingMeta: "File cleanup pending; restore is unavailable.",
    documentPurgeChanged: "The paper or deletion preview changed. This deletion was cancelled and trash was refreshed; review a new preview and confirm again.",
    documentPurgeConflict: "Permanent deletion conflicted with another operation. This operation was cancelled; review a new preview and confirm again.",
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
    document_in_use: "This paper is associated with research. Remove the association before retrying.",
    document_busy: "This paper still has an active job or assistant operation. Finish or stop it before retrying.",
    document_revision_conflict: "The paper changed elsewhere. Refresh and retry.",
    document_trashed: "This paper is in trash. Restore it first.",
    document_not_deleted: "Only a paper in trash can be permanently deleted.",
    document_purge_changed: "The paper or deletion preview changed. Review a new preview and confirm again.",
    document_purged: "This paper was already permanently deleted.",
    document_purge_pending: "The paper is removed, but file cleanup is incomplete. Retry cleanup.",
    document_purge_unsafe: "This paper cannot be permanently deleted safely. Refresh trash before retrying.",
    document_purge_too_large: "This paper’s contents are too large to permanently delete right now.",
    purgeNote: "Delete permanently",
    purgeConfirm: "Permanently delete the note body and image excerpt; this cannot be undone. Exported files, backups, and past conversations are not affected.",
    purging: "Permanently deleting note…",
    purged: "The note body and image excerpt were permanently deleted and cannot be recovered.",
    purgeStorageUnavailable: "The note content is no longer accessible, but image-file cleanup failed. Retry the original request to finish cleanup.",
    notePurgedSource: "This note’s body and image excerpt were permanently deleted and cannot be recovered.",
    note_not_deleted: "Only a deleted note can be permanently deleted.",
    note_purged: "This note was permanently deleted and cannot be recovered.",
    annotationHighlight: "Save highlight",
    annotationUnderline: "Save underline",
    annotationTools: "Save text annotation",
    annotationKindHighlight: "Highlight",
    annotationKindUnderline: "Underline",
    annotationColor: "Annotation color",
    colorYellow: "Yellow",
    colorGreen: "Green",
    colorBlue: "Blue",
    colorPink: "Pink",
    colorBlack: "Black",
    colorRed: "Red",
    annotationSaving: "Saving text annotation…",
    annotationSaved: "Text annotation and note saved.",
    annotationSaveFailed: "The text annotation save is unconfirmed. Retry the exact request; it will not create a duplicate.",
    annotationTooManyRects: "The selection geometry is too complex. Select a smaller passage.",
    annotationRetryRequired: "Retry the unconfirmed text annotation save before creating another one.",
    annotationKind: "Annotation type",
    annotationStyleSaving: "Saving annotation style…",
    annotationStyleSaved: "Annotation style saved.",
    shapeRectangle: "Rectangle",
    shapeArrow: "Arrow",
    shapeLine: "Line",
    shapeEllipse: "Ellipse",
    shapeInk: "Freehand",
    shapeEllipseHint: "Drag to draw an ellipse; hold Shift for a perfect circle.",
    shapeTextbox: "Text box",
    shapeTextboxBody: "Text box content",
    shapeTextboxFontSize: "Font size",
    shapeTextboxPlaceholder: "Enter text box content…",
    shapeTextboxOverflow: "The text does not fit. Resize the text box or reduce the font size.",
    shapeTextboxTooLong: "Text box content cannot exceed 2,000 characters.",
    shapeTextboxEmpty: "Enter text box content.",
    textboxColorBlack: "Black",
    textboxColorBlue: "Blue",
    textboxColorGreen: "Green",
    textboxColorRed: "Red",
    shapeLayer: "PDF shape annotation layer",
    shapeSelect: "select shape annotation",
    shapeEndpoint: "Arrow endpoint; use arrow keys to nudge",
    shapeCorner: "Rectangle corner; use arrow keys to nudge",
    shapeNewLabel: "New shape annotation",
    shapeEditLabel: "Edit shape annotation",
    shapeDescription: "Annotation description",
    shapeLineWidth: "Line width (PDF units)",
    shapeSave: "Save annotation",
    shapeCancel: "Cancel",
    shapeDefaultRectangle: "Rectangle annotation",
    shapeDefaultArrow: "Arrow annotation",
    shapeDefaultLine: "Line annotation",
    shapeDefaultEllipse: "Ellipse annotation",
    shapeDefaultInk: "Freehand annotation",
    shapeSaving: "Saving shape annotation…",
    shapeSaved: "Shape annotation saved.",
    shapeSaveFailed: "The shape save is unconfirmed. Retry the exact request; it will not create a duplicate.",
    shapeInkLimit: "This stroke reached the 512-point limit and has ended. Save it, then start the next stroke.",
    shapeTooSmall: "Drag to create a valid shape.",
    shapeStale: "The page or annotation changed. Local edits were not saved.",
    shapeCaptureAlt: "Shape annotation capture from page {page}",
    shapeRegionDraftUnsaved: "Frozen PDF pixels with the selected shape. Not added to a note or the assistant yet.",
    notePageShape: "Page {page} · {kind} annotation",
    shape_annotation_excerpt_unsupported: "Share shape annotations with an independent capture; note-linked image excerpts are unavailable.",
    addToAssistant: "Add to assistant",
    notePageAnnotation: "Page {page} · text annotation",
    viewMode: "Reading mode",
    viewContinuous: "Continuous",
    viewSingle: "Single page",
    findInPdf: "Find in PDF",
    findPlaceholder: "Find in the current PDF",
    findClose: "Close",
    findPrevious: "Previous match",
    findNext: "Next match",
    findSearching: "Searching page {page} of {total}…",
    findEmpty: "Enter text to find in the current PDF.",
    findNoMatches: "No matches found across {scanned} scanned pages.",
    findCount: "Match {current} of {count} · page {page} · {scanned} pages scanned",
    findCountPartial: "Match {current} of {count} · page {page} · result limit reached; search is partial",
    findPartial: "Some pages were not scanned or their text was truncated; {scanned} pages scanned.",
    findScanned: "{count} pages had no searchable text; OCR was not performed.",
    findFailed: "Text could not be read on {count} pages, so results are incomplete. Try again.",
    findRetry: "Find did not finish. Try again.",
    crossPageSelection: "Cross-page selection is not supported. Select text within one page.",
    pageRenderRetry: "This page could not be displayed.",
    notesFilterText: "Filter notes",
    notesFilterPlaceholder: "Search note text or original quote",
    filterAll: "All",
    selectVisible: "Select visible",
    clearSelection: "Clear selection",
    batchAddAssistant: "Add selected to assistant",
    notesVisibleCount: "Showing {visible} of {total}",
    notesNoMatch: "No notes match these filters.",
    notesSelectedCount: "{count} selected",
    notesBatchLimit: "Add at most 8 unique notes to the assistant, including existing references. Select fewer notes.",
    notesBatchAdded: "Added {count} notes to the assistant. Nothing was sent.",
    notesBatchInvalid: "Selected notes changed or are unavailable. No references were added; refresh your selection.",
    readerProgressRestored: "Restored your last reading position.",
    readerProgressStorageUnavailable: "Browser reading progress cannot be read or saved; reading is unaffected.",
    firstPage: "First page",
    lastPage: "Last page",
    close: "Close",
    navigationPanel: "Outline / thumbnails",
    pdfOutline: "PDF outline",
    pageThumbnails: "Page thumbnails",
    outlineLoading: "Loading outline…",
    outlineEmpty: "This PDF has no outline.",
    outlineFailed: "The outline could not be loaded.",
    fitPage: "Fit whole page",
    readerFullscreen: "Reader fullscreen",
    exitFullscreen: "Exit fullscreen",
    fullscreenFailed: "Reader fullscreen could not be opened.",
    annotationUndo: "Annotation undo",
    annotationRedo: "Annotation redo",
    annotationHistoryStale: "The annotation changed; its conflicting history was discarded.",
    copyQuote: "Copy quote",
    quoteCopied: "Quote copied.",
    copyFailed: "Copy failed. Try again.",
    selectedAnnotationActions: "Selected annotation actions",
    annotationAction: "Annotation actions",
    objectActions: "PDF object actions",
    objectLoading: "Recognizing tables on this page…",
    objectNone: "No image or table was recognized here. You can capture a region manually.",
    objectReadFailed: "Tables on this page could not be read. Retry or capture manually.",
    objectManualCapture: "Capture region manually",
    objectCopy: "Copy image",
    objectCopied: "Image copied.",
    objectCopyFailed: "The image could not be copied. Retry or capture it manually.",
    objectCapturePending: "Finish or cancel the current capture before adding another object.",
    objectStale: "The page changed. Right-click the object again.",
    regions_busy: "Table recognition is busy. Try again shortly.",
    regions_timeout: "Table recognition timed out. Retry or capture manually.",
    regions_unavailable: "Table recognition is unavailable. Capture the region manually.",
    regions_failed: "Table recognition failed. Retry or capture manually.",
    navigationSaveOrCancel: "Unsaved annotations, a capture, or a pending save must be saved or cancelled before changing workspaces.",
    navigationPendingWrite: "Changes are being saved or processed. Wait for saving to finish before changing workspaces.",
    navigationDrawing: "There are unsaved annotations. Save or cancel the current drawing before changing workspaces.",
    navigationScreenshot: "A screenshot preview is waiting. Add or cancel the screenshot before changing workspaces.",
    navigationSelection: "A region is being selected. Finish or cancel the selection before changing workspaces.",
    navigationRichDraftError: "A rich-text change in the current note could not be preserved. Fix, save, or cancel the note before changing workspaces.",
    personalOpenFailed: "My data could not be opened. Retry; the existing workspace was not changed.",
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
  pageFirst: $("page-first"),
  pagePrev: $("page-prev"),
  pageNext: $("page-next"),
  pageLast: $("page-last"),
  pageInput: $("page-input"),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  zoomFit: $("zoom-fit"),
  zoomFitPage: $("zoom-fit-page"),
  readerFullscreen: $("reader-fullscreen"),
  annotationUndo: $("annotation-undo"),
  annotationRedo: $("annotation-redo"),
  navigationToggle: $("reader-navigation-toggle"),
  navigationPanel: $("reader-navigation-panel"),
  navigationClose: $("reader-navigation-close"),
  outlineTab: $("reader-outline-tab"),
  thumbnailsTab: $("reader-thumbnails-tab"),
  outline: $("reader-outline"),
  outlineList: $("reader-outline-list"),
  outlineStatus: $("reader-outline-status"),
  outlineRetry: $("reader-outline-retry"),
  thumbnailsPanel: $("reader-thumbnails-panel"),
  thumbnails: $("reader-thumbnails"),
  thumbnailsPrev: $("reader-thumbnails-prev"),
  thumbnailsNext: $("reader-thumbnails-next"),
  thumbnailsRange: $("reader-thumbnails-range"),
  selectedAnnotationToolbar: $("selected-annotation-toolbar"),
  selectedAnnotationCopy: $("selected-annotation-copy"),
  selectedAnnotationNote: $("selected-annotation-note"),
  selectedAnnotationAgent: $("selected-annotation-agent"),
  selectedAnnotationEdit: $("selected-annotation-edit"),
  selectedAnnotationKind: $("selected-annotation-kind"),
  selectedAnnotationColor: $("selected-annotation-color"),
  selectedAnnotationDelete: $("selected-annotation-delete"),
  zoomLabel: $("zoom-label"),
  viewMode: $("reader-view-mode"),
  findToggle: $("reader-find-toggle"),
  exportReadingRecord: $("export-reading-record"),
  exportAnnotatedPdf: $("export-annotated-pdf"),
  metadataPanel: $("metadata-panel"),
  metadataForm: $("metadata-form"),
  metadataTitle: $("metadata-title"),
  metadataAuthors: $("metadata-authors"),
  metadataYear: $("metadata-year"),
  metadataDoi: $("metadata-doi"),
  metadataDoiCandidatesLabel: $("metadata-doi-candidates-label"),
  metadataDoiCandidates: $("metadata-doi-candidates"),
  metadataLookupSource: $("metadata-lookup-source"),
  metadataLatest: $("metadata-latest"),
  metadataStatus: $("metadata-status"),
  metadataLookup: $("metadata-lookup"),
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
  textAnnotationsLayer: $("text-annotations-layer"),
  textStatus: $("reader-text-status"),
  readerProgressStatus: $("reader-progress-status"),
  textSelectionNote: $("text-selection-note"),
  textSelectionAsk: $("text-selection-ask"),
  textSelectionTranslate: $("text-selection-translate"),
  textAnnotationToolbar: $("text-annotation-toolbar"),
  textAnnotationHighlight: $("text-annotation-highlight"),
  textAnnotationUnderline: $("text-annotation-underline"),
  readerRegionMode: $("reader-region-mode"),
  overlay: $("region-overlay"),
  activeSelection: $("active-selection"),
  noteForm: $("note-form"),
  noteText: $("note-text"),
  richTextPlain: $("rich-text-plain"),
  richTextDraftStatus: $("rich-text-draft-status"),
  noteSave: $("note-save"),
  excerptSave: $("excerpt-save"),
  regionMode: $("reader-region-mode"),
  pageNote: $("page-note"),
  activeSource: $("active-source"),
  anchorHelp: $("anchor-help"),
  regionDraft: $("region-draft"),
  regionPreview: $("region-draft-preview"),
  regionDraftStatus: $("region-draft-status"),
  regionAddNote: $("region-add-note"),
  regionAddAgent: $("region-add-agent"),
  regionDraftCancel: $("region-draft-cancel"),
  characterCount: $("character-count"),
  notesPanel: $("notes-panel"),
  notesList: $("notes-list"),
  notesEmpty: $("notes-empty"),
  notesCount: $("notes-count"),
  notesFilterPanel: $("notes-filter-panel"),
  notesFilterQuery: $("notes-filter-query"),
  notesFilterColor: $("notes-filter-color"),
  notesFilterKind: $("notes-filter-kind"),
  notesFilterClear: $("notes-filter-clear"),
  notesFilterStatus: $("notes-filter-status"),
  notesSelectVisible: $("notes-select-visible"),
  notesSelectionClear: $("notes-selection-clear"),
  notesBatchAgent: $("notes-batch-agent"),
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
  viewMode: readViewMode(),
  readerPages: new Map(),
  readerPagesContainer: null,
  activePageRecord: null,
  continuousFrame: null,
  readerLayoutSequence: 0,
  readerLayoutLocked: false,
  pointerDragPage: null,
  readerProgress: {
    captureTimer: null,
    pending: null,
    loading: false,
    restoring: false,
    generation: 0,
    status: null,
    last: null
  },
  notes: [],
  noteStates: [],
  noteStatesLoaded: false,
  excerpts: [],
  drafts: new Map(),
  editDrafts: new Map(),
  noteTools: new Map(),
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
  capturedTextSelection: null,
  loadController: null,
  pendingUpload: false,
  pendingSaves: 0,
  annotationSaves: new Map(),
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
    operations: new Map(),
    purgeOperations: new Map(),
    purgedIds: new Set()
  },
  documentMenu: null,
  rename: null,
  lastUpload: null,
  highlight: null,
  highlightRevealId: null,
  regionActive: false,
  regionCapture: null,
  selection: null,
  selectedAnnotationId: null,
  status: null,
  resizeFrame: null
};

const annotationHistory = createAnnotationHistory();
let readerNavigation = null;
let imageLibrary = null;
let imageViewer = null;
let analysis = null;
let datasetSelection = null;
let dataImports = null;
let charts = null;
let workspace = null;
let dataNavigation = null;
let readerWorkspaceVisible = false;
let assistant = null;
let richText = null;
let researchRecord = null;
let study = null;
let readerFind = null;
let readerObjects = null;
let readerShapes = null;
let lastReadingDocumentId = null;
let lastDataDocumentId = null;
let lastDataSelection = { datasetId: null, analysisId: null, chartId: null };
let workspaceModeIntent = 0;
let workspaceModePending = false;

function isStudy(document = state.document) {
  return document?.kind === "study";
}

function isPersonalOwner(document = state.document) {
  return document?.kind === "study" && document?.workspace_role === "personal_analysis";
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

function readViewMode() {
  try {
    return localStorage.getItem("research-workbench-reader-view-mode") === "single" ? "single" : "continuous";
  } catch {
    return "continuous";
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
  readerObjects?.close();
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.title = `${t("pageTitle")} · Synrise Neuro`;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
    node.title = t(node.dataset.i18nAria);
  });
  elements.selectedAnnotationToolbar.setAttribute("aria-label", t("selectedAnnotationActions"));
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
  elements.textAnnotationToolbar.setAttribute("aria-label", t("annotationTools"));
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
  renderReaderProgressStatus();
  imageLibrary?.applyLanguage(state.language);
  imageViewer?.applyLanguage(state.language);
  analysis?.applyLanguage(state.language);
  datasetSelection?.applyLanguage(state.language);
  dataImports?.applyLanguage(state.language);
  charts?.applyLanguage(state.language);
  workspace?.applyLanguage(state.language);
  dataNavigation?.applyLanguage(state.language);
  assistant?.applyLanguage(state.language);
  richText?.applyLanguage(state.language);
  researchRecord?.applyLanguage(state.language);
  study?.applyLanguage(state.language);
  readerFind?.applyLanguage();
  readerShapes?.applyLanguage();
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

function updateUrl(documentId, noteId = null, replace = false, mode = "reading", tool = "analysis", page = null) {
  workspace?.reveal(mode, { tool, showNotes: Boolean(noteId) });
  const url = new URL(window.location.href);
  setOwnerInUrl(url, documentId);
  if (noteId) url.searchParams.set("note", noteId);
  else url.searchParams.delete("note");
  if (mode === "reading" && !noteId && Number.isInteger(page)) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  url.searchParams.set("workspace", mode);
  if (mode === "data") url.searchParams.set("tool", tool);
  else url.searchParams.delete("tool");
  for (const key of ["analysis", "dataset", "chart", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  const method = replace || url.href === window.location.href ? "replaceState" : "pushState";
  window.history[method]({}, "", url);
}

function readPageParam(params) {
  const raw = params.get("page");
  return /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/.test(raw || "") ? Number(raw) : null;
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
  for (const key of ["note", "page", "analysis", "dataset", "chart"]) url.searchParams.delete(key);
  window.history.replaceState({}, "", url);
}

function clearImageInUrl(documentId) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("document") !== documentId) return;
  for (const key of ["image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history.replaceState({}, "", url);
}

async function openImageViewer(documentId, kind, sourceId, options = {}) {
  invalidateWorkspaceModeIntent();
  cancelReaderProgressRestore();
  if (state.document?.id !== documentId) await openDocument(documentId, { explicitIntent: true });
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
  if (!state.document || richText?.isEditorActive()) return;
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
    button.addEventListener("click", () => openDocument(document.id, { workspace: "reading" }));

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
    state.studies = Array.isArray(studyBody.items) ? studyBody.items.filter((item) => !isPersonalOwner(item)) : [];
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
    name.textContent = document.purge_pending ? t("documentPurgePendingTitle") : document.title || document.original_filename || t("untitled");
    const meta = window.document.createElement("span");
    meta.className = "document-meta";
    meta.textContent = document.purge_pending ? [document.deleted_at, t("documentPurgePendingMeta")].filter(Boolean).join(" · ") : document.deleted_at || "";
    const restoreOperation = trash.operations.get(document.id);
    const purgeOperation = trash.purgeOperations.get(document.id);
    const actions = window.document.createElement("div");
    actions.className = "library-trash-actions";
    if (!document.purge_pending) {
      const restore = window.document.createElement("button");
      restore.type = "button";
      restore.className = "button button-quiet";
      restore.dataset.action = "restore-document";
      restore.disabled = Boolean(restoreOperation?.pending || purgeOperation);
      restore.textContent = t(restoreOperation?.pending ? "documentRestoring" : restoreOperation ? "retry" : "restoreDocument");
      restore.addEventListener("click", () => restoreDocument(document.id));
      actions.append(restore);
    }
    const purge = window.document.createElement("button");
    purge.type = "button";
    purge.className = "button button-quiet";
    purge.dataset.action = "purge-document";
    purge.disabled = Boolean(restoreOperation || purgeOperation?.pending || document.purge_pending && !purgeOperation);
    purge.textContent = t(purgeOperation?.pending ? purgeOperation.phase === "preview" ? "documentPurgePreviewLoading" : "documentPurging" : purgeOperation ? "retry" : "purgeDocument");
    purge.addEventListener("click", () => purgeDocument(document.id));
    actions.append(purge);
    item.append(name, meta, actions);
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
    trash.items = (Array.isArray(body.items) ? body.items : []).filter((item) => !trash.purgedIds.has(item.id));
    for (const [documentId, operation] of trash.operations) {
      if (operation.action === "restore" && operation.conflicted && !operation.pending) trash.operations.delete(documentId);
    }
    for (const document of trash.items) {
      if (!document.purge_pending) continue;
      const payload = documentPurgePayload(document.purge_request);
      if (!payload) continue;
      trash.operations.delete(document.id);
      if (trash.purgeOperations.get(document.id)?.pending) continue;
      trash.purgeOperations.set(document.id, {
        documentId: document.id,
        action: "purge",
        phase: "delete",
        payload,
        preview: null,
        pending: false,
        cleanupPending: true
      });
    }
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
    if (operations.get(operation.documentId) !== operation) return result;
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
    if (operations.get(operation.documentId) !== operation) return null;
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
  const trash = state.libraryTrash;
  const document = trash.items.find((item) => item.id === documentId);
  if (document?.purge_pending || trash.purgeOperations.has(documentId)) return;
  const existing = trash.operations.get(documentId);
  if (existing && !existing.conflicted) {
    await runDocumentOperation(existing);
    return;
  }
  if (existing) trash.operations.delete(documentId);
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

function documentPurgePayload(value) {
  if (!value || typeof value.request_id !== "string" || !value.request_id || !Number.isInteger(value.expected_revision) || typeof value.preview_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.preview_sha256)) return null;
  return {
    request_id: value.request_id,
    expected_revision: value.expected_revision,
    preview_sha256: value.preview_sha256
  };
}

function formatDocumentPurgeSize(value) {
  const bytes = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let size = bytes;
  let unitIndex = -1;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = new Intl.NumberFormat(state.language === "zh" ? "zh-CN" : "en", { maximumFractionDigits: 1 }).format(size);
  return `${rounded} ${units[unitIndex]}`;
}

function documentPurgeConfirmation(preview) {
  const counts = preview.counts && typeof preview.counts === "object" ? preview.counts : {};
  const values = {};
  for (const field of ["notes", "images", "datasets", "analyses", "charts", "imports", "conversations", "files", "missing_files"]) {
    values[field] = Number.isInteger(counts[field]) && counts[field] >= 0 ? counts[field] : 0;
  }
  return t("documentPurgeConfirm", {
    title: preview.title || t("untitled"),
    counts: t("documentPurgeCounts", values),
    size: formatDocumentPurgeSize(counts.bytes)
  });
}

function setDocumentPurgeStatus(operation, key, kind = "error") {
  state.libraryTrash.status = { key, kind, retry: () => purgeDocument(operation.documentId) };
  renderLibraryTrash();
}

function markDocumentPurgePending(operation) {
  operation.cleanupPending = true;
  const document = state.libraryTrash.items.find((item) => item.id === operation.documentId);
  if (!document) return;
  document.purge_pending = true;
  document.purge_request = { ...operation.payload };
  if (operation.preview?.counts) document.counts = operation.preview.counts;
}

async function clearDocumentPurgeAndRefresh(operation, key) {
  const trash = state.libraryTrash;
  if (trash.purgeOperations.get(operation.documentId) === operation) trash.purgeOperations.delete(operation.documentId);
  await loadLibraryTrash();
  if (!trash.status) trash.status = { key, kind: "error" };
  renderLibraryTrash();
}

function applyDocumentPurge(operation) {
  const trash = state.libraryTrash;
  const documentId = operation.documentId;
  annotationHistory.invalidate(documentId);
  trash.purgedIds.add(documentId);
  if (trash.purgeOperations.get(documentId) === operation) trash.purgeOperations.delete(documentId);
  trash.items = trash.items.filter((item) => item.id !== documentId);
  trash.status = { key: "documentPurged", kind: "success" };
  state.documents = state.documents.filter((item) => item.id !== documentId);
  state.search.documents = state.search.documents.filter((item) => item.id !== documentId);
  state.search.notes = state.search.notes.filter((item) => item.document_id !== documentId);
  if (["searchResultCount", "searchEmpty"].includes(state.search.status?.key)) {
    const values = { studies: state.search.studies.length, documents: state.search.documents.length, notes: state.search.notes.length };
    state.search.status = {
      key: values.studies || values.documents || values.notes ? "searchResultCount" : "searchEmpty",
      kind: "info",
      values
    };
  }
  const wasOpen = state.document?.id === documentId;
  if (wasOpen) {
    showMissingDocument();
    updateUrl(null, null, true, "reading");
  }
  state.metadata.get(documentId)?.lookup?.controller.abort();
  state.metadata.delete(documentId);
  state.documentOperations.delete(documentId);
  trash.operations.delete(documentId);
  state.drafts.delete(documentId);
  state.editDrafts.delete(documentId);
  state.noteTools.delete(documentId);
  clearReaderProgress(documentId);
  renderDocuments();
  renderSearch();
  renderLibraryTrash();
  if (!wasOpen) setStatus("documentPurged", "success");
}

async function runDocumentPurge(operation) {
  const trash = state.libraryTrash;
  if (operation.pending || !operation.payload || trash.operations.has(operation.documentId)) return null;
  operation.pending = true;
  operation.phase = "delete";
  trash.purgeOperations.set(operation.documentId, operation);
  trash.status = { key: "documentPurging", kind: "info" };
  renderLibraryTrash();
  try {
    const result = await api(`/api/v1/documents/${encodeURIComponent(operation.documentId)}/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload)
    });
    if (result?.id === operation.documentId && result.purged === true && result.files_removed === true) {
      applyDocumentPurge(operation);
      return result;
    }
    if (result?.id === operation.documentId && result.purged === true) {
      markDocumentPurgePending(operation);
      setDocumentPurgeStatus(operation, "documentPurgeCleanupRetry");
      return null;
    }
    throw new ApiError("request_failed");
  } catch (error) {
    if (["revision_conflict", "document_revision_conflict", "document_purge_changed"].includes(error.code)) {
      await clearDocumentPurgeAndRefresh(operation, "documentPurgeChanged");
      return null;
    }
    if (["document_not_deleted", "document_purged", "document_purge_unsafe", "document_purge_too_large", "idempotency_conflict", "not_found", "validation_error"].includes(error.code)) {
      const key = error.code === "idempotency_conflict" ? "documentPurgeConflict" : error.code;
      await clearDocumentPurgeAndRefresh(operation, key);
      return null;
    }
    if (error.code === "document_purge_pending") {
      markDocumentPurgePending(operation);
      setDocumentPurgeStatus(operation, "documentPurgeCleanupRetry");
    } else {
      const key = ["network", "request_failed", "storage_unavailable", "storage_failure"].includes(error.code) ? "documentPurgeRetry" : error.code || "documentPurgeRetry";
      setDocumentPurgeStatus(operation, key);
    }
    return null;
  } finally {
    operation.pending = false;
    renderLibraryTrash();
  }
}

async function previewDocumentPurge(operation) {
  const trash = state.libraryTrash;
  if (operation.pending || trash.operations.has(operation.documentId)) return;
  operation.pending = true;
  operation.phase = "preview";
  trash.status = { key: "documentPurgePreviewLoading", kind: "info" };
  renderLibraryTrash();
  try {
    const preview = await api(`/api/v1/documents/${encodeURIComponent(operation.documentId)}/purge-preview`);
    if (trash.purgeOperations.get(operation.documentId) !== operation) return;
    const payload = documentPurgePayload({ ...preview, request_id: "preview" });
    if (preview?.id !== operation.documentId || !payload) throw new ApiError("request_failed");
    operation.preview = preview;
    operation.pending = false;
    trash.status = null;
    renderLibraryTrash();
    if (!window.confirm(documentPurgeConfirmation(preview))) {
      trash.purgeOperations.delete(operation.documentId);
      renderLibraryTrash();
      return;
    }
    operation.payload = {
      request_id: crypto.randomUUID(),
      expected_revision: preview.expected_revision,
      preview_sha256: preview.preview_sha256
    };
    operation.phase = "delete";
    await runDocumentPurge(operation);
  } catch (error) {
    if (trash.purgeOperations.get(operation.documentId) !== operation) return;
    if (["revision_conflict", "document_revision_conflict", "document_purge_changed"].includes(error.code)) {
      await clearDocumentPurgeAndRefresh(operation, "documentPurgeChanged");
      return;
    }
    if (["document_not_deleted", "document_purged", "document_purge_pending", "document_purge_unsafe", "document_purge_too_large", "not_found", "validation_error"].includes(error.code)) {
      await clearDocumentPurgeAndRefresh(operation, error.code);
      return;
    }
    const key = ["network", "request_failed"].includes(error.code) ? "documentPurgePreviewFailed" : error.code || "documentPurgePreviewFailed";
    setDocumentPurgeStatus(operation, key);
  } finally {
    operation.pending = false;
    renderLibraryTrash();
  }
}

async function purgeDocument(documentId) {
  const trash = state.libraryTrash;
  const existing = trash.purgeOperations.get(documentId);
  if (existing) {
    if (existing.pending || trash.operations.has(documentId)) return;
    if (existing.phase === "delete" && existing.payload) await runDocumentPurge(existing);
    else await previewDocumentPurge(existing);
    return;
  }
  const document = trash.items.find((item) => item.id === documentId);
  if (!document || document.purge_pending || trash.operations.has(documentId)) return;
  const operation = {
    documentId,
    action: "purge",
    phase: "preview",
    payload: null,
    preview: null,
    pending: false,
    cleanupPending: false
  };
  trash.purgeOperations.set(documentId, operation);
  await previewDocumentPurge(operation);
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
      lookup: null,
      candidates: [],
      lookupSource: null,
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

function metadataSnapshotValue(snapshot, field) {
  const value = snapshot?.[field];
  return value === null || value === undefined ? "" : String(value);
}

function metadataLookupValue(field, value) {
  if (field === "year") {
    const year = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isInteger(year) && year >= 1 && year <= 9999 ? String(year) : null;
  }
  const limits = { title: 180, authors: 2000, doi: 255 };
  if (typeof value !== "string" || !value.trim() || value.length > limits[field]) return null;
  return value;
}

function safeMetadataSourceUrl(value, documentId) {
  if (typeof value !== "string" || !value || !documentId) return null;
  try {
    const url = new URL(value, window.location.origin);
    const canonicalDoi = url.protocol === "https:" && url.hostname === "doi.org" && url.pathname.length > 1;
    const currentPdf = url.origin === window.location.origin && url.pathname === `/api/v1/documents/${encodeURIComponent(documentId)}/file`;
    return canonicalDoi || currentPdf ? url.href : null;
  } catch {
    return null;
  }
}

function renderMetadataCandidates(entry) {
  const candidates = entry?.candidates || [];
  elements.metadataDoiCandidates.replaceChildren();
  elements.metadataDoiCandidatesLabel.hidden = !candidates.length;
  elements.metadataDoiCandidates.disabled = !candidates.length || Boolean(entry?.lookup);
  if (!candidates.length) return;
  const placeholder = window.document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("metadataDoiCandidatePlaceholder");
  elements.metadataDoiCandidates.append(placeholder);
  for (const doi of candidates) {
    const option = window.document.createElement("option");
    option.value = doi;
    option.textContent = doi;
    elements.metadataDoiCandidates.append(option);
  }
}

function renderMetadataSource(entry) {
  elements.metadataLookupSource.replaceChildren();
  const source = entry?.lookupSource;
  elements.metadataLookupSource.hidden = !source;
  if (!source) return;
  const provider = window.document.createElement("span");
  provider.textContent = t("metadataLookupSource", { provider: String(source.provider || "") });
  elements.metadataLookupSource.append(provider);
  const href = safeMetadataSourceUrl(source.url, state.document?.id);
  if (href) {
    const link = window.document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("metadataLookupSourceLink");
    elements.metadataLookupSource.append(link);
  }
  const warnings = Array.isArray(source.warnings) ? source.warnings.filter((warning) => typeof warning === "string" && warning) : [];
  if (warnings.length) {
    const warningText = window.document.createElement("span");
    warningText.className = "metadata-lookup-warnings";
    warningText.textContent = warnings.join(" ");
    elements.metadataLookupSource.append(warningText);
  }
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

  elements.metadataLookup.disabled = !document || !entry?.snapshot || entry.loading || Boolean(entry?.lookup) || pending || Boolean(draft?.conflicted);
  elements.metadataLookup.textContent = t(entry?.lookup ? "metadataLookupLoading" : "metadataLookup");
  elements.metadataEdit.hidden = Boolean(draft);
  elements.metadataEdit.disabled = !document || !entry?.snapshot || entry.loading || Boolean(entry?.lookup) || pending;
  elements.metadataSave.hidden = !draft;
  elements.metadataSave.disabled = !draft || Boolean(entry?.lookup) || pending || draft.conflicted;
  elements.metadataSave.textContent = t(draft?.saveFailed ? "retrySave" : "metadataSave");
  elements.metadataCancel.hidden = !draft;
  elements.metadataCancel.disabled = pending;
  elements.metadataViewLatest.hidden = !draft?.conflicted;
  elements.metadataViewLatest.disabled = entry?.loading || pending;
  elements.metadataRetry.hidden = !entry?.status?.retry || Boolean(entry?.lookup) || pending;
  elements.metadataStatus.textContent = entry?.status ? t(entry.status.key, entry.status.values || {}) : "";
  if (entry?.status?.kind) elements.metadataStatus.dataset.kind = entry.status.kind;
  else delete elements.metadataStatus.dataset.kind;
  elements.metadataLatest.hidden = !draft?.conflicted || !entry.latestVisible;
  renderMetadataCandidates(entry);
  renderMetadataSource(entry);
  renderMetadataLatest(entry);
}

async function lookupMetadata(documentId) {
  const entry = ensureMetadata(documentId);
  if (entry.lookup || state.pendingMetadata.has(documentId)) return;
  if (state.document?.id === documentId && !entry.draft) startMetadataEdit();
  const draft = entry.draft;
  if (!draft || draft.conflicted || !entry.snapshot) return;
  if (state.document?.id === documentId) captureCurrentMetadataDraft();
  const values = Object.fromEntries(["title", "authors", "year", "doi"].map((field) => [field, draft[field]]));
  const protectedFields = new Set(["title", "authors", "year"].filter((field) => values[field] !== metadataSnapshotValue(entry.snapshot, field)));
  const operation = {
    documentId,
    draft,
    values,
    protectedFields,
    controller: new AbortController()
  };
  let focusDoi = false;
  entry.lookup = operation;
  entry.candidates = [];
  entry.lookupSource = null;
  entry.status = { key: "metadataLookupLoading", kind: "info" };
  renderDocumentDetails();
  renderMetadata();

  try {
    const body = await api(`/api/v1/documents/${encodeURIComponent(documentId)}/metadata/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doi: values.doi.trim() }),
      signal: operation.controller.signal
    });
    if (entry.lookup !== operation || entry.draft !== draft) return;
    if (body.saved !== false) throw new ApiError("request_failed");
    if (body.metadata_revision !== draft.expectedRevision || entry.snapshot?.revision !== draft.expectedRevision) {
      draft.conflicted = true;
      entry.status = { key: "metadataConflict", kind: "error" };
      return;
    }
    if (body.source_sha256 !== entry.snapshot?.sha256) {
      entry.status = { key: "source_changed", kind: "error", retry: "lookup" };
      return;
    }
    if (body.status === "choose_doi") {
      entry.candidates = [...new Set((Array.isArray(body.candidates) ? body.candidates : []).filter((doi) => typeof doi === "string" && doi && doi.length <= 255))];
      entry.status = { key: "metadataLookupChooseDoi", kind: "info" };
      focusDoi = true;
    } else if (body.status === "not_found") {
      entry.status = { key: "metadataLookupNotFound", kind: "info" };
    } else if (body.status === "ready") {
      if (state.document?.id === documentId) captureCurrentMetadataDraft();
      for (const field of ["title", "authors", "year", "doi"]) {
        const value = metadataLookupValue(field, body.fields?.[field]);
        if (value === null || draft[field] !== values[field]) continue;
        if (field !== "doi" && protectedFields.has(field)) continue;
        draft[field] = value;
      }
      draft.operation = null;
      draft.saveFailed = false;
      entry.lookupSource = body.source && typeof body.source === "object" ? { ...body.source, warnings: body.warnings } : null;
      entry.status = { key: "metadataLookupReady", kind: "info" };
    } else {
      throw new ApiError("request_failed");
    }
  } catch (error) {
    if (error?.name === "AbortError" || entry.lookup !== operation || entry.draft !== draft) return;
    draft.conflicted = error.code === "revision_conflict";
    entry.status = draft.conflicted
      ? { key: "metadataConflict", kind: "error" }
      : { key: error.code || "request_failed", kind: "error", retry: "lookup" };
  } finally {
    if (entry.lookup === operation) entry.lookup = null;
    if (state.document?.id === documentId) {
      renderDocumentDetails();
      renderMetadata();
    }
  }
  if (focusDoi && state.document?.id === documentId && entry.draft === draft) elements.metadataDoi.focus();
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
    doi: snapshot.doi || "",
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
  entry.lookup?.controller.abort();
  entry.lookup = null;
  entry.draft = null;
  entry.candidates = [];
  entry.lookupSource = null;
  entry.status = null;
  entry.latestVisible = false;
  renderDocumentDetails();
  renderMetadata();
  elements.metadataEdit.focus();
}

async function submitMetadataSave(documentId) {
  const entry = ensureMetadata(documentId);
  const draft = entry.draft;
  if (!draft || entry.lookup || state.pendingMetadata.has(documentId)) return;
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
    entry.candidates = [];
    entry.lookupSource = null;
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

function hasActiveSavedPdfNotes(document) {
  return Boolean(document && !isStudy(document) && state.noteStatesLoaded && state.noteStates.some((note) => note.document_id === document.id && !note.deleted_at && !note.purged));
}

function renderDocumentDetails() {
  const document = state.document;
  elements.documentTitle.textContent = document ? document.title || document.original_filename || t("untitled") : "";
  elements.pageCount.textContent = document && !isStudy(document) ? t("pageOf", { count: document.page_count }) : "";
  elements.readerEmpty.hidden = Boolean(document);
  if (!document) elements.pageSurface.hidden = true;
  const hasPdf = Boolean(state.pdf && document);
  elements.pageInput.disabled = !hasPdf;
  elements.pageFirst.disabled = !hasPdf || state.page <= 1;
  elements.pagePrev.disabled = !hasPdf || state.page <= 1;
  elements.pageNext.disabled = !hasPdf || state.page >= (document?.page_count || 1);
  elements.pageLast.disabled = !hasPdf || state.page >= (document?.page_count || 1);
  elements.navigationToggle.disabled = !hasPdf;
  elements.zoomIn.disabled = !hasPdf || state.effectiveScale >= ZOOM_MAX;
  elements.zoomOut.disabled = !hasPdf || state.effectiveScale <= ZOOM_MIN;
  elements.zoomFit.disabled = !hasPdf;
  elements.zoomFitPage.disabled = !hasPdf;
  elements.readerFullscreen.disabled = !hasPdf;
  const annotationDisabled = !hasPdf || state.pendingSaves > 0 || state.pendingMutations.size > 0;
  const shapeUnsaved = Boolean(readerShapes?.hasUnsavedChanges?.());
  const historyCounts = document ? annotationHistory.counts(document.id) : { undo: 0, redo: 0 };
  elements.annotationUndo.disabled = !hasPdf || !historyCounts.undo || annotationDisabled || shapeUnsaved;
  elements.annotationRedo.disabled = !hasPdf || !historyCounts.redo || annotationDisabled || shapeUnsaved;
  readerNavigation?.update();
  renderSelectedAnnotationToolbar();
  readerShapes?.updateControls();
  readerShapes?.positionEditor();
  elements.textSelectionNote.disabled = annotationDisabled;
  elements.textSelectionAsk.disabled = annotationDisabled;
  elements.textSelectionTranslate.disabled = annotationDisabled;
  elements.textAnnotationHighlight.disabled = annotationDisabled;
  elements.textAnnotationUnderline.disabled = annotationDisabled;
  elements.textAnnotationToolbar.querySelectorAll("[data-annotation-color]").forEach((input) => {
    input.disabled = annotationDisabled;
  });
  elements.pageInput.max = String(document?.page_count || 1);
  if (!hasPdf || window.document.activeElement !== elements.pageInput) {
    elements.pageInput.value = hasPdf ? String(state.page) : "";
  }
  elements.zoomLabel.textContent = `${Math.round(state.effectiveScale * 100)}%`;
  elements.sample.disabled = state.pendingUpload;
  elements.uploadButton.disabled = state.pendingUpload;
  elements.uploadInput.disabled = state.pendingUpload;
  elements.exportReadingRecord.disabled = !document || isStudy(document) || state.pendingSaves > 0 || state.pendingExcerpts.size > 0 || state.pendingExports.size > 0 || state.pendingMutations.size > 0 || state.pendingMetadata.size > 0 || state.editDrafts.has(document.id) || Boolean(document && !isStudy(document) && ensureMetadata(document.id).draft);
  elements.exportReadingRecord.textContent = t(state.pendingExports.size > 0 ? "exporting" : "exportReadingRecord");
  elements.exportAnnotatedPdf.disabled = !hasActiveSavedPdfNotes(document) || state.pendingSaves > 0 || state.pendingExcerpts.size > 0 || state.pendingExports.size > 0 || state.pendingMutations.size > 0 || state.pendingMetadata.size > 0 || state.editDrafts.has(document.id) || Boolean(document && !isStudy(document) && ensureMetadata(document.id).draft);
  elements.exportAnnotatedPdf.textContent = t(document && state.pendingExports.has(`annotated-pdf:${document.id}`) ? "exportingAnnotatedPdf" : "exportAnnotatedPdf");
  elements.viewMode.disabled = !hasPdf;
  elements.viewMode.value = state.viewMode || "continuous";
  readerFind?.update();
  assistant?.contextChanged();
}

function renderRegionCapture() {
  const capture = state.regionCapture?.documentId === state.document?.id ? state.regionCapture : null;
  elements.regionDraft.hidden = !capture;
  if (!capture) return;
  if (elements.regionPreview.firstChild !== capture.previewCanvas) elements.regionPreview.replaceChildren(capture.previewCanvas);
  elements.regionDraftStatus.dataset.kind = capture.error ? "error" : "info";
  elements.regionDraftStatus.textContent = t(capture.pending ? "captureUploading" : capture.error || (capture.shape ? "shapeRegionDraftUnsaved" : "regionDraftUnsaved"));
  const disabled = capture.pending || state.pendingSaves > 0 || state.pendingMutations.size > 0;
  elements.regionAddNote.disabled = disabled;
  elements.regionAddAgent.disabled = disabled;
  elements.regionDraftCancel.disabled = disabled;
}

function renderDraft() {
  if (isStudy()) {
    elements.regionDraft.hidden = true;
    elements.readerRegionMode.disabled = true;
    richText?.close({ restoreFocus: false });
    study?.renderDocument();
    return;
  }
  if (!state.document) {
    elements.noteForm.dataset.mode = "create";
    elements.editModeLabel.hidden = true;
    elements.editCancel.hidden = true;
    elements.excerptSave.hidden = true;
    elements.regionDraft.hidden = true;
    elements.noteText.value = "";
    elements.noteText.disabled = true;
    elements.noteText.readOnly = false;
    elements.richTextPlain.disabled = true;
    elements.richTextPlain.hidden = true;
    elements.richTextDraftStatus.hidden = true;
    elements.noteSave.disabled = true;
    elements.excerptSave.disabled = true;
    elements.readerRegionMode.disabled = true;
    elements.pageNote.disabled = true;
    elements.activeSource.textContent = t("noSource");
    elements.characterCount.textContent = "0 / 10000";
    richText?.sync();
    return;
  }

  const editDraft = state.editDrafts.get(state.document.id);
  const draft = editDraft || ensureDraft(state.document.id);
  const formatted = Boolean(draft.richContent);
  if (elements.noteText.value !== draft.text) elements.noteText.value = draft.text;
  elements.characterCount.textContent = `${draft.text.length} / 10000`;
  elements.noteText.readOnly = formatted;
  elements.richTextPlain.hidden = !formatted;
  elements.richTextDraftStatus.hidden = false;
  elements.noteForm.dataset.mode = editDraft ? "edit" : "create";
  elements.editModeLabel.hidden = !editDraft;
  elements.editCancel.hidden = !editDraft;
  elements.excerptSave.hidden = true;
  renderRegionCapture();

  if (editDraft) {
    const note = state.notes.find((item) => item.id === editDraft.noteId) || editDraft.note;
    const pending = state.pendingMutations.has(mutationKey(state.document.id, editDraft.noteId));
    elements.activeSource.textContent = t(note.rect ? "pageRegion" : "pageWhole", { page: note.page });
    elements.noteText.disabled = pending;
    elements.richTextPlain.disabled = pending;
    elements.readerRegionMode.disabled = !state.pdf || pending;
    elements.pageNote.disabled = true;
    elements.noteSave.disabled = pending || !editDraft.text.trim();
    elements.excerptSave.disabled = true;
    elements.editCancel.disabled = pending;
    elements.noteSave.textContent = t(editDraft.saveFailed ? "retryEdit" : "saveEdit");
    elements.anchorHelp.textContent = t("editMode");
    richText?.sync();
    return;
  }

  if (draft.page === null) elements.activeSource.textContent = t("noSource");
  else elements.activeSource.textContent = t(draft.rect ? "pageRegion" : "pageWhole", { page: draft.page });
  const pending = state.pendingSaves > 0;
  const mutationPending = state.pendingMutations.size > 0;
  const ready = Boolean(state.pdf);
  elements.noteText.disabled = pending;
  elements.richTextPlain.disabled = pending || mutationPending;
  elements.readerRegionMode.disabled = !ready || pending || mutationPending;
  elements.pageNote.disabled = !ready || pending || mutationPending;
  elements.noteSave.disabled = pending || mutationPending || !ready || draft.page === null || !draft.text.trim();
  elements.excerptSave.disabled = true;
  elements.noteSave.textContent = t(draft.saveFailed ? "retrySave" : "saveNote");
  elements.anchorHelp.textContent = state.regionActive ? t("regionInstructions") : t("anchorHelp");
  richText?.sync();
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

function makeAnnotationStyleControl(document, note, annotation, field, disabled) {
  const label = window.document.createElement("label");
  label.className = "annotation-style-control";
  label.textContent = t(field === "kind" ? "annotationKind" : "annotationColor");
  const select = window.document.createElement("select");
  select.dataset.action = field === "kind" ? "annotation-kind" : "annotation-color";
  select.dataset.noteId = note.id;
  select.disabled = disabled;
  select.setAttribute("aria-label", `${label.textContent}: ${note.annotation?.quote || note.text}`);
  const values = field === "kind" ? ["highlight", "underline"] : ["yellow", "green", "blue", "pink"];
  for (const value of values) {
    const option = window.document.createElement("option");
    option.value = value;
    option.textContent = t(field === "kind" ? `annotationKind${value[0].toUpperCase()}${value.slice(1)}` : `color${value[0].toUpperCase()}${value.slice(1)}`);
    option.selected = annotation[field] === value;
    select.append(option);
  }
  select.addEventListener("change", () => changeAnnotationStyle(document, note, { [field]: select.value }));
  label.append(select);
  return label;
}

function appendRichNoteBody(item, note, noteState) {
  if (!noteState?.rich_content || typeof noteState.rich_html !== "string") return false;
  const body = window.document.createElement("div");
  body.className = "note-rich-content";
  item.append(body);
  void renderRichHtml(body, { html: noteState.rich_html, text: note.text, language: state.language });
  return true;
}

function ensureNoteTools(documentId) {
  if (!state.noteTools.has(documentId)) {
    state.noteTools.set(documentId, { query: "", color: "all", kind: "all", selected: new Set(), message: null });
  }
  return state.noteTools.get(documentId);
}

function filteredPaperNotes(document) {
  if (!document) return [];
  const tools = ensureNoteTools(document.id);
  const query = tools.query.trim().toLocaleLowerCase();
  return state.notes.filter((note) => {
    const noteState = noteStateFor(note.id);
    if (noteState?.deleted_at || noteState?.purged || noteState?.document_id && noteState.document_id !== document.id) return false;
    const annotation = noteState?.annotation || note.annotation || null;
    const shape = noteState?.shape_annotation || null;
    if (tools.color !== "all" && (shape?.color || annotation?.color) !== tools.color) return false;
    if (tools.kind !== "all" && (shape?.kind || annotation?.kind) !== tools.kind) return false;
    if (!query) return true;
    return `${note.text || ""}\n${annotation?.quote || ""}\n${shape?.kind || ""}`.toLocaleLowerCase().includes(query);
  });
}

function renderNoteTools(document, visibleNotes) {
  const paper = document && !isStudy(document) ? document : null;
  elements.notesFilterPanel.hidden = !paper;
  if (!paper) return;
  elements.notesFilterPanel.setAttribute("aria-label", t("notesFilterText"));
  const tools = ensureNoteTools(paper.id);
  const visibleIds = new Set(visibleNotes.map((note) => note.id));
  for (const id of [...tools.selected]) {
    if (!visibleIds.has(id)) tools.selected.delete(id);
  }
  if (elements.notesFilterQuery.value !== tools.query) elements.notesFilterQuery.value = tools.query;
  elements.notesFilterColor.value = tools.color;
  elements.notesFilterKind.value = tools.kind;
  const filtered = Boolean(tools.query || tools.color !== "all" || tools.kind !== "all");
  elements.notesFilterClear.disabled = !filtered;
  elements.notesSelectVisible.disabled = !visibleNotes.length;
  elements.notesSelectionClear.disabled = !tools.selected.size;
  elements.notesBatchAgent.disabled = !tools.selected.size || tools.selected.size > 8 || state.pendingSaves > 0 || state.pendingMutations.size > 0;
  const status = [t("notesVisibleCount", { visible: visibleNotes.length, total: state.notes.length })];
  if (state.notes.length && !visibleNotes.length) status.push(t("notesNoMatch"));
  if (tools.selected.size) status.push(t("notesSelectedCount", { count: tools.selected.size }));
  if (tools.selected.size > 8) status.push(t("notesBatchLimit"));
  if (tools.message) status.push(t(tools.message.key, tools.message.values));
  elements.notesFilterStatus.textContent = status.join(" · ");
  elements.notesFilterStatus.dataset.kind = tools.message?.kind || (tools.selected.size > 8 ? "error" : "info");
}

function renderNotes() {
  if (isStudy()) {
    elements.notesFilterPanel.hidden = true;
    study?.renderNotes();
    return;
  }
  elements.notesList.replaceChildren();
  const document = state.document;
  const hasDocument = Boolean(document);
  const visibleNotes = filteredPaperNotes(document);
  elements.notesEmpty.hidden = !hasDocument || visibleNotes.length > 0;
  elements.notesEmpty.textContent = t(state.notes.length ? "notesNoMatch" : "emptyNotes");
  elements.notesCount.textContent = hasDocument && state.notes.length ? String(state.notes.length) : "";
  const actionsLocked = state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.pendingExcerpts.size > 0 || (document && state.editDrafts.has(document.id));
  renderNoteTools(document, visibleNotes);

  for (const note of visibleNotes) {
    const noteState = noteStateFor(note.id);
    const annotation = noteState?.annotation || note.annotation || null;
    const shape = noteState?.shape_annotation || null;
    const reviewStatus = noteState?.review_status || "unreviewed";
    const item = window.document.createElement("li");
    item.className = "note-item";
    item.dataset.noteId = note.id;
    item.dataset.reviewStatus = reviewStatus;
    if (annotation || shape) {
      item.dataset.annotationKind = shape?.kind || annotation.kind;
      item.dataset.annotationColor = shape?.color || annotation.color;
    }
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "note-open";
    button.addEventListener("click", () => openNote(note.id));
    const source = window.document.createElement("span");
    source.className = "note-source";
    source.textContent = shape
      ? t("notePageShape", { page: note.page, kind: shapeKindLabel(shape.kind) })
      : t(annotation ? "notePageAnnotation" : note.rect ? "notePageRegion" : "notePageWhole", { page: note.page });
    button.append(source);
    if (annotation?.quote && annotation.quote.trim() !== note.text.trim()) {
      const quote = window.document.createElement("span");
      quote.className = "note-annotation-quote";
      quote.textContent = annotation.quote;
      button.append(quote);
    }
    const selectionRow = window.document.createElement("div");
    selectionRow.className = "note-selection-row";
    const checkbox = window.document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.noteSelect = note.id;
    const tools = ensureNoteTools(document.id);
    checkbox.checked = tools.selected.has(note.id);
    checkbox.disabled = !noteState || state.pendingSaves > 0 || state.pendingMutations.size > 0;
    const summary = (annotation?.quote || note.text || "").trim().slice(0, 100);
    checkbox.setAttribute("aria-label", `${source.textContent}: ${summary}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) tools.selected.add(note.id);
      else tools.selected.delete(note.id);
      tools.message = null;
      renderNoteTools(document, filteredPaperNotes(document));
    });
    selectionRow.append(checkbox, button);
    item.append(selectionRow);
    if (!appendRichNoteBody(item, note, noteState)) {
      const text = window.document.createElement("span");
      text.className = "note-text-preview";
      text.textContent = note.text;
      button.append(text);
    }
    imageLibrary?.appendNoteImages(item, note, noteState);

    const reviewRow = window.document.createElement("div");
    reviewRow.className = "note-review-row";
    const badge = window.document.createElement("span");
    badge.className = "review-badge";
    badge.dataset.status = reviewStatus;
    badge.textContent = t(reviewStatus === "source_checked" ? "reviewChecked" : "reviewUnreviewed");
    reviewRow.append(badge);
    item.append(reviewRow);

    const excerpt = state.excerpts.find((item) => item.note_id === note.id);
    if (!shape && note.rect && excerpt) {
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
    } else if (!shape && note.rect) {
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

    if (annotation) {
      const styleControls = window.document.createElement("div");
      styleControls.className = "annotation-style-controls";
      styleControls.append(
        makeAnnotationStyleControl(document, note, annotation, "kind", actionsLocked || !noteState),
        makeAnnotationStyleControl(document, note, annotation, "color", actionsLocked || !noteState)
      );
      item.append(styleControls);
    }
    const actions = window.document.createElement("div");
    actions.className = "note-actions";
    if (annotation || shape) actions.append(makeNoteAction("annotation-actions", t("annotationAction"), () => showAnnotationFromNote(document, note), actionsLocked || !noteState));
    actions.append(
      makeNoteAction("annotation-agent", t("addToAssistant"), () => shape ? shareShapeFromNote(document, noteState, "agent") : assistant?.addNoteReference(document.id, noteState), actionsLocked || !noteState),
      makeNoteAction("edit-note", t("editNote"), () => shape ? showAnnotationFromNote(document, note) : startEditNote(document, note), actionsLocked || !noteState),
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
    state.studies = Array.isArray(studyBody.items) ? studyBody.items.filter((item) => !isPersonalOwner(item)) : [];
    study?.setStudies(state.studies);
    renderDocuments();
    const params = new URLSearchParams(window.location.search);
    const requestedStudy = params.get("study");
    const requestedDocument = requestedStudy || params.get("document");
    const requestedNote = params.get("note");
    const requestedPage = readPageParam(params);
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
        page: requestedMode === "reading" ? requestedPage : null,
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

function renderReaderProgressStatus() {
  const key = state.readerProgress.status;
  elements.readerProgressStatus.hidden = !key;
  elements.readerProgressStatus.textContent = key ? t(key) : "";
}

function setReaderProgressStatus(key) {
  state.readerProgress.status = key;
  renderReaderProgressStatus();
}

function readerProgressMatchesCurrentOwner(snapshot) {
  const owner = state.document;
  return Boolean(snapshot && owner && snapshot.owner?.id === owner.id && snapshot.owner?.sha256 === owner.sha256 && snapshot.sequence === state.loadSequence);
}

function cancelReaderProgressRestore() {
  const progress = state.readerProgress;
  progress.pending = null;
  progress.restoring = false;
  progress.generation += 1;
  if (state.pdf) progress.loading = false;
  if (progress.captureTimer) clearTimeout(progress.captureTimer);
  progress.captureTimer = null;
  if (progress.status === "readerProgressRestored") setReaderProgressStatus(null);
}

function snapshotReaderProgress() {
  const progress = state.readerProgress;
  const owner = state.document;
  if (progress.loading || progress.restoring || state.readerLayoutLocked || state.regionActive || state.selection || state.pointerDragPage !== null) return null;
  if (!state.pdf || !owner || isStudy(owner) || !visibleReaderBounds() || elements.readerStage.clientHeight <= 0) return null;
  const viewportCenter = elements.readerStage.scrollTop + elements.readerStage.clientHeight / 2;
  let record = null;
  for (const candidate of state.readerPages.values()) {
    if (candidate.surface.hidden || !candidate.surface.isConnected || candidate.surface.offsetHeight <= 0) continue;
    const top = candidate.surface.offsetTop;
    if (viewportCenter >= top && viewportCenter <= top + candidate.surface.offsetHeight) {
      record = candidate;
      break;
    }
  }
  if (!record) record = state.activePageRecord;
  if (!record || state.readerPages.get(record.pageNumber) !== record || !record.rendered || record.sequence !== state.renderSequence) return null;
  const centerFraction = (viewportCenter - record.surface.offsetTop) / record.surface.offsetHeight;
  const boundedCenterFraction = Math.max(0, Math.min(1, centerFraction));
  if (!Number.isFinite(boundedCenterFraction) || boundedCenterFraction < 0 || boundedCenterFraction > 1) return null;
  const snapshot = { owner, sequence: state.loadSequence, page: record.pageNumber, centerFraction: boundedCenterFraction };
  progress.last = snapshot;
  return snapshot;
}

function persistReaderProgressSnapshot(snapshot) {
  if (!readerProgressMatchesCurrentOwner(snapshot) || isStudy(snapshot.owner)) return;
  if (!writeReaderProgress(snapshot.owner, snapshot.page, snapshot.centerFraction)) setReaderProgressStatus("readerProgressStorageUnavailable");
}

function flushReaderProgress() {
  const progress = state.readerProgress;
  if (progress.captureTimer) clearTimeout(progress.captureTimer);
  progress.captureTimer = null;
  let snapshot = snapshotReaderProgress();
  if (!snapshot && readerProgressMatchesCurrentOwner(progress.last)) snapshot = progress.last;
  persistReaderProgressSnapshot(snapshot);
}

function scheduleReaderProgressCapture() {
  const progress = state.readerProgress;
  const snapshot = snapshotReaderProgress();
  if (!snapshot) return;
  if (progress.captureTimer) clearTimeout(progress.captureTimer);
  progress.captureTimer = setTimeout(() => {
    progress.captureTimer = null;
    persistReaderProgressSnapshot(snapshot);
  }, 180);
}

function prepareReaderProgressRestore(owner, sequence) {
  const result = readReaderProgress(owner);
  if (result.unavailable) setReaderProgressStatus("readerProgressStorageUnavailable");
  if (result.record) state.readerProgress.pending = { owner, sequence, record: result.record };
}

async function restorePendingReaderProgress() {
  const progress = state.readerProgress;
  const pending = progress.pending;
  if (!pending || progress.restoring || !visibleReaderBounds()) return;
  if (!readerProgressMatchesCurrentOwner(pending) || state.pdf === null) {
    progress.pending = null;
    if (state.pdf) progress.loading = false;
    return;
  }
  progress.pending = null;
  const generation = ++progress.generation;
  progress.restoring = true;
  try {
    await goToPage(pending.record.page, { restoreProgress: true, preserveUrl: true });
    if (generation !== progress.generation || !readerProgressMatchesCurrentOwner(pending)) return;
    if (!visibleReaderBounds()) {
      progress.pending = pending;
      return;
    }
    setReaderProgressStatus("readerProgressRestored");
    if (state.viewMode === "continuous") {
      const record = state.readerPages.get(pending.record.page);
      if (!record || record.surface.offsetHeight <= 0) {
        progress.pending = pending;
        return;
      }
      elements.readerStage.scrollTop = Math.max(0, record.surface.offsetTop + pending.record.center_fraction * record.surface.offsetHeight - elements.readerStage.clientHeight / 2);
      handleContinuousScroll();
    }
    progress.loading = false;
  } finally {
    if (generation === progress.generation) {
      progress.restoring = false;
      if (!progress.pending) progress.loading = false;
      scheduleReaderProgressCapture();
    }
  }
}

function cancelDocumentWork() {
  readerObjects?.reset();
  readerShapes?.documentChanged();
  closeSelectedAnnotation();
  readerNavigation?.setDocument(null);
  flushReaderProgress();
  cancelReaderProgressRestore();
  state.readerProgress.last = null;
  renderReaderProgressStatus();
  readerFind?.documentChanged();
  richText?.close({ restoreFocus: false });
  imageViewer?.close({ restoreFocus: false });
  researchRecord?.documentChanged();
  state.loadSequence += 1;
  state.noteNavigationSequence += 1;
  state.renderSequence += 1;
  for (const entry of state.metadata.values()) entry.lookup?.controller.abort();
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
  state.pointerDragPage = null;
  state.pdfLinks?.destroy();
  state.pdfLinks = null;
  destroyReaderPages();
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

function prepareContextNavigation() {
  captureCurrentDraft();
  captureCurrentMetadataDraft();
  const documentId = state.document?.id;
  const pendingWrite = Boolean(
    state.pendingSaves > 0 ||
    state.pendingMutations.size > 0 ||
    state.pendingMetadata.size > 0 ||
    state.pendingExcerpts.size > 0 ||
    documentId && study?.hasPending(documentId) ||
    documentId && analysis?.hasPending?.(documentId) ||
    dataImports?.isImportPending?.()
  );
  if (pendingWrite) setStatus("navigationPendingWrite", "info");
  else if (readerShapes?.hasUnsavedChanges?.()) setStatus("navigationDrawing", "error");
  else if (state.regionCapture) setStatus("navigationScreenshot", "error");
  else if (state.selection) setStatus("navigationSelection", "error");
  else if (richText?.hasUnpreservedChanges?.()) setStatus("navigationRichDraftError", "error");
  else return true;
  return false;
}

function invalidateWorkspaceModeIntent(intent = null) {
  if (intent !== null && intent === workspaceModeIntent) return;
  workspaceModeIntent += 1;
  workspaceModePending = false;
  workspace?.setModePending(false);
}

function beginWorkspaceModeIntent() {
  if (workspaceModePending || !prepareContextNavigation()) return null;
  const intent = ++workspaceModeIntent;
  workspaceModePending = true;
  workspace?.setModePending(true);
  return intent;
}

function finishWorkspaceModeIntent(intent) {
  if (intent !== workspaceModeIntent) return;
  workspaceModePending = false;
  workspace?.setModePending(false);
}

function readDataSelection() {
  const params = new URLSearchParams(window.location.search);
  return {
    datasetId: params.get("dataset") || null,
    analysisId: params.get("analysis") || null,
    chartId: params.get("chart") || null
  };
}

function rememberCurrentWorkspaceOwner() {
  if (!state.document) return;
  if (workspace?.getMode() === "reading" && !isStudy()) lastReadingDocumentId = state.document.id;
  if (workspace?.getMode() === "data") {
    lastDataDocumentId = state.document.id;
    lastDataSelection = readDataSelection();
  }
}

function clearActiveDocument(mode = "reading") {
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
  updateUrl(null, null, true, mode);
  clearStatus();
}

async function ensurePersonalOwner() {
  let body = await api("/api/v1/data-workspace/personal");
  let owner = body?.owner || null;
  if (!owner) {
    body = await api("/api/v1/data-workspace/personal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    owner = body?.owner || null;
  }
  if (!isPersonalOwner(owner) || !owner.id) throw new ApiError("personalOpenFailed");
  return owner;
}

async function openPersonalWithIntent(intent) {
  try {
    const owner = await ensurePersonalOwner();
    if (intent !== workspaceModeIntent) return;
    await openDocument(owner.id, {
      ownerKind: "study",
      workspace: "data",
      explicitIntent: true,
      modeIntent: intent
    });
  } catch (error) {
    if (intent === workspaceModeIntent) setStatus(error.code || "personalOpenFailed", "error", {}, openPersonalData);
  } finally {
    finishWorkspaceModeIntent(intent);
  }
}

async function openPersonalData() {
  const intent = beginWorkspaceModeIntent();
  if (intent === null) return;
  rememberCurrentWorkspaceOwner();
  workspace?.reveal("data", { tool: "analysis" });
  await openPersonalWithIntent(intent);
}

async function openDataWorkspace() {
  const intent = beginWorkspaceModeIntent();
  if (intent === null) return;
  rememberCurrentWorkspaceOwner();
  workspace?.reveal("data", { tool: lastDataSelection.chartId ? "charts" : "analysis" });
  const targetId = lastDataDocumentId || (isStudy() ? state.document?.id : null);
  if (!targetId) {
    await openPersonalWithIntent(intent);
    return;
  }
  try {
    const selection = targetId === lastDataDocumentId ? lastDataSelection : { datasetId: null, analysisId: null, chartId: null };
    await openDocument(targetId, {
      workspace: "data",
      ...selection,
      tool: selection.chartId ? "charts" : "analysis",
      explicitIntent: true,
      passiveRestore: true,
      modeIntent: intent
    });
  } finally {
    finishWorkspaceModeIntent(intent);
  }
}

async function openReadingWorkspace() {
  const intent = beginWorkspaceModeIntent();
  if (intent === null) return;
  rememberCurrentWorkspaceOwner();
  workspace?.reveal("reading");
  try {
    const targetId = state.documents.some((item) => item.id === lastReadingDocumentId) ? lastReadingDocumentId : state.documents[0]?.id || null;
    if (targetId) await openDocument(targetId, { workspace: "reading", explicitIntent: true, modeIntent: intent });
    else clearActiveDocument("reading");
  } finally {
    finishWorkspaceModeIntent(intent);
  }
}

function openCatalogItem(item) {
  if (!item?.document_id || !item.id) return;
  const selection = item.kind === "dataset" ? { datasetId: item.id } : item.kind === "analysis" ? { analysisId: item.id } : { chartId: item.id };
  return openDocument(item.document_id, {
    workspace: "data",
    ...selection,
    tool: item.kind === "chart" ? "charts" : "analysis",
    explicitIntent: true
  });
}

function restorePassiveDataSelection(documentId, options) {
  if (!options.passiveRestore) return false;
  const datasetId = options.datasetId || null;
  const analysisId = options.analysisId || null;
  const chartId = options.chartId || null;
  if (chartId && charts?.getActiveChartId(documentId) === chartId) {
    showChartInUrl(documentId, chartId);
    return true;
  }
  if (analysisId && analysis?.getActiveAnalysisId() === analysisId) {
    showAnalysisInUrl(documentId, analysisId);
    return true;
  }
  if (datasetId && analysis?.getSelectedDatasetId() === datasetId) {
    showDatasetInUrl(documentId, datasetId);
    return true;
  }
  if (datasetId || analysisId || chartId) return false;
  const activeChartId = charts?.getActiveChartId(documentId);
  if (activeChartId) {
    showChartInUrl(documentId, activeChartId);
    return true;
  }
  const activeAnalysisId = analysis?.getActiveAnalysisId();
  if (activeAnalysisId) {
    showAnalysisInUrl(documentId, activeAnalysisId);
    return true;
  }
  const selectedDatasetId = analysis?.getSelectedDatasetId();
  if (selectedDatasetId) {
    showDatasetInUrl(documentId, selectedDatasetId);
    return true;
  }
  return false;
}

async function openDocument(documentId, options = {}) {
  if (options.modeIntent != null && options.modeIntent !== workspaceModeIntent) return false;
  invalidateWorkspaceModeIntent(options.modeIntent ?? null);
  const navigationIntent = workspaceModeIntent;
  const knownTarget = state.documents.find((item) => item.id === documentId) || state.studies.find((item) => item.id === documentId);
  const requestedMode = options.workspace || (options.noteId || options.imageLink ? "reading" : options.analysisId || options.datasetId || options.chartId || knownTarget?.kind === "study" ? "data" : null);
  const contextChanging = Boolean(state.document && (state.document.id !== documentId || requestedMode && requestedMode !== workspace?.getMode()));
  if (contextChanging && !prepareContextNavigation()) return false;
  const explicitIntent = Boolean(options.explicitIntent || options.noteId || options.imageLink || options.analysisId || options.datasetId || options.chartId);
  if (explicitIntent || state.document && state.document.id !== documentId) cancelReaderProgressRestore();
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
    if (resolveSequence !== state.loadSequence || navigationIntent !== workspaceModeIntent) return false;
    if (!document && !["not_found", "document_trashed"].includes(resolveError?.code)) {
      setStatus(resolveError?.code || "documentOpenFailed", "error", {}, () => openDocument(documentId, options));
      return;
    }
    const resolvedMode = options.workspace || (options.noteId || options.imageLink ? "reading" : options.analysisId || options.datasetId || options.chartId || document?.kind === "study" ? "data" : null);
    const resolveContextChanging = Boolean(state.document && (state.document.id !== documentId || resolvedMode && resolvedMode !== workspace?.getMode()));
    if (resolveContextChanging && !prepareContextNavigation()) return false;
    if (navigationIntent !== workspaceModeIntent) return false;
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
      if (!isPersonalOwner(document)) {
        state.studies = [document, ...state.studies.filter((item) => item.id !== document.id)];
        study?.setStudies(state.studies);
      }
    } else {
      state.documents = [document, ...state.documents.filter((item) => item.id !== document.id)];
    }
  }
  const studyOwner = isStudy(document);
  const explicitPage = !studyOwner && Number.isInteger(options.page) && options.page >= 1 && options.page <= document.page_count ? options.page : null;
  const explicitNavigation = Boolean(options.explicitIntent || options.noteId || options.imageLink || explicitPage || options.analysisId || options.datasetId || options.chartId);
  const mode = options.workspace || (options.noteId || options.imageLink ? "reading" : options.analysisId || options.datasetId || options.chartId ? "data" : studyOwner ? "data" : workspace?.getMode() || "reading");
  const tool = options.chartId || options.tool === "charts" ? "charts" : "analysis";
  if (mode === "reading" && !studyOwner) lastReadingDocumentId = documentId;
  if (mode === "data") {
    lastDataDocumentId = documentId;
    lastDataSelection = {
      datasetId: options.datasetId || null,
      analysisId: options.analysisId || null,
      chartId: options.chartId || null
    };
  }
  if (state.document?.id === documentId && (studyOwner ? state.noteStatesLoaded : state.pdf) && !options.force) {
    workspace?.reveal(mode, { tool, showNotes: Boolean(options.noteId || options.imageLink) });
    if (!options.preserveUrl && !options.imageLink && !options.noteId && !explicitPage) updateUrl(documentId, null, Boolean(options.replaceUrl), mode, tool);
    if (options.imageLink && !studyOwner) await openImageViewer(documentId, options.imageLink.kind, options.imageLink.sourceId, { annotationId: options.imageLink.annotationId });
    else if (options.noteId) await openNote(options.noteId, { preserveUrl: options.preserveUrl });
    else if (explicitPage) {
      if (!options.preserveUrl) updateUrl(documentId, null, Boolean(options.replaceUrl), mode, tool, explicitPage);
      await goToPage(explicitPage, { preserveUrl: true });
    }
    const restoredSelection = restorePassiveDataSelection(documentId, options);
    if (options.datasetId && !restoredSelection) await analysis?.openDataset(options.datasetId, { preserveUrl: options.preserveUrl });
    if (options.analysisId && !restoredSelection) await analysis?.openJob(options.analysisId, { preserveUrl: options.preserveUrl });
    if (options.chartId && !restoredSelection) await charts?.openChart(documentId, options.chartId, { preserveUrl: options.preserveUrl });
    return;
  }

  if (navigationIntent !== workspaceModeIntent) return false;
  const navigationContextChanging = Boolean(state.document && (state.document.id !== documentId || mode !== workspace?.getMode()));
  if (navigationContextChanging && !prepareContextNavigation()) return false;
  if (navigationIntent !== workspaceModeIntent) return false;
  workspace?.reveal(mode, { tool, showNotes: Boolean(options.noteId || options.imageLink) });
  captureCurrentDraft();
  captureCurrentMetadataDraft();
  cancelDocumentWork();
  state.readerProgress.loading = true;
  const sequence = state.loadSequence;
  const controller = new AbortController();
  state.loadController = controller;
  state.document = document;
  state.page = explicitPage || 1;
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
  if (!options.preserveUrl) updateUrl(documentId, options.noteId || null, Boolean(options.replaceUrl), mode, tool, options.noteId ? null : explicitPage);
  renderDocuments();
  renderDocumentDetails();
  renderMetadata();
  renderDraft();
  renderNotes();
  imageLibrary?.documentChanged(studyOwner ? null : document);
  analysis?.reload(documentId);
  dataImports?.reload(documentId);
  charts?.reload(documentId);
  const restoredSelection = restorePassiveDataSelection(documentId, options);
  if (options.datasetId && !restoredSelection) analysis?.openDataset(options.datasetId, { preserveUrl: options.preserveUrl });
  if (options.analysisId && !restoredSelection) analysis?.openJob(options.analysisId, { preserveUrl: options.preserveUrl });
  if (options.chartId && !restoredSelection) charts?.openChart(documentId, options.chartId, { preserveUrl: options.preserveUrl });
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
    state.readerProgress.loading = false;
    elements.pageSurface.hidden = true;
    elements.readerEmpty.hidden = false;
    renderDocumentDetails();
    renderDraft();
    const key = pdfResult.reason?.name === "AbortError" ? null : pdfResult.reason?.code || "documentOpenFailed";
    if (key) setStatus(key, "error", {}, () => openDocument(documentId, { force: true }));
    return;
  }

  state.pdf = pdfResult.value;
  readerNavigation?.setDocument(state.pdf);
  if (state.pdf) {
    const pdf = state.pdf;
    state.pdfLinks = createPdfReaderLinks({
      pdfjsLib,
      pdf,
      currentPage: () => state.page,
      isCurrent: (record) => sequence === state.loadSequence && state.pdf === pdf && state.readerPages.get(record.pageNumber) === record,
      navigate: navigatePdfLink
    });
  }
  if (!studyOwner && !explicitNavigation) prepareReaderProgressRestore(document, sequence);
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
  if (!studyOwner) {
    await requestRender();
    if (sequence === state.loadSequence && state.document?.id === documentId) {
      if (state.readerProgress.pending) await restorePendingReaderProgress();
      else state.readerProgress.loading = false;
    }
  }
  if (sequence !== state.loadSequence || state.document?.id !== documentId) return;
  if (!studyOwner && options.imageLink) {
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
  renderDocumentDetails();
  renderNotes();
  renderTextAnnotations();
  readerShapes?.render();
}

async function loadExcerpts(document, sequence, signal) {
  const body = await api(`/api/v1/documents/${encodeURIComponent(document.id)}/excerpts`, { signal });
  if (sequence !== state.loadSequence || state.document?.id !== document.id) return;
  state.excerpts = Array.isArray(body.items) ? body.items : [];
  renderNotes();
}

const PAGE_ID_FIELDS = {
  surface: "page-surface",
  canvas: "reader-canvas",
  textLayer: "reader-text-layer",
  textAnnotationsLayer: "text-annotations-layer",
  overlay: "region-overlay",
  activeSelection: "active-selection"
};

function availableReaderWidth() {
  const style = getComputedStyle(elements.readerStage);
  return Math.max(160, elements.readerStage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) || 600);
}

function setPageEstimate(record) {
  const baseWidth = record.baseWidth || 612;
  const baseHeight = record.baseHeight || 792;
  const scale = state.zoomMode === "fit" ? availableReaderWidth() / baseWidth : state.zoom;
  const width = Math.max(1, Math.floor(baseWidth * scale));
  const height = Math.max(1, Math.floor(baseHeight * scale));
  record.surface.style.width = `${width}px`;
  record.surface.style.height = `${height}px`;
  record.surface.style.setProperty("--scale-factor", String(scale));
  record.surface.style.setProperty("--total-scale-factor", String(scale * (record.page?.userUnit || 1)));
  record.surface.style.setProperty("--scale-round-x", "1px");
  record.surface.style.setProperty("--scale-round-y", "1px");
  record.scale = scale;
}

function createReaderPage(pageNumber, useLegacy = false) {
  let nodes;
  if (useLegacy) {
    nodes = {
      surface: elements.pageSurface,
      canvas: elements.canvas,
      textLayer: elements.textLayer,
      textAnnotationsLayer: elements.textAnnotationsLayer,
      overlay: elements.overlay,
      activeSelection: elements.activeSelection
    };
  } else {
    const surface = window.document.createElement("div");
    surface.className = "page-surface";
    const canvas = window.document.createElement("canvas");
    canvas.setAttribute("aria-label", t("pdfPage"));
    const textLayer = window.document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.setAttribute("aria-label", t("pdfPage"));
    const textAnnotationsLayer = window.document.createElement("div");
    textAnnotationsLayer.className = "text-annotations-layer";
    textAnnotationsLayer.setAttribute("aria-hidden", "true");
    const overlay = window.document.createElement("div");
    overlay.className = "region-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.dataset.active = String(state.regionActive);
    const activeSelection = window.document.createElement("div");
    activeSelection.className = "active-selection";
    activeSelection.hidden = true;
    overlay.append(activeSelection);
    surface.append(canvas, textLayer, textAnnotationsLayer, overlay);
    nodes = { surface, canvas, textLayer, textAnnotationsLayer, overlay, activeSelection };
  }
  const imageLayer = window.document.createElement("div");
  imageLayer.className = "reader-image-layer";
  imageLayer.setAttribute("aria-hidden", "true");
  nodes.surface.insertBefore(imageLayer, nodes.textAnnotationsLayer);
  nodes.imageLayer = imageLayer;
  const linkLayer = window.document.createElement("div");
  linkLayer.className = "reader-link-layer annotationLayer";
  nodes.surface.insertBefore(linkLayer, nodes.overlay);
  nodes.linkLayer = linkLayer;
  const status = window.document.createElement("div");
  status.className = "reader-page-status";
  status.hidden = true;
  nodes.surface.append(status);
  const record = {
    ...nodes,
    pageNumber,
    status,
    page: null,
    baseWidth: 612,
    baseHeight: 792,
    scale: 1,
    rendered: false,
    textReady: false,
    hasText: null,
    renderTask: null,
    textTask: null,
    textTaskPromise: null,
    textLayerSequence: 0,
    sequence: -1,
    queuedSequence: null,
    queuedPromise: null,
    desired: true
  };
  nodes.surface.classList.add("reader-page-wrap");
  nodes.surface.dataset.readerPage = String(pageNumber);
  nodes.canvas.width = 1;
  nodes.canvas.height = 1;
  nodes.textLayer.dataset.page = String(pageNumber);
  nodes.canvas.dataset.page = String(pageNumber);
  setPageEstimate(record);
  readerShapes?.attach(record);
  return record;
}

function setRecordIdentity(record, active) {
  for (const [field, id] of Object.entries(PAGE_ID_FIELDS)) {
    if (active) record[field].id = id;
    else record[field].removeAttribute("id");
  }
  if (active) {
    elements.pageSurface = record.surface;
    elements.canvas = record.canvas;
    elements.textLayer = record.textLayer;
    elements.textAnnotationsLayer = record.textAnnotationsLayer;
    elements.overlay = record.overlay;
    elements.activeSelection = record.activeSelection;
    elements.canvas.dataset.testid = "reader-canvas";
    elements.overlay.dataset.testid = "region-overlay";
  } else {
    record.canvas.removeAttribute("data-testid");
    record.overlay.removeAttribute("data-testid");
  }
  record.surface.dataset.activePage = String(active);
}

function activateReaderPage(record, notify = true) {
  if (!record) return;
  const previous = state.activePageRecord;
  if (previous && previous !== record) {
    setRecordIdentity(previous, false);
    previous.activeSelection.hidden = true;
  }
  state.activePageRecord = record;
  state.page = record.pageNumber;
  state.effectiveScale = record.scale || state.effectiveScale;
  state.fitScale = Math.max(0.1, availableReaderWidth() / (record.baseWidth || 612));
  setRecordIdentity(record, true);
  elements.textStatus.hidden = !record.textReady || record.hasText !== false;
  if (record.textReady && record.hasText === false) elements.textStatus.textContent = t("noTextLayer");
  if (notify) renderDocumentDetails();
}

function removeReaderPage(record) {
  try {
    record.renderTask?.cancel();
    record.textTask?.cancel();
  } catch {
    // Stale page records are detached and sequence checked.
  }
  record.canvas.width = 1;
  record.canvas.height = 1;
  readerShapes?.detach(record);
  record.surface.remove();
}

function ensureReaderPages() {
  if (!state.pdf || !state.document || isStudy()) return;
  if (!state.readerPagesContainer) {
    state.readerPagesContainer = window.document.createElement("div");
    state.readerPagesContainer.className = "reader-pages";
  }
  const container = state.readerPagesContainer;
  if (!container.isConnected) elements.readerStage.append(container);
  if (!state.activePageRecord) {
    const record = createReaderPage(state.page, true);
    state.readerPages.set(record.pageNumber, record);
    container.append(record.surface);
    activateReaderPage(record, false);
  } else if (!container.contains(state.activePageRecord.surface)) {
    container.append(state.activePageRecord.surface);
  }
  elements.readerStage.dataset.viewMode = state.viewMode;
  const count = state.document.page_count;
  if (state.viewMode === "continuous") {
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      let record = state.readerPages.get(pageNumber);
      if (!record) {
        record = createReaderPage(pageNumber);
        state.readerPages.set(pageNumber, record);
      }
      const currentAtPosition = container.children[pageNumber - 1];
      if (currentAtPosition !== record.surface) container.insertBefore(record.surface, currentAtPosition || null);
      record.surface.hidden = false;
    }
  } else {
    let current = state.readerPages.get(state.page);
    if (!current) {
      current = createReaderPage(state.page);
      state.readerPages.set(state.page, current);
    }
    for (const record of [...state.readerPages.values()]) {
      if (record !== current) {
        state.readerPages.delete(record.pageNumber);
        removeReaderPage(record);
      }
    }
    container.append(current.surface);
    current.surface.hidden = false;
    activateReaderPage(current, false);
  }
}

function destroyReaderPages() {
  for (const record of state.readerPages.values()) {
    try {
      record.renderTask?.cancel();
      record.textTask?.cancel();
    } catch {
      // Document teardown also destroys the PDF loading task.
    }
    record.imageLayer.replaceChildren();
    readerShapes?.detach(record);
    if (record !== state.activePageRecord) record.surface.remove();
  }
  if (state.activePageRecord?.surface) elements.readerStage.append(state.activePageRecord.surface);
  state.readerPagesContainer?.remove();
  state.readerPagesContainer = null;
  state.readerPages.clear();
  state.activePageRecord = null;
}

function releaseReaderPage(record) {
  if (state.activePageRecord === record) return;
  readerShapes?.detach(record);
  try {
    record.renderTask?.cancel();
    record.textTask?.cancel();
  } catch {
    // Released records cannot repaint without passing current generation checks.
  }
  record.renderTask = null;
  record.textTask = null;
  record.page = null;
  record.rendered = false;
  record.textReady = false;
  record.sequence = -1;
  record.canvas.width = 1;
  record.canvas.height = 1;
  record.textLayer.replaceChildren();
  record.imageLayer.replaceChildren();
  record.linkAnnotationLayer?.destroy();
  record.linkAnnotationLayer = null;
  record.linkLayer.replaceChildren();
  record.textAnnotationsLayer.replaceChildren();
  record.overlay.querySelectorAll(".source-highlight").forEach((node) => node.remove());
  record.surface.querySelector(".reader-find-layer")?.replaceChildren();
  record.status.hidden = true;
  setPageEstimate(record);
}

function visibleReaderBounds() {
  const bounds = elements.readerStage.getBoundingClientRect();
  if (getComputedStyle(elements.readerStage).visibility !== "visible" || bounds.width <= 0 || bounds.height <= 0) return null;
  return bounds;
}

function captureReaderAnchor() {
  const record = state.activePageRecord;
  if (!record || state.viewMode !== "continuous" || !visibleReaderBounds()) return null;
  const height = Math.max(1, record.surface.offsetHeight);
  return { page: record.pageNumber, ratio: (elements.readerStage.scrollTop - record.surface.offsetTop) / height };
}

function restoreReaderAnchor(anchor) {
  if (!anchor || state.viewMode !== "continuous" || !visibleReaderBounds()) return;
  const record = state.readerPages.get(anchor.page) || state.activePageRecord;
  if (!record) return;
  elements.readerStage.scrollTop = Math.max(0, record.surface.offsetTop + anchor.ratio * Math.max(1, record.surface.offsetHeight));
}

function beginReaderLayout() {
  const sequence = ++state.readerLayoutSequence;
  state.readerLayoutLocked = true;
  elements.readerStage.dataset.readerLayoutLocked = "true";
  if (state.continuousFrame) cancelAnimationFrame(state.continuousFrame);
  state.continuousFrame = null;
  return sequence;
}

function finishReaderLayout(sequence) {
  if (sequence !== state.readerLayoutSequence) return;
  state.readerLayoutLocked = false;
  delete elements.readerStage.dataset.readerLayoutLocked;
  if (state.continuousFrame) cancelAnimationFrame(state.continuousFrame);
  state.continuousFrame = null;
}

function desiredContinuousPages() {
  ensureReaderPages();
  const bounds = elements.readerStage.getBoundingClientRect();
  const center = bounds.top + bounds.height / 2;
  const records = [...state.readerPages.values()].map((record) => {
    const rect = record.surface.getBoundingClientRect();
    return {
      record,
      visible: rect.bottom >= bounds.top && rect.top <= bounds.bottom,
      distance: Math.abs(rect.top + rect.height / 2 - center)
    };
  });
  records.sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance || a.record.pageNumber - b.record.pageNumber);
  const selected = records.filter((item) => item.visible || item.distance <= bounds.height * 1.5).slice(0, 5);
  const include = (record) => {
    if (!record || selected.some((item) => item.record === record)) return;
    if (selected.length >= 5) selected.pop();
    selected.push({ record });
  };
  include(state.activePageRecord);
  include(readerShapes?.getInteractingRecord());
  include(state.selection?.record || state.readerPages.get(state.pointerDragPage));
  return selected.map((item) => item.record);
}

function queueReaderPage(record) {
  const sequence = state.renderSequence;
  if (record.rendered && record.sequence === sequence) return Promise.resolve();
  if (record.queuedSequence === sequence && record.queuedPromise) return record.queuedPromise;
  record.queuedSequence = sequence;
  const promise = state.renderQueue.catch(() => {}).then(() => renderReaderPage(record, sequence));
  record.queuedPromise = promise;
  state.renderQueue = promise;
  return promise.finally(() => {
    if (record.queuedPromise === promise) {
      record.queuedPromise = null;
      record.queuedSequence = null;
    }
  });
}

function renderVisibleContinuous() {
  if (state.viewMode !== "continuous" || !state.pdf || !visibleReaderBounds()) return Promise.resolve();
  const desired = desiredContinuousPages();
  const wanted = new Set(desired);
  for (const record of state.readerPages.values()) {
    record.desired = wanted.has(record);
    if (!record.desired && (record.rendered || record.renderTask || record.textTask || record.textLayer.childNodes.length)) releaseReaderPage(record);
  }
  return Promise.all(desired.map((record) => queueReaderPage(record)));
}

function setReaderPageError(record) {
  record.status.replaceChildren();
  const text = window.document.createElement("span");
  text.textContent = t("pageRenderRetry");
  const retry = window.document.createElement("button");
  retry.type = "button";
  retry.className = "button button-quiet";
  retry.textContent = t("retry");
  retry.addEventListener("click", () => {
    record.rendered = false;
    record.sequence = -1;
    void queueReaderPage(record);
  });
  record.status.append(text, retry);
  record.status.hidden = false;
}

async function renderReaderTextLayer(record, sequence, documentId) {
  const textLayerSequence = ++record.textLayerSequence;
  const previousTask = record.textTask;
  const previousPromise = record.textTaskPromise;
  record.textTask = null;
  record.textTaskPromise = null;
  try {
    previousTask?.cancel();
  } catch {
    // A replaced task is still bounded by its render promise.
  }
  record.textLayer.replaceChildren();
  record.imageLayer.replaceChildren();
  record.textReady = false;
  if (previousPromise) {
    try {
      await previousPromise;
    } catch {
      // Cancellation is the expected completion for a replaced task.
    }
    if (record.textLayerSequence !== textLayerSequence || sequence !== state.renderSequence || state.document?.id !== documentId || state.readerPages.get(record.pageNumber) !== record || state.viewMode === "continuous" && !record.desired) return;
    record.textLayer.replaceChildren();
    record.imageLayer.replaceChildren();
  }
  if (record.page.imageCoordinates?.length) {
    const images = new pdfjsLib.TextLayerImages(0, record.page.imageCoordinates, {
      rawDims: { pageWidth: record.viewport.width, pageHeight: record.viewport.height }
    }, () => record.canvas);
    record.imageLayer.append(images.render());
  }
  const task = new pdfjsLib.TextLayer({
    textContentSource: record.page.streamTextContent(),
    container: record.textLayer,
    viewport: record.viewport
  });
  record.textTask = task;
  record.textLayer.dataset.documentId = documentId;
  record.textLayer.dataset.page = String(record.pageNumber);
  const isCurrent = () => record.textLayerSequence === textLayerSequence && record.textTask === task && sequence === state.renderSequence && state.document?.id === documentId && state.readerPages.get(record.pageNumber) === record && (state.viewMode !== "continuous" || record.desired);
  try {
    const promise = task.render();
    record.textTaskPromise = promise;
    await promise;
    if (!isCurrent()) return;
    record.textTask = null;
    record.textTaskPromise = null;
    record.textReady = true;
    const hasText = task.textContentItemsStr.some((text) => text.trim());
    record.hasText = hasText;
    if (state.activePageRecord === record) {
      elements.textStatus.hidden = hasText;
      if (!hasText) elements.textStatus.textContent = t("noTextLayer");
    }
    readerFind?.pageRendered(record.pageNumber);
  } catch (error) {
    if (!isCurrent()) return;
    record.textTask = null;
    record.textTaskPromise = null;
    record.textLayer.replaceChildren();
    record.imageLayer.replaceChildren();
    if (["AbortException", "AbortError", "RenderingCancelledException"].includes(error?.name) || sequence !== state.renderSequence) return;
    if (state.activePageRecord === record) {
      elements.textStatus.hidden = false;
      elements.textStatus.textContent = t("textLayerUnavailable");
    }
  }
}

async function renderReaderPage(record, sequence) {
  const pdf = state.pdf;
  const documentId = state.document?.id;
  if (!pdf || !documentId || sequence !== state.renderSequence || state.readerPages.get(record.pageNumber) !== record || !elements.readerStage.clientWidth) return;
  if (state.viewMode === "continuous" && !record.desired) return;
  if (record.rendered && record.sequence === sequence) return;
  try {
    record.status.hidden = true;
    record.page = record.page || await pdf.getPage(record.pageNumber);
    if (sequence !== state.renderSequence || state.pdf !== pdf || state.document?.id !== documentId || state.viewMode === "continuous" && !record.desired) return;
    const baseViewport = record.page.getViewport({ scale: 1 });
    record.baseWidth = baseViewport.width;
    record.baseHeight = baseViewport.height;
    const fitScale = Math.max(0.1, availableReaderWidth() / baseViewport.width);
    const scale = state.zoomMode === "fit" ? fitScale : state.zoom;
    record.scale = scale;
    if (state.activePageRecord === record) {
      state.fitScale = fitScale;
      state.effectiveScale = scale;
    }
    const viewport = record.page.getViewport({ scale });
    record.viewport = viewport;
    const cssWidth = Math.max(1, Math.floor(viewport.width));
    const cssHeight = Math.max(1, Math.floor(viewport.height));
    const ratioCap = Math.min(Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)), MAX_CANVAS_AXIS / cssWidth, MAX_CANVAS_AXIS / cssHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO, ratioCap);
    const outputViewport = record.page.getViewport({ scale: scale * pixelRatio });
    record.canvas.width = Math.max(1, Math.floor(cssWidth * pixelRatio));
    record.canvas.height = Math.max(1, Math.floor(cssHeight * pixelRatio));
    record.canvas.style.width = `${cssWidth}px`;
    record.canvas.style.height = `${cssHeight}px`;
    record.surface.style.width = `${cssWidth}px`;
    record.surface.style.height = `${cssHeight}px`;
    record.surface.style.setProperty("--scale-factor", String(scale));
    record.surface.style.setProperty("--total-scale-factor", String(scale * (record.page?.userUnit || 1)));
    record.surface.hidden = false;
    elements.readerEmpty.hidden = true;
    if (state.activePageRecord === record) renderDocumentDetails();
    const context = record.canvas.getContext("2d", { alpha: false });
    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, record.canvas.width, record.canvas.height);
    context.restore();
    record.renderTask = record.page.render({ canvas: record.canvas, canvasContext: context, viewport: outputViewport, background: "#ffffff", recordImages: true });
    if (state.activePageRecord === record) state.renderTask = record.renderTask;
    await record.renderTask.promise;
    record.renderTask = null;
    if (state.activePageRecord === record) state.renderTask = null;
    if (sequence !== state.renderSequence || state.pdf !== pdf || state.document?.id !== documentId || state.viewMode === "continuous" && !record.desired) return;
    record.canvas.dataset.documentId = documentId;
    elements.readerStage.dataset.page = String(state.page);
    elements.readerStage.dataset.documentId = documentId;
    await renderReaderTextLayer(record, sequence, documentId);
    if (sequence !== state.renderSequence || state.readerPages.get(record.pageNumber) !== record || state.viewMode === "continuous" && !record.desired) return;
    await state.pdfLinks?.render(record);
    if (sequence !== state.renderSequence || state.readerPages.get(record.pageNumber) !== record || state.viewMode === "continuous" && !record.desired) return;
    record.rendered = true;
    record.sequence = sequence;
    renderTextAnnotations();
    readerShapes?.attach(record);
    readerShapes?.render();
    const highlight = drawHighlight();
    if (highlight && state.highlightRevealId === highlight.dataset.noteId) {
      state.highlightRevealId = null;
      highlight.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  } catch (error) {
    if (["RenderingCancelledException", "AbortException", "AbortError"].includes(error?.name) || sequence !== state.renderSequence) return;
    record.rendered = false;
    setReaderPageError(record);
    if (state.activePageRecord === record) setStatus("renderFailed", "error", {}, () => requestRender());
  }
}

function handleContinuousScroll() {
  if (state.readerLayoutLocked) {
    if (state.continuousFrame) cancelAnimationFrame(state.continuousFrame);
    state.continuousFrame = null;
    return;
  }
  if (state.continuousFrame) cancelAnimationFrame(state.continuousFrame);
  state.continuousFrame = requestAnimationFrame(() => {
    state.continuousFrame = null;
    if (state.readerLayoutLocked || state.viewMode !== "continuous" || !state.pdf) return;
    const bounds = visibleReaderBounds();
    if (!bounds) return;
    if (!state.pointerDragPage && !state.selection) {
      const center = bounds.top + bounds.height / 2;
      let closest = null;
      let distance = Infinity;
      for (const record of state.readerPages.values()) {
        const rect = record.surface.getBoundingClientRect();
        if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
        const nextDistance = Math.max(rect.top - center, center - rect.bottom, 0);
        if (nextDistance < distance) {
          closest = record;
          distance = nextDistance;
        }
      }
      if (closest && closest !== state.activePageRecord) activateReaderPage(closest);
    }
    void renderVisibleContinuous();
  });
}

async function navigatePdfLink({ pageNumber, destArray }) {
  const pdf = state.pdf;
  const documentId = state.document?.id;
  const loadSequence = state.loadSequence;
  await goToPage(pageNumber);
  if (state.pdf !== pdf || state.document?.id !== documentId || state.loadSequence !== loadSequence) return;
  const record = state.readerPages.get(pageNumber);
  if (!record?.viewport) return;
  if (destArray?.[1]?.name === "XYZ" && Number.isFinite(destArray[2]) && Number.isFinite(destArray[3])) {
    const [x, y] = record.viewport.convertToViewportPoint(destArray[2], destArray[3]);
    const stageBounds = elements.readerStage.getBoundingClientRect();
    const surfaceBounds = record.surface.getBoundingClientRect();
    const surfaceTop = surfaceBounds.top - stageBounds.top + elements.readerStage.scrollTop;
    const surfaceLeft = surfaceBounds.left - stageBounds.left + elements.readerStage.scrollLeft;
    elements.readerStage.scrollTop = Math.max(0, surfaceTop + y - elements.readerStage.clientHeight * 0.25);
    elements.readerStage.scrollLeft = Math.max(0, surfaceLeft + x - elements.readerStage.clientWidth * 0.25);
  }
  state.pdfLinks?.rendered(record);
}

async function goToPage(page, options = {}) {
  if (!state.pdf || !state.document) return;
  readerObjects?.close();
  readerShapes?.cancel();
  if (!options.restoreProgress) cancelReaderProgressRestore();
  const nextPage = Math.max(1, Math.min(state.document.page_count, Math.trunc(Number(page) || 1)));
  const revealNoteId = options.preserveHighlight ? state.highlightRevealId : null;
  state.highlightRevealId = null;
  const layoutSequence = beginReaderLayout();
  try {
    state.page = nextPage;
    if (!options.preserveHighlight) {
      state.highlight = null;
      if (!options.preserveUrl) updateUrl(state.document.id);
    }
    setRegionMode(false);
    ensureReaderPages();
    activateReaderPage(state.readerPages.get(nextPage));
    if (state.viewMode === "continuous") {
      const record = state.readerPages.get(nextPage);
      elements.readerStage.scrollTop = Math.max(0, record.surface.offsetTop - 8);
      await renderVisibleContinuous();
      if (layoutSequence !== state.readerLayoutSequence) return;
      restoreReaderAnchor({ page: nextPage, ratio: 0 });
    } else {
      await requestRender();
    }
    const highlight = drawHighlight();
    if (revealNoteId && state.highlight?.id === revealNoteId && highlight) {
      highlight.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  } finally {
    finishReaderLayout(layoutSequence);
    scheduleReaderProgressCapture();
  }
}

function cancelTextLayer() {
  const selection = window.getSelection();
  if (selection?.anchorNode && elements.readerStage.contains(selection.anchorNode)) selection.removeAllRanges();
  state.capturedTextSelection = null;
  resetTextAnnotationToolbar();
  for (const record of state.readerPages.values()) {
    try {
      record.textTask?.cancel();
    } catch {
      // Stale layers are detached and rejected by the render sequence.
    }
    record.textTask = null;
    record.textLayer.replaceChildren();
    record.imageLayer.replaceChildren();
    record.linkAnnotationLayer?.destroy();
    record.linkAnnotationLayer = null;
    record.linkLayer.replaceChildren();
    record.textAnnotationsLayer.replaceChildren();
    record.shapeLayer?.replaceChildren();
  }
  elements.textStatus.hidden = true;
}

function readPdfTextSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const layerForNode = (node) => {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest(".textLayer") || null;
  };
  const textLayer = layerForNode(selection.anchorNode);
  const focusLayer = layerForNode(selection.focusNode);
  if (textLayer !== focusLayer && (textLayer || focusLayer)) {
    if (elements.readerStage.contains(textLayer || focusLayer)) setStatus("crossPageSelection", "error");
    return null;
  }
  if (!textLayer || !elements.readerStage.contains(textLayer) || !textLayer.contains(selection.anchorNode) || !textLayer.contains(selection.focusNode)) return null;
  const pageNumber = Number(textLayer.dataset.page);
  const record = state.readerPages.get(pageNumber);
  if (!record || textLayer.dataset.documentId !== state.document?.id) return null;
  if (state.activePageRecord !== record) activateReaderPage(record);
  const text = selection.toString().trim();
  if (!text) return null;
  const geometry = pdfSelectionGeometry(selection, textLayer);
  if (!geometry) return null;
  const { rects, clientRects: clippedClientRects } = geometry;
  const union = [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3]))
  ];
  return {
    documentId: state.document.id,
    page: pageNumber,
    sequence: state.loadSequence,
    text,
    rect: union,
    rects,
    clientRect: {
      left: Math.min(...clippedClientRects.map((rect) => rect.left)),
      top: Math.min(...clippedClientRects.map((rect) => rect.top)),
      right: Math.max(...clippedClientRects.map((rect) => rect.right)),
      bottom: Math.max(...clippedClientRects.map((rect) => rect.bottom))
    }
  };
}

function currentPdfTextSelection() {
  const captured = state.capturedTextSelection;
  return captured?.documentId === state.document?.id && captured.sequence === state.loadSequence && state.readerPages.has(captured.page)
    ? captured
    : readPdfTextSelection();
}

function resetTextAnnotationToolbar() {
  elements.textAnnotationToolbar.dataset.contextual = "false";
  elements.textAnnotationToolbar.style.left = "";
  elements.textAnnotationToolbar.style.top = "";
}

function updateTextAnnotationToolbar() {
  if (readerShapes?.isInteracting()) {
    state.capturedTextSelection = null;
    resetTextAnnotationToolbar();
    return;
  }
  const selected = readPdfTextSelection();
  if (selected) closeSelectedAnnotation();
  state.capturedTextSelection = selected;
  if (!selected || state.pendingSaves > 0 || state.pendingMutations.size > 0) {
    resetTextAnnotationToolbar();
    return;
  }
  const toolbar = elements.textAnnotationToolbar;
  toolbar.dataset.contextual = "true";
  toolbar.style.left = "8px";
  toolbar.style.top = "8px";
  const width = toolbar.offsetWidth;
  const height = toolbar.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, selected.clientRect.left));
  const preferredTop = selected.clientRect.top - height - 8;
  const top = preferredTop >= 8 ? preferredTop : Math.max(8, Math.min(window.innerHeight - height - 8, selected.clientRect.bottom + 8));
  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${top}px`;
}

function readerSourceUrl(documentId, page) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("document", documentId);
  url.searchParams.set("page", String(page));
  url.searchParams.set("workspace", "reading");
  return url.href;
}

function readerSourceProvenance(source) {
  return {
    label: source.sourceLabel || (state.language === "zh" ? `来源：第 ${source.page} 页 · 选定区域` : `Source: page ${source.page} · selected region`),
    url: source.sourceUrl || readerSourceUrl(source.documentId, source.page)
  };
}

function shapeKindLabel(kind) {
  const keys = {
    rectangle: "shapeRectangle",
    arrow: "shapeArrow",
    line: "shapeLine",
    ellipse: "shapeEllipse",
    ink: "shapeInk",
    textbox: "shapeTextbox"
  };
  return t(keys[kind] || "shapeRectangle");
}

function shapeMutationPayload(shape) {
  const points = shape.points.map((point) => [point[0], point[1]]);
  if (shape.kind === "textbox") {
    return {
      kind: shape.kind,
      color: shape.color,
      font_size: shape.font_size,
      points
    };
  }
  return {
    kind: shape.kind,
    color: shape.color,
    line_width: shape.line_width,
    points
  };
}

function shapeSourceProvenance(capture) {
  const url = new URL(readerSourceUrl(capture.documentId, capture.page));
  url.searchParams.set("rect", capture.rect.map((value) => String(value)).join(","));
  url.searchParams.set("source_sha256", capture.sourceSha);
  url.searchParams.set("shape_note", capture.shapeNoteId);
  url.searchParams.set("shape_revision", String(capture.shapeRevision));
  url.searchParams.set("shape_kind", capture.shapeKind);
  const kind = shapeKindLabel(capture.shapeKind);
  const sourceLabel = (state.language === "zh"
    ? `来源：第 ${capture.page} 页 · ${kind}批注 · 修订 ${capture.shapeRevision}`
    : `Source: page ${capture.page} · ${kind} annotation · revision ${capture.shapeRevision}`).replace(/\s+/g, " ").trim();
  if (!sourceLabel || sourceLabel.length > 200 || url.href.length > 2048) return null;
  return { sourceUrl: url.href, sourceLabel };
}

function clearPdfTextSelection() {
  state.capturedTextSelection = null;
  window.getSelection()?.removeAllRanges();
  resetTextAnnotationToolbar();
}

function anchorNewDraftAfterInsertion(documentId, source, shouldAnchor) {
  if (!shouldAnchor || state.document?.id !== documentId || state.editDrafts.has(documentId)) return;
  const draft = ensureDraft(documentId);
  if (draft.page !== null) return;
  draft.page = source.page;
  draft.rect = source.rect ? [...source.rect] : null;
  draft.includeExcerpt = false;
}

function addTextSelectionToNote() {
  if (!state.document || !state.pdf || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  const selected = currentPdfTextSelection();
  if (!selected) {
    setStatus("selectTextFirst", "error");
    return;
  }
  if (selected.text.length > 10000) {
    setStatus("textSelectionTooLong", "error");
    return;
  }
  const draft = state.editDrafts.get(state.document.id) || ensureDraft(state.document.id);
  const shouldAnchor = !state.editDrafts.has(state.document.id) && !draft.text.trim() && draft.page === null;
  const insertion = `“${selected.text}”\n`;
  captureCurrentDraft();
  workspace?.showNotes();
  const bookmark = richText?.getBookmark();
  if (shouldAnchor) {
    draft.page = selected.page;
    draft.rect = [...selected.rect];
  }
  if (!richText?.insertText(bookmark, insertion, readerSourceProvenance(selected))) {
    if (shouldAnchor) {
      draft.page = null;
      draft.rect = null;
      renderDraft();
    }
    setStatus("readerActionUnavailable", "error");
    return;
  }
  anchorNewDraftAfterInsertion(state.document.id, selected, shouldAnchor);
  highlightDraft(state.document.id, selected.page, selected.rect);
  clearPdfTextSelection();
  renderDraft();
  setStatus("textDraftReady", "success");
  assistant?.contextChanged();
  richText?.focus();
}

function readerActionFailureStatus(result) {
  return {
    limit: "readerActionLimit",
    imageLimit: "readerActionImageLimit",
    owner: "readerActionOwner",
    pending: "readerActionPending",
    unavailable: "readerActionUnavailable"
  }[result] || "readerActionInvalid";
}

function prepareTextReaderAction(kind) {
  if (!state.document || !state.pdf) {
    setStatus("readerActionInvalid", "error");
    return;
  }
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0) {
    setStatus("readerActionPending", "error");
    return;
  }
  const selected = currentPdfTextSelection();
  if (!selected) {
    setStatus("selectTextFirst", "error");
    return;
  }
  if (!assistant?.prepareReaderAction) {
    setStatus("readerActionUnavailable", "error");
    return;
  }
  const result = assistant.prepareReaderAction(selected.documentId, {
    kind,
    page: selected.page,
    rect: [...selected.rect],
    quote: selected.text
  });
  if (result !== "added") {
    setStatus(readerActionFailureStatus(result), "error");
    return;
  }
  clearPdfTextSelection();
  setStatus("readerActionReady", "success");
}

function renderTextAnnotations() {
  for (const record of state.readerPages.values()) record.textAnnotationsLayer.replaceChildren();
  if (!state.document || !state.pdf) return;
  for (const note of state.noteStates) {
    const annotation = note.annotation;
    const record = state.readerPages.get(note.page);
    if (!record || note.deleted_at || note.purged || note.document_id !== state.document.id || !annotation) continue;
    if (!["highlight", "underline"].includes(annotation.kind) || !["yellow", "green", "blue", "pink"].includes(annotation.color) || !Array.isArray(annotation.rects)) continue;
    for (const rect of annotation.rects.slice(0, 256)) {
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[0] < 0 || rect[1] < 0 || rect[2] > 1 || rect[3] > 1 || rect[2] <= rect[0] || rect[3] <= rect[1]) continue;
      const markup = window.document.createElement("div");
      markup.className = "text-annotation";
      markup.dataset.annotationId = note.id;
      markup.dataset.kind = annotation.kind;
      markup.dataset.color = annotation.color;
      markup.style.left = `${rect[0] * 100}%`;
      markup.style.top = `${rect[1] * 100}%`;
      markup.style.width = `${(rect[2] - rect[0]) * 100}%`;
      markup.style.height = `${(rect[3] - rect[1]) * 100}%`;
      record.textAnnotationsLayer.append(markup);
    }
  }
}

function selectedAnnotation() {
  const note = noteStateFor(state.selectedAnnotationId);
  return note?.annotation && !note.deleted_at && !note.purged && note.document_id === state.document?.id ? note : null;
}

function closeSelectedAnnotation() {
  state.selectedAnnotationId = null;
  elements.selectedAnnotationToolbar.hidden = true;
}

function renderSelectedAnnotationToolbar() {
  const note = selectedAnnotation();
  const record = note ? state.readerPages.get(note.page) : null;
  const stageBounds = elements.readerStage.getBoundingClientRect();
  if (!note || !record?.rendered || !record.surface.isConnected || stageBounds.width <= 0) {
    elements.selectedAnnotationToolbar.hidden = true;
    return;
  }
  const toolbar = elements.selectedAnnotationToolbar;
  const locked = state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(state.document.id);
  toolbar.hidden = false;
  for (const control of toolbar.querySelectorAll("button, select")) control.disabled = locked;
  elements.selectedAnnotationKind.value = note.annotation.kind;
  elements.selectedAnnotationColor.value = note.annotation.color;
  const rect = note.rect || [0, 0, 1, 1];
  const surface = record.surface.getBoundingClientRect();
  const anchor = { left: surface.left + rect[0] * surface.width, right: surface.left + rect[2] * surface.width, top: surface.top + rect[1] * surface.height, bottom: surface.top + rect[3] * surface.height };
  toolbar.style.left = "8px";
  toolbar.style.top = "8px";
  const width = toolbar.offsetWidth;
  const height = toolbar.offsetHeight;
  const left = Math.max(stageBounds.left + 4, Math.min(stageBounds.right - width - 4, anchor.left));
  const above = anchor.top - height - 6;
  const below = anchor.bottom + 6;
  const top = above >= stageBounds.top + 4 ? above : Math.max(stageBounds.top + 4, Math.min(stageBounds.bottom - height - 4, below));
  toolbar.style.left = `${Math.max(4, left)}px`;
  toolbar.style.top = `${Math.max(4, top)}px`;
}

function selectTextAnnotation(note, options = {}) {
  readerShapes?.cancel();
  state.highlight = note;
  state.highlightRevealId = null;
  state.selectedAnnotationId = note.id;
  state.capturedTextSelection = null;
  resetTextAnnotationToolbar();
  drawHighlight();
  renderSelectedAnnotationToolbar();
  if (options.focus) elements.selectedAnnotationCopy.focus({ preventScroll: true });
}

async function copySelectedAnnotation() {
  const note = selectedAnnotation();
  if (!note) return;
  try {
    await navigator.clipboard.writeText(note.annotation.quote);
    setStatus("quoteCopied", "success");
  } catch {
    setStatus("copyFailed", "error");
  }
}

function addSelectedAnnotationToNote() {
  const note = selectedAnnotation();
  if (!note || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  const documentId = note.document_id;
  const draft = state.editDrafts.get(documentId) || ensureDraft(documentId);
  const shouldAnchor = !state.editDrafts.has(documentId) && !draft.text.trim() && draft.page === null;
  const source = { documentId, page: note.page, rect: note.rect };
  captureCurrentDraft();
  workspace?.showNotes();
  const bookmark = richText?.getBookmark();
  if (shouldAnchor) {
    draft.page = note.page;
    draft.rect = note.rect ? [...note.rect] : null;
  }
  if (!richText?.insertText(bookmark, `“${note.annotation.quote}”\n`, readerSourceProvenance(source))) {
    if (shouldAnchor) { draft.page = null; draft.rect = null; }
    renderDraft();
    setStatus("readerActionUnavailable", "error");
    return;
  }
  anchorNewDraftAfterInsertion(documentId, source, shouldAnchor);
  renderDraft();
  setStatus("textDraftReady", "success");
  assistant?.contextChanged();
}

async function showAnnotationFromNote(document, note) {
  const noteState = noteStateFor(note.id);
  if ((!noteState?.annotation && !noteState?.shape_annotation) || noteState.deleted_at) return;
  if (state.page !== note.page || !state.readerPages.get(note.page)?.rendered) await goToPage(note.page, { preserveHighlight: true });
  if (state.document?.id !== document.id) return;
  closeSelectedAnnotation();
  clearPdfTextSelection();
  if (noteState.shape_annotation) readerShapes?.select(noteState.id, { focus: true });
  else selectTextAnnotation(noteStateFor(note.id), { focus: true });
}

function openTextAnnotationAtPoint(event) {
  const target = event.target;
  const surface = target.closest(".page-surface");
  if (readerShapes?.isInteracting() || state.regionActive || target.closest(".region-overlay") || event.detail > 1 || !state.document || !surface) return;
  const documentId = state.document.id;
  const pageNumber = Number(surface.dataset.readerPage);
  const bounds = surface.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  requestAnimationFrame(() => {
    const record = state.readerPages.get(pageNumber);
    if (state.regionActive || !window.getSelection()?.isCollapsed || state.document?.id !== documentId || !target.isConnected || !surface.isConnected || !surface.contains(target) || record?.surface !== surface || !record.rendered) return;
    for (const note of state.noteStates) {
      const annotation = note.annotation;
      if (note.deleted_at || note.purged || note.document_id !== documentId || note.page !== pageNumber || !Array.isArray(annotation?.rects)) continue;
      if (annotation.rects.some((rect) => Array.isArray(rect) && rect.length === 4 && x >= rect[0] && x <= rect[2] && y >= rect[1] - 0.004 && y <= rect[3] + 0.004)) {
        selectTextAnnotation(note);
        return;
      }
    }
  });
}

function annotationSnapshot(note) {
  return {
    text: note.text,
    annotation: note.annotation ? JSON.parse(JSON.stringify(note.annotation)) : null,
    shape_annotation: note.shape_annotation ? JSON.parse(JSON.stringify(note.shape_annotation)) : null,
    deleted_at: note.deleted_at || null
  };
}

async function runShapeCreate(interaction) {
  const operation = interaction.operation;
  if (!operation || operation.pending) return null;
  const documentId = operation.documentId;
  operation.pending = true;
  state.pendingSaves += 1;
  renderDocumentDetails();
  renderNotes();
  setStatus("shapeSaving");
  try {
    const note = await api(`/api/v1/documents/${encodeURIComponent(documentId)}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload)
    });
    const savedState = await api(`/api/v1/documents/${encodeURIComponent(documentId)}/notes/${encodeURIComponent(note.id)}/state`);
    if (savedState.id !== note.id || savedState.document_id !== documentId || !savedState.shape_annotation) throw new ApiError("request_failed");
    if (state.document?.id === documentId) {
      state.noteStates = [savedState, ...state.noteStates.filter((item) => item.id !== savedState.id)];
      state.notes = [savedState, ...state.notes.filter((item) => item.id !== savedState.id)];
      renderNotes();
      renderTextAnnotations();
      readerShapes?.render();
    }
    annotationHistory.record(documentId, {
      kind: "create", noteId: savedState.id, beforeRevision: null, afterRevision: savedState.revision,
      beforeStyle: null, afterStyle: { kind: savedState.shape_annotation.kind, color: savedState.shape_annotation.color },
      beforeDeleted: false, afterDeleted: false,
      beforeSnapshot: null, afterSnapshot: annotationSnapshot(savedState)
    });
    setStatus("shapeSaved", "success");
    readerShapes?.saved(interaction);
    return savedState;
  } catch (error) {
    operation.pending = false;
    setStatus("shapeSaveFailed", "error", {}, () => retryShapeSave(interaction));
    return null;
  } finally {
    state.pendingSaves -= 1;
    renderDocumentDetails();
    renderDraft();
    renderNotes();
  }
}

async function retryShapeSave(interaction) {
  if (!interaction) return null;
  if (state.document?.id !== interaction.documentId) await openDocument(interaction.documentId, { force: true });
  return saveShape(interaction);
}

async function saveShape(interaction) {
  if (!interaction || state.document?.id !== interaction.documentId || state.document.sha256 !== interaction.sourceSha) return null;
  if (!interaction.noteId) {
    if (!interaction.operation) {
      const shape = shapeMutationPayload(interaction.shape);
      interaction.operation = {
        documentId: interaction.documentId,
        pending: false,
        payload: {
          request_id: crypto.randomUUID(),
          page: interaction.record.pageNumber,
          rect: shapeBounds(shape),
          text: interaction.text.trim(),
          shape_annotation: shape
        }
      };
    }
    return runShapeCreate(interaction);
  }
  const note = noteStateFor(interaction.noteId);
  if (!note?.shape_annotation || note.deleted_at || note.purged || note.revision !== interaction.revision) {
    setStatus("shapeStale", "error");
    return null;
  }
  if (!interaction.operation) {
    interaction.operation = makeLifecycleMutation(state.document, note, "shape", {
      text: interaction.text.trim(),
      shape_annotation: shapeMutationPayload(interaction.shape)
    });
  }
  if (!interaction.operation) return null;
  return runMutation(interaction.operation);
}

async function runTextAnnotationSave(operation) {
  if (operation.pending) return;
  const documentId = operation.payload ? operation.documentId : null;
  if (!documentId || (state.annotationSaves.has(documentId) && state.annotationSaves.get(documentId) !== operation)) return;
  operation.pending = true;
  state.annotationSaves.set(documentId, operation);
  state.pendingSaves += 1;
  renderDocumentDetails();
  renderNotes();
  setStatus("annotationSaving");
  try {
    const note = await api(`/api/v1/documents/${encodeURIComponent(documentId)}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload)
    });
    const savedState = await api(`/api/v1/documents/${encodeURIComponent(documentId)}/notes/${encodeURIComponent(note.id)}/state`);
    if (savedState.id !== note.id || savedState.document_id !== documentId || !savedState.annotation) throw new ApiError("request_failed");
    annotationHistory.record(documentId, {
      kind: "create", noteId: savedState.id, beforeRevision: null, afterRevision: savedState.revision,
      beforeStyle: { ...savedState.annotation }, afterStyle: { ...savedState.annotation }, beforeDeleted: false, afterDeleted: false,
      beforeSnapshot: null, afterSnapshot: annotationSnapshot(savedState)
    });
    if (state.document?.id === documentId) {
      state.noteStates = [savedState, ...state.noteStates.filter((item) => item.id !== savedState.id)];
      state.notes = [savedState, ...state.notes.filter((item) => item.id !== savedState.id)];
      renderNotes();
      renderTextAnnotations();
      selectTextAnnotation(savedState);
    }
    if (state.annotationSaves.get(documentId) === operation) state.annotationSaves.delete(documentId);
    if (state.capturedTextSelection?.documentId === documentId && state.capturedTextSelection.sequence === operation.selectionSequence && state.capturedTextSelection.text === operation.payload.annotation.quote) {
      state.capturedTextSelection = null;
      window.getSelection()?.removeAllRanges();
      resetTextAnnotationToolbar();
    }
    setStatus("annotationSaved", "success");
  } catch (error) {
    operation.pending = false;
    setStatus(error.code || "annotationSaveFailed", "error", {}, () => retryTextAnnotationSave(operation));
  } finally {
    state.pendingSaves -= 1;
    renderDocumentDetails();
    renderNotes();
  }
}

async function retryTextAnnotationSave(operation) {
  if (state.document?.id !== operation.documentId) await openDocument(operation.documentId, { force: true });
  await runTextAnnotationSave(operation);
}

function submitTextAnnotation(kind) {
  if (!state.document || !state.pdf || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  const existing = state.annotationSaves.get(state.document.id);
  if (existing) {
    setStatus("annotationRetryRequired", "error", {}, () => retryTextAnnotationSave(existing));
    return;
  }
  const selected = currentPdfTextSelection();
  if (!selected) {
    setStatus("selectTextFirst", "error");
    return;
  }
  if (selected.text.length > 10000) {
    setStatus("textSelectionTooLong", "error");
    return;
  }
  if (!selected.rects.length || selected.rects.length > 256) {
    setStatus("annotationTooManyRects", "error");
    return;
  }
  const color = elements.textAnnotationToolbar.querySelector("[data-annotation-color]:checked")?.value || "yellow";
  const operation = {
    documentId: selected.documentId,
    selectionSequence: selected.sequence,
    pending: false,
    payload: {
      request_id: crypto.randomUUID(),
      page: selected.page,
      rect: [...selected.rect],
      text: selected.text,
      annotation: {
        kind,
        color,
        quote: selected.text,
        rects: selected.rects.map((rect) => [...rect])
      }
    }
  };
  void runTextAnnotationSave(operation);
}

function requestRender(preservedAnchor) {
  if (!state.pdf || !state.document) return Promise.resolve();
  readerObjects?.close();
  readerShapes?.cancel();
  const anchor = preservedAnchor === undefined ? captureReaderAnchor() : preservedAnchor;
  const layoutSequence = beginReaderLayout();
  const sequence = ++state.renderSequence;
  clearHighlights();
  readerFind?.clearHighlights();
  const selection = window.getSelection();
  if (selection?.anchorNode && elements.readerStage.contains(selection.anchorNode)) selection.removeAllRanges();
  for (const record of state.readerPages.values()) {
    try {
      record.renderTask?.cancel();
      record.textTask?.cancel();
    } catch {
      // The serial queue and generation checks reject stale work.
    }
    record.renderTask = null;
    record.textTask = null;
    record.rendered = false;
    record.textReady = false;
    record.sequence = -1;
    record.textLayer.replaceChildren();
    record.imageLayer.replaceChildren();
    record.linkAnnotationLayer?.destroy();
    record.linkAnnotationLayer = null;
    record.linkLayer.replaceChildren();
    record.textAnnotationsLayer.replaceChildren();
    record.shapeLayer?.replaceChildren();
    setPageEstimate(record);
  }
  state.renderTask = null;
  state.capturedTextSelection = null;
  resetTextAnnotationToolbar();
  elements.textStatus.hidden = true;
  ensureReaderPages();
  activateReaderPage(state.readerPages.get(state.page), false);
  if (state.viewMode === "continuous") {
    if (!anchor) restoreReaderAnchor({ page: state.page, ratio: 0 });
    return renderVisibleContinuous()
      .then(() => {
        if (layoutSequence === state.readerLayoutSequence) restoreReaderAnchor(anchor);
      })
      .finally(() => {
        finishReaderLayout(layoutSequence);
        scheduleReaderProgressCapture();
      });
  }
  return queueReaderPage(state.activePageRecord).finally(() => {
    finishReaderLayout(layoutSequence);
    scheduleReaderProgressCapture();
  });
}

function clearHighlights() {
  elements.readerStage.querySelectorAll(".source-highlight").forEach((node) => node.remove());
}

function drawHighlight() {
  clearHighlights();
  const note = state.highlight;
  const record = note ? state.readerPages.get(note.page) : null;
  if (!note || !record || !state.document || note.document_id !== state.document.id) return null;
  const highlight = window.document.createElement("div");
  highlight.className = "source-highlight";
  highlight.dataset.noteId = note.id;
  const rect = note.rect || [0, 0, 1, 1];
  highlight.dataset.wholePage = String(!note.rect);
  highlight.style.left = `${rect[0] * 100}%`;
  highlight.style.top = `${rect[1] * 100}%`;
  highlight.style.width = `${(rect[2] - rect[0]) * 100}%`;
  highlight.style.height = `${(rect[3] - rect[1]) * 100}%`;
  const annotation = noteStateFor(note.id)?.annotation || note.annotation;
  if (note.rect && Array.isArray(annotation?.rects)) {
    highlight.dataset.textAnnotation = "true";
    for (const lineRect of annotation.rects.slice(0, 256)) {
      if (!Array.isArray(lineRect) || lineRect.length !== 4 || !lineRect.every(Number.isFinite) || lineRect[2] <= lineRect[0] || lineRect[3] <= lineRect[1]) continue;
      const line = window.document.createElement("div");
      line.className = "source-highlight-line";
      line.style.left = `${((lineRect[0] - rect[0]) / (rect[2] - rect[0])) * 100}%`;
      line.style.top = `${((lineRect[1] - rect[1]) / (rect[3] - rect[1])) * 100}%`;
      line.style.width = `${((lineRect[2] - lineRect[0]) / (rect[2] - rect[0])) * 100}%`;
      line.style.height = `${((lineRect[3] - lineRect[1]) / (rect[3] - rect[1])) * 100}%`;
      highlight.append(line);
    }
  }
  record.overlay.append(highlight);
  return highlight;
}

async function openNote(noteId, options = {}) {
  invalidateWorkspaceModeIntent();
  cancelReaderProgressRestore();
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
  if (active) readerShapes?.cancel();
  state.regionActive = Boolean(active && state.pdf && state.document);
  readerShapes?.updateControls();
  elements.regionMode.setAttribute("aria-pressed", String(state.regionActive));
  elements.regionMode.textContent = t(state.regionActive ? "cancelRegion" : "regionMode");
  elements.readerRegionMode.setAttribute("aria-pressed", String(state.regionActive));
  elements.readerRegionMode.textContent = t(state.regionActive ? "cancelRegion" : "regionMode");
  elements.readerStage.querySelectorAll(".region-overlay").forEach((overlay) => {
    overlay.dataset.active = String(state.regionActive);
  });
  elements.anchorHelp.textContent = state.regionActive ? t("regionInstructions") : t("anchorHelp");
  if (!state.regionActive) cancelSelection();
}

function eventPoint(event, overlay = state.selection?.overlay || elements.overlay) {
  const bounds = overlay.getBoundingClientRect();
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
  selection.activeSelection.hidden = false;
  selection.activeSelection.style.left = `${left}px`;
  selection.activeSelection.style.top = `${top}px`;
  selection.activeSelection.style.width = `${width}px`;
  selection.activeSelection.style.height = `${height}px`;
}

function cancelSelection() {
  const selection = state.selection;
  state.selection = null;
  if (selection) selection.activeSelection.hidden = true;
  else elements.activeSelection.hidden = true;
}

function makeRegionPreview(rect, record) {
  const preview = window.document.createElement("canvas");
  const canvas = record.canvas;
  const left = Math.max(0, Math.floor(rect[0] * canvas.width));
  const top = Math.max(0, Math.floor(rect[1] * canvas.height));
  const right = Math.min(canvas.width, Math.ceil(rect[2] * canvas.width));
  const bottom = Math.min(canvas.height, Math.ceil(rect[3] * canvas.height));
  preview.width = Math.max(1, right - left);
  preview.height = Math.max(1, bottom - top);
  preview.setAttribute("role", "img");
  preview.setAttribute("aria-label", t("excerptImageAlt", { page: record.pageNumber }));
  const context = preview.getContext("2d");
  context.drawImage(canvas, left, top, preview.width, preview.height, 0, 0, preview.width, preview.height);
  return preview;
}

function readerRecordIsCurrent(record, documentId, sourceSha, renderSequence) {
  return Boolean(
    record &&
    state.document &&
    state.document.id === documentId &&
    typeof sourceSha === "string" &&
    sourceSha &&
    state.document.sha256 === sourceSha &&
    state.renderSequence === renderSequence &&
    state.readerPages.get(record.pageNumber) === record &&
    record.rendered &&
    record.sequence === renderSequence &&
    record.canvas.dataset.documentId === documentId
  );
}

function captureIsCurrent(capture) {
  return Boolean(
    state.regionCapture === capture &&
    state.document?.id === capture.documentId &&
    state.document.sha256 === capture.sourceSha &&
    capture.previewCanvas?.width > 0 &&
    capture.previewCanvas.height > 0
  );
}

async function copyReaderObject(record, object) {
  const owner = state.document;
  const renderSequence = state.renderSequence;
  if (!readerRecordIsCurrent(record, owner?.id, owner?.sha256, renderSequence)) {
    setStatus("objectStale", "error");
    return;
  }
  try {
    const preview = makeRegionPreview(object.rect, record);
    const blob = await new Promise((resolve) => preview.toBlob(resolve, "image/png"));
    if (!readerRecordIsCurrent(record, owner.id, owner.sha256, renderSequence)) {
      setStatus("objectStale", "error");
      return;
    }
    if (!blob || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("clipboard unavailable");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setStatus("objectCopied", "success");
  } catch {
    setStatus("objectCopyFailed", "error");
  }
}

async function handleReaderObjectAction(record, object, action) {
  if (action === "copy") {
    await copyReaderObject(record, object);
    return;
  }
  const owner = state.document;
  const renderSequence = state.renderSequence;
  if (!readerRecordIsCurrent(record, owner?.id, owner?.sha256, renderSequence)) {
    setStatus("objectStale", "error");
    return;
  }
  if (state.regionCapture || state.pendingSaves > 0 || state.pendingMutations.size > 0) {
    setStatus("objectCapturePending", "error");
    return;
  }
  state.regionCapture = {
    documentId: owner.id,
    sourceSha: owner.sha256,
    page: record.pageNumber,
    rect: [...object.rect],
    previewCanvas: makeRegionPreview(object.rect, record),
    requestId: crypto.randomUUID(),
    image: null,
    pending: false,
    error: null,
    record,
    renderSequence
  };
  clearStatus();
  renderDraft();
  if (action === "note") await addCaptureToNote();
  else if (action === "agent") await addCaptureToAgent();
}

async function captureShape(interaction, target) {
  const owner = state.document;
  const record = interaction.record;
  const note = noteStateFor(interaction.noteId);
  const renderSequence = state.renderSequence;
  if (!note?.shape_annotation || note.deleted_at || note.purged || note.revision !== interaction.revision || !readerRecordIsCurrent(record, owner?.id, owner?.sha256, renderSequence)) {
    setStatus("shapeStale", "error");
    return;
  }
  if (state.regionCapture || state.pendingSaves > 0 || state.pendingMutations.size > 0) {
    setStatus("objectCapturePending", "error");
    return;
  }
  const composed = readerShapes?.composeCapture(record, note.shape_annotation, note.text);
  if (["shapeTextboxEmpty", "shapeTextboxTooLong", "shapeTextboxOverflow"].includes(composed?.error)) {
    setStatus(composed.error, "error");
    return;
  }
  const rect = composed?.rect;
  if (!composed?.canvas || !Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[0] < 0 || rect[1] < 0 || rect[2] > 1 || rect[3] > 1 || rect[2] <= rect[0] || rect[3] <= rect[1]) {
    setStatus("shapeStale", "error");
    return;
  }
  const capture = {
    shape: true,
    shapeNoteId: note.id,
    shapeRevision: note.revision,
    shapeKind: note.shape_annotation.kind,
    description: note.text,
    documentId: owner.id,
    sourceSha: owner.sha256,
    page: record.pageNumber,
    rect: [...rect],
    previewCanvas: composed.canvas,
    requestId: crypto.randomUUID(),
    image: null,
    pending: false,
    error: null,
    record,
    renderSequence
  };
  const provenance = shapeSourceProvenance(capture);
  if (!provenance) {
    setStatus("shapeStale", "error");
    return;
  }
  Object.assign(capture, provenance);
  state.regionCapture = capture;
  clearStatus();
  renderDraft();
  if (target === "note") await addCaptureToNote();
  else if (target === "agent") await addCaptureToAgent();
}

async function shareShapeFromNote(document, note, target) {
  if (!note?.shape_annotation || note.deleted_at || note.purged) return;
  if (state.document?.id !== document.id) await openDocument(document.id, { force: true });
  if (state.document?.id !== document.id) return;
  if (state.page !== note.page || !state.readerPages.get(note.page)?.rendered) await goToPage(note.page, { preserveHighlight: true });
  if (readerShapes?.select(note.id)) await readerShapes.share(target);
}

function cancelRegionCapture() {
  const capture = state.regionCapture;
  if (!capture || capture.pending || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  state.regionCapture = null;
  if (state.highlight?.id === `reader-capture-${capture.documentId}`) {
    state.highlight = null;
    state.highlightRevealId = null;
    clearHighlights();
  }
  clearStatus();
  renderDraft();
  assistant?.contextChanged();
}

async function ensureCaptureImage(capture) {
  if (capture.image) return capture.image;
  if (capture.pending || !captureIsCurrent(capture)) return null;
  capture.pending = true;
  capture.error = null;
  renderDraft();
  try {
    const image = await imageLibrary.uploadCanvas(capture.documentId, capture.previewCanvas, {
      requestId: capture.requestId,
      filename: capture.shape ? `page-${capture.page}-shape-${capture.shapeNoteId}.png` : `page-${capture.page}-region.png`
    });
    if (!captureIsCurrent(capture)) return null;
    capture.image = image;
    return image;
  } catch (error) {
    if (captureIsCurrent(capture)) capture.error = error.code || "request_failed";
    return null;
  } finally {
    capture.pending = false;
    if (state.regionCapture === capture && state.document?.id === capture.documentId) renderDraft();
  }
}

async function addCaptureToNote() {
  const capture = state.regionCapture;
  if (!capture || capture.pending || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  if (!captureIsCurrent(capture)) {
    setStatus("objectStale", "error");
    return;
  }
  const draft = state.editDrafts.get(capture.documentId) || ensureDraft(capture.documentId);
  const shouldAnchor = !state.editDrafts.has(capture.documentId) && !draft.text.trim() && draft.page === null;
  const bookmark = richText?.getBookmark();
  const image = await ensureCaptureImage(capture);
  if (!image || !captureIsCurrent(capture)) return;
  if (shouldAnchor) {
    draft.page = capture.page;
    draft.rect = [...capture.rect];
  }
  const inserted = richText?.insertImage(bookmark, {
    document_id: image.document_id,
    image_id: image.id,
    sha256: image.sha256,
    alt: t(capture.shape ? "shapeCaptureAlt" : "regionCaption", { page: capture.page })
  }, readerSourceProvenance(capture), capture.shape ? capture.description : "");
  if (!inserted) {
    if (shouldAnchor) {
      draft.page = null;
      draft.rect = null;
      renderDraft();
    }
    setStatus("captureInsertFailed", "error");
    return;
  }
  anchorNewDraftAfterInsertion(capture.documentId, capture, shouldAnchor);
  state.regionCapture = null;
  highlightDraft(capture.documentId, capture.page, capture.rect);
  workspace?.showNotes();
  renderDraft();
  setStatus("captureNoteReady", "success");
  assistant?.contextChanged();
  richText?.focus();
}

async function addCaptureToAgent() {
  const capture = state.regionCapture;
  if (!capture || capture.pending || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
  if (!captureIsCurrent(capture)) {
    setStatus("objectStale", "error");
    return;
  }
  const image = await ensureCaptureImage(capture);
  if (!image || !captureIsCurrent(capture)) return;
  const result = assistant?.prepareReaderAction(capture.documentId, {
    kind: "image",
    page: capture.page,
    rect: [...capture.rect],
    quote: "",
    image,
    description: capture.shape ? capture.description : undefined,
    sourceUrl: capture.shape ? capture.sourceUrl : undefined,
    sourceLabel: capture.shape ? capture.sourceLabel : undefined
  });
  if (result !== "added") {
    setStatus(readerActionFailureStatus(result || "unavailable"), "error");
    return;
  }
  state.regionCapture = null;
  renderDraft();
  setStatus("readerActionReady", "success");
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
  selection.activeSelection.hidden = true;
  if (width < 4 || height < 4 || !point.width || !point.height) {
    setStatus("selectionTooSmall", "error");
    return;
  }
  const owner = state.document;
  const documentId = owner?.id;
  const page = selection.record.pageNumber;
  const renderSequence = state.renderSequence;
  if (!readerRecordIsCurrent(selection.record, documentId, owner?.sha256, renderSequence)) {
    setRegionMode(false);
    setStatus("objectStale", "error");
    renderDraft();
    return;
  }
  if (state.regionCapture) {
    setRegionMode(false);
    setStatus("objectCapturePending", "error");
    renderDraft();
    return;
  }
  const rect = [left / point.width, top / point.height, (left + width) / point.width, (top + height) / point.height];
  state.regionCapture = {
    documentId,
    sourceSha: owner.sha256,
    page,
    rect,
    previewCanvas: makeRegionPreview(rect, selection.record),
    requestId: crypto.randomUUID(),
    image: null,
    pending: false,
    error: null,
    record: selection.record,
    renderSequence
  };
  setRegionMode(false);
  highlightDraft(documentId, page, rect);
  state.highlight.id = `reader-capture-${documentId}`;
  workspace?.showNotes();
  clearStatus();
  renderDraft();
  assistant?.contextChanged();
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
      richText?.close({ restoreFocus: false });
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
  workspace?.showNotes();
  richText?.close({ restoreFocus: false });
  captureCurrentDraft();
  readerShapes?.cancel();
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
    style: ["annotationStyleSaving", "annotationStyleSaved"],
    shape: ["shapeSaving", "shapeSaved"],
    delete: ["deleting", "deleted"],
    restore: ["restoring", "restored"],
    purge: ["purging", "purged"]
  }[action];
  const operation = {
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
  const style = noteState.shape_annotation || noteState.annotation;
  if (["style", "shape", "delete", "restore"].includes(action) && style) {
    operation.historyEntry = {
      kind: action, noteId: note.id, beforeRevision: noteState.revision, afterRevision: null,
      beforeStyle: { kind: style.kind, color: style.color },
      afterStyle: action === "style" ? { ...change.annotation_style } : action === "shape" ? { kind: change.shape_annotation.kind, color: change.shape_annotation.color } : { kind: style.kind, color: style.color },
      beforeDeleted: Boolean(noteState.deleted_at), afterDeleted: action === "delete" ? true : action === "restore" ? false : Boolean(noteState.deleted_at),
      beforeSnapshot: annotationSnapshot(noteState), afterSnapshot: null
    };
  }
  return operation;
}

async function changeAnnotationStyle(document, note, change) {
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(document.id)) return;
  const key = mutationKey(document.id, note.id);
  const failed = state.failedMutations.get(key);
  if (failed?.action === "style") {
    if (!failed.conflicted) await runMutation(failed);
    else setStatus("revisionConflict", "error", {}, () => refreshLatest(document), "viewLatest");
    return;
  }
  const noteState = noteStateFor(note.id);
  if (!noteState?.annotation) return;
  const annotationStyle = {
    kind: change.kind || noteState.annotation.kind,
    color: change.color || noteState.annotation.color
  };
  if (annotationStyle.kind === noteState.annotation.kind && annotationStyle.color === noteState.annotation.color) return;
  const operation = makeLifecycleMutation(document, note, "style", { annotation_style: annotationStyle });
  if (operation) await runMutation(operation);
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
  if (state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(document.id)) return null;
  const key = mutationKey(document.id, note.id);
  const failed = state.failedMutations.get(key);
  if (failed?.action === "delete" && !failed.conflicted) return runMutation(failed);
  if (failed?.conflicted) state.failedMutations.delete(key);
  if (!window.confirm(t("deleteConfirm"))) return null;
  const operation = makeLifecycleMutation(document, note, "delete");
  return operation ? runMutation(operation) : null;
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
  annotationHistory.invalidate(document.id, noteId);
  if (state.selectedAnnotationId === noteId) closeSelectedAnnotation();
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
  readerShapes?.noteChanged({ id: noteId, purged: true });
  renderTextAnnotations();
  readerShapes?.render();
}

function applyMutationState(operation, savedState) {
  const { document, noteId, action } = operation;
  if (state.document?.id !== document.id) return;
  state.noteStates = [savedState, ...state.noteStates.filter((item) => item.id !== noteId)];
  if (savedState.deleted_at) {
    if (state.selectedAnnotationId === noteId) closeSelectedAnnotation();
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
  readerShapes?.noteChanged(savedState);
  renderNotes();
  renderTextAnnotations();
  readerShapes?.render();
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
  if (state.pendingMutations.has(key)) return null;
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
    if (operation.historyReplay) {
      annotationHistory.complete(document.id, operation.historyReplay.direction, savedState.revision, operation.historyReplay.entry);
    } else if (operation.historyEntry) {
      operation.historyEntry.afterRevision = savedState.revision;
      operation.historyEntry.afterSnapshot = annotationSnapshot(savedState);
      annotationHistory.record(document.id, operation.historyEntry);
    } else if (["edit", "review", "purge"].includes(action)) {
      annotationHistory.invalidate(document.id, noteId);
    }
    if (action === "edit") {
      const currentDraft = state.editDrafts.get(document.id);
      if (currentDraft?.requestId === operation.payload.request_id) state.editDrafts.delete(document.id);
    }
    renderDocumentDetails();
    renderDraft();
    renderNotes();
    setStatus(operation.successStatus, "success");
    return savedState;
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
      annotationHistory.invalidate(document.id, noteId);
      setStatus("revisionConflict", "error", {}, () => refreshLatest(document), "viewLatest");
    } else {
      const key = action === "purge" && error.code === "storage_unavailable" ? "purgeStorageUnavailable" : error.code || "request_failed";
      setStatus(key, "error", {}, () => retryMutation(operation));
    }
    return null;
  } finally {
    state.pendingMutations.delete(key);
    renderDocumentDetails();
    renderDraft();
    renderNotes();
  }
}

async function replayAnnotationHistory(direction) {
  if (!state.document || readerShapes?.hasUnsavedChanges?.() || state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(state.document.id)) return;
  const document = state.document;
  const entry = annotationHistory.peek(document.id, direction);
  if (!entry) return;
  readerShapes?.cancel();
  const failed = state.failedMutations.get(mutationKey(document.id, entry.noteId));
  if (failed) {
    if (!failed.conflicted && failed.historyReplay?.direction === direction && failed.historyReplay.entry === entry) await runMutation(failed);
    return;
  }
  const note = noteStateFor(entry.noteId);
  const expected = annotationHistory.expectedRevision(entry, direction);
  if (!note || note.revision !== expected || (!note.annotation && !note.shape_annotation)) {
    annotationHistory.invalidate(document.id, entry.noteId);
    renderDocumentDetails();
    setStatus("annotationHistoryStale", "error");
    return;
  }
  let action;
  let change = {};
  if (entry.kind === "style") {
    action = "style";
    change.annotation_style = { ...(direction === "undo" ? entry.beforeStyle : entry.afterStyle) };
  } else if (entry.kind === "shape") {
    const snapshot = direction === "undo" ? entry.beforeSnapshot : entry.afterSnapshot;
    if (!snapshot?.shape_annotation) {
      annotationHistory.invalidate(document.id, entry.noteId);
      setStatus("annotationHistoryStale", "error");
      return;
    }
    action = "shape";
    change.text = snapshot.text;
    change.shape_annotation = shapeMutationPayload(snapshot.shape_annotation);
  } else {
    const deleted = direction === "undo" ? entry.beforeDeleted : entry.afterDeleted;
    if (entry.kind === "create") action = direction === "undo" ? "delete" : "restore";
    else action = deleted ? "delete" : "restore";
  }
  const operation = makeLifecycleMutation(document, note, action, change);
  if (!operation) return;
  delete operation.historyEntry;
  operation.historyReplay = { direction, entry };
  await runMutation(operation);
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
  if (noteStateFor(note.id)?.shape_annotation) {
    setStatus("shape_annotation_excerpt_unsupported", "error");
    return;
  }
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
  if (!document || isStudy(document) || state.pendingExports.size > 0 || state.pendingSaves > 0 || state.pendingExcerpts.size > 0 || state.pendingMutations.size > 0 || state.pendingMetadata.size > 0 || state.editDrafts.has(document.id) || ensureMetadata(document.id).draft) return;
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

function makeAnnotatedPdfExportRequest(document) {
  return {
    documentId: document.id,
    title: document.title || document.original_filename || t("annotatedPdf"),
    sha256: document.sha256,
    loadSequence: state.loadSequence
  };
}

function annotatedPdfExportRequestIsCurrent(request) {
  return Boolean(state.document && !isStudy(state.document) && state.document.id === request.documentId && state.document.sha256 === request.sha256 && state.loadSequence === request.loadSequence);
}

async function exportAnnotatedPdf(request) {
  if (!annotatedPdfExportRequestIsCurrent(request) || !hasActiveSavedPdfNotes(state.document) || state.pendingExports.size > 0 || state.pendingSaves > 0 || state.pendingExcerpts.size > 0 || state.pendingMutations.size > 0 || state.pendingMetadata.size > 0 || state.editDrafts.has(request.documentId) || ensureMetadata(request.documentId).draft) return;
  const pendingKey = `annotated-pdf:${request.documentId}`;
  state.pendingExports.add(pendingKey);
  renderDocumentDetails();
  setStatus("exportingAnnotatedPdf");
  try {
    const response = await checkedFetch(`/api/v1/documents/${encodeURIComponent(request.documentId)}/export/annotated.pdf`);
    const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/pdf") throw new ApiError("pdf_export_failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    const base = request.title
      .replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, "_")
      .trim()
      .slice(0, 80);
    try {
      link.href = url;
      link.download = `${base || t("annotatedPdf")}-annotated.pdf`;
      link.hidden = true;
      window.document.body.append(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (annotatedPdfExportRequestIsCurrent(request)) setStatus("exportedAnnotatedPdf", "success");
  } catch (error) {
    if (annotatedPdfExportRequestIsCurrent(request)) {
      setStatus(error.code || "request_failed", "error", {}, () => exportAnnotatedPdf(request));
    }
  } finally {
    state.pendingExports.delete(pendingKey);
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

elements.metadataLookup.addEventListener("click", () => {
  if (state.document) void lookupMetadata(state.document.id);
});
elements.metadataDoiCandidates.addEventListener("change", () => {
  if (!elements.metadataDoiCandidates.value) return;
  elements.metadataDoi.value = elements.metadataDoiCandidates.value;
  elements.metadataDoi.dispatchEvent(new Event("input", { bubbles: true }));
  elements.metadataDoi.focus();
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
  else if (entry.status?.retry === "lookup") void lookupMetadata(state.document.id);
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
    if (!entry.lookup) entry.status = null;
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
elements.pageFirst.addEventListener("click", () => goToPage(1));
elements.pagePrev.addEventListener("click", () => goToPage(state.page - 1));
elements.pageNext.addEventListener("click", () => goToPage(state.page + 1));
elements.pageLast.addEventListener("click", () => goToPage(state.document?.page_count || 1));
elements.annotationUndo.addEventListener("click", () => replayAnnotationHistory("undo"));
elements.annotationRedo.addEventListener("click", () => replayAnnotationHistory("redo"));
elements.selectedAnnotationCopy.addEventListener("click", copySelectedAnnotation);
elements.selectedAnnotationNote.addEventListener("click", addSelectedAnnotationToNote);
elements.selectedAnnotationAgent.addEventListener("click", () => {
  const note = selectedAnnotation();
  if (note) assistant?.addNoteReference(note.document_id, note);
});
elements.selectedAnnotationEdit.addEventListener("click", () => {
  const note = selectedAnnotation();
  if (note) startEditNote(state.document, note);
});
elements.selectedAnnotationKind.addEventListener("change", () => {
  const note = selectedAnnotation();
  if (note) changeAnnotationStyle(state.document, note, { kind: elements.selectedAnnotationKind.value });
});
elements.selectedAnnotationColor.addEventListener("change", () => {
  const note = selectedAnnotation();
  if (note) changeAnnotationStyle(state.document, note, { color: elements.selectedAnnotationColor.value });
});
elements.selectedAnnotationDelete.addEventListener("click", () => {
  const note = selectedAnnotation();
  if (note) deleteNote(state.document, note);
});
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
elements.zoomFitPage.addEventListener("click", async () => {
  const pdf = state.pdf;
  const record = state.activePageRecord;
  const documentId = state.document?.id;
  const loadSequence = state.loadSequence;
  const pageNumber = state.page;
  if (!pdf || !record) return;
  try {
    const page = record.page || await pdf.getPage(pageNumber);
    if (state.pdf !== pdf || state.activePageRecord !== record || state.document?.id !== documentId || state.loadSequence !== loadSequence || state.page !== pageNumber) return;
    const base = page.getViewport({ scale: 1 });
    const style = getComputedStyle(elements.readerStage);
    const width = elements.readerStage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = elements.readerStage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(width / base.width, height / base.height)));
    state.zoomMode = "manual";
    await requestRender();
  } catch (error) {
    if (state.pdf === pdf && state.document?.id === documentId && state.loadSequence === loadSequence) setStatus(error.code || "renderFailed", "error", {}, () => requestRender());
  }
});
let fullscreenAnchor = null;
elements.readerFullscreen.addEventListener("click", async () => {
  const panel = document.querySelector(".reader-panel");
  fullscreenAnchor = captureReaderAnchor();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (panel.requestFullscreen) await panel.requestFullscreen();
    else throw new Error("unsupported");
  } catch {
    fullscreenAnchor = null;
    setStatus("fullscreenFailed", "error");
  }
});
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  elements.readerFullscreen.textContent = t(active ? "exitFullscreen" : "readerFullscreen");
  elements.readerFullscreen.setAttribute("aria-label", t(active ? "exitFullscreen" : "readerFullscreen"));
  const anchor = fullscreenAnchor;
  fullscreenAnchor = null;
  if (state.pdf) void requestRender(anchor);
});
elements.viewMode.addEventListener("change", () => {
  if (!state.pdf) return;
  flushReaderProgress();
  state.viewMode = elements.viewMode.value === "single" ? "single" : "continuous";
  try {
    localStorage.setItem("research-workbench-reader-view-mode", state.viewMode);
  } catch {
    // The selected mode still applies for this session.
  }
  void requestRender();
});
elements.exportReadingRecord.addEventListener("click", () => {
  if (state.document) exportReadingRecord(state.document);
});
elements.exportAnnotatedPdf.addEventListener("click", () => {
  if (state.document && hasActiveSavedPdfNotes(state.document)) void exportAnnotatedPdf(makeAnnotatedPdfExportRequest(state.document));
});
elements.readerRegionMode.addEventListener("click", () => setRegionMode(!state.regionActive));
elements.textSelectionNote.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || elements.textSelectionNote.disabled) return;
  event.preventDefault();
  state.capturedTextSelection = readPdfTextSelection();
});
elements.textSelectionNote.addEventListener("click", addTextSelectionToNote);
elements.textSelectionAsk.addEventListener("click", () => prepareTextReaderAction("ask"));
elements.textSelectionTranslate.addEventListener("click", () => prepareTextReaderAction("translate"));
elements.textAnnotationToolbar.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.target.closest("button, input, label")) return;
  event.preventDefault();
  state.capturedTextSelection = readPdfTextSelection() || currentPdfTextSelection();
});
elements.textAnnotationHighlight.addEventListener("click", () => submitTextAnnotation("highlight"));
elements.textAnnotationUnderline.addEventListener("click", () => submitTextAnnotation("underline"));
document.addEventListener("selectionchange", updateTextAnnotationToolbar);
elements.readerStage.addEventListener("scroll", () => {
  if (elements.textAnnotationToolbar.dataset.contextual === "true") updateTextAnnotationToolbar();
  readerNavigation?.update();
  renderSelectedAnnotationToolbar();
  readerShapes?.positionEditor();
  handleContinuousScroll();
  scheduleReaderProgressCapture();
});
elements.regionAddNote.addEventListener("click", addCaptureToNote);
elements.regionAddAgent.addEventListener("click", addCaptureToAgent);
elements.regionDraftCancel.addEventListener("click", cancelRegionCapture);
elements.pageNote.addEventListener("click", () => {
  if (!state.document || !state.pdf || state.editDrafts.has(state.document.id) || state.pendingSaves > 0 || state.pendingMutations.size > 0) return;
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
  richText?.focus();
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
  if (draft.page === null && draft.text.trim()) {
    draft.page = state.page;
    draft.rect = null;
  }
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
elements.notesFilterQuery.addEventListener("input", () => {
  if (!state.document || isStudy()) return;
  const tools = ensureNoteTools(state.document.id);
  tools.query = elements.notesFilterQuery.value.slice(0, 200);
  tools.message = null;
  renderNotes();
});
for (const [select, field] of [[elements.notesFilterColor, "color"], [elements.notesFilterKind, "kind"]]) {
  select.addEventListener("change", () => {
    if (!state.document || isStudy()) return;
    const tools = ensureNoteTools(state.document.id);
    tools[field] = select.value;
    tools.message = null;
    renderNotes();
  });
}
elements.notesFilterClear.addEventListener("click", () => {
  if (!state.document || isStudy()) return;
  const tools = ensureNoteTools(state.document.id);
  tools.query = "";
  tools.color = "all";
  tools.kind = "all";
  tools.message = null;
  renderNotes();
  elements.notesFilterQuery.focus();
});
elements.notesSelectVisible.addEventListener("click", () => {
  if (!state.document || isStudy()) return;
  const tools = ensureNoteTools(state.document.id);
  for (const note of filteredPaperNotes(state.document)) tools.selected.add(note.id);
  tools.message = null;
  renderNotes();
});
elements.notesSelectionClear.addEventListener("click", () => {
  if (!state.document || isStudy()) return;
  const tools = ensureNoteTools(state.document.id);
  tools.selected.clear();
  tools.message = null;
  renderNotes();
});
elements.notesBatchAgent.addEventListener("click", () => {
  if (!state.document || isStudy()) return;
  const document = state.document;
  const tools = ensureNoteTools(document.id);
  const selected = [...tools.selected].map((noteId) => noteStateFor(noteId));
  const result = assistant?.addNoteReferences(document.id, selected) || "invalid";
  tools.message = result === "added"
    ? { key: "notesBatchAdded", kind: "success", values: { count: selected.length } }
    : { key: result === "limit" ? "notesBatchLimit" : "notesBatchInvalid", kind: "error" };
  renderNotes();
});

elements.readerStage.addEventListener("pointerdown", (event) => {
  const surface = event.target.closest(".page-surface");
  if (!surface || event.button !== 0 || !state.document) return;
  state.pointerDragPage = Number(surface.dataset.readerPage);
  const overlay = event.target.closest(".region-overlay");
  if (!state.regionActive || !overlay) return;
  const record = state.readerPages.get(state.pointerDragPage);
  if (!record) return;
  event.preventDefault();
  const point = eventPoint(event, overlay);
  state.selection = {
    pointerId: event.pointerId,
    record,
    overlay,
    activeSelection: record.activeSelection,
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y
  };
  overlay.setPointerCapture(event.pointerId);
  paintSelection(state.selection);
});
elements.readerStage.addEventListener("pointermove", (event) => {
  const selection = state.selection;
  if (!selection || selection.pointerId !== event.pointerId) return;
  const point = eventPoint(event);
  selection.currentX = point.x;
  selection.currentY = point.y;
  paintSelection(selection);
});
elements.readerStage.addEventListener("pointerup", finishSelection);
elements.readerStage.addEventListener("pointercancel", cancelSelection);
elements.readerStage.addEventListener("click", openTextAnnotationAtPoint);
document.addEventListener("pointerup", () => {
  state.pointerDragPage = null;
  if (state.viewMode === "continuous" && window.getSelection()?.isCollapsed !== false) handleContinuousScroll();
});
document.addEventListener("pointercancel", () => {
  state.pointerDragPage = null;
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#selected-annotation-toolbar, .text-annotation, [data-action='annotation-actions']")) closeSelectedAnnotation();
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editable = target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable='true'], .ql-editor");
  const readerScope = document.querySelector(".reader-panel")?.contains(target) || target === document.body;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && readerScope && !editable && ["z", "y"].includes(event.key.toLowerCase())) {
    const direction = event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo";
    if (annotationHistory.counts(state.document?.id)[direction]) {
      event.preventDefault();
      void replayAnnotationHistory(direction);
    }
    return;
  }
  if (event.key !== "Escape") return;
  if (state.documentMenu) {
    event.preventDefault();
    closeDocumentMenu(true);
  } else if (readerShapes?.handleEscape()) {
    event.preventDefault();
  } else if (state.selectedAnnotationId) {
    closeSelectedAnnotation();
  } else if (!elements.navigationPanel.hidden) {
    readerNavigation?.close();
    elements.navigationToggle.focus({ preventScroll: true });
  } else if (state.regionActive) {
    setRegionMode(false);
  }
});

window.addEventListener("pagehide", flushReaderProgress);

window.addEventListener("popstate", () => {
  invalidateWorkspaceModeIntent();
  const params = new URLSearchParams(window.location.search);
  const studyId = params.get("study");
  const documentId = studyId || params.get("document");
  const noteId = params.get("note");
  const page = readPageParam(params);
  const analysisId = params.get("analysis");
  const datasetId = params.get("dataset");
  const chartId = params.get("chart");
  const hasExplicitMode = params.has("workspace") || ["note", "analysis", "dataset", "chart", "image_source"].some((key) => params.has(key));
  const mode = studyId && !hasExplicitMode ? "data" : workspace?.modeForParams(params) || "reading";
  const tool = chartId || params.get("tool") === "charts" ? "charts" : "analysis";
  const imageLink = studyId ? null : readImageLink(params);
  const validPage = mode === "reading" && page && state.document?.id === documentId && page <= state.document.page_count;
  if (noteId || imageLink || analysisId || datasetId || chartId || validPage) cancelReaderProgressRestore();
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
      else if (mode === "reading" && page && page <= state.document.page_count) goToPage(page, { preserveUrl: true });
    }
    if (mode === "data" && datasetId) analysis?.openDataset(datasetId, { preserveUrl: true, preserveFocus: true });
    if (mode === "data" && analysisId) analysis?.openJob(analysisId, { preserveUrl: true, preserveFocus: true });
    if (mode === "data" && chartId) charts?.openChart(documentId, chartId, { preserveUrl: true });
  } else {
    openDocument(documentId, {
      ownerKind: studyId ? "study" : "paper",
      noteId: mode === "reading" ? noteId : null,
      page: mode === "reading" ? page : null,
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
    readerNavigation?.update();
    const width = elements.readerStage.clientWidth;
    if (width === observedStageWidth) return;
    observedStageWidth = width;
    if (!width || state.readerLayoutLocked) return;
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
  cancelReaderProgressRestore();
  const attached = source.source;
  if (attached?.kind === "study") {
    await openDocument(source.document_id, { ownerKind: "study", workspace: "reading", explicitIntent: true });
    return;
  }
  if (attached?.kind === "dataset") source = { ...source, kind: "dataset_sample", dataset_id: attached.id };
  else if (attached?.kind === "analysis") source = { ...source, kind: "analysis_result", analysis_id: attached.id };
  else if (attached?.kind === "chart") source = { ...source, kind: "chart_result", chart_id: attached.id };
  if (source.kind === "study_context") {
    await openDocument(source.document_id, { ownerKind: "study", workspace: "reading", explicitIntent: true });
    return;
  }
  if (source.kind === "data") source = { ...source, kind: "dataset_sample", dataset_id: source.dataset_id || source.id };
  if (source.kind === "reference_dataset_sample") source = { ...source, kind: "dataset_sample" };
  if (source.kind === "reference_analysis_result") source = { ...source, kind: "analysis_result" };
  if (source.kind === "analysis") source = { ...source, kind: "analysis_result", analysis_id: source.analysis_id || source.id };
  if (source.kind === "chart") source = { ...source, kind: "chart_result", chart_id: source.chart_id || source.id };
  if (source.kind === "dataset_sample") {
    if (!source.dataset_id) return;
    if (state.document?.id !== source.document_id) await openDocument(source.document_id, { workspace: "data", datasetId: source.dataset_id, explicitIntent: true });
    else {
      invalidateWorkspaceModeIntent();
      if (workspace?.getMode() !== "data" && !prepareContextNavigation()) return;
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
    await openDocument(source.document_id, { noteId: source.note_id || null, explicitIntent: true });
  }
  if (state.document?.id !== source.document_id) return;
  invalidateWorkspaceModeIntent();
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
  lastDataDocumentId = documentId;
  lastDataSelection = { datasetId, analysisId: null, chartId: null };
  const url = new URL(window.location.href);
  const replace = url.searchParams.get(isStudy() ? "study" : "document") === documentId && url.searchParams.get("dataset") === datasetId;
  setOwnerInUrl(url, documentId);
  url.searchParams.set("dataset", datasetId);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "analysis");
  for (const key of ["note", "page", "analysis", "chart", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

function showAnalysisInUrl(documentId, analysisId) {
  if (state.document?.id !== documentId || workspace?.getMode() !== "data" || workspace?.getTool() !== "analysis") return;
  lastDataDocumentId = documentId;
  lastDataSelection = { datasetId: null, analysisId, chartId: null };
  const url = new URL(window.location.href);
  const replace = url.searchParams.get(isStudy() ? "study" : "document") === documentId && url.searchParams.get("analysis") === analysisId;
  setOwnerInUrl(url, documentId);
  url.searchParams.set("analysis", analysisId);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "analysis");
  for (const key of ["dataset", "note", "page", "chart", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

async function openAnalysisJob(documentId, analysisId) {
  if (!analysisId) return;
  invalidateWorkspaceModeIntent();
  if (state.document?.id === documentId && workspace?.getMode() !== "data" && !prepareContextNavigation()) return;
  cancelReaderProgressRestore();
  if (state.document?.id !== documentId) await openDocument(documentId, { workspace: "data", analysisId, explicitIntent: true });
  else {
    workspace?.reveal("data", { tool: "analysis" });
    await analysis?.openJob(analysisId);
  }
}

function showChartInUrl(documentId, chartId) {
  if (state.document?.id !== documentId || workspace?.getMode() !== "data" || workspace?.getTool() !== "charts") return;
  lastDataDocumentId = documentId;
  lastDataSelection = { datasetId: null, analysisId: null, chartId };
  const url = new URL(window.location.href);
  const replace = url.searchParams.get(isStudy() ? "study" : "document") === documentId && url.searchParams.get("chart") === chartId;
  setOwnerInUrl(url, documentId);
  url.searchParams.set("chart", chartId);
  url.searchParams.set("workspace", "data");
  url.searchParams.set("tool", "charts");
  for (const key of ["note", "page", "analysis", "dataset", "image_kind", "image_source", "image_annotation"]) url.searchParams.delete(key);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

async function openChart(documentId, chartId) {
  if (!chartId) return;
  invalidateWorkspaceModeIntent();
  if (state.document?.id === documentId && workspace?.getMode() !== "data" && !prepareContextNavigation()) return;
  cancelReaderProgressRestore();
  if (state.document?.id !== documentId) await openDocument(documentId, { workspace: "data", chartId, explicitIntent: true });
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
  const isCorrelation = job.method === "correlation";
  const method = job.method === "ttest_independent" ? "Independent-samples t-test" : isPaired ? "Paired t-test" : isCorrelation ? "Correlation analysis" : "Descriptive analysis";
  let citation = `Analysis: ${method} · ${job.dataset_name}\n${url.pathname}${url.search}`;
  if (isCorrelation) {
    const result = job.result || {};
    const test = result.test || {};
    const kind = test.kind || job.correlation?.kind || "pearson";
    const columns = Array.isArray(test.columns) ? test.columns : Array.isArray(result.pairs?.columns) ? result.pairs.columns : job.columns || [];
    const coefficient = test.coefficient || (kind === "spearman" ? "rho" : "r");
    const interval = test.ci ? `[${test.ci.lower ?? "—"}, ${test.ci.upper ?? "—"}]` : "Unavailable";
    citation = `Analysis: ${method} · ${job.dataset_name}\nColumns: ${columns[0] || "—"}, ${columns[1] || "—"}\nMethod: ${kind === "spearman" ? "Spearman" : "Pearson"}\n${coefficient}: ${test.estimate ?? "—"} · p: ${test.p_value ?? "—"}\nComplete pairs: ${result.counts?.used ?? "—"} · Excluded pairs: ${result.counts?.excluded ?? "—"}\nConfidence interval: ${interval}\nCorrelation does not imply causation.\n${url.pathname}${url.search}`;
  }
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
    if (draft.page === null && draft.text.trim()) {
      draft.page = state.page;
      draft.rect = null;
    }
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
  richText?.close({ restoreFocus: false });
  clearStatus();
  renderDraft();
  elements.noteText.focus();
}

dataNavigation = createDataNavigation({
  api,
  getLanguage: () => state.language,
  openCatalogItem,
  openPersonalData
});

workspace = createWorkspace({
  getDocument: () => state.document,
  getLanguage: () => state.language,
  modeSelected: (mode) => mode === "data" ? openDataWorkspace() : openReadingWorkspace(),
  modeRendered: (mode) => dataNavigation?.setMode(mode),
  modePendingChanged: (pending) => dataNavigation?.setNavigationPending(pending),
  readingVisible: () => {
    if (readerWorkspaceVisible) return;
    readerWorkspaceVisible = true;
    if (state.pdf) void requestRender().then(restorePendingReaderProgress);
  },
  toolVisible: (tool) => {
    readerObjects?.close();
    readerWorkspaceVisible = false;
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
  isBusy: () => state.pendingSaves > 0 || state.pendingMutations.size > 0,
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
    dataNavigation?.sourcesChanged(documentId);
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
    dataNavigation?.sourcesChanged(documentId);
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
  getSelectedDataset: () => analysis.getSelectedDataset(),
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
  selectChatImage: (documentId, imageId) => imageLibrary.selectChatImage(documentId, imageId),
  deselectChatImage: (documentId, imageId) => imageLibrary.deselectChatImage(documentId, imageId),
  getImages: (documentId, imageIds) => documentId ? imageLibrary.getImages(documentId, imageIds) : [],
  getActiveImage: (documentId) => imageViewer.getActiveImage(documentId),
  clearActiveImage: (documentId) => imageViewer.clearActiveContext(documentId),
  openImageProposal,
  navigateSource: navigateAssistantSource,
  reviewResearchRecord: (source) => researchRecord.reviewSource(source),
  refreshAfterAgent
});

readerFind = createReaderFind({
  t,
  getPdf: () => state.pdf,
  getDocument: () => state.document,
  isStudy,
  isReadingVisible: () => workspace.getMode() === "reading",
  goToPage,
  getTextLayer: (page) => state.page === page ? elements.textLayer : elements.readerStage.querySelector(`[data-reader-page="${page}"] .textLayer`),
  getPageSurface: (page) => state.page === page ? elements.pageSurface : elements.readerStage.querySelector(`[data-reader-page="${page}"]`)
});

readerObjects = createReaderObjectMenu({
  stage: elements.readerStage,
  api,
  t,
  getDocument: () => state.document && !isStudy() ? state.document : null,
  getRecord: (page) => state.readerPages.get(page),
  getRenderSequence: () => state.renderSequence,
  onAction: handleReaderObjectAction,
  onManualCapture: () => setRegionMode(true)
});

readerShapes = createReaderShapes({
  t,
  getDocument: () => state.document,
  getNotes: () => state.noteStates,
  getRecord: (page) => state.readerPages.get(page),
  getRenderSequence: () => state.renderSequence,
  getStage: () => elements.readerStage,
  recordIsCurrent: (record) => readerRecordIsCurrent(record, state.document?.id, state.document?.sha256, state.renderSequence),
  generationCurrent(target) {
    if (!readerRecordIsCurrent(target.record, target.documentId, target.sourceSha, target.renderSequence)) return false;
    if (!target.noteId) return true;
    const note = noteStateFor(target.noteId);
    return Boolean(note?.shape_annotation && !note.deleted_at && !note.purged && note.revision === target.revision);
  },
  isBusy: () => !state.pdf || !state.document || isStudy() || state.pendingSaves > 0 || state.pendingMutations.size > 0 || state.editDrafts.has(state.document.id),
  isSuspended: () => state.regionActive || workspace?.getMode() !== "reading",
  beforeInteraction() {
    setRegionMode(false);
    clearPdfTextSelection();
    closeSelectedAnnotation();
    readerObjects?.close();
  },
  beforeSelect() {
    setRegionMode(false);
    clearPdfTextSelection();
    closeSelectedAnnotation();
    readerObjects?.close();
  },
  save: saveShape,
  remove: (target) => deleteNote(state.document, noteStateFor(target.noteId)),
  capture: captureShape,
  status: (key) => setStatus(key, "error")
});
$("reader-shape-rectangle").addEventListener("click", () => readerShapes.start("rectangle"));
$("reader-shape-arrow").addEventListener("click", () => readerShapes.start("arrow"));
$("reader-shape-line").addEventListener("click", () => readerShapes.start("line"));
$("reader-shape-ellipse").addEventListener("click", () => readerShapes.start("ellipse"));
$("reader-shape-ink").addEventListener("click", () => readerShapes.start("ink"));
$("reader-shape-textbox").addEventListener("click", () => readerShapes.start("textbox"));

readerNavigation = createReaderNavigation({
  elements: {
    toggle: elements.navigationToggle, panel: elements.navigationPanel, close: elements.navigationClose,
    outlineTab: elements.outlineTab, thumbnailsTab: elements.thumbnailsTab, outline: elements.outline,
    thumbnailsPanel: elements.thumbnailsPanel, thumbnails: elements.thumbnails, pageInput: elements.pageInput,
    previous: elements.thumbnailsPrev, next: elements.thumbnailsNext, range: elements.thumbnailsRange,
    outlineList: elements.outlineList, outlineStatus: elements.outlineStatus, outlineRetry: elements.outlineRetry
  },
  t,
  goToPage,
  goToDestination: (destination) => state.pdfLinks?.goToDestination(destination)
});

applyTheme();
applyLanguage();
loadDocuments();
