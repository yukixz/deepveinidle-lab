import {callRule,requireCapability} from './adapter.js';

export function gatheringPackCapacity(game,slots,branches){
 const feature='estimateBatchTime.gatheringDrops';
 requireCapability(Number.isSafeInteger(game.coinItemId)&&game.coinItemId>=0,feature,'coinItemId');
 let nonstackables=0,variable=branches.length>1||branches[0]?.chance!==1;
 const stackArrivals=new Map(),itemStackability=new Map();
 for(const branch of branches){
  const stackMissRates=new Map();
  for(const {outcomes,units,chance} of branch.rolls){
   if(chance===0)continue;
   let nonstackChance=0;
   const stacks=new Map();
   for(const {id,probability} of outcomes){
    if(probability===0||id===game.coinItemId)continue;
    if(!Number.isSafeInteger(id)||id<0)throw Error('invalidResult');
    if(!itemStackability.has(id)){
     const item=callRule(game,'item',feature,id);
     if(typeof item?.stackable!=='boolean')throw Error('invalidResult');
     itemStackability.set(id,item.stackable);
    }
    if(itemStackability.get(id))stacks.set(id,(stacks.get(id)??0)+probability);
    else nonstackChance+=probability;
   }
   nonstackChance=Math.min(1,nonstackChance)*chance;
   nonstackables+=branch.chance*nonstackChance*units;
   variable||=nonstackChance>0&&nonstackChance<1;
   for(const [id,stackChance] of stacks){
    const missRate=Math.log1p(-Math.min(1,stackChance)*chance);
    stackMissRates.set(id,(stackMissRates.get(id)??0)+missRate);
   }
  }
  // Rolls within a branch are independent. Burn and success are exclusive,
  // so add their weighted chances only after combining same-ID rolls.
  for(const [id,missRate] of stackMissRates){
   const arrivalChance=-Math.expm1(missRate)*branch.chance;
   stackArrivals.set(id,(stackArrivals.get(id)??0)+arrivalChance);
  }
 }
 const arrivals=Array.from(stackArrivals.values(),chance=>Math.log1p(-Math.min(1,chance)));
 const guaranteed=arrivals.filter(rate=>rate===-Infinity).length;
 const random=arrivals.filter(rate=>Number.isFinite(rate)&&rate<0);
 // If these are the only possible stacks, their occupancy approaches the
 // threshold asymptotically. Use the longest mean first-arrival time.
 if(nonstackables===0&&guaranteed+random.length<=slots){
  if(guaranteed+random.length<slots)return Infinity;
  return Math.max(1,...random.map(rate=>-1/Math.expm1(rate)));
 }
 const occupied=attempts=>nonstackables*attempts+guaranteed
  +random.reduce((sum,missRate)=>sum-Math.expm1(attempts*missRate),0);
 const deterministic=!variable&&random.length===0;
 const tolerance=deterministic?0:4*Number.EPSILON*slots;
 const full=occupancy=>occupancy>=slots-tolerance;
 if(full(occupied(1)))return 1;
 // Use the nonstackable growth bound when available. Searching integer
 // endpoints also makes the fractional capacity independent of task length.
 const limit=Number.MAX_SAFE_INTEGER;
 let lower=1,upper=nonstackables>0?Math.min(limit,Math.ceil(slots/nonstackables)):limit;
 if(!full(occupied(upper)))return Infinity;
 while(upper-lower>1){
  const middle=lower+Math.floor((upper-lower)/2);
  if(full(occupied(middle)))upper=middle;
  else lower=middle;
 }
 const upperSlots=occupied(upper);
 if(deterministic||Math.abs(upperSlots-slots)<=tolerance)return upper;
 const lowerSlots=occupied(lower);
 return lower+(slots-lowerSlots)/(upperSlots-lowerSlots);
}
