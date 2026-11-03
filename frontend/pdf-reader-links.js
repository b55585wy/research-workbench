import { EventBus, PDFLinkService } from "/vendor/pdfjs/web/pdf_viewer.mjs";

function supportedLink(annotation, AnnotationType) {
  if (annotation.annotationType !== AnnotationType.LINK || annotation.action || annotation.attachment || annotation.setOCGState || annotation.actions) return false;
  if (annotation.dest) return typeof annotation.dest === "string" || Array.isArray(annotation.dest);
  if (!annotation.url) return false;
  try {
    return ["http:", "https:"].includes(new URL(annotation.url).protocol);
  } catch {
    return false;
  }
}

function guardLinkClicks(record) {
  if (record.linkClickGuard) return;
  const gesture = { pointerId: null, x: 0, y: 0, moved: false, anchor: null };
  const layer = record.linkLayer;
  layer.addEventListener("pointerdown", (event) => {
    gesture.pointerId = event.button === 0 ? event.pointerId : null;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.moved = false;
    gesture.anchor = event.target.closest("a");
  }, true);
  layer.addEventListener("pointermove", (event) => {
    if (event.pointerId === gesture.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3) gesture.moved = true;
  }, true);
  layer.addEventListener("pointercancel", () => { gesture.pointerId = null; }, true);
  layer.addEventListener("click", (event) => {
    if (event.detail === 0 || gesture.pointerId === null) return;
    const exactTarget = gesture.anchor && gesture.anchor === event.target.closest("a");
    if (gesture.moved || !exactTarget || event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    gesture.pointerId = null;
  }, true);
  record.linkClickGuard = gesture;
}

export function createPdfReaderLinks({ pdfjsLib, pdf, currentPage, isCurrent, navigate }) {
  let disposed = false;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, ignoreDestinationZoom: true });
  linkService.setDocument(pdf);
  linkService.setViewer({
    get currentPageNumber() { return currentPage(); },
    set currentPageNumber(value) { if (!disposed) void navigate({ pageNumber: value }); },
    pagesRotation: 0,
    isInPresentationMode: false,
    pageLabelToPageNumber: () => null,
    scrollPageIntoView: (destination) => { if (!disposed) void navigate(destination); }
  });
  const goToDestination = linkService.goToDestination.bind(linkService);
  linkService.goToDestination = async (destination) => {
    if (disposed) return;
    try {
      await goToDestination(destination);
    } catch (error) {
      if (!disposed) throw error;
    }
  };

  async function render(record) {
    guardLinkClicks(record);
    const generation = (record.linkGeneration || 0) + 1;
    record.linkGeneration = generation;
    const current = () => !disposed && record.linkGeneration === generation && isCurrent(record);
    record.linkAnnotationLayer?.destroy();
    record.linkAnnotationLayer = null;
    record.linkLayer.replaceChildren();
    const annotations = (await record.page.getAnnotations({ intent: "display" })).filter((annotation) => supportedLink(annotation, pdfjsLib.AnnotationType));
    if (!current()) return;
    if (!annotations.length) return;
    const layer = new pdfjsLib.AnnotationLayer({
      div: record.linkLayer,
      page: record.page,
      viewport: record.viewport.clone({ dontFlip: true }),
      linkService,
      annotationStorage: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      accessibilityManager: null,
      structTreeLayer: null
    });
    record.linkAnnotationLayer = layer;
    await layer.render({
      annotations,
      renderForms: false,
      downloadManager: null,
      enableComment: false,
      enableScripting: false,
      hasJSActions: false,
      fieldObjects: null,
      imageResourcesPath: "",
      optionalContentConfig: null
    });
    if (!current()) {
      layer.destroy();
      if (record.linkAnnotationLayer === layer) {
        record.linkAnnotationLayer = null;
        record.linkLayer.replaceChildren();
      }
    }
  }

  function rendered(record) {
    if (disposed) return;
    eventBus.dispatch("textlayerrendered", {
      pageNumber: record.pageNumber,
      source: { textLayer: { div: record.textLayer } }
    });
  }

  function destroy() {
    disposed = true;
  }

  return { render, rendered, goToDestination: linkService.goToDestination, destroy };
}
