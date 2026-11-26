import {legacyPriceState} from './fixtures/legacy-price-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath,json} from '../scripts/release-common.mjs';
import {priceDefaults,setItemPrice} from '../src/item-prices.js';

const toolbarOnly=process.argv.includes('--toolbar-only');
const option=key=>{const index=process.argv.indexOf(key);if(index===-1)return null;assert.ok(process.argv[index+1]&&!process.argv[index+1].startsWith('--'),`Missing value for ${key}`);return process.argv[index+1];};
const directory=path.resolve(option('--out')??(toolbarOnly?'.test-artifacts/price-toolbar':'.test-artifacts/market-prices'));
let base=option('--base-url'),server;
if(base){const url=new URL(base);assert.ok(['http:','https:'].includes(url.protocol));base=url.origin;}
await fs.mkdir(directory,{recursive:true});
const result={base,cases:[],errors:[]};let browser;
try{
 if(!base){
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([code])=>{throw Error(`Server exited: ${code}`);})]);
  base=`http://127.0.0.1:${port}`;result.base=base;
 }
 browser=await chromium.launch({headless:true,executablePath:await browserPath()});
 if(!toolbarOnly){
 const live=await browser.newContext(),livePage=await live.newPage();
 await livePage.goto(base+'/forecast');
 result.live=await livePage.evaluate(async()=>{
  const {requestMarket}=await import('/src/market-import.js');const {snapshot}=await requestMarket();
  return {quantities:Object.values(snapshot.quotes).filter(q=>Number.isSafeInteger(q.ask?.quantity)&&Number.isSafeInteger(q.bid?.quantity)).length,items:Object.keys(snapshot.quotes).length,invalid:snapshot.invalid,generatedAt:new Date(Object.values(snapshot.quotes)[0].ask.capturedAt).toISOString()};
 });
 assert.ok(result.live.items>0);assert.ok(result.live.quantities>0);result.cases.push('real browser cross-origin official API request without userscript');await live.close();
 }
 for(const language of ['zh','en'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  page.on('pageerror',e=>result.errors.push(e.message));
  let requests=0,fail=true;
  const payload={game:'Deep Vein Idle',generatedAt:new Date().toISOString(),refreshSeconds:300,items:{1:{avg7d:74,avg30d:64,lowestSell:84,sellQty:7,highestBuy:50,buyQty:6},2:{avg7d:80}}};
  await context.route('https://deepveinidle.com/api/market/prices.json',route=>{
   requests++;return route.fulfill({status:fail?503:200,contentType:'application/json',body:fail?'Unavailable':JSON.stringify(payload)});
  });
  const saved=setItemPrice(setItemPrice(legacyPriceState(2),1,123),2,99);
  saved.prices[1].locked=true;
  await context.addInitScript(({saved,language})=>{
   if(!localStorage.getItem('dvi-item-prices-v1'))localStorage.setItem('dvi-item-prices-v1',JSON.stringify(saved));
   localStorage.setItem('dvi-price-auto-import-at-v1',String(Date.now()));
   localStorage.setItem('dvi-simulator-v1',JSON.stringify({language}));
  },{saved,language});
  await page.goto(base+'/enhance');
  const opener=page.locator('#enhance-section [data-open-global-prices]');
  await opener.click();assert.equal(requests,0);
  assert.equal(await page.locator('#price-import-settings, #price-import-reset, [data-price-category]').count(),0);
  assert.equal(await page.locator('.price-sync #price-import, .price-sync #price-auto-import').count(),2);
  await page.locator('#price-import').click();await page.locator('#price-status[role="alert"]').waitFor();
  const error=await page.locator('#price-status').textContent();
  await page.locator('#price-close').click();await opener.click();assert.equal(await page.locator('#price-status').textContent(),error);
  fail=false;await page.locator('#price-import').click();
  await page.waitForFunction(()=>/已刷新|Refreshed/.test(document.getElementById('price-status')?.textContent));
  assert.equal(requests,2);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('dvi-item-prices-v1')));
  assert.equal(stored.version,8);assert.equal(stored.prices[1].price,123);assert.equal(stored.prices[1].locked,true);
  assert.equal(stored.prices[2].price,99);assert.equal(stored.quotes[1].avg7d.value,74);
  await page.locator('#price-search').fill('Copper');await page.locator('#price-search').blur();
  assert.equal(await page.locator('[data-price-value="1"]').inputValue(),'123');
  await page.locator('#price-filter').selectOption('locked');
  assert.equal(await page.locator('[data-price-value="1"]').count(),1);
  assert.ok(await page.locator('#item-prices-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.screenshot({path:path.join(directory,`quotes-${language}-${width}.png`)});
  await page.keyboard.press('Escape');await page.locator('#item-prices-dialog[open]').waitFor({state:'hidden'});
  assert.equal(await opener.evaluate(el=>document.activeElement===el),true);
  result.cases.push(`${language} ${width}px: global dialog, offline open, preserved error, quote-only refresh, lock and migration, filter, focus`);
  await context.close();
 }
 {
  const context=await browser.newContext(),page=await context.newPage();let requests=0;
  await context.route('https://deepveinidle.com/api/market/prices.json',route=>{requests++;return route.fulfill({status:503,body:'Unavailable'});});
  await page.goto(base+'/forecast');await page.locator('#price-auto-notice [role="alert"]').waitFor();
  assert.match(await page.locator('#price-auto-notice').innerText(),/failed|失败/);
  await page.reload();await page.locator('#forecast-content').waitFor();assert.equal(requests,1);
  result.cases.push('automatic API failure is visible and not retried on reload within five minutes');await context.close();
 }
 if(!toolbarOnly){
 const captureContext=await browser.newContext(),capturePage=await captureContext.newPage();
 capturePage.on('pageerror',e=>result.errors.push(e.message));
 await captureContext.route('**/character-capture-check',route=>route.fulfill({contentType:'text/html',path:'tests/fixtures/character-capture.html'}));
 await captureContext.route('**/candidate.js',route=>route.fulfill({contentType:'text/javascript',path:'src/character-import.user.js'}));
 await capturePage.goto(base+'/character-capture-check');
 await capturePage.waitForFunction(()=>{const text=document.querySelector('#results').textContent;if(!text.startsWith('{'))return false;const r=JSON.parse(text);return r.error||r.passed?.includes('PASS');},{},{timeout:20000});
 result.capture=JSON.parse(await capturePage.locator('#results').innerText());assert.equal(result.capture.error,undefined,JSON.stringify(result.capture));assert.ok(result.capture.passed.includes('PASS'));
 result.cases.push('direct character capture without Worker: trimming, ignored market frames, coalesced slow saves, connection isolation and visible data errors');
 await captureContext.close();
 }
 {
  const context=await browser.newContext(),page=await context.newPage();let requests=0;
  const saved=priceDefaults();saved.preferences.autoImport=false;
  await context.addInitScript(saved=>{if(!localStorage.getItem('dvi-item-prices-v1'))localStorage.setItem('dvi-item-prices-v1',JSON.stringify(saved));},saved);
  await context.route('https://deepveinidle.com/api/market/prices.json',route=>{requests++;return route.fulfill({status:503,body:'Unavailable'});});
  await page.goto(base+'/enhance');await page.locator('#enhance-section [data-open-global-prices]').click();assert.equal(requests,0);assert.equal(await page.locator('#price-auto-import').isChecked(),false);
  await page.reload();await page.locator('#enhance-section [data-open-global-prices]').click();assert.equal(requests,0);assert.equal(await page.locator('#price-auto-import').isChecked(),false);
  await page.locator('#price-auto-import').check();assert.equal(requests,0);await page.reload();await page.locator('#price-auto-notice').waitFor();assert.equal(requests,1);
  result.cases.push('automatic import checkbox persists across reloads, prevents requests while off, and enables the next visit');await context.close();
 }
 for(const fail of [false,true]){
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  const at=new Date();await page.clock.install({time:at});await page.clock.pauseAt(at);
  await context.route('https://deepveinidle.com/api/market/prices.json',route=>route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify({game:'Deep Vein Idle',generatedAt:at.toISOString(),refreshSeconds:300,items:{1:{lowestSell:84,highestBuy:50}}})}));
  await page.goto(base+'/forecast');await page.locator('#price-auto-notice').waitFor();
  assert.equal(await page.locator('#price-auto-notice button').count(),0);
  await page.clock.runFor(29999);assert.equal(await page.locator('#price-auto-notice').count(),1);
  await page.clock.runFor(1);assert.equal(await page.locator('#price-auto-notice').count(),0);
  for(const key of ['Enter',' ']){
   await page.evaluate(()=>localStorage.removeItem('dvi-price-auto-import-at-v1'));await page.reload();await page.locator('#price-auto-notice').waitFor();
   await page.locator('#price-auto-notice').focus();await page.keyboard.press(key===' '?'Space':key);assert.equal(await page.locator('#price-auto-notice').count(),0);
   await page.clock.runFor(30000);assert.equal(await page.locator('#price-auto-notice').count(),0);
  }
  result.cases.push(`${fail?'Failure':'Success'} notification: no close button, visible before 30 seconds, dismissed at 30 seconds, Enter/Space dismiss and timer cleanup`);await context.close();
 }
 {
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  const at=new Date();await page.clock.install({time:at});await page.clock.pauseAt(at);let requests=0;
  await context.route('https://deepveinidle.com/api/market/prices.json',route=>{requests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({game:'Deep Vein Idle',generatedAt:at.toISOString(),refreshSeconds:300,items:{1:{lowestSell:84,highestBuy:50}}})});});
  await page.goto(base+'/forecast');await page.locator('#price-auto-notice').waitFor();assert.equal(requests,1);
  await page.clock.fastForward(299999);assert.equal(requests,1);
  await page.reload();await page.locator('#forecast-content').waitFor();assert.equal(requests,1);assert.equal(await page.locator('#price-auto-notice').count(),0);
  await page.clock.fastForward(1);assert.equal(requests,1);
  await page.reload();await page.locator('#price-auto-notice').waitFor();assert.equal(requests,2);
  await page.clock.fastForward(300000);assert.equal(requests,2);
  result.cases.push('automatic import: no request at 299999ms reload, request on opening at 300000ms, no background polling after five minutes');await context.close();
 }
assert.deepEqual(result.errors,[]);result.status='passed';console.log(JSON.stringify({status:result.status,cases:result.cases.length,live:result.live,directory}));
}catch(error){result.status='failed';result.failure=error.stack;throw error;}
finally{if(browser)await browser.close();server?.kill();await json(path.join(directory,'browser.json'),result);}
