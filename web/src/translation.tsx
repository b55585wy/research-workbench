import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

type TranslationLanguage = "zh" | "en";
type TargetLanguage = "zh" | "en";
type TranslationMode = "original" | "dual" | "translated";
type OverlayStatus = { documentId: string; sourceSha256: string; jobId: string; page: number; kind: "partial" | "unavailable" };
type JobStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";

interface TranslationDocument {
  id: string;
  sha256: string;
  pageCount: number;
}

export interface TranslationPanelModel {
  language: TranslationLanguage;
  open: boolean;
  reading: boolean;
  document: TranslationDocument | null;
  currentPage: number;
}

interface TranslationCapabilities {
  ready: boolean;
  parser_ready: boolean;
  model_ready: boolean;
  reason: string | null;
  max_pages: number;
  target_languages: TargetLanguage[];
}

interface TranslationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TranslationBlock {
  id: string;
  kind: "text" | "title" | "caption" | "formula" | "image" | "table" | "code" | "other";
  order: number;
  rect: TranslationRect | null;
  source_text: string;
  translated_text: string | null;
}

interface TranslationResultPage {
  page: number;
  status: "completed" | "unavailable" | "failed";
  warning: string | null;
  blocks: TranslationBlock[];
}

interface TranslationJob {
  id: string;
  document_id: string;
  source_sha256: string;
  pages: number[];
  target_language: TargetLanguage;
  status: JobStatus;
  stage: "queued" | "parsing" | "translating" | "finished";
  completed_pages: number;
  total_pages: number;
  created_at: string;
  updated_at: string;
  error: null | { code: string; message: string };
  result_pages: TranslationResultPage[];
}

interface TranslationRequest {
  documentId: string;
  sourceSha256: string;
  payload: {
    request_id: string;
    source_sha256: string;
    pages: number[];
    target_language: TargetLanguage;
  };
}

export interface TranslationPanelCallbacks {
  api: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
  onOpenChange: (open: boolean) => void;
  goToSource: (page: number, rect: TranslationRect | null, expectedDocumentId: string, expectedSourceSha256: string) => void | boolean | Promise<void | boolean>;
  onOpenSettings: () => void;
}

export interface MountTranslationPanelOptions {
  controlsContainer: HTMLElement;
  panelContainer: HTMLElement;
  model: TranslationPanelModel;
  callbacks: TranslationPanelCallbacks;
  onMounted?: () => void;
}

export interface TranslationPanelHandle {
  update: (model: TranslationPanelModel) => boolean;
  destroy: () => void;
}

interface TranslationRegistration {
  controlsContainer: HTMLElement;
  panelContainer: HTMLElement;
  root: Root;
  callbacks: TranslationPanelCallbacks;
  active: boolean;
}

const controlsOwners = new WeakMap<HTMLElement, TranslationRegistration>();
const panelOwners = new WeakMap<HTMLElement, TranslationRegistration>();
const activeStatuses = new Set<JobStatus>(["queued", "running"]);

