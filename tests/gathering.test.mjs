import {questlessOffline} from '../scripts/native-questless.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {gatheringDefaults,gatheringPotions,gatheringJobs,gatheringSkills,normalizeGathering,gatheringPlayer,selectedGatheringSites,gatheringStats,importGathering} from '../src/gathering-model.js';
import {createGatheringScenario,simulateGatheringSite,simulateGatheringJob} from '../src/gathering-simulation.js';
import {combatHot,combatHotWindows} from '../src/combat-hot.js';
import {manualWindows} from '../src/manual-settings.js';
import {nativeDay} from './native-day.mjs';
import {questlessTick} from '../scripts/native-questless.mjs';
import {valueCombatRewards} from '../src/item-prices.js';
const jobFor=skill=>gatheringJobs.find(j=>j.skill===skill);

test('discard setting defaults safely, persists as a boolean and resets on character import',()=>{
 const defaults=gatheringDefaults();assert.equal(defaults.discardGathered,false);
 for(const value of [undefined,null,false,'true','false',1])assert.equal(normalizeGathering({...defaults,discardGathered:value}).discardGathered,false);
 const selected=normalizeGathering({...defaults,discardGathered:true});
 assert.equal(normalizeGathering(JSON.parse(JSON.stringify(selected))).discardGathered,true);
 assert.equal(normalizeGathering({...selected,skill:'fishing'}).discardGathered,true);
 const {player}=gatheringPlayer(selected);
 const imported=importGathering(selected,{version:2,capturedAt:Date.now(),player,worldTick:player.lastTick,worldBuffs:[]});
 assert.equal(imported.state.discardGathered,false);
});

for(const skill of gatheringSkills)test(`${skill}: discard follows original route and values only retained product opportunities`,()=>{
 const s={...gatheringDefaults(),skill,discardGathered:true,simulationHours:24,hotSetting:'off'};
 const job=jobFor(skill),site=selectedGatheringSites(s,job)[0],scenario=createGatheringScenario(s,job,site,{seed:0});
 let p;game.predict(scenario.player,scenario.context,q=>{p=q;return false;});p.offlineCapTicks=scenario.durationTicks*2;
 assert.ok(game.startWork(p,scenario.context,site.id,job.id,'drop',null));
 const initialXp=p.skills[skill],gross={},counts={};let moving=0,bonusOpportunities=0;
 for(let tick=1;tick<=scenario.durationTicks;tick++){
  if(p.activity==='walking')moving++;
  const pack=p.pack.map(i=>({...i})),events=[];
  questlessTick(game,p,scenario.context,game.predictionStartTick+tick,events);
  for(const event of events){
   counts[event.kind]=(counts[event.kind]??0)+1;
   if(['produced','bonus','pet','mount','box'].includes(event.kind))gross[event.itemId]=(gross[event.itemId]??0)+(event.qty??1);
   if(event.kind==='dropped')bonusOpportunities=0;
   if(event.kind==='produced'&&job.bonus){
    // Test capacity directly against the pre-action pack plus sampled product.
    const candidate={...p,pack};game.addPack(candidate,event.itemId,event.qty??1);
    if(game.addPack(candidate,game.withRarity(job.bonus.itemId,1),1))bonusOpportunities++;
   }
  }
 }
 const actual=simulateGatheringSite(s,job,site,{seed:0}),inventory={...p.bank};
 for(const item of p.pack)inventory[item.itemId]=(inventory[item.itemId]??0)+item.qty;
 for(const [id,qty]of Object.entries(p.overflow))inventory[id]=(inventory[id]??0)+qty;
 assert.equal(Object.values(actual.activityTicks).reduce((a,b)=>a+b,0),actual.elapsedTicks);
 assert.equal(actual.extraTicks+actual.activityTicks.working,actual.elapsedTicks);
 assert.equal(actual.activityTicks.walking,actual.movingTicks);
 assert.ok(actual.extraTicks>=actual.movingTicks);
 assert.equal(actual.xp,p.skills[skill]-initialXp);assert.equal(actual.completed,counts.produced);
 assert.equal(actual.movingTicks,moving);assert.equal(actual.deposits,counts.deposited??0);assert.deepEqual(actual.sampleItems,gross);
 assert.equal(actual.totalIncome,actual.coins+actual.normalValue+actual.rareValue);
 if(skill==='thieving'){
  const bank=simulateGatheringSite({...s,discardGathered:false},job,site,{seed:0});
  assert.equal(actual.coins,counts.produced*job.output.qty);assert.deepEqual(actual,bank);
  assert.ok(Object.keys(actual.rareItems).some(id=>game.baseItemId(Number(id))===game.mountItemId));
 }else{
  assert.ok(counts.dropped>0);assert.equal(actual.deposits,0);
  const retained=Object.entries(inventory).filter(([id])=>game.baseItemId(Number(id))===job.output.itemId).reduce((sum,[,qty])=>sum+qty,0);
  assert.ok(retained>0&&retained<game.packCapacity(p));assert.ok(actual.completed>1000*retained);
  assert.ok(Math.abs(actual.normal-retained)<1e-9);
  const probabilities=[1-1/40,1/40-1/400,1/400-1/8000,1/8000-1/150000,1/150000];
  probabilities.forEach((prob,tier)=>assert.ok(Math.abs(actual.normalItems[game.withRarity(job.output.itemId,tier)]-retained*prob)<1e-9));
  if(job.bonus){
   const bonus=Object.entries(actual.rareItems).filter(([id])=>game.baseItemId(Number(id))===job.bonus.itemId).reduce((sum,[,qty])=>sum+qty,0);
   assert.ok(Math.abs(bonus-bonusOpportunities*job.bonus.chance)<1e-9);
   assert.ok(bonus<(counts.bonus??0));
  }
 }
});

