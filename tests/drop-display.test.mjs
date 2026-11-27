import {timingDetails} from '../src/activity-timing.js';
import test from 'node:test';
import {compactNumber,formatOneDecimal,formatUnitPrice} from '../src/number-format.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {world as combatWorld} from '../src/upstream.js';
import {defaults,normalize} from '../src/model.js';
import {importCharacter} from '../src/character-import.js';
import {manualControls} from '../src/manual-controls.js';
import {rewardAmount} from '../src/combat-hot.js';
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const names=['enemyColumns','visibleEnemyColumns','depotCell','priceWarning','hourlyCells'];
const code=ast.body.filter(n=>names.includes(n.id?.name)||n.declarations?.some(d=>names.includes(d.id.name))).map(n=>source.slice(n.start,n.end)).join('\n');
const quantityNames=['formatRate','formatDropQuantity','lootDetails'];
const quantityCode=ast.body.filter(n=>quantityNames.includes(n.id?.name)||n.declarations?.some(d=>quantityNames.includes(d.id.name))).map(n=>source.slice(n.start,n.end)).join('\n');
test('gathering pet price notes stay empty without looking up prices',()=>{
 const gathering=fs.readFileSync(new URL('../src/gathering-controls.js',import.meta.url),'utf8');
 const node=parse(gathering,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.id?.name==='priceNote');
 for(const language of ['zh','en']){
  const c=vm.createContext({timingDetails,compactNumber,game:{isPet:()=>true},text:(zh,en)=>language==='zh'?zh:en});
  vm.runInContext(gathering.slice(node.start,node.end),c);
  assert.equal(c.priceNote(280),'');
 }
});
test('combat methodology note identifies simulated and expected fields in both languages below the table',()=>{
 const assignments=ast.body.filter(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.object?.name==='Object'&&n.expression.callee.property?.name==='assign'&&n.expression.arguments[1]?.properties.some(p=>p.key.name==='combatMethodNote'));
 const c=vm.createContext({timingDetails,compactNumber,copy:{zh:{},en:{}}});
 vm.runInContext(assignments.map(n=>source.slice(n.start,n.end)).join('\n'),c);
 assert.match(c.copy.zh.combatMethodNote,/击杀次数、攻击次数、额外耗时、经验及食物消耗来自<strong class="simulation-caveat">原始模拟<\/strong>/);
 assert.match(c.copy.zh.combatMethodNote,/<strong class="simulation-caveat">数学期望<\/strong>/);
 assert.match(c.copy.en.combatMethodNote,/<strong class="simulation-caveat">original simulation<\/strong>/);
 assert.match(c.copy.en.combatMethodNote,/<strong class="simulation-caveat">mathematical expectations<\/strong>/);
 assert.match(c.copy.zh.combatMethodNote,/金币、普通与稀有掉落.*数学期望/);
 assert.match(c.copy.zh.combatMethodNote,/药剂成本按所选时长.*收入与利润.*物品价格/);
 assert.match(c.copy.en.combatMethodNote,/Kills, attack attempts, extra time, XP and food consumption.*original simulation/);
 assert.match(c.copy.en.combatMethodNote,/coins, normal and rare drops.*mathematical expectations/);
 assert.match(c.copy.en.combatMethodNote,/potion cost uses the selected duration.*Income and profit.*item prices/);
 assert.ok(source.includes('</tbody></table></div><p id="combat-method-note" class="table-note">${t(\'rounding\')} <strong class="simulation-caveat">'));
 assert.ok(source.includes("</strong><br>${t('combatMethodNote')}</p></section>"));
});
test('drop quantities use adaptive precision after daily conversion without changing consumables',()=>{
 for(const language of ['zh','en'])for(const hours of [1,6,24,48]){
  const c=vm.createContext({timingDetails,compactNumber,formatUnitPrice,language,state:{manual:{simulationHours:hours}},rewardAmount,game:{isPet:id=>id===280,itemTier:()=>0,baseItemId:id=>id,item:()=>({name:'Item'})},pageValuation:()=>()=>({price:1,fallback:false}),getSnapshot:()=>({}),esc:String,name:String});
  vm.runInContext(quantityCode,c);
  const factor=rewardAmount(1,'day',hours);
  for(const [value,expected] of [[0,'0'],[0.000001,'1/1,000,000'],[0.03,'1/33'],[0.026,'1/38'],[0.027,'1/37'],[0.099,'1/10'],[0.1,'0.10'],[0.1234,'0.12'],[1,'1.00'],[9.994,'9.99'],[10,'10'],[10.6,'11']]){
   const quantity=value/factor;
   assert.equal(vm.runInContext(`formatDropQuantity(${quantity})`,c),expected,`${language}/${hours}/${value}`);
   assert.ok(c.lootDetails({1:quantity},true).includes(`<span>${expected}</span>`));
  }
  assert.ok(c.lootDetails({1:0.03/factor}).includes('<span>0.0</span>'));
  assert.match(c.lootDetails({1:1},true),/<span>Item 1<\/span>/);
  assert.equal(c.lootDetails({},true),'');
  const pet=c.lootDetails({280:0.03/factor},true);
  assert.ok(pet.includes('<span>Item</span>'));
  assert.ok(pet.includes('<span>1/33</span>'));
  assert.ok(!pet.includes('title=')&&!pet.includes('⚠'));
 }
 assert.ok(source.includes("lootDetails(r.normalItems,true)||'0'"));
 assert.ok(source.includes("lootDetails(r.rareItems,true)||'0'"));
 assert.ok(source.includes('lootDetails(r.foodItems??{})'));
 assert.ok(source.includes('lootDetails(r.potionItems??{})'));
});
function view(enabled,result,error=false){
 const c=vm.createContext({timingDetails,compactNumber,formatOneDecimal,state:{manual:{vendorValues:enabled}},hourly:new Map(result?[['m',result]]:[]),simulationError:error,valuedResult:r=>r,language:'zh',game:{tickMs:600,world:combatWorld},t:k=>k,formatRate:(n,metric='count')=>['coins','attempts'].includes(metric)?String(Math.round(n)):n.toFixed(1),esc:String,lootDetails:()=>'<span>item quantity</span>'});
 vm.runInContext(code,c);return c;
}
test('global valuation is canonical and obsolete controls stay absent in both languages',()=>{
 assert.equal(defaults().manual.vendorValues,true);
 assert.equal(normalize({manual:{}}).manual.vendorValues,true);
 const state=defaults();state.manual.vendorValues=true;state.manual.valuationMode='vendor';state.guild={name:"SakuraSpring",tag:"SAKI"};
 assert.equal(normalize(JSON.parse(JSON.stringify(state))).manual.vendorValues,true);
 for(const language of ['zh','en']){
 const controls=manualControls(state,{language,number:()=>'',options:()=>'',esc:String,name:String});
 const html=controls.simulation;
 assert.match(html,/id="simulation-settings"/);
 assert.doesNotMatch(Object.values(controls).join(''),/sakura-settings|Play with Sakura|一起蛐蛐撒库拉/);
 assert.doesNotMatch(html,/<details[^>]* open/);
 assert.doesNotMatch(html,/data-path="manual.valuationMode"/);
 assert.ok(!html.includes(language==='zh'?'掉落估值':'Drop valuation'));
 }
});
test('headers and pending and failed rows follow the visible column count',()=>{
 for(const enabled of [false,true]){
 const c=view(enabled);const columns=c.visibleEnemyColumns();
 assert.equal(columns.length,10);assert.deepEqual(Array.from(columns,x=>x[0]),['enemy','xpHour','totalIncomeHour','profitHour','movingShare','killsHour','coinsHour','normalHour','rareHour','foodHour']);
 assert.equal(columns.find(x=>x[0]==='normalHour')[1],'normalValue');
 assert.equal(columns.some(x=>x[0]==='totalIncomeHour'),true);
 assert.equal((c.hourlyCells({key:'m'}).match(/<td/g)||[]).length,9);
 assert.match(c.hourlyCells({key:'m'}),/<summary>…<\/summary><div>depot: …<\/div>/);
 assert.match(view(enabled,null,true).hourlyCells({key:'m'}),/<summary>!<\/summary><div>depot: !<\/div>/);
 }
});
test('quantities and globally valued amounts render separately with highlighted income',()=>{
 const result={homeBank:2,kills:1,attacks:7,xp:2,coins:3,normal:4,rare:5,normalValue:40,rareValue:50,totalIncome:93,profit:80,foodCost:10,potionCost:3,consumableCost:13,food:6,normalItems:{},rareItems:{},bySkill:{},elapsedTicks:1,movingTicks:0,extraTicks:0,restocks:0};
 for(const enabled of [false,true]){
 const html=view(enabled,result).hourlyCells({key:'m'});
 assert.match(html,new RegExp(`<summary>${'40'}</summary>`));
 assert.match(html,new RegExp(`<summary>${'50'}</summary>`));
 assert.equal(html.includes('<td class="column-highlight">93</td>'),true);
 assert.match(html,/item quantity/);assert.ok(html.startsWith('<td class="column-highlight"><details'));assert.match(html,/<td>3<\/td>/);assert.match(html,/<td><details[^>]*><summary>1<\/summary><div>攻击次数\/天：7/);assert.match(html,/<summary>0\.0%<\/summary>/);assert.match(html,/depot: 仓库 2/);
 const seeded=view(enabled,{...result,seed:4294967295});assert.doesNotMatch(seeded.hourlyCells({key:'m'}),/随机种子：4294967295/);
 seeded.language='en';assert.doesNotMatch(seeded.hourlyCells({key:'m'}),/Random seed: 4294967295/);
 assert.match(seeded.hourlyCells({key:'m'}),/Attack attempts\/day: 7/);
 }
});

