import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { GuestIdentity } from "./guest-access";

export { mountHeaderSettings } from "./header-settings";
export type {
  HeaderSettingsHandle,
  MountHeaderSettingsOptions
} from "./header-settings";
export { mountTranslationPanel } from "./translation";
export type {
  MountTranslationPanelOptions,
  TranslationPanelCallbacks,
  TranslationPanelHandle,
  TranslationPanelModel,
  TranslationRecordRequest
} from "./translation";
export { mountTranslationLibrary } from "./translation-library";
export type {
  MountTranslationLibraryOptions,
  TranslationLibraryCallbacks,
  TranslationLibraryHandle,
  TranslationLibraryItem,
  TranslationLibraryModel
} from "./translation-library";
export { mountFlowReader } from "./flow-reading";
export type {
  FlowReaderCallbacks,
  FlowReaderHandle,
  FlowReaderModel,
  FlowRect,
  MountFlowReaderOptions
} from "./flow-reading";
export { mountSourcePreparation } from "./source-preparation";
export type {
  MountSourcePreparationOptions,
  SourcePreparationCallbacks,
  SourcePreparationHandle,
  SourcePreparationLanguage,
  SourcePreparationModel,
  SourcePreparationPaper
} from "./source-preparation";
export { mountDeviceAI } from "./device-ai";
export type {
  DeviceAICallbacks,
  DeviceAIHandle,
  DeviceAILanguage,
  DeviceAIModel,
  DeviceAINoteSave,
  DeviceAISource,
  DeviceAISourceSegment,
  MountDeviceAIOptions
} from "./device-ai";
export { mountDeviceAssistant } from "./device-assistant";
export type {
  DeviceAssistantCallbacks,
  DeviceAssistantHandle,
  DeviceAssistantLanguage,
  DeviceAssistantMaterial,
  DeviceAssistantModel,
  DeviceAssistantNote,
  DeviceAssistantNoteSave,
  DeviceAssistantOwner,
  DeviceAssistantReaderAction,
  DeviceAssistantResult,
  DeviceAssistantSourceSegment,
  MountDeviceAssistantOptions
} from "./device-assistant";

export type WorkspaceLanguage = "zh" | "en";

export interface WorkspaceDocument {
  id: string;
  title?: string | null;
  original_filename?: string | null;
  page_count: number;
}

export interface WorkspaceShellModel {
  language: WorkspaceLanguage;
  documents: readonly WorkspaceDocument[];
  activeDocumentId: string | null;
  openMenuDocumentId: string | null;
}

export interface DocumentMenuPoint {
  x: number;
  y: number;
}

export interface WorkspaceShellCallbacks {
  onOpenDocument: (documentId: string) => void;
  onDocumentMenu: (
    documentId: string,
    anchor: HTMLButtonElement,
    point?: DocumentMenuPoint
  ) => void;
}

export interface MountWorkspaceShellOptions {
  identityContainer: HTMLElement;
  documentsContainer: HTMLUListElement;
  model: WorkspaceShellModel;
  callbacks: WorkspaceShellCallbacks;
  onMounted?: () => void;
}

export interface WorkspaceShellHandle {
  update: (model: WorkspaceShellModel) => boolean;
  destroy: () => void;
}

interface ShellRegistration {
  identityContainer: HTMLElement;
  documentsContainer: HTMLUListElement;
  identityRoot: Root;
  documentsRoot: Root;
  callbacks: WorkspaceShellCallbacks;
  active: boolean;
}

const identityOwners = new WeakMap<HTMLElement, ShellRegistration>();
const documentsOwners = new WeakMap<HTMLUListElement, ShellRegistration>();

const strings = {
  zh: {
    untitled: "未命名文献",
    documentMenu: "文献操作",
    pages: (count: number) => `${count} 页`
  },
  en: {
    untitled: "Untitled paper",
    documentMenu: "Paper actions",
    pages: (count: number) => `${count} pages`
  }
} as const;

function DocumentCatalogue({ model, callbacks }: {
  model: WorkspaceShellModel;
  callbacks: WorkspaceShellCallbacks;
}) {
  const copy = strings[model.language];
  return model.documents.map((document) => {
    const title = document.title || document.original_filename || copy.untitled;
    return (
      <li
        className="document-item"
        data-document-id={document.id}
        data-active={model.activeDocumentId === document.id}
        key={document.id}
        onContextMenu={(event) => {
          event.preventDefault();
          const anchor = event.currentTarget.querySelector<HTMLButtonElement>('[data-action="document-menu"]');
          if (anchor) {
            callbacks.onDocumentMenu(document.id, anchor, { x: event.clientX, y: event.clientY });
          }
        }}
      >
        <button
          className="document-open"
          type="button"
          title={title}
          onClick={() => callbacks.onOpenDocument(document.id)}
        >
          <span className="document-name">{title}</span>
          <span className="document-meta">{copy.pages(document.page_count)}</span>
        </button>
        <button
          className="document-menu-button"
          type="button"
          data-action="document-menu"
          title={copy.documentMenu}
          aria-label={`${copy.documentMenu}: ${title}`}
          aria-haspopup="menu"
          aria-expanded={model.openMenuDocumentId === document.id}
          onClick={(event) => {
            event.stopPropagation();
            callbacks.onDocumentMenu(document.id, event.currentTarget);
          }}
        >
          ⋯
        </button>
      </li>
    );
  });
}

