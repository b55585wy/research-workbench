import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

type LibraryLanguage = "zh" | "en";
type LibraryKind = "run" | "job";

export interface TranslationLibraryItem {
  kind: LibraryKind;
  id: string;
  document_id: string;
  source_sha256: string;
  title: string;
  target_language: "zh" | "en";
  pages: readonly number[];
  status: "queued" | "running" | "paused" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";
  completed_pages: number;
  total_pages: number;
  created_at: string;
  updated_at: string;
}

export interface TranslationLibraryModel {
  language: LibraryLanguage;
  open: boolean;
}

export interface TranslationLibraryCallbacks {
  api: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
  onOpen: (item: TranslationLibraryItem) => boolean | Promise<boolean>;
  onClose: () => void;
}

export interface MountTranslationLibraryOptions {
  container: HTMLElement;
  model: TranslationLibraryModel;
  callbacks: TranslationLibraryCallbacks;
}

export interface TranslationLibraryHandle {
  update: (model: TranslationLibraryModel) => boolean;
  destroy: () => void;
}

interface LibraryRegistration {
  container: HTMLElement;
  root: Root;
  callbacks: TranslationLibraryCallbacks;
  active: boolean;
}

const owners = new WeakMap<HTMLElement, LibraryRegistration>();
const pageSize = 20;

const strings = {
  zh: {
    heading: "译文",
    close: "返回阅读",
    search: "搜索译文",
    placeholder: "按文献标题搜索",
    submit: "搜索",
    clear: "清除",
    loading: "正在读取译文…",
    failed: "无法读取译文，请重试。",
    retry: "重试",
    empty: "暂无译文",
    noMatches: "没有匹配的译文",
    open: "打开",
    opening: "正在打开…",
    openFailed: "无法打开这条译文，请重试。",
    pages: (completed: number, total: number) => `已翻译 ${completed} / ${total} 页`,
    language: (language: "zh" | "en") => language === "zh" ? "中文" : "英文",
    queued: "排队中",
    running: "翻译中",
    paused: "已停止",
    completed: "已完成",
    partial: "部分完成",
    failedStatus: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
    previous: "上一页",
    next: "下一页",
    page: (page: number, total: number) => `第 ${page} / ${total} 页`
  },
  en: {
    heading: "Translations",
    close: "Back to reader",
    search: "Search translations",
    placeholder: "Search by paper title",
    submit: "Search",
    clear: "Clear",
    loading: "Reading translations…",
    failed: "Translations could not be loaded. Try again.",
    retry: "Try again",
    empty: "No translations yet",
    noMatches: "No matching translations",
    open: "Open",
    opening: "Opening…",
    openFailed: "This translation could not be opened. Try again.",
    pages: (completed: number, total: number) => `${completed} of ${total} pages translated`,
    language: (language: "zh" | "en") => language === "zh" ? "Chinese" : "English",
    queued: "Queued",
    running: "Translating",
    paused: "Stopped",
    completed: "Completed",
    partial: "Partially completed",
    failedStatus: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
    previous: "Previous",
    next: "Next",
    page: (page: number, total: number) => `Page ${page} of ${total}`
  }
} as const;

function validItem(value: unknown): value is TranslationLibraryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TranslationLibraryItem>;
  return (item.kind === "run" || item.kind === "job")
    && typeof item.id === "string" && Boolean(item.id)
    && typeof item.document_id === "string" && Boolean(item.document_id)
    && typeof item.source_sha256 === "string" && Boolean(item.source_sha256)
    && typeof item.title === "string"
    && (item.target_language === "zh" || item.target_language === "en")
    && Array.isArray(item.pages) && item.pages.length > 0
    && item.pages.every((page) => Number.isInteger(page) && page > 0)
    && ["queued", "running", "paused", "completed", "partial", "failed", "cancelled", "interrupted"].includes(item.status || "")
    && Number.isInteger(item.completed_pages) && Number(item.completed_pages) >= 0
    && Number.isInteger(item.total_pages) && Number(item.total_pages) >= item.pages.length
    && typeof item.created_at === "string" && typeof item.updated_at === "string";
}

