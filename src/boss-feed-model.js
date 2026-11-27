import {createWorkTimeEngine} from '../vendor/work-time/index.js';
import * as game from './upstream.js';
import {translatedName} from './i18n.js';
import {createCharacterContext} from './boss-feed-character.js';
import {batchQuantity, goldCost, marketSupply, procurementGold, quote} from './boss-feed-economics.js';

export const rarityCount = 5;
const {bossWorkTimeGame:gameFile,bossFeedRules:native} = game;
const bossLabels = {heart:'熔炉之心', kraken:'海妖', colony:'菌群', blight:'枯萎之花', siege:'围城'};
export const bossList = native.rawBosses.map(boss => ({...boss, label:bossLabels[boss.key] ?? boss.name}));
export const gameSource = gameFile.source;
export const gameVersion = gameSource.sourceVersion;

const engine = createWorkTimeEngine(gameFile);
const singleRecipes = new Map();
for (const recipe of gameFile.recipes) {
  if (recipe.inputs.length && !recipe.retired && !singleRecipes.has(recipe.output.itemId)) {
    singleRecipes.set(recipe.output.itemId, recipe);
  }
}

const isKnown = value => Number.isFinite(value) && value >= 0;
const itemName = id => {
  const item = native.item(native.decodeBase(Number(id)));
  return translatedName(item.name,'zh');
};
function xpContext(actor, worldXp) {
  return {hypothetical:true, windows:[{fromTick:actor.lastTick, toTick:actor.lastTick, xpMult:1 + worldXp}]};
}

function material(id, quantity) {
  const itemId = Number(id);
  return {id:itemId, name:itemName(itemId), englishName:native.item(native.decodeBase(itemId)).name,
    quality:native.tier(itemId), quantity};
}

function prep({recipe, quality, quantity, character}) {
  if (quantity === null) return {materials:[], seconds:null, xp:null, reason:'craftQuantity'};
  const actor = character.actorFor(recipe.skill);
  const options = {character:character.workCharacter(recipe.skill), task:{jobId:recipe.id, tier:quality, quantity}};
  const result = engine.estimateTaskTime(options);
  const materials = Object.entries(result.materials ?? {}).map(([id, count]) => material(id, count));
  const products = result.products?.[gameFile.withRarity(recipe.output.itemId, quality)];
  const xp = actor && isKnown(products) ? native.productionXp(actor, xpContext(actor, character.worldXp),
    recipe, quality, actor.lastTick, false) * products / recipe.output.qty : null;
  const savesMaterials = actor && native.materialSavingSkill(native.equippedSkillTool(actor, recipe.skill)) === recipe.skill;
  return {materials, seconds:result.seconds ?? null, xp, note:savesMaterials ? 'regularRecipe' : null,
    reason:result.status === 'ok' ? null : result.reason ?? result.status,
    levelTooLow:result.status === 'levelTooLow'};
}

function feedPoints(boss,actor,itemId) {
  const basePoints = native.pointsBase(itemId);
  return actor && basePoints > 0 ? basePoints * (actor.bossMarks.includes(boss.id) ? native.markMultiplier : 1)
    * (1 + native.contributionBonus(actor,boss,actor.lastTick)) : null;
}