const strings = {
  zh: {
    translate: "翻译页面",
    translation: "译文",
    readingMode: "阅读模式",
    originalMode: "原文",
    dualMode: "双栏",
    translatedMode: "译文",
    showDual: "在双栏中查看",
    noSavedTranslation: "没有可用的已保存译文。",
    currentPageAbsent: "当前页不在这条已完成的翻译记录中。",
    stillTranslating: "翻译仍在进行；已完成的页面可以切换显示。",
    partialOverlay: "当前页部分内容未覆盖，原文已保留。",
    unavailableOverlay: "当前页无法安全覆盖，已保留原文。",
    close: "关闭翻译栏",
    currentPage: "当前页",
    selectedPages: "指定页面",
    pagesLabel: "页码（最多 5 页）",
    pagesPlaceholder: "例如 1,3-5",
    targetLanguage: "翻译为",
    chinese: "中文",
    english: "英文",
    start: "开始翻译",
    starting: "正在提交…",
    retryRequest: "重试同一请求",
    loading: "正在读取翻译设置和已保存记录…",
    unavailable: "翻译暂不可用。",
    openSettings: "打开模型设置",
    savedRuns: "已保存的翻译",
    noSavedRuns: "暂无已保存翻译",
    loadRunFailed: "无法打开这条翻译记录，请重试。",
    listFailed: "无法读取已保存的翻译。",
    capabilitiesFailed: "无法读取翻译设置。",
    network: "无法连接本地服务。请求可能已提交；请使用相同请求重试。",
    requestFailed: "翻译请求未完成，请重试。",
    invalidPages: "请输入 1 至 5 个不重复的有效页码，例如 1,3-5。",
    pageRange: (pages: string, count: number) => `第 ${pages} 页 · 共 ${count} 页`,
    queued: "排队中",
    running: "翻译中",
    completed: "已完成",
    partial: "部分完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
    parsing: "正在解析原文",
    translating: "正在翻译",
    finished: "处理已结束",
    progress: (completed: number, total: number) => `已完成 ${completed} / ${total} 页`,
    cancel: "取消翻译",
    cancelling: "正在取消…",
    cancelFailed: "取消请求未完成，请重试。",
    retryJob: "重新翻译",
    pollFailed: "进度暂时无法刷新，将自动重试。",
    original: "查看原文",
    originalBlock: "原文位置",
    page: (page: number) => `第 ${page} 页`,
    noText: "此页没有可翻译的文字，可能是扫描页或空页。",
    pageUnavailable: "此页无法提供译文。",
    pageFailed: "此页翻译失败。",
    formula: "公式保留在原文中",
    image: "图片保留在原文中",
    table: "表格保留在原文中",
    other: "非文字内容保留在原文中",
    missingTranslation: "此段没有可用译文",
    visualNotice: "公式、图片和其他非文字内容不会被臆译；请通过原文链接核对。",
    noResults: "这条记录还没有可显示的译文。",
    empty: "选择当前页或最多 5 个页面，然后开始翻译。已有记录不会自动重新运行。",
    ready: "原文保持在左侧，译文按原页码显示在右侧。",
    jobError: "翻译未完成。",
    retryHint: "网络结果不确定时会保留同一请求标识，避免重复创建任务。",
    sourceLanguage: (language: TargetLanguage) => language === "zh" ? "中文" : "英文"
  },
  en: {
    translate: "Translate pages",
    translation: "Translation",
    readingMode: "Reading mode",
    originalMode: "Original",
    dualMode: "Dual",
    translatedMode: "Translated",
    showDual: "View in dual mode",
    noSavedTranslation: "No saved translation is available.",
    currentPageAbsent: "The current page is not in this completed translation.",
    stillTranslating: "Translation is still running; completed pages can be displayed.",
    partialOverlay: "Some content on this page was not overlaid; the original remains visible.",
    unavailableOverlay: "This page cannot be safely overlaid; the original remains visible.",
    close: "Close translation panel",
    currentPage: "Current page",
    selectedPages: "Selected pages",
    pagesLabel: "Pages (up to 5)",
    pagesPlaceholder: "For example, 1,3-5",
    targetLanguage: "Translate into",
    chinese: "Chinese",
    english: "English",
    start: "Start translation",
    starting: "Submitting…",
    retryRequest: "Retry same request",
    loading: "Loading translation settings and saved runs…",
    unavailable: "Translation is currently unavailable.",
    openSettings: "Open model settings",
    savedRuns: "Saved translations",
    noSavedRuns: "No saved translations",
    loadRunFailed: "This saved translation could not be opened. Try again.",
    listFailed: "Saved translations could not be loaded.",
    capabilitiesFailed: "Translation settings could not be loaded.",
    network: "The local service could not be reached. The request may have been submitted; retry the same request.",
    requestFailed: "The translation request was not completed. Try again.",
    invalidPages: "Enter 1 to 5 distinct valid pages, for example 1,3-5.",
    pageRange: (pages: string, count: number) => `Pages ${pages} · ${count} total`,
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    partial: "Partially completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
    parsing: "Parsing the original",
    translating: "Translating",
    finished: "Processing finished",
    progress: (completed: number, total: number) => `${completed} of ${total} pages completed`,
    cancel: "Cancel translation",
    cancelling: "Cancelling…",
    cancelFailed: "The cancellation request was not completed. Try again.",
    retryJob: "Translate again",
    pollFailed: "Progress could not be refreshed and will be retried automatically.",
    original: "View original",
    originalBlock: "Original location",
    page: (page: number) => `Page ${page}`,
    noText: "No translatable text was found on this page. It may be scanned or empty.",
    pageUnavailable: "A translation is unavailable for this page.",
    pageFailed: "This page could not be translated.",
    formula: "Formula kept in the original",
    image: "Figure kept in the original",
    table: "Table kept in the original",
    other: "Non-text content kept in the original",
    missingTranslation: "No translation is available for this paragraph",
    visualNotice: "Formulas, figures, and other non-text content are not invented. Use the original links to inspect them.",
    noResults: "This run has no translated pages to display yet.",
    empty: "Choose the current page or up to 5 pages, then start. Saved runs are never rerun automatically.",
    ready: "The original stays on the left, with translated paragraphs organized by original page on the right.",
    jobError: "The translation was not completed.",
    retryHint: "If the network result is uncertain, the same request ID is retained to avoid duplicate jobs.",
    sourceLanguage: (language: TargetLanguage) => language === "zh" ? "Chinese" : "English"
  }
} as const;

