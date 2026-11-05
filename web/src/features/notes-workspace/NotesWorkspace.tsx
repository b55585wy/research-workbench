import { useId, useRef, type KeyboardEvent } from "react";
import { NativeSlot } from "./NativeSlot";
import type { NativeHostLease } from "./native-host";
import { sections } from "./state";
import type { NotesWorkspaceHosts, NotesWorkspaceModel, NotesWorkspaceSection } from "./types";

const strings = {
  zh: { label: "笔记工作区", saved: "已保存", editor: "编辑", images: "图片", open: "打开编辑器", resume: "继续编辑", draft: "草稿", busy: "处理中" },
  en: { label: "Notes workspace", saved: "Saved", editor: "Editor", images: "Images", open: "Open editor", resume: "Resume editing", draft: "Draft", busy: "Working" }
};

export function NotesWorkspace({ hosts, model, section, revealVersion, onSelect, onOpenEditor, register }: {
  hosts: NotesWorkspaceHosts;
  model: NotesWorkspaceModel;
  section: NotesWorkspaceSection;
  revealVersion: number;
  onSelect: (section: NotesWorkspaceSection) => void;
  onOpenEditor: () => void;
  register: (lease: NativeHostLease) => () => void;
}) {
  const id = useId();
  const tabs = useRef<Partial<Record<NotesWorkspaceSection, HTMLButtonElement>>>({});
  const copy = strings[model.language];
  const draft = model.hasDraft || model.editing;

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, current: NotesWorkspaceSection) {
    const index = sections.indexOf(current);
    const destinations: Record<string, number> = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 };
    const destination = destinations[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    onSelect(sections[destination]);
    tabs.current[sections[destination]]?.focus();
  }

  return (
    <section className="notes-workspace" aria-label={copy.label}>
      <div className="notes-workspace-toolbar">
        <div className="notes-workspace-tabs" role="tablist" aria-label={copy.label}>
          {sections.map((item) => (
            <button type="button" role="tab" className="notes-workspace-tab" key={item}
              id={`${id}-tab-${item}`} aria-controls={`${id}-panel-${item}`}
              aria-selected={section === item} tabIndex={section === item ? 0 : -1}
              ref={(node) => { tabs.current[item] = node || undefined; }}
              onClick={() => onSelect(item)} onKeyDown={(event) => onTabKey(event, item)}>
              <span>{copy[item]}</span>
              {item === "saved" && <span className="notes-workspace-count">{model.noteCount.toLocaleString(model.language)}</span>}
              {item === "editor" && draft && <span className="notes-workspace-draft" title={copy.draft}>
                <span aria-hidden="true">•</span><span className="sr-only">{copy.draft}</span>
              </span>}
            </button>
          ))}
        </div>
        <button type="button" className="notes-workspace-open" hidden={section === "editor"} disabled={model.busy}
          title={draft ? copy.resume : copy.open} aria-label={draft ? copy.resume : copy.open} onClick={onOpenEditor}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20ZM13.5 8l3 3" />
          </svg>
          <span className="sr-only">{draft ? copy.resume : copy.open}</span>
        </button>
      </div>
      <span className="notes-workspace-status sr-only" role="status">{model.busy ? copy.busy : ""}</span>
      {sections.map((item) => (
        <div role="tabpanel" className="notes-workspace-panel" id={`${id}-panel-${item}`}
          aria-labelledby={`${id}-tab-${item}`} aria-busy={model.busy} tabIndex={0}
          hidden={section !== item} key={item}>
          <NativeSlot host={hosts[item]} active={section === item} revealVersion={revealVersion} register={register} />
        </div>
      ))}
    </section>
  );
}
