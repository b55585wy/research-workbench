export type ChartSkillKind = "analysis_counts" | "histogram" | "scatter" | "grouped_points";
export type ChartSkillExport = "png" | "svg" | "offline";

export interface SkillSpec {
  format: "research-chart-skill/v1";
  name: string;
  description: string;
  chart: { kind: ChartSkillKind; bins: number | null };
  style: {
    palette: string[];
    font_family: "Arial, sans-serif" | "Georgia, serif" | "monospace";
    font_size: number;
    line_width: number;
    marker_size: number;
    width: number;
    height: number;
  };
  exports: ChartSkillExport[];
}

export interface SkillSnapshot {
  id: string;
  revision: number;
  sha256: string;
  spec: SkillSpec;
}

export interface SkillRecord extends SkillSnapshot {
  created_at: string;
  updated_at: string;
}

export interface ChartSkillsModel {
  language: "zh" | "en";
  ownerId: string | null;
  available: boolean;
  busy: boolean;
  selected: SkillSnapshot | null;
}

export interface ChartSkillsCallbacks {
  api: (url: string, options?: RequestInit) => Promise<any>;
  onSelect: (snapshot: SkillSnapshot | null) => void;
}

export interface ChartSkillsHandle {
  update: (model: ChartSkillsModel) => boolean;
  destroy: () => void;
  hasUnsavedWork: () => boolean;
  prepareNavigation: () => boolean;
}

export interface MountChartSkillsOptions {
  container: HTMLElement;
  model: ChartSkillsModel;
  callbacks: ChartSkillsCallbacks;
  onMounted?: () => void;
}
