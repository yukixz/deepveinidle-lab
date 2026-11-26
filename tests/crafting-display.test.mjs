import {timingDetails} from '../src/activity-timing.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as game from '../src/upstream.js';
import * as model from '../src/crafting-model.js';
import * as store from '../src/crafting-store.js';
import {valuationPrice} from '../src/item-prices.js';
import {compactNumber,formatOneDecimal,formatUnitPrice} from '../src/number-format.js';
const source=fs.readFileSync(new URL('../src/crafting-controls.js',import.meta.url),'utf8');
function page(language='zh'){
 const context=vm.createContext({timingDetails,compactNumber,formatOneDecimal,formatUnitPrice,registerCharacterUpdates:()=>({read(){}}),...model,...store,game,valuationPrice,pageValuation:(page,prices)=>id=>valuationPrice(id,prices),localStorage:{getItem(){return null;},removeItem(){}},translatedName:n=>n,translatedItemName:id=>String(id),getSnapshot:()=>({getItem:()=>({price:null,vendorPrice:0})}),subscribe(){}});
 vm.runInContext(source.replaceAll('import.meta.url',"'http://localhost/'").replace(/^import .*;\n/gm,'').replaceAll('export function','function'),context);
 vm.runInContext(`language=${JSON.stringify(language)};state.levels.cooking=100;[1,2,3,4].forEach(t=>selectedTiers.add(t));`,context);return context;
}
test('all five rarities appear independently, with XP and profit first and no quantity input',()=>{
 for(const lang of ['zh','en']){
  const p=page(lang),rows=vm.runInContext('visibleJobs()',p);assert.equal(rows.length,40);
  assert.deepEqual(Array.from(rows.slice(0,5),r=>r.tier),[0,1,2,3,4]);
  const headers=vm.runInContext('headers()',p);assert.equal((headers.match(/<th /g)||[]).length,7);
  const row=vm.runInContext('recipeRow(visibleJobs()[0])',p);assert.equal((row.match(/<td[ >]/g)||[]).length,7);
  assert.doesNotMatch(row,/<select/);
  assert.ok(headers.indexOf(lang==='zh'?'经验/天':'XP/day')<headers.indexOf(lang==='zh'?'单次材料成本':'Material cost / craft'));
  assert.match(row,lang==='zh'?/ · 普通<\/strong><small>所需等级 1/:/ · Normal<\/strong><small>Level 1/);
  assert.match(headers,/data-craft-sort="levelReq"/);
 }
});

test('rarity filter defaults to normal and combines with search',()=>{
 const p=page();vm.runInContext("selectedTiers.clear();selectedTiers.add(0)",p);
 // Use the actual upstream recipe name to avoid translation assumptions.
 vm.runInContext("query=craftingJobs.find(j=>j.id===61).name",p);
 assert.equal(vm.runInContext('visibleJobs().length',p),1);
 assert.equal(vm.runInContext('visibleJobs()[0].tier',p),0);
 vm.runInContext('selectedTiers.add(2)',p);
 assert.deepEqual(Array.from(vm.runInContext('visibleJobs().map(p=>p.tier)',p)),[0,2]);
 const html=vm.runInContext('rarityFilters()',p);assert.equal((html.match(/aria-pressed="true"/g)||[]).length,2);
 vm.runInContext('selectedTiers.clear()',p);
 assert.equal(vm.runInContext('visibleJobs().length',p),0);
 assert.match(source,/const selectedTiers=new Set\(\[0\]\)/);
});

test('calculation status keeps its layout slot when idle, running and failed',()=>{
 const p=page();assert.match(vm.runInContext('craftingProgress()',p),/craft-progress is-idle/);
 vm.runInContext('running=true;progress={completed:1,total:5}',p);
 const running=vm.runInContext('craftingProgress()',p);assert.match(running,/1\/5/);assert.doesNotMatch(running,/is-idle|hidden/);
 vm.runInContext("running=false;workerError='workerFailed'",p);
 assert.doesNotMatch(vm.runInContext('craftingProgress()',p),/is-idle/);
 assert.match(source,/craft-recipe-heading.*craftingProgress\(\)/);
 assert.doesNotMatch(source,/<p class="table-note gather-progress"/);
});

