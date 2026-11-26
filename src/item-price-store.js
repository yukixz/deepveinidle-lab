import {requestMarket} from './market-import.js';
import {priceStorageKey,normalizePriceState,validateMarketSnapshot} from './item-prices.js';
let state={version:8,prices:{},quotes:{},preferences:{autoImport:true}},saveError=null,initialized=false;const listeners=new Set();
function initialize(){if(initialized)return;initialized=true;
 try{const raw=localStorage.getItem(priceStorageKey);if(raw){
  const previous=normalizePriceState(JSON.parse(raw));
  state={version:8,prices:previous.prices,quotes:previous.quotes,preferences:{autoImport:previous.preferences.autoImport}};
 }}catch(error){saveError=error.message==='invalidPriceStorage'?'invalidPriceStorage':'priceReadFailed';}
}
export function priceState(){initialize();return state;}
export function priceSaveError(){initialize();return saveError;}
export function updatePrices(next){initialize();const previous=state,previousError=saveError;state=next;
 try{localStorage.setItem(priceStorageKey,JSON.stringify(state));saveError=null;}catch{saveError='priceSaveFailed';}
 const change=Object.freeze({...Object.fromEntries(['prices','quotes','preferences'].map(key=>[key==='quotes'?'market':key,JSON.stringify(previous[key])!==JSON.stringify(state[key])])),storage:previousError!==saveError});
 for(const listener of listeners)listener(change);
}
export function subscribePrices(listener){listeners.add(listener);return ()=>listeners.delete(listener);}

export function setAutoUpdate(autoImport){
 const current=priceState();
 updatePrices({...current,preferences:{autoImport}});
}

let marketRequest;
export function refreshMarketPrices(){
 marketRequest??=refreshQuotes().finally(()=>{marketRequest=null;});
 return marketRequest;
}
async function refreshQuotes(){
 const current=priceState();
 if(saveError==='invalidPriceStorage'||saveError==='priceReadFailed')throw Error(saveError);
 const response=await requestMarket();
 if(!response.snapshot)throw Error('noMarketData');
 const parsed=validateMarketSnapshot(response.snapshot);
 const count=Object.keys(parsed.quotes).length;
 if(!count)throw Error(parsed.invalid?'invalidMarketData':'noMarketData');
 const latest=Math.max(0,...Object.values(current.quotes).flatMap(q=>Object.values(q).map(side=>side.capturedAt)));
 const incoming=Math.max(...Object.values(parsed.quotes).flatMap(q=>Object.values(q).map(side=>side.capturedAt)));
 if(incoming<latest)throw Error('marketStale');
 updatePrices({...priceState(),quotes:parsed.quotes});
 if(saveError)throw Error(saveError);
 return {stats:{count,invalid:parsed.invalid}};
}

export const priceAutoImportTimeKey='dvi-price-auto-import-at-v1';
const priceAutoImportInterval=5*60*1000;
export async function importAutomaticPrices(now=Date.now()){
 const claim=()=>{
  initialize();
  if(saveError)throw Error(saveError);
  if(!state.preferences.autoImport)return false;
  try{
   const saved=localStorage.getItem(priceAutoImportTimeKey),last=Number(saved);
   if(saved!==null&&(!Number.isSafeInteger(last)||last<=0))throw Error('invalidAutoImportTime');
   if(last&&now-last<priceAutoImportInterval)return false;
   localStorage.setItem(priceAutoImportTimeKey,String(now));
  }catch{throw Error('priceAutoImportStorageFailed');}
  return true;
 };
 const claimed=globalThis.navigator?.locks?await navigator.locks.request(priceAutoImportTimeKey,async()=>claim()):claim();
 if(!claimed)return null;
 return refreshMarketPrices();
}
