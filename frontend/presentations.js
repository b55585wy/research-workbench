const STYLE_IDS = ["default", "nature", "cell"];
const LIMITS = { notes: 5, charts: 4, analyses: 4, slides: 8 };
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const messages = {
  zh: {
    panel: "AI 大纲与可编辑 PPT",
    help: "选择当前工作区的笔记、分析结果和图表，整理成可编辑的汇报。可直接编辑资料大纲，也可使用 AI。",
    title: "演示标题",
    titlePlaceholder: "输入 1–120 个字符",
    style: "视觉风格",
    defaultStyle: "默认",
    natureStyle: "Nature",
    cellStyle: "Cell",
    styleNote: "调整配色与版式，保留原始数据。",
    notes: "笔记",
    charts: "图表",
    analyses: "分析结果",
    noSources: "暂无可选内容。",
    missingSource: "已选来源当前不可用",
    noteSource: "已保存笔记",
    chartSource: "已保存图表",
    analysisSource: "已完成分析",
    sourceUnavailable: "当前不可用",
    page: "第 {page} 页",
    describe: "描述统计",
    ttest_independent: "独立样本 t 检验",
    ttest_paired: "配对 t 检验",
    correlation: "相关分析",
    previewContext: "预览所选来源",
    previewingContext: "正在生成来源预览…",
    contextPreview: "所选来源与完整上下文",
    contextHash: "来源 SHA-256：{hash}",
    ai: "使用 AI 生成大纲",
    generating: "正在使用 AI 生成大纲…",
    aiWarning: "只有点击“使用 AI 生成大纲”才会向当前模型服务发送以上上下文，并可能产生费用。生成会替换当前大纲；下载 PPT 不会调用 AI。",
    aiUnavailable: "当前模型不可用。仍可编辑建议大纲并下载 PPT。",
    unavailable: "PPT 功能当前不可用，请稍后重试。",
    outlineAria: "可编辑演示大纲",
    suggested: "资料大纲 · 可编辑",
    suggestedEdited: "资料大纲 · 已编辑",
    aiGenerated: "AI 生成大纲 · 请人工核对并编辑",
    aiEdited: "AI 生成大纲 · 已人工编辑",
    slide: "第 {number} 页幻灯片",
    slideTitle: "幻灯片标题",
    point: "正文 {number}",
    addPoint: "添加正文",
    removePoint: "删除此段正文",
    addSlide: "添加幻灯片",
    removeSlide: "删除此页",
    referencedChart: "引用图表",
    noChart: "不引用图表",
    referencedSources: "引用来源",
    download: "下载可编辑 PPTX",
    downloading: "正在生成 PPTX…",
    downloadNote: "下载到你的设备，可继续编辑；来源保留在附录中。",
    emptySelection: "请至少选择一条笔记、一个图表或一项已完成分析。",
    selectionLimit: "所选来源超过上限，请减少选择。",
    titleRequired: "请输入 1–120 个字符的演示标题。",
    contextRequired: "来源或设置已变化。草稿已保留，请重新预览来源。",
    contextReady: "来源预览已更新，尚未调用 AI。",
    outlineReady: "AI 大纲已生成，请核对、编辑后再下载。",
    downloaded: "可编辑 PPTX 已下载。",
    loading: "正在加载 PPT 功能与来源…",
    loadFailed: "无法加载 PPT 功能或来源，请重试。",
    contextFailed: "来源预览未完成，请重试。",
    outlineFailed: "AI 大纲未完成。草稿和请求标识已保留；不会自动重试。",
    exportFailed: "PPTX 下载未完成。大纲已保留，可重试下载，不会调用 AI。",
    invalidResponse: "服务返回的内容未通过校验，未替换当前草稿。",
    invalidOutline: "请填写每页标题，并确保正文、来源和图表引用符合限制。",
    newSlide: "新幻灯片 {number}",
    retry: "重试",
    network: "无法连接本地服务。草稿已保留。",
    request_failed: "操作未完成，请重试。",
    validation_error: "选择或大纲无效，请检查标题、正文、来源和数量限制。",
    not_found: "所选文献或来源不存在，请重新加载并核对选择。",
    source_changed: "来源已变化。草稿已保留，请重新预览来源。",
    presentation_changed: "来源已变化。草稿已保留，请重新预览来源。",
    presentation_context_too_large: "所选上下文过大，请减少笔记或来源后重试。",
    presentation_unavailable: "PPT 导出组件当前不可用。",
    presentation_ai_unavailable: "当前模型不可用，可使用建议大纲。",
    presentation_busy: "另一项大纲请求仍在处理，请稍后重试。",
    idempotency_conflict: "本次内容与已有请求不同，请重新预览来源。",
    presentation_limit: "内容超出 PPT 限制，请减少幻灯片、正文或图表数据。"
  },
  en: {
    panel: "AI outline & editable PPT",
    help: "Choose notes, analysis results, and charts from this workspace. Edit the source outline directly or use AI to draft your presentation.",
    title: "Presentation title",
    titlePlaceholder: "Enter 1–120 characters",
    style: "Visual style",
    defaultStyle: "Default",
    natureStyle: "Nature",
    cellStyle: "Cell",
    styleNote: "Adjust colors and layout while preserving the data.",
    notes: "Notes",
    charts: "Charts",
    analyses: "Analysis results",
    noSources: "No sources available yet.",
    missingSource: "Selected source is no longer available",
    noteSource: "Saved note",
    chartSource: "Saved chart",
    analysisSource: "Completed analysis",
    sourceUnavailable: "Unavailable",
    page: "Page {page}",
    describe: "Descriptive statistics",
    ttest_independent: "Independent-samples t-test",
    ttest_paired: "Paired t-test",
    correlation: "Correlation analysis",
    previewContext: "Preview selected sources",
    previewingContext: "Building source preview…",
    contextPreview: "Selected sources and full context",
    contextHash: "Source SHA-256: {hash}",
    ai: "Generate outline with AI",
    generating: "Generating outline with AI…",
    aiWarning: "The context above is sent to the configured model only when you click Generate outline with AI; charges may apply. Generation replaces the current outline. PPT download never calls AI.",
    aiUnavailable: "The model is unavailable. You can still edit and download the suggested outline.",
    unavailable: "Presentation features are currently unavailable. Try again later.",
    outlineAria: "Editable presentation outline",
    suggested: "Source outline · editable",
    suggestedEdited: "Source outline · edited",
    aiGenerated: "AI-generated outline · review and edit",
    aiEdited: "AI-generated outline · manually edited",
    slide: "Slide {number}",
    slideTitle: "Slide title",
    point: "Body {number}",
    addPoint: "Add body text",
    removePoint: "Remove this body text",
    addSlide: "Add slide",
    removeSlide: "Remove slide",
    referencedChart: "Referenced chart",
    noChart: "No chart",
    referencedSources: "Referenced source labels",
    download: "Download editable PPTX",
    downloading: "Generating PPTX…",
    downloadNote: "Download to your device and keep editing. Sources are retained in the appendix.",
    emptySelection: "Select at least one note, chart, or completed analysis.",
    selectionLimit: "Too many sources are selected. Reduce the selection.",
    titleRequired: "Enter a presentation title of 1–120 characters.",
    contextRequired: "Sources or settings changed. Your draft is retained; preview the sources again.",
    contextReady: "Source preview updated. AI has not been called.",
    outlineReady: "AI outline generated. Review and edit it before downloading.",
    downloaded: "Editable PPTX downloaded.",
    loading: "Loading presentation features and sources…",
    loadFailed: "Presentation features or sources could not be loaded. Try again.",
    contextFailed: "The source preview was not completed. Try again.",
    outlineFailed: "The AI outline was not completed. Your draft and request ID are retained; nothing was retried automatically.",
    exportFailed: "The PPTX download was not completed. Your outline is retained; retrying download does not call AI.",
    invalidResponse: "The server response failed validation. Your current draft was not replaced.",
    invalidOutline: "Enter every slide title and check body, source, and chart reference limits.",
    newSlide: "New slide {number}",
    retry: "Retry",
    network: "Cannot connect to the local service. Your draft is retained.",
    request_failed: "The action was not completed. Try again.",
    validation_error: "The selection or outline is invalid. Check titles, body text, sources, and limits.",
    not_found: "The paper or a selected source no longer exists. Reload and review the selection.",
    source_changed: "A source changed. Your draft is retained; preview the sources again.",
    presentation_changed: "A source changed. Your draft is retained; preview the sources again.",
    presentation_context_too_large: "The selected context is too large. Select fewer notes or sources.",
    presentation_unavailable: "The PPT export component is currently unavailable.",
    presentation_ai_unavailable: "The model is unavailable. The suggested outline remains available.",
    presentation_busy: "Another outline request is still running. Try again later.",
    idempotency_conflict: "This content differs from the existing request. Preview the sources again.",
    presentation_limit: "The PPT limits were exceeded. Reduce slides, body text, or chart data."
  }
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validText(value, maximum, nonempty = false) {
  return typeof value === "string" && value.length <= maximum && (!nonempty || value.trim().length > 0);
}

function validOutline(outline, sources = []) {
  if (!outline || !validText(outline.title, 120, true) || !Array.isArray(outline.slides) || outline.slides.length < 1 || outline.slides.length > LIMITS.slides) return false;
  const refs = new Set(sources.map((source) => source.ref));
  const chartIds = new Set(sources.filter((source) => source.kind === "chart").map((source) => source.id));
  return outline.slides.every((slide) => slide && validText(slide.title, 100, true) && Array.isArray(slide.body) && slide.body.length <= 5 &&
    slide.body.every((body) => validText(body, 400)) && Array.isArray(slide.source_refs) && slide.source_refs.length <= 13 &&
    new Set(slide.source_refs).size === slide.source_refs.length && slide.source_refs.every((ref) => typeof ref === "string" && refs.has(ref)) &&
    (slide.chart_id === null || typeof slide.chart_id === "string" && chartIds.has(slide.chart_id)));
}

function validSources(sources, selectors) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 13) return false;
  const expected = new Map([
    ...selectors.note_ids.map((id) => [`note:${id}`, id]),
    ...selectors.chart_ids.map((id) => [`chart:${id}`, id]),
    ...selectors.analysis_ids.map((id) => [`analysis:${id}`, id])
  ]);
  if (sources.length !== expected.size || new Set(sources.map((source) => source?.ref)).size !== sources.length) return false;
  return sources.every((source) => source && ["note", "chart", "analysis"].includes(source.kind) && UUID.test(source.id) &&
    expected.has(`${source.kind}:${source.id}`) && typeof source.ref === "string" && Boolean(source.ref) &&
    typeof source.title === "string" && Boolean(source.title.trim()));
}

