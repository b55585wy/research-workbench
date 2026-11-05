import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { TranslationRunPanel, runInScope, type TranslationRun } from "./translation-runs";
import { presentTranslationBlocks } from "./translation-presentation";

type TranslationLanguage = "zh" | "en";
type TargetLanguage = "zh" | "en";
type TranslationMode = "original" | "dual" | "translated";
type OverlayStatus = { documentId: string; sourceSha256: string; jobId: string; page: number; kind: "partial" | "unavailable" };
type JobStatus = "queued" | "running" | "paused" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";

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
  run_support?: boolean;
  run_max_pages?: number;
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

export type TranslationExcerptAction = "note" | "ask";

export interface TranslationExcerpt {
  documentId: string;
  sourceSha256: string;
  jobId: string;
  blockId: string;
  page: number;
  rect: TranslationRect | null;
  sourceText: string;
  translatedText: string;
  targetLanguage: TargetLanguage;
}

interface TranslationResultPage {
  page: number;
  status: "completed" | "unavailable" | "failed";
  warning: string | null;
  blocks: TranslationBlock[];
  job_id?: string;
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
  onExcerpt?: (action: TranslationExcerptAction, excerpt: TranslationExcerpt) => void | boolean | Promise<void | boolean>;
}

export interface MountTranslationPanelOptions {
  controlsContainer: HTMLElement;
  panelContainer: HTMLElement;
  model: TranslationPanelModel;
  callbacks: TranslationPanelCallbacks;
  onMounted?: () => void;
}

export interface TranslationRecordRequest {
  kind: "run" | "job";
  id: string;
  documentId: string;
  sourceSha256: string;
  pages: number[];
}

export interface TranslationPanelHandle {
  update: (model: TranslationPanelModel) => boolean;
  openRecord: (request: TranslationRecordRequest) => Promise<boolean>;
  destroy: () => void;
}

interface TranslationRegistration {
  controlsContainer: HTMLElement;
  panelContainer: HTMLElement;
  root: Root;
  callbacks: TranslationPanelCallbacks;
  opener: ((request: TranslationRecordRequest) => Promise<boolean>) | null;
  active: boolean;
}

const controlsOwners = new WeakMap<HTMLElement, TranslationRegistration>();
const panelOwners = new WeakMap<HTMLElement, TranslationRegistration>();
const activeStatuses = new Set<JobStatus>(["queued", "running"]);

