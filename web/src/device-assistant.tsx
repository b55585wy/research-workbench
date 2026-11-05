import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from "react";
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

const MAX_QUESTION = 2000;
const MAX_ANSWER = 6000;
const MAX_MATERIALS = 4;
const MAX_MATERIAL = 3000;
const MAX_MATERIAL_TOTAL = 6000;
const MAX_HISTORY = 8000;
const MAX_COMBINED = 16000;
const MAX_BODY_BYTES = 65536;
const MAX_TURNS = 10;
const MAX_MODEL = 120;
const MAX_CREDENTIAL = 512;
const MAX_NOTE = 10000;
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type DeviceAssistantLanguage = "zh" | "en";
export type DeviceAssistantResult = "added" | "invalid" | "limit" | "owner" | "pending";

export interface DeviceAssistantRect extends ReadonlyArray<number> {}

export interface DeviceAssistantSourceSegment {
  page: number;
  quote: string;
  rects: readonly DeviceAssistantRect[];
}

export interface DeviceAssistantOwner {
  documentId: string;
  sourceSha256: string;
  title: string;
  page: number;
  pageCount: number;
}

export interface DeviceAssistantNote {
  id: string;
  document_id: string;
  page: number;
  rect: readonly number[] | null;
  text: string;
  revision: number;
  deleted_at?: string | null;
  purged?: boolean;
  source_segments?: readonly DeviceAssistantSourceSegment[] | null;
}

export interface DeviceAssistantReaderAction {
  kind: string;
  page: number;
  rect: readonly number[] | null;
  rects?: readonly (readonly number[])[];
  text?: string;
  sourceSha256?: string;
  sourceSegments?: readonly DeviceAssistantSourceSegment[] | null;
}

export interface DeviceAssistantMaterial {
  key: string;
  kind: "selection" | "note";
  documentId: string;
  sourceSha256: string;
  title: string;
  text: string;
  page: number;
  rect: readonly number[] | null;
  segments: readonly DeviceAssistantSourceSegment[];
  noteId: string | null;
  revision: number | null;
}

export interface DeviceAssistantModel {
  language: DeviceAssistantLanguage;
  owner: DeviceAssistantOwner | null;
}

export interface DeviceAssistantNoteSave {
  requestId: string;
  owner: DeviceAssistantOwner;
  page: number;
  rect: readonly number[] | null;
  segments: readonly DeviceAssistantSourceSegment[];
  text: string;
  signal: AbortSignal;
}

export interface DeviceAssistantCallbacks {
  isCurrent: (owner: DeviceAssistantOwner | null) => boolean;
  revalidate: (
    owner: DeviceAssistantOwner | null,
    materials: readonly DeviceAssistantMaterial[],
    signal: AbortSignal
  ) => Promise<void>;
  saveNote: (save: DeviceAssistantNoteSave) => Promise<void>;
  onSource: (material: DeviceAssistantMaterial) => void;
  renderAnswer: (container: HTMLElement, answer: string, language: DeviceAssistantLanguage) => void;
  onLayout?: () => void;
}

export interface MountDeviceAssistantOptions {
  container: HTMLElement;
  model: DeviceAssistantModel;
  callbacks: DeviceAssistantCallbacks;
  onMounted?: () => void;
}

export interface DeviceAssistantHandle {
  update: (model: DeviceAssistantModel) => boolean;
  prepareReaderAction: (documentId: string, action: DeviceAssistantReaderAction) => DeviceAssistantResult;
  addNoteReferences: (documentId: string, notes: readonly DeviceAssistantNote[]) => DeviceAssistantResult;
  clearConversation: () => boolean;
  suspend: () => void;
  destroy: () => void;
}

interface WireMaterial {
  label: string;
  text: string;
}

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface QuestionPayload {
  question: string;
  materials: WireMaterial[];
  history: HistoryMessage[];
  answer_language: DeviceAssistantLanguage;
  model: string;
}

interface Confirmation {
  owner: DeviceAssistantOwner | null;
  materials: readonly DeviceAssistantMaterial[];
  payload: QuestionPayload;
  source: DeviceModelSource;
  credential: string;
}

interface Turn {
  id: string;
  noteId: string;
  owner: DeviceAssistantOwner | null;
  language: DeviceAssistantLanguage;
  question: string;
  answer: string;
  materials: readonly DeviceAssistantMaterial[];
  saveState: "idle" | "error" | "saved";
}

interface Registration {
  container: HTMLElement;
  root: Root;
  active: boolean;
}

interface Controller {
  prepareReaderAction: (documentId: string, action: DeviceAssistantReaderAction) => DeviceAssistantResult;
  addNoteReferences: (documentId: string, notes: readonly DeviceAssistantNote[]) => DeviceAssistantResult;
  clearConversation: () => boolean;
  suspend: () => void;
}

type Phase = "editing" | "reviewing" | "confirmed" | "sending";
type StatusKind = "info" | "success" | "error";

const owners = new WeakMap<HTMLElement, Registration>();

