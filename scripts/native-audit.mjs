import {questlessOffline,questlessTick} from './native-questless.mjs';
// Independently extract the current native engine for compatibility checks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';
import {game,preset} from '../src/model.js';
import {createScenario,simulateMonster,START_TICK} from '../src/simulation.js';
import {gatheringDefaults,gatheringJobs} from '../src/gathering-model.js';
import {createGatheringScenario,simulateGatheringSite} from '../src/gathering-simulation.js';
import {craftingDefaults,craftingTiers,craftingJobs,craftingMaterials} from '../src/crafting-model.js';
import {createCraftingScenario,simulateCrafting} from '../src/crafting-simulation.js';
import {enhancementDefaults,enhanceableItems,enhancementSteps} from '../src/enhancement.js';
import {forecast} from '../src/hot-forecast.js';

async function loadNative(directory,output,manifestPath,snapshotPath,exports){
const manifest=JSON.parse(fs.readFileSync(manifestPath));
const metadata={...manifest,file:snapshotPath};
const source=fs.readFileSync(metadata.file,'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),metadata.sha256);
const declarations=new Map();
for(const node of parse(source,{ecmaVersion:'latest',sourceType:'module',ranges:true}).body){
 if(node.type==='FunctionDeclaration'||node.type==='ClassDeclaration')declarations.set(node.id.name,{start:node.start,text:source.slice(node.start,node.end)});
 if(node.type==='VariableDeclaration')for(const d of node.declarations){
  const ids=[];const walk=n=>{if(!n)return;if(n.type==='Identifier')ids.push(n.name);else if(n.type==='ObjectPattern')n.properties.forEach(p=>walk(p.value));else if(n.type==='ArrayPattern')n.elements.forEach(walk);};walk(d.id);
  const entry={start:d.start,text:node.kind+' '+source.slice(d.start,d.end)+';'};ids.forEach(id=>declarations.set(id,entry));
 }
}
const selected=new Set(),allowed=new Set(['WeakSet','WeakMap','Uint8Array','Uint16Array','Uint32Array','Int16Array','Int32Array','Float64Array','Math','Map','Set','Number','Object','Array','String','Error','Date','Boolean','Infinity','undefined','JSON','RegExp','parseInt','parseFloat']);
function collect(name){
 const d=declarations.get(name);if(!d)throw Error('Missing native declaration '+name);if(selected.has(d))return;selected.add(d);
 const refs=analyze(parse(d.text,{ecmaVersion:'latest',sourceType:'module',ranges:true}),{ecmaVersion:2024,sourceType:'module'}).globalScope.through.map(r=>r.identifier.name);
 for(const dep of new Set(refs))if(declarations.has(dep))collect(dep);else if(!allowed.has(dep))throw Error('Unexpected native dependency '+dep);
}
Object.values(exports).forEach(collect);
 const file=path.join(directory,output);
 fs.writeFileSync(file,[...selected].sort((a,b)=>a.start-b.start).map(d=>d.text).join('\n')+'\nexport{'+Object.entries(exports).map(([alias,name])=>name+' as '+alias).join(',')+'};');
 return {engine:await import(pathToFileURL(file)),version:metadata.changelogVersion};
}

const exports={
 world:'X',monsters:'Il',gear:'as',predict:'pS',offline:'Hq',startFight:'Sv',startWork:'mh',
 tick:'HMo',killMonster:'Gzo',seededFloat:'ni',bonusSalt:'czo',hotSkill:'OT',
 upgradeResult:'pb',upgradeRecipes:'$m',startUpgrade:'R3o',itemSupportsRarity:'hb',itemEnhancementLimit:'li',
 enhanceCost:'yc',enhanceChance:'mH',enhanceXp:'AVo',enhanceTicks:'ed',skillPetChance:'QO',
 enhanceProtectedFailTo:'Dm',enhancePityChance:'xVo',enhancePityActive:'gv',enhanceRules:'qs',
};
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dvi-native-audit-'));
try{
 const {engine:native,version}=await loadNative(directory,'native.mjs','vendor/manifest.json','vendor/game-original.js',exports);
 assert.deepEqual(native.world,game.world);assert.deepEqual(native.monsters,game.monsters);
 const rarityVariants=id=>native.itemSupportsRarity(id)?[0,1,2,3,4]:[0];
 const gearLevels=id=>{
  const cap=native.itemEnhancementLimit(id);
  return [...new Set([0,Math.min(17,cap),cap])];
 };
 let tokenCases=0,upgradeEncodingCases=0;
 for(const shrine of [0,20,50])for(const worldRare of [0,.25,10000])for(let seed=0;seed<64;seed++){
  const state=preset('ranged');state.gear.amulet={id:0,tier:0,plus:0};state.brews.hunter=-1;state.manual.blessing=false;state.manual.hotSetting='off';state.manual.worldRarity=worldRare*100;state.house.shrine=shrine;
  const monster={...game.monsters[0],bonus:{...game.monsters[0].bonus,chance:.5}};
  const {player,context}=createScenario(state,monster,{seed});
  const tick=START_TICK+1,roll=native.seededFloat(seed,context.secretAt,native.bonusSalt,player.id,1,tick),chance=Math.min(1,.5*(1+worldRare+.005*shrine)),events=[];
  native.killMonster(player,context,monster,tick,events);
  assert.equal(events.some(e=>e.kind==='bonus'),roll<chance);tokenCases++;
 }
 for(const upgrade of native.upgradeRecipes)for(const from of upgrade.from)for(const tier of rarityVariants(from))for(const plus of gearLevels(from)){
  const target=upgrade.to[upgrade.from.indexOf(from)];
  assert.equal(native.upgradeResult(upgrade,game.encode(game.withRarity(from,tier),plus)),game.encode(game.withRarity(target,tier),plus));upgradeEncodingCases++;
 }
 let count=0;
 function compare(state,monster){
  state.manual.simulationHours=1;state.manual.hotSetting='off';
  const {player,context,durationTicks}=createScenario(state,monster,{seed:314});
  const nativeContext={...context,world:native.world};
  const zone=native.world.zones.find(z=>z.monsterId===monster.id);
  let prepared;
  native.predict(player,nativeContext,p=>{prepared=p;return false;});
  assert.ok(native.startFight(prepared,nativeContext,zone.id));
  prepared.offlineCapTicks=durationTicks*2;
  const expected={kills:0,deaths:0,bySkill:{}};
  let elapsedTicks=0;
  do{
   elapsedTicks+=100;
   const report=questlessOffline(native,prepared,nativeContext,START_TICK+elapsedTicks);
   expected.kills+=report.kills;expected.deaths+=report.deaths;
   for(const [skill,{xp}]of Object.entries(report.skills))if(xp)expected.bySkill[skill]=(expected.bySkill[skill]??0)+xp;
  }while(elapsedTicks<durationTicks&&!expected.deaths&&prepared.route!==null);
  const actual=simulateMonster(state,monster,{seed:314});
  assert.deepEqual({kills:actual.kills,deaths:actual.deaths,bySkill:actual.bySkill},expected,`${state.style}: ${state.gear.weapon.id}: ${monster.name}`);
  assert.equal(actual.elapsedTicks,elapsedTicks);count++;
 }
 for(const style of ['melee','ranged','magic'])for(const monster of game.monsters)compare(preset(style),monster);
 for(const[id,style]of[[394,'melee'],[151,'ranged'],[629,'ranged'],[630,'ranged'],[631,'magic']])for(const tier of [0,4]){
  const state=preset(style);for(const k of Object.keys(state.levels))state.levels[k]=99;
  state.masteries.accuracy=13;state.gear.weapon={id,tier,plus:17};state.manual.foodPerTrip=5;
  if(style==='magic')for(const[slot,id]of[['helmet',632],['body',633],['legs',634],['shield',635]])state.gear[slot]={id,tier,plus:17};
  for(const monster of game.monsters)compare(state,monster);
 }
 for(const [style,weapon,helmet] of [['melee',884,881],['ranged',889,886],['magic',894,891]]){
  const state=preset(style);state.gear.weapon={id:weapon,tier:4,plus:40};state.gear.helmet={id:helmet,tier:4,plus:40};state.gear.earring={id:980,tier:4,plus:25};
  for(const monster of game.monsters)compare(state,monster);
 }
 let gearVariants=0;
 for(const id of [919,921,947,977]){
  const progress=game.unfinishedGear(id);
  for(const relics of [0,1,Math.min(2200,progress.relics)]){
   const encoded=game.encodeRelics(game.encode(game.withRarity(id,4),17),relics);
   assert.deepEqual(game.gear(encoded),native.gear(encoded));gearVariants++;
   if(relics===0){
    const source=game.gear(game.encode(game.withRarity(progress.from,4),17));
    assert.deepEqual(['accuracy','strength','defence'].map(key=>game.gear(encoded)[key]),['accuracy','strength','defence'].map(key=>source[key]));
   }
  }
 }
 for(const id of [629,630,631,632,633,634,635,881,884,904,980,989])for(const tier of rarityVariants(id))for(const plus of gearLevels(id)){
  const encoded=game.encode(game.withRarity(id,tier),plus);assert.deepEqual(game.gear(encoded),native.gear(encoded));gearVariants++;
 }
 let gatheringCount=0;
 for(const geared of [false,true])for(const job of gatheringJobs){
  const state=gatheringDefaults();state.skill=job.skill;state.levels[job.skill]=99;state.simulationHours=1;state.hotSetting='off';
  if(geared){
   const [slot,id,shield,outfit]={mining:['pickaxe',698,720,741],fishing:['rod',572,722,744],woodcutting:['axe',575,724,747],thieving:['gloves',718,728,753]}[job.skill];
   state.levels[job.skill]=105;state.gear[slot]={id,tier:4,plus:17};state.gear.shield={id:shield,tier:4,plus:17};
   for(const [index,part]of ['helmet','body','legs'].entries())state.gear[part]={id:outfit+index,tier:0,plus:0};
  }
  for(const site of game.world.sites.filter(site=>site.jobIds.includes(job.id))){
   const scenario=createGatheringScenario(state,job,site,{seed:314}),actual=simulateGatheringSite(state,job,site,{seed:314});
   let player;native.predict(scenario.player,scenario.context,p=>{player=p;return false;});player.offlineCapTicks=12000;
   assert.ok(native.startWork(player,scenario.context,site.id,job.id,'bank',null));
   const report=questlessOffline(native,player,scenario.context,START_TICK+6000);
   // Compare the sampled inventory; displayed rewards now use opportunity expectations.
   const expectedItems={...actual.sampleItems};if(actual.coins)expectedItems[game.coinItemId]=actual.coins;
   assert.deepEqual(expectedItems,report.itemsGained);assert.equal(actual.xp,report.skills[job.skill]?.xp??0);gatheringCount++;
  }
 }
 let craftingCount=0,upgradeCount=0;
 const state=craftingDefaults();state.hotSetting='off';for(const skill of Object.keys(state.levels))state.levels[skill]=105;
 for(const job of craftingJobs)for(const tier of craftingTiers(job)){
  const [slot,id,shield,outfit]={cooking:['pan',573,723,744],smithing:['hammer',699,721,741],fletching:['knife',576,725,747],herblore:['mortar',712,727,750],crafting:['needle',719,729,753]}[job.skill];
  state.gear[slot]={id,tier:4,plus:17};state.gear.shield={id:shield,tier:4,plus:17};
  for(const [index,part]of ['helmet','body','legs'].entries())state.gear[part]={id:outfit+index,tier:0,plus:0};
  const actual=simulateCrafting(state,job,tier,3,{seed:314});
  if(job.upgrade){
   const {player,context,site}=createCraftingScenario(state,job,tier,3,{seed:314});
   const before=player.skills[job.skill],from=game.withRarity(job.upgrade.from[0],tier);
   player.bank=craftingMaterials(job,tier,3);
   assert.ok(native.startUpgrade(player,context,job.upgrade.id,from,3));
   assert.equal(player.route.siteId,site.id);
   let completed=0,elapsed=0;
   while(completed<3&&elapsed<6000){
    const events=[];questlessTick(native,player,context,START_TICK+(++elapsed),events);
    completed+=events.filter(e=>e.kind==='produced'&&e.upgrade===job.upgrade.id).length;
   }
   assert.equal(completed,3);assert.equal(actual.elapsedTicks,elapsed);
   assert.equal(actual.xp,player.skills[job.skill]-before);
   assert.equal(player.bank[game.withRarity(job.output.itemId,tier)],3);upgradeCount++;
  }else{
   const scenario=createCraftingScenario(state,job,tier,3,{seed:314}),before=scenario.player.skills[job.skill];
   const report=questlessOffline(native,scenario.player,scenario.context,START_TICK+6000);
   assert.equal(actual.xp,scenario.player.skills[job.skill]-before);assert.deepEqual(actual.sampleItems,report.itemsGained);craftingCount++;
  }
 }
 let costs=0;for(const id of [629,630,631,632,633,634,635,881,884,904,980,989])for(const tier of rarityVariants(id))for(const plus of gearLevels(id)){
  const encoded=game.encode(game.withRarity(id,tier),plus);assert.deepEqual(game.enhanceCost(encoded),native.enhanceCost(encoded));costs++;
 }
 let enhancementCases=0;
 assert.equal(native.enhanceTicks,4);assert.equal(native.skillPetChance('enhancing'),1/3e6);
 const pityLimit=Math.ceil(native.enhanceRules.pityMaxLift/native.enhanceRules.pityStep);
 for(const item of enhanceableItems)for(const tier of rarityVariants(item.id))for(const [level,mastery,lectern,protect,useCore]of [[1,0,0,false,false],[99,200,7,true,true]]){
  const target=native.itemEnhancementLimit(item.id);
  const state={...enhancementDefaults(),itemId:item.id,tier,level,mastery,lectern,target,protect,useCore};
  const player={skills:{enhancing:game.levelXp(level)},masteries:{enhance:mastery},house:{lectern},houseFurniture:lectern?{lectern:{cell:0,slot:0}}:{},brews:{},lastTick:0};
  for(const step of enhancementSteps(state)){
   const id=game.withRarity(item.id,tier),withCore=useCore&&native.enhanceChance(player,step.from)<1;
   const cost=native.enhanceCost(game.encode(id,step.from),withCore);
   const chance=native.enhanceChance(player,step.from,withCore),protectedStep=protect&&step.from>=state.protectFrom;
   const chances=native.enhancePityActive(step.from)?Array.from({length:pityLimit+1},(_,failures)=>native.enhancePityChance(chance,failures)):[chance];
   assert.equal(step.chance,chances[0]);assert.deepEqual(step.chances,chances);
   assert.equal(step.failTo,native.enhanceProtectedFailTo(step.from,protectedStep));
   assert.deepEqual({gold:step.gold,shards:step.shards,essence:step.essence,core:step.core},cost);
   assert.equal(step.xp,native.enhanceXp(player,{windows:[]},0,id,step.from));enhancementCases++;
  }
 }
 const schedule=forecast(Date.UTC(2026,9,13));for(const entry of [schedule.current,...schedule.entries])assert.deepEqual(entry,native.hotSkill(entry.from));
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify({tokenCases,upgradeEncodingCases,predictions:count,gearVariants,gatheringSites:gatheringCount,craftingCases:craftingCount,upgradeCases:upgradeCount,enhancementCosts:costs,enhancementCases,forecastSlots:49})+'\n');
 console.log(`Token drops: ${tokenCases} seeded cases matched manual shrine/world probabilities; ${upgradeEncodingCases} upgrade encodings preserved rarity and enhancement.`);
 console.log(`Enhancing: ${enhancementCases} item/rarity/level/mastery/plus cases matched independent native chance, pity, rollback, costs and XP; duration and pet chance matched.`);
 console.log(`Other pages: ${gatheringCount} gathering sites, ${craftingCount} ordinary recipe/quality cases, ${upgradeCount} upgrade/quality cases, ${costs} enhancement costs and 49 forecast slots matched independent native code.`);
 console.log(`Native ${version} combat comparison: ${count}/${count} one-hour simulations matched independent offline reports; geometry, monsters and ${gearVariants} gear variants matched.`);
}finally{fs.rmSync(directory,{recursive:true});}