test('discard preserves the pre-full segment and retained values at the nearest point',()=>{
 const s={...gatheringDefaults(),discardGathered:true,simulationHours:1/60,hotSetting:'off'},job=jobFor('mining');
 const short=simulateGatheringSite(s,job,selectedGatheringSites(s,job)[0]);
 assert.ok(short.completed<28);assert.ok(Math.abs(short.normal-short.completed)<1e-9);
 const result=simulateGatheringJob({...s,simulationHours:1},job);
 assert.equal(result.sites.length,selectedGatheringSites(s,job).length);
 assert.equal(result.normal,result.sites[0].normal);
 assert.ok(Math.abs(result.normal-Object.values(result.normalItems).reduce((a,b)=>a+b,0))<1e-9);
});

test('gathering scope, normalization, tools and independent skill settings',()=>{
 assert.deepEqual(gatheringSkills.map(s=>gatheringJobs.filter(j=>j.skill===s).length),[9,8,6,8]);
 const d=gatheringDefaults();assert.equal(d.simulationHours,24);assert.equal('siteSelection' in d,false);
 const s=normalizeGathering({...d,skill:'fishing',jobSelection:1,siteSelection:1,gear:{rod:{id:89,tier:4,plus:10}},levels:{mining:85,fishing:40},perks:{quick:100}});
 assert.equal(s.jobSelection,'all');assert.equal('siteSelection' in s,false);assert.equal(s.levels.mining,85);assert.equal(s.levels.fishing,40);assert.equal(s.perks.quick,10);
 const p=gatheringPlayer(s).player;assert.equal(p.equipment.rod,game.encode(game.withRarity(89,4),10));assert.equal(p.skills.fishing,game.levelXp(40));assert.equal(p.eatAt,0);assert.deepEqual(p.bank,{});
 assert.ok(gatheringStats(s).toolBonus>0);assert.equal(gatheringStats(s).capacity,28);
 assert.equal(normalizeGathering({...d,simulationHours:0,hotSetting:'bad'}).hotSetting,'current');
});

