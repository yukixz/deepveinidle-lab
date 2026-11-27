import {enhancementMinimum} from './enhancement.js';

export const enhancementPercentiles=Object.freeze([80,90,95]);
const maxStoredCells=5_000_000,maxEvaluatedCells=500_000_000;

// Decimal money is scaled with BigInt before GCD compression. Probabilities
// remain Float64. Adaptive bounds round integer costs, never input prices.
function decimal(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('invalidPrice');
 const [mantissa,exp='0']=String(value).split('e'),parts=mantissa.split('.');
 const places=(parts[1]?.length??0)-Number(exp);
 return {units:BigInt(parts.join(''))*10n**BigInt(Math.max(0,-places)),places:Math.max(0,places)};
}
function integers(values){
 const parsed=values.map(decimal),places=Math.max(0,...parsed.map(x=>x.places));
 return {values:parsed.map(x=>x.units*10n**BigInt(places-x.places)),scale:10n**BigInt(places)};
}
const gcd=(a,b)=>{while(b){[a,b]=[b,a%b];}return a;};
function moneyValue(amount,scale){
 const divisor=Number(scale);
 if(!Number.isFinite(divisor)||amount>BigInt(Number.MAX_SAFE_INTEGER))throw Error('distributionPrecision');
 return Number(amount)/divisor;
}
function resourceLimit(reason,details={}){
 const error=Error('distributionLimit');error.details={reason,...details};throw error;
}
// Eliminate certain-success states by charging their entire forced path to
// the branch that enters it. Branch values below are total costs, not extras.
function stochasticStates(steps,start,values){
 const target=steps.length,next=Array(target+1).fill(target),forced=Array(target+1).fill(0n);
 for(let k=target-1;k>=0;k--){
  if(steps[k].chance===1){next[k]=next[k+1];forced[k]=values[2*k]+forced[k+1];}
  else next[k]=k;
 }
 const originals=steps.map((s,k)=>s.chance<1?k:null).filter(k=>k!==null);
 const index=new Map(originals.map((k,i)=>[k,i]));index.set(target,originals.length);
 return {
  prefix:forced[start],start:index.get(next[start]),
  steps:originals.map(k=>({chance:steps[k].chance,failTo:index.get(next[steps[k].failTo])})),
  values:originals.flatMap(k=>[values[2*k]+forced[k+1],values[2*k]+values[2*k+1]+forced[steps[k].failTo]])
 };
}
export function exactCostDistribution(steps,start,{alphas=[.95,.99],maxCells=maxStoredCells,maxWork=maxEvaluatedCells}={}){
 if(!Number.isSafeInteger(start)||start<0||start>steps.length||!Number.isSafeInteger(maxCells)||maxCells<=0||!Number.isSafeInteger(maxWork)||maxWork<=0||!alphas.length||alphas.some(a=>!Number.isFinite(a)||a<=0||a>=1))throw Error('invalidConfiguration');
 for(const [k,s]of steps.entries())if(!Number.isFinite(s.chance)||s.chance<=0||s.chance>1||!Number.isSafeInteger(s.failTo)||s.failTo<0||s.failTo>k)throw Error('invalidConfiguration');
 const {values,scale}=integers(steps.flatMap(s=>[s.cost,s.failureCost]));
 return solve(steps,start,values,scale,alphas,maxCells,maxWork);
}
function solve(steps,start,values,scale,alphas,maxCells,maxWork,budget={used:0}){
 let target=steps.length,prefix=0n;
 const finish=(result,points=0)=>{const evaluatedCells=points*target;budget.used+=evaluatedCells;return {...result,evaluatedCells};};
 const output=(cost,probability)=>({minPrice:moneyValue(cost+prefix,scale),actualProbability:probability});
 if(start===target)return finish({quantiles:alphas.map(alpha=>({alpha,...output(0n,1)})),evaluatedBudgetPoints:0});
 if(steps.slice(start).every(s=>s.chance===1)){
  const cost=steps.slice(start).reduce((total,_,i)=>total+values[(i+start)*2],0n);
  return finish({quantiles:alphas.map(alpha=>({alpha,...output(cost,1)})),evaluatedBudgetPoints:0});
 }
 ({steps,start,values,prefix}=stochasticStates(steps,start,values));
 target=steps.length;
 let unit=0n;
 for(const cost of values)unit=gcd(unit,cost);
 if(unit===0n)return finish({quantiles:alphas.map(alpha=>({alpha,...output(0n,1)})),evaluatedBudgetPoints:1});
 const points=Math.floor((maxWork-budget.used)/target);
 if(!points)resourceLimit('work',{states:target,maxWork,evaluatedCells:budget.used});
 // Delays beyond the evaluated budget need no array index conversion.
 const index=v=>Number(v/unit>BigInt(points)?BigInt(points):v/unit);
 const costs=steps.map((_,k)=>index(values[2*k])),failureCosts=steps.map((_,k)=>index(values[2*k+1]));
 // A row only needs to retain values until its last incoming transition
 // has read them. The extra cell prevents overwriting a still-needed value.
 const lengths=steps.map(()=>1);
 for(let k=0;k<target;k++){
  if(k+1<target&&costs[k]<points)lengths[k+1]=Math.max(lengths[k+1],costs[k]+1);
  if(failureCosts[k]<points)lengths[steps[k].failTo]=Math.max(lengths[steps[k].failTo],failureCosts[k]+1);
 }
 const storedCells=lengths.reduce((sum,n)=>sum+n,0);
 if(storedCells>maxCells)resourceLimit('memory',{states:target,storedCells,maxCells});
 const rows=lengths.map(n=>new Float64Array(n)),found=new Map(),requested=new Set(alphas).size;
 for(let n=0;n<points;n++){
  for(let k=target-1;k>=0;k--){
   const s=steps[k],success=n-costs[k],failure=n-failureCosts[k];
   const win=success<0?0:k+1===target?1:rows[k+1][success%lengths[k+1]];
   // Only a self-loop may refer to this cell. Eliminate it algebraically.
   const self=s.failTo===k&&failure===n;
   if(costs[k]===0&&s.failTo<k&&failure===n)throw Error('distributionPrecision');
   const value=self?win:s.chance*win+(1-s.chance)*(failure<0?0:rows[s.failTo][failure%lengths[s.failTo]]);
   if(!Number.isFinite(value)||value<0||value>1+1e-12)throw Error('unreliableCalculation');
   rows[k][n%lengths[k]]=Math.min(1,value);
  }
  for(const alpha of alphas)if(!found.has(alpha)&&rows[start][n%lengths[start]]>=alpha)found.set(alpha,{alpha,...output(BigInt(n)*unit,rows[start][n%lengths[start]])});
  if(found.size===requested)return finish({quantiles:alphas.map(a=>found.get(a)),evaluatedBudgetPoints:n+1,storedCells,dpStates:target},n+1);
 }
 budget.used+=points*target;
 resourceLimit('work',{states:target,maxWork,evaluatedBudgetPoints:points,storedCells,evaluatedCells:budget.used});
}

