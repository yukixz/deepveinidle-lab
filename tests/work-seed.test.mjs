import {questlessOffline} from '../scripts/native-questless.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import * as game from '../src/upstream.js';
import * as gathering from '../src/gathering-model.js';
import * as crafting from '../src/crafting-model.js';
import * as store from '../src/crafting-store.js';
import {createGatheringScenario,simulateGatheringSite,simulateGatheringJob} from '../src/gathering-simulation.js';
import {createCraftingScenario,simulateCrafting,simulateCraftingWindow} from '../src/crafting-simulation.js';
import {START_TICK} from '../src/simulation.js';
import {nativeDay} from './native-day.mjs';

test('gathering seeded results reproduce and match original offline reports in all four skills',()=>{
 for(const skill of gathering.gatheringSkills){
  const now=Date.UTC(2026,9,19),state=gathering.gatheringDefaults();state.skill=skill;state.simulationHours=1/60;
  const before=JSON.stringify(state),job=gathering.gatheringJobs.find(j=>j.skill===skill),site=gathering.selectedGatheringSites(state,job)[0];
  const outcomes=[];
  for(const seed of [123456789,0xffffffff]){
   const scenario=createGatheringScenario(state,job,site,{seed,now});assert.equal(scenario.context.seed,seed);
   const r=simulateGatheringSite(state,job,site,{seed,now});assert.equal(r.seed,seed);
   assert.deepEqual(r,simulateGatheringSite(state,job,site,{seed,now}));
   const native=nativeDay(scenario.player,scenario.context,p=>game.startWork(p,scenario.context,site.id,job.id,'bank',null),scenario.durationTicks);
   assert.equal(r.xp,native.bySkill[skill]);
   const items=r.sampleItems;
   assert.deepEqual(items,native.itemsGained);
   const {seed:ignored,...outcome}=r;outcomes.push(outcome);
  }
  assert.notDeepEqual(outcomes[0],outcomes[1],skill);
  assert.equal(JSON.stringify(state),before);assert.equal(state.hotSetting,'current');
 }
});

test('nearest gathering site uses the round seed',()=>{
 const state=gathering.gatheringDefaults();state.simulationHours=1/60;const job=gathering.gatheringJobs[0];
 const r=simulateGatheringJob(state,job,{seed:42});assert.equal(r.seed,42);assert.equal(r.sites.length,1);assert.ok(r.sites.every(s=>s.seed===42));
 assert.throws(()=>createGatheringScenario(state,job,gathering.selectedGatheringSites(state,job)[0],{seed:-1}),/Invalid simulation seed/);
});

test('crafting seeds reproduce all five skills and match original finite-route reports',()=>{
 for(const skill of crafting.craftingSkills){
  const now=Date.UTC(2026,9,19),state=crafting.craftingDefaults();state.skill=skill;
  const job=crafting.craftingJobs.find(j=>j.skill===skill),outcomes=[];
  for(const seed of [123456789,0xffffffff]){
   const scenario=createCraftingScenario(state,job,0,100,{seed,now}),xp=scenario.player.skills[skill];assert.equal(scenario.context.seed,seed);
   const report=questlessOffline(game,scenario.player,scenario.context,START_TICK+60000),r=simulateCrafting(state,job,0,100,{seed,now});
   assert.equal(r.seed,seed);assert.equal(r.complete,true);assert.equal(r.xp,scenario.player.skills[skill]-xp);
   assert.deepEqual(r.sampleItems,report.itemsGained);assert.equal(r.burnt,report.burnt);assert.equal(r.deposits,report.deposits);
   assert.deepEqual(r,simulateCrafting(state,job,0,100,{seed,now}));
   const {seed:ignored,...outcome}=r;outcomes.push(outcome);
  }
  assert.notDeepEqual(outcomes[0],outcomes[1],skill);assert.equal(state.hotSetting,'current');
 }
 const state=crafting.craftingDefaults(),job=crafting.craftingJobs.find(j=>j.skill==='cooking');
 assert.equal(simulateCraftingWindow(state,job,0,{seed:42}).seed,42);
 assert.throws(()=>createCraftingScenario(state,job,0,1,{seed:0x100000000}),/Invalid simulation seed/);
});

