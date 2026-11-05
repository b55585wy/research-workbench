const assert = require("node:assert/strict");
const test = require("node:test");
const { noteMenuBounds, positionNoteMenu } = require("../../web/src/note-menu-position.ts");

// Requirement scenarios, enumerated before tests:
// 1. Original 390x620 left-edge failure, within the notes panel above mobile navigation.
// 2. Desktop notes-column left/right bounds and the closest allowed horizontal position.
// 3. Prefer above when it fits, flip below when needed, and preserve the 4px gap.
// 4. Bound height to the larger short space, including an above-preferred tie, for internal scrolling.
// 5. 320px viewport and panels narrower than the requested menu, without shrinking menu content.
// 6. Empty, negative, nonfinite and overflowing dimensions/coordinates fail safely.
// 7. Visual viewport offsets/keyboard size and intersecting ancestor clipping bounds.
// 8. Offscreen, detached-equivalent, disjoint and edge-touching anchors cannot leave orphan menus.
// 9. Partly clipped anchors remain usable; resize, wrapped content and clipping recompute without mutation.
// Browser-only behavior (focus, callbacks, observers, cleanup, themes, overflow) is reserved for root acceptance.

const box = (left, top, width, height) => ({ left, top, width, height });
const viewport = box(0, 0, 390, 620);
const menu = { width: 240, height: 129 };
const place = (anchor, overrides = {}) => positionNoteMenu({ anchor, menu, viewport, ...overrides });
const right = (rect) => rect.left + rect.width;
const bottom = (rect) => rect.top + rect.height;

function contained(rect, bounds) {
  assert.ok(rect && bounds);
  assert.ok(Object.values(rect).every(Number.isFinite));
  assert.ok(rect.width > 0 && rect.height > 0);
  assert.ok(rect.left >= bounds.left && rect.top >= bounds.top);
  assert.ok(right(rect) <= right(bounds) && bottom(rect) <= bottom(bounds));
}

test("original mobile left-edge failure stays above its trigger and inside notes, clear of navigation", () => {
  const notes = box(0, 100, 390, 450);
  const anchor = box(160, 483, 44, 44);
  const result = place(anchor, { clips: [notes] });
  contained(result, noteMenuBounds(viewport, [notes]));
  assert.deepEqual(result, box(8, 350, 240, 129));
  assert.equal(bottom(result), anchor.top - 4);
  assert.ok(bottom(result) <= bottom(notes));
});

test("desktop menu stays in its own notes column at the nearest allowed horizontal position", () => {
  const desktop = box(0, 0, 1440, 900);
  const notes = box(1120, 80, 320, 720);
  const bounds = noteMenuBounds(desktop, [notes]);
  for (const anchor of [box(1124, 500, 36, 36), box(1360, 500, 36, 36), box(1412, 500, 28, 36)]) {
    const result = place(anchor, { viewport: desktop, clips: [notes] });
    contained(result, bounds);
    const desiredLeft = right(anchor) - menu.width;
    assert.equal(result.left, Math.max(bounds.left, Math.min(desiredLeft, right(bounds) - result.width)));
    assert.equal(bottom(result), anchor.top - 4);
  }
});

test("prefer above when either side fits and flip below only when above cannot fit", () => {
  const anchor = box(180, 250, 44, 44);
  const above = place(anchor);
  assert.equal(bottom(above), anchor.top - 4);
  assert.equal(above.height, menu.height);
  const nearTop = box(180, 20, 44, 44);
  const below = place(nearTop);
  contained(below, noteMenuBounds(viewport));
  assert.equal(below.top, bottom(nearTop) + 4);
  assert.equal(below.height, menu.height);
});

test("short screens cap scrolling height on the larger side and prefer above on a tie", () => {
  const short = box(0, 0, 390, 180);
  const largeMenu = { width: 240, height: 240 };
  for (const [anchorTop, expected] of [[72, box(8, 8, 240, 60)], [25, box(8, 65, 240, 107)], [100, box(8, 8, 240, 88)]]) {
    const anchor = box(80, anchorTop, 36, 36);
    const result = place(anchor, { viewport: short, menu: largeMenu });
    contained(result, noteMenuBounds(short));
    assert.deepEqual(result, expected);
    assert.ok(result.height < largeMenu.height);
  }
});

test("320px viewport and narrow panels cap width to usable bounds without changing requested dimensions", () => {
  const small = box(0, 0, 320, 620);
  for (const notes of [box(12, 100, 296, 440), box(120, 100, 112, 440)]) {
    const anchor = box(notes.left + 8, 460, 44, 44);
    const result = place(anchor, { viewport: small, clips: [notes] });
    const bounds = noteMenuBounds(small, [notes]);
    contained(result, bounds);
    assert.equal(result.width, Math.min(menu.width, bounds.width));
    assert.equal(result.height, menu.height);
  }
  assert.deepEqual(menu, { width: 240, height: 129 });
});

