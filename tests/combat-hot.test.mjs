import test from 'node:test';
import assert from 'node:assert/strict';
import {preset,normalize,defaults} from '../src/model.js';
import * as game from '../src/upstream.js';
import {DAY_TICKS,simulationHotMarkup,combatHot,combatHotWindows,rewardAmount} from '../src/combat-hot.js';
import {epoch,tickTime} from '../src/hot-forecast.js';
import {manualWindows} from '../src/manual-settings.js';
import {START_TICK,simulateMonster,createScenario} from '../src/simulation.js';
import {nativeDay} from './native-day.mjs';
const now=Date.UTC(2026,9,6,3,17);
test('hot modes default to current time, preserve choices and migrate legacy booleans',()=>{
 assert.equal(defaults().manual.hotSetting,'current');
 assert.equal(normalize({}).manual.hotSetting,'current');
 for(const hotSetting of ['game','current','off'])assert.equal(normalize({manual:{hotSetting}}).manual.hotSetting,hotSetting);
 for(const [hotForecast,expected]of [[true,'current'],[false,'off']])assert.equal(normalize({manual:{hotForecast}}).manual.hotSetting,expected);
 assert.equal(normalize({manual:{hotMode:2,hotSetting:'invalid'}}).manual.hotSetting,'current');
 assert.equal(normalize({manual:{hotSetting:'game',hotForecast:true}}).manual.hotSetting,'game');
});
test('forecast includes active combat periods, clips boundaries and fails on invalid time',()=>{
 const result=combatHot(now,24);assert.equal(result.end-result.start,144000);
 assert.equal(tickTime(result.start),now);
 let hot=game.hotSkill(result.start);while(hot.skill!=='combat')hot=game.hotSkill(hot.until);
 const active=combatHot(tickTime(hot.from+17),24);assert.equal(active.entries[0].from,hot.from+17);assert.equal(active.entries[0].until,hot.until);
 for(const entry of result.entries){assert.equal(entry.skill,'combat');assert.ok(entry.from>=result.start&&entry.until<=result.end);assert.ok(entry.until>entry.from);}
 for(const value of [NaN,Infinity,epoch-1])assert.throws(()=>combatHot(value),/invalidTime/);
});
test('mapped windows match forecast for every tick including initialization and half-hour boundaries',()=>{
 const schedule=combatHot(Date.UTC(2026,9,2),24),windows=[...manualWindows(START_TICK,START_TICK+DAY_TICKS,30),...combatHotWindows(schedule)],seen=new Set();
 const expectedHot=Array.from({length:DAY_TICKS+1},(_,offset)=>game.hotSkill(schedule.start+Math.max(0,offset-1)));
 for(let offset=0;offset<=DAY_TICKS;offset++){
  const tick=START_TICK+offset,forecast=expectedHot[offset];
  let xp=0,rare=0;
  for(const w of windows)if(tick>=w.fromTick&&tick<=w.toTick){xp+=w.xpMult-1;rare+=w.rarityMult-1;}
  assert.ok(Math.abs(xp-(.3+(forecast.skill==='combat'&&forecast.kind==='xp'?forecast.mult-1:0)))<1e-10);
  assert.ok(Math.abs(rare-(forecast.skill==='combat'&&forecast.kind==='rarity'?forecast.mult-1:0))<1e-10);
  if(forecast.skill==='combat')seen.add(forecast.kind);
 }
 assert.deepEqual([...seen].sort(),['rarity','xp']);
});
test('day totals divide uniformly without hourly rounding, including early deaths',()=>{
 for(const value of [0,1,25,1234.5]){assert.equal(rewardAmount(value,'hour',24),value/24);assert.equal(rewardAmount(value,'day',24),value);}
 const s=preset('ranged'),m=game.monsters[0];s.manual.simulationHours=24;const result=simulateMonster(s,m);
 assert.equal(result.elapsedTicks,DAY_TICKS);assert.equal(result.xp,Object.values(result.bySkill).reduce((sum,n)=>sum+n,0));
 const dead=simulateMonster(defaults(),game.monsters.at(-1));assert.equal(dead.deaths,1);assert.ok(dead.elapsedTicks<DAY_TICKS);assert.equal(rewardAmount(dead.xp,'hour'),dead.xp);
});
test('forecast changes XP and aligns with original offline chunks over 24 hours',()=>{
 const s=preset('ranged'),m=game.monsters[0];s.manual.simulationHours=24;s.manual.hotSetting='off';
 const baseline=simulateMonster(s,m,{now});s.manual.hotSetting='current';
 const result=simulateMonster(s,m,{now}),{player,context}=createScenario(s,m,{now}),zone=game.world.zones.find(z=>z.monsterId===m.id);
 const expected=nativeDay(player,context,p=>game.startFight(p,context,zone.id));
 assert.ok(result.xp>baseline.xp);assert.equal(result.xp,expected.xpPerHour);assert.deepEqual(result.bySkill,expected.bySkill);assert.equal(result.elapsedTicks,expected.ticks);
 assert.throws(()=>simulateMonster(s,m,{now:epoch-1}),/invalidTime/);
 assert.deepEqual(simulateMonster({...s,manual:{...s.manual,hotSetting:'off'}},m,{now:epoch-1}),baseline);
});
test('game mode maps native hot rules while current and off select explicit windows',()=>{
 const s=preset('ranged'),m=game.monsters[0];s.manual.simulationHours=24;s.manual.hotSetting='game';
 const {player,context}=createScenario(s,m,{now:NaN});
 assert.ok(context.windows.length>0);
 const zone=game.world.zones.find(z=>z.monsterId===m.id),nativeContext=game.createContext(game.world,0);
 const expected=nativeDay(player,nativeContext,p=>game.startFight(p,nativeContext,zone.id));
 const result=simulateMonster(s,m,{now:NaN});
 assert.equal(result.xp,expected.xpPerHour);assert.deepEqual(result.bySkill,expected.bySkill);
 s.manual.hotSetting='off';assert.deepEqual(createScenario(s,m,{now:NaN}).context.windows,[]);
 s.manual.hotSetting='current';assert.throws(()=>createScenario(s,m,{now:NaN}),/invalidTime/);
 s.manual.hotSetting='game';s.manual.weeklyXp=20;
 const windows=createScenario(s,m,{now:NaN}).context.windows;
 assert.deepEqual(windows[0],{fromTick:START_TICK,toTick:START_TICK+DAY_TICKS,xpMult:1.2,rarityMult:1});
});

test('long hot previews cap detail without changing the simulation window',()=>{
 const now=Date.UTC(2026,10,26);
 const preview=simulationHotMarkup(now,31*24+24,'en',String);
 assert.match(preview,/first 31 days/);
 assert.equal((preview.match(/ · /g)??[]).length,combatHot(now,31*24).entries.length);
 assert.doesNotMatch(simulationHotMarkup(now,24,'en',String),/first 31 days/);
});
