import { renderRichHtml } from "/rich-text.js";
import { createTaskClient } from "/task-client.js";

const ACTIVE_STATES = new Set(["queued", "running"]);
const TERMINAL_STATES = new Set(["waiting_confirmation", "completed", "failed", "cancelled", "interrupted"]);

const messages = {
  zh: {
    assistant: "研究助手",
    close: "关闭研究助手",
    history: "对话记录",
    new: "新对话",
    emptyHistory: "暂无对话",
    messageLabel: "给研究助手的消息",
    placeholder: "询问当前页面或已选图片…",
    send: "发送",
    retry: "按原请求重试",
    cancel: "停止",
    stopping: "正在停止…",
    sending: "正在提交…",
    loading: "正在加载…",
    queued: "排队中",
    running: "正在处理",
    waiting_confirmation: "等待你确认",
    completed: "已完成",
    failed: "未完成",
    cancelled: "已停止",
    interrupted: "服务重启后已中断；不会自动重试或写入。",
    contextPaper: "文献：{title}",
    contextStudy: "研究：{title}",
    studySource: "研究笔记来源",
    sourceHash: "来源 SHA-256",
    contextPage: "第 {page} 页",
    contextRegion: "选定区域",
    contextWhole: "整页上下文",
    contextNote: "当前笔记",
    contextImages: "已选 {count} 张图片",
    contextImagePixels: "图片：{name} · 提供预览像素",
    contextImageMetadata: "图片：{name} · 仅提供来源和批注文字，不提供像素",
    clearImageContext: "清除图片上下文",
    contextDataset: "将提供所选数据的预览",
    contextAnalysis: "将提供当前已保存的分析结果",
    contextChart: "图表：{title} · 仅元信息和摘要",
    clearChartContext: "清除图表上下文",
    chartDataset: "图表数据",
    chartKind: "图表类型",
    grouped_points: "两组观测点",
    chartGroupColumn: "分组列",
    chartOutcome: "数值结果列",
    chartFields: "图表字段",
    chartBins: "分组数",
    chartRevision: "图表修订号",
    chartDataHash: "图表数据 SHA-256",
    chartPreview: "预览图表",
    chartPreviewing: "正在预览…",
    chartPreviewReady: "只读预览已生成，可确认原提案。",
    chartPreviewFailed: "预览失败，请重试；尚未写入。",
    chartOpen: "打开已保存图表",
    analysisDataset: "数据",
    analysisDatasetHash: "数据 SHA-256",
    analysisEngine: "语言",
    analysisColumns: "分析列",
    analysisRecipe: "固定代码版本",
    analysisRecipeHash: "代码 SHA-256",
    analysisCode: "将运行的固定代码",
    analysisCodeLoading: "正在读取固定代码…",
    analysisCodeUnavailable: "固定代码暂不可用，不能确认运行。",
    analysisCodeMismatch: "固定代码与提案不一致，不能确认运行。",
    analysisConfirm: "确认运行",
    analysisQueued: "分析任务已排队，尚未完成。",
    analysisOpen: "查看分析任务",
    analysisMethod: "分析方法",
    analysisTtest: "独立样本 t 检验（r-stats）",
    analysisOutcome: "数值结果变量",
    analysisGroupColumn: "分组列",
    analysisGroups: "明确分组顺序",
    analysisDifference: "均值差方向",
    analysisVariant: "方差处理",
    analysisAlternative: "备择方向",
    analysisConfidence: "置信水平",
    analysisIndependent: "独立样本声明",
    analysisIndependentConfirmed: "已确认两组独立，且一个观测不会同时属于两组。",
    analysisMissing: "缺失处理",
    analysisCompleteCases: "仅使用结果和分组均完整的行",
    analysisCounts: "完整数据预览计数",
    analysisTotal: "总行数",
    analysisUsed: "使用行数",
    analysisExcluded: "排除行数",
    analysisMissingOutcome: "仅结果缺失",
    analysisMissingGroup: "仅分组缺失",
    analysisMissingBoth: "结果和分组均缺失",
    analysisGroupSummaries: "预览分组摘要",
    analysisMean: "均值",
    analysisSd: "样本标准差",
    analysisMedian: "中位数",
    analysisMin: "最小值",
    analysisMax: "最大值",
    analysisCancel: "确认取消任务",
    analysisCancelled: "已提交分析任务取消。",
    analysisId: "分析任务 ID",
    analysisStatus: "任务状态",
    analysisLibrary: "计算库",
    selectionParent: "筛选父数据",
    selectionRule: "精确筛选规则",
    selectionName: "结果名称",
    selectionDefaultName: "（默认名称）",
    selectionCounts: "匹配 / 排除 / 总行数",
    selectionRecipe: "固定筛选配方",
    selectionSourceRowsHash: "源行映射 SHA-256",
    selectionPreviewHash: "预览 SHA-256",
    selectionCreated: "筛选分析表已生成，尚未自动共享给助手。",
    selectionOpen: "打开筛选分析表",
    selectionChildLoadFailed: "分析表已保存，但读取完整记录失败；不会重复确认提案。",
    variant_welch: "Welch（不假定等方差）",
    variant_student: "Student（假定等方差）",
    alternative_two_sided: "双侧（两组不相等）",
    alternative_greater: "第 1 组大于第 2 组",
    alternative_less: "第 1 组小于第 2 组",
    noDocument: "选择一篇文献后可向助手提问。",
    emptyChat: "发送一条消息开始。助手会保留来源、工具进度和待确认操作。",
    you: "你",
    assistantAnswer: "助手",
    tools: "工具记录",
    sources: "来源",
    reviewResearchRecord: "查看导出范围",
    proposals: "待确认操作",
    proposalStatus: "状态：{status}",
    pending: "待确认",
    applied: "已保存",
    rejected: "已拒绝",
    conflict: "发生冲突，原提案仍保留",
    conflictHelp: "目标或来源已在其他地方变化。请查看原提案，放弃后可重新提出操作；不会覆盖较新的内容。",
    abandonConflict: "放弃旧提案",
    proposalInactive: "当前任务已结束，此提案不能再执行。",
    noteBody: "笔记正文",
    formattingRemoved: "此修改会将已有格式笔记转为纯文本，原有格式将被移除。",
    paper: "文献",
    page: "页码",
    pageValue: "第 {page} 页",
    selection: "页面范围",
    selectedRegion: "选定区域",
    wholePage: "整页",
    sourceRef: "出处 {ref}",
    selectedImages: "所选图片（点击打开原图）",
    proposalImageAlt: "提案图片：{name}",
    imageUnavailable: "图片信息暂不可用，请重新加载后再确认。",
    imageSource: "图片来源",
    imageRegion: "图片区域",
    viewImageRegion: "查看提案区域",
    viewSource: "查看出处",
    viewTarget: "查看目标笔记",
    metadataChanges: "书目信息修改",
    field_title: "标题",
    field_authors: "作者",
    field_year: "年份",
    field_doi: "DOI",
    cleared: "（清空）",
    receiptCreated: "已保存新笔记。",
    receiptUpdated: "已保存书目信息修改。",
    receiptChanged: "已保存笔记修改。",
    receiptDeleted: "已删除笔记。",
    receiptRestored: "已恢复笔记。",
    receiptSaved: "已保存修改。",
    openSource: "打开来源",
    not_found: "找不到请求的内容。",
    agent_invalid_state: "当前任务状态不能处理此提案。",
    agent_proposal_changed: "提案内容已变化，请重新查看。",
    agent_decision_conflict: "此提案已经处理，不能更改先前决定。",
    agent_cancelled: "此次助手任务已结束，未提交新的提案。",
    agent_image_not_selected: "只能使用本次明确选择的图片。",
    agent_scope: "此提案不属于当前文献，未执行写入。",
    agent_tool_unavailable: "这项操作当前不可用。",
    confirm: "确认保存",
    reject: "拒绝",
    receipt: "实际保存结果",
    deciding: "正在提交决定…",
    confirmed: "操作已按原提案保存。",
    rejectedDone: "已拒绝此提案，未执行写入。",
    settings: "本地模型设置",
    settingsHelp: "设置仅保存在此研究工作台的私有配置中。密钥不会写入浏览器本地存储。",
    providerUrl: "API 地址（HTTPS）",
    providerModel: "模型",
    providerKey: "API 密钥",
    providerImages: "此模型接受图片输入",
    saveSettings: "保存模型设置",
    savingSettings: "正在保存模型设置…",
    settingsSaved: "模型设置已保存。",
    settingsInvalid: "请输入不含凭据、查询或片段的 HTTPS 地址和模型名称。",
    notConfigured: "尚未配置本地模型。可在下方设置；阅读、上传和笔记仍可使用。",
    configured: "模型：{model} · 图片输入：{vision}",
    visionOn: "支持",
    visionOff: "不支持或未确认",
    agent_not_configured: "尚未配置模型。请先在“本地模型设置”中保存连接。",
    agent_vision_disabled: "当前模型未确认支持图片。请移除图片或调整模型设置；消息草稿已保留。",
    agent_busy: "此对话已有正在处理的任务，请等待或停止后再发送。",
    agent_task_dataset_required: "连续任务需要先明确共享所选数据。",
    agent_task_busy: "此对话已有连续任务。请停止接续，或开始新对话。",
    agent_task_scope_changed: "文献或来源范围已变化，未继续任务。",
    agent_task_paused: "任务已暂停，请明确继续后再操作。",
    agent_task_stage: "当前步骤不能执行此操作。",
    agent_task_sources_required: "请重新共享原始数据和原任务所选图片后再继续。",
    agent_task_limit: "连续任务已达到自动接续上限，请查看当前进度。",
    agent_task_control_conflict: "任务状态已变化，请读取最新状态后再操作。",
    agent_task_invalid_state: "当前任务状态不能执行此操作。",
    idempotency_conflict: "请求标识发生冲突，原请求未被改写。",
    revision_conflict: "目标已在其他地方更新。原提案仍保留，请查看后重新提出操作。",
    source_changed: "来源已变化，未执行写入。原提案仍保留。",
    note_deleted: "目标笔记已删除，未执行写入。",
    validation_error: "请求无效，请检查当前页面、图片或设置。",
    network: "无法连接本地服务。草稿和原请求已保留。",
    request_failed: "操作未完成，请重试。",
    loadFailed: "无法加载对话，请重试。",
    statusFailed: "无法读取模型状态。",
    turnFailed: "此次助手任务未完成。",
    cancelFailed: "停止请求未完成，请重试。",
    decisionFailed: "决定未保存，原提案仍保留。请重试。",
    newConversation: "新对话",
    conversation: "对话 {date}",
    untitled: "未命名文献"
  },
  en: {
    assistant: "Research assistant",
    close: "Close research assistant",
    history: "Conversations",
    new: "New conversation",
    emptyHistory: "No conversations",
    messageLabel: "Message for the research assistant",
    placeholder: "Ask about the current page or selected images…",
    send: "Send",
    retry: "Retry exact request",
    cancel: "Stop",
    stopping: "Stopping…",
    sending: "Submitting…",
    loading: "Loading…",
    queued: "Queued",
    running: "Working",
    waiting_confirmation: "Waiting for your confirmation",
    completed: "Completed",
    failed: "Not completed",
    cancelled: "Stopped",
    interrupted: "Interrupted by a service restart; no automatic retry or write will occur.",
    contextPaper: "Paper: {title}",
    contextStudy: "Research: {title}",
    studySource: "Study note source",
    sourceHash: "Source SHA-256",
    contextPage: "Page {page}",
    contextRegion: "Selected region",
    contextWhole: "Whole-page context",
    contextNote: "Active note",
    contextImages: "{count} images selected",
    contextImagePixels: "Image: {name} · preview pixels provided",
    contextImageMetadata: "Image: {name} · source and annotation text only; no pixels",
    clearImageContext: "Clear image context",
    contextDataset: "Selected data preview will be provided",
    contextAnalysis: "The current saved analysis will be provided",
    contextChart: "Chart: {title} · metadata and summary only",
    clearChartContext: "Clear chart context",
    chartDataset: "Chart data",
    chartKind: "Chart type",
    grouped_points: "Two-group observations",
    chartGroupColumn: "Grouping column",
    chartOutcome: "Numeric outcome column",
    chartFields: "Chart fields",
    chartBins: "Bins",
    chartRevision: "Chart revision",
    chartDataHash: "Chart data SHA-256",
    chartPreview: "Preview chart",
    chartPreviewing: "Previewing…",
    chartPreviewReady: "Read-only preview generated; the exact proposal can be confirmed.",
    chartPreviewFailed: "Preview failed. Retry; nothing was written.",
    chartOpen: "Open saved chart",
    analysisDataset: "Data",
    analysisDatasetHash: "Data SHA-256",
    analysisEngine: "Language",
    analysisColumns: "Columns",
    analysisRecipe: "Fixed code version",
    analysisRecipeHash: "Code SHA-256",
    analysisCode: "Fixed code to run",
    analysisCodeLoading: "Loading fixed code…",
    analysisCodeUnavailable: "The fixed code is unavailable, so this run cannot be confirmed.",
    analysisCodeMismatch: "The fixed code does not match the proposal, so this run cannot be confirmed.",
    analysisConfirm: "Confirm run",
    analysisQueued: "The analysis task is queued, not complete.",
    analysisOpen: "Open analysis task",
    analysisMethod: "Analysis method",
    analysisTtest: "Independent-samples t-test (r-stats)",
    analysisOutcome: "Numeric outcome",
    analysisGroupColumn: "Grouping column",
    analysisGroups: "Explicit group order",
    analysisDifference: "Mean difference direction",
    analysisVariant: "Variance method",
    analysisAlternative: "Alternative direction",
    analysisConfidence: "Confidence level",
    analysisIndependent: "Independent-samples declaration",
    analysisIndependentConfirmed: "Confirmed: the groups are independent and no observation belongs to both groups.",
    analysisMissing: "Missing data",
    analysisCompleteCases: "Only rows with both outcome and group present are used",
    analysisCounts: "Full-data preview counts",
    analysisTotal: "Total rows",
    analysisUsed: "Rows used",
    analysisExcluded: "Rows excluded",
    analysisMissingOutcome: "Outcome only missing",
    analysisMissingGroup: "Group only missing",
    analysisMissingBoth: "Outcome and group missing",
    analysisGroupSummaries: "Preview group summaries",
    analysisMean: "Mean",
    analysisSd: "Sample SD",
    analysisMedian: "Median",
    analysisMin: "Minimum",
    analysisMax: "Maximum",
    analysisCancel: "Confirm task cancellation",
    analysisCancelled: "Analysis task cancellation submitted.",
    analysisId: "Analysis task ID",
    analysisStatus: "Task status",
    analysisLibrary: "Computation library",
    selectionParent: "Selection parent data",
    selectionRule: "Exact filter rule",
    selectionName: "Result name",
    selectionDefaultName: "(default name)",
    selectionCounts: "Matched / excluded / total rows",
    selectionRecipe: "Fixed selection recipe",
    selectionSourceRowsHash: "Source-row mapping SHA-256",
    selectionPreviewHash: "Preview SHA-256",
    selectionCreated: "The filtered analysis table was generated and has not been shared with the assistant automatically.",
    selectionOpen: "Open filtered analysis table",
    selectionChildLoadFailed: "The table was saved, but its full record could not be loaded; the proposal will not be confirmed again.",
    variant_welch: "Welch (equal variances not assumed)",
    variant_student: "Student (equal variances assumed)",
    alternative_two_sided: "Two-sided (groups differ)",
    alternative_greater: "Group 1 greater than group 2",
    alternative_less: "Group 1 less than group 2",
    noDocument: "Choose a paper before asking the assistant.",
    emptyChat: "Send a message to start. Sources, tool progress, and pending actions are retained.",
    you: "You",
    assistantAnswer: "Assistant",
    tools: "Tool history",
    sources: "Sources",
    reviewResearchRecord: "Review export scope",
    proposals: "Actions awaiting confirmation",
    proposalStatus: "Status: {status}",
    pending: "Pending",
    applied: "Saved",
    rejected: "Rejected",
    conflict: "Conflict; original proposal retained",
    conflictHelp: "The target or source changed elsewhere. Review the original proposal and abandon it before requesting a new action; newer content will not be overwritten.",
    abandonConflict: "Abandon old proposal",
    proposalInactive: "This task has ended, so this proposal can no longer be applied.",
    noteBody: "Note text",
    formattingRemoved: "This edit converts a formatted note to plain text and removes its existing formatting.",
    paper: "Paper",
    page: "Page",
    pageValue: "Page {page}",
    selection: "Page scope",
    selectedRegion: "Selected region",
    wholePage: "Whole page",
    sourceRef: "Source {ref}",
    selectedImages: "Selected images (click to open the original)",
    proposalImageAlt: "Proposal image: {name}",
    imageUnavailable: "Image details are unavailable. Reload them before confirming.",
    imageSource: "Image source",
    imageRegion: "Image region",
    viewImageRegion: "View proposed region",
    viewSource: "View source",
    viewTarget: "View target note",
    metadataChanges: "Bibliographic changes",
    field_title: "Title",
    field_authors: "Authors",
    field_year: "Year",
    field_doi: "DOI",
    cleared: "(cleared)",
    receiptCreated: "New note saved.",
    receiptUpdated: "Bibliographic changes saved.",
    receiptChanged: "Note changes saved.",
    receiptDeleted: "Note deleted.",
    receiptRestored: "Note restored.",
    receiptSaved: "Changes saved.",
    openSource: "Open source",
    not_found: "The requested content could not be found.",
    agent_invalid_state: "The current task state cannot process this proposal.",
    agent_proposal_changed: "The proposal changed. Review it again.",
    agent_decision_conflict: "This proposal was already decided; the earlier decision cannot be changed.",
    agent_cancelled: "This assistant task ended without submitting a new proposal.",
    agent_image_not_selected: "Only images explicitly selected for this request can be used.",
    agent_scope: "This proposal does not belong to the current paper; no write occurred.",
    agent_tool_unavailable: "This action is currently unavailable.",
    confirm: "Confirm save",
    reject: "Reject",
    receipt: "Actual save receipt",
    deciding: "Submitting decision…",
    confirmed: "The exact proposal was saved.",
    rejectedDone: "Proposal rejected; no write was performed.",
    settings: "Local model settings",
    settingsHelp: "Settings are stored only in this workbench’s private configuration. Keys are never written to browser local storage.",
    providerUrl: "API URL (HTTPS)",
    providerModel: "Model",
    providerKey: "API key",
    providerImages: "This model accepts image input",
    saveSettings: "Save model settings",
    savingSettings: "Saving model settings…",
    settingsSaved: "Model settings saved.",
    settingsInvalid: "Enter an HTTPS URL without credentials, query, or fragment, and a model name.",
    notConfigured: "No local model is configured. Configure one below; reading, uploads, and notes remain available.",
    configured: "Model: {model} · Image input: {vision}",
    visionOn: "supported",
    visionOff: "unsupported or unconfirmed",
    agent_not_configured: "No model is configured. Save a connection under “Local model settings” first.",
    agent_vision_disabled: "This model has not confirmed image support. Remove the images or change settings; your draft is retained.",
    agent_busy: "This conversation already has an active task. Wait or stop it before sending.",
    agent_task_dataset_required: "Share the selected data explicitly before starting a continuation task.",
    agent_task_busy: "This conversation has a continuation task. Stop it or start a new conversation.",
    agent_task_scope_changed: "The paper or source scope changed, so the task was not continued.",
    agent_task_paused: "The task is paused. Continue it explicitly before taking this action.",
    agent_task_stage: "This action is not available at the current step.",
    agent_task_sources_required: "Share the original data and task-selected images again before continuing.",
    agent_task_limit: "The continuation limit was reached. Review the current progress.",
    agent_task_control_conflict: "The task state changed. Load the latest state before taking another action.",
    agent_task_invalid_state: "This action is unavailable in the current task state.",
    idempotency_conflict: "The request ID conflicted; the original request was not changed.",
    revision_conflict: "The target changed elsewhere. The original proposal is retained; review it and request a new action.",
    source_changed: "The source changed, so no write occurred. The original proposal is retained.",
    note_deleted: "The target note is deleted, so no write occurred.",
    validation_error: "The request is invalid. Check the current page, images, or settings.",
    network: "Cannot connect to the local service. Your draft and exact request are retained.",
    request_failed: "The action was not completed. Try again.",
    loadFailed: "The conversation could not be loaded.",
    statusFailed: "The model status could not be read.",
    turnFailed: "This assistant task was not completed.",
    cancelFailed: "The stop request was not completed. Try again.",
    decisionFailed: "The decision was not saved. The original proposal is retained; try again.",
    newConversation: "New conversation",
    conversation: "Conversation {date}",
    untitled: "Untitled paper"
  }
};

