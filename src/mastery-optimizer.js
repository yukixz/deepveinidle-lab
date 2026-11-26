import * as game from './upstream.js';
import {maxHit as combatMaxHit,maxHp as combatMaxHp} from './upstream-combat.js';
import {normalize,makePlayer} from './model.js';
import {simulateMonster} from './simulation.js';
import {normalizeGathering,gatheringJobs} from './gathering-model.js';
import {simulateGatheringJob} from './gathering-simulation.js';
import {normalizeCrafting,craftingJobs,craftingTiers} from './crafting-model.js';
import {simulateCraftingWindow} from './crafting-simulation.js';
import {valueRewards,validPrice} from './item-prices.js';
import {createMasteryWorkEstimator} from './mastery-work-estimate.js';

const optimizerTracks=['xp','move','hp','maxhit','accuracy','rare'];
export const optimizerHours=24;
export const optimizerEfforts={fast:60,standard:120,deep:360,comprehensive:720};
const searchSettings={
 fast:{beam:1,directions:2,donors:1,starts:2,pairs:false,patience:1,flatStages:2},
 standard:{beam:2,directions:3,donors:2,starts:5,pairs:false,patience:1,flatStages:3},
 deep:{beam:3,directions:5,donors:3,starts:5,pairs:true,patience:2,flatStages:4},
 comprehensive:{beam:4,directions:5,donors:5,starts:5,pairs:true,patience:3,flatStages:6},
};
export function optimizerPolicy(objective){
 if(objective==='combatXp')return {tracks:['xp','maxhit','accuracy','move','hp','rare'],experience:true};
 if(objective==='gatherXp')return {tracks:['gather','move','rare','xp'],gathering:true,experience:true};
 if(objective==='craftXp')return {tracks:['craft','xp','move'],crafting:true,experience:true};
 if(['combatIncome','combatCollection'].includes(objective))return {tracks:['maxhit','accuracy','rare','move','hp'],ignoreLevelUpsForGeneration:true,collection:objective==='combatCollection'};
 if(['gatherIncome','gatherCollection'].includes(objective))return {tracks:['gather','move','rare','xp'],gathering:true,collection:objective==='gatherCollection'};
 throw Error('unsupportedObjective');
}
export function optimizerWorkMode(policy,mode='standard'){
 if(!policy.gathering&&!policy.crafting)return 'standard';
 if(mode!=='fast'&&mode!=='standard')throw Error('invalidOptimizerWorkMode');
 return mode;
}
export function combatIncomeGeneration(combat,floor){
 const {player}=makePlayer(combat),cache=new Map();
 const value=(r,id,n)=>{
  const ranks={...r,[id]:n},k=id+':'+key(ranks);if(cache.has(k))return cache.get(k);
  player.masteries=ranks;const v=id==='hp'?combatMaxHp(player):combatMaxHit(player);cache.set(k,v);return v;
 };
 const canonicalRank=(r,id,n)=>{
  const target=value(r,id,n);let lo=floor[id],hi=n;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(value(r,id,mid)>=target)hi=mid;else lo=mid+1;}return lo;
 };
 return {
  canonicalize:r=>{const result={...r};for(const id of ['hp','maxhit'])result[id]=canonicalRank(result,id,result[id]);return result;},
  nextRank:(r,id,n)=>{
   if(n<floor[id]||n>game.masteryRankLimit||!['hp','maxhit'].includes(id))return n;
   const rank=canonicalRank(r,id,n);if(n<=r[id]||rank>r[id])return rank;
   const before=value(r,id,r[id]);if(value(r,id,game.masteryRankLimit)===before)return game.masteryRankLimit+1;
   let lo=n,hi=game.masteryRankLimit;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(value(r,id,mid)>before)hi=mid;else lo=mid+1;}return lo;
  },
 };
}
export const screeningSeeds=[20261023,798997366];
export const reviewSeeds=[1426429260,20261024,371993,100718,20261025];
const zero=()=>Object.fromEntries(game.masteries.map(m=>[m.id,0]));
const key=r=>game.masteries.map(m=>r[m.id]).join(',');
const cost=r=>game.masteriesTotalCost(r);
function readRanks(raw){
 const ranks=zero();
 for(const m of game.masteries){const n=raw?.[m.id];if(!Number.isSafeInteger(n)||n<0||n>game.masteryRankLimit)throw Error('invalidOptimizerRanks');ranks[m.id]=n;}
 return ranks;
}
function allocationFloor(allocationMode,current,totalPoints){
 if(allocationMode==='reset')return zero();
 if(allocationMode!=='remaining')throw Error('invalidOptimizerMode');
 const floor=readRanks(current);
 if(cost(floor)>totalPoints)throw Error('optimizerCurrentOverBudget');
 return floor;
}
export function affordableRank(points){
 let lo=0,hi=game.masteryRankLimit;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(game.masteryTotalCost(mid)<=points)lo=mid;else hi=mid-1;}
 return lo;
}
export function optimizerScenario(objective,raw){
 if(optimizerPolicy(objective).crafting)return normalizeCrafting({...raw,simulationHours:optimizerHours});
 return optimizerPolicy(objective).gathering
  ?normalizeGathering({...raw,simulationHours:optimizerHours,customSimulation:false})
  :normalize({...raw,manual:{...raw?.manual,simulationHours:optimizerHours,customSimulation:false}});
}
export function optimizerInput(raw){
 const policy=optimizerPolicy(raw?.objective);
 const workMode=optimizerWorkMode(policy,raw.workMode);
 if(!Number.isSafeInteger(raw.totalPoints)||raw.totalPoints<0)throw Error('invalidOptimizerPoints');
 if(!Object.hasOwn(optimizerEfforts,raw.effort))throw Error('invalidOptimizerEffort');
 const current=readRanks(raw.current),allocationMode=raw.allocationMode===undefined?'reset':raw.allocationMode;
 const floor=allocationFloor(allocationMode,current,raw.totalPoints);
 if(!Number.isSafeInteger(raw.now)||raw.now<=0)throw Error('invalidOptimizerScenario');
 if(policy.crafting){
  if(!raw.crafting||typeof raw.crafting!=='object')throw Error('invalidOptimizerCrafting');
  const job=craftingJobs.find(j=>j.id===raw.recipeId);if(!job)throw Error('invalidOptimizerRecipe');
  if(!craftingTiers(job).includes(raw.tier))throw Error('invalidOptimizerTier');
  const crafting=optimizerScenario(raw.objective,{...raw.crafting,skill:job.skill});
  if(crafting.levels[job.skill]<job.levelReq)throw Error('levelTooLow');
  return {...raw,allocationMode,workMode,current,availablePoints:raw.totalPoints-cost(floor),crafting,job};
 }
 if(policy.gathering){
  if(!raw.gathering||typeof raw.gathering!=='object')throw Error('invalidOptimizerGathering');
  const job=gatheringJobs.find(j=>j.id===raw.jobId);if(!job)throw Error('invalidOptimizerJob');
  const gathering=optimizerScenario(raw.objective,{...raw.gathering,skill:job.skill});
  if(gathering.levels[job.skill]<job.levelReq)throw Error('levelTooLow');
  return {...raw,allocationMode,workMode,current,availablePoints:raw.totalPoints-cost(floor),gathering,job};
 }
 const monster=game.monsters.find(m=>m.id===raw.monsterId);if(!monster)throw Error('invalidOptimizerMonster');
 if(!raw.combat||typeof raw.combat!=='object')throw Error('invalidOptimizerScenario');
 return {...raw,allocationMode,workMode,current,availablePoints:raw.totalPoints-cost(floor),combat:optimizerScenario(raw.objective,raw.combat),monster};
}
// All possible income items, including qualities absent from one random trial.
export function combatIncomeItems(combat,monster){
 const ids=new Set([monster.bonus.itemId,game.combatPetItem(monster.id),game.voidShardItemId]);
 for(let tier=0;tier<=4;tier++){ids.add(game.withRarity(monster.drop,tier));if(!combat.manual.ironman)ids.add(game.withRarity(game.mountItemId,tier));}
 return [...ids];
}
export function optimizerIncomeItems(input){
 const policy=optimizerPolicy(input.objective);
 if(policy.collection||policy.experience)return [];
 if(!policy.gathering)return combatIncomeItems(input.combat,input.monster);
 const ids=new Set(),add=(id,plain=false,minTier=0)=>{if(id===game.coinItemId)return;for(let tier=minTier;tier<=(plain||!game.itemSupportsRarity(id)?0:4);tier++)ids.add(game.withRarity(id,tier));};
 add(input.job.output.itemId,input.job.plain);
 if(input.job.bonus)add(input.job.bonus.itemId,false,game.bonusMinimumUncommon(input.job.bonus.itemId)?1:0);
 if(!input.gathering.ironman)add(game.mountItemId);
 return [...ids];
}
export function checkOptimizerPrices(input,prices){
 const missing=optimizerIncomeItems(input).filter(id=>!game.isPet(id)&&!validPrice(prices?.[id]?.price));
 if(missing.length){const error=Error('missingOptimizerPrices');error.itemIds=missing;throw error;}
}
// Collection quality weights are the first milestone's original mastery reward.
export function collectionScore(result){
 let score=0;
 const sources=result.collectionItems?[result.collectionItems]:[result.normalItems,result.rareItems];
 for(const items of sources)for(const [rawId,qty]of Object.entries(items??{})){
  const id=Number(rawId);
  if(!Number.isFinite(qty)||qty<0)throw Error('invalidOptimizerCollection');
  if(id===game.coinItemId||game.isPet(id)||game.collectionExcluded(id))continue;
  score+=qty*game.collectionPoints(1,game.itemTier(id),game.baseItemId(id));
 }
 if(!Number.isFinite(score))throw Error('invalidOptimizerCollection');
 return score;
}
export function sampleStats(values){
 const mean=values.reduce((a,b)=>a+b,0)/values.length;
 const sd=values.length>1?Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/(values.length-1)):0;
 return {mean,sd,se:sd/Math.sqrt(values.length)};
}
// Generic search accepts an explicit target policy; unsupported objectives never
// inherit combat-income assumptions through the application entry point.
export function searchMasteryAllocations({totalPoints,current,allocationMode='reset',maxCandidates,effort='standard',tracks=optimizerTracks,canonicalize=r=>({...r}),nextRank=(r,id,n)=>n,evaluate}){
 if(!Number.isSafeInteger(totalPoints)||totalPoints<0||!Number.isSafeInteger(maxCandidates)||maxCandidates<1)throw Error('invalidOptimizerPoints');
 const settings=searchSettings[effort];if(!settings)throw Error('invalidOptimizerEffort');
 const floor=allocationFloor(allocationMode,current,totalPoints),available=totalPoints-cost(floor),seen=new Map(),priority=Object.fromEntries(tracks.map(id=>[id,0]));
 const rank=(a,b)=>b.score-a.score||a.cost-b.cost||key(a.ranks).localeCompare(key(b.ranks));
 function visit(raw){
  const ranks=canonicalize(raw),id=key(ranks);if(seen.has(id))return seen.get(id);
  if(seen.size>=maxCandidates||cost(ranks)>totalPoints||game.masteries.some(m=>ranks[m.id]<floor[m.id]||!tracks.includes(m.id)&&ranks[m.id]!==floor[m.id]))return null;
  const result={ranks:{...ranks},cost:cost(ranks),score:evaluate({...ranks})};seen.set(id,result);return result;
 }
 const exhaustive=[];
 function enumerate(index,left,ranks){
  if(exhaustive.length>maxCandidates)return;
  if(index===tracks.length){exhaustive.push({...ranks});return;}
  const id=tracks[index],base=game.masteryTotalCost(floor[id]),max=affordableRank(left+base);
  for(let n=floor[id];n<=max&&exhaustive.length<=maxCandidates;){
   ranks[id]=n;enumerate(index+1,left-(game.masteryTotalCost(n)-base),ranks);
   const next=nextRank(ranks,id,n+1);if(next<=n)break;n=next;
  }
  ranks[id]=floor[id];
 }
 enumerate(0,available,{...floor});
 if(exhaustive.length<=maxCandidates){for(const r of exhaustive)visit(r);const candidates=[...seen.values()].sort(rank);return {candidates,reviewCandidates:candidates.filter(c=>Number.isFinite(c.score)).slice(0,5),exhaustive:true,stopReason:'exhaustive'};}
 const previous={standard:'fast',deep:'standard',comprehensive:'deep'}[effort];
 // Reuse the lower effort's candidate set before broadening the search.
 // The outer visit owns evaluation, so recursive phases never re-simulate ranks.
 const inherited=previous?searchMasteryAllocations({totalPoints,current,allocationMode,maxCandidates:Math.min(maxCandidates,optimizerEfforts[previous]),effort:previous,tracks,canonicalize,nextRank,evaluate:r=>visit(r).score}).reviewCandidates:[];
 const base=visit(floor);
 if(current&&cost(current)<=totalPoints)visit({...floor,...Object.fromEntries(tracks.map(id=>[id,current[id]??0]))});
 const spread=ids=>{const r={...floor};for(const id of ids)r[id]=affordableRank(game.masteryTotalCost(floor[id])+Math.floor(available/ids.length));return r;};
 visit(spread(tracks));
 const extraRanks=id=>affordableRank(game.masteryTotalCost(floor[id])+available)-floor[id];
 // Combat policy supplies a useful initial order; generic tests keep their order.
 for(const id of [...new Set([...tracks.slice(0,settings.starts),...tracks.filter(id=>id==='hp')])]){
  const r=visit({...floor,[id]:floor[id]+extraRanks(id)});
  if(r&&Number.isFinite(r.score)&&Number.isFinite(base.score))priority[id]=Math.max(0,r.score-base.score);
 }
 if(settings.pairs)for(let i=0;i<tracks.length;i++)for(let j=i+1;j<tracks.length;j++){
  if(effort==='deep'&&i>1)continue;visit(spread([tracks[i],tracks[j]]));
 }
 function beam(){
  const sorted=[...seen.values()].sort(rank),selected=[];
  for(const candidate of sorted){
   if(selected.every(other=>tracks.reduce((sum,id)=>sum+Math.abs(candidate.ranks[id]-other.ranks[id])/Math.max(1,extraRanks(id)),0)>=.1))selected.push(candidate);
   if(selected.length===settings.beam)break;
  }
  for(const candidate of sorted){if(selected.length===settings.beam)break;if(!selected.includes(candidate))selected.push(candidate);}
  return selected;
 }
 const steps=[];for(let step=2**Math.floor(Math.log2(Math.max(1,...tracks.map(extraRanks))));step>=1;step/=2)steps.push(step);
 const improved=(before,after)=>after>before+Math.max(1,Math.abs(before))*1e-9||before===-Infinity&&after>-Infinity;
 let flatStages=0,stopReason='stalled';
 for(let stage=0;stage<steps.length&&seen.size<maxCandidates;stage++){
  const step=steps[stage],stageBest=[...seen.values()].sort(rank)[0].score;
  const limit=Math.min(maxCandidates,seen.size+Math.ceil((maxCandidates-seen.size)/(steps.length-stage)));
  let flatRounds=0,round=0;
  while(seen.size<limit&&flatRounds<settings.patience){
   const before=seen.size,best=[...seen.values()].sort(rank)[0].score;
   const ordered=[...tracks].sort((a,b)=>priority[b]-priority[a]||tracks.indexOf(a)-tracks.indexOf(b));
   const directions=[...new Set([...ordered.slice(0,settings.directions),tracks[(stage+round)%tracks.length]])];
   for(const root of beam())for(const id of directions){
    if(seen.size>=limit)break;
    for(const direction of [1,-1]){
     if(seen.size>=limit)break;
     const n=nextRank(root.ranks,id,root.ranks[id]+direction*step);
     if(n<floor[id]||n>game.masteryRankLimit)continue;
     const candidate=visit({...root.ranks,[id]:n});
     if(candidate&&Number.isFinite(candidate.score)&&Number.isFinite(root.score))priority[id]=Math.max(priority[id],candidate.score-root.score);
    }
    const donors=tracks.filter(d=>d!==id&&root.ranks[d]>floor[d]).sort((a,b)=>priority[a]-priority[b]||tracks.indexOf(a)-tracks.indexOf(b)).slice(0,settings.donors);
    for(const donor of donors){
     if(seen.size>=limit)break;
     const r={...root.ranks};r[donor]=Math.max(floor[donor],r[donor]-step);r[id]=floor[id];
     const normalized=canonicalize(r);normalized[id]=0;normalized[id]=affordableRank(totalPoints-cost(normalized));visit(normalized);
    }
   }
   const after=[...seen.values()].sort(rank)[0].score;
   flatRounds=improved(best,after)?0:flatRounds+1;round++;
   if(seen.size===before)break;
  }
  flatStages=improved(stageBest,[...seen.values()].sort(rank)[0].score)?0:flatStages+1;
  // Always retain a fine-step pass, even after coarse stages stop improving.
  if(flatStages>=settings.flatStages&&stage<steps.length-2)stage=steps.length-2;
 }
 if(seen.size>=maxCandidates)stopReason='limit';
 const candidates=[...seen.values()].sort(rank);
 const reviewCandidates=[...new Map([...inherited,...candidates.filter(c=>Number.isFinite(c.score)).slice(0,5)].map(c=>[key(c.ranks),c])).values()];
 return {candidates,reviewCandidates,exhaustive:false,stopReason};
}

