import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

export type NoteControlLanguage = "zh" | "en";
export type NoteControlAction = "annotation" | "assistant" | "edit" | "delete" | "review";
export type NoteFilterField = "query" | "color" | "kind";

export interface NoteAnnotationControl {
  kind: "highlight" | "underline";
  color: "yellow" | "green" | "blue" | "pink";
}

export interface NoteControlModel {
  noteId: string;
  language: NoteControlLanguage;
  disabled: boolean;
  masteryLevel: number;
  reviewStatus: "unreviewed" | "source_checked";
  annotation: NoteAnnotationControl | null;
  canOpenAnnotation: boolean;
  canShare: boolean;
}

export interface NoteControlCallbacks {
  onMastery: (noteId: string, level: number) => void;
  onStyle: (noteId: string, change: Partial<NoteAnnotationControl>) => void;
  onAction: (noteId: string, action: NoteControlAction) => void;
}

export interface MountNoteControlsOptions {
  container: HTMLElement;
  model: NoteControlModel;
  callbacks: NoteControlCallbacks;
  onMounted?: () => void;
}

export interface NoteControlsHandle {
  update: (model: NoteControlModel) => boolean;
  destroy: () => void;
}

export interface NoteFilterModel {
  language: NoteControlLanguage;
  query: string;
  color: string;
  kind: string;
}

export interface MountNoteFiltersOptions {
  container: HTMLElement;
  model: NoteFilterModel;
  onChange: (field: NoteFilterField, value: string) => void;
  onMounted?: () => void;
}

export interface NoteFiltersHandle {
  update: (model: NoteFilterModel) => boolean;
  destroy: () => void;
}

const strings = {
  zh: {
    mastery: "掌握程度",
    masteryLevel: (level: number) => `掌握程度：${level} 星（共 5 星）`,
    clearMastery: "清除掌握程度评分",
    annotationKind: "标注类型",
    annotationColor: "标注颜色",
    highlight: "高亮",
    underline: "下划线",
    yellow: "黄色",
    green: "绿色",
    blue: "蓝色",
    pink: "粉色",
    black: "黑色",
    red: "红色",
    annotation: "批注操作",
    assistant: "加入助手",
    edit: "编辑",
    delete: "删除",
    more: "更多笔记操作",
    reviewChecked: "已核对引文原文",
    reviewUnreviewed: "待核对引文原文",
    markChecked: "标记引文原文已核对",
    markUnchecked: "将引文原文改为待核对",
    filterText: "筛选笔记",
    filterPlaceholder: "搜索正文或原始引文",
    filterOptions: "颜色和类型筛选",
    filterOptionsActive: "颜色和类型筛选（已启用）",
    all: "全部",
    rectangle: "矩形",
    arrow: "箭头",
    line: "直线",
    ellipse: "圆形",
    ink: "手绘",
    textbox: "文本框"
  },
  en: {
    mastery: "Mastery",
    masteryLevel: (level: number) => `Mastery: ${level} of 5 stars`,
    clearMastery: "Clear mastery rating",
    annotationKind: "Annotation type",
    annotationColor: "Annotation color",
    highlight: "Highlight",
    underline: "Underline",
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
    pink: "Pink",
    black: "Black",
    red: "Red",
    annotation: "Annotation actions",
    assistant: "Add to assistant",
    edit: "Edit",
    delete: "Delete",
    more: "More note actions",
    reviewChecked: "Quoted source checked",
    reviewUnreviewed: "Quoted source needs checking",
    markChecked: "Mark quoted source checked",
    markUnchecked: "Mark quoted source needs checking",
    filterText: "Filter notes",
    filterPlaceholder: "Search note text or original quote",
    filterOptions: "Color and type filters",
    filterOptionsActive: "Color and type filters (active)",
    all: "All",
    rectangle: "Rectangle",
    arrow: "Arrow",
    line: "Line",
    ellipse: "Ellipse",
    ink: "Freehand",
    textbox: "Text box"
  }
} as const;

