import test from 'node:test';
import assert from 'node:assert/strict';
import {enhanceableItems} from '../src/enhancement.js';
import {filterSearchOptions,bindSearchSelect} from '../src/search-select.js';
test('all enhanceable items are searchable and bilingual search ignores case',()=>{
 assert.equal(enhanceableItems.length,297);
 const catalog=enhanceableItems.map(x=>({value:x.id,label:x.name}));assert.equal(filterSearchOptions(catalog,'').length,297);
 const options=[{value:1,label:'青铜',search:'青铜 Bronze blade'},{value:2,label:'铁',search:'铁 Iron blade'}];
 assert.equal(filterSearchOptions(options,' BRONZE ')[0].value,1);assert.equal(filterSearchOptions(options,'青铜')[0].value,1);assert.equal(filterSearchOptions(options,'missing').length,0);
});
test('search selection commits only confirmed options and restores value on cancel, blur and category changes',()=>{
 const original=globalThis.document,elements=new Map();
 const element=()=>({value:'',innerHTML:'',textContent:'',hidden:true,setAttribute(){},removeAttribute(){},scrollIntoView(){}});
 globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}};
 try{
  const selections=[],options=[{value:1,label:'One'},{value:2,label:'Two'}];
  const select=bindSearchSelect({id:'item',options,value:1,onSelect:x=>selections.push(x),emptyText:'None',countText:n=>String(n),selectedLabel:id=>options.find(x=>x.value===id).label});
  const input=elements.get('item'),key=key=>input.onkeydown({key,preventDefault(){}});
  input.onfocus();input.value='invalid';input.oninput();key('Enter');assert.deepEqual(selections,[]);assert.equal(elements.get('item-status').textContent,'None');key('Escape');assert.equal(input.value,'One');
  input.onfocus();key('ArrowUp');key('Enter');assert.deepEqual(selections,[2]);assert.equal(input.value,'Two');
  input.onfocus();input.value='One';input.oninput();input.onblur();assert.equal(input.value,'Two');assert.deepEqual(selections,[2]);
  select.setOptions([options[0]]);assert.equal(input.value,'Two');input.onfocus();key('ArrowDown');key('Enter');assert.deepEqual(selections,[2,1]);
 }finally{globalThis.document=original;}
});
