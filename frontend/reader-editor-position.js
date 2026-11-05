export function readerEditorPlacement({ stage, viewport, anchor, width, height }) {
  const valid = (box) => box && [box.left, box.top, box.right, box.bottom].every(Number.isFinite) && box.right > box.left && box.bottom > box.top;
  if (!valid(stage) || !valid(viewport) || !valid(anchor) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const left = Math.max(stage.left, viewport.left) + 8;
  const top = Math.max(stage.top, viewport.top) + 8;
  const right = Math.min(stage.right, viewport.right) - 8;
  const bottom = Math.min(stage.bottom, viewport.bottom) - 8;
  if (right <= left || bottom <= top) return null;
  const maxWidth = right - left;
  const maxHeight = bottom - top;
  const actualWidth = Math.min(width, maxWidth);
  const actualHeight = Math.min(height, maxHeight);
  const above = anchor.top - actualHeight - 4;
  const preferredTop = above >= top ? above : anchor.bottom + 4;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  return {
    left: clamp(anchor.left, left, right - actualWidth),
    top: clamp(preferredTop, top, bottom - actualHeight),
    maxWidth,
    maxHeight
  };
}