type Copy = (typeof strings)["en"] | (typeof strings)["zh"];
type IconName = "highlight" | "underline" | "annotation" | "assistant" | "edit" | "delete" | "more" | "source" | "filter" | "rectangle" | "arrow" | "line" | "ellipse" | "ink" | "textbox";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    highlight: <><path d="m9 15-4 4 1 1 4-4M10 5l9 9-5 5-9-9zM3 22h10" /></>,
    underline: <><path d="M6 3v7a6 6 0 0 0 12 0V3M5 21h14" /></>,
    annotation: <><path d="M4 5h16v12H9l-5 4V5Z" /><path d="M8 9h8M8 13h5" /></>,
    assistant: <><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z" /><path d="M9 11h6M12 8v6" /></>,
    edit: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20ZM13.5 8l3 3" /></>,
    delete: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    source: <><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><path d="m9 15 6-6M10 9h5v5" /></>,
    filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />,
    rectangle: <rect x="3" y="4" width="18" height="16" rx="1" />,
    arrow: <path d="M3 17 17 3m-7 0h7v7" />,
    line: <path d="M4 20 20 4" />,
    ellipse: <ellipse cx="12" cy="12" rx="9" ry="7" />,
    ink: <path d="M3 15c3-7 5-10 7-7s1 8 4 7 2-6 4-5 1 4 3 5" />,
    textbox: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M7 9h10M7 13h7" /></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

function masteryValue(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
}

