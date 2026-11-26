import {createCraftingScenario} from '../src/crafting-simulation.js';
import {simulationTick} from '../src/simulation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {game,defaults,normalize,makePlayer,calculate,slots} from '../src/model.js';
import {importCharacter} from '../src/character-import.js';
import {craftingDefaults,craftingJobs,craftingMaterials} from '../src/crafting-model.js';
import {createScenario} from '../src/simulation.js';

test('1205 amulet retains every quality and enhancement without total level warnings',()=>{
 assert.equal(game.equipment.find(g=>g.itemId===357).totalLevel,750);
 for(let tier=0;tier<5;tier++)for(const plus of [0,17,20])for(const level of [1,241]){
  const s=defaults();s.gear.amulet={id:357,tier,plus};for(const k of Object.keys(s.levels))s.levels[k]=level;
  const restored=normalize(JSON.parse(JSON.stringify(s))),r=calculate(restored),id=game.encode(game.withRarity(357,tier),plus);
  assert.equal(r.player.equipment.amulet,id);
  assert.deepEqual(r.issues.filter(i=>i.slot==='amulet'),[]);
  assert.equal(createScenario(restored,game.monsters[0]).player.equipment.amulet,id);
  assert.equal(r.stats.evasion,game.evasion(r.player));
 }
 const s=defaults();s.gear.amulet.id=186;assert.deepEqual(makePlayer(s).issues.filter(i=>i.slot==='amulet'),[]);
});

test('1205 imported worn amulet is retained without claiming total level eligibility',()=>{
 const snapshot={version:2,worldBuffsVersion:1,capturedAt:Date.now(),player:{lastTick:100,skills:{melee:0,ranged:0,magic:0,defence:0,hitpoints:game.levelXp(10),mining:game.levelXp(99)},equipment:Object.fromEntries(slots.map(k=>[k,k==='amulet'?game.encode(game.withRarity(357,4),17):null]))}};
 const imported=importCharacter(defaults(),snapshot).state;
 assert.deepEqual(imported.gear.amulet,{id:357,tier:4,plus:17});
 assert.deepEqual(makePlayer(imported).issues.filter(i=>i.slot==='amulet'),[]);
});

test('1205 upgrade capacity accepts last slot and rejects net growth beyond capacity atomically',()=>{
 const s=craftingDefaults();s.levels.fletching=99;const job=craftingJobs.find(j=>j.upgrade?.id===264),from=145,to=629;
 const player=filled=>{const p=createCraftingScenario(s,job,0,2).player;p.unlimitedBank=false;p.bank=craftingMaterials(job,0,2);for(let id=1;Object.keys(p.bank).length<filled;id++)if(!Object.hasOwn(p.bank,id)&&id!==to)p.bank[id]=1;return p;};
 const run=(p,count)=>{
  const context=game.createContext(game.world,0);
  assert.ok(game.startUpgrade(p,context,job.upgrade.id,from,count));
  for(let tick=p.lastTick+1,end=tick+6000;tick<end&&p.route;tick++)simulationTick(p,context,tick,[]);
  assert.equal(p.route,null);
 };
 const full=player(75),before=structuredClone(full.bank);run(full,1);assert.deepEqual(full.bank,before);
 const free=player(74);free.bank[280]=1;run(free,1);assert.equal(free.bank[to],1);
 const last=player(74);run(last,2);assert.equal(last.bank[to],2);assert.equal(last.bank[from],undefined);
});
