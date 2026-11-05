import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

type HeaderSettingsLanguage = "zh" | "en";

export interface MountHeaderSettingsOptions {
  container: HTMLElement;
  controls: HTMLElement;
  identity: HTMLElement;
  onMounted?: () => void;
}

export interface HeaderSettingsHandle {
  destroy: () => void;
}

interface HeaderSettingsRegistration {
  root: Root;
  active: boolean;
}

const strings = {
  zh: {
    settings: "工作台设置",
    close: "关闭设置",
    space: "当前空间与存储",
    appearance: "外观与主题",
    language: "语言",
    openingSpace: "正在打开空间…",
    spaceRecovery: "空间保存与恢复"
  },
  en: {
    settings: "Workspace settings",
    close: "Close settings",
    space: "Current space and storage",
    appearance: "Appearance and theme",
    language: "Language",
    openingSpace: "Opening workspace…",
    spaceRecovery: "Space saving and recovery"
  }
} as const;

const owners = new WeakMap<HTMLElement, HeaderSettingsRegistration>();

function pageLanguage(): HeaderSettingsLanguage {
  return document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function NativeControlsSlot({ controls }: { controls: HTMLElement }) {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const anchor = document.createComment("header-settings-native-controls");
    controls.parentNode?.insertBefore(anchor, controls);
    slot.appendChild(controls);
    return () => {
      if (anchor.parentNode) anchor.parentNode.insertBefore(controls, anchor);
      anchor.remove();
    };
  }, [controls]);

  return <div ref={slotRef} className="header-settings-native" />;
}

function HeaderSettings({ container, controls, identity }: Omit<MountHeaderSettingsOptions, "onMounted">) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<HeaderSettingsLanguage>(pageLanguage);
  const [identityText, setIdentityText] = useState("");
  const [hasSpaceAction, setHasSpaceAction] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const copy = strings[language];

  useEffect(() => {
    const refresh = () => {
      const status = identity.querySelector<HTMLElement>(":scope > .local-guest");
      setIdentityText(status?.textContent?.trim() || "");
      setHasSpaceAction(Boolean(identity.querySelector(":scope > .guest-space-badge")));
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(identity, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [identity]);

  useEffect(() => {
    const refresh = () => setLanguage(pageLanguage());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
  }, []);

  function closePanel(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) gearRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) closePanel(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [container, open]);

  function openSpaceAction() {
    setOpen(false);
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      identity.querySelector<HTMLButtonElement>(":scope > .guest-space-badge")?.click();
    }, 0);
  }

  return (
    <div className="header-settings-widget">
      <button
        ref={gearRef}
        className="header-settings-gear button button-quiet"
        type="button"
        aria-label={copy.settings}
        title={copy.settings}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="header-settings-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.04V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.96 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
      </button>
      <section
        id="header-settings-panel"
        className="header-settings-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="header-settings-heading"
        hidden={!open}
      >
        <header className="header-settings-heading-row">
          <h2 id="header-settings-heading">{copy.settings}</h2>
          <button
            ref={closeRef}
            className="header-settings-close button button-quiet"
            type="button"
            aria-label={copy.close}
            title={copy.close}
            onClick={() => closePanel()}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="header-settings-body">
          <section className="header-settings-space" aria-label={copy.space}>
            <h3>{copy.space}</h3>
            <p className="header-settings-identity">{identityText || copy.openingSpace}</p>
            {hasSpaceAction && (
              <button className="button button-secondary header-settings-space-action" type="button" onClick={openSpaceAction}>
                {copy.spaceRecovery}
              </button>
            )}
          </section>
          <h3 className="header-settings-appearance-label">{copy.appearance}</h3>
          <NativeControlsSlot controls={controls} />
          <h3 className="header-settings-language-label">{copy.language}</h3>
        </div>
      </section>
    </div>
  );
}

function validateOptions({ container, controls, identity }: MountHeaderSettingsOptions) {
  if (!(container instanceof HTMLElement) || !(controls instanceof HTMLElement) || !(identity instanceof HTMLElement)) {
    throw new TypeError("Header settings mount hosts must be elements");
  }
  if (container.contains(controls) || container.contains(identity) || controls.contains(container) || identity.contains(container)) {
    throw new Error("Header settings mount hosts must not overlap");
  }
}

export function mountHeaderSettings(options: MountHeaderSettingsOptions): HeaderSettingsHandle {
  validateOptions(options);
  const previous = owners.get(options.container);
  if (previous) {
    previous.active = false;
    previous.root.unmount();
  }
  const registration: HeaderSettingsRegistration = {
    root: createRoot(options.container),
    active: true
  };
  const handle: HeaderSettingsHandle = {
    destroy() {
      if (!registration.active) return;
      registration.active = false;
      if (owners.get(options.container) === registration) owners.delete(options.container);
      registration.root.unmount();
    }
  };
  owners.set(options.container, registration);
  try {
    flushSync(() => {
      registration.root.render(
        <HeaderSettings
          container={options.container}
          controls={options.controls}
          identity={options.identity}
        />
      );
    });
    options.onMounted?.();
    return handle;
  } catch (error) {
    handle.destroy();
    throw error;
  }
}