function MasteryControl({ model, callbacks, copy }: {
  model: NoteControlModel;
  callbacks: NoteControlCallbacks;
  copy: Copy;
}) {
  const level = masteryValue(model.masteryLevel);
  return (
    <div className="note-mastery" role="group" aria-label={copy.mastery}>
      <span className="note-control-label">{copy.mastery}</span>
      <div className="note-mastery-stars">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            className="note-mastery-star"
            type="button"
            data-mastery-level={value}
            aria-label={copy.masteryLevel(value)}
            aria-pressed={level === value}
            title={copy.masteryLevel(value)}
            disabled={model.disabled}
            onClick={() => callbacks.onMastery(model.noteId, value)}
            key={value}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-filled={value <= level}>
              <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function StyleControls({ model, callbacks, copy }: {
  model: NoteControlModel;
  callbacks: NoteControlCallbacks;
  copy: Copy;
}) {
  const annotation = model.annotation;
  if (!annotation) return null;
  return (
    <div className="note-style-controls">
      <div className="note-kind-control" role="group" aria-label={copy.annotationKind}>
        {(["highlight", "underline"] as const).map((kind) => (
          <button
            className="note-icon-button"
            type="button"
            data-action="annotation-kind"
            data-value={kind}
            aria-label={copy[kind]}
            aria-pressed={annotation.kind === kind}
            title={copy[kind]}
            disabled={model.disabled}
            onClick={() => callbacks.onStyle(model.noteId, { kind })}
            key={kind}
          >
            <Icon name={kind} />
          </button>
        ))}
      </div>
      <div className="note-color-control" role="group" aria-label={copy.annotationColor}>
        {(["yellow", "green", "blue", "pink"] as const).map((color) => (
          <button
            className="note-color-button"
            type="button"
            data-action="annotation-color"
            data-value={color}
            aria-label={copy[color]}
            aria-pressed={annotation.color === color}
            title={copy[color]}
            disabled={model.disabled}
            onClick={() => callbacks.onStyle(model.noteId, { color })}
            key={color}
          >
            <span className="note-color-swatch" data-color={color} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ action, label, icon, disabled, onClick, danger = false }: {
  action: string;
  label: string;
  icon: IconName;
  disabled: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className="note-icon-button"
      type="button"
      data-action={action}
      data-danger={danger || undefined}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function NoteControls({ model, callbacks }: {
  model: NoteControlModel;
  callbacks: NoteControlCallbacks;
}) {
  const copy = strings[model.language];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const checked = model.reviewStatus === "source_checked";

  function closeMenu(restoreFocus: boolean) {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuTriggerRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (model.disabled) setMenuOpen(false);
  }, [model.disabled]);

  useEffect(() => {
    if (!menuOpen) return;
    const container = menuContainerRef.current;
    const frame = requestAnimationFrame(() => container?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    const outside = (event: PointerEvent) => {
      if (container && event.target instanceof Node && !container.contains(event.target)) closeMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
    };
  }, [menuOpen]);

  function menuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuContainerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1 + items.length) % items.length : (current - 1 + items.length) % items.length;
    items[next].focus();
  }

  return (
    <div className="note-react-controls">
      <MasteryControl model={model} callbacks={callbacks} copy={copy} />
      <StyleControls model={model} callbacks={callbacks} copy={copy} />
      <div className="note-actions note-react-actions">
        {model.canOpenAnnotation && <ActionButton action="annotation-actions" label={copy.annotation} icon="source" disabled={model.disabled} onClick={() => callbacks.onAction(model.noteId, "annotation")} />}
        {model.canShare && <ActionButton action="annotation-agent" label={copy.assistant} icon="assistant" disabled={model.disabled} onClick={() => callbacks.onAction(model.noteId, "assistant")} />}
        <ActionButton action="edit-note" label={copy.edit} icon="edit" disabled={model.disabled} onClick={() => callbacks.onAction(model.noteId, "edit")} />
        <ActionButton action="delete-note" label={copy.delete} icon="delete" danger disabled={model.disabled} onClick={() => callbacks.onAction(model.noteId, "delete")} />
        <div className="note-more" ref={menuContainerRef} onKeyDown={menuKeys}>
          <button
            ref={menuTriggerRef}
            className="note-icon-button"
            type="button"
            data-action="note-more"
            aria-label={copy.more}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={copy.more}
            disabled={model.disabled}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div className="note-more-menu" role="menu" aria-label={copy.more}>
              <p className="note-review-status" data-status={model.reviewStatus}>{checked ? copy.reviewChecked : copy.reviewUnreviewed}</p>
              <button
                className="note-review-action note-mastery-clear"
                type="button"
                role="menuitem"
                data-mastery-level="0"
                disabled={model.disabled || masteryValue(model.masteryLevel) === 0}
                onClick={() => {
                  closeMenu(true);
                  callbacks.onMastery(model.noteId, 0);
                }}
              >
                {copy.clearMastery}
              </button>
              <button
                className="note-review-action"
                type="button"
                role="menuitem"
                data-action="review-note"
                onClick={() => {
                  closeMenu(true);
                  callbacks.onAction(model.noteId, "review");
                }}
              >
                {checked ? copy.markUnchecked : copy.markChecked}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const filterColors = ["all", "yellow", "green", "blue", "pink", "black", "red"] as const;
const filterKinds = ["all", "highlight", "underline", "rectangle", "arrow", "line", "ellipse", "ink", "textbox"] as const;

function NoteFilters({ model, onChange }: {
  model: NoteFilterModel;
  onChange: (field: NoteFilterField, value: string) => void;
}) {
  const copy = strings[model.language];
  const [optionsOpen, setOptionsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsId = useId();
  const optionsActive = model.color !== "all" || model.kind !== "all";
  const optionsLabel = optionsActive ? copy.filterOptionsActive : copy.filterOptions;

  function closeOptions(restoreFocus: boolean) {
    setOptionsOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (!optionsOpen) return;
    const outside = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) closeOptions(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [optionsOpen]);

  return (
    <div
      className="note-filter-react"
      ref={containerRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && optionsOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeOptions(true);
        }
      }}
    >
      <div className="note-filter-search-row">
        <label className="note-filter-query">
          <span>{copy.filterText}</span>
          <input
            type="search"
            value={model.query}
            maxLength={200}
            autoComplete="off"
            placeholder={copy.filterPlaceholder}
            onChange={(event) => onChange("query", event.target.value)}
          />
        </label>
        <button
          ref={triggerRef}
          className="note-icon-button note-filter-disclosure"
          type="button"
          data-action="filter-options"
          data-active={optionsActive}
          aria-label={optionsLabel}
          aria-expanded={optionsOpen}
          aria-controls={optionsId}
          title={optionsLabel}
          onClick={() => setOptionsOpen((open) => !open)}
        >
          <Icon name="filter" />
        </button>
      </div>
      {optionsOpen && (
        <div className="note-filter-options" id={optionsId}>
          <div className="note-filter-row">
            <span className="note-control-label">{copy.annotationColor}</span>
            <div className="note-filter-swatches" role="group" aria-label={copy.annotationColor}>
              {filterColors.map((color) => (
                <button
                  className={color === "all" ? "note-filter-all" : "note-color-button"}
                  type="button"
                  aria-label={color === "all" ? copy.all : copy[color]}
                  aria-pressed={model.color === color}
                  title={color === "all" ? copy.all : copy[color]}
                  onClick={() => onChange("color", color)}
                  key={color}
                >
                  {color === "all" ? copy.all : <span className="note-color-swatch" data-color={color} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
          <div className="note-filter-row">
            <span className="note-control-label">{copy.annotationKind}</span>
            <div className="note-filter-kinds" role="group" aria-label={copy.annotationKind}>
              {filterKinds.map((kind) => (
                <button
                  className={kind === "all" ? "note-filter-all" : "note-icon-button"}
                  type="button"
                  aria-label={kind === "all" ? copy.all : copy[kind]}
                  aria-pressed={model.kind === kind}
                  title={kind === "all" ? copy.all : copy[kind]}
                  onClick={() => onChange("kind", kind)}
                  key={kind}
                >
                  {kind === "all" ? copy.all : <Icon name={kind} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Registration<M> {
  container: HTMLElement;
  root: Root;
  active: boolean;
}

const noteOwners = new WeakMap<HTMLElement, Registration<NoteControlModel>>();
const filterOwners = new WeakMap<HTMLElement, Registration<NoteFilterModel>>();

function destroyRegistration<M>(owners: WeakMap<HTMLElement, Registration<M>>, registration: Registration<M>) {
  if (!registration.active) return;
  registration.active = false;
  if (owners.get(registration.container) === registration) owners.delete(registration.container);
  registration.root.unmount();
}

function validateContainer(container: HTMLElement) {
  if (!(container instanceof HTMLElement)) throw new TypeError("Note control mount host must be an HTML element");
}

export function mountNoteControls({ container, model, callbacks, onMounted }: MountNoteControlsOptions): NoteControlsHandle {
  validateContainer(container);
  const previous = noteOwners.get(container);
  if (previous) destroyRegistration(noteOwners, previous);
  const registration: Registration<NoteControlModel> = { container, root: createRoot(container), active: true };
  noteOwners.set(container, registration);
  const render = (nextModel: NoteControlModel) => registration.root.render(<NoteControls model={nextModel} callbacks={callbacks} />);
  flushSync(() => render(model));
  onMounted?.();
  return {
    update(nextModel) {
      if (!registration.active || noteOwners.get(container) !== registration) return false;
      render(nextModel);
      return true;
    },
    destroy() {
      destroyRegistration(noteOwners, registration);
    }
  };
}

export function mountNoteFilters({ container, model, onChange, onMounted }: MountNoteFiltersOptions): NoteFiltersHandle {
  validateContainer(container);
  const previous = filterOwners.get(container);
  if (previous) destroyRegistration(filterOwners, previous);
  const registration: Registration<NoteFilterModel> = { container, root: createRoot(container), active: true };
  filterOwners.set(container, registration);
  const render = (nextModel: NoteFilterModel) => registration.root.render(<NoteFilters model={nextModel} onChange={onChange} />);
  flushSync(() => render(model));
  onMounted?.();
  return {
    update(nextModel) {
      if (!registration.active || filterOwners.get(container) !== registration) return false;
      render(nextModel);
      return true;
    },
    destroy() {
      destroyRegistration(filterOwners, registration);
    }
  };
}