type Copy = (typeof strings)["en"] | (typeof strings)["zh"];

function isActive(job: TranslationJob | null) {
  return Boolean(job && activeStatuses.has(job.status));
}

function formatPages(pages: number[]) {
  return pages.join(", ");
}

function parsePages(value: string, pageCount: number, maxPages: number) {
  const pages = new Set<number>();
  const normalized = value.trim().replaceAll(/[，、]/g, ",").replaceAll(/[–—]/g, "-");
  if (!normalized) return null;
  for (const part of normalized.split(",")) {
    const token = part.trim();
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) return null;
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > pageCount) return null;
    if (last - first + 1 > maxPages) return null;
    for (let page = first; page <= last; page += 1) pages.add(page);
    if (pages.size > maxPages) return null;
  }
  return pages.size ? [...pages].sort((a, b) => a - b) : null;
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code;
  return "request_failed";
}

function isAbort(error: unknown) {
  return typeof error === "object" && error && "name" in error && error.name === "AbortError";
}

function jobInScope(value: unknown, document: TranslationDocument): value is TranslationJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<TranslationJob>;
  return typeof job.id === "string"
    && job.document_id === document.id
    && job.source_sha256 === document.sha256
    && Array.isArray(job.pages)
    && job.pages.every((page) => Number.isInteger(page))
    && [
      "queued", "running", "completed", "partial", "failed", "cancelled", "interrupted"
    ].includes(job.status as JobStatus);
}

function jobResults(job: TranslationJob) {
  return Array.isArray(job.result_pages) ? job.result_pages : [];
}

function frozenCompletedPages(job: TranslationJob) {
  return Object.freeze(jobResults(job).filter((page) => page.status === "completed").map((page) => Object.freeze({
    ...page,
    blocks: Object.freeze((Array.isArray(page.blocks) ? page.blocks : []).map((block) => Object.freeze({
      ...block,
      rect: block.rect ? Object.freeze({ ...block.rect }) : null
    })))
  })));
}

function upsertJob(items: TranslationJob[], job: TranslationJob) {
  return [job, ...items.filter((item) => item.id !== job.id)]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
}

function runLabel(job: TranslationJob, copy: Copy, language: TranslationLanguage) {
  const date = new Date(job.created_at);
  const timestamp = Number.isFinite(date.getTime()) ? date.toLocaleString(language === "zh" ? "zh-CN" : "en") : "";
  return `${formatPages(job.pages)} · ${copy.sourceLanguage(job.target_language)} · ${copy[job.status]}${timestamp ? ` · ${timestamp}` : ""}`;
}

function BlockView({ block, page, copy, onSource }: {
  block: TranslationBlock;
  page: number;
  copy: Copy;
  onSource: (page: number, rect: TranslationRect | null) => void;
}) {
  const translatable = block.kind === "text" || block.kind === "title" || block.kind === "caption";
  const translated = translatable && typeof block.translated_text === "string" && block.translated_text.trim()
    ? block.translated_text
    : null;
  const marker = translatable
    ? copy.missingTranslation
    : block.kind === "formula"
      ? copy.formula
      : block.kind === "image"
        ? copy.image
        : block.kind === "table"
          ? copy.table
          : copy.other;
  return (
    <div className={`translation-block translation-block-${block.kind}`}>
      {translated
        ? <p className={block.kind === "title" ? "translation-translated-title" : "translation-paragraph"}>{translated}</p>
        : <p className="translation-original-marker">{marker}</p>}
      {block.rect && (
        <button className="translation-source-link" type="button" onClick={() => onSource(page, block.rect)}>
          {copy.originalBlock}
        </button>
      )}
    </div>
  );
}

