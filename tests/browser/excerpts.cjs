const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium, expect } = require('C:/Users/wangyi/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/test');
const [base, evidence, phase] = process.argv.slice(2);
const reading = JSON.parse(fs.readFileSync(path.join(evidence, 'expected-reading.json')));
const method = reading.notes.find(note => note.key === 'method');
const table = reading.notes.find(note => note.key === 'performance');
const doc = reading.document_id;
const checks = [], errors = [], external = [];
let browser;
const watchdog = setTimeout(async () => { if (browser) await browser.close().catch(() => {}); process.exit(1); }, 150000);

async function check(name, action) {
  try { await action(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
}
function item(page, note) { return page.getByTestId('notes-list').locator(`[data-note-id="${note.id}"]`); }
async function ready(page, id, number) {
  await expect(page.getByTestId('reader-canvas')).toHaveAttribute('data-document-id', id);
  if (number) await expect(page.getByTestId('reader-canvas')).toHaveAttribute('data-page', String(number));
  await expect(page.getByTestId('region-mode')).toBeEnabled();
}
async function createExisting(page, note) {
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/notes/${note.id}/excerpt`));
  await item(page, note).locator('[data-action="create-excerpt"]').click();
  const actual = await response;
  assert([200, 201].includes(actual.status()), await actual.text());
  const image = item(page, note).getByTestId('excerpt-image');
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty('complete', true);
  assert(await image.evaluate(element => element.naturalWidth > 0));
  return actual.json();
}
async function selectRegion(page, text) {
  await page.getByTestId('page-input').fill('8');
  await page.getByTestId('page-input').press('Enter');
  await ready(page, doc, 8);
  await page.getByTestId('region-mode').click();
  const canvas = page.getByTestId('reader-canvas');
  await canvas.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await page.evaluate(() => window.scrollBy(0, -96));
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.06, box.y + box.height * 0.07);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.49, box.y + box.height * 0.19, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('note-text').fill(text);
}
async function listNotes(context) { return (await (await context.request.get(base + `/api/v1/documents/${doc}/notes`)).json()).items; }

async function before(page, context) {
  await page.goto(base + `/?document=${doc}&note=${method.id}`);
  await ready(page, doc, 4);
  await check('E01/E11/E16: existing method/table notes gain source-bound images without changing notes', async () => {
    const original = await listNotes(context);
    const first = await createExisting(page, method);
    // The table is on page8 while the reader remains on page4: it must not capture the screen.
    const second = await createExisting(page, table);
    assert.equal(first.page, 4); assert.equal(second.page, 8);
    assert.equal(first.source_sha256, second.source_sha256);
    assert.deepEqual(await listNotes(context), original);
    await item(page, table).locator('.note-open').click();
    await ready(page, doc, 8);
    await expect(page.locator('.source-highlight')).toHaveAttribute('data-note-id', table.id);
    fs.writeFileSync(path.join(evidence, 'initial-excerpts.json'), JSON.stringify([first, second], null, 2));
  });
  await check('E08: keyboard export downloads one complete reading-record ZIP', async () => {
    let first = true;
    const pattern = `**/documents/${doc}/export`;
    await page.route(pattern, async route => {
      if (!first) return route.continue();
      first = false;
      await route.abort('failed');
    });
    await page.getByTestId('export-reading-record').click();
    await expect(page.getByTestId('export-reading-record')).toBeEnabled();
    await expect(page.getByTestId('app-status')).toBeVisible();
    await page.getByTestId('export-reading-record').focus();
    const download = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    await (await download).saveAs(path.join(evidence, 'real-paper-reading-record.zip'));
    await expect(page.getByTestId('export-reading-record')).toBeEnabled();
    await page.unroute(pattern);
  });
  await page.screenshot({ path: path.join(evidence, 'excerpts-desktop-zh.png'), fullPage: false });
  await check('E12: failed image step keeps note, source and image intent for idempotent retry', async () => {
    const text = '验收笔记：图表保存失败后重试';
    await selectRegion(page, text);
    const before = (await listNotes(context)).length;
    let first = true;
    await page.route('**/notes/*/excerpt', async route => {
      if (route.request().method() !== 'POST' || !first) return route.continue();
      first = false;
      await route.abort('failed');
    });
    await page.getByTestId('excerpt-save').click();
    await expect(page.getByTestId('note-text')).toHaveValue(text);
    await expect(page.getByTestId('excerpt-save')).toBeEnabled();
    assert.equal((await listNotes(context)).length, before + 1);
    const saved = (await listNotes(context)).find(note => note.text === text);
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/notes/${saved.id}/excerpt`) && r.status() === 201);
    // A normal form retry must retain the failed image intent.
    await page.getByTestId('note-save').click();
    await response;
    await expect(page.getByTestId('note-text')).toHaveValue('');
    await expect(item(page, saved).getByTestId('excerpt-image')).toBeVisible();
    assert.equal((await listNotes(context)).length, before + 1);
    await page.unroute('**/notes/*/excerpt');
  });
  await check('E04/E12: committed image response loss retries the same note/image', async () => {
    const text = '验收笔记：图表已提交但响应丢失';
    await selectRegion(page, text);
    let committed, first = true;
    await page.route('**/notes/*/excerpt', async route => {
      if (route.request().method() !== 'POST' || !first) return route.continue();
      first = false;
      const response = await route.fetch();
      committed = await response.json();
      await route.abort('failed');
    });
    await page.getByTestId('excerpt-save').click();
    await expect(page.getByTestId('excerpt-save')).toBeEnabled();
    await expect(page.getByTestId('note-text')).toHaveValue(text);
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/notes/${committed.note_id}/excerpt`) && r.status() === 200);
    await page.getByTestId('excerpt-save').click();
    await response;
    await expect(page.getByTestId('note-text')).toHaveValue('');
    assert.equal((await listNotes(context)).filter(note => note.text === text).length, 1);
    await page.unroute('**/notes/*/excerpt');
  });
  let second;
  await check('E13: save+image completing after navigation cannot retarget the image or clear another draft', async () => {
    const sample = await (await context.request.get(base + '/assets/sample.pdf')).body();
    second = await (await context.request.post(base + '/api/v1/documents', { multipart: {
      file: { name: 'Synthetic other paper.pdf', mimeType: 'application/pdf', buffer: sample } } })).json();
    await page.reload(); await ready(page, doc);
    await page.getByTestId('documents-list').locator(`[data-document-id="${second.id}"] button`).click();
    await ready(page, second.id, 1);
    await page.locator('#page-note').click();
    await page.getByTestId('note-text').fill('另一篇文献的未保存笔记');
    await page.getByTestId('documents-list').locator(`[data-document-id="${doc}"] button`).click();
    await ready(page, doc);
    await selectRegion(page, '验收笔记：保存图表时切换文献');
    let enter, release, done, note;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const complete = new Promise(resolve => { done = resolve; });
    const pattern = `**/documents/${doc}/notes`;
    await page.route(pattern, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const actual = await route.fetch(); note = await actual.json(); enter(); await gate;
      try { await route.fulfill({ response: actual }); } finally { done(); }
    });
    await page.getByTestId('excerpt-save').click(); await entered;
    await page.getByTestId('documents-list').locator(`[data-document-id="${second.id}"] button`).click();
    await expect(page.getByTestId('reader-canvas')).toHaveAttribute('data-document-id', second.id);
    const imageResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/documents/${doc}/notes/${note.id}/excerpt`));
    release(); await complete; await page.unroute(pattern);
    assert.equal((await imageResponse).status(), 201);
    await ready(page, second.id, 1);
    await expect(page.getByTestId('note-text')).toHaveValue('另一篇文献的未保存笔记');
    assert.equal(await page.getByTestId('notes-list').getByTestId('excerpt-image').count(), 0);
  });
  await check('E13: delayed old excerpt listing cannot populate another paper', async () => {
    let enter, release, done;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const complete = new Promise(resolve => { done = resolve; });
    const pattern = `**/documents/${doc}/excerpts`;
    await page.route(pattern, async route => {
      const actual = await route.fetch(); enter(); await gate;
      try { await route.fulfill({ response: actual }); } catch (_) {} finally { done(); }
    });
    await page.getByTestId('documents-list').locator(`[data-document-id="${doc}"] button`).click();
    await entered;
    await page.getByTestId('documents-list').locator(`[data-document-id="${second.id}"] button`).click();
    release(); await complete; await page.unroute(pattern);
    await ready(page, second.id, 1);
    assert.equal(await page.getByTestId('notes-list').getByTestId('excerpt-image').count(), 0);
    await expect(page.getByTestId('note-text')).toHaveValue('另一篇文献的未保存笔记');
  });
  await page.goto(base + `/?document=${doc}&note=${method.id}`); await ready(page, doc, 4);
  await check('E15: English/mobile image preview and controls remain usable', async () => {
    await page.getByTestId('language-toggle').click();
    await expect(page.getByTestId('export-reading-record')).toContainText('Export');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(item(page, method).getByTestId('excerpt-image')).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(evidence, 'excerpts-mobile-en.png'), fullPage: true });
  });
}

