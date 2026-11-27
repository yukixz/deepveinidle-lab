import {bossFeedRules as game} from './upstream.js';
import * as upstream from './upstream.js';
import {workStrideSpeed} from './work-config-effects.js';
import {characterMasteries} from './character-masteries.js';
import {validItemId} from './item-prices.js';
import {readWorldBuffs} from './world-buffs.js';

export const toolSlots = {
  mining:'pickaxe', smithing:'hammer', fishing:'rod', cooking:'pan',
  woodcutting:'axe', fletching:'knife', farming:'hoe', herblore:'mortar',
  thieving:'gloves', crafting:'needle',
};
const gathering = new Set(['mining','fishing','woodcutting','farming','thieving']);
const skills = Object.keys(toolSlots);
const toolSlotSet = new Set(Object.values(toolSlots));
export const sharedEquipmentSlots = ['shield','mount','helmet','body','legs','earring'];
const outfitSlots = new Set(['helmet','body','legs']);
export const potionKinds = ['gatherer','swift','elixir','bosskeeper'];
const slots = [...toolSlotSet, ...sharedEquipmentSlots];
const capPerk = key => game.perkList.find(perk => perk.id === key).ranks;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const isGatheringSkill = skill => gathering.has(skill);
export const masteryKeys = skill => ['xp', 'move', isGatheringSkill(skill) ? 'gather' : 'craft'];
export const roomsFor = names => game.rooms.filter(room => names.includes(room.bonus.skill));

function equipmentInSlot(slot, value) {
  if (!validItemId(value)) return false;
  const equipment = toolSlotSet.has(slot) || slot === 'mount' ? game.tool(value) : game.gear(value);
  if (equipment?.slot !== slot) return false;
  const base = game.decodeBase(value);
  if (upstream.itemEnhancement(value) > equipmentEnhancementLimit(base)) return false;
  if (slot === 'shield') return !!equipment.offhand;
  if (slot === 'earring') return base === upstream.earringIds.bosskeeper;
  if (outfitSlots.has(slot)) {
    if (slot === 'body' && base === upstream.packmasterCoatId) return true;
    return game.rawBosses.some(boss => game.outfitContribution({[slot]:value}, boss.key) > 0);
  }
  return true;
}

export function normalizeCharacter(raw = {}) {
  if (!object(raw)) raw = {};
  const levels = {}, equipment = {}, brews = {}, house = {}, masteries = {}, perks = {};
  for (const skill of skills) {
    levels[skill] = integer(raw.levels?.[skill], 1, game.maxLevel) ? raw.levels[skill] : 1;
    masteries[skill] = {};
    for (const key of masteryKeys(skill)) {
      const rank = raw.masteries?.[skill]?.[key];
      masteries[skill][key] = integer(rank, 0, game.masteryRankLimit) ? rank : 0;
    }
  }
  for (const slot of slots) {
    const value = raw.equipment?.[slot];
    equipment[slot] = equipmentInSlot(slot, value) ? value : null;
  }
  for (const kind of potionKinds) {
    const tier = raw.brews?.[kind];
    brews[kind] = integer(tier, -1, kind === 'bosskeeper' ? 0 : 4) ? tier : -1;
  }
  for (const room of roomsFor(skills)) {
    const value = raw.house?.[room.id];
    house[room.id] = integer(value, 0, room.maxLevel ?? game.houseLevelLimit) ? value : 0;
  }
  for (const key of ['pockets', 'quick']) {
    const rank = raw.perks?.[key];
    perks[key] = integer(rank, 0, capPerk(key)) ? rank : 0;
  }
  const capturedAt = validDate(raw.capturedAt) ? raw.capturedAt : null;
  const source = raw.source === 'lab' ? 'lab' : 'manual';
  return {
    version:1, capturedAt, source,
    measuredSkills: Array.isArray(raw.measuredSkills) ? skills.filter(k => raw.measuredSkills.includes(k)) : [],
    levels, equipment, brews, house, masteries, perks,
    guildXp:number(raw.guildXp, 0, 1e5) ? raw.guildXp : 0,
    worldXp:number(raw.worldXp, 0, 1e5) ? raw.worldXp : 0,
    blessing:raw.blessing === true,
    bossMarks: game.rawBosses.filter(boss => Array.isArray(raw.bossMarks) && raw.bossMarks.includes(boss.id)).map(boss => boss.id),
  };
}

