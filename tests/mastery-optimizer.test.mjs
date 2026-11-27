import test from 'node:test';
import assert from 'node:assert/strict';
import {game,preset,masteryValue,makePlayer} from '../src/model.js';
import {gatheringDefaults,gatheringJobs} from '../src/gathering-model.js';
import {simulateGatheringJob} from '../src/gathering-simulation.js';
import {simulateMonster} from '../src/simulation.js';
import {valueRewards} from '../src/item-prices.js';
import {masteryDefaults} from '../src/mastery.js';
import {affordableRank,optimizerInput,combatIncomeItems,checkOptimizerPrices,searchMasteryAllocations,optimizeMastery,screeningSeeds,reviewSeeds,sampleStats,optimizerEfforts,optimizerPolicy,combatIncomeGeneration,optimizerIncomeItems,collectionScore} from '../src/mastery-optimizer.js';
const zero=()=>masteryDefaults().current;
function input(points=123){
 const combat=preset('ranged');combat.manual.simulationHours=1;
 const raw={objective:'combatIncome',totalPoints:points,current:zero(),effort:'standard',monsterId:7,combat,now:1792713600000};
 const validated=optimizerInput(raw);return {...raw,prices:Object.fromEntries(combatIncomeItems(validated.combat,validated.monster).map(id=>[id,{price:game.isPet(id)?0:100}]))};
}
// This independent enumerator sums the mathematical cost rather than the
// optimizer's candidate builder or the upstream cumulative cost helper.
function brute(points,score,current={}){
 let best=-Infinity;const ids=['xp','move','hp','maxhit','accuracy','rare'];
 function walk(i,left,r){if(i===ids.length){best=Math.max(best,score(r));return;}
  for(let n=current[ids[i]]??0;n*n+39*n<=left;n++)walk(i+1,left-(n*n+39*n),{...r,[ids[i]]:n});
 }
 const fixed=Object.entries(current).filter(([id])=>!ids.includes(id)).reduce((sum,[,r])=>sum+r*r+39*r,0);
 walk(0,points-fixed,{...current});return best;
}
test('reset budget boundaries match independent exhaustive objectives, including a multi-rank plateau',()=>{
 for(const points of [0,39,40,41,82,123]){
  const score=r=>20*(r.maxhit>=2)+7*r.rare+3*r.accuracy+r.xp+r.hp;
  const search=searchMasteryAllocations({totalPoints:points,current:{...zero(),maxhit:59},maxCandidates:240,evaluate:score});
  assert.equal(search.exhaustive,true);assert.equal(search.candidates[0].score,brute(points,score));
  for(const c of search.candidates)assert.ok(Object.values(c.ranks).reduce((n,r)=>n+r*r+39*r,0)<=points);
 }
 const exact=searchMasteryAllocations({totalPoints:82,maxCandidates:240,evaluate:r=>r.maxhit>=2?10:0});
 assert.equal(exact.candidates[0].ranks.maxhit,2);
});
test('bounded search is reproducible, preserves inputs, reclaims old ranks and respects high-rank budgets',()=>{
 const current={...zero(),maxhit:200,accuracy:1},before=structuredClone(current),seen=[];
 const options={totalPoints:1000000,current,maxCandidates:240,evaluate:r=>{seen.push({...r});return r.rare+2*r.accuracy;}};
 const a=searchMasteryAllocations(options),b=searchMasteryAllocations({...options,evaluate:r=>r.rare+2*r.accuracy});
 assert.equal(a.exhaustive,false);assert.deepEqual(a,b);assert.ok(a.candidates.length<=240);assert.ok(a.candidates.length>1);
 assert.deepEqual(current,before);assert.ok(seen.some(r=>r.rare===200));assert.ok(seen.some(r=>r.maxhit<200));
 assert.equal(new Set(seen.map(r=>JSON.stringify(r))).size,seen.length);
 assert.ok(seen.every(r=>Object.values(r).every(n=>Number.isInteger(n)&&n>=0&&n<=200)&&game.masteriesTotalCost(r)<=1000000));
 assert.equal(affordableRank(Number.MAX_SAFE_INTEGER),200);
 assert.equal(masteryValue('accuracy',200),200);assert.equal(masteryValue('enhance',200),50);
});
test('remaining-points allocations match independent enumeration and preserve all ten rank floors',()=>{
 const current={...zero(),xp:1,accuracy:1,rare:1,gather:2,craft:1,offline:1,enhance:3};
 const invested=Object.values(current).reduce((sum,r)=>sum+r*r+39*r,0);
 const score=r=>20*(r.maxhit>=2)+7*r.rare+3*r.accuracy+r.xp+r.hp;
 for(const available of [0,39,40,41,42,43,82,123]){
  const totalPoints=invested+available,search=searchMasteryAllocations({totalPoints,current,allocationMode:'remaining',maxCandidates:240,evaluate:score});
  assert.equal(search.exhaustive,true);assert.equal(search.candidates[0].score,brute(totalPoints,score,current));
  for(const c of search.candidates){
   for(const m of game.masteries){assert.ok(c.ranks[m.id]>=current[m.id]);if(['gather','craft','offline','enhance'].includes(m.id))assert.equal(c.ranks[m.id],current[m.id]);}
   assert.ok(c.cost<=totalPoints);assert.ok(c.cost-invested<=available);
  }
 }
});
test('remaining-points search never refunds initial investment, even during bounded large-budget moves',()=>{
 const current={...zero(),xp:180,move:20,hp:5,maxhit:190,accuracy:180,rare:170,gather:20,craft:17,offline:3,enhance:200},before=structuredClone(current),seen=[];
 const totalPoints=game.masteriesTotalCost(current)+20000;
 const search=searchMasteryAllocations({totalPoints,current,allocationMode:'remaining',maxCandidates:240,evaluate:r=>{seen.push(r);return r.rare*2+r.accuracy+r.move;}});
 assert.equal(search.exhaustive,false);assert.ok(seen.length>1&&seen.length<=240);
 for(const ranks of seen){assert.ok(game.masteriesTotalCost(ranks)<=totalPoints);for(const m of game.masteries)assert.ok(ranks[m.id]>=current[m.id]);for(const id of ['gather','craft','offline','enhance'])assert.equal(ranks[id],current[id]);}
 assert.deepEqual(current,before);
 const capped=Object.fromEntries(game.masteries.map(m=>[m.id,200]));
 const full=searchMasteryAllocations({totalPoints:game.masteriesTotalCost(capped)+100000,current:capped,allocationMode:'remaining',maxCandidates:240,evaluate:()=>1});
 assert.equal(full.candidates.length,1);assert.deepEqual(full.candidates[0].ranks,capped);
});
test('remaining-points results charge incremental costs and handle no spare points and exact next-rank costs',()=>{
 const raw=input();raw.allocationMode='remaining';raw.current={...zero(),accuracy:1,gather:2,craft:1,offline:3,enhance:5};
 const invested=game.masteriesTotalCost(raw.current),simulate=s=>({deaths:0,endedEarly:false,coins:100+20*s.masteries.accuracy,normalItems:{},rareItems:{}});
 for(const available of [0,41,42]){
  raw.totalPoints=invested+available;const before=structuredClone(raw),result=optimizeMastery(raw,{simulate});
  assert.equal(result.allocationMode,'remaining');assert.equal(result.availablePoints,available);
  assert.equal(result.plans[0].ranks.accuracy,available===42?2:1);assert.equal(result.plans[0].additionalCost,available===42?42:0);
  assert.equal(result.plans[0].remaining,available===42?0:available);assert.deepEqual(raw,before);
  if(available===0){assert.equal(result.screened,1);assert.deepEqual(result.plans[0].ranks,raw.current);}
 }
 raw.totalPoints=invested-1;assert.throws(()=>optimizeMastery(raw,{simulate:()=>{throw Error('must not simulate');}}),/optimizerCurrentOverBudget/);
 assert.throws(()=>optimizerInput({...raw,allocationMode:'unknown'}),/invalidOptimizerMode/);
 assert.throws(()=>optimizerInput({...raw,allocationMode:null}),/invalidOptimizerMode/);
 assert.equal(optimizerInput({...raw,allocationMode:undefined}).allocationMode,'reset');
});
test('keeping current ranks remains a reviewed option when screening favors upgrades that do not hold up',()=>{
 const raw=input(240);raw.allocationMode='remaining';raw.current.hp=1;
 const result=optimizeMastery(raw,{simulate:(s,m,{seed})=>{
  const changed=Object.entries(s.masteries).some(([id,n])=>n!==raw.current[id]);
  return {deaths:0,endedEarly:false,coins:changed?(screeningSeeds.includes(seed)?200:50):100,normalItems:{},rareItems:{}};
 }});
 assert.deepEqual(result.plans[0].ranks,raw.current);assert.equal(result.plans[0].additionalCost,0);assert.equal(result.plans[0].paired.mean,0);
});
test('validation rejects unsupported goals and bad budgets, ranks and scenarios',()=>{
 const base=input();for(const totalPoints of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'40'])assert.throws(()=>optimizerInput({...base,totalPoints}));
 for(const objective of ['unknown','xp','enhanceCost',undefined])assert.throws(()=>optimizerInput({...base,objective}),/unsupportedObjective/);
 for(const rank of [-1,.1,201,null,'1'])assert.throws(()=>optimizerInput({...base,current:{...zero(),xp:rank}}),/invalidOptimizerRanks/);
 assert.throws(()=>optimizerInput({...base,combat:null}),/invalidOptimizerScenario/);
 assert.throws(()=>optimizerInput({...base,monsterId:-1}),/invalidOptimizerMonster/);
 assert.throws(()=>optimizerInput({...base,effort:'unknown'}),/invalidOptimizerEffort/);
});
test('price coverage includes unseen qualities, bonus, shard and mounts; zero prices are valid',()=>{
 const raw=input(),i=optimizerInput(raw),ids=combatIncomeItems(i.combat,i.monster);
 for(let tier=0;tier<=4;tier++)assert.ok(ids.includes(game.withRarity(i.monster.drop,tier)));
 assert.ok(ids.includes(i.monster.bonus.itemId));assert.ok(ids.includes(game.voidShardItemId));
 const missing=game.withRarity(game.mountItemId,4);delete raw.prices[missing];
 assert.throws(()=>checkOptimizerPrices(i,raw.prices),e=>e.message==='missingOptimizerPrices'&&e.itemIds.includes(missing));
 raw.prices[missing]={price:0};assert.doesNotThrow(()=>checkOptimizerPrices(i,raw.prices));
 i.combat.manual.ironman=true;assert.ok(!combatIncomeItems(i.combat,i.monster).includes(missing));
});
test('independent review seeds, cache and paired comparisons preserve the declared income objective',()=>{
 const raw=input(40),calls=[],progress=[];
 const simulate=(s,m,{seed})=>{calls.push({ranks:{...s.masteries},seed});return {deaths:0,endedEarly:false,coins:100+20*s.masteries.rare+(seed%5),normalItems:{},rareItems:{}};};
 const result=optimizeMastery(raw,{simulate,onProgress:p=>progress.push(p)});
 assert.equal(result.plans[0].ranks.rare,1);assert.equal(result.plans[0].paired.mean,20);assert.equal(result.plans[0].paired.se,0);
 assert.ok(screeningSeeds.every(seed=>!reviewSeeds.includes(seed)));assert.ok(result.screened<7);assert.ok(calls.every(call=>call.ranks.xp===0));
 assert.equal(new Set(calls.map(c=>JSON.stringify(c))).size,calls.length);assert.equal(result.simulations,calls.length);
 assert.ok(progress.some(p=>p.phase==='search'));assert.ok(progress.some(p=>p.phase==='review'));
 assert.deepEqual(sampleStats([1,2,3]),{mean:2,sd:1,se:1/Math.sqrt(3)});
 const over=input(0);over.current.enhance=1;const r=optimizeMastery(over,{simulate});assert.equal(r.baseline.overBudget,true);assert.equal(r.plans[0].paired,null);
});
test('deaths and early ends are excluded without extrapolation; simulation errors and missing prices fail',()=>{
 const raw=input(40),simulate=(s,m,{seed})=>({deaths:s.masteries.rare?1:0,endedEarly:false,coins:100,normalItems:{},rareItems:{}});
 const result=optimizeMastery(raw,{simulate});assert.ok(result.excluded>0);assert.equal(result.plans[0].ranks.rare,0);
 for(const sample of [{deaths:1,endedEarly:false},{deaths:0,endedEarly:true}])assert.throws(()=>optimizeMastery(raw,{simulate:()=>sample}),/noViableOptimizerPlan/);
 assert.throws(()=>optimizeMastery(raw,{simulate:()=>{throw Error('route failed');}}),/route failed/);
 assert.throws(()=>optimizeMastery({...raw,prices:{}},{simulate}),/missingOptimizerPrices/);
 assert.throws(()=>optimizeMastery(raw,{simulate:()=>({deaths:0,endedEarly:false,coins:NaN,normalItems:{},rareItems:{}})}));
});
test('review can reject a screening winner and an unsafe baseline has no paired comparison',()=>{
 const raw=input(40);
 const result=optimizeMastery(raw,{simulate:(s,m,{seed})=>({deaths:s.masteries.rare&&reviewSeeds.includes(seed)?1:0,endedEarly:false,coins:100+20*s.masteries.rare,normalItems:{},rareItems:{}})});
 assert.equal(result.plans[0].ranks.rare,0);assert.ok(result.excluded>0);
 raw.current={...zero(),hp:1};
 const unsafe=optimizeMastery(raw,{simulate:s=>({deaths:s.masteries.hp?1:0,endedEarly:false,coins:100,normalItems:{},rareItems:{}})});
 assert.equal(unsafe.baseline.viable,false);assert.equal(unsafe.baseline.stats,null);assert.equal(unsafe.plans[0].paired,null);
});
test('real upstream simulation matches a separately valued baseline and leaves the input untouched',()=>{
 const raw=input(0),before=structuredClone(raw),result=optimizeMastery(raw);
 const values=reviewSeeds.map(seed=>valueRewards(simulateMonster({...optimizerInput(raw).combat,masteries:zero()},game.monsters.find(m=>m.id===7),{seed,now:raw.now}),raw.prices).totalIncome);
 assert.equal(result.plans[0].stats.mean,sampleStats(values).mean);assert.equal(result.plans[0].paired.mean,0);assert.deepEqual(raw,before);assert.equal(result.screened,1);
});