function feed({boss, category, base, itemId, character, settings}) {
  const skill = category.skill;
  const actor = character.actorFor(skill);
  const workCharacter = character.workCharacter(skill, {farmingFeed:native.feedUsesFarmingSpeed(base)});
  const recipe = native.feedRecipe(base);
  const level = workCharacter?.skills?.[skill]?.level;
  const levels = boss.skills.map(key => workCharacter?.skills?.[key]?.level);
  const bossUnlocked = levels.some(value => value >= gameFile.bossUnlockLevel);
  const low = (isKnown(level) && level < recipe?.levelReq)
    || (levels.every(isKnown) && !bossUnlocked);
  const points = feedPoints(boss,actor,itemId);
  const {quantity, chests} = batchQuantity(native.chestThreshold(boss), points);
  const xpPerItem = recipe && actor ? native.feedXp(actor, xpContext(actor, character.worldXp), itemId, skill,
    actor.lastTick, settings.fire) : null;
  const rate = engine.estimateBossFeedRate({character:workCharacter, task:{bossId:boss.id, itemId}});
  const {secondsPerItem:feedSecondsPerItem} = rate;
  return {points, quantity, chests, xpPerItem,
    feedSecondsPerItem, feedSeconds:feedSecondsPerItem !== null && quantity !== null ? feedSecondsPerItem * quantity : null,
    feedWorkSecondsPerItem:rate.feedSecondsPerItem, feedLogisticsSecondsPerItem:rate.logisticsSecondsPerItem,
    status:low ? 'levelTooLow' : rate.status === 'ineligibleItem' ? 'ineligible' : feedSecondsPerItem === null ? 'unknown' : 'ok',
    reason:low ? (level < recipe?.levelReq ? 'feedLevel' : 'bossLevel')
      : rate.status === 'ineligibleItem' ? 'ineligibleItem' : feedSecondsPerItem === null ? rate.reason ?? 'feedTime' : null,
    requiredLevel:level < recipe?.levelReq ? recipe.levelReq : gameFile.bossUnlockLevel,
  };
}

function essenceFeed(boss,character) {
  const itemId = native.essenceItemId;
  const actor = character.actorFor(boss.skills[0]);
  const points = feedPoints(boss,actor,itemId);
  const {quantity,chests} = batchQuantity(native.chestThreshold(boss),points);
  const unlocked = boss.skills.some(skill => native.level(actor.skills[skill]) >= gameFile.bossUnlockLevel);
  const feedSecondsPerItem = unlocked ? gameFile.tickMs/1000/native.essenceItemsPerTick(actor,itemId) : null;
  return {itemId,name:itemName(itemId),englishName:native.item(itemId).name,quality:0,skill:null,category:'essence',
    bossSkills:boss.skills,points,quantity,chests,xpPerItem:0,feedSecondsPerItem,
    feedWorkSecondsPerItem:feedSecondsPerItem,feedLogisticsSecondsPerItem:unlocked ? 0 : null,
    feedSeconds:unlocked && quantity !== null ? feedSecondsPerItem * quantity : null,
    status:unlocked ? 'ok' : 'levelTooLow',reason:unlocked ? null : 'bossLevel',requiredLevel:gameFile.bossUnlockLevel};
}

function rowFor(baseRow, production) {
  const {materials, seconds:craftSeconds} = production;
  const xpBySkill = Object.fromEntries(baseRow.bossSkills.map(skill => [skill, 0]));
  if (baseRow.skill !== null) xpBySkill[baseRow.skill] = baseRow.xpPerItem !== null && baseRow.quantity !== null
    ? baseRow.xpPerItem * baseRow.quantity : null;
  if (production.skill) {
    const previous = Object.hasOwn(xpBySkill, production.skill) ? xpBySkill[production.skill] : 0;
    xpBySkill[production.skill] = previous !== null && production.xp !== null ? previous + production.xp : null;
  }
  return {...baseRow, kind:production.kind, key:`${baseRow.itemId}:${production.kind}`,materials,
    craftSeconds, craftXp:production.xp, craftSkill:production.skill, xpBySkill,
    totalSeconds:craftSeconds !== null && baseRow.feedSeconds !== null ? craftSeconds + baseRow.feedSeconds : null,
    status:production.levelTooLow ? 'levelTooLow' : baseRow.status === 'ok' && production.reason ? 'unknown' : baseRow.status,
    reason:baseRow.reason ?? production.reason ?? null,
    note:production.note ?? null,
  };
}