function solveStickyPity(chances,successCost,scrollCost,scale,alphas,maxWork){
 const quantiles=[],failureCost=successCost+scrollCost;
 let uncompleted=1;
 for(let failures=0;failures<maxWork;failures++){
  uncompleted*=1-chances[Math.min(failures,chances.length-1)];
  const actualProbability=1-uncompleted;
  while(quantiles.length<alphas.length&&actualProbability>=alphas[quantiles.length]){
   const minPrice=moneyValue(successCost+BigInt(failures)*failureCost,scale);
   quantiles.push({alpha:alphas[quantiles.length],minPrice,lowerPrice:minPrice,relativeError:0,exact:true,actualProbability});
  }
  if(quantiles.length===alphas.length)return {quantiles,exact:true,evaluatedBudgetPoints:failures+1,evaluatedCells:failures+1,storedCells:1,dpStates:1};
 }
 resourceLimit('work',{states:1,maxWork,evaluatedCells:maxWork});
}

// Invert a conjugate-symmetric spectrum at evenly spaced points. The radius
// used to evaluate the generating function is accounted for by the caller.
function invertSpectrum(real,imaginary){
 const size=real.length;
 for(let i=1,j=0;i<size;i++){
  let bit=size>>1;
  for(;j&bit;bit>>=1)j^=bit;
  j^=bit;
  if(i<j){[real[i],real[j]]=[real[j],real[i]];[imaginary[i],imaginary[j]]=[imaginary[j],imaginary[i]];}
 }
 for(let width=2;width<=size;width*=2){
  const half=width/2;
  for(let j=0;j<half;j++){
   const angle=2*Math.PI*j/width,c=Math.cos(angle),s=Math.sin(angle);
   for(let i=j;i<size;i+=width){
    const next=i+half,r=real[next]*c-imaginary[next]*s,v=real[next]*s+imaginary[next]*c;
    real[next]=real[i]-r;imaginary[next]=imaginary[i]-v;real[i]+=r;imaginary[i]+=v;
   }
  }
 }
}