test('four search efforts vary generation and stop early on flat objectives',()=>{
 assert.deepEqual(optimizerEfforts,{fast:60,standard:120,deep:360,comprehensive:720});
 const counts=[];
 for(const [effort,maxCandidates]of Object.entries(optimizerEfforts)){
  const result=searchMasteryAllocations({totalPoints:100000,effort,maxCandidates,evaluate:()=>100});
  assert.equal(result.stopReason,'stalled');assert.ok(result.candidates.length<maxCandidates);counts.push(result.candidates.length);
 }
 assert.ok(counts.every((n,i)=>i===0||n>counts[i-1]));
});
test('combat-income generation excludes XP and preserves the remaining-mode floor',()=>{
 const policy=optimizerPolicy('combatIncome');assert.equal(policy.ignoreLevelUpsForGeneration,true);assert.equal(policy.tracks.length,5);assert.ok(!policy.tracks.includes('xp'));
 for(const goal of ['xp','unknown','enhanceCost',undefined])assert.throws(()=>optimizerPolicy(goal),/unsupportedObjective/);
 for(const allocationMode of ['reset','remaining'])for(const effort of Object.keys(optimizerEfforts)){
  const raw=input(5000);raw.current={...zero(),xp:5,gather:2};raw.allocationMode=allocationMode;raw.effort=effort;const calls=[];
  const result=optimizeMastery(raw,{simulate:(s,m,{seed})=>{calls.push({ranks:s.masteries,seed});return {deaths:0,endedEarly:false,coins:100+s.masteries.rare+s.masteries.accuracy,normalItems:{},rareItems:{}};}});
  assert.ok(result.screened<=optimizerEfforts[effort]);
  const expected=allocationMode==='remaining'?5:0;
  assert.ok(calls.filter(c=>screeningSeeds.includes(c.seed)).every(c=>c.ranks.xp===expected));
  assert.ok(result.plans.every(p=>p.ranks.xp===expected&&p.ranks.gather===(allocationMode==='remaining'?2:0)));
  assert.equal(result.baseline.ranks.xp,5);assert.ok(result.plans.every(p=>p.cost<=raw.totalPoints));
 }
});
test('income generation skips initial HP plateaus, keeps floors and crosses the next breakpoint',()=>{
 const combat=preset('ranged');combat.levels.hitpoints=10;const floor=zero(),before=structuredClone(combat),generation=combatIncomeGeneration(combat,floor);
 // At rank 0 the preset has 10 HP. +0.5% per rank is rounded down;
 // the first additional HP arrives at rank 20, not at ranks 1 through 19.
 assert.equal(generation.canonicalize({...floor,hp:19}).hp,0);
 assert.equal(generation.nextRank(floor,'hp',1),20);
 assert.equal(generation.canonicalize({...floor,hp:21}).hp,20);
 const remaining={...floor,hp:7};const kept=combatIncomeGeneration(combat,remaining);
 assert.equal(kept.canonicalize(remaining).hp,7);assert.equal(kept.nextRank(remaining,'hp',8),20);
 assert.deepEqual(combat,before);assert.deepEqual(floor,zero());
});

