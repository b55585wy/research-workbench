import type { NotesWorkspaceModel, NotesWorkspaceSection } from "./types";

export const sections: readonly NotesWorkspaceSection[] = ["saved", "editor", "images"];

export function isNotesSection(value: unknown): value is NotesWorkspaceSection {
  return sections.includes(value as NotesWorkspaceSection);
}

export function snapshotModel(model: NotesWorkspaceModel): NotesWorkspaceModel {
  if (!model || !["zh", "en"].includes(model.language)
    || (model.ownerId !== null && typeof model.ownerId !== "string")) {
    throw new TypeError("Invalid notes workspace model");
  }
  return {
    language: model.language,
    ownerId: model.ownerId,
    noteCount: Number.isFinite(model.noteCount) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(model.noteCount))) : 0,
    hasDraft: Boolean(model.hasDraft),
    editing: Boolean(model.editing),
    busy: Boolean(model.busy)
  };
}

/** Presentation only: no repository, draft content, or persistence callbacks. */
export function createNotesWorkspaceState(initial: NotesWorkspaceModel) {
  let model = snapshotModel(initial);
  let section: NotesWorkspaceSection = model.hasDraft || model.editing ? "editor" : "saved";
  let revealVersion = 0;
  const remembered = new Map<string | null, NotesWorkspaceSection>();

  return {
    get model() { return { ...model }; },
    get section() { return section; },
    get revealVersion() { return revealVersion; },
    show(next: NotesWorkspaceSection) {
      if (!isNotesSection(next)) return false;
      section = next;
      revealVersion += 1;
      remembered.set(model.ownerId, section);
      return true;
    },
    update(input: NotesWorkspaceModel) {
      const next = snapshotModel(input);
      const ownerChanged = next.ownerId !== model.ownerId;
      const resumed = (next.hasDraft && !model.hasDraft) || (next.editing && !model.editing);
      if (ownerChanged) remembered.set(model.ownerId, section);
      if (ownerChanged) section = remembered.get(next.ownerId) || "saved";
      if ((ownerChanged || resumed) && (next.hasDraft || next.editing)) section = "editor";
      if (ownerChanged || resumed) revealVersion += 1;
      model = next;
    }
  };
}
