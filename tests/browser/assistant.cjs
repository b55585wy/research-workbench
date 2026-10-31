const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,expect}=require('C:/Users/wangyi/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/test');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const [base,evidence,phase]=process.argv.slice(2),checks=[],errors=[],external=[];
let browser;
const hook=(p,id)=>p.locator('#'+id),note=(p,id)=>hook(p,'notes-list').locator(`[data-note-id="${id}"]`);
const image=(p,id)=>hook(p,'images-list').locator(`:scope > [data-image-id="${id}"]`);
const watchdog=setTimeout(async()=>{if(browser)await browser.close().catch(()=>{});process.exit(1);},240000);
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});throw e;}}
async function ready(p,id,page){await expect(hook(p,'reader-canvas')).toHaveAttribute('data-document-id',id);if(page)await expect(hook(p,'reader-canvas')).toHaveAttribute('data-page',String(page));await expect(hook(p,'note-text')).toBeEnabled();}
async function select(p,id){await hook(p,'documents-list').locator(`[data-document-id="${id}"] button`).click();await ready(p,id);}
async function uploadPDF(p,name){const got=p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/documents');await hook(p,'upload-input').setInputFiles(path.join(evidence,name));const r=await got;assert.equal(r.status(),201,await r.text());const d=await r.json();await ready(p,d.id);await expect(hook(p,'upload-button')).toBeEnabled();return d;}
async function listNotes(c,id){return(await(await c.request.get(base+`/api/v1/documents/${id}/notes`)).json()).items;}
async function openAssistant(p){if(!await hook(p,'assistant-panel').isVisible())await hook(p,'assistant-toggle').click();await expect(hook(p,'assistant-message')).toBeVisible();}
async function closeAssistant(p){if(await hook(p,'assistant-panel').isVisible())await hook(p,'assistant-close').click();}
async function send(p,id,text){await openAssistant(p);await hook(p,'assistant-message').fill(text);const got=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/documents/${id}/agent/turns`));await hook(p,'assistant-send').click();const r=await got;assert.equal(r.status(),202,await r.text());return r.json();}
async function newConversation(p){await openAssistant(p);await hook(p,'assistant-new').click();await expect(hook(p,'assistant-message')).toHaveValue('');}
async function checkpoint(c,id,turn){let result;await expect.poll(async()=>{result=await(await c.request.get(base+`/api/v1/documents/${id}/agent/turns/${turn}`)).json();return result.status;},{timeout:10000}).not.toMatch(/^(queued|running)$/);return result;}
async function proposal(p,id){const item=hook(p,'assistant-proposals').locator(`[data-proposal-id="${id}"]`);await expect(item).toBeVisible();return item;}
async function approve(p,id,turn){const item=await proposal(p,turn.proposals[0].id);const got=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/proposals/${turn.proposals[0].id}/confirm`));await item.locator('[data-action="confirm-proposal"]').click();const r=await got;assert.equal(r.status(),200,await r.text());return r.json();}
async function uploadImage(p,id,name='fixture.png'){const got=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/documents/${id}/images`));await hook(p,'image-upload-input').setInputFiles({name,mimeType:'image/png',buffer:fs.readFileSync(path.join(evidence,'fixture.png'))});const r=await got;assert.equal(r.status(),201,await r.text());const i=await r.json();await expect(image(p,i.id)).toBeVisible();return i;}

async function before(p,c){
 await p.goto(base);let first,second,asset,manual,modelNote;
 await check('A01/A05: real PDF and image uploads display context-bound image library',async()=>{
  first=await uploadPDF(p,'first.pdf');asset=await uploadImage(p,first.id);
  await expect(image(p,asset.id).locator('img')).toHaveJSProperty('complete',true);
  assert(await image(p,asset.id).locator('img').evaluate(x=>x.naturalWidth>0));
  const raw=await(await c.request.get(base+asset.file_url)).body();assert.deepEqual(raw,fs.readFileSync(path.join(evidence,'fixture.png')));
 });
 await check('A04: manual image-note creation shares source and refreshes uploaded images',async()=>{
  await image(p,asset.id).locator('[data-action="select-note-image"]').check();
  await hook(p,'page-note').click();await hook(p,'note-text').fill('Manual uploaded image note');
  const got=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/image-notes'));
  await hook(p,'note-save').click();const r=await got;assert.equal(r.status(),201,await r.text());manual=await r.json();
  await expect(note(p,manual.id).locator('img')).toBeVisible();await expect(note(p,manual.id)).toContainText(/用户上传|User-uploaded/i);
  await expect(note(p,manual.id)).toHaveAttribute('data-review-status','unreviewed');
 });
 await check('A03: lost image-note response retries same request without duplicate notes',async()=>{
  await image(p,asset.id).locator('[data-action="select-note-image"]').check();await hook(p,'page-note').click();await hook(p,'note-text').fill('Image note after lost response');
  let once=true;const payloads=[];await p.route('**/image-notes',async route=>{payloads.push(route.request().postDataJSON());if(!once)return route.continue();once=false;await route.fetch();await route.abort('failed');});
  await hook(p,'note-save').click();await expect(hook(p,'note-save')).toBeEnabled();await expect(hook(p,'note-text')).toHaveValue('Image note after lost response');
  const got=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/image-notes'));
  await hook(p,'note-save').click();assert.equal((await got).status(),200);assert.deepEqual(payloads[0],payloads[1]);await p.unroute('**/image-notes');
  assert.equal((await listNotes(c,first.id)).length,2);
 });
 await check('A03: lost image upload response retains UUID and original bytes',async()=>{
  let once=true;const requests=[];await p.route('**/documents/*/images',async route=>{if(route.request().method()!=='POST')return route.continue();const body=route.request().postDataBuffer().toString('latin1');requests.push(body.match(/name="request_id"\r\n\r\n([^\r]+)/)?.[1]);if(!once)return route.continue();once=false;const actual=await route.fetch();assert.equal(actual.status(),201);await route.abort('failed');});
  await hook(p,'image-upload-input').setInputFiles({name:'lost-upload.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(evidence,'fixture.png'))});
  await expect(hook(p,'image-upload-status').locator('[data-action="retry-image-upload"]')).toBeVisible();
  const got=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/documents/${first.id}/images`));await hook(p,'image-upload-status').locator('[data-action="retry-image-upload"]').click();assert.equal((await got).status(),200);
  assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert(requests[0]);await p.unroute('**/documents/*/images');
  assert.equal((await(await c.request.get(base+`/api/v1/documents/${first.id}/images`)).json()).items.length,2);
 });
 await check('A05/A07: Agent reads actual page and exposes safe per-turn source links',async()=>{
  await hook(p,'page-input').fill('2');await p.setViewportSize({width:1580,height:1000});await expect(hook(p,'page-input')).toHaveValue('2');await hook(p,'page-input').press('Enter');await ready(p,first.id,2);await p.setViewportSize({width:1600,height:1050});
  await openAssistant(p);await expect(hook(p,'assistant-context')).toContainText(/2/);
  const accepted=await send(p,first.id,'[PAGE2] Explain the second page');const turn=await checkpoint(c,first.id,accepted.id);
  assert.equal(turn.status,'completed');await expect(hook(p,'assistant-messages')).toContainText('Synthetic page2 answer');
  await expect(hook(p,'assistant-sources')).toContainText(/2/);assert.equal(await p.evaluate(()=>window.injected),undefined);
  assert(turn.sources.some(s=>s.page===2&&s.text.includes('PAGE 2')));
 });
 await check('A04/A09: Agent proposes then confirms note while preserving manual draft',async()=>{
  await closeAssistant(p);await hook(p,'note-text').fill('Unsaved manual draft stays here');
  await newConversation(p);const accepted=await send(p,first.id,'[CREATE] Agent saved text note');const turn=await checkpoint(c,first.id,accepted.id);
  assert.equal(turn.status,'waiting_confirmation');assert.equal((await listNotes(c,first.id)).length,2);
  const card=await proposal(p,turn.proposals[0].id);await expect(card).toContainText('Agent saved text note');assert(!await card.locator('pre').count());
  const saved=await approve(p,first.id,turn);modelNote=saved.proposals[0].result.note_id;
  await closeAssistant(p);await expect(note(p,modelNote)).toContainText('Agent saved text note');await expect(hook(p,'note-text')).toHaveValue('Unsaved manual draft stays here');
 });
 await check('A05/A09: selected image reaches Agent and confirmed image note shares library',async()=>{
  await image(p,asset.id).locator('[data-action="select-chat-image"]').check();await newConversation(p);
  await expect(hook(p,'assistant-context')).toContainText(/1.*图片|1.*image/i);const accepted=await send(p,first.id,'[IMAGE] Agent uploaded-image note');const turn=await checkpoint(c,first.id,accepted.id);
  assert(turn.context.image_ids.includes(asset.id));assert(turn.sources.some(s=>s.kind==='user_upload'));
  const opened=c.waitForEvent('page');await hook(p,'assistant-sources').getByRole('button',{name:asset.original_filename,exact:true}).click();const preview=await opened;await preview.waitForLoadState('domcontentloaded');assert.equal(preview.url(),base+asset.preview_url);await expect.poll(()=>preview.locator('img').evaluate(x=>x.complete&&x.naturalWidth>0)).toBe(true);await preview.close();
  const saved=await approve(p,first.id,turn);await closeAssistant(p);await expect(note(p,saved.proposals[0].result.note_id).locator('img')).toBeVisible();
 });
 await check('A09: rejecting a concrete proposal creates no note',async()=>{
  await newConversation(p);const accepted=await send(p,first.id,'[CREATE] This one will be rejected');const turn=await checkpoint(c,first.id,accepted.id);const before=(await listNotes(c,first.id)).length;
  const card=await proposal(p,turn.proposals[0].id);await card.locator('[data-action="reject-proposal"]').click();await expect(card).toContainText(/放弃|未执行|已拒绝|rejected|not applied/i);assert.equal((await listNotes(c,first.id)).length,before);
 });
 await check('A09/A14: concurrent manual edit retains proposal and can abandon conflict',async()=>{
  await closeAssistant(p);await note(p,modelNote).locator('.note-open').click();await newConversation(p);
  const accepted=await send(p,first.id,'[EDIT] Update selected note');const turn=await checkpoint(c,first.id,accepted.id);
  const state=await(await c.request.get(base+`/api/v1/documents/${first.id}/notes/${modelNote}/state`)).json();
  assert.equal((await c.request.patch(base+`/api/v1/documents/${first.id}/notes/${modelNote}`,{data:{request_id:randomUUID(),expected_revision:state.revision,text:'Newer manually saved text'}})).status(),200);
  const card=await proposal(p,turn.proposals[0].id);await card.locator('[data-action="confirm-proposal"]').click();await expect(card).toHaveAttribute('data-status','conflict');await expect(card).toContainText('Agent proposed revision');
  await card.locator('[data-action="reject-proposal"]').click();await expect(card).toHaveAttribute('data-status','rejected');
  assert((await listNotes(c,first.id)).some(n=>n.id===modelNote&&n.text==='Newer manually saved text'));assert.equal(await p.evaluate(()=>window.injected),undefined);
 });
 await check('A10: lost confirmation response retries exact hash and saves once',async()=>{
  await newConversation(p);const accepted=await send(p,first.id,'[CREATE] Confirm response loss note');const turn=await checkpoint(c,first.id,accepted.id);const before=(await listNotes(c,first.id)).length;
  let once=true;const decisions=[];await p.route('**/proposals/*/confirm',async route=>{decisions.push(route.request().postDataJSON());if(!once)return route.continue();once=false;const r=await route.fetch();assert.equal(r.status(),200);await route.abort('failed');});
  const card=await proposal(p,turn.proposals[0].id);await card.locator('[data-action="confirm-proposal"]').click();
  await expect(hook(p,'assistant-status').locator('button')).toBeVisible();await hook(p,'assistant-status').locator('button').click();await expect(card).toHaveAttribute('data-status','applied');
  assert.equal(decisions.length,2);assert.deepEqual(decisions[0],decisions[1]);assert.equal((await listNotes(c,first.id)).length,before+1);await p.unroute('**/proposals/*/confirm');
 });
 await check('A03/A14: lost turn response retries same captured request and conversation',async()=>{
  await newConversation(p);let once=true;const payloads=[];await p.route('**/agent/turns',async route=>{if(route.request().method()!=='POST')return route.continue();payloads.push(route.request().postDataJSON());if(!once)return route.continue();once=false;const r=await route.fetch();assert.equal(r.status(),202);await route.abort('failed');});
  await hook(p,'assistant-message').fill('[CREATE] Turn response loss note');await hook(p,'assistant-send').click();await expect(hook(p,'assistant-send')).toHaveText(/按原请求重试|Retry original request/);await expect(hook(p,'assistant-send')).toBeEnabled();
  await hook(p,'assistant-send').click();await expect(hook(p,'assistant-proposals').locator('[data-proposal-id]')).toBeVisible();assert.equal(payloads.length,2);assert.deepEqual(payloads[0],payloads[1]);await p.unroute('**/agent/turns');
  await hook(p,'assistant-proposals').locator('[data-action="reject-proposal"]').click();
 });
 await check('A14: delayed old-paper response cannot replace another paper chat draft',async()=>{
  await closeAssistant(p);second=await uploadPDF(p,'second.pdf');await openAssistant(p);await hook(p,'assistant-message').fill('Second paper chat draft');await closeAssistant(p);await select(p,first.id);await newConversation(p);
  let reached,release;const entered=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
  await p.route(`**/documents/${first.id}/agent/turns`,async route=>{const r=await route.fetch();reached();await gate;await route.fulfill({response:r});});
  await hook(p,'assistant-message').fill('[PAGE2] Delayed first paper response');await hook(p,'assistant-send').click();await entered;await closeAssistant(p);await select(p,second.id);await openAssistant(p);await expect(hook(p,'assistant-message')).toHaveValue('Second paper chat draft');release();
  await expect(hook(p,'assistant-context')).toContainText('second');await expect(hook(p,'assistant-message')).toHaveValue('Second paper chat draft');await p.unroute(`**/documents/${first.id}/agent/turns`);await closeAssistant(p);await select(p,first.id);
 });
 await check('A12: disabled vision is clear and keeps message and selected image',async()=>{
  await c.request.post(base+'/__acceptance/mode',{data:{images:false}});await p.reload();await ready(p,first.id);
  await image(p,asset.id).locator('[data-action="select-chat-image"]').check();await newConversation(p);await hook(p,'assistant-message').fill('Image request retained');await hook(p,'assistant-send').click();
  await expect(hook(p,'assistant-status')).toContainText(/图片|image/i);await expect(hook(p,'assistant-message')).toHaveValue('Image request retained');
  await c.request.post(base+'/__acceptance/mode',{data:{images:true}});await p.reload();await ready(p,first.id);
 });
 await check('A12: provider failure is failed history rather than saved/success',async()=>{
  await newConversation(p);const accepted=await send(p,first.id,'[FAIL] Synthetic network failure');const turn=await checkpoint(c,first.id,accepted.id);assert.equal(turn.status,'failed');await expect(hook(p,'assistant-messages')).toContainText(/连接|失败|unavailable|failed/i);
 });
 await check('A15: image-note export includes originals/previews and opens offline',async()=>{
  await closeAssistant(p);const download=p.waitForEvent('download');await hook(p,'export-reading-record').click();await(await download).saveAs(path.join(evidence,'assistant-export.zip'));
  fs.writeFileSync(path.join(evidence,'expected-notes.json'),JSON.stringify(await listNotes(c,first.id),null,2));
 });
 await check('A17: blue theme, English mobile drawer and keyboard retain usable layout',async()=>{
  await hook(p,'theme-select').selectOption('doraemon-blue');await hook(p,'language-toggle').click();await p.setViewportSize({width:390,height:844});await openAssistant(p);
  await hook(p,'assistant-settings-toggle').click();await expect(hook(p,'assistant-provider-key')).toHaveAttribute('type','password');await expect(hook(p,'assistant-provider-key')).toHaveValue('');await hook(p,'assistant-provider-key').fill('acceptance-private-sentinel');assert(!await p.evaluate(()=>Object.values(localStorage).some(x=>String(x).includes('acceptance-private-sentinel'))));await hook(p,'assistant-provider-key').fill('');await hook(p,'assistant-settings-toggle').click();
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await expect(hook(p,'assistant-send')).toBeVisible();await expect(hook(p,'assistant-panel')).toBeVisible();
  await p.screenshot({path:path.join(evidence,'assistant-mobile-en.png'),fullPage:false});await closeAssistant(p);await p.setViewportSize({width:1600,height:1050});await hook(p,'language-toggle').click();await openAssistant(p);await p.screenshot({path:path.join(evidence,'assistant-desktop-zh.png'),fullPage:false});
 });
 let interrupted;
 await check('A09/A14: cancel blocks a late model proposal and keeps existing notes',async()=>{
  await newConversation(p);const count=(await listNotes(c,first.id)).length;const accepted=await send(p,first.id,'[HOLD] Will be cancelled');
  await expect.poll(async()=>(await(await c.request.get(base+'/__acceptance/state')).json()).held).toBe(true);await hook(p,'assistant-cancel').click();await c.request.post(base+'/__acceptance/release');const turn=await checkpoint(c,first.id,accepted.id);assert.equal(turn.status,'cancelled');assert.equal((await listNotes(c,first.id)).length,count);
 });
 fs.writeFileSync(path.join(evidence,'browser-state.json'),JSON.stringify({first,second,asset,manual,modelNote},null,2));
}