test('higher efforts include the lower effort candidate set without duplicate evaluation',()=>{
 let previous=new Set(),previousReview=new Set(),tier=0;
 for(const [effort,maxCandidates]of Object.entries(optimizerEfforts)){
  const calls=[],result=searchMasteryAllocations({totalPoints:100000,effort,maxCandidates,evaluate:r=>{calls.push(JSON.stringify(r));return r.maxhit+2*r.rare+r.accuracy;}});
  const actual=new Set(calls);assert.equal(actual.size,calls.length);assert.equal(calls.length,result.candidates.length);assert.ok(calls.length<=maxCandidates);
  for(const key of previous)assert.ok(actual.has(key));previous=actual;
  const review=new Set(result.reviewCandidates.map(c=>JSON.stringify(c.ranks)));for(const key of previousReview)assert.ok(review.has(key));assert.ok(review.size<=5*++tier);previousReview=review;
 }
});

test('damage breakpoints keep the cheapest initial-equivalent rank and generic search can still optimize XP',()=>{
 const combat=preset('ranged'),floor=zero(),generation=combatIncomeGeneration(combat,floor),first=new Map();
 for(let n=0;n<=60;n++){
  const ranks={...floor,maxhit:n},player=makePlayer({...combat,masteries:ranks}).player,hit=game.maxHit(player);
  if(!first.has(hit))first.set(hit,n);assert.equal(generation.canonicalize(ranks).maxhit,first.get(hit));
 }
 const generic=searchMasteryAllocations({totalPoints:40,maxCandidates:60,evaluate:r=>r.xp*1000});
 assert.equal(generic.candidates[0].ranks.xp,1);
});