export function estimateRoutes({bossId, config, settings = {}}) {
  const routes = [], materialIds = new Set();
  const boss = bossList.find(entry => entry.id === Number(bossId));
  if (!boss) return {routes,materialIds};
  const options = {fire:true, strategy:'both', skills:boss.skills, ...settings};
  const character = createCharacterContext(config);
  for (const category of boss.classes) {
    if (!options.skills.includes(category.skill)) continue;
    for (const base of category.items) {
      const recipe = singleRecipes.get(base);
      const englishName = native.item(base).name;
      const name = itemName(base);
      const maxQuality = gameFile.itemSupportsRarity(base) ? rarityCount - 1 : 0;
      for (let quality = 0; quality <= maxQuality; quality++) {
        const itemId = gameFile.withRarity(base, quality);
        const result = feed({boss, category, base, itemId, character, settings:options});
        const baseRow = {itemId, name, englishName, quality, skill:category.skill, category:category.cls,
          bossSkills:boss.skills, ...result};
        if (options.strategy !== 'craft') {
          const buy = {kind:'buy', materials:[material(itemId, result.quantity)], seconds:0, xp:0};
          routes.push(rowFor(baseRow, buy));
        }
        if (recipe && options.strategy !== 'buy') {
          const craft = prep({recipe, quality, quantity:result.quantity, character});
          routes.push(rowFor(baseRow, {...craft, kind:'craft', skill:recipe.skill}));
        }
      }
    }
  }
  if (options.strategy !== 'craft') {
    const row = essenceFeed(boss,character);
    routes.push(rowFor(row,{kind:'buy',materials:[material(row.itemId,row.quantity)],seconds:0,xp:0}));
  }
  if (character.actorFor(boss.skills[0]).brews.bosskeeper) for (const route of routes) {
    route.materials.push(material(game.bosskeeperTonicId,route.feedSeconds === null ? null : Math.ceil(route.feedSeconds/3600)));
  }
  for (const route of routes) for (const {id} of route.materials) materialIds.add(id);
  return {routes,materialIds};
}

export function refreshRouteQuotes(materialIds, priceSnapshot, previousQuotes, materialSource = 'avg7d') {
  const quotes = new Map();
  let unchanged = previousQuotes?.size === materialIds.size;
  for (const id of materialIds) {
    const latest = quote(priceSnapshot,id,materialSource);
    quotes.set(id,latest);
    const previous = previousQuotes?.get(id);
    unchanged &&= previous?.unitPrice === latest.unitPrice && previous?.sellQty === latest.sellQty;
  }
  return unchanged ? previousQuotes : quotes;
}

export function valueRoutes(routes, quotes, {dailyProfit = 0, chargeCraftTime = true} = {}) {
  return routes.map(route => {
    const materials = route.materials.map(row => ({...row,...quotes.get(row.id)}));
    const materialGold = materials.length ? procurementGold(materials) : null;
    const {supply,limitingIds} = route.kind === 'buy' ? {supply:materials[0]?.sellQty ?? null, limitingIds:[]}
      : marketSupply(materials.filter(row => row.id !== game.bosskeeperTonicId),route.quantity);
    const costs = goldCost({materialGold,feedSeconds:route.feedSeconds,craftSeconds:route.craftSeconds,dailyProfit,
      chargeCraftTime:route.kind === 'craft' && chargeCraftTime});
    for (const row of materials) row.limiting = limitingIds.includes(row.id);
    return {...route,...costs,materials,materialGold,supply,
      reason:route.reason ?? (materialGold === null ? 'missingPrice' : null)};
  });
}

export function calculateRows({priceSnapshot = null, dailyProfit = 0, materialSource = 'avg7d', ...options}) {
  const {routes,materialIds} = estimateRoutes(options);
  const quotes = refreshRouteQuotes(materialIds,priceSnapshot,undefined,materialSource);
  return valueRoutes(routes,quotes,{dailyProfit,chargeCraftTime:options.settings?.chargeCraftTime});
}
