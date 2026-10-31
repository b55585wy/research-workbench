const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium,expect}=require('C:/Users/wangyi/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/test');
const [base,evidence,phase]=process.argv.slice(2);
const reading=JSON.parse(fs.readFileSync(path.join(evidence,'expected-reading.json')));
const doc=reading.document_id,method=reading.notes.find(n=>n.key==='method');
const checks=[],errors=[],external=[];let browser;
const watchdog=setTimeout(async()=>{if(browser)await browser.close().catch(()=>{});process.exit(1);},220000);
const metaPath=id=>`/api/v1/documents/${id}/metadata`;
const active=(p,id)=>p.getByTestId('notes-list').locator(`[data-note-id="${id}"]`);
const results=p=>p.getByTestId('library-search-results');
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});throw e;}}
async function metadata(c,id=doc){return(await c.request.get(base+metaPath(id))).json();}
async function ready(p,id=doc){await expect(p.getByTestId('reader-canvas')).toHaveAttribute('data-document-id',id);await expect(p.getByTestId('note-text')).toBeEnabled();}
async function open(p,id=doc){await p.goto(base+`/?document=${id}`);await ready(p,id);await expect(p.getByTestId('metadata-edit')).toBeEnabled();}
async function select(p,id){await p.getByTestId('documents-list').locator(`[data-document-id="${id}"] button`).click();await ready(p,id);await expect(p.getByTestId('metadata-edit')).toBeEnabled();}
async function showMetadata(p){if(!await p.locator('#metadata-panel').evaluate(x=>x.open))await p.getByTestId('metadata-toggle').click();}
async function editMetadata(p,fields={}){await showMetadata(p);await p.getByTestId('metadata-edit').click();for(const[k,v]of Object.entries(fields))await p.getByTestId('metadata-'+k).fill(v===null?'':String(v));}
async function saveMetadata(p,id=doc){const got=p.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(metaPath(id)));await p.getByTestId('metadata-save').click();const r=await got;assert.equal(r.status(),200,await r.text());await expect(p.getByTestId('metadata-edit')).toBeVisible();return r.json();}
async function upload(p,file,status){const got=p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/documents');await p.getByTestId('upload-input').setInputFiles(file);const r=await got;assert.equal(r.status(),status,await r.text());await expect(p.locator('#upload-button')).toBeEnabled();return r.json();}
async function search(p,q){await p.getByTestId('library-search-input').fill(q);const got=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/search'&&new URL(r.url()).searchParams.get('q')===q);await p.getByTestId('library-search-submit').click();const r=await got;assert.equal(r.status(),200,await r.text());await expect(p.getByTestId('library-search-submit')).toBeEnabled();return r.json();}
async function ink(p,maxWidth=2000){await p.waitForFunction(max=>{const c=document.querySelector('#reader-canvas');if(!c?.width||c.getBoundingClientRect().width>max)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=16)if(d[i+3]>200&&d[i]<120&&d[i+1]<120&&d[i+2]<120&&++n>40)return true;return false;},maxWidth);}

async function before(p,c){
 await open(p);
 const original=await metadata(c),originalNotes=(await(await c.request.get(base+`/api/v1/documents/${doc}/note-states`)).json()).items;
 let second;
 await check('L01/L02: existing real PDF upload reuses original paper and four notes',async()=>{
  const r=await upload(p,'C:/Users/wangyi/Downloads/1-s2.0-S0003682X25000970-main.pdf',200);
  assert.equal(r.id,doc);await ready(p);await expect(p.getByTestId('app-status')).toContainText(/已有|已在|重复|already|existing/i);
  assert.deepEqual((await(await c.request.get(base+`/api/v1/documents/${doc}/note-states`)).json()).items,originalNotes);
  assert.equal((await(await c.request.get(base+'/api/v1/documents')).json()).items.length,1);
 });
 await check('L05: invalid upload reports error and keeps the opened paper',async()=>{
  await upload(p,{name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')},422);
  await expect(p.getByTestId('app-status')).toHaveAttribute('data-kind','error');await ready(p);
 });
 await check('L01/L03: same filename with different PDF bytes creates two independent papers',async()=>{
  const a=await upload(p,{name:'same-name.pdf',mimeType:'application/pdf',buffer:fs.readFileSync(path.join(evidence,'synthetic-1.pdf'))},201);
  const b=await upload(p,{name:'same-name.pdf',mimeType:'application/pdf',buffer:fs.readFileSync(path.join(evidence,'synthetic-2.pdf'))},201);
  assert.notEqual(a.id,b.id);assert.equal(a.page_count,1);assert.equal(b.page_count,2);second=b.id;
  await expect(p.getByTestId('documents-list').locator('[data-document-id]')).toHaveCount(3);
 });
 await check('L04: lost committed upload response retries without another document',async()=>{
  let first=true,committed,observed;const pattern='**/api/v1/documents',trace=[];
  const retried=new Promise(r=>observed=r);
  await p.route(pattern,async route=>{if(route.request().method()!=='POST')return route.continue();const bytes=route.request().postDataBuffer();trace.push({first,size:bytes?.length,filename:bytes?.toString('latin1').match(/filename="([^"]*)"/)?.[1]});if(!first){const r=await route.fetch();const body=await r.json();trace.push({status:r.status(),body});await route.fulfill({response:r});observed({status:r.status(),body});return;}first=false;const r=await route.fetch();assert.equal(r.status(),201,await r.text());committed=await r.json();await route.abort('failed');});
  await p.getByTestId('upload-input').setInputFiles({name:'synthetic-3.pdf',mimeType:'application/pdf',buffer:fs.readFileSync(path.join(evidence,'synthetic-3.pdf'))});
  await expect(p.locator('#status-retry')).toBeVisible();assert(committed);
  trace.push({statusText:await p.getByTestId('app-status').innerText()});await p.locator('#status-retry').click();const retry=await retried;fs.writeFileSync(path.join(evidence,'upload-retry-trace.json'),JSON.stringify(trace,null,2));assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(retry.body.id,committed.id);
  await expect(p.locator('#upload-button')).toBeEnabled();await p.unroute(pattern);
  assert.equal((await(await c.request.get(base+'/api/v1/documents')).json()).items.length,4);
  await select(p,doc);
 });
 await check('L06/L13: metadata cancel preserves original metadata and independent note draft',async()=>{
  await p.getByTestId('note-text').fill('独立的新笔记草稿');await editMetadata(p,{title:'取消的标题'});
  await expect(p.getByTestId('export-reading-record')).toBeDisabled();await p.getByTestId('metadata-cancel').click();
  assert.deepEqual(await metadata(c),original);await expect(p.getByTestId('note-text')).toHaveValue('独立的新笔记草稿');
 });
 await check('L06/L18: saved bibliography updates visible title safely and keeps original notes',async()=>{
  await editMetadata(p,{title:'声全息研究 <img src=x onerror="window.injected=1">',authors:'Straße; 王某 <script>bad()</script>',year:2025,doi:'10.1016/j.apacoust.2025.110625'});
  const saved=await saveMetadata(p);await expect(p.locator('#document-title')).toHaveText(saved.title);
  assert.equal(await p.evaluate(()=>window.injected),undefined);assert.deepEqual((await(await c.request.get(base+`/api/v1/documents/${doc}/note-states`)).json()).items,originalNotes);
 });
 await check('L09: search finds title,authors,year,DOI and filename with Unicode/case folding',async()=>{
  for(const q of ['全息研究','STRASSE','2025','110625',original.original_filename.toUpperCase().slice(0,16)]){
   const found=await search(p,q);assert(found.documents.some(d=>d.id===doc),q);await expect(results(p).locator(`[data-document-id="${doc}"]`).first()).toBeVisible();
  }
 });
 await check('L14: note search opens exact saved page/rectangle and keeps the creation draft',async()=>{
  await search(p,'目标幅度图 AE');const hit=results(p).locator(`[data-note-id="${method.id}"]`);await expect(hit).toBeVisible();await hit.locator('button').click();
  await expect(p.getByTestId('reader-canvas')).toHaveAttribute('data-page','4');await expect(p.locator('.source-highlight')).toHaveAttribute('data-note-id',method.id);
  await expect(p.getByTestId('note-text')).toHaveValue('独立的新笔记草稿');
 });
 await check('L11/L12: late query and clear cannot replace a newer search',async()=>{
  let reached,release;const entered=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
  await p.route('**/api/v1/search?**',async route=>{if(new URL(route.request().url()).searchParams.get('q')!=='old-query')return route.continue();const r=await route.fetch();reached();await gate;try{await route.fulfill({response:r});}catch{}});
  await p.getByTestId('library-search-input').fill('old-query');await p.getByTestId('library-search-submit').click();await entered;
  await search(p,'STRASSE');release();await expect(results(p)).toContainText('声全息研究');
  await p.getByTestId('library-search-clear').click();await expect(results(p)).toBeHidden();await expect(p.getByTestId('library-search-input')).toHaveValue('');
  await p.unroute('**/api/v1/search?**');
 });
 await check('L11: no-result search and service error have distinct visible states and retry',async()=>{
  await search(p,'no-such-paper-xyz');await expect(p.getByTestId('library-search-status')).toContainText(/没有|未找到|无匹配|No .*found|No results/i);
  let first=true;await p.route('**/api/v1/search?**',async route=>{if(!first)return route.continue();first=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{code:'storage_unavailable',message:'Unavailable'}})});});
  await p.getByTestId('library-search-input').fill('STRASSE');await p.getByTestId('library-search-submit').click();await expect(p.locator('#library-search-retry')).toBeVisible();
  await p.locator('#library-search-retry').click();await expect(results(p)).toContainText('声全息研究');await p.unroute('**/api/v1/search?**');await p.getByTestId('library-search-clear').click();
 });
 await check('L08/L13: lost metadata save response retries exactly once without losing form values',async()=>{
  await editMetadata(p,{authors:'响应丢失后保留的作者'});const payloads=[];let first=true;
  await p.route('**'+metaPath(doc),async route=>{if(route.request().method()!=='PATCH')return route.continue();payloads.push(route.request().postDataJSON());if(!first)return route.continue();first=false;await route.fetch();await route.abort('failed');});
  const before=await metadata(c);await p.getByTestId('metadata-save').click();await expect(p.getByTestId('metadata-retry')).toBeVisible();await expect(p.getByTestId('metadata-authors')).toHaveValue('响应丢失后保留的作者');
  await p.getByTestId('metadata-retry').click();await expect(p.getByTestId('metadata-edit')).toBeVisible();assert.equal((await metadata(c)).revision,before.revision+1);assert.equal(payloads.length,2);assert.deepEqual(payloads[0],payloads[1]);await p.unroute('**'+metaPath(doc));
 });
 await check('L08/L13: two-tab metadata conflict keeps draft and cannot overwrite a newer title',async()=>{
  const other=await c.newPage();await open(other);await editMetadata(p,{title:'本页旧版本草稿'});await editMetadata(other,{title:'另一页先保存的标题'});await saveMetadata(other);
  const got=p.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(metaPath(doc)));await p.getByTestId('metadata-save').click();assert.equal((await got).status(),409);
  await expect(p.getByTestId('metadata-title')).toHaveValue('本页旧版本草稿');await expect(p.locator('#metadata-view-latest')).toBeVisible();await p.locator('#metadata-view-latest').click();
  await expect(p.getByTestId('metadata-title')).toHaveValue('本页旧版本草稿');assert.equal((await metadata(c)).title,'另一页先保存的标题');
  await p.getByTestId('metadata-cancel').click();await editMetadata(p,{title:'研究记录：声全息论文',authors:'Straße; 王某'});await saveMetadata(p);await other.close();
 });
 await check('L12/L13: per-paper metadata and note drafts survive navigation',async()=>{
  await editMetadata(p,{authors:'本篇未提交作者'});await select(p,second);await editMetadata(p,{authors:'另一篇未提交作者'});await select(p,doc);
  await showMetadata(p);await expect(p.getByTestId('metadata-authors')).toHaveValue('本篇未提交作者');await expect(p.getByTestId('note-text')).toHaveValue('独立的新笔记草稿');await p.getByTestId('metadata-cancel').click();
 });
 await check('L12: delayed metadata save cannot replace another paper form',async()=>{
  await editMetadata(p,{authors:'最终作者：Straße; 王某'});let reached,release;const entered=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
  await p.route('**'+metaPath(doc),async route=>{if(route.request().method()!=='PATCH')return route.continue();const r=await route.fetch();reached();await gate;await route.fulfill({response:r});});
  await p.getByTestId('metadata-save').click();await entered;await select(p,second);await showMetadata(p);await expect(p.getByTestId('metadata-authors')).toHaveValue('另一篇未提交作者');
  release();await expect(p.getByTestId('metadata-save')).toBeEnabled();await expect(p.getByTestId('metadata-authors')).toHaveValue('另一篇未提交作者');
  await p.getByTestId('metadata-cancel').click();await p.unroute('**'+metaPath(doc));await select(p,doc);await showMetadata(p);await expect(p.getByTestId('metadata-authors')).toHaveValue('最终作者：Straße; 王某');
 });
 await check('L06: clearing optional metadata is saved; cancelling a note edit preserves bibliography',async()=>{
  await editMetadata(p,{year:null,doi:''});await saveMetadata(p);assert.equal((await metadata(c)).year,null);assert.equal((await metadata(c)).doi,'');
  await editMetadata(p,{year:2025,doi:'10.1016/j.apacoust.2025.110625'});await saveMetadata(p);
  const before=await metadata(c);await active(p,method.id).locator('[data-action="edit-note"]').click();await p.getByTestId('note-text').fill('取消的笔记编辑');await p.getByTestId('edit-cancel').click();assert.deepEqual(await metadata(c),before);
 });
 await check('L20: Doraemon blue preserves drafts and original PDF pixels with readable controls',async()=>{
  const noteDraft=await p.getByTestId('note-text').inputValue();await editMetadata(p,{authors:'主题切换时的未提交草稿'});
  await ink(p);let lastPixels,stable=0;await expect.poll(async()=>{const value=await p.getByTestId('reader-canvas').evaluate(x=>x.toDataURL());stable=value===lastPixels?stable+1:0;lastPixels=value;return stable;},{intervals:[100],timeout:10000}).toBeGreaterThanOrEqual(3);const pixels=lastPixels;
  await p.getByTestId('theme-select').selectOption('doraemon-blue');await expect(p.locator('html')).toHaveAttribute('data-theme','doraemon-blue');
  await expect(p.getByTestId('metadata-authors')).toHaveValue('主题切换时的未提交草稿');await expect(p.getByTestId('note-text')).toHaveValue(noteDraft);
  assert.equal(await p.getByTestId('reader-canvas').evaluate(x=>x.toDataURL()),pixels);
  assert(await p.locator('canvas,img').evaluateAll(xs=>xs.every(x=>getComputedStyle(x).filter==='none')));
  const colors=await p.locator('#upload-button').evaluate(x=>({fg:getComputedStyle(x).color,bg:getComputedStyle(x).backgroundColor}));
  const lum=s=>{const v=s.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;};
  const a=lum(colors.fg),b=lum(colors.bg);assert((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,JSON.stringify(colors));
  await p.getByTestId('theme-select').selectOption('default');await expect(p.getByTestId('theme-select')).toHaveValue('default');await p.getByTestId('theme-select').selectOption('doraemon-blue');await p.getByTestId('metadata-cancel').click();
 });
 await check('L20: theme survives reload and language switch without changing saved data',async()=>{
  const before=await metadata(c);await p.reload();await ready(p);await expect(p.getByTestId('theme-select')).toHaveValue('doraemon-blue');await expect(p.locator('html')).toHaveAttribute('data-theme','doraemon-blue');
  await p.getByTestId('language-toggle').click();await expect(p.getByTestId('theme-select')).toHaveValue('doraemon-blue');await p.getByTestId('language-toggle').click();assert.deepEqual(await metadata(c),before);
 });
 await check('L15/L18: keyboard export includes saved metadata; bilingual mobile form fits',async()=>{
  const download=p.waitForEvent('download');await p.getByTestId('export-reading-record').focus();await p.keyboard.press('Enter');await(await download).saveAs(path.join(evidence,'library-export.zip'));
  fs.writeFileSync(path.join(evidence,'expected-metadata.json'),JSON.stringify(await metadata(c),null,2));
  await p.getByTestId('language-toggle').click();await p.setViewportSize({width:390,height:844});await showMetadata(p);await expect(p.getByTestId('metadata-edit')).toBeVisible();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await ink(p,390);await p.screenshot({path:path.join(evidence,'library-mobile-en.png'),fullPage:true});
  await p.setViewportSize({width:1600,height:1050});await p.getByTestId('language-toggle').click();await p.evaluate(()=>scrollTo(0,0));await ink(p);await p.screenshot({path:path.join(evidence,'library-desktop-zh.png'),fullPage:false});
 });
}

async function after(p,c){
 await open(p);await showMetadata(p);
 await check('L17/L19: hard restart/fresh browser retains saved metadata and original pending notes',async()=>{
  const expected=JSON.parse(fs.readFileSync(path.join(evidence,'expected-metadata.json')));assert.deepEqual(await metadata(c),expected);
  await expect(p.getByTestId('metadata-title')).toHaveValue(expected.title);await search(p,'STRASSE');await expect(results(p)).toContainText(expected.title);
  const notes=(await(await c.request.get(base+`/api/v1/documents/${doc}/note-states`)).json()).items;assert.equal(notes.length,4);assert(notes.every(n=>n.review_status==='unreviewed'&&n.revision===1));
  await upload(p,'C:/Users/wangyi/Downloads/1-s2.0-S0003682X25000970-main.pdf',200);assert.deepEqual(await metadata(c),expected);
 });
}

(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const c=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true});const p=await c.newPage();p.setDefaultTimeout(10000);
 c.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url());});
 try{
  if(phase==='before')await before(p,c);else if(phase==='after')await after(p,c);else await check('L15: offline export opens bibliography and all original images with app stopped',async()=>{
   await p.goto(pathToFileURL(path.join(evidence,'unpacked/index.html')).href);await expect(p.locator('h1')).toHaveText('研究记录：声全息论文');await expect(p.locator('body')).toContainText('最终作者：Straße; 王某');await expect(p.locator('body')).toContainText('2025');await expect(p.locator('img')).toHaveCount(2);assert(await p.locator('img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));assert.equal(await p.locator('script').count(),0);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }catch(e){await p.screenshot({path:path.join(evidence,`failure-${phase}.png`),fullPage:true}).catch(()=>{});throw e;}
 finally{await c.close();}
 console.log(JSON.stringify({passed:true,phase,checks:checks.length}));
})().then(()=>{fs.writeFileSync(path.join(evidence,`browser-${phase}.json`),JSON.stringify({passed:true,checks,errors,external},null,2));}).catch(e=>{fs.writeFileSync(path.join(evidence,`browser-${phase}.json`),JSON.stringify({passed:false,checks,errors,external,error:e.stack},null,2));console.error(e.stack);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);if(browser)await browser.close().catch(()=>{});});