test('independent review cannot lose a lower-effort winner to extra screening candidates',()=>{
 let income=-Infinity;
 for(const effort of Object.keys(optimizerEfforts)){
  const raw=input(5000);raw.effort=effort;const calls=new Set();
  const result=optimizeMastery(raw,{simulate:(s,m,{seed})=>{
   const key=JSON.stringify(s.masteries)+':'+seed;assert.ok(!calls.has(key));calls.add(key);
   const coins=screeningSeeds.includes(seed)?100+5*s.masteries.rare+s.masteries.accuracy:100+5*s.masteries.maxhit+s.masteries.hp;
   return {deaths:0,endedEarly:false,coins,normalItems:{},rareItems:{}};
  }});
  assert.ok(result.plans[0].stats.mean>=income);income=result.plans[0].stats.mean;
  assert.equal(result.simulations,calls.size);assert.ok(result.screened<=optimizerEfforts[effort]);
 }
});

function gatheringInput(objective='gatherIncome',points=40){
 const gathering=gatheringDefaults();gathering.simulationHours=1/60;gathering.hotSetting='off';
 const job=gatheringJobs.find(j=>j.skill==='mining'&&j.levelReq===1);
 const raw={objective,totalPoints:points,current:zero(),effort:'fast',jobId:job.id,gathering,now:1792713600000};
 const input=optimizerInput(raw);return {...raw,prices:Object.fromEntries(optimizerIncomeItems(input).map(id=>[id,{price:100}]))};
}
test('collection scoring follows first milestone quality weights and ignores coins, pets and excluded items',()=>{
 const drop=game.monsters.find(m=>m.id===7).drop;
 const items=Object.fromEntries([0,1,2,3,4].map(tier=>[game.withRarity(drop,tier),2]));
 assert.equal(collectionScore({normalItems:items,rareItems:{[game.combatPetItem(7)]:10000},coins:999999}),288);
 assert.equal(collectionScore({collectionItems:items,normalItems:{},rareItems:{}}),288);
 assert.throws(()=>collectionScore({normalItems:{[drop]:NaN}}),/invalidOptimizerCollection/);
});
test('both collection objectives rank weighted output without consulting prices in both allocation modes',()=>{
 for(const objective of ['combatCollection','gatherCollection'])for(const allocationMode of ['reset','remaining']){
  const raw=objective==='combatCollection'?{...input(82),objective}:gatheringInput(objective,82);
  raw.allocationMode=allocationMode;raw.current.enhance=1;raw.prices={};
  const drop=objective==='combatCollection'?game.monsters.find(m=>m.id===7).drop:gatheringJobs.find(j=>j.id===raw.jobId).output.itemId;
  const result=optimizeMastery(raw,{simulate:s=>({deaths:0,endedEarly:false,coins:999999-s.masteries.rare*1000,normalItems:{[drop]:100,[game.withRarity(drop,4)]:s.masteries.rare},rareItems:{}})});
  assert.equal(result.plans[0].ranks.rare,allocationMode==='reset'?2:1);
  assert.equal(result.plans[0].stats.mean,allocationMode==='reset'?300:200);
  for(const plan of result.plans){assert.ok(plan.cost<=raw.totalPoints);assert.equal(plan.ranks.enhance,allocationMode==='reset'?0:1);}
 }
});
test('gather income validates tasks and all possible prices, and includes XP in its independent policy',()=>{
 const raw=gatheringInput(),input=optimizerInput(raw);
 assert.deepEqual(optimizerPolicy(raw.objective).tracks,['gather','move','rare','xp']);
 const missing=optimizerIncomeItems(input)[0];delete raw.prices[missing];assert.throws(()=>checkOptimizerPrices(input,raw.prices),/missingOptimizerPrices/);
 raw.prices[missing]={price:0};assert.doesNotThrow(()=>checkOptimizerPrices(input,raw.prices));
 assert.throws(()=>optimizerInput({...raw,jobId:-1}),/invalidOptimizerJob/);
 const high=gatheringJobs.find(j=>j.levelReq>1);assert.throws(()=>optimizerInput({...raw,jobId:high.id}),/levelTooLow/);
 assert.throws(()=>optimizerInput({...raw,gathering:null}),/invalidOptimizerGathering/);
 const result=optimizeMastery(raw,{simulate:s=>({endedEarly:false,coins:10+s.masteries.xp*20,normalItems:{},rareItems:{}})});
 assert.equal(result.plans[0].ranks.xp,1);
});
test('real gathering objectives match independent full-duration simulation and preserve frozen input',()=>{
 for(const objective of ['gatherIncome','gatherCollection']){
  const raw=gatheringInput(objective,0),before=structuredClone(raw),result=optimizeMastery(raw);
  const job=gatheringJobs.find(j=>j.id===raw.jobId);
  const values=reviewSeeds.map(seed=>{const sample=simulateGatheringJob({...optimizerInput(raw).gathering,masteries:zero()},job,{seed,now:raw.now});
   return objective==='gatherIncome'?valueRewards(sample,raw.prices).totalIncome:Object.entries(sample.collectionItems).reduce((sum,[id,qty])=>sum+(game.isPet(Number(id))||game.collectionExcluded(Number(id))?0:qty*[1,3,10,30,100][game.itemTier(Number(id))]),0);
  });
  assert.equal(result.plans[0].stats.mean,sampleStats(values).mean);assert.deepEqual(raw,before);
 }
});

