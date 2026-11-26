import test from 'node:test';
import assert from 'node:assert/strict';
import {game,defaults} from '../src/model.js';
import {createScenario,START_TICK} from '../src/simulation.js';
import {createCombatExpectation} from '../src/combat-expectation.js';
import {masteryResultEngine,validateComputedMasteryResult} from '../src/mastery-result-store.js';
const result=()=>({coins:0,normalItems:{},rareItems:{}});

test('1214 synthetic prediction retains empty boss rewards and mastery pages',()=>{
 const {player,context}=createScenario({});let prepared;
 game.predict(player,context,p=>{prepared=p;return false;});
 assert.deepEqual(prepared.skillbossPending,[]);assert.deepEqual(prepared.masteryAway,{});
 assert.equal(prepared.skillboss,null);assert.deepEqual(prepared.masterySkills,{});
 assert.equal(masteryResultEngine,'mastery-1/game-1.0.1221/combat-1.0.1225');
 assert.throws(()=>validateComputedMasteryResult({engine:'mastery-1/game-1.0.1212'}),/savedMasteryVersion/);
});

test('1214 all upgrades preserve full quality and enhancement encoding',()=>{
 for(const upgrade of game.upgradeRecipes)for(const from of upgrade.from)for(let tier=0;tier<5;tier++)for(const plus of [0,17,100]){
  const target=upgrade.to[upgrade.from.indexOf(from)];
  assert.equal(game.upgradeResult(upgrade,game.encode(game.withRarity(from,tier),plus)),game.encode(game.withRarity(target,tier),plus));
 }
});

test('1214 shrine and other rare bonuses add before luck, with token probability capped',()=>{
 const state=defaults();state.manual.hotSetting='off';state.house.shrine=50;
 state.gear.amulet={id:357,tier:4,plus:17};state.brews.hunter=4;
 const base=game.monsters[0],monster={...base,bonus:{...base.bonus,chance:.5}};
 const {player,context}=createScenario(state,monster);
 context.windows.push({fromTick:START_TICK,toTick:START_TICK+10,rarityMult:2});
 const r=result();createCombatExpectation(monster).kill(r,player,context,START_TICK+1);
 const multiplier=(1+game.equipmentLuck(player.equipment))*(game.combatRarityMultiplier(player,context,START_TICK+1)+game.houseRarityMultiplier(player)-1);
 assert.ok(multiplier>2);assert.equal(r.rareItems[monster.bonus.itemId],1);
 const low={...monster,bonus:{...monster.bonus,chance:.0004}},small=result();
 createCombatExpectation(low).kill(small,player,context,START_TICK+1);
 assert.ok(Math.abs(small.rareItems[low.bonus.itemId]-.0004*multiplier)<1e-12);
});
