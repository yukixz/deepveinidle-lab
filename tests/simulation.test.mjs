import {questlessOffline} from '../scripts/native-questless.mjs';
import {nativeDay} from './native-day.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults as defaultBuild,preset as presetBuild,normalize,masteryValue,masteryRank} from '../src/model.js';
import * as game from '../src/upstream.js';
import {simulateMonster,createScenario,START_TICK,HOUR_TICKS,DAY_TICKS} from '../src/simulation.js';
// Keep non-forecast regression scenarios deterministic and independent of wall time.
const preset=style=>{const s=presetBuild(style);s.manual.hotSetting='off';s.manual.simulationHours=24;return s;};
const defaults=()=>{const s=defaultBuild();s.manual.hotSetting='off';s.manual.simulationHours=24;return s;};

test('banking eats without overhealing and loads trip food only with auto-eating enabled',()=>{
 for(const [hp,eatAt,stock,expectedHp,eaten]of [[12,.5,28,72,3],[42,.5,28,82,2],[43,.5,28,83,2],[12,0,28,12,0],[12,.5,0,12,0],[0,.5,28,80,4],[12,.5,1,32,1]]){
  const {player:p,context}=createScenario(preset('magic'),game.monsters[0]);
  p.bank={66:stock};p.pack=[];p.foodItemId=66;p.foodPerTrip=28;
  p.eatAt=eatAt;p.hp=hp;p.perks.meals=0;p.brews={};
  p.route={zoneId:12};p.activity='banking';
  const events=[];game.tick(p,context,START_TICK+1,events);
  assert.equal(p.hp,expectedHp,`hp=${hp}, threshold=${eatAt}, stock=${stock}`);
  assert.equal(events.filter(e=>e.kind==='ate').length,eaten);
  assert.ok(events.filter(e=>e.kind==='ate').every(e=>e.healed===20));
  assert.equal(p.pack.reduce((sum,item)=>sum+item.qty,0),eatAt>0?stock-eaten:0);
  assert.equal(p.activity,'idle');
 }
});


