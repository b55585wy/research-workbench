import { useLayoutEffect, useRef } from "react";
import { attachNativeHost, type NativeHostLease } from "./native-host";

export function NativeSlot({ host, active, revealVersion, register }: {
  host: HTMLElement;
  active: boolean;
  revealVersion: number;
  register: (lease: NativeHostLease) => () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!slot.current) return;
    const lease = attachNativeHost(host, slot.current);
    const unregister = register(lease);
    return () => { lease.release(); unregister(); };
  }, [host, register]);
  useLayoutEffect(() => {
    if (active && host.tagName === "DETAILS") host.setAttribute("open", "");
  }, [active, host, revealVersion]);
  return <div className="notes-workspace-native-slot" ref={slot} />;
}
