import test from 'node:test';
import assert from 'node:assert/strict';
import {exactCostDistribution,enhancementDistribution,enhancementPercentiles} from '../src/enhancement-distribution.js';
import {calculateEnhancement,enhancementDefaults} from '../src/enhancement.js';
const solve=(steps,start=0,options)=>exactCostDistribution(steps,start,options);

test('high-step quantiles include changing pity chances and all per-attempt materials',()=>{
 const s={...enhancementDefaults(),itemId:853,tier:0,current:20,target:21,shardPrice:1,scrollPrice:8,essencePrice:2,corePrice:25,useCore:true};
 const result=calculateEnhancement(s),step=result.steps[20];
 const attempt=step.gold+step.shards+step.essence*2+25;
 const expected=[2,3,4].map(n=>attempt*n+(n-1)*8);
 const q=enhancementDistribution(s,result).quantiles;
 for(let i=0;i<q.length;i++)assert.ok(q[i].lowerPrice<=expected[i]&&expected[i]<=q[i].minPrice);
});

test('direct sticky-step quantiles retain an exact crossing close to the target probability',()=>{
 const s={...enhancementDefaults(),itemId:853,tier:0,current:20,target:21,level:154,lectern:30,mastery:105,shardPrice:0,scrollPrice:0,essencePrice:0};
 const result=calculateEnhancement(s),q=enhancementDistribution(s,result).quantiles[0];
 assert.equal(q.minPrice,56490000);
 assert.equal(q.lowerPrice,56490000);
 assert.ok(q.actualProbability>.8&&q.actualProbability<.80000001);
 const core={...s,level:147,lectern:47,mastery:199,useCore:true,corePrice:0};
 const [,,q95]=enhancementDistribution(core,calculateEnhancement(core)).quantiles;
 assert.equal(q95.minPrice,112980000);
 assert.equal(q95.lowerPrice,112980000);
});

test('first-passage quantiles match chronological paths with simultaneous pity counters',()=>{
 for(const [start,failLast]of [[1,1],[2,1],[1,0]]){
  const steps=[{chances:[.85],gold:2,failTo:0,protected:false},{chances:[.51,.66,.8],gold:3,failTo:0,protected:false},{chances:[.48,.62,.77],gold:5,failTo:failLast,protected:failLast===1}]
   .map(s=>({...s,chance:s.chances[0],shards:0,essence:0,core:0}));
  const mass=Array.from({length:500},()=>new Map()),completed=new Float64Array(mass.length);
  mass[0].set(`${start}00`,1);
  const add=(cost,key,p)=>{if(cost<mass.length)mass[cost].set(key,(mass[cost].get(key)??0)+p);};
  for(const [b,row]of mass.entries())for(const [key,probability]of row){
   const [k,first,last]=[...key].map(Number),s=steps[k],counters=[0,first,last],tries=counters[k],p=s.chances[tries],cost=b+s.gold;
   if(cost>=mass.length)continue;
   counters[k]=0;
   if(k+1===steps.length)completed[cost]+=probability*p;
   else add(cost,`${k+1}${counters[1]}${counters[2]}`,probability*p);
   counters[k]=Math.min(tries+1,s.chances.length-1);
   add(cost+(s.protected?1:0),`${s.failTo}${counters[1]}${counters[2]}`,probability*(1-p));
  }
  const pricedGold=completed.reduce((sum,p,cost)=>sum+p*cost,0);
  const result={steps,pricedGold,totals:{scrolls:1}},input={current:start,target:steps.length,scrollPrice:1};
  const {quantiles}=enhancementDistribution(input,result);
  let cdf=0;
  const cumulative=completed.map(probability=>cdf+=probability);
  assert.ok(cdf>1-1e-12);
  for(const q of quantiles){const expected=cumulative.findIndex(p=>p>=q.alpha);assert.equal(q.minPrice,expected);assert.equal(q.lowerPrice,expected);}
  assert.throws(()=>enhancementDistribution(input,result,{maxCells:1}),error=>error.message==='distributionLimit'&&error.details.reason==='memory');
  assert.throws(()=>enhancementDistribution(input,result,{maxWork:1}),error=>error.message==='distributionLimit'&&error.details.reason==='work');
 }
});

