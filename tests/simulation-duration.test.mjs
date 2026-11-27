import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,preset,normalize} from '../src/model.js';
import * as game from '../src/upstream.js';
import {simulateMonster,createScenario,START_TICK,HOUR_TICKS} from '../src/simulation.js';
import {combatHot,combatHotWindows,rewardAmount,simulationTicks} from '../src/combat-hot.js';
import {tickTime} from '../src/hot-forecast.js';
import {nativeDay} from './native-day.mjs';
import {normalizeGathering} from '../src/gathering-model.js';
import {MAX_SIMULATION_MINUTES} from '../src/manual-settings.js';
const now=Date.UTC(2026,9,6,14,44);
test('duration defaults to 24 hours and saved durations normalize predictably',()=>{
 assert.equal(defaults().manual.simulationHours,24);
 assert.equal(normalize({manual:{hotForecast:false}}).manual.simulationHours,24);
 for(const hours of [1,6,24,48])assert.equal(normalize({manual:{simulationHours:hours}}).manual.simulationHours,hours);
 for(const value of ['invalid',NaN,Infinity])assert.equal(normalize({manual:{simulationHours:value}}).manual.simulationHours,24);
 assert.equal(normalize({manual:{simulationHours:0}}).manual.simulationHours,1);
 assert.equal(normalize({manual:{simulationHours:25}}).manual.simulationHours,25);
 assert.equal(normalize({manual:{simulationHours:6.7}}).manual.simulationHours,7);
 for(const [value,expected] of [[.5,1],[1.5,2],[-1,1],[1e12,Math.floor(MAX_SIMULATION_MINUTES/60)]]){
  const saved=normalize({manual:{simulationHours:value,customSimulation:true}});
  assert.equal(saved.manual.simulationHours,expected);
  assert.equal(normalize(JSON.parse(JSON.stringify(saved))).manual.simulationHours,expected);
 }
 for(const [hours,expected] of [[.5,1],[1,1],[1.5,2],[6.7,7],[24,24],[0,1]])assert.equal(normalizeGathering({simulationHours:hours}).simulationHours,expected);
 for(const hours of [0,-1,1/120,NaN])assert.throws(()=>simulationTicks(hours),/invalidDuration/);
});
test('one, six and 24 hour trials match independent upstream offline reports',()=>{
 const s=preset('ranged'),m=game.monsters.find(m=>m.name==='Gnawer'),zone=game.world.zones.find(z=>z.monsterId===m.id);
 s.manual.weeklyXp=20;s.manual.hotSetting='current';
 for(const hours of [.5,1,1.5,6,24,48]){
  s.manual.simulationHours=hours;
  const expectedHours=normalize(s).manual.simulationHours;
  const {player,context,durationTicks}=createScenario(s,m,{now});
  const expected=nativeDay(player,context,p=>game.startFight(p,context,zone.id),durationTicks);
  const actual=simulateMonster(s,m,{now});
  assert.equal(actual.durationTicks,expectedHours*HOUR_TICKS);assert.equal(actual.elapsedTicks,durationTicks);
  assert.equal(actual.xp,expected.xpPerHour);assert.deepEqual(actual.bySkill,expected.bySkill);
  assert.equal(actual.deaths,expected.deaths);
  assert.ok(Math.abs(actual.normal-actual.kills*(m.dropChance??1))<1e-7);
 }
 // At the default hour, original predictor and adapter also agree without extrapolation.
 s.manual.simulationHours=1;
 const {player,context}=createScenario(s,m,{now});
 const expected=game.predict(player,context,p=>game.startFight(p,context,zone.id));
 assert.equal(simulateMonster(s,m,{now}).xp,expected.xpPerHour);
});
test('hot schedules clip to the selected duration including an active period',()=>{
 const start=combatHot(now,24).entries[0].from+17;
 for(const hours of [.5,1,1.5,6,24,48]){
  const schedule=combatHot(tickTime(start),hours);
  assert.equal(schedule.end-schedule.start,simulationTicks(hours));
  assert.equal(schedule.entries[0].from,start);
  for(const entry of schedule.entries)assert.ok(entry.from>=start&&entry.until<=schedule.end);
  const windows=combatHotWindows(schedule);
  assert.ok(windows.every(w=>w.fromTick>=START_TICK&&w.toTick<=START_TICK+simulationTicks(hours)));
 }
 const s=preset('ranged');s.manual.simulationHours=1;s.manual.hotSetting='off';
 const {context,durationTicks}=createScenario(s,game.monsters[0],{now});
 assert.ok(context.windows.every(w=>w.toTick<=START_TICK+durationTicks));
});
test('rewards use selected duration, including early death, for all periods',()=>{
 for(const hours of [.5,1,1.5,6,24,48])for(const total of [0,1,1234.5]){
  assert.equal(rewardAmount(total,'hour',hours),total/hours);
  assert.equal(rewardAmount(total,'day',hours),total/hours*24);
  assert.equal(rewardAmount(total,'total',hours),total);
 }
 const s=defaults();s.manual.simulationHours=6;
 const result=simulateMonster(s,game.monsters.at(-1),{now});
 assert.equal(result.deaths,1);assert.ok(result.elapsedTicks<result.durationTicks);
 assert.equal(rewardAmount(result.xp,'hour',6),result.xp/6);
});
