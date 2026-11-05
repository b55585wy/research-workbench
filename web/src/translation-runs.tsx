import { useEffect, useRef, useState, type ReactNode } from "react";

export type RunTargetLanguage = "zh" | "en";
export type TranslationRunStatus = "queued" | "running" | "paused" | "completed" | "partial" | "failed" | "interrupted";

export interface RunResultPage {
  page: number;
  status: "completed" | "unavailable" | "failed";
  warning: string | null;
  blocks: Array<{
    id: string;
    kind: "text" | "title" | "caption" | "formula" | "image" | "table" | "code" | "other";
    order: number;
    rect: { x: number; y: number; width: number; height: number } | null;
    source_text: string;
    translated_text: string | null;
  }>;
  job_id: string;
}

export interface TranslationRun {
  id: string;
  document_id: string;
  source_sha256: string;
  pages: number[];
  target_language: RunTargetLanguage;
  status: TranslationRunStatus;
  stage: "queued" | "parsing" | "translating" | "finished";
  revision: number;
  total_pages: number;
  processed_pages: number;
  completed_pages: number;
  reused_pages: number;
  active_job_id: string | null;
  created_at: string;
  updated_at: string;
  error: { code: string; message: string } | null;
  parser: { id: string; version: string };
  model: { name: string };
  model_fingerprint: string;
  prompt_version: string;
  result_schema_version: number;
  result_pages: RunResultPage[];
}

interface RunDocument {
  id: string;
  sha256: string;
  pageCount: number;
}

export interface TranslationRunCapabilities {
  ready: boolean;
  model_ready: boolean;
  reason: string | null;
  run_support?: boolean;
  run_max_pages?: number;
}

type CreateDraft = {
  kind: "create";
  documentId: string;
  sourceSha256: string;
  payload: {
    request_id: string;
    source_sha256: string;
    pages: number[];
    target_language: RunTargetLanguage;
    confirmed: true;
  };
};

type ControlDraft = {
  kind: "pause" | "resume";
  documentId: string;
  sourceSha256: string;
  runId: string;
  payload: {
    request_id: string;
    expected_revision: number;
    confirmed: true;
  };
};

type RequestDraft = CreateDraft | ControlDraft;
type Confirmation =
  | { kind: "create"; pages: number[]; targetLanguage: RunTargetLanguage }
  | { kind: "resume"; run: TranslationRun };

