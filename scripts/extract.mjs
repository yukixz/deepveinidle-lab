import fs from 'node:fs';
import crypto from 'node:crypto';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';

// Select upstream declarations by semantic signature; preserve their source verbatim.
const sourceInfo={"sourceUrl":"https://deepveinidle.com/assets/index-BiCDjiFc.js","retrieved":"2026-11-27","changelogVersion":"1.0.1228","sha256":"c600e5c33615ceb8c6c7f179e6e368b935ec09b36ca60d4c1815b3690f96343b"};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
// Reviewed public build mappings; the source hash guards every symbol.
const exportsMap={
  "features": "se",
  "skillOutfits": "_g",
  "outfitXpBonus": "kxo",
  "skillOffhandBonus": "$8",
  "houseLevelLimit": "oH",
  "questDay": "ub",
  "questWeek": "$oo",
  "monsters": "Il",
  "equipment": "TM",
  "items": "mc",
  "marketCategories": "bf",
  "marketFamilies": "hZ",
  "marketFamily": "C8",
  "gear": "as",
  "item": "ie",
  "canSell": "Ti",
  "canTradeItem": "ii",
  "vendorPrice": "am",
  "encode": "Un",
  "withRarity": "Te",
  "levelXp": "os",
  "level": "Ge",
  "maxLevel": "dm",
  "accuracy": "by",
  "maxHit": "el",
  "evasion": "wc",
  "hitChance": "uh",
  "magic": "ih",
  "style": "fh",
  "attackTicks": "l0",
  "maxHp": "Xa",
  "equipmentSlots": "Au",
  "masteries": "bg",
  "rooms": "bs",
  "foodBuff": "hv",
  "preferredBankFood": "pY",
  "cropDuration": "Nlo",
  "isCrop": "eoo",
  "damageReduction": "$Oo",
  "brewScale": "In",
  "warriorAccuracyBonus": "yHo",
  "warriorMaxHitBonus": "XZ",
  "nourishHealingBonus": "UZ",
  "hasteAttackSpeedBonus": "_Z",
  "combine": "ui",
  "bosses": "zg",
  "bossStats": "Lxo",
  "bossWeakMultiplier": "D9o",
  "bossOtherMultiplier": "T9o",
  "tickMs": "kM",
  "strength": "yzo",
  "armour": "qYo",
  "magicDefenceScale": "sq",
  "maxEnhancement": "sh",
  "potions": "bd",
  "recipes": "xe",
  "translations": "iB",
  "worldTranslations": "Ehe",
  "uiTranslations": "fhe",
  "homeTranslations": "phe",
  "houseBonus": "gm",
  "houseDamageCap": "$Yo",
  "masteryRankLimit": "Xl",
  "masteryRankCost": "Jd",
  "masteryTotalCost": "gjo",
  "masteriesTotalCost": "fw",
  "masteryEarnedPoints": "U1",
  "collectionPoints": "cYo",
  "collectionItems": "a0",
  "combatTick": "Wzo",
  "killMonster": "Gzo",
  "combatRarityMultiplier": "Yzo",
  "rarityThresholds": "tr",
  "mountRarityThresholds": "ag",
  "mountChance": "z_o",
  "baseAttackTicks": "rh",
  "combatPetChance": "IM",
  "combatPetItem": "dSo",
  "isPet": "gi",
  "voidShardChance": "Szo",
  "voidShardQuantity": "Hzo",
  "voidShardItemId": "pc",
  "mountItemId": "Sg",
  "abyssalGoldBonus": "VZ",
  "baseItemId": "io",
  "itemTier": "ee",
  "coinItemId": "ks",
  "hotSkill": "OT",
  "masteryOfflineBaseHours": "lH",
  "predict": "pS",
  "offline": "Hq",
  "tick": "HMo",
  "world": "X",
  "startFight": "Sv",
  "resetActivity": "ls",
  "depositPack": "Loo",
  "homeBank": "AY",
  "combatTargetTile": "Ete",
  "nearbyTile": "Ts",
  "predictionStartTick": "Bx",
  "predictionChunkTicks": "KD",
  "allSkills": "ca",
  "createContext": "clo",
  "fullFoodLoad": "Mf",
  "perks": "zB",
  "hotXp": "bSo",
  "hotRare": "wSo",
  "tools": "Rro",
  "tool": "Rr",
  "toolLuck": "Ug",
  "equipmentLuck": "hk",
  "brewRarityMultiplier": "Zeo",
  "houseRarityMultiplier": "s5",
  "masteryMultiplier": "an",
  "mountSpeed": "dD",
  "randomFloat": "js",
  "canEnhance": "rc",
  "enhanceChance": "mH",
  "enhanceCost": "yc",
  "enhanceXp": "AVo",
  "enhanceTicks": "ed",
  "protectionMin": "hs",
  "startWork": "mh",
  "workChance": "X3o",
  "workModifiers": "JL",
  "recipeInputs": "tn",
  "burnChance": "_3o",
  "workXpMultiplier": "Hv",
  "caughtChance": "z3o",
  "packCapacity": "Es",
  "lootBoxItemId": "my",
  "nearestWorkSite": "Df",
  "armourMultiplier": "mL",
  "restock": "Kte",
  "upgradeRecipes": "$m",
  "upgradeResult": "pb",
  "upgradeMaterials": "bv",
  "recipeLevel": "o_",
  "windowModifiers": "Cu",
  "hotRarityMultiplier": "P8",
  "skillPet": "vZ",
  "skillPetChance": "QO",
  "itemSupportsRarity": "hb",
  "bonusMinimumUncommon": "Ek",
  "addPack": "Ri",
  "enhancementTargetLimit": "NS",
  "enhanceMasteryMultiplier": "jGo",
  "enhanceMasteryBonusCap": "YL",
  "recipeRarity": "nv",
  "recipeOutput": "ry",
  "collectionExcluded": "uYo",
  "startUpgrade": "R3o",
  "upgradeSiteJob": "LL",
  "upgradeWorkTicks": "w5",
  "itemEnhancementLimit": "li",
  "rollPlayerDamage": "ozo",
  "createPlayer": "Foo",
  "unfinishedGear": "Bl",
  "encodeRelics": "lS",
  "itemRelics": "uc",
  "itemEnhancement": "Eo",
  "enhanceRules": "qs",
  "enhanceProtectedFailTo": "Dm",
  "enhancePityChance": "xVo",
  "enhancePityActive": "gv",
  "enhancePityBucket": "HL",
  "enhancePityKey": "BGo",
  "enhancePityRead": "qGo",
  "enhanceShardId": "pc",
  "enhanceScrollId": "Dl",
  "enhanceEssenceId": "tl",
  "enhanceCoreId": "au",
  "dungeonKeyTier": "iZ",
  "dungeonKeyChance": "Nxo",
  "dungeonKeyBaseTicks": "jxo",
  "isDungeonKey": "F8",
  "worldEarringBonus": "fm",
  "earringIds": "Wl",
  "packmasterCoatId": "Ls",
  "packmasterMoveBonus": "gxo",
  "packmasterSlotBonus": "IO",
  "bosskeeperTonicId": "hr"
};
// Skilling bosses and work-time use this same declaration closure and snapshot.
const bossFeedRules={
  rawBosses:'jo', rooms:'Vxo', makePlayer:exportsMap.createPlayer, pointsBase:'LM', markMultiplier:'eH',
  outfitContribution:'o9o', contributionBonus:'YQo', chestThreshold:'fd', feedXp:'KAo', feedRecipe:'rv',
  feedUsesFarmingSpeed:'qKo', productionXp:'Tae', equippedSkillTool:'kq',
  materialSavingSkill:'fae', swiftSpeedBonus:'Q8', essenceItemId:'hy', essenceItemsPerTick:'deo',
  item:exportsMap.item, itemList:exportsMap.items, gear:exportsMap.gear, tool:exportsMap.tool,
  decodeBase:exportsMap.baseItemId, tier:exportsMap.itemTier, withRarity:exportsMap.withRarity,
  encode:exportsMap.encode, level:exportsMap.level, levelXp:exportsMap.levelXp,
  workSpeed:exportsMap.workModifiers, inventoryCapacity:exportsMap.packCapacity,
  mountStride:exportsMap.mountSpeed, brewStrength:exportsMap.brewScale,
  masteryMultiplier:exportsMap.masteryMultiplier, sideSkillBonus:exportsMap.skillOffhandBonus,
  workXpMultiplier:exportsMap.workXpMultiplier, perkList:exportsMap.perks, maxLevel:exportsMap.maxLevel,
  maxEnhancement:exportsMap.maxEnhancement, masteryRankLimit:exportsMap.masteryRankLimit,
  houseLevelLimit:exportsMap.houseLevelLimit, canEnhance:exportsMap.canEnhance,
};
const bossWorkTimeGame={
  tickMs:exportsMap.tickMs, recipes:exportsMap.recipes, upgradeRecipes:exportsMap.upgradeRecipes,
  items:exportsMap.items, item:exportsMap.item, recipeInputs:exportsMap.recipeInputs,
  recipeOutput:exportsMap.recipeOutput, itemSupportsRarity:exportsMap.itemSupportsRarity,
  rarityThresholds:exportsMap.rarityThresholds, hotRarityMultiplier:exportsMap.hotRarityMultiplier,
  world:exportsMap.world, siteEntrance:exportsMap.nearbyTile, walkPath:'NM',
  withRarity:exportsMap.withRarity, baseItemId:exportsMap.baseItemId, itemTier:exportsMap.itemTier,
  upgradeMaterials:exportsMap.upgradeMaterials, upgradeResult:exportsMap.upgradeResult,
  levelSpeedCoefficient:'ZIo', upgradeBaseTicks:'Seo', bonusMinimumUncommon:exportsMap.bonusMinimumUncommon,
  bosses:bossFeedRules.rawBosses, bossUnlockLevel:'gc', bossFeedRecipe:bossFeedRules.feedRecipe,
  bossFeedParts:'rSo', bossUsesFarmingSpeed:bossFeedRules.feedUsesFarmingSpeed,
  bossHeartLayout:'xa', bossKrakenLayout:'Tn', bossColonyLayout:'Id', bossBlightLayout:'ti', bossSiegeLayout:'wl',
};
const exportGroups={bossFeedRules,bossWorkTimeGame};
function extractSnapshot(snapshot,sourceInfo,exportsMap,exportGroups={}) {
const source = fs.readFileSync(snapshot,'utf8');
if(hash(source)!==sourceInfo.sha256)throw Error('Unreviewed upstream snapshot: review source metadata, export mappings and signatures before extraction');
const ast = parse(source,{ecmaVersion:'latest',sourceType:'module',ranges:true});
const declarations = new Map();
for (const node of ast.body) {
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') declarations.set(node.id.name,{name:node.id.name,start:node.start,end:node.end,text:source.slice(node.start,node.end)});
  if (node.type === 'VariableDeclaration') for(const d of node.declarations) {
    // Keep destructuring together, so dependent constants retain original initialization.
    const ids=[]; const walk=n=>{if(!n)return;if(n.type==='Identifier')ids.push(n.name);else if(n.type==='ObjectPattern')n.properties.forEach(p=>walk(p.value));else if(n.type==='ArrayPattern')n.elements.forEach(walk);};walk(d.id);
    const entry={name:ids.join(','),start:d.start,end:d.end,text:node.kind+' '+source.slice(d.start,d.end)+';'};
    ids.forEach(id=>declarations.set(id,entry));
  }
}
const selected=new Set(); const allowed=new Set(['WeakSet','WeakMap','Uint8Array','Uint16Array','Uint32Array','Int16Array','Int32Array','Float64Array','Math','Map','Set','Number','Object','Array','String','Error','Date','Boolean','Infinity','undefined','JSON','RegExp','parseInt','parseFloat']);
function collect(name){
 const d=declarations.get(name);if(!d)throw Error('Missing declaration '+name);if(selected.has(d))return;selected.add(d);
 const a=parse(d.text,{ecmaVersion:'latest',sourceType:'module',ranges:true});
 const refs=analyze(a,{ecmaVersion:2024,sourceType:'module'}).globalScope.through.map(r=>r.identifier.name);
 for(const dep of new Set(refs))if(declarations.has(dep))collect(dep);else if(!allowed.has(dep))throw Error(`Unexpected external dependency ${dep} in ${name}`);
}
Object.values(exportsMap).forEach(collect);
for(const group of Object.values(exportGroups))Object.values(group).forEach(collect);
const ordered=[...selected].sort((a,b)=>a.start-b.start);
const workTimeSource={sourceVersion:sourceInfo.changelogVersion,sourceUrl:sourceInfo.sourceUrl,sha256:sourceInfo.sha256};
const groupedCode=Object.entries(exportGroups).map(([name,group])=>{
 const members=Object.entries(group).map(([key,symbol])=>`  ${key}: ${symbol}`);
 if(name==='bossWorkTimeGame')members.push(`  source: Object.freeze(${JSON.stringify(workTimeSource)})`);
 return `export const ${name} = Object.freeze({\n${members.join(',\n')}\n});\n`;
}).join('');
const moduleCode='// GENERATED from reviewed vendor snapshots. Do not edit.\n'+ordered.map(d=>d.text).join('\n')+'\nexport { '+Object.entries(exportsMap).map(([alias,name])=>`${name} as ${alias}`).join(', ')+' };\n'+groupedCode;
const manifest=JSON.stringify({...sourceInfo,exports:exportsMap,exportGroups,declarations:ordered.map(({name,start,end,text})=>({name,start,end,sha256:hash(text)})),overrides:[]},null,2);
return {moduleCode,manifest,count:ordered.length};
}

const {moduleCode,manifest,count}=extractSnapshot('vendor/game-original.js',sourceInfo,exportsMap,exportGroups);
fs.mkdirSync('src',{recursive:true});
fs.writeFileSync('src/upstream.js',moduleCode);
fs.writeFileSync('vendor/manifest.json',manifest);
console.log(`Extracted ${count} original declarations into src/upstream.js.`);
