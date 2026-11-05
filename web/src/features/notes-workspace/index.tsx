import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { NotesWorkspace } from "./NotesWorkspace";
import type { NativeHostLease } from "./native-host";
import { createNotesWorkspaceState, sections } from "./state";
import type { MountNotesWorkspaceOptions, NotesWorkspaceHandle, NotesWorkspaceSection } from "./types";

export type * from "./types";

const containers = new WeakSet<HTMLElement>();

/** Mount only after the native workspace has finished assembling its hosts. */
export function mountNotesWorkspace(options: MountNotesWorkspaceOptions): NotesWorkspaceHandle {
  const { container, hosts } = options;
  const state = createNotesWorkspaceState(options.model);
  const nativeHosts = sections.map((section) => hosts[section]);
  if (containers.has(container) || container.childNodes.length || new Set(nativeHosts).size !== 3) {
    throw new Error("Notes workspace requires an empty, unclaimed container and three distinct hosts");
  }
  for (const host of nativeHosts) {
    if (!host?.parentNode || host.ownerDocument !== container.ownerDocument || host.contains(container)
      || container.contains(host) || nativeHosts.some((other) => other !== host && host.contains(other))) {
      throw new Error("Notes workspace hosts must be separate native subtrees outside the container");
    }
  }

  let root: Root | null = null;
  let active = true;
  let failure: unknown;
  const leases = new Set<NativeHostLease>();
  const register = (lease: NativeHostLease) => {
    leases.add(lease);
    return () => { leases.delete(lease); };
  };
  function restore() {
    for (const lease of leases) lease.release();
    leases.clear();
  }
  function destroy() {
    if (!active && !root && !leases.size) return;
    active = false;
    restore();
    containers.delete(container);
    const mounted = root;
    root = null;
    if (mounted) flushSync(() => mounted.unmount());
  }
  function fail(error: unknown) {
    failure = error;
    active = false;
    restore();
    // React invokes this during its commit; unmount after that commit completes.
    queueMicrotask(destroy);
  }
  function render() {
    if (!active || !root) return false;
    try {
      flushSync(() => root?.render(
        <NotesWorkspace hosts={hosts} model={state.model} section={state.section} revealVersion={state.revealVersion}
          onSelect={show} register={register} onOpenEditor={() => {
            if (!active || state.model.busy) return;
            show("editor");
            options.callbacks?.onOpenEditor?.();
          }} />
      ));
      if (failure) throw failure;
    } catch (error) {
      destroy();
      throw error;
    }
    return active;
  }
  function show(section: NotesWorkspaceSection) {
    if (!active || !state.show(section)) return false;
    try { return render(); } catch { return false; }
  }

  containers.add(container);
  try {
    root = createRoot(container, { onUncaughtError: fail });
    render();
    if (!active || leases.size !== 3) throw new Error("Notes workspace native slots did not mount");
    options.onMounted?.();
  } catch (error) {
    destroy();
    throw error;
  }
  return {
    update(model) {
      if (!active) return false;
      state.update(model);
      try { return render(); } catch { return false; }
    },
    show,
    destroy
  };
}
