import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

const PARSER_ID = "mineru-flash-txt";
const PARSER_VERSION = "4.1.5";
const RESULT_SCHEMA_VERSION = 1;
const MAX_PAGES = 5;
const MAX_DOCUMENT_PAGES = 200;
const MAX_INPUT_LENGTH = 80;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type SourcePreparationLanguage = "zh" | "en";

export interface SourcePreparationPaper {
  documentId: string;
  sourceSha256: string;
  title: string;
  pageCount: number;
  initialPage: number;
}

export interface SourcePreparationModel {
  language: SourcePreparationLanguage;
  visible: boolean;
  contextKey: string;
  editable: boolean;
  papers: readonly SourcePreparationPaper[];
  preferredDocumentId: string | null;
}

export interface SourcePreparationCallbacks {
  api: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
}

export interface MountSourcePreparationOptions {
  container: HTMLElement;
  model: SourcePreparationModel;
  callbacks: SourcePreparationCallbacks;
  onMounted?: () => void;
}

export interface SourcePreparationHandle {
  update: (model: SourcePreparationModel) => boolean;
  reset: () => void;
  destroy: () => void;
}

interface SourcePreparationSelection {
  contextKey: string;
  key: string;
}

interface SourcePreparationRegistration {
  container: HTMLElement;
  root: Root;
  callbacks: SourcePreparationCallbacks;
  model: SourcePreparationModel;
  selection: SourcePreparationSelection | null;
  reset: ((collapse?: boolean, clearSelection?: boolean) => void) | null;
  active: boolean;
}

interface ReadingCapabilities {
  ready: boolean;
  parser_ready: boolean;
  reason: string | null;
  max_pages: number;
  parser: { id: string; version: string };
  result_schema_version: number;
}

type ResultStatus = "completed" | "partial" | "unavailable";

interface ReadingResultPage {
  page: number;
  status: ResultStatus;
  warning: string | null;
  blocks: unknown[];
}

interface ReadingResponse {
  requested_pages: number[];
  cached_pages: number[];
  missing_pages: number[];
  result_pages: ReadingResultPage[];
}

interface PageState {
  page: number;
  status: ResultStatus | "missing";
  warning: string | null;
}

type OperationAction = "check" | "prepare";
type OperationPhase = "checking" | "preparing";
type NoticeKey = "checkComplete" | "readySameChat" | "waitingCancelled" | "prepareIncomplete";
type PageErrorKey = "pagesEmpty" | "pagesSyntax" | "pagesDuplicate" | "pagesReversed" | "pagesTooMany" | "pagesOutside" | "pagesTooLong";
type OperationErrorKey = PageErrorKey | "invalidResponse" | "prepareBusy" | "sourceChanged" | "sourceUnavailable" | "prepareTimeout" | "prepareCancelled" | "runtimeUnavailable" | "network" | "requestFailed";

interface Operation {
  generation: number;
  contextKey: string;
  sourceKey: string;
  paper: SourcePreparationPaper;
  pages: number[];
  controller: AbortController;
}

interface CapabilityRequest {
  generation: number;
  contextKey: string;
  controller: AbortController;
  promise?: Promise<ReadingCapabilities | null>;
}

type PageParseResult = { ok: true; pages: number[] } | { ok: false; error: PageErrorKey };

const owners = new WeakMap<HTMLElement, SourcePreparationRegistration>();

