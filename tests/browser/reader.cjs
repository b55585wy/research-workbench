const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, expect } = require(process.env.RESEARCH_PLAYWRIGHT ||
  'C:/Users/wangyi/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/test');
const [base, evidence, phase] = process.argv.slice(2);
const checks = [];
const errors = [];
const external = [];
const assetRequests = new Set();
let browser;
const watchdog = setTimeout(async () => {
  fs.writeFileSync(path.join(evidence, `timeout-${phase}.json`), JSON.stringify({ checks, errors }));
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
}, 150000);

async function check(name, action) {
  try {
    await action();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
    throw error;
  }
}

async function ready(page, documentId, number = 1) {
  const canvas = page.getByTestId('reader-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-document-id', documentId);
  await expect(canvas).toHaveAttribute('data-page', String(number));
  await expect(page.getByTestId('region-mode')).toBeEnabled();
}

async function ink(page, previousWidth = null) {
  await page.waitForFunction(oldWidth => {
    const canvas = document.querySelector('[data-testid="reader-canvas"]');
    if (!canvas || !canvas.width || oldWidth === canvas.width) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 64) {
      if (pixels[index] < 180 && pixels[index + 1] < 180 && pixels[index + 2] < 180) dark++;
    }
    return dark > 30;
  }, previousWidth);
}

async function highlight(page, rect) {
  const selection = page.locator('#region-overlay .source-highlight');
  await expect(selection).toBeVisible();
  const paper = await page.getByTestId('reader-canvas').boundingBox();
  const box = await selection.boundingBox();
  const actual = [(box.x - paper.x) / paper.width, (box.y - paper.y) / paper.height,
    (box.x + box.width - paper.x) / paper.width, (box.y + box.height - paper.y) / paper.height];
  assert(actual.every((value, index) => Math.abs(value - rect[index]) < 0.018), JSON.stringify({ actual, rect }));
  return actual;
}

async function save(page, text, status = 201) {
  if (await page.getByTestId('note-text').inputValue() !== text) await page.getByTestId('note-text').fill(text);
  const response = page.waitForResponse(item => item.request().method() === 'POST' &&
    /\/documents\/[^/]+\/notes$/.test(item.url()) && item.status() === status);
  await page.getByTestId('note-save').click();
  const note = await (await response).json();
  await expect(page.getByTestId('notes-list').locator(`[data-note-id="${note.id}"]`).first()).toBeVisible();
  return note;
}

async function clickDocument(page, id) {
  await page.getByTestId('documents-list').locator(`[data-document-id="${id}"]`).first().click();
}

async function noteClick(page, id) {
  await page.getByTestId('notes-list').locator(`[data-note-id="${id}"]`).locator(".note-open").click();
}

