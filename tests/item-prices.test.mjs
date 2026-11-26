import {legacyPriceState} from './fixtures/legacy-price-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {priceDefaults,priceCategories,itemCategory,normalizePriceState,validItemId,itemFamily,setItemPrice,lockItemPrices,clearUnlockedPrices,validateMarketSnapshot,valueItems,valueRewards,valuationPrice,valueCombatRewards} from '../src/item-prices.js';
import {normalizeManual} from '../src/manual-settings.js';
import {normalizeGathering} from '../src/gathering-model.js';
import {enhancementDefaults,validateEnhancement,resolveEnhancementPrices,calculateEnhancement} from '../src/enhancement.js';
const at=Date.now()-1000;
test('pets retain quantities but never contribute prices or missing-price warnings',()=>{
 const pet=game.combatPetItem(game.monsters[0].id),item=game.monsters[0].drop;
 assert.equal(game.isPet(pet),true);assert.equal(game.canSell(pet),false);assert.equal(itemFamily(pet),null);
 for(const prices of [{},{[pet]:{price:999999}},{[pet]:{price:999999},[item]:{price:10}}]){
  assert.deepEqual(valuationPrice(pet,prices),{price:0,fallback:false});
  const result={coins:100,normalItems:{[item]:2},rareItems:{[pet]:0.03},foodItems:{},potionItems:{}};
  const valued=valueCombatRewards(result,prices);
  assert.equal(valued.rareValue,0);assert.deepEqual(valued.rareMissingPrices,[]);
  assert.equal(valued.rareItems[pet],0.03);
  assert.equal(valued.totalIncome,100+2*valuationPrice(item,prices).price);
  assert.equal(valued.profit,valued.totalIncome);
  assert.deepEqual(valued.missingPrices,prices[item]?[]:[item]);
  assert.deepEqual(valued.profitMissingPrices,valued.missingPrices);
 }
});
const side=value=>({value,capturedAt:at});
test('All defaults to seven-day averages and primary categories inherit it with independent floors disabled',()=>{
 const state=priceDefaults();assert.equal(state.preferences.categories.all,'avg7d');
 assert.ok(priceCategories.every(c=>state.preferences.categories[c.key]===null));
 assert.ok(Object.values(state.preferences.vendorFallback).every(value=>value===false));
 state.preferences.categories.resources='off';state.preferences.categories.equipment='ask';state.preferences.vendorFallback.equipment=true;
 assert.deepEqual(normalizePriceState(state).preferences,state.preferences);
});
test('legacy consistent category choices and bidVendor floors reset without changing prices or quotes',()=>{
 for(const version of [2,3,4]){
  const state=setItemPrice(legacyPriceState(version),1,77);
  for(const key of priceCategories.find(c=>c.key==='resources').families){state.preferences.categories[key]=version<4?'bidVendor':'bid';state.preferences.vendorFallback[key]=true;}
  for(const key of ['weapons','armour','jewellery'])state.preferences.categories[key]='off';
  state.quotes={1:{ask:side(80)}};const migrated=normalizePriceState(state);
  assert.equal(migrated.version,7);assert.deepEqual(migrated.preferences,priceDefaults().preferences);assert.equal(migrated.prices[1].price,77);
  assert.deepEqual(migrated.quotes,version===2?{}:state.quotes);assert.deepEqual(migrated.preferences.reviewCategories,[]);
 }
 const state=priceDefaults();delete state.preferences.vendorFallback.resources;assert.throws(()=>normalizePriceState(state),/invalidPriceStorage/);
});
test('complete item IDs are independent and unsupported rarity/enhancement fail',()=>{
 let s=priceDefaults();for(const [id,value]of [[110,10],[4110,30],[50110,20]])s=setItemPrice(s,id,value);
 assert.equal(s.prices[110].price,10);assert.equal(s.prices[4110].price,30);assert.equal(s.prices[50110].price,20);
 assert.equal(validItemId(5110),false);assert.equal(validItemId(10001),false);assert.throws(()=>setItemPrice(s,5110,1),/invalidPrice/);
 assert.deepEqual(normalizePriceState(s),s);
});
test('blank, zero and invalid manual prices are distinct; edits retain locks',()=>{
 let s=lockItemPrices(priceDefaults(),[1],true).state;s=setItemPrice(s,1,0);assert.equal(s.prices[1].locked,true);assert.equal(s.prices[1].price,0);
 s=setItemPrice(s,1,null);assert.equal(s.prices[1].price,null);
 for(const value of [-1,Infinity,NaN,'12',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>setItemPrice(s,1,value),/invalidPrice/);
});
test('bulk locks are idempotent and never modify price provenance or timestamps',()=>{
 let s=setItemPrice(priceDefaults(),1,7,at);const before=s.prices[1];let result=lockItemPrices(s,[1,1,1001],true);
 assert.equal(result.changed,2);assert.deepEqual(result.state.prices[1],{...before,locked:true});assert.equal(result.state.prices[1001].price,null);
 assert.equal(lockItemPrices(result.state,[1,1001],true).changed,0);
 result=lockItemPrices(result.state,[1,1001],false);assert.equal(result.changed,2);assert.deepEqual(result.state.prices[1],before);
});
test('valuation uses exact quantities and IDs, propagates missing prices and rejects overflow',()=>{
 const prices={1:{price:10},1001:{price:0}};
 assert.deepEqual(valueItems({1:2,1001:3},prices),{value:20,partial:20,missing:[]});
 assert.deepEqual(valueItems({1:2,1001:3,2:4},prices),{value:20+4*game.vendorPrice(2),partial:20+4*game.vendorPrice(2),missing:[2]});
 const result={coins:7,normalItems:{1:2},rareItems:{1001:3}};assert.equal(valueRewards(result,prices).totalIncome,27);assert.equal(valueRewards({...result,rareItems:{2:3}},prices).totalIncome,7+20+3*game.vendorPrice(2));
 assert.throws(()=>valueItems({1:2},{1:{price:Number.MAX_SAFE_INTEGER}}),/priceOverflow/);
});
test('valuation modes default independently of old toggles',()=>{
 assert.equal(normalizeManual({vendorValues:true}).valuationMode,'custom');assert.equal(normalizeManual({vendorValues:false}).valuationMode,'custom');assert.equal(normalizeManual({valuationMode:'custom'}).vendorValues,true);
 assert.equal(normalizeGathering({valuationMode:'custom'}).valuationMode,'custom');assert.equal(normalizeGathering({vendorValues:true}).valuationMode,'custom');
});
test('enhancement resolves explicit price modes and binds owned bases',()=>{
 const prices={208:{price:2},359:{price:3},110:{price:4},111:{price:9}};let s={...enhancementDefaults(),itemId:110,tier:0};let resolved=resolveEnhancementPrices(s,prices);
 assert.deepEqual([resolved.shardPrice,resolved.scrollPrice,resolved.basePrice],[2,3,4]);assert.notEqual(calculateEnhancement(resolved).expectedFee,null);
 const missing={...s};delete missing.priceModes;assert.throws(()=>validateEnhancement(missing),/invalidPrice/);const unbound={...s};delete unbound.basePriceItem;assert.throws(()=>validateEnhancement(unbound),/invalidPrice/);
 s=validateEnhancement({...s,shardPrice:7,basePrice:8,priceModes:{shardPrice:'manual',scrollPrice:'global',basePrice:'manual'},basePriceItem:110});assert.equal(resolveEnhancementPrices(s,prices).basePrice,8);
 s=validateEnhancement({...s,itemId:111});assert.equal(s.priceModes.basePrice,'global');assert.equal(resolveEnhancementPrices(s,prices).basePrice,9);assert.equal(resolveEnhancementPrices(s,prices).shardPrice,7);
 s.priceModes.basePrice='owned';s.basePriceItem=111;assert.equal(resolveEnhancementPrices(s,prices).basePrice,0);s=validateEnhancement({...s,current:1});assert.equal(s.priceModes.basePrice,'global');assert.equal(resolveEnhancementPrices(s,prices).basePrice,null);
});

test('clearing removes all unlocked prices including zero and preserves locked records and quote settings',()=>{
 let state=setItemPrice(setItemPrice(setItemPrice(priceDefaults(),1,0),2,17),3,88);state=lockItemPrices(state,[3,1001],true).state;state.quotes={1:{bid:side(36)}};
 const before=structuredClone(state),r=clearUnlockedPrices(state);assert.equal(r.cleared,2);assert.deepEqual(Object.keys(r.state.prices),['3','1001']);assert.deepEqual(r.state.prices[3],before.prices[3]);assert.deepEqual(r.state.prices[1001],before.prices[1001]);assert.deepEqual(r.state.quotes,before.quotes);assert.deepEqual(r.state.preferences,before.preferences);assert.deepEqual(state,before);assert.equal(clearUnlockedPrices(r.state).cleared,0);
});

test('fallback distinguishes unset, zero and imported vendor prices; combat costs allow negative profit',()=>{
 assert.equal(valuationPrice(1,{}).fallback,true);
 assert.deepEqual(valuationPrice(1,{1:{price:0}}),{price:0,fallback:false});
 assert.equal(valuationPrice(1,{1:{price:game.vendorPrice(1),source:'vendor'}}).fallback,false);
 const r=valueCombatRewards({coins:10,normalItems:{},rareItems:{},foodItems:{64:3},potionItems:{1:24}},{64:{price:2},1:{price:1}});
 assert.equal(r.consumableCost,30);assert.equal(r.foodCost,6);assert.equal(r.potionCost,24);assert.equal(r.profit,-20);
});

test('fallback warnings follow positive quantities and aggregate income and profit separately',()=>{
 const raw={coins:10,normalItems:{1:2,2:0},rareItems:{3:1},foodItems:{64:2},potionItems:{4:1}};
 const prices={1:{price:0},3:{price:game.vendorPrice(3),source:'vendor'},4:{price:5}};
 const valued=valueCombatRewards(raw,prices);
 assert.deepEqual(valued.normalMissingPrices,[]);assert.deepEqual(valued.rareMissingPrices,[]);
 assert.deepEqual(valued.missingPrices,[]);assert.deepEqual(valued.foodMissingPrices,[64]);
 assert.deepEqual(valued.profitMissingPrices,[64]);assert.deepEqual(valued.potionMissingPrices,[]);
 assert.equal(valued.foodCost,2*game.vendorPrice(64));
 const missing=valueCombatRewards(raw,{});
 assert.deepEqual(missing.normalMissingPrices,[1]);assert.deepEqual(missing.rareMissingPrices,[3]);
 assert.deepEqual(missing.missingPrices,[1,3]);assert.deepEqual(missing.profitMissingPrices,[1,3,64,4]);
});
