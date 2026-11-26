import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath,packageFiles,json} from '../scripts/release-common.mjs';

const directory=path.resolve(process.argv[2]??'.test-artifacts/appreciation');
await fs.mkdir(directory,{recursive:true});
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
const result={cases:[],errors:[]};let browser;
try{
 await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([code])=>{throw Error(`Server exited: ${code}`);})]);
 const base=`http://127.0.0.1:${port}`;
 browser=await chromium.launch({headless:true,executablePath:await browserPath()});
 const page=await browser.newPage();page.on('pageerror',error=>result.errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('dvi-item-prices-v1',JSON.stringify({version:8,prices:{},quotes:{},preferences:{autoImport:false}})));
 const copyURL='https://cdn.jsdelivr.net/gh/vikiboss/v50@main/static/v50.json';
 let copyMode='success',copyRequests=0;
 const sample='第一行外部文案\n<img src=x onerror=alert(1)>'; 
 await page.route(copyURL,async route=>{
  copyRequests++;
  if(copyMode==='network'){await route.abort();return;}
  const mode=copyMode;
  if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,150));
  const body=mode==='json'?'invalid json':JSON.stringify(mode==='empty'?['',null,42]:mode==='object'?{text:'unexpected'}:mode==='choices'?['第一条','第二条']:[mode==='slow'?'旧请求':sample]);
  await route.fulfill({status:mode==='http'?503:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body});
 });
 await page.goto(base+'/forecast');
 const imageResponse=await page.request.get(base+'/src/assets/appreciation.jpg');
 assert.equal(imageResponse.headers()['content-type'],'image/jpeg');
 assert.deepEqual(await imageResponse.body(),await fs.readFile('src/assets/appreciation.jpg'));
 assert.ok((await packageFiles(process.cwd())).some(file=>file.path==='src/assets/appreciation.jpg'));
 for(const width of [1920,1441,1280,390])for(const language of ['zh','en']){
  await page.setViewportSize({width,height:900});await page.selectOption('#language',language);
  const button=page.locator('header #appreciation-open');
  assert.equal(await button.count(),1);
  assert.equal(await button.getAttribute('class'),'secondary');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}/${language}: page overflow`);
  await button.click();await page.locator('#appreciation-dialog[open]').waitFor();
  await page.waitForFunction(expected=>document.querySelector('.appreciation-copy').textContent===expected,sample);
  assert.equal(await page.locator('.appreciation-copy img').count(),0);
  assert.equal(await page.locator('.appreciation-prompt').innerText(),language==='zh'?'觉得好用？微信扫一扫打赏一下～':'Finding it useful? Scan with WeChat to leave a tip.');
  const image=page.locator('.appreciation-image');await image.evaluate(el=>el.decode());
  const bounds=await image.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
  assert.ok(bounds.y>=0&&bounds.y+bounds.height<=900);
  const dimensions=await image.evaluate(el=>[el.naturalWidth,el.naturalHeight]);
  assert.ok(Math.abs(bounds.width/bounds.height-dimensions[0]/dimensions[1])<0.01);
  await page.locator('#language').evaluate(el=>el.focus());
  assert.equal(await page.locator('#language').evaluate(el=>el===document.activeElement),false);
  await page.screenshot({path:path.join(directory,`${language}-${width}.png`)});
  await page.locator('#appreciation-close').click();
  await page.waitForFunction(()=>document.activeElement.id==='appreciation-open');
  await button.press('Enter');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#appreciation-dialog').open&&document.activeElement.id==='appreciation-open');
  await button.click();await page.mouse.click(1,1);
  await page.waitForFunction(()=>!document.querySelector('#appreciation-dialog').open&&document.activeElement.id==='appreciation-open');
  assert.equal(new URL(page.url()).pathname,'/forecast');
  await page.locator('#combat-nav').click();await page.locator('#combat-section [data-open-global-prices]').click();await page.locator('#item-prices-dialog[open]').waitFor();await page.keyboard.press('Escape');await page.locator('#forecast-nav').click();
  result.cases.push({width,language,status:'passed'});
 }
 for(const section of ['combat','gather','craft','enhance','mastery','formulas','debug']){
  await page.goto(base+'/'+section);await page.locator('#appreciation-open').click();await page.locator('#appreciation-dialog[open]').waitFor();await page.keyboard.press('Escape');
 }
 await page.route('**/src/assets/appreciation.jpg',route=>route.abort());
 await page.reload();await page.locator('#appreciation-open').click();await page.locator('#appreciation-error:not([hidden])').waitFor();
 await page.unroute('**/src/assets/appreciation.jpg');await page.keyboard.press('Escape');await page.locator('#appreciation-open').click();
 await page.locator('.appreciation-image').evaluate(el=>el.decode());assert.equal(await page.locator('#appreciation-error').isVisible(),false);
 await page.keyboard.press('Escape');
 const open=async()=>{await page.locator('#appreciation-open').click();};
 const close=async()=>{await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#appreciation-dialog').open);};
 copyMode='choices';
 await page.evaluate(()=>{window.savedRandom=Math.random;Math.random=()=>0;});await open();
 await page.waitForFunction(()=>document.querySelector('.appreciation-copy').textContent==='第一条');await close();
 await page.evaluate(()=>{Math.random=()=>0.999;});await open();
 await page.waitForFunction(()=>document.querySelector('.appreciation-copy').textContent==='第二条');await close();
 await page.evaluate(()=>{Math.random=window.savedRandom;});
 for(const mode of ['network','http','json','empty','object']){
  copyMode=mode;await open();await page.waitForTimeout(100);
  assert.equal(await page.locator('.appreciation-copy').isVisible(),false);
  assert.equal(await page.locator('.appreciation-copy').textContent(),'');await close();
 }
 copyMode='slow';await open();await page.waitForTimeout(20);await close();
 copyMode='success';await open();await page.waitForTimeout(200);
 assert.equal(await page.locator('.appreciation-copy').textContent(),sample);await close();
 copyMode='slow';await open();await page.selectOption('#language','zh');await page.waitForTimeout(200);
 assert.equal(await page.locator('.appreciation-copy').isVisible(),false);await close();
 copyMode='slow';await page.evaluate(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===10000?10:ms,...args);});
 await open();await page.waitForTimeout(200);assert.equal(await page.locator('.appreciation-copy').isVisible(),false);await close();
 result.externalCopy={status:'passed',requests:copyRequests,cases:['every open reloads','random first/last','plain text and newlines','network/http/json/empty/object failure','close/reopen race','redraw race','timeout']};
 assert.deepEqual(result.errors,[]);result.status='passed';
 console.log(JSON.stringify({status:result.status,cases:result.cases.length,directory}));
}catch(error){result.status='failed';result.failure=error.stack;throw error;}
finally{if(browser)await browser.close();server.kill();await json(path.join(directory,'browser.json'),result);}
