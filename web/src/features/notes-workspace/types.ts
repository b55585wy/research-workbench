export type NotesWorkspaceSection = "saved" | "editor" | "images";

export interface NotesWorkspaceModel {
  language: "zh" | "en";
  ownerId: string | null;
  noteCount: number;
  /** True only for a dirty or resumed draft, never a pristine source selection. */
  hasDraft: boolean;
  editing: boolean;
  busy: boolean;
}

export interface NotesWorkspaceHosts {
  editor: HTMLElement;
  saved: HTMLElement;
  images: HTMLElement;
}

export interface NotesWorkspaceCallbacks {
  /** Reveal the current editor; must not reset or create a note. */
  onOpenEditor?: () => void;
}

export interface MountNotesWorkspaceOptions {
  container: HTMLElement;
  hosts: NotesWorkspaceHosts;
  model: NotesWorkspaceModel;
  callbacks?: NotesWorkspaceCallbacks;
  onMounted?: () => void;
}

export interface NotesWorkspaceHandle {
  update: (model: NotesWorkspaceModel) => boolean;
  show: (section: NotesWorkspaceSection) => boolean;
  destroy: () => void;
}
