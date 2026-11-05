import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  defaultFlowReadingPreferences,
  flowReadingWidths,
  readFlowReadingPreferences,
  writeFlowReadingPreferences,
  type FlowReadingPreferences,
  type FlowReadingWidth
} from "./flow-preferences";
import { validatedSentences } from "./flow-sentences";
import { runInScope, type TranslationRun } from "./translation-runs";

type FlowLanguage = "zh" | "en";
type FlowPhase = "cache" | "preparing" | "ready" | "error" | "cancelled" | "unavailable";
type TextMode = "original" | "translated" | "bilingual";

export interface FlowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FlowDocument {
  id: string;
  sha256: string;
  pageCount: number;
  title?: string | null;
}

export interface FlowReaderModel {
  visible: boolean;
  fullscreen?: boolean;
  language: FlowLanguage;
  document: FlowDocument | null;
  currentPage: number;
}

interface SourceBlock {
  id: string;
  kind: "text" | "title" | "caption" | "formula" | "image" | "table" | "code" | "other";
  order: number;
  rect: FlowRect | null;
  source_text: string;
  translated_text: null;
}

interface SourcePage {
  page: number;
  status: "completed" | "partial" | "unavailable";
  warning: string | null;
  blocks: SourceBlock[];
}

interface ReadingResult {
  document_id: string;
  source_sha256: string;
  parser: { id: string; version: string };
  result_schema_version: 1;
  requested_pages: number[];
  cached_pages: number[];
  missing_pages: number[];
  result_pages: SourcePage[];
}

interface ReadingCapabilities {
  ready: boolean;
  parser_ready: boolean;
  reason: string | null;
  max_pages: number;
  parser: { id: string; version: string };
  result_schema_version: 1;
}

interface TranslationJob {
  id: string;
  document_id: string;
  source_sha256: string;
  pages: number[];
  target_language: "zh" | "en";
  status: string;
  created_at: string;
  parser?: { id: string; version: string };
  result_schema_version?: number;
  result_pages?: Array<{
    page: number;
    status: string;
    blocks: Array<{
      id: string;
      kind: string;
      source_text: string;
      translated_text: string | null;
      sentences?: unknown;
    }>;
  }>;
}

type SelectedTranslation = { kind: "run" | "job"; id: string; scope: string } | null;

interface VisualResult {
  url: string;
  width: number;
  height: number;
  release: () => void;
}

export interface FlowReaderCallbacks {
  api: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
  getVisual: (input: {
    documentId: string;
    sourceSha256: string;
    page: number;
    rect: FlowRect;
    signal: AbortSignal;
  }) => Promise<VisualResult | null>;
  onOpenOriginal: (page: number, rect: FlowRect | null, id: string, hash: string) => Promise<boolean>;
  onPageViewed: (page: number, id: string, hash: string) => void;
  onRequestTranslation: (page: number, id: string, hash: string) => void;
  onToggleFullscreen?: (trigger: HTMLButtonElement) => void;
}

export interface MountFlowReaderOptions {
  container: HTMLElement;
  model: FlowReaderModel;
  callbacks: FlowReaderCallbacks;
}

export interface FlowReaderHandle {
  update: (model: FlowReaderModel) => boolean;
  destroy: () => void;
}

interface FlowRegistration {
  container: HTMLElement;
  root: Root;
  callbacks: FlowReaderCallbacks;
  active: boolean;
}

const owners = new WeakMap<HTMLElement, FlowRegistration>();
const translatableKinds = new Set(["text", "title", "caption"]);
const visualKinds = new Set(["image", "table", "formula"]);

