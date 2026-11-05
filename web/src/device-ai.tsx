import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  clearDeviceModelConnection,
  loadDeviceModelCapability,
  readDeviceModelConnection,
  rememberDeviceModelSubmission,
  selectDeviceModelSource,
  subscribeDeviceModelConnection,
  type DeviceModelSource
} from "./device-model-connection";

const MAX_MODEL_CHARACTERS = 120;
const MAX_CREDENTIAL_CHARACTERS = 512;
const MAX_TRANSLATED_CHARACTERS = 6000;
const MAX_NOTE_CHARACTERS = 10000;
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type DeviceAILanguage = "zh" | "en";

export interface DeviceAISourceSegment {
  page: number;
  quote: string;
  rects: readonly (readonly number[])[];
}

export interface DeviceAISource {
  documentId: string;
  sourceSha256: string;
  page: number;
  pages: readonly number[];
  text: string;
  rect: readonly number[];
  segments: readonly DeviceAISourceSegment[];
}

export interface DeviceAIModel {
  language: DeviceAILanguage;
  source: DeviceAISource;
}

export interface DeviceAINoteSave {
  requestId: string;
  source: DeviceAISource;
  text: string;
  signal: AbortSignal;
}

export interface DeviceAICallbacks {
  isCurrent: () => boolean;
  onClose: () => void;
  onSource: (source: DeviceAISource) => void;
  onLayout: () => void;
  saveNote: (save: DeviceAINoteSave) => Promise<void>;
}

export interface MountDeviceAIOptions {
  container: HTMLElement;
  model: DeviceAIModel;
  callbacks: DeviceAICallbacks;
  onMounted?: () => void;
}

export interface DeviceAIHandle {
  update: (model: DeviceAIModel) => boolean;
  destroy: () => void;
}

type DeviceAIPhase = "idle" | "loading" | "requestError" | "success" | "saving" | "saveError" | "saved";
type DeviceAIErrorKey = "credentialInvalid" | "modelInvalid" | "network" | "invalidResponse" | "conflict" | "busy" | "failed" | "saveFailed";
type DeviceAINoticeKey = "copied" | "copyFailed";

interface TranslationResult {
  noteId: string;
  targetLanguage: DeviceAILanguage;
  translatedText: string;
  noteText: string;
}

interface DeviceAIRegistration {
  container: HTMLElement;
  root: Root;
  callbacks: DeviceAICallbacks;
  active: boolean;
}

const owners = new WeakMap<HTMLElement, DeviceAIRegistration>();