test("empty, invalid and overflowing rectangles/sizes return no placement", () => {
  const anchor = box(80, 300, 44, 44);
  const invalidRects = [null, {}, box(0, 0, 0, 100), box(0, 0, 100, 0), box(0, 0, -1, 100),
    box(NaN, 0, 100, 100), box(0, Infinity, 100, 100), box(0, 0, Infinity, 100),
    box(0, 0, 100, NaN), box(Number.MAX_VALUE, 0, Number.MAX_VALUE, 100)];
  for (const invalid of invalidRects) {
    assert.equal(place(invalid), null);
    assert.equal(place(anchor, { viewport: invalid }), null);
    assert.equal(place(anchor, { clips: [invalid] }), null);
  }
  for (const invalid of [null, {}, { width: 0, height: 100 }, { width: 240, height: -1 },
    { width: NaN, height: 100 }, { width: 240, height: Infinity }]) assert.equal(place(anchor, { menu: invalid }), null);
  assert.equal(place(anchor, { viewport: box(0, 0, 16, 620) }), null);
  assert.equal(place(anchor, { viewport: box(0, 0, 390, 16) }), null);
});

test("visual viewport offsets and keyboard-reduced height are honored in layout coordinates", () => {
  const visual = box(40, 120, 320, 300);
  const anchor = box(268, 280, 44, 44);
  const result = place(anchor, { viewport: visual, menu: { width: 240, height: 120 } });
  contained(result, noteMenuBounds(visual));
  assert.deepEqual(result, box(72, 156, 240, 120));
});

test("all clipping ancestors intersect the viewport and note panel", () => {
  const clips = [box(20, 100, 350, 460), box(30, 180, 300, 330), box(0, 0, 390, 500)];
  const bounds = noteMenuBounds(viewport, clips);
  assert.deepEqual(bounds, box(30, 180, 300, 320));
  const result = place(box(280, 450, 44, 44), { clips });
  for (const clip of clips) contained(result, clip);
  contained(result, bounds);
  assert.equal(bottom(result), 446);
});

test("anchors outside or only touching clipping bounds close; disjoint or filled bounds cannot place a menu", () => {
  const clips = [box(40, 100, 300, 400)];
  for (const anchor of [box(-50, 200, 44, 44), box(340, 200, 44, 44), box(80, 56, 44, 44), box(80, 500, 44, 44)]) {
    assert.equal(place(anchor, { clips }), null);
  }
  assert.equal(place(box(80, 200, 44, 44), { clips: [box(500, 100, 100, 100)] }), null);
  assert.equal(place(box(8, 8, 374, 604)), null);
});

test("partly clipped anchor stays actionable at its visible edge", () => {
  const clips = [box(40, 100, 300, 400)];
  const result = place(box(20, 80, 44, 44), { clips });
  contained(result, noteMenuBounds(viewport, clips));
  assert.equal(result.left, 40);
  assert.equal(result.top, 128);
});

test("resize and wrapped language measurements recompute within bounds without mutating geometry", () => {
  const anchor = Object.freeze(box(180, 250, 44, 44));
  const frozenMenu = Object.freeze({ width: 240, height: 129 });
  const clips = Object.freeze([Object.freeze(box(12, 80, 296, 480))]);
  const first = place(anchor, { menu: frozenMenu, clips });
  const resized = place(anchor, { menu: frozenMenu, clips, viewport: box(0, 0, 320, 320) });
  const wrapped = place(anchor, { menu: { width: 240, height: 260 }, clips, viewport: box(0, 0, 320, 320) });
  contained(first, noteMenuBounds(viewport, clips));
  contained(resized, noteMenuBounds(box(0, 0, 320, 320), clips));
  contained(wrapped, noteMenuBounds(box(0, 0, 320, 320), clips));
  assert.equal(bottom(wrapped), anchor.top - 4);
  assert.equal(wrapped.height, 166);
  assert.equal(place(anchor, { menu: frozenMenu, clips }).top, first.top);
});

test("bounded viewport matrix always stays contained and at the closest permitted position", () => {
  for (const width of [320, 390, 1440]) for (const height of [120, 300, 620]) for (const offset of [0, 80]) {
    const view = box(offset, offset, width, height);
    const bounds = noteMenuBounds(view);
    for (const x of [bounds.left, bounds.left + bounds.width / 2, right(bounds) - 44]) {
      for (const y of [bounds.top, bounds.top + bounds.height / 2 - 22, bottom(bounds) - 44]) {
        const anchor = box(x, y, 44, 44);
        const result = place(anchor, { viewport: view, menu: { width: 400, height: 400 } });
        contained(result, bounds);
        const above = Math.max(0, anchor.top - 4 - bounds.top);
        const below = Math.max(0, bottom(bounds) - bottom(anchor) - 4);
        assert.equal(result.height, Math.min(400, Math.max(above, below)));
        if (above >= 400) assert.equal(bottom(result), anchor.top - 4);
        assert.equal(result.left, Math.max(bounds.left, Math.min(right(anchor) - result.width, right(bounds) - result.width)));
        assert.ok(bottom(result) === anchor.top - 4 || result.top === bottom(anchor) + 4);
      }
    }
  }
});
