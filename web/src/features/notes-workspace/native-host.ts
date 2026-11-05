export interface NativeHostLease {
  release: () => void;
}

const owners = new WeakMap<HTMLElement, NativeHostLease>();

function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/** The only code allowed to move or decorate a native host subtree. */
export function attachNativeHost(host: HTMLElement, slot: HTMLElement): NativeHostLease {
  const parent = host.parentNode;
  if (!parent || owners.has(host) || slot.childNodes.length || host.contains(slot)
    || host.ownerDocument !== slot.ownerDocument) {
    throw new Error("Notes workspace requires an unclaimed native host and an empty slot");
  }
  const next = host.nextSibling;
  const anchor = host.ownerDocument.createComment(`notes-workspace:${host.id}`);
  const hidden = host.getAttribute("hidden");
  const open = host.getAttribute("open");
  const decorated = host.classList.contains("notes-workspace-native-host");
  const summary = Array.from(host.children).find((child) => child.tagName === "SUMMARY") as HTMLElement | undefined;
  const summaryHidden = summary?.getAttribute("hidden") ?? null;
  const summaryDecorated = summary?.classList.contains("notes-workspace-native-summary");
  let released = false;

  const lease = {
    release() {
      if (released) return;
      released = true;
      if (anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
      else parent.insertBefore(host, next?.parentNode === parent ? next : null);
      anchor.remove();
      restoreAttribute(host, "hidden", hidden);
      restoreAttribute(host, "open", open);
      if (!decorated) host.classList.remove("notes-workspace-native-host");
      if (summary) {
        restoreAttribute(summary, "hidden", summaryHidden);
        if (!summaryDecorated) summary.classList.remove("notes-workspace-native-summary");
      }
      owners.delete(host);
    }
  };
  owners.set(host, lease);
  try {
    parent.insertBefore(anchor, host);
    slot.append(host);
    host.hidden = false;
    if (host.tagName === "DETAILS") host.setAttribute("open", "");
    host.classList.add("notes-workspace-native-host");
    if (summary) {
      summary.hidden = false;
      summary.classList.add("notes-workspace-native-summary");
    }
  } catch (error) {
    lease.release();
    throw error;
  }
  return lease;
}
