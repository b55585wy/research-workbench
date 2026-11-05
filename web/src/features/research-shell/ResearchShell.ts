import { createElement as h } from "react";
import type { ChangeEvent } from "react";
import type { ResearchArea, ResearchShellCallbacks, ResearchShellModel } from "./contracts";

const copy = {
  zh: {
    navigation: "研究工作区", panels: "工作区面板", reading: "阅读", analysis: "数据分析",
    charts: "科研绘图", presentations: "汇报 PPT", assistant: "助手", switchWorkspace: "切换工作区"
  },
  en: {
    navigation: "Research workspace", panels: "Workspace panels", reading: "Reading", analysis: "Data analysis",
    charts: "Scientific charts", presentations: "Presentation (PPT)", assistant: "Assistant", switchWorkspace: "Switch workspace"
  }
};

const areas: ResearchArea[] = ["reading", "analysis", "charts", "presentations"];
const paths = {
  reading: "M3 5c4-1 7 0 9 2 2-2 5-3 9-2v14c-4-1-7 0-9 2-2-2-5-3-9-2zM12 7v14",
  analysis: "M4 3v18h17M8 16v-5m5 5V6m5 10v-8",
  charts: "M4 3v18h17M7 15l5-7 4 4 5-7M7 15h.01M12 8h.01M16 12h.01",
  presentations: "M3 4h18v12H3zM12 16v5m-5 0 5-5 5 5M7 8h10M7 12h6",
  assistant: "M4 4h16v12H9l-5 4zM8 9h8M8 12h5"
};

function icon(name: keyof typeof paths) {
  return h("svg", {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false"
  }, h("path", { d: paths[name] }));
}

export function ResearchShell({ model, callbacks }: { model: ResearchShellModel; callbacks: ResearchShellCallbacks }) {
  const text = copy[model.language === "zh" ? "zh" : "en"];
  const compact = model.language === "zh"
    ? { reading: "阅读", analysis: "分析", charts: "绘图", presentations: "PPT" }
    : { reading: "Read", analysis: "Analyze", charts: "Charts", presentations: "PPT" };
  const availableAreas = areas.filter((area) => !model.availableAreas || model.availableAreas.includes(area));
  const selectedArea = availableAreas.includes(model.area) ? model.area : "";
  return h("nav", { className: "research-shell", "aria-label": text.navigation },
    availableAreas.length > 1 ? h("label", { className: "research-shell-picker", "aria-busy": model.pending },
      icon(model.area), h("span", { className: "research-shell-picker-caption" }, text.switchWorkspace),
      h("select", {
        className: "research-shell-select", value: selectedArea, disabled: model.pending,
        "aria-label": text.switchWorkspace, "aria-controls": "reader-panel data-workspace",
        title: selectedArea ? text[selectedArea] : text.switchWorkspace,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const area = availableAreas.find((area) => area === event.currentTarget.value);
          // Keep the supplied selection until native navigation accepts a new model.
          event.currentTarget.value = selectedArea;
          if (!model.pending && area && area !== model.area) void callbacks.onNavigate(area);
        }
      }, selectedArea ? null : h("option", { value: "", disabled: true }, text.switchWorkspace),
      ...availableAreas.map((area) => h("option", { key: area, value: area }, text[area])))
    ) : null,
    h("div", { className: "research-shell-areas", "aria-busy": model.pending },
      ...availableAreas.map((area) => h("button", {
        key: area, type: "button", className: "research-shell-button research-shell-area",
        "data-research-area": area, "aria-current": model.area === area ? "page" : undefined,
        "aria-controls": area === "reading" ? "reader-panel" : "data-workspace",
        disabled: model.pending, title: text[area], "aria-label": text[area],
        onClick: () => { if (!model.pending) void callbacks.onNavigate(area); }
      }, icon(area), h("span", { className: "research-shell-label", "aria-hidden": true }, compact[area])))
    ),
    h("div", { className: "research-shell-panels", role: "group", "aria-label": text.panels },
      h("button", {
        type: "button", className: "research-shell-button", title: text.assistant,
        "aria-label": text.assistant, "aria-controls": "assistant-panel", onClick: callbacks.onAssistant
      }, icon("assistant"), h("span", { className: "research-shell-label" }, text.assistant))
    )
  );
}
