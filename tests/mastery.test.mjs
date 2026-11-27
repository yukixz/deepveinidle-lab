import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {masteryDefaults,validateMastery,calculateMastery,highestAffordableMastery,masteryLimit,masteryStorageKey,readMasterySettings,writeMasterySettings} from '../src/mastery.js';
import {masteryValue} from '../src/model.js';

test('mastery upgrade costs agree with independently summed rank costs, including limits',()=>{
 const s=masteryDefaults();assert.equal(calculateMastery(s).spent,0);
 s.target.xp=1;assert.equal(calculateMastery(s).spent,40);
 s.target.xp=2;assert.equal(calculateMastery(s).spent,82);
 s.current.xp=1;assert.equal(calculateMastery(s).spent,42);
 s.target.enhance=3;assert.equal(calculateMastery(s).spent,168);
 let sum=0;for(let rank=1;rank<=masteryLimit;rank++){sum+=38+2*rank;assert.equal(game.masteryTotalCost(rank),sum);}
 for(const m of game.masteries)s.target[m.id]=masteryLimit;
 assert.equal(calculateMastery(s).targetCost,sum*10);
 assert.equal(calculateMastery(s).rows.every(row=>row.nextCost===null),true);
});
test('highest affordable rank respects current investment and competing allocations',()=>{
 const s=masteryDefaults();assert.equal(highestAffordableMastery(s,'xp'),0);
 for(const [budget,expected]of [[39,0],[40,1],[81,1],[82,2],[125,2],[126,3]]){s.totalPoints=budget;assert.equal(highestAffordableMastery(s,'xp'),expected);}
 s.current.xp=10;s.target.xp=10;s.totalPoints=549;assert.equal(highestAffordableMastery(s,'xp'),10);s.totalPoints=550;assert.equal(highestAffordableMastery(s,'xp'),11);
 s.target.rare=1;assert.equal(highestAffordableMastery(s,'xp'),10);
 s.totalPoints=529;assert.equal(highestAffordableMastery(s,'xp'),9);s.totalPoints=39;assert.throws(()=>highestAffordableMastery(s,'xp'),/otherTracksOverBudget/);
 s.totalPoints=Number.MAX_SAFE_INTEGER;assert.equal(highestAffordableMastery(s,'xp'),masteryLimit);
 assert.throws(()=>highestAffordableMastery(s,'unknown'),/unknownMastery/);
});
test('over-budget plans remain calculable; mode changes and undo preserve the baseline',()=>{
 const s=masteryDefaults();s.current.xp=5;s.target.xp=7;s.target.rare=3;s.totalPoints=221;s.budget=1;
 const before=structuredClone(s),r=calculateMastery(s);assert.equal(r.spent,228);assert.equal(r.remaining,-227);assert.deepEqual(s,before);
 s.mode='unlimited';assert.equal(calculateMastery(s).spent,r.spent);
 s.target={...s.current};assert.equal(calculateMastery(s).spent,0);assert.equal(calculateMastery(s).currentCost,220);
 assert.deepEqual(validateMastery(JSON.parse(JSON.stringify(s))),s);
});
test('invalid ranks, total points, and stored configurations fail explicitly',()=>{
 for(const value of ['', ' ',null,undefined,true,NaN,Infinity,-1,1.5,masteryLimit+1]){const s=masteryDefaults();s.target.xp=value;assert.throws(()=>validateMastery(s),/invalidInteger/);}
 for(const value of ['',-1,.5,Infinity,Number.MAX_SAFE_INTEGER+1]){const s=masteryDefaults();s.totalPoints=value;assert.throws(()=>validateMastery(s),/invalidInteger/);}
 const s=masteryDefaults();s.current.xp=1;assert.equal(validateMastery(s).target.xp,0);
 assert.throws(()=>validateMastery({}),/invalidConfiguration/);
 s.target.xp='2';s.budget='82';assert.equal(validateMastery(s).target.xp,2);
});
test('mastery bonuses preserve enhancement quarter-percent and fractional offline hours',()=>{
 assert.equal(masteryValue('xp',1),.5);assert.equal(masteryValue('enhance',1),.25);assert.equal(masteryValue('offline',1),.12);
 assert.equal(masteryValue('offline',20),2.4);
});
test('maximum affordable rank has a tight boundary for varied plans',()=>{
 for(const rank of [0,1,17,199,200])for(const budget of [0,40,1000,99999]){
  const s=masteryDefaults();s.current.xp=rank;s.target.xp=rank;s.target.move=2;s.totalPoints=game.masteryTotalCost(rank)+budget+82;
  const result=highestAffordableMastery(s,'xp'),cost=game.masteryTotalCost(result)-game.masteryTotalCost(rank);
  assert.ok(cost<=budget);if(result<masteryLimit)assert.ok(cost+game.masteryRankCost(result+1)>budget);
 }
});