const strings = {
  zh: {
    translate: "翻译",
    translation: "译文",
    readingMode: "阅读模式",
    originalMode: "原文",
    dualMode: "对照",
    translatedMode: "译文",
    showDual: "对照查看",
    noSavedTranslation: "暂无译文",
    currentPageAbsent: "本页暂无译文",
    stillTranslating: "本页翻译中，原文仍可阅读。",
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
    startCurrent: "翻译本页",
    more: "指定页码",
    confirmRange: "确认翻译所选页面",
    reviewRange: "核对页码",
    cancelConfirmation: "返回",
    backToRuns: "返回翻译记录",
    starting: "正在提交…",
    retryRequest: "重试同一请求",
    loading: "正在读取翻译设置和已保存记录…",
    unavailable: "翻译暂不可用。",
    openSettings: "打开模型设置",
    savedRuns: "翻译记录",
    continuous: "连续翻译",
    legacy: "早期翻译",
    noSavedRuns: "选择翻译记录",
    loadRunFailed: "无法打开这条翻译记录，请重试。",
    listFailed: "无法读取已保存的翻译。",
    capabilitiesFailed: "无法读取翻译设置。",
    network: "无法连接本地服务。请求可能已提交；请使用相同请求重试。",
    requestFailed: "翻译请求未完成，请重试。",
    invalidPages: "请输入 1 至 5 个不重复的有效页码，例如 1,3-5。",
    pageRange: (pages: string, count: number) => `第 ${pages} 页 · 共 ${count} 页`,
    queued: "排队中",
    running: "翻译中",
    paused: "已停止",
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
    pageInformation: "期刊 / 出版信息",
    addExcerptToNote: "将译文和原文加入笔记",
    addExcerptToAsk: "将译文和原文加入助手草稿",
    excerptFailed: "未能加入译文，请重试；原有草稿未更改。",
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
    noResults: "暂无译文",
    empty: "选择当前页或最多 5 个页面，然后开始翻译。已有记录不会自动重新运行。",
    ready: "原文保持在左侧，译文按原页码显示在右侧。",
    jobError: "翻译未完成。",
    retryHint: "网络结果不确定时会保留同一请求标识，避免重复创建任务。",
    sourceLanguage: (language: TargetLanguage) => language === "zh" ? "中文" : "英文"
  },
  en: {
    translate: "Translate",
    translation: "Translation",
    readingMode: "Reading mode",
    originalMode: "Original",
    dualMode: "Compare",
    translatedMode: "Translated",
    showDual: "Compare",
    noSavedTranslation: "No translation yet",
    currentPageAbsent: "No translation for this page yet",
    stillTranslating: "This page is being translated. The original remains readable.",
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
    startCurrent: "Translate current page",
    more: "Selected pages",
    confirmRange: "Confirm selected pages",
    reviewRange: "Review pages",
    cancelConfirmation: "Back",
    backToRuns: "Back to translation history",
    starting: "Submitting…",
    retryRequest: "Retry same request",
    loading: "Loading translations…",
    unavailable: "Translation is currently unavailable.",
    openSettings: "Open model settings",
    savedRuns: "Translation history",
    continuous: "Continuous translation",
    legacy: "Earlier translations",
    noSavedRuns: "Choose a translation",
    loadRunFailed: "This saved translation could not be opened. Try again.",
    listFailed: "Saved translations could not be loaded.",
    capabilitiesFailed: "Translation settings could not be loaded.",
    network: "The local service could not be reached. The request may have been submitted; retry the same request.",
    requestFailed: "The translation request was not completed. Try again.",
    invalidPages: "Enter 1 to 5 distinct valid pages, for example 1,3-5.",
    pageRange: (pages: string, count: number) => `Pages ${pages} · ${count} total`,
    queued: "Queued",
    running: "Running",
    paused: "Stopped",
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
    pageInformation: "Journal / publication information",
    addExcerptToNote: "Add translation and original to note",
    addExcerptToAsk: "Add translation and original to assistant draft",
    excerptFailed: "The translation could not be added. Try again; the existing draft was not changed.",
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
    noResults: "No translation yet",
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

function BlockView({ block, page, copy, onSource, onExcerpt, excerptPending = false }: {
  block: TranslationBlock;
  page: number;
  copy: Copy;
  onSource: (page: number, rect: TranslationRect | null) => void;
  onExcerpt?: (action: TranslationExcerptAction, block: TranslationBlock, page: number) => void;
  excerptPending?: boolean;
}) {
  const translatable = block.kind === "text" || block.kind === "title" || block.kind === "caption";
  const translated = translatable && typeof block.translated_text === "string" && block.translated_text.trim()
    ? block.translated_text
    : null;
  const canExcerpt = Boolean(translated && onExcerpt && typeof block.source_text === "string" && block.source_text.trim());
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
      {(block.rect || canExcerpt) && (
        <div className="translation-block-footer">
          {block.rect && (
            <button
              className="translation-source-link translation-source-icon"
              type="button"
              aria-label={copy.originalBlock}
              title={copy.originalBlock}
              onClick={() => onSource(page, block.rect)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><path d="m9 15 6-6M10 9h5v5" /></svg>
            </button>
          )}
          {canExcerpt && (
            <div className="translation-excerpt-actions">
              <button
                className="translation-excerpt-action"
                type="button"
                data-excerpt-action="note"
                aria-label={copy.addExcerptToNote}
                title={copy.addExcerptToNote}
                disabled={excerptPending}
                onClick={() => onExcerpt?.("note", block, page)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4M3 3h12" /></svg>
              </button>
              <button
                className="translation-excerpt-action"
                type="button"
                data-excerpt-action="ask"
                aria-label={copy.addExcerptToAsk}
                title={copy.addExcerptToAsk}
                disabled={excerptPending}
                onClick={() => onExcerpt?.("ask", block, page)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v9ZM8 9h8M8 13h5" /></svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TranslationPageInformation({ blocks, page, copy, onSource }: {
  blocks: TranslationBlock[];
  page: number;
  copy: Copy;
  onSource: (page: number, rect: TranslationRect | null) => void;
}) {
  if (!blocks.length) return null;
  return (
    <details className="translation-page-information">
      <summary>{copy.pageInformation}</summary>
      <div className="translation-page-information-content">
        {blocks.map((block) => (
          <div className="translation-information-block" key={block.id}>
            <p>{block.source_text}</p>
            {block.rect && (
              <button
                className="translation-source-link translation-source-icon"
                type="button"
                aria-label={copy.originalBlock}
                title={copy.originalBlock}
                onClick={() => onSource(page, block.rect)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><path d="m9 15 6-6M10 9h5v5" /></svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function TranslationResults({ job, copy, onSource, onExcerpt, excerptPending = false, pageNavigation }: {
  job: TranslationJob;
  copy: Copy;
  onSource: (page: number, rect: TranslationRect | null) => void;
  onExcerpt?: (action: TranslationExcerptAction, block: TranslationBlock, page: number) => void;
  excerptPending?: boolean;
  pageNavigation?: ReactNode;
}) {
  const pages = [...jobResults(job)].sort((a, b) => a.page - b.page);
  if (!pages.length) return <div className="translation-results">{pageNavigation}<p className="translation-empty">{copy.noResults}</p></div>;
  return (
    <div className="translation-results">
      {pages.map((page) => {
        const blocks = Array.isArray(page.blocks) ? [...page.blocks].sort((a, b) => a.order - b.order) : [];
        const presented = presentTranslationBlocks(blocks, page.page);
        return (
          <section className="translation-result-page" key={page.page} aria-labelledby={`translation-page-${job.id}-${page.page}`}>
            <header className="translation-page-header">
              <h3 id={`translation-page-${job.id}-${page.page}`}>{pageNavigation || copy.page(page.page)}</h3>
              <button className="translation-source-link" type="button" onClick={() => onSource(page.page, null)}>
                {copy.original}
              </button>
            </header>
            {page.warning && <p className="translation-page-warning">{page.warning}</p>}
            {page.status !== "completed" && (
              <p className="translation-page-warning">{copy[page.status === "failed" ? "pageFailed" : "pageUnavailable"]}</p>
            )}
            <TranslationPageInformation blocks={presented.pageInformation} page={page.page} copy={copy} onSource={onSource} />
            {!blocks.length && page.status === "completed" && <p className="translation-empty">{copy.noText}</p>}
            {presented.blocks.map((block) => (
              <BlockView
                block={block}
                page={page.page}
                copy={copy}
                onSource={onSource}
                onExcerpt={page.status === "completed" ? onExcerpt : undefined}
                excerptPending={excerptPending}
                key={block.id}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function TranslationExperience({ model, callbacks, controlsContainer, panelContainer, registerOpener }: {
  model: TranslationPanelModel;
  callbacks: TranslationPanelCallbacks;
  controlsContainer: HTMLElement;
  panelContainer: HTMLElement;
  registerOpener: (opener: ((request: TranslationRecordRequest) => Promise<boolean>) | null) => void;
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
  const operationRef = useRef(0);
  const operationLockRef = useRef<number | null>(null);
  const excerptActionRef = useRef(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [capabilities, setCapabilities] = useState<TranslationCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<TranslationJob | null>(null);
  const [selectedRun, setSelectedRun] = useState<TranslationRun | null>(null);
  const runReadingCacheRef = useRef<TranslationRun | null>(null);
  const readerPageRef = useRef(model.currentPage);
  readerPageRef.current = model.currentPage;
  const [externalRun, setExternalRun] = useState<TranslationRun | null>(null);
  const [historyView, setHistoryView] = useState<"run" | "legacy">("run");
  const [legacyConfirmation, setLegacyConfirmation] = useState<{ pages: number[]; targetLanguage: TargetLanguage } | null>(null);
  const [pageInput, setPageInput] = useState(String(model.currentPage || 1));
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>(model.language);
  const [requestDraft, setRequestDraft] = useState<TranslationRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<"start" | "cancel" | "open" | null>(null);
  const [pendingExcerpt, setPendingExcerpt] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const visibleLegacyJob = activeScope && document && selectedJob && jobInScope(selectedJob, document) && selectedJob.target_language === targetLanguage ? selectedJob : null;
  const visibleRun = activeScope && document && selectedRun && runInScope(selectedRun, document) && selectedRun.target_language === targetLanguage ? selectedRun : null;
  const useRuns = capabilities?.run_support !== false || Boolean(visibleRun);
  const runView = historyView === "run" && useRuns;
  const visibleJob: TranslationJob | null = runView ? visibleRun : visibleLegacyJob;
  const visibleSourceJobId = runView
    ? visibleRun?.result_pages.find((page) => page.page === model.currentPage && page.status === "completed")?.job_id || ""
    : visibleLegacyJob?.id || "";
  const handleRunSelection = useCallback((run: TranslationRun | null) => {
    excerptActionRef.current += 1;
    if (!run) {
      setSelectedRun(null);
      return;
    }
    // Page-filtered reads can be combined only within the same frozen run version.
    const identity = (value: TranslationRun) => JSON.stringify([
      value.id, value.document_id, value.source_sha256, value.target_language,
      value.revision, value.parser, value.model, value.model_fingerprint,
      value.prompt_version, value.result_schema_version
    ]);
    const cached = runReadingCacheRef.current;
    const pages = cached && identity(cached) === identity(run) ? cached.result_pages : [];
    const retained = pages.filter((page) => page.page === readerPageRef.current && !run.result_pages.some((next) => next.page === page.page));
    const merged = { ...run, result_pages: [...retained, ...run.result_pages] };
    runReadingCacheRef.current = merged;
    setSelectedRun(merged);
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    operationRef.current += 1;
    operationLockRef.current = null;
    excerptActionRef.current += 1;
    scopeControllerRef.current?.abort();
    setMode("dual");
    setOverlayStatus(null);
    setCapabilities(null);
    setCapabilitiesError(null);
    setJobs([]);
    setJobsError(null);
    setSelectedJob(null);
    setSelectedRun(null);
    runReadingCacheRef.current = null;
    setExternalRun(null);
    setHistoryView("run");
    setLegacyConfirmation(null);
    setPageInput(String(model.currentPage || 1));
    setTargetLanguage(model.language);
    setRequestDraft(null);
    setPendingAction(null);
    setPendingExcerpt(null);
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
      if (mode === "translated" && document && visibleJob && visibleSourceJobId
        && detail.documentId === document.id && detail.sourceSha256 === document.sha256
        && detail.jobId === visibleSourceJobId && detail.page === model.currentPage
        && ["partial", "unavailable"].includes(detail.kind)) setOverlayStatus(detail);
    };
    controlsContainer.addEventListener("translation-overlay-status", handleStatus);
    return () => controlsContainer.removeEventListener("translation-overlay-status", handleStatus);
  }, [controlsContainer, documentKey, visibleJob, visibleSourceJobId, model.currentPage, mode]);

  useEffect(() => {
    setOverlayStatus(null);
    const snapshot = model.reading && document ? Object.freeze({
      mode,
      documentId: document.id,
      sourceSha256: document.sha256,
      jobId: mode === "translated" ? visibleSourceJobId : "",
      currentPage: model.currentPage,
      language: model.language,
      resultPages: mode === "translated" && visibleSourceJobId && visibleJob ? Object.freeze(frozenCompletedPages(visibleJob).filter((page) => page.page === model.currentPage)) : Object.freeze([])
    }) : null;
    controlsContainer.dispatchEvent(new CustomEvent("translation-presentation-change", { detail: snapshot }));
  }, [controlsContainer, mode, documentKey, visibleJob, visibleSourceJobId, model.reading, model.currentPage, model.language]);

  useEffect(() => () => {
    controlsContainer.dispatchEvent(new CustomEvent("translation-presentation-change", { detail: null }));
  }, [controlsContainer]);

  useEffect(() => {
    const ticket = ++generationRef.current;
    operationRef.current += 1;
    operationLockRef.current = null;
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
    if (runView || !activeScope || !document || !isActive(selectedJob)) return;
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
  }, [activeScope, runView, selectedJob?.id, selectedJob?.status]);

  async function submitTranslation(request: TranslationRequest) {
    if (!activeScope || !document || operationLockRef.current !== null || pendingAction || request.documentId !== document.id || request.sourceSha256 !== document.sha256) return;
    const scope = activeScope;
    const scopeDocument = document;
    const ticket = generationRef.current;
    const operation = ++operationRef.current;
    operationLockRef.current = operation;
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
      if (operationLockRef.current === operation) {
        operationLockRef.current = null;
        if (generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) setPendingAction(null);
      }
    }
  }

  function startFromForm(currentOnly: boolean) {
    if (!document || requestDraft || pendingAction || legacyConfirmation) return;
    const maxPages = Math.min(5, capabilities?.max_pages || 5);
    const pages = currentOnly ? [model.currentPage] : parsePages(pageInput, document.pageCount, maxPages);
    if (!pages) {
      setOperationError("invalid_pages");
      return;
    }
    setOperationError(null);
    if (!currentOnly) {
      setLegacyConfirmation({ pages, targetLanguage });
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

  function confirmLegacyRange() {
    if (!document || !legacyConfirmation || requestDraft || pendingAction) return;
    const confirmation = legacyConfirmation;
    setLegacyConfirmation(null);
    void submitTranslation({
      documentId: document.id,
      sourceSha256: document.sha256,
      payload: {
        request_id: crypto.randomUUID(),
        source_sha256: document.sha256,
        pages: [...confirmation.pages],
        target_language: confirmation.targetLanguage
      }
    });
  }

  async function openSaved(jobId: string) {
    if (!activeScope || !document || !jobId || pendingAction) return;
    const scope = activeScope;
    const scopeDocument = document;
    const ticket = generationRef.current;
    const action = ++jobActionRef.current;
    setHistoryView("legacy");
    setExternalRun(null);
    setLegacyConfirmation(null);
    setPendingAction("open");
    setOperationError(null);
    try {
      const job = await callbacks.api<TranslationJob>(
        `/api/v1/translations/${encodeURIComponent(jobId)}`,
        { signal: scopeControllerRef.current?.signal }
      );
      if (generationRef.current !== ticket || scopeRef.current !== scope || action !== jobActionRef.current) return;
      if (!jobInScope(job, scopeDocument) || job.id !== jobId) throw new Error("request_failed");
      setTargetLanguage(job.target_language);
      setSelectedJob(job);
    } catch (error) {
      if (!isAbort(error) && generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) {
        setOperationError(`open:${errorCode(error)}`);
      }
    } finally {
      if (generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) setPendingAction(null);
    }
  }

  async function openExternalRecord(request: TranslationRecordRequest): Promise<boolean> {
    if (
      !activeScope || !document || pendingAction
      || request.documentId !== document.id || request.sourceSha256 !== document.sha256
      || !request.id || !Array.isArray(request.pages) || !request.pages.length
      || request.pages.some((page) => !Number.isInteger(page) || page < 1 || page > document.pageCount)
    ) return false;
    const scope = activeScope;
    const scopeDocument = document;
    const ticket = generationRef.current;
    const action = ++jobActionRef.current;
    excerptActionRef.current += 1;
    setPendingAction("open");
    setOperationError(null);
    setLegacyConfirmation(null);
    setHistoryView(request.kind === "run" ? "run" : "legacy");
    changeMode("dual");
    try {
      if (request.kind === "run") {
        const page = request.pages.includes(model.currentPage) ? model.currentPage : request.pages[0];
        const run = await callbacks.api<TranslationRun>(`/api/v1/translation-runs/${encodeURIComponent(request.id)}?page=${page}`, {
          signal: scopeControllerRef.current?.signal
        });
        if (generationRef.current !== ticket || scopeRef.current !== scope || action !== jobActionRef.current) return false;
        if (
          !runInScope(run, scopeDocument) || run.id !== request.id
          || run.result_pages.length > 1 || run.result_pages.some((result) => result.page !== page
            || !["completed", "unavailable", "failed"].includes(result.status)
            || typeof result.job_id !== "string" || !result.job_id || !Array.isArray(result.blocks))
        ) throw new Error("request_failed");
        setSelectedJob(null);
        setTargetLanguage(run.target_language);
        setSelectedRun(run);
        setExternalRun(run);
      } else {
        const job = await callbacks.api<TranslationJob>(`/api/v1/translations/${encodeURIComponent(request.id)}`, {
          signal: scopeControllerRef.current?.signal
        });
        if (generationRef.current !== ticket || scopeRef.current !== scope || action !== jobActionRef.current) return false;
        if (!jobInScope(job, scopeDocument) || job.id !== request.id) throw new Error("request_failed");
        setExternalRun(null);
        setSelectedRun(null);
        setTargetLanguage(job.target_language);
        setSelectedJob(job);
        setJobs((current) => upsertJob(current, job));
      }
      return true;
    } catch (error) {
      if (!isAbort(error) && generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) {
        setOperationError(`open:${errorCode(error)}`);
      }
      return false;
    } finally {
      if (generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) setPendingAction(null);
    }
  }

  registerOpener(openExternalRecord);
  useEffect(() => () => registerOpener(null), []);

  async function cancelSelected() {
    if (runView || !activeScope || !document || !selectedJob || !isActive(selectedJob) || operationLockRef.current !== null || pendingAction) return;
    const scope = activeScope;
    const scopeDocument = document;
    const jobId = selectedJob.id;
    const ticket = generationRef.current;
    const operation = ++operationRef.current;
    operationLockRef.current = operation;
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
      if (operationLockRef.current === operation) {
        operationLockRef.current = null;
        if (generationRef.current === ticket && scopeRef.current === scope && action === jobActionRef.current) setPendingAction(null);
      }
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
    if (!activeScope || scopeRef.current !== activeScope || !document || !visibleJob) return;
    const expectedDocumentId = document.id;
    const expectedSourceSha256 = document.sha256;
    changeMode("original");
    void callbacks.goToSource(page, rect, expectedDocumentId, expectedSourceSha256);
  }

  async function excerpt(action: TranslationExcerptAction, block: TranslationBlock, page: number) {
    const callback = callbacks.onExcerpt;
    if (!callback || pendingExcerpt || !activeScope || scopeRef.current !== activeScope || !document || !visibleJob) return;
    const resultPage = jobResults(visibleJob).find((item) => item.page === page && item.status === "completed");
    const excerptJobId = runView ? resultPage?.job_id : visibleJob.id;
    const rect = block.rect == null ? null : block.rect;
    const validRect = rect === null || (
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
      && rect.x + rect.width <= 1 && rect.y + rect.height <= 1
    );
    if (
      !resultPage || !excerptJobId || !resultPage.blocks.some((item) => item.id === block.id)
      || !block.id || !["text", "title", "caption"].includes(block.kind)
      || typeof block.source_text !== "string" || !block.source_text.trim()
      || typeof block.translated_text !== "string" || !block.translated_text.trim()
      || !Number.isInteger(page) || page < 1 || page > document.pageCount || !validRect
    ) return;
    const scope = activeScope;
    const ticket = generationRef.current;
    const jobAction = jobActionRef.current;
    const actionToken = ++excerptActionRef.current;
    const pendingKey = `${visibleJob.id}:${block.id}:${action}`;
    const value: TranslationExcerpt = Object.freeze({
      documentId: document.id,
      sourceSha256: document.sha256,
      jobId: excerptJobId,
      blockId: block.id,
      page,
      rect: rect ? Object.freeze({ ...rect }) : null,
      sourceText: block.source_text,
      translatedText: block.translated_text,
      targetLanguage: visibleJob.target_language
    });
    const current = () => generationRef.current === ticket
      && scopeRef.current === scope
      && jobActionRef.current === jobAction
      && excerptActionRef.current === actionToken;
    setPendingExcerpt(pendingKey);
    setOperationError(null);
    try {
      const result = await callback(action, value);
      if (current() && result === false) setOperationError("excerpt");
    } catch {
      if (current()) setOperationError("excerpt");
    } finally {
      if (current()) setPendingExcerpt(null);
    }
  }

  const currentResult = visibleJob && jobResults(visibleJob).find((page) => page.page === model.currentPage);
  const currentPageCompleted = currentResult?.status === "completed";
  function readingNotice() {
    if (!visibleJob) return copy.noSavedTranslation;
    if (currentPageCompleted) {
      if (overlayStatus?.kind === "partial") return copy.partialOverlay;
      return overlayStatus?.kind === "unavailable" ? copy.unavailableOverlay : null;
    }
    if (!visibleJob.pages.includes(model.currentPage)) return copy.currentPageAbsent;
    if (currentResult?.status === "failed" || visibleJob.status === "failed") return copy.pageFailed;
    if (currentResult?.status === "unavailable") return copy.pageUnavailable;
    return isActive(visibleJob) ? copy.stillTranslating : copy.currentPageAbsent;
  }
  const overlayNotice = readingNotice();
  const controls = (
    <>
      <div className="translation-mode-control" role="group" aria-label={copy.readingMode}>
        {(["original", "dual", "translated"] as const).map((item) => (
          <button
            className="button button-quiet translation-mode-button"
            type="button"
            ref={item === "dual" ? toggleRef : undefined}
            aria-controls={item === "dual" ? panelContainer.id : undefined}
            aria-expanded={item === "dual" ? model.open && model.reading : undefined}
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
      {model.reading && document && mode !== "dual" && overlayNotice && (
        <div className="translation-mode-notice" role="status">
          <span>{overlayNotice}</span>
          {!currentPageCompleted && <button className="translation-source-link" type="button" onClick={() => {
            changeMode("dual");
            requestAnimationFrame(() => panelContainer.querySelector<HTMLButtonElement>(".translation-current-button")?.focus());
          }}>{copy.translate}</button>}
        </div>
      )}
    </>
  );

  if (!model.reading || !document) return controls;
  const maxPages = Math.min(5, capabilities?.max_pages || 5);
  const formDisabled = Boolean(requestDraft) || pendingAction === "start";
  const operationMessage = operationError === "invalid_pages"
    ? copy.invalidPages
    : operationError === "excerpt"
      ? copy.excerptFailed
      : operationError?.startsWith("cancel:")
      ? copy.cancelFailed
      : operationError?.startsWith("open:")
        ? copy.loadRunFailed
        : operationError === "network"
          ? copy.network
          : copy.requestFailed;
  const legacyHistory = (
    <section className="translation-legacy-history" aria-label={copy.legacy}>
      <h3 className="translation-secondary-heading">{copy.legacy}</h3>
      <div className="translation-saved-row">
        <label htmlFor="translation-saved-runs">{copy.legacy}</label>
        <select
          id="translation-saved-runs"
          value=""
          disabled={!jobs.length || Boolean(pendingAction)}
          onChange={(event) => void openSaved(event.target.value)}
        >
          <option value="">{copy.noSavedRuns}</option>
          {jobs.map((job) => <option value={job.id} key={job.id}>{runLabel(job, copy, model.language)}</option>)}
        </select>
      </div>
      {jobsError && <p className="translation-status" data-kind="error" role="alert">{copy.listFailed}</p>}
    </section>
  );
  const panel = (
    <div
      className="translation-panel-content"
      hidden={!model.open || mode !== "dual"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <header className="translation-header">
        <h2 id="translation-heading">{copy.translation}</h2>
        <button className="button button-quiet translation-close" type="button" aria-label={copy.close} title={copy.close} onClick={closePanel}>×</button>
      </header>

      {!capabilities && !capabilitiesError && <p className="translation-status" role="status">{copy.loading}</p>}
      {capabilitiesError && <p className="translation-status" data-kind="error" role="alert">{copy.capabilitiesFailed}</p>}

      {runView ? (
        <>
          <TranslationRunPanel
            document={document}
            currentPage={model.currentPage}
            language={model.language}
            targetLanguage={targetLanguage}
            onTargetLanguageChange={setTargetLanguage}
            capabilities={capabilities}
            api={callbacks.api}
            onOpenSettings={openSettings}
            onSelectionChange={handleRunSelection}
            externalRun={externalRun}
            historyContent={legacyHistory}
            renderResults={(run, pageNavigation) => (
              <TranslationResults
                job={run}
                copy={copy}
                onSource={source}
                onExcerpt={callbacks.onExcerpt ? excerpt : undefined}
                excerptPending={Boolean(pendingExcerpt)}
                pageNavigation={pageNavigation}
              />
            )}
          />
          {operationError && <p className="translation-status" data-kind="error" role="alert">{operationMessage}</p>}
        </>
      ) : (
        <>
          {useRuns && (
            <button className="button button-quiet translation-back" type="button" onClick={() => {
              setHistoryView("run");
              setOperationError(null);
            }}>{copy.backToRuns}</button>
          )}
          <div className="translation-current-action">
            <label className="translation-field" htmlFor="translation-target-language">
              <span>{copy.targetLanguage}</span>
              <select id="translation-target-language" value={targetLanguage} disabled={formDisabled || Boolean(legacyConfirmation)} onChange={(event) => setTargetLanguage(event.target.value as TargetLanguage)}>
                <option value="zh">{copy.chinese}</option>
                <option value="en">{copy.english}</option>
              </select>
            </label>
            {!requestDraft && (
              <button className="button button-primary translation-current-button" type="button" disabled={!capabilities?.ready || Boolean(pendingAction) || Boolean(legacyConfirmation)} onClick={() => startFromForm(true)}>
                {pendingAction === "start" ? copy.starting : copy.startCurrent}
              </button>
            )}
            {requestDraft && (
              <button className="button button-primary translation-current-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void submitTranslation(requestDraft)}>
                {pendingAction === "start" ? copy.starting : copy.retryRequest}
              </button>
            )}
          </div>
          {requestDraft && !pendingAction && <p className="translation-retry-hint">{copy.retryHint}</p>}

          {capabilities && !capabilities.ready && (
            <div className="translation-unavailable" role="status">
              <p>{capabilities.reason || copy.unavailable}</p>
              {!capabilities.model_ready && <button className="button button-secondary" type="button" onClick={openSettings}>{copy.openSettings}</button>}
            </div>
          )}

          {legacyConfirmation && !requestDraft && (
            <div className="translation-run-confirmation" role="group" aria-label={copy.confirmRange}>
              <strong>{copy.pageRange(formatPages(legacyConfirmation.pages), legacyConfirmation.pages.length)} · {copy.sourceLanguage(legacyConfirmation.targetLanguage)}</strong>
              <div className="translation-start-row">
                <button className="button button-primary" type="button" disabled={formDisabled} onClick={confirmLegacyRange}>{copy.confirmRange}</button>
                <button className="button button-secondary" type="button" disabled={formDisabled} onClick={() => setLegacyConfirmation(null)}>{copy.cancelConfirmation}</button>
              </div>
            </div>
          )}


          {operationError && <p className="translation-status" data-kind="error" role="alert">{operationMessage}</p>}
          {pollError && <p className="translation-status" role="status">{copy.pollFailed}</p>}

          {visibleLegacyJob ? (
            <section className="translation-job" aria-label={copy.translation}>
              {visibleLegacyJob.status !== "completed" && <div className="translation-job-summary">
                <div>
                  <strong>{copy[visibleLegacyJob.status]}</strong>
                  <p>{copy.pageRange(formatPages(visibleLegacyJob.pages), visibleLegacyJob.total_pages)}</p>
                </div>
                {!isActive(visibleLegacyJob) && ["failed", "partial", "cancelled", "interrupted"].includes(visibleLegacyJob.status) && (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={Boolean(requestDraft) || Boolean(pendingAction)}
                    onClick={() => void submitTranslation({
                      documentId: visibleLegacyJob.document_id,
                      sourceSha256: visibleLegacyJob.source_sha256,
                      payload: {
                        request_id: crypto.randomUUID(),
                        source_sha256: visibleLegacyJob.source_sha256,
                        pages: [...visibleLegacyJob.pages],
                        target_language: visibleLegacyJob.target_language
                      }
                    })}
                  >
                    {copy.retryJob}
                  </button>
                )}
              </div>}
              {isActive(visibleLegacyJob) && (
                <div className="translation-progress" role="status" aria-live="polite">
                  <p>{copy[visibleLegacyJob.stage]} · {copy.progress(visibleLegacyJob.completed_pages, visibleLegacyJob.total_pages)}</p>
                  <progress max={Math.max(1, visibleLegacyJob.total_pages)} value={visibleLegacyJob.completed_pages} />
                  <button className="button button-secondary" type="button" disabled={Boolean(pendingAction)} onClick={() => void cancelSelected()}>
                    {pendingAction === "cancel" ? copy.cancelling : copy.cancel}
                  </button>
                </div>
              )}
              {visibleLegacyJob.error && <p className="translation-status" data-kind="error" role="alert">{visibleLegacyJob.error.message || copy.jobError}</p>}
              <TranslationResults
                job={visibleLegacyJob}
                copy={copy}
                onSource={source}
                onExcerpt={callbacks.onExcerpt ? excerpt : undefined}
                excerptPending={Boolean(pendingExcerpt)}
              />
            </section>
          ) : (
            <p className="translation-empty">{copy.noSavedTranslation}</p>
          )}
          <details className="translation-options">
            <summary>{copy.more}</summary>
            <form className="translation-form" onSubmit={(event) => {
              event.preventDefault();
              startFromForm(false);
            }}>
              <label className="translation-field" htmlFor="translation-page-input">
                <span>{copy.pagesLabel}</span>
                <input
                  id="translation-page-input"
                  value={pageInput}
                  placeholder={copy.pagesPlaceholder}
                  inputMode="text"
                  autoComplete="off"
                  disabled={formDisabled || Boolean(legacyConfirmation)}
                  onChange={(event) => setPageInput(event.target.value)}
                />
              </label>
              <div className="translation-start-row">
                <button className="button button-secondary" type="submit" disabled={!capabilities?.ready || formDisabled || Boolean(legacyConfirmation)}>{copy.reviewRange}</button>
              </div>
            </form>
          </details>
          <details className="translation-history">
            <summary>{copy.savedRuns}</summary>
            <div className="translation-saved-row">
              <label htmlFor="translation-saved-runs">{copy.savedRuns}</label>
              <select
                id="translation-saved-runs"
                value={visibleLegacyJob?.id || ""}
                disabled={!jobs.length || Boolean(pendingAction)}
                onChange={(event) => void openSaved(event.target.value)}
              >
                {!jobs.length && <option value="">{copy.noSavedRuns}</option>}
                {jobs.map((job) => <option value={job.id} key={job.id}>{runLabel(job, copy, model.language)}</option>)}
              </select>
            </div>
            {jobsError && <p className="translation-status" data-kind="error" role="alert">{copy.listFailed}</p>}
          </details>
        </>
      )}
    </div>
  );

  return <>{controls}{createPortal(panel, panelContainer)}</>;
}

function render(registration: TranslationRegistration, model: TranslationPanelModel) {
  registration.root.render(
    <TranslationExperience
      model={model}
      callbacks={registration.callbacks}
      controlsContainer={registration.controlsContainer}
      panelContainer={registration.panelContainer}
      registerOpener={(opener) => {
        registration.opener = opener;
      }}
    />
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
    opener: null,
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
    async openRecord(request) {
      if (
        !registration.active
        || controlsOwners.get(controlsContainer) !== registration
        || panelOwners.get(panelContainer) !== registration
        || !registration.opener
        || !request || !["run", "job"].includes(request.kind)
        || !request.id || !request.documentId || !request.sourceSha256
      ) return false;
      return registration.opener(request);
    },
    destroy() {
      destroy(registration);
    }
  };
}