export function optimizeMastery(raw,{simulate,onProgress=()=>{}}={}){
 const input=optimizerInput(raw);checkOptimizerPrices(input,input.prices);
 const policy=optimizerPolicy(input.objective),fast=input.workMode==='fast';
 const estimate=fast?createMasteryWorkEstimator(input,policy):null;
 const run=simulate??(policy.crafting?simulateCraftingWindow:policy.gathering?simulateGatheringJob:simulateMonster);
 const screen=fast?[null]:screeningSeeds,review=fast?[null]:reviewSeeds;
 const cache=new Map();let simulations=0,excluded=0;
 const maxCandidates=optimizerEfforts[input.effort];
 const progress=(phase,candidates)=>onProgress({phase,candidates,maxCandidates,simulations,excluded,workMode:input.workMode});
 function trial(ranks,seed){
  const id=`${key(ranks)}:${seed}`;if(cache.has(id))return cache.get(id);
  let result;
  if(estimate)result=estimate(ranks);
  else{
   const state={...(policy.crafting?input.crafting:policy.gathering?input.gathering:input.combat),masteries:{...ranks}};
   const options={seed,now:input.now,...(policy.gathering?{rewardMode:policy.collection?'collection':'income',collectSamples:false}:{})};
   result=policy.crafting?run(state,input.job,input.tier,options):run(state,policy.gathering?input.job:input.monster,options);simulations++;
  }
  let value=null;
  if((policy.gathering||policy.crafting||result.deaths===0)&&!result.endedEarly&&(!policy.crafting||result.complete&&!result.error)){
   if(policy.experience){if(!Number.isFinite(result.xp)||result.xp<0)throw Error('invalidOptimizerXp');value=result.xp;}
   else if(policy.collection)value=collectionScore(result);
   else {
    const valued=valueRewards(result,input.prices);
    if(valued.missingPrices.length){const error=Error('missingOptimizerPrices');error.itemIds=valued.missingPrices;throw error;}
    if(!Number.isFinite(valued.totalIncome)||valued.totalIncome<0)throw Error('invalidOptimizerIncome');value=valued.totalIncome;
   }
  }
  cache.set(id,value);return value;
 }
 let screened=0;
 const floor=allocationFloor(input.allocationMode,input.current,input.totalPoints);
 const generation=policy.ignoreLevelUpsForGeneration?combatIncomeGeneration(input.combat,floor):{};
 const tracks=fast&&!policy.experience?policy.tracks.filter(id=>id!=='xp'):policy.tracks;
 const search=searchMasteryAllocations({tracks,...generation,effort:input.effort,totalPoints:input.totalPoints,current:input.current,allocationMode:input.allocationMode,maxCandidates,evaluate:ranks=>{
  const trials=screen.map(seed=>trial(ranks,seed));screened++;
  if(trials.includes(null))excluded++;
  progress('search',screened);return trials.includes(null)?-Infinity:sampleStats(trials).mean;
 }});
 const finalists=search.reviewCandidates;
 if(!finalists.length)throw Error('noViableOptimizerPlan');
 const baseSamples=review.map(seed=>trial(input.current,seed));
 const baseline={ranks:input.current,cost:cost(input.current),overBudget:cost(input.current)>input.totalPoints,viable:!baseSamples.includes(null),stats:baseSamples.includes(null)?null:sampleStats(baseSamples)};
 progress('review',screened);
 const reviewed=[];
 for(const candidate of finalists){
  const samples=review.map(seed=>trial(candidate.ranks,seed));
  if(samples.includes(null)){excluded++;continue;}
  const paired=baseline.viable&&!baseline.overBudget?sampleStats(samples.map((v,i)=>v-baseSamples[i])):null;
  reviewed.push({...candidate,samples,stats:sampleStats(samples),paired,remaining:input.totalPoints-candidate.cost,additionalCost:input.allocationMode==='remaining'?candidate.cost-baseline.cost:null});progress('review',screened);
 }
 // Keeping the current allocation is always an option in the remaining-points
 // mode, even when it was outside the retained screening finalists.
 const baseCandidate=search.candidates.find(c=>key(c.ranks)===key(input.current));
 if(input.allocationMode==='remaining'&&baseline.viable&&Number.isFinite(baseCandidate?.score)&&!reviewed.some(c=>key(c.ranks)===key(input.current))){
  const candidate=baseCandidate;
  reviewed.push({...candidate,samples:baseSamples,stats:baseline.stats,paired:sampleStats(baseSamples.map(()=>0)),remaining:input.availablePoints,additionalCost:0});
 }
 reviewed.sort((a,b)=>b.stats.mean-a.stats.mean||a.cost-b.cost||key(a.ranks).localeCompare(key(b.ranks)));
 if(!reviewed.length)throw Error('noViableOptimizerPlan');
 return {objective:input.objective,allocationMode:input.allocationMode,workMode:input.workMode,availablePoints:input.availablePoints,totalPoints:input.totalPoints,monsterId:input.monsterId,jobId:input.jobId,hours:optimizerHours,now:input.now,effort:input.effort,screeningSeeds:fast?[]:[...screen],reviewSeeds:fast?[]:[...review],screened,simulations,excluded,exhaustive:search.exhaustive,stopReason:search.stopReason,baseline,plans:reviewed.slice(0,3)};
}
