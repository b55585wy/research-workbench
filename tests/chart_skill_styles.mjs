import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(new URL("../frontend/chart-styles.js", import.meta.url), "utf8"), context);
const styles = context.window.ResearchChartStyles;
const spec = () => ({ format: "research-chart-skill/v1", name: "教学配色", description: "Synthetic data only",
  chart: { kind: "histogram", bins: 20 }, style: { palette: ["#0072B2", "#D55E00"], font_family: "Georgia, serif",
    font_size: 14, line_width: 2, marker_size: 10, width: 1200, height: 800 }, exports: ["png", "svg", "offline"] });
const snapshot = () => ({ id: "de50bfa0-3b64-4253-86cb-b43ac2d2ecb4", revision: 1, sha256: "a".repeat(64), spec: spec() });
const figure = () => ({ traces: [{ type: "bar", x: ["A", "B"], y: [3, 7] }], layout: { title: "Synthetic", xaxis: {}, yaxis: {} } });

test("custom recipe changes only visual fields and never mutates source or snapshot", () => {
  const input = figure(), rule = snapshot(), before = JSON.stringify({ input, rule });
  const output = styles.apply(input, rule);
  assert.equal(JSON.stringify({ input, rule }), before);
  assert.equal(JSON.stringify(output.traces[0].y), "[3,7]");
  assert.equal(JSON.stringify(output.traces[0].x), '["A","B"]');
  assert.equal(output.traces[0].marker.color, "#0072B2");
  assert.equal(output.traces[0].marker.line.width, 2);
  assert.equal(output.layout.font.family, "Georgia, serif");
  assert.equal(output.layout.font.size, 14);
  assert.equal(output.layout.xaxis.linewidth, 2);
  assert.equal(output.layout.width, 1200);
  assert.equal(output.layout.height, 800);
  const narrow = styles.apply(input, rule, 360);
  assert.equal(narrow.layout.width, 360);
  assert.equal(narrow.layout.height, 240);
  assert.equal(narrow.layout.font.size, output.layout.font.size);
});

test("grouped observations use stable per-group colors while retaining every observation", () => {
  const rule = snapshot(); rule.spec.chart = { kind: "grouped_points", bins: null };
  const input = { traces: [{ type: "scatter", x: ["A", "B", "A"], y: [1, 2, 3] }], layout: { xaxis: { type: "category" } } };
  const output = styles.apply(input, rule);
  assert.equal(JSON.stringify(output.traces[0].marker.color), '["#0072B2","#D55E00","#0072B2"]');
  assert.equal(output.traces[0].marker.size, 10);
  assert.equal(JSON.stringify(output.traces[0].y), "[1,2,3]");
});

test("legacy presets and unknown string fallback retain their original behavior", () => {
  assert.equal(styles.apply(figure(), "nature").traces[0].marker.color, "#0072B2");
  assert.equal(styles.apply(figure(), "cell").traces[0].marker.color, "#3B5488");
  assert.equal(styles.apply(figure(), "unknown").traces[0].marker.color, "#1677B8");
  assert.equal(styles.apply(figure(), "default").layout.width, undefined);
});

test("unsupported, malformed, nonfinite and out-of-bound recipes never silently fall back", () => {
  const changes = [v => { v.extra = true; }, v => { v.spec.style.font_size = true; },
    v => { v.spec.style.line_width = Infinity; }, v => { v.spec.style.palette = ["red", "blue"]; },
    v => { v.spec.style.palette = ["#aabbcc", "#AABBCC"]; }, v => { v.spec.chart.bins = 51; },
    v => { v.spec.chart.kind = "scatter"; }, v => { v.spec.exports = []; }, v => { v.revision = 0; },
    v => { v.spec.name = " x "; }, v => { v.spec.description = "x\ncommand"; },
    v => { v.spec.style.width = 2401; }, v => { v.spec.style.font_family = "url(remote)"; },
    v => { v.spec.exports = Array(1); }, v => { v.spec.style.palette = ["#0072B2", ,]; }];
  for (const change of changes) {
    const value = snapshot(); change(value);
    assert.equal(styles.validSkillSnapshot(value), false);
    assert.throws(() => styles.apply(figure(), value), /chart_skill_invalid/);
  }
  for (const [key, low, high] of [["font_size", 8, 24], ["marker_size", 2, 16], ["width", 480, 2400], ["height", 320, 1600], ["line_width", .5, 4]]) {
    for (const bound of [low, high]) { const value = snapshot(); value.spec.style[key] = bound; assert.equal(styles.validSkillSnapshot(value), true); }
  }
});