export function createCharacterContext(input) {
  const config = normalizeCharacter(input);
  const actors = new Map();
  const actorFor = skill => {
    if (actors.has(skill)) return actors.get(skill);
    const actor = game.makePlayer(0, 'calculator', 240, 21, 0);
    for (const [name, level] of Object.entries(config.levels)) actor.skills[name] = game.levelXp(level);
    Object.assign(actor.equipment, config.equipment);
    Object.assign(actor.perks, config.perks);
    actor.masteries = {...config.masteries[skill]};
    actor.guildBonus = config.guildXp;
    actor.bossMarks = [...config.bossMarks];
    for (const [room, level] of Object.entries(config.house)) {
      if (!level) continue;
      actor.house[room] = level;
      // Native bonuses require the room to be placed. This synthetic actor has
      // already received the effective level, independently of map position.
      actor.houseFurniture[room] = {cell:0, slot:0};
    }
    actor.brews = {};
    actor.brewTier = {};
    actor.brewBuckets = {};
    for (const [kind, tier] of Object.entries(config.brews)) {
      if (tier < 0) continue;
      actor.brews[kind] = Number.MAX_SAFE_INTEGER;
      actor.brewTier[kind] = tier;
    }
    if (config.blessing) actor.brews.blessing = Number.MAX_SAFE_INTEGER;
    actors.set(skill, actor);
    return actor;
  };
  const workCharacter = (skill, {farmingFeed = false} = {}) => {
    const actor = actorFor(skill);
    let speedMultiplier = game.workSpeed(actor, skill).combined;
    if (farmingFeed && skill === 'farming') speedMultiplier *= 1 + game.sideSkillBonus(actor.equipment, skill);
    const strideSpeed = workStrideSpeed(actor);
    return {
      skills:{
        ...Object.fromEntries(Object.entries(config.levels).map(([name, level]) => [name, {level}])),
        [skill]:{level:config.levels[skill] ?? 1, speedMultiplier, failureMultiplier:1 - .03 * actor.perks.hands},
      },
      movement:{strideSpeed, capacity:game.inventoryCapacity(actor)},
    };
  };
  function summarize(skill) {
    const actor = actorFor(skill);
    const work = workCharacter(skill, {farmingFeed:true});
    const bundle = (base = false) => game.workXpMultiplier(actor, base, skill) +
      game.masteryMultiplier(actor.masteries, 'xp') - 1 + config.worldXp;
    return {...work.skills[skill], ...work.movement,
      productionSpeed:game.workSpeed(actor,skill).combined,
      rawXpMultiplier:bundle(true), processedXpMultiplier:bundle()};
  }
  return {actorFor, workCharacter, summarize, capturedAt:config.capturedAt, worldXp:config.worldXp};
}

function potionTier(player, kind) {
  if (!object(player.brews)) return undefined;
  const until = player.brews[kind] ?? 0;
  if (!integer(until)) return undefined;
  if (until <= player.lastTick) return -1;
  if (kind === 'bosskeeper') return 0;
  const buckets = player.brewBuckets?.[kind];
  if (buckets === undefined) return player.brewTier?.[kind] ?? 0;
  if (!Array.isArray(buckets) || buckets.length !== 5 || !buckets.every(value => integer(value))) return undefined;
  const elapsed = Math.max(0, player.lastTick - (until - buckets.reduce((total, ticks) => total + ticks, 0)));
  let sum = 0;
  for (let tier = 4; tier >= 0; tier--) if (elapsed < (sum += buckets[tier])) return tier;
  return undefined;
}