export function createAssistant(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    toggle: byId("assistant-toggle"),
    panel: byId("assistant-panel"),
    close: byId("assistant-close"),
    heading: byId("assistant-heading"),
    history: byId("assistant-history"),
    new: byId("assistant-new"),
    context: byId("assistant-context"),
    messages: byId("assistant-messages"),
    sources: byId("assistant-sources"),
    proposals: byId("assistant-proposals"),
    status: byId("assistant-status"),
    form: byId("assistant-form"),
    message: byId("assistant-message"),
    send: byId("assistant-send"),
    cancel: byId("assistant-cancel"),
    settings: byId("assistant-settings"),
    settingsToggle: byId("assistant-settings-toggle"),
    settingsForm: byId("assistant-settings-form"),
    settingsHelp: byId("assistant-settings-help"),
    providerUrl: byId("assistant-provider-url"),
    providerModel: byId("assistant-provider-model"),
    providerKey: byId("assistant-provider-key"),
    providerImages: byId("assistant-provider-images"),
    providerSave: byId("assistant-provider-save"),
    settingsStatus: byId("assistant-settings-status")
  };
  const papers = new Map();
  const analysisRecipes = new Map();
  let language = adapter.getLanguage();
  let provider = { loaded: false, configured: false, model: "", image_input: false };
  let providerStatus = { key: "loading", kind: "info" };
  let settingsPending = false;
  let settingsStatus = null;

  function t(key, values = {}) {
    let text = messages[language][key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  const tasks = createTaskClient({
    api: adapter.api,
    getDocument: adapter.getDocument,
    getLanguage: () => language,
    getConversationId: (paperId) => entryFor(paperId).conversationId,
    getSharedDatasetId: adapter.getSharedDatasetId,
    getChatImages: adapter.getChatImages,
    getDraft: (paperId) => entryFor(paperId).draft,
    clearDraft: (paperId, expectedDraft) => {
      const entry = entryFor(paperId);
      if (entry.draft === expectedDraft) entry.draft = "";
    },
    refreshConversation: async (paperId, conversationId) => {
      const entry = entryFor(paperId);
      if (entry.conversationId === conversationId) await loadConversation(paperId, entry, conversationId, { taskRefresh: true });
    },
    openAnalysisJob: adapter.openAnalysisJob,
    openChart: adapter.openChart,
    navigateSource: adapter.navigateSource,
    render: () => render()
  });

  function entryFor(documentId) {
    if (!papers.has(documentId)) {
      papers.set(documentId, {
        conversations: [],
        conversationId: null,
        turns: [],
        draft: "",
        fresh: false,
        loaded: false,
        loading: false,
        loadSequence: 0,
        loadController: null,
        pendingSend: null,
        pendingDecision: null,
        chartPreviews: new Map(),
        cancelling: null,
        status: null,
        pollToken: 0,
        pollTimer: null,
        pollController: null
      });
    }
    return papers.get(documentId);
  }

  function current() {
    const paper = adapter.getDocument();
    return paper ? { paper, entry: entryFor(paper.id) } : { paper: null, entry: null };
  }

  function isCurrent(paperId, entry) {
    return adapter.getDocument()?.id === paperId && entryFor(paperId) === entry;
  }

  function latestTurn(entry) {
    return entry.turns.length ? entry.turns[entry.turns.length - 1] : null;
  }

  function activeTurn(entry) {
    return [...entry.turns].reverse().find((turn) => ACTIVE_STATES.has(turn.status)) || null;
  }

  function statusText(status) {
    return messages[language][status] || messages.en[status] || status;
  }

  function setEntryStatus(entry, status, paperId) {
    entry.status = status;
    if (isCurrent(paperId, entry)) render();
  }

  function upsertTurn(entry, turn) {
    const index = entry.turns.findIndex((item) => item.id === turn.id);
    if (index >= 0) entry.turns[index] = turn;
    else entry.turns.push(turn);
    entry.turns.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    entry.conversationId = turn.conversation_id;
    entry.fresh = false;
  }

  function renderContext() {
    elements.context.replaceChildren();
    const paper = adapter.getDocument();
    if (!paper) {
      elements.context.textContent = t("noDocument");
      return;
    }
    const context = adapter.getContext();
    const images = adapter.getChatImages(paper.id);
    const badges = paper.kind === "study" ? [
      t("contextStudy", { title: paper.title || paper.name || t("untitled") })
    ] : [
      t("contextPaper", { title: paper.title || paper.original_filename || t("untitled") }),
      t("contextPage", { page: context.page }),
      t(context.rect ? "contextRegion" : "contextWhole")
    ];
    if (context.activeNoteId) badges.push(t("contextNote"));
    if (images.length) badges.push(t("contextImages", { count: images.length }));
    if (adapter.getSharedDatasetId?.()) badges.push(t("contextDataset"));
    if (adapter.getActiveAnalysisId?.()) badges.push(t("contextAnalysis"));
    for (const label of badges) {
      const badge = document.createElement("span");
      badge.className = "assistant-context-badge";
      badge.textContent = label;
      elements.context.append(badge);
    }
    const activeChart = adapter.getActiveChart?.(paper.id);
    if (activeChart) {
      const badge = document.createElement("span");
      badge.className = "assistant-context-badge";
      badge.dataset.activeChart = "true";
      badge.textContent = t("contextChart", { title: activeChart.title });
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "button button-quiet";
      clear.dataset.action = "clear-chart-context";
      clear.textContent = t("clearChartContext");
      clear.addEventListener("click", () => adapter.clearActiveChart(paper.id));
      elements.context.append(badge, clear);
    }
    const activeImage = adapter.getActiveImage?.(paper.id);
    if (activeImage) {
      const badge = document.createElement("span");
      badge.className = "assistant-context-badge";
      badge.dataset.activeImage = "true";
      badge.textContent = t(activeImage.pixelsShared ? "contextImagePixels" : "contextImageMetadata", { name: activeImage.label });
      const clear = document.createElement("button");
      clear.id = "image-context-clear";
      clear.type = "button";
      clear.className = "button button-quiet";
      clear.dataset.action = "clear-image-context";
      clear.textContent = t("clearImageContext");
      clear.addEventListener("click", () => adapter.clearActiveImage(paper.id));
      elements.context.append(badge, clear);
    }
  }

  function renderHistory(entry) {
    elements.history.replaceChildren();
    elements.history.setAttribute("aria-label", t("history"));
    if (entry?.fresh || !entry?.conversationId) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = t("newConversation");
      elements.history.append(option);
    }
    for (const conversation of entry?.conversations || []) {
      const option = document.createElement("option");
      option.value = conversation.id;
      const date = String(conversation.updated_at || "").slice(0, 10);
      option.textContent = conversation.title || t("conversation", { date });
      elements.history.append(option);
    }
    if (!elements.history.options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = t("emptyHistory");
      elements.history.append(option);
    }
    elements.history.value = entry?.conversationId || "";
    elements.history.disabled = !entry?.conversations.length || entry.loading || Boolean(entry.pendingSend?.pending) || Boolean(entry.pendingDecision);
  }

  function renderMessages(entry) {
    elements.messages.replaceChildren();
    if (!entry?.turns.length) {
      const empty = document.createElement("p");
      empty.className = "assistant-empty";
      empty.textContent = t("emptyChat");
      elements.messages.append(empty);
      return;
    }
    for (const turn of entry.turns) {
      const article = document.createElement("article");
      article.className = "assistant-turn";
      article.dataset.turnId = turn.id;
      article.dataset.status = turn.status;

      const user = document.createElement("div");
      user.className = "assistant-user-message";
      const userLabel = document.createElement("strong");
      userLabel.textContent = t("you");
      const userText = document.createElement("p");
      userText.textContent = turn.message || t("contextImages", { count: turn.context?.images?.length || 0 });
      user.append(userLabel, userText);

      const progress = document.createElement("p");
      progress.className = "assistant-turn-status";
      progress.textContent = statusText(turn.status);
      article.append(user, progress);

      if (turn.answer) {
        const answer = document.createElement("div");
        answer.className = "assistant-answer";
        const label = document.createElement("strong");
        label.textContent = t("assistantAnswer");
        const text = document.createElement("p");
        text.textContent = turn.answer;
        answer.append(label, text);
        article.append(answer);
      }
      if (turn.error) {
        const error = document.createElement("p");
        error.className = "assistant-error";
        error.textContent = errorText(turn.error, "turnFailed");
        article.append(error);
      }
      if (Array.isArray(turn.events) && turn.events.length) {
        const details = document.createElement("details");
        details.className = "assistant-tools";
        const summary = document.createElement("summary");
        summary.textContent = `${t("tools")} (${turn.events.length})`;
        const list = document.createElement("ol");
        for (const event of turn.events) {
          const item = document.createElement("li");
          item.dataset.eventKind = event.kind;
          item.dataset.status = event.status;
          const title = document.createElement("strong");
          title.textContent = `${event.title} · ${event.status}`;
          item.append(title);
          if (event.summary) {
            const text = document.createElement("p");
            text.textContent = event.summary;
            item.append(text);
          }
          list.append(item);
        }
        details.append(summary, list);
        article.append(details);
      }
      elements.messages.append(article);
    }
  }

  function renderSources(turn) {
    elements.sources.replaceChildren();
    if (!Array.isArray(turn?.sources) || !turn.sources.length) return;
    const heading = document.createElement("h3");
    heading.textContent = t("sources");
    const list = document.createElement("ul");
    for (const source of turn.sources) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "assistant-source-button";
      const isResearchRecord = source.kind === "research_record";
      button.textContent = isResearchRecord ? t("reviewResearchRecord") : source.label || source.ref;
      button.addEventListener("click", () => {
        if (isResearchRecord) adapter.reviewResearchRecord?.(source);
        else adapter.navigateSource(source);
      });
      item.append(button);
      if (isResearchRecord && source.ref) {
        const reference = document.createElement("p");
        reference.className = "assistant-source-ref";
        reference.textContent = t("sourceRef", { ref: source.ref });
        item.append(reference);
      }
      if (source.text) {
        const excerpt = document.createElement("p");
        excerpt.textContent = source.text;
        item.append(excerpt);
      }
      list.append(item);
    }
    elements.sources.append(heading, list);
  }

  function errorText(error, fallback = "request_failed") {
    const code = typeof error === "string" ? error : error?.code || error?.key;
    const known = code && (Object.hasOwn(messages[language], code) || Object.hasOwn(messages.en, code));
    if (known) return t(code);
    const message = typeof error === "object" ? error?.message : null;
    return message && message !== code ? message : t(fallback);
  }

  function appendProposalField(list, label, value, className = "") {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    if (className) description.className = className;
    list.append(term, description);
    return description;
  }

  function appendSourceButton(container, source, label) {
    if (!source?.document_id) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "assistant-source-button assistant-proposal-source";
    button.dataset.action = "open-proposal-source";
    button.textContent = label;
    button.addEventListener("click", () => adapter.navigateSource(source));
    container.append(button);
  }

  function appendProposalImages(card, paper, turn, payload) {
    const imageIds = Array.isArray(payload.image_ids) ? payload.image_ids : [];
    if (!imageIds.length) return;
    const label = document.createElement("strong");
    label.textContent = t("selectedImages");
    const group = document.createElement("div");
    group.className = "assistant-proposal-images";
    const libraryImages = adapter.getImages?.(paper.id, imageIds) || [];
    const contextImages = Array.isArray(turn.context?.images) ? turn.context.images : [];
    for (const imageId of imageIds) {
      const image = libraryImages.find((item) => item.id === imageId) || contextImages.find((item) => item.id === imageId);
      if (!image) {
        const unavailable = document.createElement("p");
        unavailable.className = "assistant-proposal-inactive";
        unavailable.textContent = t("imageUnavailable");
        group.append(unavailable);
        continue;
      }
      const figure = document.createElement("figure");
      const link = document.createElement("a");
      link.className = "assistant-proposal-image-link";
      link.href = image.file_url || `/api/v1/documents/${encodeURIComponent(paper.id)}/images/${encodeURIComponent(image.id)}/file`;
      link.target = "_blank";
      link.rel = "noopener";
      const preview = document.createElement("img");
      preview.src = image.preview_url || `/api/v1/documents/${encodeURIComponent(paper.id)}/images/${encodeURIComponent(image.id)}/preview`;
      preview.alt = t("proposalImageAlt", { name: image.original_filename });
      preview.loading = "lazy";
      const caption = document.createElement("figcaption");
      caption.textContent = image.original_filename;
      link.append(preview, caption);
      figure.append(link);
      group.append(figure);
    }
    card.append(label, group);
  }

  function analysisRecipe(payload) {
    const engine = payload.engine === "r" ? "r" : "python";
    const method = payload.method === "ttest_independent" ? "ttest_independent" : "describe";
    const key = `${engine}:${method}`;
    if (!analysisRecipes.has(key)) {
      const state = { status: "loading", recipe: null };
      analysisRecipes.set(key, state);
      if (!adapter.getAnalysisRecipe) {
        state.status = "error";
      } else {
        adapter.getAnalysisRecipe(engine, method).then((recipe) => {
          state.recipe = recipe;
          state.status = "loaded";
        }).catch(() => {
          state.status = "error";
        }).finally(() => {
          if (current().paper) render();
        });
      }
    }
    return analysisRecipes.get(key);
  }

  function appendTtestProposal(card, details, payload) {
    const options = payload.ttest || {};
    const groups = Array.isArray(options.groups) ? options.groups : [];
    const preview = payload.preview || {};
    appendProposalField(details, t("analysisMethod"), t("analysisTtest"));
    appendProposalField(details, t("analysisOutcome"), payload.columns?.[0] || "—");
    appendProposalField(details, t("analysisGroupColumn"), options.group_column || "—");
    appendProposalField(details, t("analysisGroups"), groups.length === 2 ? `1: ${groups[0]} · 2: ${groups[1]}` : "—");
    appendProposalField(details, t("analysisDifference"), groups.length === 2 ? `${groups[0]} − ${groups[1]}` : "—");
    appendProposalField(details, t("analysisVariant"), t(`variant_${options.variant || "welch"}`));
    appendProposalField(details, t("analysisAlternative"), t(`alternative_${options.alternative || "two_sided"}`));
    appendProposalField(details, t("analysisConfidence"), `${Number(options.confidence ?? 0.95) * 100}%`);
    appendProposalField(details, t("analysisIndependent"), options.independent_samples_confirmed === true ? t("analysisIndependentConfirmed") : "—");
    appendProposalField(details, t("analysisMissing"), t("analysisCompleteCases"));
    if (payload.library) appendProposalField(details, t("analysisLibrary"), `${payload.library.id || "r-stats"} ${payload.library.version || ""} · ${payload.library.sha256 || "—"}`);
    const counts = preview.counts || {};
    for (const [field, key] of [["total", "analysisTotal"], ["used", "analysisUsed"], ["excluded", "analysisExcluded"], ["missing_outcome_only", "analysisMissingOutcome"], ["missing_group_only", "analysisMissingGroup"], ["missing_both", "analysisMissingBoth"]]) {
      appendProposalField(details, `${t("analysisCounts")} · ${t(key)}`, counts[field] ?? "—");
    }
    if (Array.isArray(preview.stats)) {
      const label = document.createElement("strong");
      label.textContent = t("analysisGroupSummaries");
      const scroll = document.createElement("div");
      scroll.className = "assistant-ttest-stats";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const header = document.createElement("tr");
      for (const text of [t("analysisGroupColumn"), "n", t("analysisMean"), t("analysisSd"), t("analysisMedian"), t("analysisMin"), t("analysisMax")]) {
        const cell = document.createElement("th");
        cell.textContent = text;
        header.append(cell);
      }
      thead.append(header);
      const tbody = document.createElement("tbody");
      for (const stat of preview.stats) {
        const row = document.createElement("tr");
        for (const [index, value] of [stat.column, stat.n, stat.mean, stat.sd, stat.median, stat.min, stat.max].entries()) {
          const cell = document.createElement(index === 0 ? "th" : "td");
          cell.textContent = value ?? "—";
          row.append(cell);
        }
        tbody.append(row);
      }
      table.append(thead, tbody);
      scroll.append(table);
      card.append(label, scroll);
    }
    for (const warning of preview.warnings || []) {
      const text = document.createElement("p");
      text.className = "assistant-proposal-inactive";
      text.textContent = warning;
      card.append(text);
    }
    return options.independent_samples_confirmed === true && groups.length === 2 && groups[0] !== groups[1] && Boolean(preview.counts);
  }

  function appendAnalysisProposal(card, details, payload) {
    const isTTest = payload.method === "ttest_independent";
    appendProposalField(details, t("analysisDataset"), payload.dataset_name || payload.dataset_id || "—");
    appendProposalField(details, t("analysisDatasetHash"), payload.dataset_sha256 || "—");
    appendProposalField(details, t("analysisEngine"), payload.engine === "r" ? "R" : "Python");
    appendProposalField(details, t("analysisColumns"), Array.isArray(payload.columns) ? payload.columns.join(", ") : "—");
    const scientificReady = isTTest ? appendTtestProposal(card, details, payload) : true;
    appendProposalField(details, t("analysisRecipe"), `${payload.recipe_id || (isTTest ? "ttest-independent-rstats-v1" : "describe-v1")} · v${payload.recipe_version || 1}`);
    appendProposalField(details, t("analysisRecipeHash"), payload.recipe_sha256 || "—");
    const state = analysisRecipe(payload);
    const label = document.createElement("strong");
    label.textContent = t("analysisCode");
    card.append(label);
    if (state.status === "loading") {
      const loading = document.createElement("p");
      loading.className = "assistant-proposal-inactive";
      loading.textContent = t("analysisCodeLoading");
      card.append(loading);
      return false;
    }
    if (state.status === "error" || !state.recipe) {
      const unavailable = document.createElement("p");
      unavailable.className = "assistant-error";
      unavailable.textContent = t("analysisCodeUnavailable");
      card.append(unavailable);
      return false;
    }
    const code = document.createElement("pre");
    code.className = "assistant-analysis-code";
    code.tabIndex = 0;
    code.textContent = state.recipe.code;
    card.append(code);
    if (state.recipe.sha256 !== payload.recipe_sha256) {
      const mismatch = document.createElement("p");
      mismatch.className = "assistant-error";
      mismatch.textContent = t("analysisCodeMismatch");
      card.append(mismatch);
      return false;
    }
    return scientificReady;
  }

  function renderProposals(paper, entry, turn) {
    elements.proposals.replaceChildren();
    if (!Array.isArray(turn?.proposals) || !turn.proposals.length) return;
    const heading = document.createElement("h3");
    heading.textContent = t("proposals");
    elements.proposals.append(heading);
    for (const proposal of turn.proposals) {
      const payload = proposal.payload && typeof proposal.payload === "object" ? proposal.payload : {};
      const isAnalysis = ["run_analysis", "run_t_test"].includes(proposal.kind);
      const isCancelAnalysis = proposal.kind === "cancel_analysis";
      const isDatasetSelection = proposal.kind === "create_dataset_selection";
      const isCreateChart = proposal.kind === "create_chart";
      const isChart = ["create_chart", "delete_chart", "restore_chart"].includes(proposal.kind);
      const chartPreviewKey = proposal.sha256 || proposal.id;
      const chartPreview = entry.chartPreviews.get(chartPreviewKey) || null;
      const isImageAnnotation = ["create_image_annotation", "edit_image_annotation", "delete_image_annotation", "restore_image_annotation"].includes(proposal.kind);
      const card = document.createElement("article");
      card.className = "assistant-proposal";
      card.dataset.proposalId = proposal.id;
      card.dataset.status = proposal.status;
      const title = document.createElement("h4");
      title.textContent = proposal.title;
      const status = document.createElement("p");
      status.className = "assistant-proposal-status";
      status.textContent = t("proposalStatus", { status: t(proposal.status) });
      card.append(title, status);

      const details = document.createElement("dl");
      details.className = "assistant-proposal-details";
      appendProposalField(details, t("paper"), paper.title || paper.original_filename || t("untitled"));
      if (Number.isInteger(payload.page)) appendProposalField(details, t("page"), t("pageValue", { page: payload.page }));
      if (paper.kind !== "study" && Object.hasOwn(payload, "rect")) appendProposalField(details, t(isImageAnnotation ? "imageRegion" : "selection"), t(payload.rect ? "selectedRegion" : "wholePage"));
      const source = turn.sources?.find((item) => payload.source_ref
        ? item.ref === payload.source_ref
        : isImageAnnotation
          ? item.source_id === payload.source_id && item.source_kind === payload.source_kind
          : payload.note_id && item.note_id === payload.note_id);
      const sourceRef = payload.source_ref || source?.ref;
      if (sourceRef) appendProposalField(details, t("sourceRef", { ref: sourceRef }), source?.label || t("viewSource"));
      if (payload.source?.kind && payload.source?.id) {
        appendProposalField(details, t("studySource"), `${payload.source.kind} · ${payload.source.id}`);
        appendProposalField(details, t("sourceHash"), payload.source.sha256 || "—");
      }
      if (isImageAnnotation) appendProposalField(details, t("imageSource"), source?.label || payload.source_label || payload.source_id || "—");
      if (typeof payload.text === "string") {
        const noteBody = appendProposalField(details, t("noteBody"), payload.text, "assistant-proposal-text");
        if (payload.rich_content && typeof payload.rich_html === "string") {
          noteBody.classList.remove("assistant-proposal-text");
          noteBody.classList.add("note-rich-content", "assistant-proposal-rich");
          void renderRichHtml(noteBody, { html: payload.rich_html, text: payload.text, language });
        }
      } else if (isImageAnnotation && typeof source?.text === "string") {
        appendProposalField(details, t("noteBody"), source.text, "assistant-proposal-text");
      }
      if (isChart) {
        if (payload.dataset_id) appendProposalField(details, t("chartDataset"), payload.dataset_name || payload.dataset_id);
        if (payload.kind) appendProposalField(details, t("chartKind"), t(payload.kind));
        if (payload.kind === "grouped_points") {
          appendProposalField(details, t("chartGroupColumn"), payload.x || "—");
          appendProposalField(details, t("chartOutcome"), payload.y || "—");
        } else {
          const fields = [payload.x, payload.y].filter(Boolean);
          if (fields.length) appendProposalField(details, t("chartFields"), fields.join(", "));
        }
        if (payload.bins !== null && payload.bins !== undefined) appendProposalField(details, t("chartBins"), payload.bins);
        if (payload.expected_revision !== undefined) appendProposalField(details, t("chartRevision"), payload.expected_revision);
        if (payload.data_sha256) appendProposalField(details, t("chartDataHash"), payload.data_sha256);
      }
      if (isDatasetSelection) {
        appendProposalField(details, t("selectionParent"), `${payload.source_name || payload.dataset_id || "—"}\n${payload.dataset_sha256 || "—"}`);
        appendProposalField(details, t("selectionRule"), `${payload.column || "—"} = ${JSON.stringify(payload.value ?? "")}`);
        appendProposalField(details, t("selectionName"), payload.name || t("selectionDefaultName"));
        appendProposalField(details, t("selectionCounts"), `${payload.counts?.matched ?? "—"} / ${payload.counts?.excluded ?? "—"} / ${payload.counts?.total ?? "—"}`);
        appendProposalField(details, t("selectionRecipe"), `${payload.recipe?.id || "—"} · v${payload.recipe?.version || "—"}`);
        appendProposalField(details, t("analysisRecipeHash"), payload.recipe?.sha256 || payload.recipe_sha256 || "—");
        appendProposalField(details, t("selectionSourceRowsHash"), payload.source_rows_sha256 || "—");
        appendProposalField(details, t("selectionPreviewHash"), payload.preview_sha256 || "—");
      }
      if (isCancelAnalysis) {
        appendProposalField(details, t("analysisId"), payload.analysis_id || "—");
        appendProposalField(details, t("analysisDataset"), payload.dataset_name || payload.dataset_id || "—");
        appendProposalField(details, t("analysisDatasetHash"), payload.dataset_sha256 || "—");
        appendProposalField(details, t("analysisStatus"), payload.status || payload.analysis_status || "—");
      }
      card.append(details);
      if (payload.formatting_removed === true) {
        const warning = document.createElement("p");
        warning.className = "assistant-proposal-inactive assistant-formatting-removed";
        warning.textContent = t("formattingRemoved");
        card.append(warning);
      }
      const analysisReady = isAnalysis ? appendAnalysisProposal(card, details, payload) : true;

      const changes = payload.changes && typeof payload.changes === "object" ? Object.entries(payload.changes) : [];
      if (changes.length) {
        const changeLabel = document.createElement("strong");
        changeLabel.textContent = t("metadataChanges");
        const changeList = document.createElement("dl");
        changeList.className = "assistant-proposal-details";
        for (const [field, value] of changes) {
          appendProposalField(changeList, t(`field_${field}`), value === null || value === "" ? t("cleared") : String(value));
        }
        card.append(changeLabel, changeList);
      }
      appendProposalImages(card, paper, turn, payload);

      if (isImageAnnotation && payload.source_kind && payload.source_id) {
        const view = document.createElement("button");
        view.type = "button";
        view.className = "assistant-source-button assistant-proposal-source";
        view.dataset.action = "view-image-region";
        view.textContent = t("viewImageRegion");
        view.addEventListener("click", () => adapter.openImageProposal(paper.id, proposal));
        card.append(view);
      } else if ((isAnalysis || isDatasetSelection) && payload.dataset_id) {
        appendSourceButton(card, { document_id: paper.id, kind: "dataset_sample", dataset_id: payload.dataset_id }, t(isDatasetSelection ? "selectionParent" : "analysisDataset"));
      } else if (isCancelAnalysis && payload.analysis_id) {
        appendSourceButton(card, { document_id: paper.id, kind: "analysis_result", analysis_id: payload.analysis_id }, t("analysisOpen"));
      } else if (payload.note_id) {
        appendSourceButton(card, { ...source, document_id: paper.id, note_id: payload.note_id }, t("viewTarget"));
      } else if (payload.source_ref || source) {
        appendSourceButton(card, { ...source, document_id: paper.id, page: payload.page || source?.page, rect: Object.hasOwn(payload, "rect") ? payload.rect : source?.rect }, t("viewSource"));
      } else if (payload.source?.kind) {
        appendSourceButton(card, { document_id: paper.id, source: payload.source }, t("viewSource"));
      }
      if (isCreateChart && proposal.status === "pending") {
        const previewButton = document.createElement("button");
        previewButton.type = "button";
        previewButton.className = "button button-secondary assistant-proposal-source";
        previewButton.dataset.action = "preview-chart";
        previewButton.disabled = Boolean(chartPreview?.pending) || Boolean(entry.pendingDecision);
        previewButton.textContent = t(chartPreview?.pending ? "chartPreviewing" : "chartPreview");
        previewButton.addEventListener("click", () => previewChartProposal(paper.id, entry, proposal));
        card.append(previewButton);
        if (chartPreview) {
          const previewStatus = document.createElement("p");
          previewStatus.className = chartPreview.ready ? "assistant-proposal-receipt" : "assistant-error";
          previewStatus.textContent = t(chartPreview.pending ? "chartPreviewing" : chartPreview.ready ? "chartPreviewReady" : "chartPreviewFailed");
          card.append(previewStatus);
        }
      }
      if (proposal.status === "conflict") {
        const conflict = document.createElement("p");
        conflict.className = "assistant-error";
        conflict.textContent = t("conflictHelp");
        card.append(conflict);
      }
      if (proposal.error) {
        const error = document.createElement("p");
        error.className = "assistant-error";
        error.textContent = errorText(proposal.error, "decisionFailed");
        card.append(error);
      }
      if (proposal.result) {
        const receiptLabel = document.createElement("strong");
        receiptLabel.textContent = t("receipt");
        const receipt = document.createElement("p");
        receipt.className = "assistant-proposal-receipt";
        const outcome = {
          created: "receiptCreated",
          updated: "receiptUpdated",
          patch: "receiptChanged",
          delete: "receiptDeleted",
          restore: "receiptRestored"
        }[proposal.result.outcome] || "receiptSaved";
        receipt.textContent = isAnalysis ? t("analysisQueued") : isCancelAnalysis ? t("analysisCancelled") : isDatasetSelection ? t("selectionCreated") : t(outcome);
        card.append(receiptLabel, receipt);
        if ((isAnalysis || isCancelAnalysis) && proposal.result.analysis_id) {
          const open = document.createElement("button");
          open.type = "button";
          open.className = "assistant-source-button assistant-proposal-source";
          open.dataset.action = "open-analysis";
          open.textContent = t("analysisOpen");
          open.addEventListener("click", () => adapter.openAnalysisJob?.(proposal.result.document_id || paper.id, proposal.result.analysis_id));
          card.append(open);
        } else if (isDatasetSelection && proposal.result.dataset_id) {
          appendSourceButton(card, {
            document_id: proposal.result.document_id || paper.id,
            kind: "dataset_sample",
            dataset_id: proposal.result.dataset_id
          }, t("selectionOpen"));
        } else if (isChart && (proposal.result.chart_id || payload.chart_id || proposal.result.id)) {
          appendSourceButton(card, {
            document_id: proposal.result.document_id || paper.id,
            kind: "chart_result",
            chart_id: proposal.result.chart_id || payload.chart_id || proposal.result.id
          }, t("chartOpen"));
        } else if (isImageAnnotation) {
          appendSourceButton(card, {
            document_id: proposal.result.document_id || paper.id,
            kind: "image_annotation",
            source_kind: payload.source_kind,
            source_id: payload.source_id,
            annotation_id: proposal.result.annotation_id || payload.annotation_id || null
          }, t("openSource"));
        } else {
          appendSourceButton(card, {
            document_id: proposal.result.document_id || paper.id,
            note_id: proposal.result.note_id || null,
            page: paper.kind === "study" || proposal.result.note_id ? null : 1,
            rect: null,
            ...(paper.kind === "study" && payload.source ? { source: payload.source } : {})
          }, t("openSource"));
        }
      }

      const awaitingDecision = turn.status === "waiting_confirmation" && (proposal.status === "pending" || proposal.status === "conflict");
      if (awaitingDecision) {
        const actions = document.createElement("div");
        actions.className = "assistant-proposal-actions";
        const deciding = entry.pendingDecision === `${turn.id}:${proposal.id}`;
        const choices = proposal.status === "pending"
          ? [[true, "confirm-proposal", t(isAnalysis ? "analysisConfirm" : isCancelAnalysis ? "analysisCancel" : "confirm")], [false, "reject-proposal", t("reject")]]
          : [[false, "reject-proposal", t("abandonConflict")]];
        for (const [approved, action, label] of choices) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = approved ? "button button-primary" : "button button-quiet";
          button.dataset.action = action;
          button.disabled = Boolean(entry.pendingDecision) || Boolean(approved && isAnalysis && !analysisReady) || Boolean(approved && isCreateChart && !chartPreview?.ready);
          button.textContent = deciding ? t("deciding") : label;
          button.addEventListener("click", () => decideProposal(paper.id, entry, turn.id, proposal, approved));
          actions.append(button);
        }
        card.append(actions);
      } else if (proposal.status === "pending") {
        const inactive = document.createElement("p");
        inactive.className = "assistant-proposal-inactive";
        inactive.textContent = t("proposalInactive");
        card.append(inactive);
      }
      elements.proposals.append(card);
    }
  }

  function derivedStatus(paper, entry) {
    if (!paper) return { key: "noDocument", kind: "info" };
    if (entry.status) return entry.status;
    if (!provider.loaded) return providerStatus;
    if (!provider.configured) return { key: "notConfigured", kind: "info" };
    if (adapter.getChatImages(paper.id).length && !provider.image_input) return { key: "agent_vision_disabled", kind: "error" };
    return { key: "configured", kind: "info", values: { model: provider.model || "—", vision: t(provider.image_input ? "visionOn" : "visionOff") } };
  }

  function renderStatus(paper, entry) {
    elements.status.replaceChildren();
    const status = derivedStatus(paper, entry);
    elements.status.dataset.kind = status.kind || "info";
    const text = document.createElement("span");
    text.textContent = status.kind === "error" ? errorText(status) : t(status.key, status.values || {});
    elements.status.append(text);
    if (status.retry) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "status-retry";
      retry.textContent = t("retry");
      retry.addEventListener("click", status.retry);
      elements.status.append(retry);
    }
  }

  function renderSettings() {
    elements.settingsStatus.dataset.kind = settingsStatus?.kind || "info";
    elements.settingsStatus.textContent = settingsStatus
      ? settingsStatus.kind === "error" ? errorText(settingsStatus) : t(settingsStatus.key)
      : "";
    elements.providerSave.disabled = settingsPending;
    elements.providerSave.textContent = t(settingsPending ? "savingSettings" : "saveSettings");
  }

  function render() {
    const { paper, entry } = current();
    renderContext();
    renderHistory(entry);
    renderMessages(entry);
    const turn = latestTurn(entry || { turns: [] });
    renderSources(turn);
    if (paper && entry) renderProposals(paper, entry, turn);
    else elements.proposals.replaceChildren();
    tasks.render();
    renderStatus(paper, entry);
    if (entry && elements.message.value !== entry.draft) elements.message.value = entry.draft;
    elements.message.disabled = !paper || Boolean(entry?.pendingSend?.pending);
    const active = entry ? activeTurn(entry) : null;
    const sending = Boolean(entry?.pendingSend?.pending);
    const taskBusy = Boolean(paper && entry && tasks.isBusy(paper.id, entry.conversationId));
    elements.send.disabled = !paper || sending || Boolean(active) || taskBusy || Boolean(entry?.pendingDecision) || (!entry?.draft.trim() && !adapter.getChatImages(paper?.id).length && !entry?.pendingSend);
    elements.send.textContent = t(entry?.pendingSend ? "retry" : "send");
    elements.cancel.hidden = !active;
    elements.cancel.disabled = !active || Boolean(entry?.cancelling);
    elements.cancel.textContent = t(entry?.cancelling ? "stopping" : "cancel");
    elements.new.disabled = !paper || sending || Boolean(entry?.pendingDecision);
    renderSettings();
  }

  function stopPolling(entry) {
    entry.pollToken += 1;
    if (entry.pollTimer) clearTimeout(entry.pollTimer);
    entry.pollTimer = null;
    entry.pollController?.abort();
    entry.pollController = null;
  }

  function startPolling(paperId, entry, turnId) {
    stopPolling(entry);
    const token = entry.pollToken;
    const poll = async () => {
      if (token !== entry.pollToken) return;
      const controller = new AbortController();
      entry.pollController = controller;
      try {
        const turn = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/turns/${encodeURIComponent(turnId)}`, { signal: controller.signal });
        if (token !== entry.pollToken) return;
        upsertTurn(entry, turn);
        entry.status = null;
        if (isCurrent(paperId, entry)) render();
        if (TERMINAL_STATES.has(turn.status)) {
          stopPolling(entry);
          loadConversations(paperId, entry, false);
          return;
        }
        entry.pollTimer = setTimeout(poll, 750);
      } catch (error) {
        if (error?.name === "AbortError" || token !== entry.pollToken) return;
        entry.status = {
          key: error.code || "network",
          kind: "error",
          retry: () => startPolling(paperId, entry, turnId)
        };
        if (isCurrent(paperId, entry)) render();
      } finally {
        if (entry.pollController === controller) entry.pollController = null;
      }
    };
    poll();
  }

  async function loadConversation(paperId, entry, conversationId, options = {}) {
    stopPolling(entry);
    const sequence = ++entry.loadSequence;
    entry.loadController?.abort();
    const controller = new AbortController();
    entry.loadController = controller;
    entry.loading = true;
    entry.status = null;
    if (isCurrent(paperId, entry)) render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/conversations/${encodeURIComponent(conversationId)}`, { signal: controller.signal });
      if (sequence !== entry.loadSequence) return;
      entry.turns = Array.isArray(body.turns) ? body.turns : [];
      entry.loaded = true;
      entry.conversationId = conversationId;
      entry.fresh = false;
      if (!options.taskRefresh) tasks.conversationChanged(paperId, conversationId);
      const active = activeTurn(entry);
      if (active) startPolling(paperId, entry, active.id);
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== entry.loadSequence) return;
      entry.status = { key: error.code || "loadFailed", kind: "error", retry: () => loadConversation(paperId, entry, conversationId) };
    } finally {
      if (sequence === entry.loadSequence) {
        entry.loading = false;
        entry.loadController = null;
        if (isCurrent(paperId, entry)) render();
      }
    }
  }

  async function loadConversations(paperId, entry, openLatest = true) {
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/conversations`);
      entry.conversations = Array.isArray(body.items) ? body.items : [];
      if (openLatest && !entry.conversationId && !entry.fresh && !entry.pendingSend && entry.conversations.length) {
        await loadConversation(paperId, entry, entry.conversations[0].id);
      }
    } catch (error) {
      entry.status = { key: error.code || "loadFailed", kind: "error", retry: () => loadConversations(paperId, entry, true) };
    }
    if (isCurrent(paperId, entry)) render();
  }

  async function send(paperId, entry) {
    if (entry.pendingSend?.pending || activeTurn(entry)) return;
    if (!entry.pendingSend && tasks.isBusy(paperId, entry.conversationId)) {
      entry.status = { key: "agent_task_busy", kind: "error" };
      render();
      return;
    }
    if (!entry.pendingSend) {
      const context = adapter.getContext();
      const imageIds = adapter.getChatImages(paperId).map((image) => image.id);
      const message = entry.draft;
      if (!message.trim() && !imageIds.length) return;
      if (!provider.configured) {
        entry.status = { key: "agent_not_configured", kind: "error" };
        render();
        return;
      }
      if (imageIds.length && !provider.image_input) {
        entry.status = { key: "agent_vision_disabled", kind: "error" };
        render();
        return;
      }
      entry.pendingSend = {
        pending: false,
        payload: {
          request_id: crypto.randomUUID(),
          conversation_id: entry.conversationId || null,
          message,
          context: {
            page: context.page,
            rect: context.rect ? [...context.rect] : null,
            active_note_id: context.activeNoteId || null,
            active_image: context.activeImage ? {
              source_kind: context.activeImage.source_kind,
              source_id: context.activeImage.source_id,
              ...(context.activeImage.annotation_id ? { annotation_id: context.activeImage.annotation_id } : {})
            } : null,
            image_ids: imageIds,
            dataset_id: adapter.getSharedDatasetId?.() || null,
            active_analysis_id: context.activeAnalysisId || null,
            active_chart_id: context.activeChartId || null,
            language
          }
        }
      };
      if (tasks.continueTaskRequested(paperId)) entry.pendingSend.payload.continue_task = true;
    }
    const operation = entry.pendingSend;
    operation.pending = true;
    entry.status = { key: "sending", kind: "info" };
    render();
    try {
      const turn = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.payload)
      });
      if (entry.pendingSend === operation) entry.pendingSend = null;
      if (entry.draft === operation.payload.message) entry.draft = "";
      upsertTurn(entry, turn);
      tasks.acceptTurn(paperId, turn.conversation_id, turn);
      entry.status = null;
      if (isCurrent(paperId, entry)) render();
      loadConversations(paperId, entry, false);
      if (ACTIVE_STATES.has(turn.status)) startPolling(paperId, entry, turn.id);
    } catch (error) {
      operation.pending = false;
      entry.status = { key: error.code || "network", kind: "error" };
      if (isCurrent(paperId, entry)) render();
    }
  }

  async function cancelTurn(paperId, entry) {
    const turn = activeTurn(entry);
    if (!turn || entry.cancelling) return;
    entry.cancelling = turn.id;
    entry.status = { key: "stopping", kind: "info" };
    render();
    try {
      const updated = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/turns/${encodeURIComponent(turn.id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      upsertTurn(entry, updated);
      entry.status = null;
      if (TERMINAL_STATES.has(updated.status)) stopPolling(entry);
    } catch (error) {
      entry.status = { key: error.code || "cancelFailed", kind: "error", retry: () => cancelTurn(paperId, entry) };
    } finally {
      entry.cancelling = null;
      if (isCurrent(paperId, entry)) render();
    }
  }

  async function previewChartProposal(paperId, entry, proposal) {
    const key = proposal.sha256 || proposal.id;
    const state = entry.chartPreviews.get(key);
    if (state?.pending || !adapter.previewChartProposal) return;
    entry.chartPreviews.set(key, { pending: true, ready: false });
    if (isCurrent(paperId, entry)) render();
    try {
      const ready = await adapter.previewChartProposal(paperId, proposal);
      entry.chartPreviews.set(key, { pending: false, ready: Boolean(ready) });
    } catch {
      entry.chartPreviews.set(key, { pending: false, ready: false });
    }
    if (isCurrent(paperId, entry)) render();
  }

  async function acceptDatasetSelectionResult(paperId, entry, proposal, result) {
    if (!result?.dataset_id) return;
    try {
      const url = result.url || `/api/v1/documents/${encodeURIComponent(paperId)}/datasets/${encodeURIComponent(result.dataset_id)}`;
      const dataset = await adapter.api(url);
      const select = adapter.getDocument()?.id === paperId && adapter.getSelectedDatasetId?.() === proposal.payload?.dataset_id;
      adapter.acceptDatasetSelection?.(paperId, dataset, { select });
      entry.status = { key: "selectionCreated", kind: "success" };
    } catch (error) {
      entry.status = {
        key: "selectionChildLoadFailed",
        kind: "error",
        retry: () => acceptDatasetSelectionResult(paperId, entry, proposal, result)
      };
    }
    if (isCurrent(paperId, entry)) render();
  }

  async function decideProposal(paperId, entry, turnId, proposal, approved) {
    const turn = entry.turns.find((item) => item.id === turnId);
    const allowed = turn?.status === "waiting_confirmation" && (proposal.status === "pending" || proposal.status === "conflict" && !approved);
    const chartPreview = entry.chartPreviews.get(proposal.sha256 || proposal.id);
    if (entry.pendingDecision || !allowed || approved && proposal.kind === "create_chart" && !chartPreview?.ready) return;
    const key = `${turnId}:${proposal.id}`;
    entry.pendingDecision = key;
    entry.status = { key: "deciding", kind: "info" };
    render();
    try {
      const updated = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/turns/${encodeURIComponent(turnId)}/proposals/${encodeURIComponent(proposal.id)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, proposal_sha256: proposal.sha256 })
      });
      upsertTurn(entry, updated);
      entry.status = { key: approved ? ["run_analysis", "run_t_test"].includes(proposal.kind) ? "analysisQueued" : proposal.kind === "cancel_analysis" ? "analysisCancelled" : proposal.kind === "create_dataset_selection" ? "selectionCreated" : "confirmed" : "rejectedDone", kind: "success" };
      if (approved) {
        await adapter.refreshAfterAgent(paperId, proposal.kind);
        const result = updated.proposals?.find((item) => item.id === proposal.id)?.result;
        const analysisId = result?.analysis_id;
        if (["run_analysis", "run_t_test", "cancel_analysis"].includes(proposal.kind) && analysisId && adapter.getDocument()?.id === paperId) await adapter.openAnalysisJob?.(paperId, analysisId);
        const chartId = result?.chart_id || proposal.payload?.chart_id || result?.id;
        if (["create_chart", "restore_chart"].includes(proposal.kind) && chartId && adapter.getDocument()?.id === paperId) await adapter.openChart?.(paperId, chartId);
        if (proposal.kind === "create_dataset_selection") await acceptDatasetSelectionResult(paperId, entry, proposal, result);
      }
    } catch (error) {
      let retry = () => decideProposal(paperId, entry, turnId, proposal, approved);
      if (approved && ["revision_conflict", "source_changed", "note_deleted", "dataset_changed", "recipe_changed", "preview_changed", "selection_preview_changed", "selection_source_changed", "engine_unavailable", "analysis_busy", "analysis_quota"].includes(error.code)) {
        try {
          const updated = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/turns/${encodeURIComponent(turnId)}`);
          upsertTurn(entry, updated);
          retry = null;
        } catch {
          // Keep the exact-decision retry when the conflict state cannot be loaded.
        }
      }
      entry.status = { key: error.code || "decisionFailed", kind: "error", retry };
    } finally {
      entry.pendingDecision = null;
      if (isCurrent(paperId, entry)) render();
    }
  }

  async function loadProvider() {
    providerStatus = { key: "loading", kind: "info" };
    try {
      provider = { ...(await adapter.api("/api/v1/agent/status")), loaded: true };
      providerStatus = null;
      if (!elements.providerModel.value) elements.providerModel.value = provider.model || "";
      elements.providerImages.checked = Boolean(provider.image_input);
    } catch (error) {
      provider = { loaded: false, configured: false, model: "", image_input: false };
      providerStatus = { key: error.code || "statusFailed", kind: "error", retry: loadProvider };
    }
    render();
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (settingsPending) return;
    const baseUrl = elements.providerUrl.value.trim();
    const model = elements.providerModel.value.trim();
    let valid = Boolean(model);
    try {
      const parsed = new URL(baseUrl);
      valid = valid && parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch {
      valid = false;
    }
    if (!valid) {
      settingsStatus = { key: "settingsInvalid", kind: "error" };
      renderSettings();
      return;
    }
    settingsPending = true;
    settingsStatus = { key: "savingSettings", kind: "info" };
    renderSettings();
    try {
      provider = {
        ...(await adapter.api("/api/v1/agent/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_url: baseUrl,
            model,
            api_key: elements.providerKey.value,
            supports_images: elements.providerImages.checked
          })
        })),
        loaded: true
      };
      elements.providerKey.value = "";
      providerStatus = null;
      settingsStatus = { key: "settingsSaved", kind: "success" };
      const { entry } = current();
      if (entry) entry.status = null;
    } catch (error) {
      settingsStatus = { key: error.code || "request_failed", kind: "error" };
    } finally {
      settingsPending = false;
      render();
    }
  }

  elements.toggle.addEventListener("click", () => {
    const open = elements.panel.hidden;
    elements.panel.hidden = !open;
    elements.toggle.setAttribute("aria-expanded", String(open));
    if (open) elements.message.focus();
  });
  elements.close.addEventListener("click", () => {
    elements.panel.hidden = true;
    elements.toggle.setAttribute("aria-expanded", "false");
    elements.toggle.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.panel.hidden) {
      elements.panel.hidden = true;
      elements.toggle.setAttribute("aria-expanded", "false");
      elements.toggle.focus();
    }
  });
  elements.new.addEventListener("click", () => {
    const { paper, entry } = current();
    if (!paper) return;
    stopPolling(entry);
    entry.loadSequence += 1;
    entry.loadController?.abort();
    entry.conversationId = null;
    entry.turns = [];
    entry.fresh = true;
    entry.pendingSend = null;
    entry.status = null;
    tasks.conversationChanged(paper.id, null);
    render();
    elements.message.focus();
  });
  elements.history.addEventListener("change", () => {
    const { paper, entry } = current();
    if (!paper || !elements.history.value) return;
    entry.conversationId = elements.history.value;
    entry.turns = [];
    entry.pendingSend = null;
    tasks.conversationChanged(paper.id, entry.conversationId);
    loadConversation(paper.id, entry, entry.conversationId);
  });
  elements.message.addEventListener("input", () => {
    const { entry } = current();
    if (!entry) return;
    entry.draft = elements.message.value;
    if (entry.pendingSend && !entry.pendingSend.pending) entry.pendingSend = null;
    entry.status = null;
    render();
  });
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { paper, entry } = current();
    if (paper) send(paper.id, entry);
  });
  elements.cancel.addEventListener("click", () => {
    const { paper, entry } = current();
    if (paper) cancelTurn(paper.id, entry);
  });
  elements.settingsForm.addEventListener("submit", saveSettings);

  loadProvider();

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.toggle.textContent = t("assistant");
      elements.heading.textContent = t("assistant");
      elements.close.setAttribute("aria-label", t("close"));
      elements.new.textContent = t("new");
      elements.message.setAttribute("aria-label", t("messageLabel"));
      elements.message.placeholder = t("placeholder");
      elements.settingsToggle.textContent = t("settings");
      elements.settingsHelp.textContent = t("settingsHelp");
      elements.settingsForm.querySelector('label[for="assistant-provider-url"]').textContent = t("providerUrl");
      elements.settingsForm.querySelector('label[for="assistant-provider-model"]').textContent = t("providerModel");
      elements.settingsForm.querySelector('label[for="assistant-provider-key"]').textContent = t("providerKey");
      elements.settingsForm.querySelector(".assistant-vision-option span").textContent = t("providerImages");
      tasks.applyLanguage(nextLanguage);
      render();
    },
    documentChanged() {
      const { paper, entry } = current();
      if (paper && !entry.loaded && !entry.loading && !entry.conversations.length) loadConversations(paper.id, entry, true);
      tasks.documentChanged();
      render();
    },
    contextChanged() {
      tasks.contextChanged();
      render();
    },
    refreshConversations(documentId) {
      const entry = entryFor(documentId);
      return loadConversations(documentId, entry, false);
    },
    render
  };
}
