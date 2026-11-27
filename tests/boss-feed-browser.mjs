import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath} from '../scripts/release-common.mjs';
import {priceDefaults,priceStorageKey} from '../src/item-prices.js';
import {marketPricesUrl} from '../src/market-import.js';
import {levelXp} from '../src/upstream.js';

const directory=process.argv[2]??'.test-artifacts/boss-feed';
await fs.mkdir(directory,{recursive:true});
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try {
 const base=await Promise.race([
  once(server.stdout,'data').then(([data])=>String(data).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]),
  once(server,'exit').then(([code])=>{throw Error('Local server exited: '+code);}),
 ]);
 assert.ok(base);
 browser=await chromium.launch({executablePath:await browserPath(),headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:950}});
 const prices=priceDefaults();
 prices.preferences.autoImport=false;
 const otherBossLevels=[[1,'fishing','cooking',91,92],[2,'woodcutting','fletching',93,94],
  [3,'farming','herblore',95,96],[4,'thieving','crafting',97,98]];
 const levels=[['mining',105],['smithing',105],...otherBossLevels.flatMap(([,first,second,firstLevel,secondLevel])=>
  [[first,firstLevel],[second,secondLevel]])];
 const imported={
  version:2,capturedAt:Date.now(),worldTick:20,worldBuffsVersion:1,
  worldBuffs:[{fromTick:19,toTick:21,xpMult:1.12}],
  player:{id:1,name:'BrowserTest',lastTick:20,
   skills:Object.fromEntries(levels.map(([skill,level])=>[skill,levelXp(level)])),
   masteryPage:1,masterySkills:{mining:1,smithing:2,fishing:1,cooking:2},
   masteries:{gather:4},masteryAway:{2:{craft:12}},equipment:{},brews:{},
   house:{},houseFurniture:{},perks:{},guildBonus:.05,bossMarks:[]},
 };
 await context.addInitScript(({prices,key,imported})=>{
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(prices));
  window.bossFeedReads=0;
  document.addEventListener('dvi-character-request',event=>{
   const request=JSON.parse(event.detail);
   if(request.action==='read')window.bossFeedReads++;
   const response={id:request.id,source:'dvi-character-script',version:'2.4',ready:true,
    snapshot:request.action==='read'?imported:undefined};
   document.dispatchEvent(new CustomEvent('dvi-character-response',{detail:JSON.stringify(response)}));
  });
 },{prices,key:priceStorageKey,imported});
 let requests=0;
 await context.route(marketPricesUrl,async route=>{
  requests++;
  if(requests===3)return route.fulfill({status:503,body:'Unavailable'});
  await route.fulfill({json:{game:'Deep Vein Idle',generatedAt:new Date().toISOString(),refreshSeconds:60,items:{
   5:{lowestSell:770,avg7d:770,sellQty:1000000},
   1008:{lowestSell:630,highestBuy:420,avg7d:500,sellQty:20},
   2008:{lowestSell:8500,avg7d:requests===2?9600:8500,sellQty:42000},
   2044:{lowestSell:16000,highestBuy:15000,avg7d:15500,sellQty:20},
  }}});
 });
 const page=await context.newPage();
 page.setDefaultTimeout(12000);
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const find=name=>page.locator('#boss-feed-'+name);
 const bossButton=id=>find('picker').locator(`button[value="${id}"]`);
 const selectedBoss=()=>find('picker').locator('button[aria-pressed="true"]').getAttribute('value');
 const rows=page.locator('[data-boss-feed-row]');
 const row=key=>rows.and(page.locator(`[data-boss-feed-row="${key}"]`));
 const coin=key=>row(key).locator('td').nth(3);
 const textIs=(locator,text)=>page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector:locator,text});
 const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dvi-boss-feed-v1')));
 const options=id=>find(id).locator('option').allTextContents();
 const pressed=id=>find(id).locator('button[aria-pressed="true"]').evaluateAll(buttons=>buttons.map(button=>button.value));
 const toggle=(id,value)=>find(id).locator(`button[value="${value}"]`).click();
 async function updateMarket(status='已刷新'){
  await page.click('[data-page-prices="boss-feed"] [data-open-global-prices]');
  await page.click('#price-import');
  await textIs('#price-status',status);
  await page.keyboard.press('Escape');
 }
 await page.goto(base+'/boss-feed/');
 await find('comparison').waitFor();
 assert.equal(await page.locator('#boss-feed-nav').textContent(),'技能首领');
 assert.deepEqual(await page.locator('.section-nav a').evaluateAll(links=>links.map(link=>link.dataset.section)),
  ['combat','gather','craft','enhance','mastery','boss-feed','forecast']);
 assert.equal(await find('section').locator('h1').textContent(),'角色配置');
 assert.equal(await find('title').textContent(),'生效角色配置');
 assert.equal(await find('boss-badge').count(),1);
 assert.equal(await find('boss-badge').textContent(),'熔炉之心');
 assert.equal(await find('picker').locator('button').count(),5);
 assert.equal(await selectedBoss(),'0');
 const icons=await find('picker').locator('button svg').evaluateAll(nodes=>nodes.map(node=>node.innerHTML));
 assert.equal(new Set(icons).size,5);
 assert.equal(await find('section').locator('.result-heading .eyebrow').textContent(),'SKILLING BOSSES FEEDING OVERVIEW');
 assert.equal(await find('comparison-title').textContent(),'投喂物品性价比');
 assert.equal(await find('box-basis').textContent(),'每100箱');
 assert.equal(await find('section').locator('.panel-heading + .intro').textContent(),'配置角色，对比技能首领投喂物品的性价比');
 assert.equal(await find('import-settings').evaluate(node=>node.previousElementSibling?.classList.contains('intro')),true);
 assert.equal(await find('reset').textContent(),'清空配置');
 assert.equal(await find('storage').textContent(),'● 技能首领配置独立保存在此浏览器');
 assert.equal(await find('picker').evaluate(node=>Boolean(node.nextElementSibling?.querySelector('#boss-feed-daily-profit'))),true);
 assert.equal(await page.getByLabel('时间金币参数（M 金币／天）', {exact:true}).count(),1);
 assert.equal(await find('daily-profit-note').textContent(),'用于将时间成本换算成金币成本');
 assert.equal(await find('daily-profit').inputValue(),'0');
 assert.equal(await find('skill').inputValue(),'');
 assert.equal(await find('skill').evaluate(node=>node.nextElementSibling?.id),'boss-feed-category');
 assert.deepEqual(await options('skill'),['全部技能','采矿','锻造']);
 assert.deepEqual(await options('category'),['全部分类','矿石','金属锭','煤','首领精华']);
 assert.deepEqual(await pressed('quality'),['0','1']);
 assert.deepEqual(await find('strategy').locator('option').allTextContents(),['直购+自制','仅直购','仅自制']);
 assert.equal(await find('strategy').inputValue(),'both');
 assert.equal(await page.getByLabel('市场卖单量 >',{exact:true}).count(),1);
 for(const id of ['eligible','fire','charge-craft-time'])assert.equal(await find(id).isChecked(),true);
 assert.equal(await rows.count(),0);
 assert.equal(requests,0);
 await find('import').click();
 await textIs('#boss-feed-import-status','已导入');
 for(const [id,,,firstLevel,secondLevel] of otherBossLevels){
  await bossButton(id).click();
  assert.match(await find('import-status').textContent(),/已导入 · 读取时间/);
  assert.deepEqual(await find('character-skills').locator('input').evaluateAll(inputs=>inputs.map(input=>input.valueAsNumber)),
   [firstLevel,secondLevel]);
 }
 assert.equal(await page.evaluate(()=>window.bossFeedReads),1);
 await bossButton(0).click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

 const pageLabel=find('page-label');
 const first=find('first-page');
 const previous=find('previous-page');
 const next=find('next-page');
 const last=find('last-page');
 const rowKeys=()=>rows.evaluateAll(elements=>elements.map(element=>element.dataset.bossFeedRow));
 await pageLabel.waitFor({state:'visible'});
 assert.match(await pageLabel.textContent(),/^第 1 \/ \d+ 页$/);
 const pageCount=Number((await pageLabel.textContent()).match(/\/ (\d+)/)[1]);
 const firstPage=await rowKeys();
 assert.equal(firstPage.length,10);
 assert.equal(await first.count(),1);
 assert.equal(await first.isDisabled(),true);
 assert.equal(await previous.isDisabled(),true);
 await next.click();
 assert.equal(await pageLabel.textContent(),`第 2 / ${pageCount} 页`);
 const secondPage=await rowKeys();
 assert.equal(secondPage.length,10);
 assert.equal(new Set([...firstPage,...secondPage]).size,20);
 await previous.click();
 assert.deepEqual(await rowKeys(),firstPage);
 await last.click();
 assert.equal(await pageLabel.textContent(),`第 ${pageCount} / ${pageCount} 页`);
 assert.equal(await next.isDisabled(),true);
 assert.equal(await last.isDisabled(),true);
 assert.ok(await rows.count()>0 && await rows.count()<=10);
 await first.click();
 assert.deepEqual(await rowKeys(),firstPage);
 await last.click();
 await page.locator('[data-boss-feed-sort="quantity"]').click();
 assert.equal(await pageLabel.textContent(),`第 1 / ${pageCount} 页`);
 const quantities=(await rows.locator('td:nth-child(4)').allTextContents()).map(text=>Number(text.replaceAll(',','')));
 const lastQuantityOnFirstPage=quantities.at(-1);
 await next.click();
 const firstQuantityOnSecondPage=Number((await rows.first().locator('td:nth-child(4)').textContent()).replaceAll(',',''));
 assert.ok(lastQuantityOnFirstPage<=firstQuantityOnSecondPage);
 await find('category').selectOption('ore');
 assert.match(await pageLabel.textContent(),/^第 1 \/ \d+ 页$/);
 await find('skill').selectOption('mining');
 assert.equal(await find('category').inputValue(),'ore');
 assert.deepEqual(await options('category'),['全部分类','矿石','煤']);
 await find('skill').selectOption('smithing');
 assert.equal(await find('category').inputValue(),'');
 assert.deepEqual(await options('category'),['全部分类','金属锭']);
 assert.deepEqual([...new Set(await rows.locator('td:nth-child(2)').allTextContents())],['锻造']);
 await find('skill').selectOption('');
 await find('category').selectOption('essence');
 await row('778:buy').waitFor();
 assert.equal(await row('778:buy').locator('td').first().textContent(),'任一栏');
 await find('category').selectOption('');
 const potionPanel=find('character-potions');
 await potionPanel.locator('summary').click();
 const tonic=potionPanel.locator('input[type="checkbox"]');
 await tonic.check();
 assert.equal((await state()).character.brews.bosskeeper,0);
 await tonic.uncheck();
 await potionPanel.locator('summary').click();
 await find('search').fill('meteoric');
 assert.deepEqual(new Set(await rows.locator('td:nth-child(2)').allTextContents()),new Set(['采矿','锻造']));
 await page.locator('[data-boss-feed-sort="totalGold"]').click();

 await updateMarket();
 await find('search').fill('meteoric');
 await row('1008:buy').waitFor();
 const preserved=await page.evaluate(async()=>{
  const original=document.querySelector('[data-boss-feed-row="1008:buy"]');
  const {setPrice}=await import('/src/price-service.js');
  setPrice(741,123);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return original.isConnected;
 });
 assert.equal(preserved,true);
 const importedCost=await coin('1008:buy').textContent();
 assert.notEqual(importedCost,'—');
 await page.click('[data-page-prices="boss-feed"] [data-open-global-prices]');
 await page.locator('#price-search').fill('1008');
 await page.locator('#price-search').blur();
 const price=page.locator('[data-price-value="1008"]');
 assert.equal(await price.inputValue(),'');
 await price.fill('900');
 assert.equal(await page.locator('[data-price-lock="1008"]').isChecked(),true);
 await page.keyboard.press('Escape');
 await page.waitForFunction(previous=>document.querySelector('[data-boss-feed-row="1008:buy"] .column-highlight')?.textContent!==previous,importedCost);
 const manuallyPriced=await coin('1008:buy').textContent();
 assert.notEqual(manuallyPriced,'—');
 assert.equal(requests,1);

 const simulationPanel=page.locator('#boss-feed-simulation-panel');
 const materialSource=simulationPanel.getByLabel('材料',{exact:true});
 assert.equal(await materialSource.inputValue(),'avg7d');
 assert.deepEqual(await materialSource.locator('option').evaluateAll(rows=>rows.map(row=>row.value)),
  ['avg7d','sellPrice','buyPrice','vendorPrice','none']);
 await simulationPanel.locator('summary').press('Space');
 assert.equal(await materialSource.isVisible(),false);
 await simulationPanel.locator('summary').press('Enter');
 await materialSource.selectOption('none');
 await page.waitForFunction(()=>document.querySelector('[data-boss-feed-row="1008:buy"] .column-highlight')?.textContent==='0');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('dvi-page-prices-boss-feed')).materials),'none');
 await find('daily-profit').fill('12.5');
 await find('fire').uncheck();
 await find('charge-craft-time').uncheck();
 const beforeReset=await state();
 const pricesBeforeReset=await page.evaluate(key=>localStorage.getItem(key),priceStorageKey);
 await find('simulation-defaults').click();
 assert.equal(await materialSource.inputValue(),'avg7d');
 assert.deepEqual(await state(),beforeReset);
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),priceStorageKey),pricesBeforeReset);
 await find('daily-profit').fill('0');
 await find('fire').check();
 await find('charge-craft-time').check();
 await page.waitForFunction(value=>document.querySelector('[data-boss-feed-row="1008:buy"] .column-highlight')?.textContent===value,manuallyPriced);

 await toggle('quality','2');
 await row('2044:buy').waitFor();
 await find('strategy').selectOption('craft');
 await row('2044:buy').waitFor({state:'hidden'});
 await row('2044:craft').waitFor();
 await find('strategy').selectOption('buy');
 await row('2044:craft').waitFor({state:'hidden'});
 await row('2044:buy').waitFor();
 await find('strategy').selectOption('both');
 await find('supply').fill('20');
 await row('2044:buy').waitFor({state:'hidden'});
 await row('2044:craft').waitFor();
 await row('2044:craft').locator('button').click();
 const details=page.locator('[id="boss-feed-detail-2044:craft"]');
 assert.match(await details.innerText(),/42,000/);
 assert.match(await details.innerText(),/收入损失/);
 await bossButton(1).focus();
 await page.keyboard.press('Enter');
 assert.equal(await selectedBoss(),'1');
 assert.equal(await find('boss-badge').textContent(),'海妖');
 assert.equal(await find('character-masteries').locator('fieldset').nth(1).locator('input').last().inputValue(),'6');
 const cookingSpeed=find('attributes').getByRole('group',{name:'烹饪',exact:true}).locator('.stat').filter({hasText:'制造速度加成'});
 assert.equal(await cookingSpeed.locator('strong').textContent(),'6%');
 assert.equal(await page.evaluate(()=>window.bossFeedReads),1);
 assert.equal(await find('search').inputValue(),'');
 assert.deepEqual(await pressed('quality'),['0','1']);
 await bossButton(0).click();
 assert.equal(await find('search').inputValue(),'meteoric');
 assert.equal(await find('supply').inputValue(),'20');
 assert.deepEqual(await pressed('quality'),['0','1','2']);

 const craftCost=await coin('2044:craft').textContent();
 await updateMarket();
 assert.equal(requests,2);
 await page.waitForFunction(previous=>document.querySelector('[data-boss-feed-row="2044:craft"] .column-highlight')?.textContent!==previous,craftCost);
 const refreshedCost=await coin('2044:craft').textContent();
 await updateMarket('返回错误');
 assert.equal(requests,3);
 assert.equal(await coin('2044:craft').textContent(),refreshedCost);
 await find('supply').fill('');
 assert.equal(await coin('1008:buy').textContent(),manuallyPriced);
 await find('supply').fill('20');
 await find('daily-profit').fill('12.5');
 await find('strategy').selectOption('craft');
 await find('skill').selectOption('smithing');
 await find('category').selectOption('bars');
 await bossButton(1).click();
 assert.equal(await find('daily-profit').inputValue(),'12.5');
 assert.equal(await find('strategy').inputValue(),'both');
 assert.deepEqual(await options('skill'),['全部技能','钓鱼','烹饪']);
 assert.equal(await find('skill').inputValue(),'');
 await bossButton(0).click();
 assert.equal(await find('daily-profit').inputValue(),'12.5');
 assert.equal(await find('strategy').inputValue(),'craft');
 assert.equal(await find('skill').inputValue(),'smithing');
 assert.equal(await find('category').inputValue(),'bars');

 await page.reload();
 await find('comparison').waitFor();
 assert.equal(await find('daily-profit').inputValue(),'12.5');
 assert.equal(await find('strategy').inputValue(),'craft');
 assert.equal(await find('supply').inputValue(),'20');
 assert.equal(await find('skill').inputValue(),'smithing');
 assert.equal(await find('category').inputValue(),'bars');
 assert.equal((await state()).bossSettings[0].filters.minimumSupply,20);
 await find('import').click();
 await textIs('#boss-feed-import-status','已导入');
 assert.deepEqual((await state()).character.masteries.smithing,{xp:0,move:0,craft:12});
 assert.equal((await state()).character.worldXp,.12);
 assert.equal((await state()).character.id,undefined);
 const auto=page.locator('[data-character-page="boss-feed"]');
 await auto.check();
 const miningLevel=find('character-skills').locator('input').first();
 await miningLevel.fill('104');
 await miningLevel.blur();
 const masteries=find('character-masteries');
 await masteries.locator('summary').click();
 const miningXp=masteries.locator('fieldset').first().locator('input').first();
 assert.equal(await miningXp.getAttribute('step'),'0.5');
 await miningXp.fill('7.5');
 await miningXp.blur();
 assert.equal((await state()).character.masteries.mining.xp,15);
 await bossButton(1).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dvi-boss-feed-v1')).character.measuredSkills.includes('fishing'));
 assert.equal((await state()).character.levels.mining,104);
 assert.equal((await state()).character.masteries.cooking.craft,12);
 assert.equal((await state()).character.masteries.mining.xp,15);

 await page.click('#craft-nav');
 await page.goBack();
 await find('comparison').waitFor({state:'visible'});
 assert.equal(await selectedBoss(),'1');
 await find('reset').click();
 assert.equal((await state()).character.levels.fishing,1);
 assert.equal((await state()).character.levels.mining,1);
 assert.equal((await state()).character.capturedAt,null);
 assert.deepEqual((await state()).character.measuredSkills,[]);
 assert.equal((await state()).bossSettings[0].filters.minimumSupply,20);
 assert.equal(await selectedBoss(),'1');
 assert.equal(await auto.isChecked(),true);
 assert.equal(await find('import-status').textContent(),'');
 await auto.uncheck();
 await page.reload();
 await find('comparison').waitFor();
 assert.equal(await find('character').locator('input').first().inputValue(),'1');
 const fieldsHaveNotes=await find('character').locator('.gear-row input,.gear-row select,.boss-config-field input,.boss-config-field select')
  .evaluateAll(fields=>fields.every(field=>document.getElementById(field.getAttribute('aria-describedby'))?.textContent.trim()));
 assert.equal(fieldsHaveNotes,true);
 const perks=find('character-perks');
 await perks.locator('summary').click();
 assert.deepEqual(await perks.locator('.micro').allTextContents(),['+1 背包格','采集与制作速度提升 0.5%']);
 const perkRows=await perks.locator('.number-field').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().top));
 assert.ok(perkRows[1]>perkRows[0]);
 await perks.locator('summary').click();
 const worldXpNote=find('character-other').locator('.boss-config-field').filter({hasText:'世界增益经验'}).locator('.micro');
 assert.equal(await worldXpNote.textContent(),'导入捕获时生效的世界增益，整个模拟周期保持生效。');
 assert.equal(await selectedBoss(),'1');
 await find('eligible').uncheck();
 for(const width of [1440,390])for(const language of ['zh','en']){
  await page.setViewportSize({width,height:950});
  await page.selectOption('#language',language);
  await find('section').locator('h1').filter({hasText:language==='zh'?'角色配置':'Character build'}).waitFor();
  assert.equal(await find('title').textContent(),language==='zh'?'生效角色配置':'Effective character build');
  assert.equal(await find('boss-badge').textContent(),language==='zh'?'海妖':'Kraken');
  assert.equal(await find('comparison-title').textContent(),language==='zh'?'投喂物品性价比':'Feeding item value');
  assert.equal(await find('box-basis').textContent(),language==='zh'?'每100箱':'Per 100 chests');
  const methodNote=find('method-note');
  assert.equal(await methodNote.evaluate(node=>node.previousElementSibling?.id),'boss-feed-pagination');
  assert.match(await methodNote.textContent(),language==='zh'?/自制只计算一层配方，金币成本包含采购额/:/Self-crafting covers one recipe layer\. Coin cost includes purchases/);
  assert.match(await pageLabel.textContent(),language==='zh'?/^第 1 \/ \d+ 页$/:/^Page 1 of \d+$/);
  assert.equal(await next.textContent(),language==='zh'?'下一页':'Next');
  assert.equal(await first.textContent(),language==='zh'?'首页':'First');
  assert.equal(await last.textContent(),language==='zh'?'末页':'Last');
  assert.equal(await next.isVisible(),true);
  assert.deepEqual(await options('skill'),language==='zh'?['全部技能','钓鱼','烹饪']:['All skills','Fishing','Cooking']);
  assert.equal(await find('import-settings').evaluate(node=>node.previousElementSibling?.classList.contains('intro')),true);
  const attributes=await find('attributes').evaluate(node=>({
   groups:[...node.querySelectorAll('.stats')].map(group=>group.querySelectorAll('.stat').length),
   rowTops:[...new Set([...node.querySelectorAll('.stat')].map(card=>card.getBoundingClientRect().top))],
   widths:[...node.querySelectorAll('.stat')].map(card=>card.getBoundingClientRect().width),
   scrollWidth:node.scrollWidth-node.clientWidth,
   levels:[...node.querySelectorAll('.stat.primary strong')].map(value=>value.textContent.trim()),
   headingSize:getComputedStyle(document.getElementById('boss-feed-title')).fontSize,
   gatheringHeadingSize:getComputedStyle(document.querySelector('#gather-results .result-heading h2')).fontSize,
   values:[...node.querySelectorAll('.stat strong')].map(value=>parseFloat(getComputedStyle(value).fontSize)),
  }));
  assert.deepEqual(attributes.groups,[5,5]);
  for(const [skillName,label] of language==='zh'
   ? [['钓鱼','采集速度加成'],['烹饪','制造速度加成']]
   : [['Fishing','Gather speed bonus'],['Cooking','Craft speed bonus']]){
   const speed=find('attributes').getByRole('group',{name:skillName,exact:true}).locator('.stat').filter({hasText:label});
   assert.equal(await speed.locator('strong').textContent(),'0%');
  }
  assert.equal(attributes.rowTops.length,2);
  assert.equal(attributes.scrollWidth>0,width<=740);
  const pagination=await pageLabel.evaluate(label=>{
   const nav=label.parentElement;
   const navBounds=nav.getBoundingClientRect();
   const bounds=[...nav.children].map(control=>control.getBoundingClientRect());
   const range=document.createRange();
   range.selectNodeContents(label);
   return {lines:range.getClientRects().length,buttonWidths:[...nav.querySelectorAll('button')].map(button=>button.getBoundingClientRect().width),
    centerOffset:(bounds[0].left+bounds.at(-1).right-navBounds.left-navBounds.right)/2,
    centers:bounds.map(box=>box.top+box.height/2)};
  });
  assert.equal(pagination.lines,1,JSON.stringify(pagination));
  assert.ok(pagination.buttonWidths.every(width=>width<=80),JSON.stringify(pagination));
  assert.ok(Math.abs(pagination.centerOffset)<1,JSON.stringify(pagination));
  assert.ok(Math.max(...pagination.centers)-Math.min(...pagination.centers)<1,JSON.stringify(pagination));
  if(width<=740){
   assert.ok(attributes.widths.every(width=>width>=128),JSON.stringify(attributes.widths));
   const offsets=await find('attributes').evaluate(node=>{
    const firstCards=[...node.querySelectorAll('.stats .stat:first-child')];
    const start=firstCards.map(card=>card.getBoundingClientRect().left);
    node.scrollLeft=48;
    const distances=firstCards.map((card,index)=>start[index]-card.getBoundingClientRect().left);
    node.scrollLeft=0;
    return distances;
   });
   assert.deepEqual(offsets,[48,48]);
  }
  assert.deepEqual(attributes.levels,['1','1']);
  assert.equal(attributes.headingSize,attributes.gatheringHeadingSize);
  assert.ok(attributes.values.every(size=>size>=22));
  await page.waitForFunction(()=>document.querySelector('#boss-feed-content [data-scroll-column$="-information"]'));
  const layout=await find('section').evaluate(section=>{
   const left=section.querySelector('[data-scroll-column$="-config"]');
   const right=section.querySelector('[data-scroll-column$="-information"]');
   const table=section.querySelector('.table-scroll');
   return {overflow:document.documentElement.scrollWidth-innerWidth,split:getComputedStyle(left).overflowY==='auto',
    stacked:right.getBoundingClientRect().top>=left.getBoundingClientRect().bottom-1,
    tableScroll:table.scrollWidth>table.clientWidth};
  });
  assert.ok(layout.overflow<=0,JSON.stringify({width,language,layout}));
  assert.equal(layout.split,width>740);
  assert.equal(layout.stacked,width<=740);
  if(width<=740)assert.equal(layout.tableScroll,true);
  else {
   const firstRow=await find('skill').evaluate(select=>[
    select.previousElementSibling,select,select.nextElementSibling,document.getElementById('boss-feed-quality'),
   ].map(control=>{
    const box=control.getBoundingClientRect();
    return box.top+box.height/2;
   }));
   assert.ok(Math.max(...firstRow)-Math.min(...firstRow)<2,JSON.stringify({width,language,firstRow}));
   const centers=await find('strategy').evaluate(select=>[select,...['supply','eligible','fire','charge-craft-time']
    .map(id=>document.getElementById('boss-feed-'+id))].map(control=>{
     const box=control.getBoundingClientRect();
     return box.top+box.height/2;
    }));
   assert.ok(Math.max(...centers)-Math.min(...centers)<2,JSON.stringify({width,language,centers}));
  }
  await page.screenshot({path:`${directory}/${language}-${width}.png`});
  await find('attributes').screenshot({path:`${directory}/${language}-${width}-attributes.png`});
 }
 await bossButton(3).click();
 await find('character-equipment').locator('summary').click();
 const offHand=find('character-equipment').locator('.gear-name').filter({has:page.getByText('Off-hand',{exact:true})});
 await offHand.locator('select').selectOption({label:'Blightroot Seed Satchel'});
 const gearLayout=row=>row.evaluate(node=>{
  const bounds=node.getBoundingClientRect();
  const boxes=[...node.querySelectorAll('.gear-name select,.gear-mods > select,.enhance input')].map(control=>{
   const box=control.getBoundingClientRect();
   return [box.x-bounds.x,box.y-bounds.y,box.width,box.height];
  });
  return {columns:getComputedStyle(node).gridTemplateColumns,boxes};
 });
 async function offHandLayouts(row){
  const layouts=[];
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:950});
   layouts.push(await gearLayout(row));
  }
  return layouts;
 }
 const bossOffHandLayouts=await offHandLayouts(offHand.locator('..'));
 async function checkNarrowGear(equipment){
  const rows=await equipment.locator('.gear-row').evaluateAll(elements=>elements.map(row=>{
   const bounds=selector=>row.querySelector(selector).getBoundingClientRect().toJSON();
   return {
    row:row.getBoundingClientRect().toJSON(),label:bounds('.gear-name span'),item:bounds('.gear-name select'),
    rarity:bounds('.gear-mods > select'),enhance:bounds('.enhance input'),note:bounds('.gear-stats'),
   };
  }));
  assert.ok(rows.length>0);
  for(const {row,label,item,rarity,enhance,note} of rows){
   assert.ok(item.top>=label.bottom);
   assert.ok(Math.abs(item.left-row.left)<1 && Math.abs(item.right-row.right)<1);
   assert.ok(rarity.top>=item.bottom && note.top>=enhance.bottom);
   assert.ok(Math.abs(rarity.top-enhance.top)<1);
   assert.ok(Math.abs(rarity.width-enhance.width)<1);
   assert.equal(rarity.height,32);
   assert.equal(rarity.height,enhance.height);
   assert.equal(rarity.height,item.height);
   assert.ok(Math.abs(rarity.left-row.left)<1 && Math.abs(enhance.right-row.right)<1);
  }
 }
 await checkNarrowGear(find('character-equipment'));
 assert.match(await offHand.locator('..').locator('.gear-stats').textContent(),/Farming \+3%/);
 const potions=find('character-potions');
 await potions.locator('summary').click();
 const elixir=potions.locator('label').filter({hasText:'Elixir of the vein'});
 await elixir.locator('select').selectOption('2');
 assert.equal(await elixir.locator('..').locator('.micro').textContent(),'All XP +16%');
 const farmingCards=find('attributes').getByRole('group',{name:'Farming',exact:true}).locator('.stat');
 assert.equal(await farmingCards.count(),6);
 assert.equal(await farmingCards.filter({hasText:'Gather speed bonus'}).locator('strong').textContent(),'3%');
 assert.equal(await farmingCards.filter({hasText:'Craft speed bonus'}).locator('strong').textContent(),'0%');
 assert.equal(await farmingCards.evaluateAll(cards=>new Set(cards.map(card=>card.getBoundingClientRect().top)).size),1);
 const home=find('character-home');
 await home.locator('summary').click();
 await home.locator('input').first().fill('5');
 await home.locator('input').first().blur();
 assert.match(await home.locator('.micro').first().textContent(),/current \+5%/);
 for(const [label,name] of [['Head','Blightward hat'],['Body','Blightward coat'],['Legs','Blightward trousers']]){
  const clothing=find('character-equipment').locator('.gear-name').filter({has:page.getByText(label,{exact:true})});
  await clothing.locator('select').selectOption({label:name});
  assert.equal(await clothing.locator('..').locator('.gear-stats').textContent(),'Piece XP +4% · Piece feeding contribution +4%');
 }
 assert.equal(await find('character-equipment').locator('.work-outfit-total').textContent(),
  'Outfit XP total +16% · Outfit feeding contribution total +16%');
 const offHandMods=offHand.locator('..').locator('.gear-mods');
 await offHandMods.locator('select').selectOption('1');
 await offHandMods.locator('input').fill('2');
 await offHandMods.locator('input').blur();
 assert.equal((await state()).character.equipment.shield,21726);
 for (const [section,skill,other] of [['gather','mining','fishing'],['craft','smithing','cooking']]) {
  await page.click('#'+section+'-nav');
  await page.locator(`[data-${section}-skill="${skill}"]`).click();
  const equipment=page.locator(`#${section}-equipment`);
  await equipment.evaluate(node=>{node.open=true;});
  if(section==='craft'){
   const offHand=equipment.locator('[data-craft-field="gear.shield.id"]');
   assert.deepEqual(await offHandLayouts(offHand.locator('../..')),bossOffHandLayouts);
  }
  await checkNarrowGear(equipment);
  for(const [slot,id] of [['helmet','741'],['body','742'],['legs','743']]){
   const item=equipment.locator(`[data-${section}-field="gear.${slot}.id"]`);
   await item.selectOption(id);
   assert.equal(await item.locator('../..').locator('.gear-stats').textContent(),'Piece XP +4%');
  }
  const outfit=equipment.locator('.work-outfit-total');
  assert.equal(await outfit.textContent(),'Outfit XP total +16%');
  await page.locator(`[data-${section}-skill="${other}"]`).click();
  assert.equal(await outfit.textContent(),'Outfit XP total +0%');
  const potionField=page.locator(`[data-${section}-field="brews.${section==='gather'?'hunter':'elixir'}"]`);
  await page.locator(`#${section}-potions`).evaluate(node=>{node.open=true;});
  await potionField.selectOption('1');
  assert.equal(await potionField.locator('xpath=../following-sibling::p[1]').textContent(),
   section==='gather'?'Rarity and rare finds +32.5%':'All XP +13%');
 }
 await page.click('#combat-nav');
 const combatEquipment=page.locator('#equipment-settings');
 await combatEquipment.evaluate(node=>{node.open=true;});
 await checkNarrowGear(combatEquipment);
 await page.locator('#potion-settings').evaluate(node=>{node.open=true;});
 for(const [kind,tier,description] of [
  ['hunter','1','Rarity and rare finds +32.5%'],['warrior','1','Accuracy +13 · Max hit +13%'],
  ['elixir','4','All XP +30%'],['abyssal','2','Monster coins +40%'],['swift','3','Movement speed +44%'],
  ['nourish','1','Food healing +32.5%'],['haste','2','Attack speed +32%'],
 ]){
  const field=page.locator(`[data-path="brews.${kind}"]`);
  await field.selectOption(tier);
  assert.equal(await field.locator('xpath=../following-sibling::p[1]').textContent(),description);
 }
 await page.selectOption('#language','zh');
 const warrior=page.locator('[data-path="brews.warrior"]');
 const warriorNote=warrior.locator('xpath=../following-sibling::p[1]');
 assert.equal(await warriorNote.textContent(),'命中 +13 · 最大伤害 +13%');
 await warrior.selectOption('-1');
 assert.equal(await warriorNote.textContent(),'命中 +0 · 最大伤害 +0%');
 for(const [section,selector] of [
  ['combat','#equipment-settings'],['gather','#gather-equipment'],['craft','#craft-equipment'],
  ['boss-feed','#boss-feed-character-equipment'],
 ]){
  await page.click('#'+section+'-nav');
  const equipment=page.locator(selector);
  await equipment.evaluate(node=>{node.open=true;});
  await checkNarrowGear(equipment);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS boss feeding browser: shared market, filters, character import, responsive attributes and work configuration effects');
} finally {
 server.kill();
 await browser?.close();
}
