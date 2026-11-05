import type { ChartSkillsModel, SkillRecord, SkillSnapshot, SkillSpec } from "./types";

export const SKILL_BYTES = 16 * 1024;
export const SKILL_KINDS = ["analysis_counts", "histogram", "scatter", "grouped_points"] as const;
export const SKILL_FONTS = ["Arial, sans-serif", "Georgia, serif", "monospace"] as const;
export const SKILL_EXPORTS = ["png", "svg", "offline"] as const;
const controls = /[\u0000-\u001f\u007f-\u009f]/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SkillValidationError extends Error {
  field: string;
  constructor(field: string) {
    super(`Invalid figure skill: ${field}`);
    this.field = field;
  }
}

function invalid(field: string): never { throw new SkillValidationError(field); }

function object(value: unknown, keys: string[], field: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field);
  const own = Object.keys(value);
  if (own.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return invalid(field);
  return value as Record<string, any>;
}

function numeric(value: unknown, min: number, max: number, integer: boolean, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max
    || (integer && !Number.isInteger(value))) return invalid(field);
  return value;
}

function boundedText(value: unknown, min: number, max: number, field: string, trim = false): string {
  if (typeof value !== "string" || controls.test(value)) return invalid(field);
  const result = trim ? value.trim() : value;
  const length = Array.from(result).length;
  if (length < min || length > max) return invalid(field);
  return result;
}

/** Returns an isolated validated copy; array order and palette spelling are retained. */
export function validateSkillSpec(value: unknown): SkillSpec {
  const spec = object(value, ["format", "name", "description", "chart", "style", "exports"], "spec");
  if (spec.format !== "research-chart-skill/v1") return invalid("format");
  const chart = object(spec.chart, ["kind", "bins"], "chart");
  if (!SKILL_KINDS.includes(chart.kind)) return invalid("chart.kind");
  const bins = chart.kind === "histogram" ? numeric(chart.bins, 2, 50, true, "chart.bins") : null;
  if (chart.kind !== "histogram" && chart.bins !== null) return invalid("chart.bins");
  const style = object(spec.style,
    ["palette", "font_family", "font_size", "line_width", "marker_size", "width", "height"], "style");
  if (!Array.isArray(style.palette) || style.palette.length < 2 || style.palette.length > 8
    || Array.from(style.palette).some((color: unknown) => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
    || new Set(style.palette.map((color: string) => color.toLowerCase())).size !== style.palette.length) return invalid("style.palette");
  if (!SKILL_FONTS.includes(style.font_family)) return invalid("style.font_family");
  if (!Array.isArray(spec.exports) || spec.exports.length < 1 || spec.exports.length > 3
    || Array.from(spec.exports).some((format: any) => !SKILL_EXPORTS.includes(format))
    || new Set(spec.exports).size !== spec.exports.length) return invalid("exports");
  const result: SkillSpec = {
    format: spec.format,
    name: boundedText(spec.name, 1, 60, "name", true),
    description: boundedText(spec.description, 0, 500, "description"),
    chart: { kind: chart.kind, bins },
    style: {
      palette: [...style.palette], font_family: style.font_family,
      font_size: numeric(style.font_size, 8, 24, true, "style.font_size"),
      line_width: numeric(style.line_width, 0.5, 4, false, "style.line_width"),
      marker_size: numeric(style.marker_size, 2, 16, true, "style.marker_size"),
      width: numeric(style.width, 480, 2400, true, "style.width"),
      height: numeric(style.height, 320, 1600, true, "style.height")
    },
    exports: [...spec.exports]
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > SKILL_BYTES) return invalid("size");
  return result;
}

export function parseSkillImport(text: string): SkillSpec {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > SKILL_BYTES) return invalid("size");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return invalid("json"); }
  return validateSkillSpec(value);
}

export function validateSkillSnapshot(value: unknown): SkillSnapshot {
  const snapshot = object(value, ["id", "revision", "sha256", "spec"], "snapshot");
  if (typeof snapshot.id !== "string" || !uuid.test(snapshot.id)) return invalid("id");
  if (typeof snapshot.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(snapshot.sha256)) return invalid("sha256");
  return {
    id: snapshot.id, revision: numeric(snapshot.revision, 1, Number.MAX_SAFE_INTEGER, true, "revision"),
    sha256: snapshot.sha256, spec: validateSkillSpec(snapshot.spec)
  };
}

export function validateSkillRecord(value: unknown): SkillRecord {
  const record = object(value, ["id", "revision", "sha256", "spec", "created_at", "updated_at"], "record");
  for (const key of ["created_at", "updated_at"]) {
    if (typeof record[key] !== "string" || !/^\d{4}-\d\d-\d\dT/.test(record[key])
      || !Number.isFinite(Date.parse(record[key]))) return invalid(key);
  }
  return { ...validateSkillSnapshot({ id: record.id, revision: record.revision, sha256: record.sha256, spec: record.spec }),
    created_at: record.created_at, updated_at: record.updated_at };
}

export function validateChartSkillsModel(value: ChartSkillsModel): ChartSkillsModel {
  if (!value || !["zh", "en"].includes(value.language) || (value.ownerId !== null && typeof value.ownerId !== "string")
    || typeof value.available !== "boolean" || typeof value.busy !== "boolean") return invalid("model");
  return { language: value.language, ownerId: value.ownerId, available: value.available, busy: value.busy,
    selected: value.selected === null ? null : validateSkillSnapshot(value.selected) };
}

export function defaultSkillSpec(): SkillSpec {
  return {
    format: "research-chart-skill/v1", name: "", description: "", chart: { kind: "histogram", bins: 20 },
    style: { palette: ["#1677B8", "#8DA5B5", "#009E73", "#CC79A7"], font_family: "Arial, sans-serif",
      font_size: 12, line_width: 1, marker_size: 6, width: 900, height: 560 },
    exports: ["png", "svg", "offline"]
  };
}
