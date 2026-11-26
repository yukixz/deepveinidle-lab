import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {priceDefaults,setItemPrice,valuationPrice,valueItems} from '../src/item-prices.js';
import {createPriceSnapshot} from '../src/price-protocol.js';
import {dropValue} from '../src/simulation.js';

test('1203 abyssal eye discount reaches vendor estimates and explicit prices keep priority',()=>{
 assert.equal(game.item(207).name,'Abyssal eye');assert.equal(game.item(207).value,900000);
 assert.equal(game.vendorPrice(207),288000);
 for(const id of [1207,70207])assert.throws(()=>game.vendorPrice(id),/unknown item id/);
 assert.equal(game.vendorPrice(206),140000);assert.equal(game.vendorPrice(208),600);
 assert.equal(dropValue({207:2,206:1}),716000);
 const state=priceDefaults(),prices=createPriceSnapshot(state,[207]);
 assert.equal(prices.getItem(207).vendorPrice,288000);
 assert.deepEqual(valuationPrice(207,prices),{price:288000,fallback:true});
 assert.equal(valueItems({207:2},prices).value,576000);
 const manual=createPriceSnapshot(setItemPrice(state,207,350000));assert.deepEqual(valuationPrice(207,manual),{price:350000,fallback:false});

});

test('1203 cached level queries preserve exact XP boundaries and interleaved callers',()=>{
 const expected=xp=>{let lo=1,hi=game.maxLevel;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(game.levelXp(mid)<=xp)lo=mid;else hi=mid-1;}return lo;};
 for(const rank of [2,25,50,99,100,1000,game.maxLevel])for(const xp of [game.levelXp(rank)-1,game.levelXp(rank),game.levelXp(rank)+1]){
  for(const other of [0,game.levelXp(42),xp,game.levelXp(99),xp])assert.equal(game.level(other),expected(other));
 }
});
