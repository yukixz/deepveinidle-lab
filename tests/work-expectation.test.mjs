import {questlessTick} from '../scripts/native-questless.mjs';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {gatheringDefaults,gatheringPlayer,gatheringJobs,selectedGatheringSites} from '../src/gathering-model.js';
import {simulateGatheringSite} from '../src/gathering-simulation.js';
import {craftingDefaults,craftingJobs,priceItems,craftingMaterials} from '../src/crafting-model.js';
import {createCraftingScenario,simulateCrafting} from '../src/crafting-simulation.js';
import {beforeWork,workQualities,expectedWorkRewards,addExpected} from '../src/work-expectation.js';
import {START_TICK} from '../src/simulation.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('gathering quality expectations normalize and retain rare tiers absent from the sample',()=>{
 const state=gatheringDefaults();state.hotSetting='off';state.simulationHours=1/60;
 const job=gatheringJobs[0],site=selectedGatheringSites(state,job)[0];
 const r=simulateGatheringSite(state,job,site,{seed:123});
 const thresholds=[1-1/40,1/40-1/400,1/400-1/8000,1/8000-1/150000,1/150000];
 thresholds.forEach((p,tier)=>close(r.normalItems[game.withRarity(job.output.itemId,tier)],r.completed*p));
 close(Object.values(r.normalItems).reduce((a,b)=>a+b,0),r.completed);
 assert.ok(r.normalItems[game.withRarity(job.output.itemId,4)]>0);
 assert.equal(r.sampleItems[game.withRarity(job.output.itemId,4)],undefined);
 const {player}=gatheringPlayer(state),context=game.createContext(game.world,0);
 context.windows=[{start:START_TICK,end:START_TICK+10,rarityMult:1e8,xpMult:1}];
 const ps=workQualities(player,context,job,START_TICK+1);
 close(ps.reduce((a,b)=>a+b,0),1);assert.ok(ps.every(p=>p>=0));assert.equal(ps[4],1);
});

test('burn product expectation uses pre-action level while XP and timing retain the native path',()=>{
 const state=craftingDefaults();state.hotSetting='off';const job=craftingJobs.find(j=>j.skill==='cooking');
 const scenario=createCraftingScenario(state,job,2,100,{seed:77});
 let expectedBurn=0,completed=0,initialXp=scenario.player.skills.cooking,tick=0;
 while(completed<100){
  tick++;const b=game.burnChance(job,scenario.player),events=[];
  questlessTick(game,scenario.player,scenario.context,START_TICK+tick,events);
  if(events.some(e=>e.kind==='produced'||e.kind==='burnt')){expectedBurn+=b;completed++;}
 }
 const r=simulateCrafting(state,job,2,100,{seed:77});
 close(r.items[job.burn.itemId],expectedBurn);
 close(r.items[game.withRarity(job.output.itemId,2)],(100-expectedBurn)*job.output.qty);
 assert.equal(r.xp,scenario.player.skills.cooking-initialXp);assert.equal(r.elapsedTicks,tick);
 assert.deepEqual(r.consumed,craftingMaterials(job,2,100));
 assert.notEqual(r.items[job.burn.itemId],r.burnt);
 const partial=simulateCrafting(state,job,2,100,{seed:77,maxTicks:100});
 assert.equal(partial.complete,false);assert.equal(partial.error,'timeLimit');
 close((partial.items[job.burn.itemId]??0)+(partial.items[game.withRarity(job.output.itemId,2)]??0),partial.completed);
});

test('reward opportunities skip failures, respect ironman and use post-XP speed',()=>{
 const state=gatheringDefaults();state.hotSetting='off';const {player}=gatheringPlayer(state);
 const job=gatheringJobs[0],context=game.createContext(game.world,0),produced={itemId:job.output.itemId,qty:1};
 const none={};expectedWorkRewards(none,player,context,job,START_TICK,null,null);assert.deepEqual(none,{});
 player.skills.mining=game.levelXp(80);
 const rewards={};expectedWorkRewards(rewards,player,context,job,START_TICK,null,produced);
 const mounts=Object.entries(rewards).filter(([id])=>game.baseItemId(Number(id))===game.mountItemId);
 close(mounts.reduce((n,[,q])=>n+q,0),game.mountChance(1/game.workChance(job,player)));
 close(rewards[game.skillPet('mining').itemId],game.skillPetChance('mining'));
 player.ironman=true;const iron={};expectedWorkRewards(iron,player,context,job,START_TICK,null,produced);
 assert.equal(Object.keys(iron).length,2);assert.ok(iron[game.skillPet('mining').itemId]>0);
 assert.ok(rewards[909]>0);close(iron[909],rewards[909]);
 player.activity='working';player.workJobId=job.id;player.stunUntil=START_TICK+5;
 assert.equal(beforeWork(player,job,START_TICK),null);
});

