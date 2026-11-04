function clampRange(range, textLayer) {
  const document = textLayer.ownerDocument;
  const layerRange = document.createRange();
  layerRange.selectNodeContents(textLayer);
  const selected = range.cloneRange();
  if (selected.compareBoundaryPoints(Range.START_TO_START, layerRange) < 0) {
    selected.setStart(layerRange.startContainer, layerRange.startOffset);
  }
  if (selected.compareBoundaryPoints(Range.END_TO_END, layerRange) > 0) {
    selected.setEnd(layerRange.endContainer, layerRange.endOffset);
  }
  layerRange.detach();
  if (selected.collapsed) {
    selected.detach();
    return null;
  }
  return selected;
}

function rangeTextWithBreaks(range) {
  const fragment = range.cloneContents();
  for (const br of fragment.querySelectorAll("br")) {
    br.replaceWith(br.ownerDocument.createTextNode("\n"));
  }
  return fragment.textContent.trim();
}

function unionRect(rects) {
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3]))
  ];
}

function unionClientRect(rects) {
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom))
  };
}

export function collectPdfTextSelection({ selection, records, documentId, sequence, geometry, toolbarPage }) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const segments = [];
  const ordered = [...records].sort((left, right) => left.pageNumber - right.pageNumber);
  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const nativeRange = selection.getRangeAt(rangeIndex);
    for (const record of ordered) {
      const textLayer = record.textLayer;
      if (!record.rendered || !record.textReady || !textLayer?.isConnected || textLayer.dataset.documentId !== documentId) continue;
      const range = clampRange(nativeRange, textLayer);
      if (!range) continue;
      const quote = rangeTextWithBreaks(range);
      const pageGeometry = geometry({ rangeCount: 1, getRangeAt: () => range }, textLayer);
      if (!quote || !pageGeometry?.rects.length) {
        range.detach();
        continue;
      }
      segments.push({
        page: record.pageNumber,
        quote,
        rects: pageGeometry.rects.map((rect) => Object.freeze([...rect])),
        clientRects: pageGeometry.clientRects,
        clientRect: unionClientRect(pageGeometry.clientRects)
      });
      range.detach();
    }
  }
  const byPage = new Map();
  for (const segment of segments) {
    const existing = byPage.get(segment.page);
    if (!existing) {
      byPage.set(segment.page, segment);
      continue;
    }
    existing.quote += `\n${segment.quote}`;
    existing.rects.push(...segment.rects);
    existing.clientRects.push(...segment.clientRects);
    existing.clientRect = unionClientRect(existing.clientRects);
  }
  const pages = [...byPage.values()].sort((left, right) => left.page - right.page);
  if (!pages.length) return null;
  const first = pages[0];
  const toolbarSegment = pages.find((segment) => segment.page === toolbarPage) || first;
  const sourceSegments = pages.length > 1
    ? Object.freeze(pages.map((segment) => Object.freeze({
      page: segment.page,
      quote: segment.quote,
      rects: Object.freeze(segment.rects.map((rect) => Object.freeze([...rect])))
    })))
    : null;
  return {
    documentId,
    page: first.page,
    sequence,
    text: pages.map((segment) => segment.quote).join("\n"),
    rect: unionRect(first.rects),
    rects: first.rects.map((rect) => [...rect]),
    source_segments: sourceSegments,
    selectionPages: Object.freeze(pages.map((segment) => segment.page)),
    clientRect: toolbarSegment.clientRect
  };
}

export function sourceSegmentsFor(note) {
  if (!Array.isArray(note?.source_segments)) return [];
  return note.source_segments.filter((segment) =>
    Number.isInteger(segment?.page) && segment.page >= 1 && segment.page <= 200 &&
    typeof segment.quote === "string" && segment.quote.trim() &&
    Array.isArray(segment.rects) && segment.rects.length
  ).slice(0, 20);
}

export function formatSelectionQuote(selection, language = "zh") {
  const segments = sourceSegmentsFor(selection);
  if (segments.length < 2) return selection?.text || selection?.annotation?.quote || "";
  return segments.map((segment) => language === "zh" ? `第 ${segment.page} 页\n${segment.quote}` : `Page ${segment.page}\n${segment.quote}`).join("\n\n");
}
