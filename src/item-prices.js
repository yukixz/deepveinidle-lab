import * as game from './upstream.js';

export const priceStorageKey='dvi-item-prices-v1';
export const marketFamilies=game.marketFamilies;
// The market offers a dedicated gems shortcut as well as gems under resources.
// Pricing uses the primary groups without that duplicate shortcut.
export const priceCategories=game.marketCategories.filter(category=>category.key!=='gems');
export function itemCategory(id){const family=itemFamily(id);return priceCategories.find(category=>category.families.includes(family))?.key??null;}
// This pricing subset does not change the market categories used by item filters.
const monsterValuablesCategory='monsterValuables';
const monsterValuables=new Set(game.monsters.map(monster=>game.baseItemId(monster.bonus.itemId)).filter(id=>itemCategory(id)==='valuables'));
const legacyCategoryKeys=[...priceCategories.map(category=>category.key),monsterValuablesCategory];
export const isMonsterValuable=id=>monsterValuables.has(game.baseItemId(id));
const marketPriceModes=['avg7d','avg30d','ask','bid'];
const priceModes=[...marketPriceModes,'vendor','off'];
const priceSources=['manual',...marketPriceModes,'vendor'];
const legacyPriceModes=['ask','bid','vendor','off'];
export function validatePricePreferences(preferences){
 const keys=['all',...legacyCategoryKeys];
 if(!record(preferences)||typeof preferences.autoImport!=='boolean'||!record(preferences.categories)||!record(preferences.vendorFallback)||!Array.isArray(preferences.reviewCategories))throw Error('invalidPricePreferences');
 if(Object.keys(preferences.categories).some(key=>!keys.includes(key))||Object.keys(preferences.vendorFallback).some(key=>!keys.includes(key)))throw Error('invalidPricePreferences');
 for(const key of keys){
  const mode=preferences.categories[key],inherits=key!=='all'&&mode===null;
  if(!inherits&&!priceModes.includes(mode)||typeof preferences.vendorFallback[key]!=='boolean')throw Error('invalidPricePreferences');
 }
 const review=preferences.reviewCategories;
 if(new Set(review).size!==review.length||review.some(key=>!legacyCategoryKeys.includes(key)||preferences.categories[key]!==null))throw Error('invalidPricePreferences');
 return structuredClone(preferences);
}
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const time=v=>Number.isSafeInteger(v)&&v>0&&v<=Date.now()+60000;
export const validPrice=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;
export function validItemId(id){
 if(!Number.isSafeInteger(id)||id<=0)return false;
 try{
  const base=game.baseItemId(id),tier=game.itemTier(id),plus=game.itemEnhancement(id),relics=game.itemRelics(id);
  const encoded=game.encodeRelics(game.encode(game.withRarity(base,tier),plus),relics);
  return tier<=4&&plus<=game.maxEnhancement&&encoded===id&&game.item(id).id===id&&(!plus||game.canEnhance(id));
 }catch{return false;}
}
export function itemFamily(id){try{return game.marketFamily(game.baseItemId(id));}catch{return null;}}
export function priceDefaults(){return {version:7,prices:{},quotes:{},preferences:{autoImport:true,categories:{all:'avg7d',...Object.fromEntries(legacyCategoryKeys.map(key=>[key,key===monsterValuablesCategory?'vendor':null]))},vendorFallback:Object.fromEntries(['all',...legacyCategoryKeys].map(key=>[key,false])),reviewCategories:[]}};}
export function normalizePriceState(raw){
 if(!record(raw)||![2,3,4,5,6,7,8].includes(raw.version)||!record(raw.prices)||!record(raw.quotes)||!record(raw.preferences)||raw.version!==8&&!record(raw.preferences.categories))throw Error('invalidPriceStorage');
 const next=priceDefaults();
 for(const [key,p] of Object.entries(raw.prices)){
  if(String(Number(key))!==key||!validItemId(Number(key))||!record(p)||p.price!==null&&!validPrice(p.price)||typeof p.locked!=='boolean'||!priceSources.includes(p.source)||!time(p.updatedAt)||p.quoteCapturedAt!==null&&!time(p.quoteCapturedAt))throw Error('invalidPriceStorage');
  next.prices[key]={price:p.price,locked:p.locked,source:p.source,updatedAt:p.updatedAt,quoteCapturedAt:raw.version===2?null:p.quoteCapturedAt};
 }
 if(raw.version>=3){
  const parsed=validateMarketSnapshot({version:1,quotes:raw.quotes,invalid:0});
  if(parsed.invalid)throw Error('invalidPriceStorage');next.quotes=parsed.quotes;
 }
 if(raw.version===8){
  if(typeof raw.preferences.autoImport!=='boolean')throw Error('invalidPriceStorage');
  return {...next,version:8,preferences:{autoImport:raw.preferences.autoImport}};
 }
 if(raw.version>=5){
  try{
   const preferences=raw.version<7?{...raw.preferences,categories:{[monsterValuablesCategory]:'vendor',...raw.preferences.categories},vendorFallback:{[monsterValuablesCategory]:false,...raw.preferences.vendorFallback}}:raw.preferences;
   const validated=validatePricePreferences(preferences);
   if(raw.version>=6)next.preferences=validated;
   else next.preferences.autoImport=validated.autoImport;
  }catch{throw Error('invalidPriceStorage');}
  return next;
 }
 if(raw.version===4&&(typeof raw.preferences.autoImport!=='boolean'||!record(raw.preferences.vendorFallback)))throw Error('invalidPriceStorage');
 if(raw.version===4)next.preferences.autoImport=raw.preferences.autoImport;
 const legacy=raw.version<4;
 for(const family of marketFamilies){
  const mode=raw.preferences.categories[family.key];
  if(!legacyPriceModes.includes(mode)&&!(legacy&&mode==='bidVendor')||!legacy&&typeof raw.preferences.vendorFallback[family.key]!=='boolean')throw Error('invalidPriceStorage');
 }
 return next;
}
// Preference changes revalue only affected categories, from the current cache.
// Off/review categories keep their existing values, including manually unlocked ones.
export function validateMarketSnapshot(raw){
 if(!record(raw)||raw.version!==1||!record(raw.quotes)||!Number.isSafeInteger(raw.invalid)||raw.invalid<0)throw Error('invalidMarketData');
 const quotes={};let invalid=raw.invalid;
 for(const [key,q]of Object.entries(raw.quotes)){
  const id=Number(key);if(String(id)!==key||!validItemId(id)||!itemFamily(id)||!record(q)){invalid++;continue;}
  const entry={};
  for(const side of marketPriceModes){
   if(!Object.hasOwn(q,side))continue;const v=q[side];
   if(!record(v)||!time(v.capturedAt)||!(v.invalid===true||v.value===null||validPrice(v.value)&&v.value>0)){invalid++;continue;}
   entry[side]=v.invalid===true?{invalid:true,capturedAt:v.capturedAt}:{value:v.value,capturedAt:v.capturedAt};
   if(v.quantityInvalid===true)entry[side].quantityInvalid=true;
   else if(Object.hasOwn(v,'quantity')){
    if(Number.isSafeInteger(v.quantity)&&v.quantity>=0)entry[side].quantity=v.quantity;
    else {entry[side].quantityInvalid=true;invalid++;}
   }
  }
  if(Object.keys(entry).length)quotes[key]=entry;else invalid++;
 }
 return {quotes,invalid};
}
export function setItemPrice(state,id,price,now=Date.now()){
 if(!validItemId(id)||price!==null&&!validPrice(price))throw Error('invalidPrice');
 return {...state,prices:{...state.prices,[id]:{price,locked:state.prices[id]?.locked??false,source:'manual',updatedAt:now,quoteCapturedAt:null}}};
}
export function lockItemPrices(state,ids,locked,now=Date.now()){
 if(typeof locked!=='boolean'||ids.some(id=>!validItemId(id)))throw Error('invalidPrice');
 const prices={...state.prices};let changed=0;
 for(const id of new Set(ids)){
  const old=prices[id];if((old?.locked??false)===locked)continue;
  prices[id]=old?{...old,locked}:{price:null,locked,source:'manual',updatedAt:now,quoteCapturedAt:null};changed++;
 }
 return {state:{...state,prices},changed};
}
export function clearUnlockedPrices(state){
 const prices=Object.fromEntries(Object.entries(state.prices).filter(([,p])=>p.locked));
 const cleared=Object.values(state.prices).filter(p=>!p.locked&&p.price!==null).length;
 return {state:{...state,prices},cleared};
}
export function itemPrice(id,prices){return prices.getItem?prices.getItem(Number(id)).price:prices[id]?.price??null;}
export function valuationPrice(id,prices={}){
 id=Number(id);if(game.isPet(id))return {price:0,fallback:false};
 const price=itemPrice(id,prices);
 const vendor=prices.getItem?prices.getItem(id).vendorPrice:game.canSell(id)?game.vendorPrice(id):null;
 return {price:price??vendor??0,fallback:price===null};
}
export function valueItems(items,prices={},priceFor=id=>valuationPrice(id,prices)){
 let partial=0;const missing=[];
 for(const [key,qty]of Object.entries(items)){
  if(!Number.isFinite(qty)||qty<0)throw Error('invalidDropQuantity');if(!qty)continue;
  const id=Number(key),{price,fallback}=priceFor(id);
  if(fallback)missing.push(id);partial+=qty*price;
 }
 if(!Number.isFinite(partial)||partial>Number.MAX_SAFE_INTEGER)throw Error('priceOverflow');
 return {value:partial,partial,missing};
}
export function valueRewards(result,prices={},priceFor){
 if(!result)return result;
 const normal=valueItems(result.normalItems,prices,priceFor),rare=valueItems(result.rareItems,prices,priceFor);
 const totalIncome=normal.value===null||rare.value===null?null:result.coins+normal.value+rare.value;
 if(totalIncome!==null&&(!Number.isFinite(totalIncome)||totalIncome>Number.MAX_SAFE_INTEGER))throw Error('priceOverflow');
 return {...result,normalValue:normal.value,rareValue:rare.value,totalIncome,normalMissingPrices:normal.missing,rareMissingPrices:rare.missing,missingPrices:[...normal.missing,...rare.missing]};
}

export function valueCombatRewards(result,prices={},valuation){
 const valued=valueRewards(result,prices,valuation?.rewards);if(!valued)return valued;
 const food=valueItems(result.foodItems??{},prices,valuation?.consumables);
 const potions=valueItems(result.potionItems??{},prices,valuation?.consumables);
 const consumableCost=food.value+potions.value;
 if(!Number.isFinite(consumableCost)||consumableCost>Number.MAX_SAFE_INTEGER)throw Error('priceOverflow');
 const profit=valued.totalIncome-consumableCost;
 if(!Number.isFinite(profit)||Math.abs(profit)>Number.MAX_SAFE_INTEGER)throw Error('priceOverflow');
 return {...valued,consumableCost,consumableMissingPrices:[...food.missing,...potions.missing],foodCost:food.value,potionCost:potions.value,foodMissingPrices:food.missing,potionMissingPrices:potions.missing,profitMissingPrices:[...valued.missingPrices,...food.missing,...potions.missing],profit};
}
