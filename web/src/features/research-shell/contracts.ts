export type ResearchArea = "reading" | "analysis" | "charts" | "presentations";

export interface ResearchShellModel {
  language: "zh" | "en";
  area: ResearchArea;
  pending: boolean;
  libraryVisible: boolean;
  notesVisible: boolean;
  ownerTitle?: string;
  availableAreas?: readonly ResearchArea[];
}

export interface ResearchShellCallbacks {
  onNavigate(area: ResearchArea): void | Promise<void>;
  onLibrary(): void;
  onNotes(): void;
  onAssistant(): void;
}

export interface MountResearchShellOptions {
  container: HTMLElement;
  model: ResearchShellModel;
  callbacks: ResearchShellCallbacks;
  onMounted?(): void;
}

export interface ResearchShellHandle {
  update(model: ResearchShellModel): boolean;
  destroy(): void;
}
