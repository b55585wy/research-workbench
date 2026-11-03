import { renderRichHtml } from "/rich-text.js";
import { createTaskClient } from "/task-client.js";
import { createAssistantWindow } from "/assistant-window.js";
import { isPdfPageSource, onlineDatasetSourceUrl, pdfPageApplicationUrl, renderAssistantAnswer } from "/assistant-answer.js";
import { createReferencePicker, normalizeResourceReference, resourceReferenceKey, resourceReferencesFromTurn, resourceReferenceWire } from "/assistant-references.js";
import { createSourcePreparationBridge } from "/source-preparation-bridge.js";

const ACTIVE_STATES = new Set(["queued", "running"]);
const TERMINAL_STATES = new Set(["waiting_confirmation", "completed", "failed", "cancelled", "interrupted"]);

const messages = {
  zh: {
    assistant: "研究助手",
    close: "关闭研究助手",
    window: "移动助手窗口",
    fullPage: "全屏",
    exitFullPage: "退出全屏",
    resize: "调整助手窗口大小",
    resizeLeft: "从左侧调整助手窗口宽度",
    resizeRight: "从右侧调整助手窗口宽度",
    moveHelp: "拖动标题栏移动；聚焦后使用方向键移动。",
    resizeHelp: "拖动或使用方向键调整窗口大小；按住 Shift 加速。",
    resizeEdgeHelp: "拖动或使用左右方向键调整宽度；按住 Shift 加速，另一侧边缘保持不动。",
    windowHelp: "拖动标题栏空白区域移动窗口。聚焦标题栏后使用方向键移动，按住 Shift 加速。左右边缘手柄用于调整宽度，右下角手柄用于调整宽度和高度；也可聚焦手柄使用方向键。全屏或窄屏时不能手动移动或调整大小。",
    history: "对话记录",
    new: "新对话",
    emptyHistory: "暂无对话",
    messageLabel: "给研究助手的消息",
    placeholder: "询问当前页面或已选图片…",
    analysisPlanPrompt: "请检查当前已共享的数据和研究设计，并提出合适的分析方案。只提供建议，不要自动运行分析。",
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
    contextStudy: "项目：{title}",
    contextPersonal: "我的数据",
    studySource: "研究笔记来源",
    sourceHash: "来源 SHA-256",
    contextPage: "第 {page} 页",
    contextRegion: "选定区域",
    contextWhole: "整页上下文",
    readerActions: "已加入的原文操作",
    readerActionAsk: "原文提问",
    readerActionTranslate: "原文翻译",
    readerActionImage: "PDF 区域截图",
    readerActionOpen: "打开固定来源",
    readerActionRemove: "移除这条原文贡献",
    readerActionRemoved: "已移除所选原文贡献，其他草稿内容保持不变。",
    readerActionRemovedEdited: "已移除所选原文来源；其中已编辑的文字仍保留在草稿中。",
    readerActionPage: "第 {page} 页 · 选定区域",
    readerAskPrompt: "请解释并回答以下原文涉及的问题：\n“{quote}”\n{source}",
    readerTranslatePrompt: "请翻译以下原文，并在译文后保留来源：\n“{quote}”\n{source}",
    readerImagePrompt: "请查看本次明确选择的 PDF 区域截图并解释其内容。截图是用户框选的画面像素，不是已提取的原始嵌入图片。\n{source}",
    readerImageDescription: "图形批注说明：{description}",
    contextNote: "当前笔记",
    contextImages: "已选 {count} 张图片",
    contextImagePixels: "图片：{name} · 提供预览像素",
    contextImageMetadata: "图片：{name} · 仅提供来源和批注文字，不提供像素",
    clearImageContext: "清除图片上下文",
    contextDataset: "数据：{title} · 已共享预览",
    contextDatasetNotShared: "数据：{title} · 未共享",
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
    analysisQueued: "已提交分析任务，请在任务记录中查看运行状态。",
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
    analysisPaired: "配对 t 检验（r-stats）",
    analysisPairedUnit: "唯一配对单位 ID 列",
    analysisPairedFirst: "第 1 个数值列",
    analysisPairedSecond: "第 2 个数值列",
    analysisPairedDirection: "配对差值方向",
    analysisPairedDeclaration: "配对设计声明",
    analysisPairedConfirmed: "已确认按唯一、非空单位 ID 精确配对，并已核对配对设计。",
    analysisCompletePairs: "仅使用两个数值和配对单位 ID 均完整的配对",
    analysisPairedTotal: "总配对数",
    analysisPairedUsed: "完整配对数",
    analysisPairedExcluded: "排除配对数",
    analysisPairedMissingFirst: "仅第 1 列缺失",
    analysisPairedMissingSecond: "仅第 2 列缺失",
    analysisPairedMissingBoth: "两列均缺失",
    analysisPairedStats: "完整配对摘要",
    analysisPairedDifferenceStats: "配对差值摘要（第 1 列 − 第 2 列）",
    analysisPairedStatsBasis: "仅完整配对；n 为完整配对数，missing 为排除配对数。",
    analysisCompletePairN: "完整配对",
    analysisExcludedPairN: "排除配对",
    analysisPairedIdentity: "配对标识：精确、唯一、非空",
    paired_alternative_two_sided: "双侧（第 1 列与第 2 列的差值不为零）",
    paired_alternative_greater: "第 1 列减去第 2 列大于零",
    paired_alternative_less: "第 1 列减去第 2 列小于零",
    analysisCorrelation: "相关分析（r-stats）",
    analysisCorrelationFirst: "第 1 个数值列（X）",
    analysisCorrelationSecond: "第 2 个数值列（Y）",
    analysisCorrelationKind: "相关系数",
    analysisCorrelationDeclaration: "同一观察对象与独立性声明",
    analysisCorrelationConfirmed: "已明确确认每行 X/Y 属于同一观察对象，且各观测行相互独立；未根据列名推断。",
    analysisCorrelationCompletePairs: "仅使用 X 和 Y 均完整的配对行",
    analysisCorrelationPairs: "配对核对",
    analysisCorrelationMatching: "同一观察对象逐行配对",
    analysisCorrelationTiesFirst: "X 重复值数（不含首次）",
    analysisCorrelationTiesSecond: "Y 重复值数（不含首次）",
    analysisCorrelationStats: "完整配对变量摘要",
    analysisCorrelationSpearman: "Spearman 使用 exact = FALSE、continuity = FALSE；p 值为渐近近似值，不提供置信区间。",
    correlation_pearson: "Pearson（线性相关）",
    correlation_spearman: "Spearman（秩相关）",
    correlation_alternative_two_sided: "双侧（相关系数不为零）",
    correlation_alternative_greater: "正相关（相关系数大于零）",
    correlation_alternative_less: "负相关（相关系数小于零）",
    noDocument: "选择一篇文献后可向助手提问。",
    emptyChat: "发送一条消息开始。助手会保留来源、工具进度和待确认操作。",
    you: "你",
    assistantAnswer: "助手",
    tools: "工具记录",
    sources: "来源",
    sourceExcerpt: "查看原文文字",
    otherSources: "其他来源（未在回答中引用，{count}）",
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
    copyTable: "复制表格",
    downloadCsv: "下载 CSV",
    tableCopied: "表格已复制。",
    copyFailed: "复制失败。回答内容未更改，请重试。",
    downloadFailed: "下载失败，请重试。",
    tableScroll: "表格，可水平滚动",
    markdownUnavailable: "富文本组件不可用；以下保留原始 Markdown 文本。",
    mathUnavailable: "公式组件不可用；公式按原始文本显示。",
    tableTooLarge: "表格超过 {columns} 列或 {rows} 行上限，已保留原文且禁用导出。",
    tableMalformed: "表格行列不完整，已保留原文且禁用导出。",
    contextComputationGrants: "计算权限：{count} 项数据",
    citationNewTab: "在新标签页打开 {ref} 来源：{label}",
    citationOpen: "打开 {ref} 来源：{label}",
    citationUnverified: "未核实的来源引用",
    provenance: "引用来源",
    sourceUrl: "来源 URL",
    not_found: "找不到请求的内容。",
    agent_invalid_state: "当前任务状态不能处理此提案。",
    agent_proposal_changed: "提案内容已变化，请重新查看。",
    agent_decision_conflict: "此提案已经处理，不能更改先前决定。",
    agent_cancelled: "此次助手任务已结束，未提交新的提案。",
    agent_image_not_selected: "只能使用本次明确选择的图片。",
    agent_scope: "此提案不属于当前文献，未执行写入。",
    agent_tool_unavailable: "这项操作当前不可用。",
    agent_answer_incomplete: "回答未完整生成；当前范围和原文摘录已保留。",
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
    agent_image_limit: "每次最多向助手提供 4 张图片。请明确移除多余图片后再发送。",
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
    noteReferences: "已加入的笔记来源",
    noteReferencePrompt: "请结合已加入的笔记来源回答问题，并引用相应出处。",
    noteReferenceAdded: "笔记来源已加入，尚未发送。",
    noteReferenceRemoved: "已移除笔记来源。",
    noteReferenceLimit: "最多加入 8 条不同的笔记来源。请先移除一条，或重新加入已有来源以更新它。",
    noteReferenceInvalid: "只有当前文献中已保存且未删除的笔记才能加入助手。",
    noteReferenceOpen: "打开笔记来源",
    noteReferenceRemove: "移除这条笔记来源",
    noteReferencePage: "第 {page} 页",
    noteReferenceStyle: "{kind} · {color}",
    highlight: "高亮",
    underline: "下划线",
    yellow: "黄色",
    green: "绿色",
    blue: "蓝色",
    pink: "粉色",
    note_reference_changed: "笔记在加入后已修改。原请求和来源仍保留；请移除后重新加入最新版本，或按原请求重试。",
    note_reference_limit: "笔记来源数量超出限制。请移除多余来源后重新发送。",
    note_purged: "一条笔记来源已彻底删除。请移除它或重新加入其他已保存笔记。",
    noteReferenceUnavailable: "一条笔记来源不存在、已删除或不属于当前文献。请移除后重新加入。",
    resourceReferences: "已加入的跨项目资料",
    resourceReferenceHelp: "固定的资料会在发送时提供给助手；论文按页读取，数据默认仅提供字段和少量样本行，描述统计权限需单独明确开启。",
    contextResourceReferences: "外部资料：{count} 项 · 发送时提供",
    addReferences: "添加资料",
    referencePickerTitle: "添加资料到当前对话",
    closeReferences: "关闭资料选择",
    referenceSearch: "搜索资料",
    referenceSearchPlaceholder: "搜索标题、作者、DOI 或所属项目",
    referenceSearchSubmit: "搜索",
    referencePapers: "论文",
    referenceDatasets: "数据",
    referencePickerScope: "仅在明确添加后共享。论文按页读取；数据默认仅提供字段和最多 5 行样本，描述统计权限需在固定后单独开启。",
    referenceResults: "资料搜索结果",
    referencePrevious: "上一页",
    referenceNext: "下一页",
    referenceCatalogLoading: "正在加载资料目录…",
    referenceCatalogEmpty: "没有匹配的资料。可更换搜索词或资料类型。",
    referenceCatalogFailed: "无法加载资料目录，请重试。尚未添加或共享任何资料。",
    referencePaper: "论文",
    referenceDataset: "数据",
    referenceUntitled: "未命名资料",
    referenceOwnerUnknown: "所属项目未知",
    referencePages: "{count} 页",
    referenceAdd: "添加",
    referenceAdded: "已添加",
    referenceAddedNotice: "资料已固定到当前对话，尚未发送。",
    referenceDuplicate: "这项资料已在当前对话中。",
    resourceReferenceRemove: "移除这项资料",
    resourceReferenceRemoved: "已移除资料；之后的请求不会再提供它。",
    resourceReferenceLimit: "每次最多固定 8 项不同资料。请先移除一项。",
    resourceReferenceBusy: "当前请求或任务未结束，暂时不能修改资料。",
    referenceAnalysisGrant: "允许 Python/R 描述统计（全表计算，执行前确认）",
    referenceAnalysisGrantUpdated: "描述统计权限已更新，尚未发送。",
    referenceAnalysisDecisionPending: "有待确认或发生冲突的跨数据描述统计提案。请先确认、拒绝或放弃该提案，再添加、移除资料或修改权限。",
    referenceAnalysisTarget: "原数据位置",
    referenceAnalysisScope: "固定 describe 方法：使用 Python/R 对原数据全表进行本地描述统计。结果保存在原数据位置；确认后仅排队，不会自动打开或切换对话。",
    analysisDescribe: "描述统计（全表本地计算）",
    reference_analysis_not_allowed: "该数据未明确允许描述统计。请先勾选对应数据的权限，再重新提出操作。",
    reference_analysis_source_changed: "原数据位置或来源已变化，未执行或读取分析。",
    reference_analysis_dataset_changed: "原数据已变化，未执行或读取分析。",
    reference_analysis_dataset_mismatch: "提案或结果与原数据不匹配，未执行或读取分析。",
    reference_analysis_not_ready: "分析尚未成功完成，当前没有可读取的结果。",
    reference_analysis_result_not_ready: "分析结果尚未成功完成，请稍后在下一对话轮次中查询。",
    reference_analysis_unsupported_method: "仅支持固定 describe 描述统计，未执行其他方法。",
    reference_analysis_method_unsupported: "仅支持固定 describe 描述统计，未执行其他方法。",
    dataset_changed: "数据已变化，未执行或读取分析。",
    analysis_not_ready: "分析尚未成功完成，当前没有可读取的结果。",
    unsupported_method: "仅支持固定 describe 描述统计，未执行其他方法。",
    referenceContinueTask: "跨项目资料不支持连续任务。请关闭“连续完成分析、图表和笔记”后再发送。",
    agent_reference_task_unsupported: "跨项目资料不支持连续任务。请关闭连续任务后重新发送。",
    resourceReferenceChanged: "固定资料在添加后已变化。可按原请求重试；若要更新资料，请先编辑草稿以取消原重试，再移除并重新添加最新版本。",
    resourceReferenceUnavailable: "固定资料不存在、已删除或不再可用。可按原请求重试；或先编辑草稿以取消原重试，再移除这项资料。",
    resourceReferenceRejected: "资料未通过来源校验。原请求保持不变；可按原请求重试，或编辑草稿取消重试后调整资料。",
    untitled: "未命名文献"
  },
  en: {
    assistant: "Research assistant",
    close: "Close research assistant",
    window: "Move assistant window",
    fullPage: "Full screen",
    exitFullPage: "Exit full screen",
    resize: "Resize assistant window",
    resizeLeft: "Resize assistant width from the left",
    resizeRight: "Resize assistant width from the right",
    moveHelp: "Drag the header to move; focus it and use the arrow keys.",
    resizeHelp: "Drag or use the arrow keys to resize; hold Shift for larger steps.",
    resizeEdgeHelp: "Drag or use Left/Right Arrow to resize width; hold Shift for larger steps. The opposite edge stays fixed.",
    windowHelp: "Drag a free area of the header to move the window. Focus the header and use the arrow keys to move; hold Shift for larger steps. Drag the left or right edge to adjust width, or the bottom-right corner to adjust width and height. Focus a handle to use arrow keys. Manual moving and resizing are unavailable in full-screen or narrow-screen mode.",
    history: "Conversations",
    new: "New conversation",
    emptyHistory: "No conversations",
    messageLabel: "Message for the research assistant",
    placeholder: "Ask about the current page or selected images…",
    analysisPlanPrompt: "Inspect the currently shared data and research design, then propose an appropriate analysis. Provide recommendations only; do not run an analysis automatically.",
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
    contextStudy: "Project: {title}",
    contextPersonal: "My data",
    studySource: "Study note source",
    sourceHash: "Source SHA-256",
    contextPage: "Page {page}",
    contextRegion: "Selected region",
    contextWhole: "Whole-page context",
    readerActions: "Prepared reader actions",
    readerActionAsk: "Question about source text",
    readerActionTranslate: "Translate source text",
    readerActionImage: "PDF region capture",
    readerActionOpen: "Open frozen source",
    readerActionRemove: "Remove this source contribution",
    readerActionRemoved: "The selected source contribution was removed. Other draft content was preserved.",
    readerActionRemovedEdited: "The frozen source was removed. Its edited text remains in your draft.",
    readerActionPage: "Page {page} · selected region",
    readerAskPrompt: "Explain the following source text and answer the question it raises:\n“{quote}”\n{source}",
    readerTranslatePrompt: "Translate the following source text and retain its source after the translation:\n“{quote}”\n{source}",
    readerImagePrompt: "Inspect the explicitly selected PDF region capture and explain its contents. It contains user-selected canvas pixels, not a proven original embedded PDF image.\n{source}",
    readerImageDescription: "Shape annotation description: {description}",
    contextNote: "Active note",
    contextImages: "{count} images selected",
    contextImagePixels: "Image: {name} · preview pixels provided",
    contextImageMetadata: "Image: {name} · source and annotation text only; no pixels",
    clearImageContext: "Clear image context",
    contextDataset: "Data: {title} · preview shared",
    contextDatasetNotShared: "Data: {title} · not shared",
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
    analysisQueued: "Analysis submitted. Check its status in the task list.",
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
    analysisPaired: "Paired t-test (r-stats)",
    analysisPairedUnit: "Unique pairing unit ID column",
    analysisPairedFirst: "First numeric column",
    analysisPairedSecond: "Second numeric column",
    analysisPairedDirection: "Paired difference direction",
    analysisPairedDeclaration: "Paired-design declaration",
    analysisPairedConfirmed: "Exact pairing by unique, nonempty unit IDs and the paired design are confirmed.",
    analysisCompletePairs: "Only pairs with both numeric values and the pairing unit ID present are used",
    analysisPairedTotal: "Total pairs",
    analysisPairedUsed: "Complete pairs",
    analysisPairedExcluded: "Excluded pairs",
    analysisPairedMissingFirst: "First column only missing",
    analysisPairedMissingSecond: "Second column only missing",
    analysisPairedMissingBoth: "Both columns missing",
    analysisPairedStats: "Complete-pair summaries",
    analysisPairedDifferenceStats: "Paired-difference summary (first − second)",
    analysisPairedStatsBasis: "Complete pairs only; n is used pairs and missing is excluded pairs.",
    analysisCompletePairN: "Complete pairs",
    analysisExcludedPairN: "Excluded pairs",
    analysisPairedIdentity: "Pairing identity: exact, unique, nonempty",
    paired_alternative_two_sided: "Two-sided (first minus second is nonzero)",
    paired_alternative_greater: "First minus second is greater than zero",
    paired_alternative_less: "First minus second is less than zero",
    analysisCorrelation: "Correlation analysis (r-stats)",
    analysisCorrelationFirst: "First numeric column (X)",
    analysisCorrelationSecond: "Second numeric column (Y)",
    analysisCorrelationKind: "Correlation coefficient",
    analysisCorrelationDeclaration: "Same observational unit and independence declaration",
    analysisCorrelationConfirmed: "Explicitly confirmed: each row’s X/Y values belong to the same observational unit and observational rows are independent; this was not inferred from column labels.",
    analysisCorrelationCompletePairs: "Only rows with both X and Y present are used",
    analysisCorrelationPairs: "Pairing review",
    analysisCorrelationMatching: "Same-observational-unit row pairing",
    analysisCorrelationTiesFirst: "X duplicate values (excluding first)",
    analysisCorrelationTiesSecond: "Y duplicate values (excluding first)",
    analysisCorrelationStats: "Complete-pair variable summaries",
    analysisCorrelationSpearman: "Spearman uses exact = FALSE and continuity = FALSE; the p value is an asymptotic approximation and no confidence interval is provided.",
    correlation_pearson: "Pearson (linear correlation)",
    correlation_spearman: "Spearman (rank correlation)",
    correlation_alternative_two_sided: "Two-sided (nonzero correlation)",
    correlation_alternative_greater: "Positive correlation (coefficient greater than zero)",
    correlation_alternative_less: "Negative correlation (coefficient less than zero)",
    noDocument: "Choose a paper before asking the assistant.",
    emptyChat: "Send a message to start. Sources, tool progress, and pending actions are retained.",
    you: "You",
    assistantAnswer: "Assistant",
    tools: "Tool history",
    sources: "Sources",
    sourceExcerpt: "View original page text",
    otherSources: "Other sources (not cited in the answer, {count})",
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
    copyTable: "Copy table",
    downloadCsv: "Download CSV",
    tableCopied: "Table copied.",
    copyFailed: "Copy failed. The answer is unchanged; try again.",
    downloadFailed: "Download failed. Try again.",
    tableScroll: "Table; scroll horizontally",
    markdownUnavailable: "Rich-text components are unavailable; the original Markdown is preserved below.",
    mathUnavailable: "Math components are unavailable; formulas are shown as source text.",
    tableTooLarge: "The table exceeds the {columns}-column or {rows}-row limit. Its source is preserved and export is disabled.",
    tableMalformed: "The table has inconsistent rows or columns. Its source is preserved and export is disabled.",
    contextComputationGrants: "Computation grants: {count} datasets",
    citationNewTab: "Open {ref} source in a new tab: {label}",
    citationOpen: "Open {ref} source: {label}",
    citationUnverified: "Unverified source citation",
    provenance: "Cited sources",
    sourceUrl: "Source URL",
    not_found: "The requested content could not be found.",
    agent_invalid_state: "The current task state cannot process this proposal.",
    agent_proposal_changed: "The proposal changed. Review it again.",
    agent_decision_conflict: "This proposal was already decided; the earlier decision cannot be changed.",
    agent_cancelled: "This assistant task ended without submitting a new proposal.",
    agent_image_not_selected: "Only images explicitly selected for this request can be used.",
    agent_scope: "This proposal does not belong to the current paper; no write occurred.",
    agent_tool_unavailable: "This action is currently unavailable.",
    agent_answer_incomplete: "No complete answer was generated. The current scope and source excerpts are retained.",
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
    agent_image_limit: "Provide at most 4 images per request. Explicitly remove extra images before sending.",
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
    noteReferences: "Pinned note sources",
    noteReferencePrompt: "Answer using the pinned note sources and cite the relevant sources.",
    noteReferenceAdded: "Note source pinned. Nothing has been sent.",
    noteReferenceRemoved: "Note source removed.",
    noteReferenceLimit: "You can pin up to 8 unique note sources. Remove one first, or pin an existing source again to update it.",
    noteReferenceInvalid: "Only saved, active notes from the current paper can be pinned.",
    noteReferenceOpen: "Open note source",
    noteReferenceRemove: "Remove this note source",
    noteReferencePage: "Page {page}",
    noteReferenceStyle: "{kind} · {color}",
    highlight: "Highlight",
    underline: "Underline",
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
    pink: "Pink",
    note_reference_changed: "A pinned note changed after it was added. The original request and pins are retained; remove and re-add the latest version, or retry the exact request.",
    note_reference_limit: "The note-source limit was exceeded. Remove extra pins before sending again.",
    note_purged: "A pinned note was permanently deleted. Remove it or pin another saved note.",
    noteReferenceUnavailable: "A pinned note is missing, deleted, or belongs to another paper. Remove it and pin a valid note.",
    resourceReferences: "Pinned cross-project references",
    resourceReferenceHelp: "Pinned references are provided when you send. Papers are read by page; datasets default to fields and a few sample rows, with a separate explicit grant for descriptive statistics.",
    contextResourceReferences: "External references: {count} · provided on send",
    addReferences: "Add references",
    referencePickerTitle: "Add references to this conversation",
    closeReferences: "Close reference picker",
    referenceSearch: "Search references",
    referenceSearchPlaceholder: "Search title, authors, DOI, or owner",
    referenceSearchSubmit: "Search",
    referencePapers: "Papers",
    referenceDatasets: "Datasets",
    referencePickerScope: "Nothing is shared until you explicitly add it. Papers are read by page; datasets default to fields and up to 5 sample rows. Enable descriptive statistics separately after pinning.",
    referenceResults: "Reference search results",
    referencePrevious: "Previous",
    referenceNext: "Next",
    referenceCatalogLoading: "Loading reference catalog…",
    referenceCatalogEmpty: "No matching references. Try another search or reference type.",
    referenceCatalogFailed: "The reference catalog could not be loaded. Retry; nothing has been added or shared.",
    referencePaper: "Paper",
    referenceDataset: "Dataset",
    referenceUntitled: "Untitled reference",
    referenceOwnerUnknown: "Unknown owner",
    referencePages: "{count} pages",
    referenceAdd: "Add",
    referenceAdded: "Added",
    referenceAddedNotice: "Reference pinned to this conversation; nothing has been sent.",
    referenceDuplicate: "This reference is already in the conversation.",
    resourceReferenceRemove: "Remove this reference",
    resourceReferenceRemoved: "Reference removed; later requests will not provide it.",
    resourceReferenceLimit: "Pin at most 8 unique references. Remove one first.",
    resourceReferenceBusy: "References cannot be changed while a request or task is unresolved.",
    referenceAnalysisGrant: "Allow Python/R descriptive statistics (full-table computation; confirmation required before running)",
    referenceAnalysisGrantUpdated: "Descriptive-statistics permission updated; nothing has been sent.",
    referenceAnalysisDecisionPending: "A cross-dataset descriptive-analysis proposal is pending or in conflict. Confirm, reject, or abandon it before adding or removing references or changing permissions.",
    referenceAnalysisTarget: "Original data owner",
    referenceAnalysisScope: "Fixed describe method: Python/R computes descriptive statistics locally on the original full table. Results are saved at the original data location; confirmation only queues the job and does not open it or switch conversations.",
    analysisDescribe: "Descriptive statistics (local full-table computation)",
    reference_analysis_not_allowed: "This dataset has not been explicitly permitted for descriptive statistics. Enable its permission and request the operation again.",
    reference_analysis_source_changed: "The original data owner or source changed; the analysis was not run or read.",
    reference_analysis_dataset_changed: "The original dataset changed; the analysis was not run or read.",
    reference_analysis_dataset_mismatch: "The proposal or result does not match the original dataset; the analysis was not run or read.",
    reference_analysis_not_ready: "The analysis has not succeeded, so no result is available to read.",
    reference_analysis_result_not_ready: "The analysis result is not ready. Ask for it again in a later conversation turn.",
    reference_analysis_unsupported_method: "Only the fixed describe method is supported; no other method was run.",
    reference_analysis_method_unsupported: "Only the fixed describe method is supported; no other method was run.",
    dataset_changed: "The dataset changed; the analysis was not run or read.",
    analysis_not_ready: "The analysis has not succeeded, so no result is available to read.",
    unsupported_method: "Only the fixed describe method is supported; no other method was run.",
    referenceContinueTask: "Cross-project references do not support continuation tasks. Turn off “Continue analysis, charts, and notes” before sending.",
    agent_reference_task_unsupported: "Cross-project references do not support continuation tasks. Turn off continuation and send again.",
    resourceReferenceChanged: "A pinned reference changed after it was added. Retry the exact request, or edit the draft to cancel that retry before removing and re-adding the latest version.",
    resourceReferenceUnavailable: "A pinned reference is missing, deleted, or unavailable. Retry the exact request, or edit the draft to cancel that retry before removing it.",
    resourceReferenceRejected: "Reference validation failed. The exact request is unchanged; retry it, or edit the draft to cancel the retry before changing references.",
    untitled: "Untitled paper"
  }
};