const strings = {
  zh: {
    heading: "段落阅读",
    fullscreen: "阅读全屏",
    exitFullscreen: "退出全屏",
    original: "原文",
    translated: "已存译文",
    bilingual: "双语对照",
    textModeLabel: "阅读文本",
    previous: "上一批",
    next: "下一批",
    returnPdf: "返回 PDF",
    openPage: "查看原页",
    settings: "阅读设置",
    find: "查找已加载页面",
    fontSize: "字号",
    lineHeight: "行距",
    readingWidth: "阅读宽度",
    narrow: "窄（640px）",
    normal: "标准（760px）",
    wide: "宽（可用宽度）",
    resetDefaults: "恢复默认",
    jumpToPage: "跳转页码",
    pageTotal: (count: number) => `共 ${count} 页`,
    goToPage: "跳转",
    currentPage: (page: number) => `当前第 ${page} 页`,
    invalidPage: (count: number) => `请输入 1 至 ${count} 的整数页码。`,
    findPlaceholder: "查找当前文本",
    findAction: "查找",
    findScope: "仅查找当前已加载或已准备页面，不是全文检索。",
    findEmpty: "请输入查找内容。",
    findTooLong: "查找内容不能超过 200 个字符。",
    findNone: "当前已加载页面没有匹配。",
    findCount: (current: number, total: number) => `第 ${current} / ${total} 个匹配`,
    previousMatch: "上一个匹配",
    nextMatch: "下一个匹配",
    page: (page: number) => `第 ${page} 页`,
    batch: (start: number, end: number) => `第 ${start}–${end} 页`,
    loadingCache: "正在读取已准备的原文…",
    preparing: "准备阅读中…",
    cancel: "取消",
    retry: "重试",
    cancelled: "已取消准备。已缓存的内容仍可阅读。",
    failed: "原文准备失败。已缓存的内容仍可阅读，或返回原页。",
    unavailable: "当前无法准备新页面。已缓存的内容仍可阅读。",
    incomplete: "部分页面尚未准备完成，可通过原页继续阅读。",
    noBlocks: "此页没有可排列的文本块，请查看原页。",
    unavailablePage: "此页原文不可用，请查看原页。",
    partialPage: "此页仅提供部分原文，版式不确定的内容请查看原页。",
    loadingVisual: "正在载入原文图像…",
    visualFailed: "无法显示此区域，请查看原页。",
    imageAlt: (page: number) => `第 ${page} 页原文区域`,
    loadingTranslations: "正在读取已保存的译文…",
    noTranslations: "当前文献没有匹配的已保存译文。",
    translationFailed: "无法读取已保存的译文。",
    translationListPartial: "部分已保存译文暂时无法读取；其他记录仍可使用。",
    continuous: "连续",
    single: "单次",
    translationScope: "缺少译文的段落保留原文；图像、表格和公式始终保留原文。",
    sentenceFallback: "部分段落缺少有效的句子对齐，仍按整段对照显示；如需句子对齐，请手动翻译当前页。",
    translate: "翻译当前页",
    untitled: "未命名文献",
    translationLabel: "选择已保存译文",
    sourceReady: "原文按解析顺序排列；复杂版式请对照原页。"
  },
  en: {
    heading: "Paragraph reading",
    fullscreen: "Reading fullscreen",
    exitFullscreen: "Exit fullscreen",
    original: "Original",
    translated: "Saved translation",
    bilingual: "Bilingual",
    textModeLabel: "Reading text",
    previous: "Previous batch",
    next: "Next batch",
    returnPdf: "Return to PDF",
    openPage: "Open original page",
    settings: "Reading settings",
    find: "Find in loaded pages",
    fontSize: "Font size",
    lineHeight: "Line spacing",
    readingWidth: "Reading width",
    narrow: "Narrow (640px)",
    normal: "Normal (760px)",
    wide: "Wide (available width)",
    resetDefaults: "Reset defaults",
    jumpToPage: "Go to page",
    pageTotal: (count: number) => `of ${count} pages`,
    goToPage: "Go",
    currentPage: (page: number) => `Current page ${page}`,
    invalidPage: (count: number) => `Enter a whole page number from 1 to ${count}.`,
    findPlaceholder: "Find current text",
    findAction: "Find",
    findScope: "Searches only currently loaded or prepared pages, not the whole paper.",
    findEmpty: "Enter text to find.",
    findTooLong: "Find text must be 200 characters or fewer.",
    findNone: "No matches in the currently loaded pages.",
    findCount: (current: number, total: number) => `Match ${current} of ${total}`,
    previousMatch: "Previous match",
    nextMatch: "Next match",
    page: (page: number) => `Page ${page}`,
    batch: (start: number, end: number) => `Pages ${start}–${end}`,
    loadingCache: "Reading prepared source text…",
    preparing: "Preparing reading…",
    cancel: "Cancel",
    retry: "Retry",
    cancelled: "Preparation cancelled. Cached content remains available.",
    failed: "Source preparation failed. Cached content remains available, or open the original page.",
    unavailable: "New pages cannot be prepared right now. Cached content remains available.",
    incomplete: "Some pages are not prepared yet. You can continue in the original PDF.",
    noBlocks: "This page has no flowable text blocks. Open the original page.",
    unavailablePage: "Source text is unavailable for this page. Open the original page.",
    partialPage: "Only partial source text is available. Check the original page for uncertain layout.",
    loadingVisual: "Loading original visual…",
    visualFailed: "This region cannot be displayed. Open the original page.",
    imageAlt: (page: number) => `Original region from page ${page}`,
    loadingTranslations: "Reading saved translations…",
    noTranslations: "No matching saved translation is available for this paper.",
    translationFailed: "Saved translations could not be read.",
    translationListPartial: "Some saved translations could not be read; the other records remain available.",
    continuous: "Continuous",
    single: "Single",
    translationScope: "Paragraphs without a translation remain in the original language; images, tables, and formulas always remain original.",
    sentenceFallback: "Some paragraphs lack valid sentence alignment and remain paragraph pairs. To create aligned text, use Translate current page.",
    translate: "Translate current page",
    untitled: "Untitled paper",
    translationLabel: "Saved translation",
    sourceReady: "Source text follows parsed reading order; compare complex layouts with the original page."
  }
} as const;

type Copy = (typeof strings)[FlowLanguage];

function isAbort(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "request_failed";
}

function validRect(value: unknown): value is FlowRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Partial<FlowRect>;
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && Number(rect.x) >= 0 && Number(rect.y) >= 0
    && Number(rect.width) > 0 && Number(rect.height) > 0
    && Number(rect.x) + Number(rect.width) <= 1
    && Number(rect.y) + Number(rect.height) <= 1;
}

function samePages(first: number[], second: number[]) {
  return first.length === second.length && first.every((page, index) => page === second[index]);
}

function parseReadingResult(value: unknown, document: FlowDocument, requestedPages: number[]): ReadingResult {
  if (!value || typeof value !== "object") throw new Error("request_failed");
  const result = value as ReadingResult;
  if (
    result.document_id !== document.id
    || result.source_sha256 !== document.sha256
    || result.result_schema_version !== 1
    || typeof result.parser?.id !== "string"
    || typeof result.parser?.version !== "string"
    || !Array.isArray(result.requested_pages)
    || !samePages(result.requested_pages, requestedPages)
    || !Array.isArray(result.cached_pages)
    || !Array.isArray(result.missing_pages)
    || !Array.isArray(result.result_pages)
  ) throw new Error("request_failed");
  for (const page of result.result_pages) {
    if (
      !requestedPages.includes(page.page)
      || !["completed", "partial", "unavailable"].includes(page.status)
      || !Array.isArray(page.blocks)
    ) throw new Error("request_failed");
    for (const block of page.blocks) {
      if (
        typeof block.id !== "string"
        || typeof block.kind !== "string"
        || !Number.isFinite(block.order)
        || typeof block.source_text !== "string"
        || block.translated_text !== null
        || (block.rect !== null && !validRect(block.rect))
      ) throw new Error("request_failed");
    }
  }
  return result;
}

function translationSummaryInScope(value: unknown, document: FlowDocument): value is TranslationJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<TranslationJob>;
  return typeof job.id === "string"
    && job.document_id === document.id
    && job.source_sha256 === document.sha256
    && Array.isArray(job.pages)
    && job.pages.every((page) => Number.isInteger(page))
    && (job.target_language === "zh" || job.target_language === "en")
    && typeof job.created_at === "string";
}

function translationDetailInScope(
  value: unknown,
  document: FlowDocument,
  parser: { id: string; version: string }
): value is TranslationJob {
  if (!translationSummaryInScope(value, document)) return false;
  const job = value as TranslationJob;
  return job.result_schema_version === 1
    && job.parser?.id === parser.id
    && job.parser?.version === parser.version
    && Array.isArray(job.result_pages);
}