for(const skill of gatheringSkills)test(`${skill}: adapter matches independent original offline reports, upgrades and banking`,()=>{
 const s=gatheringDefaults();s.skill=skill;s.simulationHours=1;s.hotSetting='off';s.perks.pockets=5;s.perks.quick=10;s.masteries.gather=100;s.brews.gatherer=2;
 const job=jobFor(skill),site=selectedGatheringSites(s,job)[0],scenario=createGatheringScenario(s,job,site);
 const native=nativeDay(scenario.player,scenario.context,p=>game.startWork(p,scenario.context,site.id,job.id,'bank',null),scenario.durationTicks);
 const actual=simulateGatheringSite(s,job,site);
 assert.equal(actual.xp,native.bySkill[skill]);assert.equal(actual.elapsedTicks,native.ticks);
 const expected=actual.sampleItems;
 assert.deepEqual(expected,native.itemsGained);assert.ok(actual.endLevel>actual.startLevel);assert.ok(actual.completed>0);
 if(skill!=='thieving')assert.ok(actual.deposits>0);else{assert.ok(actual.caught>0);assert.equal(actual.attempts,actual.completed+actual.caught);assert.ok(actual.stunnedTicks>0);assert.equal(actual.normal,0);}
});

test('each task simulates only the nearest point and ignores legacy site selections',()=>{
 const s={...gatheringDefaults(),simulationHours:1/60},job=jobFor('mining');let count=0;
 const r=simulateGatheringJob(s,job,{onSite:()=>count++});assert.equal(count,1);assert.equal(r.sites.length,1);assert.equal(r.completed,r.sites[0].completed);
 for(const siteSelection of [0,1,2,3,'nearest','bad',null]){
  const legacy={...s,jobSelection:job.id,siteSelection,homeBank:2};
  assert.equal('siteSelection' in normalizeGathering(legacy),false);
  assert.deepEqual(simulateGatheringJob(legacy,job),simulateGatheringJob({...legacy,siteSelection:undefined},job));
 }
 assert.throws(()=>simulateGatheringSite(s,gatheringJobs.find(j=>j.levelReq>1),game.world.sites[0]),/invalidSite|levelTooLow/);
});

test('skill-specific hot windows omit native bonuses when disabled and map current schedule',()=>{
 const start=game.predictionStartTick,end=start+144000;
 for(const skill of gatheringSkills){const windows=manualWindows(start,end,10,true,skill);for(let tick=start;tick<end;tick+=1000){const xp=windows.filter(w=>w.fromTick<=tick&&tick<=w.toTick).reduce((a,w)=>a+(w.xpMult-1),1);assert.ok(Math.abs(xp-1.1)<1e-10);}
  const schedule=combatHot(Date.now(),24,skill);assert.ok(schedule.entries.every(h=>h.skill===skill));assert.equal(combatHotWindows(schedule).length,schedule.entries.length);
 }
});

test('configuration import maps gathering fields and restores simulation defaults',()=>{
 const d=gatheringDefaults(),p=gatheringPlayer(d).player;p.skills.mining=game.levelXp(85)+10;p.equipment.pickaxe=game.encode(game.withRarity(84,3),5);p.brews.gatherer=p.lastTick+100;p.brewTier.gatherer=2;p.perks.hands=8;p.masteries.gather=7;
 const snapshot={version:2,capturedAt:Date.now(),player:p,worldTick:p.lastTick,worldBuffs:[]};
 const r=importGathering({...d,simulationHours:1,jobSelection:1,siteSelection:1},snapshot);
 assert.equal(r.state.levels.mining,85);assert.deepEqual(r.state.gear.pickaxe,{id:84,tier:3,plus:5});assert.equal(r.state.brews.gatherer,2);assert.equal(r.state.perks.hands,8);assert.equal(r.state.masteries.gather,7);assert.equal(r.state.simulationHours,1);assert.equal('siteSelection' in r.state,false);assert.equal(r.state.jobSelection,'all');
 p.skills.mining='bad';const partial=importGathering({...d,levels:{...d.levels,mining:90}},snapshot);assert.equal(partial.state.levels.mining,90);assert.ok(partial.warnings.includes('skills.mining'));
 assert.throws(()=>importGathering(d,{...snapshot,version:1}),/invalidSnapshot/);
});

