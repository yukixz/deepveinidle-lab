import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {enhancementStorageKey} from '../src/enhancement.js';

test('userscript bridge imports enhancement independently, retains state on errors, and never stores inventory',async()=>{
 const original={document:globalThis.document,localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),CustomEvent:globalThis.CustomEvent};
 const elements=new Map(),storage=new Map([['dvi-simulator-v1','combat configuration sentinel']]);let failStorage=false;
 class Element{innerHTML='';textContent='';open=false;disabled=false;value='';setAttribute(){}removeAttribute(){}querySelector(){return null;}querySelectorAll(){return [];}addEventListener(){}}
 class Document extends EventTarget{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}querySelector(selector){return this.getElementById(selector);}querySelectorAll(){return [];}}
 const document=new Document();
 globalThis.document=document;globalThis.CustomEvent=class extends Event{constructor(type,args){super(type);this.detail=args.detail;}};
 globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(failStorage)throw Error('quota');storage.set(key,value);}};
 let snapshot={guild:{name:"Miners",tag:"MINE"},version:2,capturedAt:Date.now(),player:{skills:{enhancing:game.levelXp(42)},house:{lectern:7},houseFurniture:{lectern:{cell:1,slot:0}},masteries:{enhance:9},equipment:{mount:game.encode(game.withRarity(328,3),7)},bank:{328:3},pack:[],overflow:{}}};
 document.addEventListener('dvi-character-request',event=>{const request=JSON.parse(event.detail);document.dispatchEvent(new CustomEvent('dvi-character-response',{detail:JSON.stringify({source:'dvi-character-script',id:request.id,version:'2.4',snapshot})}));});
 try{
  const {renderEnhancement}=await import('../src/enhancement-controls.js');renderEnhancement('zh');const {setCharacterImportPage}=await import('../src/import-controls.js');setCharacterImportPage('enhance');
  await document.getElementById('enhance-import').onclick();
  let saved=JSON.parse(storage.get(enhancementStorageKey));assert.deepEqual(saved.guild,{name:"Miners",tag:"MINE"});assert.equal(saved.level,42);assert.equal(saved.lectern,7);assert.equal(saved.mastery,9);assert.equal(saved.bank,undefined);assert.equal(saved.candidates,undefined);assert.equal(storage.get('dvi-simulator-v1'),'combat configuration sentinel');assert.match(document.getElementById('enhance-import-status').textContent,/已导入/);assert.doesNotMatch(document.getElementById('enhance-content').innerHTML,/角色物品|enhance-candidate/);
  const previous=storage.get(enhancementStorageKey);delete snapshot.player.skills;
  await document.getElementById('enhance-import').onclick();assert.equal(storage.get(enhancementStorageKey),previous);assert.match(document.getElementById('enhance-import-status').textContent,/缺少/);assert.doesNotMatch(document.getElementById('enhance-content').innerHTML,/角色物品|enhance-candidate/);
  snapshot=null;await document.getElementById('enhance-import').onclick();assert.match(document.getElementById('enhance-import-status').textContent,/没有角色数据/);
  renderEnhancement('en');assert.doesNotMatch(document.getElementById('enhance-content').innerHTML,/Quick select character item|enhance-candidate/);assert.match(document.getElementById('enhance-import-status').textContent,/No character data/);
  failStorage=true;document.getElementById('enhance-reset').onclick();assert.match(document.getElementById('enhance-save-note').textContent,/not saved/);assert.equal(storage.get(enhancementStorageKey),previous);
 }finally{for(const [key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else if(key==='localStorage')Object.defineProperty(globalThis,key,value);else globalThis[key]=value;}}
});
