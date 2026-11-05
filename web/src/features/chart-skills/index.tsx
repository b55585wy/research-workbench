import { createElement as h } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ChartSkillPicker } from "./ChartSkillPicker";
import { createChartSkillsController } from "./controller";
import type { ChartSkillsHandle, MountChartSkillsOptions } from "./types";

export type * from "./types";
export { validateSkillSpec, validateSkillSnapshot, parseSkillImport } from "./validation";

const containers = new WeakSet<HTMLElement>();
let nextId = 0;

export function mountChartSkills(options: MountChartSkillsOptions): ChartSkillsHandle {
  const { container } = options;
  if (containers.has(container) || container.childNodes.length) throw new Error("Chart skills require an empty unclaimed container");
  const view = container.ownerDocument.defaultView;
  if (!view || typeof options.callbacks?.api !== "function" || typeof options.callbacks?.onSelect !== "function") {
    throw new Error("Chart skills require a document and callbacks");
  }
  const resources = new Map<string, number>();
  const controller = createChartSkillsController(options.model, options.callbacks, {
    confirm: (message) => view.confirm(message), uuid: () => view.crypto.randomUUID(),
    download(spec, id) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json;charset=utf-8" }));
      const link = container.ownerDocument.createElement("a");
      link.href = url; link.download = `figure-skill-${id}.json`;
      try { container.ownerDocument.body.append(link); link.click(); }
      finally {
        link.remove();
        resources.set(url, view.setTimeout(() => { URL.revokeObjectURL(url); resources.delete(url); }, 1000));
      }
    }
  });
  const idPrefix = `chart-skill-${++nextId}`;
  let root: Root | null = null;
  let active = true;
  let failure: unknown;
  let unsubscribe = () => {};
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!controller.hasUnsavedWork()) return;
    event.preventDefault(); event.returnValue = "";
  }
  function destroy() {
    if (!active && !root) return;
    active = false; unsubscribe(); controller.destroy();
    view?.removeEventListener("beforeunload", beforeUnload);
    for (const [url, timer] of resources) { view?.clearTimeout(timer); URL.revokeObjectURL(url); }
    resources.clear(); containers.delete(container);
    const mounted = root; root = null;
    if (mounted) flushSync(() => mounted.unmount());
  }
  function render() {
    if (!active || !root) return false;
    try {
      flushSync(() => root?.render(h(ChartSkillPicker, { controller, state: controller.state, idPrefix })));
      if (failure) throw failure;
      return true;
    } catch (reason) { failure = reason; destroy(); return false; }
  }
  containers.add(container);
  try {
    root = createRoot(container, { onUncaughtError: (reason) => { failure = reason; queueMicrotask(destroy); } });
    if (!render()) throw failure || new Error("Chart skills failed to mount");
    unsubscribe = controller.subscribe(render);
    view.addEventListener("beforeunload", beforeUnload);
    options.onMounted?.();
    void controller.load();
  } catch (reason) { destroy(); throw reason; }
  return {
    update(model) { return active && controller.update(model) && active; },
    hasUnsavedWork: () => controller.hasUnsavedWork(),
    prepareNavigation: () => controller.prepareNavigation(),
    destroy
  };
}