test('legendary Bonebound +20 to +40 completes with essence, scrolls and cores within solver limits',()=>{
 const s={...enhancementDefaults(),itemId:853,tier:4,current:20,target:40,level:100,lectern:35,mastery:150,shardPrice:600,scrollPrice:300000,essencePrice:500,corePrice:15000000,useCore:true};
 const r=calculateEnhancement(s),d=enhancementDistribution(s,r);
 assert.ok(r.pricedGold>934e9&&r.pricedGold<935e9);
 assert.ok(d.evaluatedCells<=500_000_000&&d.storedCells<=5_000_000);
 assert.ok(d.quantiles.every(q=>q.relativeError<=.001));
 assert.ok(d.quantiles[2].lowerPrice>2.079e12&&d.quantiles[2].minPrice<2.083e12);
});
const reference=target=>Array.from({length:target},(_,k)=>({chance:Math.min(1,1.3*1.158*1.375*Math.max(.2,1-.06*k)),cost:500000*k,failureCost:200000,failTo:Math.max(0,k-1)}));
test('matches all four supplied reference quantile vectors',()=>{
 for(const [start,target,q95,q99]of [[12,13,62500000,101300000],[14,15,272100000,450200000],[10,12,41600000,62000000],[10,15,363600000,542100000]]){
  const result=solve(reference(target),start);
  assert.deepEqual(result.quantiles.map(q=>q.minPrice),[q95,q99]);
  if(target===13)assert.ok(Math.abs(result.quantiles[0].actualProbability-.9543126238709738)<1e-12);
 }
});
// Independent forward propagation of path probability mass over accumulated
// cost (rather than backward CDF equations). Test positive integer costs.
function enumerate(steps,start,budget){
 const mass=Array.from({length:budget+1},()=>Array(steps.length).fill(0));mass[0][start]=1;
 let completed=0;
 for(let b=0;b<=budget;b++)for(let k=0;k<steps.length;k++){
  const s=steps[k],p=mass[b][k];
  if(b+s.cost<=budget){if(k+1===steps.length)completed+=p*s.chance;else mass[b+s.cost][k+1]+=p*s.chance;}
  if(b+s.cost+s.failureCost<=budget)mass[b+s.cost+s.failureCost][s.failTo]+=p*(1-s.chance);
 }
 return completed;
}
test('minimal quantiles agree with independent paths for resets, protection and nonzero starts',()=>{
 for(const protectedStep of [false,true])for(const start of [0,2]){
  const steps=Array.from({length:4},(_,k)=>({chance:.7,cost:k+1,failureCost:protectedStep&&k>=2?3:0,failTo:protectedStep&&k>=2?k-1:0}));
  const result=solve(steps,start,{alphas:[.6,.975]});
  for(const q of result.quantiles){assert.ok(enumerate(steps,start,q.minPrice)>=q.alpha);assert.ok(enumerate(steps,start,q.minPrice-1)<q.alpha);assert.ok(Math.abs(enumerate(steps,start,q.minPrice)-q.actualProbability)<1e-12);}
 }
});
test('zero-cost floor self-loop, charged self-loop and arbitrary probability',()=>{
 assert.equal(solve([{chance:.5,cost:0,failureCost:0,failTo:0}]).quantiles[1].minPrice,0);
 const charged=solve([{chance:.5,cost:0,failureCost:2,failTo:0}],0,{alphas:[.975]}).quantiles[0];
 assert.equal(charged.minPrice,10);assert.equal(charged.actualProbability,.984375);
 assert.equal(solve([{chance:.5,cost:1,failureCost:1,failTo:0}]).quantiles[0].minPrice,9);
});
test('decimal costs retain exact decimal grid; deterministic paths bypass budget limit',()=>{
 const result=solve([{chance:.5,cost:.1,failureCost:.02,failTo:0}]);
 assert.equal(result.quantiles[0].minPrice,.58);assert.equal(result.quantiles[1].minPrice,.82);
 assert.equal(solve([{chance:1,cost:1e12,failureCost:0,failTo:0}],0,{maxCells:1}).quantiles[1].minPrice,1e12);
});
test('limits, unsafe money and invalid inputs explicitly fail without partial results',()=>{
 assert.throws(()=>solve(reference(15),10,{maxCells:15}),/distributionLimit/);
 assert.throws(()=>solve([{chance:1,cost:1e16,failureCost:0,failTo:0}]),/distributionPrecision/);
 for(const patch of [{chance:0},{chance:1.01},{cost:-1},{failureCost:NaN},{failTo:-1}])assert.throws(()=>solve([{chance:.5,cost:1,failureCost:1,failTo:0,...patch}]));
 for(const options of [{alphas:[1]},{maxCells:0}])assert.throws(()=>solve(reference(2),0,options));
});
const config=patch=>({...enhancementDefaults(),itemId:110,tier:3,target:7,shardPrice:100,scrollPrice:200000,basePrice:0,...patch});
const gameSolve=s=>enhancementDistribution(s,calculateEnhancement(s));
const gameExact=s=>{
 const r=calculateEnhancement(s);
 return solve(r.steps.map(x=>({chance:x.chance,failTo:x.failTo,cost:x.gold+x.shards*(s.shardPrice??0),failureCost:x.protected?s.scrollPrice??0:0})),s.current,{alphas:[.8,.9,.95]});
};
function containsExact(result,expected){
 for(const [i,q]of result.quantiles.entries()){
  assert.ok(q.lowerPrice<=expected[i]&&expected[i]<=q.minPrice);
  assert.ok(q.relativeError<=.001);
  assert.ok(q.minPrice<=expected[i]*1.001);
  if(!q.exact)assert.equal(q.actualProbability,null);
 }
}
test('game cost distribution matches exact cases and excludes the base item',()=>{
 assert.deepEqual(enhancementPercentiles,[80,90,95]);
 for(const [protect,expected]of [[true,[940300,1195500,1623100]],[false,[264500,358800,455400]]]){
  const s=config({protect}),result=gameSolve(s);
  assert.deepEqual(result.quantiles.map(q=>q.minPrice),expected);
  assert.deepEqual(result.quantiles.map(q=>q.alpha),[.8,.9,.95]);
  const shifted=gameSolve({...s,basePrice:100});assert.deepEqual(shifted,result);
  assert.deepEqual(gameSolve({...s,basePrice:null}),result);
 }
});
test('game missing prices, unused scrolls, zero target, decimals and deterministic paths',()=>{
 assert.equal(gameSolve(config({shardPrice:null})),null);
 assert.equal(gameSolve(config({scrollPrice:null})),null);
 assert.ok(gameSolve(config({protect:false,scrollPrice:null})));
 assert.equal(gameSolve(config({current:7,target:7,shardPrice:null,scrollPrice:null,basePrice:120})).quantiles[0].minPrice,0);
 const s=config({lectern:50,level:241,mastery:200,shardPrice:.123,scrollPrice:null,basePrice:10});
 assert.equal(gameSolve(s).quantiles[0].minPrice,calculateEnhancement(s).pricedGold);
 assert.throws(()=>gameSolve(config({target:20})),/distributionLimit/);
});