const strings = {
  zh: {
    title: "准备论文页面",
    help: "选择论文和页码，已有页面可以直接复用。",
    empty: "请先打开论文，或用“添加资料”加入论文。",
    source: "论文来源",
    sourcePages: (count: number) => `共 ${count} 页`,
    untitled: "未命名论文",
    pagesLabel: "页码（最多 5 页）",
    pagesPlaceholder: "例如 1-3,7",
    selectedCount: (count: number) => `已选择 ${count} 页`,
    check: "检查已准备页面",
    prepare: (count: number | null) => count === null ? "准备页面" : `准备 ${count} 页`,
    retry: "按相同范围重试",
    cancel: "取消等待",
    checking: "正在检查已保存的页面…",
    preparing: "正在准备缺失页面…",
    capabilitiesLoading: "正在读取页面准备能力…",
    runtimeUnavailable: "页面准备运行环境暂不可用；仍可检查已经准备的页面。",
    checkComplete: "缓存检查完成；未启动页面准备。",
    readySameChat: "所选页面已处理，可在当前对话中继续提问。",
    waitingCancelled: "已取消等待",
    prepareIncomplete: "部分页面尚未准备；可按相同范围重试。",
    preparedMeaning: "准备后的原文页面可用于助手检索。",
    completed: "已准备",
    partial: "部分可用",
    unavailable: "无可用文字",
    missing: "尚未准备",
    page: (page: number) => `第 ${page} 页`,
    pagesEmpty: "请输入页码。",
    pagesSyntax: "请用半角数字、逗号和短横线，例如 1-3,7。",
    pagesDuplicate: "页码或重叠范围不能重复。",
    pagesReversed: "范围起始页不能大于结束页。",
    pagesTooMany: "每次最多选择 5 页。",
    pagesOutside: "页码必须介于 1 和当前论文总页数之间，且文档不能超过 200 页。",
    pagesTooLong: "页码输入过长，请缩短后重试。",
    invalidResponse: "页面状态暂时无法确认，请重新检查。",
    prepareBusy: "已有页面准备任务正在运行；请稍后按相同范围重试。",
    sourceChanged: "论文版本已变化，请重新选择或重新加入资料。",
    sourceUnavailable: "无法读取论文原文件，请重新选择或检查资料。",
    prepareTimeout: "页面准备超时；可按相同范围重试。",
    prepareCancelled: "页面准备已取消；已显示的缓存结果保留。",
    network: "无法连接本地服务；已显示的缓存结果保留，可按相同范围重试。",
    requestFailed: "请求未完成；已显示的缓存结果保留，可按相同范围重试。"
  },
  en: {
    title: "Prepare paper pages",
    help: "Select a paper and pages. Prepared pages can be reused.",
    empty: "Open a paper or add one with Add references.",
    source: "Paper source",
    sourcePages: (count: number) => `${count} pages`,
    untitled: "Untitled paper",
    pagesLabel: "Pages (up to 5)",
    pagesPlaceholder: "For example, 1-3,7",
    selectedCount: (count: number) => `${count} selected`,
    check: "Check prepared pages",
    prepare: (count: number | null) => count === null ? "Prepare pages" : `Prepare ${count} ${count === 1 ? "page" : "pages"}`,
    retry: "Retry same scope",
    cancel: "Cancel waiting",
    checking: "Checking saved pages…",
    preparing: "Preparing missing pages…",
    capabilitiesLoading: "Reading page-preparation availability…",
    runtimeUnavailable: "The page-preparation runtime is unavailable. Already prepared pages can still be checked.",
    checkComplete: "Cache check complete. Preparation was not started.",
    readySameChat: "The selected pages have been processed. Continue asking in this chat.",
    waitingCancelled: "Waiting cancelled",
    prepareIncomplete: "Some pages are not prepared. Retry the same scope if appropriate.",
    preparedMeaning: "Prepared source pages can be searched by the assistant.",
    completed: "Prepared",
    partial: "Partial",
    unavailable: "No usable text",
    missing: "Not prepared",
    page: (page: number) => `Page ${page}`,
    pagesEmpty: "Enter one or more pages.",
    pagesSyntax: "Use numbers, commas, and hyphens, for example 1-3,7.",
    pagesDuplicate: "Pages and overlapping ranges must not contain duplicates.",
    pagesReversed: "A range cannot end before it starts.",
    pagesTooMany: "Select at most 5 pages at a time.",
    pagesOutside: "Pages must be within the paper, and the document cannot exceed 200 pages.",
    pagesTooLong: "The page expression is too long. Shorten it and try again.",
    invalidResponse: "The page status could not be confirmed. Check again.",
    prepareBusy: "Another page-preparation task is already running. Retry the same scope later.",
    sourceChanged: "The paper version changed. Select it again or add the reference again.",
    sourceUnavailable: "The original paper file is unavailable. Select it again or check the material.",
    prepareTimeout: "Page preparation timed out. Retry the same scope if appropriate.",
    prepareCancelled: "Page preparation was cancelled. Displayed cached results are retained.",
    network: "The local service could not be reached. Displayed cached results are retained; retry the same scope if appropriate.",
    requestFailed: "The request was not completed. Displayed cached results are retained; retry the same scope if appropriate."
  }
} as const;

