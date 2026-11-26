import {recordActivityTime} from './activity-timing.js';
import * as game from './upstream.js';
import {normalizeCrafting,craftingPlayer,craftingMaterials,recipeKey,validQuantity,safeAdd} from './crafting-model.js';
import {MAX_SIMULATION_MINUTES,manualWindows} from './manual-settings.js';
import {simulationTicks,hotSchedule,combatHotWindows} from './combat-hot.js';
import {START_TICK,simulationTick} from './simulation.js';
import {validateSimulationSeed} from './simulation-seed.js';

import {beforeWork,expectedWorkRewards,expectedCraftProduct,addExpected} from './work-expectation.js';

export const MAX_CRAFT_TICKS=30*24*3600000/game.tickMs;
export function createCraftingScenario(raw,job,tier,count,{now=Date.now(),maxTicks=MAX_CRAFT_TICKS,timeWindow=false,seed=0}={}){
 if(!validQuantity(count)||count===0)throw Error('invalidQuantity');
 if(!Number.isSafeInteger(maxTicks)||maxTicks<1||maxTicks>(timeWindow?simulationTicks(Math.floor(MAX_SIMULATION_MINUTES/60)):MAX_CRAFT_TICKS))throw Error('invalidDuration');
 const {state:s,player:p}=craftingPlayer(raw);
 if(s.levels[job.skill]<job.levelReq)throw Error('levelTooLow');
 const materials=craftingMaterials(job,tier,count),context={...game.createContext(game.world,validateSimulationSeed(seed)),hypothetical:true,windows:manualWindows(START_TICK,START_TICK+maxTicks,s.weeklyXp,s.hotSetting!=='game',job.skill)};
 if(s.hotSetting==='current')context.windows.push(...combatHotWindows(hotSchedule(now,maxTicks,job.skill)));
 let prepared;game.predict(p,context,player=>{prepared=player;return false;});
 const routeJobId=job.upgrade?game.upgradeSiteJob(job.upgrade):job.id;
 const siteId=game.nearestWorkSite(context,routeJobId,prepared.x,prepared.y),site=game.world.siteById.get(siteId);
 if(!site||!site.jobIds.includes(routeJobId))throw Error('noSites');
 const bank=s.homeBank?game.world.bankById.get(s.homeBank):game.homeBank(context,site);
 if(!bank)throw Error('unreachable');
 // Reinitialize from the chosen depot so automatic and manual starts use the
 // same upstream predictor initialization as gathering.
 p.homeBank=bank.id;game.predict(p,context,player=>{prepared=player;return false;});
 prepared.offlineCapTicks=maxTicks*2;
 // At most one recipe can complete per tick. Supply the whole achievable
 // quantity up front, keeping upstream withdrawal sizes and bank trips intact.
 const unitMaterials=Object.entries(craftingMaterials(job,tier,1));
 prepared.bank=Object.fromEntries(unitMaterials.map(([id,qty])=>[id,qty*Math.min(count,maxTicks)]));
 const started=job.upgrade
  ?game.startUpgrade(prepared,context,job.upgrade.id,game.withRarity(job.upgrade.from[0],tier),count)
  :game.startWork(prepared,context,site.id,job.id,'bank',count,tier);
 if(!started)throw Error('invalidRoute');
 return {player:prepared,context,site:game.world.siteById.get(prepared.route.siteId),bank,maxTicks,materials,unitMaterials};
}
export function simulateCrafting(raw,job,tier,count,{onProgress=()=>{},...options}={}){
 const {player:p,context,site,bank,maxTicks,materials,unitMaterials}=createCraftingScenario(raw,job,tier,count,options),initialXp=p.skills[job.skill];
 const r={key:recipeKey(job.id,tier),jobId:job.id,skill:job.skill,tier,count,completed:0,success:0,burnt:0,xp:0,items:{},sampleItems:{},consumed:{},materials,elapsedTicks:0,movingTicks:0,workingTicks:0,deposits:0,siteId:site.id,homeBank:bank.id,startLevel:game.level(initialXp),endLevel:game.level(initialXp),complete:false,error:null};
 r.seed=context.seed;
 for(let tick=1;tick<=maxTicks;tick++){
  recordActivityTime(r,p,START_TICK+tick);
  if(p.activity==='walking')r.movingTicks++;
  if(p.activity==='working')r.workingTicks++;
  const at=START_TICK+tick,before=job.upgrade?null:beforeWork(p,job,at),events=[];simulationTick(p,context,at,events);
  const produced=events.find(e=>e.kind==='produced'),executed=produced||events.some(e=>e.kind==='burnt');
  if(executed&&!job.upgrade){if(!before)throw Error('missingWorkState');expectedCraftProduct(r.items,job,tier,before.burn);expectedWorkRewards(r.items,p,context,job,at,before,produced);}
  for(const e of events){
   if(e.kind==='produced'||e.kind==='burnt'){
    r.completed++;if(e.kind==='burnt')r.burnt++;else r.success++;
    r.sampleItems[e.itemId]=safeAdd(r.sampleItems[e.itemId]??0,e.qty??1);
    if(job.upgrade)addExpected(r.items,e.itemId,e.qty??1);
    for(const [id,qty] of unitMaterials)r.consumed[id]=safeAdd(r.consumed[id]??0,qty);
   }
   if(['bonus','pet','mount','voidshard','box'].includes(e.kind)){const id=e.kind==='box'?(e.itemId??game.lootBoxItemId):e.itemId;if(!Number.isSafeInteger(id))throw Error('invalidReward');r.sampleItems[id]=safeAdd(r.sampleItems[id]??0,e.qty??1);if(e.kind==='box')addExpected(r.items,id,e.qty??1);}
   if(e.kind==='deposited')r.deposits++;
   if(e.kind==='routeStopped'&&e.reason!=='done')r.error=`routeStopped:${e.reason}`;
  }
  r.elapsedTicks=tick;
  if(r.completed===count){r.complete=true;break;}
  if(r.error||p.route===null){r.error??='routeStopped';break;}
  if(tick%Math.max(game.predictionChunkTicks,6000)===0)onProgress({completed:r.completed,count,ticks:tick});
 }
 if(!r.complete&&!r.error)r.error='timeLimit';
 r.xp=p.skills[job.skill]-initialXp;r.endLevel=game.level(p.skills[job.skill]);return r;
}

// A completed time window is valid even though an unlimited count is unfinished.
export function simulateCraftingWindow(raw,job,tier,options={}){
 const ticks=simulationTicks(normalizeCrafting(raw).simulationHours);
 const result=simulateCrafting(raw,job,tier,ticks,{...options,maxTicks:ticks,timeWindow:true});
 if(result.error==='timeLimit'){result.error=null;result.complete=true;}
 return result;
}
