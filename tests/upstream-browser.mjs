import {gatheringDefaults,gatheringStorageKey} from '../src/gathering-model.js';
import {craftingStorageKey} from '../src/crafting-model.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath} from '../scripts/release-common.mjs';
import {preset} from '../src/model.js';
import {enhancementDefaults,enhancementStorageKey} from '../src/enhancement.js';
import {masteryDefaults,masteryStorageKey} from '../src/mastery.js';
import {craftingDefaults} from '../src/crafting-model.js';
import {translatedItemName} from '../src/i18n.js';
import {priceDefaults,setItemPrice,lockItemPrices} from '../src/item-prices.js';

const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const output=path.resolve(option('--out')??'.test-artifacts/upstream-1212/browser');
await fs.mkdir(output,{recursive:true});
const servers=[],result={cases:[],errors:[]};let browser;
async function serve(script){
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const child=spawn(process.execPath,[script],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});servers.push(child);
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(([code])=>{throw Error(`Server exited ${code}`);})]);
 return `http://127.0.0.1:${port}`;
}
try{
 const base=option('--url')??await serve('scripts/serve.mjs');result.target=base;
 browser=await chromium.launch({headless:true,executablePath:await browserPath()});
 for(const language of ['zh','en'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>result.errors.push(error.message));
  const state=preset('ranged');state.manual.simulationHours=1;state.manual.enemySelection='monster-11';state.manual.hotSetting='off';
  state.gear.amulet={id:357,tier:4,plus:17};
  const craft=craftingDefaults();craft.skill='smithing';craft.simulationHours=1;craft.levels.smithing=99;craft.levels.crafting=99;
  const prices=lockItemPrices(setItemPrice(priceDefaults(),700,50),[700],true).state;prices.preferences.autoImport=false;
  await context.addInitScript(({state,craft,key,language,prices})=>{
   if(!localStorage.getItem('dvi-simulator-v1'))localStorage.setItem('dvi-simulator-v1',JSON.stringify({language,state}));if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:1,build:craft}));
   if(!localStorage.getItem('dvi-item-prices-v1'))localStorage.setItem('dvi-item-prices-v1',JSON.stringify(prices));
  },{state,craft,key:craftingStorageKey,language,prices});
  await page.goto(base+'/combat');await page.selectOption('#language',language);
  if(args.includes('--combat-1225')){
   await page.locator('#equipment-settings').evaluate(el=>el.open=true);
   const field=path=>page.locator(`[data-path="gear.${path}"]`);
   await field('weapon.id').selectOption('861');
   assert.equal(await field('weapon.plus').getAttribute('max'),'40');
   await field('weapon.plus').fill('40');
   await field('earring.id').selectOption('980');
   assert.equal(await field('earring.plus').getAttribute('max'),'25');
   await field('body.id').selectOption('924');
   assert.equal(await field('body.relics').getAttribute('min'),'1');
   assert.equal(await field('body.relics').getAttribute('max'),'5000');
   for(const value of ['0','']){
    await field('body.relics').fill(value);
    await field('body.relics').press('Tab');
    assert.equal(await field('body.id').inputValue(),'924');
    assert.equal(await field('body.relics').inputValue(),'1');
   }
   await field('body.relics').fill('2200');
   await field('body.relics').press('Tab');
   await field('body.relics').fill('');
   await field('body.relics').press('Tab');
   assert.equal(await field('body.relics').inputValue(),'2200');
   await page.reload();
   assert.equal(await field('weapon.plus').inputValue(),'40');
   assert.equal(await field('earring.id').inputValue(),'980');
   assert.equal(await field('body.relics').inputValue(),'2200');
   await page.locator('#equipment-settings').evaluate(el=>el.open=true);
   await page.locator('[data-path="manual.allGear"]').check();
   await field('body.id').selectOption('129');
   await page.locator('#issues').getByText(language==='zh'?/流派不匹配/:/Wrong combat style/).waitFor();
   assert.equal(await field('body.relics').count(),0);
   assert.equal(await field('body.plus').getAttribute('max'),'20');
   await page.waitForFunction(()=>document.querySelector('#rows tr[data-enemy]')&&!document.querySelector('#rows td.hourly-muted'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(output,`combat-1225-${language}-${width}.png`),fullPage:true});
   result.cases.push(`Combat 1.0.1228 ${language} ${width}`);
   await context.close();
   continue;
  }
  if(args.includes('--caps-only')){
   for(const [route,prefix]of [['combat','data-path'],['gather','data-gather-field'],['craft','data-craft-field']]){
    await page.goto(base+'/'+route);
    const houses=page.locator(`[${prefix}^="house."]`),masteries=page.locator(`[${prefix}^="masteries."]`);
    assert.ok(await houses.count()>0);assert.ok(await masteries.count()>0);
    assert.ok((await houses.evaluateAll(els=>els.map(el=>el.max))).every(max=>max==='50'));
    const accuracy=page.locator(`[${prefix}="masteries.accuracy"]`);
    if(await accuracy.count())assert.equal(await accuracy.getAttribute('max'),'200');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
   await page.goto(base+'/enhance');
   assert.equal(await page.locator('[data-enhance-field="lectern"]').getAttribute('max'),'50');
   await page.locator('#enhance-home-settings').evaluate(el=>el.open=true);
   await page.locator('[data-enhance-field="lectern"]').fill('51');await page.locator('#enhance-results [role="alert"]').waitFor();
   await page.locator('[data-enhance-field="lectern"]').fill('50');await page.locator('.enhance-table tbody tr').first().waitFor();
   await page.goto(base+'/mastery');
   await page.locator('#mastery-total').fill('100000');
   const target=page.locator('[data-mastery-id="xp"][data-mastery-field="target"]');
   assert.equal(await target.getAttribute('max'),'200');await target.fill('201');
   assert.match(await page.locator('#mastery-issue').innerText(),/200/);
   await target.fill('200');assert.equal(await page.locator('#mastery-issue').innerText(),'');
   await page.screenshot({path:path.join(output,`caps-${language}-${width}.png`),fullPage:true});
   for(const [route,key,invalid,note]of [
    ['enhance',enhancementStorageKey,{...enhancementDefaults(),mastery:201},'#enhance-import-status'],
    ['mastery',masteryStorageKey,{...masteryDefaults(),target:{...masteryDefaults().target,xp:201}},'#mastery-save-note']]){
    const saved=JSON.stringify(invalid);await page.evaluate(({key,saved})=>localStorage.setItem(key,saved),{key,saved});
    await page.goto(base+'/'+route);
    assert.match(await page.locator(note).textContent(),language==='zh'?/无法读取/:/could not be read/);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),saved);
   }
   result.cases.push({language,width,status:'passed',caps:true});await context.close();continue;
  }
  await page.waitForFunction(()=>document.querySelector('#simulation-status').hidden&&!document.querySelector('#rows .pending'));
  assert.equal(await page.locator('#rows tr[data-enemy]').count(),1);
  assert.ok(!/Simulation failed|模拟失败/.test(await page.locator('#rows').innerText()));
  const invite='https://deepveinidle.com/?ref=Alice';
  const brand=page.locator('.brand');
  const home=brand.getByRole('link',{name:language==='zh'?'Alice’s 实验室':'Alice’s Lab',exact:true});
  const subtitle=brand.getByRole('link',{name:'Deep Vein Idle',exact:true});
  const footer=page.locator('.project-footer');
  const footerGame=footer.getByRole('link',{name:'Deep Vein Idle ↗',exact:true});
  assert.equal(await home.getAttribute('href'),'/');
  assert.equal(await footer.locator('.footer-contact span').innerText(),language==='zh'?'项目作者：Alice':'Project author: Alice');
  assert.doesNotMatch(await footer.innerText(),/897891232|2026-11-09|1\.0\.1214/);
  assert.equal(await footer.locator('p').count(),2);
  const row=await footer.locator('.footer-contact').boundingBox();
  const author=await footer.locator('.footer-contact span').boundingBox();
  const link=await footerGame.boundingBox();
  assert.ok(Math.abs(author.x-row.x)<1 && Math.abs(link.x+link.width-row.x-row.width)<1);
  assert.ok(Math.abs(author.y-link.y)<3 && author.x+author.width<link.x);
  await context.route(invite,route=>route.fulfill({body:'Game link verified'}));
  await home.focus();
  await page.keyboard.press('Tab');
  assert.ok(await subtitle.evaluate(el=>document.activeElement===el));
  for(const gameLink of [subtitle,footerGame]){
   assert.equal(await gameLink.getAttribute('href'),invite);
   await gameLink.focus();
   const [popup]=await Promise.all([page.waitForEvent('popup'),page.keyboard.press('Enter')]);
   await popup.waitForURL(invite);
   await popup.close();
  }
  assert.ok((await page.locator('[data-path^="house."]').evaluateAll(els=>els.map(el=>el.max))).every(max=>max==='50'));
  assert.equal(await page.locator('[data-path="masteries.accuracy"]').getAttribute('max'),'200');
  const amuletNote=/总等级|total level/i;
  assert.doesNotMatch(await page.locator('#issues').innerText(),amuletNote);
  assert.equal(await page.locator('#issues .issue-box').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.reload();assert.doesNotMatch(await page.locator('#issues').innerText(),amuletNote);
  assert.equal(await page.locator('#issues .issue-box').count(),0);
  await page.waitForFunction(()=>document.querySelector('#simulation-status').hidden&&!document.querySelector('#rows .pending'));
  const combatScreenshot=`combat-${language}-${width}.png`;await page.screenshot({path:path.join(output,combatScreenshot),fullPage:true});
  if(args.includes('--combat-only')){
   await page.goto(base+'/mastery');
   assert.doesNotMatch(await page.locator('#optimizer-scenario').textContent(),/配装提示|loadout warnings/);
   await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('dvi-simulator-v1'));saved.state.levels.ranged=1;localStorage.setItem('dvi-simulator-v1',JSON.stringify(saved));});
   await page.goto(base+'/combat');
   assert.match(await page.locator('#issues').innerText(),language==='zh'?/等级不足，仍计入/:/Level too low; included/);
   assert.doesNotMatch(await page.locator('#issues').innerText(),amuletNote);
   await page.goto(base+'/mastery');
   assert.match(await page.locator('#optimizer-scenario').textContent(),language==='zh'?/配装提示/:/loadout warnings/);
   result.cases.push({language,width,status:'passed',screenshots:[combatScreenshot]});await context.close();continue;
  }
  const gather=gatheringDefaults();gather.levels.mining=99;gather.jobSelection=344;gather.simulationHours=1;gather.hotSetting='off';gather.worldRarity=100;
  await page.evaluate(({key,gather})=>localStorage.setItem(key,JSON.stringify(gather)),{key:gatheringStorageKey,gather});
  await page.goto(base+'/gather');
  assert.ok((await page.locator('[data-gather-field^="house."]').evaluateAll(els=>els.map(el=>el.max))).every(max=>max==='50'));
  assert.match(await page.locator('[data-gather-field="jobSelection"] option[value="344"]').textContent(),language==='zh'?/纯净煤矿/:/Pure coal/);
  await page.waitForFunction(()=>document.getElementById('gather-344-level')&&document.querySelector('#gather-results .gather-progress')?.hidden&&!/计算中|Calculating/.test(document.querySelector('#gather-results tbody').textContent));
  assert.ok(!/模拟失败|Simulation failed|invalidRoute/.test(await page.locator('#gather-results').innerText()));
  await page.reload();assert.equal(await page.locator('[data-gather-field="jobSelection"]').inputValue(),'344');
  await page.waitForFunction(()=>document.getElementById('gather-344-level')&&document.querySelector('#gather-results .gather-progress')?.hidden&&!/计算中|Calculating/.test(document.querySelector('#gather-results tbody').textContent));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const gatherScreenshot=`gather-${language}-${width}.png`;await page.screenshot({path:path.join(output,gatherScreenshot),fullPage:true});
  await page.locator('#craft-nav').click();
  assert.equal(await page.locator('[data-craft-field="house.forge"]').getAttribute('max'),'50');await page.locator('[data-craft-rarity="4"]').click();
  await page.selectOption('#craft-group','Upgrades');await page.locator('#craft-search').fill('Colossus blade');
  const upgradeRow=page.locator('.craft-table tbody tr').filter({has:page.locator('[id="craft-upgrade-271:4-recipe"]')});
  await upgradeRow.locator('td').nth(0).locator('summary').click();assert.match(await upgradeRow.locator('td').nth(0).innerText(),/1,900/);
  const upgradeCost=upgradeRow.locator('td').nth(5);
  await upgradeCost.locator('summary').click();
  for(const id of [4114,4252])assert.equal(await upgradeCost.locator('.gather-item').filter({hasText:translatedItemName(id,language)}).count(),1);
  assert.equal(await upgradeCost.locator('input').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const craftScreenshot=`craft-${language}-${width}.png`;await page.screenshot({path:path.join(output,craftScreenshot),fullPage:true});
  await page.reload();await page.locator('#craft-section').waitFor({state:'visible'});
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).build.skill,craftingStorageKey),'smithing');
  await page.locator('[data-craft-skill="crafting"]').click();await page.locator('[data-craft-rarity="4"]').click();await page.selectOption('#craft-group','Fireworks');
  assert.equal(await page.locator('.craft-table tbody tr').count(),9);assert.equal(await page.locator('[id="craft-421:4-recipe"]').count(),0);
  const powder=page.locator('.craft-table .gather-item').filter({hasText:translatedItemName(700,language)}).first();
  await powder.locator('xpath=ancestor::details').evaluate(e=>e.open=true);
  await page.waitForFunction(()=>document.querySelector('.craft-progress').classList.contains('is-idle'),{},{timeout:120000});
  assert.ok(!/制造计算失败|Crafting computation failed|invalidRoute|noSites/.test(await page.locator('#craft-results').innerText()));
  assert.match(await powder.locator('span').first().innerText(),/ 50$/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const fireworksScreenshot=`fireworks-${language}-${width}.png`;await page.screenshot({path:path.join(output,fireworksScreenshot),fullPage:true});
  await page.reload();await page.selectOption('#craft-group','Fireworks');assert.equal(await page.locator('[id="craft-420:4-recipe"]').count(),0);
  await powder.locator('xpath=ancestor::details').evaluate(e=>e.open=true);
  assert.match(await powder.locator('span').first().innerText(),/ 50$/);
  const enhance={...enhancementDefaults(),mastery:200,target:100};delete enhance.lectern;
  await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:enhancementStorageKey,state:enhance});
  await page.goto(base+'/enhance');
  const target=page.locator('[data-enhance-field="target"]'),mastery=page.locator('[data-enhance-field="mastery"]'),lectern=page.locator('[data-enhance-field="lectern"]');
  assert.equal(await lectern.inputValue(),'0');assert.equal(await lectern.getAttribute('max'),'50');
  assert.equal(await target.inputValue(),'100');assert.equal(await target.getAttribute('max'),'20');
  await page.locator('#enhance-results [role="alert"]').waitFor();
  assert.match(await page.locator('#enhance-results').innerText(),/\+20/);
  await page.reload();assert.equal(await target.inputValue(),'100');
  await page.locator('#enhance-mastery-settings').evaluate(el=>el.open=true);
  assert.equal(await mastery.inputValue(),'50');assert.equal(await mastery.getAttribute('max'),'50');
  await target.fill('20');await page.locator('.enhance-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.enhance-table tbody tr').count(),20);
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).mastery,enhancementStorageKey),200);
  assert.match(await page.locator('.enhance-table tbody tr').nth(19).innerText(),/30%/);
  await page.locator('#enhance-home-settings').evaluate(el=>el.open=true);await lectern.fill('7');
  assert.match(await page.locator('.enhance-table tbody tr').nth(19).innerText(),/32[.,]1%/);
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).lectern,enhancementStorageKey),7);
  await page.reload();assert.equal(await lectern.inputValue(),'7');assert.equal(await target.inputValue(),'20');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const enhanceScreenshot=`enhance-${language}-${width}.png`;await page.screenshot({path:path.join(output,enhanceScreenshot),fullPage:true});
  await page.locator('#enhance-mastery-settings').evaluate(el=>el.open=true);
  await mastery.fill('51');await page.locator('#enhance-results [role="alert"]').waitFor();
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).mastery,enhancementStorageKey),200);
  await mastery.fill('50');
  await page.locator('[data-enhance-field="current"]').fill('100');await page.locator('[data-enhance-field="current"]').dispatchEvent('change');
  await target.fill('100');await page.locator('.enhance-table tbody').waitFor();
  assert.match(await page.locator('.enhance-table tbody').innerText(),language==='zh'?/无需强化/:/no enhancement needed/);
  await page.reload();assert.equal(await page.locator('[data-enhance-field="current"]').inputValue(),'100');assert.equal(await target.inputValue(),'100');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const highScreenshot=`enhance-existing-${language}-${width}.png`;await page.screenshot({path:path.join(output,highScreenshot),fullPage:true});
  await page.locator('#enhance-home-settings').evaluate(el=>el.open=true);await page.locator('#enhance-mastery-settings').evaluate(el=>el.open=true);
  await page.locator('[data-enhance-field="current"]').fill('0');await page.locator('[data-enhance-field="current"]').dispatchEvent('change');await target.fill('1');await lectern.fill('0');await mastery.fill('0');
  assert.equal(await page.locator('.enhance-inputs .stat').last().locator('strong').innerText(),language==='zh'?'2.4 秒':'2.4 s');
  const masteryState=masteryDefaults();masteryState.totalPoints=100000;masteryState.current.enhance=200;masteryState.target.enhance=200;
  await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:masteryStorageKey,state:masteryState});
  await page.goto(base+'/mastery');
  const card=page.locator('[data-mastery-row="enhance"]');
  assert.equal(await card.locator('[data-mastery-current="enhance"]').innerText(),'200');
  assert.equal(await card.locator('[data-mastery-field="target"]').getAttribute('max'),'200');
  assert.equal(await card.locator('[data-mastery-value="target"]').innerText(),'+50%');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const masteryScreenshot=`mastery-${language}-${width}.png`;await page.screenshot({path:path.join(output,masteryScreenshot),fullPage:true});
  result.cases.push({language,width,status:'passed',screenshots:[gatherScreenshot,combatScreenshot,craftScreenshot,fireworksScreenshot,enhanceScreenshot,highScreenshot,masteryScreenshot]});await context.close();
 }
 if(!option('--url')&&!args.includes('--combat-only')&&!args.includes('--caps-only')&&!args.includes('--combat-1225')){
  const captureBase=await serve('scripts/check-capture-browser.mjs'),page=await browser.newPage();await page.goto(captureBase);
  await page.waitForFunction(()=>{const text=document.querySelector('#results').textContent;return text.includes('"PASS"')||text.includes('"error"');},{},{timeout:20000});
  result.capture=JSON.parse(await page.locator('#results').textContent());assert.ok(result.capture.passed.includes('PASS'),JSON.stringify(result.capture));
 }
 assert.deepEqual(result.errors,[]);result.status='passed';console.log(`PASS upstream browser: ${result.cases.length} bilingual/viewport cases${result.capture?', character capture passed':''}`);
}catch(error){result.status='failed';result.error=error.stack;throw error;}
finally{
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
 if(browser)await browser.close();for(const server of servers)server.kill();
}
