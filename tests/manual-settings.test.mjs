import {startFight as startCombat} from '../src/upstream.js';
import {nativeDay} from './native-day.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {game,defaults as defaultBuild,preset as presetBuild,normalize,makePlayer,calculate,selectStyle} from '../src/model.js';
import {createScenario,simulateMonster,START_TICK} from '../src/simulation.js';
import {manualWindows} from '../src/manual-settings.js';
// Keep non-forecast regression scenarios deterministic and independent of wall time.
const preset=style=>{const s=presetBuild(style);s.manual.hotSetting='off';s.manual.simulationHours=24;return s;};
const defaults=()=>{const s=defaultBuild();s.manual.hotSetting='off';s.manual.simulationHours=24;return s;};


test('old configurations keep defaults; all new manual settings survive normalization',()=>{
 const old=normalize({levels:{ranged:70}});assert.equal(old.manual.seed,0);assert.equal(old.manual.currentTick,START_TICK);assert.equal(old.manual.foodPerTrip,-1);
 const s=defaults();s.manual.guildXp=11.5;s.manual.perks.pockets=4;
 assert.deepEqual(normalize(s).manual,s.manual);
});
test('legacy progress and exact XP are ignored; configured levels remain editable',()=>{
 const s=preset('ranged');s.manual.progress={ranged:99};s.manual.xp={ranged:game.levelXp(100)+123};
 const n=normalize(s);assert.equal(n.levels.ranged,85);assert.equal(n.manual.progress,undefined);assert.equal(n.manual.xp,undefined);
 assert.equal(makePlayer(s).player.skills.ranged,game.levelXp(85));
 assert.deepEqual(simulateMonster(s,game.monsters[0]),simulateMonster(preset('ranged'),game.monsters[0]));
});
test('guild and blessing enter native combat XP while legacy events are ignored',()=>{
 const s=preset('ranged');s.manual.guildXp=11;s.manual.blessing=true;s.manual.windows=[{start:0,minutes:60,xp:45,rare:25}];
 const {player}=createScenario(s);assert.equal(player.guildBonus,.11);assert.ok(player.brews.blessing>START_TICK+6000);
 const base=simulateMonster(preset('ranged'),game.monsters[0]),r=simulateMonster(s,game.monsters[0]);assert.equal(base.kills,r.kills);assert.ok(r.xp>base.xp);
 // Gnawer has 8 attack XP and 2 each defence/HP: round at 1+.11+.05 = 1.16.
 assert.ok(r.xp>=r.kills*(9+2+2)&&r.xp<(r.kills+1)*(9+2+2));
});
test('food carry limits, perks and fountain-only mode remain configurable',()=>{
 const s=preset('ranged');s.manual.perks.pockets=5;s.manual.perks.rest=4;s.manual.foodPerTrip=-2;s.manual.foodRule=2;s.manual.foodMaxTier=0;
 const {player}=createScenario(s);assert.deepEqual(player.bank,{64:1e9});assert.equal(player.foodPerTrip,-2);assert.equal(player.foodItemId,-2);assert.equal(player.perks.pockets,5);assert.equal(player.perks.rest,4);
 assert.ok(simulateMonster(s,game.monsters.at(-1)).food>0);
 s.manual.foodRule=3;assert.equal(simulateMonster(s,game.monsters.at(-1)).food,0);
});
test('legacy buff expiry and home overrides reset to permanent buffs and configured home levels',()=>{
 const s=preset('ranged');s.brews.warrior=0;s.manual.brewMinutes={warrior:.01};s.fed=true;s.rooted=true;s.manual.fedMinutes=.01;s.manual.rootedMinutes=.01;s.manual.blessing=true;s.manual.blessingMinutes=.01;s.house.target=20;s.manual.placed={target:false};s.manual.upgradeMinutes={target:.02};
 const normalized=normalize(s);for(const key of ['brewMinutes','fedMinutes','rootedMinutes','blessingMinutes','placed','upgradeMinutes'])assert.equal(Object.hasOwn(normalized.manual,key),false,key);
 const {player:p,context}=createScenario(s);assert.ok(p.houseFurniture.target);assert.deepEqual(p.houseUpgrades,{});
 for(const kind of ['warrior','fed','rooted','blessing'])assert.equal(p.brews[kind],Number.MAX_SAFE_INTEGER);
 game.tick(p,context,START_TICK+6000,[]);assert.equal(p.house.target,20);assert.ok(game.brewScale(p,'warrior')>0);
 const baseline=structuredClone(s);baseline.manual.placed.target=true;baseline.manual.upgradeMinutes.target=-1;
 assert.equal(calculate(s).stats.hit,calculate(baseline).stats.hit);
});
test('disabled hot bonuses stay zero at every tick across a full hot cycle',()=>{
 // Exercise more than the fixed prediction hour, including combat XP/rare periods
 // and all boundary ticks. The game changes hot periods every 36000 ticks.
 const start=START_TICK,end=start+36*36000,windows=manualWindows(start,end),seen=new Set();
 for(let tick=start;tick<=end;tick++){
  const hot=game.hotSkill(tick);if(hot.skill==='combat')seen.add(hot.kind);
  let xp=0;
  let rare=0;
  for(const w of windows)if(tick>=w.fromTick&&tick<=w.toTick){xp+=w.xpMult-1;rare+=w.rarityMult-1;}
  assert.ok(Math.abs(xp)<1e-10);assert.ok(Math.abs(rare)<1e-10);
 }
 assert.ok(seen.has('xp'));assert.ok(seen.has('rarity'));
});
test('full manual scenario matches native predictor across 20 monsters without a snapshot',()=>{
 const s=preset('ranged');s.manual.playerId=54321;s.manual.seed=813;s.manual.weeklyXp=30;s.manual.guildXp=11;s.manual.blessing=true;s.manual.progress={ranged:75.1};s.manual.perks.pockets=1;s.manual.foodPerTrip=-2;s.manual.windows=[{start:0,minutes:60,xp:45,rare:25}];s.brews.haste=1;s.manual.brewMinutes={haste:20};s.manual.actualInventory=true;s.manual.bank=[{id:64,tier:0,plus:0,qty:5000}];s.manual.upgradeMinutes={target:10};
 const before=JSON.stringify(s);
 for(const monster of game.monsters){const {player,context}=createScenario(s,monster),zone=game.world.zones.find(z=>z.monsterId===monster.id),expected=nativeDay(player,context,p=>startCombat(p,context,zone.id)),actual=simulateMonster(s,monster);assert.equal(actual.xp,expected.xpPerHour,monster.name);assert.equal(actual.deaths,expected.deaths);assert.deepEqual(actual.bySkill,expected.bySkill);}
 assert.equal(JSON.stringify(s),before);
});
test('mixed equipment toggle preserves cross-style choices',()=>{
 const s=preset('ranged');s.manual.allGear=true;const helmet=s.gear.helmet.id;assert.equal(selectStyle(s,'magic').gear.helmet.id,helmet);
});