for(const skill of gatheringSkills)for(const discardGathered of [false,true])test(`${skill} ${discardGathered?'drop':'bank'}: every task and point matches original offline inventory and XP`,()=>{
 const s=gatheringDefaults();s.skill=skill;s.discardGathered=discardGathered;s.levels[skill]=100;s.simulationHours=1;s.hotSetting='off';s.gear[{mining:'pickaxe',fishing:'rod',woodcutting:'axe',thieving:'gloves'}[skill]]={id:{mining:84,fishing:89,woodcutting:94,thieving:327}[skill],tier:4,plus:5};s.gear.amulet={id:186,tier:4,plus:5};s.brews.hunter=4;s.masteries.rare=100;
 for(const job of gatheringJobs.filter(j=>j.skill===skill))for(const site of game.world.sites.filter(site=>site.jobIds.includes(job.id))){
  const scenario=createGatheringScenario(s,job,site);let p;game.predict(scenario.player,scenario.context,prepared=>{p=prepared;return false;});p.offlineCapTicks=scenario.durationTicks*2;
  assert.ok(game.startWork(p,scenario.context,site.id,job.id,discardGathered?'drop':'bank',null));
  const initialXp=p.skills[skill],gained={};for(let tick=game.predictionChunkTicks;tick<=scenario.durationTicks;tick+=game.predictionChunkTicks){const report=questlessOffline(game,p,scenario.context,game.predictionStartTick+tick);for(const [id,qty]of Object.entries(report.itemsGained))gained[id]=(gained[id]??0)+qty;}
  const actual=simulateGatheringSite(s,job,site),inventory={...p.bank};for(const item of p.pack)inventory[item.itemId]=(inventory[item.itemId]??0)+item.qty;for(const [id,qty]of Object.entries(p.overflow))inventory[id]=(inventory[id]??0)+qty;
  const expected={...actual.sampleItems};delete expected[game.coinItemId];
  delete gained[game.coinItemId];assert.deepEqual(expected,discardGathered?gained:inventory,`${skill} job ${job.id} site ${site.id}`);assert.equal(actual.coins,p.coins);assert.equal(actual.xp,p.skills[skill]-initialXp);
  if(discardGathered){const retained=Object.entries(inventory).filter(([id])=>game.baseItemId(Number(id))===job.output.itemId).reduce((sum,[,qty])=>sum+qty,0);assert.ok(Math.abs(actual.normal-retained)<1e-8,`${skill} retained job ${job.id} site ${site.id}`);}
 }
});

test('nearest strategy preserves original point order and uses the prediction depot start',()=>{
 const d=gatheringDefaults(),job=jobFor('mining');
 const automatic={...d,siteSelection:'nearest',simulationHours:1/60};
 assert.equal('siteSelection' in normalizeGathering(automatic),false);
 assert.equal(selectedGatheringSites(automatic,job)[0].id,1);
 assert.equal(selectedGatheringSites({...automatic,homeBank:1},job)[0].id,1);
 const second=selectedGatheringSites({...automatic,homeBank:2},job);assert.equal(second.length,1);
 // From depot 2, the shortest walk reaches the far side of the river first.
 const fishing=gatheringJobs.find(j=>j.id===25);
 assert.equal(selectedGatheringSites({...automatic,skill:'fishing',homeBank:2},fishing)[0].id,34);
 const theft=jobFor('thieving');assert.equal(selectedGatheringSites({...automatic,skill:'thieving',homeBank:2},theft)[0].id,84);
 assert.equal(game.nearestWorkSite({world:{width:4,height:4,collision:new Uint8Array(16),sites:[{id:3,x:1,y:0,jobIds:[1]},{id:2,x:0,y:1,jobIds:[1]}]}},1,0,0),3);
 const result=simulateGatheringJob(automatic,job);assert.equal(result.sites.length,1);assert.equal(result.sites[0].siteId,1);
 assert.equal('siteSelection' in normalizeGathering({...automatic,jobSelection:job.id}),false);
 assert.equal('siteSelection' in normalizeGathering({...automatic,siteSelection:'bad'}),false);
});