function TranslationResults({ job, copy, onSource }: {
  job: TranslationJob;
  copy: Copy;
  onSource: (page: number, rect: TranslationRect | null) => void;
}) {
  const pages = [...jobResults(job)].sort((a, b) => a.page - b.page);
  const hasVisuals = pages.some((page) => Array.isArray(page.blocks) && page.blocks.some((block) => !["text", "title", "caption"].includes(block.kind)));
  if (!pages.length) return <p className="translation-empty">{copy.noResults}</p>;
  return (
    <div className="translation-results">
      {hasVisuals && <p className="translation-visual-notice">{copy.visualNotice}</p>}
      {pages.map((page) => {
        const blocks = Array.isArray(page.blocks) ? [...page.blocks].sort((a, b) => a.order - b.order) : [];
        return (
          <section className="translation-result-page" key={page.page} aria-labelledby={`translation-page-${job.id}-${page.page}`}>
            <header className="translation-page-header">
              <h3 id={`translation-page-${job.id}-${page.page}`}>{copy.page(page.page)}</h3>
              <button className="translation-source-link" type="button" onClick={() => onSource(page.page, null)}>
                {copy.original}
              </button>
            </header>
            {page.warning && <p className="translation-page-warning">{page.warning}</p>}
            {page.status !== "completed" && (
              <p className="translation-page-warning">{copy[page.status === "failed" ? "pageFailed" : "pageUnavailable"]}</p>
            )}
            {!blocks.length && page.status === "completed" && <p className="translation-empty">{copy.noText}</p>}
            {blocks.map((block) => <BlockView block={block} page={page.page} copy={copy} onSource={onSource} key={block.id} />)}
          </section>
        );
      })}
    </div>
  );
}