function harness(){
 const workers=[],timers=new Map();let timerId=0,seed=100;
 const ctx={Date,JSON,URL,Map,Set,document:{getElementById:()=>null},renderHot:()=>{},console:{error(){}},randomSimulationSeed:()=>++seed,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),Worker:class{
  constructor(){workers.push(this);}
  postMessage(data){this.data=data;}
  terminate(){this.terminated=true;}
 }};
 return {ctx,workers,flush:()=>{for(const [id,fn]of timers){timers.delete(id);fn();}}};
}
function gatherScheduler(){
 const h=harness(),source=fs.readFileSync(new URL('../src/gathering-controls.js',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const code=ast.body.filter(n=>n.id?.name==='startSimulation'||n.declarations?.some(d=>d.id.name==='worker')).map(n=>source.slice(n.start,n.end)).join('\n').replaceAll('import.meta.url',"'http://localhost/'");
 h.context=vm.createContext({...h.ctx,state:gathering.gatheringDefaults(),renderResults:()=>{},text:(zh,en)=>en});vm.runInContext(code,h.context);
 h.read=expr=>vm.runInContext(expr,h.context);return h;
}
test('gathering reruns share one seed, ignore stale messages and retain seed across redraws',()=>{
 const h=gatherScheduler();h.context.startSimulation();h.flush();const first=h.workers[0];assert.equal(first.data.seed,101);
 h.context.startSimulation();h.flush();assert.equal(h.workers.length,1);
 h.context.startSimulation(true);h.flush();const second=h.workers[1];assert.equal(second.data.seed,102);assert.equal(first.terminated,true);
 first.onmessage({data:{result:{jobId:1,seed:101},done:true}});first.onerror({message:'stale'});
 assert.equal(h.read('current.results.size'),0);assert.equal(h.read('current.error'),undefined);assert.notEqual(second.terminated,true);
 h.context.state.levels.mining++;h.context.startSimulation();h.flush();assert.equal(h.workers[2].data.seed,103);
});
test('gathering random-source failure is explicit and does not start a fallback worker',()=>{
 const h=gatherScheduler();h.context.randomSimulationSeed=()=>{throw Error('No randomness');};h.context.startSimulation();h.flush();
 assert.equal(h.workers.length,0);assert.equal(h.read('current.error'),'No randomness');assert.equal(h.read('current.running'),false);
});

function craftScheduler(){
 const h=harness(),source=fs.readFileSync(new URL('../src/crafting-controls.js',import.meta.url),'utf8');
 h.context=vm.createContext({...h.ctx,...crafting,...store,game,registerCharacterUpdates:()=>({read(){}}),localStorage:{getItem:()=>null,removeItem:()=>{}},subscribe:()=>{},getSnapshot:()=>({})});
 vm.runInContext(source.replaceAll('import.meta.url',"'http://localhost/'").replace(/^import .*;\n/gm,'').replaceAll('export function','function'),h.context);
 vm.runInContext("renderResults=()=>{};active=true;",h.context);h.read=expr=>vm.runInContext(expr,h.context);
 h.complete=worker=>{for(const p of worker.data.recipes)worker.onmessage({data:{result:{key:p.key,seed:worker.data.seed}}});worker.onmessage({data:{done:true}});};return h;
}
test('crafting batches retain a round seed and rate cache while new rounds discard old results',()=>{
 const h=craftScheduler();h.context.startSimulation();const first=h.workers[0];assert.equal(first.data.seed,101);h.complete(first);
 assert.equal(h.read('rateCache.size'),1);h.context.startSimulation();assert.equal(h.workers.length,1);
 h.context.schedule();assert.equal(h.read('rateCache.size'),0);h.flush();const next=h.workers[1];assert.equal(next.data.seed,102);
 first.onmessage({data:{result:{key:'stale',seed:101},done:true}});first.onerror();assert.equal(h.read('rateCache.has("stale")'),false);assert.equal(h.read('workerError'),null);assert.notEqual(next.terminated,true);
});
test('crafting category and rarity changes preserve the round seed, time and completed rate entries',()=>{
 const h=craftScheduler();h.context.startSimulation();const first=h.workers[0];h.complete(first);
 h.read('selectedTiers.add(2)');h.context.refreshTaskSelection();h.flush();const next=h.workers[1];
 assert.equal(next.data.seed,first.data.seed);assert.equal(next.data.now,first.data.now);
 assert.equal(next.data.recipes.length,1);assert.equal(next.data.recipes[0].tier,2);h.complete(next);
 assert.equal(h.read('rateCache.size'),2);
 h.read("group='missing'");h.context.refreshTaskSelection();h.flush();assert.equal(h.workers.length,2);
 h.read("group='';query='no-match'");h.context.refreshTaskSelection();h.flush();
 assert.equal(h.workers.length,2);assert.equal(h.read('rateCache.size'),2);
});
test('crafting random-source failure is explicit and prevents redraw retry loops',()=>{
 const h=craftScheduler();h.context.randomSimulationSeed=()=>{throw Error('No randomness');};h.context.startSimulation();assert.equal(h.workers.length,0);assert.equal(h.read('workerError'),'No randomness');h.context.startSimulation();assert.equal(h.workers.length,0);
});

test('gathering and crafting workers forward their supplied seed to every work task',()=>{
 for(const type of ['gathering','crafting']){
  const source=fs.readFileSync(new URL(`../src/${type}-worker.js`,import.meta.url),'utf8'),seen=[],results=[];
  const ctx=vm.createContext({...gathering,...crafting,self:{postMessage:m=>results.push(m)},performance:{now:()=>0},simulateGatheringJob:(state,job,o)=>{seen.push(o.seed);return {jobId:job.id,seed:o.seed};},simulateCraftingWindow:(s,j,t,o)=>{seen.push(o.seed);return {key:crafting.recipeKey(j.id,t),seed:o.seed};}});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,''),ctx);
  const state=gathering.gatheringDefaults();state.levels.mining=100;
  ctx.self.onmessage({data:{state,seed:0xffffffff,recipes:[{jobId:61,tier:0,key:'61:0'},{jobId:61,tier:1,key:'61:1'}]}});
  assert.ok(seen.length>=2);assert.ok(seen.every(seed=>seed===0xffffffff));assert.equal(results.at(-1).done,true);
 }
});