function translationRunDetailInScope(
  value: unknown,
  document: FlowDocument,
  parser: { id: string; version: string },
  runId: string,
  page: number
): value is TranslationRun {
  if (!runInScope(value, document)) return false;
  return value.id === runId
    && value.pages.includes(page)
    && value.result_schema_version === 1
    && value.parser?.id === parser.id
    && value.parser?.version === parser.version
    && value.result_pages.length <= 1
    && value.result_pages.every((result) => result.page === page && Array.isArray(result.blocks));
}

function translatedBlockCandidate(job: TranslationJob | null, page: number, block: SourceBlock) {
  if (!job || !translatableKinds.has(block.kind)) return null;
  for (const resultPage of job.result_pages || []) {
    if (resultPage.page !== page || resultPage.status !== "completed" || !Array.isArray(resultPage.blocks)) continue;
    for (const candidate of resultPage.blocks) {
      const translatedText = candidate.translated_text;
      if (
        candidate.id === block.id
        && candidate.source_text === block.source_text
        && typeof translatedText === "string"
        && translatedText.trim()
      ) return { ...candidate, translated_text: translatedText };
    }
  }
  return null;
}

function translatedBlock(job: TranslationJob | null, page: number, block: SourceBlock) {
  return translatedBlockCandidate(job, page, block)?.translated_text ?? null;
}

function SourceVisual({ block, page, document, callbacks, copy }: {
  block: SourceBlock;
  page: number;
  document: FlowDocument;
  callbacks: FlowReaderCallbacks;
  copy: Copy;
}) {
  const figureRef = useRef<HTMLElement | null>(null);
  const [inRange, setInRange] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [visual, setVisual] = useState<{ url: string; width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const rect = block.rect;

  useEffect(() => {
    const figure = figureRef.current;
    const root = figure?.closest(".flow-scroll");
    if (!figure || !(root instanceof HTMLElement)) return;
    if (typeof IntersectionObserver === "undefined") {
      setFailed(true);
      return;
    }
    setInRange(false);
    const observer = new IntersectionObserver((entries) => {
      setInRange(entries.some((entry) => entry.isIntersecting));
    }, { root, rootMargin: "200px 0px", threshold: 0 });
    observer.observe(figure);
    return () => {
      setInRange(false);
      observer.disconnect();
    };
  }, [block.id, document.id, document.sha256, page]);

  useEffect(() => {
    if (!inRange || !rect || !visualKinds.has(block.kind)) return;
    const controller = new AbortController();
    let stopped = false;
    let owned: VisualResult | null = null;
    setVisual(null);
    setFailed(false);
    void callbacks.getVisual({
      documentId: document.id,
      sourceSha256: document.sha256,
      page,
      rect,
      signal: controller.signal
    }).then((result) => {
      if (stopped) {
        result?.release();
        return;
      }
      owned = result;
      if (result) setVisual({ url: result.url, width: result.width, height: result.height });
      else setFailed(true);
    }).catch(() => {
      if (!stopped) setFailed(true);
    });
    return () => {
      stopped = true;
      controller.abort();
      owned?.release();
      setVisual(null);
    };
  }, [attempt, block.id, block.kind, callbacks, document.id, document.sha256, inRange, page, rect]);

  const fallback = failed || !rect;
  return (
    <figure className={`flow-visual flow-visual-${block.kind}`} ref={figureRef}>
      {!fallback && !visual && <p className="flow-visual-status" role="status">{copy.loadingVisual}</p>}
      {!fallback && visual && (
        <div className="flow-visual-viewport" tabIndex={0}>
          <img src={visual.url} width={visual.width} height={visual.height} alt={copy.imageAlt(page)} draggable={false} />
        </div>
      )}
      {fallback && (
        <>
          {block.source_text && <pre className="flow-raw-text">{block.source_text}</pre>}
          <p className="flow-visual-status">{copy.visualFailed}</p>
          {failed && rect && typeof IntersectionObserver !== "undefined" && <button className="button button-quiet" type="button" onClick={() => setAttempt((value) => value + 1)}>{copy.retry}</button>}
        </>
      )}
      <button className="button button-quiet flow-source-link" type="button" onClick={() => void callbacks.onOpenOriginal(page, rect, document.id, document.sha256)}>
        {copy.openPage}
      </button>
    </figure>
  );
}

type FlowTextPart = "source" | "translation";

interface FlowTextVariant {
  part: FlowTextPart;
  text: string;
  sentenceId?: string;
}

interface FlowMatch {
  index: number;
  page: number;
  blockId: string;
  part: FlowTextPart;
  sentenceId?: string;
  start: number;
  end: number;
}

interface FlowSearchResult {
  scope: string;
  pages: SourcePage[];
  mode: TextMode;
  translation: TranslationJob | null;
  matches: FlowMatch[];
}

function blockTextVariants(block: SourceBlock, page: number, mode: TextMode, translation: TranslationJob | null): FlowTextVariant[] {
  const source = { part: "source" as const, text: block.source_text };
  if (mode === "original") return [source];
  const translated = translatedBlockCandidate(translation, page, block);
  if (!translated) return [source];
  if (mode === "bilingual") {
    const sentences = validatedSentences(block, translated);
    if (sentences) {
      return sentences.flatMap((sentence): FlowTextVariant[] => [
        { part: "source", text: sentence.source_text, sentenceId: sentence.id },
        { part: "translation", text: sentence.translated_text, sentenceId: sentence.id }
      ]);
    }
    return [source, { part: "translation", text: translated.translated_text }];
  }
  return [{ part: "translation", text: translated.translated_text }];
}

function findInPages(pages: SourcePage[], query: string, mode: TextMode, translation: TranslationJob | null) {
  const matches: FlowMatch[] = [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  for (const page of pages) {
    if (page.status === "unavailable") continue;
    const blocks = [...page.blocks].sort((first, second) => first.order - second.order);
    for (const block of blocks) {
      if (visualKinds.has(block.kind)) continue;
      for (const variant of blockTextVariants(block, page.page, mode, translation)) {
        if (!variant.text.trim()) continue;
        expression.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = expression.exec(variant.text))) {
          matches.push({
            index: matches.length,
            page: page.page,
            blockId: block.id,
            part: variant.part,
            ...(variant.sentenceId ? { sentenceId: variant.sentenceId } : {}),
            start: match.index,
            end: match.index + match[0].length
          });
        }
      }
    }
  }
  return matches;
}

type FlowIconName = "return" | "previous" | "next" | "settings" | "search" | "up" | "down" | "expand" | "collapse";

