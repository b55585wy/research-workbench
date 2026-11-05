import type { ChartSkillsCallbacks, ChartSkillsModel, SkillRecord, SkillSnapshot, SkillSpec } from "./types";
import { defaultSkillSpec, parseSkillImport, SKILL_BYTES, SkillValidationError,
  validateChartSkillsModel, validateSkillRecord, validateSkillSpec } from "./validation";
import { skillCopy } from "./copy";

interface Editor {
  spec: SkillSpec;
  id: string | null;
  revision: number | null;
  ownerId: string | null;
  baseline: string;
  imported: boolean;
}

interface Operation {
  ownerId: string | null;
  epoch: number;
  url: string;
  body: string;
  id: string;
  revision: number;
  spec: SkillSpec;
}

export interface ChartSkillsState {
  model: ChartSkillsModel;
  items: SkillRecord[];
  editor: Editor | null;
  dirty: boolean;
  detached: boolean;
  loading: boolean;
  listError: boolean;
  error: "invalid" | "writeError" | "changed" | "quota" | null;
  pending: boolean;
  running: boolean;
}

interface Environment {
  confirm: (message: string) => boolean;
  uuid: () => string;
  download: (spec: SkillSpec, id: string) => void;
}

const snapshot = (record: SkillSnapshot): SkillSnapshot => ({
  id: record.id, revision: record.revision, sha256: record.sha256, spec: validateSkillSpec(record.spec)
});
export const skillKey = (record: SkillSnapshot) => `${record.id}:${record.revision}:${record.sha256}`;