function render(registration: ShellRegistration, model: WorkspaceShellModel) {
  registration.identityRoot.render(<GuestIdentity language={model.language} />);
  registration.documentsRoot.render(
    <DocumentCatalogue model={model} callbacks={registration.callbacks} />
  );
}

function destroy(registration: ShellRegistration) {
  if (!registration.active) return;
  registration.active = false;
  if (identityOwners.get(registration.identityContainer) === registration) {
    identityOwners.delete(registration.identityContainer);
  }
  if (documentsOwners.get(registration.documentsContainer) === registration) {
    documentsOwners.delete(registration.documentsContainer);
  }
  registration.identityRoot.unmount();
  registration.documentsRoot.unmount();
}

interface CatalogueFocus {
  documentId: string;
  control: "open" | "menu";
}

function captureCatalogueFocus(container: HTMLUListElement): CatalogueFocus | null {
  const active = container.ownerDocument.activeElement;
  if (!active || !container.contains(active)) return null;
  const control = active.closest<HTMLButtonElement>('.document-open, [data-action="document-menu"]');
  if (!control || !container.contains(control)) return null;
  const item = control.closest<HTMLElement>("[data-document-id]");
  const documentId = item?.dataset.documentId;
  if (!item || !container.contains(item) || !documentId) return null;
  return {
    documentId,
    control: control.matches('[data-action="document-menu"]') ? "menu" : "open"
  };
}

function restoreCatalogueFocus(container: HTMLUListElement, focus: CatalogueFocus | null) {
  if (!focus) return;
  const item = Array.from(container.querySelectorAll<HTMLElement>("[data-document-id]"))
    .find((candidate) => candidate.dataset.documentId === focus.documentId);
  const selector = focus.control === "menu" ? '[data-action="document-menu"]' : ".document-open";
  item?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
}

function captureCatalogueScroll(container: HTMLUListElement) {
  const positions: { element: HTMLElement; left: number; top: number }[] = [];
  for (let element: HTMLElement | null = container; element; element = element.parentElement) {
    positions.push({ element, left: element.scrollLeft, top: element.scrollTop });
  }
  return () => {
    positions.forEach(({ element, left, top }) => {
      if (!element.isConnected) return;
      element.scrollLeft = left;
      element.scrollTop = top;
    });
  };
}

function validateMountHosts(identityContainer: HTMLElement, documentsContainer: HTMLUListElement) {
  if (!(identityContainer instanceof HTMLElement) || !(documentsContainer instanceof HTMLUListElement)) {
    throw new TypeError("Workspace shell mount hosts must be compatible elements");
  }
  if (
    identityContainer === documentsContainer
    || identityContainer.contains(documentsContainer)
    || documentsContainer.contains(identityContainer)
  ) {
    throw new Error("Workspace shell mount hosts must be distinct, non-overlapping subtrees");
  }
}

function createWorkspaceRoots(identityContainer: HTMLElement, documentsContainer: HTMLUListElement) {
  const identityRoot = createRoot(identityContainer);
  try {
    return { identityRoot, documentsRoot: createRoot(documentsContainer) };
  } catch (error) {
    identityRoot.unmount();
    throw error;
  }
}

export function mountWorkspaceShell({
  identityContainer,
  documentsContainer,
  model,
  callbacks,
  onMounted
}: MountWorkspaceShellOptions): WorkspaceShellHandle {
  validateMountHosts(identityContainer, documentsContainer);
  const focus = captureCatalogueFocus(documentsContainer);
  const restoreCatalogueScroll = captureCatalogueScroll(documentsContainer);
  const previous = new Set<ShellRegistration>();
  const identityOwner = identityOwners.get(identityContainer);
  const documentsOwner = documentsOwners.get(documentsContainer);
  if (identityOwner) previous.add(identityOwner);
  if (documentsOwner) previous.add(documentsOwner);
  previous.forEach(destroy);

  const registration: ShellRegistration = {
    identityContainer,
    documentsContainer,
    ...createWorkspaceRoots(identityContainer, documentsContainer),
    callbacks,
    active: true
  };
  identityOwners.set(identityContainer, registration);
  documentsOwners.set(documentsContainer, registration);
  flushSync(() => render(registration, model));
  restoreCatalogueScroll();
  restoreCatalogueFocus(documentsContainer, focus);
  onMounted?.();

  return {
    update(nextModel) {
      if (
        !registration.active
        || identityOwners.get(identityContainer) !== registration
        || documentsOwners.get(documentsContainer) !== registration
      ) return false;
      render(registration, nextModel);
      return true;
    },
    destroy() {
      destroy(registration);
    }
  };
}
