import {createWorkTimeEngine} from '../vendor/work-time/index.js';
import * as game from './upstream.js';
import {selectedGatheringSites,toolSlots} from './gathering-model.js';
import {createGatheringScenario} from './gathering-simulation.js';
import {createCraftingScenario} from './crafting-simulation.js';
import {simulationTicks} from './combat-hot.js';
import {START_TICK} from './simulation.js';
import {addExpected,expectedWorkExtras,expectedDungeonKeys} from './work-expectation.js';
import {workStrideSpeed} from './work-config-effects.js';

const native=game.bossFeedRules,workTimeRules=game.bossWorkTimeGame;
const tickSeconds=game.tickMs/1000;

function workScenario(input){
 const {job,now}=input;
 if(input.objective==='craftXp')return createCraftingScenario(input.crafting,job,input.tier,1,{now,maxTicks:simulationTicks(input.crafting.simulationHours),timeWindow:true});
 const [site]=selectedGatheringSites(input.gathering,job);
 if(!site)throw Error('noSites');
 const scenario=createGatheringScenario(input.gathering,job,site,{now});
 let player;
 game.predict(scenario.player,scenario.context,prepared=>{player=prepared;return false;});
 return {...scenario,player,site};
}

function workIntervals(windows,durationTicks){
 const first=START_TICK+1,end=first+durationTicks;
 const edges=[...new Set([first,end,...windows.flatMap(w=>[w.fromTick,w.toTick+1]).filter(tick=>tick>first&&tick<end)])].sort((a,b)=>a-b);
 return edges.slice(0,-1).map((tick,index)=>({tick,until:edges[index+1],environment:{tick,worldRarityBonus:game.windowModifiers(windows,tick).rarityMult-1}}));
}

function batchAttempts(upper,seconds,estimate){
 let low=0,high=Math.floor(upper);
 while(low<high){
  const mid=Math.ceil((low+high)/2);
  if(estimate(mid).seconds<=seconds)low=mid;
  else high=mid-1;
 }
 return low;
}

export function createMasteryWorkEstimator(input,{crafting,experience,collection}){
 const {job}=input,{player:initial,context,site,bank,durationTicks,maxTicks,discardGathered:discard=false}=workScenario(input);
 const origin={x:initial.x,y:initial.y};
 const siteEntrance=(world,x,y,seed,from)=>{
  if(!from&&x===bank.x&&y===bank.y)return origin;
  return game.nearbyTile(world,x,y,x===site.x&&y===site.y?initial.id:seed,from);
 };
 const adjacent=Math.abs(site.x-origin.x)<=1&&Math.abs(site.y-origin.y)<=1;
 const entrance=adjacent?origin:siteEntrance(game.world,site.x,site.y,0,origin);
 const path=entrance&&workTimeRules.walkPath(game.world,origin.x,origin.y,entrance.x,entrance.y);
 if(!path)throw Error('unreachable');
 // Bind the batch estimator's depot key to the actual depot and starting tile.
 // The scenario's windows already carry the selected hot schedule.
 const engine=createWorkTimeEngine({...workTimeRules,world:{...game.world,bankById:new Map([[1,bank]])},siteEntrance,
  hotRarityMultiplier:(tick,skill)=>game.hotRarityMultiplier(tick,skill,context.hypothetical)});
 const intervals=workIntervals(context.windows,durationTicks??maxTicks);
 const totalSeconds=(durationTicks??maxTicks)*tickSeconds;
 const tier=crafting?input.tier:0,raw=job.inputs?.length===0;
 const roundTrips=!discard&&!job.upgrade&&job.skill!=='thieving';
 const countTask={jobId:job.id,tier,siteId:site.id,count:1};

 return ranks=>{
  const player={...initial,masteries:ranks};
  const speed=game.workModifiers(player,job.skill);
  const equipped=player.equipment[toolSlots[job.skill]];
  const luck=(equipped==null?0:game.toolLuck(equipped))+game.equipmentLuck(player.equipment);
  const character={
   skills:{[job.skill]:{level:game.level(player.skills[job.skill]),speedMultiplier:speed.combined,
    upgradeSpeedMultiplier:speed.tool*game.combine(speed.quick,speed.home)*speed.mastery,failureMultiplier:1-.03*player.perks.hands,
    luck,rareFindBonus:game.combine(game.brewRarityMultiplier(player),game.houseRarityMultiplier(player),game.masteryMultiplier(ranks,'rare'))-1}},
   movement:{strideSpeed:workStrideSpeed(player),capacity:game.packCapacity(player)},
  };
  const options={character,task:countTask,environment:intervals[0].environment};
  const walkingTicks=path.length?Math.ceil(path.length*1000/character.movement.strideSpeed)+1:0;
  const workStart=START_TICK+1+walkingTicks;
  const activeSeconds=Math.max(0,totalSeconds-walkingTicks*tickSeconds);
  const unavailable={endedEarly:true,complete:false};
  if(job.upgrade){
   const actionSeconds=engine.workActionSeconds(options);
   return actionSeconds?{complete:true,xp:Math.floor(activeSeconds/actionSeconds)*job.xp}:unavailable;
  }
  const unit=engine.estimateWorkExpectation(options);
  if(unit.status!=='ok')return unavailable;
  let attempts=activeSeconds/(unit.actionSeconds+unit.waitSeconds),batchCapacity=null;
  if(roundTrips||discard&&job.skill!=='thieving'){
   const estimate=count=>engine.estimateBatchTime({character,task:{...countTask,count}});
   const batch=estimate(1);
   if(batch.status!=='ok')return unavailable;
   batchCapacity=batch.batchCapacity;
   if(roundTrips)attempts=batchAttempts(attempts,totalSeconds,estimate);
  }
  const success=(1-unit.burn)*(1-unit.caught),completed=attempts*success;
  // After repeated discards, the final partial pack is typically half full.
  const retained=discard&&batchCapacity!==null&&completed>batchCapacity?batchCapacity/(2*completed):1;
  const items={},extras={};let xp=0,coins=0;
  if(attempts===0)return {complete:true,xp,coins,normalItems:items,rareItems:extras};
  for(const {tick,until,environment} of intervals){
   const span=until-Math.max(tick,workStart);
   if(span<=0)continue;
   const count=attempts*span/(activeSeconds/tickSeconds);
   const interval={...options,environment};
   if(experience){
    const qualities=engine.workQualities(interval);
    const perSuccess=qualities.reduce((sum,p,quality)=>sum+p*native.productionXp(player,context,job,quality,tick,raw),0);
    xp+=count*success*perSuccess;
   }else{
    expectedDungeonKeys((id,quantity)=>addExpected(extras,id,quantity),player,context,job,tick,count*success);
    const {products}=engine.estimateWorkExpectation(interval);
    for(const [id,quantity] of Object.entries(products)){
     if(Number(id)===game.coinItemId)coins+=count*quantity;
     else addExpected(items,id,count*quantity*(collection?1:retained));
    }
   }
  }
  if(!experience)expectedWorkExtras((id,quantity)=>addExpected(extras,id,quantity*completed),player,job,unit.actionSeconds/tickSeconds);
  return {complete:true,xp,coins,normalItems:items,rareItems:extras};
 };
}