const strings = {
  zh: {
    original: "所选原文",
    sourcePages: (pages: readonly number[], count: number) => `第 ${pages.join(", ")} 页 · ${count} 字`,
    target: "译为",
    chinese: "中文",
    english: "英文",
    model: "模型标识",
    credential: "DeepSeek API 密钥",
    credentialPlaceholder: "仅在本页暂存",
    clearConnection: "清除连接",
    sharedConnection: "平台连接",
    personalConnection: "自己的 Key",
    sharedLoading: "正在读取平台连接…",
    sharedUnavailable: "平台连接不可用，请使用自己的 Key。",
    sharedNotice: "使用平台 DeepSeek 连接，不会要求或保存你的 API 密钥。",
    transit: "所选文字经本站转发到 DeepSeek，可能产生模型费用；PDF 不上传。",
    keyNotice: "密钥仅在本页暂存，不保存到服务器、浏览器存储或备份。",
    confirm: "确认可能产生费用并连接翻译",
    confirmAgain: "再次确认可能产生费用并翻译",
    loading: "正在翻译所选文字…",
    ready: "翻译完成，尚未保存。关闭或离开后会丢失。",
    translation: "译文",
    save: "保存为本机新笔记",
    retrySave: "重试保存同一笔记",
    saving: "正在保存为本机新笔记…",
    saved: "已保存为本机新笔记；当前编辑器草稿未改动。",
    copy: "复制译文",
    copied: "译文已复制。",
    copyFailed: "复制失败，请手动选择译文。",
    viewSource: "查看原文",
    offline: "当前离线。原文和本机笔记仍可使用；联网后才能翻译。",
    credentialInvalid: "请输入 1 至 512 个可见 ASCII 字符的 API 密钥，不能包含空格。",
    modelInvalid: "模型标识需为 1 至 120 个可见 ASCII 字符，不能包含空格。",
    network: "未收到翻译结果确认，结果不确定。再次确认发送可能再次产生费用。",
    invalidResponse: "翻译服务返回了无法验证的结果，未显示或保存。",
    conflict: "翻译请求冲突。请检查后可再次明确确认发送。",
    busy: "翻译服务正忙。稍后可再次明确确认发送。",
    failed: "翻译未完成。可检查后再次明确确认发送。",
    saveFailed: "本机笔记保存失败；译文仍保留。可用同一笔记编号重试，不会重新翻译。",
    translatedNote: (language: DeviceAILanguage) => `译文（${language === "zh" ? "中文" : "英文"}）`
  },
  en: {
    original: "Selected original",
    sourcePages: (pages: readonly number[], count: number) => `Pages ${pages.join(", ")} · ${count} characters`,
    target: "Translate to",
    chinese: "Chinese",
    english: "English",
    model: "Model identifier",
    credential: "DeepSeek API key",
    credentialPlaceholder: "Kept only in this page",
    clearConnection: "Clear connection",
    sharedConnection: "Platform connection",
    personalConnection: "Your key",
    sharedLoading: "Reading the platform connection…",
    sharedUnavailable: "The platform connection is unavailable. Use your own key instead.",
    sharedNotice: "Uses the platform DeepSeek connection without requesting or saving your API key.",
    transit: "Selected text is forwarded by this site to DeepSeek and may incur model charges. The PDF is not uploaded.",
    keyNotice: "The key is kept only in this page and is not saved to the server, browser storage, or backups.",
    confirm: "Confirm possible charges and connect to translate",
    confirmAgain: "Confirm possible charges and translate again",
    loading: "Translating the selected text…",
    ready: "Translation ready but not saved. It will be lost if you close or navigate away.",
    translation: "Translation",
    save: "Save as a new device note",
    retrySave: "Retry saving the same note",
    saving: "Saving as a new device note…",
    saved: "Saved as a new device note. The current editor draft was not changed.",
    copy: "Copy translation",
    copied: "Translation copied.",
    copyFailed: "Copy failed. Select and copy the translation manually.",
    viewSource: "View source",
    offline: "You are offline. The original and device notes remain available; reconnect to translate.",
    credentialInvalid: "Enter an API key containing 1–512 visible ASCII characters without spaces.",
    modelInvalid: "Use 1–120 visible ASCII characters without spaces for the model identifier.",
    network: "No translation acknowledgement was received, so the outcome is uncertain. Another confirmed send may be charged again.",
    invalidResponse: "The translation response could not be verified and was not shown or saved.",
    conflict: "The translation request conflicted. Review it before explicitly confirming another send.",
    busy: "The translation service is busy. You can explicitly confirm another send later.",
    failed: "Translation was not completed. Review and explicitly confirm another send if needed.",
    saveFailed: "The device note was not saved; the translation is still here. Retry with the same note ID without retranslating.",
    translatedNote: (language: DeviceAILanguage) => `Translation (${language === "zh" ? "Chinese" : "English"})`
  }
} as const;

class RelayError extends Error {
  constructor(readonly key: DeviceAIErrorKey) {
    super(key);
  }
}

function validVisibleAscii(value: string, maximum: number) {
  return value.length >= 1 && value.length <= maximum && VISIBLE_ASCII.test(value);
}