const strings = {
  zh: {
    empty: "输入问题，或先明确加入 PDF 选区和已保存笔记。",
    memory: "对话仅保留在本页，刷新会丢失；保存的回答会成为普通本机笔记并随现有备份导出。",
    turnCount: (count: number) => `本轮对话 ${count}/10`,
    currentPaper: "当前文献",
    noPaper: "未选择文献；可提一般问题，但不能保存为文献笔记。",
    question: "问题",
    questionPlaceholder: "输入你的问题…",
    answerLanguage: "回答语言",
    chinese: "中文",
    english: "英文",
    settings: "模型连接",
    credential: "DeepSeek API 密钥",
    credentialPlaceholder: "仅在本页暂存",
    model: "模型标识",
    clearConnection: "清除连接",
    sharedConnection: "平台连接",
    personalConnection: "自己的 Key",
    sharedLoading: "正在读取平台连接…",
    sharedUnavailable: "平台连接不可用，请使用自己的 Key。",
    sharedNotice: "使用平台 DeepSeek 连接，不会要求或保存你的 API 密钥。",
    keyNotice: "密钥仅在本页暂存，不保存到服务器、浏览器存储或备份。",
    materials: "本次加入的资料",
    selection: "PDF 选区",
    note: "已保存笔记",
    page: (page: number) => `第 ${page} 页`,
    fullText: "完整文字",
    viewSource: "查看原来源",
    remove: "移除",
    includeHistory: "同时提供同一 PDF 最近一轮已完成的问题和回答",
    noHistory: "当前 PDF 还没有可加入的已完成问答。",
    review: "预览完整请求",
    reviewing: "正在核对原文和笔记…",
    preview: "发送前完整预览",
    previewHelp: "以下全部文字会发送；文献标识、页码、坐标和笔记编号不会随请求发送。",
    previewQuestion: "问题全文",
    previewMaterials: "资料全文",
    noMaterials: "不提供额外资料。",
    previewHistory: "附带的历史全文",
    noHistorySent: "不发送历史消息。",
    modelLabel: "模型",
    transit: "问题和上述资料经本站转发到 DeepSeek，可能产生模型费用；PDF 不上传。",
    edit: "返回修改",
    confirm: "确认可能产生费用并发送",
    sending: "正在等待回答…",
    stop: "停止等待",
    stopped: "已停止等待，结果不确定。再次确认发送可能再次产生费用。",
    requestFailed: "未收到有效回答，结果不确定。再次确认发送可能再次产生费用。",
    invalidResponse: "回答未通过完整性校验，未显示或保存。",
    credentialInvalid: "请输入 1 至 512 个可见 ASCII 字符的 API 密钥，不能包含空格。",
    modelInvalid: "模型标识需为 1 至 120 个可见 ASCII 字符，不能包含空格。",
    offline: "当前离线。联网后才能发送；问题、资料和笔记仍保留。",
    sourceChanged: "原文、笔记或当前文献已变化。请移除变化资料并重新选择，然后重新预览。",
    validation: "请检查问题、资料和设置；内容不能为空或包含无效字符。",
    questionRequired: "请输入非空问题，最多 2000 字。",
    materialLimit: "最多 4 份资料，每份不超过 3000 字，合计不超过 6000 字。",
    historyLimit: "附带历史不能超过 8000 字。",
    combinedLimit: "问题、资料和历史合计不能超过 16000 字，且请求不能超过 64 KiB。",
    turnLimit: "已达到 10 轮上限。请先保存需要保留的回答，再清空对话；不会自动丢弃内容。",
    added: "资料已加入，尚未发送。",
    removed: "资料已移除，尚未发送。",
    cleared: "对话已清空；未发送的问题、已加入资料、PDF 和笔记均保留。",
    ownerChanged: "文献已切换；等待已停止，本次资料和历史上的选择已重置，未发送问题仍保留。",
    you: "你",
    assistant: "助手",
    sentMaterials: "本次实际发送的资料",
    sourceNotice: "这些卡片记录实际发送的文字快照，不代表回答中的每项说法都已核实。",
    save: "保存为本机新笔记",
    retrySave: "重试保存同一笔记",
    saving: "正在核对来源并保存…",
    saved: "已保存为本机新笔记；当前编辑器草稿未改动。",
    saveFailed: "保存失败；回答仍保留。可用同一笔记编号重试，不会重新请求模型。",
    differentOwner: "此回答属于另一文献或版本，切回原文献后才能保存。",
    noteQuestion: "问题",
    noteAnswer: "回答",
    conflict: "请求冲突。请检查后重新预览并明确确认发送。",
    busy: "服务正忙。稍后可重新预览并明确确认发送。",
    saveUnavailable: "没有当前文献，不能保存为文献笔记。"
  },
  en: {
    empty: "Enter a question, or explicitly add a PDF selection and saved notes.",
    memory: "Conversation is kept only in this page and is lost on refresh. Saved answers become ordinary device notes included in existing backups.",
    turnCount: (count: number) => `Conversation ${count}/10 turns`,
    currentPaper: "Current paper",
    noPaper: "No paper selected. General questions are allowed, but answers cannot be saved as paper notes.",
    question: "Question",
    questionPlaceholder: "Ask a question…",
    answerLanguage: "Answer language",
    chinese: "Chinese",
    english: "English",
    settings: "Model connection",
    credential: "DeepSeek API key",
    credentialPlaceholder: "Kept only in this page",
    model: "Model identifier",
    clearConnection: "Clear connection",
    sharedConnection: "Platform connection",
    personalConnection: "Your key",
    sharedLoading: "Reading the platform connection…",
    sharedUnavailable: "The platform connection is unavailable. Use your own key instead.",
    sharedNotice: "Uses the platform DeepSeek connection without requesting or saving your API key.",
    keyNotice: "The key is kept only in this page and is not saved to the server, browser storage, or backups.",
    materials: "Materials added for this request",
    selection: "PDF selection",
    note: "Saved note",
    page: (page: number) => `Page ${page}`,
    fullText: "Full text",
    viewSource: "View original source",
    remove: "Remove",
    includeHistory: "Include the latest completed question and answer from this PDF",
    noHistory: "This PDF has no completed question and answer to include yet.",
    review: "Preview complete request",
    reviewing: "Checking the original and notes…",
    preview: "Complete preview before sending",
    previewHelp: "All text below will be sent. Document IDs, pages, coordinates, and note IDs are not included in the request.",
    previewQuestion: "Complete question",
    previewMaterials: "Complete materials",
    noMaterials: "No additional materials.",
    previewHistory: "Complete included history",
    noHistorySent: "No history will be sent.",
    modelLabel: "Model",
    transit: "The question and materials above are forwarded by this site to DeepSeek and may incur model charges. The PDF is not uploaded.",
    edit: "Back to editing",
    confirm: "Confirm possible charges and send",
    sending: "Waiting for the answer…",
    stop: "Stop waiting",
    stopped: "Waiting stopped; the outcome is uncertain. Another confirmed send may be charged again.",
    requestFailed: "No valid answer was received, so the outcome is uncertain. Another confirmed send may be charged again.",
    invalidResponse: "The answer failed integrity validation and was not shown or saved.",
    credentialInvalid: "Enter an API key containing 1–512 visible ASCII characters without spaces.",
    modelInvalid: "Use 1–120 visible ASCII characters without spaces for the model identifier.",
    offline: "You are offline. Reconnect to send; the question, materials, and notes are preserved.",
    sourceChanged: "The original, a note, or the current paper changed. Remove changed materials, select them again, and review again.",
    validation: "Check the question, materials, and settings. Content must be nonblank and contain valid characters.",
    questionRequired: "Enter a nonblank question of at most 2,000 characters.",
    materialLimit: "Use at most 4 materials, each up to 3,000 characters and 6,000 characters in total.",
    historyLimit: "Included history cannot exceed 8,000 characters.",
    combinedLimit: "Question, materials, and history cannot exceed 16,000 characters, and the request cannot exceed 64 KiB.",
    turnLimit: "The 10-turn limit has been reached. Save answers you need, then clear the conversation. Nothing is discarded automatically.",
    added: "Materials added. Nothing was sent.",
    removed: "Material removed. Nothing was sent.",
    cleared: "Conversation cleared. The unsent question, added materials, PDFs, and notes were preserved.",
    ownerChanged: "Paper changed. Waiting stopped; materials and history selection were reset, while the unsent question was preserved.",
    you: "You",
    assistant: "Assistant",
    sentMaterials: "Materials actually sent for this turn",
    sourceNotice: "These cards record the exact text snapshots sent. They do not mean every claim in the answer is verified.",
    save: "Save as a new device note",
    retrySave: "Retry saving the same note",
    saving: "Checking sources and saving…",
    saved: "Saved as a new device note. The current editor draft was not changed.",
    saveFailed: "Saving failed; the answer is still here. Retry with the same note ID without another model request.",
    differentOwner: "This answer belongs to another paper or version. Return to that paper before saving.",
    noteQuestion: "Question",
    noteAnswer: "Answer",
    conflict: "The request conflicted. Review it, then preview and explicitly confirm another send.",
    busy: "The service is busy. Preview and explicitly confirm another send later.",
    saveUnavailable: "A current paper is required to save a paper note."
  }
} as const;

