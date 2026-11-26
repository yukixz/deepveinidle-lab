import {game} from './model.js';
import {optimizerInput,optimizerScenario,optimizerPolicy,optimizerWorkMode,checkOptimizerPrices} from './mastery-optimizer.js';
import {craftingJobs} from './crafting-model.js';
import {gatheringJobs} from './gathering-model.js';

export const masteryResultStorageKey='dvi-mastery-results-v1';
// Bump when simulation, search, valuation, or upstream rules change incompatibly.
export const masteryResultEngine='mastery-1/game-1.0.1221/combat-1.0.1225';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const number=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')?Number(v):NaN;
function requireValue(ok){if(!ok)throw Error('invalidSavedMasteryResult');}
function ranks(value){requireValue(object(value)&&Object.keys(value).length===game.masteries.length&&game.masteries.every(m=>integer(value[m.id])&&value[m.id]<=game.masteryRankLimit));}
function stats(value){requireValue(object(value)&&['mean','sd','se'].every(k=>Number.isFinite(value[k]))&&value.sd>=0&&value.se>=0);}
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(object(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function optimizerContext(raw){
 const policy=optimizerPolicy(raw.objective),gathering=policy.gathering;
 return {objective:raw.objective,allocationMode:raw.allocationMode,totalPoints:number(raw.totalPoints),current:Object.fromEntries(game.masteries.map(m=>[m.id,number(raw.current?.[m.id])])),effort:raw.effort,
  ...((policy.gathering||policy.crafting)&&raw.workMode!==undefined?{workMode:optimizerWorkMode(policy,raw.workMode)}:{}),
  ...(policy.crafting?{recipeId:raw.recipeId,tier:raw.tier,crafting:optimizerScenario(raw.objective,{...raw.crafting,skill:craftingJobs.find(j=>j.id===raw.recipeId)?.skill})}:gathering?{jobId:raw.jobId,gathering:optimizerScenario(raw.objective,{...raw.gathering,skill:gatheringJobs.find(j=>j.id===raw.jobId)?.skill})}:{monsterId:raw.monsterId,combat:optimizerScenario(raw.objective,raw.combat)})};
}
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
export function optimizerTaskKey(raw){
 const context=optimizerContext(raw),policy=optimizerPolicy(context.objective),gathering=policy.gathering,work=gathering||policy.crafting;
 const source=policy.crafting?context.crafting:gathering?context.gathering:context.combat,settings=work?source:source.manual;
 // Only running tasks compare inputs; saved allocations never use this key.
 // Compare whole groups, without source-page filters or overridden masteries.
 const scenario={...pick(source,['levels','gear','brews','house']),
  perks:work?source.perks:{...settings.perks,meals:source.meals},
  buffs:pick(settings,['guildXp','weeklyXp','worldRarity','blessing','hotSetting']),
  supplies:{homeBank:source.homeBank,ironman:settings.ironman,...(gathering?{discardGathered:source.discardGathered}:{coins:settings.coins,bankSlotsBought:settings.bankSlotsBought,unlimitedBank:settings.unlimitedBank})},
  ...(!work?{style:source.style,food:{...pick(source,['food','eatAt','fed','rooted']),...pick(settings,['foodRule','foodMaxTier','foodPerTrip'])}}:{})};
 return JSON.stringify(stable({...pick(context,['objective','allocationMode','totalPoints','current']),...(work?{workMode:optimizerWorkMode(policy,context.workMode)}:{}),...(policy.crafting?{recipeId:context.recipeId,tier:context.tier}:gathering?{jobId:context.jobId}:{monsterId:context.monsterId}),scenario}));
}
export function validateComputedMasteryResult(record){
 requireValue(object(record));
 if(record.engine!==masteryResultEngine)throw Error('savedMasteryVersion');
 requireValue(object(record.input)&&object(record.plan)&&object(record.baseline));
 const raw=record.input;requireValue(integer(raw.now)&&raw.now>0&&object(raw.current));ranks(raw.current);
 requireValue(integer(raw.totalPoints)&&object(raw.prices));
 const input=optimizerInput(raw);checkOptimizerPrices(input,raw.prices);
 const {now,prices,...context}=raw;
 requireValue(JSON.stringify(stable(context))===JSON.stringify(stable(optimizerContext(raw))));
 const plan=record.plan,base=record.baseline;ranks(plan.ranks);ranks(base.ranks);stats(plan.stats);
 requireValue(plan.cost===game.masteriesTotalCost(plan.ranks)&&plan.cost<=input.totalPoints);
 requireValue(base.cost===game.masteriesTotalCost(base.ranks)&&base.overBudget===(base.cost>input.totalPoints)&&typeof base.viable==='boolean');
 requireValue(JSON.stringify(stable(base.ranks))===JSON.stringify(stable(input.current)));
 if(base.viable)stats(base.stats);else requireValue(base.stats===null);
 if(plan.paired!==null)stats(plan.paired);
 requireValue(plan.paired===null||base.viable&&!base.overBudget);
 if(input.allocationMode==='remaining'){
  requireValue(game.masteries.every(m=>plan.ranks[m.id]>=input.current[m.id]));
  requireValue(plan.additionalCost===plan.cost-base.cost);
 }else requireValue(plan.additionalCost===null);
 return record;
}
export function validateSavedMasteryPlan(record){
 // Historical inputs and metrics never gate recovery of a legal allocation.
 requireValue(object(record)&&object(record.plan));ranks(record.plan.ranks);return record;
}
export function masteryResultHistory(record){
 try{
  requireValue(typeof record.engine==='string'&&record.engine.length>0&&object(record.input)&&object(record.baseline));
  const input=record.input;requireValue(integer(input.now)&&input.now>0&&input.now<=8.64e15&&integer(input.totalPoints)&&['reset','remaining'].includes(input.allocationMode));
  const policy=optimizerPolicy(input.objective),workMode=optimizerWorkMode(policy,input.workMode);stats(record.plan.stats);requireValue(record.plan.stats.mean>=0);
  if(record.plan.paired!==null)stats(record.plan.paired);
  requireValue(typeof record.baseline.overBudget==='boolean'&&typeof record.baseline.viable==='boolean');
  return {available:true,oldEngine:record.engine!==masteryResultEngine,input,plan:record.plan,baseline:record.baseline,policy,workMode};
 }catch{return {available:false,oldEngine:record?.engine!==masteryResultEngine};}
}
export function createMasteryResult(request,result,index=0){
 requireValue(object(result)&&result.objective===request.objective&&result.allocationMode===request.allocationMode&&result.totalPoints===request.totalPoints&&Array.isArray(result.plans));
 const policy=optimizerPolicy(request.objective);
 requireValue(optimizerWorkMode(policy,request.workMode)===optimizerWorkMode(policy,result.workMode));
 const plan=result.plans[index];requireValue(object(plan));
 const input={...optimizerContext(request),now:request.now,prices:structuredClone(request.prices)};
 return structuredClone(validateComputedMasteryResult({engine:masteryResultEngine,input,baseline:result.baseline,plan:{ranks:plan.ranks,cost:plan.cost,additionalCost:plan.additionalCost,stats:plan.stats,paired:plan.paired}}));
}
export function emptyMasteryResults(){return {version:1,revision:0,manual:null,auto:null};}
function validateStore(value){
 requireValue(object(value));if(value.version!==1)throw Error('savedMasteryVersion');
 requireValue(integer(value.revision));
 for(const slot of ['manual','auto'])if(value[slot]!==null)validateSavedMasteryPlan(value[slot]);
 return {version:1,revision:value.revision,manual:value.manual,auto:value.auto};
}
export function readMasteryResults(storage){
 const raw=storage.getItem(masteryResultStorageKey);return raw===null?emptyMasteryResults():validateStore(JSON.parse(raw));
}
export function writeMasteryResults(storage,previous,next){
 const current=readMasteryResults(storage);
 if(JSON.stringify(current)!==JSON.stringify(previous))throw Error('savedMasteryConflict');
 const value=validateStore({...next,version:1,revision:current.revision+1});
 storage.setItem(masteryResultStorageKey,JSON.stringify(value));return value;
}
