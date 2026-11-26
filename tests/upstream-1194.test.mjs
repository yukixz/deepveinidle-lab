import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {defaults,normalize,masteryValue} from '../src/model.js';
import {importCharacter} from '../src/character-import.js';
import {craftingJobs} from '../src/crafting-model.js';
import {enhancementDefaults,validateEnhancement,calculateEnhancement,decodeEnhancementItem,importEnhancement} from '../src/enhancement.js';
import {masteryDefaults,importMastery} from '../src/mastery.js';

test('1194 separates the +20 task cap from existing +100 item encoding',()=>{
 assert.equal(game.enhancementTargetLimit,20);assert.equal(game.maxEnhancement,100);
 for(const current of [21,50,100]){
  const id=game.encode(game.withRarity(110,4),current);
  assert.equal(decodeEnhancementItem(id).current,current);
  const state={...enhancementDefaults(),current,target:current};
  assert.equal(calculateEnhancement(state).totals.attempts,0);
  assert.equal(validateEnhancement(JSON.parse(JSON.stringify(state))).current,current);
  assert.equal(normalize({...defaults(),gear:{weapon:{id:110,tier:4,plus:current}}}).gear.weapon.plus,20);
  const snapshot={version:2,capturedAt:Date.now(),player:{lastTick:0,skills:{enhancing:0},house:{},houseFurniture:{},masteries:{enhance:200},equipment:{weapon:id},bank:{},pack:[],overflow:{}}};
  assert.equal(importEnhancement(state,snapshot).state.current,current);
  const combat=importCharacter(defaults(),snapshot);assert.equal(combat.state.gear.weapon.id,0);assert.ok(combat.warnings.includes('equipment: equipment.weapon'));
 }
 for(const [current,target]of [[0,21],[20,21],[21,22],[50,100]])assert.throws(()=>calculateEnhancement({...enhancementDefaults(),current,target}),/targetAboveLimit/);
 const legacy={...enhancementDefaults(),target:100};assert.equal(validateEnhancement(legacy,{allowUnsupportedTarget:true}).target,100);
 assert.throws(()=>calculateEnhancement(legacy),/targetAboveLimit/);
 assert.ok(calculateEnhancement({...enhancementDefaults(),target:20}).totals.attempts>0);
});

test('1194 enhancement mastery keeps rank costs while capping both probability and displayed bonus',()=>{
 const player={skills:{enhancing:0},house:{},houseFurniture:{},masteries:{enhance:0},brews:{},lastTick:0};
 for(const rank of [0,1,199,200,201,20000]){
  player.masteries.enhance=rank;
  const bonus=Math.min(.5,rank*.0025);
  assert.ok(Math.abs(game.enhanceChance(player,19)-.2*(1+bonus))<1e-12);
  assert.equal(masteryValue('enhance',rank),Number((bonus*100).toFixed(6)));
 }
 assert.ok(game.masteryTotalCost(201)>game.masteryTotalCost(200));
});

test('1194 forge points stop at +15, retain higher bits and reach 15,662 at full completion',()=>{
 const points=forgeLog=>game.masteryEarnedPoints({collections:{},forgeLog});
 assert.equal(points({29:2**15-1}),5336);
 assert.equal(points({29:2**30-1}),5336);
 assert.equal(points({29:2**15}),0);
 assert.equal(points(Object.fromEntries(Array.from({length:30},(_,i)=>[i,2**30-1]))),15662);
 const snapshot={version:2,capturedAt:Date.now(),player:{collections:{64:1},forgeLog:{29:2**30-1},masteries:{enhance:1}}};
 const imported=importMastery(masteryDefaults(),snapshot).state;
 assert.equal(imported.totalPoints,5337);assert.equal(imported.budget,5297);assert.equal(snapshot.player.forgeLog[29],2**30-1);
 snapshot.player.masteries.enhance=200;assert.throws(()=>importMastery(imported,snapshot),/invalidSnapshot/);
});

test('1194 candidates use effective upstream lists and exclude unreleased food and recipes',()=>{
 for(let id=69;id<=85;id++)assert.ok(!craftingJobs.some(j=>j.id===id));
 for(const id of [45,53,54,55,71,77,78]){
  assert.ok(!game.items.some(i=>i.id===id));
 }
});