export function importLabCharacter(snapshot, previous, selectedSkills = skills, {sameAutomaticCapture = false} = {}) {
  const player = snapshot?.player;
  if (snapshot?.version !== 2 || !integer(snapshot.capturedAt, 1, Date.now() + 60000) ||
      !object(player) || !integer(player.lastTick) || !object(player.skills)) {
    throw new Error('invalidSnapshot');
  }
  const config = normalizeCharacter(previous);
  const warnings = [];
  let masteryFallback = false;
  const importedSkills = [];
  const assign = (label, valid, setter) => valid ? setter() : warnings.push(label);
  const usedSkills = selectedSkills.filter(name => skills.includes(name));
  const levelSkills = sameAutomaticCapture ? usedSkills : skills;
  for (const skill of levelSkills) {
    const xp = player.skills[skill];
    assign(`skills.${skill}`, number(xp), () => {
      config.levels[skill] = game.level(xp);
      importedSkills.push(skill);
    });
  }
  if (!sameAutomaticCapture) {
    for (const skill of skills) {
      const {ranks, source} = characterMasteries(player, skill);
      masteryFallback ||= Boolean(source.fallback);
      for (const key of masteryKeys(skill)) {
        const rank = ranks?.[key] ?? (object(ranks) ? 0 : undefined);
        assign(`masteries.${skill}.${key}`, integer(rank, 0, game.masteryRankLimit),
          () => config.masteries[skill][key] = rank);
      }
    }
  }
  for (const slot of [...usedSkills.map(skill => toolSlots[skill]), ...sharedEquipmentSlots]) {
    const value = player.equipment?.[slot];
    if (slot === 'earring' && value === undefined) continue;
    const eligible = equipmentInSlot(slot, value);
    const unrelated = (slot === 'shield' || slot === 'earring' || outfitSlots.has(slot)) &&
      validItemId(value) && game.gear(value)?.slot === slot &&
      upstream.itemEnhancement(value) <= equipmentEnhancementLimit(game.decodeBase(value));
    assign(`equipment.${slot}`, value === null || eligible || unrelated, () => config.equipment[slot] = eligible ? value : null);
  }
  for (const kind of potionKinds) {
    const value = potionTier(player, kind);
    assign(`brews.${kind}`, integer(value, -1, 4), () => config.brews[kind] = value);
  }
  for (const room of roomsFor(usedSkills)) {
    const placed = player.houseFurniture?.[room.id];
    const value = object(placed) ? player.house?.[room.id] ?? 0 : 0;
    assign(`house.${room.id}`, object(player.house) && object(player.houseFurniture) &&
      integer(value, 0, room.maxLevel ?? game.houseLevelLimit), () => config.house[room.id] = value);
  }
  for (const key of ['pockets','quick']) {
    const value = player.perks?.[key] ?? (object(player.perks) ? 0 : undefined);
    assign(`perks.${key}`, integer(value, 0, capPerk(key)), () => config.perks[key] = value);
  }
  assign('guildBonus', number(player.guildBonus, 0, 1e5), () => config.guildXp = player.guildBonus);
  const blessing = player.brews?.blessing ?? 0;
  assign('blessing', object(player.brews) && integer(blessing), () => config.blessing = blessing > player.lastTick);
  const world = readWorldBuffs(snapshot);
  config.worldXp = world.weeklyXp / 100;
  if (world.warning) warnings.push(world.warning);
  assign('bossMarks', Array.isArray(player.bossMarks) && player.bossMarks.every(mark => integer(mark)),
    () => config.bossMarks = game.rawBosses.filter(boss => player.bossMarks.includes(boss.id)).map(boss => boss.id));

  if (!importedSkills.length) throw new Error('incompleteSnapshot');
  config.measuredSkills = importedSkills;
  config.source = 'lab';
  config.capturedAt = new Date(snapshot.capturedAt).toISOString();
  return {config, warnings:[...new Set(warnings)], masteryFallback};
}

export function characterEquipmentOptions(slot) {
  return game.itemList.filter(item => game.decodeBase(item.id) === item.id && equipmentInSlot(slot, item.id));
}

export function validEquipmentTiers(base) {
  if (!base) return [0];
  return [0,1,2,3,4].filter(tier => {
    try {
      return game.item(game.withRarity(base, tier)).id === game.withRarity(base, tier);
    } catch {
      return false;
    }
  });
}

export const characterLimits = {
  level:game.maxLevel, mastery:game.masteryRankLimit, house:game.houseLevelLimit,
  enhancement:game.maxEnhancement, pockets:capPerk('pockets'), quick:capPerk('quick'),
};
export const encodeEquipment = (id, tier, plus) => id ? game.encode(game.withRarity(id, tier), plus) : null;
export const decodeEquipment = id => id ? {
  base:game.decodeBase(id), tier:game.tier(id), plus:Math.floor(id / game.encode(0, 1)),
} : {base:0, tier:0, plus:0};
export const equipmentCanEnhance = id => !!id && game.canEnhance(id);
export const equipmentEnhancementLimit = id => equipmentCanEnhance(id) ? upstream.itemEnhancementLimit(id) : 0;
