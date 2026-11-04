export type FlowReadingWidth = "narrow" | "normal" | "wide";

export interface FlowReadingPreferences {
  fontSize: number;
  lineHeight: number;
  width: FlowReadingWidth;
}

export const defaultFlowReadingPreferences: FlowReadingPreferences = {
  fontSize: 17,
  lineHeight: 1.85,
  width: "normal"
};

export const flowReadingWidths: Record<FlowReadingWidth, string> = {
  narrow: "640px",
  normal: "760px",
  wide: "100%"
};

const storageKey = "research-workbench.flow-reading.preferences.v1";
const widths = new Set<FlowReadingWidth>(["narrow", "normal", "wide"]);

function validFontSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 14 && value <= 28;
}

function validLineHeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1.4 && value <= 2.4;
}

function validWidth(value: unknown): value is FlowReadingWidth {
  return typeof value === "string" && widths.has(value as FlowReadingWidth);
}

export function readFlowReadingPreferences(): FlowReadingPreferences {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return { ...defaultFlowReadingPreferences };
    const value = JSON.parse(stored) as Partial<FlowReadingPreferences> & { version?: unknown };
    if (!value || typeof value !== "object" || value.version !== 1) return { ...defaultFlowReadingPreferences };
    return {
      fontSize: validFontSize(value.fontSize) ? value.fontSize : defaultFlowReadingPreferences.fontSize,
      lineHeight: validLineHeight(value.lineHeight) ? value.lineHeight : defaultFlowReadingPreferences.lineHeight,
      width: validWidth(value.width) ? value.width : defaultFlowReadingPreferences.width
    };
  } catch {
    return { ...defaultFlowReadingPreferences };
  }
}

export function writeFlowReadingPreferences(preferences: FlowReadingPreferences) {
  try {
    const value = {
      version: 1,
      fontSize: validFontSize(preferences.fontSize) ? preferences.fontSize : defaultFlowReadingPreferences.fontSize,
      lineHeight: validLineHeight(preferences.lineHeight) ? preferences.lineHeight : defaultFlowReadingPreferences.lineHeight,
      width: validWidth(preferences.width) ? preferences.width : defaultFlowReadingPreferences.width
    };
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
  }
}
