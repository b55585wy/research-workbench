import { createElement as h, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

type Model = {
  title: string; body: string; language: "zh" | "en"; stepId: string; index: number; total: number;
  layout: { x: number; y: number; width: number; maxHeight: number; arrow: string;
    target: { left: number; top: number; width: number; height: number } };
};
type Action = "previous" | "next" | "skip";
const copy = {
  zh: { label: "功能引导", skip: "跳过", previous: "上一步", next: "下一步", done: "开始使用", close: "关闭引导" },
  en: { label: "Feature guide", skip: "Skip", previous: "Back", next: "Next", done: "Get started", close: "Close guide" }
};

export function FirstUseGuide({ model, onAction }: { model: Model; onAction: (action: Action) => void }) {
  const ref = useRef<HTMLElement>(null);
  const text = copy[model.language];
  useLayoutEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return h("div", { className: "first-use-overlay", lang: model.language },
    h("div", { className: "first-use-spotlight", "aria-hidden": true, style: model.layout.target }),
    h("svg", { className: "first-use-arrow", "aria-hidden": true },
      h("defs", null, h("marker", { id: "first-use-arrow-head", markerWidth: 7, markerHeight: 7, refX: 5, refY: 3, orient: "auto" },
        h("path", { d: "M0,0 L6,3 L0,6 Z", fill: "currentColor" }))),
      h("path", { d: model.layout.arrow, fill: "none", stroke: "currentColor", strokeWidth: 2, markerEnd: "url(#first-use-arrow-head)" })),
    h("section", { ref, className: "first-use-card", role: "dialog", "aria-modal": false, tabIndex: -1,
      "aria-label": text.label, "aria-labelledby": "first-use-title", "aria-describedby": "first-use-body", "data-step": model.stepId,
      style: { left: model.layout.x, top: model.layout.y, width: model.layout.width, maxHeight: model.layout.maxHeight } },
      h("header", null,
        h("span", { className: "first-use-counter", "aria-live": "polite", "aria-atomic": true }, `${text.label} · ${model.index + 1}/${model.total}`),
        h("button", { type: "button", className: "button button-quiet first-use-close", title: text.close, "aria-label": text.close, onClick: () => onAction("skip") },
          h("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true },
            h("path", { d: "m6 6 12 12M18 6 6 18" })))),
      h("h2", { id: "first-use-title", "aria-live": "polite" }, model.title),
      h("p", { id: "first-use-body" }, model.body),
      h("footer", null,
        h("button", { type: "button", className: "button button-quiet", onClick: () => onAction("skip") }, text.skip),
        h("button", { type: "button", className: "button button-quiet", disabled: model.index === 0, onClick: () => onAction("previous") }, text.previous),
        h("button", { type: "button", className: "button button-primary", onClick: () => onAction("next") }, model.index === model.total - 1 ? text.done : text.next))));
}

const owners = new WeakSet<HTMLElement>();
export function mountFirstUseGuide({ container, model, onAction }: { container: HTMLElement; model: Model; onAction: (action: Action) => void }) {
  if (owners.has(container) || container.childNodes.length) throw new Error("Guide host must be empty and unclaimed");
  owners.add(container);
  const root = createRoot(container);
  let active = true;
  const update = (value: Model) => { if (active) flushSync(() => root.render(h(FirstUseGuide, { model: value, onAction }))); };
  const handle = { update, destroy() {
    if (!active) return;
    active = false; owners.delete(container); flushSync(() => root.unmount());
  } };
  try { update(model); return handle; }
  catch (error) { handle.destroy(); throw error; }
}
