import test from 'node:test';
import assert from 'node:assert/strict';

test('service commands, typed events, concurrent refresh and snapshot isolation preserve price ownership',async t=>{
 const storage=new Map();t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>payload}));
 const original=globalThis.localStorage;
 globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 let at=Date.now()-1000,requests=0,release;
 let payload={game:'Deep Vein Idle',generatedAt:new Date(at).toISOString(),refreshSeconds:300,items:{1:{lowestSell:9,sellQty:100,highestBuy:4,buyQty:200}}};
 try{
  const service=await import('../src/price-service.js');
  const events=[],unsubscribe=service.subscribe(change=>events.push(change));
  const empty=service.getSnapshot();service.setPrice(1,0);
  assert.equal(service.getItem(1).price,0);assert.equal(service.getItem(1).configured.locked,true);assert.equal(empty.getItem(1).price,null);
  assert.equal(events.at(-1).prices,true);assert.equal(events.at(-1).market,false);
  service.setAutoUpdate(false);
  assert.equal(events.at(-1).preferences,true);assert.equal(events.at(-1).prices,false);
  await service.importPrices();assert.equal(service.getItem(1).price,0);assert.equal(service.getItem(1).sellQuantity,100);
  assert.equal(events.at(-1).market,true);assert.equal(events.at(-1).prices,false);assert.equal(service.getItem(207).price,null);
  const before=service.getSnapshot([1]);service.setLocked([1],false);
  t.mock.method(globalThis,'fetch',async()=>{requests++;await new Promise(resolve=>release=resolve);return {ok:true,json:async()=>payload};});
  const importing=service.importPrices(),refreshing=service.importPrices();assert.equal(requests,1);
  service.setPrice(1,77);release();await Promise.all([importing,refreshing]);
  assert.equal(service.getItem(1).price,77);assert.equal(before.items[1].price,0);
  service.setLocked([1],false);t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>payload}));
  await service.importPrices();assert.equal(service.getItem(1).price,77);
  assert.equal(service.clearPrices(),1);assert.equal(service.getItem(1).price,null);assert.equal(service.getItem(1).buyQuantity,200);
  const latest=service.getSnapshot();payload={...payload,generatedAt:new Date(at-1000).toISOString()};
  await assert.rejects(service.importPrices(),/marketStale/);assert.equal(service.getSnapshot(),latest);
  service.setPrice(1,99);const snapshot=service.getSnapshot();payload={...payload,generatedAt:new Date(at+500).toISOString(),items:{2:{lowestSell:5,sellQty:0,highestBuy:null,buyQty:0}}};
  await service.importPrices();assert.equal(service.getItem(1).sellPrice,null);assert.equal(service.getItem(1).price,99);assert.equal(snapshot.getItem(1).sellPrice,9);
  const stored=JSON.parse(storage.get('dvi-item-prices-v1'));assert.equal(stored.version,8);assert.deepEqual(stored.preferences,{autoImport:false});assert.equal(stored.prices[1].price,99);assert.equal(stored.quotes[2].ask.quantity,0);
  const saved=storage.get('dvi-item-prices-v1'),setItem=globalThis.localStorage.setItem;globalThis.localStorage.setItem=()=>{throw Error('quota');};
  service.setPrice(1,55);assert.equal(service.getItem(1).price,55);assert.equal(service.getSaveError(),'priceSaveFailed');assert.equal(events.at(-1).storage,true);assert.equal(storage.get('dvi-item-prices-v1'),saved);
  globalThis.localStorage.setItem=setItem;service.setPrice(1,56);assert.equal(service.getSaveError(),null);assert.equal(events.at(-1).storage,true);
  const count=events.length;unsubscribe();service.setPrice(2,7);assert.equal(events.length,count);
 }finally{if(original===undefined)delete globalThis.localStorage;else globalThis.localStorage=original;}
});
