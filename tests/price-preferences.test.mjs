import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {priceDefaults,priceCategories,isMonsterValuable,itemCategory,normalizePriceState,setItemPrice,lockItemPrices,validatePricePreferences} from '../src/item-prices.js';
import {legacyPriceState} from './fixtures/legacy-price-state.mjs';
const at=Date.now()-1000;
const quote=(ask,bid)=>({avg7d:{value:ask,capturedAt:at},avg30d:{value:bid,capturedAt:at},ask:{value:ask,capturedAt:at},bid:{value:bid,capturedAt:at}});

test('primary pricing categories come from the game market with gems only under resources',()=>{
 assert.deepEqual(priceCategories,game.marketCategories.filter(category=>category.key!=='gems'));
 assert.deepEqual(priceCategories.map(c=>c.key),['resources','consumables','equipment','tools','valuables']);
 assert.equal(itemCategory(293),'resources');assert.equal(itemCategory(328),'tools');
 for(const family of game.marketFamilies)assert.equal(priceCategories.filter(category=>category.families.includes(family.key)).length,1,family.key);
 for(const id of [1,1001,110,10110])assert.equal(itemCategory(id),itemCategory(game.baseItemId(id)));
 assert.throws(()=>validatePricePreferences({...priceDefaults().preferences,categories:{...priceDefaults().preferences.categories,all:null}}),/invalidPricePreferences/);
 assert.throws(()=>validatePricePreferences({...priceDefaults().preferences,categories:{...priceDefaults().preferences.categories,ore:'ask'}}),/invalidPricePreferences/);
});

test('legacy conflicting families reset to seven-day averages without changing values or cache',()=>{
 for(const version of [2,3,4,5]){
  const old=setItemPrice(version===5?{...priceDefaults(),version:5}:legacyPriceState(version),1,77);
  old.preferences.autoImport=false;
  if(version===5){old.preferences.categories.all='bid';old.preferences.reviewCategories=['resources'];}
  else old.preferences.categories.ore='bid';
  old.quotes={1:quote(90,40)};
  const next=normalizePriceState(old);
  assert.deepEqual(next.preferences,{...priceDefaults().preferences,autoImport:version<4?true:false});
  assert.equal(next.prices[1].price,77);assert.deepEqual(next.quotes,version===2?{}:old.quotes);
 }
});

test('monster valuables match only dedicated monster drops classified as valuables',()=>{
 const ids=[...new Set(game.monsters.map(m=>m.bonus.itemId))];
 assert.equal(ids.length,13);
 for(const id of ids){assert.equal(itemCategory(id),'valuables');assert.equal(isMonsterValuable(id),true);}
 const other=game.items.find(i=>itemCategory(i.id)==='valuables'&&!ids.includes(game.baseItemId(i.id))).id;
 assert.equal(isMonsterValuable(other),false);
});

test('v6 migration adds only the new policy, preserving choices, prices, quotes and locks; v7 restores exactly',()=>{
 let old=lockItemPrices(setItemPrice(setItemPrice(priceDefaults(),201,123),202,0),[202],true).state;
 old.version=6;delete old.preferences.categories.monsterValuables;delete old.preferences.vendorFallback.monsterValuables;
 old.preferences.categories.all='bid';old.preferences.categories.valuables='off';old.preferences.vendorFallback.all=true;old.preferences.autoImport=false;old.quotes={201:quote(900,800)};
 const original=structuredClone(old),next=normalizePriceState(old);
 assert.equal(next.version,7);assert.deepEqual(old,original);assert.deepEqual(next.prices,old.prices);assert.deepEqual(next.quotes,old.quotes);
 const prefs=structuredClone(next.preferences);delete prefs.categories.monsterValuables;delete prefs.vendorFallback.monsterValuables;assert.deepEqual(prefs,old.preferences);
 assert.equal(next.preferences.categories.monsterValuables,'vendor');assert.equal(next.preferences.vendorFallback.monsterValuables,false);
 assert.deepEqual(normalizePriceState(next),next);
 const broken=structuredClone(next);
 delete broken.preferences.categories.monsterValuables;
 assert.throws(()=>normalizePriceState(broken),/invalidPriceStorage/);
});