function ownerKey(owner: DeviceAssistantOwner | null) {
  return owner ? `${owner.documentId}:${owner.sourceSha256}` : "none";
}

function validText(value: unknown, maximum: number, allowBlank = false): value is string {
  if (typeof value !== "string" || value.length > maximum || (!allowBlank && !value.trim()) || value.includes("\0")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function validRect(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] >= 0 && value[1] >= 0 && value[2] <= 1 && value[3] <= 1
    && value[2] > value[0] && value[3] > value[1];
}

function copyRect(rect: readonly number[]) {
  return Object.freeze([...rect]);
}

function unionRects(rects: readonly (readonly number[])[]) {
  return Object.freeze([
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3]))
  ]);
}

function freezeSegments(value: readonly DeviceAssistantSourceSegment[] | null | undefined, pageCount: number) {
  if (value == null) return [] as readonly DeviceAssistantSourceSegment[];
  if (!Array.isArray(value) || value.length > 20) throw new Error("invalid_segments");
  let previous = 0;
  return Object.freeze(value.map((segment) => {
    if (!Number.isInteger(segment.page) || segment.page <= previous || segment.page > pageCount
      || !validText(segment.quote, MAX_MATERIAL)
      || !Array.isArray(segment.rects) || !segment.rects.length || segment.rects.length > 256
      || !segment.rects.every(validRect)) throw new Error("invalid_segments");
    previous = segment.page;
    return Object.freeze({
      page: segment.page,
      quote: segment.quote,
      rects: Object.freeze(segment.rects.map(copyRect))
    });
  }));
}

function freezeMaterial(material: DeviceAssistantMaterial): DeviceAssistantMaterial {
  return Object.freeze({
    ...material,
    rect: material.rect ? copyRect(material.rect) : null,
    segments: freezeSegments(material.segments, 200)
  });
}

