import test from 'node:test';
import assert from 'node:assert/strict';
import {game,preset as presetBuild,calculate} from '../src/model.js';
import {simulateMonster} from '../src/simulation.js';
import {combatPotions,combatRooms,combatMasteries,combatPerks} from '../src/combat-options.js';
import {manualControls} from '../src/manual-controls.js';
// Keep non-forecast regression scenarios deterministic and independent of wall time.
const preset=style=>{const s=presetBuild(style);s.manual.hotSetting='off';s.manual.simulationHours=24;return s;};


test('removed settings do not alter combat across three styles and every monster',()=>{
 const changes=[['gatherer',s=>{s.brews.gatherer=4;s.manual.brewMinutes={gatherer:10};}],['coins',s=>{s.manual.coins=1e12;}],...['hands','quick'].map(k=>[k,s=>{s.manual.perks[k]=10;}]),...game.masteries.filter(m=>!combatMasteries.includes(m)).map(m=>[m.id,s=>{s.masteries[m.id]=game.masteryRankLimit;}]),...game.rooms.filter(r=>!combatRooms.includes(r)).map(r=>[r.id,s=>{s.house[r.id]=100;s.manual.upgradeMinutes={[r.id]:1};}]),['storeroom placement',s=>{s.manual.placed={storeroom:false};}]];
 for(const style of ['melee','ranged','magic']){
  const base=preset(style);base.manual.unlimitedBank=false;base.house.storeroom=20;
  const stats=calculate(base).stats,results=game.monsters.map(m=>simulateMonster(base,m));
  for(const [key,change]of changes){const s=structuredClone(base);change(s);assert.deepEqual(calculate(s).stats,stats,`${style}: ${key} stats`);for(const [i,m]of game.monsters.entries())assert.deepEqual(simulateMonster(s,m),results[i],`${style}: ${key}: ${m.name}`);}
 }
});
test('settings lists expose combat options and omit ineffective manual controls in both languages',()=>{
 assert.equal(combatPotions.length,7);assert.equal(combatRooms.length,7);assert.equal(combatMasteries.length,6);assert.deepEqual(combatPerks.map(p=>p.id),['pockets','meals','rest']);
 for(const language of ['zh','en']){
  const controls=manualControls(preset('ranged'),{language,number:path=>`data-path="${path}"`,options:()=>'',esc:String,name:String,tiers:()=>''});
  const html=controls.food+controls.other+controls.simulation;
  assert.ok(!controls.other.includes('data-path="manual.hotSetting"'));
  assert.ok(controls.simulation.includes('data-path="manual.hotSetting"'));
  assert.ok(!controls.simulation.includes('data-simulation-mode'));
  assert.equal((controls.simulation.match(/data-simulation-hours/g)??[]).length,1);
  assert.match(controls.simulation,/min="1" max="\d+" step="1" value="24"/);
  assert.ok(controls.simulation.includes(language==='zh'?'模拟时间（小时）':'Simulation time (hours)'));
  assert.ok(!controls.simulation.includes(language==='zh'?'自定义时长':'Custom duration'));
  assert.ok(controls.simulation.includes('data-path="manual.simulationHours"'));
  const custom=preset('ranged');custom.manual.customSimulation=true;
  assert.ok(manualControls(custom,{language,number:path=>`data-path="${path}"`,options:()=>'',esc:String,name:String}).simulation.includes('data-path="manual.simulationHours"'));
  for(const path of ['actualInventory','unlimitedBank','bankSlotsBought','hotMode','hotMinutes','playerId','seed','currentTick','coins','perks.hands','perks.quick','brewMinutes.gatherer','placed.storeroom','placed.mine','upgradeMinutes.mine','upgradeMinutes.storeroom','xp.ranged','progress.ranged','brewMinutes.warrior','fedMinutes','rootedMinutes','blessingMinutes'])assert.ok(!html.includes(`data-path="manual.${path}"`),path);
  for(const path of ['ironman','perks.rest','perks.pockets'])assert.ok(html.includes(`data-path="manual.${path}"`),path);
 }
});