// A first passage through step k consists of one winning attempt plus any
// number of losses. Each loss pays its costs and independently rebuilds the
// lower steps before retrying k with its saved pity count. The saturated
// retry tail is a geometric series. Products combine independent passages.
function evaluatePassages(real,imaginary,steps,costs,start,minimum,damping){
 const size=real.length,from=new Float64Array(steps.length),to=new Float64Array(steps.length);
 const phases=costs.map(cost=>cost%size),radii=costs.map(cost=>Math.exp(-damping*cost/size));
 const angle=-2*Math.PI/size;
 for(let i=0;i<=size/2;i++){
  let prefixR=1,prefixI=0,resultR=1,resultI=0;
  for(let k=minimum;k<steps.length;k++){
   const {failTo,chance,chances=[chance]}=steps[k],failure=2*k+1;
   let rebuildR=1,rebuildI=0;
   if(chance<1){
    if(failTo===minimum){rebuildR=prefixR;rebuildI=prefixI;}
    else for(let j=failTo;j<k;j++){
     const r=rebuildR*from[j]-rebuildI*to[j];rebuildI=rebuildR*to[j]+rebuildI*from[j];rebuildR=r;
    }
   }
   const retryAngle=angle*(i*phases[failure]%size);
   const fr=radii[failure]*Math.cos(retryAngle),fi=radii[failure]*Math.sin(retryAngle);
   const retryR=fr*rebuildR-fi*rebuildI,retryI=fr*rebuildI+fi*rebuildR;
   const tail=chances.at(-1),a=1-(1-tail)*retryR,b=(1-tail)*retryI,squared=a*a+b*b;
   let pr=tail*a/squared,pi=tail*b/squared;
   for(let j=chances.length-2;j>=0;j--){
    const p=chances[j],r=p+(1-p)*(retryR*pr-retryI*pi);
    pi=(1-p)*(retryR*pi+retryI*pr);pr=r;
   }
   const win=2*k,winAngle=angle*(i*phases[win]%size),wr=radii[win]*Math.cos(winAngle),wi=radii[win]*Math.sin(winAngle);
   from[k]=wr*pr-wi*pi;to[k]=wr*pi+wi*pr;
   const prefix=prefixR*from[k]-prefixI*to[k];prefixI=prefixR*to[k]+prefixI*from[k];prefixR=prefix;
   if(k>=start){const result=resultR*from[k]-resultI*to[k];resultI=resultR*to[k]+resultI*from[k];resultR=result;}
  }
  real[i]=resultR;imaginary[i]=resultI;
  if(i>0&&i<size/2){real[size-i]=resultR;imaginary[size-i]=-resultI;}
 }
}