function selectionMaterial(owner: DeviceAssistantOwner, documentId: string, action: DeviceAssistantReaderAction) {
  if (action.kind !== "ask" || owner.documentId !== documentId || action.sourceSha256 !== owner.sourceSha256
    || !validText(action.text, MAX_MATERIAL)) throw new Error("invalid_selection");
  const supplied = action.sourceSegments?.length
    ? freezeSegments(action.sourceSegments, owner.pageCount)
    : freezeSegments([{
      page: action.page,
      quote: action.text,
      rects: action.rects?.length ? action.rects : action.rect ? [action.rect] : []
    }], owner.pageCount);
  if (!supplied.length || supplied.map((segment) => segment.quote).join("\n") !== action.text) throw new Error("invalid_selection");
  const first = supplied[0];
  return freezeMaterial({
    key: `selection:${documentId}:${owner.sourceSha256}:${JSON.stringify(supplied)}`,
    kind: "selection",
    documentId,
    sourceSha256: owner.sourceSha256,
    title: owner.title,
    text: action.text,
    page: first.page,
    rect: unionRects(first.rects),
    segments: supplied,
    noteId: null,
    revision: null
  });
}

function noteMaterial(owner: DeviceAssistantOwner, documentId: string, note: DeviceAssistantNote) {
  if (!note || note.document_id !== documentId || owner.documentId !== documentId || note.deleted_at || note.purged
    || typeof note.id !== "string" || !note.id || !Number.isInteger(note.revision) || note.revision < 1
    || !Number.isInteger(note.page) || note.page < 1 || note.page > owner.pageCount
    || !validText(note.text, MAX_MATERIAL)) throw new Error("invalid_note");
  if (note.rect !== null && note.rect !== undefined && !validRect(note.rect)) throw new Error("invalid_note");
  const segments = freezeSegments(note.source_segments, owner.pageCount);
  return freezeMaterial({
    key: `note:${note.id}`,
    kind: "note",
    documentId,
    sourceSha256: owner.sourceSha256,
    title: owner.title,
    text: note.text,
    page: note.page,
    rect: note.rect ? copyRect(note.rect) : null,
    segments,
    noteId: note.id,
    revision: note.revision
  });
}

function materialsFit(materials: readonly DeviceAssistantMaterial[]) {
  return materials.length <= MAX_MATERIALS
    && materials.every((material) => validText(material.text, MAX_MATERIAL))
    && materials.reduce((total, material) => total + material.text.length, 0) <= MAX_MATERIAL_TOTAL;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function responseError(status: number) {
  if (status === 401 || status === 403) return "credentialInvalid";
  if (status === 409) return "conflict";
  if (status === 429 || status === 503) return "busy";
  if (status === 422) return "validation";
  return "requestFailed";
}

function statusNode(copy: { readonly [key: string]: unknown }, status: { key: string; kind: StatusKind } | null): ReactNode {
  if (!status) return null;
  const value = copy[status.key];
  return typeof value === "string" ? value : status.key;
}

function MaterialText({ material, label }: { material: DeviceAssistantMaterial; label: string }) {
  return (
    <details className="device-assistant-material-text">
      <summary>{label}</summary>
      <pre tabIndex={0}>{material.text}</pre>
    </details>
  );
}

function AnswerContent({ turn, callbacks }: { turn: Turn; callbacks: DeviceAssistantCallbacks }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.replaceChildren();
    callbacks.renderAnswer(container, turn.answer, turn.language);
    return () => {
      container.replaceChildren();
    };
  }, [callbacks, turn.answer, turn.id, turn.language]);
  return <div className="assistant-answer-content" ref={ref} />;
}