async function after(p,c){
 const saved=JSON.parse(fs.readFileSync(path.join(evidence,'browser-state.json')));await p.goto(base+`/?document=${saved.first.id}`);await ready(p,saved.first.id);
 await check('A13/A17: hard restart/fresh browser retains image notes and conversation receipts',async()=>{
  const expected=JSON.parse(fs.readFileSync(path.join(evidence,'expected-notes.json')));assert.deepEqual(await listNotes(c,saved.first.id),expected);await expect(image(p,saved.asset.id)).toBeVisible();await expect(note(p,saved.manual.id).locator('img')).toBeVisible();
  await openAssistant(p);await expect(hook(p,'assistant-history').locator('option')).not.toHaveCount(1);
  const history=await(await c.request.get(base+`/api/v1/documents/${saved.first.id}/agent/conversations`)).json();assert(history.items.length>5);const turns=await(await c.request.get(base+`/api/v1/documents/${saved.first.id}/agent/conversations/${history.items[0].id}`)).json();assert(turns.turns.length);
 });
}

(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const c=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true});const p=await c.newPage();p.setDefaultTimeout(10000);
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url());});
 try{if(phase==='before')await before(p,c);else if(phase==='after')await after(p,c);else await check('A15: portable uploaded-image notes open with app stopped',async()=>{await p.goto(pathToFileURL(path.join(evidence,'unpacked/index.html')).href);await expect(p.locator('body')).toContainText('User-uploaded image');assert(await p.locator('img').evaluateAll(xs=>xs.length>0&&xs.every(x=>x.complete&&x.naturalWidth>0)));assert.equal(await p.locator('script').count(),0);});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);}
 catch(e){await p.screenshot({path:path.join(evidence,`failure-${phase}.png`),fullPage:true}).catch(()=>{});throw e;}finally{await c.close();}
})().then(()=>{fs.writeFileSync(path.join(evidence,`browser-${phase}.json`),JSON.stringify({passed:true,checks,errors,external},null,2));console.log(JSON.stringify({passed:true,phase,checks:checks.length}));}).catch(e=>{fs.writeFileSync(path.join(evidence,`browser-${phase}.json`),JSON.stringify({passed:false,checks,errors,external,error:e.stack},null,2));console.error(e.stack);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);if(browser)await browser.close().catch(()=>{});});
