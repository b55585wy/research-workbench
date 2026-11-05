import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(new URL("../frontend/chart-styles.js", import.meta.url), "utf8"), context);
vm.runInContext(readFileSync(new URL("../frontend/chart-skill-state.js", import.meta.url), "utf8").replaceAll("export function ", "function "), context);
const snapshot = () => ({ id: "de50bfa0-3b64-4253-86cb-b43ac2d2ecb4", revision: 1, sha256: "a".repeat(64), spec: {
  format: "research-chart-skill/v1", name: "Synthetic", description: "", chart: { kind: "histogram", bins: 2 },
  style: { palette: ["#0072B2", "#D55E00"], font_family: "Arial, sans-serif", font_size: 12, line_width: 1,
    marker_size: 6, width: 900, height: 560 }, exports: ["png", "offline"] } });

test("a selected recipe is copied and deeply frozen before creating the request reference", () => {
  const source = snapshot(), frozen = context.frozenChartSkill(source);
  source.spec.style.font_size = 24;
  assert.equal(frozen.spec.style.font_size, 12);
  assert.ok(Object.isFrozen(frozen.spec.style.palette));
  assert.equal(JSON.stringify(context.chartSkillReference({ skillSnapshot: frozen, kind: "histogram", bins: 2 })),
    JSON.stringify({ id: frozen.id, revision: 1, sha256: frozen.sha256 }));
  assert.equal(context.chartSkillReference({}), undefined);
  assert.throws(() => context.chartSkillReference({ skillSnapshot: frozen, kind: "scatter", bins: 2 }), /chart_skill_changed/);
  assert.throws(() => context.chartSkillReference({ skillSnapshot: frozen, kind: "histogram", bins: 4 }), /chart_skill_changed/);
});

test("records and artifacts must have identical frozen versions and compatible chart fields", () => {
  const record = { skill_snapshot: snapshot() };
  const artifact = { kind: "histogram", spec: { bins: 2 }, skill_snapshot: snapshot() };
  assert.equal(context.chartSkillsMatch(artifact, record), true);
  assert.equal(context.chartSkillsMatch({}, {}), true);
  assert.equal(context.chartSkillsMatch(artifact, {}), false);
  for (const mutate of [v => { v.revision++; }, v => { v.sha256 = "b".repeat(64); }, v => { v.spec.style.palette.reverse(); }]) {
    const changed = structuredClone(artifact); mutate(changed.skill_snapshot);
    assert.equal(context.chartSkillsMatch(changed, record), false);
  }
  artifact.spec.bins = 3;
  assert.equal(context.chartSkillsMatch(artifact, record), false);
});

test("the displayed chart owns its selection and config export even when a newer draft is parked", () => {
  const old = snapshot(), next = snapshot(); next.revision = 2;
  const draft = { skillSnapshot: next };
  assert.equal(context.visibleChartSkill(draft, { skill_snapshot: old }), old);
  assert.equal(context.visibleChartSkill(draft, {}), null);
  assert.equal(context.visibleChartSkill(draft, null), next);
  assert.equal(context.visibleChartSkill(null, null), null);
});

test("only authorized image formats use the frozen export dimensions", () => {
  const value = snapshot();
  assert.equal(context.chartSkillAllows(value, "png"), true);
  assert.equal(context.chartSkillAllows(value, "svg"), false);
  assert.equal(context.chartSkillAllows(value, "offline"), true);
  assert.equal(JSON.stringify(context.chartSkillImageOptions(value, "png")), '{"width":900,"height":560,"scale":1}');
  assert.throws(() => context.chartSkillImageOptions(value, "svg"), /chart_skill_export_unavailable/);
  assert.equal(JSON.stringify(context.chartSkillImageOptions(null, "svg")), '{"scale":2}');
});