function FlowIcon({ name }: { name: FlowIconName }) {
  return (
    <svg className="flow-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {name === "return" && <><path d="M8 5 3 10l5 5M3 10h9" /><path d="M12 4h5v12h-5" /></>}
      {name === "previous" && <path d="m12 4-6 6 6 6" />}
      {name === "next" && <path d="m8 4 6 6-6 6" />}
      {name === "up" && <path d="m4 12 6-6 6 6" />}
      {name === "down" && <path d="m4 8 6 6 6-6" />}
      {name === "settings" && <><path d="M3 5h14M3 10h14M3 15h14" /><path d="M7 3v4M13 8v4M8 13v4" /></>}
      {name === "search" && <><circle cx="8.5" cy="8.5" r="5" /><path d="m12 12 4.5 4.5" /></>}
      {name === "expand" && <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" />}
      {name === "collapse" && <path d="M3 7h4V3M13 3v4h4M17 13h-4v4M7 17v-4H3" />}
    </svg>
  );
}

function variantMatches(matches: FlowMatch[], variant: FlowTextVariant) {
  return matches.filter((match) => match.part === variant.part && match.sentenceId === variant.sentenceId);
}

function highlightedText(variant: FlowTextVariant, blockId: string, matches: FlowMatch[], activeMatch: number): ReactNode {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) content.push(variant.text.slice(cursor, match.start));
    content.push(
      <mark
        className="flow-find-match"
        data-flow-match-index={match.index}
        data-active={activeMatch === match.index ? "true" : "false"}
        key={`${match.page}:${blockId}:${variant.sentenceId || "block"}:${variant.part}:${match.start}`}
      >
        {variant.text.slice(match.start, match.end)}
      </mark>
    );
    cursor = match.end;
  }
  if (cursor < variant.text.length) content.push(variant.text.slice(cursor));
  return matches.length ? content : variant.text;
}

function flowBlockElement(block: SourceBlock, children: ReactNode, className = "", identified = true) {
  const classes = `flow-block flow-block-${block.kind}${className ? ` ${className}` : ""}`;
  const id = identified ? block.id : undefined;
  if (block.kind === "title") return <h3 className={classes} data-flow-block-id={id}>{children}</h3>;
  if (block.kind === "caption") return <p className={classes} data-flow-block-id={id}>{children}</p>;
  if (block.kind === "code") return <pre className={classes} data-flow-block-id={id}>{children}</pre>;
  return <p className={classes} data-flow-block-id={id}>{children}</p>;
}

function BlockView({ block, page, document, callbacks, copy, mode, translation, matches, activeMatch }: {
  block: SourceBlock;
  page: number;
  document: FlowDocument;
  callbacks: FlowReaderCallbacks;
  copy: Copy;
  mode: TextMode;
  translation: TranslationJob | null;
  matches: FlowMatch[];
  activeMatch: number;
}) {
  if (visualKinds.has(block.kind)) {
    return <SourceVisual block={block} page={page} document={document} callbacks={callbacks} copy={copy} />;
  }
  const variants = blockTextVariants(block, page, mode, translation);
  const source = variants[0];
  if (mode === "bilingual" && variants.length > 1) {
    return (
      <div className="flow-bilingual-pair" data-flow-block-id={block.id}>
        {Array.from({ length: Math.floor(variants.length / 2) }, (_, index) => {
          const original = variants[index * 2];
          const translated = variants[index * 2 + 1];
          return (
            <div className="flow-bilingual-sentence" data-flow-sentence-id={original.sentenceId} key={original.sentenceId || "paragraph"}>
              {flowBlockElement(block, highlightedText(original, block.id, variantMatches(matches, original), activeMatch), "flow-bilingual-original", false)}
              {flowBlockElement(block, highlightedText(translated, block.id, variantMatches(matches, translated), activeMatch), "flow-bilingual-translation", false)}
            </div>
          );
        })}
      </div>
    );
  }
  if (!source?.text.trim()) return null;
  return flowBlockElement(block, highlightedText(source, block.id, variantMatches(matches, source), activeMatch));
}