test('removed valuation controls stay absent regardless of guild and configuration import',()=>{
 const state=defaults();state.manual.vendorValues=true;state.manual.valuationMode='vendor';
 const render=state=>manualControls(state,{language:'zh',number:()=>'',options:()=>'',esc:String,name:String});
 for(const guild of [null,undefined,{name:'Other',tag:'SAKI'},{name:'SakuraSpring',tag:'OTHER'},{name:'sakuraspring',tag:'SAKI'},{name:'SakuraSpring',tag:'SAKI'}]){
  state.guild=guild;assert.doesNotMatch(render(state).simulation,/data-path="manual.valuationMode"/);assert.doesNotMatch(Object.values(render(state)).join(''),/sakura-settings/);
 }
 const snapshot={version:2,capturedAt:Date.now(),player:{lastTick:100},guild:{name:'SakuraSpring',tag:'SAKI'}};
 const imported=importCharacter(state,snapshot).state;
 assert.doesNotMatch(render(imported).simulation,/manual.valuationMode/);assert.equal(imported.manual.vendorValues,true);
 const left=importCharacter(imported,{...snapshot,guild:null}).state;
 assert.doesNotMatch(render(left).simulation,/manual.valuationMode/);assert.equal(left.manual.vendorValues,true);
 assert.equal(normalize(JSON.parse(JSON.stringify(left))).manual.vendorValues,true);
});