test('market tax, profit margin and base price leave all three cost quantiles unchanged',()=>{
 const s=config({profitRate:0,basePrice:100}),raw=gameSolve(s);
 for(const [taxRate,profitRate] of [[0,3],[3,12.5],[12.5,0]]){
  const result=gameSolve({...s,profitRate,taxRate});
  for(let i=0;i<3;i++){
   assert.equal(result.quantiles[i].minPrice,raw.quantiles[i].minPrice);
   assert.equal(result.quantiles[i].actualProbability,raw.quantiles[i].actualProbability);
  }
 }
});

test('rolling rows cross the storage-sized budget and enforce separate memory and work limits',()=>{
 const steps=[{chance:.01,cost:1,failureCost:0,failTo:0}];
 const result=solve(steps,0,{maxCells:2,maxWork:500});
 assert.deepEqual(result.quantiles.map(q=>q.minPrice),[299,459]);
 assert.equal(result.storedCells,2);
 assert.equal(result.evaluatedBudgetPoints,460);
 assert.ok(Math.abs(result.quantiles[1].actualProbability-(1-.99**459))<1e-12);
 assert.throws(()=>solve(steps,0,{maxCells:1,maxWork:500}),error=>error.message==='distributionLimit'&&error.details.reason==='memory');
 assert.throws(()=>solve(steps,0,{maxCells:2,maxWork:459}),error=>error.message==='distributionLimit'&&error.details.reason==='work');
 assert.throws(()=>solve(steps,0,{maxWork:0}),/invalidConfiguration/);
});

