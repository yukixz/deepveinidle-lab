import test from 'node:test';
import assert from 'node:assert/strict';
import {createPriceSnapshot} from '../src/price-protocol.js';
import {lockItemPrices,setItemPrice,priceDefaults,valueCombatRewards} from '../src/item-prices.js';
import {pageIncomeUnitPrice,pagePriceSettings,pageValuation,selectedUnitPrice} from '../src/page-prices.js';
import {vendorPrice} from '../src/upstream.js';

test('page settings select quotes by use and distinguish missing prices from deliberate zeros', t=>{
 const saved=new Map([
  ['dvi-page-prices-craft','{"products":"sellPrice","materials":"buyPrice","missing":"none"}'],
  ['dvi-page-prices-gather','{"products":"unknown","missing":"vendorPrice"}']
 ]);
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>saved.get(key)??null}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;});
 const at=Date.now(),state=setItemPrice(priceDefaults(),1,999,at);
 state.quotes[1]={ask:{value:100,capturedAt:at},bid:{value:40,capturedAt:at},avg7d:{value:70,capturedAt:at}};
 const snapshot=createPriceSnapshot(state);
 assert.equal(pagePriceSettings('combat').values.missing,'warn');
 assert.equal(pagePriceSettings('gather').values.products,'avg7d');
 assert.equal(pageIncomeUnitPrice('combat',snapshot,207),288000);
 assert.equal(pageIncomeUnitPrice('combat',snapshot,2),null);
 assert.deepEqual(pageValuation('combat',snapshot)(2,'drops'),{price:0,fallback:true});
 assert.deepEqual(pageValuation('gather',snapshot)(2,'products'),{price:vendorPrice(2),fallback:false});
 assert.deepEqual(pageValuation('craft',snapshot)(1,'products'),{price:100,fallback:false});
 assert.deepEqual(pageValuation('craft',snapshot)(1,'materials'),{price:40,fallback:false});
 assert.deepEqual(pageValuation('craft',snapshot)(2,'materials'),{price:0,fallback:false});
 const locked=createPriceSnapshot(lockItemPrices(setItemPrice(state,1,0,at),[1],true).state);
 assert.equal(selectedUnitPrice(locked,1,'buyPrice'),0);
 assert.equal(selectedUnitPrice(locked,1,'none'),0);
 assert.equal(selectedUnitPrice(snapshot,1,'none'),0);
 assert.equal(selectedUnitPrice(snapshot,1,'avg7d'),70);
 const raw={coins:23,normalItems:{1:2},rareItems:{207:1},foodItems:{2:1},potionItems:{}};
 const price=pageValuation('combat',snapshot);
 const valued=valueCombatRewards(raw,snapshot,{rewards:id=>price(id,'drops'),consumables:id=>price(id,'consumables')});
 assert.equal(valued.totalIncome,288163);
 assert.deepEqual(valued.profitMissingPrices,[2]);
 assert.equal(valued.profit,valued.totalIncome);
});
