import { createElement as h } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { TeachingData } from "./TeachingData";
import { createTeachingDataController } from "./controller";
import type { MountTeachingDataOptions, TeachingDataHandle } from "./types";

export type * from "./types";

const containers = new WeakSet<HTMLElement>();
let nextId = 0;

export function mountTeachingData(options: MountTeachingDataOptions): TeachingDataHandle {
  const { container, callbacks } = options;
  if (containers.has(container) || container.childNodes.length) throw new Error("Teaching data require an empty unclaimed container");
  const view = container.ownerDocument.defaultView;
  if (!view || !callbacks || [callbacks.onImport, callbacks.onContinue, callbacks.onRefresh].some(fn => typeof fn !== "function")) {
    throw new Error("Teaching data require a document and callbacks");
  }
  const controller = createTeachingDataController(options.model, callbacks, {
    uuid: () => view.crypto.randomUUID(), confirm: message => view.confirm(message)
  });
  const idPrefix = `teaching-data-${++nextId}`;
  let root: Root | null = null;
  let active = true;
  let renderOK = true;
  let failure: unknown;
  let wasOpen = false;
  let lastSelection: string | null = null;
  let unsubscribe = () => {};

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!controller.hasUnsavedWork()) return;
    event.preventDefault(); event.returnValue = "";
  }
  function destroy() {
    if (!active) return;
    active = false; unsubscribe();
    view?.removeEventListener("beforeunload", beforeUnload);
    controller.destroy();
    const owned = root; root = null;
    try { if (owned) flushSync(() => owned.unmount()); }
    finally { containers.delete(container); }
  }
  function render() {
    if (!active || !root) return false;
    const { open, selectedId } = controller.state;
    try {
      failure = undefined;
      flushSync(() => root?.render(h(TeachingData, { controller, state: controller.state, idPrefix })));
      if (failure) throw failure;
      if (wasOpen && !open) container.querySelector<HTMLButtonElement>("[data-teaching-trigger]")?.focus();
      if (!wasOpen && open) container.querySelector<HTMLElement>(".teaching-data-panel button")?.focus();
      if (wasOpen && open && selectedId !== lastSelection) {
        container.querySelector<HTMLElement>(selectedId ? "[data-teaching-review-heading]" : ".teaching-data-panel button")?.focus();
      }
      wasOpen = open; lastSelection = selectedId; renderOK = true;
    } catch (reason) {
      // Keep the controller, request lock and unload guard alive if a later render fails.
      failure = reason; renderOK = false;
    }
    return renderOK;
  }
  containers.add(container);
  try {
    root = createRoot(container, { onUncaughtError: reason => { failure = reason; renderOK = false; } });
    if (!render()) throw failure || new Error("Teaching data failed to mount");
    unsubscribe = controller.subscribe(render);
    view.addEventListener("beforeunload", beforeUnload);
    options.onMounted?.();
  } catch (reason) { try { destroy(); } catch { /* Preserve the original mount error. */ } throw reason; }
  return {
    update(model) { return active && controller.update(model) && renderOK; },
    hasUnsavedWork: () => controller.hasUnsavedWork(),
    prepareNavigation: () => controller.prepareNavigation(),
    destroy
  };
}