test('recipe cost and value details show read-only prices',()=>{
 const p=page();
 vm.runInContext(`getSnapshot=()=>({getItem:id=>({price:id===20?2500:1250,vendorPrice:0})});
 const recipe=visibleJobs()[0];
 rateCache.set(recipe.key,{signature:signature(recipe),result:{completed:1,xp:999.25,items:{60:1},consumed:{20:1}}});`,p);
 const row=vm.runInContext('recipeRow(visibleJobs()[0])',p);
 assert.doesNotMatch(row,/<input/);
 assert.match(row,/-cost/);assert.match(row,/-value/);
 assert.match(row,/<summary>999\.25<\/summary>/);
 assert.match(row,/<td class="column-highlight">-1\.25K<\/td>/);
 assert.match(row,/-cost"><summary>2\.50K<\/summary>/);
 assert.match(row,/-value"><summary>1\.25K<\/summary>/);
 assert.match(row,/20 · 普通 2\.50K<\/span><span>1<\/span>/);
 assert.match(row,/60 · 普通 1\.25K<\/span><span>1<\/span>/);
});


test('upgrades stay in the seven-column table without extra recipe notes and display daily simulation results',()=>{
 for(const lang of ['zh','en']){
  const p=page(lang);vm.runInContext("state.skill='smithing';query='Colossus blade';state.levels.smithing=99",p);
  const recipes=vm.runInContext('visibleJobs()',p);assert.equal(recipes.length,5);
  vm.runInContext(`const recipe=visibleJobs()[0];rateCache.set(recipe.key,{signature:signature(recipe),result:{completed:12,xp:22800,items:{350:12},consumed:{114:12}}});`,p);
  const row=vm.runInContext('recipeRow(visibleJobs()[0])',p);
  assert.equal((row.match(/<td[ >]/g)||[]).length,7);
  assert.doesNotMatch(row,/即时升级 · 底装 \+0|Instant upgrade · base \+0|gear-stats/);
  assert.match(row,/<summary>22\.80K<\/summary>/);assert.match(row,lang==='zh'?/平均单次经验/:/Average XP per action/);
 }
});

test('daily craft count rounds for display while sorting retains raw counts',()=>{
 const p=page();vm.runInContext(`const recipe=visibleJobs()[0];rateCache.set(recipe.key,{signature:signature(recipe),result:{completed:241.6,xp:480,items:{40:240},consumed:{20:240}}});`,p);
 const row=vm.runInContext('recipeRow(visibleJobs()[0])',p);
 assert.ok(row.match(/<td[^>]*>.*?<\/td>/g)[4].includes('<summary>242</summary>'));
 assert.equal(vm.runInContext('rateFor(visibleJobs()[0]).result.completed',p),241.6);
});

test('valuation errors preserve all seven cells, highlighted XP/profit and highlighted recipe name',()=>{
 const p=page();vm.runInContext("priceItems=()=>{throw Error('priceOverflow')}",p);
 const row=vm.runInContext('recipeRow(visibleJobs()[0])',p);
 assert.equal((row.match(/<td[ >]/g)||[]).length,7);assert.equal((row.match(/class="column-highlight"/g)||[]).length,3);
});

test('XP details use unrounded run totals, include burnt attempts and handle zero completed actions',()=>{
 const p=page();vm.runInContext(`const recipe=visibleJobs()[0];rateCache.set(recipe.key,{signature:signature(recipe),result:{completed:4,success:3,burnt:1,xp:15,items:{},consumed:{}}});`,p);
 const row=vm.runInContext('recipeRow(visibleJobs()[0])',p);
 assert.match(row,/id="craft-61:0-xp"/);assert.match(row,/平均单次经验<\/span><span>3\.8<\/span>/);
 vm.runInContext('rateFor(visibleJobs()[0]).result.completed=0;rateFor(visibleJobs()[0]).result.xp=0',p);
 assert.match(vm.runInContext('recipeRow(visibleJobs()[0])',p),/单次经验<\/span><span>—<\/span>/);
});

test('rate tasks follow category and rarity while search remains a display filter',()=>{
 const p=page();
 vm.runInContext("state.levels.cooking=1;selectedTiers.clear();selectedTiers.add(0)",p);
 assert.equal(vm.runInContext("pendingRecipes().length",p),1);
 vm.runInContext("query='no-such-item'",p);assert.equal(vm.runInContext('visibleJobs().length',p),0);assert.equal(vm.runInContext('pendingRecipes().length',p),1);
 vm.runInContext("query=craftingJobs.find(j=>j.id===61).name;selectedTiers.add(2)",p);
 assert.deepEqual(Array.from(vm.runInContext('pendingRecipes().map(p=>p.key)',p)),['61:0','61:2']);
 vm.runInContext("group='missing'",p);assert.equal(vm.runInContext('pendingRecipes().length',p),0);
 vm.runInContext("group='';query='';selectedTiers.clear()",p);
 assert.equal(vm.runInContext('pendingRecipes().length',p),0);
 vm.runInContext("selectedTiers.add(4);query=craftingJobs.find(j=>j.id===61).name;const recipe=visibleJobs()[0];rateCache.set(recipe.key,{signature:signature(recipe),result:{completed:10}})",p);
 assert.equal(vm.runInContext('pendingRecipes().length',p),0);
});

test('movement share uses unrounded elapsed ticks, handles zero time and sorts numerically',()=>{
 for(const lang of ['zh','en']){
  const p=page(lang);
  vm.runInContext(`selectedTiers.clear();selectedTiers.add(0);selectedTiers.add(1);const recipes=visibleJobs().slice(0,2);recipes.forEach((recipe,i)=>rateCache.set(recipe.key,{signature:signature(recipe),result:{completed:4,xp:15,items:{},consumed:{},extraTicks:i?1:2,elapsedTicks:i?3:6}}));`,p);
  const cell=()=>vm.runInContext('recipeRow(visibleJobs()[0])',p).match(/<td[^>]*>.*?<\/td>/g)[3];
  assert.match(cell(),/<summary>33\.3%<\/summary>/);
  const headings=vm.runInContext('headers()',p);assert.ok(headings.indexOf('data-craft-sort="movingRatio"')<headings.indexOf('data-craft-sort="completed"'));
  vm.runInContext('state.simulationHours=1',p);
  // Refresh signatures after changing duration; percentages must not scale to a day.
  vm.runInContext('recipes.forEach(recipe=>rateCache.get(recipe.key).signature=signature(recipe))',p);assert.match(cell(),/<summary>33\.3%<\/summary>/);
  vm.runInContext('rateFor(recipes[0]).result.extraTicks=0',p);assert.match(cell(),/<summary>0\.0%<\/summary>/);
  vm.runInContext("sort='movingRatio';direction='desc'",p);assert.equal(vm.runInContext('sortedJobs()[0].tier',p),1);
  vm.runInContext("direction='asc'",p);assert.equal(vm.runInContext('sortedJobs()[0].tier',p),0);
  vm.runInContext('rateFor(recipes[0]).result.elapsedTicks=0',p);assert.equal(cell(),'<td>—</td>');assert.equal(vm.runInContext('sortedJobs()[0].tier',p),1);
  vm.runInContext("rateCache.clear()",p);assert.equal(cell(),lang==='zh'?'<td>计算中…</td>':'<td>Calculating…</td>');
 }
});