test('independent storage round trips and rejects corruption and unavailable storage',()=>{
 const data=new Map([['dvi-simulator-v1','existing combat settings']]);
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 assert.deepEqual(readMasterySettings(storage),masteryDefaults());
 const s=masteryDefaults();s.target.xp=2;s.planned=true;s.totalPoints=81;s.budget=81;writeMasterySettings(storage,s);assert.deepEqual(readMasterySettings(storage),s);
 assert.equal(data.get('dvi-simulator-v1'),'existing combat settings');
 const lastSaved=data.get(masteryStorageKey);s.target.xp='';assert.throws(()=>writeMasterySettings(storage,s),/invalidInteger/);assert.equal(data.get(masteryStorageKey),lastSaved);
 data.set(masteryStorageKey,'{');assert.throws(()=>readMasterySettings(storage),SyntaxError);
 data.set(masteryStorageKey,JSON.stringify({mode:'limited'}));assert.throws(()=>readMasterySettings(storage),/invalidInteger/);
 const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};
 assert.throws(()=>readMasterySettings(denied),/denied/);assert.throws(()=>writeMasterySettings(denied,masteryDefaults()),/quota/);
 assert.equal(calculateMastery(masteryDefaults()).spent,0);
});

test('mastery import updates current ranks and points while preserving planned targets and mode',async()=>{
 const {importMastery}=await import('../src/mastery.js');
 const s=masteryDefaults();s.mode='unlimited';s.budget=1234;s.target.xp=99;
 const ranks=Object.fromEntries(game.masteries.map((m,i)=>[m.id,i]));
 const snapshot={version:2,capturedAt:Date.now(),player:{masteries:ranks,collections:{64:1},forgeLog:{29:1073741823},bank:{64:99}}};
 const result=importMastery(s,snapshot);assert.deepEqual(result.state.current,ranks);assert.deepEqual(result.state.target,s.target);assert.equal(result.state.mode,'unlimited');assert.equal(result.state.planned,true);assert.equal(result.state.totalPoints,5337);assert.equal(result.state.budget,5337-game.masteriesTotalCost(ranks));assert.equal(result.capturedAt,snapshot.capturedAt);assert.equal(result.state.bank,undefined);assert.equal(calculateMastery(result.state).targetCost,game.masteriesTotalCost(s.target));assert.equal(s.target.xp,99);
 result.state.current.xp=10;assert.equal(snapshot.player.masteries.xp,0);assert.equal(result.state.target.xp,99);
 snapshot.player.masteries={enhance:1,offline:2};const sparse=importMastery(s,snapshot).state;assert.equal(sparse.current.xp,0);assert.equal(sparse.current.enhance,1);assert.equal(sparse.current.offline,2);
});
test('bad mastery imports fail atomically instead of silently mapping invalid ranks to zero',async()=>{
 const {importMastery}=await import('../src/mastery.js');const s=masteryDefaults();s.target.xp=7;const before=structuredClone(s);
 const base={version:2,capturedAt:Date.now(),player:{masteries:{xp:2},collections:{64:1},forgeLog:{29:1073741823}}};
 for(const value of [null,'2',undefined,-1,1.5,Infinity,masteryLimit+1]){const bad=structuredClone(base);bad.player.masteries.xp=value;assert.throws(()=>importMastery(s,bad),/invalidSnapshot/);assert.deepEqual(s,before);}
 for(const masteries of [null,[],undefined]){assert.throws(()=>importMastery(s,{...base,player:{masteries}}),/incompleteSnapshot/);}
 const invalidBudget={...s,budget:''};assert.equal(importMastery(invalidBudget,base).state.mode,'limited');
 for(const snapshot of [null,{...base,version:1},{...base,capturedAt:Date.now()+120000},{...base,capturedAt:0},{...base,player:null}])assert.throws(()=>importMastery(s,snapshot),/invalidSnapshot/);
});


test('earned mastery points include collection and forge sources and deduct existing allocation',async()=>{
 const {importMastery}=await import('../src/mastery.js');const s=masteryDefaults();
 const snapshot={version:2,capturedAt:Date.now(),player:{masteries:{},collections:{64:1},forgeLog:{0:1}}};
 let result=importMastery(s,snapshot).state;assert.equal(result.totalPoints,6);assert.equal(result.budget,6);
 snapshot.player.collections={};snapshot.player.forgeLog={};result=importMastery(s,snapshot).state;assert.equal(result.totalPoints,0);assert.equal(result.budget,0);
 snapshot.player.masteries={xp:1};assert.throws(()=>importMastery(s,snapshot),/invalidSnapshot/);
 const granted=importMastery(s,{...snapshot,player:{...snapshot.player,masteryGrant:65}}).state;
 assert.equal(granted.totalPoints,65);assert.equal(granted.budget,25);
 for(const masteryGrant of [-1,1.5,'65',null])assert.throws(()=>importMastery(s,{...snapshot,player:{...snapshot.player,masteryGrant}}),/invalidSnapshot/);
 snapshot.player.forgeLog={0:255};const exhausted=importMastery(s,snapshot).state;assert.equal(exhausted.totalPoints,40);assert.equal(exhausted.budget,0);snapshot.player.forgeLog={};
 for(const field of ['collections','forgeLog']){for(const value of [undefined,null,[]]){const bad=structuredClone(snapshot);bad.player[field]=value;assert.throws(()=>importMastery(s,bad),/incompleteSnapshot/);}}
 snapshot.player.masteries={};
 for(const collections of [{'64':-1},{'64':'1'},{'64':.5},{'bad':1},{'01':1},{'64':Infinity}])assert.throws(()=>importMastery(s,{...snapshot,player:{...snapshot.player,collections}}),/invalidSnapshot/);
 for(const forgeLog of [{'30':1},{'0':2**30},{'0':-1},{'0':1.5},{'0':'1'},{'bad':1}])assert.throws(()=>importMastery(s,{...snapshot,player:{...snapshot.player,forgeLog}}),/invalidSnapshot/);
 const old=masteryDefaults();delete old.totalPoints;assert.equal(validateMastery(old).totalPoints,0);
 const saved=validateMastery({...masteryDefaults(),totalPoints:6});assert.equal(saved.totalPoints,6);
});