const strings = {
  zh: {
    continuous: "翻译",
    startCurrent: "翻译本页",
    more: "整篇或页码范围",
    history: "翻译记录",
    current: "当前页",
    whole: "整篇文献",
    range: "页码范围",
    rangeLabel: "页码（最多 200 页）",
    rangePlaceholder: "例如 1-10,15,20-22",
    target: "翻译为",
    chinese: "中文",
    english: "英文",
    review: "核对并开始",
    confirmStart: "确认发送并开始",
    confirmResume: "确认发送并继续",
    cancelConfirmation: "返回修改",
    stop: "停止后续翻译",
    stopping: "正在停止…",
    continue: "继续翻译",
    starting: "正在提交…",
    resuming: "正在继续…",
    retry: "重试同一请求",
    retryHint: "网络结果不确定时会保留完全相同的请求，避免重复操作。",
    feeNotice: "确认后，所选页面会发送给已配置的模型服务，可能产生服务商费用。",
    resumeNotice: "继续只会处理尚未完成的页面；所选范围会发送给已配置的模型服务，可能产生服务商费用。",
    confirmScope: (pages: string, count: number, language: string) => `发送范围：第 ${pages} 页，共 ${count} 页；语言：${language}。`,
    saved: "翻译记录",
    noSaved: "暂无翻译记录",
    refresh: "刷新",
    loadingList: "正在读取翻译记录…",
    listFailed: "无法读取翻译记录。",
    loadingRun: "正在读取已存译文…",
    loadFailed: "无法读取这条记录或所选页面，请重试。",
    requestFailed: "操作未完成，请重试。",
    network: "连接结果不确定；请使用同一请求重试。",
    invalidPages: "请输入有效页码，范围不能超出文献页数或 200 页上限。",
    unsupported: "当前服务不支持批量翻译；已保存译文仍可阅读。",
    wholeTooLarge: "整篇翻译一次最多授权 200 页。此文献超出上限，请改用明确的页码范围；系统不会自动截断。",
    queued: "排队中",
    running: "翻译中",
    paused: "已停止",
    completed: "已完成",
    partial: "部分完成",
    failed: "失败",
    interrupted: "已中断，需手动继续",
    parsing: "正在解析原文",
    translating: "正在翻译",
    finished: "处理已结束",
    pages: (pages: string, count: number) => `第 ${pages} 页 · 共 ${count} 页`,
    processed: (value: number, total: number) => `已处理 ${value} / ${total} 页`,
    completedProgress: (value: number, total: number) => `已有完整译文 ${value} / ${total} 页`,
    unavailable: (count: number) => count > 0 ? `${count} 页已处理但没有完整译文，原文仍可阅读。` : "暂无已处理的缺失页面。",
    waiting: (count: number) => count > 0 ? `${count} 页尚未处理。` : "所有授权页面均已处理。",
    viewPage: "查看已存页面",
    viewPageHint: "切换这里只会读取已保存结果，不会开始翻译。",
    runError: "这次翻译未完成；已保存的页面仍可查看。",
    stopFailed: "停止请求未完成，请重试。",
    continueFailed: "继续请求未完成，请重试。",
    openSettings: "打开模型设置",
    language: (language: RunTargetLanguage) => language === "zh" ? "中文" : "英文"
  },
  en: {
    continuous: "Translation",
    startCurrent: "Translate this page",
    more: "Whole paper or page range",
    history: "Translation history",
    current: "Current page",
    whole: "Whole paper",
    range: "Page range",
    rangeLabel: "Pages (up to 200)",
    rangePlaceholder: "For example, 1-10,15,20-22",
    target: "Translate into",
    chinese: "Chinese",
    english: "English",
    review: "Review scope",
    confirmStart: "Confirm and start",
    confirmResume: "Confirm and continue",
    cancelConfirmation: "Back",
    stop: "Stop further translation",
    stopping: "Stopping…",
    continue: "Continue translation",
    starting: "Submitting…",
    resuming: "Continuing…",
    retry: "Retry same request",
    retryHint: "The same request is retained after an uncertain network result.",
    feeNotice: "The selected pages will be sent to the configured model provider; charges may apply.",
    resumeNotice: "Only incomplete pages will be sent to the configured model provider; charges may apply.",
    confirmScope: (pages: string, count: number, language: string) => `Pages ${pages} (${count} total) · ${language}.`,
    saved: "Translation history",
    noSaved: "No translations yet",
    refresh: "Refresh",
    loadingList: "Reading translation history…",
    listFailed: "Translation history could not be read.",
    loadingRun: "Reading the saved translation…",
    loadFailed: "This record or selected page could not be read. Try again.",
    requestFailed: "The operation was not completed. Try again.",
    network: "The connection result is uncertain; retry the same request.",
    invalidPages: "Enter valid pages within the paper and the 200-page limit.",
    unsupported: "Batch translation is unavailable; saved translations remain readable.",
    wholeTooLarge: "Whole-paper translation authorizes at most 200 pages. Choose an explicit page range instead; the paper will not be truncated automatically.",
    queued: "Queued",
    running: "Running",
    paused: "Stopped",
    completed: "Completed",
    partial: "Partially completed",
    failed: "Failed",
    interrupted: "Interrupted; manual continue required",
    parsing: "Parsing the original",
    translating: "Translating",
    finished: "Processing finished",
    pages: (pages: string, count: number) => `Pages ${pages} · ${count} total`,
    processed: (value: number, total: number) => `${value} of ${total} pages processed`,
    completedProgress: (value: number, total: number) => `${value} of ${total} pages have complete translations`,
    unavailable: (count: number) => count > 0 ? `${count} processed pages have no complete translation; their originals remain readable.` : "No processed pages are missing from the complete-page count.",
    waiting: (count: number) => count > 0 ? `${count} pages have not been processed.` : "Every authorized page has been processed.",
    viewPage: "View saved page",
    viewPageHint: "Changing this page only reads saved results; it never starts translation.",
    runError: "This translation did not finish. Pages already saved remain available.",
    stopFailed: "The stop request was not completed. Try again.",
    continueFailed: "The continue request was not completed. Try again.",
    openSettings: "Open model settings",
    language: (language: RunTargetLanguage) => language === "zh" ? "Chinese" : "English"
  }
} as const;

