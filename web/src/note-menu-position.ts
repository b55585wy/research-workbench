export interface NoteMenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface NoteMenuSize {
  width: number;
  height: number;
}

function validSize(size: NoteMenuSize) {
  return Boolean(size) && Number.isFinite(size.width) && size.width > 0
    && Number.isFinite(size.height) && size.height > 0;
}

function validRect(rect: NoteMenuRect) {
  return validSize(rect) && Number.isFinite(rect.left) && Number.isFinite(rect.top)
    && Number.isFinite(rect.left + rect.width) && Number.isFinite(rect.top + rect.height);
}

function intersect(a: NoteMenuRect, b: NoteMenuRect): NoteMenuRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const width = Math.min(a.left + a.width, b.left + b.width) - left;
  const height = Math.min(a.top + a.height, b.top + b.height) - top;
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

export function noteMenuBounds(viewport: NoteMenuRect, clips: readonly NoteMenuRect[] = []): NoteMenuRect | null {
  if (!validRect(viewport) || viewport.width <= 16 || viewport.height <= 16) return null;
  let bounds: NoteMenuRect | null = {
    left: viewport.left + 8,
    top: viewport.top + 8,
    width: viewport.width - 16,
    height: viewport.height - 16
  };
  for (const clip of clips) {
    if (!bounds || !validRect(clip)) return null;
    bounds = intersect(bounds, clip);
  }
  return bounds;
}

export function positionNoteMenu({ anchor, menu, viewport, clips = [] }: {
  anchor: NoteMenuRect;
  menu: NoteMenuSize;
  viewport: NoteMenuRect;
  clips?: readonly NoteMenuRect[];
}): NoteMenuRect | null {
  if (!validRect(anchor) || !validSize(menu)) return null;
  const bounds = noteMenuBounds(viewport, clips);
  const visibleAnchor = bounds && intersect(anchor, bounds);
  if (!bounds || !visibleAnchor) return null;
  const above = Math.max(0, visibleAnchor.top - 4 - bounds.top);
  const below = Math.max(0, bounds.top + bounds.height - visibleAnchor.top - visibleAnchor.height - 4);
  const useAbove = menu.height <= above || (menu.height > below && above >= below);
  const height = Math.min(menu.height, useAbove ? above : below);
  const width = Math.min(menu.width, bounds.width);
  if (height <= 0) return null;
  return {
    left: Math.max(bounds.left, Math.min(anchor.left + anchor.width - width, bounds.left + bounds.width - width)),
    top: useAbove ? visibleAnchor.top - 4 - height : visibleAnchor.top + visibleAnchor.height + 4,
    width,
    height
  };
}
