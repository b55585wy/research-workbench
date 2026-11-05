import { createElement as h, type ChangeEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { ChartSkillsController, ChartSkillsState } from "./controller";
import { skillKey } from "./controller";
import { skillCopy } from "./copy";
import { defaultSkillSpec, SKILL_EXPORTS, SKILL_FONTS, SKILL_KINDS } from "./validation";
import type { SkillSpec } from "./types";

const paths = {
  new: "M12 4v16M4 12h16", edit: "m15 4 5 5M4 20l4-1L20 7l-4-4L4 15z",
  import: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5", export: "M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5",
  remove: "M4 12h16"
};

function icon(name: keyof typeof paths) {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" }, h("path", { d: paths[name] }));
}

function action(label: string, name: keyof typeof paths, run: () => void, disabled: boolean) {
  return h("button", { type: "button", className: "chart-skill-icon", title: label, "aria-label": label,
    disabled, onClick: run }, icon(name));
}

function field(label: string, control: ReactNode) {
  return h("label", { className: "chart-skill-field" }, h("span", null, label), control);
}

function restoreFocus(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, close: () => boolean) {
  const section = event.currentTarget.closest(".chart-skills");
  if (close()) section?.querySelector<HTMLSelectElement>("[data-skill-select]")?.focus();
}

const presets = {
  neutral: defaultSkillSpec().style.palette,
  nature: ["#0072B2", "#D55E00", "#009E73", "#CC79A7"],
  cell: ["#3B5488", "#E69F00", "#00A087", "#CC79A7"]
};

export function ChartSkillPicker({ controller, state, idPrefix }: {
  controller: ChartSkillsController; state: ChartSkillsState; idPrefix: string;
}) {
  const { model, editor, pending, running, detached } = state;
  const text = skillCopy[model.language];
  const disabled = !model.available || model.busy || pending || detached;
  const selected = model.selected;
  const records = selected && !state.items.some((item) => skillKey(item) === skillKey(selected))
    ? [selected, ...state.items] : state.items;
  const spec = editor?.spec;
  const change = (next: SkillSpec) => { controller.change(next); };
  const style = (key: keyof SkillSpec["style"], value: unknown) => {
    if (spec) change({ ...spec, style: { ...spec.style, [key]: value } });
  };
  const numberField = (label: string, key: "font_size" | "line_width" | "marker_size" | "width" | "height",
    min: number, max: number, step = 1) => field(label, h("input", {
    type: "number", value: Number.isFinite(spec?.style[key]) ? spec?.style[key] : "", min, max, step, required: true,
    onChange: (event: ChangeEvent<HTMLInputElement>) => style(key, event.currentTarget.valueAsNumber)
  }));

  function paletteEditor(draft: SkillSpec) {
    const preset = Object.entries(presets).find(([, colors]) => colors.join() === draft.style.palette.join())?.[0] || "custom";
    return h("fieldset", { className: "chart-skill-palette" }, h("legend", null, text.palette),
      field(text.palettePreset, h("select", { value: preset, "aria-label": text.palettePreset,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const colors = presets[event.currentTarget.value as keyof typeof presets];
          if (colors) style("palette", [...colors]);
        } }, h("option", { value: "custom" }, text.custom),
        ...Object.keys(presets).map((key) => h("option", { key, value: key }, text[key as keyof typeof presets])))),
      h("div", { className: "chart-skill-swatches" }, ...draft.style.palette.map((color, index) =>
        h("label", { className: "chart-skill-swatch", key: index, title: `${text.color} ${index + 1}: ${color}` },
          h("input", { type: "color", value: color, "aria-label": `${text.color} ${index + 1}`,
            onChange: (event: ChangeEvent<HTMLInputElement>) => style("palette",
              draft.style.palette.map((value, position) => position === index ? event.currentTarget.value : value)) }))),
      action(text.addColor, "new", () => {
        const colors = ["#333333", "#777777", "#999999", "#BBBBBB", "#0055AA", "#AA5500", "#337733", "#993366", "#123456"];
        const color = colors.find((item) => !draft.style.palette.some((value) => value.toLowerCase() === item.toLowerCase()));
        if (color && draft.style.palette.length < 8) style("palette", [...draft.style.palette, color]);
      }, draft.style.palette.length >= 8),
      action(text.removeColor, "remove", () => {
        if (draft.style.palette.length > 2) style("palette", draft.style.palette.slice(0, -1));
      }, draft.style.palette.length <= 2)));
  }

  function editorForm(draft: SkillSpec) {
    return h("form", { className: "chart-skill-editor", "aria-label": text.editor, "aria-busy": running,
      onSubmit: (event: { preventDefault: () => void }) => { event.preventDefault(); void controller.save(); },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation(); restoreFocus(event, () => controller.closeEditor());
      } },
    h("div", { className: "chart-skill-editor-heading" }, h("strong", null, text.editor),
      editor?.revision ? h("span", null, `v${editor.revision}`) : null,
      state.dirty ? h("span", { role: "status" }, text.dirty) : null),
    h("fieldset", { className: "chart-skill-editor-fields", disabled },
      field(text.name, h("input", { type: "text", value: draft.name, required: true, autoFocus: true,
        onChange: (event: ChangeEvent<HTMLInputElement>) => change({ ...draft, name: event.currentTarget.value }) })),
      field(text.description, h("textarea", { value: draft.description, rows: 2,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => change({ ...draft, description: event.currentTarget.value }) })),
      h("div", { className: "chart-skill-grid" },
        field(text.kind, h("select", { value: draft.chart.kind, "aria-label": text.kind, "aria-describedby": `${idPrefix}-requirement`,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => {
            const kind = event.currentTarget.value as SkillSpec["chart"]["kind"];
            change({ ...draft, chart: { kind, bins: kind === "histogram" ? 20 : null } });
          } }, ...SKILL_KINDS.map((kind) => h("option", { key: kind, value: kind }, text.kinds[kind])))),
        draft.chart.kind === "histogram" ? field(text.bins, h("input", { type: "number", min: 2, max: 50, step: 1,
          value: typeof draft.chart.bins === "number" && Number.isFinite(draft.chart.bins) ? draft.chart.bins : "", required: true,
          onChange: (event: ChangeEvent<HTMLInputElement>) => change({ ...draft,
            chart: { ...draft.chart, bins: event.currentTarget.valueAsNumber } }) })) : null),
      h("p", { id: `${idPrefix}-requirement`, className: "chart-skill-requirement" }, text.requirements[draft.chart.kind]),
      paletteEditor(draft),
      h("div", { className: "chart-skill-grid" },
        field(text.font, h("select", { value: draft.style.font_family, "aria-label": text.font,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => style("font_family", event.currentTarget.value)
        }, ...SKILL_FONTS.map((font) => h("option", { key: font, value: font }, font)))),
        numberField(text.fontSize, "font_size", 8, 24), numberField(text.lineWidth, "line_width", 0.5, 4, 0.1),
        numberField(text.markerSize, "marker_size", 2, 16), numberField(text.width, "width", 480, 2400),
        numberField(text.height, "height", 320, 1600)),
      h("fieldset", { className: "chart-skill-formats" }, h("legend", null, text.formats),
        ...SKILL_EXPORTS.map((format) => h("label", { key: format },
          h("input", { type: "checkbox", checked: draft.exports.includes(format),
            onChange: (event: ChangeEvent<HTMLInputElement>) => change({ ...draft, exports: event.currentTarget.checked
              ? [...draft.exports, format] : draft.exports.filter((value) => value !== format) }) }),
          format === "offline" ? text.offline : format.toUpperCase())))),
    h("div", { className: "chart-skill-editor-actions" },
      h("button", { type: "submit", disabled }, editor?.id ? text.saveVersion : text.save),
      h("button", { type: "button", disabled: pending,
        onClick: (event: MouseEvent<HTMLElement>) => restoreFocus(event, () => controller.closeEditor()) }, text.cancel)));
  }

  return h("section", { className: "chart-skills", "aria-label": text.label, lang: model.language },
    h("div", { className: "chart-skill-toolbar" },
      field(text.label, h("select", { "data-skill-select": true, "aria-label": text.label, value: selected ? skillKey(selected) : "", disabled,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => { controller.select(event.currentTarget.value); }
      }, h("option", { value: "" }, text.builtin), ...records.map((record) => h("option", {
        key: skillKey(record), value: skillKey(record) }, `${record.spec.name} · v${record.revision}`)))),
      h("div", { className: "chart-skill-actions", role: "group", "aria-label": text.label },
        action(text.new, "new", () => { controller.newSkill(); }, disabled),
        action(text.edit, "edit", () => { controller.editSelected(); }, disabled || !selected),
        h("label", { className: `chart-skill-icon chart-skill-import${disabled ? " is-disabled" : ""}`, title: text.import },
          icon("import"), h("input", { className: "chart-skill-file", type: "file", accept: ".json,application/json",
            disabled, "aria-label": text.import, onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
              if (file) void controller.importFile(file);
            } })),
        action(text.export, "export", () => { controller.exportSelected(); }, !selected))),
    !model.available ? h("p", { className: "chart-skill-status", role: "status" }, text.unavailable) : null,
    selected && !editor && model.available ? h("p", { className: "chart-skill-requirement" }, text.requirements[selected.spec.chart.kind]) : null,
    state.loading ? h("p", { className: "chart-skill-status", role: "status" }, text.loading) : null,
    state.listError ? h("div", { className: "chart-skill-status", role: "alert" }, text.listError,
      h("button", { type: "button", disabled: !model.available, onClick: () => { void controller.load(); } }, text.reload)) : null,
    state.error ? h("p", { className: "chart-skill-error", role: "alert" }, text[state.error]) : null,
    pending ? h("div", { className: "chart-skill-pending" },
      h("p", { role: "status" }, running ? text.saving : text.uncertain),
      !running ? h("div", { className: "chart-skill-editor-actions" },
        h("button", { type: "button", disabled: !model.available || model.busy || detached,
          onClick: () => { void controller.retry(); } }, text.retry),
        h("button", { type: "button", onClick: () => { controller.discardRequest(); } }, text.discard)) : null) : null,
    detached ? h("div", { className: "chart-skill-status", role: "status" }, text.detached,
      h("button", { type: "button", disabled: pending, onClick: () => { controller.closeEditor(); } }, text.discardDraft)) : null,
    spec && !detached ? editorForm(spec) : null);
}
