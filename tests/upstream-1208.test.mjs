import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {game,defaults,normalize} from '../src/model.js';
import {gatheringDefaults,normalizeGathering,importGathering} from '../src/gathering-model.js';
import {craftingDefaults,normalizeCrafting,importCrafting} from '../src/crafting-model.js';
import {enhancementDefaults,validateEnhancement,importEnhancement} from '../src/enhancement.js';
import {masteryDefaults,validateMastery,highestAffordableMastery,importMastery} from '../src/mastery.js';
import {importCharacter} from '../src/character-import.js';
import {captureHarness,flushCapture} from './helpers/capture-harness.mjs';

test('1208 exports live mastery and station caps rather than the legacy rank constant',()=>{
 const manifest=JSON.parse(fs.readFileSync('vendor/manifest.json'));
 assert.equal(manifest.changelogVersion,'1.0.1228');assert.deepEqual(manifest.overrides,[]);
 assert.equal(game.masteryRankLimit,200);assert.equal(game.houseLevelLimit,50);
 assert.ok(game.masteries.every(m=>m.maxRanks===200));
 for(const [create,read]of [[defaults,normalize],[gatheringDefaults,normalizeGathering],[craftingDefaults,normalizeCrafting]]){
  for(const [rank,level]of [[199,49],[200,50],[201,51],[20000,1000]]){
   const s=create();for(const id in s.masteries)s.masteries[id]=rank;for(const id in s.house)s.house[id]=level;
   const restored=read(JSON.parse(JSON.stringify(s)));
   assert.ok(Object.values(restored.masteries).every(n=>n===Math.min(rank,200)));
   assert.ok(Object.values(restored.house).every(n=>n===Math.min(level,50)));
  }
 }
 const s=masteryDefaults();s.totalPoints=Number.MAX_SAFE_INTEGER;
 for(const m of game.masteries)assert.equal(highestAffordableMastery(s,m.id),200);
 for(const n of [201,20000]){s.target.xp=n;assert.throws(()=>validateMastery(s),/invalidInteger/);}
 for(const patch of [{mastery:201},{lectern:51}])assert.throws(()=>validateEnhancement({...enhancementDefaults(),...patch}),/invalidConfiguration/);
});

test('1208 partial imports warn and retain invalid fields, strict imports reject atomically',()=>{
 const snapshot={version:2,capturedAt:Date.now(),player:{lastTick:0,house:{post:51,mine:51,forge:51,lectern:51},houseFurniture:{post:{},mine:{},forge:{},lectern:{}},masteries:{xp:201,enhance:201},skills:{enhancing:0},equipment:{},bank:{},pack:[],overflow:{},collections:{},forgeLog:{}}};
 for(const [create,read,room]of [[defaults,importCharacter,'post'],[gatheringDefaults,importGathering,'mine'],[craftingDefaults,importCrafting,'forge']]){
  const current=create();current.house[room]=7;current.masteries.xp=9;const before=structuredClone(current);
  const {state,warnings}=read(current,snapshot);
  assert.equal(state.house[room],room==='post'?0:7);assert.equal(state.masteries.xp,room==='post'?0:9);
  assert.ok(warnings.some(w=>w.includes(`house.${room}`)));assert.ok(warnings.some(w=>w.includes('masteries.xp')));
  assert.deepEqual(current,before);
 }
 const current=enhancementDefaults(),before=structuredClone(current);
 assert.throws(()=>importEnhancement(current,snapshot),/invalidSnapshot/);assert.deepEqual(current,before);
 const mastery=masteryDefaults();assert.throws(()=>importMastery(mastery,snapshot),/invalidSnapshot/);assert.deepEqual(mastery,masteryDefaults());
 const valid=structuredClone(snapshot);valid.player.masteries={};valid.player.house.lectern=50;
 assert.equal(importEnhancement(current,valid).state.lectern,50);
});

test('1208 capture retains both mastery pages while tracking active masteries',async()=>{
 const h=captureHarness(),ws=new h.page.WebSocket('wss://deepveinidle.com/ws');
 const player={lastTick:1,skills:{},equipment:{},pack:[],bank:{},overflow:{},masteries:{xp:1},masteryOther:{xp:2},masteryPage:1};
 ws.receive([{t:'welcome',you:player}],1);await flushCapture();
 assert.equal(h.writes.at(-1).value.player.masteries.xp,1);
 assert.deepEqual(h.writes.at(-1).value.player.masteryOther,{xp:2});assert.equal(h.writes.at(-1).value.player.masteryPage,1);
 // The public client swaps masteries and masteryOther when switching pages.
 ws.receive([{t:'snapshot',you:{...player,lastTick:2,masteries:{xp:2},masteryOther:{xp:1},masteryPage:2}}],2);await flushCapture();
 assert.equal(h.writes.at(-1).value.player.masteries.xp,2);
});