test('gathering output names translate base items independently of all quality prefixes',async()=>{
 const {translatedItemName}=await import('../src/i18n.js');
 assert.equal(translatedItemName(game.withRarity(1,2),'zh'),'铜矿');
 assert.equal(translatedItemName(game.withRarity(1,2),'en'),'Copper');
 for(const job of gatheringJobs){if(job.output.itemId===game.coinItemId)continue;for(let tier=0;tier<5;tier++){
  const id=game.withRarity(job.output.itemId,tier),zh=translatedItemName(id,'zh');assert.match(zh,/[\u3400-\u9fff]/);assert.doesNotMatch(zh,/Normal|Uncommon|Rare|Epic|Legendary/);
 }}
});

test('luck uses only the active tool quality and amulet, separately from rare-find multipliers',()=>{
 const slots={mining:'pickaxe',fishing:'rod',woodcutting:'axe',thieving:'gloves'};
 assert.equal(gatheringStats(gatheringDefaults()).luck,0);
 for(const [skill,slot]of Object.entries(slots)){
  const s=gatheringDefaults();s.skill=skill;
  const id=game.tools.find(t=>t.slot===slot&&game.itemTier(t.itemId)===0).itemId;
  for(const [tier,expected]of [0,.25,.75,2,5].entries()){
   s.gear[slot]={id,tier,plus:0};assert.equal(gatheringStats(s).luck,expected);
   s.gear[slot].plus=10;assert.equal(gatheringStats(s).luck,expected);
  }
  const amulet=game.equipment.find(g=>g.slot==='amulet'&&game.itemTier(g.itemId)===0);
  s.gear.amulet={id:amulet.itemId,tier:2,plus:5};
  const expected=5+game.gear(game.encode(game.withRarity(amulet.itemId,2),5)).luck;
  assert.equal(gatheringStats(s).luck,expected);
  s.house.shrine=100;s.masteries.rare=10;s.brews.hunter=4;s.blessing=true;
  assert.equal(gatheringStats(s).luck,expected);
  s.gear[slot].id=0;assert.equal(gatheringStats(s).luck,game.gear(game.encode(game.withRarity(amulet.itemId,2),5)).luck);
 }
});

test('combined luck adds rarity modifiers before multiplying equipment luck',()=>{
 const s=gatheringDefaults();assert.equal(gatheringStats(s).luckBonus,0);
 s.gear.pickaxe={id:game.tools.find(t=>t.slot==='pickaxe'&&game.itemTier(t.itemId)===0).itemId,tier:2,plus:0};
 s.gear.amulet={id:game.equipment.find(g=>g.slot==='amulet'&&game.itemTier(g.itemId)===0).itemId,tier:0,plus:0};
 assert.equal(gatheringStats(s).luck,1);assert.equal(gatheringStats(s).luckBonus,1);
 s.brews.hunter=0;s.blessing=true;s.house.shrine=10;s.masteries.rare=10;
 assert.ok(Math.abs(gatheringStats(s).luckBonus-1.9)<1e-12);
 s.hotSetting='current';assert.ok(Math.abs(gatheringStats(s).luckBonus-1.9)<1e-12);
});

for(const job of gatheringJobs)for(const homeBank of [0,1,2])test(`${job.skill} job ${job.id}, depot ${homeBank}: selection and simulation share the original initialized start`,()=>{
 const state={...gatheringDefaults(),skill:job.skill,homeBank,simulationHours:1/60};state.levels[job.skill]=99;
 const {player}=gatheringPlayer(state),context=game.createContext(game.world,0);let prepared;
 game.predict(player,context,p=>{prepared=p;return false;});
 const [site]=selectedGatheringSites(state,job);
 assert.equal(site.id,game.nearestWorkSite(context,job.id,prepared.x,prepared.y));
 const scenario=createGatheringScenario(state,job,site);
 assert.equal(scenario.player.x,player.x);assert.equal(scenario.player.y,player.y);assert.equal(scenario.bank.id,homeBank||1);
 const native=nativeDay(scenario.player,scenario.context,p=>game.startWork(p,scenario.context,site.id,job.id,'bank',null),scenario.durationTicks);
 const actual=simulateGatheringJob(state,job);
 assert.equal(actual.sites.length,1);assert.equal(actual.homeBank,homeBank||1);assert.equal(actual.xp,native.bySkill[job.skill]??0);assert.deepEqual(actual.sampleItems,native.itemsGained);
});

