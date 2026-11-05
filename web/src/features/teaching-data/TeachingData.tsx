import { createElement as h, type KeyboardEvent } from "react";
import type { TeachingAction, TeachingExample } from "./types";
import type { TeachingDataController, TeachingState } from "./controller";
import { progressAllows, teachingProgress } from "./controller";
import { teachingCopy } from "./copy";

function exampleIcon() {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" },
  h("path", { d: "M4 4h16v16H4zM4 10h16M10 4v16M10 15h10" }));
}

export function TeachingData({ controller, state, idPrefix }: {
  controller: TeachingDataController; state: TeachingState; idPrefix: string;
}) {
  const { model, command, pending, detached } = state;
  const text = teachingCopy[model.language];
  const selected = model.examples.find(item => item.id === state.selectedId);
  const disabled = !model.ownerId || !model.available || model.busy || !!command || !!state.continuing || state.refreshing;
  const progress = teachingProgress(model);
  const badge = () => h("span", { className: "teaching-data-badge" }, text.synthetic);
  const button = (label: string, run: () => unknown, blocked = false, primary = false) =>
    h("button", { type: "button", className: primary ? "teaching-data-primary" : undefined,
      disabled: blocked, onClick: run }, label);

  function escape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !state.open) return;
    event.preventDefault(); event.stopPropagation();
    const section = event.currentTarget;
    if (controller.close()) section.querySelector<HTMLButtonElement>("[data-teaching-trigger]")?.focus();
  }

  function scenario(example: TeachingExample) {
    return h("button", { key: example.id, type: "button", className: "teaching-data-scenario",
      onClick: () => controller.select(example.id), "aria-label": `${example.title[model.language]} · ${text.synthetic}` },
    h("strong", null, example.title[model.language]),
    h("span", null, example.question[model.language]),
    h("span", { className: "teaching-data-scenario-meta" }, badge(),
      h("span", null, text[example.availability])));
  }

  function review(example: TeachingExample) {
    return h("div", { className: "teaching-data-review" },
      h("h4", { tabIndex: -1, "data-teaching-review-heading": true }, example.title[model.language]), badge(),
      h("dl", { className: "teaching-data-facts" },
        ...([ [text.question, example.question[model.language]], [text.design, example.design[model.language]],
          [text.rowMeaning, example.rowMeaning[model.language]], [text.rows, String(example.rowCount)] ] as const)
          .map(([label, value]) => h("div", { key: label }, h("dt", null, label), h("dd", null, value)))),
      h("div", { className: "teaching-data-table-scroll", tabIndex: 0, role: "region", "aria-label": text.variables },
        h("table", null, h("caption", null, text.variables),
          h("thead", null, h("tr", null,
            ...[text.name, text.meaning, text.unit, text.missing].map(label => h("th", { key: label, scope: "col" }, label)))),
          h("tbody", null, ...example.fields.map(field => h("tr", { key: field.name },
            h("th", { scope: "row" }, field.label[model.language], h("code", null, field.name)),
            h("td", null, field.meaning[model.language], h("small", null, field.numeric ? text.numeric : text.categorical)),
            h("td", null, field.unit?.[model.language] || "—"), h("td", null, String(field.missing))))))),
      example.previewRows.length ? h("div", { className: "teaching-data-table-scroll", tabIndex: 0, role: "region", "aria-label": text.preview },
        h("table", null, h("caption", null, `${text.preview} · ${text.synthetic}`),
          h("thead", null, h("tr", null, ...example.fields.map(field => h("th", { key: field.name, scope: "col" }, field.name)))),
          h("tbody", null, ...example.previewRows.map((row, index) => h("tr", { key: index },
            ...row.map((cell, column) => h("td", { key: column }, cell))))))) : h("p", null, text.noPreview),
      example.availability !== "ready" ? h("p", { role: "status" }, text[example.availability]) : null);
  }

  function retainedRequest() {
    if (!command) return null;
    return h("div", { className: "teaching-data-request", "aria-busy": pending },
      h("p", { role: pending ? "status" : "alert" }, pending ? text.pending : text[state.feedback === "failed" ? "failed" : "uncertain"]),
      detached ? h("p", null, text.detached) : null,
      !pending ? h("div", { className: "teaching-data-actions" },
        button(text.retry, () => { void controller.retry(); }, detached || !model.available || !model.ownerId || model.busy
          || model.examples.find(item => item.id === command.exampleId)?.availability !== "ready"),
        button(text.discard, () => controller.discardRequest())) : null);
  }

  function progressActions() {
    if (!progress) return null;
    const example = model.examples.find(item => item.id === progress.exampleId)!;
    return h("div", { className: "teaching-data-progress", "aria-label": `${example.title[model.language]} · ${text.synthetic}` },
      badge(), h("span", null, example.title[model.language]), h("span", { role: "status" }, text[progress.stage]),
      ...(["analysis", "charts", "presentations"] as TeachingAction[]).filter(action => progressAllows(model, action)).map(action =>
        h("button", { key: action, type: "button", disabled,
          onClick: () => { void controller.continueTo(action); } }, text[action])),
      state.continuing ? h("span", { role: "status" }, text.continuing) : null);
  }

  return h("section", { className: "teaching-data", lang: model.language, "aria-label": text.trigger, onKeyDown: escape },
    h("div", { className: "teaching-data-toolbar" },
      h("button", { type: "button", "data-teaching-trigger": true, "aria-expanded": state.open,
        "aria-controls": `${idPrefix}-panel`, onClick: () => { if (!state.open) controller.open(); else controller.close(); } },
      exampleIcon(), text.trigger), !state.open ? progressActions() : null),
    !state.open && state.feedback ? h("p", { role: state.feedback === "stale" ? "status" : "alert" }, text[state.feedback]) : null,
    state.open ? h("section", { id: `${idPrefix}-panel`, className: "teaching-data-panel", "aria-labelledby": `${idPrefix}-heading`,
      onSubmit: (event: { preventDefault(): void }) => event.preventDefault() },
      h("header", { className: "teaching-data-heading" }, h("h3", { id: `${idPrefix}-heading` }, selected && !detached ? text.review : text.choose)),
      h("div", { className: "teaching-data-content" },
      h("p", { className: "teaching-data-note" }, text.syntheticNote),
      selected && !detached ? review(selected) : !command ? h("div", { className: "teaching-data-scenarios" },
        model.examples.length ? model.examples.map(scenario) : h("p", null, text.empty)) : null,
      !model.available || !model.ownerId ? h("p", { role: "status" }, text.disabled) : model.busy ? h("p", { role: "status" }, text.busy) : null,
      retainedRequest(),
      !command && state.feedback ? h("p", { role: "alert" }, text[state.feedback]) : null),
      !command ? h("footer", { className: "teaching-data-actions" },
        selected ? button(text.back, () => controller.back()) : null,
        button(text.cancel, () => controller.close()),
        button(state.refreshing ? text.refreshing : text.refresh, () => { void controller.refresh(); }, disabled),
        selected ? button(text.import, () => { void controller.importSelected(); }, disabled || selected.availability !== "ready", true) : null) : null) : null);
}