function sourceKey(paper: SourcePreparationPaper) {
  return `${paper.documentId}:${paper.sourceSha256}`;
}

function validPapers(items: readonly SourcePreparationPaper[]) {
  const papers: SourcePreparationPaper[] = [];
  const keys = new Set<string>();
  for (const item of items) {
    if (!UUID_PATTERN.test(item.documentId) || !SHA256_PATTERN.test(item.sourceSha256)
      || !Number.isInteger(item.pageCount) || item.pageCount < 1 || item.pageCount > MAX_DOCUMENT_PAGES) continue;
    const key = sourceKey(item);
    if (keys.has(key)) continue;
    keys.add(key);
    papers.push({
      documentId: item.documentId,
      sourceSha256: item.sourceSha256,
      title: typeof item.title === "string" ? item.title : "",
      pageCount: item.pageCount,
      initialPage: Number.isInteger(item.initialPage) && item.initialPage >= 1 && item.initialPage <= item.pageCount ? item.initialPage : 1
    });
  }
  return papers;
}

function preferredPaper(model: SourcePreparationModel, papers: readonly SourcePreparationPaper[]) {
  return papers.find((paper) => paper.documentId === model.preferredDocumentId) || papers[0] || null;
}

function validatedModel(model: SourcePreparationModel): SourcePreparationModel {
  return { ...model, papers: validPapers(model.papers) };
}

function selectedPaperFor(registration: SourcePreparationRegistration) {
  const { model, selection } = registration;
  const explicitlySelected = selection?.contextKey === model.contextKey
    ? model.papers.find((paper) => sourceKey(paper) === selection.key)
    : undefined;
  return explicitlySelected || preferredPaper(model, model.papers);
}

function selectedIdentity(paper: SourcePreparationPaper | null) {
  return paper ? `${sourceKey(paper)}:${paper.pageCount}` : "";
}

function parsePages(value: string, pageCount: number): PageParseResult {
  if (value.length > MAX_INPUT_LENGTH) return { ok: false, error: "pagesTooLong" };
  const normalized = value.trim();
  if (!normalized) return { ok: false, error: "pagesEmpty" };
  const pages = new Set<number>();
  for (const part of normalized.split(",")) {
    const match = /^([0-9]+)(?:\s*-\s*([0-9]+))?$/.exec(part.trim());
    if (!match) return { ok: false, error: "pagesSyntax" };
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return { ok: false, error: "pagesOutside" };
    if (last < first) return { ok: false, error: "pagesReversed" };
    if (first < 1 || last > pageCount || last > MAX_DOCUMENT_PAGES) return { ok: false, error: "pagesOutside" };
    if (pages.size + (last - first + 1) > MAX_PAGES) return { ok: false, error: "pagesTooMany" };
    for (let page = first; page <= last; page += 1) {
      if (pages.has(page)) return { ok: false, error: "pagesDuplicate" };
      pages.add(page);
      if (pages.size > MAX_PAGES) return { ok: false, error: "pagesTooMany" };
    }
  }
  return pages.size ? { ok: true, pages: [...pages].sort((a, b) => a - b) } : { ok: false, error: "pagesEmpty" };
}

function samePages(actual: unknown, expected: readonly number[]) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((page, index) => page === expected[index]);
}

