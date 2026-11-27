import {startFight as startCombat} from '../src/upstream.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {game,defaults,preset} from '../src/model.js';
import {createScenario,simulationTick,simulateMonster} from '../src/simulation.js';
import {nativeDay} from './native-day.mjs';
import {craftingJobs,craftingMaterials} from '../src/crafting-model.js';
import {gatheringDefaults,gatheringJobs,selectedGatheringSites} from '../src/gathering-model.js';
import {createGatheringScenario,simulateGatheringSite} from '../src/gathering-simulation.js';
import {questlessOffline} from '../scripts/native-questless.mjs';

test('1190 hunting grounds, new fountains and Ice wight XP use the reviewed map',()=>{
 for(const [id,x,y]of [[9,172,238],[10,243,158],[11,239,188]]){
  const zone=game.world.zoneById.get(id);assert.deepEqual([zone.x,zone.y,zone.width,zone.height],[x,y,12,12]);
 }
 for(const [id,x,y]of [[384,170,244],[385,241,159],[386,237,194]]){
  const site=game.world.siteById.get(id);assert.deepEqual([site.kind,site.x,site.y],['fountain',x,y]);
 }
 assert.equal(game.monsters.find(m=>m.id===11).xp,2200);
});

test('all three moved combat zones match native routes with automatic and both fixed depots',()=>{
 for(const id of [9,10,11])for(const homeBank of [0,1,2]){
  const state=preset('ranged');state.homeBank=homeBank;state.manual.simulationHours=1;state.manual.hotSetting='off';
  const monster=game.monsters.find(m=>m.id===id),scenario=createScenario(state,monster,{seed:314});
  const reference=nativeDay(scenario.player,scenario.context,p=>startCombat(p,scenario.context,id),6000);
  const actual=simulateMonster(state,monster,{seed:314});
  assert.deepEqual(actual.bySkill,reference.bySkill,`zone ${id}, depot ${homeBank}`);
  assert.equal(actual.elapsedTicks,reference.ticks);assert.equal(actual.deaths,reference.deaths);
  assert.ok(actual.movingTicks>0);assert.equal(actual.homeBank,homeBank||scenario.player.homeBank);
 }
});

test('six Colossus recipes at every quality retain base and chips without bars',()=>{
 for(const [recipe,base,chips]of [[271,114,2],[272,394,3],[273,119,2],[274,124,1],[275,129,3],[276,134,2]]){
  const job=craftingJobs.find(j=>j.id===`upgrade-${recipe}`);
  for(let tier=0;tier<5;tier++)assert.deepEqual(craftingMaterials(job,tier,2),{[base+tier*1000]:2,[252+tier*1000]:chips*2});
 }

});

test('synthetic quests remain empty through daily and weekly reset while raw engine creates tasks',()=>{
 for(const tick of [1007999,1008000,1008001,1152000]){
  const {player,context}=createScenario(defaults());
  const raw=structuredClone(player),events=[];
  simulationTick(player,context,tick,events);game.tick(raw,context,tick,[]);
  assert.deepEqual(player.quests.daily,[]);assert.deepEqual(player.quests.weekly,[]);
  assert.ok(raw.quests.daily.length>0);assert.deepEqual(events,[]);assert.equal(player.coins,0);
 }
});

test('automatic task payouts are excluded from thieving coins and XP across the weekly boundary',()=>{
 const s=gatheringDefaults();s.skill='thieving';s.levels.thieving=100;s.simulationHours=24;s.hotSetting='off';s.gear.gloves={id:327,tier:4,plus:5};
 const job=gatheringJobs.find(j=>j.id===243),site=selectedGatheringSites(s,job)[0];
 const scenario=createGatheringScenario(s,job,site);let player;
 game.predict(scenario.player,scenario.context,p=>{player=p;return false;});player.offlineCapTicks=scenario.durationTicks*2;
 assert.ok(game.startWork(player,scenario.context,site.id,job.id,'bank',null));
 const before=player.skills.thieving,raw=structuredClone(player);raw.quests.day=-1;raw.quests.week=-1;
 const report=questlessOffline(game,player,scenario.context,game.predictionStartTick+scenario.durationTicks);
 game.offline(raw,scenario.context,game.predictionStartTick+scenario.durationTicks);
 const actual=simulateGatheringSite(s,job,site);
 assert.ok(raw.coins>player.coins,'raw engine must exercise automatic quest rewards');
 assert.equal(actual.coins,actual.completed*260);assert.equal(actual.coins,report.coins);
 assert.equal(actual.xp,player.skills.thieving-before);assert.deepEqual(player.quests.daily,[]);assert.deepEqual(player.quests.weekly,[]);
});
