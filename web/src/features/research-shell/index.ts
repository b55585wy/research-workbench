import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { ResearchShell } from "./ResearchShell";
import type { MountResearchShellOptions, ResearchShellHandle, ResearchShellModel } from "./contracts";

export type { ResearchArea, ResearchShellModel, ResearchShellCallbacks, ResearchShellHandle } from "./contracts";

const owners = new WeakMap<HTMLElement, ResearchShellHandle>();

export function mountResearchShell({ container, model, callbacks, onMounted }: MountResearchShellOptions): ResearchShellHandle {
  if (!container || container.nodeType !== 1) throw new TypeError("Research shell requires an element host");
  owners.get(container)?.destroy();
  let root: Root | null = createRoot(container);
  function render(next: ResearchShellModel) {
    if (root) flushSync(() => root?.render(createElement(ResearchShell, { model: next, callbacks })));
  }
  const handle: ResearchShellHandle = {
    update(next) {
      if (!root || owners.get(container) !== handle) return false;
      try { render(next); }
      catch (error) { handle.destroy(); throw error; }
      return true;
    },
    destroy() {
      if (!root) return;
      const owned = root;
      root = null;
      if (owners.get(container) === handle) owners.delete(container);
      owned.unmount();
    }
  };
  owners.set(container, handle);
  try {
    render(model);
    onMounted?.();
  } catch (error) {
    handle.destroy();
    throw error;
  }
  return handle;
}