test('effective mastery values cap enhancement while stored ranks and original units survive',()=>{
 for(const m of game.masteries)for(const rank of [0,1,13,20000])assert.equal(masteryRank(m.id,masteryValue(m.id,rank)),Math.min(rank,200));
 const stored=defaultBuild();stored.masteries.enhance=20000;assert.equal(normalize(stored).masteries.enhance,200);
 assert.equal(masteryValue('accuracy',1),1);assert.equal(masteryRank('accuracy',11),11);
 assert.equal(masteryRank('enhance',0.5),2);assert.equal(masteryValue('enhance',1),0.25);assert.equal(masteryValue('offline',1),0.12);
});
test('all monsters match the original predictor XP, timing and deaths',()=>{
 const state=preset('ranged');
 for(const monster of game.monsters){
  const scenario=createScenario(state,monster),zone=game.world.zones.find(z=>z.monsterId===monster.id);
  const expected=nativeDay(scenario.player,scenario.context,p=>game.startFight(p,scenario.context,zone.id));
  const actual=simulateMonster(state,monster);
  assert.equal(Math.round(actual.xp),expected.xpPerHour,monster.name);
  assert.deepEqual(actual.bySkill,expected.bySkill,monster.name);
  assert.equal(actual.deaths,expected.deaths);assert.equal(actual.elapsedTicks,expected.ticks);
  assert.ok(Math.abs(actual.normal-actual.kills*(monster.dropChance??1))<1e-7);
 }
});
test('full tick event counts agree with original offline report and food inventory ledger',()=>{
 const state=preset('ranged'),monster=game.monsters.find(m=>m.id===20),scenario=createScenario(state,monster);
 let p;game.predict(scenario.player,scenario.context,prepared=>{p=prepared;return false;});
 assert.equal(p.lastTick,START_TICK);assert.equal(p.pack.length,0);
 game.startFight(p,scenario.context,game.world.zones.find(z=>z.monsterId===monster.id).id);
 p.offlineCapTicks=DAY_TICKS*2;
 const report=questlessOffline(game,p,scenario.context,START_TICK+DAY_TICKS),actual=simulateMonster(state,monster);
 assert.equal(actual.kills,report.kills);
 const food=game.withRarity(state.food.id,state.food.tier),left=(p.bank[food]??0)+p.pack.filter(x=>x.itemId===food).reduce((n,x)=>n+x.qty,0);
 assert.equal(actual.foodItems[food],actual.food);assert.equal(actual.food,1e9-left);assert.ok(actual.food>0);assert.ok(actual.restocks>1);assert.ok(actual.movingTicks>0);
});
test('death follows predictor check boundaries without lifetime extrapolation',()=>{
 const r=simulateMonster(defaults(),game.monsters.find(m=>m.id===20));
 assert.equal(r.deaths,1);assert.ok(r.elapsedTicks<HOUR_TICKS);assert.equal(r.elapsedTicks%game.predictionChunkTicks,0);assert.equal(r.kills,0);
});
test('movement potion and mastery affect real travel and yields',()=>{
 const state=preset('ranged'),monster=game.monsters.find(m=>m.id===20),base=simulateMonster(state,monster);
 state.brews.swift=4;const swift=simulateMonster(state,monster);assert.ok(swift.movingTicks<base.movingTicks);assert.ok(swift.kills>base.kills);
 state.brews.swift=-1;state.masteries.move=100;const mastery=simulateMonster(state,monster);assert.ok(mastery.movingTicks<base.movingTicks);
});
test('starting depot changes travel and repeated simulation preserves input',()=>{
 const state=preset('magic'),before=JSON.stringify(state),monster=game.monsters[0];
 const a=simulateMonster(state,monster),b=simulateMonster(state,monster);assert.deepEqual(a,b);assert.equal(JSON.stringify(state),before);
 state.homeBank=2;assert.notEqual(simulateMonster(state,monster).movingTicks,a.movingTicks);
});
test('buffs, food expiry and movement remain aligned with original prediction',()=>{
 const state=preset('magic');state.food={id:171,tier:2};state.fed=true;state.rooted=true;state.brews.haste=3;state.brews.swift=2;state.masteries.xp=20;state.masteries.move=10;
 const monster=game.monsters.find(m=>m.id===20),scenario=createScenario(state,monster);
 const expected=nativeDay(scenario.player,scenario.context,p=>game.startFight(p,scenario.context,game.world.zones.find(z=>z.monsterId===monster.id).id));
 const result=simulateMonster(state,monster);
 assert.equal(Math.round(result.xp),expected.xpPerHour);assert.deepEqual(result.bySkill,expected.bySkill);assert.equal(result.deaths,expected.deaths);
});

test('mount stacks with movement buffs and matches original full prediction',()=>{
 const s=preset('ranged'),monster=game.monsters.find(m=>m.id===20),base=simulateMonster(s,monster);
 s.gear.mount={id:328,tier:2,plus:5};
 const mounted=simulateMonster(s,monster);assert.ok(mounted.movingTicks<base.movingTicks);
 s.brews.swift=0;s.masteries.move=10;
 const scenario=createScenario(s,monster),zone=game.world.zones.find(z=>z.monsterId===monster.id);
 const expected=nativeDay(scenario.player,scenario.context,p=>{
  const started=game.startFight(p,scenario.context,zone.id);
  return started;
 });
 const walking=createScenario(s,monster);let prepared;
 game.predict(walking.player,walking.context,p=>{prepared=p;return false;});
 game.startFight(prepared,walking.context,zone.id);
 let walk;
 for(let tick=1;tick<=100&&!walk;tick++){
  const events=[];game.tick(prepared,walking.context,START_TICK+tick,events);walk=events.find(e=>e.kind==='walkStarted');
 }
 // Round(1473 * 1.20 * 1.05): mount is rounded before the other multipliers.
 assert.ok(walk);assert.equal(walk.speed,1856);
 const result=simulateMonster(s,monster);
 assert.equal(Math.round(result.xp),expected.xpPerHour);assert.deepEqual(result.bySkill,expected.bySkill);
 assert.equal(result.deaths,expected.deaths);assert.equal(result.elapsedTicks,expected.ticks);
 assert.ok(result.movingTicks<mounted.movingTicks);
});


