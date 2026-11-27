import assert from 'node:assert/strict';
import test from 'node:test';
import {bossList,calculateRows,estimateRoutes,gameVersion,refreshRouteQuotes,valueRoutes} from '../src/boss-feed-model.js';
import {importLabCharacter,normalizeCharacter} from '../src/boss-feed-character.js';
import {parseMarketPrices} from '../src/market-import.js';
import {priceDefaults} from '../src/item-prices.js';
import {createPriceSnapshot} from '../src/price-protocol.js';
import {readFile} from 'node:fs/promises';
import {bossWorkTimeGame,levelXp} from '../src/upstream.js';

const priceSnapshot = createPriceSnapshot({
  ...priceDefaults(),
  quotes:parseMarketPrices({
    game:'Deep Vein Idle', generatedAt:new Date().toISOString(), refreshSeconds:60,
    items:{
      5:{lowestSell:810, highestBuy:700, avg7d:770, sellQty:1_390_000},
      1008:{lowestSell:630, highestBuy:420, avg7d:500, sellQty:0},
      2008:{lowestSell:8500, avg7d:8500, sellQty:42_000},
      4008:{lowestSell:null},
      2044:{lowestSell:16_000, avg7d:16_000, sellQty:20},
    },
  }).quotes,
  prices:{
    5:{price:900},1008:{price:1,locked:true},2008:{price:8500},2044:{price:16_000},3008:{price:0,locked:true},
  },
});
const character = {
  levels:Object.fromEntries(bossList.flatMap(boss => boss.skills.map(skill => [skill,105]))),
  perks:{pockets:3},
  masteries:{mining:{move:20,gather:20},smithing:{xp:20,craft:20}},
};
const compare = (options = {}) => calculateRows({
  bossId:0, config:character, priceSnapshot, dailyProfit:150_000_000, ...options,
});
const find = (rows, itemId, kind) => rows.find(row => row.itemId === itemId && row.kind === kind);

test('uses locked prices or seven-day averages independently of market quantities', () => {
  const rows = compare();
  const ore = find(rows,1008,'buy');
  assert.equal(ore.materials[0].unitPrice,1);
  assert.equal(ore.materialGold,ore.quantity);
  assert.equal(ore.supply,0);
  const free = find(rows,3008,'buy');
  assert.equal(free.materialGold,0);
  assert.equal(free.supply,null);
  const unpriced = find(rows,4008,'buy');
  assert.equal(unpriced.materialGold,null);
  assert.equal(unpriced.supply,0);
  const bar = find(rows,2044,'craft');
  assert.equal(bar.supply,42_000);
  assert.equal(find(rows,2044,'buy').supply,20);
});

test('material source reprices direct purchases and recipe inputs without changing supply or time',()=>{
  const original = compare();
  const ask = compare({materialSource:'sellPrice'});
  const bid = compare({materialSource:'buyPrice'});
  const vendor = compare({materialSource:'vendorPrice'});
  const free = compare({materialSource:'none'});
  assert.equal(find(ask,5,'buy').materials[0].unitPrice,810);
  assert.equal(find(bid,5,'buy').materials[0].unitPrice,700);
  assert.ok(Number.isFinite(find(vendor,5,'buy').materials[0].unitPrice));
  assert.equal(find(ask,1008,'buy').materials[0].unitPrice,1);
  assert.equal(find(free,1008,'buy').materialGold,0);
  assert.equal(find(bid,2044,'craft').materialGold,null);
  assert.equal(find(ask,2044,'craft').supply,find(original,2044,'craft').supply);
  assert.equal(find(free,2044,'craft').totalSeconds,find(original,2044,'craft').totalSeconds);
});

test('uses the Lab upstream provenance and both work-time estimates', async () => {
  const manifest = JSON.parse(await readFile(new URL('../vendor/manifest.json',import.meta.url),'utf8'));
  assert.equal(gameVersion,manifest.changelogVersion);
  assert.equal(bossWorkTimeGame.source.sha256,manifest.sha256);
  assert.equal(bossWorkTimeGame.source.sourceUrl,manifest.sourceUrl);
  const rows = compare();
  const ore = find(rows,1008,'buy');
  const bar = find(rows,2044,'craft');
  assert.ok(ore.feedWorkSecondsPerItem > 0 && ore.feedLogisticsSecondsPerItem > 0);
  assert.ok(bar.craftSeconds > 0 && bar.craftXp > 0);
  assert.ok(bar.chests >= 100);
  assert.ok(Math.abs(bar.totalGold - (bar.materialGold + bar.totalSeconds * (150_000_000 / 86400))) < 1e-7);
  const adjusted = find(compare({settings:{fire:false,chargeCraftTime:false}}),2044,'craft');
  assert.equal(adjusted.feedSeconds,bar.feedSeconds);
  assert.equal(adjusted.countedSeconds,adjusted.feedSeconds);
  assert.equal(adjusted.craftSeconds,bar.craftSeconds);
  assert.ok(adjusted.xpPerItem < bar.xpPerItem);
});

