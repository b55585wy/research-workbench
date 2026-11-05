import type { LocalizedText, TeachingExample, TeachingField, TeachingModel, TeachingProgress } from "./types";

function invalid(): never { throw new Error("Invalid teaching data model"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return invalid();
  return value;
}
function localized(value: unknown, max = 1000): LocalizedText {
  const item = object(value);
  return { zh: text(item.zh, max), en: text(item.en, max) };
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) return invalid();
  return value as number;
}
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function optionalId(value: unknown): string | null { return value === null ? null : text(value, 512); }

function example(value: unknown): TeachingExample {
  const item = object(value);
  const rowCount = integer(item.rowCount, 1, 50);
  if (!Array.isArray(item.fields) || item.fields.length < 1 || item.fields.length > 8) return invalid();
  const fields = Array.from(item.fields, (value): TeachingField => {
    const field = object(value);
    return { name: text(field.name, 128), label: localized(field.label, 160), meaning: localized(field.meaning),
      unit: field.unit === null ? null : localized(field.unit, 80), numeric: boolean(field.numeric),
      missing: integer(field.missing, 0, rowCount) };
  });
  if (new Set(fields.map(field => field.name)).size !== fields.length || !Array.isArray(item.previewRows)
    || item.previewRows.length > Math.min(5, rowCount)) return invalid();
  const previewRows = Array.from(item.previewRows, (row): string[] => {
    if (!Array.isArray(row) || row.length !== fields.length) return invalid();
    return Array.from(row, cell => text(cell, 500, true));
  });
  if (!["ready", "loading", "unavailable"].includes(item.availability as string)) return invalid();
  return { id: text(item.id, 128), title: localized(item.title, 160), question: localized(item.question),
    design: localized(item.design), rowMeaning: localized(item.rowMeaning), rowCount, fields, previewRows,
    availability: item.availability as TeachingExample["availability"] };
}

function progress(value: unknown): TeachingProgress | null {
  if (value === null) return null;
  const item = object(value);
  if (!["imported", "analyzed", "charted"].includes(item.stage as string)) return invalid();
  return { exampleId: text(item.exampleId, 128), datasetId: text(item.datasetId, 512),
    stage: item.stage as TeachingProgress["stage"], analysisId: optionalId(item.analysisId), chartId: optionalId(item.chartId) };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Isolate root-owned snapshots; rejected updates leave the last valid model intact. */
export function validateTeachingModel(value: unknown): TeachingModel {
  const item = object(value);
  if (!["zh", "en"].includes(item.language as string) || !Array.isArray(item.examples) || item.examples.length > 16) return invalid();
  const examples = Array.from(item.examples, example);
  if (new Set(examples.map(entry => entry.id)).size !== examples.length) return invalid();
  return freeze({ language: item.language as TeachingModel["language"], ownerId: optionalId(item.ownerId),
    available: boolean(item.available), busy: boolean(item.busy), examples, progress: progress(item.progress) });
}
