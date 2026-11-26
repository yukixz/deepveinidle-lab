import {legacyPriceState} from './fixtures/legacy-price-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {priceDefaults,setItemPrice} from '../src/item-prices.js';

let sequence=0;
async function withStore(storage,run){
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 try{await run(await import(`../src/item-price-store.js?test=${++sequence}`));}
 finally{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage;}
}
test('price store round trip migrates legacy preferences and restores zero prices and locks',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const state=setItemPrice(priceDefaults(),1,0);state.prices[1].locked=true;state.preferences.categories.resources='bid';
 await withStore(storage,store=>store.updatePrices(state));
 await withStore(storage,store=>assert.deepEqual(store.priceState(),{...state,version:8,preferences:{autoImport:true}}));
});
test('invalid saved price data remains untouched until an explicit update',async()=>{
 let writes=0;
 await withStore({getItem:()=>'{"version":9}',setItem:()=>writes++},store=>{
  assert.deepEqual(store.priceState(),{version:8,prices:{},quotes:{},preferences:{autoImport:true}});assert.equal(store.priceSaveError(),'invalidPriceStorage');assert.equal(writes,0);
 });
});
test('failed save exposes an error while notifying consumers of the usable memory state',async()=>{
 await withStore({getItem:()=>null,setItem:()=>{throw Error('quota');}},store=>{
  let notifications=0;const unsubscribe=store.subscribePrices(()=>notifications++),state=setItemPrice(priceDefaults(),1,36);
  store.updatePrices(state);assert.equal(store.priceState(),state);assert.equal(store.priceSaveError(),'priceSaveFailed');assert.equal(notifications,1);
  unsubscribe();store.updatePrices(state);assert.equal(notifications,1);
 });
});
test('published v2 migrates prices, locks and preferences, discarding game quotes and their time baseline',async()=>{
 const state=setItemPrice(legacyPriceState(2),1,0);state.prices[1].locked=true;
 state.prices[2]={price:99,locked:false,source:'bid',updatedAt:Date.now(),quoteCapturedAt:Date.now()};state.quotes={2:{bid:{value:99,capturedAt:Date.now()}}};state.preferences.categories.ore='ask';
 const saved=JSON.stringify(state);let writes=0,latest;
 await withStore({getItem:()=>saved,setItem:(key,value)=>{writes++;latest=JSON.parse(value);}},store=>{
  const current=store.priceState();assert.equal(writes,0);assert.equal(store.priceSaveError(),null);assert.equal(current.version,8);assert.deepEqual(current.quotes,{});assert.equal(current.prices[1].price,0);assert.equal(current.prices[1].locked,true);assert.equal(current.prices[2].price,99);assert.equal(current.prices[2].source,'bid');assert.equal(current.prices[2].quoteCapturedAt,null);assert.deepEqual(current.preferences,{autoImport:true});
  store.updatePrices(current);assert.equal(writes,1);assert.equal(latest.version,8);
 });
});

test('market refresh shares requests and applies quotes to the latest locked price state',async()=>{
 const oldFetch=globalThis.fetch;let respond,requests=0;
 globalThis.fetch=()=>{requests++;return new Promise(resolve=>respond=resolve);};
 try{await withStore({getItem:()=>null,setItem:()=>{}},async store=>{
  const first=store.refreshMarketPrices(),second=store.refreshMarketPrices();assert.equal(requests,1);
  const current=setItemPrice(store.priceState(),1,77);current.prices[1].locked=true;store.updatePrices(current);
  respond({ok:true,json:async()=>({game:'Deep Vein Idle',generatedAt:new Date().toISOString(),refreshSeconds:60,items:{1:{lowestSell:3,highestBuy:2}}})});
  await Promise.all([first,second]);assert.equal(store.priceState().prices[1].price,77);assert.equal(store.priceState().quotes[1].ask.value,3);
 });}finally{globalThis.fetch=oldFetch;}
});
test('market refresh fails atomically and allows the next request to retry',async()=>{
 const oldFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return requests===1?{ok:false}:{ok:true,json:async()=>({game:'Deep Vein Idle',generatedAt:new Date().toISOString(),refreshSeconds:60,items:{1:{lowestSell:3,highestBuy:2}}})};};
 try{await withStore({getItem:()=>null,setItem:()=>{}},async store=>{
  const original=store.priceState();await assert.rejects(store.refreshMarketPrices(),/marketHttpFailed/);assert.equal(store.priceState(),original);
  await store.refreshMarketPrices();assert.equal(requests,2);assert.equal(store.priceState().quotes[1].ask.value,3);
 });}finally{globalThis.fetch=oldFetch;}
});