test('revalues existing route estimates with current quotes and time charges', () => {
  const {routes,materialIds} = estimateRoutes({bossId:0,config:character});
  const quotes = refreshRouteQuotes(materialIds,priceSnapshot);
  const repriced = {
    getItem(id) {
      const item = priceSnapshot.getItem(id);
      return id === 1008 ? {...item,price:500,sellQuantity:31} : item;
    },
  };
  const currentQuotes = refreshRouteQuotes(materialIds,repriced,quotes);
  assert.equal(refreshRouteQuotes(materialIds,{getItem:repriced.getItem},currentQuotes),currentQuotes);
  const rows = valueRoutes(routes,currentQuotes,{dailyProfit:86400,chargeCraftTime:false});
  const ore = find(rows,1008,'buy');
  assert.equal(ore.supply,31);
  assert.equal(ore.materialGold,500 * ore.quantity);
  const original = find(routes,2044,'craft');
  const bar = find(rows,2044,'craft');
  assert.equal(bar.craftSeconds,original.craftSeconds);
  assert.equal(bar.totalSeconds,original.totalSeconds);
  assert.equal(bar.opportunityGold,original.feedSeconds);
  assert.deepEqual(bar.xpBySkill,original.xpBySkill);
});

test('covers the five skill pairings, existing direct-buy variants and universal boss essence', () => {
  assert.equal(bossList.length,5);
  let count = 0;
  for (const boss of bossList) {
    const rows = compare({bossId:boss.id,settings:{strategy:'buy'}});
    assert.equal(new Set(rows.map(row => row.itemId)).size,rows.length);
    const essence = find(rows,778,'buy');
    assert.ok(essence);
    assert.equal(essence.xpPerItem,0);
    assert.equal(essence.feedSecondsPerItem,.51);
    assert.deepEqual(new Set(rows.filter(row => row.itemId !== 778).map(row => row.skill)),new Set(boss.skills));
    assert.ok(rows.every(row => row.status === 'ok' && row.feedSecondsPerItem > 0));
    count += rows.length;
  }
  assert.equal(count,565);
});

test('Bosskeeper effects stack and tonic doses enter purchase cost', () => {
  const base = find(compare(),1008,'buy');
  const config = {...character,equipment:{...character.equipment,earring:254988},brews:{...character.brews,bosskeeper:0}};
  const noQuote = find(compare({config}),1008,'buy');
  const pricedTonic = createPriceSnapshot({...priceDefaults(),prices:{1008:{price:1,locked:true},990:{price:100,locked:true}}});
  const boosted = find(compare({config,priceSnapshot:pricedTonic}),1008,'buy');
  assert.ok(Math.abs(boosted.points/base.points-1.4)<1e-12);
  assert.equal(noQuote.materialGold,null);
  const tonic = boosted.materials.find(item => item.id === 990);
  assert.equal(tonic.quantity,Math.ceil(boosted.feedSeconds/3600));
  assert.equal(boosted.materialGold,boosted.materials.reduce((sum,item) => sum+item.quantity*item.unitPrice,0));
});

test('imports active Bosskeeper tonic, earring and Packmaster coat without dropping enhancements', () => {
  const snapshot = {version:2,capturedAt:Date.now(),player:{lastTick:10,skills:{mining:levelXp(100)},
    equipment:{earring:254988,body:254989},brews:{bosskeeper:11}}};
  const {config} = importLabCharacter(snapshot,character,['mining']);
  assert.equal(config.equipment.earring,254988);
  assert.equal(config.equipment.body,254989);
  assert.equal(config.brews.bosskeeper,0);
  const expired = importLabCharacter({...snapshot,player:{...snapshot.player,lastTick:11}},config,['mining']);
  assert.equal(expired.config.brews.bosskeeper,-1);
});

test('imports other boss levels, both bound mastery pages and active world XP', () => {
  const capturedAt = Date.now();
  const snapshot = {version:2,capturedAt,worldTick:10,worldBuffsVersion:1,
    worldBuffs:[{fromTick:5,toTick:10,xpMult:1.25},{fromTick:11,toTick:20,xpMult:2}],
    player:{lastTick:10,skills:{mining:1000,smithing:2000,fishing:levelXp(93)},masteryPage:1,
      masterySkills:{mining:1,smithing:2,cooking:2},masteries:{move:3,gather:8},masteryAway:{2:{xp:11,craft:19}}},
  };
  const previous = {...character,levels:{...character.levels,cooking:73}};
  const result = importLabCharacter(snapshot,previous,['mining','smithing']);
  assert.equal(result.config.levels.fishing,93);
  assert.equal(result.config.levels.cooking,73);
  assert.ok(result.warnings.includes('skills.cooking'));
  assert.deepEqual(result.config.masteries.mining,{xp:0,move:3,gather:8});
  assert.deepEqual(result.config.masteries.smithing,{xp:11,move:0,craft:19});
  assert.deepEqual(result.config.masteries.fishing,{xp:0,move:3,gather:8});
  assert.deepEqual(result.config.masteries.cooking,{xp:11,move:0,craft:19});
  assert.equal(result.config.worldXp,.25);
});

test('rejects out-of-range imported equipment and preserves the previous tool', () => {
  const previous = normalizeCharacter({...character,equipment:{pickaxe:4084}});
  const snapshot = {version:2,capturedAt:Date.now(),
    player:{lastTick:10,skills:{mining:1000},equipment:{pickaxe:70_084_084}},
  };
  const result = importLabCharacter(snapshot,previous,['mining']);
  assert.equal(result.config.equipment.pickaxe,4084);
  assert.ok(result.warnings.includes('equipment.pickaxe'));
});
