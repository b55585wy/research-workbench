import { TEXTBOX_COLORS, TEXTBOX_FONT_FAMILY, drawTextboxCanvas, layoutTextbox } from "/reader-textbox.js";
import { readerEditorPlacement } from "/reader-editor-position.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = { yellow: "#ffe069", green: "#91dab1", blue: "#91c8f6", pink: "#efa9cf" };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function shapePayload(shape) {
  if (shape.kind === "textbox") {
    return {
      kind: shape.kind,
      color: shape.color,
      font_size: shape.font_size,
      points: shape.points.map((point) => [...point])
    };
  }
  return {
    kind: shape.kind,
    color: shape.color,
    line_width: shape.line_width,
    points: shape.points.map((point) => [...point])
  };
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

export function shapeBounds(shape) {
  let xs = shape.points.map((point) => point[0]);
  let ys = shape.points.map((point) => point[1]);
  if (["arrow", "line", "ink"].includes(shape.kind) && Math.min(...xs) === Math.max(...xs)) {
    const value = xs[0];
    xs = [Math.max(0, value - 0.0005), Math.min(1, value + 0.0005)];
  }
  if (["arrow", "line", "ink"].includes(shape.kind) && Math.min(...ys) === Math.max(...ys)) {
    const value = ys[0];
    ys = [Math.max(0, value - 0.0005), Math.min(1, value + 0.0005)];
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function validShape(shape) {
  if (!shape || !["rectangle", "arrow", "textbox", "line", "ellipse", "ink"].includes(shape.kind) || !Array.isArray(shape.points)) return false;
  const ink = shape.kind === "ink";
  if (ink ? shape.points.length < 2 || shape.points.length > 512 : shape.points.length !== 2) return false;
  const textbox = shape.kind === "textbox";
  if (!Object.hasOwn(textbox ? TEXTBOX_COLORS : COLORS, shape.color)) return false;
  if (textbox ? !Number.isInteger(shape.font_size) || shape.font_size < 8 || shape.font_size > 48 : ![1, 2, 3, 4].includes(shape.line_width)) return false;
  if (!shape.points.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1))) return false;
  if (ink) return shape.points.slice(1).some((point) => point[0] !== shape.points[0][0] || point[1] !== shape.points[0][1]);
  const [[x1, y1], [x2, y2]] = shape.points;
  return ["arrow", "line"].includes(shape.kind) ? x1 !== x2 || y1 !== y2 : x1 !== x2 && y1 !== y2;
}

function arrowGeometry(start, end, strokeWidth, unitScale) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const ux = dx / length;
  const uy = dy / length;
  const headLength = Math.min(Math.max(8 * unitScale, 4 * strokeWidth), 0.4 * length);
  const angle = Math.PI / 6;
  const wing = (sign) => {
    const x = -ux * Math.cos(angle) + sign * uy * Math.sin(angle);
    const y = -uy * Math.cos(angle) - sign * ux * Math.sin(angle);
    return [end[0] + x * headLength, end[1] + y * headLength];
  };
  return { headLength, points: [end, wing(1), wing(-1)] };
}

