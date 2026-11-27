import {gatheringSkills} from './domain.js';
import {callRule,requireCapability,tickMilliseconds} from './adapter.js';

// The phase transitions in pN / RN / WOo of the reviewed 1.0.1214 snapshot.
// This is an analytical approximation: initial pack is empty, all materials are
// available, the main-city warehouse is the origin, and the last batch is banked.
// Callers may provide an expected gathering capacity for the current snapshot.
export const batchTimeModel=Object.freeze({sourceVersion:'1.0.1214',version:3,
 initialCraftTicks:5,initialGatherTicks:2,turnoverTicks:6,finishTicks:2,walkStartTicks:1});
const exactTripLimit=128;
export function createBatchTimeEstimator(game,{resolveMovement}={}){
const routes=new Map(),siteRoutes=new Map();
const checked=value=>{if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw Error('quantityOverflow');return value;};
const unknown=(workSeconds,reason)=>({status:'unknownTime',seconds:null,workSeconds,overheadSeconds:null,batches:null,reason,sourceVersion:batchTimeModel.sourceVersion});

function routeLeg(from,target){
 // pN keeps the current tile when it already borders the destination. Otherwise
 // Ht chooses by Chebyshev proximity before k1 finds the actual walkable path.
 if(Math.abs(from.x-target.x)<=1&&Math.abs(from.y-target.y)<=1)return {point:from,distance:0};
 const feature='estimateBatchTime.route';
 const point=callRule(game,'siteEntrance',feature,game.world,target.x,target.y,0,from);if(!point)return null;
 if(!Number.isSafeInteger(point.x)||!Number.isSafeInteger(point.y)||Math.abs(point.x-target.x)>1||Math.abs(point.y-target.y)>1)throw Error('invalidResult');
 const path=callRule(game,'walkPath',feature,game.world,from.x,from.y,point.x,point.y);
 if(path===null)return null;
 if(!Array.isArray(path))throw Error('invalidResult');
 return {point,distance:path.length};
}

function siteRoute(site,bank,origin){
 if(siteRoutes.has(site.id))return siteRoutes.get(site.id);
 const legs=[],seen=new Map();let point=origin,route=null;
 // After each return the character occupies one of the depot's eight adjacent
 // tiles. Detect that finite state cycle once, independently of task quantity.
 for(;;){
  const key=`${point.x}:${point.y}`;
  if(seen.has(key)){
   const cycleStart=seen.get(key),cycle=legs.slice(cycleStart);
   route={siteId:site.id,bankId:bank.id,distance:legs[0].outwardDistance,returnDistance:legs[0].returnDistance,
    cycleStart,cycleLength:cycle.length,
    cycleOutwardDistance:cycle.reduce((sum,leg)=>sum+leg.outwardDistance,0),
    cycleReturnDistance:cycle.reduce((sum,leg)=>sum+leg.returnDistance,0),legs};
   route.cycleDistance=route.cycleOutwardDistance+route.cycleReturnDistance;break;
  }
  seen.set(key,legs.length);
  const outward=routeLeg(point,site);if(!outward)break;
  const returning=routeLeg(outward.point,bank);if(!returning)break;
  legs.push({bankStart:point,workPoint:outward.point,bankEnd:returning.point,
   outwardDistance:outward.distance,returnDistance:returning.distance});
  point=returning.point;
 }
 siteRoutes.set(site.id,route);return route;
}

function workRoute(jobId,siteId){
 const feature='estimateBatchTime.route',world=game.world;
 let candidates;
 if(siteId!==undefined){
  if(!Number.isSafeInteger(siteId))return null;
  requireCapability(typeof world?.siteById?.get==='function',feature,'world.siteById.get');
  const site=world.siteById.get(siteId);if(!site)return null;
  if(!Array.isArray(site.jobIds)||site.id!==siteId)throw Error('invalidResult');
  if(!site.jobIds.includes(jobId))return null;
  candidates=[site];
 }else{
  requireCapability(Array.isArray(world?.sites),feature,'world.sites');
  candidates=world.sites.filter(site=>{
   if(!site||!Array.isArray(site.jobIds))throw Error('invalidResult');
   return site.jobIds.includes(jobId);
  });
 }
 if(candidates.length===0)return null;
 // The task starts and finishes at the main-city depot, independent of the
 // character's current position or preferred bank. Its reviewed world ID is 1.
 requireCapability(typeof world.bankById?.get==='function',feature,'world.bankById.get');
 const bank=world.bankById.get(1);if(!bank)return null;
 if(!Number.isSafeInteger(bank.x)||!Number.isSafeInteger(bank.y))throw Error('invalidResult');
 const cacheKey=`${jobId}:${siteId??'default'}`;
 if(routes.has(cacheKey))return routes.get(cacheKey);
 const origin=callRule(game,'siteEntrance',feature,world,bank.x,bank.y,0);if(!origin)return null;
 if(!Number.isSafeInteger(origin.x)||!Number.isSafeInteger(origin.y)||Math.abs(origin.x-bank.x)>1||Math.abs(origin.y-bank.y)>1)throw Error('invalidResult');
 let best=null;
 // Default selection minimizes the real first walk from this fixed origin;
 // the game UI can choose another site from the live character's position.
 for(const site of candidates){
  if(!Number.isSafeInteger(site.id)||!Number.isSafeInteger(site.x)||!Number.isSafeInteger(site.y))throw Error('invalidResult');
  const candidate=siteRoute(site,bank,origin);
  if(candidate&&(best===null||candidate.distance<best.distance||candidate.distance===best.distance&&candidate.siteId<best.siteId))best=candidate;
 }
 routes.set(cacheKey,best);return best;
}

function walking(route,batches,strideSpeed){
 // La resets stride on each new path; rounding the entire route would carry a
 // remainder across legs that Vko discards when the character arrives.
 const ticks=distance=>Math.ceil(distance*1000/strideSpeed);
 const costs=route.legs.map(leg=>({walk:ticks(leg.outwardDistance)+ticks(leg.returnDistance),
  starts:Number(leg.outwardDistance>0)+Number(leg.returnDistance>0)}));
 const sum=(start,end,key)=>costs.slice(start,end).reduce((total,cost)=>total+cost[key],0);
 const prefix=Math.min(batches,route.cycleStart),remaining=batches-prefix;
 const cycles=Math.floor(remaining/route.cycleLength),tail=remaining%route.cycleLength;
 const total=key=>checked(sum(0,prefix,key)+cycles*sum(route.cycleStart,costs.length,key)+sum(route.cycleStart,route.cycleStart+tail,key));
 return {walkTicks:ticks(route.distance),returnWalkTicks:ticks(route.returnDistance),totalWalkTicks:total('walk'),walkStarts:total('starts')};
}

function walkingAtMeanTrips(route,strideSpeed,batches){
 const whole=Math.floor(batches);
 const walks=walking(route,whole,strideSpeed),fraction=batches-whole;
 if(fraction>0){
  const next=walking(route,whole+1,strideSpeed);
  walks.totalWalkTicks+=fraction*(next.totalWalkTicks-walks.totalWalkTicks);
  walks.walkStarts+=fraction*(next.walkStarts-walks.walkStarts);
 }
 return {...walks,batches};
}

function batchWalks(route,strideSpeed,attempts,capacity){
 if(capacity===Infinity)return {...walking(route,1,strideSpeed),batches:1};
 const smaller=Math.floor(capacity),larger=Math.ceil(capacity);
 const minTrips=Math.ceil(attempts/larger),maxTrips=Math.ceil(attempts/smaller);
 if(minTrips===maxTrips)return {...walking(route,minTrips,strideSpeed),batches:minTrips};
 const shortChance=larger-capacity,longChance=1-shortChance;
 if(maxTrips>exactTripLimit){
  // The stationary number of unused attempts in the last trip is
  // E[X(X-1)]/(2 E[X]) for an integer trip capacity X.
  const leftover=(shortChance*smaller*(smaller-1)+longChance*larger*(larger-1))/(2*capacity);
  const batches=Math.min(maxTrips,Math.max(minTrips,(attempts+leftover)/capacity));
  const approximate=walkingAtMeanTrips(route,strideSpeed,batches);
  // The approximation is monotone, but can start below the exact estimate
  // at the cutoff. Once it reaches the trip limit, all cutoff paths cost less.
  if(batches>=exactTripLimit)return approximate;
  const cutoff=batchWalks(route,strideSpeed,exactTripLimit*smaller,capacity);
  return {...approximate,batches:Math.max(batches,cutoff.batches),
   totalWalkTicks:Math.max(approximate.totalWalkTicks,cutoff.totalWalkTicks),
   walkStarts:Math.max(approximate.walkStarts,cutoff.walkStarts)};
 }
 // Distribution of short trips after k independent trips. Advance its
 // binomial probabilities in place to avoid subtracting nearly equal CDFs.
 const mass=new Float64Array(maxTrips);
 mass[0]=1;
 const first=walking(route,minTrips,strideSpeed);
 let previous=first,batches=minTrips,totalWalkTicks=first.totalWalkTicks,walkStarts=first.walkStarts;
 const spareOnLongestTrips=(larger-attempts%larger)%larger;
 for(let k=1;k<maxTrips;k++){
  for(let short=k;short>0;short--)mass[short]=mass[short]*longChance+mass[short-1]*shortChance;
  mass[0]*=longChance;
  if(k<minTrips)continue;
  // Each short trip uses up one unit of spare capacity.
  const spare=spareOnLongestTrips+(k-minTrips)*larger;
  let needNext=0;
  for(let short=spare+1;short<=k;short++)needNext+=mass[short];
  if(needNext===0)break;
  batches+=needNext;
  const next=walking(route,k+1,strideSpeed);
  totalWalkTicks+=needNext*(next.totalWalkTicks-previous.totalWalkTicks);
  walkStarts+=needNext*(next.walkStarts-previous.walkStarts);
  previous=next;
 }
 return {...first,batches,totalWalkTicks,walkStarts};
}

function movement(player){
 const feature='estimateBatchTime.movement';
 if(!player||!Number.isInteger(player.perks?.pockets)||player.perks.pockets<0||player.perks.pockets>5
  ||!player.equipment||!Object.hasOwn(player.equipment,'mount')||!Number.isInteger(player.masteries?.move)||player.masteries.move<0
  ||!player.brews||!player.brewTier||!Number.isSafeInteger(player.lastTick)||player.lastTick<0)return null;
 requireCapability(Number.isSafeInteger(game.masteryRankLimit)&&game.masteryRankLimit>=0,feature,'masteryRankLimit');
 if(player.masteries.move>game.masteryRankLimit)return null;
 const mount=player.equipment.mount;
 if(mount!==null){
  if(!Number.isSafeInteger(mount))return null;
  if(callRule(game,'tool',feature,mount)?.slot!=='mount')return null;
 }
 const swiftUntil=player.brews.swift;
 if(swiftUntil!==undefined&&(!Number.isSafeInteger(swiftUntil)||swiftUntil<0))return null;
 let swiftMultiplier=1;
 if(swiftUntil>player.lastTick){
  if(!Number.isInteger(player.brewTier.swift)||player.brewTier.swift<0||player.brewTier.swift>4)return null;
  requireCapability(Number.isFinite(game.swiftSpeedBonus)&&game.swiftSpeedBonus>=0,feature,'swiftSpeedBonus');
  const strength=callRule(game,'brewStrength',feature,player,'swift');
  if(!Number.isFinite(strength)||strength<0)throw Error('invalidResult');
  swiftMultiplier+=game.swiftSpeedBonus*strength;
 }
 const stride=callRule(game,'mountStride',feature,player),mastery=callRule(game,'masteryMultiplier',feature,player.masteries,'move');
 if(!Number.isFinite(stride)||!Number.isFinite(mastery))throw Error('invalidResult');
 const strideSpeed=Math.round(stride*swiftMultiplier*mastery);
 if(!Number.isFinite(strideSpeed)||strideSpeed<=0)return null;
 const slots=callRule(game,'inventoryCapacity',feature,player);
 if(!Number.isSafeInteger(slots)||slots<0)throw Error('invalidResult');
 return {strideSpeed,slots};
}

function capacity(job,tier,slots){
 // q_ limits how many inputs the game withdraws, including a reserved output stack.
 // This may be lower than the theoretical limit after consuming the first inputs.
 const feature='estimateBatchTime.capacity';
 const inputs=callRule(game,'recipeInputs',feature,job,tier);
 if(!Array.isArray(inputs)||inputs.some(input=>!input||!Number.isSafeInteger(input.itemId)||!Number.isSafeInteger(input.qty)||input.qty<0))throw Error('invalidResult');
 const stacked=id=>{
  const item=callRule(game,'item',feature,id);
  if(typeof item?.stackable!=='boolean')throw Error('invalidResult');
  return item.stackable;
 };
 const nonstacked=inputs.filter(input=>!stacked(input.itemId)).reduce((sum,input)=>sum+input.qty,0);
 const stacks=new Set(inputs.filter(input=>stacked(input.itemId)).map(input=>input.itemId)).size;
 const output=callRule(game,'recipeOutput',feature,job,tier);
 if(!Number.isSafeInteger(output))throw Error('invalidResult');
 const stackedOutput=stacked(output);
 if(nonstacked>0)return Math.floor((slots-stacks-(stackedOutput?1:0))/nonstacked);
 if(stackedOutput)return slots>=stacks+1?Infinity:0;
 if(!Number.isSafeInteger(job.output?.qty)||job.output.qty<=0)throw Error('invalidJob');
 return Math.floor((slots-stacks)/job.output.qty);
}

function estimateBatchTime({job,tier=0,count,player,actionSeconds,discard=false,siteId,resolveCapacity}){
  if(!Number.isInteger(tier)||tier<0||tier>4)throw Error('invalidTier');
 if(!Number.isFinite(count)||count<=0||count>Number.MAX_SAFE_INTEGER)throw Error('invalidQuantity');
 if(!Number.isFinite(actionSeconds)||actionSeconds<0)return unknown(null,'actionTime');
 const workSeconds=checked(count*actionSeconds),base={workSeconds,sourceVersion:batchTimeModel.sourceVersion};
 if((discard&&gatheringSkills.includes(job.skill))||job.skill==='thieving'||job.upgrade)return {...base,status:'ok',seconds:workSeconds,overheadSeconds:0,batches:0,batchCapacity:null};
 const travel=resolveMovement?resolveMovement(player):movement(player);if(!travel)return unknown(workSeconds,'movementConfiguration');
 const route=workRoute(job.id,siteId);if(!route)return unknown(workSeconds,'workLocation');
 const batchCapacity=resolveCapacity?resolveCapacity(travel.slots):capacity(job,tier,travel.slots);
 if(batchCapacity<=0)return {...base,status:'unreachable',seconds:null,overheadSeconds:null,batches:null,batchCapacity};
 const {batches,...walks}=batchWalks(route,travel.strideSpeed,Math.ceil(count),batchCapacity);
 if(!Array.isArray(job.inputs))throw Error('invalidJob');
 const initialTicks=job.inputs.length?batchTimeModel.initialCraftTicks:batchTimeModel.initialGatherTicks;
 const overheadSeconds=checked((initialTicks+batchTimeModel.finishTicks+(batches-1)*batchTimeModel.turnoverTicks+walks.totalWalkTicks+walks.walkStarts*batchTimeModel.walkStartTicks)*tickMilliseconds(game,'estimateBatchTime')/1000);
 const {legs,...geometry}=route;
 return {...base,...geometry,...travel,...walks,originAssumption:'main-city-bank',status:'ok',seconds:checked(workSeconds+overheadSeconds),overheadSeconds,batches,batchCapacity:batchCapacity===Infinity?null:batchCapacity};
}

return estimateBatchTime;
}