const DeviceAssistant = forwardRef<Controller, {
  model: DeviceAssistantModel;
  callbacks: DeviceAssistantCallbacks;
}>(function DeviceAssistant({ model, callbacks }, ref) {
  const copy = strings[model.language];
  const questionId = useId();
  const credentialId = useId();
  const modelId = useId();
  const languageId = useId();
  const [question, setQuestion] = useState("");
  const [answerLanguage, setAnswerLanguage] = useState<DeviceAssistantLanguage>(model.language);
  const [initialConnection] = useState(() => readDeviceModelConnection());
  const [credential, setCredential] = useState(initialConnection.credential);
  const [modelName, setModelName] = useState(initialConnection.model);
  const [connectionSource, setConnectionSource] = useState<DeviceModelSource>(initialConnection.source);
  const [capability, setCapability] = useState({
    loaded: initialConnection.capabilityLoaded,
    failed: initialConnection.capabilityFailed,
    sharedAvailable: initialConnection.sharedAvailable
  });
  const [materials, setMaterials] = useState<readonly DeviceAssistantMaterial[]>([]);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [phase, setPhase] = useState<Phase>("editing");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [status, setStatus] = useState<{ key: string; kind: StatusKind } | null>(null);
  const [savingTurnId, setSavingTurnId] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const mounted = useRef(true);
  const generation = useRef(0);
  const reviewController = useRef<AbortController | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const ownSubmission = useRef(false);
  const currentOwnerKey = ownerKey(model.owner);
  const previousOwnerKey = useRef(currentOwnerKey);
  const busy = phase === "reviewing" || phase === "sending" || savingTurnId !== null;

  function showStatus(key: string, kind: StatusKind = "info") {
    setStatus({ key, kind });
  }

  function invalidateConfirmation() {
    if (phase === "reviewing" || phase === "sending") return;
    setConfirmation(null);
    setPhase("editing");
    setStatus(null);
  }

  function abortPending(nextStatus = true) {
    generation.current += 1;
    reviewController.current?.abort();
    requestController.current?.abort();
    saveController.current?.abort();
    reviewController.current = null;
    requestController.current = null;
    saveController.current = null;
    setSavingTurnId(null);
    setConfirmation(null);
    setPhase("editing");
    if (nextStatus) showStatus("stopped");
  }

  useEffect(() => {
    mounted.current = true;
    const updateOnline = () => setOnline(navigator.onLine);
    const unsubscribe = subscribeDeviceModelConnection(() => {
      if (ownSubmission.current) return;
      const connection = readDeviceModelConnection();
      setCredential(connection.credential);
      setModelName(connection.model);
      setConnectionSource(connection.source);
      setCapability({
        loaded: connection.capabilityLoaded,
        failed: connection.capabilityFailed,
        sharedAvailable: connection.sharedAvailable
      });
      if (!reviewController.current && !requestController.current && !saveController.current) {
        setConfirmation(null);
        setPhase("editing");
      }
    });
    void loadDeviceModelCapability();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      mounted.current = false;
      unsubscribe();
      generation.current += 1;
      reviewController.current?.abort();
      requestController.current?.abort();
      saveController.current?.abort();
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (previousOwnerKey.current === currentOwnerKey) return;
    previousOwnerKey.current = currentOwnerKey;
    generation.current += 1;
    reviewController.current?.abort();
    requestController.current?.abort();
    saveController.current?.abort();
    reviewController.current = null;
    requestController.current = null;
    saveController.current = null;
    setSavingTurnId(null);
    setMaterials([]);
    setIncludeHistory(false);
    setConfirmation(null);
    setPhase("editing");
    showStatus("ownerChanged");
  }, [currentOwnerKey]);

  useEffect(() => {
    callbacks.onLayout?.();
  });

  function latestTurn() {
    const key = ownerKey(model.owner);
    return model.owner ? [...turns].reverse().find((turn) => ownerKey(turn.owner) === key) || null : null;
  }

  function buildPayload(): { payload: QuestionPayload } | { error: string } {
    const trimmedModel = modelName.trim();
    if (!validText(question, MAX_QUESTION)) return { error: "questionRequired" };
    if (!VISIBLE_ASCII.test(trimmedModel) || trimmedModel.length > MAX_MODEL) return { error: "modelInvalid" };
    if (!materialsFit(materials)) return { error: "materialLimit" };
    const previous = includeHistory ? latestTurn() : null;
    const history: HistoryMessage[] = previous
      ? [{ role: "user", content: previous.question }, { role: "assistant", content: previous.answer }]
      : [];
    if (history.reduce((total, message) => total + message.content.length, 0) > MAX_HISTORY) return { error: "historyLimit" };
    const payload: QuestionPayload = {
      question,
      materials: materials.map((material, index) => ({ label: `M${index + 1}`, text: material.text })),
      history,
      answer_language: answerLanguage,
      model: trimmedModel
    };
    const combined = payload.question.length
      + payload.materials.reduce((total, material) => total + material.text.length, 0)
      + history.reduce((total, message) => total + message.content.length, 0);
    if (combined > MAX_COMBINED) return { error: "combinedLimit" };
    return { payload };
  }

  async function review() {
    if (busy || phase === "confirmed") return;
    if (turns.length >= MAX_TURNS) {
      showStatus("turnLimit", "error");
      return;
    }
    const built = buildPayload();
    if ("error" in built) {
      showStatus(built.error, "error");
      return;
    }
    const ticket = ++generation.current;
    const controller = new AbortController();
    reviewController.current = controller;
    const owner = model.owner ? { ...model.owner } : null;
    const snapshot = [...materials];
    setPhase("reviewing");
    setStatus(null);
    try {
      await callbacks.revalidate(owner, snapshot, controller.signal);
      if (!mounted.current || ticket !== generation.current || !callbacks.isCurrent(owner)) return;
      reviewController.current = null;
      setConfirmation({ owner, materials: snapshot, payload: built.payload, source: connectionSource, credential });
      setPhase("confirmed");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!mounted.current || ticket !== generation.current) return;
      reviewController.current = null;
      setPhase("editing");
      showStatus("sourceChanged", "error");
    }
  }

  async function send() {
    if (!confirmation || phase !== "confirmed" || savingTurnId !== null || requestController.current) return;
    if (turns.length >= MAX_TURNS) {
      showStatus("turnLimit", "error");
      return;
    }
    const current = confirmation;
    if (current.source === "shared" && (!capability.loaded || !capability.sharedAvailable)) {
      showStatus("sharedUnavailable", "error");
      return;
    }
    if (current.source === "personal" && (!VISIBLE_ASCII.test(current.credential) || current.credential.length > MAX_CREDENTIAL)) {
      showStatus("credentialInvalid", "error");
      return;
    }
    if (!online) {
      showStatus("offline", "error");
      return;
    }
    const requestId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const ticket = ++generation.current;
    const controller = new AbortController();
    requestController.current = controller;
    setPhase("sending");
    setStatus(null);
    try {
      await callbacks.revalidate(current.owner, current.materials, controller.signal);
      if (!mounted.current || ticket !== generation.current || !callbacks.isCurrent(current.owner)) return;
      const body = JSON.stringify({
        request_id: requestId,
        ...current.payload,
        confirmed: true
      });
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error("combinedLimit");
      const payloadSha256 = await digest(canonical(current.payload));
      ownSubmission.current = true;
      try {
        rememberDeviceModelSubmission(current.credential, current.payload.model, current.source);
      } finally {
        ownSubmission.current = false;
      }
      let response: Response;
      try {
        response = await fetch("/device/ai/question", {
          method: "POST",
          headers: {
            "X-Research-Model-Source": current.source,
            ...(current.source === "personal" ? { Authorization: `Bearer ${current.credential}` } : {}),
            "Content-Type": "application/json"
          },
          body,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new Error("requestFailed");
      }
      if (!response.ok) throw new Error(responseError(response.status));
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new Error("invalidResponse");
      }
      const result = value as Record<string, unknown> | null;
      if (!result || typeof result !== "object" || Array.isArray(result)
        || Object.keys(result).sort().join(",") !== "answer,model,payload_sha256,request_id"
        || result.request_id !== requestId || result.model !== current.payload.model
        || typeof result.payload_sha256 !== "string" || !SHA256.test(result.payload_sha256)
        || result.payload_sha256 !== payloadSha256
        || !validText(result.answer, MAX_ANSWER)) throw new Error("invalidResponse");
      if (!mounted.current || ticket !== generation.current || !callbacks.isCurrent(current.owner)) return;
      const turn: Turn = {
        id: requestId,
        noteId,
        owner: current.owner,
        language: model.language,
        question: current.payload.question,
        answer: result.answer,
        materials: current.materials,
        saveState: "idle"
      };
      requestController.current = null;
      setTurns((existing) => [...existing, turn]);
      setQuestion("");
      setIncludeHistory(false);
      setConfirmation(null);
      setPhase("editing");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!mounted.current || ticket !== generation.current) return;
      requestController.current = null;
      setConfirmation(null);
      setPhase("editing");
      const key = error instanceof Error && [
        "credentialInvalid", "conflict", "busy", "validation", "invalidResponse", "combinedLimit", "requestFailed"
      ].includes(error.message) ? error.message : "requestFailed";
      showStatus((error as { code?: string })?.code === "source_changed" ? "sourceChanged" : key, "error");
    }
  }

  async function save(turn: Turn) {
    if (savingTurnId || busy || turn.saveState === "saved") return;
    const owner = turn.owner;
    if (!owner || !model.owner || ownerKey(model.owner) !== ownerKey(owner) || !callbacks.isCurrent(owner)) {
      showStatus("differentOwner", "error");
      return;
    }
    const ticket = ++generation.current;
    const controller = new AbortController();
    saveController.current = controller;
    setSavingTurnId(turn.id);
    setStatus(null);
    try {
      await callbacks.revalidate(owner, turn.materials, controller.signal);
      if (!mounted.current || ticket !== generation.current || !callbacks.isCurrent(owner)) return;
      const language = strings[turn.language];
      const text = `${language.noteQuestion}:\n${turn.question}\n\n${language.noteAnswer}:\n${turn.answer}`;
      if (!validText(text, MAX_NOTE)) throw new Error("saveFailed");
      const anchor = turn.materials[0];
      await callbacks.saveNote({
        requestId: turn.noteId,
        owner,
        page: anchor?.page || owner.page,
        rect: anchor?.rect || null,
        segments: anchor?.segments || [],
        text,
        signal: controller.signal
      });
      if (!mounted.current || ticket !== generation.current || !callbacks.isCurrent(owner)) return;
      saveController.current = null;
      setSavingTurnId(null);
      setTurns((existing) => existing.map((item) => item.id === turn.id ? { ...item, saveState: "saved" } : item));
      showStatus("saved", "success");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!mounted.current || ticket !== generation.current) return;
      saveController.current = null;
      setSavingTurnId(null);
      setTurns((existing) => existing.map((item) => item.id === turn.id ? { ...item, saveState: "error" } : item));
      showStatus((error as { code?: string })?.code === "source_changed" ? "sourceChanged" : "saveFailed", "error");
    }
  }

  useImperativeHandle(ref, () => ({
    prepareReaderAction(documentId, action) {
      if (!model.owner || model.owner.documentId !== documentId) return "owner";
      if (busy) return "pending";
      let material: DeviceAssistantMaterial;
      try {
        material = selectionMaterial(model.owner, documentId, action);
      } catch {
        return "invalid";
      }
      const next = [...materials.filter((item) => item.key !== material.key), material];
      if (!materialsFit(next)) return "limit";
      setMaterials(next);
      setConfirmation(null);
      setPhase("editing");
      showStatus("added", "success");
      return "added";
    },
    addNoteReferences(documentId, notes) {
      if (!model.owner || model.owner.documentId !== documentId) return "owner";
      if (busy) return "pending";
      if (!Array.isArray(notes) || !notes.length) return "invalid";
      try {
        const incoming = new Map<string, DeviceAssistantMaterial>();
        for (const note of notes) {
          const material = noteMaterial(model.owner, documentId, note);
          const previous = incoming.get(material.key);
          if (previous && (previous.revision !== material.revision || previous.text !== material.text)) return "invalid";
          incoming.set(material.key, material);
        }
        const next = new Map(materials.map((material) => [material.key, material]));
        incoming.forEach((material, key) => next.set(key, material));
        const merged = [...next.values()];
        if (!materialsFit(merged)) return "limit";
        setMaterials(merged);
        setConfirmation(null);
        setPhase("editing");
        showStatus("added", "success");
        return "added";
      } catch {
        return "invalid";
      }
    },
    clearConversation() {
      if (busy) return false;
      setTurns([]);
      setIncludeHistory(false);
      setConfirmation(null);
      setPhase("editing");
      showStatus("cleared", "success");
      return true;
    },
    suspend() {
      abortPending(false);
    }
  }), [busy, materials, model, turns, question, answerLanguage, credential, modelName, includeHistory, phase, savingTurnId]);

  const latest = latestTurn();
  const editing = phase !== "confirmed";
  const statusContent = statusNode(copy, status);

  return (
    <div className="device-assistant">
      <p className="device-assistant-memory">{copy.memory}</p>
      <div className="device-assistant-context">
        <span>{copy.turnCount(turns.length)}</span>
        <span>{model.owner ? `${copy.currentPaper}: ${model.owner.title}` : copy.noPaper}</span>
      </div>

      {turns.length > 0 && (
        <div className="device-assistant-turns" aria-live="polite">
          {turns.map((turn) => {
            const sameOwner = ownerKey(turn.owner) === currentOwnerKey;
            const canSave = Boolean(turn.owner) && sameOwner;
            const saving = savingTurnId === turn.id;
            return (
              <article className="assistant-turn device-assistant-turn" key={turn.id}>
                <div className="device-assistant-turn-owner">{turn.owner?.title || copy.noPaper}</div>
                <section className="assistant-user-message" aria-label={copy.you}>
                  <strong>{copy.you}</strong>
                  <p>{turn.question}</p>
                </section>
                <section className="assistant-answer" aria-label={copy.assistant}>
                  <strong>{copy.assistant}</strong>
                  <AnswerContent turn={turn} callbacks={callbacks} />
                </section>
                {turn.materials.length > 0 && (
                  <details className="device-assistant-sent-materials">
                    <summary>{copy.sentMaterials} ({turn.materials.length})</summary>
                    <p>{copy.sourceNotice}</p>
                    {turn.materials.map((material) => (
                      <div className="device-assistant-source-card" key={material.key}>
                        <strong>{material.kind === "selection" ? copy.selection : copy.note} · {copy.page(material.page)}</strong>
                        <MaterialText material={material} label={copy.fullText} />
                        <button className="button button-quiet" type="button" onClick={() => callbacks.onSource(material)}>
                          {copy.viewSource}
                        </button>
                      </div>
                    ))}
                  </details>
                )}
                <div className="device-assistant-save-row">
                  {turn.saveState !== "saved" && (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={!canSave || busy}
                      title={!turn.owner ? copy.saveUnavailable : !sameOwner ? copy.differentOwner : undefined}
                      onClick={() => void save(turn)}
                    >
                      {saving ? copy.saving : turn.saveState === "error" ? copy.retrySave : copy.save}
                    </button>
                  )}
                  {turn.saveState === "saved" && <span className="device-assistant-saved">{copy.saved}</span>}
                  {!sameOwner && <span className="device-assistant-owner-warning">{copy.differentOwner}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!turns.length && !confirmation && <p className="assistant-empty">{copy.empty}</p>}

      {confirmation && (
        <section className="device-assistant-preview" aria-label={copy.preview}>
          <h3>{copy.preview}</h3>
          <p>{copy.previewHelp}</p>
          <h4>{copy.previewQuestion}</h4>
          <pre tabIndex={0}>{confirmation.payload.question}</pre>
          <h4>{copy.previewMaterials}</h4>
          {confirmation.payload.materials.length === 0 && <p>{copy.noMaterials}</p>}
          {confirmation.payload.materials.map((material) => (
            <div className="device-assistant-preview-material" key={material.label}>
              <strong>{material.label}</strong>
              <pre tabIndex={0}>{material.text}</pre>
            </div>
          ))}
          <h4>{copy.previewHistory}</h4>
          {confirmation.payload.history.length === 0 && <p>{copy.noHistorySent}</p>}
          {confirmation.payload.history.map((message, index) => (
            <div className="device-assistant-preview-history" key={`${message.role}-${index}`}>
              <strong>{message.role === "user" ? copy.you : copy.assistant}</strong>
              <pre tabIndex={0}>{message.content}</pre>
            </div>
          ))}
          <p>
            {confirmation.source === "shared" ? copy.sharedConnection : copy.personalConnection} · {copy.modelLabel}: {confirmation.payload.model} · {copy.answerLanguage}: {confirmation.payload.answer_language === "zh" ? copy.chinese : copy.english}
          </p>
          <p className="device-assistant-fee">{copy.transit}</p>
          <div className="device-assistant-preview-actions">
            <button className="button button-quiet" type="button" disabled={phase === "sending"} onClick={invalidateConfirmation}>
              {copy.edit}
            </button>
            <button className="button button-primary" type="button" disabled={phase === "sending" || !online || (confirmation.source === "shared" && (!capability.loaded || !capability.sharedAvailable))} onClick={() => void send()}>
              {phase === "sending" ? copy.sending : copy.confirm}
            </button>
          </div>
        </section>
      )}

      {editing && (
        <div className="device-assistant-editor">
          {materials.length > 0 && (
            <section className="device-assistant-materials" aria-label={copy.materials}>
              <h3>{copy.materials}</h3>
              {materials.map((material) => (
                <article className="device-assistant-material" key={material.key}>
                  <div>
                    <strong>{material.kind === "selection" ? copy.selection : copy.note} · {copy.page(material.page)}</strong>
                    <span>{material.title}</span>
                  </div>
                  <MaterialText material={material} label={copy.fullText} />
                  <div className="device-assistant-material-actions">
                    <button className="button button-quiet" type="button" disabled={busy} onClick={() => callbacks.onSource(material)}>
                      {copy.viewSource}
                    </button>
                    <button
                      className="button button-quiet"
                      type="button"
                      disabled={busy}
                      aria-label={`${copy.remove}: ${material.kind === "selection" ? copy.selection : copy.note} ${copy.page(material.page)}`}
                      onClick={() => {
                        setMaterials((current) => current.filter((item) => item.key !== material.key));
                        setConfirmation(null);
                        showStatus("removed");
                      }}
                    >
                      {copy.remove}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}

          <label className="device-assistant-question" htmlFor={questionId}>
            <span>{copy.question}</span>
            <textarea
              id={questionId}
              rows={4}
              maxLength={MAX_QUESTION}
              placeholder={copy.questionPlaceholder}
              value={question}
              disabled={busy}
              onChange={(event) => {
                setQuestion(event.target.value);
                invalidateConfirmation();
              }}
            />
            <span className="device-assistant-count">{question.length}/{MAX_QUESTION}</span>
          </label>

          <div className="device-assistant-options">
            <label htmlFor={languageId}>
              <span>{copy.answerLanguage}</span>
              <select
                id={languageId}
                value={answerLanguage}
                disabled={busy}
                onChange={(event) => {
                  setAnswerLanguage(event.target.value === "en" ? "en" : "zh");
                  invalidateConfirmation();
                }}
              >
                <option value="zh">{copy.chinese}</option>
                <option value="en">{copy.english}</option>
              </select>
            </label>
            <label className="device-assistant-history-option">
              <input
                type="checkbox"
                checked={includeHistory}
                disabled={busy || !latest}
                onChange={(event) => {
                  setIncludeHistory(event.target.checked);
                  invalidateConfirmation();
                }}
              />
              <span>{copy.includeHistory}</span>
            </label>
            {!latest && <p>{copy.noHistory}</p>}
          </div>

          <details className="device-assistant-settings">
            <summary>{copy.settings}</summary>
            <div className="device-assistant-settings-body">
              <div className="device-assistant-source" role="group" aria-label={copy.settings}>
                <label className="device-assistant-source-option">
                  <input
                    type="radio"
                    name={`${modelId}-source`}
                    checked={connectionSource === "shared"}
                    disabled={!capability.sharedAvailable || busy}
                    onChange={() => selectDeviceModelSource("shared")}
                  />
                  <span>{copy.sharedConnection}</span>
                </label>
                <label className="device-assistant-source-option">
                  <input
                    type="radio"
                    name={`${modelId}-source`}
                    checked={connectionSource === "personal"}
                    disabled={busy}
                    onChange={() => selectDeviceModelSource("personal")}
                  />
                  <span>{copy.personalConnection}</span>
                </label>
              </div>
              {!capability.loaded && <p className="device-assistant-capability">{copy.sharedLoading}</p>}
              {capability.loaded && !capability.sharedAvailable && <p className="device-assistant-capability">{copy.sharedUnavailable}</p>}
              {connectionSource === "personal" && (
                <label htmlFor={credentialId}>
                  <span>{copy.credential}</span>
                  <input
                    id={credentialId}
                    type="password"
                    value={credential}
                    placeholder={copy.credentialPlaceholder}
                    maxLength={MAX_CREDENTIAL}
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    onChange={(event) => {
                      setCredential(event.target.value);
                      invalidateConfirmation();
                    }}
                  />
                </label>
              )}
              <label htmlFor={modelId}>
                <span>{copy.model}</span>
                <input
                  id={modelId}
                  value={modelName}
                  maxLength={MAX_MODEL}
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={connectionSource === "shared"}
                  disabled={busy}
                  onChange={(event) => {
                    setModelName(event.target.value);
                    invalidateConfirmation();
                  }}
                />
              </label>
              {connectionSource === "personal" && (
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    clearDeviceModelConnection();
                    setStatus(null);
                  }}
                >
                  {copy.clearConnection}
                </button>
              )}
              <p>{connectionSource === "shared" ? copy.sharedNotice : copy.keyNotice}</p>
            </div>
          </details>

          <p className="device-assistant-fee">{copy.transit}</p>
          <button className="button button-primary device-assistant-review" type="button" disabled={busy || (connectionSource === "shared" && (!capability.loaded || !capability.sharedAvailable))} onClick={() => void review()}>
            {phase === "reviewing" ? copy.reviewing : copy.review}
          </button>
        </div>
      )}

      {phase === "sending" && (
        <button className="button button-quiet device-assistant-stop" type="button" onClick={() => abortPending(true)}>
          {copy.stop}
        </button>
      )}
      {!online && <p className="device-assistant-offline">{copy.offline}</p>}
      <p className="device-assistant-status" data-kind={status?.kind || "info"} role={status?.kind === "error" ? "alert" : "status"} aria-live="polite">
        {phase === "sending" ? copy.sending : statusContent}
      </p>
    </div>
  );
});

function destroy(registration: Registration) {
  if (!registration.active) return;
  registration.active = false;
  if (owners.get(registration.container) === registration) owners.delete(registration.container);
  registration.root.unmount();
}

export function mountDeviceAssistant({ container, model, callbacks, onMounted }: MountDeviceAssistantOptions): DeviceAssistantHandle {
  if (!(container instanceof HTMLElement)) throw new TypeError("Device assistant requires an HTML host");
  const previous = owners.get(container);
  if (previous) destroy(previous);
  const registration: Registration = { container, root: createRoot(container), active: true };
  const controller: { current: Controller | null } = { current: null };
  owners.set(container, registration);
  const render = (nextModel: DeviceAssistantModel) => {
    registration.root.render(<DeviceAssistant ref={(value) => { controller.current = value; }} model={nextModel} callbacks={callbacks} />);
  };
  flushSync(() => render(model));
  onMounted?.();
  return {
    update(nextModel) {
      if (!registration.active || owners.get(container) !== registration) return false;
      render(nextModel);
      return true;
    },
    prepareReaderAction(documentId, action) {
      return controller.current?.prepareReaderAction(documentId, action) || "pending";
    },
    addNoteReferences(documentId, notes) {
      return controller.current?.addNoteReferences(documentId, notes) || "pending";
    },
    clearConversation() {
      return controller.current?.clearConversation() || false;
    },
    suspend() {
      controller.current?.suspend();
    },
    destroy() {
      destroy(registration);
    }
  };
}
