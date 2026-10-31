const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium, expect} = require('C:/Users/wangyi/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/test');
const [base, evidence, phase] = process.argv.slice(2);
const reading = JSON.parse(fs.readFileSync(path.join(evidence, 'expected-reading.json')));
const doc = reading.document_id;
const method = reading.notes.find(n => n.key === 'method');
const table = reading.notes.find(n => n.key === 'performance');
const checks = [], errors = [], external = [];
let browser;
const watchdog = setTimeout(async () => { if (browser) await browser.close().catch(() => {}); process.exit(1); }, 160000);
const notePath = id => `/api/v1/documents/${doc}/notes/${id}`;
const item = (p, id) => p.getByTestId('notes-list').locator(`[data-note-id="${id}"]`);
const deleted = (p, id) => p.getByTestId('deleted-notes-list').locator(`[data-note-id="${id}"]`);
const action = (p, id, a) => item(p, id).locator(`[data-action="${a}-note"]`);
async function check(name, fn) {
  try { await fn(); checks.push({name, passed: true}); }
  catch (error) { checks.push({name, passed: false, error: error.message}); throw error; }
}
async function state(context, id) { return (await context.request.get(base + notePath(id) + '/state')).json(); }
async function states(context) { return (await (await context.request.get(base + `/api/v1/documents/${doc}/note-states`)).json()).items; }
async function ready(p, id = doc) {
  await expect(p.getByTestId('reader-canvas')).toHaveAttribute('data-document-id', id);
  await expect(p.getByTestId('note-text')).toBeEnabled();
}
async function renderedInk(p) {
  await p.waitForFunction(() => {
    const canvas=document.querySelector('#reader-canvas');
    const stage=document.querySelector('#reader-stage');
    if(!canvas?.width || (stage && canvas.getBoundingClientRect().width>stage.clientWidth))return false;
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let dark=0;
    for(let i=0;i<pixels.length;i+=16)if(pixels[i+3]>200&&pixels[i]<120&&pixels[i+1]<120&&pixels[i+2]<120&&++dark>40)return true;
    return false;
  });
}
async function open(p, id = doc, note = null) {
  await p.goto(base + `/?document=${id}${note ? '&note=' + note : ''}`);
  await ready(p, id);
  if (id === doc) await expect(action(p, method.id, 'edit')).toBeEnabled();
}
async function clickMutation(p, id, kind, fields = null) {
  const methodName = kind === 'delete' ? 'DELETE' : kind === 'restore' ? 'POST' : 'PATCH';
  const suffix = notePath(id) + (kind === 'restore' ? '/restore' : '');
  const response = p.waitForResponse(r => r.request().method() === methodName && r.url().endsWith(suffix));
  if (kind === 'save') await p.getByTestId('note-save').click();
  else if (kind === 'restore') await deleted(p, id).locator('[data-action="restore-note"]').click();
  else await action(p, id, kind).click();
  const actual = await response;
  assert.equal(actual.status(), 200, await actual.text());
  const value = await actual.json();
  if (fields) for (const [key, expected] of Object.entries(fields)) assert.deepEqual(value[key], expected);
  await expect(p.getByTestId('export-reading-record')).toBeEnabled();
  return value;
}
async function edit(p, id, text) {
  await action(p, id, 'edit').click();
  await expect(p.getByTestId('edit-mode')).toBeVisible();
  await p.getByTestId('note-text').fill(text);
  return clickMutation(p, id, 'save', {text});
}

