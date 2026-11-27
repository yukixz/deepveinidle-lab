import {itemPrice} from './item-prices.js';
import {readGuild} from './guild.js';
import {characterMasteries} from './character-masteries.js';
import * as game from './upstream.js';

export const enhancementStorageKey='dvi-enhancement-v1';
export const enhanceableItems=[...new Set([...game.equipment,...game.tools].map(x=>game.baseItemId(x.itemId)))]
 .filter(id=>game.canEnhance(id)).map(id=>game.item(id));
const priceFields=['shardPrice','scrollPrice','essencePrice','corePrice','basePrice'];
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function enhancementDefaults(){return {guild:null,itemId:328,tier:4,current:0,target:10,level:1,lectern:0,mastery:0,protect:true,protectFrom:2,useCore:false,shardPrice:null,scrollPrice:null,essencePrice:null,corePrice:null,basePrice:null,taxRate:3,profitRate:10,priceModes:Object.fromEntries(priceFields.map(key=>[key,'global'])),basePriceItem:null};}
export function validateEnhancement(input,{allowUnsupportedTarget=false}={}){
 if(!record(input))throw Error('invalidConfiguration');
 const s={useCore:false,essencePrice:null,corePrice:null,...input,guild:readGuild(input.guild),lectern:Object.hasOwn(input,'lectern')?input.lectern:0,taxRate:Object.hasOwn(input,'taxRate')?input.taxRate:3,profitRate:Object.hasOwn(input,'profitRate')?input.profitRate:10};
 if(!enhanceableItems.some(x=>x.id===s.itemId)||!integer(s.tier,0,4)||!game.canEnhance(game.withRarity(s.itemId,s.tier)))throw Error('invalidItem');
 for(const [key,min,max]of [['current',0,game.maxEnhancement],['target',0,game.maxEnhancement],['level',1,game.maxLevel],['lectern',0,game.houseLevelLimit],['mastery',0,game.masteryRankLimit],['protectFrom',game.protectionMin,game.maxEnhancement]])if(!integer(s[key],min,max))throw Error('invalidConfiguration');
 validateFeeRates(s.profitRate,s.taxRate);
 if(typeof s.protect!=='boolean'||typeof s.useCore!=='boolean')throw Error('invalidConfiguration');
 for(const key of priceFields)if(s[key]!==null&&(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<0||s[key]>Number.MAX_SAFE_INTEGER))throw Error('invalidPrice');
 if(!record(input.priceModes)||!Object.hasOwn(input,'basePriceItem'))throw Error('invalidPrice');
 const priceModes={essencePrice:'global',corePrice:'global',...input.priceModes};
 s.priceModes=Object.fromEntries(priceFields.map(key=>[key,priceModes[key]]));
 for(const [key,mode]of Object.entries(s.priceModes))if(!['global','manual',...(key==='basePrice'?['owned']:[])].includes(mode))throw Error('invalidPrice');
 const baseId=game.encode(game.withRarity(s.itemId,s.tier),s.current);
 s.basePriceItem=input.basePriceItem;
 if(s.basePriceItem!==null&&!integer(s.basePriceItem,0,Number.MAX_SAFE_INTEGER))throw Error('invalidPrice');
 if(s.priceModes.basePrice!=='global'&&s.basePriceItem!==baseId){s.priceModes.basePrice='global';s.basePrice=null;s.basePriceItem=null;}
 if(s.target<s.current)throw Error('targetBelowCurrent');
 if(!allowUnsupportedTarget&&s.target>game.itemEnhancementLimit(baseId)&&s.target!==s.current)throw Error('targetAboveLimit');
 return s;
}
export function enhancementSteps(input){
 const s=validateEnhancement(input),p={skills:{enhancing:game.levelXp(s.level)},house:{lectern:s.lectern},houseFurniture:s.lectern?{lectern:{cell:0,slot:0}}:{},masteries:{enhance:s.mastery},brews:{},lastTick:0};
 const item=game.withRarity(s.itemId,s.tier),pityLimit=Math.ceil(game.enhanceRules.pityMaxLift/game.enhanceRules.pityStep);
 return Array.from({length:s.target===s.current?0:s.target},(_,k)=>{
  const withoutCore=game.enhanceChance(p,k),useCore=s.useCore&&withoutCore<1;
  const baseChance=useCore?game.enhanceChance(p,k,true):withoutCore,protectedStep=s.protect&&k>=s.protectFrom;
  const chances=game.enhancePityActive(k)?Array.from({length:pityLimit+1},(_,failures)=>game.enhancePityChance(baseChance,failures)):[baseChance];
  return {from:k,to:k+1,chance:chances[0],chances,...game.enhanceCost(game.encode(item,k),useCore),failTo:game.enhanceProtectedFailTo(k,protectedStep),protected:protectedStep,xp:game.enhanceXp(p,{windows:[]},0,item,k)};
 });
}
const sum=values=>values.reduce((total,value)=>total+value,0);
// Reaching the next level clears this step's pity. Its rollback is rebuilt
// through independent lower first passages, with pity kept at the failed step.
function expectedCost(steps,start,attempts,cost,failureCost=()=>0){
 const passages=[];
 for(const [k,step]of steps.entries()){
  const rollback=sum(passages.slice(step.failTo,k)),{attempts:tries,failures}=attempts[k];
  passages.push(tries*cost(step)+failures*(failureCost(step)+rollback));
 }
 const result=sum(passages.slice(start));
 if(!Number.isFinite(result))throw Error('unreliableCalculation');
 return result;
}
function expectedAttempts(chances){
 const tail=chances.at(-1);
 let failures=(1-tail)/tail;
 for(let i=chances.length-2;i>=0;i--)failures=(1-chances[i])*(1+failures);
 return {attempts:1+failures,failures};
}
export function enhancementMinimum(steps,start){
 let minimum=start;
 for(let k=steps.length-1;k>=minimum;k--)if(steps[k].chance<1)minimum=Math.min(minimum,steps[k].failTo);
 return minimum;
}
function validateFeeRates(profitRate,taxRate){
 if(typeof profitRate!=='number'||!Number.isFinite(profitRate)||profitRate<0||profitRate>=100)throw Error('invalidProfitRate');
 if(typeof taxRate!=='number'||!Number.isFinite(taxRate)||taxRate<0||taxRate>=100)throw Error('invalidTaxRate');
 if(profitRate+taxRate>=100)throw Error('invalidFeeRates');
}
export function enhancementFee(cost,profitRate,taxRate=0){
 validateFeeRates(profitRate,taxRate);
 return cost===null?null:cost/(1-taxRate/100-profitRate/100);
}
export function calculateEnhancement(input){
 const s=validateEnhancement(input),steps=enhancementSteps(s),totals={},attempts=steps.map(step=>expectedAttempts(step.chances));
 for(const [key,cost]of Object.entries({gold:x=>x.gold,shards:x=>x.shards,essence:x=>x.essence,cores:x=>x.core,attempts:()=>1}))totals[key]=expectedCost(steps,s.current,attempts,cost);
 totals.scrolls=expectedCost(steps,s.current,attempts,()=>0,step=>step.protected?1:0);
 totals.seconds=totals.attempts*game.enhanceTicks*game.tickMs/1000;
 const materials={shards:s.shardPrice,scrolls:s.scrollPrice,essence:s.essencePrice,cores:s.corePrice};
 const missingPrices=Object.keys(materials).filter(key=>totals[key]>0&&materials[key]===null);
 const pricedGold=missingPrices.length?null:totals.gold+sum(Object.entries(materials).map(([key,price])=>totals[key]*(price??0)));
 const purchaseTotal=pricedGold!==null&&s.basePrice!==null?pricedGold+s.basePrice:null;
 const expectedFee=enhancementFee(purchaseTotal,s.profitRate,s.taxRate);
 if([totals.seconds,pricedGold,purchaseTotal,expectedFee].some(v=>v!==null&&!Number.isFinite(v)))throw Error('unreliableCalculation');
 return {steps,totals,missingPrices,pricedGold,purchaseTotal,expectedFee};
}
export function decodeEnhancementItem(id){
 if(!integer(id,0,Number.MAX_SAFE_INTEGER))throw Error('invalidSnapshot');
 const itemId=game.baseItemId(id),tier=game.itemTier(id),current=game.itemEnhancement(id),relics=game.itemRelics(id);
 if(!enhanceableItems.some(x=>x.id===itemId))return null;
 if(!integer(tier,0,4)||!integer(current,0,game.maxEnhancement)||!game.canEnhance(id)||game.encodeRelics(game.encode(game.withRarity(itemId,tier),current),relics)!==id)throw Error('invalidSnapshot');
 try{game.item(id);}catch{throw Error('invalidSnapshot');}
 return {itemId,tier,current,id,...(relics?{relics}:{})};
}
export function importEnhancement(current,snapshot){
 if(!record(snapshot)||snapshot.version!==2||!integer(snapshot.capturedAt,1,Number.MAX_SAFE_INTEGER)||snapshot.capturedAt>Date.now()+60000||!record(snapshot.player))throw Error('invalidSnapshot');
 const guild=readGuild(snapshot.guild),p=snapshot.player;
 const {ranks,source:masterySource}=characterMasteries(p,'enhancing');
 if(!record(p.skills)||typeof p.skills.enhancing!=='number'||!Number.isFinite(p.skills.enhancing)||p.skills.enhancing<0||!record(p.house)||!record(p.houseFurniture)||!record(ranks))throw Error('incompleteSnapshot');
 const lectern=p.house.lectern??0,mastery=ranks.enhance??0;
 if(!integer(lectern,0,game.houseLevelLimit)||!integer(mastery,0,game.masteryRankLimit)||Object.hasOwn(p.houseFurniture,'lectern')&&!record(p.houseFurniture.lectern))throw Error('invalidSnapshot');
 const state=validateEnhancement({...current,guild,level:game.level(p.skills.enhancing),lectern:Object.hasOwn(p.houseFurniture,'lectern')?lectern:0,mastery});
 return {state,capturedAt:snapshot.capturedAt,masterySource};
}

export function resolveEnhancementPrices(input,prices={},priceFor=id=>itemPrice(id,prices),ignoreMaterials=false){
 const s=validateEnhancement(input),baseId=game.encode(game.withRarity(s.itemId,s.tier),s.current);
 const enhancementPriceItems={shardPrice:game.enhanceShardId,scrollPrice:game.enhanceScrollId,essencePrice:game.enhanceEssenceId,corePrice:game.enhanceCoreId};
 for(const key of priceFields){
  if(ignoreMaterials&&key!=='basePrice')s[key]=0;
  else if(s.priceModes[key]==='global')s[key]=priceFor(key==='basePrice'?baseId:enhancementPriceItems[key],key);
  else if(s.priceModes[key]==='owned')s[key]=0;
 }
 return s;
}