async function before(page, context) {
  await page.goto(base);
  await expect(page.getByTestId('sample-open')).toBeVisible();
  await check('R13: upload is keyboard reachable', async () => {
    const upload = page.getByRole('button', { name: '上传 PDF', exact: true });
    await upload.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles([]);
  });
  await page.screenshot({ path: path.join(evidence, 'empty-desktop.png'), fullPage: true });
  let document;
  let region;
  await check('R01: real sample upload, local PDF rendering and byte readback', async () => {
    const uploaded = page.waitForResponse(item => item.request().method() === 'POST' && item.url().endsWith('/api/v1/documents'));
    await page.getByTestId('sample-open').click();
    const response = await uploaded;
    assert.equal(response.status(), 201);
    document = await response.json();
    await ready(page, document.id);
    await ink(page);
    const original = await (await context.request.get(base + '/assets/sample.pdf')).body();
    const stored = await (await context.request.get(base + `/api/v1/documents/${document.id}/file`)).body();
    assert.deepEqual(stored, original);
  });

  await check('R02/R12: region note is persisted and markup remains text', async () => {
    await page.getByTestId('region-mode').click();
    const box = await page.getByTestId('reader-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.45, { steps: 8 });
    await page.mouse.up();
    region = await save(page, '合成笔记 <img src=x onerror="window.noteXss=true"> source position');
    assert.equal(region.document_id, document.id);
    assert.equal(region.page, 1);
    assert(region.rect.every((value, index) => Math.abs(value - [0.1, 0.2, 0.65, 0.45][index]) < 0.018));
    assert.equal(await page.locator('#notes-list img').count(), 0);
    assert.equal(await page.evaluate(() => window.noteXss), undefined);
  });

  await check('R02/R04: note jump returns to saved page and zoom preserves region', async () => {
    await page.locator('#page-next').click();
    await ready(page, document.id, 2);
    await noteClick(page, region.id);
    await ready(page, document.id, 1);
    await highlight(page, region.rect);
    const old = await page.getByTestId('reader-canvas').evaluate(canvas => canvas.width);
    await page.getByTestId('zoom-in').click();
    await ink(page, old);
    await highlight(page, region.rect);
  });

  let whole;
  await check('R02/R13: keyboard page note retains its source across page navigation', async () => {
    await page.locator('#page-next').click();
    await ready(page, document.id, 2);
    await page.locator('#page-note').focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('note-text').fill('Keyboard whole-page note');
    await page.locator('#page-prev').click();
    await ready(page, document.id, 1);
    whole = await save(page, 'Keyboard whole-page note');
    assert.equal(whole.page, 2);
    assert.equal(whole.rect, null);
  });

  await check('R07/R11: lost successful save keeps draft; retry reuses one note', async () => {
    await page.locator('#page-note').click();
    const text = 'Retry after a committed response was lost';
    let committed;
    let first = true;
    const pattern = `**/documents/${document.id}/notes`;
    await page.route(pattern, async route => {
      if (route.request().method() !== 'POST' || !first) return route.continue();
      first = false;
      const actual = await route.fetch();
      committed = await actual.json();
      await route.abort('failed');
    });
    await page.getByTestId('note-text').fill(text);
    await page.getByTestId('note-save').click();
    await expect(page.getByTestId('app-status')).toBeVisible();
    await expect(page.getByTestId('note-save')).toBeEnabled();
    await expect(page.getByTestId('note-text')).toHaveValue(text);
    const retried = await save(page, text, 200);
    assert.equal(retried.id, committed.id);
    await page.unroute(pattern);
    const notes = await (await context.request.get(base + `/api/v1/documents/${document.id}/notes`)).json();
    assert.equal(notes.items.filter(note => note.text === text).length, 1);
  });

  await check('R04: jumping to a source below the fold actually reveals it', async () => {
    const result = await context.request.post(base + `/api/v1/documents/${document.id}/notes`, {
      data: { request_id: require('node:crypto').randomUUID(), page: 1,
        rect: [0.1, 0.78, 0.7, 0.88], text: 'Synthetic source below the fold' }
    });
    assert.equal(result.status(), 201);
    const low = await result.json();
    await page.reload();
    await ready(page, document.id, 1);
    await noteClick(page, low.id);
    await highlight(page, low.rect);
    await expect(page.locator('#region-overlay .source-highlight')).toBeInViewport({ ratio: 0.9 });
  });

  let second;
  await check('R10: document drafts and delayed file responses stay bound to their source', async () => {
    const sample = await (await context.request.get(base + '/assets/sample.pdf')).body();
    const created = await context.request.post(base + '/api/v1/documents', {
      multipart: { file: { name: 'Second synthetic document.pdf', mimeType: 'application/pdf', buffer: sample } }
    });
    assert.equal(created.status(), 201);
    second = await created.json();
    await page.reload();
    await ready(page, document.id, 1);
    await page.locator('#page-note').click();
    await page.getByTestId('note-text').fill('Unsaved draft for first document');
    await clickDocument(page, second.id);
    await ready(page, second.id, 1);
    await expect(page.getByTestId('note-text')).toHaveValue('');
    await page.locator('#page-note').click();
    await page.getByTestId('note-text').fill('Unsaved draft for second document');
    await clickDocument(page, document.id);
    await ready(page, document.id, 1);
    await expect(page.getByTestId('note-text')).toHaveValue('Unsaved draft for first document');
    let release;
    let entered;
    let completed;
    const held = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const completion = new Promise(resolve => { completed = resolve; });
    const pattern = `**/documents/${second.id}/file`;
    await page.route(pattern, async route => {
      const actual = await route.fetch();
      entered();
      await gate;
      try { await route.fulfill({ response: actual }); } catch (_) { /* cancelled navigation */ }
      finally { completed(); }
    });
    await clickDocument(page, second.id);
    await held;
    const previousButton = page.getByTestId('documents-list').locator(`[data-document-id="${document.id}"] button`).first();
    const canNavigate = await previousButton.isEnabled();
    if (canNavigate) await previousButton.click();
    release();
    await completion;
    await page.unroute(pattern);
    const expected = canNavigate ? document.id : second.id;
    await ready(page, expected, 1);
    await expect(page.getByTestId('note-text')).toHaveValue(canNavigate ?
      'Unsaved draft for first document' : 'Unsaved draft for second document');
  });

  await check('R10/R11: a save completing after navigation cannot clear another draft', async () => {
    await clickDocument(page, document.id);
    await ready(page, document.id, 1);
    await page.locator('#page-note').click();
    await page.getByTestId('note-text').fill('Save while switching documents');
    let release;
    let entered;
    let completed;
    let committed;
    const held = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const completion = new Promise(resolve => { completed = resolve; });
    const pattern = `**/documents/${document.id}/notes`;
    await page.route(pattern, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const actual = await route.fetch();
      committed = await actual.json();
      entered();
      await gate;
      try { await route.fulfill({ response: actual }); } finally { completed(); }
    });
    await page.getByTestId('note-save').click();
    await held;
    await clickDocument(page, second.id);
    await expect(page.getByTestId('reader-canvas')).toHaveAttribute('data-document-id', second.id);
    release();
    await completion;
    await page.unroute(pattern);
    await ready(page, second.id, 1);
    await expect(page.getByTestId('note-text')).toHaveValue('Unsaved draft for second document');
    assert.equal(committed.document_id, document.id);
    const firstNotes = await (await context.request.get(base + `/api/v1/documents/${document.id}/notes`)).json();
    const otherNotes = await (await context.request.get(base + `/api/v1/documents/${second.id}/notes`)).json();
    assert(firstNotes.items.some(note => note.id === committed.id));
    assert(!otherNotes.items.some(note => note.id === committed.id));
  });

  await check('R05: browser upload errors do not add a document', async () => {
    const previous = (await (await context.request.get(base + '/api/v1/documents')).json()).items.length;
    const response = page.waitForResponse(item => item.request().method() === 'POST' && item.url().endsWith('/api/v1/documents'));
    await page.getByTestId('upload-input').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
    assert.equal((await response).status(), 422);
    await expect(page.getByTestId('app-status')).toBeVisible();
    assert.equal((await (await context.request.get(base + '/api/v1/documents')).json()).items.length, previous);
  });

  await clickDocument(page, document.id);
  await ready(page, document.id, 1);
  await noteClick(page, region.id);
  await highlight(page, region.rect);
  const sourceLink = page.url();
  assert(sourceLink.includes(document.id) && sourceLink.includes(region.id));
  await page.screenshot({ path: path.join(evidence, 'reader-desktop-zh.png'), fullPage: true });
  await check('R13: English controls and mobile source geometry', async () => {
    await page.getByTestId('language-toggle').click();
    await expect(page.locator('h1')).toHaveText('Papers & notes');
    await page.screenshot({ path: path.join(evidence, 'reader-desktop-en.png'), fullPage: true });
    await page.locator('#zoom-fit').click();
    await ready(page, document.id, 1);
    const old = await page.getByTestId('reader-canvas').evaluate(canvas => canvas.width);
    await page.setViewportSize({ width: 390, height: 844 });
    await ink(page, old);
    await highlight(page, region.rect);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(evidence, 'reader-mobile-en.png'), fullPage: true });
    await page.getByTestId('language-toggle').click();
    await expect(page.locator('h1')).toHaveText('文献与笔记');
  });
  await check('R01: a tall PDF keeps canvas allocation within its budget', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const created = await context.request.post(base + '/api/v1/documents', {
      multipart: { file: { name: 'Synthetic tall page.pdf', mimeType: 'application/pdf',
        buffer: fs.readFileSync(path.join(evidence, 'synthetic-tall-page.pdf')) } }
    });
    assert.equal(created.status(), 201);
    const tall = await created.json();
    await page.goto(base + '/?document=' + tall.id);
    await ready(page, tall.id, 1);
    const size = await page.getByTestId('reader-canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    assert(size.width * size.height <= 8_000_000, JSON.stringify(size));
    assert(size.width <= 16384 && size.height <= 16384, JSON.stringify(size));
    await page.goto(sourceLink);
    await ready(page, document.id, 1);
    await highlight(page, region.rect);
  });
  fs.writeFileSync(path.join(evidence, 'persisted.json'), JSON.stringify({ document, second, region, whole, sourceLink }, null, 2));
}