test('gathering potion costs use enabled qualities and selected hours, with profit and repricing',()=>{
 const state={...gatheringDefaults(),simulationHours:1/60,blessing:true},job=jobFor('mining');
 assert.deepEqual(simulateGatheringJob(state,job).potionItems,{});
 state.brews.gatherer=0;state.brews.hunter=4;
 const raw=simulateGatheringJob(state,job),gatherer=game.withRarity(gatheringPotions.find(b=>b.kind==='gatherer').itemId,0),hunter=game.withRarity(gatheringPotions.find(b=>b.kind==='hunter').itemId,4);
 assert.deepEqual(raw.potionItems,{[gatherer]:1/60,[hunter]:1/60});
 const prices=Object.fromEntries([...Object.keys(raw.normalItems),...Object.keys(raw.rareItems)].map(id=>[id,{price:0}]));
 prices[gatherer]={price:6000};prices[hunter]={price:12000};
 const valued=valueCombatRewards(raw,prices);
 assert.equal(valued.potionCost,300);assert.equal(valued.profit,valued.totalIncome-300);assert.ok(valued.profit<0);assert.deepEqual(valued.potionMissingPrices,[]);
 const repriced=valueCombatRewards(raw,{...prices,[gatherer]:{price:0}});assert.equal(repriced.potionCost,200);assert.equal(repriced.profit,valued.profit+100);
 const missing=valueCombatRewards(raw,{});assert.deepEqual(missing.potionMissingPrices.map(Number).sort((a,b)=>a-b),[gatherer,hunter].sort((a,b)=>a-b));
 state.simulationHours=1;const hourly=simulateGatheringJob(state,job);assert.deepEqual(hourly.potionItems,{[gatherer]:1,[hunter]:1});
});

test('optimizer reward modes use the Gathering page expectations without sampled-drop ledgers',()=>{
 const closeItems=(actual,expected)=>{
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
  for(const id of Object.keys(expected))assert.ok(Math.abs(actual[id]-expected[id])<=1e-9*Math.max(1,expected[id]),`${id}: ${actual[id]} != ${expected[id]}`);
 };
 for(const job of gatheringJobs)for(const discardGathered of [false,true]){
  const state=gatheringDefaults();state.skill=job.skill;state.levels[job.skill]=100;state.simulationHours=1/60;state.hotSetting='off';state.discardGathered=discardGathered;
  const options={seed:1426429260,now:Date.UTC(2026,9,28)};
  const page=simulateGatheringJob(state,job,options);
  const income=simulateGatheringJob(state,job,{...options,rewardMode:'income',collectSamples:false});
  const collection=simulateGatheringJob(state,job,{...options,rewardMode:'collection',collectSamples:false});
  for(const result of [income,collection]){
   for(const metric of ['completed','attempts','caught','xp','coins','movingTicks','deposits','endLevel','endedEarly'])assert.equal(result[metric],page[metric],`${job.id}: ${metric}`);
   assert.deepEqual(result.sampleItems,{});
  }
  closeItems(income.normalItems,page.normalItems);closeItems(income.rareItems,page.rareItems);assert.deepEqual(income.collectionItems,{});
  closeItems(collection.collectionItems,page.collectionItems);assert.deepEqual(collection.normalItems,{});assert.deepEqual(collection.rareItems,{});
 }
 const state=gatheringDefaults(),job=jobFor('mining');
 assert.throws(()=>simulateGatheringJob(state,job,{rewardMode:'unknown'}),/invalidRewardMode/);
});