type Copy = (typeof strings)["en"] | (typeof strings)["zh"];
const activeStatuses = new Set<TranslationRunStatus>(["queued", "running"]);

function isAbort(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "request_failed";
}

function failed(code: string) {
  return Object.assign(new Error(code), { code });
}

export function runInScope(value: unknown, document: RunDocument): value is TranslationRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<TranslationRun>;
  return typeof run.id === "string"
    && run.document_id === document.id
    && run.source_sha256 === document.sha256
    && Array.isArray(run.pages)
    && run.pages.length >= 1
    && run.pages.length <= 200
    && run.pages.every((page, index) => Number.isInteger(page) && page >= 1 && page <= document.pageCount && (index === 0 || page > (run.pages as number[])[index - 1]))
    && run.total_pages === run.pages.length
    && (run.target_language === "zh" || run.target_language === "en")
    && ["queued", "running", "paused", "completed", "partial", "failed", "interrupted"].includes(run.status as TranslationRunStatus)
    && ["queued", "parsing", "translating", "finished"].includes(run.stage as TranslationRun["stage"])
    && Number.isInteger(run.revision) && Number(run.revision) > 0
    && Number.isInteger(run.processed_pages) && Number(run.processed_pages) >= 0 && Number(run.processed_pages) <= run.total_pages
    && Number.isInteger(run.completed_pages) && Number(run.completed_pages) >= 0 && Number(run.completed_pages) <= Number(run.processed_pages)
    && typeof run.created_at === "string"
    && typeof run.updated_at === "string"
    && Array.isArray(run.result_pages);
}

function validRunDetail(run: TranslationRun, runId: string, page: number) {
  return run.id === runId
    && run.pages.includes(page)
    && run.result_pages.length <= 1
    && run.result_pages.every((result) => result.page === page
      && ["completed", "unavailable", "failed"].includes(result.status)
      && typeof result.job_id === "string" && Boolean(result.job_id)
      && Array.isArray(result.blocks));
}

export function formatRunPages(pages: number[]) {
  const parts: string[] = [];
  for (let index = 0; index < pages.length;) {
    const first = pages[index];
    let last = first;
    while (index + 1 < pages.length && pages[index + 1] === last + 1) {
      index += 1;
      last = pages[index];
    }
    parts.push(first === last ? String(first) : `${first}-${last}`);
    index += 1;
  }
  return parts.join(", ");
}

function parsePages(value: string, pageCount: number, maxPages: number) {
  const pages = new Set<number>();
  const normalized = value.trim().replaceAll(/[，、]/g, ",").replaceAll(/[–—]/g, "-");
  if (!normalized) return null;
  for (const part of normalized.split(",")) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) return null;
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > pageCount || last - first + 1 > maxPages) return null;
    for (let page = first; page <= last; page += 1) pages.add(page);
    if (pages.size > maxPages) return null;
  }
  return pages.size ? [...pages].sort((a, b) => a - b) : null;
}

function upsertRun(items: TranslationRun[], run: TranslationRun) {
  return [{ ...run, result_pages: [] }, ...items.filter((item) => item.id !== run.id)]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
}

function preferredPage(run: TranslationRun, currentPage: number) {
  return run.pages.includes(currentPage) ? currentPage : run.pages[0];
}