test('discarded gathering production remains in collection totals while income only retains carried goods',()=>{
 const raw=gatheringInput('gatherCollection'),job=gatheringJobs.find(j=>j.id===raw.jobId);
 raw.gathering.simulationHours=1;
 const sample=simulateGatheringJob({...raw.gathering,discardGathered:true},job,{seed:reviewSeeds[0],now:raw.now});
 const main=items=>Object.entries(items).filter(([id])=>game.baseItemId(Number(id))===job.output.itemId).reduce((sum,[,qty])=>sum+qty,0);
 assert.ok(Math.abs(main(sample.collectionItems)-sample.completed*job.output.qty)<1e-8);
 assert.ok(main(sample.collectionItems)>main(sample.normalItems));
});
test('plain products require only normal price; non-ironman mount qualities remain covered',()=>{
 const raw=gatheringInput(),job=gatheringJobs.find(j=>j.plain);assert.ok(job);
 raw.jobId=job.id;raw.gathering.levels[job.skill]=game.maxLevel;
 const ids=optimizerIncomeItems(optimizerInput(raw));assert.ok(ids.includes(job.output.itemId));
 for(let tier=1;tier<=4;tier++){assert.ok(!ids.includes(game.withRarity(job.output.itemId,tier)));assert.ok(ids.includes(game.withRarity(game.mountItemId,tier)));}
});