export function createReaderShapes(adapter) {
  let interaction = null;
  let drawKind = null;
  let saving = false;
  let widthMenuOpen = false;
  let editorViewportActive = false;
  let editorFrame = null;
  let clipSequence = 0;
  const layers = new Map();
  const editor = document.getElementById("reader-shape-editor");
  const description = document.getElementById("reader-shape-description");
  const descriptionLabel = document.getElementById("reader-shape-description-label");
  const color = document.getElementById("reader-shape-color");
  const colorPalette = editor.querySelector(".reader-shape-color-palette");
  const width = document.getElementById("reader-shape-width");
  const widthField = document.getElementById("reader-shape-width-field");
  const widthPicker = editor.querySelector(".reader-shape-width-picker");
  const widthToggle = document.getElementById("reader-shape-width-toggle");
  const widthPreview = widthToggle.querySelector("[data-width-preview]");
  const fontSize = document.getElementById("reader-shape-font-size");
  const fontSizeField = document.getElementById("reader-shape-font-size-field");
  const overflow = document.getElementById("reader-shape-overflow");
  const saveButton = document.getElementById("reader-shape-save");
  const cancelButton = document.getElementById("reader-shape-cancel");
  const deleteButton = document.getElementById("reader-shape-delete");
  const noteButton = document.getElementById("reader-shape-note");
  const agentButton = document.getElementById("reader-shape-agent");

  function svgElement(name, attributes = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  function noteFor(noteId) {
    return adapter.getNotes().find((note) => note.id === noteId && !note.deleted_at && !note.purged && note.shape_annotation) || null;
  }

  function currentRecord() {
    return interaction?.record || null;
  }

  function dirty() {
    if (!interaction) return false;
    if (!interaction.noteId) return true;
    return interaction.text !== interaction.original.text || JSON.stringify(interaction.shape) !== JSON.stringify(interaction.original.shape);
  }

  function generationCurrent(target = interaction) {
    return Boolean(target && adapter.generationCurrent(target));
  }

  function updateMode() {
    for (const kind of ["rectangle", "arrow", "textbox", "line", "ellipse", "ink"]) {
      const button = document.getElementById(`reader-shape-${kind}`);
      button.setAttribute("aria-pressed", String(drawKind === kind));
      button.disabled = adapter.isBusy();
    }
    for (const [record, layer] of layers) {
      layer.dataset.drawing = String(Boolean(drawKind && adapter.recordIsCurrent(record)));
      layer.dataset.suspended = String(adapter.isSuspended());
    }
    const widthDisabled = !interaction || Boolean(interaction.drawing) || saving || adapter.isBusy() || Boolean(interaction.operation) || interaction.shape.kind === "textbox";
    widthToggle.disabled = widthDisabled;
    if (widthDisabled) closeWidthMenu();
  }

  function positionEditor() {
    if (!interaction || interaction.drawing || editor.hidden) return;
    const stage = adapter.getStage().getBoundingClientRect();
    const surface = interaction.record.surface.getBoundingClientRect();
    const bounds = shapeBounds(interaction.shape);
    const anchor = { left: surface.left + bounds[0] * surface.width, top: surface.top + bounds[1] * surface.height,
      right: surface.left + bounds[2] * surface.width, bottom: surface.top + bounds[3] * surface.height };
    const visual = window.visualViewport;
    const viewport = { left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0,
      right: (visual?.offsetLeft || 0) + (visual?.width || window.innerWidth), bottom: (visual?.offsetTop || 0) + (visual?.height || window.innerHeight) };
    const measure = () => {
      const size = editor.getBoundingClientRect();
      return readerEditorPlacement({ stage, viewport, anchor, width: size.width, height: size.height });
    };
    let position = measure();
    editor.style.visibility = position ? "" : "hidden";
    if (!position) return;
    editor.style.maxWidth = `${position.maxWidth}px`;
    editor.style.maxHeight = `${position.maxHeight}px`;
    // Width changes can reflow the description and action rows.
    position = measure();
    editor.style.left = `${position.left}px`;
    editor.style.top = `${position.top}px`;
  }

  function scheduleEditorPosition() {
    if (editorFrame !== null) return;
    editorFrame = requestAnimationFrame(() => {
      editorFrame = null;
      positionEditor();
    });
  }

  function watchEditorViewport(active) {
    if (editorViewportActive === active) return;
    editorViewportActive = active;
    const method = active ? "addEventListener" : "removeEventListener";
    window[method]("resize", scheduleEditorPosition);
    window.visualViewport?.[method]("resize", scheduleEditorPosition);
    window.visualViewport?.[method]("scroll", scheduleEditorPosition);
    if (!active && editorFrame !== null) {
      cancelAnimationFrame(editorFrame);
      editorFrame = null;
    }
  }

  function makeTextboxLayout(record, shape, text, cssWidth, cssHeight) {
    const unitScale = (record.scale || 1) * (record.page?.userUnit || 1);
    const bounds = shapeBounds(shape);
    return layoutTextbox(
      text,
      shape.font_size,
      (bounds[2] - bounds[0]) * cssWidth / unitScale,
      (bounds[3] - bounds[1]) * cssHeight / unitScale
    );
  }

  function updateColorOptions(kind) {
    const textbox = kind === "textbox";
    const colors = textbox ? TEXTBOX_COLORS : COLORS;
    color.replaceChildren();
    colorPalette.replaceChildren();
    for (const value of Object.keys(colors)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = adapter.t(`${textbox ? "textboxColor" : "color"}${value[0].toUpperCase()}${value.slice(1)}`);
      color.append(option);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reader-shape-color-swatch";
      button.dataset.value = value;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.setAttribute("aria-label", option.textContent);
      button.title = option.textContent;
      button.tabIndex = -1;
      button.style.setProperty("--reader-shape-swatch-color", colors[value]);
      colorPalette.append(button);
    }
  }

  function syncColorPalette() {
    const buttons = [...colorPalette.querySelectorAll(".reader-shape-color-swatch")];
    const selected = buttons.find((button) => button.dataset.value === color.value) || null;
    colorPalette.setAttribute("aria-disabled", String(color.disabled));
    for (const button of buttons) {
      button.setAttribute("aria-checked", String(button === selected));
      button.tabIndex = button === selected ? 0 : -1;
      button.disabled = color.disabled;
    }
  }

  function handleWidthMenuPointerDown(event) {
    if (!widthField.contains(event.target)) closeWidthMenu();
  }

  function closeWidthMenu(returnFocus = false) {
    const restoreFocus = returnFocus && widthMenuOpen && !widthToggle.disabled;
    widthMenuOpen = false;
    widthPicker.hidden = true;
    widthToggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", handleWidthMenuPointerDown, true);
    if (restoreFocus) widthToggle.focus({ preventScroll: true });
  }

  function openWidthMenu() {
    if (width.disabled || widthToggle.disabled || widthField.hidden || !interaction || interaction.shape.kind === "textbox") return;
    widthMenuOpen = true;
    widthPicker.hidden = false;
    widthToggle.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", handleWidthMenuPointerDown, true);
    const checked = [...widthPicker.querySelectorAll(".reader-shape-width-option")].find((button) => button.dataset.value === width.value);
    checked?.focus({ preventScroll: true });
  }

  function syncWidthPicker() {
    const groupLabel = adapter.t("shapeLineWidth");
    const currentLabel = `${groupLabel} ${width.value}`;
    widthToggle.setAttribute("aria-label", currentLabel);
    widthToggle.title = currentLabel;
    widthToggle.disabled = width.disabled || widthField.hidden;
    widthPreview.setAttribute("stroke-width", width.value);
    widthPicker.setAttribute("aria-label", groupLabel);
    widthPicker.setAttribute("aria-disabled", String(width.disabled));
    for (const option of width.options) {
      let button = widthPicker.querySelector(`[data-value="${option.value}"]`);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "reader-shape-width-option";
        button.dataset.value = option.value;
        button.setAttribute("role", "radio");
        const icon = svgElement("svg", {
          class: "reader-shape-width-icon",
          viewBox: "0 0 30 12",
          "aria-hidden": "true",
          focusable: "false"
        });
        icon.append(svgElement("line", {
          x1: 2,
          y1: 6,
          x2: 28,
          y2: 6,
          stroke: "currentColor",
          "stroke-width": option.value,
          "stroke-linecap": "round"
        }));
        button.append(icon);
        widthPicker.append(button);
      }
      const label = `${groupLabel} ${option.value}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.setAttribute("aria-checked", String(button.dataset.value === width.value));
      button.tabIndex = button.dataset.value === width.value ? 0 : -1;
      button.disabled = width.disabled;
    }
    if (widthToggle.disabled) closeWidthMenu();
  }

  function fontControlValid() {
    return Number.isInteger(fontSize.valueAsNumber) && fontSize.valueAsNumber >= 8 && fontSize.valueAsNumber <= 48;
  }

  function renderEditor(sync = false) {
    const focusedColor = colorPalette.contains(document.activeElement) ? document.activeElement.dataset.value : null;
    editor.hidden = !interaction || Boolean(interaction.drawing);
    watchEditorViewport(!editor.hidden);
    if (editor.hidden) {
      closeWidthMenu();
      return;
    }
    const busy = saving || adapter.isBusy();
    const frozen = Boolean(interaction.operation);
    const textbox = interaction.shape.kind === "textbox";
    if (sync) {
      updateColorOptions(interaction.shape.kind);
      description.value = interaction.text;
      color.value = interaction.shape.color;
      if (textbox) fontSize.value = String(interaction.shape.font_size);
      else width.value = String(interaction.shape.line_width);
    }
    descriptionLabel.textContent = adapter.t(textbox ? "shapeTextboxBody" : "shapeDescription");
    description.maxLength = textbox ? 4000 : 10000;
    description.placeholder = textbox && !interaction.noteId ? adapter.t("shapeTextboxPlaceholder") : "";
    widthField.hidden = textbox;
    fontSizeField.hidden = !textbox;
    description.disabled = busy || frozen;
    color.disabled = busy || frozen;
    syncColorPalette();
    width.disabled = busy || frozen || textbox;
    syncWidthPicker();
    fontSize.disabled = busy || frozen || !textbox;
    const blank = textbox && !interaction.text.trim();
    const tooLong = textbox && Array.from(interaction.text).length > 2000;
    const record = interaction.record;
    const layout = textbox ? makeTextboxLayout(record, interaction.shape, interaction.text, record.viewport?.width || record.surface.clientWidth, record.viewport?.height || record.surface.clientHeight) : null;
    const overflowing = textbox && !blank && layout.overflow;
    const invalidFont = textbox && !fontControlValid();
    saveButton.disabled = busy || !dirty() || !validShape(interaction.shape) || blank || tooLong || overflowing || invalidFont;
    const warning = !textbox ? null : blank ? "shapeTextboxEmpty" : tooLong ? "shapeTextboxTooLong" : overflowing ? "shapeTextboxOverflow" : null;
    overflow.hidden = !warning;
    overflow.textContent = warning ? adapter.t(warning) : "";
    if (overflow.hidden) description.removeAttribute("aria-describedby");
    else description.setAttribute("aria-describedby", "reader-shape-overflow");
    cancelButton.disabled = saving;
    deleteButton.hidden = !interaction.noteId;
    deleteButton.disabled = busy;
    noteButton.hidden = !interaction.noteId;
    agentButton.hidden = !interaction.noteId;
    noteButton.disabled = busy || dirty() || blank || tooLong || overflowing;
    agentButton.disabled = busy || dirty() || blank || tooLong || overflowing;
    editor.setAttribute("aria-label", adapter.t(interaction.noteId ? "shapeEditLabel" : "shapeNewLabel"));
    positionEditor();
    if (focusedColor && !color.disabled) {
      const buttons = [...colorPalette.querySelectorAll(".reader-shape-color-swatch")];
      const target = buttons.find((button) => button.dataset.value === focusedColor) || buttons.find((button) => button.dataset.value === color.value);
      target?.focus({ preventScroll: true });
    }
  }

  function appendShape(layer, record, shape, noteId, selected, body = "") {
    const bounds = record.surface.getBoundingClientRect();
    const cssWidth = record.viewport?.width || bounds.width;
    const cssHeight = record.viewport?.height || bounds.height;
    const points = shape.points.map(([x, y]) => [x * cssWidth, y * cssHeight]);
    const unitScale = (record.scale || 1) * (record.page?.userUnit || 1);
    const textbox = shape.kind === "textbox";
    const strokeWidth = textbox ? 0 : shape.line_width * unitScale;
    const paint = (textbox ? TEXTBOX_COLORS : COLORS)[shape.color];
    const group = svgElement("g", {
      class: "reader-shape",
      "data-note-id": noteId || "draft",
      "data-kind": shape.kind,
      tabindex: noteId || selected ? 0 : -1,
      role: noteId ? "button" : "img",
      "aria-label": `${adapter.t(`shape${shape.kind[0].toUpperCase()}${shape.kind.slice(1)}`)}${noteId ? `, ${adapter.t("shapeSelect")}` : ""}`
    });
    let hit;
    if (shape.kind === "rectangle") {
      const x = Math.min(points[0][0], points[1][0]);
      const y = Math.min(points[0][1], points[1][1]);
      const w = Math.abs(points[1][0] - points[0][0]);
      const h = Math.abs(points[1][1] - points[0][1]);
      group.append(svgElement("rect", { class: "reader-shape-visual", x, y, width: w, height: h, fill: "none", stroke: paint, "stroke-width": strokeWidth }));
      hit = svgElement("rect", { class: "reader-shape-hit", x, y, width: w, height: h, fill: "none", stroke: "transparent", "stroke-width": Math.max(14, strokeWidth + 8) });
    } else if (textbox) {
      const x = Math.min(points[0][0], points[1][0]);
      const y = Math.min(points[0][1], points[1][1]);
      const w = Math.abs(points[1][0] - points[0][0]);
      const h = Math.abs(points[1][1] - points[0][1]);
      const layout = makeTextboxLayout(record, shape, body, cssWidth, cssHeight);
      const clipId = `reader-textbox-clip-${++clipSequence}`;
      const clip = svgElement("clipPath", { id: clipId });
      clip.append(svgElement("rect", { x, y, width: w, height: h }));
      const text = svgElement("text", {
        class: "reader-textbox-text",
        fill: paint,
        "font-family": TEXTBOX_FONT_FAMILY,
        "font-size": layout.fontSize * unitScale,
        "clip-path": `url(#${clipId})`,
        "xml:space": "preserve"
      });
      for (let index = 0; index < layout.lines.length; index += 1) {
        const line = svgElement("tspan", {
          x: x + layout.padding * unitScale,
          y: y + (layout.padding + layout.fontSize + index * layout.lineHeight) * unitScale
        });
        line.textContent = layout.lines[index];
        text.append(line);
      }
      group.append(svgElement("rect", { class: "reader-shape-visual reader-textbox-background", x, y, width: w, height: h, fill: "transparent", stroke: "none" }), clip, text);
      hit = svgElement("rect", { class: "reader-shape-hit", x, y, width: w, height: h, fill: "transparent", stroke: "none", style: "pointer-events:all" });
    } else if (shape.kind === "ellipse") {
      const attributes = {
        cx: (points[0][0] + points[1][0]) / 2,
        cy: (points[0][1] + points[1][1]) / 2,
        rx: Math.abs(points[1][0] - points[0][0]) / 2,
        ry: Math.abs(points[1][1] - points[0][1]) / 2
      };
      group.append(svgElement("ellipse", { ...attributes, class: "reader-shape-visual", fill: "none", stroke: paint, "stroke-width": strokeWidth }));
      hit = svgElement("ellipse", { ...attributes, class: "reader-shape-hit", fill: "none", stroke: "transparent", "stroke-width": Math.max(14, strokeWidth + 8) });
    } else if (shape.kind === "ink") {
      const path = points.map((point) => point.join(",")).join(" ");
      group.append(svgElement("polyline", { class: "reader-shape-visual", points: path, fill: "none", stroke: paint, "stroke-width": strokeWidth, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      hit = svgElement("polyline", { class: "reader-shape-hit", points: path, fill: "none", stroke: "transparent", "stroke-width": Math.max(14, strokeWidth + 8), "stroke-linecap": "round", "stroke-linejoin": "round" });
    } else {
      group.append(svgElement("line", { class: "reader-shape-visual", x1: points[0][0], y1: points[0][1], x2: points[1][0], y2: points[1][1], stroke: paint, "stroke-width": strokeWidth, "stroke-linecap": "round" }));
      const arrow = shape.kind === "arrow" ? arrowGeometry(points[0], points[1], strokeWidth, unitScale) : null;
      if (arrow) group.append(svgElement("path", {
        class: "reader-shape-visual",
        d: `M ${arrow.points[1].join(" ")} L ${arrow.points[0].join(" ")} L ${arrow.points[2].join(" ")}`,
        fill: "none", stroke: paint, "stroke-width": strokeWidth, "stroke-linecap": "round", "stroke-linejoin": "round"
      }));
      hit = svgElement("line", { class: "reader-shape-hit", x1: points[0][0], y1: points[0][1], x2: points[1][0], y2: points[1][1], stroke: "transparent", "stroke-width": Math.max(14, strokeWidth + 8), "stroke-linecap": "round" });
    }
    group.append(hit);
    if (selected) {
      const endpoint = ["arrow", "line"].includes(shape.kind);
      let handles;
      if (endpoint) handles = [[points[0], 0], [points[1], 1]];
      else if (shape.kind === "ink") {
        const frame = shapeBounds(shape);
        handles = [[frame[0], frame[1]], [frame[2], frame[1]], [frame[2], frame[3]], [frame[0], frame[3]]].map((point, index) => [[point[0] * cssWidth, point[1] * cssHeight], index]);
      } else {
        handles = [[points[0], 0], [[points[1][0], points[0][1]], 1], [points[1], 2], [[points[0][0], points[1][1]], 3]];
      }
      for (const [point, index] of handles) {
        group.append(svgElement("circle", {
          class: "reader-shape-handle", "data-handle": index, cx: point[0], cy: point[1], r: 5,
          tabindex: 0, role: "button", "aria-label": adapter.t(endpoint ? "shapeEndpoint" : "shapeCorner")
        }));
      }
    }
    layer.append(group);
  }

  function render() {
    const active = document.activeElement;
    const focusedGroup = active?.closest?.(".reader-shape");
    const focusedHandle = active?.closest?.(".reader-shape-handle");
    const focus = focusedGroup && [...layers.values()].some((layer) => layer.contains(active)) ? {
      noteId: focusedGroup.dataset.noteId,
      handle: focusedHandle ? focusedHandle.dataset.handle : null
    } : null;
    for (const [record, layer] of layers) {
      layer.replaceChildren();
      if (!record.rendered || !record.surface.isConnected) continue;
      const cssWidth = record.viewport?.width || record.surface.clientWidth;
      const cssHeight = record.viewport?.height || record.surface.clientHeight;
      layer.setAttribute("viewBox", `0 0 ${cssWidth} ${cssHeight}`);
      for (const note of adapter.getNotes()) {
        if (note.page !== record.pageNumber || note.deleted_at || note.purged || !validShape(note.shape_annotation)) continue;
        if (interaction?.noteId === note.id) continue;
        appendShape(layer, record, note.shape_annotation, note.id, false, note.text);
      }
      if (interaction?.record === record && !interaction.drawing) appendShape(layer, record, interaction.shape, interaction.noteId, true, interaction.text);
      if (interaction?.record === record && interaction.drawing) appendShape(layer, record, interaction.shape, null, false, interaction.text);
    }
    updateMode();
    renderEditor();
    if (focus) {
      for (const layer of layers.values()) {
        const group = [...layer.querySelectorAll(".reader-shape")].find((node) => node.dataset.noteId === focus.noteId);
        if (!group) continue;
        const target = focus.handle === null ? group : [...group.querySelectorAll(".reader-shape-handle")].find((node) => node.dataset.handle === focus.handle);
        if (target) target.focus({ preventScroll: true });
        break;
      }
    }
  }

  function cancel() {
    const pointerId = interaction?.drawing?.pointerId ?? interaction?.drag?.pointerId;
    if (pointerId !== undefined) releasePointer(interaction, pointerId);
    interaction = null;
    drawKind = null;
    saving = false;
    editor.hidden = true;
    render();
  }

  function hasUnsavedChanges() {
    return saving || Boolean(interaction && (dirty() || interaction.drawing || interaction.drag));
  }

  function start(kind) {
    if (adapter.isBusy()) return;
    if (hasUnsavedChanges()) {
      adapter.status("shapeUnsavedChanges");
      return;
    }
    adapter.beforeInteraction();
    cancel();
    drawKind = kind;
    updateMode();
  }

  function select(noteId, options = {}) {
    const note = noteFor(noteId);
    const record = note && adapter.getRecord(note.page);
    if (!note || !record || !adapter.recordIsCurrent(record)) return false;
    closeWidthMenu();
    if (interaction?.noteId === note.id && interaction.record === record && generationCurrent(interaction)) {
      drawKind = null;
      if (options.focus) description.focus({ preventScroll: true });
      return true;
    }
    if (hasUnsavedChanges()) {
      adapter.status("shapeUnsavedChanges");
      return false;
    }
    drawKind = null;
    interaction = {
      noteId: note.id,
      record,
      documentId: adapter.getDocument().id,
      sourceSha: adapter.getDocument().sha256,
      renderSequence: adapter.getRenderSequence(),
      revision: note.revision,
      shape: shapePayload(note.shape_annotation),
      text: note.text,
      original: { shape: shapePayload(note.shape_annotation), text: note.text },
      operation: null,
      drawing: null,
      drag: null
    };
    render();
    renderEditor(true);
    if (options.focus) description.focus({ preventScroll: true });
    return true;
  }

  function eventPoint(event, record) {
    const bounds = record.surface.getBoundingClientRect();
    return [clamp((event.clientX - bounds.left) / bounds.width), clamp((event.clientY - bounds.top) / bounds.height)];
  }

  function drawingPoint(event, record) {
    const point = eventPoint(event, record);
    if (interaction.shape.kind !== "ellipse" || !event.shiftKey) return point;
    const start = interaction.shape.points[0];
    const bounds = record.surface.getBoundingClientRect();
    const signX = point[0] >= start[0] ? 1 : -1;
    const signY = point[1] >= start[1] ? 1 : -1;
    const availableX = (signX > 0 ? 1 - start[0] : start[0]) * bounds.width;
    const availableY = (signY > 0 ? 1 - start[1] : start[1]) * bounds.height;
    const side = Math.min(Math.abs(point[0] - start[0]) * bounds.width, Math.abs(point[1] - start[1]) * bounds.height, availableX, availableY);
    return [clamp(start[0] + signX * side / bounds.width), clamp(start[1] + signY * side / bounds.height)];
  }

  function beginDrawing(event, record, layer) {
    if (!drawKind || !adapter.recordIsCurrent(record)) return;
    const point = eventPoint(event, record);
    const owner = adapter.getDocument();
    const kind = drawKind;
    const textbox = kind === "textbox";
    const points = kind === "ink" ? [[...point]] : [[...point], [...point]];
    let shape = { kind, color: "yellow", line_width: 2, points };
    if (textbox) {
      const bounds = record.surface.getBoundingClientRect();
      const cssWidth = record.viewport?.width || bounds.width;
      const cssHeight = record.viewport?.height || bounds.height;
      const unitScale = (record.scale || 1) * (record.page?.userUnit || 1);
      const width = Math.min(1, 180 * unitScale / cssWidth);
      const height = Math.min(1, 80 * unitScale / cssHeight);
      const left = Math.max(0, Math.min(point[0], 1 - width));
      const top = Math.max(0, Math.min(point[1], 1 - height));
      shape = { kind, color: "black", font_size: 14, points: [[left, top], [left + width, top + height]] };
    }
    interaction = {
      noteId: null,
      record,
      documentId: owner.id,
      sourceSha: owner.sha256,
      renderSequence: adapter.getRenderSequence(),
      revision: null,
      shape,
      text: textbox ? "" : adapter.t(`shapeDefault${kind[0].toUpperCase()}${kind.slice(1)}`),
      original: null,
      operation: null,
      drawing: textbox ? null : { pointerId: event.pointerId },
      drag: null
    };
    drawKind = null;
    if (!textbox) layer.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    render();
    if (textbox) {
      renderEditor(true);
      description.focus({ preventScroll: true });
    }
  }

  function beginDrag(event, record, layer, target) {
    const group = target.closest(".reader-shape");
    const noteId = group?.dataset.noteId;
    if (!noteId || event.button !== 0) return;
    if (noteId === "draft") {
      if (!interaction || interaction.noteId || interaction.record !== record || interaction.drawing || !generationCurrent(interaction)) return;
    } else {
      adapter.beforeSelect();
      if (!select(noteId)) return;
    }
    if (interaction.operation || saving) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const handle = target.closest(".reader-shape-handle");
    interaction.drag = {
      pointerId: event.pointerId,
      type: handle ? "handle" : "move",
      handle: handle ? Number(handle.dataset.handle) : null,
      start: eventPoint(event, record),
      points: clone(interaction.shape.points)
    };
    layer.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function movePoints(delta) {
    const points = clone(interaction.drag.points);
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), delta[0]));
    const dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), delta[1]));
    interaction.shape.points = points.map(([x, y]) => [x + dx, y + dy]);
  }

  function resizeHandle(kind, points, handle, point) {
    if (["arrow", "line"].includes(kind)) {
      const resized = clone(points);
      resized[handle] = point;
      return resized;
    }
    if (kind === "ink") {
      const bounds = shapeBounds({ kind, points });
      const resized = [...bounds];
      if (handle === 0 || handle === 3) resized[0] = point[0];
      else resized[2] = point[0];
      if (handle === 0 || handle === 1) resized[1] = point[1];
      else resized[3] = point[1];
      if (resized[0] === resized[2] || resized[1] === resized[3]) return null;
      return points.map(([x, y]) => [
        clamp(resized[0] + (x - bounds[0]) / (bounds[2] - bounds[0]) * (resized[2] - resized[0])),
        clamp(resized[1] + (y - bounds[1]) / (bounds[3] - bounds[1]) * (resized[3] - resized[1]))
      ]);
    }
    const resized = clone(points);
    if (handle === 0 || handle === 3) resized[0][0] = point[0];
    else resized[1][0] = point[0];
    if (handle === 0 || handle === 1) resized[0][1] = point[1];
    else resized[1][1] = point[1];
    return resized;
  }

  function dragTo(event) {
    const drag = interaction?.drag;
    if (!drag || drag.pointerId !== event.pointerId || interaction.operation || saving) return;
    const point = eventPoint(event, interaction.record);
    if (drag.type === "move") {
      movePoints([point[0] - drag.start[0], point[1] - drag.start[1]]);
    } else {
      const points = resizeHandle(interaction.shape.kind, drag.points, drag.handle, point);
      if (points) interaction.shape.points = points;
    }
    event.preventDefault();
    event.stopPropagation();
    render();
  }

  function releasePointer(target, pointerId) {
    const layer = target?.record?.shapeLayer;
    if (layer?.hasPointerCapture(pointerId)) layer.releasePointerCapture(pointerId);
  }

  function finishDrawing(event, atLimit = false) {
    releasePointer(interaction, event.pointerId);
    interaction.drawing = null;
    event.preventDefault();
    event.stopPropagation();
    if (!validShape(interaction.shape)) {
      adapter.status("shapeTooSmall");
      cancel();
      return;
    }
    render();
    renderEditor(true);
    description.focus({ preventScroll: true });
    if (atLimit) adapter.status("shapeInkLimit");
  }

  function continueDrawing(event, record) {
    if (interaction.operation || saving) return;
    event.preventDefault();
    event.stopPropagation();
    if (interaction.shape.kind !== "ink") {
      interaction.shape.points[1] = drawingPoint(event, record);
      render();
      return;
    }
    const point = eventPoint(event, record);
    const points = interaction.shape.points;
    const last = points[points.length - 1];
    const bounds = record.surface.getBoundingClientRect();
    if (Math.hypot((point[0] - last[0]) * bounds.width, (point[1] - last[1]) * bounds.height) < 2) return;
    points.push(point);
    if (points.length === 512) {
      finishDrawing(event, true);
      return;
    }
    render();
  }

  function finishPointer(event) {
    if (interaction?.drawing?.pointerId === event.pointerId) {
      if (interaction.shape.kind === "ink") {
        const point = eventPoint(event, interaction.record);
        const points = interaction.shape.points;
        const last = points[points.length - 1];
        if (point[0] !== last[0] || point[1] !== last[1]) points.push(point);
        finishDrawing(event, points.length === 512);
      } else {
        interaction.shape.points[1] = drawingPoint(event, interaction.record);
        finishDrawing(event);
      }
      return;
    }
    if (interaction?.drag?.pointerId !== event.pointerId) return;
    releasePointer(interaction, event.pointerId);
    if (!validShape(interaction.shape)) interaction.shape.points = interaction.drag.points;
    interaction.drag = null;
    event.preventDefault();
    event.stopPropagation();
    render();
  }

  function nudge(event, handle = null) {
    if (!interaction || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (interaction.operation || saving || interaction.drawing) return true;
    const bounds = interaction.record.surface.getBoundingClientRect();
    const amount = event.shiftKey ? 10 : 1;
    const delta = [
      (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0) / bounds.width,
      (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0) / bounds.height
    ];
    const previous = clone(interaction.shape.points);
    if (handle === null) {
      interaction.drag = { points: previous };
      movePoints(delta);
      interaction.drag = null;
    } else {
      let corner;
      if (["arrow", "line"].includes(interaction.shape.kind)) corner = previous[handle];
      else if (interaction.shape.kind === "ink") {
        const frame = shapeBounds(interaction.shape);
        corner = [[frame[0], frame[1]], [frame[2], frame[1]], [frame[2], frame[3]], [frame[0], frame[3]]][handle];
      } else {
        const xIndex = handle === 0 || handle === 3 ? 0 : 1;
        const yIndex = handle === 0 || handle === 1 ? 0 : 1;
        corner = [previous[xIndex][0], previous[yIndex][1]];
      }
      const points = resizeHandle(interaction.shape.kind, previous, handle, [clamp(corner[0] + delta[0]), clamp(corner[1] + delta[1])]);
      if (points) interaction.shape.points = points;
    }
    if (!validShape(interaction.shape)) interaction.shape.points = previous;
    render();
    return true;
  }

  function attach(record) {
    const existing = layers.get(record);
    if (existing?.isConnected) {
      record.shapeLayer = existing;
      updateMode();
      return existing;
    }
    const layer = svgElement("svg", { class: "reader-shape-layer", "aria-label": adapter.t("shapeLayer") });
    record.surface.insertBefore(layer, record.linkLayer);
    record.shapeLayer = layer;
    layers.set(record, layer);
    layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || adapter.isSuspended() || adapter.isBusy()) return;
      if (drawKind) beginDrawing(event, record, layer);
      else beginDrag(event, record, layer, event.target);
    });
    layer.addEventListener("pointermove", (event) => {
      if (interaction?.record !== record) return;
      if (interaction.drawing?.pointerId === event.pointerId) continueDrawing(event, record);
      else dragTo(event);
    });
    layer.addEventListener("pointerup", finishPointer);
    layer.addEventListener("pointercancel", cancel);
    layer.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        const noteId = event.target.closest(".reader-shape")?.dataset.noteId;
        if (noteId && noteId !== "draft") {
          event.preventDefault();
          event.stopPropagation();
          select(noteId, { focus: true });
        }
        return;
      }
      const handle = event.target.closest(".reader-shape-handle");
      const group = event.target.closest(".reader-shape");
      const current = interaction?.record === record && group && (interaction.noteId ? group.dataset.noteId === interaction.noteId : group.dataset.noteId === "draft");
      if (current) nudge(event, handle ? Number(handle.dataset.handle) : null);
    });
    updateMode();
    return layer;
  }

  async function save() {
    const current = interaction;
    if (!current || saving || adapter.isBusy() || !validShape(current.shape)) return;
    if (!generationCurrent(current)) {
      adapter.status("shapeStale");
      cancel();
      return;
    }
    if (current.shape.kind === "textbox") {
      if (!fontControlValid()) return;
      current.text = description.value.trim();
      const record = current.record;
      const layout = makeTextboxLayout(current.record, current.shape, current.text, record.viewport?.width || record.surface.clientWidth, record.viewport?.height || record.surface.clientHeight);
      if (!current.text || Array.from(current.text).length > 2000 || layout.overflow) {
        renderEditor();
        return;
      }
    } else {
      current.text = description.value.trim() || adapter.t(`shapeDefault${current.shape.kind[0].toUpperCase()}${current.shape.kind.slice(1)}`);
    }
    saving = true;
    renderEditor();
    const saved = await adapter.save(current);
    saving = false;
    if (saved && interaction === current) cancel();
    else renderEditor();
  }

  function saved(target) {
    if (interaction !== target) return;
    target.operation = null;
    saving = false;
    cancel();
  }

  async function share(target) {
    const current = interaction;
    if (!current?.noteId || dirty() || adapter.isBusy() || !generationCurrent(current)) return;
    await adapter.capture(current, target);
  }

  description.addEventListener("input", () => {
    if (!interaction || interaction.operation || saving) return;
    interaction.text = description.value;
    render();
  });
  color.addEventListener("change", () => {
    if (!interaction || interaction.operation || saving) return;
    const colors = interaction.shape.kind === "textbox" ? TEXTBOX_COLORS : COLORS;
    if (!Object.hasOwn(colors, color.value)) return;
    interaction.shape.color = color.value;
    render();
  });
  function chooseColor(button) {
    if (button.disabled) return;
    if (color.value === button.dataset.value) {
      syncColorPalette();
      return;
    }
    color.value = button.dataset.value;
    color.dispatchEvent(new Event("change", { bubbles: true }));
  }
  colorPalette.addEventListener("click", (event) => {
    const button = event.target.closest(".reader-shape-color-swatch");
    if (button) chooseColor(button);
  });
  colorPalette.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const current = event.target.closest(".reader-shape-color-swatch");
    if (!current) return;
    const buttons = [...colorPalette.querySelectorAll(".reader-shape-color-swatch")].filter((button) => !button.disabled);
    const index = buttons.indexOf(current);
    if (index < 0 || !buttons.length) return;
    event.preventDefault();
    const previous = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (previous ? -1 : 1) + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    next.focus({ preventScroll: true });
    chooseColor(next);
  });
  function chooseWidth(button) {
    if (button.disabled) return;
    if (width.value === button.dataset.value) {
      syncWidthPicker();
      return;
    }
    width.value = button.dataset.value;
    width.dispatchEvent(new Event("change", { bubbles: true }));
  }
  widthToggle.addEventListener("click", () => {
    if (widthMenuOpen) closeWidthMenu(true);
    else openWidthMenu();
  });
  widthPicker.addEventListener("click", (event) => {
    const button = event.target.closest(".reader-shape-width-option");
    if (!button) return;
    chooseWidth(button);
    closeWidthMenu(true);
  });
  widthPicker.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const current = event.target.closest(".reader-shape-width-option");
    if (!current) return;
    const buttons = [...widthPicker.querySelectorAll(".reader-shape-width-option")].filter((button) => !button.disabled);
    const index = buttons.indexOf(current);
    if (index < 0 || !buttons.length) return;
    event.preventDefault();
    event.stopPropagation();
    const previous = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (previous ? -1 : 1) + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    next.focus({ preventScroll: true });
    chooseWidth(next);
  });
  width.addEventListener("change", () => {
    if (!interaction || interaction.operation || saving || interaction.shape.kind === "textbox") return;
    interaction.shape.line_width = Number(width.value);
    render();
  });
  fontSize.addEventListener("input", () => {
    if (!interaction || interaction.operation || saving || interaction.shape.kind !== "textbox") return;
    if (fontControlValid()) {
      interaction.shape.font_size = fontSize.valueAsNumber;
      render();
    } else {
      renderEditor();
    }
  });
  saveButton.addEventListener("click", save);
  cancelButton.addEventListener("click", cancel);
  deleteButton.addEventListener("click", async () => {
    const current = interaction;
    if (!current?.noteId || adapter.isBusy()) return;
    if (await adapter.remove(current)) cancel();
  });
  noteButton.addEventListener("click", () => share("note"));
  agentButton.addEventListener("click", () => share("agent"));
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (widthMenuOpen) closeWidthMenu(true);
      else cancel();
    }
  });

  function composeCapture(record, shape, savedText = "") {
    const source = record.canvas;
    const ratio = source.width / Math.max(1, record.viewport.width);
    const rawScale = (record.scale || 1) * (record.page?.userUnit || 1) * ratio;
    const points = shape.points.map(([x, y]) => [x * source.width, y * source.height]);
    const textbox = shape.kind === "textbox";
    let layout = null;
    if (textbox) {
      if (!savedText.trim()) return { error: "shapeTextboxEmpty" };
      if (Array.from(savedText).length > 2000) return { error: "shapeTextboxTooLong" };
      const width = Math.abs(points[1][0] - points[0][0]);
      const height = Math.abs(points[1][1] - points[0][1]);
      layout = layoutTextbox(savedText, shape.font_size, width / rawScale, height / rawScale);
      if (layout.overflow) return { error: "shapeTextboxOverflow" };
    }
    const strokeWidth = textbox ? 0 : shape.line_width * rawScale;
    const arrow = shape.kind === "arrow" ? arrowGeometry(points[0], points[1], strokeWidth, rawScale) : null;
    const margin = strokeWidth / 2 + (arrow?.headLength || 0) + Math.max(2, 2 * ratio);
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const left = Math.max(0, Math.floor(Math.min(...xs) - margin));
    const top = Math.max(0, Math.floor(Math.min(...ys) - margin));
    const right = Math.min(source.width, Math.ceil(Math.max(...xs) + margin));
    const bottom = Math.min(source.height, Math.ceil(Math.max(...ys) + margin));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, right - left);
    canvas.height = Math.max(1, bottom - top);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", adapter.t("shapeCaptureAlt", { page: record.pageNumber }));
    const context = canvas.getContext("2d");
    context.drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    context.translate(-left, -top);
    if (textbox) {
      const x = Math.min(points[0][0], points[1][0]);
      const y = Math.min(points[0][1], points[1][1]);
      drawTextboxCanvas(context, layout, x, y, rawScale, TEXTBOX_COLORS[shape.color]);
    } else {
      context.strokeStyle = COLORS[shape.color];
      context.lineWidth = strokeWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      if (shape.kind === "rectangle") {
        context.rect(Math.min(points[0][0], points[1][0]), Math.min(points[0][1], points[1][1]), Math.abs(points[1][0] - points[0][0]), Math.abs(points[1][1] - points[0][1]));
      } else if (shape.kind === "ellipse") {
        context.ellipse((points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2, Math.abs(points[1][0] - points[0][0]) / 2, Math.abs(points[1][1] - points[0][1]) / 2, 0, 0, 2 * Math.PI);
      } else {
        context.moveTo(...points[0]);
        for (const point of points.slice(1)) context.lineTo(...point);
      }
      context.stroke();
      if (arrow) {
        context.beginPath();
        context.moveTo(...arrow.points[1]);
        context.lineTo(...arrow.points[0]);
        context.lineTo(...arrow.points[2]);
        context.stroke();
      }
    }
    return { canvas, rect: [left / source.width, top / source.height, right / source.width, bottom / source.height] };
  }

  function detach(record) {
    if (interaction?.record === record) cancel();
    layers.get(record)?.remove();
    layers.delete(record);
    delete record.shapeLayer;
  }

  function documentChanged() {
    cancel();
    for (const record of [...layers.keys()]) detach(record);
  }

  return {
    attach,
    detach,
    render,
    cancel,
    saved,
    start,
    select,
    share,
    positionEditor,
    updateControls: updateMode,
    composeCapture,
    bounds: shapeBounds,
    isInteracting: () => Boolean(interaction || drawKind),
    hasUnsavedChanges,
    isBusy: () => saving,
    getInteractingRecord: currentRecord,
    handleEscape() {
      if (!interaction && !drawKind) return false;
      cancel();
      return true;
    },
    noteChanged(note) {
      if (interaction?.noteId === note.id && (note.deleted_at || note.purged || note.revision !== interaction.revision)) cancel();
    },
    documentChanged,
    applyLanguage() {
      render();
      if (interaction) renderEditor(true);
    }
  };
}
