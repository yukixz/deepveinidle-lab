import * as game from './upstream-combat.js';
import {readGuild} from './guild.js';
import {readWorldBuffs,worldBuffWarningText} from './world-buffs.js';
import {defaults,normalize,slots,skills,combatStyles,foods,gearDetails,gearEnhancementLimit,gearRelicLimit,equippedItemId} from './model.js';
import {combatRooms,combatMasteries,combatPerks,combatPotions} from './combat-options.js';
import {characterMasteries} from './character-masteries.js';
const importTypes=[['skills','技能','Skills'],['equipment','装备','Equipment'],['food','食物','Food'],['potions','药水','Potions'],['home','家园','Home'],['masteries','精通','Masteries'],['guild','公会与祝福','Guild & blessing'],['supplies','补给','Supplies'],['perks','特权','Perks']];
export function importWarningText(language,warnings=[]){
 const zh=language==='zh',categories=new Set(warnings.filter(item=>item!=='guild: worldBuffs.upgrade').map(item=>item.split(': ')[0])),lines=[];
 if(categories.has('food')){
  const reasons=[['food.bankMissing','仓库数据缺失','Warehouse data is missing'],['food.bankInvalid','仓库数据异常','Warehouse data is invalid'],['food.bankLockedMissing','缺少仓库锁定数据，请更新角色脚本并刷新游戏重新捕获','Warehouse lock data is missing; update the character script and refresh the game to capture again'],['food.bankLockedInvalid','仓库锁定数据异常','Warehouse lock data is invalid'],['food.noCandidate','仓库没有符合策略及稀有度上限的食物','No warehouse food matches the strategy and rarity cap'],['foodMaxTier','自动进食稀有度上限无效','The automatic food rarity cap is invalid']];
  const details=reasons.filter(([key])=>warnings.includes(`food: ${key}`)).map(r=>r[zh?1:2]);
  lines.push((zh?'【食物】部分配置未导入，已保留原值，请手动检查':'[Food] Some settings were not imported; previous values were kept. Please check manually.')+(details.length?(zh?'：': ' ')+details.join(zh?'；':'; '):''));
 }
 if(warnings.includes('guild: worldBuffs.upgrade'))lines.push(worldBuffWarningText(language,'worldBuffs.upgrade'));
 const others=importTypes.filter(([id])=>id!=='food'&&categories.has(id)).map(type=>type[zh?1:2]);
 if(others.length)lines.push(zh?`【${others.join('、')}】导入失败，请手动配置`:`[${others.join(', ')}] import failed. Please configure manually.`);
 return lines.join('\n');
}
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const valid=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const int=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>valid(v,min,max)&&Number.isInteger(v);
function warehouseFood(player){
 if(!record(player.bank))return {warning:'food.bankMissing'};
 for(const [key,qty] of Object.entries(player.bank)){
  const id=Number(key);
  if(!int(id,1)||String(id)!==key||!int(qty))return {warning:'food.bankInvalid'};
  try{game.item(id);}catch{return {warning:'food.bankInvalid'};}
 }
 if(player.bankLocked===undefined)return {warning:'food.bankLockedMissing'};
 if(!Array.isArray(player.bankLocked)||!player.bankLocked.every(id=>{if(!int(id,1))return false;try{game.item(id);return true;}catch{return false;}}))return {warning:'food.bankLockedInvalid'};
 const id=game.preferredBankFood({...player,lockedUsable:player.lockedUsable===true});
 if(id===null)return {warning:'food.noCandidate'};
 if(!foods.some(f=>f.id===game.baseItemId(id))||!int(game.itemTier(id),0,4))return {warning:'food.bankInvalid'};
 return {food:{id:game.baseItemId(id),tier:game.itemTier(id)}};
}
export function importCharacter(current,snapshot){
 if(!record(snapshot)||snapshot.version!==2||!int(snapshot.capturedAt,1)||snapshot.capturedAt>Date.now()+60000||!record(snapshot.player)||!int(snapshot.player.lastTick))throw new Error('invalidSnapshot');
 const chosen=importTypes.map(([id])=>id);
 const state=defaults(),p=snapshot.player,warnings=[],applied=new Set();
 let category,combatSkill,masterySource,masteryFallback=false;
 for(const key of ['food','eatAt','fed','rooted'])state[key]=structuredClone(current[key]);
 for(const key of ['foodRule','foodMaxTier','foodPerTrip','enemySelection','simulationHours','customSimulation','hotSetting','vendorValues','valuationMode'])state.manual[key]=current.manual[key];
 try{state.guild=readGuild(snapshot.guild);}catch(error){
  if(error.message!=='invalidSnapshot')throw error;
  state.guild=null;warnings.push('guild: guild');
 }
 const warn=field=>warnings.push(`${category}: ${field}`);
 const put=(field,value,check,set)=>{if(check(value)){set(value);applied.add(category);}else warn(field);};
 const active=kind=>record(p.brews)&&int(p.brews[kind]??0)&&(p.brews[kind]??0)>p.lastTick;
 for(category of chosen){
  if(category==='skills')for(const k of skills)put(`skills.${k}`,p.skills?.[k],v=>valid(v),v=>state.levels[k]=game.level(v));
  if(category==='equipment'){
   if(!record(p.equipment)){warn('equipment');continue;}
   for(const slot of slots){
    const id=p.equipment[slot];
    if(id===null||(slot==='earring'&&id===undefined)){
     state.gear[slot]={id:0,tier:0,plus:0};applied.add(category);
     if(slot==='weapon')combatSkill='melee';
     continue;
    }
    const base=int(id)?game.baseItemId(id):0,tier=int(id)?game.itemTier(id):0,plus=int(id)?game.itemEnhancement(id):0,relics=int(id)?game.itemRelics(id):0;
    if(!int(id)||!int(tier,0,4)||!int(plus,0,gearEnhancementLimit(base))||!int(relics,0,gearRelicLimit(base))||gearDetails(slot,id)?.slot!==slot){warn(`equipment.${slot}`);continue;}
    state.gear[slot]=gearRelicLimit(base)?{id:base,tier,plus,relics}:{id:base,tier,plus};applied.add(category);
    if(slot==='weapon'){
     const weapon=game.gear(base);
     combatSkill=weapon?.magic?'magic':weapon?.ranged?'ranged':'melee';
    }
   }
   if(combatSkill)state.style=combatSkill;
   if(slots.some(slot=>{const g=gearDetails(slot,equippedItemId(state.gear[slot]));return g?.style&&g.style!==state.style;}))state.manual.allGear=true;
  }
  if(category==='food'){
   const id=p.foodItemId;
   if(p.eatAt===0){state.manual.foodRule=3;applied.add(category);}
   else if(id===null||id===0||id===-2){
    state.manual.foodRule=id===-2?2:1;applied.add(category);
    if(p.eatAt!==0&&int(p.foodMaxTier,0,4)){
     const result=warehouseFood(p);
     if(result.warning)warn(result.warning);else state.food=result.food;
    }
   }
   else if(int(id,1)&&foods.some(f=>f.id===game.baseItemId(id))&&int(game.itemTier(id),0,4)){state.food={id:game.baseItemId(id),tier:game.itemTier(id)};state.manual.foodRule=0;applied.add(category);}else warn('foodItemId');
   if(p.eatAt===0){state.manual.foodRule=3;applied.add(category);}
   else put('eatAt',p.eatAt,v=>[.25,.5,.75].includes(v),v=>state.eatAt=v*100);
   put('foodMaxTier',p.foodMaxTier,v=>int(v,0,4),v=>state.manual.foodMaxTier=v);
   put('foodPerTrip',p.foodPerTrip,v=>[5,10,20,-2,-1].includes(v),v=>state.manual.foodPerTrip=v);
   if(record(p.brews)){
    for(const kind of ['fed','rooted'])put(`food.${kind}`,p.brews[kind]??0,v=>int(v),()=>state[kind]=active(kind));
   }else warn('food.buffs');
  }
  if(category==='potions'){
   if(!record(p.brews)){warn('brews');continue;}
   for(const {kind} of combatPotions){
    if(!int(p.brews[kind]??0)){warn(`brews.${kind}`);continue;}
    if(!active(kind)){state.brews[kind]=-1;applied.add(category);continue;}
    const buckets=p.brewBuckets?.[kind];let tier=p.brewTier?.[kind]??0;
    if(buckets!==undefined){
     if(!Array.isArray(buckets)||buckets.length!==5||!buckets.every(v=>int(v))){warn(`brewBuckets.${kind}`);continue;}
     const total=buckets.reduce((a,b)=>a+b,0),elapsed=Math.max(0,p.lastTick-(p.brews[kind]-total));let sum=0;tier=-1;
     for(let i=4;i>=0;i--){sum+=buckets[i];if(elapsed<sum){tier=i;break;}}
    }
    put(`brewTier.${kind}`,tier,v=>int(v,0,4),v=>state.brews[kind]=v);
   }
  }
  if(category==='home'){
   if(!record(p.house)||!record(p.houseFurniture)){warn('house / houseFurniture');continue;}
   for(const r of combatRooms)put(`house.${r.id}`,Object.hasOwn(p.house,r.id)?p.house[r.id]:0,v=>int(v,0,game.houseLevelLimit),v=>state.house[r.id]=r.bonus.kind==='bankSlots'||record(p.houseFurniture[r.id])?v:0);
  }
  if(category==='masteries'){
   let hasRanks=false;
   const read=skill=>{
    const {ranks,source}=characterMasteries(p,skill),values={...state.masteries};
    masteryFallback ||= Boolean(source.fallback);
    if(record(ranks)){
     hasRanks=true;
     for(const {id}of combatMasteries)put(`masteries.${id}`,Object.hasOwn(ranks,id)?ranks[id]:0,
      v=>int(v,0,game.masteryRankLimit),v=>values[id]=v);
    }else warn('masteries');
    return {values,source};
   };
   const active=read(combatSkill);
   masterySource=active.source;
   const activeStyle=combatSkill??'melee';
   const profiles=Object.fromEntries(combatStyles.map(skill=>[skill,skill===activeStyle?active.values:read(skill).values]));
   if(hasRanks)state.masteriesBySkill=profiles;
   state.masteries=active.values;
  }
  if(category==='guild'){
   put('guildBonus',p.guildBonus,v=>valid(v,0,1e5),v=>state.manual.guildXp=v*100);
   if(record(p.brews)&&int(p.brews.blessing??0)){state.manual.blessing=active('blessing');applied.add(category);}else warn('blessing');
   const world=readWorldBuffs(snapshot);
   state.manual.weeklyXp=world.weeklyXp;state.manual.worldRarity=world.worldRarity;
   if(world.warning)warn(world.warning);else applied.add(category);
  }
  if(category==='supplies'){
   put('homeBank',p.homeBank,v=>v===null||game.world.banks.some(b=>b.id===v),v=>state.homeBank=v??0);
   put('ironman',p.ironman,v=>typeof v==='boolean',v=>state.manual.ironman=v);
  }
  if(category==='perks'){
   if(!record(p.perks)){warn('perks');continue;}
   for(const perk of combatPerks)put(`perks.${perk.id}`,Object.hasOwn(p.perks,perk.id)?p.perks[perk.id]:0,v=>int(v,0,perk.ranks),v=>{if(perk.id==='meals')state.meals=v;else state.manual.perks[perk.id]=v;});
  }
 }
 return {state:normalize(state),applied:[...applied],warnings:[...new Set(warnings)],masterySource,masteryFallback};
}