function solvePity(steps,start,minimum,values,scale,alphas,maxCells,maxWork,budget,mean){
 const relevant=values.slice(2*minimum),unit=relevant.reduce(gcd,0n);
 const scales=Number(scale),price=Number(unit)/scales;
 if(!unit)return {quantiles:alphas.map(alpha=>({alpha,minPrice:0,lowerPrice:0,actualProbability:1})),evaluatedBudgetPoints:1,storedCells:0};
 if(!Number.isFinite(scales)||!Number.isFinite(price)||price===0)throw Error('distributionPrecision');
 const costs=steps.flatMap((_,k)=>[Number(values[2*k]/unit),Number((values[2*k]+values[2*k+1])/unit)]);
 if(costs.slice(2*minimum).some(cost=>!Number.isSafeInteger(cost)))throw Error('distributionPrecision');
 const states=steps.length-minimum,retries=steps.slice(minimum).reduce((n,step)=>n+(step.chances?.length??1),0);
 const damping=12,roundoffGuard=1e-6,aliasGuard=Math.exp(-damping)+roundoffGuard;
 // After undoing the radius, folded probability mass adds at most exp(-12)
 // to any CDF in the period. Guard both sides for floating-point error and
 // require additional coverage for the one-sided contribution of folded mass.
 for(let size=32;;size*=2){
  const storedCells=2*size+2*steps.length;
  if(storedCells>maxCells)resourceLimit('memory',{states,storedCells,maxCells});
  const work=(size/2+1)*(retries+states)+size*Math.log2(size);
  if(work>maxWork-budget.used)resourceLimit('work',{states,maxWork,evaluatedCells:budget.used});
  if(size<mean/price*2)continue;
  budget.used+=work;
  const real=new Float64Array(size),imaginary=new Float64Array(size);
  evaluatePassages(real,imaginary,steps,costs,start,minimum,damping);
  invertSpectrum(real,imaginary);
  const lower=Array(alphas.length).fill(-1),upper=Array(alphas.length).fill(-1);
  let cdf=0,compensation=0;
  for(let n=0;n<size;n++){
   const mass=real[n]*Math.exp(damping*n/size)/size-compensation,next=cdf+mass;
   compensation=(next-cdf)-mass;cdf=next;
   if(!Number.isFinite(cdf)||cdf<-roundoffGuard||cdf>1+aliasGuard)throw Error('distributionPrecision');
   for(let i=0;i<alphas.length;i++){
    if(lower[i]<0&&cdf>=alphas[i]-roundoffGuard)lower[i]=n;
    if(upper[i]<0&&cdf>=alphas[i]+aliasGuard)upper[i]=n;
   }
   if(upper.every(index=>index>=0)){
    const money=index=>moneyValue(BigInt(index)*unit,scale);
    return {quantiles:alphas.map((alpha,i)=>({alpha,lowerPrice:money(lower[i]),minPrice:money(upper[i]),actualProbability:null})),evaluatedBudgetPoints:n+1,storedCells,dpStates:states};
   }
  }
 }
}

