import test from 'node:test';
import assert from 'node:assert/strict';
import {forecast,epoch,tickTime,hotSkills} from '../src/hot-forecast.js';
import {hotKinds,normalizeSelection,toggleSelection,parseForecastFilters} from '../src/forecast-filters.js';
const at=time=>Date.parse(`2026-10-06T${time}:00+08:00`);
test('shared schedule includes thieving rare finds and the filter returns future slots',()=>{
 const now=Date.parse('2026-11-27T11:00:00+08:00'),result=forecast(now,'thieving','rarity');
 assert.deepEqual([result.current.skill,result.current.kind,result.current.mult],['thieving','rarity',1.25]);
 assert.equal(result.impossible,false);
 assert.equal(result.entries.length,10);
 assert.ok(result.entries.every(slot=>slot.skill==='thieving'&&slot.kind==='rarity'));
});
test('verified date examples and half-hour boundary use game epoch',()=>{
 for(const [time,skill] of [['11:00','smithing'],['11:30','farming'],['12:00','mining'],['12:30','fletching'],['13:00','combat'],['19:00','combat'],['23:00','combat']]){
  const current=forecast(at(time)).current;
  assert.equal(current.skill,skill);assert.equal(current.kind,'xp');assert.equal(current.mult,1.2);
  assert.equal(tickTime(current.from),at(time));assert.equal(tickTime(current.until),at(time)+1800000);
 }
 assert.equal(forecast(at('11:30')-1).current.skill,'smithing');
 assert.equal(forecast(at('11:30')).current.skill,'farming');
 assert.equal(tickTime(0),epoch);
});
test('unfiltered schedule contains 48 future contiguous half-hour slots',()=>{
 const now=at('11:12'),{current,entries}=forecast(now);
 assert.equal(entries.length,48);assert.equal(tickTime(entries[0].from),at('11:30'));
 assert.equal(entries[0].from,current.until);
 for(let i=0;i<entries.length;i++){
  assert.equal(tickTime(entries[i].until)-tickTime(entries[i].from),1800000);
  if(i)assert.equal(entries[i].from,entries[i-1].until);
 }
});
test('skill and bonus filters return exactly 10 future matching slots beyond 24 hours',()=>{
 const now=at('11:12');
 for(const skill of ['all',...hotSkills])for(const kind of ['all','xp','rarity']){
  if(skill==='all'&&kind==='all')continue;
  const result=forecast(now,skill,kind);
  if(result.impossible){assert.equal(kind,'rarity');assert.ok(['cooking','smithing','fletching','herblore','crafting','enhancing'].includes(skill));assert.deepEqual(result.entries,[]);continue;}
  assert.equal(result.entries.length,10);
  for(const [i,entry] of result.entries.entries()){
   assert.ok(tickTime(entry.from)>now);
   if(skill!=='all')assert.equal(entry.skill,skill);
   if(kind!=='all')assert.equal(entry.kind,kind);
   if(i)assert.ok(entry.from>result.entries[i-1].from);
  }
 }
 assert.ok(tickTime(forecast(now,'combat','rarity').entries[9].from)>now+86400000);
});
test('invalid clock and unknown filters fail explicitly',()=>{
 assert.throws(()=>forecast(epoch-1),/invalidTime/);
 assert.throws(()=>forecast(NaN),/invalidTime/);
 assert.throws(()=>forecast(at('11:00'),'unknown'),/invalidFilter/);
});
test('multi-select returns the earliest union within each group and intersection across groups',()=>{
 // Independently verified half-hour examples above: farming 11:30, mining 12:00.
 const result=forecast(at('11:12'),['mining','farming'],['xp']);
 assert.equal(result.entries.length,10);
 assert.deepEqual(result.entries.slice(0,2).map(entry=>[entry.skill,tickTime(entry.from)]),[['farming',at('11:30')],['mining',at('12:00')]]);
 assert.ok(result.entries.every(entry=>['mining','farming'].includes(entry.skill)&&entry.kind==='xp'));
 for(let i=1;i<result.entries.length;i++)assert.ok(result.entries[i].from>result.entries[i-1].from);
 assert.deepEqual(forecast(at('11:12'),['mining'],hotKinds),forecast(at('11:12'),'mining','all'));
 assert.deepEqual(forecast(at('11:12'),hotSkills,hotKinds),forecast(at('11:12')));
});
test('mixed possible and impossible rarity selections retain valid results',()=>{
 assert.equal(forecast(at('11:12'),['cooking','crafting'],['rarity']).impossible,true);
 const result=forecast(at('11:12'),['cooking','mining'],['rarity']);
 assert.equal(result.impossible,false);assert.equal(result.entries.length,10);
 assert.ok(result.entries.every(entry=>entry.skill==='mining'&&entry.kind==='rarity'));
 assert.throws(()=>forecast(at('11:12'),['mining','unknown']),/invalidFilter/);
 assert.throws(()=>forecast(at('11:12'),[],['unknown']),/invalidFilter/);
});
test('filter toggles and persisted state normalize all, duplicates and invalid data',()=>{
 assert.deepEqual(toggleSelection([],'mining',hotSkills),['mining']);
 assert.deepEqual(toggleSelection(['mining'],'fishing',hotSkills),['mining','fishing']);
 assert.deepEqual(toggleSelection(['mining'],'mining',hotSkills),[]);
 assert.deepEqual(toggleSelection(['mining'],'all',hotSkills),[]);
 assert.deepEqual(toggleSelection(['xp'],'rarity',hotKinds),[]);
 assert.deepEqual(normalizeSelection(['fishing','mining','fishing'],hotSkills),['mining','fishing']);
 const filters={version:1,skills:['fishing','mining'],kinds:['rarity']};
 assert.deepEqual(parseForecastFilters(JSON.parse(JSON.stringify(filters))),{skills:['mining','fishing'],kinds:['rarity']});
 for(const raw of [null,{}, {...filters,version:2},{...filters,skills:'mining'},{...filters,kinds:['bad']}])assert.throws(()=>parseForecastFilters(raw),/invalidFilter/);
});
