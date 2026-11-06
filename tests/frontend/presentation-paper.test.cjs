const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const modulePromise = import(pathToFileURL(path.join(__dirname, '../../frontend/presentation-paper.js')));

test('blank selects all pages only when the entire paper fits the read limit', async () => {
  const { parsePaperPages } = await modulePromise;
  for (const total of [1, 20, 60]) assert.deepEqual(parsePaperPages('  ', total), { valid: true, pages: null });
  assert.equal(parsePaperPages('', 61).valid, false);
  assert.deepEqual(parsePaperPages('2-4', 1000), { valid: true, pages: [2, 3, 4] });
});

test('explicit ranges, separate pages, whitespace and Chinese punctuation produce sorted page numbers', async () => {
  const { parsePaperPages } = await modulePromise;
  assert.deepEqual(parsePaperPages(' 8， 1–3, 5 - 6 ', 20), { valid: true, pages: [1, 2, 3, 5, 6, 8] });
  assert.equal(parsePaperPages('1-60', 60).pages.length, 60);
});

test('duplicates, reversed/out-of-range/coerced values and oversized ranges cannot submit', async () => {
  const { parsePaperPages } = await modulePromise;
  for (const value of ['0', '-1', '21', '5-2', '1,1', '1-3,3', '1,,2', '1.5', '1e1', 'true', '<b>1</b>', '1-999999999999999999999', '1'.repeat(241), null]) {
    assert.equal(parsePaperPages(value, 20).valid, false, String(value));
  }
  assert.equal(parsePaperPages('1-61', 100).valid, false);
  for (const count of [0, -1, 1.5, NaN, Infinity]) assert.equal(parsePaperPages('1', count).valid, false);
});

test('paper-only body slides keep citations while title-only and mixed-source workflows remain available', async () => {
  const { missingPaperCitation } = await modulePromise;
  const paper = { kind: 'paper', ref: 'paper:example' };
  const outline = { slides: [{ body: ['Supported result'], source_refs: [] }] };
  assert.equal(missingPaperCitation(outline, [paper]), true);
  outline.slides[0].source_refs = [paper.ref];
  assert.equal(missingPaperCitation(outline, [paper]), false);
  outline.slides.push({ body: ['   '], source_refs: [] });
  assert.equal(missingPaperCitation(outline, [paper]), false);
  outline.slides[0].source_refs = [];
  assert.equal(missingPaperCitation(outline, [paper, { kind: 'note', ref: 'note:example' }]), false);
  assert.equal(missingPaperCitation(outline, []), false);
});
