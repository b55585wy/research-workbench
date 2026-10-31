const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium, expect } = require('C:/Users/wangyi/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/test');
const [base, evidence] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const [rotation, expected] of [[0,[255,0,0]],[90,[0,0,255]],[180,[255,255,0]],[270,[0,255,0]]]) {
      for (const cropped of [0, 1]) {
        const document = await (await context.request.post(base + '/api/v1/documents', { multipart: {
          file: { name: 'Synthetic colors.pdf', mimeType: 'application/pdf',
            buffer: fs.readFileSync(path.join(evidence, `colors-${rotation}-${cropped}.pdf`)) } } })).json();
        const note = await (await context.request.post(base + `/api/v1/documents/${document.id}/notes`, {
          data: { request_id: randomUUID(), page: 1, rect: [0.05,0.05,0.45,0.45], text: 'Synthetic rotated-region proof' } })).json();
        const response = await context.request.post(base + `/api/v1/documents/${document.id}/notes/${note.id}/excerpt`);
        assert.equal(response.status(), 201);
        const excerpt = await response.json();
        await page.goto(base + `/?document=${document.id}&note=${note.id}`);
        await expect(page.getByTestId('reader-canvas')).toHaveAttribute('data-document-id', document.id);
        await expect(page.getByTestId('reader-canvas')).toHaveAttribute('data-page', '1');
        // The page may redraw after image previews change layout. Observe rendered
        // pixels, not metadata from an earlier completed render or a fixed sleep.
        const observed = await page.waitForFunction(({id, expected}) => {
          const source = document.querySelector('[data-testid="reader-canvas"]');
          if (!source || source.dataset.documentId !== id || !source.width || !source.height) return false;
          const color = [...source.getContext('2d').getImageData(Math.floor(source.width*.25),Math.floor(source.height*.25),1,1).data].slice(0,3);
          return color.every((value,index) => value === expected[index]) ? color : false;
        }, {id:document.id, expected});
        const displayed = await observed.jsonValue();
        const saved = await page.evaluate(async imageUrl => {
          const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
          const target = document.createElement('canvas'); target.width=bitmap.width; target.height=bitmap.height;
          target.getContext('2d').drawImage(bitmap,0,0);
          const saved = [...target.getContext('2d').getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data].slice(0,3);
          bitmap.close(); return saved;
        }, excerpt.image_url);
        const colors = {displayed, saved};
        if (JSON.stringify(colors.displayed) !== JSON.stringify(expected)) {
          await page.getByTestId('reader-canvas').screenshot({ path: path.join(evidence, `mismatch-${rotation}-${cropped}.png`) });
          const independent = await page.evaluate(async sourceUrl => {
            const api = await import('/vendor/pdfjs/build/pdf.mjs');
            const task = api.getDocument({ data: await (await fetch(sourceUrl)).arrayBuffer() });
            const pdf = await task.promise; const p = await pdf.getPage(1); const view = p.getViewport({ scale: 1 });
            const canvas = document.createElement('canvas');canvas.width=view.width;canvas.height=view.height;
            await p.render({ canvasContext:canvas.getContext('2d'), viewport:view }).promise;
            const result = { rotation:p.rotate, view:p.view, viewport:[view.width,view.height],
              pixel:[...canvas.getContext('2d').getImageData(Math.floor(canvas.width*.25),Math.floor(canvas.height*.25),1,1).data] };
            await task.destroy(); return result;
          }, `/api/v1/documents/${document.id}/file`);
          fs.writeFileSync(path.join(evidence, 'mismatch.json'), JSON.stringify({rotation,cropped,expected,colors,independent},null,2));
        }
        assert.deepEqual(colors.displayed, expected); assert.deepEqual(colors.saved, colors.displayed);
        checks.push({ rotation, nonzero_crop_box: Boolean(cropped), ...colors, passed: true });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    fs.writeFileSync(path.join(evidence, 'checks-before.json'), JSON.stringify({ checks, errors }, null, 2));
    await context.close(); await browser.close();
  }
  console.log(JSON.stringify({ passed: checks.length }));
})().catch(error => { console.error(error.stack); process.exit(1); });