function TranslationLibrary({ model, callbacks }: {
  model: TranslationLibraryModel;
  callbacks: TranslationLibraryCallbacks;
}) {
  const copy = strings[model.language];
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<TranslationLibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!model.open) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [model.open]);

  useEffect(() => {
    if (!model.open) return;
    const ticket = ++generationRef.current;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setOpenError(false);
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset), q: query });
    void callbacks.api<{ items?: unknown; total?: unknown }>(`/api/v1/library/translations?${params.toString()}`, {
      signal: controller.signal
    }).then((body) => {
      if (generationRef.current !== ticket) return;
      const nextItems = Array.isArray(body.items) ? body.items.filter(validItem).slice(0, pageSize) : [];
      const nextTotal = Number.isSafeInteger(body.total) && Number(body.total) >= 0 ? Number(body.total) : nextItems.length;
      setItems(nextItems);
      setTotal(nextTotal);
    }).catch((error) => {
      if (generationRef.current !== ticket || (typeof error === "object" && error && "name" in error && error.name === "AbortError")) return;
      setItems([]);
      setTotal(0);
      setLoadError(true);
    }).finally(() => {
      if (generationRef.current === ticket) setLoading(false);
    });
    return () => {
      controller.abort();
      if (generationRef.current === ticket) generationRef.current += 1;
    };
  }, [model.open, query, offset, retry]);

  async function openItem(item: TranslationLibraryItem) {
    if (openingId) return;
    setOpeningId(item.id);
    setOpenError(false);
    try {
      const opened = await callbacks.onOpen(Object.freeze({ ...item, pages: Object.freeze([...item.pages]) }));
      if (!opened) setOpenError(true);
    } catch {
      setOpenError(true);
    } finally {
      setOpeningId(null);
    }
  }

  if (!model.open) return null;
  const page = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="translation-library-content" onKeyDown={(event) => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        callbacks.onClose();
      }
    }}>
      <header className="translation-library-header">
        <h2 id="translation-library-heading">{copy.heading}</h2>
        <button className="button button-quiet" type="button" onClick={callbacks.onClose}>{copy.close}</button>
      </header>
      <form className="translation-library-search" role="search" onSubmit={(event) => {
        event.preventDefault();
        setOffset(0);
        setQuery(input.trim().slice(0, 200));
      }}>
        <label htmlFor="translation-library-query">{copy.search}</label>
        <div>
          <input ref={searchRef} id="translation-library-query" type="search" maxLength={200} autoComplete="off" placeholder={copy.placeholder} value={input} onChange={(event) => setInput(event.target.value)} />
          <button className="button button-secondary" type="submit" disabled={loading}>{copy.submit}</button>
          <button className="button button-quiet" type="button" disabled={!input && !query} onClick={() => {
            setInput("");
            setOffset(0);
            setQuery("");
          }}>{copy.clear}</button>
        </div>
      </form>
      <div className="translation-library-status" role="status" aria-live="polite">
        {loading && <p>{copy.loading}</p>}
        {loadError && <p data-kind="error">{copy.failed} <button className="translation-source-link" type="button" onClick={() => setRetry((value) => value + 1)}>{copy.retry}</button></p>}
        {openError && <p data-kind="error">{copy.openFailed}</p>}
      </div>
      {!loading && !loadError && !items.length && <p className="translation-library-empty">{query ? copy.noMatches : copy.empty}</p>}
      {!loadError && items.length > 0 && (
        <ul className="translation-library-list" aria-label={copy.heading}>
          {items.map((item) => (
            <li className="translation-library-item" data-translation-kind={item.kind} data-translation-id={item.id} key={`${item.kind}:${item.id}`}>
              <div className="translation-library-item-copy">
                <h3>{item.title || "—"}</h3>
                <p>{copy.pages(item.completed_pages, item.total_pages)} · {copy.language(item.target_language)}</p>
              </div>
              <span className="translation-library-item-status" data-status={item.status}>{copy[item.status === "failed" ? "failedStatus" : item.status]}</span>
              <button className="button button-secondary" type="button" disabled={Boolean(openingId)} onClick={() => void openItem(item)}>
                {openingId === item.id ? copy.opening : copy.open}
              </button>
            </li>
          ))}
        </ul>
      )}
      <nav className="translation-library-pagination" aria-label={copy.heading}>
        <button className="button button-quiet" type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>{copy.previous}</button>
        <span>{copy.page(page, pageCount)}</span>
        <button className="button button-quiet" type="button" disabled={loading || offset + pageSize >= total || offset + pageSize > 100000} onClick={() => setOffset((value) => Math.min(100000, value + pageSize))}>{copy.next}</button>
      </nav>
    </div>
  );
}

function render(registration: LibraryRegistration, model: TranslationLibraryModel) {
  registration.root.render(<TranslationLibrary model={model} callbacks={registration.callbacks} />);
}

export function mountTranslationLibrary({ container, model, callbacks }: MountTranslationLibraryOptions): TranslationLibraryHandle {
  if (!(container instanceof HTMLElement)) throw new TypeError("Translation library host must be an HTML element");
  const previous = owners.get(container);
  if (previous) {
    previous.active = false;
    previous.root.unmount();
  }
  const registration: LibraryRegistration = { container, root: createRoot(container), callbacks, active: true };
  owners.set(container, registration);
  flushSync(() => render(registration, model));
  return {
    update(nextModel) {
      if (!registration.active || owners.get(container) !== registration) return false;
      render(registration, nextModel);
      return true;
    },
    destroy() {
      if (!registration.active) return;
      registration.active = false;
      if (owners.get(container) === registration) owners.delete(container);
      registration.root.unmount();
    }
  };
}