test('table amounts show fallback warnings before expanding and food displays its cost',()=>{
 const result={homeBank:2,kills:1,attacks:7,xp:2,coins:3,normalValue:40,rareValue:50,totalIncome:93,profit:20,food:6,foodCost:70,potionCost:3,consumableCost:73,consumableMissingPrices:[64],normalItems:{},rareItems:{},bySkill:{},elapsedTicks:1,movingTicks:0,extraTicks:0,restocks:0,normalMissingPrices:[1],rareMissingPrices:[],missingPrices:[1],foodMissingPrices:[64],profitMissingPrices:[1,64]};
 const html=view(true,result).hourlyCells({key:'m'});
 assert.match(html,/<summary><span[^>]*>⚠<\/span> 40<\/summary>/);
 assert.match(html,/<summary><span[^>]*>⚠<\/span> 73<\/summary>/);
 assert.match(html,/<td class="column-highlight"><span[^>]*>⚠<\/span> 93<\/td>/);
 assert.match(html,/<td class="column-highlight"><span[^>]*>⚠<\/span> 20<\/td>/);
 assert.match(html,/食物成本：/);assert.match(html,/药剂成本：/);
 assert.doesNotMatch(html,/<summary><span[^>]*>⚠<\/span> 50<\/summary>/);
});