async function before(p, context) {
  await open(p, doc, method.id);
  const originals = await states(context);
  const images = (await (await context.request.get(base + `/api/v1/documents/${doc}/excerpts`)).json()).items;
  const image = images.find(e => e.note_id === method.id);
  const imageUrl = image.image_url || `/api/v1/documents/${doc}/notes/${method.id}/excerpt/image`;
  const originalImage = await (await context.request.get(base + imageUrl)).body();
  await check('N02/N11: migrated real notes are pending, never inferred from text', async () => {
    assert.equal(originals.length, 4);
    for (const n of originals) assert.equal(n.review_status, 'unreviewed');
    await expect(item(p, method.id)).toHaveAttribute('data-review-status', 'unreviewed');
  });
  for (const heldEndpoint of ['notes','note-states']) {
    await check(`N17: ${heldEndpoint} response arrives last; displayed text and review target stay in the same revision`, async () => {
      let held, changed, release;
      const captured=new Promise(r=>held=r), updated=new Promise(r=>changed=r), gate=new Promise(r=>release=r);
      const otherEndpoint=heldEndpoint==='notes'?'note-states':'notes';
      const heldPattern=`**/documents/${doc}/${heldEndpoint}`;
      const otherPattern=`**/documents/${doc}/${otherEndpoint}`;
      let old;
      await p.route(heldPattern,async route=>{
        old=await state(context,method.id);
        const response=await route.fetch(); held(); await gate; await route.fulfill({response});
      });
      await p.route(otherPattern,async route=>{
        await captured;
        const result=await context.request.patch(base+notePath(method.id),{data:{request_id:require('node:crypto').randomUUID(),expected_revision:old.revision,text:'跨请求更新的文字'}});
        assert.equal(result.status(),200); const response=await route.fetch();
        await route.fulfill({response});changed();
      });
      await p.goto(base+`/?document=${doc}`);await updated;release();await ready(p);
      await expect(action(p,method.id,'review')).toBeEnabled();
      const expectedText=heldEndpoint==='notes'?'跨请求更新的文字':old.text;
      await expect(item(p,method.id).locator('.note-text-preview')).toHaveText(expectedText);
      const response=p.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(notePath(method.id)));
      await action(p,method.id,'review').click();const actual=await response;
      assert.equal(actual.status(),heldEndpoint==='notes'?200:409);
      const actualState=await state(context,method.id);
      assert.equal(actualState.review_status,heldEndpoint==='notes'?'source_checked':'unreviewed');
      await p.unroute(heldPattern);await p.unroute(otherPattern);
      assert.equal((await context.request.patch(base+notePath(method.id),{data:{request_id:require('node:crypto').randomUUID(),expected_revision:actualState.revision,text:method.text,review_status:'unreviewed'}})).status(),200);
      await open(p);
    });
  }
  await check('N12: edit/cancel keeps the separate creation draft and immutable source', async () => {
    await p.getByTestId('note-text').fill('未提交的新笔记草稿');
    await action(p, method.id, 'edit').click();
    await expect(p.getByTestId('note-text')).toHaveValue(method.text);
    await p.getByTestId('note-text').fill('取消的编辑内容');
    await expect(p.getByTestId('region-mode')).toBeDisabled();
    await expect(p.getByTestId('export-reading-record')).toBeDisabled();
    await expect(action(p, method.id, 'review')).toBeDisabled();
    await p.getByTestId('edit-cancel').click();
    await expect(p.getByTestId('note-text')).toHaveValue('未提交的新笔记草稿');
    assert.equal((await state(context, method.id)).text, method.text);
  });
  await check('N01/N03/N15: edited text stays literal and retains PDF/PNG/source; review resets only on change', async () => {
    await clickMutation(p, method.id, 'review', {review_status: 'source_checked', review_provenance: 'self_reported'});
    await edit(p, method.id, '修订方法：<img src=x onerror="window.injected=1"> & 原文核对');
    await expect(item(p, method.id)).toHaveAttribute('data-review-status', 'unreviewed');
    const changed = await state(context, method.id);
    for (const key of ['id', 'document_id', 'page', 'rect', 'created_at']) assert.deepEqual(changed[key], originals.find(n => n.id === method.id)[key]);
    assert.deepEqual(await (await context.request.get(base + imageUrl)).body(), originalImage);
    assert.equal(await p.evaluate(() => window.injected), undefined);
    await expect(item(p, method.id).locator('.note-text-preview')).toContainText('<img src=x');
    await clickMutation(p, method.id, 'review', {review_status: 'source_checked'});
    const checked = await state(context, method.id);
    await edit(p, method.id, checked.text);
    assert.deepEqual(await state(context, method.id), checked);
    await clickMutation(p, method.id, 'review', {review_status: 'unreviewed', reviewed_at: null});
  });
  await check('N07/N13: lost committed edit response retries the identical mutation once', async () => {
    await action(p, method.id, 'edit').click();
    await p.getByTestId('note-text').fill('响应丢失后的修订文字');
    const payloads = []; let first = true;
    await p.route('**' + notePath(method.id), async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      payloads.push(route.request().postDataJSON());
      if (!first) return route.continue();
      first = false; await route.fetch(); await route.abort('failed');
    });
    const old = await state(context, method.id);
    await p.getByTestId('note-save').click();
    await expect(p.getByTestId('note-save')).toBeEnabled();
    await expect(p.getByTestId('app-status')).toHaveAttribute('data-kind', 'error');
    await expect(p.getByTestId('note-text')).toHaveValue('响应丢失后的修订文字');
    await clickMutation(p, method.id, 'save');
    assert.equal(payloads.length, 2); assert.deepEqual(payloads[0], payloads[1]);
    assert.equal((await state(context, method.id)).revision, old.revision + 1);
    await p.unroute('**' + notePath(method.id));
  });
  await check('N06/N13: two-tab conflict preserves the draft and never overwrites the newer note', async () => {
    const other = await context.newPage(); await open(other);
    await action(p, method.id, 'edit').click(); await p.getByTestId('note-text').fill('本页旧版本草稿');
    await edit(other, method.id, '另一个页面先保存的内容');
    const response = p.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(notePath(method.id)));
    await p.getByTestId('note-save').click(); assert.equal((await response).status(), 409);
    await expect(p.getByTestId('app-status')).toContainText(/更新|updated/);
    await expect(p.getByTestId('note-text')).toHaveValue('本页旧版本草稿');
    await p.locator('#status-retry').click();
    await expect(item(p, method.id)).toContainText('另一个页面先保存的内容');
    await expect(p.getByTestId('note-text')).toHaveValue('本页旧版本草稿');
    await p.getByTestId('edit-cancel').click();
    await edit(p, method.id, '最终修订：已保存当前文字');
    await other.close();
  });
  let second;
  await check('N12: per-document creation and edit drafts survive navigation', async () => {
    await p.getByTestId('note-text').fill('本篇新笔记草稿');
    await action(p, method.id, 'edit').click(); await p.getByTestId('note-text').fill('本篇未提交编辑');
    const sample = await (await context.request.get(base + '/assets/sample.pdf')).body();
    const uploaded = p.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/documents'));
    await p.getByTestId('upload-input').setInputFiles({name:'lifecycle-synthetic.pdf',mimeType:'application/pdf',buffer:sample});
    second = (await (await uploaded).json()).id;
    await ready(p, second);
    await p.getByTestId('note-text').fill('另一篇草稿');
    await p.getByTestId('documents-list').locator(`[data-document-id="${doc}"]`).click();
    await ready(p); await expect(p.getByTestId('note-text')).toHaveValue('本篇未提交编辑');
    await p.getByTestId('edit-cancel').click(); await expect(p.getByTestId('note-text')).toHaveValue('本篇新笔记草稿');
  });
  await check('N12: delayed edit completion cannot clear another paper draft', async () => {
    await action(p, method.id, 'edit').click(); await p.getByTestId('note-text').fill('延迟保存的最终文字');
    let release, arrived;
    const gate = new Promise(r => release = r), reached = new Promise(r => arrived = r);
    await p.route('**' + notePath(method.id), async route => {
      const result = await route.fetch(); arrived(); await gate; await route.fulfill({response: result});
    });
    await p.getByTestId('note-save').click(); await reached;
    // Use the uploaded synthetic document's stored ID instead of text matching.
    await p.getByTestId('documents-list').locator(`[data-document-id="${second}"]`).click(); await ready(p, second);
    await p.getByTestId('note-text').fill('保存期间另一篇的草稿');
    release(); await expect(p.getByTestId('export-reading-record')).toBeEnabled();
    await expect(p.getByTestId('note-text')).toHaveValue('保存期间另一篇的草稿');
    await p.unroute('**' + notePath(method.id));
    await p.getByTestId('documents-list').locator(`[data-document-id="${doc}"]`).click(); await ready(p);
    await expect(item(p, method.id)).toContainText('延迟保存的最终文字');
    await expect(p.getByTestId('note-text')).toHaveValue('本篇新笔记草稿');
  });
  await check('N04/N13: delete cancellation keeps the note; confirmed delete clears its source URL', async () => {
    await item(p, method.id).locator('.note-open').click();
    p.once('dialog', dialog => dialog.dismiss()); await action(p, method.id, 'delete').click();
    await expect(item(p, method.id)).toBeVisible(); assert.equal((await state(context, method.id)).deleted_at, null);
    p.once('dialog', dialog => dialog.accept()); await clickMutation(p, method.id, 'delete');
    await expect(item(p, method.id)).toHaveCount(0);
    assert(!new URL(p.url()).searchParams.has('note'));
    await expect(p.locator('.source-highlight')).toHaveCount(0);
    assert.equal((await context.request.get(base + imageUrl)).status(), 404);
    await p.getByTestId('deleted-notes-toggle').click();
    await expect(deleted(p, method.id)).toBeVisible();
    await clickMutation(p, method.id, 'restore');
    await expect(item(p, method.id).getByTestId('excerpt-image')).toBeVisible();
    assert.deepEqual(await (await context.request.get(base + imageUrl)).body(), originalImage);
  });
  await check('N07: review/delete/restore retries reuse their original request after response loss', async () => {
    for (const kind of ['review', 'delete', 'restore']) {
      const suffix = notePath(method.id) + (kind === 'restore' ? '/restore' : '');
      const payloads=[]; let first=true;
      await p.route('**' + suffix, async route => {
        if (!['PATCH','DELETE','POST'].includes(route.request().method())) return route.continue();
        payloads.push(route.request().postDataJSON());
        if (!first) return route.continue(); first=false;
        await route.fetch(); await route.abort('failed');
      });
      const old = await state(context, method.id);
      if (kind === 'delete') p.once('dialog', dialog => dialog.accept());
      if (kind === 'restore') {
        await p.getByTestId('deleted-notes-toggle').click();
        await deleted(p, method.id).locator('[data-action="restore-note"]').click();
      } else await action(p, method.id, kind).click();
      await expect(p.locator('#status-retry')).toBeVisible();
      await p.locator('#status-retry').click();
      await expect(p.getByTestId('export-reading-record')).toBeEnabled();
      await expect(p.locator('#status-retry')).toBeHidden();
      assert.equal(payloads.length, 2); assert.deepEqual(payloads[0], payloads[1]);
      assert.equal((await state(context, method.id)).revision, old.revision + 1);
      await p.unroute('**' + suffix);
    }
  });
  await check('N09/N15: export carries current checked text and omits a deleted image; keyboard works', async () => {
    await expect(item(p, method.id)).toHaveAttribute('data-review-status', 'source_checked');
    p.once('dialog', d => d.accept()); await clickMutation(p, table.id, 'delete');
    const download = p.waitForEvent('download');
    await p.getByTestId('export-reading-record').focus(); await p.keyboard.press('Enter');
    await (await download).saveAs(path.join(evidence, 'lifecycle-export.zip'));
    fs.writeFileSync(path.join(evidence, 'expected-final-states.json'), JSON.stringify(await states(context), null, 2));
  });
  await check('N15: bilingual mobile actions remain usable without page overflow', async () => {
    await p.getByTestId('language-toggle').click();
    await expect(action(p, method.id, 'edit')).toHaveText('Edit');
    await p.setViewportSize({width:390,height:844});
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await action(p, method.id, 'edit').click(); await expect(p.getByTestId('edit-cancel')).toBeVisible();
    await p.getByTestId('edit-cancel').click();
    await renderedInk(p);
    await p.screenshot({path:path.join(evidence,'lifecycle-mobile-en.png'),fullPage:true});
    await p.setViewportSize({width:1440,height:1000}); await p.getByTestId('language-toggle').click();
    await item(p, method.id).locator('.note-open').click();
    await p.evaluate(()=>window.scrollTo(0,0)); await renderedInk(p);
    await p.screenshot({path:path.join(evidence,'lifecycle-desktop-zh.png'),fullPage:false});
  });
}