function retargetOutlineRefs(outline, previousSources, nextSources) {
  const previous = new Map(previousSources.map((source) => [source.ref, source]));
  const next = new Map(nextSources.map((source) => [`${source.kind}:${source.id}`, source.ref]));
  for (const slide of outline.slides) {
    slide.source_refs = [...new Set(slide.source_refs.map((ref) => {
      const source = previous.get(ref);
      return source ? next.get(`${source.kind}:${source.id}`) : null;
    }).filter(Boolean))];
  }
}

function sourceSignature(sources) {
  const fields = ["id", "revision", "updated_at", "deleted_at", "purged", "text", "rich_html", "sha256", "source_sha256", "data_sha256", "status", "result_sha256", "created_at"];
  return JSON.stringify(Object.fromEntries(Object.entries(sources).map(([kind, items]) => [kind, items.map((item) => Object.fromEntries(fields.map((field) => [field, item[field] ?? null])))])));
}

export function createPresentations(adapter) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    panel: byId("presentations-panel"),
    help: byId("presentations-help"),
    title: byId("presentation-title"),
    style: byId("presentation-style"),
    styleNote: byId("presentations-style-note"),
    sources: byId("presentation-sources"),
    preview: byId("presentation-context-preview"),
    status: byId("presentation-status"),
    context: byId("presentation-context"),
    contextSources: byId("presentation-context-sources"),
    contextText: byId("presentation-context-text"),
    contextHash: byId("presentation-context-hash"),
    aiWarning: byId("presentation-ai-warning"),
    ai: byId("presentation-ai"),
    outline: byId("presentation-outline"),
    outlineKind: byId("presentation-outline-kind"),
    slides: byId("presentation-slides"),
    addSlide: byId("presentation-add-slide"),
    export: byId("presentation-export"),
    downloadNote: byId("presentation-download-note")
  };
  const papers = new Map();
  let currentId = null;
  let language = adapter.getLanguage();
  let capabilitiesPromise = null;

  function t(key, values = {}) {
    let text = messages[language][key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, handler, className = "button button-quiet") {
    const node = make("button", className, label);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }

  function entryFor(documentId) {
    if (!papers.has(documentId)) {
      const document = adapter.getDocument?.();
      const documentTitle = document?.id === documentId ? document.title || document.original_filename : "";
      papers.set(documentId, {
        sources: { note: [], chart: [], analysis: [] },
        sourceSignature: null,
        selected: { note: new Set(), chart: new Set(), analysis: new Set() },
        selectionExplicit: false,
        title: String(documentTitle || (language === "zh" ? "研究汇报" : "Research presentation")).slice(0, 120),
        style: "default",
        context: null,
        contextStale: false,
        contextSelectionKey: null,
        contextVersion: 0,
        outline: null,
        outlineOrigin: "suggested",
        outlineEdited: false,
        aiRequestId: null,
        capabilities: null,
        pending: null,
        operation: null,
        loadSequence: 0,
        status: null
      });
    }
    return papers.get(documentId);
  }

  function currentEntry() {
    return currentId ? entryFor(currentId) : null;
  }

  function errorKey(error, fallback) {
    const key = error?.code || error?.message || fallback;
    return Object.hasOwn(messages.en, key) ? key : fallback;
  }

  function setStatus(entry, key, kind = "info", retry = null) {
    entry.status = { key, kind, retry };
  }

  function selectors(entry) {
    return {
      title: entry.title.trim(),
      style: entry.style,
      note_ids: [...entry.selected.note],
      chart_ids: [...entry.selected.chart],
      analysis_ids: [...entry.selected.analysis]
    };
  }

  function selectionProblem(entry) {
    const selected = selectors(entry);
    const count = selected.note_ids.length + selected.chart_ids.length + selected.analysis_ids.length;
    if (!validText(selected.title, 120, true) || !STYLE_IDS.includes(selected.style)) return "titleRequired";
    if (!count) return "emptySelection";
    if (selected.note_ids.length > LIMITS.notes || selected.chart_ids.length > LIMITS.charts || selected.analysis_ids.length > LIMITS.analyses) return "selectionLimit";
    return null;
  }

  function contextCurrent(entry) {
    return Boolean(entry?.context && !entry.contextStale && SHA256.test(entry.context.source_sha256 || ""));
  }

  function invalidateContext(entry) {
    if (!entry) return;
    entry.contextVersion += 1;
    if (entry.context) entry.contextStale = true;
    entry.aiRequestId = null;
    if (entry.status?.key === "contextReady" || entry.status?.key === "outlineReady") entry.status = null;
  }

  function markSourceChanged(entry, error) {
    if (!["source_changed", "presentation_changed"].includes(error?.code || error?.message)) return;
    entry.contextStale = true;
    entry.aiRequestId = null;
  }

  function getCapabilities(force = false) {
    if (!capabilitiesPromise || force) {
      capabilitiesPromise = adapter.api("/api/v1/presentations/capabilities").then((body) => {
        if (!body || typeof body.available !== "boolean" || typeof body.ai_available !== "boolean" ||
          !Array.isArray(body.styles) || !STYLE_IDS.every((id) => body.styles.includes(id)) ||
          !Object.entries(LIMITS).every(([key, value]) => body.limits?.[key] === value)) throw new Error("invalidResponse");
        return body;
      }).catch((error) => {
        capabilitiesPromise = null;
        throw error;
      });
    }
    return capabilitiesPromise;
  }

  function sourceTitle(kind, source) {
    if (kind === "chart") return source.title || t("chartSource");
    if (kind === "analysis") return source.dataset_name || t("analysisSource");
    const text = String(source.text || "").trim();
    return text ? text.slice(0, 90) : t("noteSource");
  }

  function sourceMeta(kind, source) {
    const parts = [t(kind === "note" ? "noteSource" : kind === "chart" ? "chartSource" : "analysisSource")];
    if (kind === "note" && Number.isInteger(source.page)) parts.push(t("page", { page: source.page }));
    if (kind === "analysis") parts.push(t(source.method || "describe"));
    if (source.unavailable) parts.push(t("sourceUnavailable"));
    return parts.join(" · ");
  }

  function renderSources(entry) {
    elements.sources.replaceChildren();
    if (!entry) return;
    for (const kind of ["note", "chart", "analysis"]) {
      const fieldset = make("fieldset", "presentations-source-group");
      const labelKey = kind === "note" ? "notes" : kind === "chart" ? "charts" : "analyses";
      fieldset.append(make("legend", "", `${t(labelKey)} · ${entry.selected[kind].size}`));
      const items = [...entry.sources[kind]];
      const availableIds = new Set(items.map((item) => item.id));
      for (const id of entry.selected[kind]) {
        if (!availableIds.has(id)) items.push({ id, title: t("missingSource"), text: t("missingSource"), unavailable: true });
      }
      if (!items.length) fieldset.append(make("p", "presentations-muted", t("noSources")));
      for (const source of items) {
        const label = make("label", "presentations-source-option");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = entry.selected[kind].has(source.id);
        checkbox.disabled = Boolean(entry.pending) || entry.capabilities?.available !== true;
        checkbox.dataset.kind = kind;
        checkbox.dataset.sourceId = source.id;
        checkbox.setAttribute("aria-label", `${sourceTitle(kind, source)} · ${sourceMeta(kind, source)}`);
        checkbox.addEventListener("change", () => {
          if (entry.pending) return;
          entry.selectionExplicit = true;
          if (checkbox.checked) entry.selected[kind].add(source.id);
          else entry.selected[kind].delete(source.id);
          invalidateContext(entry);
          renderSources(entry);
          renderControls(entry);
        });
        const text = make("span", "presentations-source-label", sourceTitle(kind, source));
        text.append(make("span", "presentations-source-meta", sourceMeta(kind, source)));
        label.append(checkbox, text);
        fieldset.append(label);
      }
      elements.sources.append(fieldset);
    }
  }

  function renderStatus(entry) {
    elements.status.replaceChildren();
    let status = entry?.status;
    if (!status && entry?.capabilities?.available === false) status = { key: "unavailable", kind: "error" };
    if (!status && entry?.contextStale) status = { key: "contextRequired", kind: "error" };
    const problem = entry && !entry.pending && entry.capabilities?.available === true ? selectionProblem(entry) : null;
    if (!status && problem) status = { key: problem, kind: problem === "emptySelection" ? "info" : "error" };
    if (!status) {
      delete elements.status.dataset.kind;
      return;
    }
    elements.status.dataset.kind = status.kind || "info";
    elements.status.append(make("span", "", t(status.key)));
    if (status.retry) elements.status.append(button(t("retry"), status.retry, "status-retry"));
  }

  function renderContext(entry) {
    const context = entry?.context;
    elements.context.hidden = !context;
    elements.contextSources.replaceChildren();
    elements.contextText.textContent = context?.text || "";
    elements.contextHash.textContent = context ? t("contextHash", { hash: context.source_sha256 }) : "";
    for (const source of context?.sources || []) {
      const item = make("li", "", `${source.ref} · ${source.title}`);
      item.append(make("span", "presentations-source-meta", `${source.kind} · ${source.id}`));
      elements.contextSources.append(item);
    }
  }

  function outlineBadge(entry) {
    if (entry.outlineOrigin === "ai") return t(entry.outlineEdited ? "aiEdited" : "aiGenerated");
    return t(entry.outlineEdited ? "suggestedEdited" : "suggested");
  }

  function markOutlineEdited(entry) {
    entry.outlineEdited = true;
    elements.outlineKind.textContent = outlineBadge(entry);
    const valid = validOutline(entry.outline, entry.context?.sources);
    if (!valid) setStatus(entry, "invalidOutline", "error");
    else if (entry.status?.key === "invalidOutline") entry.status = null;
    elements.export.disabled = Boolean(entry.pending) || !contextCurrent(entry) || !valid;
    renderStatus(entry);
  }

  function renderSlides(entry) {
    elements.slides.replaceChildren();
    const outline = entry?.outline;
    if (!outline) return;
    const sources = entry.context?.sources || [];
    const charts = sources.filter((source) => source.kind === "chart");
    outline.slides.forEach((slide, slideIndex) => {
      const fieldset = make("fieldset", "presentations-slide");
      fieldset.dataset.slideIndex = String(slideIndex);
      fieldset.append(make("legend", "", t("slide", { number: slideIndex + 1 })));
      const titleLabel = make("label", "presentations-field", t("slideTitle"));
      const title = document.createElement("input");
      title.className = "presentations-slide-title";
      title.type = "text";
      title.maxLength = 100;
      title.required = true;
      title.value = slide.title;
      title.disabled = Boolean(entry.pending);
      title.addEventListener("input", () => {
        slide.title = title.value;
        markOutlineEdited(entry);
      });
      titleLabel.append(title);
      fieldset.append(titleLabel);
      slide.body.forEach((body, bodyIndex) => {
        const point = make("div", "presentations-slide-point");
        const label = make("label", "", t("point", { number: bodyIndex + 1 }));
        const textarea = document.createElement("textarea");
        textarea.maxLength = 400;
        textarea.rows = 3;
        textarea.value = body;
        textarea.disabled = Boolean(entry.pending);
        textarea.addEventListener("input", () => {
          slide.body[bodyIndex] = textarea.value;
          markOutlineEdited(entry);
        });
        label.append(textarea);
        const actions = make("div", "presentations-slide-actions");
        const remove = button(t("removePoint"), () => {
          slide.body.splice(bodyIndex, 1);
          entry.outlineEdited = true;
          renderSlides(entry);
          renderControls(entry);
        });
        remove.disabled = Boolean(entry.pending);
        actions.append(remove);
        point.append(label, actions);
        fieldset.append(point);
      });
      const pointActions = make("div", "presentations-slide-actions");
      const addPoint = button(t("addPoint"), () => {
        slide.body.push("");
        entry.outlineEdited = true;
        renderSlides(entry);
        renderControls(entry);
      });
      addPoint.disabled = Boolean(entry.pending) || slide.body.length >= 5;
      pointActions.append(addPoint);
      if (outline.slides.length > 1) {
        const removeSlide = button(t("removeSlide"), () => {
          outline.slides.splice(slideIndex, 1);
          entry.outlineEdited = true;
          renderSlides(entry);
          renderControls(entry);
        });
        removeSlide.disabled = Boolean(entry.pending);
        pointActions.append(removeSlide);
      }
      fieldset.append(pointActions);
      const chartLabel = make("label", "presentations-field", t("referencedChart"));
      const chart = document.createElement("select");
      chart.className = "presentations-slide-chart";
      chart.disabled = Boolean(entry.pending);
      chart.append(new Option(t("noChart"), ""));
      for (const source of charts) chart.append(new Option(`${source.ref} · ${source.title}`, source.id));
      chart.value = slide.chart_id || "";
      chart.addEventListener("change", () => {
        slide.chart_id = chart.value || null;
        markOutlineEdited(entry);
      });
      chartLabel.append(chart);
      fieldset.append(chartLabel);
      const sourceBox = make("div", "presentations-slide-sources", t("referencedSources"));
      const refs = make("div", "presentations-ref-list");
      for (const source of sources) {
        const label = make("label", "presentations-ref-option");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = slide.source_refs.includes(source.ref);
        checkbox.disabled = Boolean(entry.pending);
        checkbox.addEventListener("change", () => {
          const selected = new Set(slide.source_refs);
          if (checkbox.checked) selected.add(source.ref);
          else selected.delete(source.ref);
          slide.source_refs = [...selected];
          markOutlineEdited(entry);
        });
        label.append(checkbox, make("span", "", `${source.ref} · ${source.title}`));
        refs.append(label);
      }
      sourceBox.append(refs);
      fieldset.append(sourceBox);
      elements.slides.append(fieldset);
    });
  }

  function renderControls(entry) {
    const pending = Boolean(entry?.pending);
    const problem = entry ? selectionProblem(entry) : "emptySelection";
    elements.title.disabled = !entry || pending;
    elements.style.disabled = !entry || pending;
    elements.preview.disabled = !entry || pending || entry.capabilities?.available !== true || Boolean(problem);
    elements.preview.textContent = t(entry?.pending === "context" ? "previewingContext" : "previewContext");
    elements.ai.disabled = !entry || pending || !contextCurrent(entry) || entry.capabilities?.ai_available !== true;
    elements.ai.textContent = t(entry?.pending === "outline" ? "generating" : "ai");
    elements.aiWarning.textContent = t(entry?.capabilities && !entry.capabilities.ai_available ? "aiUnavailable" : "aiWarning");
    elements.outline.hidden = !entry?.outline;
    elements.outlineKind.textContent = entry?.outline ? outlineBadge(entry) : "";
    elements.addSlide.disabled = !entry?.outline || pending || entry.outline.slides.length >= LIMITS.slides;
    elements.export.disabled = !entry?.outline || pending || entry.capabilities?.available !== true || !contextCurrent(entry) || !validOutline(entry.outline, entry.context?.sources);
    elements.export.textContent = t(entry?.pending === "export" ? "downloading" : "download");
    renderStatus(entry);
  }

  function render() {
    const entry = currentEntry();
    if (elements.title.value !== (entry?.title || "")) elements.title.value = entry?.title || "";
    elements.style.value = entry?.style || "default";
    renderSources(entry);
    renderContext(entry);
    renderSlides(entry);
    renderControls(entry);
  }

  function applyDefaultSelection(entry, documentId) {
    if (entry.selectionExplicit) return;
    for (const kind of ["note", "chart", "analysis"]) entry.selected[kind].clear();
    const current = adapter.getDataSelection?.() || {};
    if (current.datasetId) return;
    const analysisId = current.analysisId || (!current.chartId ? adapter.getSelectedAnalysis?.(documentId)?.id : null);
    const chartId = current.chartId || (!current.analysisId ? adapter.getCurrentChart?.(documentId)?.id : null);
    if (chartId && entry.sources.chart.some((item) => item.id === chartId)) entry.selected.chart.add(chartId);
    else if (analysisId && entry.sources.analysis.some((item) => item.id === analysisId && item.status === "succeeded")) entry.selected.analysis.add(analysisId);
  }

  async function reload(documentId) {
    currentId = documentId || null;
    const entry = currentEntry();
    if (!entry) {
      render();
      return;
    }
    const sequence = ++entry.loadSequence;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    setStatus(entry, "loading");
    render();
    const base = `/api/v1/documents/${encodeURIComponent(documentId)}`;
    const [capabilities, notes, charts, analyses] = await Promise.allSettled([
      getCapabilities(),
      adapter.api(`${base}/note-states`),
      adapter.api(`${base}/charts`),
      adapter.api(`${base}/analyses`)
    ]);
    if (sequence !== entry.loadSequence || entry !== currentEntry() || navigationGeneration !== adapter.getNavigationGeneration?.()) return;
    const nextSources = {
      note: notes.status === "fulfilled" && Array.isArray(notes.value.items) ? notes.value.items.filter((item) => !item.deleted_at && !item.purged) : entry.sources.note,
      chart: charts.status === "fulfilled" && Array.isArray(charts.value.items) ? charts.value.items.filter((item) => !item.deleted_at) : entry.sources.chart,
      analysis: analyses.status === "fulfilled" && Array.isArray(analyses.value.items) ? analyses.value.items.filter((item) => item.status === "succeeded") : entry.sources.analysis
    };
    const signature = sourceSignature(nextSources);
    if (entry.sourceSignature !== null && signature !== entry.sourceSignature) invalidateContext(entry);
    entry.sources = nextSources;
    entry.sourceSignature = signature;
    if (capabilities.status === "fulfilled") entry.capabilities = capabilities.value;
    applyDefaultSelection(entry, documentId);
    const failed = [capabilities, notes, charts, analyses].find((result) => result.status === "rejected");
    if (failed) setStatus(entry, errorKey(failed.reason, "loadFailed"), "error", () => reload(documentId));
    else if (entry.status?.key === "loading") entry.status = null;
    render();
  }

  function validateContextResponse(body, selected) {
    if (!body || !SHA256.test(body.source_sha256 || "") || typeof body.text !== "string" || body.text.length > 18000 ||
      !validSources(body.sources, selected) || !validOutline(body.suggested_outline, body.sources)) throw new Error("invalidResponse");
  }

  async function previewContext(entry) {
    if (!entry || entry.pending || selectionProblem(entry) || entry.capabilities?.available !== true) return;
    const documentId = currentId;
    const selected = selectors(entry);
    const selectionKey = JSON.stringify(selected);
    const version = entry.contextVersion;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const operation = { kind: "context" };
    entry.operation = operation;
    entry.pending = "context";
    setStatus(entry, "previewingContext");
    render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/presentations/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected)
      });
      validateContextResponse(body, selected);
      if (entry.operation !== operation || version !== entry.contextVersion || navigationGeneration !== adapter.getNavigationGeneration?.()) return;
      const previousHash = entry.context?.source_sha256;
      const previousSources = entry.context?.sources || [];
      const replaceOutline = !entry.outline || entry.contextSelectionKey !== selectionKey;
      entry.context = { source_sha256: body.source_sha256, sources: clone(body.sources), text: body.text };
      entry.contextStale = false;
      entry.contextSelectionKey = selectionKey;
      if (previousHash !== body.source_sha256) entry.aiRequestId = null;
      if (replaceOutline) {
        entry.outline = clone(body.suggested_outline);
        entry.outline.title = entry.title.trim();
        entry.outlineOrigin = "suggested";
        entry.outlineEdited = false;
      } else {
        retargetOutlineRefs(entry.outline, previousSources, body.sources);
      }
      setStatus(entry, "contextReady", "success");
    } catch (error) {
      markSourceChanged(entry, error);
      if (entry.operation === operation && version === entry.contextVersion) setStatus(entry, errorKey(error, "contextFailed"), "error", () => previewContext(entry));
    } finally {
      if (entry.operation === operation) {
        entry.operation = null;
        entry.pending = null;
      }
      if (entry === currentEntry()) render();
    }
  }

  async function generateOutline(entry) {
    if (!entry || entry.pending || !contextCurrent(entry) || entry.capabilities?.ai_available !== true) return;
    const documentId = currentId;
    const version = entry.contextVersion;
    const sourceHash = entry.context.source_sha256;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    if (!entry.aiRequestId) entry.aiRequestId = crypto.randomUUID();
    const operation = { kind: "outline" };
    entry.operation = operation;
    entry.pending = "outline";
    setStatus(entry, "generating");
    render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(documentId)}/presentations/outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selectors(entry), source_sha256: sourceHash, request_id: entry.aiRequestId, confirmed: true })
      });
      if (!body || body.ai_generated !== true || body.source_sha256 !== sourceHash || !validSources(body.sources, selectors(entry)) || !validOutline(body.outline, body.sources)) throw new Error("invalidResponse");
      if (entry.operation !== operation || version !== entry.contextVersion || entry.context?.source_sha256 !== sourceHash || navigationGeneration !== adapter.getNavigationGeneration?.()) return;
      entry.outline = clone(body.outline);
      entry.outline.title = entry.title.trim();
      entry.outlineOrigin = "ai";
      entry.outlineEdited = false;
      setStatus(entry, "outlineReady", "success");
    } catch (error) {
      markSourceChanged(entry, error);
      const stale = ["source_changed", "presentation_changed"].includes(error?.code || error?.message);
      if (entry.operation === operation && version === entry.contextVersion) setStatus(entry, errorKey(error, "outlineFailed"), "error", stale ? () => previewContext(entry) : () => generateOutline(entry));
    } finally {
      if (entry.operation === operation) {
        entry.operation = null;
        entry.pending = null;
      }
      if (entry === currentEntry()) render();
    }
  }

  function downloadName(title) {
    const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().slice(0, 80);
    return `${safe || "presentation"}.pptx`;
  }

  async function exportPresentation(entry) {
    if (!entry || entry.pending || !contextCurrent(entry) || entry.capabilities?.available !== true || !validOutline(entry.outline, entry.context.sources)) return;
    const documentId = currentId;
    const version = entry.contextVersion;
    const sourceHash = entry.context.source_sha256;
    const navigationGeneration = adapter.getNavigationGeneration?.();
    const operation = { kind: "export" };
    entry.operation = operation;
    entry.pending = "export";
    setStatus(entry, "downloading");
    render();
    try {
      const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}/presentations/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selectors(entry), source_sha256: sourceHash, outline: clone(entry.outline) })
      });
      const mime = String(response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
      const blob = await response.blob();
      if (mime !== PPTX_MIME || !blob.size || blob.size > 20 * 1024 * 1024) throw new Error("invalidResponse");
      if (entry.operation !== operation || version !== entry.contextVersion || navigationGeneration !== adapter.getNavigationGeneration?.() || currentId !== documentId) return;
      const url = URL.createObjectURL(blob);
      const link = make("a");
      link.href = url;
      link.download = downloadName(entry.outline.title);
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(entry, "downloaded", "success");
    } catch (error) {
      markSourceChanged(entry, error);
      const stale = ["source_changed", "presentation_changed"].includes(error?.code || error?.message);
      if (entry.operation === operation && version === entry.contextVersion) setStatus(entry, errorKey(error, "exportFailed"), "error", stale ? () => previewContext(entry) : () => exportPresentation(entry));
    } finally {
      if (entry.operation === operation) {
        entry.operation = null;
        entry.pending = null;
      }
      if (entry === currentEntry()) render();
    }
  }

  elements.title.addEventListener("input", () => {
    const entry = currentEntry();
    if (!entry || entry.pending) return;
    entry.title = elements.title.value;
    if (entry.outline) {
      entry.outline.title = elements.title.value;
      entry.outlineEdited = true;
    }
    invalidateContext(entry);
    renderControls(entry);
  });
  elements.style.addEventListener("change", () => {
    const entry = currentEntry();
    if (!entry || entry.pending) return;
    entry.style = STYLE_IDS.includes(elements.style.value) ? elements.style.value : "default";
    invalidateContext(entry);
    renderControls(entry);
  });
  elements.preview.addEventListener("click", () => previewContext(currentEntry()));
  elements.ai.addEventListener("click", () => generateOutline(currentEntry()));
  elements.export.addEventListener("click", () => exportPresentation(currentEntry()));
  elements.addSlide.addEventListener("click", () => {
    const entry = currentEntry();
    if (!entry?.outline || entry.pending || entry.outline.slides.length >= LIMITS.slides) return;
    entry.outline.slides.push({ title: t("newSlide", { number: entry.outline.slides.length + 1 }), body: [], source_refs: [], chart_id: null });
    entry.outlineEdited = true;
    renderSlides(entry);
    renderControls(entry);
  });
  elements.panel.addEventListener("toggle", () => {
    if (elements.panel.open && currentId) reload(currentId);
  });

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      elements.panel.querySelector("summary").textContent = t("panel");
      elements.help.textContent = t("help");
      document.querySelector('label[for="presentation-title"]').firstChild.textContent = t("title");
      elements.title.placeholder = t("titlePlaceholder");
      document.querySelector('label[for="presentation-style"]').firstChild.textContent = t("style");
      for (const id of STYLE_IDS) elements.style.querySelector(`option[value="${id}"]`).textContent = t(`${id}Style`);
      elements.styleNote.textContent = t("styleNote");
      elements.context.querySelector("summary").textContent = t("contextPreview");
      elements.outline.setAttribute("aria-label", t("outlineAria"));
      elements.addSlide.textContent = t("addSlide");
      elements.downloadNote.textContent = t("downloadNote");
      render();
    },
    reload,
    sourcesChanged(documentId) {
      if (currentId === documentId && elements.panel.open) return reload(documentId);
      return null;
    },
    hasPending(documentId) {
      return Boolean(documentId && papers.get(documentId)?.pending);
    }
  };
}
