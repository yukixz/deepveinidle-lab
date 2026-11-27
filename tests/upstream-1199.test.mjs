import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
import {createHash} from'node:crypto';
import * as game from'../src/upstream.js';
import {enhancementDefaults,enhanceableItems,validateEnhancement,enhancementSteps,calculateEnhancement,importEnhancement} from'../src/enhancement.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('Current reviewed full snapshot retains lectern and client boss definitions',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../vendor/manifest.json',import.meta.url)));
 assert.equal(m.changelogVersion,'1.0.1228');
 const digest=createHash('sha256').update(fs.readFileSync(new URL('../vendor/game-original.js',import.meta.url))).digest('hex');
 assert.equal(digest,'c600e5c33615ceb8c6c7f179e6e368b935ec09b36ca60d4c1815b3690f96343b');
 assert.equal(m.sha256,digest);assert.deepEqual(m.overrides,[]);
 assert.notEqual(game.rooms.find(r=>r.id==='lectern').retired,true);
 assert.deepEqual(game.bosses.map(b=>b.exclusive.chance),[1/500,1/500,1/500]);
});
test('1199 restored base floor and placed lectern multiplier match independent vectors',()=>{
 for(const [level,mastery,lectern]of [[1,0,0],[42,9,7],[99,200,25]]){
  const steps=enhancementSteps({...enhancementDefaults(),level,mastery,lectern,target:20});
  for(const k of [0,12,13,14,19])near(steps[k].chance,Math.min(1,Math.max(.2,1-.06*k)*(1+.01*lectern)*(1+.002*(level-1))*(1+Math.min(.5,.0025*mastery))));
 }
 assert.equal(enhancementSteps({...enhancementDefaults(),target:20})[19].chance,.2);
});
test('Enhancement rarity affects XP and keeps shard cost uniform below +20',()=>{
 for(const item of enhanceableItems)for(const [tier,mult]of [1,1.5,3,8,25].entries()){
  const state={...enhancementDefaults(),itemId:item.id,tier,target:4};
  for(const step of enhancementSteps(state)){
   assert.equal(step.shards,3*(step.from+1));
   assert.equal(step.xp,Math.round(20*(2*step.from+1)*mult));
  }
  const result=calculateEnhancement(state);near(result.totals.seconds,result.totals.attempts*2.4);
 }
 assert.equal(game.enhanceTicks*game.tickMs,2400);assert.equal(game.skillPetChance('enhancing'),1/3e6);assert.equal(game.skillPetChance('mining'),1/3e6);
});
test('1199 missing lectern in 1198 saves defaults to zero without replacing explicit invalid values',()=>{
 const legacy={...enhancementDefaults(),mastery:200,target:20,shardPrice:123};delete legacy.lectern;
 assert.deepEqual(validateEnhancement(legacy),{...legacy,lectern:0});
 assert.equal(validateEnhancement({...legacy,lectern:7}).lectern,7);
 for(const lectern of [null,undefined,-1,1.5,'7'])assert.throws(()=>validateEnhancement({...legacy,lectern}),/invalidConfiguration/);
 const normalized=validateEnhancement(legacy);assert.deepEqual(validateEnhancement(JSON.parse(JSON.stringify(normalized))),normalized);
});
test('1199 role import restores placed lectern and still rejects incomplete snapshots atomically',()=>{
 const current=enhancementDefaults(),snapshot={version:2,capturedAt:Date.now(),player:{skills:{enhancing:game.levelXp(42)},masteries:{enhance:200},house:{lectern:7},houseFurniture:{lectern:{cell:0,slot:0}},equipment:{},bank:{},pack:[],overflow:{}}};
 const state=importEnhancement(current,snapshot).state;assert.equal(state.lectern,7);assert.equal(state.level,42);assert.equal(state.mastery,200);
 assert.equal(importEnhancement(current,{...snapshot,player:{...snapshot.player,houseFurniture:{}}}).state.lectern,0);
 for(const key of ['house','houseFurniture']){const player={...snapshot.player};delete player[key];assert.throws(()=>importEnhancement(current,{...snapshot,player}),/incompleteSnapshot/);}
 assert.deepEqual(current,enhancementDefaults());
});