function TranslationExperience({ model, callbacks, controlsContainer, panelContainer }: {
  model: TranslationPanelModel;
  callbacks: TranslationPanelCallbacks;
  controlsContainer: HTMLElement;
  panelContainer: HTMLElement;
}) {
  const copy = strings[model.language];
  const document = model.document;
  const documentKey = document ? `${document.id}:${document.sha256}` : null;
  const [mode, setMode] = useState<TranslationMode>("dual");
  const [overlayStatus, setOverlayStatus] = useState<OverlayStatus | null>(null);
  const activeScope = model.reading && document ? documentKey : null;
  const scopeRef = useRef(activeScope);
  scopeRef.current = activeScope;
  const generationRef = useRef(0);
  const scopeControllerRef = useRef<AbortController | null>(null);
  const jobActionRef = useRef(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [capabilities, setCapabilities] = useState<TranslationCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<TranslationJob | null>(null);
  const [selectionMode, setSelectionMode] = useState<"current" | "pages">("current");
  const [pageInput, setPageInput] = useState(String(model.currentPage || 1));
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>(model.language);
  const [requestDraft, setRequestDraft] = useState<TranslationRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<"start" | "cancel" | "open" | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const visibleJob = activeScope && document && selectedJob && jobInScope(selectedJob, document) ? selectedJob : null;

  useEffect(() => {
    generationRef.current += 1;
    scopeControllerRef.current?.abort();
    setMode("dual");
    setOverlayStatus(null);
    setCapabilities(null);
    setCapabilitiesError(null);
    setJobs([]);
    setJobsError(null);
    setSelectedJob(null);
    setSelectionMode("current");
    setPageInput(String(model.currentPage || 1));
    setTargetLanguage(model.language);
    setRequestDraft(null);
    setPendingAction(null);
    setOperationError(null);
    setPollError(false);
  }, [documentKey]);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<OverlayStatus | null>).detail;
      if (!detail) {
        setOverlayStatus(null);
        return;
      }
      if (mode === "translated" && document && visibleJob
        && detail.documentId === document.id && detail.sourceSha256 === document.sha256
        && detail.jobId === visibleJob.id && detail.page === model.currentPage
        && ["partial", "unavailable"].includes(detail.kind)) setOverlayStatus(detail);
    };
    controlsContainer.addEventListener("translation-overlay-status", handleStatus);
    return () => controlsContainer.removeEventListener("translation-overlay-status", handleStatus);
  }, [controlsContainer, documentKey, visibleJob?.id, model.currentPage, mode]);

  useEffect(() => {
    setOverlayStatus(null);
    const snapshot = model.reading && document ? Object.freeze({
      mode,
      documentId: document.id,
      sourceSha256: document.sha256,
      jobId: mode === "translated" && visibleJob ? visibleJob.id : "",
      currentPage: model.currentPage,
      language: model.language,
      resultPages: mode === "translated" && visibleJob ? frozenCompletedPages(visibleJob) : Object.freeze([])
    }) : null;
    controlsContainer.dispatchEvent(new CustomEvent("translation-presentation-change", { detail: snapshot }));
  }, [controlsContainer, mode, documentKey, visibleJob, model.reading, model.currentPage, model.language]);

  useEffect(() => () => {
    controlsContainer.dispatchEvent(new CustomEvent("translation-presentation-change", { detail: null }));
  }, [controlsContainer]);

  useEffect(() => {
    const ticket = ++generationRef.current;
    scopeControllerRef.current?.abort();
    const controller = new AbortController();
    scopeControllerRef.current = controller;
    setPendingAction(null);
    setOperationError(null);
    setPollError(false);
    if (!activeScope || !document) {
      setCapabilities(null);
      return () => {
        controller.abort();
      };
    }
    const scope = activeScope;
    const scopeDocument = document;
    const current = () => generationRef.current === ticket && scopeRef.current === scope;
    setCapabilitiesError(null);
    setJobsError(null);

    async function loadCapabilities() {
      try {
        const body = await callbacks.api<TranslationCapabilities>("/api/v1/translation-capabilities", { signal: controller.signal });
        if (current()) setCapabilities(body);
      } catch (error) {
        if (!isAbort(error) && current()) setCapabilitiesError(errorCode(error));
      }
    }

    async function loadJobs() {
      const action = ++jobActionRef.current;
      try {
        const body = await callbacks.api<{ items: TranslationJob[] }>(
          `/api/v1/documents/${encodeURIComponent(scopeDocument.id)}/translations?limit=20`,
          { signal: controller.signal }
        );
        if (!current() || action !== jobActionRef.current) return;
        const items = Array.isArray(body.items)
          ? body.items.filter((job): job is TranslationJob => jobInScope(job, scopeDocument)).slice(0, 20)
          : [];
        setJobs(items);
        const preferred = items.find((job) => job.id === selectedJob?.id) || items[0];
        if (!preferred) {
          setSelectedJob(null);
          return;
        }
        const detail = await callbacks.api<TranslationJob>(
          `/api/v1/translations/${encodeURIComponent(preferred.id)}`,
          { signal: controller.signal }
        );
        if (current() && action === jobActionRef.current && jobInScope(detail, scopeDocument)) setSelectedJob(detail);
      } catch (error) {
        if (!isAbort(error) && current() && action === jobActionRef.current) setJobsError(errorCode(error));
      }
    }

    void loadCapabilities();
    void loadJobs();
    return () => {
      controller.abort();
      if (generationRef.current === ticket) generationRef.current += 1;
    };
  }, [activeScope]);

  useEffect(() => {
    if (!activeScope || !document || !isActive(selectedJob)) return;
    const scope = activeScope;
    const scopeDocument = document;
    const jobId = (selectedJob as TranslationJob).id;
    const ticket = generationRef.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let failures = 0;

    async function poll() {
      if (stopped) return;
      const action = jobActionRef.current;
      controller = new AbortController();
      try {
        const job = await callbacks.api<TranslationJob>(
          `/api/v1/translations/${encodeURIComponent(jobId)}`,
          { signal: controller.signal }
        );
        if (stopped || generationRef.current !== ticket || scopeRef.current !== scope) return;
        if (action === jobActionRef.current) {
          if (!jobInScope(job, scopeDocument)) return;
          failures = 0;
          setPollError(false);
          setSelectedJob((current) => current?.id === jobId ? job : current);
          setJobs((current) => upsertJob(current, job));
        }
      } catch (error) {
        if (stopped || isAbort(error) || generationRef.current !== ticket || scopeRef.current !== scope) return;
        if (action === jobActionRef.current) {
          failures += 1;
          setPollError(true);
        }
      }
      if (!stopped) timer = setTimeout(poll, Math.min(8000, 1200 * (2 ** failures)));
    }

    timer = setTimeout(poll, 1200);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [activeScope, selectedJob?.id, selectedJob?.status]);

  async function submitTranslation(request: TranslationRequest) {
    if (!activeScope || !document || pendingAction || request.documentId !== document.id || request.sourceSha256 !== document.sha256) return;
    const scope = activeScope;
    const scopeDocument = document;
    const ticket = generationRef.current;
    const action = ++jobActionRef.current;
    setRequestDraft(request);
    setPendingAction("start");
    setOperationError(null);
    try {
      const job = await callbacks.api<TranslationJob>(
        `/api/v1/documents/${encodeURIComponent(request.documentId)}/translations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.payload),
          signal: scopeControllerRef.current?.signal
        }
      );
      if (generationRef.current !== ticket || scopeRef.current !== scope || action !== jobActionRef.current) return;
      if (!jobInScope(job, scopeDocument)) throw new Error("request_failed");
      setRequestDraft(null);
      setSelectedJob(job);
      setJobs((current) => upsertJob(current, job));
    } catch (error) {
      if (!isAbort(error) && generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) {
        const code = errorCode(error);
        if (code !== "network" && code !== "request_failed") setRequestDraft(null);
        setOperationError(code);
      }
    } finally {
      if (generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) setPendingAction(null);
    }
  }

  function startFromForm() {
    if (!document || requestDraft || pendingAction) return;
    const maxPages = Math.min(5, capabilities?.max_pages || 5);
    const pages = selectionMode === "current" ? [model.currentPage] : parsePages(pageInput, document.pageCount, maxPages);
    if (!pages) {
      setOperationError("invalid_pages");
      return;
    }
    void submitTranslation({
      documentId: document.id,
      sourceSha256: document.sha256,
      payload: {
        request_id: crypto.randomUUID(),
        source_sha256: document.sha256,
        pages,
        target_language: targetLanguage
      }
    });
  }

  async function openSaved(jobId: string) {
    if (!activeScope || !document || !jobId || pendingAction) return;
    const scope = activeScope;
    const scopeDocument = document;
    const ticket = generationRef.current;
    const action = ++jobActionRef.current;
    setPendingAction("open");
    setOperationError(null);
    try {
      const job = await callbacks.api<TranslationJob>(
        `/api/v1/translations/${encodeURIComponent(jobId)}`,
        { signal: scopeControllerRef.current?.signal }
      );
      if (generationRef.current !== ticket || scopeRef.current !== scope || action !== jobActionRef.current) return;
      if (!jobInScope(job, scopeDocument)) throw new Error("request_failed");
      setSelectedJob(job);
    } catch (error) {
      if (!isAbort(error) && generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) {
        setOperationError(`open:${errorCode(error)}`);
      }
    } finally {
      if (generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) setPendingAction(null);
    }
  }

  async function cancelSelected() {
    if (!activeScope || !document || !selectedJob || !isActive(selectedJob) || pendingAction) return;
    const scope = activeScope;
    const scopeDocument = document;
    const jobId = selectedJob.id;
    const ticket = generationRef.current;
    const action = ++jobActionRef.current;
    setPendingAction("cancel");
    setOperationError(null);
    try {
      const job = await callbacks.api<TranslationJob>(`/api/v1/translations/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: scopeControllerRef.current?.signal
      });
      if (generationRef.current !== ticket || scopeRef.current !== scope || action !== jobActionRef.current) return;
      if (!jobInScope(job, scopeDocument) || job.id !== jobId) throw new Error("request_failed");
      setSelectedJob((current) => current?.id === jobId ? job : current);
      setJobs((current) => upsertJob(current, job));
    } catch (error) {
      if (!isAbort(error) && generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) {
        setOperationError(`cancel:${errorCode(error)}`);
      }
    } finally {
      if (generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) setPendingAction(null);
    }
  }

  function closePanel() {
    callbacks.onOpenChange(false);
    requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }));
  }

  function changeMode(nextMode: TranslationMode) {
    setOverlayStatus(null);
    setMode(nextMode);
    callbacks.onOpenChange(nextMode === "dual");
  }

  function openSettings() {
    changeMode("dual");
    callbacks.onOpenSettings();
  }

  function source(page: number, rect: TranslationRect | null) {
    if (!activeScope || scopeRef.current !== activeScope || !document || !selectedJob || !jobInScope(selectedJob, document)) return;
    const expectedDocumentId = document.id;
    const expectedSourceSha256 = document.sha256;
    changeMode("original");
    void callbacks.goToSource(page, rect, expectedDocumentId, expectedSourceSha256);
  }

  const toggle = (
    <button
      ref={toggleRef}
      className="button button-secondary translation-toggle"
      type="button"
      aria-controls={panelContainer.id}
      aria-expanded={model.open && mode === "dual" && model.reading}
      aria-pressed={model.open && mode === "dual" && model.reading}
      disabled={!model.reading || !document}
      onClick={() => model.open && mode === "dual" ? closePanel() : changeMode("dual")}
    >
      {copy.translate}
    </button>
  );
  const currentPageCompleted = Boolean(visibleJob && jobResults(visibleJob).some((page) => page.page === model.currentPage && page.status === "completed"));
  const overlayNotice = !visibleJob
    ? copy.noSavedTranslation
    : isActive(visibleJob)
      ? copy.stillTranslating
      : !currentPageCompleted
        ? copy.currentPageAbsent
        : overlayStatus?.kind === "partial"
          ? copy.partialOverlay
          : overlayStatus?.kind === "unavailable"
            ? copy.unavailableOverlay
            : null;
  const controls = (
    <>
      {toggle}
      <div className="translation-mode-control" role="group" aria-label={copy.readingMode}>
        {(["original", "dual", "translated"] as const).map((item) => (
          <button
            className="button button-quiet translation-mode-button"
            type="button"
            data-translation-mode={item}
            aria-pressed={mode === item}
            disabled={!model.reading || !document}
            onClick={() => changeMode(item)}
            key={item}
          >
            {copy[`${item}Mode`]}
          </button>
        ))}
      </div>
      {mode === "translated" && overlayNotice && (
        <div className="translation-mode-notice" role="status">
          <span>{overlayNotice}</span>
          <button className="translation-source-link" type="button" onClick={() => changeMode("dual")}>{copy.showDual}</button>
        </div>
      )}
    </>
  );

  if (!model.open || mode !== "dual" || !model.reading || !document) return controls;
  const maxPages = Math.min(5, capabilities?.max_pages || 5);
  const formDisabled = Boolean(requestDraft) || pendingAction === "start";
  const operationMessage = operationError === "invalid_pages"
    ? copy.invalidPages
    : operationError?.startsWith("cancel:")
      ? copy.cancelFailed
      : operationError?.startsWith("open:")
        ? copy.loadRunFailed
        : operationError === "network"
          ? copy.network
          : copy.requestFailed;
  const panel = (
    <div
      className="translation-panel-content"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <header className="translation-header">
        <div>
          <h2 id="translation-heading">{copy.translation}</h2>
          <p>{copy.ready}</p>
        </div>
        <button className="button button-quiet translation-close" type="button" aria-label={copy.close} title={copy.close} onClick={closePanel}>×</button>
      </header>

      <form className="translation-form" onSubmit={(event) => {
        event.preventDefault();
        startFromForm();
      }}>
        <fieldset className="translation-page-choice" disabled={formDisabled}>
          <legend className="sr-only">{copy.pagesLabel}</legend>
          <label>
            <input type="radio" name="translation-pages" checked={selectionMode === "current"} onChange={() => setSelectionMode("current")} />
            <span>{copy.currentPage} · {model.currentPage}</span>
          </label>
          <label>
            <input type="radio" name="translation-pages" checked={selectionMode === "pages"} onChange={() => setSelectionMode("pages")} />
            <span>{copy.selectedPages}</span>
          </label>
        </fieldset>
        {selectionMode === "pages" && (
          <label className="translation-field" htmlFor="translation-page-input">
            <span>{copy.pagesLabel}</span>
            <input
              id="translation-page-input"
              value={pageInput}
              placeholder={copy.pagesPlaceholder}
              inputMode="text"
              autoComplete="off"
              disabled={formDisabled}
              onChange={(event) => setPageInput(event.target.value)}
            />
          </label>
        )}
        <label className="translation-field" htmlFor="translation-target-language">
          <span>{copy.targetLanguage}</span>
          <select id="translation-target-language" value={targetLanguage} disabled={formDisabled} onChange={(event) => setTargetLanguage(event.target.value as TargetLanguage)}>
            <option value="zh">{copy.chinese}</option>
            <option value="en">{copy.english}</option>
          </select>
        </label>
        <div className="translation-start-row">
          {requestDraft ? (
            <button className="button button-primary" type="button" disabled={Boolean(pendingAction)} onClick={() => void submitTranslation(requestDraft)}>
              {pendingAction === "start" ? copy.starting : copy.retryRequest}
            </button>
          ) : (
            <button className="button button-primary" type="submit" disabled={!capabilities?.ready || Boolean(pendingAction)}>
              {pendingAction === "start" ? copy.starting : copy.start}
            </button>
          )}
        </div>
        {requestDraft && <p className="translation-retry-hint">{copy.retryHint}</p>}
      </form>

      {!capabilities && !capabilitiesError && <p className="translation-status" role="status">{copy.loading}</p>}
      {capabilitiesError && <p className="translation-status" data-kind="error" role="alert">{copy.capabilitiesFailed}</p>}
      {capabilities && !capabilities.ready && (
        <div className="translation-unavailable" role="status">
          <p>{capabilities.reason || copy.unavailable}</p>
          {!capabilities.model_ready && <button className="button button-secondary" type="button" onClick={openSettings}>{copy.openSettings}</button>}
        </div>
      )}

      <div className="translation-saved-row">
        <label htmlFor="translation-saved-runs">{copy.savedRuns}</label>
        <select
          id="translation-saved-runs"
          value={visibleJob?.id || ""}
          disabled={!jobs.length || Boolean(pendingAction)}
          onChange={(event) => void openSaved(event.target.value)}
        >
          {!jobs.length && <option value="">{copy.noSavedRuns}</option>}
          {jobs.map((job) => <option value={job.id} key={job.id}>{runLabel(job, copy, model.language)}</option>)}
        </select>
      </div>
      {jobsError && <p className="translation-status" data-kind="error" role="alert">{copy.listFailed}</p>}
      {operationError && <p className="translation-status" data-kind="error" role="alert">{operationMessage}</p>}
      {pollError && <p className="translation-status" role="status">{copy.pollFailed}</p>}

      {visibleJob ? (
        <section className="translation-job" aria-label={copy.translation}>
          <div className="translation-job-summary">
            <div>
              <strong>{copy[visibleJob.status]}</strong>
              <p>{copy.pageRange(formatPages(visibleJob.pages), visibleJob.total_pages)}</p>
            </div>
            {!isActive(visibleJob) && ["failed", "partial", "cancelled", "interrupted"].includes(visibleJob.status) && (
              <button
                className="button button-secondary"
                type="button"
                disabled={Boolean(requestDraft) || Boolean(pendingAction)}
                onClick={() => void submitTranslation({
                  documentId: visibleJob.document_id,
                  sourceSha256: visibleJob.source_sha256,
                  payload: {
                    request_id: crypto.randomUUID(),
                    source_sha256: visibleJob.source_sha256,
                    pages: [...visibleJob.pages],
                    target_language: visibleJob.target_language
                  }
                })}
              >
                {copy.retryJob}
              </button>
            )}
          </div>
          {isActive(visibleJob) && (
            <div className="translation-progress" role="status" aria-live="polite">
              <p>{copy[visibleJob.stage]} · {copy.progress(visibleJob.completed_pages, visibleJob.total_pages)}</p>
              <progress max={Math.max(1, visibleJob.total_pages)} value={visibleJob.completed_pages} />
              <button className="button button-secondary" type="button" disabled={Boolean(pendingAction)} onClick={() => void cancelSelected()}>
                {pendingAction === "cancel" ? copy.cancelling : copy.cancel}
              </button>
            </div>
          )}
          {visibleJob.error && <p className="translation-status" data-kind="error" role="alert">{visibleJob.error.message || copy.jobError}</p>}
          <TranslationResults job={visibleJob} copy={copy} onSource={source} />
        </section>
      ) : (
        <p className="translation-empty">{copy.empty}</p>
      )}
    </div>
  );

  return <>{controls}{createPortal(panel, panelContainer)}</>;
}