async function after(p, context) {
  await open(p);
  await check('N14: hard server restart and fresh browser retain exact current/review/deletion states', async () => {
    const expected=JSON.parse(fs.readFileSync(path.join(evidence,'expected-final-states.json')));
    assert.deepEqual((await states(context)).sort((a,b)=>a.id.localeCompare(b.id)), expected.sort((a,b)=>a.id.localeCompare(b.id)));
    await expect(item(p, method.id)).toHaveAttribute('data-review-status','source_checked');
    await expect(item(p, table.id)).toHaveCount(0);
    await p.goto(base+`/?document=${doc}&note=${table.id}`); await ready(p);
    await expect(p.getByTestId('app-status')).toContainText(/恢复|restore/);
    await expect(deleted(p, table.id)).toBeVisible();
    await clickMutation(p, table.id, 'restore');
    await expect(item(p, table.id).getByTestId('excerpt-image')).toBeVisible();
  });
  await check('N02/N14: newly created notes receive enabled lifecycle actions', async () => {
    await p.locator('#page-note').click(); await p.getByTestId('note-text').fill('重启后的新笔记');
    const response=p.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/notes'));
    await p.getByTestId('note-save').click(); const n=await (await response).json();
    await expect(action(p,n.id,'edit')).toBeEnabled();
    await expect(item(p,n.id)).toHaveAttribute('data-review-status','unreviewed');
  });
}

(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const p=await context.newPage(); p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url());});
 if(phase==='before')await before(p,context);
 else if(phase==='after')await after(p,context);
 else await check('N09: exported record opens offline with the app stopped',async()=>{
   await p.goto(pathToFileURL(path.join(evidence,'unpacked/index.html')).href);
   await expect(p.locator('body')).toContainText('延迟保存的最终文字');
   await expect(p.locator('body')).toContainText('自行确认');
   await expect(p.locator('img')).toHaveCount(1);
   assert(await p.locator('img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));
   assert.equal(await p.locator('script').count(),0);
 });
 assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
 await context.close(); await browser.close(); clearTimeout(watchdog);
 fs.writeFileSync(path.join(evidence,`browser-${phase}.json`),JSON.stringify({passed:true,checks,errors,external},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length,phase}));
})().catch(async error=>{
 fs.writeFileSync(path.join(evidence,`browser-${phase}.json`),JSON.stringify({passed:false,checks,errors,external,error:error.stack},null,2));
 console.error(error.stack); if(browser)await browser.close().catch(()=>{});clearTimeout(watchdog);process.exitCode=1;
});