async function sourceDigest(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function noteBody(language: DeviceAILanguage, targetLanguage: DeviceAILanguage, translatedText: string, sourceText: string) {
  const copy = strings[language];
  return `${copy.translatedNote(targetLanguage)}\n${translatedText}\n\n${copy.original}\n${sourceText}`;
}

function responseError(status: number) {
  if (status === 401 || status === 403) return new RelayError("credentialInvalid");
  if (status === 409) return new RelayError("conflict");
  if (status === 429 || status === 503) return new RelayError("busy");
  return new RelayError("failed");
}

function DeviceAIConfirmation({ model, callbacks }: {
  model: DeviceAIModel;
  callbacks: DeviceAICallbacks;
}) {
  const copy = strings[model.language];
  const source = model.source;
  const keyId = useId();
  const modelId = useId();
  const languageId = useId();
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const translationSubmissionPending = useRef(false);
  const saveSubmissionPending = useRef(false);
  const ownSubmission = useRef(false);
  const [initialConnection] = useState(() => readDeviceModelConnection());
  const lastConnection = useRef(initialConnection);
  const [targetLanguage, setTargetLanguage] = useState<DeviceAILanguage>(model.language);
  const [modelName, setModelName] = useState(initialConnection.model);
  const [credential, setCredential] = useState(initialConnection.credential);
  const [connectionSource, setConnectionSource] = useState<DeviceModelSource>(initialConnection.source);
  const [capability, setCapability] = useState({
    loaded: initialConnection.capabilityLoaded,
    failed: initialConnection.capabilityFailed,
    sharedAvailable: initialConnection.sharedAvailable
  });
  const [phase, setPhase] = useState<DeviceAIPhase>("idle");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [errorKey, setErrorKey] = useState<DeviceAIErrorKey | null>(null);
  const [noticeKey, setNoticeKey] = useState<DeviceAINoticeKey | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    mounted.current = true;
    const updateOnline = () => setOnline(navigator.onLine);
    const unsubscribe = subscribeDeviceModelConnection(() => {
      if (ownSubmission.current) return;
      const previous = lastConnection.current;
      const connection = readDeviceModelConnection();
      lastConnection.current = connection;
      setCredential(connection.credential);
      setModelName(connection.model);
      setConnectionSource(connection.source);
      setCapability({
        loaded: connection.capabilityLoaded,
        failed: connection.capabilityFailed,
        sharedAvailable: connection.sharedAvailable
      });
      const changed = previous.source !== connection.source || previous.model !== connection.model
        || (connection.source === "personal" && previous.credential !== connection.credential);
      if (changed && !requestController.current && !saveController.current) invalidateResult();
    });
    void loadDeviceModelCapability();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      unsubscribe();
      mounted.current = false;
      requestGeneration.current += 1;
      requestController.current?.abort();
      saveController.current?.abort();
    };
  }, []);

  useEffect(() => {
    callbacks.onLayout();
  }, [callbacks, phase, result, errorKey, noticeKey, online, model.language, connectionSource, capability]);

  function invalidateResult() {
    if (phase === "loading" || phase === "saving") return;
    setResult(null);
    setPhase("idle");
    setErrorKey(null);
    setNoticeKey(null);
  }

  async function confirmTranslation() {
    if (translationSubmissionPending.current || saveSubmissionPending.current || requestController.current || saveController.current || phase === "loading" || phase === "saving") return;
    if (!callbacks.isCurrent()) {
      callbacks.onClose();
      return;
    }
    const trimmedModel = modelName.trim();
    const submissionSource = connectionSource;
    const submissionCredential = credential;
    if (submissionSource === "shared" && (!capability.loaded || !capability.sharedAvailable)) return;
    if (submissionSource === "personal" && !validVisibleAscii(submissionCredential, MAX_CREDENTIAL_CHARACTERS)) {
      setErrorKey("credentialInvalid");
      return;
    }
    if (!validVisibleAscii(trimmedModel, MAX_MODEL_CHARACTERS)) {
      setErrorKey("modelInvalid");
      return;
    }
    if (!online) {
      setErrorKey(null);
      return;
    }

    translationSubmissionPending.current = true;
    ownSubmission.current = true;
    try {
      rememberDeviceModelSubmission(submissionCredential, trimmedModel, submissionSource);
    } finally {
      ownSubmission.current = false;
    }
    const requestId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    requestController.current = controller;
    setResult(null);
    setPhase("loading");
    setErrorKey(null);
    setNoticeKey(null);

    try {
      const digest = await sourceDigest(source.text).catch(() => {
        throw new RelayError("failed");
      });
      let response: Response;
      try {
        response = await fetch("/device/ai/selection-translation", {
          method: "POST",
          headers: {
            "X-Research-Model-Source": submissionSource,
            ...(submissionSource === "personal" ? { Authorization: `Bearer ${submissionCredential}` } : {}),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            request_id: requestId,
            text: source.text,
            target_language: targetLanguage,
            model: trimmedModel,
            confirmed: true
          }),
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new RelayError("network");
      }
      if (!response.ok) throw responseError(response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new RelayError("invalidResponse");
      }
      const value = body as Record<string, unknown> | null;
      if (!value || typeof value !== "object" || Array.isArray(value)
        || value.request_id !== requestId
        || typeof value.text_sha256 !== "string"
        || !SHA256.test(value.text_sha256)
        || value.text_sha256 !== digest
        || value.target_language !== targetLanguage
        || value.model !== trimmedModel
        || typeof value.translated_text !== "string"
        || !value.translated_text.trim()
        || value.translated_text.length > MAX_TRANSLATED_CHARACTERS) {
        throw new RelayError("invalidResponse");
      }
      if (!mounted.current || generation !== requestGeneration.current || !callbacks.isCurrent()) return;
      const text = noteBody(model.language, targetLanguage, value.translated_text, source.text);
      if (text.length > MAX_NOTE_CHARACTERS) throw new RelayError("invalidResponse");
      setResult({
        noteId,
        targetLanguage,
        translatedText: value.translated_text,
        noteText: text
      });
      setPhase("success");
      requestController.current = null;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!mounted.current || generation !== requestGeneration.current || !callbacks.isCurrent()) return;
      requestController.current = null;
      setPhase("requestError");
      setErrorKey(error instanceof RelayError ? error.key : "network");
    } finally {
      translationSubmissionPending.current = false;
    }
  }

  async function saveTranslation() {
    if (saveSubmissionPending.current || translationSubmissionPending.current || saveController.current || !result || (phase !== "success" && phase !== "saveError")) return;
    if (!callbacks.isCurrent()) {
      callbacks.onClose();
      return;
    }
    saveSubmissionPending.current = true;
    const controller = new AbortController();
    saveController.current = controller;
    setPhase("saving");
    setErrorKey(null);
    setNoticeKey(null);
    try {
      await callbacks.saveNote({
        requestId: result.noteId,
        source,
        text: result.noteText,
        signal: controller.signal
      });
      if (!mounted.current || !callbacks.isCurrent()) return;
      saveController.current = null;
      setPhase("saved");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!mounted.current || !callbacks.isCurrent()) return;
      saveController.current = null;
      setPhase("saveError");
      setErrorKey("saveFailed");
    } finally {
      saveSubmissionPending.current = false;
    }
  }

  function clearConnection() {
    if (translationSubmissionPending.current || saveSubmissionPending.current || requestController.current || saveController.current) return;
    clearDeviceModelConnection();
  }

  async function copyTranslation() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.translatedText);
      if (mounted.current) setNoticeKey("copied");
    } catch {
      if (mounted.current) setNoticeKey("copyFailed");
    }
  }

  const requestPending = phase === "loading";
  const savePending = phase === "saving";
  const showResult = Boolean(result);
  const showOffline = !online && (phase === "idle" || phase === "requestError");
  const status = requestPending
    ? copy.loading
    : savePending
      ? copy.saving
      : phase === "success"
        ? copy.ready
        : phase === "saved"
          ? copy.saved
          : showOffline
            ? copy.offline
            : errorKey
              ? copy[errorKey]
              : noticeKey
                ? copy[noticeKey]
                : "";
  const statusKind = showOffline || errorKey || noticeKey === "copyFailed" ? "error" : "info";

  return (
    <div className="device-ai">
      <section className="device-ai-original" aria-label={copy.original}>
        <h3>{copy.original}</h3>
        <p>{copy.sourcePages(source.pages, source.text.length)}</p>
        <div className="device-ai-text" tabIndex={0}>{source.text}</div>
      </section>

      <div className="device-ai-source" role="group" aria-label={copy.model}>
        <label className="device-ai-source-option">
          <input
            type="radio"
            name={`${modelId}-source`}
            checked={connectionSource === "shared"}
            disabled={!capability.sharedAvailable || requestPending || savePending || phase === "saved"}
            onChange={() => selectDeviceModelSource("shared")}
          />
          <span>{copy.sharedConnection}</span>
        </label>
        <label className="device-ai-source-option">
          <input
            type="radio"
            name={`${modelId}-source`}
            checked={connectionSource === "personal"}
            disabled={requestPending || savePending || phase === "saved"}
            onChange={() => selectDeviceModelSource("personal")}
          />
          <span>{copy.personalConnection}</span>
        </label>
      </div>
      {!capability.loaded && <p className="device-ai-capability">{copy.sharedLoading}</p>}
      {capability.loaded && !capability.sharedAvailable && <p className="device-ai-capability">{copy.sharedUnavailable}</p>}

      <div className="device-ai-fields">
        <label htmlFor={languageId}>
          <span>{copy.target}</span>
          <select
            id={languageId}
            value={targetLanguage}
            disabled={requestPending || savePending || phase === "saved"}
            onChange={(event) => {
              setTargetLanguage(event.target.value === "en" ? "en" : "zh");
              invalidateResult();
            }}
          >
            <option value="zh">{copy.chinese}</option>
            <option value="en">{copy.english}</option>
          </select>
        </label>
        <label htmlFor={modelId}>
          <span>{copy.model}</span>
          <input
            id={modelId}
            value={modelName}
            maxLength={MAX_MODEL_CHARACTERS}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            readOnly={connectionSource === "shared"}
            disabled={requestPending || savePending || phase === "saved"}
            onChange={(event) => {
              setModelName(event.target.value);
              invalidateResult();
            }}
          />
        </label>
      </div>

      {connectionSource === "personal" && (
        <label className="device-ai-credential" htmlFor={keyId}>
          <span>{copy.credential}</span>
          <input
            id={keyId}
            type="password"
            value={credential}
            placeholder={copy.credentialPlaceholder}
            maxLength={MAX_CREDENTIAL_CHARACTERS}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            disabled={requestPending || savePending || phase === "saved"}
            onChange={(event) => {
              setCredential(event.target.value);
              invalidateResult();
            }}
          />
        </label>
      )}

      {connectionSource === "personal" && (
        <button
          className="button button-quiet device-ai-clear-connection"
          type="button"
          disabled={requestPending || savePending}
          onClick={clearConnection}
        >
          {copy.clearConnection}
        </button>
      )}

      <div className="device-ai-notices">
        <p>{copy.transit}</p>
        <p>{connectionSource === "shared" ? copy.sharedNotice : copy.keyNotice}</p>
      </div>

      {!showResult && (
        <button
          className="button button-primary device-ai-confirm"
          type="button"
          disabled={requestPending || savePending || !online || (connectionSource === "shared" && (!capability.loaded || !capability.sharedAvailable))}
          onClick={() => void confirmTranslation()}
        >
          {phase === "requestError" ? copy.confirmAgain : copy.confirm}
        </button>
      )}

      {showResult && result && (
        <section className="device-ai-result" aria-label={copy.translation}>
          <h3>{copy.translation} · {result.targetLanguage === "zh" ? copy.chinese : copy.english}</h3>
          <div className="device-ai-text" tabIndex={0}>{result.translatedText}</div>
          <div className="device-ai-actions">
            {phase !== "saved" && (
              <button
                className="button button-primary"
                type="button"
                disabled={savePending}
                onClick={() => void saveTranslation()}
              >
                {phase === "saveError" ? copy.retrySave : copy.save}
              </button>
            )}
            <button className="button button-secondary" type="button" disabled={savePending} onClick={() => void copyTranslation()}>
              {copy.copy}
            </button>
            <button
              className="button button-quiet"
              type="button"
              disabled={savePending}
              onClick={() => callbacks.onSource(source)}
            >
              {copy.viewSource}
            </button>
          </div>
        </section>
      )}

      <p
        className="device-ai-status"
        data-kind={statusKind}
        role={statusKind === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {status}
      </p>
    </div>
  );
}

function render(registration: DeviceAIRegistration, model: DeviceAIModel) {
  registration.root.render(<DeviceAIConfirmation model={model} callbacks={registration.callbacks} />);
}

function destroy(registration: DeviceAIRegistration) {
  if (!registration.active) return;
  registration.active = false;
  if (owners.get(registration.container) === registration) owners.delete(registration.container);
  registration.root.unmount();
}

export function mountDeviceAI({ container, model, callbacks, onMounted }: MountDeviceAIOptions): DeviceAIHandle {
  if (!(container instanceof HTMLElement)) throw new TypeError("Device AI requires an HTML host");
  const previous = owners.get(container);
  if (previous) destroy(previous);
  const registration: DeviceAIRegistration = {
    container,
    root: createRoot(container),
    callbacks,
    active: true
  };
  owners.set(container, registration);
  flushSync(() => render(registration, model));
  onMounted?.();
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