export function TranslationRunPanel({ document, currentPage, language, capabilities, api, onOpenSettings, onSelectionChange, renderResults, externalRun = null }: {
  document: RunDocument;
  currentPage: number;
  language: "zh" | "en";
  capabilities: TranslationRunCapabilities | null;
  api: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
  onOpenSettings: () => void;
  onSelectionChange: (run: TranslationRun | null) => void;
  renderResults: (run: TranslationRun) => ReactNode;
  externalRun?: TranslationRun | null;
}) {
  const copy = strings[language];
  const documentKey = `${document.id}:${document.sha256}`;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const generationRef = useRef(0);
  const scopeControllerRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const operationLockRef = useRef<number | null>(null);
  const [selectionMode, setSelectionMode] = useState<"current" | "whole" | "range">("current");
  const [pageInput, setPageInput] = useState(String(currentPage || 1));
  const [targetLanguage, setTargetLanguage] = useState<RunTargetLanguage>(language);
  const [runs, setRuns] = useState<TranslationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<TranslationRun | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const selectedRunIdRef = useRef(selectedRunId);
  const selectedRunRef = useRef(selectedRun);
  selectedRunIdRef.current = selectedRunId;
  selectedRunRef.current = selectedRun;
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [listRetry, setListRetry] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [pollError, setPollError] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [requestDraft, setRequestDraft] = useState<RequestDraft | null>(null);
  const [pendingAction, setPendingAction] = useState<"create" | "pause" | "resume" | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const runMaxPages = Math.min(200, document.pageCount, capabilities?.run_max_pages || 200);
  const wholeTooLarge = document.pageCount > runMaxPages;

  useEffect(() => {
    generationRef.current += 1;
    operationRef.current += 1;
    operationLockRef.current = null;
    scopeControllerRef.current?.abort();
    const controller = new AbortController();
    scopeControllerRef.current = controller;
    setSelectionMode("current");
    setPageInput(String(currentPageRef.current || 1));
    setTargetLanguage(language);
    setRuns([]);
    setSelectedRunId(null);
    setSelectedRun(null);
    setSelectedPage(null);
    setListError(false);
    setDetailError(false);
    setPollError(false);
    setConfirmation(null);
    setRequestDraft(null);
    setPendingAction(null);
    setOperationError(null);
    return () => controller.abort();
  }, [documentKey]);

  useEffect(() => {
    onSelectionChange(selectedRun);
  }, [selectedRun, onSelectionChange]);

  useEffect(() => {
    if (!externalRun || !runInScope(externalRun, document)) return;
    const page = externalRun.result_pages[0]?.page || preferredPage(externalRun, currentPageRef.current);
    setConfirmation(null);
    setOperationError(null);
    setDetailError(false);
    setSelectedRunId(externalRun.id);
    setSelectedPage(page);
    setSelectedRun(externalRun);
    setRuns((current) => upsertRun(current, externalRun));
  }, [externalRun]);

  useEffect(() => {
    const controller = new AbortController();
    const ticket = generationRef.current;
    let active = true;
    setListLoading(true);
    setListError(false);
    void api<{ items: unknown[] }>(`/api/v1/documents/${encodeURIComponent(document.id)}/translation-runs?limit=20`, {
      signal: controller.signal
    }).then((body) => {
      if (!active || generationRef.current !== ticket) return;
      const items = Array.isArray(body.items)
        ? body.items.filter((run): run is TranslationRun => runInScope(run, document)).slice(0, 20)
        : [];
      const retained = selectedRunRef.current?.id === selectedRunIdRef.current ? selectedRunRef.current : null;
      const nextItems = retained && !items.some((run) => run.id === retained.id)
        ? [retained, ...items].slice(0, 20)
        : items;
      setRuns(nextItems);
      setSelectedRunId((current) => {
        const preferred = nextItems.find((run) => run.id === current) || nextItems[0];
        if (!preferred) {
          setSelectedPage(null);
          setSelectedRun(null);
          return null;
        }
        setSelectedPage(preferredPage(preferred, currentPageRef.current));
        return preferred.id;
      });
    }).catch((error) => {
      if (active && !isAbort(error) && generationRef.current === ticket) setListError(true);
    }).finally(() => {
      if (active && generationRef.current === ticket) setListLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [documentKey, listRetry]);

  useEffect(() => {
    if (!selectedRunId) return;
    const metadata = selectedRun || runs.find((run) => run.id === selectedRunId);
    if (!metadata) return;
    const page = preferredPage(metadata, currentPage);
    if (page && page !== selectedPage) setSelectedPage(page);
  }, [currentPage, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !selectedPage) {
      setSelectedRun(null);
      setDetailLoading(false);
      return;
    }
    if (selectedRun?.id === selectedRunId && validRunDetail(selectedRun, selectedRunId, selectedPage)) {
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    const ticket = generationRef.current;
    const runId = selectedRunId;
    const page = selectedPage;
    let active = true;
    setSelectedRun(null);
    setDetailLoading(true);
    setDetailError(false);
    setPollError(false);
    void api<unknown>(`/api/v1/translation-runs/${encodeURIComponent(runId)}?page=${page}`, {
      signal: controller.signal
    }).then((value) => {
      if (!active || generationRef.current !== ticket) return;
      if (!runInScope(value, document) || !validRunDetail(value, runId, page)) throw failed("request_failed");
      setSelectedRun(value);
      setRuns((current) => upsertRun(current, value));
    }).catch((error) => {
      if (active && !isAbort(error) && generationRef.current === ticket) setDetailError(true);
    }).finally(() => {
      if (active && generationRef.current === ticket) setDetailLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [documentKey, selectedRunId, selectedPage, detailRetry]);

  useEffect(() => {
    if (!selectedRun || !selectedPage || !activeStatuses.has(selectedRun.status)) return;
    const runId = selectedRun.id;
    const page = selectedPage;
    const ticket = generationRef.current;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    async function poll() {
      if (stopped) return;
      controller = new AbortController();
      try {
        const value = await api<unknown>(`/api/v1/translation-runs/${encodeURIComponent(runId)}?page=${page}`, {
          signal: controller.signal
        });
        if (stopped || generationRef.current !== ticket) return;
        if (!runInScope(value, document) || !validRunDetail(value, runId, page)) throw failed("request_failed");
        failures = 0;
        setPollError(false);
        setSelectedRun((current) => current?.id === runId ? value : current);
        setRuns((current) => upsertRun(current, value));
      } catch (error) {
        if (stopped || isAbort(error) || generationRef.current !== ticket) return;
        failures += 1;
        setPollError(true);
      }
      if (!stopped) timer = setTimeout(poll, Math.min(8000, 1500 * (2 ** failures)));
    }

    timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [documentKey, selectedRun?.id, selectedRun?.status, selectedPage]);

  async function submitDraft(draft: RequestDraft) {
    if (operationLockRef.current !== null || pendingAction || draft.documentId !== document.id || draft.sourceSha256 !== document.sha256) return;
    const ticket = generationRef.current;
    const action = ++operationRef.current;
    operationLockRef.current = action;
    setRequestDraft(draft);
    setConfirmation(null);
    setPendingAction(draft.kind);
    setOperationError(null);
    try {
      const path = draft.kind === "create"
        ? `/api/v1/documents/${encodeURIComponent(document.id)}/translation-runs`
        : `/api/v1/translation-runs/${encodeURIComponent(draft.runId)}/${draft.kind}`;
      const value = await api<unknown>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.payload),
        signal: scopeControllerRef.current?.signal
      });
      if (generationRef.current !== ticket || action !== operationRef.current) return;
      if (!runInScope(value, document)) throw failed("request_failed");
      if (draft.kind !== "create" && value.id !== draft.runId) throw failed("request_failed");
      const page = preferredPage(value, currentPageRef.current);
      setRequestDraft(null);
      setSelectedRunId(value.id);
      setSelectedPage(page);
      setSelectedRun(null);
      setDetailRetry((current) => current + 1);
      setRuns((current) => upsertRun(current, value));
    } catch (error) {
      if (!isAbort(error) && generationRef.current === ticket && action === operationRef.current) {
        const code = errorCode(error);
        if (code !== "network" && code !== "request_failed") setRequestDraft(null);
        setOperationError(code);
      }
    } finally {
      if (operationLockRef.current === action) {
        operationLockRef.current = null;
        if (generationRef.current === ticket && action === operationRef.current) setPendingAction(null);
      }
    }
  }

  function startCurrentPage() {
    if (requestDraft || pendingAction || confirmation || !Number.isInteger(currentPage) || currentPage < 1 || currentPage > document.pageCount) return;
    setOperationError(null);
    void submitDraft({
      kind: "create",
      documentId: document.id,
      sourceSha256: document.sha256,
      payload: {
        request_id: crypto.randomUUID(),
        source_sha256: document.sha256,
        pages: [currentPage],
        target_language: targetLanguage,
        confirmed: true
      }
    });
  }

  function reviewCreate() {
    if (requestDraft || pendingAction || confirmation || selectionMode === "current") return;
    let pages: number[] | null;
    if (selectionMode === "whole") pages = wholeTooLarge ? null : Array.from({ length: document.pageCount }, (_, index) => index + 1);
    else pages = parsePages(pageInput, document.pageCount, runMaxPages);
    if (!pages || pages.length > 200 || pages.some((page) => page < 1 || page > document.pageCount)) {
      setOperationError(wholeTooLarge && selectionMode === "whole" ? "whole_too_large" : "invalid_pages");
      return;
    }
    setOperationError(null);
    setConfirmation({ kind: "create", pages, targetLanguage });
  }

  function confirmOperation() {
    if (!confirmation || requestDraft || pendingAction) return;
    if (confirmation.kind === "create") {
      void submitDraft({
        kind: "create",
        documentId: document.id,
        sourceSha256: document.sha256,
        payload: {
          request_id: crypto.randomUUID(),
          source_sha256: document.sha256,
          pages: [...confirmation.pages],
          target_language: confirmation.targetLanguage,
          confirmed: true
        }
      });
      return;
    }
    if (!runInScope(confirmation.run, document)) return;
    void submitDraft({
      kind: "resume",
      documentId: document.id,
      sourceSha256: document.sha256,
      runId: confirmation.run.id,
      payload: {
        request_id: crypto.randomUUID(),
        expected_revision: confirmation.run.revision,
        confirmed: true
      }
    });
  }

  function pauseSelected() {
    if (!selectedRun || !activeStatuses.has(selectedRun.status) || requestDraft || pendingAction) return;
    void submitDraft({
      kind: "pause",
      documentId: document.id,
      sourceSha256: document.sha256,
      runId: selectedRun.id,
      payload: {
        request_id: crypto.randomUUID(),
        expected_revision: selectedRun.revision,
        confirmed: true
      }
    });
  }

  const controlsDisabled = Boolean(requestDraft) || Boolean(pendingAction);
  const confirmationPages = confirmation?.kind === "create" ? confirmation.pages : confirmation?.run.pages;
  const confirmationLanguage = confirmation?.kind === "create" ? confirmation.targetLanguage : confirmation?.run.target_language;
  const operationMessage = operationError === "invalid_pages"
    ? copy.invalidPages
    : operationError === "whole_too_large"
      ? copy.wholeTooLarge
      : operationError === "network"
        ? copy.network
        : requestDraft?.kind === "pause"
          ? copy.stopFailed
          : requestDraft?.kind === "resume"
            ? copy.continueFailed
            : copy.requestFailed;
  return (
    <div className="translation-run-view">
      <div className="translation-current-action">
        <label className="translation-field" htmlFor="translation-run-target-language">
          <span>{copy.target}</span>
          <select id="translation-run-target-language" value={targetLanguage} disabled={controlsDisabled || Boolean(confirmation)} onChange={(event) => setTargetLanguage(event.target.value as RunTargetLanguage)}>
            <option value="zh">{copy.chinese}</option>
            <option value="en">{copy.english}</option>
          </select>
        </label>
        {requestDraft?.kind === "create" ? (
          <button className="button button-primary translation-current-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void submitDraft(requestDraft)}>{pendingAction === "create" ? copy.starting : copy.retry}</button>
        ) : (
          <button className="button button-primary translation-current-button" type="button" disabled={!capabilities?.ready || !capabilities.run_support || controlsDisabled || Boolean(confirmation)} onClick={startCurrentPage}>
            {pendingAction === "create" ? copy.starting : copy.startCurrent}
          </button>
        )}
      </div>
      {requestDraft && !pendingAction && <p className="translation-retry-hint">{copy.retryHint}</p>}

      {capabilities && (!capabilities.ready || !capabilities.run_support) && (
        <div className="translation-unavailable" role="status">
          <p>{capabilities.run_support ? capabilities.reason || copy.unsupported : copy.unsupported}</p>
          {!capabilities.model_ready && <button className="button button-secondary" type="button" onClick={onOpenSettings}>{copy.openSettings}</button>}
        </div>
      )}
      {operationError && <p className="translation-status" data-kind="error" role="alert">{operationMessage}</p>}

      <details className="translation-options">
        <summary>{copy.more}</summary>
        <form className="translation-form translation-run-form" onSubmit={(event) => {
          event.preventDefault();
          reviewCreate();
        }}>
          <fieldset className="translation-page-choice" disabled={controlsDisabled || Boolean(confirmation)}>
            <legend className="sr-only">{copy.rangeLabel}</legend>
            <label title={wholeTooLarge ? copy.wholeTooLarge : undefined}>
              <input type="radio" name="translation-run-pages" checked={selectionMode === "whole"} disabled={wholeTooLarge} onChange={() => setSelectionMode("whole")} />
              <span>{copy.whole} · {document.pageCount}</span>
            </label>
            <label>
              <input type="radio" name="translation-run-pages" checked={selectionMode === "range"} onChange={() => setSelectionMode("range")} />
              <span>{copy.range}</span>
            </label>
          </fieldset>
          {selectionMode === "whole" && wholeTooLarge && <p className="translation-page-limit">{copy.wholeTooLarge}</p>}
          {selectionMode === "range" && (
            <label className="translation-field" htmlFor="translation-run-page-input">
              <span>{copy.rangeLabel}</span>
              <input id="translation-run-page-input" value={pageInput} placeholder={copy.rangePlaceholder} autoComplete="off" disabled={controlsDisabled || Boolean(confirmation)} onChange={(event) => setPageInput(event.target.value)} />
            </label>
          )}
          {!confirmation && !requestDraft && (
            <div className="translation-start-row">
              <button className="button button-secondary" type="submit" disabled={!capabilities?.ready || !capabilities.run_support || controlsDisabled || selectionMode === "current"}>{copy.review}</button>
            </div>
          )}
        </form>
      </details>

      {confirmation && confirmationPages && confirmationLanguage && !requestDraft && (
        <div className="translation-run-confirmation" role="group" aria-label={confirmation.kind === "create" ? copy.confirmStart : copy.confirmResume}>
          <strong>{copy.confirmScope(formatRunPages(confirmationPages), confirmationPages.length, copy.language(confirmationLanguage))}</strong>
          <p>{confirmation.kind === "create" ? copy.feeNotice : copy.resumeNotice}</p>
          <div className="translation-start-row">
            <button className="button button-primary" type="button" disabled={controlsDisabled} onClick={confirmOperation}>{confirmation.kind === "create" ? copy.confirmStart : copy.confirmResume}</button>
            <button className="button button-secondary" type="button" disabled={controlsDisabled} onClick={() => setConfirmation(null)}>{copy.cancelConfirmation}</button>
          </div>
        </div>
      )}

      <details className="translation-history">
        <summary>{copy.history}</summary>
        <div className="translation-saved-row translation-run-history">
          <label htmlFor="translation-run-history">{copy.saved}</label>
          <div>
            <select id="translation-run-history" value={selectedRunId || ""} disabled={!runs.length || controlsDisabled} onChange={(event) => {
              const run = runs.find((item) => item.id === event.target.value);
              setConfirmation(null);
              setOperationError(null);
              setSelectedRun(null);
              setSelectedRunId(run?.id || null);
              setSelectedPage(run ? preferredPage(run, currentPageRef.current) : null);
            }}>
              {!runs.length && <option value="">{copy.noSaved}</option>}
              {runs.map((run) => <option value={run.id} key={run.id}>{formatRunPages(run.pages)} · {copy.language(run.target_language)} · {copy[run.status]}</option>)}
            </select>
            <button className="button button-quiet" type="button" disabled={listLoading || controlsDisabled} onClick={() => setListRetry((value) => value + 1)}>{copy.refresh}</button>
          </div>
        </div>
        {listLoading && <p className="translation-status" role="status">{copy.loadingList}</p>}
        {listError && <p className="translation-status" data-kind="error" role="alert">{copy.listFailed}</p>}
      </details>
      {detailLoading && <p className="translation-status" role="status">{copy.loadingRun}</p>}
      {detailError && (
        <p className="translation-status" data-kind="error" role="alert">{copy.loadFailed} <button className="translation-source-link" type="button" onClick={() => setDetailRetry((value) => value + 1)}>{copy.retry}</button></p>
      )}
      {pollError && <p className="translation-status" role="status">{copy.listFailed}</p>}

      {selectedRun && (
        <section className="translation-job translation-run" aria-label={copy.continuous}>
          <div className="translation-job-summary">
            <div>
              <strong>{copy[selectedRun.status]}</strong>
              <p>{copy.pages(formatRunPages(selectedRun.pages), selectedRun.total_pages)}</p>
            </div>
            {activeStatuses.has(selectedRun.status) && !requestDraft && (
              <button className="button button-secondary" type="button" disabled={controlsDisabled} onClick={pauseSelected}>{pendingAction === "pause" ? copy.stopping : copy.stop}</button>
            )}
            {!activeStatuses.has(selectedRun.status) && selectedRun.status !== "completed" && !requestDraft && !confirmation && (
              <button className="button button-secondary" type="button" disabled={controlsDisabled || !capabilities?.ready || !capabilities.run_support} onClick={() => {
                setOperationError(null);
                setConfirmation({ kind: "resume", run: selectedRun });
              }}>{copy.continue}</button>
            )}
          </div>
          {activeStatuses.has(selectedRun.status) && (
            <div className="translation-progress translation-run-progress" role="status" aria-live="polite">
              <p>{copy[selectedRun.stage]} · {copy.completedProgress(selectedRun.completed_pages, selectedRun.total_pages)}</p>
              <progress max={Math.max(1, selectedRun.total_pages)} value={selectedRun.processed_pages} />
            </div>
          )}
          {requestDraft && requestDraft.kind !== "create" && (
            <div className="translation-start-row translation-run-control-retry">
              <button className="button button-primary" type="button" disabled={Boolean(pendingAction)} onClick={() => void submitDraft(requestDraft)}>
                {pendingAction ? requestDraft.kind === "pause" ? copy.stopping : copy.resuming : copy.retry}
              </button>
            </div>
          )}
          {selectedRun.error && <p className="translation-status" data-kind="error" role="alert">{selectedRun.error.message || copy.runError}</p>}
          <label className="translation-field translation-run-page-picker" htmlFor="translation-run-result-page">
            <span>{copy.viewPage}</span>
            <select id="translation-run-result-page" value={selectedPage || ""} disabled={controlsDisabled} onChange={(event) => {
              setSelectedRun(null);
              setSelectedPage(Number(event.target.value));
            }}>
              {selectedRun.pages.map((page) => <option value={page} key={page}>{page}</option>)}
            </select>
          </label>
          {renderResults(selectedRun)}
        </section>
      )}
    </div>
  );
}
