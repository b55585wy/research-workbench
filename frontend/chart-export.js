(function () {
  "use strict";

  function escaped(value) {
    return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function integer(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function strings(value) {
    return Array.isArray(value) && value.every(function (item) { return typeof item === "string"; });
  }

  function valid(artifact) {
    if (!artifact || artifact.format !== "research-chart/v1" || !artifact.spec || !artifact.series || !artifact.summary) return false;
    if (!integer(artifact.summary.row_count) || !integer(artifact.summary.used_rows) || !integer(artifact.summary.excluded_rows)) return false;
    var series = artifact.series;
    if (artifact.kind === "analysis_counts") {
      return strings(series.columns) && series.columns.length > 0 && series.columns.length <= 50 &&
        Array.isArray(series.valid) && Array.isArray(series.missing) && series.valid.length === series.columns.length &&
        series.missing.length === series.columns.length && series.valid.concat(series.missing).every(integer);
    }
    if (artifact.kind === "histogram") {
      return strings(series.labels) && strings(series.lower) && strings(series.upper) && Array.isArray(series.counts) &&
        series.labels.length > 0 && series.labels.length <= 50 && series.lower.length === series.labels.length &&
        series.upper.length === series.labels.length && series.counts.length === series.labels.length && series.counts.every(integer);
    }
    if (artifact.kind === "scatter") {
      return Array.isArray(series.x) && Array.isArray(series.y) && Array.isArray(series.rows) && series.x.length > 0 &&
        series.x.length <= 50000 && series.y.length === series.x.length && series.rows.length === series.x.length &&
        series.x.every(Number.isFinite) && series.y.every(Number.isFinite) && series.rows.every(function (row) { return integer(row) && row >= 1; });
    }
    return false;
  }

  function figure(artifact) {
    var series = artifact.series;
    var spec = artifact.spec;
    var layout = {
      title: { text: escaped(artifact.title) },
      autosize: true,
      margin: { l: 64, r: 24, t: 64, b: 80 },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      font: { color: "#172033" },
      showlegend: artifact.kind === "analysis_counts",
      legend: { orientation: "h" },
      hovermode: "closest"
    };
    if (artifact.kind === "analysis_counts") {
      return {
        traces: [
          { type: "bar", name: "Valid", x: series.columns.map(escaped), y: series.valid, marker: { color: "#1677b8" } },
          { type: "bar", name: "Missing", x: series.columns.map(escaped), y: series.missing, marker: { color: "#d97706" } }
        ],
        layout: Object.assign(layout, { barmode: "group", xaxis: { automargin: true }, yaxis: { title: { text: "Rows" }, rangemode: "tozero" } })
      };
    }
    if (artifact.kind === "histogram") {
      return {
        traces: [{ type: "bar", x: series.labels.map(escaped), y: series.counts, marker: { color: "#1677b8" }, hoverinfo: "x+y" }],
        layout: Object.assign(layout, { bargap: 0, xaxis: { title: { text: escaped(spec.x) }, automargin: true }, yaxis: { title: { text: "Rows" }, rangemode: "tozero" } })
      };
    }
    return {
      traces: [{
        type: "scatter",
        mode: "markers",
        x: series.x,
        y: series.y,
        text: series.rows.map(function (row) { return "Row " + row; }),
        marker: { color: "#1677b8", size: 7, opacity: 0.72 },
        hovertemplate: "%{x}, %{y}<br>%{text}<extra></extra>"
      }],
      layout: Object.assign(layout, { xaxis: { title: { text: escaped(spec.x) }, automargin: true }, yaxis: { title: { text: escaped(spec.y) }, automargin: true } })
    };
  }

  function start() {
    var dataNode = document.getElementById("chart-data");
    var plot = document.getElementById("chart-plot");
    var status = document.getElementById("chart-status");
    if (!dataNode || !plot) return;
    function fail(message) {
      if (status) status.textContent = message;
    }
    var artifact;
    try {
      artifact = JSON.parse(dataNode.textContent);
    } catch (error) {
      fail("Chart data is invalid. The static table remains available.");
      return;
    }
    if (!valid(artifact) || !window.Plotly) {
      fail("The interactive chart is unavailable. The static table remains available.");
      return;
    }
    var built = figure(artifact);
    window.Plotly.react(plot, built.traces, built.layout, {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      showTips: false,
      toImageButtonOptions: { format: "png", filename: "research-chart", scale: 2 }
    }).catch(function () {
      fail("The interactive chart could not be drawn. The static table remains available.");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}());