async function after(page, context) {
  const stored = JSON.parse(fs.readFileSync(path.join(evidence, 'persisted.json')));
  await check('R03: hard server restart and fresh browser restore source link', async () => {
    await page.goto(stored.sourceLink);
    await ready(page, stored.document.id, stored.region.page);
    await ink(page);
    await highlight(page, stored.region.rect);
    await expect(page.getByTestId('notes-list').locator(`[data-note-id="${stored.region.id}"]`).first()).toBeVisible();
    const notes = await (await context.request.get(base + `/api/v1/documents/${stored.document.id}/notes`)).json();
    assert.equal(notes.items.find(note => note.id === stored.region.id).text, stored.region.text);
    await page.screenshot({ path: path.join(evidence, 'reader-after-restart.png'), fullPage: true });
  });
  await check('R06: unknown document link shows failure without stale content', async () => {
    await page.goto(base + '/?document=00000000-0000-4000-8000-000000000000');
    await expect(page.getByTestId('app-status')).toBeVisible();
    await expect(page.getByTestId('reader-canvas')).not.toBeVisible();
    assert.equal(await page.getByTestId('notes-list').locator('[data-note-id]').count(), 0);
  });
}

(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.RESEARCH_CHROME ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith('http') && !url.startsWith(base + '/')) external.push(url);
    if (url.includes('/vendor/pdfjs/')) assetRequests.add(new URL(url).pathname);
  });
  try {
    if (phase === 'before') await before(page, context); else await after(page, context);
    await check('R14: local PDF.js assets and zero uncaught JavaScript errors', async () => {
      assert(assetRequests.has('/vendor/pdfjs/build/pdf.mjs'));
      assert(assetRequests.has('/vendor/pdfjs/build/pdf.worker.mjs'));
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
    });
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, `failure-${phase}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(evidence, `checks-${phase}.json`), JSON.stringify({ checks, errors, external,
      assets: [...assetRequests], browser: browser.version() }, null, 2));
    await context.close();
    await browser.close();
    clearTimeout(watchdog);
  }
  console.log(JSON.stringify({ phase, passed: checks.length }));
})().catch(async error => {
  if (browser) await browser.close().catch(() => {});
  clearTimeout(watchdog);
  console.error(error.stack);
  process.exit(1);
});