test('all optimizer goals freeze 24 hours regardless of source duration without mutating it',()=>{
 for(const objective of ['combatIncome','combatCollection','gatherIncome','gatherCollection'])for(const hours of [1/60,1,72]){
  const raw=objective.startsWith('gather')?gatheringInput(objective,0):{...input(0),objective};
  const source=objective.startsWith('gather')?raw.gathering:raw.combat.manual;
  source.simulationHours=hours;source.customSimulation=true;const before=structuredClone(raw);
  const result=optimizeMastery(raw,{simulate:(state,target,options)=>{
   if(objective.startsWith('gather')){assert.equal(options.collectSamples,false);assert.equal(options.rewardMode,objective==='gatherCollection'?'collection':'income');}
   const settings=objective.startsWith('gather')?state:state.manual;
   assert.equal(settings.simulationHours,24);assert.equal(settings.customSimulation,false);
   return {deaths:0,endedEarly:false,coins:10,normalItems:{},rareItems:{}};
  }});
  assert.equal(result.hours,24);assert.deepEqual(raw,before);
 }
});

test('XP goals search XP without prices and preserve budget floors in both modes',()=>{
 for(const objective of ['combatXp','gatherXp','craftXp'])for(const allocationMode of ['reset','remaining']){
  const raw=xpInput(objective,82);raw.current.enhance=1;raw.allocationMode=allocationMode;
  const before=structuredClone(raw),calls=[];
  const result=optimizeMastery(raw,{simulate:(state,job,tierOrOptions,options)=>{
   calls.push(state.masteries);assert.equal((objective==='combatXp'?state.manual:state).simulationHours,24);
   if(objective==='craftXp'){assert.equal(tierOrOptions,0);assert.ok(options.seed);}
   return {xp:100+state.masteries.xp*1000,deaths:0,endedEarly:false,complete:true,error:null};
  }});
  assert.equal(result.plans[0].ranks.xp,allocationMode==='reset'?2:1);
  assert.equal(result.plans[0].stats.mean,allocationMode==='reset'?2100:1100);
  assert.ok(calls.some(r=>r.xp>0));assert.deepEqual(optimizerIncomeItems(optimizerInput(raw)),[]);
  assert.ok(!optimizerPolicy(objective).ignoreLevelUpsForGeneration);
  for(const p of result.plans){assert.ok(p.cost<=82);assert.equal(p.ranks.enhance,allocationMode==='reset'?0:1);}
  assert.deepEqual(raw,before);
 }
});

