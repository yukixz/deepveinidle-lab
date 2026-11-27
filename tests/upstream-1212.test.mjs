import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as game from '../src/upstream.js';
import {gatheringDefaults,normalizeGathering,gatheringPlayer,gatheringStats,importGathering} from '../src/gathering-model.js';
import {craftingDefaults,normalizeCrafting,craftingPlayer,craftingStats,importCrafting,craftingJobs,craftingMaterials} from '../src/crafting-model.js';
import {createScenario} from '../src/simulation.js';
import {simulateCrafting} from '../src/crafting-simulation.js';
import {enhanceableItems} from '../src/enhancement.js';
import {captureHarness,flushCapture} from './helpers/capture-harness.mjs';

const tools=[[698,84],[699,369],[572,89],[573,364],[575,94],[576,374],[711,389],[712,384],[718,327],[719,379]];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('The shared reviewed build applies live features and initializes synthetic account state',()=>{
 const manifest=JSON.parse(fs.readFileSync('vendor/manifest.json'));
 assert.equal(manifest.changelogVersion,'1.0.1228');assert.deepEqual(manifest.overrides,[]);
 assert.deepEqual(game.features,{enhanceRedesign:true,alchemy:true,profiles:true,guildIsles:false,campUncapped:true,earrings:true});
 assert.equal(game.rooms.length,19);
 for(const slot of ['flask','earring'])assert.ok(game.equipmentSlots.includes(slot));
 assert.equal(game.item(764).name,'Enhance essence');assert.equal(game.gear(988).slot,'earring');
 const {player:p,context}=createScenario({});let prepared;
 game.predict(p,context,value=>{prepared=value;return false;});
 assert.deepEqual(prepared.masterySkills,{});assert.equal(prepared.skillboss,null);
 assert.deepEqual(prepared.skillbossBurn,{});assert.deepEqual(prepared.houseTrophies,{});
 assert.deepEqual(prepared.alchemy.carry,{house:0,boss:0,enhance:0,xp:0});
});

test('1212 ten forged tools preserve rarity and enhancement and inherit Meteoric cost tiers',()=>{
 for(const [id,from]of tools){
  const job=craftingJobs.find(j=>j.upgrade?.to.includes(id));assert.ok(job);assert.equal(job.levelReq,105);
  near(game.tool(id).bonus,.65);assert.equal(job.upgrade.startsAtZero,undefined);
  for(let tier=0;tier<5;tier++){
   const base=game.encode(game.withRarity(from,tier),17),target=game.withRarity(id,tier);
   assert.equal(game.upgradeResult(job.upgrade,base),game.encode(target,17));
   assert.deepEqual(game.enhanceCost(game.encode(target,7)),game.enhanceCost(game.encode(game.withRarity(from,tier),7)));
   assert.equal(craftingMaterials(job,tier,2)[game.withRarity(from,tier)],2);
  }
 }
 for(const outfit of game.skillOutfits){assert.equal(game.canEnhance(outfit.id),false);assert.equal(game.itemSupportsRarity(outfit.id),false);assert.ok(!enhanceableItems.some(i=>i.id===outfit.id));}
});

test('1212 skilling offhands scale by rarity/enhancement and only affect the matching skill',()=>{
 for(const [create,stats]of [[gatheringDefaults,gatheringStats],[craftingDefaults,craftingStats]]){
  const s=create(),skill=s.skill,id=skill==='mining'?720:723,base=stats(s).speedBonus;
  for(const [tier,plus]of [[0,0],[4,17]]){
   s.gear.shield={id,tier,plus};
   near((1+stats(s).speedBonus)/(1+base),1+game.gear(game.encode(game.withRarity(id,tier),plus)).offhand.lift);
  }
  s.gear.shield={id:skill==='mining'?723:720,tier:4,plus:17};near(stats(s).speedBonus,base);
 }
});

test('outfit XP applies per piece, full set, and corresponding skill to panel and actual work',()=>{
 const s=craftingDefaults();s.skill='smithing';s.levels.smithing=99;s.hotSetting='off';const job=craftingJobs.find(j=>j.id===41);
 const baseline=simulateCrafting(s,job,4,10);
 for(const [slot,id]of [['helmet',741],['body',742],['legs',743]])s.gear[slot]={id,tier:0,plus:0};
 near(craftingStats(s).xpBonus,.16);near(game.workXpMultiplier(craftingPlayer(s).player,false,'smithing'),1.16);
 const actual=simulateCrafting(s,job,4,10);assert.equal(actual.xp,Math.round(6*25*1.16)*10);assert.ok(actual.xp>baseline.xp);
 s.skill='cooking';near(craftingStats(s).xpBonus,0);
 const e={helmet:741,body:null,legs:null};near(game.outfitXpBonus(e,'mining'),.04);near(game.outfitXpBonus(e,'fishing'),0);
 e.body=742;near(game.outfitXpBonus(e,'smithing'),.08);e.legs=743;near(game.outfitXpBonus(e,'smithing'),.16);
});

test('1212 new work equipment survives saves and imports while legacy builds get empty slots',()=>{
 for(const [create,normalize,player,read]of [[gatheringDefaults,normalizeGathering,gatheringPlayer,importGathering],[craftingDefaults,normalizeCrafting,craftingPlayer,importCrafting]]){
  const s=create();s.gear.shield={id:s.skill==='mining'?720:723,tier:4,plus:17};
  for(const [slot,id]of [['helmet',741],['body',742],['legs',743]])s.gear[slot]={id,tier:4,plus:17};
  const normalized=normalize(s);for(const slot of ['helmet','body','legs'])assert.deepEqual(normalized.gear[slot],{id:s.gear[slot].id,tier:0,plus:0});
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(normalized))),normalized);
  const p=player(normalized).player,snapshot={version:2,capturedAt:Date.now(),player:p};
  const imported=read(create(),snapshot).state;
  for(const slot of ['shield','helmet','body','legs'])assert.deepEqual(imported.gear[slot],normalized.gear[slot]);
  for(const slot of ['shield','helmet','body','legs'])delete s.gear[slot];
  assert.equal(normalize(s).gear.shield.id,0);
 }
});

test('1212 skilling gear, active mastery changes and legacy protocol survive character capture',async()=>{
 const h=captureHarness(),ws=new h.page.WebSocket('wss://deepveinidle.com/ws');
 const p=craftingPlayer(craftingDefaults()).player;p.equipment.shield=game.encode(game.withRarity(723,4),17);p.equipment.helmet=741;p.masteries={xp:4};
 ws.receive([{t:'welcome',you:p}],1);await flushCapture();
 const saved=h.writes.at(-1).value;assert.equal(saved.version,2);assert.equal(saved.player.equipment.shield,p.equipment.shield);assert.equal(saved.player.equipment.helmet,741);
 ws.receive([{t:'snapshot',you:{...p,lastTick:2,masteries:{xp:7},masterySkills:{cooking:2}}}],2);await flushCapture();
 assert.deepEqual(h.writes.at(-1).value.player.masteries,{xp:7});assert.deepEqual(h.writes.at(-1).value.player.masterySkills,{cooking:2});
});