test('legendary Leviathan +16 and +20 complete without retaining all budget history',()=>{
 for(const [target,expected,oldPoints,states]of [[16,[458417200,595862000,733906800],3669535,5],[20,[1603458400,2160448400,2717438400],13587193,9]]){
  const s=config({itemId:357,tier:4,level:100,lectern:40,mastery:200,target,shardPrice:600,scrollPrice:300000});
  const result=gameSolve(s);
  assert.deepEqual(gameExact(s).quantiles.map(q=>q.minPrice),expected);
  containsExact(result,expected);
  assert.ok(result.evaluatedBudgetPoints<oldPoints);
  assert.ok(result.storedCells<5_000_000);
  assert.equal(result.dpStates,states);
 }
});

test('forced paths preserve initial cost and rebuilding across low, mixed and rounded-to-100% chances',()=>{
 const base=[
  {chance:1,cost:1,failureCost:0,failTo:0},
  {chance:.6,cost:2,failureCost:1,failTo:0},
  {chance:1,cost:3,failureCost:0,failTo:1},
  {chance:.7,cost:4,failureCost:2,failTo:0},
  {chance:1,cost:5,failureCost:0,failTo:3}
 ];
 const masks=Array.from({length:32},(_,mask)=>base.map((_,k)=>mask&(1<<k)?1:.6+k*.03));
 for(const chances of [[1,.6,1,.7,1],[.95,.6,.85,.7,.9],[1,.6,.999999,.7,1],...masks]){
  const steps=base.map((s,k)=>({...s,chance:chances[k]}));
  for(const start of [0,1,2,3]){
   const result=solve(steps,start,{alphas:[.8,.9,.95]});
   if(result.dpStates!==undefined)assert.equal(result.dpStates,chances.filter(p=>p<1).length);
   for(const q of result.quantiles){
    assert.ok(enumerate(steps,start,q.minPrice)>=q.alpha);
    assert.ok(enumerate(steps,start,q.minPrice-1)<q.alpha);
    assert.ok(Math.abs(enumerate(steps,start,q.minPrice)-q.actualProbability)<1e-12);
   }
  }
 }
 assert.equal(solve([{chance:1,cost:7,failureCost:0,failTo:0},{chance:.5,cost:0,failureCost:0,failTo:1}]).quantiles[0].minPrice,7);
});