test('dungeon supply collection points use rare craft counts from the captured character',async()=>{
 const {importMastery}=await import('../src/mastery.js');
 const snapshot={version:2,capturedAt:Date.now(),player:{masteries:{},collections:{2962:2},forgeLog:{}}};
 assert.equal(importMastery(masteryDefaults(),snapshot).state.totalPoints,10);
});

test('available points derive from total points and current ranks, including legacy migration',async()=>{
 const {changeMasteryTotal}=await import('../src/mastery.js');let s=masteryDefaults();
 s=changeMasteryTotal(s,'100');assert.equal(s.totalPoints,100);assert.equal(s.budget,100);
 s.current.xp=1;s.target.xp=1;s=changeMasteryTotal(s,250);assert.equal(s.budget,210);
 s.target.xp=2;assert.equal(calculateMastery(s).budget,210);assert.equal(calculateMastery(s).remaining,168);
 s.budget='ignored';assert.equal(validateMastery(s).budget,210);
 s=changeMasteryTotal(s,20);assert.equal(s.budget,-20);assert.equal(calculateMastery(s).remaining,-62);
 for(const value of ['',-1,.5,Infinity])assert.throws(()=>changeMasteryTotal(s,value),/invalidInteger/);
 const legacy=masteryDefaults();legacy.current.xp=1;legacy.target.xp=1;legacy.budget=100;delete legacy.totalPoints;assert.equal(validateMastery(legacy).totalPoints,140);legacy.totalPoints=null;assert.equal(validateMastery(legacy).budget,100);
 legacy.totalPoints=200;legacy.budget=999;assert.equal(validateMastery(legacy).budget,160);
});

test('reset targets preserve current ranks, signed costs and budget through storage',()=>{
 const s=masteryDefaults();s.totalPoints=200;s.current.xp=3;s.target.xp=1;s.target.rare=2;
 const r=calculateMastery(s);assert.equal(r.currentCost,126);assert.equal(r.targetCost,122);assert.equal(r.spent,-4);assert.equal(r.remaining,78);assert.equal(r.rows.find(row=>row.id==='xp').cost,-86);
 assert.equal(highestAffordableMastery(s,'xp'),2);assert.equal(highestAffordableMastery(s,'rare'),3);
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};writeMasterySettings(storage,s);const restored=readMasterySettings(storage);assert.equal(restored.current.xp,3);assert.equal(restored.target.xp,1);assert.deepEqual(calculateMastery(restored),r);
});

test('unplanned imports initialize targets; explicit zero, undo and previous-version plans survive later imports',async()=>{
 const {importMastery}=await import('../src/mastery.js');
 const snapshot={version:2,capturedAt:Date.now(),player:{masteries:{xp:2},collections:{},forgeLog:{29:1073741823}}};
 const first=importMastery(masteryDefaults(),snapshot).state;
 assert.deepEqual(first.target,first.current);assert.equal(first.planned,false);
 const next={...snapshot,player:{...snapshot.player,masteries:{xp:3}}};
 assert.equal(importMastery(first,next).state.target.xp,3);
 const zero={...first,target:masteryDefaults().target,planned:true};
 assert.equal(importMastery(zero,next).state.target.xp,0);
 assert.equal(importMastery({...first,planned:true},next).state.target.xp,2);
 const old={...first};delete old.planned;
 const db=new Map([[masteryStorageKey,JSON.stringify(old)]]),storage={getItem:k=>db.get(k)??null,setItem:(k,v)=>db.set(k,v)};
 const restored=readMasterySettings(storage);assert.equal(restored.planned,true);
 assert.equal(importMastery(restored,next).state.target.xp,2);
 writeMasterySettings(storage,zero);assert.equal(importMastery(readMasterySettings(storage),next).state.target.xp,0);
});
