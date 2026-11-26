import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {captureScript} from './helpers/capture-harness.mjs';
import {parseMarketPrices,requestMarket,marketPricesUrl} from '../src/market-import.js';
const generatedAt=new Date(Date.now()-1000).toISOString();
const payload=(items={1:{lowestSell:84,highestBuy:null},1110:{lowestSell:900,highestBuy:700}})=>({game:'Deep Vein Idle',generatedAt,refreshSeconds:300,items});

test('official prices map full variant IDs and use generation time, with null distinct from missing',()=>{
 const s=parseMarketPrices(payload({1:{lowestSell:84,highestBuy:null},1110:{lowestSell:900,highestBuy:700},2:{lowestSell:5},3:{lowestSell:0,highestBuy:'1'},9999999:{lowestSell:1,highestBuy:2}}));
 assert.deepEqual(s.quotes[1],{ask:{value:84,capturedAt:Date.parse(generatedAt),quantityInvalid:true},bid:{value:null,capturedAt:Date.parse(generatedAt),quantityInvalid:true},avg7d:{invalid:true,capturedAt:Date.parse(generatedAt)},avg30d:{invalid:true,capturedAt:Date.parse(generatedAt)}});
 assert.equal(s.quotes[1110].bid.value,700);assert.equal(s.quotes[110],undefined);assert.equal(s.quotes[2].bid.invalid,true);assert.equal(s.quotes[3].ask.invalid,true);assert.equal(s.quotes[3].bid.invalid,true);assert.equal(s.invalid,1);

});
test('invalid metadata, unknown-only items and empty official data fail explicitly',()=>{
 for(const patch of [{game:'other'},{generatedAt:null},{generatedAt:'bad'},{generatedAt:new Date(Date.now()+120000).toISOString()},{refreshSeconds:0},{refreshSeconds:'300'},{items:[]},{items:null}])assert.throws(()=>parseMarketPrices({...payload(),...patch}),/invalidMarketData/);
 assert.throws(()=>parseMarketPrices(payload({})),/noMarketData/);
 assert.throws(()=>parseMarketPrices(payload({9999999:{lowestSell:2,highestBuy:1}})),/invalidMarketData/);
});
test('requests official public API without credentials and validates its response',async t=>{
 let called;t.mock.method(globalThis,'fetch',async(url,options)=>{called={url,options};return {ok:true,json:async()=>payload()};});
 const result=await requestMarket();assert.equal(called.url,marketPricesUrl);assert.equal(called.options.credentials,'omit');assert.ok(called.options.signal instanceof AbortSignal);assert.equal(result.snapshot.quotes[1].ask.value,84);
});
for(const [name,response,error]of [
 ['HTTP',()=>({ok:false}),'marketHttpFailed'],
 ['network',()=>{throw Error('offline');},'marketNetworkFailed'],
 ['JSON',()=>({ok:true,json:async()=>{throw SyntaxError('bad JSON');}}),'invalidMarketData'],
 ['structure',()=>({ok:true,json:async()=>({})}),'invalidMarketData']
])test(`${name} failure is reported`,async t=>{t.mock.method(globalThis,'fetch',async()=>response());await assert.rejects(requestMarket(),new RegExp(error));});
test('timeout aborts request and reports an explicit timeout',async t=>{
 const original=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms)=>{assert.equal(ms,10000);return original(fn,1);});
 t.mock.method(globalThis,'fetch',async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
 await assert.rejects(requestMarket(),/marketTimeout/);
});
test('userscript exposes only the role bridge and never reads or replies to market requests',async()=>{
 const document=new EventTarget(),reads=[],marketReplies=[];
 class DomEvent extends Event{constructor(type,{detail}){super(type);this.detail=detail;}}
 document.addEventListener('dvi-market-response',event=>marketReplies.push(event));
 vm.runInNewContext(captureScript,{document,CustomEvent:DomEvent,location:{origin:'http://127.0.0.1:4173'},GM_getValue:async key=>{reads.push(key);return {version:2};}});
 const send=(type,action)=>document.dispatchEvent(new DomEvent(type,{detail:JSON.stringify({source:'dvi-simulator',id:'test',action})}));
 send('dvi-market-request','probe');send('dvi-market-request','read');await new Promise(r=>setImmediate(r));assert.deepEqual(reads,[]);assert.deepEqual(marketReplies,[]);
 const replies=[];document.addEventListener('dvi-character-response',event=>replies.push(JSON.parse(event.detail)));
 send('dvi-character-request','read');await new Promise(r=>setImmediate(r));assert.deepEqual(reads,['dvi-character-snapshot-v2']);assert.equal(replies[0].version,'2.4');
 assert.doesNotMatch(captureScript,/dvi-market|marketBook|marketDepth|Market prices captured/);
});

test('official seven/thirty-day averages preserve decimals and distinguish null from missing or invalid',()=>{
 const parsed=parseMarketPrices(payload({1:{avg7d:73.25,avg30d:62},2:{avg7d:null,avg30d:0},3:{avg7d:'7'}}));
 assert.deepEqual(parsed.quotes[1].avg7d,{value:73.25,capturedAt:Date.parse(generatedAt)});
 assert.equal(parsed.quotes[1].avg30d.value,62);assert.equal(parsed.quotes[2].avg7d.value,null);
 assert.equal(parsed.quotes[2].avg30d.invalid,true);assert.equal(parsed.quotes[3].avg7d.invalid,true);assert.equal(parsed.quotes[3].avg30d.invalid,true);
});
