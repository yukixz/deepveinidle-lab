import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath} from '../scripts/release-common.mjs';
import {craftingDefaults} from '../src/crafting-model.js';
import {compactNumber} from '../src/number-format.js';
import {priceDefaults} from '../src/item-prices.js';
const directory=path.resolve(process.argv[2]??'.test-artifacts/crafting-table');await fs.mkdir(directory,{recursive:true});
let base=process.argv[3],server,browser,page;const results={cases:[],errors:[]};
try{
 if(!base){const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});await once(server.stdout,'data');base=`http://127.0.0.1:${port}`;}
 browser=await chromium.launch({headless:true,executablePath:await browserPath()});
 const prices=priceDefaults();prices.preferences.autoImport=false;
 const build=craftingDefaults();build.simulationHours=1;build.hotSetting='off';build.levels.cooking=20;build.levels.crafting=110;build.levels.smithing=110;
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(({build,prices})=>{
  if(!localStorage.getItem('trim-initialized')){localStorage.setItem('trim-initialized','1');localStorage.setItem('dvi-crafting-orders-v1',JSON.stringify({version:1,build,orders:'broken',inventory:'broken'}));localStorage.setItem('dvi-item-prices-v1',JSON.stringify(prices));}
  window.runs=[];const Original=Worker;
  window.Worker=class extends Original{
   constructor(url,options){super(url,options);if(String(url).includes('crafting-worker')){this.run={results:[]};window.runs.push(this.run);window.craftWorker=this;this.addEventListener('message',({data})=>{if(data.result)this.run.results.push(data.result);if(data.done)this.run.done=true;});}}
   postMessage(data,...rest){if(this.run){this.run.input=data;if(window.holdCraft)return;}return super.postMessage(data,...rest);}
  };
  document.addEventListener('dvi-character-request',event=>{const r=JSON.parse(event.detail);document.dispatchEvent(new CustomEvent('dvi-character-response',{detail:JSON.stringify({source:'dvi-character-script',id:r.id,version:'2.4',ready:true})}));});
 },{build,prices});
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>results.errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>document.querySelector('.craft-progress')?.classList.contains('is-idle'));
 const row=key=>page.locator('.craft-table tbody tr').filter({has:page.locator(`[id="craft-${key}-recipe"]`)});
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dvi-crafting-config-v1')));
 await page.goto(base+'/craft');await ready();
 assert.equal((await saved()).build.simulationHours,1);assert.equal(await page.evaluate(()=>localStorage.getItem('dvi-crafting-orders-v1')),null);
 assert.equal(await page.locator('#craft-orders-panel,#craft-filled,#craft-refresh-inventory,[data-craft-count],[data-character-update="inventory"]').count(),0);
 assert.equal(await page.locator('.craft-table th').count(),7);assert.equal(await page.locator('.craft-table tbody tr').evaluateAll(rows=>rows.every(r=>r.cells.length===7)),true);
 const run=await page.evaluate(()=>window.runs[0]);const result=run.results.find(r=>r.key==='61:0');assert.ok(result);
 assert.equal(await row('61:0').locator('td').nth(1).locator('summary').innerText(),compactNumber(result.xp*24)??(result.xp*24).toLocaleString('zh-CN',{maximumFractionDigits:2}));
 assert.equal(await row('61:0').locator('td').nth(3).locator('summary').innerText(),(result.extraTicks/result.elapsedTicks*100).toLocaleString('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:1})+'%');
 results.cases.push('legacy build migrates despite invalid removed fields; no removed controls; seven columns; real Worker daily XP and extra time');
 await row('61:0').locator('td').nth(3).locator('summary').click();await row('61:0').locator('td').nth(4).locator('summary').click();
 await page.locator('[data-craft-sort="xp"]').click();assert.equal(await page.locator('[id="craft-61:0-timing"]').getAttribute('open'),'');
 for(const width of [1440,390])for(const language of ['zh','en']){
  await page.setViewportSize({width,height:1000});await page.selectOption('#language',language);await ready();
  assert.equal(await page.locator('.craft-table th').count(),7);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.match(await page.locator('[id="craft-61:0-completed"]').innerText(),language==='zh'?/每刻完成概率/:/Completion chance per tick/);
  assert.doesNotMatch(await page.locator('[id="craft-61:0-timing"]').innerText(),/随机种子|Random seed|坐标/);
  await page.locator('.craft-recipe-heading').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,`${language}-${width}.png`)});
 }
 results.cases.push('Chinese/English desktop and 390px layout, sort, work probability, timing details retained across redraw');
 await page.setViewportSize({width:1440,height:1000});await page.selectOption('#language','zh');
 const cost=row('61:0').locator('td').nth(5).locator('details');
 await cost.locator('summary').click();
 const count=await page.evaluate(()=>window.runs.length);
 await page.locator('#craft-section [data-open-global-prices]').click();
 const priceSearch=page.locator('#price-search');
 await priceSearch.fill('Shrimp');await priceSearch.blur();
 const globalPrice=page.locator('[data-price-value="20"]');
 await globalPrice.fill('1250');await globalPrice.blur();await page.keyboard.press('Escape');
 assert.match(await cost.locator('.gather-item').innerText(),/1\.25K/);
 const materialSource=page.locator('[data-page-prices="craft"] [data-page-price="materials"]');
 await materialSource.selectOption('none');
 assert.doesNotMatch(await cost.locator('.gather-item').innerText(),/1\.25K/);
 await materialSource.selectOption('avg7d');
 assert.match(await cost.locator('.gather-item').innerText(),/1\.25K/);
 assert.equal(await cost.getAttribute('open'),'');
 assert.equal(await page.evaluate(()=>window.runs.length),count);
 await page.locator('[data-craft-skill="crafting"]').click();await page.selectOption('#craft-group','Fireworks');await ready();
 const powder=page.locator('.craft-table .gather-item').filter({hasText:'烟花火药'}).first();
 await powder.locator('xpath=ancestor::details').evaluate(e=>e.open=true);
 assert.equal(await powder.locator('[aria-label="缺价"]').count(),1);
 const missing=page.locator('[data-page-prices="craft"] [data-page-price="missing"]');
 const powderRuns=await page.evaluate(()=>window.runs.length);
 for(const mode of ['vendorPrice','none']){
  await missing.selectOption(mode);
  assert.equal(await powder.locator('[aria-label="缺价"]').count(),0);
 }
 await missing.selectOption('warn');
 assert.equal(await powder.locator('[aria-label="缺价"]').count(),1);
 assert.equal(await page.evaluate(()=>window.runs.length),powderRuns);
 await page.evaluate(async()=>{const {setPrice}=await import('/src/price-service.js');setPrice(700,50);});
 await page.reload();await page.selectOption('#craft-group','Fireworks');await ready();
 await powder.locator('xpath=ancestor::details').evaluate(e=>e.open=true);
 assert.match(await powder.locator('span').first().innerText(),/ 50$/);
 assert.equal(await powder.locator('[aria-label="缺价"]').count(),0);
 assert.equal(await page.locator('.craft-table tbody input').count(),0);
 results.cases.push('read-only material prices, global price changes without new simulation, and existing powder prices survive reload');
 // Delayed Worker repaint must preserve the focused search control.
 const previousRuns=await page.evaluate(()=>{window.holdCraft=true;return window.runs.length;});await page.locator('#craft-rerun').click();await page.waitForFunction(n=>window.runs.length>n&&window.runs.at(-1)?.input,previousRuns);
 await page.locator('#craft-search').focus();
 await page.evaluate(()=>{window.focusedSearch=document.activeElement;window.craftWorker.onmessage({data:{progress:{completed:1,total:5}}});});
 await page.waitForFunction(()=>document.querySelector('.craft-progress').textContent.includes('1/5'));assert.ok(await page.evaluate(()=>document.activeElement===window.focusedSearch));
 await page.evaluate(()=>{const w=window.craftWorker;for(const p of w.run.input.recipes)w.onmessage({data:{jobError:{key:p.key,message:'invalidRoute'}}});w.onmessage({data:{done:true}});});await ready();assert.match(await page.locator('.craft-table tbody').innerText(),/无法建立制造路线/);
 assert.equal(await page.locator('.craft-table tbody tr').evaluateAll(rows=>rows.every(r=>r.cells.length===7)),true);
 results.cases.push('pending and failed seven-column rows; progress preserves exact focused search node');
 await page.locator('#craft-search').fill('no-such-item');assert.equal(await page.locator('.empty-results').getAttribute('colspan'),'7');
 await page.evaluate(()=>window.holdCraft=false);await page.locator('#craft-reset').click();await ready();assert.deepEqual((await saved()).build,{...craftingDefaults(),simulationHours:build.simulationHours,hotSetting:build.hotSetting});
 await context.close();
 const bad=await browser.newContext();await bad.addInitScript(()=>localStorage.setItem('dvi-crafting-config-v1','broken'));const badPage=await bad.newPage();await badPage.goto(base+'/craft');assert.equal(await badPage.locator('#craft-reset-storage').count(),1);assert.equal(await badPage.evaluate(()=>localStorage.getItem('dvi-crafting-config-v1')),'broken');badPage.once('dialog',d=>d.accept());await badPage.locator('#craft-reset-storage').click();assert.equal(await badPage.locator('#craft-reset-storage').count(),0);await bad.close();
 results.cases.push('empty results, configuration reset, corrupted storage protection and explicit storage reset');assert.deepEqual(results.errors,[]);
}catch(error){results.errors.push(error.stack??String(error));if(page)await page.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{if(browser)await browser.close();server?.kill();await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2)+'\n');}console.log(JSON.stringify(results,null,2));
