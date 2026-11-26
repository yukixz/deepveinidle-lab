import {itemPrice} from './item-prices.js';
import {readGuild} from './guild.js';
import {characterMasteries} from './character-masteries.js';
import * as game from './upstream.js';

export const enhancementStorageKey='dvi-enhancement-v1';
export const enhanceableItems=[...new Set([...game.equipment,...game.tools].map(x=>x.itemId))]
 .filter(id=>game.canEnhance(id)).map(id=>game.item(id));
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function enhancementDefaults(){return {guild:null,itemId:328,tier:4,current:0,target:10,level:1,lectern:0,mastery:0,protect:true,protectFrom:game.protectionMin,shardPrice:null,scrollPrice:null,basePrice:null,taxRate:3,profitRate:10,priceModes:{shardPrice:'global',scrollPrice:'global',basePrice:'global'},basePriceItem:null};}
export function validateEnhancement(input,{allowUnsupportedTarget=false}={}){
 if(!record(input))throw Error('invalidConfiguration');
 const s={...input,guild:readGuild(input.guild),lectern:Object.hasOwn(input,'lectern')?input.lectern:0,taxRate:Object.hasOwn(input,'taxRate')?input.taxRate:3,profitRate:Object.hasOwn(input,'profitRate')?input.profitRate:10};
 if(!enhanceableItems.some(x=>x.id===s.itemId)||!integer(s.tier,0,4)||!game.canEnhance(game.withRarity(s.itemId,s.tier)))throw Error('invalidItem');
 for(const [key,min,max]of [['current',0,game.maxEnhancement],['target',0,game.maxEnhancement],['level',1,game.maxLevel],['lectern',0,game.houseLevelLimit],['mastery',0,game.masteryRankLimit],['protectFrom',game.protectionMin,game.maxEnhancement]])if(!integer(s[key],min,max))throw Error('invalidConfiguration');
 validateFeeRates(s.profitRate,s.taxRate);
 if(typeof s.protect!=='boolean')throw Error('invalidConfiguration');
 for(const key of ['shardPrice','scrollPrice','basePrice'])if(s[key]!==null&&(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<0||s[key]>Number.MAX_SAFE_INTEGER))throw Error('invalidPrice');
 if(!record(input.priceModes)||!Object.hasOwn(input,'basePriceItem'))throw Error('invalidPrice');
 s.priceModes=Object.fromEntries(['shardPrice','scrollPrice','basePrice'].map(key=>[key,input.priceModes[key]]));
 for(const [key,mode]of Object.entries(s.priceModes))if(!['global','manual',...(key==='basePrice'?['owned']:[])].includes(mode))throw Error('invalidPrice');
 const baseId=game.encode(game.withRarity(s.itemId,s.tier),s.current);
 s.basePriceItem=input.basePriceItem;
 if(s.basePriceItem!==null&&!integer(s.basePriceItem,0,Number.MAX_SAFE_INTEGER))throw Error('invalidPrice');
 if(s.priceModes.basePrice!=='global'&&s.basePriceItem!==baseId){s.priceModes.basePrice='global';s.basePrice=null;s.basePriceItem=null;}
 if(s.target<s.current)throw Error('targetBelowCurrent');
 if(!allowUnsupportedTarget&&s.target>game.enhancementTargetLimit&&s.target!==s.current)throw Error('targetAboveLimit');
 return s;
}
export function enhancementSteps(input){
 const s=validateEnhancement(input),p={skills:{enhancing:game.levelXp(s.level)},house:{lectern:s.lectern},houseFurniture:s.lectern?{lectern:{cell:0,slot:0}}:{},masteries:{enhance:s.mastery},brews:{},lastTick:0};
 return Array.from({length:s.target===s.current?0:s.target},(_,k)=>{
  const id=game.encode(game.withRarity(s.itemId,s.tier),k),chance=game.enhanceChance(p,k),cost=game.enhanceCost(id),protectedStep=s.protect&&k>=s.protectFrom;
  return {from:k,to:k+1,chance,...cost,failTo:protectedStep?k-1:0,protected:protectedStep,xp:game.enhanceXp(p,{windows:[]},0,game.withRarity(s.itemId,s.tier),k)};
 });
}
// Solve the absorption equations using positive adjacent differences. This
// avoids subtracting large expectations or pivoting a nearly singular matrix.
function expectedCost(steps,start,cost){
 let prefix=0;const differences=[];
 for(const step of steps){
  const k=step.from,c=cost(step),rollback=step.protected?(differences[k-1]??0):prefix;
  const rhs=c+(1-step.chance)*rollback,d=rhs/step.chance;
  if(!Number.isFinite(d)||d<0||Math.abs(step.chance*d-rhs)>1e-12*Math.max(1,rhs))throw Error('unreliableCalculation');
  differences.push(d);prefix+=d;
  if(!Number.isFinite(prefix))throw Error('unreliableCalculation');
 }
 const result=differences.slice(start).reduce((a,b)=>a+b,0);
 if(!Number.isFinite(result))throw Error('unreliableCalculation');
 return result;
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
 const s=validateEnhancement(input),steps=enhancementSteps(s),totals={};
 for(const [key,cost]of Object.entries({gold:x=>x.gold,shards:x=>x.shards,scrolls:x=>x.protected?1-x.chance:0,attempts:()=>1}))totals[key]=expectedCost(steps,s.current,cost);
 totals.seconds=totals.attempts*game.enhanceTicks*game.tickMs/1000;
 const missingPrices=['shards','scrolls'].filter(key=>totals[key]>0&&s[key==='shards'?'shardPrice':'scrollPrice']===null);
 const pricedGold=missingPrices.length?null:totals.gold+totals.shards*(s.shardPrice??0)+totals.scrolls*(s.scrollPrice??0);
 const purchaseTotal=pricedGold!==null&&s.basePrice!==null?pricedGold+s.basePrice:null;
 const expectedFee=enhancementFee(purchaseTotal,s.profitRate,s.taxRate);
 if([totals.seconds,pricedGold,purchaseTotal,expectedFee].some(v=>v!==null&&!Number.isFinite(v)))throw Error('unreliableCalculation');
 return {steps,totals,missingPrices,pricedGold,purchaseTotal,expectedFee};
}
export function decodeEnhancementItem(id){
 if(!integer(id,0,Number.MAX_SAFE_INTEGER))throw Error('invalidSnapshot');
 const itemId=game.baseItemId(id),tier=game.itemTier(id),current=Math.floor(id/game.encode(0,1));
 if(!enhanceableItems.some(x=>x.id===itemId))return null;
 if(!integer(tier,0,4)||!integer(current,0,game.maxEnhancement)||!game.canEnhance(id)||game.encode(game.withRarity(itemId,tier),current)!==id)throw Error('invalidSnapshot');
 return {itemId,tier,current,id};
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

const enhancementPriceItems={shardPrice:208,scrollPrice:359};
export function resolveEnhancementPrices(input,prices={},priceFor=id=>itemPrice(id,prices),ignoreMaterials=false){
 const s=validateEnhancement(input),baseId=game.encode(game.withRarity(s.itemId,s.tier),s.current);
 for(const key of ['shardPrice','scrollPrice','basePrice']){
  if(ignoreMaterials&&key!=='basePrice')s[key]=0;
  else if(s.priceModes[key]==='global')s[key]=priceFor(key==='basePrice'?baseId:enhancementPriceItems[key],key);
  else if(s.priceModes[key]==='owned')s[key]=0;
 }
 return s;
}