async function offline(page) {
  await check('E08/E14: exported HTML opens with images while the app is stopped', async () => {
    await page.goto(pathToFileURL(path.join(evidence, 'unpacked/index.html')).href);
    await expect(page.locator('h1')).toContainText('Reconfigurable phase-only acoustic holography');
    await expect(page.locator('section')).toHaveCount(4);
    await expect(page.locator('img')).toHaveCount(2);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator('script').count(), 0);
    assert(await page.locator('a[href="source.pdf#page=4"]').count() > 0);
    await page.screenshot({ path: path.join(evidence, 'offline-reading-record.png'), fullPage: true });
  });
}

async function after(page) {
  await check('E11/E14: restart/fresh browser restores original note and generated image', async () => {
    await page.goto(base + `/?document=${doc}&note=${method.id}`); await ready(page, doc, 4);
    await expect(item(page, method).getByTestId('excerpt-image')).toBeVisible();
    await expect(item(page, method).locator('.note-open')).toContainText(method.text);
    await expect(page.locator('.source-highlight')).toHaveAttribute('data-note-id', method.id);
  });
}

(async () => {
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().startsWith('http') && !request.url().startsWith(base + '/')) external.push(request.url()); });
  try {
    if (phase === 'before') await before(page, context);
    else if (phase === 'offline') await offline(page);
    else await after(page);
    await check('No uncaught JavaScript errors or external page requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, `failure-${phase}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(evidence, `checks-${phase}.json`), JSON.stringify({ checks, errors, external }, null, 2));
    await context.close(); await browser.close(); clearTimeout(watchdog);
  }
  console.log(JSON.stringify({ phase, passed: checks.length }));
})().catch(async error => { if (browser) await browser.close().catch(() => {}); clearTimeout(watchdog); console.error(error.stack); process.exit(1); });