import {craftingDefaults,craftingJobs,craftingTiers} from '../src/crafting-model.js';
import {simulateCraftingWindow} from '../src/crafting-simulation.js';
function xpInput(objective,points=0){
 if(objective==='gatherXp')return {...gatheringInput(objective,points),prices:{}};
 if(objective==='combatXp')return {...input(points),objective,prices:{}};
 const crafting=craftingDefaults();crafting.simulationHours=1;crafting.hotSetting='off';
 return {objective,totalPoints:points,current:zero(),effort:'fast',recipeId:craftingJobs.find(j=>j.levelReq===1).id,tier:0,crafting,prices:{},now:1792713600000};
}
test('real 24-hour XP scores equal source simulators for combat, gathering, crafting and upgrades',()=>{
 const upgrade=craftingJobs.find(j=>j.upgrade);
 for(const objective of ['combatXp','gatherXp','craftXp','upgrade']){
  const raw=xpInput(objective==='upgrade'?'craftXp':objective);
  if(objective==='upgrade'){raw.recipeId=upgrade.id;raw.crafting.levels[upgrade.skill]=upgrade.levelReq;raw.tier=4;}
  const before=structuredClone(raw),validated=optimizerInput(raw),result=optimizeMastery(raw);
  const values=reviewSeeds.map(seed=>{
   const options={seed,now:raw.now};
   if(raw.objective==='craftXp')return simulateCraftingWindow({...validated.crafting,masteries:zero()},validated.job,raw.tier,options).xp;
   if(raw.objective==='gatherXp')return simulateGatheringJob({...validated.gathering,masteries:zero()},validated.job,options).xp;
   const sample=simulateMonster({...validated.combat,masteries:zero()},validated.monster,options);
   assert.equal(sample.xp,Object.values(sample.bySkill).reduce((a,b)=>a+b,0));return sample.xp;
  });
  assert.ok(result.plans[0].stats.mean>0);assert.equal(result.plans[0].stats.mean,sampleStats(values).mean);assert.deepEqual(raw,before);
 }
});
test('XP goals reject invalid gains and incomplete runs; crafting validates recipe, tier and level',()=>{
 for(const objective of ['combatXp','gatherXp','craftXp']){
  const raw=xpInput(objective);
  for(const xp of [NaN,Infinity,-1,undefined])assert.throws(()=>optimizeMastery(raw,{simulate:()=>({xp,deaths:0,complete:true})}),/invalidOptimizerXp/);
  assert.throws(()=>optimizeMastery(raw,{simulate:()=>({xp:100,deaths:0,endedEarly:true,complete:false})}),/noViableOptimizerPlan/);
 }
 const raw=xpInput('craftXp');assert.throws(()=>optimizerInput({...raw,crafting:null}),/invalidOptimizerCrafting/);
 assert.throws(()=>optimizerInput({...raw,recipeId:-1}),/invalidOptimizerRecipe/);
 assert.throws(()=>optimizerInput({...raw,tier:5}),/invalidOptimizerTier/);
 const high=craftingJobs.find(j=>j.levelReq>1);assert.throws(()=>optimizerInput({...raw,recipeId:high.id,tier:craftingTiers(high)[0]}),/levelTooLow/);
 assert.throws(()=>optimizeMastery(raw,{simulate:()=>({xp:100,complete:true,error:'routeStopped'})}),/noViableOptimizerPlan/);
});

