import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath} from '../scripts/release-common.mjs';
import {priceDefaults} from '../src/item-prices.js';
const directory=path.resolve(process.argv[2]??'.test-artifacts/price-refactor/protocol');await fs.mkdir(directory,{recursive:true});
const results={cases:[],errors:[]};let server,browser;
try{
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});await once(server.stdout,'data');
 const base=`http://127.0.0.1:${port}`;browser=await chromium.launch({headless:true,executablePath:await browserPath()});
 for(const language of ['zh','en'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage();page.on('pageerror',e=>results.errors.push(e.message));
  const prices=priceDefaults();prices.preferences.autoImport=false;
  await context.addInitScript(({language,prices})=>{if(!localStorage.getItem('dvi-simulator-v1'))localStorage.setItem('dvi-simulator-v1',JSON.stringify({language}));if(!localStorage.getItem('dvi-item-prices-v1'))localStorage.setItem('dvi-item-prices-v1',JSON.stringify(prices));},{language,prices});
  let requests=0;
  await context.route('https://deepveinidle.com/api/market/prices.json',route=>{requests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({game:'Deep Vein Idle',generatedAt:new Date().toISOString(),refreshSeconds:300,items:{1:{avg7d:6.5,avg30d:5.5,lowestSell:9,sellQty:12000,highestBuy:4,buyQty:25000},2:{lowestSell:7,sellQty:0,highestBuy:2,buyQty:0}}})});});
  await page.goto(base+'/enhance');
  await page.evaluate(async()=>{const p=await import('/src/price-service.js');p.setPrice(1,0);p.setPrice(2,3);await p.importPrices();});
  await page.locator('#enhance-section [data-open-global-prices]').click();assert.equal(requests,1);await page.locator('#price-search').fill('Copper');await page.locator('#price-search').blur();
  const row=page.locator('[data-price-value="1"]').locator('..').locator('..');assert.equal(await row.locator('td').count(),11);
  const averages=await page.evaluate(async()=>(await import('/src/price-service.js')).getItem(1));assert.equal(averages.avg7d,6.5);assert.equal(averages.avg30d,5.5);assert.match(await row.innerText(),/6.5/);assert.match(await row.innerText(),/5.5/);
  assert.match(await row.innerText(),/12,000/);assert.match(await row.innerText(),/25,000/);assert.equal(await page.locator('[data-price-value="1"]').inputValue(),'0');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const layout=await page.locator('#item-prices-dialog').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(layout.scroll<=layout.client+1);
  assert.equal(await page.locator('#price-import-settings, #price-import-reset, [data-price-category]').count(),0);await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,`eight-fields-${language}-${width}.png`)});
  if(width===390){await page.locator('.price-list').evaluate(el=>el.scrollLeft=el.scrollWidth);await page.screenshot({path:path.join(directory,`market-totals-${language}-${width}.png`)});}await page.locator('#price-close').click();
  await page.locator('#enhance-nav').click();await page.evaluate(async()=>{const p=await import('/src/price-service.js');p.setPrice(208,8);p.setPrice(359,9);});
  const shard=page.locator('[data-enhance-field="shardPrice"]');assert.equal(await shard.inputValue(),'8');await shard.fill('0');await shard.blur();
  await page.evaluate(async()=>{const p=await import('/src/price-service.js');p.setPrice(208,12);});assert.equal(await shard.inputValue(),'0');
  const materials=page.locator('[data-page-prices="enhance"] [data-page-price="materials"]');
  await shard.fill('17');
  await materials.selectOption('none');assert.equal(await shard.isDisabled(),true);assert.equal(await shard.inputValue(),'0');
  await materials.selectOption('avg7d');assert.equal(await shard.isEnabled(),true);assert.equal(await shard.inputValue(),'17');
  await shard.fill('');await shard.blur();assert.equal(await shard.inputValue(),'');await page.reload();assert.equal(await shard.inputValue(),'');
  await page.screenshot({path:path.join(directory,`enhancement-${language}-${width}.png`)});
  const groups={combat:{drops:'avg7d',consumables:'avg7d',monsterRare:'vendorPrice',missing:'warn'},gather:{products:'avg7d',consumables:'avg7d',missing:'warn'},craft:{products:'avg7d',materials:'avg7d',missing:'warn'},enhance:{materials:'avg7d'},'boss-feed':{materials:'avg7d'}};
  for(const [route,expected] of Object.entries(groups)){
   await page.locator(`#${route}-nav`).click();
   const config=page.locator(`[data-page-prices="${route}"]`),open=config.locator('[data-open-global-prices]');
   await config.waitFor();
   assert.deepEqual(await config.locator('select').evaluateAll(els=>Object.fromEntries(els.map(el=>[el.dataset.pagePrice,el.value]))),expected);
   const priceRows=await config.locator('select').evaluateAll(selects=>selects.map(select=>{
    const row=select.closest('label');
    const label=row.querySelector('span').getBoundingClientRect();
    const control=select.getBoundingClientRect();
    const bounds=row.getBoundingClientRect();
    return {sideBySide:label.right<control.left&&label.top<control.bottom&&control.top<label.bottom,
     rightAligned:control.right===bounds.right,width:control.width};
   }));
   for(const row of priceRows){
    assert.deepEqual(row,{sideBySide:true,rightAligned:true,width:priceRows[0].width},`${route} ${language}: item price row alignment`);
   }
   if(route==='combat'&&width===390)await config.screenshot({path:path.join(directory,`price-options-${language}-${width}.png`)});
   assert.equal(await config.evaluate(el=>el.closest('.simulation-config').previousElementSibling.classList.contains('config')),true);
   assert.equal(await page.locator('header [data-open-global-prices], #item-prices-open').count(),0);
   const layout=await page.evaluate(()=>{
    const width=document.documentElement.scrollWidth;
    if(width<=innerWidth)return {width,viewport:innerWidth};
    const overflow=[...document.querySelectorAll('header, [data-scroll-column], :is(main,section,aside):not([hidden]), .config-column')]
     .filter(el=>el.getBoundingClientRect().right>innerWidth)
     .map(el=>[el.id||el.className,el.getBoundingClientRect().right]).slice(0,10);
    return {width,viewport:innerWidth,overflow};
   });
   assert.ok(layout.width<=layout.viewport,`${route} ${language} ${JSON.stringify(layout)}`);
   const checkPanelWidths=async()=>{
    if(width>740)return;
    const bounds=await config.evaluate(el=>{
     const column=el.closest('.config-column');
     return [...column.children,column.nextElementSibling].map(panel=>{
      const {left,right}=panel.getBoundingClientRect();
      return [left,right];
     });
    });
    assert.deepEqual(bounds.slice(0,2),[bounds[2],bounds[2]],`${route} ${language}: mobile panel edges`);
   };
   await checkPanelWidths();
   await open.click();
   await page.locator('#item-prices-dialog[open]').waitFor();
   await page.keyboard.press('Escape');await page.locator('#item-prices-dialog[open]').waitFor({state:'hidden'});
   await page.waitForFunction(route=>document.activeElement.closest('[data-page-prices]')?.dataset.pagePrices===route,route);
   await config.locator('select').first().selectOption('none');
   if(expected.missing)await config.locator('[data-page-price="missing"]').selectOption('vendorPrice');
   await page.reload();
   assert.equal(await config.locator('select').first().inputValue(),'none');
   if(expected.missing)assert.equal(await config.locator('[data-page-price="missing"]').inputValue(),'vendorPrice');
   assert.equal(requests,1);
   const globals=await page.evaluate(()=>localStorage.getItem('dvi-item-prices-v1'));
   if(route==='combat'){
    const hours=page.locator('[data-path="manual.simulationHours"]'),hot=page.locator('[data-path="manual.hotSetting"]'),enemy=page.locator('[data-path="manual.enemySelection"]');
    await hours.fill('3');await hours.blur();await hot.selectOption('off');
    const monster=await enemy.locator('option').nth(1).getAttribute('value');await enemy.selectOption(monster);
    page.once('dialog',dialog=>dialog.accept());await page.locator('#reset').click();
    assert.equal(await hours.inputValue(),'3');assert.equal(await hot.inputValue(),'off');assert.equal(await enemy.inputValue(),monster);
    assert.equal(await config.locator('select').first().inputValue(),'none');
   }
   const readOther=()=>page.evaluate(route=>{
    if(route==='enhance')return localStorage.getItem('dvi-enhancement-v1');
    if(route==='combat'){
     const {state}=JSON.parse(localStorage.getItem('dvi-simulator-v1'));
     const {enemySelection,simulationHours,hotSetting,...manual}=state.manual;
     return {...state,manual};
    }
   },route);
   const other=await readOther();
   await page.locator(`#${route}-simulation-defaults`).click();
   assert.deepEqual(await config.locator('select').evaluateAll(els=>Object.fromEntries(els.map(el=>[el.dataset.pagePrice,el.value]))),expected);
   assert.deepEqual(await readOther(),other);
   assert.equal(await page.evaluate(()=>localStorage.getItem('dvi-item-prices-v1')),globals);
   if(route==='combat'){
    assert.equal(await page.locator('[data-path="manual.simulationHours"]').inputValue(),'24');
    assert.equal(await page.locator('[data-path="manual.hotSetting"]').inputValue(),'current');
    assert.equal(await page.locator('[data-path="manual.enemySelection"]').inputValue(),'all');
   }

   const character=page.locator(`#${route}-character-panel`),simulation=page.locator(`#${route}-simulation-panel`);
   if(route!=='boss-feed'){
    await character.locator('summary').first().click();assert.equal(await character.getAttribute('open'),null);
   }
   assert.notEqual(await simulation.getAttribute('open'),null);
   await simulation.locator('summary').first().click();assert.equal(await open.isVisible(),false);
   await checkPanelWidths();
   await page.reload();
   await open.waitFor();
   if(route!=='boss-feed')assert.notEqual(await character.getAttribute('open'),null);
  }
  await page.locator('#mastery-nav').click();
  const mastery=page.locator('#mastery-character-panel');
  await mastery.locator('summary').first().press('Space');assert.equal(await mastery.getAttribute('open'),null);
  await page.locator('#forecast-nav').click();await page.locator('#mastery-nav').click();assert.equal(await mastery.getAttribute('open'),null);
  await mastery.locator('summary').first().press('Enter');assert.notEqual(await mastery.getAttribute('open'),null);
  results.cases.push(`${language}/${width}: quotes and totals, enhancement override/blank, five split panels, price row alignment, per-page defaults/persistence, shared dialog, focus return, panel folding and reset isolation`);await context.close();
 }
 assert.deepEqual(results.errors,[]);
}catch(error){results.failure=String(error.stack??error);throw error;}
finally{await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(results,null,2)+'\n');await browser?.close();server?.kill();}
console.log(JSON.stringify({status:'passed',cases:results.cases.length,directory}));
