import type { TeachingAction, TeachingCallbacks, TeachingImportCommand, TeachingModel, TeachingProgress } from "./types";
import { validateTeachingModel } from "./validation";
import { teachingCopy } from "./copy";

export interface TeachingState {
  model: TeachingModel;
  open: boolean;
  selectedId: string | null;
  command: TeachingImportCommand | null;
  pending: boolean;
  detached: boolean;
  refreshing: boolean;
  continuing: TeachingAction | null;
  feedback: "failed" | "uncertain" | "invalid" | "stale" | "refreshFailed" | "continueFailed" | null;
}

interface Environment { uuid(): string; confirm(message: string): boolean }

export function teachingProgress(model: TeachingModel): TeachingProgress | null {
  const progress = model.progress;
  return model.ownerId && model.available && progress && model.examples.some(item => item.id === progress.exampleId) ? progress : null;
}

export function progressAllows(model: TeachingModel, action: TeachingAction): boolean {
  const progress = teachingProgress(model);
  if (!progress) return false;
  if (action === "analysis") return true;
  if (action === "charts") return progress.stage !== "imported" && !!progress.analysisId;
  return action === "presentations" && progress.stage === "charted" && !!progress.analysisId && !!progress.chartId;
}

/** Only explicit import/retry actions send the one frozen command; updates never replay it. */
export function createTeachingDataController(initial: TeachingModel, callbacks: TeachingCallbacks, env: Environment) {
  let model = validateTeachingModel(initial);
  let open = false;
  let selectedId: string | null = null;
  let command: TeachingImportCommand | null = null;
  let pending = false;
  let refreshing = false;
  let continuing: TeachingAction | null = null;
  let feedback: TeachingState["feedback"] = null;
  let active = true;
  let epoch = 0;
  let continueTicket = 0;
  let refreshTicket = 0;
  const listeners = new Set<() => void>();
  const notify = () => { if (active) for (const listener of listeners) listener(); };
  const nativeReady = () => active && !!model.ownerId && model.available && !model.busy;
  const passive = () => active && !command;
  const selected = () => model.examples.find(item => item.id === selectedId);
  const lockChanged = () => {
    try { callbacks.onLockChange?.(!!command); } catch { /* A host control refresh cannot lose a retained request. */ }
  };
  function release() {
    command = null; pending = false;
    notify(); lockChanged();
  }

  async function runImport(op: TeachingImportCommand) {
    if (!active || command !== op || !pending) return false;
    const originEpoch = epoch;
    try {
      const result = await callbacks.onImport(op);
      if (!result || !["imported", "stale"].includes(result.status)
        || typeof result.datasetId !== "string" || !result.datasetId.trim() || result.datasetId.length > 512) {
        throw new Error("Import was not confirmed");
      }
      if (!active || command !== op) return false;
      const current = epoch === originEpoch && model.ownerId === op.ownerId && model.available;
      open = false; selectedId = null;
      feedback = current && result.status === "stale" ? "stale" : null;
      // Both replies confirm that root safely retained a record; neither navigates here.
      release();
      return current && result.status === "imported";
    } catch {
      if (!active || command !== op) return false;
      pending = false;
      feedback = epoch === originEpoch && model.ownerId === op.ownerId ? "failed" : "uncertain";
      notify();
      return false;
    }
  }

  return {
    get state(): TeachingState {
      return { model, open, selectedId, command, pending, detached: !!command && command.ownerId !== model.ownerId,
        refreshing, continuing, feedback };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next: TeachingModel) {
      if (!active) return false;
      let validated: TeachingModel;
      try { validated = validateTeachingModel(next); } catch { return false; }
      const changed = validated.ownerId !== model.ownerId || validated.available !== model.available;
      model = validated;
      if (changed) {
        epoch += 1; continueTicket += 1; refreshTicket += 1;
        continuing = null; refreshing = false; feedback = command ? "uncertain" : null;
        open = !!command; selectedId = command?.ownerId === model.ownerId ? command.exampleId : null;
      }
      if (!command && selectedId && !selected()) selectedId = null;
      notify(); return true;
    },
    open() {
      if (!active) return false;
      open = true;
      if (!command) { selectedId = null; feedback = null; }
      notify(); return true;
    },
    select(id: string) {
      if (!passive() || !open || !model.examples.some(item => item.id === id)) return false;
      selectedId = id; feedback = null; notify(); return true;
    },
    back() {
      if (!passive()) return false;
      selectedId = null; feedback = null; notify(); return true;
    },
    close() {
      if (!passive()) return false;
      open = false; selectedId = null; feedback = null; notify(); return true;
    },
    importSelected() {
      if (!nativeReady() || !open || command || continuing || refreshing || selected()?.availability !== "ready") return Promise.resolve(false);
      try {
        const requestId = env.uuid();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("UUID unavailable");
        command = Object.freeze({ ownerId: model.ownerId!, exampleId: selectedId!, requestId });
      } catch { feedback = "invalid"; notify(); return Promise.resolve(false); }
      const op = command;
      pending = true; feedback = null; notify(); lockChanged();
      return runImport(op);
    },
    retry() {
      const op = command;
      if (!nativeReady() || !op || pending || model.ownerId !== op.ownerId
        || model.examples.find(item => item.id === op.exampleId)?.availability !== "ready") return Promise.resolve(false);
      pending = true; feedback = null; notify();
      return runImport(op);
    },
    discardRequest() {
      if (!active || !command || pending) return false;
      const op = command;
      let confirmed = false;
      try { confirmed = env.confirm(teachingCopy[model.language].discardConfirm); } catch { return false; }
      if (!confirmed || !active || command !== op || pending) return false;
      open = false; selectedId = null; feedback = null; release(); return true;
    },
    async refresh() {
      if (!nativeReady() || command || refreshing || continuing) return false;
      const ticket = ++refreshTicket, originEpoch = epoch;
      refreshing = true; feedback = null; notify();
      try { await callbacks.onRefresh(); return active && originEpoch === epoch && ticket === refreshTicket; }
      catch {
        if (active && originEpoch === epoch && ticket === refreshTicket) feedback = "refreshFailed";
        return false;
      } finally {
        if (active && originEpoch === epoch && ticket === refreshTicket) { refreshing = false; notify(); }
      }
    },
    async continueTo(action: TeachingAction) {
      if (!nativeReady() || command || continuing || refreshing || !progressAllows(model, action)) return false;
      const ticket = ++continueTicket, originEpoch = epoch;
      continuing = action; feedback = null; notify();
      try {
        const accepted = await callbacks.onContinue(action);
        if (!active || originEpoch !== epoch || ticket !== continueTicket) return false;
        if (accepted !== true) feedback = "continueFailed";
        return accepted === true;
      } catch {
        if (active && originEpoch === epoch && ticket === continueTicket) feedback = "continueFailed";
        return false;
      } finally {
        if (active && originEpoch === epoch && ticket === continueTicket) { continuing = null; notify(); }
      }
    },
    hasUnsavedWork() { return !!command; },
    prepareNavigation() {
      if (command) return false;
      if (active) { open = false; selectedId = null; feedback = null; notify(); }
      return true;
    },
    destroy() {
      if (!active) return;
      active = false; epoch += 1; continueTicket += 1; refreshTicket += 1;
      open = false; selectedId = null; continuing = null; refreshing = false; feedback = null;
      const locked = !!command;
      command = null; pending = false; listeners.clear();
      if (locked) lockChanged();
    }
  };
}

export type TeachingDataController = ReturnType<typeof createTeachingDataController>;