test('fast work search scores four goals deterministically without running a simulator',()=>{
 for(const objective of ['gatherIncome','gatherCollection','gatherXp','craftXp']){
  const raw={...(objective.endsWith('Xp')?xpInput(objective,82):gatheringInput(objective,82)),workMode:'fast'};
  const before=structuredClone(raw);
  const result=optimizeMastery(raw,{simulate:()=>assert.fail('fast mode ran a simulation')});
  assert.equal(result.workMode,'fast');assert.equal(result.simulations,0);
  assert.deepEqual(result.screeningSeeds,[]);assert.deepEqual(result.reviewSeeds,[]);
  assert.ok(result.plans[0].stats.mean>0);assert.equal(result.plans[0].stats.se,0);
  assert.deepEqual(optimizeMastery(raw),result);assert.deepEqual(raw,before);
  assert.ok(result.plans.every(plan=>plan.cost<=raw.totalPoints));
 }
 const combat=optimizeMastery({...input(0),workMode:'fast'},{simulate:()=>({deaths:0,coins:10,normalItems:{},rareItems:{}})});
 assert.equal(combat.workMode,'standard');assert.equal(combat.simulations,7);
});

test('fast work uses gathering success and discard rules and native crafting quality and upgrade XP',()=>{
 const score=raw=>optimizeMastery({...raw,workMode:'fast'}).plans[0].stats.mean;
 const income=gatheringInput('gatherIncome',0),collection=gatheringInput('gatherCollection',0);
 income.gathering.ironman=true;collection.gathering.ironman=true;
 const discard=raw=>({...raw,gathering:{...raw.gathering,discardGathered:true}});
 assert.ok(score(discard(income))<score(income)/10);
 assert.ok(score(discard(collection))>=score(collection));
 const theft=gatheringJobs.find(job=>job.caught),gather=xpInput('gatherXp');
 gather.jobId=theft.id;gather.gathering.levels[theft.skill]=theft.levelReq;
 assert.ok(score({...gather,gathering:{...gather.gathering,perks:{hands:5}}})>score(gather));
 assert.ok(score({...gather,gathering:{...gather.gathering,weeklyXp:60}})>score(gather));
 assert.throws(()=>score({...income,prices:{}}),/missingOptimizerPrices/);
 const craft=xpInput('craftXp');
 assert.ok(score({...craft,tier:1})>score(craft));
 const upgrade=craftingJobs.find(job=>job.upgrade);craft.recipeId=upgrade.id;
 craft.crafting.levels[upgrade.skill]=upgrade.levelReq;
 assert.ok(score(craft)>0);assert.equal(score({...craft,tier:4}),score(craft));
});

test('fast gathering counts the two fishing rarity windows once',()=>{
 const job=gatheringJobs.find(j=>j.skill==='fishing'&&j.levelReq===1);
 const raw={...gatheringInput('gatherIncome',0),jobId:job.id,workMode:'fast'};
 Object.assign(raw.gathering,{ironman:true,discardGathered:true});
 const ids=optimizerIncomeItems(optimizerInput(raw)),legendary=game.withRarity(job.output.itemId,4);
 raw.prices=Object.fromEntries(ids.map(id=>[id,{price:Number(id===legendary)}]));
 const score=hotSetting=>optimizeMastery({...raw,gathering:{...raw.gathering,hotSetting}}).plans[0].stats.mean;
 assert.ok(Math.abs(score('game')/score('off')-(1+.25/24))<.0001);
});

test('fast mining XP reflects the extra pack pressure from Keyfinder when banking',()=>{
 const raw=gatheringInput('gatherXp',0);
 const job=gatheringJobs.find(job=>job.id===2);
 const gathering={...raw.gathering,levels:{...raw.gathering.levels,mining:job.levelReq},simulationHours:24};
 const keyfinder={earring:{id:game.earringIds.keyfinder,tier:4,plus:25}};
 const score=(gear,discardGathered)=>optimizeMastery({...raw,jobId:job.id,workMode:'fast',
  gathering:{...gathering,gear,discardGathered}}).plans[0].stats.mean;
 assert.ok(score(keyfinder,false)<score({},false));
 assert.equal(score(keyfinder,true),score({},true));
});

test('both mastery modes value retained dungeon keys with the same frozen price inputs',()=>{
 const raw=gatheringInput('gatherIncome',0);
 Object.assign(raw.gathering,{ironman:true,discardGathered:true});
 const input=optimizerInput(raw),ids=optimizerIncomeItems(input);
 assert.ok(ids.includes(909));
 assert.ok(!ids.includes(910));
 const prices=Object.fromEntries(ids.map(id=>[id,{price:id===909?10:0}]));
 for(const workMode of ['fast','standard']){
  const result=optimizeMastery({...raw,prices,workMode});
  assert.ok(result.plans[0].stats.mean>0,workMode);
 }
});
