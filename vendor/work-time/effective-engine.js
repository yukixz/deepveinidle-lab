import {gatheringSkills} from './domain.js';
import {callRule,requireCapability,tickMilliseconds,validateAdapter} from './adapter.js';
import {createBatchTimeEstimator} from './batch-time.js';
import {createBossFeedEstimator} from './boss-feed.js';
import {gatheringPackCapacity} from './gathering-pack.js';

const checked=value=>{if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw Error('quantityOverflow');return value;};
const probability=value=>{if(!Number.isFinite(value)||value<0||value>1)throw Error('invalidResult');return value;};
const validNumber=value=>Number.isFinite(value)&&value>=0;
const itemId=value=>{if(!Number.isSafeInteger(value)||value<0)throw Error('invalidResult');return value;};
const add=(items,id,quantity)=>{if(quantity>0)items[itemId(id)]=checked((items[id]??0)+quantity);};

// Final attributes are snapshots. This module never reconstructs equipment,
// perks, masteries or brews, and never advances the snapshot during a task.
export function createWorkTimeEngine(game={}){
 validateAdapter(game);
 const batchTime=createBatchTimeEstimator(game,{resolveMovement:character=>{
  const movement=character?.movement;
  if(!movement||!Number.isFinite(movement.strideSpeed)||movement.strideSpeed<=0
   ||!Number.isSafeInteger(movement.capacity)||movement.capacity<0)return null;
  return {strideSpeed:movement.strideSpeed,slots:movement.capacity};
 }});
 function resolve({character,task}){
  if(!task)throw Error('invalidJob');
  let tier=task.tier===undefined?0:task.tier;
  if(!Number.isInteger(tier)||tier<0||tier>4)throw Error('invalidTier');
  if(task.discard!==undefined&&typeof task.discard!=='boolean')throw Error('invalidWorkConfiguration');
  const upgrade=typeof task.jobId==='string'&&/^upgrade-\d+$/.test(task.jobId);
  const capability=upgrade?'upgradeRecipes':'recipes';
  requireCapability(Array.isArray(game[capability]),'resolveTask',capability);
  const id=upgrade?Number(task.jobId.slice(8)):task.jobId;
  if(!Number.isSafeInteger(id))throw Error('invalidJob');
  const original=game[capability].find(job=>job?.id===id);
  if(!original||typeof original.skill!=='string'||!Number.isSafeInteger(original.levelReq)||original.levelReq<1)throw Error('invalidJob');
  let job=original,input;
  if(upgrade){
   if(task.inputItemId!==undefined){
    input=itemId(task.inputItemId);
    const base=callRule(game,'baseItemId','resolveTask.upgrade',input);
    const inputTier=callRule(game,'itemTier','resolveTask.upgrade',input);
    if(!Array.isArray(original.from)||!original.from.includes(base)||!Number.isInteger(inputTier)||inputTier<0||inputTier>4
     ||task.tier!==undefined&&tier!==inputTier)throw Error('invalidWorkConfiguration: invalid upgrade inputItemId or tier');
    tier=inputTier;
   }
   // The timing-only path needs no item declarations or conversion rules.
   job={...original,id:task.jobId,inputs:[],output:{qty:1},upgrade:original};
  }
  if(!Number.isSafeInteger(job.output?.qty)||job.output.qty<=0||!Array.isArray(job.inputs))throw Error('invalidJob');
  const skill=character?.skills?.[job.skill];
  if(!Number.isSafeInteger(skill?.level)||skill.level<1)throw Error('invalidWorkConfiguration');
  return {character,task,tier,job,skill,input};
 }
 function upgradeItems(context){
  const {job,tier}=context,upgrade=job.upgrade,feature='estimateWorkExpectation.upgrade';
  if(!Array.isArray(upgrade.from)||!Array.isArray(upgrade.to)||upgrade.from.length!==upgrade.to.length||upgrade.from.length===0)throw Error('invalidJob');
  let input=context.input;
  if(input===undefined){
   if(upgrade.from.length!==1)throw Error('invalidWorkConfiguration: inputItemId required for upgrade');
   input=itemId(callRule(game,'withRarity',feature,upgrade.from[0],tier));
  }
  const output=callRule(game,'upgradeResult',feature,upgrade,input);
  if(output===null||output===undefined)throw Error('invalidWorkConfiguration: invalid upgrade inputItemId');
  const extra=callRule(game,'upgradeMaterials',feature,upgrade,input);
  if(!Array.isArray(extra?.named))throw Error('invalidResult');
  return {input,output:itemId(output),extra:extra.named};
 }
 function mode(task){
  const hasCount=task.count!==undefined,hasQuantity=task.quantity!==undefined;
  if(hasCount===hasQuantity)throw Error('invalidQuantity');
  if(hasCount){if(!Number.isSafeInteger(task.count)||task.count<=0)throw Error('invalidQuantity');}
  else if(!Number.isFinite(task.quantity)||task.quantity<=0||task.quantity>Number.MAX_SAFE_INTEGER)throw Error('invalidQuantity');
  return hasCount;
 }
 function action(context){
  const {job,skill}=context,feature='workActionSeconds';
  requireCapability(validNumber(game.levelSpeedCoefficient),feature,'levelSpeedCoefficient');
  const factor=1+Math.max(0,skill.level-job.levelReq)*game.levelSpeedCoefficient;
  const speed=job.upgrade?skill.upgradeSpeedMultiplier:skill.speedMultiplier;
  if(!validNumber(speed))throw Error('invalidWorkConfiguration');
  if(speed===0)return null;
  if(job.upgrade){
   const base=callRule(game,'upgradeBaseTicks',feature,job.upgrade);
   if(!Number.isSafeInteger(base)||base<1)throw Error('invalidResult');
   return checked(Math.max(1,Math.round(base/(factor*speed)))*tickMilliseconds(game,feature)/1000);
  }
  if(!Number.isFinite(job.baseTicks)||job.baseTicks<=0)throw Error('invalidJob');
  const chance=Math.min(1,factor*speed/job.baseTicks);
  return checked(tickMilliseconds(game,feature)/1000/chance);
 }
 function rarityMultiplier(context,environment,feature){
  const {skill,job}=context;
  if(!validNumber(skill.luck)||!validNumber(skill.rareFindBonus)||!Number.isSafeInteger(environment?.tick)||environment.tick<0
   ||!validNumber(environment.worldRarityBonus))throw Error('invalidWorkConfiguration');
  const hot=callRule(game,'hotRarityMultiplier',feature,environment.tick,job.skill);
  if(!validNumber(hot))throw Error('invalidResult');
  const multiplier=(1+skill.luck)*(1+skill.rareFindBonus+environment.worldRarityBonus+hot-1);
  if(!validNumber(multiplier))throw Error('invalidResult');
  return multiplier;
 }
 function rarity(context,environment){
  const feature='workQualities',keys=['uncommon','rare','epic','legendary'],thresholds=game.rarityThresholds;
  requireCapability(keys.every((key,index)=>Number.isFinite(thresholds?.[key])&&thresholds[key]>=0&&thresholds[key]<=1
   &&(index===0||thresholds[key]<=thresholds[keys[index-1]])),feature,'rarityThresholds');
  const multiplier=rarityMultiplier(context,environment,feature);
  const cumulative=keys.map(key=>Math.min(1,thresholds[key]*multiplier));
  return [1-cumulative[0],cumulative[0]-cumulative[1],cumulative[1]-cumulative[2],cumulative[2]-cumulative[3],cumulative[3]];
 }
 function supports(id,feature){
  const result=callRule(game,'itemSupportsRarity',feature,id);
  if(typeof result!=='boolean')throw Error('invalidResult');
  return result;
 }
 function mainQualities(context,environment){
  const {job,tier}=context;
  if(job.upgrade||!gatheringSkills.includes(job.skill))return [0,1,2,3,4].map(value=>Number(value===tier));
  if(job.plain||!supports(job.output.itemId,'workQualities'))return [1,0,0,0,0];
  return rarity(context,environment);
 }
 function qualityOutputs(id,qualities,feature){
  return qualities.flatMap((probability,tier)=>probability>0?
   [{id:tier===0?id:callRule(game,'withRarity',feature,id,tier),probability}]:[]);
 }
 function bonusOutputs(context,environment){
  const {bonus}=context.job,feature='estimateWorkExpectation.bonus';
  if(!supports(bonus.itemId,feature))return [{id:bonus.itemId,probability:1}];
  const minimum=callRule(game,'bonusMinimumUncommon',feature,bonus.itemId);
  if(typeof minimum!=='boolean')throw Error('invalidResult');
  const distribution=rarity(context,environment);
  if(minimum){distribution[1]+=distribution[0];distribution[0]=0;}
  return qualityOutputs(bonus.itemId,distribution,feature);
 }
 function singleItemRoll(id,chance){
  return {outcomes:[{id:itemId(id),probability:1}],units:1,chance};
 }
 function successfulGatheringRolls(context,environment){
  const {job,skill}=context,feature='estimateBatchTime.gatheringDrops';
  if(!validNumber(skill.keyDropMultiplier)||skill.keyDropMultiplier<1)throw Error('invalidWorkConfiguration');
  const main=context.mainOutputs??qualityOutputs(job.output.itemId,mainQualities(context,environment),'estimateWorkExpectation.products');
  const rolls=[{outcomes:main,units:job.output.qty,chance:1}];
  if(job.bonus){
   itemId(job.bonus.itemId);probability(job.bonus.chance);
   if(job.bonus.chance>0)rolls.push({
    outcomes:context.bonusOutputs??bonusOutputs(context,environment),units:1,chance:job.bonus.chance,
   });
  }
  const pet=callRule(game,'skillPet',feature,job.skill);
  if(pet!=null)rolls.push(singleItemRoll(pet.itemId,probability(callRule(game,'skillPetChance',feature,job.skill))));
  const tier=callRule(game,'dungeonKeyTier',feature,job.levelReq);
  if(!Array.isArray(tier?.finds))throw Error('invalidResult');
  if(tier.finds.length){
   const xp=callRule(game,'levelXp',feature,skill.level);
   if(!validNumber(xp))throw Error('invalidResult');
   const baseTicks=callRule(game,'dungeonKeyBaseTicks',feature,job,xp);
   if(!validNumber(baseTicks)||baseTicks===0)throw Error('invalidResult');
   const multiplier=rarityMultiplier(context,environment,feature);
   for(const find of tier.finds){
    const id=itemId(find?.itemId);
    const chance=probability(callRule(game,'dungeonKeyChance',feature,find,baseTicks,multiplier));
    rolls.push(singleItemRoll(id,Math.min(1,chance*skill.keyDropMultiplier)));
   }
  }
  return rolls;
 }
 function gatheringCapacity(context,environment){
  const {job,task,result}=context;
  if(task.discard||job.upgrade||job.inputs.length
   ||!gatheringSkills.includes(job.skill)||job.skill==='thieving')return undefined;
  return slots=>{
   if(slots===0)return 0;
   const burn=result?.burn??risk(context,'burn'),caught=result?.caught??risk(context,'caught');
   const success=(1-burn)*(1-caught),branches=[];
   if(burn>0)branches.push({chance:burn,rolls:[singleItemRoll(job.burn.itemId,1)]});
   if(success>0)branches.push({chance:success,rolls:successfulGatheringRolls(context,environment)});
   return branches.length?gatheringPackCapacity(game,slots,branches):Infinity;
  };
 }
 function risk(context,key){
  const {job,skill}=context,rule=job[key];
  if(rule===undefined)return 0;
  if(!Number.isFinite(rule.chanceAtReq)||rule.chanceAtReq<0||rule.chanceAtReq>1
   ||!Number.isFinite(rule.safeAtLevel)||rule.safeAtLevel<=job.levelReq)throw Error('invalidJob');
  if(!validNumber(skill.failureMultiplier))throw Error('invalidWorkConfiguration');
  return probability(Math.max(0,rule.chanceAtReq*(1-(skill.level-job.levelReq)/(rule.safeAtLevel-job.levelReq)))*skill.failureMultiplier);
 }
 function expected(options){
  const context=resolve(options),{job,skill,task,tier}=context,countMode=mode(task);
  if(skill.level<job.levelReq)return {...context,result:{status:'levelTooLow',seconds:null}};
  const actionSeconds=action(context);
  const requested=countMode?null:checked(Math.ceil(task.quantity/job.output.qty)*job.output.qty);
  const unavailable={status:'unreachable',attempts:null,quantity:requested,burn:null,caught:null,quality:null,actionSeconds,waitSeconds:null,materials:null,products:null};
  if(actionSeconds===null)return {...context,result:unavailable};
  const burn=job.upgrade?0:risk(context,'burn'),caught=job.upgrade?0:risk(context,'caught');
  const qualities=mainQualities(context,options.environment),quality=qualities[tier];
  let waitSeconds=0;
  if(caught>0){
   if(!Number.isSafeInteger(job.caught.stunTicks)||job.caught.stunTicks<0)throw Error('invalidJob');
   // The game consumes inputs, then checks burn, then caught. Burn ends the
   // event before any caught stun, and its byproduct is exactly one item.
   waitSeconds=checked((1-burn)*caught*Math.max(0,job.caught.stunTicks-1)*tickMilliseconds(game,'estimateWorkExpectation')/1000);
  }
  const success=(1-burn)*(1-caught),targetChance=success*quality;
  if(!countMode&&targetChance===0)return {...context,result:{...unavailable,burn,caught,quality,waitSeconds}};
  const attempts=countMode?task.count:checked(requested/job.output.qty/targetChance);
  const quantity=countMode?checked(attempts*job.output.qty*targetChance):requested;
  const materials={},products={};
  let inputs;
  if(job.upgrade){
   const upgraded=upgradeItems(context);
   inputs=[{itemId:upgraded.input,qty:1},...upgraded.extra];
   add(products,upgraded.output,attempts);
  }else{
   inputs=callRule(game,'recipeInputs','estimateWorkExpectation.materials',job,tier);
   if(gatheringSkills.includes(job.skill)){
    context.mainOutputs=qualityOutputs(job.output.itemId,qualities,'estimateWorkExpectation.products');
    for(const {id,probability:chance} of context.mainOutputs)add(products,id,checked(attempts*success*job.output.qty*chance));
   }else add(products,callRule(game,'recipeOutput','estimateWorkExpectation.products',job,tier),checked(attempts*success*job.output.qty));
   if(burn>0)add(products,job.burn.itemId,checked(attempts*burn));
   if(job.bonus){
    const bonus=job.bonus;
    itemId(bonus.itemId);probability(bonus.chance);
    const amount=checked(attempts*success*bonus.chance);
    context.bonusOutputs=bonusOutputs(context,options.environment);
    for(const {id,probability:chance} of context.bonusOutputs)add(products,id,checked(amount*chance));
   }
  }
  if(!Array.isArray(inputs))throw Error('invalidResult');
  for(const input of inputs){
   if(!input||!Number.isSafeInteger(input.qty)||input.qty<0)throw Error('invalidResult');
   itemId(input.itemId);
   add(materials,input.itemId,checked(input.qty*attempts));
  }
  return {...context,result:{status:'ok',attempts,quantity,burn,caught,quality,actionSeconds,waitSeconds,materials,products}};
 }
 function estimateWorkExpectation(options){return expected(options).result;}
 function estimateTaskTime(options){
  const context=expected(options),{result,job,tier,task,character}=context;
  if(result.status!=='ok')return {...result,seconds:null};
  return {...result,...batchTime({job,tier,count:result.attempts,player:character,actionSeconds:result.actionSeconds+result.waitSeconds,
   discard:task.discard??false,siteId:task.siteId,resolveCapacity:gatheringCapacity(context,options.environment)})};
 }
 function estimateBatchTime(options){
  const context=resolve(options),{job,tier,skill,task,character}=context;
  if(!mode(task))throw Error('invalidQuantity: estimateBatchTime requires count');
  if(skill.level<job.levelReq)return {status:'levelTooLow',seconds:null};
  const actionSeconds=action(context);
  if(actionSeconds===null)return {status:'unreachable',seconds:null,workSeconds:null,overheadSeconds:null,batches:null,batchCapacity:null};
  return batchTime({job,tier,count:task.count,player:character,actionSeconds,discard:task.discard??false,
   siteId:task.siteId,resolveCapacity:gatheringCapacity(context,options.environment)});
 }
 return Object.freeze({estimateTaskTime,estimateBatchTime,estimateWorkExpectation,
  estimateBossFeedRate:createBossFeedEstimator(game),
  workActionSeconds:options=>{const context=resolve(options);return context.skill.level<context.job.levelReq?null:action(context);},
  workQualities:options=>mainQualities(resolve(options),options.environment)});
}
