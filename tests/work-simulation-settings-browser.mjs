import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath} from '../scripts/release-common.mjs';
import {craftingDefaults,craftingPlayer} from '../src/crafting-model.js';
import {gatheringDefaults,gatheringPlayer} from '../src/gathering-model.js';
import {defaults} from '../src/model.js';
import {priceDefaults} from '../src/item-prices.js';
import {tickMs} from '../src/upstream.js';
const directory=path.resolve(process.argv[2]??'.test-artifacts/work-settings/settings');await fs.mkdir(directory,{recursive:true});
const target=process.argv[3]??null;let server,port;
if(!target){
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
}
const results={target:target??'local',cases:[],errors:[]};let browser;
try{
 if(server)await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([code])=>{throw Error(`Server exited: ${code}`);})]);
 browser=await chromium.launch({headless:true,executablePath:await browserPath()});

 for(const kind of ['gather','craft'])for(const language of ['zh','en'])for(const width of [1440,390]){
  const initial=kind==='craft'?craftingDefaults():gatheringDefaults();initial.simulationHours=1.5;initial.hotSetting='off';
  const player=(kind==='craft'?craftingPlayer:gatheringPlayer)(initial).player;
  const snapshot={version:2,capturedAt:Date.now(),player,worldBuffsVersion:1,worldTick:100,worldBuffs:[]};
  const combat=defaults();combat.manual.simulationHours=1;combat.manual.enemySelection='monster-1';
  const prices=priceDefaults();prices.preferences.autoImport=false;
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>results.errors.push(e.message));
  await context.addInitScript(({kind,initial,combat,language,prices,snapshot})=>{
   const key=kind==='craft'?'dvi-crafting-config-v1':'dvi-gathering-v1';
   if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(kind==='craft'?{version:1,build:initial}:initial));
   localStorage.setItem('dvi-simulator-v1',JSON.stringify({state:combat,language}));localStorage.setItem('dvi-item-prices-v1',JSON.stringify(prices));
   window.snapshot=snapshot;window.runs=[];const Original=Worker;
   window.Worker=class extends Original{
    constructor(url,options){super(url,options);if(String(url).includes(kind==='craft'?'crafting-worker':'gathering-worker')){this.run={rows:[]};window.runs.push(this.run);this.addEventListener('message',({data})=>{if(data.result)this.run.rows.push(data.result);if(data.done)this.run.done=true;});}}
    postMessage(data,...rest){if(this.run)this.run.input=structuredClone(data);return super.postMessage(data,...rest);}
    terminate(){if(this.run)this.run.terminated=true;return super.terminate();}
   };
   document.addEventListener('dvi-character-request',e=>{const r=JSON.parse(e.detail);document.dispatchEvent(new CustomEvent('dvi-character-response',{detail:JSON.stringify({source:'dvi-character-script',id:r.id,version:'2.4',...(r.action==='probe'?{ready:true}:{snapshot:window.snapshot})})}));});
  },{kind,initial,combat,language,prices,snapshot});
  await page.goto(`${target??`http://127.0.0.1:${port}`}/${kind}`);
  const ready=hours=>page.waitForFunction(hours=>window.runs.at(-1)?.done&&window.runs.at(-1).input.state.simulationHours===hours,hours);
  await ready(2);
  const settings=page.locator('#'+kind+(kind==='craft'?'-settings':'-simulation'));await settings.waitFor();
  const hours=page.locator(`[data-${kind}-field="simulationHours"]`),hot=page.locator(`[data-${kind}-field="hotSetting"]`);
  assert.equal(await hours.count(),1);assert.equal(await hours.inputValue(),'2');assert.equal(await hours.getAttribute('min'),'1');assert.equal(await hours.getAttribute('step'),'1');
  assert.equal(await page.locator(`#${kind}-period,[data-${kind}-field="durationMode"]`).count(),0);
  assert.equal(await settings.locator(`[data-${kind}-field="homeBank"]`).count(),0);
  for(const [value,expected] of [['0',1],['1.5',2],['1',1]]){
   await hours.fill(value);await ready(expected);
   assert.equal(await hours.inputValue(),value);
   await hours.blur();assert.equal(await hours.inputValue(),String(expected));
  }
  const row=await page.evaluate(()=>window.runs.at(-1).rows[0]);
  assert.equal(kind==='craft'?row.elapsedTicks:row.durationTicks,3600000/tickMs);
  const column=kind==='craft'?4:5;
  assert.equal(await page.locator(kind==='craft'?`[id="craft-${row.key}-recipe"]`:`#gather-${row.jobId}-level`).locator('xpath=ancestor::tr').locator('td').nth(column).innerText(),(row.completed*24).toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:0}));
  await hot.selectOption('current');await ready(1);assert.match(await page.locator(`#${kind}-hot-schedule`).innerText(),language==='zh'?/模拟区间/:/Simulation window/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await settings.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,`${kind}-${language}-${width}.png`)});
  await hot.selectOption('game');await ready(1);assert.match(await page.locator(`#${kind}-hot-schedule`).innerText(),language==='zh'?/内置预测/:/in-game predictor/);
  await hot.selectOption('off');await ready(1);assert.equal(await page.locator(`#${kind}-hot-schedule`).innerText(),'');
  await page.locator(`#${kind}-import-settings`).evaluate(el=>el.open=true);await page.locator(`#${kind}-import`).click();await ready(1);assert.equal(await hours.inputValue(),'1');
  await page.locator(`[data-character-page="${kind}"][data-character-update="config"]`).check();
  await page.evaluate(()=>{window.snapshot={...window.snapshot,capturedAt:Date.now(),worldBuffs:[{fromTick:0,toTick:200,xpMult:1.15}]};window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(kind=>Number(document.querySelector(`[data-${kind}-field="weeklyXp"]`).value)>14,kind);await ready(1);assert.equal(await hours.inputValue(),'1');
  await page.reload();await ready(1);assert.equal(await hours.inputValue(),'1');
  await page.locator(`[data-character-page="${kind}"][data-character-update="config"]`).uncheck();
  await hot.selectOption('off');
  const priceOptions=page.locator(`[data-page-prices="${kind}"] select`);
  await priceOptions.first().selectOption('none');
  if(kind==='gather'){
   await page.locator('[data-gather-skill="fishing"]').click();
   const jobs=page.locator('[data-gather-field="jobSelection"]');
   const job=await jobs.locator('option').nth(1).getAttribute('value');
   await jobs.selectOption(job);
   await page.locator('#gather-reset').click();
   assert.equal(await jobs.inputValue(),job);
   assert.equal(await page.locator('[data-gather-skill="fishing"]').getAttribute('aria-pressed'),'true');
  }else await page.locator('#craft-reset').click();
  await ready(1);
  assert.equal(await hours.inputValue(),'1');assert.equal(await hot.inputValue(),'off');
  assert.equal(await priceOptions.first().inputValue(),'none');
  if(kind==='craft')await page.locator('[data-craft-skill="smithing"]').click();
  await page.locator(`#${kind}-simulation-defaults`).click();
  await ready(24);assert.equal(await hours.inputValue(),'24');assert.equal(await hot.inputValue(),'current');
  assert.equal(await priceOptions.first().inputValue(),'avg7d');
  if(kind==='gather'){
   assert.equal(await page.locator('[data-gather-field="jobSelection"]').inputValue(),'all');
   assert.equal(await page.locator('[data-gather-skill="fishing"]').getAttribute('aria-pressed'),'true');
  }else assert.equal(await page.locator('[data-craft-skill="smithing"]').getAttribute('aria-pressed'),'true');
  const simulationRuns=await page.evaluate(()=>window.runs.length);
  await priceOptions.first().selectOption('none');
  await page.locator(`#${kind}-simulation-defaults`).click();
  assert.equal(await priceOptions.first().inputValue(),'avg7d');
  assert.equal(await page.evaluate(()=>window.runs.length),simulationRuns);
  await hours.fill('');await hours.blur();assert.equal(await hours.inputValue(),'24');
  const runCount=await page.evaluate(()=>window.runs.length);
  const rolePanel=page.locator(`#${kind}-character-panel`),simulationPanel=page.locator(`#${kind}-simulation-panel`);
  await rolePanel.locator('summary').first().press('Space');assert.equal(await rolePanel.getAttribute('open'),null);
  await simulationPanel.locator('summary').first().click();assert.equal(await hours.isVisible(),false);
  await page.selectOption('#language',language==='zh'?'en':'zh');
  assert.equal(await rolePanel.getAttribute('open'),null);assert.equal(await simulationPanel.getAttribute('open'),null);
  await page.locator('#forecast-nav').click();await page.locator(`#${kind}-nav`).click();
  assert.equal(await simulationPanel.getAttribute('open'),null);
  await simulationPanel.locator('summary').first().press('Enter');assert.equal(await hours.isVisible(),true);
  assert.equal(await rolePanel.getAttribute('open'),null);
  assert.equal(await page.evaluate(()=>window.runs.length),runCount);
  assert.ok(await page.evaluate(()=>window.runs.slice(0,-1).every(r=>r.terminated)));
  results.cases.push(`${kind}/${language}/${width}: migration, normalization, real window/daily values, hot modes, manual/auto import, reload, separate role/simulation resets, panel folding and Worker cancellation`);
  await context.close();
 }
 assert.deepEqual(results.errors,[]);
}catch(error){results.errors.push(error.stack??String(error));process.exitCode=1;}
finally{if(browser)await browser.close();server?.kill();await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2)+'\n');}
console.log(JSON.stringify(results,null,2));