export function enhancementDistribution(input,result,{maxCells=maxStoredCells,maxWork=maxEvaluatedCells}={}){
 if(!Number.isSafeInteger(maxCells)||maxCells<=0||!Number.isSafeInteger(maxWork)||maxWork<=0)throw Error('invalidConfiguration');
 if(result.pricedGold===null)return null;
 const steps=result.steps;
 const materialPrices=[['shards','shardPrice'],['scrolls','scrollPrice'],['essence','essencePrice'],['cores','corePrice']];
 const {values,scale}=integers([...materialPrices.map(([total,key])=>result.totals[total]>0?input[key]??0:0),...steps.map(s=>s.gold)]);
 const [shard,scroll,essence,core]=values;
 const costs=steps.flatMap((s,k)=>[values[k+4]+BigInt(s.shards)*shard+BigInt(s.essence)*essence+BigInt(s.core)*core,s.protected?scroll:0n]);
 const alphas=enhancementPercentiles.map(p=>p/100),budget={used:0};
 const minimum=enhancementMinimum(steps,input.current),pity=steps.slice(minimum).some(s=>s.chances.length>1);
 const start=input.current;
 if(pity&&steps.length===start+1&&steps[start].failTo===start)return solveStickyPity(steps[start].chances,costs[2*start],costs[2*start+1],scale,alphas,maxWork);
 const relevantCosts=pity?costs.slice(2*minimum):costs;
 let rounds=0,evaluatedBudgetPoints=0,storedCells=0;
 const solveCosts=costs=>pity?solvePity(steps,input.current,minimum,costs,scale,alphas,maxCells,maxWork,budget,result.pricedGold):solve(steps,input.current,costs,scale,alphas,maxCells,maxWork,budget);
 const bound=(q,lowerPrice)=>{
  if(q.minPrice<lowerPrice)throw Error('unreliableCalculation');
  return {alpha:q.alpha,minPrice:q.minPrice,lowerPrice,relativeError:lowerPrice===0?(q.minPrice===0?0:Infinity):(q.minPrice-lowerPrice)/lowerPrice,exact:q.minPrice===lowerPrice,actualProbability:null};
 };
 const exact=()=>{
  const solved=solveCosts(costs);
  const quantiles=solved.quantiles.map(q=>pity?bound(q,q.lowerPrice):{...q,lowerPrice:q.minPrice,relativeError:0,exact:true});
  if(quantiles.some(q=>q.relativeError>.001))throw Error('distributionPrecision');
  return {...solved,exact:quantiles.every(q=>q.exact),evaluatedBudgetPoints:evaluatedBudgetPoints+solved.evaluatedBudgetPoints,storedCells:Math.max(storedCells,solved.storedCells??0),evaluatedCells:budget.used,quantiles};
 };
 if(input.current===input.target||steps.slice(input.current).every(s=>s.chance===1))return exact();
 const exponent=Math.floor(Math.log10(result.pricedGold))-4;
 let grid=exponent>=0?10n**BigInt(exponent)*scale:scale/(10n**BigInt(-exponent));
 if(grid<1n)grid=1n;
 const initialGrid=Number(grid)/Number(scale);
 // Strictly positive base costs avoid zero-cost cycles between states in
 // the lower model. The game's per-attempt gold cost is always positive.
 const minimumCost=costs.filter((_,i)=>i%2===0).reduce((a,b)=>a<b?a:b);
 if(minimumCost<=0n)throw Error('unreliableCalculation');
 while(!pity&&grid>minimumCost)grid/=10n;
 for(;;){
  rounds++;
  if(relevantCosts.every(v=>v%grid===0n))return {...exact(),initialGrid,grid:Number(grid)/Number(scale),rounds};
  const roundCosts=round=>pity?steps.flatMap((_,k)=>{
   const win=costs[2*k],fail=win+costs[2*k+1],roundedWin=round(win);
   return [roundedWin,round(fail)-roundedWin];
  }):costs.map(round);
  const lowerCosts=roundCosts(v=>v/grid*grid),upperCosts=roundCosts(v=>(v+grid-1n)/grid*grid);
  const lower=solveCosts(lowerCosts);
  const upper=solveCosts(upperCosts);
  evaluatedBudgetPoints+=lower.evaluatedBudgetPoints+upper.evaluatedBudgetPoints;
  storedCells=Math.max(storedCells,lower.storedCells??0,upper.storedCells??0);
  const quantiles=upper.quantiles.map((q,i)=>({...bound(q,lower.quantiles[i].lowerPrice??lower.quantiles[i].minPrice),exact:false}));
  if(quantiles.every(q=>q.relativeError<=.001))return {quantiles,exact:false,initialGrid,grid:Number(grid)/Number(scale),rounds,evaluatedBudgetPoints,evaluatedCells:budget.used,storedCells,dpStates:upper.dpStates};
  const widest=Math.max(...quantiles.map(q=>q.relativeError));
  const refinement=pity?BigInt(Number.isFinite(widest)?Math.max(2,Math.ceil(widest/.0009)):2):10n;
  grid=grid>refinement?grid/refinement:1n;
 }
}
