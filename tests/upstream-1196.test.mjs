import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/upstream.js';
import {craftingDefaults,craftingJobs,craftingTiers,craftingMaterials} from '../src/crafting-model.js';
import {createCraftingScenario,simulateCrafting} from '../src/crafting-simulation.js';
import {validItemId,itemFamily,priceDefaults,setItemPrice,valuationPrice} from '../src/item-prices.js';
import {translatedName} from '../src/i18n.js';
import {createScenario,simulationTick} from '../src/simulation.js';

const fireworks=craftingJobs.filter(j=>Number(j.id)>=420&&Number(j.id)<=424);
test('Reviewed item and recipe catalogues retain the Moon box and filter ordinary crafting',()=>{
 assert.equal(game.items.length,2113);assert.equal(game.recipes.length,241);
 assert.equal(game.item(397).name,'Moon box');assert.equal(game.vendorPrice(397),10);assert.equal(game.marketFamily(397),'valuables');
 assert.equal(craftingJobs.filter(j=>!j.upgrade).length,191);
 assert.equal(game.upgradeRecipes.length,74);assert.equal(craftingJobs.filter(j=>j.upgrade).length,27);
});

test('1196 fireworks preserve native inputs, output quantity and supported rarities',()=>{
 assert.equal(fireworks.length,5);
 const state=craftingDefaults();state.levels.crafting=99;state.hotSetting='off';
 for(const job of fireworks){
  assert.deepEqual(craftingTiers(job),job.id===421?[0]:[0,1,2,3,4]);
  assert.equal(job.output.qty,1);
  for(const tier of craftingTiers(job)){
   const inputs=craftingMaterials(job,tier,3),result=simulateCrafting(state,job,tier,3,{seed:314});
   assert.equal(inputs[700],job.id===423?6:job.id===424?9:3);
   assert.equal(result.complete,true);assert.deepEqual(result.consumed,inputs);
   assert.equal(result.items[game.recipeOutput(job,tier)],3);
   assert.equal(result.sampleItems[game.recipeOutput(job,tier)],3);
  }
 }
 for(const tier of [1,2,3,4]){
  const job=fireworks[1];assert.throws(()=>craftingMaterials(job,tier,1),/invalidQuantity/);
 }
});
test('1196 rockets support pricing and translations; powder has no invented market or vendor sell price',()=>{
 let prices=priceDefaults();
 for(const job of fireworks)for(const tier of craftingTiers(job)){
  const id=game.recipeOutput(job,tier);assert.equal(validItemId(id),true);assert.equal(itemFamily(id),'valuables');
  assert.equal(game.canSell(id),true);assert.equal(game.vendorPrice(id),1);
  prices=setItemPrice(prices,id,12);assert.equal(valuationPrice(id,prices.prices).price,12);
  assert.notEqual(translatedName(job.name,'zh'),job.name);
 }
 assert.equal(game.canSell(700),false);assert.equal(itemFamily(700),null);
 assert.equal(valuationPrice(700,{}).fallback,true);
 prices=setItemPrice(prices,700,50);assert.equal(valuationPrice(700,prices.prices).price,50);
 assert.equal(translatedName('Fireworks','zh'),'烟花');
});
test('1196 fireworks stay out of native collection catalogue and points',()=>{
 for(const id of [701,702,703,704,705]){
  assert.equal(game.collectionExcluded(id),true);
  assert.equal(game.collectionItems.has(id),false);
 }
 assert.equal(game.masteryEarnedPoints({collections:{701:10000000},forgeLog:{}}),0);
});
test('timed upgrade keeps the base gear rarity and enhancement',()=>{
 const job=game.upgradeRecipes.find(j=>j.to.includes(629));assert.ok(job);
 const state=craftingDefaults();state.levels[job.skill]=99;const {player,context}=createCraftingScenario(state,craftingJobs.find(j=>j.upgrade?.id===job.id),4,1);
 const from=game.encode(game.withRarity(job.from[0],4),7),to=game.upgradeResult(job,from);
 player.bank={[from]:1,...Object.fromEntries(game.upgradeMaterials(job,from).named.map(i=>[i.itemId,i.qty]))};
 assert.ok(game.startUpgrade(player,context,job.id,from,1));
 for(let tick=player.lastTick+1,end=tick+6000;tick<end&&player.route;tick++)simulationTick(player,context,tick,[]);
 assert.equal(player.bank[to],1);
 assert.equal(to,game.encode(game.withRarity(629,4),7));
 assert.equal(game.collectionItems.has(629),true);
});
test('1196 predictor preserves remaining potion time and resets synthetic quests and pack',()=>{
 const {player,context}=createScenario({});player.lastTick=2222222;
 player.brews={elixir:player.lastTick+17,swift:player.lastTick-1};player.pack=[{itemId:1,qty:3}];
 player.quests={day:-1,week:-1,daily:[{id:'foreign'}],weekly:[{id:'foreign'}]};
 let prepared;game.predict(player,context,p=>{prepared=p;return false;});
 assert.equal(prepared.lastTick,game.predictionStartTick);assert.equal(prepared.brews.elixir,game.predictionStartTick+17);assert.equal(prepared.brews.swift,0);
 assert.deepEqual(prepared.pack,[]);assert.deepEqual(prepared.quests,{day:game.questDay(prepared.lastTick),week:game.questWeek(prepared.lastTick),daily:[],weekly:[]});
 assert.equal(player.lastTick,2222222);assert.equal(player.pack.length,1);
});