function validPageSet(value: unknown, requested: readonly number[], pageCount: number): value is number[] {
  if (!Array.isArray(value)) return false;
  const pages = new Set<number>();
  for (const page of value) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount || !requested.includes(page) || pages.has(page)) return false;
    pages.add(page);
  }
  return true;
}

function parseCapabilities(value: unknown): ReadingCapabilities | null {
  if (!value || typeof value !== "object") return null;
  const capabilities = value as Partial<ReadingCapabilities>;
  if (typeof capabilities.ready !== "boolean" || typeof capabilities.parser_ready !== "boolean"
    || !(typeof capabilities.reason === "string" || capabilities.reason === null)
    || capabilities.max_pages !== MAX_PAGES || capabilities.result_schema_version !== RESULT_SCHEMA_VERSION
    || capabilities.parser?.id !== PARSER_ID || capabilities.parser.version !== PARSER_VERSION) return null;
  return capabilities as ReadingCapabilities;
}

function parseReadingResponse(value: unknown, operation: Operation, requestedPages: readonly number[]): ReadingResponse {
  if (!value || typeof value !== "object") throw new Error("invalid_response");
  const response = value as Partial<ReadingResponse> & {
    document_id?: unknown;
    source_sha256?: unknown;
    parser?: { id?: unknown; version?: unknown };
    result_schema_version?: unknown;
  };
  if (response.document_id !== operation.paper.documentId || response.source_sha256 !== operation.paper.sourceSha256
    || response.parser?.id !== PARSER_ID || response.parser.version !== PARSER_VERSION
    || response.result_schema_version !== RESULT_SCHEMA_VERSION
    || !samePages(response.requested_pages, requestedPages)
    || !validPageSet(response.cached_pages, requestedPages, operation.paper.pageCount)
    || !validPageSet(response.missing_pages, requestedPages, operation.paper.pageCount)
    || !Array.isArray(response.result_pages)) throw new Error("invalid_response");
  const cached = new Set(response.cached_pages);
  const missing = new Set(response.missing_pages);
  if (cached.size + missing.size !== requestedPages.length
    || requestedPages.some((page) => cached.has(page) === missing.has(page))) throw new Error("invalid_response");
  const results = new Map<number, ReadingResultPage>();
  for (const page of response.result_pages) {
    if (!page || typeof page !== "object" || !Number.isInteger(page.page) || !cached.has(page.page)
      || results.has(page.page) || !["completed", "partial", "unavailable"].includes(page.status)
      || !(typeof page.warning === "string" || page.warning === null) || !Array.isArray(page.blocks)) throw new Error("invalid_response");
    results.set(page.page, { page: page.page, status: page.status, warning: page.warning, blocks: page.blocks });
  }
  if (results.size !== cached.size || [...cached].some((page) => !results.has(page))) throw new Error("invalid_response");
  return {
    requested_pages: [...requestedPages],
    cached_pages: [...response.cached_pages],
    missing_pages: [...response.missing_pages],
    result_pages: [...results.values()]
  };
}

function responsePageStates(response: ReadingResponse): PageState[] {
  const results = new Map(response.result_pages.map((page) => [page.page, page]));
  return response.requested_pages.map((page) => {
    const result = results.get(page);
    return result
      ? { page, status: result.status, warning: result.warning }
      : { page, status: "missing", warning: null };
  });
}

function mergedPageStates(operation: Operation, cached: ReadingResponse, prepared: ReadingResponse): PageState[] {
  const states = new Map<number, PageState>();
  for (const state of responsePageStates(cached)) {
    if (state.status !== "missing") states.set(state.page, state);
  }
  for (const state of responsePageStates(prepared)) states.set(state.page, state);
  return operation.pages.map((page) => states.get(page) || { page, status: "missing", warning: null });
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code;
  return "";
}

