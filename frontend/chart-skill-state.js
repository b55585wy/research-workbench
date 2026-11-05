function helper() { return globalThis.window?.ResearchChartStyles; }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function frozenChartSkill(value) {
  if (value == null) return null;
  if (!helper()?.validSkillSnapshot(value)) throw new Error("chart_skill_invalid");
  return freeze(JSON.parse(JSON.stringify(value)));
}

export function chartSkillReference(draft) {
  const value = draft.skillSnapshot;
  if (!value) return undefined;
  if (!helper()?.validSkillSnapshot(value)) throw new Error("chart_skill_invalid");
  if (value.spec.chart.kind !== draft.kind || value.spec.chart.bins !== (draft.kind === "histogram" ? draft.bins : null)) throw new Error("chart_skill_changed");
  return { id: value.id, revision: value.revision, sha256: value.sha256 };
}

export function chartSkillsMatch(artifact, record) {
  const left = artifact?.skill_snapshot, right = record?.skill_snapshot;
  if (left == null && right == null) return true;
  if (!helper()?.validSkillSnapshot(left) || !helper()?.validSkillSnapshot(right)) return false;
  return left.spec.chart.kind === artifact.kind && left.spec.chart.bins === artifact.spec?.bins &&
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function chartSkillAllows(snapshot, format) {
  return snapshot == null || Boolean(helper()?.validSkillSnapshot(snapshot) && snapshot.spec.exports.includes(format));
}

export function visibleChartSkill(draft, artifact) {
  return artifact ? artifact.skill_snapshot || null : draft?.skillSnapshot || null;
}

export function chartSkillImageOptions(snapshot, format) {
  if (!chartSkillAllows(snapshot, format)) throw new Error("chart_skill_export_unavailable");
  return snapshot ? { width: snapshot.spec.style.width, height: snapshot.spec.style.height, scale: 1 } : { scale: 2 };
}
