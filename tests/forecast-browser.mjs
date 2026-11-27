import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {browserPath} from '../scripts/release-common.mjs';
import {forecastStorageKey,hotSkills} from '../src/forecast-filters.js';

const base=process.argv[2]??'http://127.0.0.1:4186';
const directory=path.resolve(process.argv[3]??'.test-artifacts/forecast-multiselect');
await fs.mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:await browserPath()});
const results={base,cases:[],errors:[]};
const button=(page,group,value)=>page.locator(`[data-forecast-filter="${group}"][data-value="${value}"]`);
const selected=page=>page.locator('[data-forecast-filter][aria-pressed="true"]').evaluateAll(els=>({
 skills:els.filter(el=>el.dataset.forecastFilter==='skill').map(el=>el.dataset.value),
 kinds:els.filter(el=>el.dataset.forecastFilter==='kind').map(el=>el.dataset.value)
}));
const rows=page=>page.locator('.forecast-schedule tbody tr');
const checkPanel=async page=>{
 assert.equal(await page.locator('#forecast-content .panel').count(),1);
 assert.ok(await page.locator('#forecast-content').evaluate(el=>el.firstElementChild.matches('.forecast-heading')&&!el.querySelector('.forecast-panel .forecast-heading')&&[...el.querySelectorAll('.hot-current,.forecast-filters,.table-scroll,.forecast-empty')].every(item=>item.closest('.forecast-panel')===el.querySelector('.forecast-panel'))));
};
try{
 for(const width of [1280,390])for(const language of ['zh','en']){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(language=>{
   if(!localStorage.getItem('dvi-simulator-v1'))localStorage.setItem('dvi-simulator-v1',JSON.stringify({language}));
  },language);
  const page=await context.newPage();page.on('pageerror',error=>results.errors.push(error.message));
  await page.goto(base+'/forecast');
  await checkPanel(page);
  if(width===1280&&language==='zh'){
   const before=await page.locator('#forecast-countdown').textContent();
   await page.waitForFunction(before=>document.querySelector('#forecast-countdown').textContent!==before,before);
  }
  assert.deepEqual(await selected(page),{skills:['all'],kinds:['all']});
  assert.equal(await rows(page).count(),48);
  await button(page,'skill','mining').click();await button(page,'skill','fishing').click();
  await button(page,'kind','rarity').focus();await page.keyboard.press('Enter');
  const expected={skills:['mining','fishing'],kinds:['rarity']};
  await checkPanel(page);
  assert.deepEqual(await selected(page),expected);
  assert.equal(await rows(page).count(),10);
  assert.ok(await rows(page).evaluateAll(els=>els.every(el=>['mining','fishing'].includes(el.dataset.skill)&&el.cells[2].textContent.includes('+25%'))));
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),forecastStorageKey);
  assert.deepEqual(stored,{version:1,...expected});
  await page.reload();assert.deepEqual(await selected(page),expected);
  await page.locator('#combat-nav').click();await page.locator('#forecast-nav').click();
  await page.selectOption('#language',language==='zh'?'en':'zh');assert.deepEqual(await selected(page),expected);
  await page.selectOption('#language',language);
  const second=await context.newPage();await second.goto(base+'/forecast');assert.deepEqual(await selected(second),expected);await second.close();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(directory,`${language}-${width}.png`)});
  await button(page,'skill','mining').click();assert.deepEqual((await selected(page)).skills,['fishing']);
  await button(page,'skill','fishing').click();assert.deepEqual((await selected(page)).skills,['all']);
  await button(page,'kind','xp').click();assert.deepEqual((await selected(page)).kinds,['all']);
  for(const skill of hotSkills)await button(page,'skill',skill).click();
  assert.deepEqual((await selected(page)).skills,['all']);assert.equal(await rows(page).count(),48);
  await button(page,'skill','cooking').click();await button(page,'skill','crafting').click();await button(page,'kind','rarity').click();
  assert.equal(await rows(page).count(),0);assert.ok(await page.locator('.forecast-empty').isVisible());
  await checkPanel(page);
  await button(page,'skill','mining').click();assert.equal(await rows(page).count(),10);
  assert.ok(await rows(page).evaluateAll(els=>els.every(el=>el.dataset.skill==='mining')));
  await button(page,'skill','all').click();await button(page,'skill','thieving').click();
  assert.equal(await rows(page).count(),10);
  assert.ok(await rows(page).evaluateAll(els=>els.every(el=>el.dataset.skill==='thieving'&&el.cells[2].textContent.includes('+25%'))));
  await button(page,'skill','all').click();await button(page,'kind','all').click();await page.reload();
  assert.deepEqual(await selected(page),{skills:['all'],kinds:['all']});assert.equal(await rows(page).count(),48);
  results.cases.push({language,width,status:'passed',checks:'multi-select, keyboard, reload/new tab, language/navigation, all normalization, mixed feasibility'});
  await context.close();
 }
 for(const mode of ['corrupt','readFailure','writeFailure']){
  const context=await browser.newContext();
  await context.addInitScript(({key,mode})=>{
   localStorage.setItem('dvi-simulator-v1',JSON.stringify({language:'zh'}));
   if(mode==='corrupt')localStorage.setItem(key,'{bad json');
   const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
   globalThis.forecastStorageBlocked=true;
   Storage.prototype.getItem=function(name){if(name===key&&mode==='readFailure'&&globalThis.forecastStorageBlocked)throw Error('Read blocked');return get.call(this,name);};
   Storage.prototype.setItem=function(name,value){if(name===key&&mode==='writeFailure'&&globalThis.forecastStorageBlocked)throw Error('Write blocked');return set.call(this,name,value);};
  },{key:forecastStorageKey,mode});
  const page=await context.newPage();page.on('pageerror',error=>results.errors.push(error.message));await page.goto(base+'/forecast');
  await checkPanel(page);
  if(mode!=='writeFailure'){
   assert.deepEqual(await selected(page),{skills:['all'],kinds:['all']});
   assert.ok((await page.locator('.forecast-storage').textContent()).includes('无法读取'));
  }
  await button(page,'skill','mining').click();assert.deepEqual((await selected(page)).skills,['mining']);assert.equal(await rows(page).count(),10);
  if(mode==='writeFailure'){
   assert.ok((await page.locator('.forecast-storage').textContent()).includes('保存失败'));
   await page.selectOption('#language','en');assert.ok((await page.locator('.forecast-storage').textContent()).includes('Could not save'));
   await page.evaluate(()=>globalThis.forecastStorageBlocked=false);await button(page,'skill','fishing').click();
  }
  assert.equal(await page.locator('.forecast-storage').count(),0);
  await page.evaluate(()=>globalThis.forecastStorageBlocked=false);
  assert.equal((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),forecastStorageKey)).version,1);
  results.cases.push({mode,status:'passed'});await context.close();
 }
 const context=await browser.newContext();
 const page=await context.newPage();
 await page.clock.install({time:new Date('2025-01-01T00:00:00Z')});
 await page.goto(base+'/forecast');await checkPanel(page);
 assert.ok(await page.locator('.forecast-panel [role="alert"]').isVisible());
 assert.equal(await page.locator('.forecast-panel .forecast-filters').count(),1);
 results.cases.push({mode:'predictionErrorPanel',status:'passed'});await context.close();
 assert.deepEqual(results.errors,[]);results.status='passed';
}catch(error){results.status='failed';results.failure=error.stack;throw error;}
finally{await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2)+'\n');await browser.close();console.log(JSON.stringify(results));}
