const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/reader-editor-position.js'), 'utf8').replace('export ', '') + '\nglobalThis.place = readerEditorPlacement', context);
const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const stage = box(0, 207, 390, 560), viewport = box(0, 0, 390, 620);
const place = (extra = {}) => context.place({stage, viewport, anchor:box(40,330,300,410), width:360, height:216, ...extra});
function contained(r, bounds, width=360, height=216) {
  assert(r); assert(r.left >= bounds.left + 8); assert(r.top >= bounds.top + 8);
  assert(r.left + Math.min(width,r.maxWidth) <= bounds.right - 8);
  assert(r.top + Math.min(height,r.maxHeight) <= bounds.bottom - 8);
}
test('short mobile screen keeps editor above bottom navigation within reader', () => {
  const r=place(); contained(r,stage); assert.equal(r.top,336); assert.equal(r.left,22);
});
test('editor uses nearby space above or below the shape, then clamps at reader edge', () => {
  assert.equal(place({anchor:box(40,500,300,540)}).top,280);
  assert.equal(place({anchor:box(40,220,300,250)}).top,254);
  assert.equal(place({anchor:box(40,-200,300,-100)}).top,215);
});
test('narrow reader and reduced viewport bound width and enable internal scrolling', () => {
  const small=box(0,207,320,400),r=place({stage:small,viewport:box(0,0,320,460)});
  contained(r,small); assert.equal(r.maxWidth,304); assert.equal(r.maxHeight,177);
});
test('visual viewport offsets and desktop reader column are respected', () => {
  contained(place({viewport:box(12,250,370,500)}),box(12,250,370,500));
  const column=box(300,180,1000,850),r=place({stage:column,viewport:box(0,0,1440,900),anchor:box(950,700,990,760)});
  contained(r,column); assert.equal(r.left,632); assert.equal(r.top,480);
});
test('invalid or empty geometry cannot position an editor', () => {
  for(const extra of [{stage:null},{stage:box(0,0,0,1)},{viewport:box(NaN,0,390,620)},{anchor:box(1,1,Infinity,2)},{width:0},{height:-1},{height:NaN},{stage:box(0,700,390,800)},{stage:box(0,0,10,10)}])assert.equal(place(extra),null);
});