/** Writes are never aborted or replayed by model updates; only an explicit retry reuses them. */
export function createChartSkillsController(initial: ChartSkillsModel, callbacks: ChartSkillsCallbacks, env: Environment) {
  let model = validateChartSkillsModel(initial);
  let items: SkillRecord[] = [];
  let editor: Editor | null = null;
  let operation: Operation | null = null;
  let running = false;
  let loading = false;
  let listError = false;
  let error: ChartSkillsState["error"] = null;
  let active = true;
  let epoch = 0;
  let readTicket = 0;
  let read: AbortController | null = null;
  const listeners = new Set<() => void>();
  const dirty = () => !!editor && (editor.imported || JSON.stringify(editor.spec) !== editor.baseline);
  const detached = () => !!editor && editor.ownerId !== model.ownerId;
  const interactive = () => active && model.available && !model.busy && !operation && !detached();
  const notify = () => { if (active) for (const listener of listeners) listener(); };
  const copy = () => skillCopy[model.language];

  function clearEditor() { editor = null; error = null; }
  function allowDiscard() { return !dirty() || env.confirm(copy().discardConfirm); }
  function begin(spec: SkillSpec, existing: SkillSnapshot | null, imported = false) {
    if (!interactive() || !allowDiscard()) return false;
    editor = { spec, id: existing?.id || null, revision: existing?.revision || null,
      ownerId: model.ownerId, baseline: JSON.stringify(spec), imported };
    error = null;
    notify();
    return true;
  }

  async function load() {
    if (!active || !model.available) return false;
    read?.abort();
    const controller = new AbortController();
    read = controller;
    const ticket = ++readTicket;
    const ownerEpoch = epoch;
    loading = true; listError = false; notify();
    try {
      const response = await callbacks.api("/api/v1/chart-skills", { signal: controller.signal });
      if (!active || controller.signal.aborted || ownerEpoch !== epoch || ticket !== readTicket) return false;
      if (!response || !Array.isArray(response.items) || response.items.length > 100) throw new Error("Invalid list");
      const records = response.items.map(validateSkillRecord);
      if (new Set(records.map((record: SkillRecord) => record.id)).size !== records.length) throw new Error("Invalid list");
      items = records;
      return true;
    } catch {
      if (active && ownerEpoch === epoch && ticket === readTicket && !controller.signal.aborted) listError = true;
      return false;
    } finally {
      if (active && ownerEpoch === epoch && ticket === readTicket) {
        loading = false; read = null; notify();
      }
    }
  }

  function writeError(reason: any): ChartSkillsState["error"] {
    const code = reason?.code || reason?.error?.code || reason?.detail?.code;
    if (["chart_skill_changed", "revision_conflict", "idempotency_conflict"].includes(code)) return "changed";
    if (code === "chart_skill_quota") return "quota";
    return "writeError";
  }

  async function runWrite(op: Operation) {
    if (!active || running || operation !== op || model.ownerId !== op.ownerId || !model.available || model.busy) return false;
    running = true; error = null; op.epoch = epoch; notify();
    let saved: SkillRecord;
    try {
      const response = await callbacks.api(op.url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: op.body
      });
      saved = validateSkillRecord(response);
      if (saved.id !== op.id || saved.revision !== op.revision || JSON.stringify(saved.spec) !== JSON.stringify(op.spec)) {
        throw new Error("Mismatched save response");
      }
    } catch (reason) {
      if (active && operation === op) { running = false; error = writeError(reason); notify(); }
      return false;
    }
    if (!active || operation !== op) return false;
    running = false; operation = null; clearEditor();
    const current = op.epoch === epoch && op.ownerId === model.ownerId && model.available;
    if (current) items = [saved, ...items.filter((item) => item.id !== saved.id)];
    notify();
    if (current) callbacks.onSelect(snapshot(saved));
    return true;
  }

  return {
    get state(): ChartSkillsState {
      return { model, items, editor, dirty: dirty(), detached: detached(), loading, listError,
        error, pending: !!operation, running };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    update(next: ChartSkillsModel) {
      if (!active) return false;
      let validated: ChartSkillsModel;
      try { validated = validateChartSkillsModel(next); } catch { return false; }
      const scopeChanged = validated.ownerId !== model.ownerId || validated.available !== model.available;
      model = validated;
      if (scopeChanged) {
        epoch += 1; readTicket += 1; read?.abort(); read = null;
        items = []; loading = false; listError = false;
        if (!operation && !dirty()) clearEditor();
      }
      notify();
      if (scopeChanged && model.available) void load();
      return true;
    },
    newSkill() { return begin(defaultSkillSpec(), null); },
    editSelected() {
      if (!model.selected) return false;
      return begin(validateSkillSpec(model.selected.spec), model.selected);
    },
    change(spec: SkillSpec) {
      if (!interactive() || !editor) return false;
      editor = { ...editor, spec: structuredClone(spec) }; error = null; notify(); return true;
    },
    closeEditor() {
      if (!active || operation || !allowDiscard()) return false;
      clearEditor(); notify(); return true;
    },
    select(key: string) {
      if (!interactive() || !allowDiscard()) return false;
      const selected = key ? items.find((item) => skillKey(item) === key)
        || (model.selected && skillKey(model.selected) === key ? model.selected : null) : null;
      if (key && !selected) return false;
      clearEditor(); notify();
      callbacks.onSelect(selected ? snapshot(selected) : null);
      return true;
    },
    async importFile(file: { size: number; text: () => Promise<string> }) {
      if (!interactive()) return false;
      const ownerEpoch = epoch;
      try {
        if (file.size > SKILL_BYTES) throw new SkillValidationError("size");
        const spec = parseSkillImport(await file.text());
        if (ownerEpoch !== epoch || !interactive()) return false;
        return begin(spec, null, true);
      } catch {
        if (active && ownerEpoch === epoch) { error = "invalid"; notify(); }
        return false;
      }
    },
    exportSelected() {
      if (!active || !model.selected) return false;
      try { env.download(validateSkillSpec(model.selected.spec), model.selected.id); return true; }
      catch { error = "invalid"; notify(); return false; }
    },
    async save() {
      if (!interactive() || !editor) return false;
      try {
        const spec = validateSkillSpec(editor.spec);
        const requestId = env.uuid();
        const body = { request_id: requestId, ...(editor.id ? { expected_revision: editor.revision } : {}), spec };
        operation = { ownerId: model.ownerId, epoch,
          url: editor.id ? `/api/v1/chart-skills/${encodeURIComponent(editor.id)}/versions` : "/api/v1/chart-skills",
          body: JSON.stringify(body), id: editor.id || requestId, revision: (editor.revision || 0) + 1, spec };
      } catch { error = "invalid"; notify(); return false; }
      return runWrite(operation);
    },
    retry() { return operation ? runWrite(operation) : Promise.resolve(false); },
    discardRequest() {
      if (!active || !operation || running || !env.confirm(copy().requestConfirm)) return false;
      operation = null; error = null;
      if (detached()) clearEditor();
      notify(); return true;
    },
    hasUnsavedWork() { return !!operation || dirty(); },
    prepareNavigation() {
      if (!active) return true;
      if (operation || !allowDiscard()) return false;
      clearEditor(); notify(); return true;
    },
    destroy() {
      active = false; epoch += 1; read?.abort(); read = null; listeners.clear();
    }
  };
}

export type ChartSkillsController = ReturnType<typeof createChartSkillsController>;