test('market refresh rejects a full snapshot older than current quotes without writing',async()=>{
 const oldFetch=globalThis.fetch,now=Date.now();
 globalThis.fetch=async()=>({ok:true,json:async()=>({game:'Deep Vein Idle',generatedAt:new Date(now-1000).toISOString(),refreshSeconds:60,items:{1:{lowestSell:3,highestBuy:2}}})});
 try{await withStore({getItem:()=>null,setItem:()=>{}},async store=>{
  const current=priceDefaults();current.quotes={1:{ask:{value:9,capturedAt:now},bid:{value:8,capturedAt:now}}};store.updatePrices(current);
  await assert.rejects(store.refreshMarketPrices(),/marketStale/);assert.equal(store.priceState(),current);
 });}finally{globalThis.fetch=oldFetch;}
});

test('automatic import respects the five-minute boundary across reloads while refreshing quotes and preserving locks',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const oldFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return {ok:true,json:async()=>({game:'Deep Vein Idle',generatedAt:new Date().toISOString(),refreshSeconds:60,items:{1:{lowestSell:90,highestBuy:20,avg7d:30,avg30d:25},2:{lowestSell:80,highestBuy:10,avg7d:40,avg30d:35}}})};};
 try{
  const at=Date.now();
  await withStore(storage,async store=>{
   const state=setItemPrice(priceDefaults(),1,77);state.prices[1].locked=true;store.updatePrices(state);
   const first=store.importAutomaticPrices(at),duplicate=store.importAutomaticPrices(at);
   assert.equal(await duplicate,null);await first;
   assert.equal(requests,1);assert.equal(store.priceState().prices[1].price,77);assert.equal(store.priceState().prices[2],undefined);assert.equal(store.priceState().quotes[2].avg7d.value,40);
  });
  await withStore(storage,async store=>{
   assert.equal(await store.importAutomaticPrices(at),null);assert.equal(requests,1);
   assert.equal(await store.importAutomaticPrices(at+299999),null);assert.equal(requests,1);
   await store.importAutomaticPrices(at+300000);assert.equal(requests,2);
  });
 }finally{globalThis.fetch=oldFetch;}
});

test('automatic failure is not retried within five minutes, while manual import can retry',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const oldFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return {ok:false};};
 try{
  await withStore(storage,async store=>{const before=store.priceState();await assert.rejects(store.importAutomaticPrices(),/marketHttpFailed/);assert.equal(store.priceState(),before);});
  await withStore(storage,async store=>{assert.equal(await store.importAutomaticPrices(),null);assert.equal(requests,1);await assert.rejects(store.refreshMarketPrices(),/marketHttpFailed/);assert.equal(requests,2);});
  await withStore(storage,async store=>{const at=Number(values.get(store.priceAutoImportTimeKey));await assert.rejects(store.importAutomaticPrices(at+300000),/marketHttpFailed/);assert.equal(requests,3);});
 }finally{globalThis.fetch=oldFetch;}
});

test('automatic import skips when disabled and protects unreadable or invalid storage',async()=>{
 const oldFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('unexpected');};
 try{
  const state=priceDefaults();state.preferences.autoImport=false;
  const values=new Map([['dvi-item-prices-v1',JSON.stringify(state)]]);
  await withStore({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},async store=>assert.equal(await store.importAutomaticPrices(),null));
  let writes=0;
  await withStore({getItem:()=>'{"version":99}',setItem:()=>writes++},async store=>assert.rejects(store.importAutomaticPrices(),/invalidPriceStorage/));
  await withStore({getItem:()=>{throw Error('denied');},setItem:()=>writes++},async store=>assert.rejects(store.importAutomaticPrices(),/priceReadFailed/));
  await withStore({getItem:()=>null,setItem:()=>{throw Error('quota');}},async store=>assert.rejects(store.importAutomaticPrices(),/priceAutoImportStorageFailed/));
  assert.equal(writes,0);assert.equal(requests,0);
 }finally{globalThis.fetch=oldFetch;}
});

test('automatic import reports price saving failure after receiving valid quotes',async()=>{
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({game:'Deep Vein Idle',generatedAt:new Date().toISOString(),refreshSeconds:60,items:{1:{lowestSell:90,highestBuy:20,avg7d:30,avg30d:25}}})});
 try{await withStore({getItem:()=>null,setItem:key=>{if(key==='dvi-item-prices-v1')throw Error('quota');}},async store=>{
  await assert.rejects(store.importAutomaticPrices(),/priceSaveFailed/);assert.equal(store.priceState().prices[1],undefined);assert.equal(store.priceState().quotes[1].avg7d.value,30);
 });}finally{globalThis.fetch=oldFetch;}
});

test('disabled automatic import leaves attempt time unset and allows a later visit after enabling',async()=>{
 const state=priceDefaults();state.preferences.autoImport=false;const values=new Map([['dvi-item-prices-v1',JSON.stringify(state)]]);
 const oldFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;return {ok:false};};
 try{await withStore({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},async store=>{
  assert.equal(await store.importAutomaticPrices(),null);assert.equal(values.has(store.priceAutoImportTimeKey),false);assert.equal(requests,0);
  store.updatePrices({...store.priceState(),preferences:{...store.priceState().preferences,autoImport:true}});
  await assert.rejects(store.importAutomaticPrices(),/marketHttpFailed/);assert.equal(requests,1);
 });}finally{globalThis.fetch=oldFetch;}
});
