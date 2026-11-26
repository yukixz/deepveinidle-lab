import * as game from './upstream.js';
import {createScenario} from './simulation.js';
import {DEFAULT_HOT_SETTING,normalizeManual} from './manual-settings.js';
import {readGuild} from './guild.js';
import {slotItems,gatheringGear,workEquipmentSlots} from './gathering-model.js';
import {importWorkConfig} from './work-import.js';
import {valuationPrice} from './item-prices.js';
import {restoreSkillMasteries} from './character-masteries.js';

export const craftingStorageKey='dvi-crafting-config-v1';
export const craftingSkills=['cooking','smithing','fletching','herblore','crafting'];
export const craftingToolSlots={cooking:'pan',smithing:'hammer',fletching:'knife',herblore:'mortar',crafting:'needle'};
export const craftingSlots=[...Object.values(craftingToolSlots),'mount',...workEquipmentSlots];
export const craftingJobs=[...game.recipes.filter(r=>craftingSkills.includes(r.skill)&&!r.retired),...game.upgradeRecipes.map(upgrade=>({id:'upgrade-'+upgrade.id,name:upgrade.name,skill:upgrade.skill,group:'Upgrades',levelReq:upgrade.levelReq,xp:upgrade.xp,upgrade,output:{itemId:upgrade.to[0],qty:1}}))];
export const craftingPotions=game.potions.filter(p=>['elixir','swift'].includes(p.kind));
export const craftingRooms=game.rooms.filter(r=>r.bonus.kind==='craftSpeed'&&craftingSkills.includes(r.bonus.skill));
export const craftingMasteries=game.masteries.filter(m=>['craft','xp','move'].includes(m.id));
export const craftingPerks=game.perks.filter(p=>['pockets','quick','hands'].includes(p.id));
export const craftingTiers=job=>Array.from({length:5},(_,tier)=>tier).filter(tier=>job.upgrade||game.recipeRarity(job,tier)===tier);
export const recipeKey=(jobId,tier)=>`${jobId}:${tier}`;
export const validQuantity=value=>Number.isSafeInteger(value)&&value>=0;
export const safeAdd=(a,b)=>{const value=a+b;if(!Number.isSafeInteger(value)||value<0)throw Error('quantityOverflow');return value;};
const safeMultiply=(a,b)=>{const value=a*b;if(!Number.isSafeInteger(value)||value<0)throw Error('quantityOverflow');return value;};
const integer=(v,min,max)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Math.floor(Number(v)))):min;
export function craftingDefaults(){return {
 simulationHours:24,skill:'cooking',levels:Object.fromEntries(craftingSkills.map(k=>[k,1])),gear:Object.fromEntries(craftingSlots.map(k=>[k,{id:0,tier:0,plus:0}])),
 brews:Object.fromEntries(craftingPotions.map(p=>[p.kind,-1])),house:Object.fromEntries(craftingRooms.map(r=>[r.id,0])),masteries:Object.fromEntries(craftingMasteries.map(m=>[m.id,0])),
 perks:Object.fromEntries(craftingPerks.map(p=>[p.id,0])),guild:null,guildXp:0,weeklyXp:0,ironman:false,blessing:false,homeBank:0,hotSetting:DEFAULT_HOT_SETTING,
};}
export function normalizeCrafting(raw){
 const s=craftingDefaults();if(!raw||typeof raw!=='object')return s;
 s.skill=craftingSkills.includes(raw.skill)?raw.skill:s.skill;
 for(const k of craftingSkills)s.levels[k]=integer(raw.levels?.[k]??1,1,game.maxLevel);
 for(const slot of craftingSlots){const v=raw.gear?.[slot];if(v&&slotItems(slot).some(g=>g.itemId===Number(v.id)))s.gear[slot]={id:Number(v.id),tier:game.itemSupportsRarity(Number(v.id))?integer(v.tier??0,0,4):0,plus:game.canEnhance(Number(v.id))?integer(v.plus??0,0,game.maxEnhancement):0};}
 for(const p of craftingPotions)s.brews[p.kind]=integer(raw.brews?.[p.kind]??-1,-1,4);
 for(const r of craftingRooms)s.house[r.id]=integer(raw.house?.[r.id]??0,0,game.houseLevelLimit);
 for(const m of craftingMasteries)s.masteries[m.id]=integer(raw.masteries?.[m.id]??0,0,game.masteryRankLimit);
 restoreSkillMasteries(s,raw.masteriesBySkill,craftingSkills,game.masteryRankLimit);
 for(const p of craftingPerks)s.perks[p.id]=integer(raw.perks?.[p.id]??0,0,p.ranks);
 const manual=normalizeManual(raw,{fractionalWorldXp:true});for(const k of ['guildXp','weeklyXp','ironman','blessing','hotSetting','simulationHours'])s[k]=manual[k];
 s.homeBank=game.world.banks.some(b=>b.id===Number(raw.homeBank))?Number(raw.homeBank):0;s.guild=readGuild(raw.guild);
 return s;
}
export function craftingMaterials(job,tier,count){
 if(!validQuantity(count)||!Number.isInteger(tier)||!craftingTiers(job).includes(tier))throw Error('invalidQuantity');
 if(job.upgrade){
  const base=game.withRarity(job.upgrade.from[0],tier),items={[base]:count};
  for(const i of game.upgradeMaterials(job.upgrade,base).named)items[i.itemId]=safeAdd(items[i.itemId]??0,safeMultiply(i.qty,count));
  return items;
 }
 return Object.fromEntries(game.recipeInputs(job,tier).map(i=>[i.itemId,safeMultiply(i.qty,count)]));
}
const money=v=>{if(!Number.isFinite(v)||v<0||v>Number.MAX_SAFE_INTEGER)throw Error('priceOverflow');return v;};
export function priceItems(items,prices,{expected=false,priceFor=id=>valuationPrice(id,prices)}={}){
 let value=0;const missing=[];
 for(const [id,n]of Object.entries(items)){if(!(expected?Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER:validQuantity(n)))throw Error('quantityOverflow');const p=priceFor(Number(id));value=money(value+money(n*p.price));if(n>0&&p.fallback)missing.push(Number(id));}
 return {value,missing};
}
export function craftingPlayer(raw){
 const s=normalizeCrafting(raw),{player:p}=createScenario({levels:{},gear:{mount:s.gear.mount},brews:s.brews,house:s.house,masteries:s.masteries,homeBank:s.homeBank,manual:{...s,perks:s.perks,foodRule:3,hotSetting:'game'}});
 for(const k of craftingSkills)p.skills[k]=game.levelXp(s.levels[k]);
 for(const slot of craftingSlots){const v=s.gear[slot];p.equipment[slot]=v.id?game.encode(game.withRarity(v.id,v.tier),v.plus):null;}
 p.bank={};p.brews={};p.brewTier={};p.eatAt=0;p.fallback=null;
 for(const [kind,tier]of Object.entries(s.brews))if(tier>=0){p.brews[kind]=Number.MAX_SAFE_INTEGER;p.brewTier[kind]=tier;}
 if(s.blessing)p.brews.blessing=Number.MAX_SAFE_INTEGER;
 return {state:s,player:p};
}
export function craftingJobStats(raw,job){
 const {player}=craftingPlayer(raw);
 if(job.upgrade)return {chance:null,seconds:game.tickMs/1000*game.upgradeWorkTicks(player,job.upgrade)};
 const chance=game.workChance(job,player);return {chance,seconds:game.tickMs/1000/chance};
}
export function craftingStats(raw){
 const {state:s,player:p}=craftingPlayer(raw);return {level:s.levels[s.skill],speedBonus:game.workModifiers(p,s.skill).combined-1,
 xpBonus:game.combine(game.workXpMultiplier(p,false,s.skill),game.masteryMultiplier(p.masteries,'xp'),1+s.weeklyXp/100)-1,
 moveSpeed:Math.round(game.mountSpeed(p)*(1+.2*game.brewScale(p,'swift'))*(1+s.masteries.move*.005))/1000,capacity:game.packCapacity(p)};
}
export function importCrafting(current,snapshot){return importWorkConfig(current,snapshot,{skills:craftingSkills,slots:craftingSlots,potions:craftingPotions,rooms:craftingRooms,masteries:craftingMasteries,perks:craftingPerks,normalize:normalizeCrafting,gear:gatheringGear,reset:{homeBank:0,hotSetting:DEFAULT_HOT_SETTING}});}