test('lectern 30 and effective mastery 40% +20 completes within unchanged limits',()=>{
 const s=config({itemId:357,tier:4,level:100,lectern:30,mastery:160,target:20,shardPrice:600,scrollPrice:300000,basePrice:600000000});
 const result=gameSolve(s);
 const expected=[4010033400,5595154000,7180274600];
 assert.deepEqual(gameExact(s).quantiles.map(q=>q.minPrice),expected);
 containsExact(result,expected);
 assert.equal(result.dpStates,10);
 assert.ok(result.evaluatedCells<=500_000_000);
 assert.ok(result.storedCells<=5_000_000);
});

const feedback=patch=>config({itemId:357,tier:4,current:0,target:15,level:92,lectern:33,mastery:191,shardPrice:601,scrollPrice:300001,...patch});
test('mean magnitude selects grid, refines all quantiles and keeps prices and mean unchanged',()=>{
 const s=feedback(),before=JSON.stringify(s),mean=calculateEnhancement(s),result=gameSolve(s);
 assert.equal(result.initialGrid,10000);
 assert.equal(result.grid,1000);
 assert.equal(result.rounds,2);
 assert.equal(result.exact,false);
 assert.ok(result.quantiles.every(q=>q.relativeError<=.001&&q.actualProbability===null));
 assert.equal(JSON.stringify(s),before);
 assert.deepEqual(calculateEnhancement(s),mean);
 assert.ok(result.evaluatedCells<500_000_000);
 assert.ok(result.storedCells<5_000_000);
 const baseline=gameSolve(feedback({shardPrice:600,scrollPrice:300000}));
 containsExact(baseline,[365651600,473042400,580433200]);
});

test('integer and decimal price regressions complete with validated bounds',()=>{
 for(const patch of [{shardPrice:601,scrollPrice:300000},{shardPrice:600,scrollPrice:300001},{shardPrice:600.01,scrollPrice:300000}]){
  const result=gameSolve(feedback(patch));
  assert.ok(result.quantiles.every(q=>q.relativeError<=.001&&q.lowerPrice>0));
 }
});

test('adaptive bounds contain exact independent prices across tiers, starts and protection',()=>{
 for(const tier of [0,4])for(const current of [0,3])for(const protect of [true,false]){
  const s=config({tier,current,target:5,shardPrice:123,scrollPrice:23456});
  containsExact(gameSolve(s),gameExact(s).quantiles.map(q=>q.minPrice));
 }
 // Decimal prices with a tractable exact grid, and certain-success rebuilding.
 for(const patch of [{shardPrice:.25,scrollPrice:12.5},{level:100,lectern:30,mastery:160,target:12}]){
  const s=config(patch);containsExact(gameSolve(s),gameExact(s).quantiles.map(q=>q.minPrice));
 }
});

test('bounds and refinements share the entire work budget, with explicit resource failures',()=>{
 const s=feedback(),r=calculateEnhancement(s),full=enhancementDistribution(s,r);
 assert.throws(()=>enhancementDistribution(s,r,{maxWork:full.evaluatedCells-5}),e=>e.message==='distributionLimit'&&e.details.reason==='work'&&e.details.evaluatedCells<=full.evaluatedCells-5);
 assert.throws(()=>enhancementDistribution(s,r,{maxCells:1}),e=>e.message==='distributionLimit'&&e.details.reason==='memory');
 assert.throws(()=>enhancementDistribution(s,r,{maxWork:0}),/invalidConfiguration/);
});

test('grid refinement avoids zero-cost cycles for expensive scrolls, and exact paths stay exact',()=>{
 const s=config({target:3,shardPrice:0,scrollPrice:1e9}),r=gameSolve(s);
 assert.ok(r.initialGrid>2000&&r.grid<=2000);
 containsExact(r,gameExact(s).quantiles.map(q=>q.minPrice));
 const certain=gameSolve(config({target:2,level:100,lectern:40,mastery:200}));
 assert.equal(certain.exact,true);
 assert.ok(certain.quantiles.every(q=>q.relativeError===0&&q.actualProbability===1));
 assert.equal(gameSolve(config({current:7,target:7})).exact,true);
});
