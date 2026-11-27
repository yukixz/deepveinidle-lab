import test from 'node:test';
import assert from 'node:assert/strict';
import {game,defaults,preset,calculate,normalize,gearForStyle,masteryValue,masteryRank} from '../src/model.js';
import {createScenario,simulateMonster} from '../src/simulation.js';
import {importCharacter} from '../src/character-import.js';
import {validItemId,itemFamily,valueCombatRewards} from '../src/item-prices.js';
import {translatedItemName} from '../src/i18n.js';
import {enhanceableItems} from '../src/enhancement.js';

const newGear=[
 [629,'ranged','weapon',95,59,53,0], [630,'ranged','weapon',95,69,65,0],
 [631,'magic','weapon',95,81,73,0], [632,'magic','helmet',99,25,0,10],
 [633,'magic','body',99,42,0,19], [634,'magic','legs',99,32,0,15],
 [635,'magic','shield',99,28,23,0],
];

test('new combat gear supports all qualities, enhancement, prices, translation and storage',()=>{
 for(const[id,style,slot,level,accuracy,strength,defence]of newGear){
  assert.deepEqual([game.gear(id).levelReq,game.gear(id).accuracy,game.gear(id).strength,game.gear(id).defence],[level,accuracy,strength,defence]);
  assert.ok(gearForStyle(slot,style).some(g=>g.itemId===id));
  assert.notEqual(translatedItemName(id,'zh'),translatedItemName(id,'en'));
  assert.equal(itemFamily(id),slot==='weapon'?'weapons':'armour');
  for(let tier=0;tier<5;tier++){
   const encoded=game.encode(game.withRarity(id,tier),17);
   assert.ok(validItemId(encoded));assert.equal(game.gear(encoded).slot,slot);
   const s=defaults();s.gear[slot]={id,tier,plus:17};
   assert.deepEqual(normalize(JSON.parse(JSON.stringify(s))).gear[slot],s.gear[slot]);
  }
 }
 assert.ok([853,904,980].every(id=>enhanceableItems.some(item=>item.id===id)));
 assert.ok(newGear.every(([id])=>enhanceableItems.some(i=>i.id===id)));
});

test('new equipment imports quality and enhancement without warnings, preserving mastery ranks',()=>{
 for(const[id,style,slot]of newGear){
  const s=preset(style);for(const k of Object.keys(s.levels))s.levels[k]=99;
  const p=createScenario(s).player;p.equipment[slot]=game.encode(game.withRarity(id,4),17);p.masteries.accuracy=13;
  const imported=importCharacter(s,{version:2,capturedAt:Date.now(),player:p});
  assert.deepEqual(imported.state.gear[slot],{id,tier:4,plus:17});
  assert.ok(!imported.warnings.some(w=>w.includes('equipment.')));
  assert.equal(imported.state.masteries.accuracy,13);
  assert.equal(masteryValue('accuracy',13),13);assert.equal(masteryRank('accuracy',13),13);
 }
});

test('weapon piercing affects enemy defence before the fixed 10, including enhanced new longbow',()=>{
 for(const[id,style,scale]of[[114,'melee',1],[394,'melee',.75],[145,'ranged',1],[151,'ranged',.9],[157,'magic',.5],[630,'ranged',.9]]){
  const s=defaults();s.style=style;s.levels[style]=99;s.gear.weapon={id,tier:4,plus:17};
  const r=calculate(s),enemy=r.rows.find(m=>m.name==='Ice wight');
  assert.equal(game.armourMultiplier(r.player),scale);
  assert.equal(enemy.chance,r.stats.accuracy/(r.stats.accuracy+10+106*scale));
 }
});

test('updated attributes use native integers and preserve rarity then enhancement rounding',()=>{
 assert.deepEqual([game.gear(157).accuracy,game.gear(157).strength],[70,63]);
 assert.deepEqual([game.gear(349).accuracy,game.gear(349).strength],[23,18]);
 assert.deepEqual([115,116,117,118,119,351].map(id=>game.gear(id).defence),[6,13,22,35,52,64]);
 // Rare accuracy round(70*1.6)=112, then +5 gives round(112*1.30)=146.
 assert.equal(game.gear(game.encode(game.withRarity(157,2),5)).accuracy,146);
 for(const id of [114,394]){
  const s=defaults();s.gear.weapon.id=id;s.levels.melee=74;assert.ok(calculate(s).issues.some(i=>i.kind==='level'));
  s.levels.melee=75;assert.ok(!calculate(s).issues.some(i=>i.kind==='level'));
 }
 const s=defaults();s.masteries.accuracy=10;
 assert.equal(calculate(s).stats.accuracy,12); // round(11*1.10)
});

