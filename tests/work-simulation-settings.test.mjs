import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_SIMULATION_MINUTES} from '../src/manual-settings.js';
import {simulationTicks} from '../src/combat-hot.js';
import {gatheringDefaults,normalizeGathering,importGathering,gatheringPlayer} from '../src/gathering-model.js';
import {craftingDefaults,normalizeCrafting,importCrafting,craftingPlayer,craftingJobs} from '../src/crafting-model.js';
import {createCraftingScenario,simulateCrafting,simulateCraftingWindow,MAX_CRAFT_TICKS} from '../src/crafting-simulation.js';

for(const [name,defaults,normalize,importConfig,player] of [
 ['gather',gatheringDefaults,normalizeGathering,importGathering,gatheringPlayer],
 ['craft',craftingDefaults,normalizeCrafting,importCrafting,craftingPlayer],
]){
 test(`${name}: integer hour migration, defaults, limits, round trip and import retention`,()=>{
  assert.equal(defaults().hotSetting,'current');
  assert.equal(normalize({}).hotSetting,'current');
  for(const hotSetting of ['game','off'])assert.equal(normalize({hotSetting}).hotSetting,hotSetting);
  const max=Math.floor(MAX_SIMULATION_MINUTES/60);
  for(const [input,expected]of [[undefined,24],['bad',24],[NaN,24],[0,1],[-4,1],[.5,1],[1.49,1],[1.5,2],[48,48],[max+10,max]]){
   const state=normalize({...defaults(),simulationHours:input,customSimulation:true});
   assert.equal(state.simulationHours,expected);
   assert.equal(normalize(JSON.parse(JSON.stringify(state))).simulationHours,expected);
  }
  const snapshot={version:2,capturedAt:Date.now(),player:player(defaults()).player,worldBuffsVersion:1,worldTick:100,worldBuffs:[]};
  for(const hours of [1,2,48]){
   const result=importConfig({...defaults(),hotSetting:'off',simulationHours:hours},snapshot).state;
   assert.equal(result.simulationHours,hours);
   assert.equal(result.hotSetting,'current');
  }
 });
}
test('craft: selected window controls actual ticks, while finite-route simulation stays independent',()=>{
 const job=craftingJobs.find(j=>j.skill==='smithing'&&!j.upgrade),state={...craftingDefaults(),hotSetting:'off'};
 for(const hours of [1,2,48]){
  const s={...state,simulationHours:hours},ticks=simulationTicks(hours);
  const rate=simulateCraftingWindow(s,job,0,{seed:7});
  const reference=simulateCrafting(s,job,0,ticks,{seed:7,maxTicks:ticks});
  assert.equal(rate.elapsedTicks,ticks);assert.equal(rate.complete,true);assert.equal(rate.error,null);
  for(const key of ['completed','xp','items','consumed','endLevel'])assert.deepEqual(rate[key],reference[key]);
 }
 assert.deepEqual(simulateCrafting({...state,simulationHours:1},job,0,3,{seed:7}),simulateCrafting({...state,simulationHours:48},job,0,3,{seed:7}));
 assert.throws(()=>createCraftingScenario(state,job,0,1,{maxTicks:MAX_CRAFT_TICKS+1}),/invalidDuration/);
 const long=simulationTicks(31*24);
 assert.equal(createCraftingScenario(state,job,0,long,{maxTicks:long,timeWindow:true}).maxTicks,long);
});