test('depot defaults to automatic and valid saved choices survive',()=>{
 assert.equal(defaults().homeBank,0);
 for(const homeBank of [undefined,0,-1,99,'automatic'])assert.equal(normalize({homeBank}).homeBank,0);
 for(const homeBank of [1,2])assert.equal(normalize({homeBank}).homeBank,homeBank);
});
test('automatic depots vary by target and match explicit choices',()=>{
 const s=preset('ranged'),before=JSON.stringify(s);
 // The Cairns uses the nearby dungeon chest; The Chalk Steps uses depot 1.
 assert.equal(createScenario(s,game.monsters.find(m=>m.id===4)).player.homeBank,485);
 assert.equal(createScenario(s,game.monsters.find(m=>m.id===20)).player.homeBank,1);
 const chosen=new Set();
 for(const monster of game.monsters){
  const automatic=simulateMonster(s,monster);chosen.add(automatic.homeBank);
  if(game.world.bankById.has(automatic.homeBank))assert.deepEqual(automatic,simulateMonster({...s,homeBank:automatic.homeBank},monster),monster.name);
 }
 assert.ok(chosen.has(1)&&chosen.has(485));assert.equal(JSON.stringify(s),before);
 for(const homeBank of [1,2])for(const monster of game.monsters)assert.equal(createScenario({...s,homeBank},monster).player.homeBank,homeBank);
});
test('removed manual reproduction overrides use fixed defaults',()=>{
 const s=preset('ranged');s.manual.playerId=54321;s.manual.seed=813;s.manual.currentTick=2000000;
 const n=normalize(s);assert.equal(n.manual.playerId,1);assert.equal(n.manual.seed,0);assert.equal(n.manual.currentTick,START_TICK);
 assert.deepEqual(simulateMonster(s,game.monsters[3]),simulateMonster(preset('ranged'),game.monsters[3]));
});

test('named food above the quality cap is eaten and matches native prediction',()=>{
 const state=preset('ranged'),monster=game.monsters.find(m=>m.id===12);
 state.food={id:64,tier:4};state.manual.foodRule=0;state.manual.foodMaxTier=0;
 for(const slot of ['helmet','body','legs'])state.gear[slot]={id:0,tier:0,plus:0};
 const before=JSON.stringify(state),actual=simulateMonster(state,monster);
 assert.ok(actual.food>0);assert.ok(actual.kills>0);assert.equal(actual.deaths,0);
 const uncapped=structuredClone(state);uncapped.manual.foodMaxTier=4;
 assert.deepEqual(actual,simulateMonster(uncapped,monster));
 const {player,context}=createScenario(state,monster),zone=game.world.zones.find(z=>z.monsterId===monster.id);
 const expected=nativeDay(player,context,p=>game.startFight(p,context,zone.id));
 assert.equal(actual.xp,expected.xpPerHour);assert.deepEqual(actual.bySkill,expected.bySkill);
 assert.equal(actual.deaths,expected.deaths);assert.equal(actual.elapsedTicks,expected.ticks);
 assert.equal(JSON.stringify(state),before);
});

test('food priorities still enforce the quality cap and fountain-only never eats',()=>{
 const state=preset('ranged'),monster=game.monsters.find(m=>m.id===12);
 state.food={id:64,tier:4};state.manual.foodMaxTier=0;
 for(const slot of ['helmet','body','legs'])state.gear[slot]={id:0,tier:0,plus:0};
 for(const foodRule of [1,2]){
  state.manual.foodRule=foodRule;
  const capped=simulateMonster(state,monster);assert.equal(capped.food,0);
  const uncapped=structuredClone(state);uncapped.manual.foodMaxTier=4;
  assert.ok(simulateMonster(uncapped,monster).food>0);
 }
 state.manual.foodRule=3;state.manual.foodMaxTier=4;
 assert.equal(simulateMonster(state,monster).food,0);
});

test('enabled potions retain full quality IDs and charge one per selected hour',()=>{
 const state=defaults();state.manual.simulationHours=1;state.brews.hunter=3;
 const result=simulateMonster(state,game.monsters.find(m=>m.id===20));
 const potion=game.potions.find(p=>p.kind==='hunter');
 assert.deepEqual(result.potionItems,{[game.withRarity(potion.itemId,3)]:1});
});

test('removed snapshot format is rejected instead of falling back to a manual simulation',()=>{
 assert.throws(()=>createScenario({format:'snapshot',snapshot:{}}),/Unsupported simulation format/);
});