test('removed inventory and event overrides cannot affect manual simulation',()=>{
 const s=preset('ranged');Object.assign(s.manual,{actualInventory:true,bank:[{id:999,tier:4,plus:0,qty:1}],pack:[{id:64,qty:999}],overflow:[{id:64,qty:10}],unlimitedBank:false,bankSlotsBought:900,windows:[{start:0,minutes:999,xp:999,rare:999}],hotMode:2,hotMinutes:0});s.homeBank=0;
 const n=normalize(s);assert.equal(n.homeBank,0);assert.equal(n.manual.actualInventory,undefined);assert.equal(n.manual.unlimitedBank,true);assert.equal(n.manual.bankSlotsBought,0);for(const key of ['bank','pack','overflow','windows','hotMode','hotMinutes','brewMinutes','blessingMinutes','fedMinutes','rootedMinutes','placed','upgradeMinutes'])assert.equal(Object.hasOwn(n.manual,key),false,key);
 for(const monster of game.monsters)assert.deepEqual(simulateMonster(s,monster),simulateMonster(preset('ranged'),monster),monster.name);
});
test('removed snapshot inputs fail explicitly',()=>{
 assert.throws(()=>createScenario({format:'snapshot',player:{}}),/Unsupported simulation format/);
});


test('food threshold and carry choices normalize valid values and migrate old custom inputs',()=>{
 for(const eatAt of [25,50,75]){assert.equal(normalize({eatAt}).eatAt,eatAt);assert.equal(createScenario({...preset('ranged'),eatAt}).player.eatAt,eatAt/100);}
 for(const eatAt of [0,10,49,100,-1,null,'invalid'])assert.equal(normalize({eatAt}).eatAt,50);
 for(const foodPerTrip of [5,10,20,-2,-1]){const s=preset('ranged');s.manual.foodPerTrip=foodPerTrip;assert.equal(normalize(s).manual.foodPerTrip,foodPerTrip);assert.equal(createScenario(s).player.foodPerTrip,foodPerTrip);}
 for(const foodPerTrip of [0,1,7,33,-3,null,'invalid']){const s=preset('ranged');s.manual.foodPerTrip=foodPerTrip;assert.equal(normalize(s).manual.foodPerTrip,-1);}
});
test('world buff XP preserves fractional percentages and adds to guild and blessing',()=>{
 const s=preset('ranged');s.manual.weeklyXp=30;s.manual.guildXp=11;s.manual.blessing=true;
 assert.equal(normalize(s).manual.weeklyXp,30);s.manual.weeklyXp=30.8;assert.equal(normalize(s).manual.weeklyXp,30.8);s.manual.weeklyXp=30;
 const result=simulateMonster(s,game.monsters[0]);
 // Independent Gnawer XP: 8*1.46 rounds to 12; defence and HP 2*1.46 round to 3 each.
 assert.ok(result.xp>=result.kills*18&&result.xp<(result.kills+1)*18);
 const baseline=structuredClone(s);baseline.manual.weeklyXp=0;assert.ok(result.xp>simulateMonster(baseline,game.monsters[0]).xp);
});
test('weekly goal window covers the full hour without adding rare or restoring hot bonuses',()=>{
 const start=START_TICK,end=start+6000,windows=manualWindows(start,end,30);
 for(let tick=start;tick<=end;tick++){
  let xp=0,rare=0;
  for(const w of windows)if(tick>=w.fromTick&&tick<=w.toTick){xp+=w.xpMult-1;rare+=w.rarityMult-1;}
  assert.ok(Math.abs(xp-.3)<1e-10);assert.ok(Math.abs(rare)<1e-10);
 }
});