function operationError(error: unknown): OperationErrorKey {
  if (error instanceof Error && error.message === "invalid_response") return "invalidResponse";
  const code = errorCode(error);
  if (code === "reading_prepare_busy") return "prepareBusy";
  if (["source_changed", "document_changed", "source_hash_mismatch"].includes(code)) return "sourceChanged";
  if (["not_found", "file_missing", "source_missing", "document_trashed", "document_purged", "source_has_no_pdf"].includes(code)) return "sourceUnavailable";
  if (["reading_prepare_timeout", "parser_timeout", "timeout"].includes(code)) return "prepareTimeout";
  if (code === "reading_prepare_cancelled") return "prepareCancelled";
  if (["parser_unavailable", "parser_failed", "reading_prepare_unavailable", "reading_runtime_unavailable"].includes(code)) return "runtimeUnavailable";
  if (code === "network" || error instanceof TypeError) return "network";
  return "requestFailed";
}

function SourcePreparationSection({ model, callbacks, registration }: {
  model: SourcePreparationModel;
  callbacks: SourcePreparationCallbacks;
  registration: SourcePreparationRegistration;
}) {
  const copy = strings[model.language];
  const papers = model.papers;
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<SourcePreparationSelection | null>(registration.selection);
  const explicitlySelected = selection?.contextKey === model.contextKey
    ? papers.find((paper) => sourceKey(paper) === selection.key)
    : undefined;
  const selectedPaper = explicitlySelected || preferredPaper(model, papers);
  const selectedSourceKey = selectedPaper ? sourceKey(selectedPaper) : "";
  const [pageInput, setPageInput] = useState(String(selectedPaper?.initialPage || 1));
  const [busy, setBusy] = useState<OperationAction | null>(null);
  const [phase, setPhase] = useState<OperationPhase | null>(null);
  const [pageStates, setPageStates] = useState<PageState[]>([]);
  const [notice, setNotice] = useState<NoticeKey | null>(null);
  const [error, setError] = useState<OperationErrorKey | null>(null);
  const [retryAction, setRetryAction] = useState<OperationAction | null>(null);
  const [capabilitiesState, setCapabilitiesState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const pageInputRef = useRef(pageInput);
  const openRef = useRef(open);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const operationRef = useRef<Operation | null>(null);
  const capabilityGenerationRef = useRef(0);
  const capabilityRequestRef = useRef<CapabilityRequest | null>(null);
  const capabilitiesRef = useRef<ReadingCapabilities | null>(null);
  registration.selection = selection;
  pageInputRef.current = pageInput;
  openRef.current = open;

  function detailsIsOpen() {
    return openRef.current && detailsRef.current?.open === true;
  }

  function operationIsCurrent(operation: Operation) {
    const currentModel = registration.model;
    const currentPaper = selectedPaperFor(registration);
    return mountedRef.current && registration.active && operationRef.current === operation
      && generationRef.current === operation.generation && currentModel.visible && detailsIsOpen()
      && currentModel.contextKey === operation.contextKey && currentPaper
      && sourceKey(currentPaper) === operation.sourceKey && currentPaper.pageCount === operation.paper.pageCount;
  }

  function capabilityIsCurrent(request: CapabilityRequest) {
    const currentModel = registration.model;
    return mountedRef.current && registration.active && capabilityRequestRef.current === request
      && capabilityGenerationRef.current === request.generation && currentModel.visible && detailsIsOpen()
      && currentModel.contextKey === request.contextKey;
  }

  function resetCapabilities() {
    capabilityGenerationRef.current += 1;
    const request = capabilityRequestRef.current;
    capabilityRequestRef.current = null;
    request?.controller.abort();
    capabilitiesRef.current = null;
    setCapabilitiesState("idle");
  }

  function resetWork(collapse: boolean, clearSelection: boolean) {
    generationRef.current += 1;
    const operation = operationRef.current;
    operationRef.current = null;
    operation?.controller.abort();
    resetCapabilities();
    if (clearSelection) {
      registration.selection = null;
      setSelection(null);
    }
    if (collapse) {
      openRef.current = false;
      if (detailsRef.current) detailsRef.current.open = false;
      setOpen(false);
    }
    setBusy(null);
    setPhase(null);
    const nextPageInput = String(selectedPaperFor(registration)?.initialPage || 1);
    pageInputRef.current = nextPageInput;
    setPageInput(nextPageInput);
    setPageStates([]);
    setNotice(null);
    setError(null);
    setRetryAction(null);
  }

  registration.reset = (collapse = true, clearSelection = true) => resetWork(collapse, clearSelection);

  useEffect(() => {
    return () => {
      registration.reset = null;
      mountedRef.current = false;
      generationRef.current += 1;
      operationRef.current?.controller.abort();
      operationRef.current = null;
      capabilityGenerationRef.current += 1;
      capabilityRequestRef.current?.controller.abort();
      capabilityRequestRef.current = null;
    };
  }, [registration]);

  function ensureCapabilities(refresh = false) {
    const currentModel = registration.model;
    if (!currentModel.visible || !detailsIsOpen() || !currentModel.contextKey) return Promise.resolve(null);
    if (refresh && capabilitiesRef.current) resetCapabilities();
    if (capabilitiesRef.current) return Promise.resolve(capabilitiesRef.current);
    const existing = capabilityRequestRef.current;
    if (existing && existing.contextKey === currentModel.contextKey) return existing.promise || Promise.resolve(null);
    const request: CapabilityRequest = {
      generation: ++capabilityGenerationRef.current,
      contextKey: currentModel.contextKey,
      controller: new AbortController()
    };
    capabilityRequestRef.current = request;
    setCapabilitiesState("loading");
    request.promise = (async () => {
      try {
        const body = await callbacks.api<unknown>("/api/v1/reading-capabilities", { signal: request.controller.signal });
        const capabilities = parseCapabilities(body);
        if (capabilityIsCurrent(request)) {
          capabilitiesRef.current = capabilities;
          setCapabilitiesState(capabilities?.ready && capabilities.parser_ready ? "ready" : "unavailable");
        }
        return capabilities;
      } catch {
        if (capabilityIsCurrent(request)) {
          capabilitiesRef.current = null;
          setCapabilitiesState("unavailable");
        }
        return null;
      } finally {
        if (capabilityRequestRef.current === request) capabilityRequestRef.current = null;
      }
    })();
    return request.promise;
  }

  useEffect(() => {
    if (open && model.visible && selectedPaper) void ensureCapabilities();
  }, [open, model.visible, model.contextKey, Boolean(selectedPaper)]);

  async function requestPages(operation: Operation, pages: number[], method: "GET" | "POST") {
    const base = `/api/v1/documents/${encodeURIComponent(operation.paper.documentId)}/reading-pages`;
    if (method === "GET") {
      const query = new URLSearchParams({ source_sha256: operation.paper.sourceSha256, pages: pages.join(",") });
      const body = await callbacks.api<unknown>(`${base}?${query.toString()}`, { signal: operation.controller.signal });
      return parseReadingResponse(body, operation, pages);
    }
    const body = await callbacks.api<unknown>(`${base}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_sha256: operation.paper.sourceSha256, pages }),
      signal: operation.controller.signal
    });
    return parseReadingResponse(body, operation, pages);
  }

  async function run(action: OperationAction) {
    const currentModel = registration.model;
    const paper = selectedPaperFor(registration);
    if (!currentModel.visible || !detailsIsOpen() || !currentModel.editable || !paper || operationRef.current) return;
    const parsed = parsePages(pageInputRef.current, paper.pageCount);
    if (!parsed.ok) {
      setError(parsed.error);
      setNotice(null);
      setRetryAction(null);
      return;
    }
    const operation: Operation = {
      generation: ++generationRef.current,
      contextKey: currentModel.contextKey,
      sourceKey: sourceKey(paper),
      paper,
      pages: parsed.pages,
      controller: new AbortController()
    };
    operationRef.current = operation;
    setBusy(action);
    setPhase("checking");
    setPageStates([]);
    setNotice(null);
    setError(null);
    setRetryAction(null);
    try {
      const cached = await requestPages(operation, operation.pages, "GET");
      if (!operationIsCurrent(operation)) return;
      setPageStates(responsePageStates(cached));
      if (action === "check") {
        setNotice("checkComplete");
        return;
      }
      if (!cached.missing_pages.length) {
        setNotice("readySameChat");
        return;
      }
      const cachedCapabilities = capabilitiesRef.current;
      const capabilities = cachedCapabilities?.ready && cachedCapabilities.parser_ready
        ? cachedCapabilities
        : await ensureCapabilities(true);
      if (!operationIsCurrent(operation)) return;
      if (!capabilities?.ready || !capabilities.parser_ready) {
        setError("runtimeUnavailable");
        setRetryAction("prepare");
        return;
      }
      setPhase("preparing");
      const prepared = await requestPages(operation, cached.missing_pages, "POST");
      if (!operationIsCurrent(operation)) return;
      const merged = mergedPageStates(operation, cached, prepared);
      setPageStates(merged);
      if (merged.every((page) => page.status !== "missing")) setNotice("readySameChat");
      else {
        setNotice("prepareIncomplete");
        setRetryAction("prepare");
      }
    } catch (requestError) {
      if (!operationIsCurrent(operation)) return;
      const errorKey = operationError(requestError);
      if (errorKey === "runtimeUnavailable") resetCapabilities();
      setError(errorKey);
      setRetryAction(["invalidResponse", "sourceChanged", "sourceUnavailable"].includes(errorKey) ? null : action);
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        setBusy(null);
        setPhase(null);
      }
    }
  }

  function cancelWaiting() {
    const operation = operationRef.current;
    if (!operation && !capabilityRequestRef.current) return;
    generationRef.current += 1;
    operationRef.current = null;
    operation?.controller.abort();
    resetCapabilities();
    setBusy(null);
    setPhase(null);
    setNotice("waitingCancelled");
    setError(null);
    setRetryAction(null);
  }

  const parsed = selectedPaper ? parsePages(pageInput, selectedPaper.pageCount) : null;
  const selectedCount = parsed?.ok ? parsed.pages.length : null;
  const controlsDisabled = Boolean(busy) || !model.editable;

  return (
    <details
      ref={detailsRef}
      className="source-preparation"
      open={open}
      hidden={!model.visible}
      onToggle={(event) => {
        const isOpen = event.currentTarget.open;
        openRef.current = isOpen;
        if (isOpen) setOpen(true);
        else resetWork(true, true);
      }}
    >
      <summary>{copy.title}</summary>
      <div className="source-preparation-body">
        <p className="source-preparation-help">{copy.help}</p>
        {!selectedPaper ? <p className="source-preparation-empty">{copy.empty}</p> : (
          <>
            <div className="source-preparation-field">
              <label htmlFor="source-preparation-source">{copy.source}</label>
              <select
                id="source-preparation-source"
                value={selectedSourceKey}
                title={selectedPaper.title || copy.untitled}
                disabled={controlsDisabled}
                onChange={(event) => {
                  registration.selection = { contextKey: registration.model.contextKey, key: event.target.value };
                  setSelection(registration.selection);
                  resetWork(false, false);
                }}
              >
                {papers.map((paper) => (
                  <option value={sourceKey(paper)} key={sourceKey(paper)} title={paper.title || copy.untitled}>
                    {paper.title || copy.untitled} · {copy.sourcePages(paper.pageCount)}
                  </option>
                ))}
              </select>
            </div>
            <div className="source-preparation-field">
              <label htmlFor="source-preparation-pages">{copy.pagesLabel}</label>
              <input
                id="source-preparation-pages"
                value={pageInput}
                inputMode="text"
                autoComplete="off"
                placeholder={copy.pagesPlaceholder}
                disabled={controlsDisabled}
                aria-describedby="source-preparation-page-count source-preparation-page-meaning"
                onChange={(event) => {
                  pageInputRef.current = event.target.value;
                  setPageInput(event.target.value);
                  setPageStates([]);
                  setError(null);
                  setNotice(null);
                  setRetryAction(null);
                }}
              />
            </div>
            <p id="source-preparation-page-count" className="source-preparation-count" aria-live="polite">
              {parsed?.ok ? copy.selectedCount(parsed.pages.length) : copy[parsed && !parsed.ok ? parsed.error : "pagesEmpty"]}
            </p>
            <div className="source-preparation-actions">
              <button className="button button-secondary" type="button" disabled={controlsDisabled || !parsed?.ok} onClick={() => void run("check")}>
                {copy.check}
              </button>
              <button className="button button-primary" type="button" disabled={controlsDisabled || !parsed?.ok} onClick={() => void run("prepare")}>
                {copy.prepare(selectedCount)}
              </button>
              {busy && <button className="button button-secondary" type="button" onClick={cancelWaiting}>{copy.cancel}</button>}
              {retryAction && !busy && (
                <button className="button button-quiet" type="button" disabled={!model.editable} onClick={() => void run(retryAction)}>
                  {copy.retry}
                </button>
              )}
            </div>
            {capabilitiesState === "loading" && <p className="source-preparation-status" role="status">{copy.capabilitiesLoading}</p>}
            {capabilitiesState === "unavailable" && <p className="source-preparation-status" data-kind="error" role="status">{copy.runtimeUnavailable}</p>}
            {phase && <p className="source-preparation-status" role="status">{copy[phase]}</p>}
            {notice && <p className="source-preparation-status" data-kind="success" role="status">{copy[notice]}</p>}
            {error && <p className="source-preparation-status" data-kind="error" role="alert">{copy[error]}</p>}
            {pageStates.length > 0 && (
              <ul className="source-preparation-pages" aria-label={copy.title}>
                {pageStates.map((page) => (
                  <li className="source-preparation-page" data-status={page.status} key={page.page}>
                    <div className="source-preparation-page-heading">
                      <span>{copy.page(page.page)}</span>
                      <strong>{copy[page.status]}</strong>
                    </div>
                    {page.warning && <p className="source-preparation-warning">{page.warning}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p id="source-preparation-page-meaning" className="source-preparation-help">{copy.preparedMeaning}</p>
          </>
        )}
      </div>
    </details>
  );
}

function render(registration: SourcePreparationRegistration, model: SourcePreparationModel) {
  registration.root.render(<SourcePreparationSection model={model} callbacks={registration.callbacks} registration={registration} />);
}

function destroy(registration: SourcePreparationRegistration) {
  if (!registration.active) return;
  registration.active = false;
  if (owners.get(registration.container) === registration) owners.delete(registration.container);
  registration.root.unmount();
}

export function mountSourcePreparation({
  container,
  model,
  callbacks,
  onMounted
}: MountSourcePreparationOptions): SourcePreparationHandle {
  if (!(container instanceof HTMLElement) || !container.id) throw new TypeError("Source preparation requires an identified HTML host");
  const previous = owners.get(container);
  if (previous) destroy(previous);
  const initialModel = validatedModel(model);
  const registration: SourcePreparationRegistration = {
    container,
    root: createRoot(container),
    callbacks,
    model: initialModel,
    selection: null,
    reset: null,
    active: true
  };
  owners.set(container, registration);
  flushSync(() => render(registration, initialModel));
  onMounted?.();
  return {
    update(nextModel) {
      if (!registration.active || owners.get(container) !== registration) return false;
      const previousModel = registration.model;
      const previousIdentity = selectedIdentity(selectedPaperFor(registration));
      const validated = validatedModel(nextModel);
      registration.model = validated;
      const nextIdentity = selectedIdentity(selectedPaperFor(registration));
      if (previousModel.contextKey !== validated.contextKey || previousModel.visible !== validated.visible) {
        registration.reset?.(true, true);
      } else if (previousIdentity !== nextIdentity) {
        registration.reset?.(false, false);
      }
      render(registration, validated);
      return true;
    },
    reset() {
      if (registration.active && owners.get(container) === registration) registration.reset?.();
    },
    destroy() {
      destroy(registration);
    }
  };
}
