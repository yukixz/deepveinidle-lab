import {questlessTick} from '../scripts/native-questless.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {preset,defaults} from '../src/model.js';
import * as game from '../src/upstream.js';
import {createScenario,simulateMonster,START_TICK} from '../src/simulation.js';
import {rarityProbabilities,expectedGold,createCombatExpectation} from '../src/combat-expectation.js';
import {valueCombatRewards} from '../src/item-prices.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const result=()=>({coins:0,normalItems:{},rareItems:{}});

test('gold expectation rounds each outcome and preserves uint32 modulo weights',()=>{
 assert.equal(expectedGold({gold:[1,2]},1.25),1.5);
 assert.equal(expectedGold({gold:[1,2]},1.75),2);
 assert.equal(expectedGold({gold:[2,4]},1),(2*1431655766+3*1431655765+4*1431655765)/2**32);
});

test('quality probabilities are exclusive and clamp large bonuses',()=>{
 const p=rarityProbabilities(1);
 close(p[0],.975);close(p[1],1/40-1/400);close(p[2],1/400-1/8000);
 close(p[3],1/8000-1/150000);close(p[4],1/150000);
 assert.deepEqual(rarityProbabilities(0),[1,0,0,0,0]);
 assert.deepEqual(rarityProbabilities(150000),[0,0,0,0,1]);
 for(const scale of [1,40,400,8000,150000,1e12]){
  const probabilities=rarityProbabilities(scale);
  close(probabilities.reduce((sum,x)=>sum+x,0),1);assert.ok(probabilities.every(x=>x>=0));
 }
});

test('neutral kill rewards include all qualities, bonus, pet and shard quantities',()=>{
 const state=defaults();state.manual.hotSetting='off';
 const monster=game.monsters[0],{player,context}=createScenario(state,monster),r=result();
 createCombatExpectation(monster).kill(r,player,context,START_TICK+1);
 assert.equal(r.coins,1.5);
 close(Object.values(r.normalItems).reduce((s,x)=>s+x,0),1);
 close(r.rareItems[201],.0004);close(r.rareItems[280],1/500000);close(r.rareItems[208],.0826);
 const high=game.monsters.find(m=>m.id===7),r2=result();
 createCombatExpectation(high).kill(r2,player,context,START_TICK+1);
 close(Object.values(r2.normalItems).reduce((s,x)=>s+x,0),.5);
 close(r2.rareItems[208],.2*4);
});

test('kill expectations use event-time rarity windows, shrine changes both normal quality and bonus',()=>{
 const state=defaults();state.manual.hotSetting='off';
 const shrine=game.rooms.find(r=>r.bonus.kind==='rareChance');state.house[shrine.id]=20;
 const monster=game.monsters[0],{player,context}=createScenario(state,monster),engine=createCombatExpectation(monster);
 const before=result(),during=result(),after=result();
 context.windows.push({fromTick:START_TICK+10,toTick:START_TICK+20,rarityMult:1.25});
 engine.kill(before,player,context,START_TICK+9);engine.kill(during,player,context,START_TICK+10);engine.kill(after,player,context,START_TICK+21);
 close(before.normalItems[4240],1.1/150000);close(during.normalItems[4240],1.35/150000);
 close(before.rareItems[201],.00044);close(during.rareItems[201],.00054);
 assert.deepEqual(after,before);
 close(during.rareItems[280],before.rareItems[280]);close(during.rareItems[208],before.rareItems[208]);
 player.brews.hunter=Number.MAX_SAFE_INTEGER;player.brewTier.hunter=4;
 const hunter=result();engine.kill(hunter,player,context,START_TICK+9);close(hunter.rareItems[201],.0004*1.85);
});

test('mount expectations use all attempts, base interval, luck qualities and ironman',()=>{
 const state=preset('ranged');state.brews.haste=4;
 const monster=game.monsters[0],{player}=createScenario(state,monster),engine=createCombatExpectation(monster),r=result();
 engine.attack(r,player);
 close(Object.values(r.rareItems).reduce((s,x)=>s+x,0),game.baseAttackTicks(player)/300000);
 assert.notEqual(game.baseAttackTicks(player),game.attackTicks(player));
 const luck=game.equipmentLuck(player.equipment);
 close(r.rareItems[4328],game.baseAttackTicks(player)/300000*(1+luck)/500);
 player.ironman=true;const iron=result();engine.attack(iron,player);assert.deepEqual(iron.rareItems,{});
});

test('simulation retains the original trajectory, counts misses, and values expected rewards',()=>{
 for(const seed of [0,1]){
  const state=preset('ranged');state.manual.simulationHours=1;state.manual.hotSetting='off';state.brews.abyssal=0;
  const monster=game.monsters.find(m=>m.id===7),actual=simulateMonster(state,monster,{seed});
  const {player,context,durationTicks}=createScenario(state,monster,{seed});let p;
  game.predict(player,context,prepared=>{p=prepared;return false;});p.offlineCapTicks=durationTicks*2;
  game.startFight(p,context,game.world.zones.find(z=>z.monsterId===monster.id).id);
  const initial={...p.skills},counts={kills:0,attacks:0,misses:0,moving:0,food:0},foods={};
  for(let tick=1;tick<=durationTicks;tick++){
   if(p.activity==='walking')counts.moving++;
   const events=[];questlessTick(game,p,context,START_TICK+tick,events);
   for(const e of events){
    if(e.kind==='killed')counts.kills++;
    if(e.kind==='hit'&&e.by==='player'){counts.attacks++;if(e.damage===0)counts.misses++;}
    if(e.kind==='ate'){counts.food++;foods[e.itemId]=(foods[e.itemId]??0)+1;}
   }
   if(tick%game.predictionChunkTicks===0&&(p.hp<=0||p.route===null))break;
  }
  assert.equal(actual.kills,counts.kills);assert.equal(actual.attacks,counts.attacks);assert.ok(counts.misses>0);
  assert.equal(actual.movingTicks,counts.moving);assert.equal(actual.food,counts.food);assert.deepEqual(actual.foodItems,foods);
  assert.deepEqual(actual.bySkill,Object.fromEntries(Object.entries(initial).filter(([k,v])=>p.skills[k]!==v).map(([k,v])=>[k,p.skills[k]-v])));
  close(actual.coins,actual.kills*expectedGold(monster,1.25));close(actual.normal,actual.kills*.5);
  const prices=Object.fromEntries([...Object.keys(actual.normalItems),...Object.keys(actual.rareItems),...Object.keys(actual.foodItems),...Object.keys(actual.potionItems)].map(id=>[id,{price:2}]));
  const valued=valueCombatRewards(actual,prices);
  const tradableRare=Object.entries(actual.rareItems).filter(([id])=>!game.isPet(Number(id))).reduce((sum,[,qty])=>sum+qty,0);
  close(valued.totalIncome,actual.coins+2*(actual.normal+tradableRare));
  close(valued.profit,valued.totalIncome-2*actual.food-2*Object.values(actual.potionItems).reduce((s,x)=>s+x,0));
 }
});
