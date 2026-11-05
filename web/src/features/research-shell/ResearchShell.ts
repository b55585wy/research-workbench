import { createElement as h } from "react";
import type { ResearchArea, ResearchShellCallbacks, ResearchShellModel } from "./contracts";

const copy = {
  zh: {
    navigation: "研究工作区", panels: "工作区面板", reading: "阅读", analysis: "数据分析",
    charts: "科研绘图", presentations: "汇报 PPT", library: "资料", notes: "笔记", assistant: "助手",
    showLibrary: "展开资料栏", hideLibrary: "收起资料栏", showNotes: "展开笔记栏", hideNotes: "收起笔记栏"
  },
  en: {
    navigation: "Research workspace", panels: "Workspace panels", reading: "Reading", analysis: "Data analysis",
    charts: "Scientific charts", presentations: "Presentation (PPT)", library: "Library", notes: "Notes", assistant: "Assistant",
    showLibrary: "Expand library sidebar", hideLibrary: "Collapse library sidebar",
    showNotes: "Expand notes sidebar", hideNotes: "Collapse notes sidebar"
  }
};

const areas: ResearchArea[] = ["reading", "analysis", "charts", "presentations"];
const paths = {
  reading: "M3 5c4-1 7 0 9 2 2-2 5-3 9-2v14c-4-1-7 0-9 2-2-2-5-3-9-2zM12 7v14",
  analysis: "M4 3v18h17M8 16v-5m5 5V6m5 10v-8",
  charts: "M4 3v18h17M7 15l5-7 4 4 5-7M7 15h.01M12 8h.01M16 12h.01",
  presentations: "M3 4h18v12H3zM12 16v5m-5 0 5-5 5 5M7 8h10M7 12h6",
  library: "M3 6h7l2 2h9v12H3zM3 6V4h7l2 2",
  notes: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h4",
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
  const panelActions = [
    { name: "library" as const, label: text[model.libraryVisible ? "hideLibrary" : "showLibrary"],
      expanded: model.libraryVisible, controls: "documents-panel", run: callbacks.onLibrary },
    { name: "notes" as const, label: text[model.notesVisible ? "hideNotes" : "showNotes"],
      expanded: model.notesVisible, controls: "notes-panel", run: callbacks.onNotes },
    { name: "assistant" as const, label: text.assistant, expanded: undefined,
      controls: "assistant-panel", run: callbacks.onAssistant }
  ];
  return h("nav", { className: "research-shell", "aria-label": text.navigation },
    h("div", { className: "research-shell-areas", "aria-busy": model.pending },
      ...areas.filter((area) => !model.availableAreas || model.availableAreas.includes(area)).map((area) => h("button", {
        key: area, type: "button", className: "research-shell-button research-shell-area",
        "data-research-area": area, "aria-current": model.area === area ? "page" : undefined,
        "aria-controls": area === "reading" ? "reader-panel" : "data-workspace",
        disabled: model.pending, title: text[area], "aria-label": text[area],
        onClick: () => { if (!model.pending) void callbacks.onNavigate(area); }
      }, icon(area), h("span", { className: "research-shell-label research-shell-label-full", "aria-hidden": true }, text[area]),
        h("span", { className: "research-shell-label research-shell-label-compact", "aria-hidden": true }, compact[area])))
    ),
    h("div", { className: "research-shell-panels", role: "group", "aria-label": text.panels },
      ...panelActions.map(({ name, label, expanded, controls, run }) => h("button", {
        key: name, type: "button", className: "research-shell-button", title: label,
        "aria-label": label, "aria-controls": controls, "aria-expanded": expanded, onClick: run
      }, icon(name), h("span", { className: "research-shell-label" }, text[name])))
    )
  );
}