function render(registration: TranslationRegistration, model: TranslationPanelModel) {
  registration.root.render(
    <TranslationExperience model={model} callbacks={registration.callbacks} controlsContainer={registration.controlsContainer} panelContainer={registration.panelContainer} />
  );
}

function destroy(registration: TranslationRegistration) {
  if (!registration.active) return;
  registration.active = false;
  if (controlsOwners.get(registration.controlsContainer) === registration) controlsOwners.delete(registration.controlsContainer);
  if (panelOwners.get(registration.panelContainer) === registration) panelOwners.delete(registration.panelContainer);
  registration.root.unmount();
}

function validateHosts(controlsContainer: HTMLElement, panelContainer: HTMLElement) {
  if (!(controlsContainer instanceof HTMLElement) || !(panelContainer instanceof HTMLElement)) {
    throw new TypeError("Translation mount hosts must be HTML elements");
  }
  if (!panelContainer.id || controlsContainer === panelContainer || controlsContainer.contains(panelContainer) || panelContainer.contains(controlsContainer)) {
    throw new Error("Translation mount hosts must be distinct, non-overlapping subtrees");
  }
}

export function mountTranslationPanel({
  controlsContainer,
  panelContainer,
  model,
  callbacks,
  onMounted
}: MountTranslationPanelOptions): TranslationPanelHandle {
  validateHosts(controlsContainer, panelContainer);
  const previous = new Set<TranslationRegistration>();
  const controlsOwner = controlsOwners.get(controlsContainer);
  const panelOwner = panelOwners.get(panelContainer);
  if (controlsOwner) previous.add(controlsOwner);
  if (panelOwner) previous.add(panelOwner);
  previous.forEach(destroy);

  const registration: TranslationRegistration = {
    controlsContainer,
    panelContainer,
    root: createRoot(controlsContainer),
    callbacks,
    active: true
  };
  controlsOwners.set(controlsContainer, registration);
  panelOwners.set(panelContainer, registration);
  flushSync(() => render(registration, model));
  onMounted?.();
  return {
    update(nextModel) {
      if (
        !registration.active
        || controlsOwners.get(controlsContainer) !== registration
        || panelOwners.get(panelContainer) !== registration
      ) return false;
      render(registration, nextModel);
      return true;
    },
    destroy() {
      destroy(registration);
    }
  };
}
