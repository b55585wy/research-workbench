const assert = require("node:assert/strict");
const test = require("node:test");
const { modules, spec, record, snapshot } = require("./chart-skills-fixture.cjs");
let validateSkillSpec, parseSkillImport, validateSkillSnapshot, validateSkillRecord;
test.before(async () => ({ validateSkillSpec, parseSkillImport, validateSkillSnapshot, validateSkillRecord } = await modules));

test("valid imports preserve array order, palette spelling, unicode and isolated spec-only output", () => {
  const input = spec(); input.name = "  研究 🧪  "; input.description = "";
  input.exports = ["offline", "svg", "png"]; input.style.palette = ["#d55e00", "#0072b2"];
  const parsed = parseSkillImport(JSON.stringify(input));
  assert.equal(parsed.name, "研究 🧪");
  assert.deepEqual(parsed.exports, input.exports); assert.deepEqual(parsed.style.palette, input.style.palette);
  parsed.style.palette.push("#FFFFFF"); assert.equal(input.style.palette.length, 2);
  for (const kind of ["analysis_counts", "scatter", "grouped_points"]) {
    const value = spec(); value.chart = { kind, bins: null }; assert.equal(validateSkillSpec(value).chart.bins, null);
  }
  assert.deepEqual(validateSkillSnapshot(snapshot()), snapshot()); assert.deepEqual(validateSkillRecord(record()), record());
});

test("all numeric boundary values and unicode codepoint lengths", () => {
  for (const [field, min, max] of [["font_size", 8, 24], ["line_width", .5, 4], ["marker_size", 2, 16], ["width", 480, 2400], ["height", 320, 1600]]) {
    for (const value of [min, max]) { const input = spec(); input.style[field] = value; assert.equal(validateSkillSpec(input).style[field], value); }
  }
  for (const bins of [2, 50]) { const input = spec(); input.chart.bins = bins; assert.equal(validateSkillSpec(input).chart.bins, bins); }
  const input = spec(); input.name = "🧪".repeat(60); input.description = "🧪".repeat(500); validateSkillSpec(input);
  input.name += "🧪"; assert.throws(() => validateSkillSpec(input));
  input.name = "valid"; input.description += "🧪"; assert.throws(() => validateSkillSpec(input));
  for (const palette of [["#000000", "#FFFFFF"], Array.from({ length: 8 }, (_, i) => `#00000${i}`)]) {
    input.description = ""; input.style.palette = palette; validateSkillSpec(input);
  }
});

test("unknown/missing keys, wrong shapes, controls, executable references and invalid rules are rejected", async (t) => {
  const cases = [
    ["extra root", v => { v.run = "anything"; }], ["missing root", v => { delete v.name; }],
    ["extra chart", v => { v.chart.x = "source"; }], ["extra style", v => { v.style.script = "alert(1)"; }],
    ["chart array", v => { v.chart = []; }], ["style array", v => { v.style = []; }],
    ["wrong format", v => { v.format = "Research-chart-skill/v1"; }], ["unknown kind", v => { v.chart.kind = "line"; }],
    ["non histogram bins", v => { v.chart = { kind: "scatter", bins: 20 }; }], ["missing bins", v => { delete v.chart.bins; }],
    ["empty name", v => { v.name = "   "; }], ["name type", v => { v.name = true; }],
    ["name newline", v => { v.name = "figure\n"; }], ["name nul", v => { v.name = "fig\0ure"; }],
    ["description DEL", v => { v.description = "a\u007fb"; }], ["description C1", v => { v.description = "a\u0085b"; }],
    ["name too long", v => { v.name = "a".repeat(61); }], ["description too long", v => { v.description = "a".repeat(501); }],
    ["remote font", v => { v.style.font_family = "https://example.invalid/font"; }],
    ["palette single", v => { v.style.palette = ["#000000"]; }], ["palette empty", v => { v.style.palette = []; }],
    ["palette large", v => { v.style.palette = Array.from({ length: 9 }, (_, i) => `#00000${i}`); }],
    ["duplicate color", v => { v.style.palette = ["#aAbBcC", "#AABBCC"]; }],
    ["short color", v => { v.style.palette[0] = "#fff"; }], ["css color", v => { v.style.palette[0] = "red"; }],
    ["palette nonarray", v => { v.style.palette = "#FFFFFF"; }], ["palette type", v => { v.style.palette[0] = 0; }],
    ["no exports", v => { v.exports = []; }], ["duplicate export", v => { v.exports = ["png", "png"]; }],
    ["unknown export", v => { v.exports = ["pptx"]; }], ["uppercase export", v => { v.exports = ["SVG"]; }],
    ["exports nonarray", v => { v.exports = "png"; }],
    ["sparse palette", v => { v.style.palette = new Array(2); v.style.palette[1] = "#FFFFFF"; }],
    ["sparse exports", v => { v.exports = new Array(2); v.exports[1] = "png"; }]
  ];
  for (const [name, modify] of cases) await t.test(name, () => { const input = spec(); modify(input); assert.throws(() => validateSkillSpec(input)); });
  for (const input of [null, [], true, "{}", {}, 42]) assert.throws(() => validateSkillSpec(input));
});

test("strict finite numeric types reject booleans, strings, NaN, infinity and out of range/fractional integers", () => {
  for (const [field, min, max] of [["font_size", 8, 24], ["line_width", .5, 4], ["marker_size", 2, 16], ["width", 480, 2400], ["height", 320, 1600]]) {
    const invalid = [true, false, String(min), null, NaN, Infinity, -Infinity, min - .1, max + .1];
    if (field !== "line_width") invalid.push(min + .5);
    for (const value of invalid) { const input = spec(); input.style[field] = value; assert.throws(() => validateSkillSpec(input), `${field}=${value}`); }
  }
  for (const bins of [true, "20", null, 1, 51, 2.5, NaN, Infinity]) {
    const input = spec(); input.chart.bins = bins; assert.throws(() => validateSkillSpec(input));
  }
});

test("imports enforce encoded byte limits before JSON parsing; malformed and hostile shapes fail", () => {
  const text = JSON.stringify(spec());
  parseSkillImport(text + " ".repeat(16384 - Buffer.byteLength(text)));
  assert.throws(() => parseSkillImport(text + " ".repeat(16385 - Buffer.byteLength(text))));
  for (const text of ["", "{", "null", "[]", "true", '{"__proto__":{"run":"x"}}', '"' + "中".repeat(6000) + '"']) {
    assert.throws(() => parseSkillImport(text));
  }
  const value = spec(); value.style.width = 2400;
  assert.throws(() => parseSkillImport(JSON.stringify(value).replace('"width":2400', '"width":1e400')));
});

test("snapshot and response boundaries reject malformed IDs, revisions, hashes and extra metadata", () => {
  for (const [key, value] of [["id", "../escape"], ["revision", true], ["revision", 0], ["revision", 1.5], ["sha256", "A".repeat(64)]]) {
    assert.throws(() => validateSkillSnapshot({ ...snapshot(), [key]: value }));
  }
  assert.throws(() => validateSkillSnapshot(record()));
  assert.throws(() => validateSkillRecord({ ...record(), credentials: "secret" }));
  assert.throws(() => validateSkillRecord({ ...record(), updated_at: "yesterday" }));
});