test('kills and attack attempts scale per day using selected duration even after death',()=>{
 const result={homeBank:2,kills:12345,attacks:67890,xp:48,coins:48,normalValue:48,rareValue:48,totalIncome:144,profit:96,foodCost:24,potionCost:24,consumableCost:48,normalItems:{},rareItems:{},bySkill:{melee:48},elapsedTicks:1,movingTicks:0,extraTicks:0,restocks:0,deaths:1};
 const formatter=ast.body.find(n=>n.declarations?.some(d=>d.id.name==='formatRate'));
 for(const language of ['zh','en'])for(const hours of [1,6,24,48])for(const kills of [0,12345,12345.6789]){
  const c=view(true,{...result,kills});c.language=language;c.state.manual.simulationHours=hours;c.rewardAmount=rewardAmount;
  vm.runInContext(source.slice(formatter.start,formatter.end),c);
  const html=c.hourlyCells({key:'m'});
  const daily=n=>rewardAmount(n,'day',hours).toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:0});
  assert.ok(html.includes(`<summary>${daily(kills)}</summary><div>${language==='zh'?'攻击次数/天：':'Attack attempts/day: '}${daily(67890)}</div>`));
  assert.ok(html.includes(`<td>${compactNumber(rewardAmount(48,'day',hours))??rewardAmount(48,'day',hours).toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:0})}</td>`));
  assert.ok(html.includes(`melee: ${compactNumber(rewardAmount(48,'day',hours))??rewardAmount(48,'day',hours).toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:0})}`));
 }
});

test('combat controls omit reward period and bilingual headers label daily counts and rewards',()=>{
 const assignments=ast.body.filter(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.object?.name==='Object'&&n.expression.callee.property?.name==='assign'&&n.expression.arguments[1]?.properties.some(p=>p.key.name==='combatMethodNote'));
 const headers=ast.body.find(n=>n.id?.name==='enemyHeaders');
 for(const language of ['zh','en']){
  const controls=manualControls(defaults(),{language,number:()=>'',options:()=>'',esc:String,name:String});
  assert.doesNotMatch(controls.simulation,/id="period"|利润周期|Reward period/);
  const c=view(true);c.language=language;c.copy={zh:{},en:{}};c.sort='level';c.sortDirection='desc';
  vm.runInContext(assignments.map(n=>source.slice(n.start,n.end)).join('\n'),c);
  c.t=k=>c.copy[language][k]??k;
  vm.runInContext(source.slice(headers.start,headers.end),c);
  const html=c.enemyHeaders();
  assert.equal((html.match(/<th /g)||[]).length,10);
  assert.equal((html.match(language==='zh'?/\/天/g:/\/day/g)||[]).length,8);
  assert.ok(html.includes(language==='zh'?'击杀次数/天 <span':'Kills/day <span'));
  assert.ok(html.includes(language==='zh'?'消耗品/天 <span':'Consumables/day <span'));
 }
 assert.doesNotMatch(source,/\$\('#period'\)|periodOptions/);
});