export function createAssistant(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    toggle: byId("assistant-toggle"),
    panel: byId("assistant-panel"),
    header: document.querySelector(".assistant-header"),
    close: byId("assistant-close"),
    fullPage: byId("assistant-full-page"),
    resize: byId("assistant-resize"),
    resizeLeft: byId("assistant-resize-left"),
    resizeRight: byId("assistant-resize-right"),
    windowHelp: byId("assistant-window-help"),
    heading: byId("assistant-heading"),
    history: byId("assistant-history"),
    new: byId("assistant-new"),
    managementSummary: byId("assistant-management-summary"),
    context: byId("assistant-context"),
    messages: byId("assistant-messages"),
    sourcesDetails: byId("assistant-sources-details"),
    sourcesSummary: byId("assistant-sources-summary"),
    sources: byId("assistant-sources"),
    proposals: byId("assistant-proposals"),
    status: byId("assistant-status"),
    form: byId("assistant-form"),
    resourceReferenceHelp: byId("assistant-resource-reference-help"),
    resourceReferences: byId("assistant-resource-references"),
    sourcePreparation: byId("assistant-source-preparation"),
    noteReferences: byId("assistant-note-references"),
    readerActions: byId("assistant-reader-actions"),
    referenceAdd: byId("assistant-add-references"),
    referenceDialog: byId("assistant-reference-picker"),
    referenceHeading: byId("assistant-reference-picker-heading"),
    referenceClose: byId("assistant-reference-picker-close"),
    referenceScope: byId("assistant-reference-picker-scope"),
    referenceSearchForm: byId("assistant-reference-search-form"),
    referenceSearchLabel: byId("assistant-reference-search-label"),
    referenceSearch: byId("assistant-reference-search"),
    referenceSearchSubmit: byId("assistant-reference-search-submit"),
    referenceTabPaper: byId("assistant-reference-tab-paper"),
    referenceTabDataset: byId("assistant-reference-tab-dataset"),
    referenceStatus: byId("assistant-reference-picker-status"),
    referenceResults: byId("assistant-reference-results"),
    referencePrevious: byId("assistant-reference-previous"),
    referenceNext: byId("assistant-reference-next"),
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

  const windowControls = createAssistantWindow({
    panel: elements.panel,
    header: elements.header,
    fullPageToggle: elements.fullPage,
    resizeHandle: elements.resize,
    leftResizeHandle: elements.resizeLeft,
    rightResizeHandle: elements.resizeRight,
    help: elements.windowHelp
  });

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

  const referencePicker = createReferencePicker({
    api: adapter.api,
    t,
    elements: {
      add: elements.referenceAdd,
      dialog: elements.referenceDialog,
      heading: elements.referenceHeading,
      close: elements.referenceClose,
      scope: elements.referenceScope,
      searchForm: elements.referenceSearchForm,
      searchLabel: elements.referenceSearchLabel,
      search: elements.referenceSearch,
      searchSubmit: elements.referenceSearchSubmit,
      tabs: { paper: elements.referenceTabPaper, dataset: elements.referenceTabDataset },
      status: elements.referenceStatus,
      list: elements.referenceResults,
      previous: elements.referencePrevious,
      next: elements.referenceNext
    },
    getTarget: () => {
      const { paper, entry } = current();
      return paper && entry ? { paperId: paper.id, entry, conversationId: entry.conversationId } : null;
    },
    canEdit: (target) => canEditReferences(target.paperId, target.entry),
    onAdd: addResourceReference
  });

  let sourcePreparationGeneration = 0;
  const sourcePreparation = createSourcePreparationBridge({
    container: elements.sourcePreparation,
    getModel: sourcePreparationModel,
    api: adapter.api
  });

  function entryFor(documentId) {
    if (!papers.has(documentId)) {
      papers.set(documentId, {
        conversations: [],
        conversationsLoading: false,
        conversationsLoadSequence: 0,
        conversationId: null,
        turns: [],
        draft: "",
        fresh: false,
        loaded: false,
        loading: false,
        loadSequence: 0,
        loadController: null,
        pendingSend: null,
        resourceRefs: [],
        noteRefs: [],
        readerActions: [],
        explicitNoteContext: false,
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

  function renderContext(entry) {
    elements.context.replaceChildren();
    const paper = adapter.getDocument();
    if (!paper) {
      elements.context.textContent = t("noDocument");
      elements.managementSummary.textContent = t("noDocument");
      return;
    }
    const context = adapter.getContext();
    const images = adapter.getChatImages(paper.id);
    const pendingContext = entry?.pendingSend?.payload?.context;
    const readerAction = entry?.readerActions?.at(-1);
    const sourcePage = pendingContext ? pendingContext.page : readerAction?.page ?? context.page;
    const sourceRect = pendingContext ? pendingContext.rect : readerAction ? readerAction.rect : context.rect;
    const badges = paper.kind === "study" ? [
      t(paper.workspace_role === "personal_analysis" ? "contextPersonal" : "contextStudy", { title: paper.title || paper.name || t("untitled") })
    ] : [
      t("contextPaper", { title: paper.title || paper.original_filename || t("untitled") }),
      t("contextPage", { page: sourcePage }),
      t(sourceRect ? "contextRegion" : "contextWhole")
    ];
    const hasNoteContext = pendingContext
      ? Boolean(pendingContext.active_note_id || pendingContext.note_refs?.length)
      : entry?.explicitNoteContext ? Boolean(entry.noteRefs.length) : Boolean(context.activeNoteId);
    if (hasNoteContext) badges.push(t("contextNote"));
    if (images.length) badges.push(t("contextImages", { count: images.length }));
    const selectedDataset = adapter.getSelectedDataset?.();
    const sharedDatasetId = adapter.getSharedDatasetId?.();
    if (selectedDataset || sharedDatasetId) {
      badges.push(t(sharedDatasetId ? "contextDataset" : "contextDatasetNotShared", {
        title: selectedDataset?.original_filename || selectedDataset?.name || selectedDataset?.id || sharedDatasetId
      }));
    }
    if (adapter.getActiveAnalysisId?.()) badges.push(t("contextAnalysis"));
    const resourceRefs = pendingContext ? pendingContext.resource_refs || [] : entry?.resourceRefs || [];
    if (resourceRefs.length) badges.push(t("contextResourceReferences", { count: resourceRefs.length }));
    const computationGrantCount = resourceRefs.filter((reference) => reference.kind === "dataset" && reference.allow_analysis === true).length;
    if (computationGrantCount) badges.push(t("contextComputationGrants", { count: computationGrantCount }));
    elements.managementSummary.textContent = badges.join(" · ");
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

  function hasPendingReferenceAnalysisDecision(entry) {
    return entry.turns.some((turn) => turn.status === "waiting_confirmation" && turn.proposals?.some((proposal) => proposal.kind === "run_reference_analysis" && ["pending", "conflict"].includes(proposal.status)));
  }

  function canEditReferences(paperId, entry) {
    return isCurrent(paperId, entry) && !entry.loading && !entry.conversationsLoading && !entry.pendingSend && !activeTurn(entry) && !entry.pendingDecision && !hasPendingReferenceAnalysisDecision(entry) && !tasks.isBusy(paperId, entry.conversationId);
  }

  function sourcePreparationModel() {
    const { paper, entry } = current();
    const currentPdf = paper && paper.kind !== "study" ? paper : null;
    const context = paper ? adapter.getContext() : null;
    const candidates = [];
    if (currentPdf) {
      candidates.push({
        documentId: currentPdf.id,
        sourceSha256: currentPdf.sha256,
        title: currentPdf.title || currentPdf.original_filename || "",
        pageCount: currentPdf.page_count,
        initialPage: context?.page || 1
      });
    }
    for (const reference of entry?.resourceRefs || []) {
      if (reference.kind !== "paper") continue;
      candidates.push({
        documentId: reference.document_id,
        sourceSha256: reference.sha256,
        title: reference.title,
        pageCount: reference.page_count,
        initialPage: 1
      });
    }
    return {
      language,
      visible: !elements.panel.hidden,
      contextKey: `${paper?.id || "none"}:${entry?.conversationId || "fresh"}:${sourcePreparationGeneration}`,
      editable: Boolean(paper && entry && canEditReferences(paper.id, entry)),
      papers: candidates,
      preferredDocumentId: currentPdf?.id || null
    };
  }

  function addResourceReference(target, reference) {
    const { paperId, entry } = target;
    if (!canEditReferences(paperId, entry)) return "busy";
    const key = resourceReferenceKey(reference);
    if (entry.resourceRefs.some((item) => resourceReferenceKey(item) === key)) return "duplicate";
    if (entry.resourceRefs.length >= 8) {
      entry.status = { key: "resourceReferenceLimit", kind: "error" };
      render();
      return "limit";
    }
    entry.resourceRefs = [...entry.resourceRefs, reference];
    entry.status = { key: "referenceAddedNotice", kind: "success" };
    render();
    return "added";
  }

  function renderResourceReferences(entry) {
    elements.resourceReferences.replaceChildren();
    elements.resourceReferences.setAttribute("aria-label", t("resourceReferences"));
    const paper = adapter.getDocument();
    const pendingAnalysisDecision = Boolean(entry && hasPendingReferenceAnalysisDecision(entry));
    elements.resourceReferenceHelp.hidden = !paper || !entry || !entry.resourceRefs.length && !pendingAnalysisDecision;
    elements.resourceReferenceHelp.textContent = t(pendingAnalysisDecision ? "referenceAnalysisDecisionPending" : "resourceReferenceHelp");
    if (!paper || !entry) return;
    const editable = canEditReferences(paper.id, entry);
    for (const reference of entry.resourceRefs) {
      const key = resourceReferenceKey(reference);
      const conversationId = entry.conversationId;
      const chip = document.createElement("article");
      chip.className = "assistant-resource-reference";
      chip.dataset.referenceKey = key;
      const description = document.createElement("div");
      description.className = "assistant-resource-reference-description";
      const title = document.createElement("strong");
      title.textContent = reference.title || t("referenceUntitled");
      const meta = document.createElement("span");
      meta.textContent = `${t(reference.kind === "paper" ? "referencePaper" : "referenceDataset")} · ${reference.owner_title || t("referenceOwnerUnknown")}`;
      description.append(title, meta);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button button-quiet assistant-resource-reference-remove";
      remove.textContent = t("resourceReferenceRemove");
      remove.setAttribute("aria-label", `${t("resourceReferenceRemove")}: ${title.textContent}`);
      remove.disabled = !editable;
      remove.addEventListener("click", () => {
        if (entry.conversationId !== conversationId || !canEditReferences(paper.id, entry)) return;
        entry.resourceRefs = entry.resourceRefs.filter((item) => resourceReferenceKey(item) !== key);
        entry.status = { key: "resourceReferenceRemoved", kind: "info" };
        render();
      });
      chip.append(description, remove);
      if (reference.kind === "dataset") {
        const grant = document.createElement("label");
        grant.className = "assistant-resource-reference-grant";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = reference.allow_analysis === true;
        checkbox.disabled = !editable;
        checkbox.setAttribute("aria-label", `${t("referenceAnalysisGrant")}: ${title.textContent}`);
        const text = document.createElement("span");
        text.textContent = t("referenceAnalysisGrant");
        grant.append(checkbox, text);
        checkbox.addEventListener("change", () => {
          if (entry.conversationId !== conversationId || !canEditReferences(paper.id, entry)) return;
          const index = entry.resourceRefs.findIndex((item) => item === reference && resourceReferenceKey(item) === key);
          if (index < 0) return;
          const updated = normalizeResourceReference({ ...reference, allow_analysis: checkbox.checked });
          if (!updated) return;
          entry.resourceRefs = [...entry.resourceRefs.slice(0, index), updated, ...entry.resourceRefs.slice(index + 1)];
          entry.status = { key: "referenceAnalysisGrantUpdated", kind: "info" };
          render();
        });
        chip.append(grant);
      }
      elements.resourceReferences.append(chip);
    }
  }

  function renderNoteReferences(entry) {
    elements.noteReferences.replaceChildren();
    elements.noteReferences.setAttribute("aria-label", t("noteReferences"));
    const paper = adapter.getDocument();
    if (!paper || !entry) return;
    for (const reference of entry.noteRefs) {
      const note = reference.note;
      const annotation = note.annotation;
      const chip = document.createElement("article");
      chip.className = "assistant-note-reference";
      chip.dataset.noteReferenceId = reference.note_id;
      const summary = document.createElement("div");
      summary.className = "assistant-note-reference-summary";
      const sourceText = String(annotation?.quote || note.text || "");
      summary.textContent = sourceText.length > 280 ? `${sourceText.slice(0, 280)}…` : sourceText;
      const meta = document.createElement("div");
      meta.className = "assistant-note-reference-meta";
      const labels = [t("noteReferencePage", { page: note.page })];
      if (annotation) labels.push(t("noteReferenceStyle", { kind: t(annotation.kind), color: t(annotation.color) }));
      meta.textContent = labels.join(" · ");
      const actions = document.createElement("div");
      actions.className = "assistant-note-reference-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "button button-quiet";
      open.dataset.action = "open-note-reference";
      open.textContent = t("noteReferenceOpen");
      open.setAttribute("aria-label", `${t("noteReferenceOpen")}: ${summary.textContent}`);
      open.addEventListener("click", () => adapter.navigateSource({ document_id: paper.id, note_id: reference.note_id, page: note.page, rect: note.rect }));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button button-quiet";
      remove.dataset.action = "remove-note-reference";
      remove.textContent = t("noteReferenceRemove");
      remove.setAttribute("aria-label", `${t("noteReferenceRemove")}: ${summary.textContent}`);
      remove.addEventListener("click", () => {
        entry.explicitNoteContext = true;
        entry.noteRefs = entry.noteRefs.filter((item) => item.pinId !== reference.pinId);
        entry.status = { key: "noteReferenceRemoved", kind: "info" };
        render();
      });
      actions.append(open, remove);
      chip.append(summary, meta, actions);
      elements.noteReferences.append(chip);
    }
  }

  function addNoteReferences(documentId, notes) {
    const entry = entryFor(documentId);
    const fail = (reason) => {
      entry.status = { key: reason === "limit" ? "noteReferenceLimit" : "noteReferenceInvalid", kind: "error" };
      if (isCurrent(documentId, entry)) render();
      return reason;
    };
    if (!Array.isArray(notes) || !notes.length) return fail("invalid");
    const ids = new Set();
    for (const note of notes) {
      if (!note?.id || ids.has(note.id) || note.document_id !== documentId || note.deleted_at || note.purged || !Number.isInteger(note.revision)) return fail("invalid");
      ids.add(note.id);
    }
    const aggregateIds = new Set([...entry.noteRefs.map((reference) => reference.note_id), ...ids]);
    if (aggregateIds.size > 8) return fail("limit");
    const nextReferences = entry.noteRefs.slice();
    for (const note of notes) {
      const existingIndex = nextReferences.findIndex((item) => item.note_id === note.id);
      const previous = existingIndex >= 0 ? nextReferences[existingIndex] : null;
      const reference = {
        pinId: previous && previous.revision === note.revision ? previous.pinId : crypto.randomUUID(),
        note_id: note.id,
        revision: note.revision,
        note: JSON.parse(JSON.stringify(note))
      };
      if (existingIndex >= 0) nextReferences[existingIndex] = reference;
      else nextReferences.push(reference);
    }
    entry.noteRefs = nextReferences;
    entry.explicitNoteContext = true;
    if (!entry.draft) entry.draft = t("noteReferencePrompt");
    entry.status = { key: "noteReferenceAdded", kind: "success" };
    if (isCurrent(documentId, entry)) {
      elements.panel.hidden = false;
      elements.toggle.setAttribute("aria-expanded", "true");
      windowControls.show();
      render();
      elements.message.focus();
    }
    return "added";
  }

  function addNoteReference(documentId, note) {
    return addNoteReferences(documentId, [note]) === "added";
  }

  function frozenImageSource(documentId, action) {
    const supplied = action.description !== undefined || action.sourceUrl !== undefined || action.sourceLabel !== undefined;
    if (!supplied) return { description: "", sourceUrl: null, sourceLabel: null };
    const sourceLabel = typeof action.sourceLabel === "string" ? action.sourceLabel.replace(/\s+/g, " ").trim() : "";
    if (action.kind !== "image" || typeof action.description !== "string" || !sourceLabel || sourceLabel.length > 200 || typeof action.sourceUrl !== "string" || action.sourceUrl.length > 2048) return null;
    let url;
    try {
      url = new URL(action.sourceUrl);
    } catch {
      return null;
    }
    const rect = (url.searchParams.get("rect") || "").split(",").map(Number);
    const revision = Number(url.searchParams.get("shape_revision"));
    if (url.origin !== window.location.origin || url.pathname !== "/" || url.username || url.password || url.hash || url.href.length > 2048 ||
      url.searchParams.get("document") !== documentId || url.searchParams.get("page") !== String(action.page) || url.searchParams.get("workspace") !== "reading" ||
      url.searchParams.get("source_sha256") !== adapter.getDocument()?.sha256 || !url.searchParams.get("shape_note") ||
      !Number.isInteger(revision) || revision < 1 || !["rectangle", "arrow", "textbox", "line", "ellipse", "ink"].includes(url.searchParams.get("shape_kind")) ||
      rect.length !== 4 || !rect.every(Number.isFinite) || !rect.every((value, index) => Math.abs(value - action.rect[index]) <= 1e-6)) return null;
    return { description: action.description, sourceUrl: url.href, sourceLabel };
  }

  function readerSource(documentId, action) {
    const url = action.sourceUrl ? new URL(action.sourceUrl) : new URL("/", window.location.origin);
    if (!action.sourceUrl) {
      url.searchParams.set("document", documentId);
      url.searchParams.set("page", String(action.page));
      url.searchParams.set("workspace", "reading");
    }
    const label = action.sourceLabel || (language === "zh" ? `来源：第 ${action.page} 页 · 选定区域` : `Source: page ${action.page} · selected region`);
    return `${label}\n${url.href}`;
  }

  function transformReaderActionRanges(entry, previous, next) {
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
    const oldEnd = previous.length - suffix;
    const insertedLength = next.length - prefix - suffix;
    const transform = (position, priority) => {
      const delta = insertedLength - (oldEnd - prefix);
      if (position < prefix || position === prefix && !priority) return position;
      if (position > oldEnd || position === oldEnd && priority) return position + delta;
      if (position === prefix && priority) return position + insertedLength;
      if (position === oldEnd && !priority) return prefix;
      return prefix + Math.min(position - prefix, insertedLength);
    };
    for (const action of entry.readerActions) {
      const start = transform(action.draftStart, true);
      const end = transform(action.draftEnd, false);
      action.draftStart = start;
      action.draftEnd = Math.max(start, end);
    }
  }

  function removeReaderAction(entry, action) {
    if (entry.pendingSend?.pending) return;
    const index = entry.readerActions.findIndex((item) => item.id === action.id);
    if (index < 0) return;
    const previous = entry.draft;
    const unchanged = previous.slice(action.draftStart, action.draftEnd) === action.draftText;
    let next = previous;
    if (unchanged) {
      let start = action.draftStart;
      let end = action.draftEnd;
      const nextAction = entry.readerActions[index + 1];
      if (nextAction && nextAction.draftStart === end + nextAction.separator.length && nextAction.separator && previous.slice(end, end + nextAction.separator.length) === nextAction.separator) {
        end += nextAction.separator.length;
      } else if (action.separator && previous.slice(start - action.separator.length, start) === action.separator) {
        start -= action.separator.length;
      }
      next = `${previous.slice(0, start)}${previous.slice(end)}`;
      for (const item of entry.readerActions) {
        const shift = (position) => position <= start ? position : position >= end ? position - (end - start) : start;
        item.draftStart = shift(item.draftStart);
        item.draftEnd = shift(item.draftEnd);
      }
    }
    entry.readerActions = entry.readerActions.filter((item) => item.id !== action.id);
    entry.draft = next;
    entry.pendingSend = null;
    if (action.imageAdded && !entry.readerActions.some((item) => item.imageId === action.imageId)) {
      adapter.deselectChatImage?.(adapter.getDocument().id, action.imageId);
    }
    entry.status = { key: unchanged ? "readerActionRemoved" : "readerActionRemovedEdited", kind: "info" };
    render();
  }

  function renderReaderActions(entry) {
    elements.readerActions.replaceChildren();
    elements.readerActions.setAttribute("aria-label", t("readerActions"));
    const paper = adapter.getDocument();
    if (!paper || !entry) return;
    for (const action of entry.readerActions) {
      const chip = document.createElement("article");
      chip.className = "assistant-reader-action";
      chip.dataset.readerActionId = action.id;
      const kind = document.createElement("strong");
      kind.textContent = t(action.kind === "ask" ? "readerActionAsk" : action.kind === "translate" ? "readerActionTranslate" : "readerActionImage");
      const source = document.createElement("button");
      source.type = "button";
      source.className = "button button-quiet assistant-reader-action-source";
      source.dataset.action = "open-reader-action-source";
      source.textContent = `${t("readerActionPage", { page: action.page })} · ${t("readerActionOpen")}`;
      source.addEventListener("click", () => adapter.navigateSource({ document_id: paper.id, page: action.page, rect: [...action.rect] }));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button button-quiet assistant-reader-action-remove";
      remove.dataset.action = "remove-reader-action";
      remove.disabled = Boolean(entry.pendingSend?.pending);
      remove.textContent = t("readerActionRemove");
      remove.setAttribute("aria-label", `${t("readerActionRemove")}: ${kind.textContent}, ${t("contextPage", { page: action.page })}`);
      remove.addEventListener("click", () => removeReaderAction(entry, action));
      chip.append(kind, source, remove);
      elements.readerActions.append(chip);
    }
  }

  function prepareReaderAction(documentId, action) {
    const paper = adapter.getDocument();
    if (paper && paper.id !== documentId) return "owner";
    if (!paper || paper.kind === "study" || !action) return "invalid";
    const kind = ["ask", "translate", "image"].includes(action.kind) ? action.kind : null;
    const rect = action.rect;
    const validRect = Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) &&
      rect[0] >= 0 && rect[1] >= 0 && rect[2] <= 1 && rect[3] <= 1 && rect[2] > rect[0] && rect[3] > rect[1];
    if (!kind || !Number.isInteger(action.page) || action.page < 1 || action.page > paper.page_count || !validRect) return "invalid";
    if (kind !== "image" && (typeof action.quote !== "string" || !action.quote.trim())) return "invalid";
    if (kind === "image" && (!action.image?.id || action.image.document_id !== documentId || !/^[0-9a-f]{64}$/.test(action.image.sha256 || ""))) return "invalid";
    const frozenSource = frozenImageSource(documentId, action);
    if (!frozenSource) return "invalid";
    const entry = entryFor(documentId);
    if (entry.pendingSend?.pending) return "pending";
    const frozen = {
      id: crypto.randomUUID(),
      kind,
      page: action.page,
      rect: [...rect],
      quote: typeof action.quote === "string" ? action.quote : "",
      imageId: kind === "image" ? action.image.id : null,
      imageAdded: kind === "image" && !adapter.getChatImages(documentId).some((image) => image.id === action.image.id),
      ...frozenSource
    };
    const promptKey = kind === "ask" ? "readerAskPrompt" : kind === "translate" ? "readerTranslatePrompt" : "readerImagePrompt";
    const description = frozen.description ? `\n${t("readerImageDescription", { description: frozen.description })}` : "";
    const prompt = `${t(promptKey, { quote: frozen.quote, source: readerSource(documentId, frozen) })}${description}`;
    const separator = entry.draft ? (entry.draft.endsWith("\n") ? "\n" : "\n\n") : "";
    const nextDraft = `${entry.draft}${separator}${prompt}`;
    if (nextDraft.length > 8000) return "limit";
    frozen.separator = separator;
    frozen.draftText = prompt;
    frozen.draftStart = entry.draft.length + separator.length;
    frozen.draftEnd = nextDraft.length;
    if (kind === "image" && (!adapter.selectChatImage || !adapter.selectChatImage(documentId, frozen.imageId))) {
      return adapter.getChatImages(documentId).length >= 4 ? "imageLimit" : "invalid";
    }
    entry.pendingSend = null;
    entry.readerActions.push(frozen);
    entry.draft = nextDraft;
    entry.status = null;
    elements.panel.hidden = false;
    elements.toggle.setAttribute("aria-expanded", "true");
    windowControls.show();
    render();
    elements.message.focus();
    return "added";
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

  function openTurnSource(source) {
    if (source.kind === "online_dataset") return;
    if (source.kind === "research_record") adapter.reviewResearchRecord?.(source);
    else adapter.navigateSource(source);
  }

  function renderMessages(entry) {
    const expandedTools = new Set([...elements.messages.querySelectorAll("details.assistant-tools[data-turn-id][open]")].map((details) => details.dataset.turnId));
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
        const content = document.createElement("div");
        content.className = "assistant-answer-content";
        renderAssistantAnswer(content, {
          answer: turn.answer,
          sources: turn.sources,
          language,
          t,
          onOpenSource: openTurnSource
        });
        answer.append(label, content);
        article.append(answer);
      }
      if (turn.error) {
        const error = document.createElement("p");
        error.className = "assistant-error";
        error.textContent = errorText(turn.error, "turnFailed");
        article.append(error);
      }
      const events = (Array.isArray(turn.events) ? turn.events : []).filter((event) => event && (String(event.title || "").trim() || String(event.summary || "").trim()));
      if (events.length) {
        const details = document.createElement("details");
        details.className = "assistant-tools";
        details.dataset.turnId = turn.id;
        details.open = expandedTools.has(String(turn.id));
        const summary = document.createElement("summary");
        summary.textContent = `${t("tools")} (${events.length})`;
        const list = document.createElement("ol");
        for (const event of events) {
          const item = document.createElement("li");
          item.dataset.eventKind = event.kind || "";
          item.dataset.status = event.status || "";
          if (String(event.title || "").trim()) {
            const title = document.createElement("strong");
            title.textContent = event.status ? `${event.title} · ${event.status}` : event.title;
            item.append(title);
          }
          if (String(event.summary || "").trim()) {
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

  function appendSourceExcerpt(item, source, key, expanded) {
    if (!source.text) return;
    const details = document.createElement("details");
    details.className = "assistant-source-excerpt";
    details.dataset.sourceDetail = key;
    details.open = expanded.has(key);
    const summary = document.createElement("summary");
    summary.textContent = t("sourceExcerpt");
    details.append(summary);
    const populate = () => {
      if (details.dataset.loaded === "true") return;
      const excerpt = document.createElement("p");
      excerpt.textContent = source.text;
      details.append(excerpt);
      details.dataset.loaded = "true";
    };
    details.addEventListener("toggle", () => {
      if (details.open) populate();
    });
    if (details.open) populate();
    item.append(details);
  }

  function appendSourceItem(list, source, index, expanded) {
    const item = document.createElement("li");
    const isResearchRecord = source.kind === "research_record";
    const isPdfPage = isPdfPageSource(source);
    const onlineDatasetUrl = onlineDatasetSourceUrl(source);
    const isUnverifiedOnlineDataset = source.kind === "online_dataset" && !onlineDatasetUrl;
    const control = document.createElement(isPdfPage || onlineDatasetUrl ? "a" : isUnverifiedOnlineDataset ? "span" : "button");
    control.className = "assistant-source-button";
    const label = isResearchRecord ? t("reviewResearchRecord") : source.label || source.ref || t("openSource");
    control.textContent = label;
    if (isPdfPage || onlineDatasetUrl) {
      control.href = onlineDatasetUrl || pdfPageApplicationUrl(source);
      control.target = "_blank";
      control.rel = "noopener noreferrer";
      control.classList.add("assistant-source-link");
      control.setAttribute("aria-label", t("citationNewTab", { ref: source.ref || label, label }));
    } else if (isUnverifiedOnlineDataset) {
      control.classList.add("assistant-citation-unverified");
      control.title = t("citationUnverified");
      control.setAttribute("aria-label", `${label}: ${t("citationUnverified")}`);
    } else {
      control.type = "button";
      control.addEventListener("click", () => openTurnSource(source));
    }
    item.append(control);
    if (isPdfPage) {
      const page = document.createElement("span");
      page.className = "assistant-source-page";
      page.textContent = t("pageValue", { page: source.page });
      item.append(page);
    }
    if (isResearchRecord && source.ref) {
      const reference = document.createElement("p");
      reference.className = "assistant-source-ref";
      reference.textContent = t("sourceRef", { ref: source.ref });
      item.append(reference);
    }
    const key = source.ref || `${source.kind || "source"}:${source.document_id || ""}:${source.page || ""}:${index}`;
    appendSourceExcerpt(item, source, key, expanded);
    list.append(item);
  }

  function renderSources(turn) {
    const expanded = new Set([...elements.sources.querySelectorAll("details[data-source-detail][open]")].map((details) => details.dataset.sourceDetail));
    elements.sources.replaceChildren();
    const sources = (Array.isArray(turn?.sources) ? turn.sources : []).filter((source) => source && typeof source === "object");
    elements.sourcesDetails.hidden = !sources.length;
    elements.sourcesSummary.textContent = `${t("sources")} (${sources.length})`;
    if (!sources.length) {
      elements.sourcesDetails.open = false;
      return;
    }
    const citedRefs = new Set();
    for (const marker of String(turn.answer || "").matchAll(/\[R\d+(?:\s*,\s*R\d+)*\]/g)) {
      for (const ref of marker[0].matchAll(/R\d+/g)) citedRefs.add(ref[0]);
    }
    const cited = sources.filter((source) => source.ref && citedRefs.has(source.ref));
    const uncited = sources.filter((source) => !source.ref || !citedRefs.has(source.ref));
    if (cited.length) {
      const list = document.createElement("ul");
      list.className = "assistant-cited-sources";
      cited.forEach((source, index) => appendSourceItem(list, source, index, expanded));
      elements.sources.append(list);
    }
    if (uncited.length) {
      const details = document.createElement("details");
      details.className = "assistant-other-sources";
      details.dataset.sourceDetail = "other-sources";
      details.open = expanded.has("other-sources");
      const summary = document.createElement("summary");
      summary.textContent = t("otherSources", { count: uncited.length });
      const list = document.createElement("ul");
      uncited.forEach((source, index) => appendSourceItem(list, source, index, expanded));
      details.append(summary, list);
      elements.sources.append(details);
    }
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
    const method = ["ttest_independent", "ttest_paired", "correlation"].includes(payload.method) ? payload.method : "describe";
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

  function appendPairedProposal(card, details, payload) {
    const options = payload.paired || {};
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const preview = payload.preview || {};
    const pairing = preview.pairing || {};
    appendProposalField(details, t("analysisMethod"), t("analysisPaired"));
    appendProposalField(details, t("analysisPairedFirst"), columns[0] || "—");
    appendProposalField(details, t("analysisPairedSecond"), columns[1] || "—");
    appendProposalField(details, t("analysisPairedUnit"), options.unit_column || "—");
    appendProposalField(details, t("analysisPairedDirection"), columns.length === 2 ? `${columns[0]} − ${columns[1]}` : "—");
    appendProposalField(details, t("analysisAlternative"), t(`paired_alternative_${options.alternative || "two_sided"}`));
    appendProposalField(details, t("analysisConfidence"), `${Number(options.confidence ?? 0.95) * 100}%`);
    appendProposalField(details, t("analysisPairedDeclaration"), options.paired_samples_confirmed === true ? t("analysisPairedConfirmed") : "—");
    appendProposalField(details, t("analysisMissing"), t("analysisCompletePairs"));
    appendProposalField(details, t("analysisPairedIdentity"), pairing.identity || "exact_unique_nonempty");
    if (payload.library) appendProposalField(details, t("analysisLibrary"), `${payload.library.id || "r-stats"} ${payload.library.version || ""} · ${payload.library.sha256 || "—"}`);
    const counts = preview.counts || {};
    for (const [field, key] of [["total", "analysisPairedTotal"], ["used", "analysisPairedUsed"], ["excluded", "analysisPairedExcluded"], ["missing_first_only", "analysisPairedMissingFirst"], ["missing_second_only", "analysisPairedMissingSecond"], ["missing_both", "analysisPairedMissingBoth"]]) {
      appendProposalField(details, `${t("analysisCounts")} · ${t(key)}`, counts[field] ?? "—");
    }
    if (Array.isArray(preview.stats)) {
      const label = document.createElement("strong");
      label.textContent = t("analysisPairedStats");
      const basis = document.createElement("p");
      basis.className = "assistant-proposal-inactive";
      basis.textContent = t("analysisPairedStatsBasis");
      const scroll = document.createElement("div");
      scroll.className = "assistant-ttest-stats";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const header = document.createElement("tr");
      for (const text of [t("analysisColumns"), t("analysisCompletePairN"), t("analysisExcludedPairN"), t("analysisMean"), t("analysisSd"), t("analysisMedian"), t("analysisMin"), t("analysisMax")]) {
        const cell = document.createElement("th");
        cell.textContent = text;
        header.append(cell);
      }
      thead.append(header);
      const tbody = document.createElement("tbody");
      for (const stat of preview.stats) {
        const row = document.createElement("tr");
        for (const [index, value] of [stat.column, stat.n, stat.missing, stat.mean, stat.sd, stat.median, stat.min, stat.max].entries()) {
          const cell = document.createElement(index === 0 ? "th" : "td");
          cell.textContent = value ?? "—";
          row.append(cell);
        }
        tbody.append(row);
      }
      table.append(thead, tbody);
      scroll.append(table);
      card.append(label, basis, scroll);
    }
    const differences = preview.difference_stats || {};
    for (const [field, key] of [["n", "analysisCompletePairN"], ["mean", "analysisMean"], ["sd", "analysisSd"], ["median", "analysisMedian"], ["min", "analysisMin"], ["max", "analysisMax"]]) {
      appendProposalField(details, `${t("analysisPairedDifferenceStats")} · ${t(key)}`, differences[field] ?? "—");
    }
    for (const warning of preview.warnings || []) {
      const text = document.createElement("p");
      text.className = "assistant-proposal-inactive";
      text.textContent = warning;
      card.append(text);
    }
    return options.paired_samples_confirmed === true && columns.length === 2 && columns[0] !== columns[1] &&
      Boolean(options.unit_column) && !columns.includes(options.unit_column) && Boolean(preview.counts) && preview.stats_basis === "complete_pairs" &&
      Boolean(preview.difference_stats) && pairing.unit_column === options.unit_column && pairing.direction === "first_minus_second" &&
      pairing.missing === "complete_pairs" && JSON.stringify(pairing.columns) === JSON.stringify(columns);
  }

  function appendCorrelationProposal(card, details, payload) {
    const options = payload.correlation || {};
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const preview = payload.preview || {};
    const pairs = preview.pairs || {};
    const kind = options.kind || "pearson";
    appendProposalField(details, t("analysisMethod"), t("analysisCorrelation"));
    appendProposalField(details, t("analysisCorrelationFirst"), columns[0] || "—");
    appendProposalField(details, t("analysisCorrelationSecond"), columns[1] || "—");
    appendProposalField(details, t("analysisCorrelationKind"), t(`correlation_${kind}`));
    appendProposalField(details, t("analysisAlternative"), t(`correlation_alternative_${options.alternative || "two_sided"}`));
    if (kind === "pearson") appendProposalField(details, t("analysisConfidence"), `${Number(options.confidence ?? 0.95) * 100}%`);
    appendProposalField(details, t("analysisCorrelationDeclaration"), options.independent_pairs_confirmed === true ? t("analysisCorrelationConfirmed") : "—");
    appendProposalField(details, t("analysisMissing"), t("analysisCorrelationCompletePairs"));
    if (payload.library) appendProposalField(details, t("analysisLibrary"), `${payload.library.id || "r-stats"} ${payload.library.version || ""} · ${payload.library.sha256 || "—"}`);
    const counts = preview.counts || {};
    const firstTiesReady = Number.isInteger(pairs.ties?.first) && pairs.ties.first >= 0 && Number.isInteger(counts.used) && pairs.ties.first <= counts.used;
    const secondTiesReady = Number.isInteger(pairs.ties?.second) && pairs.ties.second >= 0 && Number.isInteger(counts.used) && pairs.ties.second <= counts.used;
    for (const [field, key] of [["total", "analysisPairedTotal"], ["used", "analysisPairedUsed"], ["excluded", "analysisPairedExcluded"], ["missing_first_only", "analysisPairedMissingFirst"], ["missing_second_only", "analysisPairedMissingSecond"], ["missing_both", "analysisPairedMissingBoth"]]) {
      appendProposalField(details, `${t("analysisCounts")} · ${t(key)}`, counts[field] ?? "—");
    }
    if (Array.isArray(preview.stats)) {
      const label = document.createElement("strong");
      label.textContent = t("analysisCorrelationStats");
      const basis = document.createElement("p");
      basis.className = "assistant-proposal-inactive";
      basis.textContent = t("analysisPairedStatsBasis");
      const scroll = document.createElement("div");
      scroll.className = "assistant-ttest-stats";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const header = document.createElement("tr");
      for (const text of [t("analysisColumns"), t("analysisCompletePairN"), t("analysisExcludedPairN"), t("analysisMean"), t("analysisSd"), t("analysisMedian"), t("analysisMin"), t("analysisMax")]) {
        const cell = document.createElement("th");
        cell.textContent = text;
        header.append(cell);
      }
      thead.append(header);
      const tbody = document.createElement("tbody");
      for (const stat of preview.stats) {
        const row = document.createElement("tr");
        for (const [index, value] of [stat.column, stat.n, stat.missing, stat.mean, stat.sd, stat.median, stat.min, stat.max].entries()) {
          const cell = document.createElement(index === 0 ? "th" : "td");
          cell.textContent = value ?? "—";
          row.append(cell);
        }
        tbody.append(row);
      }
      table.append(thead, tbody);
      scroll.append(table);
      card.append(label, basis, scroll);
    }
    appendProposalField(details, t("analysisCorrelationPairs"), Array.isArray(pairs.columns) ? pairs.columns.join(", ") : "—");
    appendProposalField(details, t("analysisCorrelationMatching"), pairs.matching || "—");
    appendProposalField(details, t("analysisCorrelationTiesFirst"), firstTiesReady ? String(pairs.ties.first) : "—");
    appendProposalField(details, t("analysisCorrelationTiesSecond"), secondTiesReady ? String(pairs.ties.second) : "—");
    if (kind === "spearman") {
      const note = document.createElement("p");
      note.className = "assistant-proposal-inactive";
      note.textContent = t("analysisCorrelationSpearman");
      card.append(note);
    }
    for (const warning of preview.warnings || []) {
      const text = document.createElement("p");
      text.className = "assistant-proposal-inactive";
      text.textContent = warning;
      card.append(text);
    }
    const confidenceReady = kind === "pearson"
      ? Number.isFinite(options.confidence) && options.confidence >= 0.5 && options.confidence <= 0.999
      : kind === "spearman" && options.confidence === null;
    return payload.method === "correlation" && payload.engine === "r" && payload.recipe_id === "correlation-rstats-v1" && Number(payload.recipe_version || 1) === 1 &&
      typeof payload.document_id === "string" && typeof payload.dataset_id === "string" && typeof (payload.dataset_sha256 || payload.source_sha256) === "string" &&
      typeof payload.recipe_sha256 === "string" && typeof payload.library_sha256 === "string" && columns.length === 2 && columns[0] && columns[1] && columns[0] !== columns[1] &&
      ["pearson", "spearman"].includes(kind) && ["two_sided", "greater", "less"].includes(options.alternative) && confidenceReady &&
      options.missing === "complete_pairs" && options.independent_pairs_confirmed === true && preview.stats_basis === "complete_pairs" &&
      Number.isInteger(counts.used) && counts.used >= 3 && Array.isArray(preview.stats) && preview.stats.length === 2 &&
      pairs.missing === "complete_pairs" && typeof pairs.matching === "string" && Boolean(pairs.matching) &&
      JSON.stringify(pairs.columns) === JSON.stringify(columns) && firstTiesReady && secondTiesReady;
  }

  function appendAnalysisProposal(card, details, payload, isReferenceAnalysis = false) {
    const isTTest = payload.method === "ttest_independent";
    const isPaired = payload.method === "ttest_paired";
    const isCorrelation = payload.method === "correlation";
    if (isReferenceAnalysis) appendProposalField(details, t("referenceAnalysisTarget"), payload.target_title || payload.target_document_id || "—");
    appendProposalField(details, t("analysisDataset"), payload.dataset_name || payload.dataset_id || "—");
    appendProposalField(details, t("analysisDatasetHash"), payload.dataset_sha256 || payload.source_sha256 || "—");
    appendProposalField(details, t("analysisEngine"), payload.engine === "r" ? "R" : "Python");
    appendProposalField(details, t("analysisColumns"), Array.isArray(payload.columns) ? payload.columns.join(", ") : "—");
    if (isReferenceAnalysis) {
      appendProposalField(details, t("analysisMethod"), t("analysisDescribe"));
      const scope = document.createElement("p");
      scope.className = "assistant-proposal-inactive";
      scope.textContent = t("referenceAnalysisScope");
      card.append(scope);
    }
    const scientificReady = isReferenceAnalysis ? payload.method === "describe" : isTTest ? appendTtestProposal(card, details, payload) : isPaired ? appendPairedProposal(card, details, payload) : isCorrelation ? appendCorrelationProposal(card, details, payload) : true;
    const defaultRecipe = isCorrelation ? "correlation-rstats-v1" : isPaired ? "ttest-paired-rstats-v1" : isTTest ? "ttest-independent-rstats-v1" : "describe-v1";
    appendProposalField(details, t("analysisRecipe"), `${payload.recipe_id || defaultRecipe} · v${payload.recipe_version || 1}`);
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
    const metadataMismatch = isCorrelation && (state.recipe.id !== payload.recipe_id || Number(state.recipe.version) !== Number(payload.recipe_version || 1));
    if (state.recipe.sha256 !== payload.recipe_sha256 || metadataMismatch) {
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
      const isReferenceAnalysis = proposal.kind === "run_reference_analysis";
      const isAnalysis = isReferenceAnalysis || ["run_analysis", "run_t_test", "run_paired_t_test", "run_correlation"].includes(proposal.kind);
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
      const analysisReady = isAnalysis ? appendAnalysisProposal(card, details, payload, isReferenceAnalysis) : true;

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
        appendSourceButton(card, { document_id: isReferenceAnalysis ? payload.target_document_id : paper.id, kind: "dataset_sample", dataset_id: payload.dataset_id }, t(isDatasetSelection ? "selectionParent" : "analysisDataset"));
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

  function hasContinuationReferenceConflict(paperId, entry) {
    if (entry.pendingSend) {
      const payload = entry.pendingSend.payload;
      return Boolean(payload.context?.resource_refs?.length && payload.continue_task);
    }
    return Boolean(entry.resourceRefs?.length && tasks.continueTaskRequested(paperId));
  }

  function derivedStatus(paper, entry) {
    if (!paper) return { key: "noDocument", kind: "info" };
    if (hasContinuationReferenceConflict(paper.id, entry)) return { key: "referenceContinueTask", kind: "error" };
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
    renderContext(entry);
    renderResourceReferences(entry);
    renderNoteReferences(entry);
    renderReaderActions(entry);
    renderHistory(entry);
    renderMessages(entry);
    const turn = latestTurn(entry || { turns: [] });
    renderSources(turn);
    if (paper && entry) renderProposals(paper, entry, turn);
    else elements.proposals.replaceChildren();
    tasks.render();
    referencePicker.render();
    renderStatus(paper, entry);
    if (entry && elements.message.value !== entry.draft) elements.message.value = entry.draft;
    elements.message.disabled = !paper || Boolean(entry?.pendingSend?.pending);
    const active = entry ? activeTurn(entry) : null;
    const sending = Boolean(entry?.pendingSend?.pending);
    const taskBusy = Boolean(paper && entry && tasks.isBusy(paper.id, entry.conversationId));
    const continuationReferenceConflict = Boolean(paper && entry && hasContinuationReferenceConflict(paper.id, entry));
    elements.send.disabled = !paper || Boolean(entry?.loading) || Boolean(entry?.conversationsLoading) || sending || Boolean(active) || taskBusy || continuationReferenceConflict || Boolean(entry?.pendingDecision) || (!entry?.draft.trim() && !adapter.getChatImages(paper?.id).length && !entry?.noteRefs.length && !entry?.pendingSend);
    elements.send.textContent = t(entry?.pendingSend ? "retry" : "send");
    elements.cancel.hidden = !active;
    elements.cancel.disabled = !active || Boolean(entry?.cancelling);
    elements.cancel.textContent = t(entry?.cancelling ? "stopping" : "cancel");
    elements.new.disabled = !paper || sending || Boolean(entry?.pendingDecision);
    renderSettings();
    sourcePreparation.update(sourcePreparationModel());
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
      if (!options.taskRefresh) {
        entry.resourceRefs = !entry.draft && !entry.pendingSend ? resourceReferencesFromTurn(latestTurn(entry)) : [];
        tasks.conversationChanged(paperId, conversationId);
      }
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
    const sequence = ++entry.conversationsLoadSequence;
    entry.conversationsLoading = true;
    if (isCurrent(paperId, entry)) render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(paperId)}/agent/conversations`);
      if (sequence !== entry.conversationsLoadSequence) return;
      entry.conversations = Array.isArray(body.items) ? body.items : [];
      if (openLatest && !entry.conversationId && !entry.fresh && !entry.pendingSend && entry.conversations.length) {
        await loadConversation(paperId, entry, entry.conversations[0].id);
      }
    } catch (error) {
      if (sequence !== entry.conversationsLoadSequence) return;
      entry.status = { key: error.code || "loadFailed", kind: "error", retry: () => loadConversations(paperId, entry, true) };
    } finally {
      if (sequence === entry.conversationsLoadSequence) {
        entry.conversationsLoading = false;
        if (isCurrent(paperId, entry)) render();
      }
    }
  }

  async function send(paperId, entry) {
    if (entry.loading || entry.conversationsLoading || entry.pendingSend?.pending || activeTurn(entry)) return;
    if (!entry.pendingSend && tasks.isBusy(paperId, entry.conversationId)) {
      entry.status = { key: "agent_task_busy", kind: "error" };
      render();
      return;
    }
    if (hasContinuationReferenceConflict(paperId, entry)) {
      entry.status = { key: "referenceContinueTask", kind: "error" };
      render();
      return;
    }
    if (!entry.pendingSend) {
      const context = adapter.getContext();
      const readerAction = entry.readerActions.at(-1) || null;
      const imageIds = adapter.getChatImages(paperId).map((image) => image.id);
      const noteRefs = entry.noteRefs.map((reference) => ({ note_id: reference.note_id, revision: reference.revision }));
      const sentNoteRefs = entry.noteRefs.map((reference) => ({ pinId: reference.pinId, note_id: reference.note_id, revision: reference.revision }));
      const resourceRefs = Object.freeze(entry.resourceRefs.map(resourceReferenceWire));
      const message = entry.draft;
      if (!message.trim() && !imageIds.length && !noteRefs.length) return;
      if (!provider.configured) {
        entry.status = { key: "agent_not_configured", kind: "error" };
        render();
        return;
      }
      if (imageIds.length > 4) {
        entry.status = { key: "agent_image_limit", kind: "error" };
        render();
        return;
      }
      if (imageIds.length && !provider.image_input) {
        entry.status = { key: "agent_vision_disabled", kind: "error" };
        render();
        return;
      }
      const payload = {
        request_id: crypto.randomUUID(),
        conversation_id: entry.conversationId || null,
        message,
        context: {
          page: readerAction?.page ?? context.page,
          rect: readerAction ? [...readerAction.rect] : context.rect ? [...context.rect] : null,
          active_note_id: entry.explicitNoteContext ? null : context.activeNoteId || null,
          active_image: context.activeImage ? {
            source_kind: context.activeImage.source_kind,
            source_id: context.activeImage.source_id,
            ...(context.activeImage.annotation_id ? { annotation_id: context.activeImage.annotation_id } : {})
          } : null,
          image_ids: imageIds,
          dataset_id: adapter.getSharedDatasetId?.() || null,
          active_analysis_id: context.activeAnalysisId || null,
          active_chart_id: context.activeChartId || null,
          language,
          ...(noteRefs.length ? { note_refs: noteRefs } : {}),
          ...(resourceRefs.length ? { resource_refs: resourceRefs } : {})
        }
      };
      if (tasks.continueTaskRequested(paperId)) payload.continue_task = true;
      Object.freeze(payload.context);
      Object.freeze(payload);
      entry.pendingSend = {
        pending: false,
        noteRefs: sentNoteRefs,
        readerActionIds: entry.readerActions.map((action) => action.id),
        payload
      };
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
      entry.noteRefs = entry.noteRefs.filter((reference) => !(operation.noteRefs || []).some((sent) => sent.pinId === reference.pinId && sent.note_id === reference.note_id && sent.revision === reference.revision));
      entry.readerActions = entry.readerActions.filter((action) => !(operation.readerActionIds || []).includes(action.id));
      upsertTurn(entry, turn);
      tasks.acceptTurn(paperId, turn.conversation_id, turn);
      entry.status = null;
      if (isCurrent(paperId, entry)) render();
      loadConversations(paperId, entry, false);
      if (ACTIVE_STATES.has(turn.status)) startPolling(paperId, entry, turn.id);
    } catch (error) {
      operation.pending = false;
      let code = operation.payload.context.note_refs?.length && error.code === "not_found" ? "noteReferenceUnavailable" : error.code || "network";
      if (operation.payload.context.resource_refs?.length) {
        if (["source_changed", "dataset_changed", "reference_changed", "agent_reference_changed", "agent_reference_source_changed"].includes(error.code)) code = "resourceReferenceChanged";
        else if (["not_found", "document_trashed", "document_purged", "file_missing", "reference_unavailable", "agent_reference_unavailable", "agent_reference_missing"].includes(error.code) && code !== "noteReferenceUnavailable") code = "resourceReferenceUnavailable";
        else if (["reference_rejected", "agent_reference_rejected", "agent_reference_scope", "reference_not_paper"].includes(error.code)) code = "resourceReferenceRejected";
      }
      entry.status = { key: code, kind: "error" };
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
      entry.status = { key: approved ? ["run_analysis", "run_t_test", "run_paired_t_test", "run_correlation", "run_reference_analysis"].includes(proposal.kind) ? "analysisQueued" : proposal.kind === "cancel_analysis" ? "analysisCancelled" : proposal.kind === "create_dataset_selection" ? "selectionCreated" : "confirmed" : "rejectedDone", kind: "success" };
      if (approved) {
        await adapter.refreshAfterAgent(paperId, proposal.kind);
        const result = updated.proposals?.find((item) => item.id === proposal.id)?.result;
        const analysisId = result?.analysis_id;
        if (["run_analysis", "run_t_test", "run_paired_t_test", "run_correlation", "cancel_analysis"].includes(proposal.kind) && analysisId && adapter.getDocument()?.id === paperId) await adapter.openAnalysisJob?.(paperId, analysisId);
        const chartId = result?.chart_id || proposal.payload?.chart_id || result?.id;
        if (["create_chart", "restore_chart"].includes(proposal.kind) && chartId && adapter.getDocument()?.id === paperId) await adapter.openChart?.(paperId, chartId);
        if (proposal.kind === "create_dataset_selection") await acceptDatasetSelectionResult(paperId, entry, proposal, result);
      }
    } catch (error) {
      let retry = () => decideProposal(paperId, entry, turnId, proposal, approved);
      if (approved && ["revision_conflict", "source_changed", "note_deleted", "dataset_changed", "recipe_changed", "preview_changed", "selection_preview_changed", "selection_source_changed", "engine_unavailable", "analysis_busy", "analysis_quota", "reference_analysis_not_allowed", "reference_analysis_source_changed", "reference_analysis_dataset_changed", "reference_analysis_dataset_mismatch", "reference_analysis_unsupported_method", "reference_analysis_method_unsupported", "unsupported_method"].includes(error.code)) {
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
    if (open) {
      windowControls.show();
      elements.message.focus();
    } else {
      referencePicker.close();
      sourcePreparation.reset();
    }
    sourcePreparation.update(sourcePreparationModel());
  });
  elements.close.addEventListener("click", () => {
    referencePicker.close();
    elements.panel.hidden = true;
    elements.toggle.setAttribute("aria-expanded", "false");
    sourcePreparation.reset();
    sourcePreparation.update(sourcePreparationModel());
    elements.toggle.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.panel.hidden) {
      if (referencePicker.isOpen()) return;
      if (windowControls.exitFullPage()) {
        event.preventDefault();
        return;
      }
      referencePicker.close();
      elements.panel.hidden = true;
      elements.toggle.setAttribute("aria-expanded", "false");
      sourcePreparation.reset();
      sourcePreparation.update(sourcePreparationModel());
      elements.toggle.focus();
    }
  });
  elements.new.addEventListener("click", () => {
    const { paper, entry } = current();
    if (!paper) return;
    referencePicker.close();
    stopPolling(entry);
    entry.loadSequence += 1;
    entry.loadController?.abort();
    entry.conversationId = null;
    entry.turns = [];
    entry.fresh = true;
    entry.pendingSend = null;
    entry.resourceRefs = [];
    entry.status = null;
    sourcePreparationGeneration += 1;
    tasks.conversationChanged(paper.id, null);
    render();
    elements.message.focus();
  });
  elements.history.addEventListener("change", () => {
    const { paper, entry } = current();
    if (!paper || !elements.history.value) return;
    referencePicker.close();
    entry.conversationId = elements.history.value;
    entry.turns = [];
    entry.pendingSend = null;
    entry.resourceRefs = [];
    sourcePreparationGeneration += 1;
    tasks.conversationChanged(paper.id, entry.conversationId);
    loadConversation(paper.id, entry, entry.conversationId);
  });
  elements.message.addEventListener("input", () => {
    const { entry } = current();
    if (!entry) return;
    const previous = entry.draft;
    const next = elements.message.value;
    transformReaderActionRanges(entry, previous, next);
    entry.draft = next;
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

  void sourcePreparation.load();
  loadProvider();

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.toggle.textContent = t("assistant");
      elements.heading.textContent = t("assistant");
      elements.close.setAttribute("aria-label", t("close"));
      windowControls.applyLanguage({
        window: t("window"),
        fullPage: t("fullPage"),
        exitFullPage: t("exitFullPage"),
        resize: t("resize"),
        resizeLeft: t("resizeLeft"),
        resizeRight: t("resizeRight"),
        moveHelp: t("moveHelp"),
        resizeHelp: t("resizeHelp"),
        resizeEdgeHelp: t("resizeEdgeHelp"),
        help: t("windowHelp")
      });
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
      referencePicker.applyLanguage();
      render();
    },
    addNoteReference,
    addNoteReferences,
    prepareReaderAction,
    planAnalysis(documentId, datasetId, navigationGeneration) {
      if (adapter.getDocument()?.id !== documentId || adapter.getSelectedDatasetId?.() !== datasetId || adapter.getSharedDatasetId?.() !== datasetId || navigationGeneration !== adapter.getNavigationGeneration?.()) return false;
      const entry = entryFor(documentId);
      if (entry.draft === "") entry.draft = t("analysisPlanPrompt");
      elements.panel.hidden = false;
      elements.toggle.setAttribute("aria-expanded", "true");
      windowControls.show();
      render();
      elements.message.focus();
      return true;
    },
    documentChanged() {
      referencePicker.close();
      sourcePreparationGeneration += 1;
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