test('bonus probability is unchanged by luck and pack capacity is checked before pets',()=>{
 const state=gatheringDefaults();state.skill='woodcutting';state.hotSetting='off';state.gear.amulet={id:186,tier:4,plus:5};
 const {player}=gatheringPlayer(state),job=gatheringJobs.find(j=>j.skill==='woodcutting'),context=game.createContext(game.world,0);
 const produced={itemId:job.output.itemId,qty:1},capacity=game.packCapacity(player);
 const sumBonus=items=>Object.entries(items).filter(([id])=>game.baseItemId(Number(id))===job.bonus.itemId).reduce((n,[,q])=>n+q,0);
 const open={};expectedWorkRewards(open,player,context,job,START_TICK,{pack:[]},produced);close(sumBonus(open),job.bonus.chance);
 const full={};expectedWorkRewards(full,player,context,job,START_TICK,{pack:Array.from({length:capacity-1},()=>({itemId:job.output.itemId,qty:1}))},produced);
 assert.equal(sumBonus(full),0);assert.ok(full[game.skillPet(job.skill).itemId]>0);
});

test('expected pricing and aggregation accept fractions without relaxing material quantities',()=>{
 assert.throws(()=>priceItems({1:.25},{}),/quantityOverflow/);
 close(priceItems({1:.25},{},{expected:true}).value,game.vendorPrice(1)*.25);
 for(const n of [-1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>priceItems({1:n},{},{expected:true}),/quantityOverflow/);
 const items={};addExpected(items,1,.25);addExpected(items,1,.125);assert.equal(items[1],.375);
 assert.throws(()=>addExpected(items,1,Infinity),/invalidResult/);
 assert.throws(()=>addExpected({1:Number.MAX_SAFE_INTEGER},1,2),/quantityOverflow/);
 assert.throws(()=>craftingMaterials(craftingJobs[0],0,.25),/invalidQuantity/);
 const pet=game.skillPet('cooking').itemId;assert.equal(priceItems({[pet]:.2},{[pet]:{price:999}},{expected:true}).value,0);
});


test('both pages describe the hybrid model and gathering retains small expected quantities',()=>{
 for(const page of ['gathering','crafting']){
  const source=fs.readFileSync(new URL('../src/'+page+'-controls.js',import.meta.url),'utf8');
  const names=page==='gathering'?['expectedQuantity','methodNote']:['methodNote'];
  const functions=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name)).map(node=>source.slice(node.start,node.end)).join('\n');
  for(const language of ['zh','en']){
   const context=vm.createContext({language,state:{discardGathered:false},text:(zh,en)=>language==='zh'?zh:en,format:(v,digits=page==='gathering'?1:0)=>v.toLocaleString('en',{minimumFractionDigits:digits,maximumFractionDigits:digits})});
   vm.runInContext(functions,context);
   if(page==='gathering'){
    assert.equal(vm.runInContext('expectedQuantity(0)',context),'0');
    assert.equal(vm.runInContext('expectedQuantity(.025)',context),'1/40');
    assert.equal(vm.runInContext('expectedQuantity(.1)',context),'0.10');
    assert.equal(vm.runInContext('expectedQuantity(10)',context),'10');
   }
   const note=vm.runInContext('methodNote()',context);
   assert.match(note,language==='zh'?/原始模拟/:/original simulation/);
   assert.match(note,language==='zh'?/数学期望/:/mathematical expectations/);
   assert.match(note,language==='zh'?/活动礼盒仍按原始模拟/:/Event boxes still use simulated/);
   assert.equal((note.match(/class="simulation-caveat"/g)||[]).length,2);
   if(page==='gathering'){
    vm.runInContext('state.discardGathered=true',context);
    assert.match(vm.runInContext('methodNote()',context),language==='zh'?/已丢弃部分不估值/:/Discarded items have no value/);
   }
  }
 }
});
