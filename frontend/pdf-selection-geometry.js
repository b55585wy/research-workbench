function clippedBox(rect, bounds) {
  const left = Math.max(bounds.left, rect.left);
  const top = Math.max(bounds.top, rect.top);
  const right = Math.min(bounds.right, rect.right);
  const bottom = Math.min(bounds.bottom, rect.bottom);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function continuous(a, b, aProvenance, bProvenance) {
  if (aProvenance.rangeIndex !== bProvenance.rangeIndex ||
      aProvenance.block !== bProvenance.block ||
      aProvenance.axis !== bProvenance.axis) return false;
  const minHeight = Math.min(a.height, b.height);
  const minWidth = Math.min(a.width, b.width);
  const horizontalGap = Math.max(0, a.left - b.right, b.left - a.right);
  const verticalGap = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  const horizontal = aProvenance.axis === 0 &&
    overlap(a.top, a.bottom, b.top, b.bottom) >= minHeight * 0.65 &&
    horizontalGap <= Math.min(1, minHeight * 0.12);
  const vertical = aProvenance.axis === 90 &&
    overlap(a.left, a.right, b.left, b.right) >= minWidth * 0.65 &&
    verticalGap <= Math.min(1, minWidth * 0.12);
  return horizontal || vertical;
}

function unionBox(a, b) {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function selectedNodeRange(range, node, document) {
  if (!range.intersectsNode(node)) return null;
  const nodeRange = document.createRange();
  nodeRange.selectNodeContents(node);
  const selected = range.cloneRange();
  if (selected.compareBoundaryPoints(Range.START_TO_START, nodeRange) < 0) selected.setStart(nodeRange.startContainer, nodeRange.startOffset);
  if (selected.compareBoundaryPoints(Range.END_TO_END, nodeRange) > 0) selected.setEnd(nodeRange.endContainer, nodeRange.endOffset);
  nodeRange.detach();
  if (selected.collapsed) {
    selected.detach();
    return null;
  }
  return selected;
}

function advanceAxis(node, textLayer) {
  const mainRotation = Number.parseFloat(textLayer.dataset.mainRotation) || 0;
  const spanRotation = Number.parseFloat(node.parentElement?.style.getPropertyValue("--rotate")) || 0;
  return (((mainRotation + spanRotation) % 180) + 180) % 180;
}

function selectionEntries(selection, textLayer, bounds) {
  const document = textLayer.ownerDocument;
  const entries = [];
  const seen = new Set();
  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    if (!textLayer.contains(range.commonAncestorContainer)) return null;
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const selected = selectedNodeRange(range, node, document);
      if (!selected) continue;
      const block = node.parentElement?.closest(".markedContent") || textLayer;
      const axis = advanceAxis(node, textLayer);
      for (const clientRect of selected.getClientRects()) {
        const box = clippedBox(clientRect, bounds);
        if (!box) continue;
        const key = [rangeIndex, box.left, box.top, box.right, box.bottom].map((value) => typeof value === "number" ? value.toFixed(3) : value).join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ ...box, rangeIndex, block, axis });
      }
      selected.detach();
    }
  }
  return entries;
}

function mergeContinuous(entries) {
  const boxes = [];
  let current = null;
  for (const entry of entries) {
    if (current && continuous(current.box, entry, current, entry)) {
      current.box = unionBox(current.box, entry);
      continue;
    }
    if (current) boxes.push(current.box);
    current = { box: { ...entry }, rangeIndex: entry.rangeIndex, block: entry.block, axis: entry.axis };
  }
  if (current) boxes.push(current.box);
  return boxes;
}

export function pdfSelectionGeometry(selection, textLayer) {
  const bounds = textLayer.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const entries = selectionEntries(selection, textLayer, bounds);
  if (!entries?.length) return null;
  const boxes = mergeContinuous(entries);
  const rects = boxes.map((box) => [
    (box.left - bounds.left) / bounds.width,
    (box.top - bounds.top) / bounds.height,
    (box.right - bounds.left) / bounds.width,
    (box.bottom - bounds.top) / bounds.height
  ].map((value) => Math.max(0, Math.min(1, value))));
  return { rects, clientRects: boxes };
}