function FlowReader({ model, callbacks }: { model: FlowReaderModel; callbacks: FlowReaderCallbacks }) {
  const document = model.document as FlowDocument;
  const copy = strings[model.language];
  const initialPage = Math.max(1, Math.min(document.pageCount, Math.trunc(model.currentPage) || 1));
  const [batchStart, setBatchStart] = useState(initialPage);
  const [retry, setRetry] = useState(0);
  const [pages, setPages] = useState<SourcePage[]>([]);
  const [parser, setParser] = useState<{ id: string; version: string } | null>(null);
  const [phase, setPhase] = useState<FlowPhase>("cache");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TextMode>("original");
  const [viewedPage, setViewedPage] = useState(initialPage);
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [runs, setRuns] = useState<TranslationRun[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState<SelectedTranslation>(null);
  const [translation, setTranslation] = useState<TranslationJob | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationRetry, setTranslationRetry] = useState(0);
  const [preferences, setPreferences] = useState<FlowReadingPreferences>(readFlowReadingPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState(String(initialPage));
  const [jumpError, setJumpError] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<FlowSearchResult | null>(null);
  const [searchFeedback, setSearchFeedback] = useState<"empty" | "tooLong" | null>(null);
  const [activeMatch, setActiveMatch] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const typographyAnchorRef = useRef<{ page: number; blockId: string; top: number } | null>(null);
  const previousPreferencesRef = useRef(preferences);
  const modelRef = useRef(model);
  modelRef.current = model;
  const scope = `${document.id}:${document.sha256}`;
  const batchPages = useMemo(
    () => Array.from({ length: Math.min(3, document.pageCount - batchStart + 1) }, (_, index) => batchStart + index),
    [batchStart, document.pageCount]
  );
  const batchEnd = batchPages[batchPages.length - 1];
  const batchKey = batchPages.join(",");
  const currentSearchResult = searchResult
    && searchResult.scope === scope
    && searchResult.pages === pages
    && searchResult.mode === mode
    && searchResult.translation === translation
    ? searchResult
    : null;
  const searchMatches = currentSearchResult?.matches || [];
  const readingStyle = {
    "--flow-reading-font-size": `${preferences.fontSize}px`,
    "--flow-reading-line-height": String(preferences.lineHeight),
    "--flow-reading-width": flowReadingWidths[preferences.width]
  } as CSSProperties;

  function captureTypographyAnchor() {
    const root = scrollRef.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const blocks = [...root.querySelectorAll<HTMLElement>("[data-flow-block-id]")];
    const block = blocks.find((element) => element.getBoundingClientRect().bottom > rootTop + 1) || blocks[blocks.length - 1];
    if (!block?.dataset.flowBlockId) return;
    const page = Number(block.closest<HTMLElement>("[data-flow-page]")?.dataset.flowPage);
    if (!Number.isInteger(page)) return;
    typographyAnchorRef.current = { page, blockId: block.dataset.flowBlockId, top: block.getBoundingClientRect().top - rootTop };
  }

  function changePreferences(next: FlowReadingPreferences) {
    captureTypographyAnchor();
    setPreferences(next);
  }

  function clearSearch() {
    setQuery("");
    setSearchResult(null);
    setSearchFeedback(null);
    setActiveMatch(0);
  }

  function submitSearch() {
    if (!query.trim()) {
      setSearchResult(null);
      setSearchFeedback("empty");
      setActiveMatch(0);
      return;
    }
    if (query.length > 200) {
      setSearchResult(null);
      setSearchFeedback("tooLong");
      setActiveMatch(0);
      return;
    }
    const matches = findInPages(pages, query, mode, translation);
    setSearchResult({ scope, pages, mode, translation, matches });
    setSearchFeedback(null);
    setActiveMatch(0);
  }

  function submitPageJump() {
    if (!/^[1-9]\d*$/.test(jumpValue.trim())) {
      setJumpError(true);
      return;
    }
    const page = Number(jumpValue.trim());
    if (!Number.isSafeInteger(page) || page < 1 || page > document.pageCount) {
      setJumpError(true);
      return;
    }
    setJumpError(false);
    if (page === batchStart) {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      setViewedPage(page);
    } else {
      setBatchStart(page);
    }
  }

  useEffect(() => {
    setJobs([]);
    setRuns([]);
    setJobsLoaded(false);
    setJobsError(null);
    setRunsError(null);
    setSelectedTranslation(null);
    setTranslation(null);
    setTranslationError(null);
  }, [scope]);

  useEffect(() => {
    writeFlowReadingPreferences(preferences);
  }, [preferences]);

  useLayoutEffect(() => {
    if (previousPreferencesRef.current === preferences) return;
    previousPreferencesRef.current = preferences;
    const root = scrollRef.current;
    const anchor = typographyAnchorRef.current;
    typographyAnchorRef.current = null;
    if (!root || !anchor) return;
    const block = [...root.querySelectorAll<HTMLElement>(`[data-flow-page="${anchor.page}"] [data-flow-block-id]`)]
      .find((element) => element.dataset.flowBlockId === anchor.blockId);
    if (block) root.scrollTop += block.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.top;
  }, [preferences]);

  useEffect(() => {
    setSearchResult(null);
    setSearchFeedback(null);
    setActiveMatch(0);
  }, [pages, mode, translation, scope]);

  useEffect(() => {
    if (!currentSearchResult?.matches.length || activeMatch < 0) return;
    const root = scrollRef.current;
    const match = [...(root?.querySelectorAll<HTMLElement>("[data-flow-match-index]") || [])]
      .find((element) => element.dataset.flowMatchIndex === String(activeMatch));
    match?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [currentSearchResult, activeMatch]);

  useEffect(() => {
    setJumpValue(String(viewedPage));
  }, [viewedPage]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    let active = true;
    setPages([]);
    setParser(null);
    setPhase("cache");
    setError(null);
    setViewedPage(batchStart);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const current = () => active && !controller.signal.aborted;

    async function load() {
      const capabilityPromise = callbacks.api<ReadingCapabilities>("/api/v1/reading-capabilities", {
        signal: controller.signal
      }).catch(() => null);
      try {
        const query = batchPages.join(",");
        const cachedResult = parseReadingResult(await callbacks.api<unknown>(
          `/api/v1/documents/${encodeURIComponent(document.id)}/reading-pages?source_sha256=${encodeURIComponent(document.sha256)}&pages=${query}`,
          { signal: controller.signal }
        ), document, batchPages);
        if (!current()) return;
        setParser(cachedResult.parser);
        setPages(cachedResult.result_pages);
        if (!cachedResult.missing_pages.length) {
          setPhase("ready");
          return;
        }
        const capabilities = await capabilityPromise;
        if (!current()) return;
        if (!capabilities?.ready || !capabilities.parser_ready) {
          setPhase("unavailable");
          return;
        }
        setPhase("preparing");
        const prepared = parseReadingResult(await callbacks.api<unknown>(
          `/api/v1/documents/${encodeURIComponent(document.id)}/reading-pages/prepare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_sha256: document.sha256, pages: cachedResult.missing_pages }),
            signal: controller.signal
          }
        ), document, cachedResult.missing_pages);
        if (!current()) return;
        const merged = new Map<number, SourcePage>();
        for (const page of [...cachedResult.result_pages, ...prepared.result_pages]) merged.set(page.page, page);
        setPages([...merged.values()].sort((first, second) => first.page - second.page));
        if (batchPages.every((page) => merged.has(page))) setPhase("ready");
        else {
          setError("incomplete_reading");
          setPhase("error");
        }
      } catch (reason: unknown) {
        if (!active) return;
        if (isAbort(reason)) {
          setPhase("cancelled");
          return;
        }
        setError(errorCode(reason));
        setPhase("error");
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
      if (requestRef.current === controller) requestRef.current = null;
    };
  }, [callbacks, scope, batchStart, retry]);

  useEffect(() => {
    if (mode === "original") return;
    const controller = new AbortController();
    let active = true;
    setJobsError(null);
    setRunsError(null);
    if (!jobsLoaded) {
      const legacyRequest = callbacks.api<{ items: unknown[] }>(
        `/api/v1/documents/${encodeURIComponent(document.id)}/translations?limit=20`,
        { signal: controller.signal }
      );
      const runRequest = callbacks.api<{ items: unknown[] }>(
        `/api/v1/documents/${encodeURIComponent(document.id)}/translation-runs?limit=20`,
        { signal: controller.signal }
      );
      void Promise.allSettled([legacyRequest, runRequest]).then(([legacyResult, runResult]) => {
        if (!active) return;
        const items = legacyResult.status === "fulfilled" && Array.isArray(legacyResult.value.items)
          ? legacyResult.value.items.filter((job): job is TranslationJob => translationSummaryInScope(job, document)).slice(0, 20)
          : [];
        const runItems = runResult.status === "fulfilled" && Array.isArray(runResult.value.items)
          ? runResult.value.items.filter((run): run is TranslationRun => runInScope(run, document)).slice(0, 20)
          : [];
        setJobs(items);
        setRuns(runItems);
        if (legacyResult.status === "rejected") setJobsError(errorCode(legacyResult.reason));
        if (runResult.status === "rejected") setRunsError(errorCode(runResult.reason));
        const choices = [
          ...runItems.map((run) => ({ selection: { kind: "run", id: run.id, scope } as const, createdAt: run.created_at })),
          ...items.map((job) => ({ selection: { kind: "job", id: job.id, scope } as const, createdAt: job.created_at }))
        ].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
        setSelectedTranslation((current) => current && choices.some((choice) => choice.selection.kind === current.kind && choice.selection.id === current.id)
          ? { ...current, scope }
          : choices[0]?.selection || null);
        setJobsLoaded(true);
      });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [callbacks, document.id, document.sha256, jobsLoaded, mode, translationRetry]);

  useEffect(() => {
    if (mode === "original" || !selectedTranslation || selectedTranslation.scope !== scope || !parser) {
      setTranslation(null);
      setTranslationLoading(false);
      return;
    }
    const selection = selectedTranslation;
    const detailParser = parser;
    const controller = new AbortController();
    let active = true;
    setTranslation(null);
    setTranslationLoading(true);
    setTranslationError(null);

    async function load() {
      try {
        if (selection.kind === "job") {
          const job = await callbacks.api<unknown>(`/api/v1/translations/${encodeURIComponent(selection.id)}`, {
            signal: controller.signal
          });
          if (!active) return;
          if (translationDetailInScope(job, document, detailParser)) setTranslation(job);
          else setTranslationError("translation_scope_mismatch");
          return;
        }
        const metadata = runs.find((run) => run.id === selection.id);
        if (!metadata) {
          setTranslationError("translation_scope_mismatch");
          return;
        }
        const requestedPages = batchPages.filter((page) => metadata.pages.includes(page));
        if (!requestedPages.length) {
          setTranslation({ ...metadata, result_pages: [] });
          return;
        }
        const details = await Promise.all(requestedPages.map((page) => callbacks.api<unknown>(
          `/api/v1/translation-runs/${encodeURIComponent(metadata.id)}?page=${page}`,
          { signal: controller.signal }
        )));
        if (!active) return;
        if (details.some((detail, index) => !translationRunDetailInScope(detail, document, detailParser, metadata.id, requestedPages[index]))) {
          setTranslationError("translation_scope_mismatch");
          return;
        }
        const validDetails = details as TranslationRun[];
        setTranslation({ ...metadata, result_pages: validDetails.flatMap((detail) => detail.result_pages) });
      } catch (reason: unknown) {
        if (active && !isAbort(reason)) setTranslationError(errorCode(reason));
      } finally {
        if (active) setTranslationLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [callbacks, document.id, document.sha256, mode, parser, selectedTranslation, runs, batchKey, translationRetry]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pages.length || typeof IntersectionObserver === "undefined") return;
    const ratios = new Map<number, number>();
    let reported = 0;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.flowPage);
        if (Number.isInteger(page)) ratios.set(page, entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      const visible = [...ratios.entries()].filter(([, ratio]) => ratio > 0)
        .sort((first, second) => second[1] - first[1] || first[0] - second[0]);
      const page = visible[0]?.[0];
      if (!page || page === reported) return;
      reported = page;
      setViewedPage(page);
      const current = modelRef.current.document;
      if (current?.id === document.id && current.sha256 === document.sha256) {
        callbacks.onPageViewed(page, document.id, document.sha256);
      }
    }, { root, threshold: [0, 0.2, 0.5, 0.8], rootMargin: "0px 0px -45% 0px" });
    root.querySelectorAll<HTMLElement>("[data-flow-page]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [callbacks, document.id, document.sha256, pages]);

  const sentenceFallback = mode === "bilingual" && translation !== null && pages.some((page) => (
    page.blocks.some((block) => {
      const candidate = translatedBlockCandidate(translation, page.page, block);
      return candidate !== null && validatedSentences(block, candidate) === null;
    })
  ));
  const missingTranslation = mode !== "original" && translation !== null && pages.some((page) => (
    page.blocks.some((block) => translatableKinds.has(block.kind) && block.source_text.trim() && !translatedBlock(translation, page.page, block))
  ));
  const busy = phase === "cache" || phase === "preparing";
  const statusMessage = phase === "cache"
    ? copy.loadingCache
    : phase === "preparing"
      ? copy.preparing
      : phase === "cancelled"
        ? copy.cancelled
        : phase === "unavailable"
          ? copy.unavailable
          : phase === "error"
            ? error === "incomplete_reading" ? copy.incomplete : copy.failed
            : null;

  return (
    <section className="flow-reader" aria-label={copy.heading}>
      <header className="flow-header">
        <div className="flow-heading-wrap">
          <h2>{copy.heading}</h2>
          <p title={document.title || copy.untitled}>{document.title || copy.untitled}</p>
        </div>
        <div className="flow-header-actions">
          <button
            className="button button-secondary flow-icon-button"
            type="button"
            aria-label={copy.returnPdf}
            title={copy.returnPdf}
            onClick={() => void callbacks.onOpenOriginal(viewedPage, null, document.id, document.sha256)}
          >
            <FlowIcon name="return" />
          </button>
          {callbacks.onToggleFullscreen && <button
            className="button button-quiet flow-icon-button flow-fullscreen-toggle"
            type="button"
            aria-label={model.fullscreen ? copy.exitFullscreen : copy.fullscreen}
            title={model.fullscreen ? copy.exitFullscreen : copy.fullscreen}
            aria-pressed={Boolean(model.fullscreen)}
            onClick={(event) => callbacks.onToggleFullscreen?.(event.currentTarget)}
          ><FlowIcon name={model.fullscreen ? "collapse" : "expand"} /></button>}
        </div>
      </header>
      <div className="flow-controls">
        <div className="flow-text-modes" role="group" aria-label={copy.textModeLabel}>
          <button className="button button-quiet" type="button" aria-pressed={mode === "original"} onClick={() => setMode("original")}>{copy.original}</button>
          <button className="button button-quiet" type="button" aria-pressed={mode === "translated"} onClick={() => setMode("translated")}>{copy.translated}</button>
          <button className="button button-quiet" type="button" aria-label={copy.bilingual} title={copy.bilingual} aria-pressed={mode === "bilingual"} onClick={() => setMode("bilingual")}>{copy.bilingual}</button>
        </div>
        <span className="flow-batch-label">{copy.batch(batchStart, batchEnd)} · {copy.currentPage(viewedPage)}</span>
        <div className="flow-batch-controls">
          <button
            className="button button-quiet flow-icon-button"
            type="button"
            aria-label={copy.previous}
            title={copy.previous}
            disabled={batchStart <= 1 || busy}
            onClick={() => setBatchStart(Math.max(1, batchStart - 3))}
          >
            <FlowIcon name="previous" />
          </button>
          <button
            className="button button-quiet flow-icon-button"
            type="button"
            aria-label={copy.next}
            title={copy.next}
            disabled={batchEnd >= document.pageCount || busy}
            onClick={() => setBatchStart(Math.min(document.pageCount, batchStart + 3))}
          >
            <FlowIcon name="next" />
          </button>
        </div>
        <form className="flow-page-jump" onSubmit={(event) => { event.preventDefault(); submitPageJump(); }} noValidate>
          <label className="sr-only" htmlFor="flow-page-jump-input">{copy.jumpToPage}</label>
          <input
            id="flow-page-jump-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={jumpValue}
            aria-label={copy.jumpToPage}
            aria-invalid={jumpError}
            aria-describedby={`flow-page-total${jumpError ? " flow-page-jump-error" : ""}`}
            onChange={(event) => { setJumpValue(event.target.value); setJumpError(false); }}
          />
          <span id="flow-page-total">/ {copy.pageTotal(document.pageCount)}</span>
          <button className="button button-quiet flow-page-jump-button" type="submit" title={copy.goToPage}>{copy.goToPage}</button>
          {jumpError && <p className="flow-jump-error" id="flow-page-jump-error" role="alert">{copy.invalidPage(document.pageCount)}</p>}
        </form>
        <div className="flow-utility-controls">
          <details
            className="flow-tool-details"
            open={settingsOpen}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              setSettingsOpen(isOpen);
              if (isOpen) {
                setSearchOpen(false);
                clearSearch();
              }
            }}
          >
            <summary className="button button-quiet flow-icon-button" aria-label={copy.settings} title={copy.settings}>
              <FlowIcon name="settings" />
            </summary>
            <div className="flow-popover flow-settings-popover">
              <div className="flow-preference-row">
                <label htmlFor="flow-font-size">{copy.fontSize}</label>
                <input
                  id="flow-font-size"
                  type="range"
                  min="14"
                  max="28"
                  step="1"
                  value={preferences.fontSize}
                  onChange={(event) => changePreferences({ ...preferences, fontSize: Number(event.target.value) })}
                />
                <output htmlFor="flow-font-size">{preferences.fontSize}px</output>
              </div>
              <div className="flow-preference-row">
                <label htmlFor="flow-line-height">{copy.lineHeight}</label>
                <input
                  id="flow-line-height"
                  type="range"
                  min="1.4"
                  max="2.4"
                  step="0.05"
                  value={preferences.lineHeight}
                  onChange={(event) => changePreferences({ ...preferences, lineHeight: Number(event.target.value) })}
                />
                <output htmlFor="flow-line-height">{preferences.lineHeight.toFixed(2)}</output>
              </div>
              <div className="flow-preference-row">
                <label htmlFor="flow-reading-width">{copy.readingWidth}</label>
                <select
                  id="flow-reading-width"
                  value={preferences.width}
                  onChange={(event) => {
                    const width = event.target.value as FlowReadingWidth;
                    if (width === "narrow" || width === "normal" || width === "wide") changePreferences({ ...preferences, width });
                  }}
                >
                  <option value="narrow">{copy.narrow}</option>
                  <option value="normal">{copy.normal}</option>
                  <option value="wide">{copy.wide}</option>
                </select>
              </div>
              <button
                className="button button-quiet flow-reset-preferences"
                type="button"
                onClick={() => changePreferences({ ...defaultFlowReadingPreferences })}
              >
                {copy.resetDefaults}
              </button>
            </div>
          </details>
          <details
            className="flow-tool-details"
            open={searchOpen}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              setSearchOpen(isOpen);
              if (isOpen) setSettingsOpen(false);
              else clearSearch();
            }}
          >
            <summary className="button button-quiet flow-icon-button" aria-label={copy.find} title={copy.find}>
              <FlowIcon name="search" />
            </summary>
            <div className="flow-popover flow-search-popover">
              <form onSubmit={(event) => { event.preventDefault(); submitSearch(); }} noValidate>
                <p className="flow-find-scope">{copy.findScope}</p>
                <div className="flow-find-row">
                  <label className="sr-only" htmlFor="flow-find-input">{copy.find}</label>
                  <input
                    id="flow-find-input"
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    maxLength={200}
                    autoComplete="off"
                    placeholder={copy.findPlaceholder}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSearchResult(null);
                      setSearchFeedback(null);
                      setActiveMatch(0);
                    }}
                  />
                  <button className="button button-secondary flow-find-submit" type="submit">{copy.findAction}</button>
                  <button
                    className="button button-quiet flow-icon-button"
                    type="button"
                    aria-label={copy.previousMatch}
                    title={copy.previousMatch}
                    disabled={!searchMatches.length}
                    onClick={() => setActiveMatch((current) => (current - 1 + searchMatches.length) % searchMatches.length)}
                  >
                    <FlowIcon name="up" />
                  </button>
                  <button
                    className="button button-quiet flow-icon-button"
                    type="button"
                    aria-label={copy.nextMatch}
                    title={copy.nextMatch}
                    disabled={!searchMatches.length}
                    onClick={() => setActiveMatch((current) => (current + 1) % searchMatches.length)}
                  >
                    <FlowIcon name="down" />
                  </button>
                </div>
                {searchFeedback && <p className="flow-find-feedback flow-error" role="alert">{searchFeedback === "empty" ? copy.findEmpty : copy.findTooLong}</p>}
                {currentSearchResult && !searchMatches.length && <p className="flow-find-feedback" role="status">{copy.findNone}</p>}
                {searchMatches.length > 0 && <p className="flow-find-feedback" aria-live="polite">{copy.findCount(activeMatch + 1, searchMatches.length)}</p>}
              </form>
            </div>
          </details>
        </div>
      </div>
      {mode !== "original" && (
        <div className="flow-translation-bar">
          {jobs.length + runs.length > 1 && (
            <label>{copy.translationLabel}
              <select value={selectedTranslation ? `${selectedTranslation.kind}:${selectedTranslation.id}` : ""} onChange={(event) => {
                const [kind, id] = event.target.value.split(":", 2);
                setSelectedTranslation(id && (kind === "run" || kind === "job") ? { kind, id, scope } : null);
              }}>
                {runs.map((run) => <option value={`run:${run.id}`} key={`run:${run.id}`}>{copy.continuous} · {run.target_language.toUpperCase()} · {run.created_at}</option>)}
                {jobs.map((job) => <option value={`job:${job.id}`} key={`job:${job.id}`}>{copy.single} · {job.target_language.toUpperCase()} · {job.created_at}</option>)}
              </select>
            </label>
          )}
          <button className="button button-secondary" type="button" onClick={() => callbacks.onRequestTranslation(viewedPage, document.id, document.sha256)}>
            {copy.translate}
          </button>
          {(translationLoading || (!jobsLoaded && !jobsError && !runsError)) && <p role="status">{copy.loadingTranslations}</p>}
          {(jobsError || translationError) && (
            <p className="flow-error" role="alert">
              {copy.translationFailed}
              <button className="button button-quiet" type="button" onClick={() => {
                setJobsLoaded(false);
                setJobsError(null);
                setRunsError(null);
                setTranslationError(null);
                setTranslationRetry((value) => value + 1);
              }}>{copy.retry}</button>
            </p>
          )}
          {runsError && !jobsError && <p className="flow-error" role="alert">{copy.translationListPartial}</p>}
          {jobsLoaded && !jobs.length && !runs.length && !jobsError && !runsError && <p>{copy.noTranslations}</p>}
          {sentenceFallback && <p className="flow-sentence-fallback">{copy.sentenceFallback}</p>}
          {missingTranslation && <p>{copy.translationScope}</p>}
        </div>
      )}
      {statusMessage && (
        <div className={`flow-status flow-status-${phase}`} role={phase === "error" ? "alert" : "status"}>
          {busy && <span className="flow-status-spinner" aria-hidden="true" />}
          <span className="flow-status-message">{statusMessage}</span>
          {busy && (
            <button
              className="button button-quiet flow-status-cancel"
              type="button"
              aria-label={copy.cancel}
              title={copy.cancel}
              onClick={() => requestRef.current?.abort()}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
              </svg>
            </button>
          )}
          {!busy && phase !== "ready" && <button className="button button-quiet" type="button" onClick={() => setRetry((value) => value + 1)}>{copy.retry}</button>}
        </div>
      )}
      <div className="flow-scroll" ref={scrollRef} style={readingStyle}>
        {phase === "ready" && pages.length > 0 && <p className="flow-order-note">{copy.sourceReady}</p>}
        {pages.map((page) => {
          const blocks = [...page.blocks].sort((first, second) => first.order - second.order);
          return (
            <article className="flow-page" data-flow-page={page.page} key={page.page} aria-labelledby={`flow-page-${page.page}`}>
              <header className="flow-page-header">
                <h3 id={`flow-page-${page.page}`}>{copy.page(page.page)}</h3>
                <button className="button button-quiet flow-source-link" type="button" onClick={() => void callbacks.onOpenOriginal(page.page, null, document.id, document.sha256)}>{copy.openPage}</button>
              </header>
              {page.warning && <p className="flow-page-warning">{copy.partialPage}</p>}
              {page.status === "partial" && !page.warning && <p className="flow-page-warning">{copy.partialPage}</p>}
              {page.status === "unavailable" && <p className="flow-page-warning">{copy.unavailablePage}</p>}
              {page.status !== "unavailable" && !blocks.length && <p className="flow-page-warning">{copy.noBlocks}</p>}
              {page.status !== "unavailable" && <div className="flow-blocks">
                {blocks.map((block) => (
                  <BlockView
                    key={block.id}
                    block={block}
                    page={page.page}
                    document={document}
                    callbacks={callbacks}
                    copy={copy}
                    mode={mode}
                    translation={translation}
                    matches={searchMatches.filter((match) => match.page === page.page && match.blockId === block.id)}
                    activeMatch={activeMatch}
                  />
                ))}
              </div>}
            </article>
          );
        })}
      </div>
      <footer className="flow-footer">
        <button className="button button-quiet" type="button" disabled={batchStart <= 1 || busy} onClick={() => setBatchStart(Math.max(1, batchStart - 3))}>{copy.previous}</button>
        <button className="button button-secondary" type="button" onClick={() => void callbacks.onOpenOriginal(viewedPage, null, document.id, document.sha256)}>{copy.returnPdf}</button>
        <button className="button button-quiet" type="button" disabled={batchEnd >= document.pageCount || busy} onClick={() => setBatchStart(Math.min(document.pageCount, batchStart + 3))}>{copy.next}</button>
      </footer>
    </section>
  );
}

function render(registration: FlowRegistration, model: FlowReaderModel) {
  registration.root.render(
    model.visible && model.document
      ? <FlowReader model={model} callbacks={registration.callbacks} />
      : null
  );
}

function destroy(registration: FlowRegistration) {
  if (!registration.active) return;
  registration.active = false;
  if (owners.get(registration.container) === registration) owners.delete(registration.container);
  registration.root.unmount();
}

export function mountFlowReader({ container, model, callbacks }: MountFlowReaderOptions): FlowReaderHandle {
  if (!(container instanceof HTMLElement)) throw new TypeError("Flow reader mount host must be an element");
  const previous = owners.get(container);
  if (previous) destroy(previous);
  const registration: FlowRegistration = {
    container,
    root: createRoot(container),
    callbacks,
    active: true
  };
  owners.set(container, registration);
  flushSync(() => render(registration, model));
  return {
    update(nextModel) {
      if (!registration.active || owners.get(container) !== registration) return false;
      render(registration, nextModel);
      return true;
    },
    destroy() {
      destroy(registration);
    }
  };
}
