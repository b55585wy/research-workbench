import { createElement as h, type SyntheticEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

type Language = "zh" | "en";
type Slide = { title: string; body: readonly string[]; source_refs: readonly string[]; chart_id: null };
type State = {
  plan: { id: string; title: string; page_range: string };
  phase: string;
  outline: { title: string; slides: readonly Slide[] } | null;
  error: string | null;
  expanded: boolean;
};
type Controller = {
  readonly state: State;
  subscribe: (listener: () => void) => () => void;
  generate: () => Promise<boolean>;
  download: () => Promise<boolean>;
  setExpanded: (expanded: boolean) => void;
};
const copy = {
  en: {
    pages: "Pages", generate: "Generate PPT", retry: "Retry generation", prepared: "Ready to generate",
    checking: "Checking source…", generating: "Generating PPT…", ready: "PPT ready", exporting: "Preparing download…",
    downloaded: "PPT downloaded", error: "Generation failed", preview: "Slide preview", download: "Download PPTX",
    source_changed: "The source changed. Prepare a new plan.", source_unavailable: "The source is unavailable.",
    request_failed: "The request failed. You can retry.", owner_changed: "The request stopped when you left this chat."
  },
  zh: {
    pages: "页码", generate: "生成 PPT", retry: "重试生成", prepared: "待生成",
    checking: "正在核对来源…", generating: "正在生成 PPT…", ready: "PPT 已就绪", exporting: "正在准备下载…",
    downloaded: "PPT 已下载", error: "生成失败", preview: "幻灯片预览", download: "下载 PPTX",
    source_changed: "来源已变化，请重新准备方案。", source_unavailable: "来源暂不可用。",
    request_failed: "请求失败，可以重试。", owner_changed: "离开此对话后，请求已停止。"
  }
};

export function AssistantPresentation({ controller, state, language }: { controller: Controller; state: State; language: Language }) {
  const text = copy[language];
  const busy = ["checking", "generating", "exporting"].includes(state.phase);
  const blocked = state.error === "source_changed" || state.error === "source_unavailable";
  return h("section", { className: "assistant-presentation", lang: language, "aria-label": state.plan.title, "aria-busy": busy },
    h("h3", null, state.plan.title),
    h("p", { className: "assistant-presentation-pages" }, `${text.pages} ${state.plan.page_range}`),
    h("p", { className: "assistant-presentation-status", role: "status" }, text[state.phase as keyof typeof text] || text.prepared),
    state.error && h("p", { className: "assistant-presentation-error", role: "alert" }, text[state.error as keyof typeof text] || text.request_failed),
    !state.outline && h("button", { type: "button", className: "button button-primary", disabled: busy || blocked,
      onClick: () => void controller.generate() }, busy ? text[state.phase as keyof typeof text] : state.phase === "error" ? text.retry : text.generate),
    state.outline && h("details", { className: "assistant-presentation-preview", open: state.expanded,
      onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => { if (event.currentTarget.open !== state.expanded) controller.setExpanded(event.currentTarget.open); } },
    h("summary", null, `${text.preview} · ${state.outline.slides.length}`),
    h("ol", null, state.outline.slides.map((slide, index) => h("li", { key: index },
      h("h4", null, slide.title),
      slide.body.length > 0 && h("ul", null, slide.body.map((line, lineIndex) => h("li", { key: lineIndex }, line))))))),
    state.outline && h("button", { type: "button", className: "button button-quiet", disabled: busy || blocked,
      onClick: () => void controller.download() }, state.phase === "exporting" ? text.exporting : text.download));
}

const hosts = new WeakSet<HTMLElement>();
export function mountAssistantPresentation({ container, controller, language }: { container: HTMLElement; controller: Controller; language: Language }) {
  if (hosts.has(container) || container.childNodes.length) throw new Error("Presentation host must be empty and unclaimed");
  hosts.add(container);
  const root = createRoot(container);
  let active = true;
  function render() {
    if (active) flushSync(() => root.render(h(AssistantPresentation, { controller, state: controller.state, language })));
  }
  const unsubscribe = controller.subscribe(render);
  render();
  return { destroy() {
    if (!active) return;
    active = false; unsubscribe(); hosts.delete(container); flushSync(() => root.unmount());
  } };
}
