(function () {
  "use strict";

  var ids = ["default", "nature", "cell"];
  var palettes = {
    default: ["#1677B8", "#8DA5B5", "#009E73", "#CC79A7"],
    nature: ["#0072B2", "#D55E00", "#009E73", "#CC79A7"],
    cell: ["#3B5488", "#E69F00", "#00A087", "#CC79A7"]
  };

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object") {
      var copy = {};
      Object.keys(value).forEach(function (key) { copy[key] = clone(value[key]); });
      return copy;
    }
    return value;
  }

  function apply(figure, styleId) {
    var id = ids.includes(styleId) ? styleId : "default";
    var palette = palettes[id];
    var result = {
      traces: clone(Array.isArray(figure?.traces) ? figure.traces : []),
      layout: clone(figure?.layout && typeof figure.layout === "object" ? figure.layout : {})
    };
    result.traces.forEach(function (trace, index) {
      trace.marker = trace.marker && typeof trace.marker === "object" ? trace.marker : {};
      trace.marker.color = palette[index % palette.length];
    });
    result.layout.paper_bgcolor = "#ffffff";
    result.layout.plot_bgcolor = "#ffffff";
    result.layout.font = Object.assign({}, result.layout.font, {
      family: "Arial, sans-serif",
      size: 12,
      color: "#172033"
    });
    ["xaxis", "yaxis"].forEach(function (name) {
      var axis = result.layout[name] && typeof result.layout[name] === "object" ? result.layout[name] : {};
      result.layout[name] = Object.assign(axis, {
        showline: true,
        linewidth: 1,
        linecolor: "#52606D",
        mirror: false,
        showgrid: false,
        zeroline: false,
        ticks: "outside",
        ticklen: 4,
        tickwidth: 1
      });
    });
    return result;
  }

  window.ResearchChartStyles = Object.freeze({
    ids: Object.freeze(ids.slice()),
    palettes: Object.freeze(Object.fromEntries(ids.map(function (id) {
      return [id, Object.freeze(palettes[id].slice())];
    }))),
    apply: apply
  });
}());
