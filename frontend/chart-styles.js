(function () {
  "use strict";

  var ids = ["default", "nature", "cell"];
  var palettes = {
    default: ["#1677B8", "#8DA5B5", "#009E73", "#CC79A7"],
    nature: ["#0072B2", "#D55E00", "#009E73", "#CC79A7"],
    cell: ["#3B5488", "#E69F00", "#00A087", "#CC79A7"]
  };

  function exact(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length &&
      keys.every(function (key) { return Object.hasOwn(value, key); });
  }

  function integer(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  }

  function validSpec(value) {
    if (!exact(value, ["format", "name", "description", "chart", "style", "exports"]) || value.format !== "research-chart-skill/v1") return false;
    if (typeof value.name !== "string" || value.name !== value.name.trim() || Array.from(value.name).length < 1 || Array.from(value.name).length > 60 ||
      typeof value.description !== "string" || Array.from(value.description).length > 500 || /[\u0000-\u001f\u007f-\u009f]/.test(value.name + value.description)) return false;
    if (!exact(value.chart, ["kind", "bins"]) || !["analysis_counts", "histogram", "scatter", "grouped_points"].includes(value.chart.kind)) return false;
    if (value.chart.kind === "histogram" ? !integer(value.chart.bins, 2, 50) : value.chart.bins !== null) return false;
    var style = value.style;
    if (!exact(style, ["palette", "font_family", "font_size", "line_width", "marker_size", "width", "height"])) return false;
    if (!Array.isArray(style.palette) || style.palette.length < 2 || style.palette.length > 8 ||
      !Array.from(style.palette).every(function (color) { return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color); }) ||
      new Set(style.palette.map(function (color) { return color.toLowerCase(); })).size !== style.palette.length) return false;
    if (!["Arial, sans-serif", "Georgia, serif", "monospace"].includes(style.font_family) || !integer(style.font_size, 8, 24) ||
      typeof style.line_width !== "number" || !Number.isFinite(style.line_width) || style.line_width < 0.5 || style.line_width > 4 ||
      !integer(style.marker_size, 2, 16) || !integer(style.width, 480, 2400) || !integer(style.height, 320, 1600)) return false;
    return Array.isArray(value.exports) && value.exports.length > 0 && value.exports.length <= 3 &&
      new Set(value.exports).size === value.exports.length && Array.from(value.exports).every(function (format) { return ["png", "svg", "offline"].includes(format); });
  }

  function validSnapshot(value) {
    return exact(value, ["id", "revision", "sha256", "spec"]) && typeof value.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) &&
      integer(value.revision, 1, Number.MAX_SAFE_INTEGER) && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) && validSpec(value.spec);
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object") {
      var copy = {};
      Object.keys(value).forEach(function (key) { copy[key] = clone(value[key]); });
      return copy;
    }
    return value;
  }

  function apply(figure, styleId, availableWidth) {
    var custom = styleId && typeof styleId === "object";
    if (custom && !validSnapshot(styleId)) throw new TypeError("chart_skill_invalid");
    var id = ids.includes(styleId) ? styleId : "default";
    var style = custom ? styleId.spec.style : null;
    var palette = style ? style.palette : palettes[id];
    var result = {
      traces: clone(Array.isArray(figure?.traces) ? figure.traces : []),
      layout: clone(figure?.layout && typeof figure.layout === "object" ? figure.layout : {})
    };
    result.traces.forEach(function (trace, index) {
      trace.marker = trace.marker && typeof trace.marker === "object" ? trace.marker : {};
      trace.marker.color = palette[index % palette.length];
      if (!style) return;
      trace.marker.line = Object.assign({}, trace.marker.line, { width: style.line_width, color: palette[index % palette.length] });
      if (trace.type !== "scatter") return;
      trace.marker.size = style.marker_size;
      if (result.layout.xaxis?.type !== "category" || !Array.isArray(trace.x)) return;
      var groups = Array.from(new Set(trace.x));
      trace.marker.color = trace.x.map(function (group) { return palette[groups.indexOf(group) % palette.length]; });
      trace.marker.line.color = trace.marker.color.slice();
    });
    result.layout.paper_bgcolor = "#ffffff";
    result.layout.plot_bgcolor = "#ffffff";
    result.layout.font = Object.assign({}, result.layout.font, {
      family: style ? style.font_family : "Arial, sans-serif",
      size: style ? style.font_size : 12,
      color: "#172033"
    });
    ["xaxis", "yaxis"].forEach(function (name) {
      var axis = result.layout[name] && typeof result.layout[name] === "object" ? result.layout[name] : {};
      result.layout[name] = Object.assign(axis, {
        showline: true,
        linewidth: style ? style.line_width : 1,
        linecolor: "#52606D",
        mirror: false,
        showgrid: false,
        zeroline: false,
        ticks: "outside",
        ticklen: 4,
        tickwidth: style ? style.line_width : 1
      });
    });
    if (style) {
      var width = Number.isFinite(availableWidth) && availableWidth > 0 ? Math.min(style.width, availableWidth) : style.width;
      result.layout.width = width;
      result.layout.height = Math.round(style.height * width / style.width);
      result.layout.autosize = false;
    }
    return result;
  }

  window.ResearchChartStyles = Object.freeze({
    ids: Object.freeze(ids.slice()),
    palettes: Object.freeze(Object.fromEntries(ids.map(function (id) {
      return [id, Object.freeze(palettes[id].slice())];
    }))),
    apply: apply,
    validSkillSpec: validSpec,
    validSkillSnapshot: validSnapshot
  });
}());
