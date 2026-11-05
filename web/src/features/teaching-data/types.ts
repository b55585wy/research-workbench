export interface LocalizedText { zh: string; en: string }

export interface TeachingField {
  name: string;
  label: LocalizedText;
  meaning: LocalizedText;
  unit: LocalizedText | null;
  numeric: boolean;
  missing: number;
}

export interface TeachingExample {
  id: string;
  title: LocalizedText;
  question: LocalizedText;
  design: LocalizedText;
  rowMeaning: LocalizedText;
  rowCount: number;
  fields: TeachingField[];
  previewRows: string[][];
  availability: "ready" | "loading" | "unavailable";
}

export interface TeachingProgress {
  exampleId: string;
  datasetId: string;
  stage: "imported" | "analyzed" | "charted";
  analysisId: string | null;
  chartId: string | null;
}

export interface TeachingModel {
  language: "zh" | "en";
  ownerId: string | null;
  available: boolean;
  busy: boolean;
  examples: TeachingExample[];
  progress: TeachingProgress | null;
}

export interface TeachingImportCommand { ownerId: string; exampleId: string; requestId: string }
export type TeachingAction = "analysis" | "charts" | "presentations";

export interface TeachingCallbacks {
  onImport(command: TeachingImportCommand): Promise<{ status: "imported" | "stale"; datasetId: string }>;
  onContinue(action: TeachingAction): boolean | Promise<boolean>;
  onRefresh(): void | Promise<void>;
  onLockChange?(locked: boolean): void;
}

export interface TeachingDataHandle {
  update(model: TeachingModel): boolean;
  destroy(): void;
  hasUnsavedWork(): boolean;
  prepareNavigation(): boolean;
}

export interface MountTeachingDataOptions {
  container: HTMLElement;
  model: TeachingModel;
  callbacks: TeachingCallbacks;
  onMounted?(): void;
}