test('warehouse meals leave the full selected trip load and all consumed food is charged',()=>{
 const s=preset('ranged'),{player:p}=createScenario(s);Object.assign(p,{hp:12,brews:{},bank:{64:100},pack:[],foodItemId:64,foodPerTrip:5,eatAt:.5,route:{zoneId:1}});p.perks.meals=0;
 const events=[];game.restock(p,game.world,events);
 assert.equal(p.hp,84);assert.equal(p.bank[64],89);assert.equal(p.pack.reduce((n,i)=>n+i.qty,0),5);
 assert.equal(events.filter(e=>e.kind==='ate').length,6);
 s.manual.simulationHours=1;s.manual.hotSetting='off';s.manual.foodPerTrip=5;
 const monster=game.monsters.find(m=>m.name==='Ice wight'),result=simulateMonster(s,monster,{seed:314});
 const valued=valueCombatRewards(result,{64:{price:7}});
 assert.ok(result.food>0);assert.equal(valued.foodCost,result.food*7);
});

test('dungeon equipment applies tier caps, set damage and relic progress across storage and import',async()=>{
 const combat=await import('../src/upstream.js');
 const state=preset('melee');
 state.levels.melee=99;
 state.gear.weapon={id:884,tier:4,plus:50};
 state.gear.helmet={id:881,tier:4,plus:45};
 state.gear.amulet={id:904,tier:4,plus:31};
 state.gear.earring={id:980,tier:4,plus:34};
 state.gear.body={id:919,tier:4,plus:20,relics:2200};
 const saved=normalize(JSON.parse(JSON.stringify(state)));
 assert.deepEqual(['weapon','helmet','earring'].map(slot=>saved.gear[slot].plus),[40,40,25]);
 assert.equal(saved.gear.amulet.plus,25);
 assert.equal(saved.gear.body.relics,2200);
 const {player,stats}=calculate(saved);
 assert.equal(combat.itemRelics(player.equipment.body),2200);
 const withoutRelics=calculate({...saved,gear:{...saved.gear,body:{...saved.gear.body,relics:0}}});
 assert.ok(stats.armour>withoutRelics.stats.armour);
 // Helmet has no strength. Replacing it with an empty slot isolates the tier-three set bonus.
 const withoutSet=calculate({...saved,gear:{...saved.gear,helmet:{id:0,tier:0,plus:0}}});
 assert.equal(stats.hit,Math.ceil(withoutSet.stats.hit*1.095));
 const scenario=createScenario(saved,combat.monsters[0]);
 assert.deepEqual(scenario.player.equipment,player.equipment);
 const imported=importCharacter(defaults(),{version:2,capturedAt:Date.now(),player:scenario.player});
 assert.deepEqual(imported.state.gear,saved.gear);
 assert.ok(!imported.warnings.some(w=>w.startsWith('equipment:')));
});

test('weapon damage floor uses base ticks without changing the planned mean',async()=>{
 const {rollPlayerDamage}=await import('../src/upstream.js');
 for(const [speed,floor]of [[2,20],[3,20],[4,26],[5,33],[6,40],[7,40]]){
  assert.equal(rollPlayerDamage(0,100,speed),floor);
  assert.equal(rollPlayerDamage(1-Number.EPSILON,100,speed),100);
  const samples=10000;
  let total=0;
  for(let i=0;i<samples;i++)total+=rollPlayerDamage((i+.5)/samples,100,speed);
  assert.ok(Math.abs(total/samples-50.5)<.01);
 }
});

test('saved and imported zero-relic gear restores its base item and variants',()=>{
 const old={...defaults(),gear:{...defaults().gear,weapon:{id:921,tier:2,plus:10,relics:0}}};
 assert.deepEqual(normalize(old).gear.weapon,{id:350,tier:2,plus:10});
 const {player}=createScenario(defaults());
 player.equipment.weapon=game.encode(game.withRarity(921,2),10);
 const imported=importCharacter(defaults(),{version:2,capturedAt:Date.now(),player});
 assert.deepEqual(imported.state.gear.weapon,{id:350,tier:2,plus:10});
 assert.ok(!imported.warnings.some(w=>w.startsWith('equipment:')));
});
