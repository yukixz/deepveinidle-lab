import * as game from './upstream.js';
import {bindSimulationHours} from './simulation-hours-control.js';
import {bindSimulationPanel,pageValuation,simulationPanel} from './page-prices.js';
import {timingDetails} from './activity-timing.js';
import {potionEffectNote} from './potion-effects.js';
import {mountAppreciation} from './appreciation-controls.js';
import {renderFormulas} from './formulas-controls.js';
import {mountUsageDashboard} from './usage-dashboard.js';
import {compactNumber,formatOneDecimal,formatUnitPrice} from './number-format.js';
import {mountScrollLayout,rememberScrollLayout} from './scroll-layout.js';
import {startAutomaticPriceImport} from './price-auto-import.js';
import {mountItemPrices} from './item-price-controls.js';
import {calculateWorldBosses,renderWorldBosses} from './world-bosses.js';
import {getSnapshot,subscribe} from './price-service.js';
import {valueCombatRewards} from './item-prices.js';
import {renderMastery} from './mastery-controls.js';
import {setMasteryCombatSource,setMasteryGatheringSource,setMasteryCraftingSource,invalidateMasteryOptimizer,leaveMasteryOptimizer} from './mastery-optimizer-controls.js';
import {renderGathering,getGatheringConfig} from './gathering-controls.js';
import {renderCrafting,getCraftingConfig} from './crafting-controls.js';
import {selectedEnemies} from './enemy-selection.js';
import {renderDebug} from './debug-controls.js';
import {renderEnhancement,applyEnhancementImport} from './enhancement-controls.js';
import {simulationHotMarkup,rewardAmount} from './combat-hot.js';
import {randomSimulationSeed} from './simulation-seed.js';
import {renderForecast,updateForecast} from './forecast-controls.js';
import {importCharacter,importWarningText} from './character-import.js';
import {rememberSkillMasteries} from './character-masteries.js';
import {registerCharacterUpdates,setCharacterImportPage,importControls,probeCharacter,importStatusText} from './import-controls.js';
import {combatPotions,combatRooms,combatMasteries} from './combat-options.js';
import {manualControls} from './manual-controls.js';
import {dictionary,translatedName} from './i18n.js';
import {gearEnhancementLimit,gearRelicLimit,equippedItemId,gearDetails,slots,skills,foods,baseGear,defaults,normalize,calculate,preset,chooseLanguage,gearForStyle,selectStyle,sortEnemies,masteryValue,masteryRank} from './model.js';
const $=s=>document.querySelector(s),storageKey='dvi-simulator-v1';
const gameInviteUrl='https://deepveinidle.com/?ref=Alice';
let saved;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
let language=chooseLanguage(saved?.language,navigator.languages||[navigator.language]),state=normalize(saved?.state||preset('ranged')),query='',sort='level',sortDirection='desc',activeSection=sectionForPath();
state=selectStyle(state,state.style);
setMasteryCombatSource(()=>state);
setMasteryGatheringSource(getGatheringConfig);
setMasteryCraftingSource(getCraftingConfig);
let importBusy=false,importStatus=null;
let bossSort='dps',bossSortDirection='desc';
const copy={zh:{title:'Alice’s 实验室',browserTitle:"Alice’s 实验室 · Deep Vein Idle",sub:'配好装备，看看每一场战斗。',beta:'1.15.1',config:'角色配置',melee:'近战',ranged:'远程',magic:'魔法',defence:'防御',hitpoints:"生命值",levels:'技能',equipment:'装备',weapon:'武器',shield:'副手',helmet:'头部',body:'胸部',legs:"护腿",ring:'戒指',amulet:'护符',earring:'耳环',mount:'坐骑',moveSpeed:'移动速度',empty:"无",unarmed:'空手',rarity:['普通','罕见','稀有','史诗','传说'],food:'食物',fed:'食物伤害增益生效 +25%',rooted:'作物减伤增益生效 −20%',potions:'药水',off:'未启用',home:'家园',masteries:'精通',depot:'模拟仓库',accuracy:"命中",maxhit:'最大伤害',hp:"生命上限",mastery:'精通等级',house:'家园设施等级（已放置）',reset:'清空配置',resetConfirm:'重置技能、装备与增益？',stats:'战斗属性',evasion:'闪避',strength:'装备力量',speed:'攻击间隔',second:'秒',targets:'普通战斗',search:'搜索怪物名称（中 / 英）',level:'等级',enemy:'敌人',rounding:'手动及导入配置模拟未保留实际库存、队列、技能等级内的经验进度、家园升级进度、增益到期时间及账号随机种子等。',saved:'配置自动保存在此浏览器',saveFail:'浏览器存储不可用，配置无法保存',emptyResults:'没有匹配的敌人',warnings:'配装提示',levelIssue:'等级不足，仍计入：需要',styleIssue:'流派不匹配，未计入战斗',twoHanded:'大剑占用双手，副手未计入',missing:'该稀有度不存在，本件未计入',acc:'命中',str:'力量',def:'防御',},en:{title:'Alice’s Lab',browserTitle:"Alice's Lab for Deep Vein Idle",sub:'Build your loadout. Know every matchup.',beta:'1.15.1',config:'Character build',melee:'Melee',ranged:'Ranged',magic:'Magic',defence:'Defence',hitpoints:'Hitpoints',levels:'Skills',equipment:'Equipment',weapon:'Weapon',shield:'Off-hand',helmet:'Head',body:'Body',legs:'Legs',ring:'Ring',amulet:'Amulet',earring:'Earring',mount:'Mount',moveSpeed:'Movement speed',empty:'None',unarmed:'Unarmed',rarity:['Normal','Uncommon','Rare','Epic','Legendary'],food:'Food',fed:'Food damage buff active +25%',rooted:'Crop protection active −20%',potions:'Potions',off:'Inactive',home:'Home',masteries:'Masteries',depot:'Simulated depot',accuracy:'Accuracy',maxhit:'Max hit',hp:'Max HP',mastery:'Mastery ranks',house:'Placed home station levels',reset:'Reset build',resetConfirm:'Reset all skills, equipment and buffs?',stats:'Character stats',evasion:'Evasion',strength:'Gear strength',speed:'Attack interval',second:'s',targets:'Normal combat',search:'Search enemies in English or Chinese',level:'Level',enemy:'Enemy',rounding:'Manual and imported build simulations do not preserve actual inventory, queued tasks, progress within skill levels, home upgrade progress, buff expiry times, or account random seeds.',saved:'Build saved automatically in this browser',saveFail:'Browser storage unavailable; build cannot be saved',emptyResults:'No matching enemies',warnings:'Loadout notes',levelIssue:'Level too low; included: requires',styleIssue:'Wrong combat style; excluded from combat',twoHanded:'Greatsword uses both hands; off-hand excluded',missing:'This rarity is unavailable; item excluded',acc:'Accuracy',str:'Strength',def:'Defence',}};
Object.assign(copy.zh,{projectAuthor:'项目作者：',copyright:'Deep Vein Idle 的名称、标识、相关设计、游戏代码，以及美术素材、截图、角色、世界设定和其他可识别的游戏资源，其知识产权归原游戏作者或相应权利人所有，保留所有权利。其他商标归各自权利人所有。',projectNotice:'本项目为玩家制作的非官方模拟工具，仅用于信息展示与交流，不代表原游戏官方立场或认可，也不声称已获得官方授权。工具的内容与运行由本项目作者独立维护。'});
Object.assign(copy.en,{projectAuthor:'Project author: ',copyright:'The Deep Vein Idle name, logos, associated designs, game code, artwork, screenshots, characters, world settings and other recognizable game resources are the intellectual property of the original game creator or their respective rights holders. All rights reserved. All other trademarks belong to their respective owners.',projectNotice:'This is an unofficial, player-created simulator for information and community discussion. It does not represent the game’s official views or endorsement, and makes no claim of official authorization. The project author independently maintains the content and operation of this tool.'});
Object.assign(copy.zh,{combat:'战斗',gather:'采集',craft:'制造','boss-feed':'技能首领',enhance:'强化',mastery:'精通',forecast:'预报',formulas:'公式',sections:'主要板块'});
Object.assign(copy.en,{combat:'Combat',gather:'Gather',craft:'Crafting','boss-feed':'Skilling Bosses',enhance:'Enhance',mastery:'Mastery',forecast:'Forecast',formulas:'Formulas',sections:'Main sections'});
const t=k=>copy[language][k]??k;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dict=dictionary;
const name=s=>translatedName(s,language);
const options=(arr,value)=>arr.map(([v,label])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const tiers=v=>options(t('rarity').map((n,i)=>[i,n]),v);
const number=(path,label,value,max,min=0,step=1)=>`<label class="number-field"><span>${esc(label)}</span><input type="number" data-path="${path}" value="${value}" min="${min}" max="${max}" step="${step}" aria-label="${esc(label)}"></label>`;
let saveOK=true;
function save(){try{localStorage.setItem(storageKey,JSON.stringify({language,state}));saveOK=true;}catch{saveOK=false;}invalidateMasteryOptimizer();}
function gearSummary(slot,g){
 if(!g)return '—';
 const percent=value=>`+${Number((value*100).toFixed(2))}%`;
 const attributes=slot==='mount'?[[g.bonus,t('moveSpeed'),percent]]:[
  [g.accuracy,t('acc')],[g.strength,t('str')],[g.defence,t('def')],
  [g.speed,language==='zh'?'基础攻击间隔':'Base attack interval',value=>`${Number((value*game.tickMs/1000).toFixed(2))} ${t('second')}`],
  [g.luck,language==='zh'?'幸运加成':'Luck bonus',percent]
 ];
 return attributes.filter(([value])=>Number.isFinite(value)&&value!==0).map(([value,label,format])=>`${label} ${format?format(value):value}`).join(' · ')||'—';
}
function equipRow(slot){const v=state.gear[slot],relicLimit=gearRelicLimit(v.id),g=v.id?gearDetails(slot,equippedItemId(v)):null;return `<div class="gear-row"><label class="gear-name"><span>${t(slot)}</span><select data-path="gear.${slot}.id" aria-label="${t(slot)}">${options([...(slot==='weapon'&&state.style!=='melee'?[]:[[0,slot==='weapon'?t('unarmed'):t('empty')]]),...(state.manual.allGear&&slot!=='weapon'?baseGear.filter(g=>g.slot===slot):gearForStyle(slot,state.style)).sort((a,b)=>a.levelReq-b.levelReq).map(x=>[x.itemId,`${name(game.item(x.itemId).name)}${slot==='mount'?'':` · ${x.levelReq}`}`])],v.id)}</select></label><div class="gear-mods"><select data-path="gear.${slot}.tier" aria-label="${t(slot)} ${language==='zh'?'稀有度':'Rarity'}" ${!v.id||!game.itemSupportsRarity(v.id)?'disabled':''}>${tiers(v.tier)}</select><label class="enhance"><span>+</span><input type="number" min="0" max="${gearEnhancementLimit(v.id)}" step="1" data-path="gear.${slot}.plus" value="${v.plus}" aria-label="${t(slot)} ${language==='zh'?'强化':'Enhance'}" ${!v.id||!game.canEnhance(v.id)?'disabled':''}></label></div>${relicLimit?`<label class="gear-stats number-field">${language==='zh'?'已投入遗物':'Relics invested'}<input type="number" min="1" max="${relicLimit}" step="1" data-path="gear.${slot}.relics" value="${v.relics??0}"></label>`:''}<small class="gear-stats">${gearSummary(slot,g)}</small></div>`;}
function houseDescription(r){const labels=language==='zh'?{gatherSpeed:'采集速度',craftSpeed:'制作速度',combatXp:'战斗经验',skillXp:'技能经验',enhanceChance:'强化成功率',dmg:'伤害',rareChance:'稀有掉落概率',bankSlots:'仓库容量'}:{gatherSpeed:'Gather speed',craftSpeed:'Craft speed',combatXp:'Combat XP',skillXp:'Skill XP',enhanceChance:'Enhance odds',dmg:'Damage',rareChance:'Rare-find',bankSlots:'Storage slots'};return labels[r.bonus.kind]+(r.bonus.kind==='dmg'?(language==='zh'?' · 每级 +0.5%，50 级最高 +25%':' · +0.5% per level, +25% at level 50'):['combatXp','skillXp','rareChance'].includes(r.bonus.kind)?(language==='zh'?' · 参与小时利润':' · affects hourly rewards'):(language==='zh'?' · 原始效果为仓库容量；当前无限仓库，不影响模拟':' · native storage capacity; no effect with unlimited storage'));}
const enemyColumns=[['enemy','level'],['xpHour','xp'],['totalIncomeHour','totalIncome'],['profitHour','profit'],['movingShare','movingRatio'],['killsHour','kills'],['coinsHour','coins'],['normalHour','normalValue'],['rareHour','rareValue'],['foodHour','consumableCost']];
const simulationSortKeys=new Set(['homeBank','kills','xp','coins','normal','rare','normalValue','rareValue','totalIncome','profit','consumableCost']);
function visibleEnemyColumns(){return enemyColumns;}
function enemyHeaders(){return visibleEnemyColumns().map(([label,key])=>`<th ${key?`data-column="${key}" aria-sort="${key===sort?(sortDirection==='asc'?'ascending':'descending'):'none'}"`:''}>${key?`<button class="sort-header" data-sort="${key}">${t(label)} <span class="sort-arrow" aria-hidden="true">${key===sort?(sortDirection==='asc'?'↑':'↓'):'↕'}</span></button>`:t(label)}</th>`).join('');}
function updateSorting(){
 document.querySelectorAll('th[data-column]').forEach(th=>{const active=th.dataset.column===sort;th.setAttribute('aria-sort',active?(sortDirection==='asc'?'ascending':'descending'):'none');th.querySelector('.sort-arrow').textContent=active?(sortDirection==='asc'?'↑':'↓'):'↕';});
}
function sectionForPath(){
 const path=location.pathname.replace(/\/$/,'');
 if(['formulas','craft','boss-feed','mastery','gather','debug','forecast','enhance','combat','usage'].includes(path.slice(1)))return path.slice(1);
 if(path!=='')history.replaceState(null,'','/combat'+location.search+location.hash);
 return 'combat';
}
let bossFeedModule;
function showBossFeed(){
 const host=$('#boss-feed-content');
 (bossFeedModule??=import('./boss-feed-controls.js')).then(({renderBossFeed})=>{
  if(activeSection!=='boss-feed'||!host.isConnected)return;
  renderBossFeed(language);
  setCharacterImportPage(activeSection);
 }).catch(error=>{
  bossFeedModule=undefined;
  if(host.isConnected)host.textContent=language==='zh'?'首领投喂页面加载失败，请重新打开。':'Boss feeding could not load. Reopen the page to retry.';
  console.error(error);
 });
}
function showSection(section){
 rememberScrollLayout();
 const wasCombat=activeSection==='combat';
 activeSection=section;
 if(wasCombat&&section!=='combat')stopSimulation();
 if(section==='mastery')renderMastery(language);else leaveMasteryOptimizer();
 renderGathering(language,{isActive:section==='gather'});
 renderCrafting(language,{isActive:section==='craft'});
 for(const id of ['combat','gather','craft','boss-feed','enhance','mastery','forecast','formulas','debug','usage'])document.getElementById(`${id}-section`).hidden=id!==section;
 if(section==='combat')scheduleSimulation();
 renderFormulas({isActive:section==='formulas'});
 if(section==='usage')mountUsageDashboard($('#usage-section'),language);
 setCharacterImportPage(section);
 if(section==='boss-feed')showBossFeed();
 document.querySelectorAll('[data-section]').forEach(link=>{
  const selected=link.dataset.section===activeSection;
  if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');

 });
}
window.addEventListener('popstate',()=>showSection(sectionForPath()));
window.addEventListener('hashchange',()=>renderFormulas({isActive:activeSection==='formulas'}));
let unmountScrollLayout;
function render(){
 unmountScrollLayout?.();
 const controls=manualControls(state,{language,number,options,esc,name,tiers});
 const openDetails=new Map([...document.querySelectorAll('details[id]')].map(el=>[el.id,el.open]));
 document.documentElement.lang=language==='zh'?'zh-CN':'en';document.title=t('browserTitle');
$('#app').innerHTML=`<header><div class="brand"><a class="brand-home" href="/"><img class="brand-icon" src="/src/assets/lab.svg" alt="" width="40" height="40">${t('title')}</a><a class="brand-game" href="${gameInviteUrl}" target="_blank" rel="noopener noreferrer">Deep Vein Idle</a></div><nav class="section-nav" aria-label="${t('sections')}">${['combat','gather','craft','enhance','mastery','boss-feed','forecast'].map(id=>`<a id="${id}-nav" href="/${id}" data-section="${id}" aria-controls="${id}-section" ${activeSection===id?'aria-current="page"':''}>${t(id)}</a>`).join('')}</nav><div class="header-right"><button id="appreciation-open" class="secondary"><span aria-hidden="true">👍</span> ${language==='zh'?'打赏一下':'Support'}</button><span class="beta">${t('beta')}</span><span class="language-switch" title="Language / 语言"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h12M9 3v2M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-8 10M14 21l4-10 4 10M15.5 17h5"/></svg><select id="language" aria-label="Language / 语言"><option value="zh" ${language==='zh'?'selected':''}>简体中文</option><option value="en" ${language==='en'?'selected':''}>English</option></select></span></div></header><main id="combat-section" aria-labelledby="combat-nav" ${activeSection!=='combat'?'hidden':''}><div class="config-column"><aside class="panel config"><details id="combat-character-panel" class="configuration-disclosure" open><summary><h1>${t('config')}</h1></summary><button id="reset" class="text-button">${t('reset')}</button><p class="muted intro">${t('sub')}</p>${importControls(language)}<div class="presets">${['melee','ranged','magic'].map((k,i)=>`<button data-preset="${k}" aria-pressed="${state.style===k}" class="${state.style===k?'selected':''}"><span>${['⚔','➶','✧'][i]}</span>${t(k)}</button>`).join('')}</div><p class="micro">${language==='zh'?'战斗风格 · 仅显示对应装备，防御与生命通用':'Combat style · matching gear only; defence and HP are shared'}</p><details class="config-detail" id="skills-settings"><summary>${t('levels')}</summary><div class="skill-grid">${skills.map(k=>number(`levels.${k}`,t(k),state.levels[k],game.maxLevel,1)).join('')}</div></details><details class="config-detail" id="equipment-settings"><summary>${t('equipment')}</summary><label class="check"><input type="checkbox" data-path="manual.allGear" ${state.manual.allGear?'checked':''}>${language==='zh'?'显示全部装备':'Show all gear'}</label>${slots.map(equipRow).join('')}</details><details class="config-detail" id="food-settings"><summary>${t('food')}</summary><label class="potion"><span>${t('food')}</span><select data-path="food.id" aria-label="${t('food')}">${options(foods.map(x=>[x.id,name(x.name)]),state.food.id)}</select></label>${controls.food}<label class="check"><input type="checkbox" data-path="fed" ${state.fed?'checked':''}>${t('fed')}</label><label class="check"><input type="checkbox" data-path="rooted" ${state.rooted?'checked':''}>${t('rooted')}</label></details><details class="config-detail" id="potion-settings"><summary>${t('potions')}</summary>${combatPotions.map(p=>{const k=p.kind;return `<label class="potion"><span>${esc(name(game.item(p.itemId).name))}</span><select data-path="brews.${k}">${options([[-1,t('off')],...t('rarity').map((v,i)=>[i,v])],state.brews[k])}</select></label><p class="micro">${esc(potionEffectNote(k,state.brews[k],language))}</p>`;}).join('')}</details><details class="config-detail" id="home-settings"><summary>${t('home')}</summary><p class="micro">${t('house')}</p><div class="skill-grid">${combatRooms.map(r=>`<div>${number(`house.${r.id}`,name(r.name),state.house[r.id],game.houseLevelLimit)}<p class="micro">${houseDescription(r)}</p></div>`).join('')}</div></details><details class="config-detail" id="mastery-settings"><summary>${t('masteries')}</summary><p class="micro">${language==='zh'?'精通实际加成（命中每级 1%，其余每级 0.5%）':'Effective mastery bonuses (accuracy: 1% per rank; others: 0.5%)'}</p><div class="skill-grid">${combatMasteries.map(m=>`<div>${number(`masteries.${m.id}`,name(m.name)+(m.unit==='percent'?' (%)':(language==='zh'?'（小时）':' (hours)')),masteryValue(m.id,state.masteries[m.id]),masteryValue(m.id,game.masteryRankLimit),0,masteryValue(m.id,1))}<p class="micro">${esc(name(m.blurb))}</p></div>`).join('')}</div></details>${controls.other}<p class="save-note" id="save-note">● ${t(saveOK?'saved':'saveFail')}</p></details></aside>${simulationPanel('combat',language,controls.simulation)}</div><div class="results"><div class="result-heading"><div><span class="eyebrow">COMBAT OVERVIEW</span><h2>${t('stats')}</h2></div><span id="style-badge" class="style-badge"></span></div><div id="stats" class="stats"></div><div id="issues" aria-live="polite"></div><section class="panel enemies"><div class="enemies-heading simulation-heading"><div><h2>${t('targets')}</h2></div><p id="simulation-status" class="simulation-progress" aria-live="polite"></p></div><div class="toolbar"><div class="search-wrap"><img class="search-icon" src="/src/assets/search.svg" alt="" width="14" height="14"><input id="search" type="search" placeholder="${t('search')}" aria-label="${t('search')}" value="${esc(query)}"></div><button id="rerun-combat" class="secondary">${language==='zh'?'重新模拟':'Rerun simulation'}</button></div><div class="table-scroll"><table><thead><tr>${enemyHeaders()}</tr></thead><tbody id="rows"></tbody></table></div><p id="combat-method-note" class="table-note">${t('rounding')} <strong class="simulation-caveat">${language==='zh'?'结果可能与游戏内的预测值和实际情况不同。':'Results may differ from in-game predictions and actual gameplay.'}</strong><br>${t('combatMethodNote')}</p></section></div></main><section id="gather-section" aria-labelledby="gather-nav" ${activeSection!=='gather'?'hidden':''}><div id="gather-content"></div></section><section id="craft-section" aria-labelledby="craft-nav" ${activeSection!=='craft'?'hidden':''}><div id="craft-content"></div></section><section id="boss-feed-section" aria-labelledby="boss-feed-nav" ${activeSection!=='boss-feed'?'hidden':''}><div id="boss-feed-content"></div></section><section id="enhance-section" aria-labelledby="enhance-nav" ${activeSection!=='enhance'?'hidden':''}><div id="enhance-content"></div></section><section id="mastery-section" aria-labelledby="mastery-nav" ${activeSection!=='mastery'?'hidden':''}><div id="mastery-content"></div></section><section id="forecast-section" class="forecast-section" aria-labelledby="forecast-nav" ${activeSection!=='forecast'?'hidden':''}><div id="forecast-content"></div></section><section id="formulas-section" class="formulas-section" lang="zh-CN" aria-label="公式" ${activeSection!=='formulas'?'hidden':''}><div id="formulas-content"></div></section><section id="debug-section" class="forecast-section" aria-labelledby="debug-title" ${activeSection!=='debug'?'hidden':''}><div id="debug-content"></div></section><section id="usage-section" class="forecast-section usage-dashboard" aria-labelledby="usage-title" ${activeSection!=='usage'?'hidden':''}></section><footer class="project-footer"><div class="footer-contact"><span>${t('projectAuthor')}<strong>Alice</strong></span><a href="${gameInviteUrl}" target="_blank" rel="noopener noreferrer">Deep Vein Idle ↗</a></div><p>${t('copyright')}</p><p>${t('projectNotice')}</p></footer>`;
 $('.enemies').insertAdjacentHTML('afterend','<section id="world-bosses" class="panel world-bosses enemies" aria-labelledby="world-boss-title"></section>');
 $('#world-bosses').onclick=e=>{const button=e.target.closest('[data-boss-sort]');if(!button)return;const key=button.dataset.bossSort;bossSortDirection=key===bossSort&&bossSortDirection==='desc'?'asc':'desc';bossSort=key;renderResults();};
 document.querySelectorAll('[data-section]').forEach(link=>link.onclick=event=>{
  if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  if(location.pathname!==link.getAttribute('href'))history.pushState(null,'',link.getAttribute('href'));
  showSection(link.dataset.section);
 });
 for(const [id,open]of openDetails){const el=document.getElementById(id);if(el)el.open=open;}
 document.querySelectorAll('[data-path^="levels."]').forEach(el=>{const k=el.dataset.path.split('.')[1];el.closest('label').classList.toggle('active-skill',k===state.style);});
 $('#language').onchange=e=>{language=e.target.value;save();render();};
 $('#reset').onclick=()=>{
  if(!confirm(t('resetConfirm')))return;
  combatUpdater.reset();
  const {enemySelection,simulationHours,hotSetting}=state.manual;
  state=selectStyle(defaults(),'melee');
  Object.assign(state.manual,{enemySelection,simulationHours,hotSetting});
  save();render();
 };
 document.querySelectorAll('[data-preset]').forEach(el=>el.onclick=()=>{const style=el.dataset.preset;if(state.style!==style)combatUpdater.invalidate();state=selectStyle(state,style);save();render();});
 bindSimulationHours($('[data-path="manual.simulationHours"]'),hours=>{
  if(state.manual.simulationHours===hours)return;
  state.manual.simulationHours=hours;save();renderResults();
 });
 document.querySelectorAll('[data-path]:not([data-simulation-hours])').forEach(el=>{
  const keys=el.dataset.path.split('.'),field=keys.at(-1),relicField=keys[0]==='gear'&&field==='relics';
  const update=()=>{
   const owner=keys.slice(0,-1).reduce((value,key)=>value[key],state);
   if(keys[0]==='masteries')owner[field]=masteryRank(keys[1],el.value);
   else if(el.type==='checkbox')owner[field]=el.checked;
   else if(['manual.hotSetting','manual.enemySelection'].includes(el.dataset.path))owner[field]=el.value;
   else owner[field]=relicField?Math.max(1,Number(el.value)):Number(el.value);
   if(keys[0]==='gear'&&field==='id'){
    if(gearRelicLimit(owner.id))owner.relics=1;
    else delete owner.relics;
   }
   state=normalize(state);
   if(keys[0]==='masteries')rememberSkillMasteries(state,state.style);
   save();
  };
  if(el.type==='number'){
   el.oninput=()=>{
    if(el.value===''||!Number.isFinite(el.valueAsNumber))return;
    update();renderResults();
    if(keys[0]==='gear'){
     const slot=keys[1],gear=gearDetails(slot,equippedItemId(state.gear[slot]));
     el.closest('.gear-row').querySelector('small.gear-stats').textContent=gearSummary(slot,gear);
    }
   };
   el.onblur=()=>{
    if(!relicField||el.value!=='')update();
    const value=keys.reduce((owner,key)=>owner[key],state);
    el.value=keys[0]==='masteries'?masteryValue(keys[1],value):value;
    renderResults();
   };
  }else el.onchange=()=>{update();render();document.querySelector(`[data-path="${el.dataset.path}"]`)?.focus();};
 });
 renderDebug(language,{applyCombat:applyCharacterImport,applyEnhancement:applyEnhancementImport,refresh:render});
 $('#import-character').onclick=()=>runCharacterImport();updateImportStatus();
 $('#search').oninput=e=>{query=e.target.value;renderResults();};
 $('#rerun-combat').onclick=()=>{scheduleSimulation(true);renderResults();};
 $('thead').onclick=e=>{const button=e.target.closest('[data-sort]');if(!button)return;const key=button.dataset.sort;sortDirection=key===sort&&sortDirection==='asc'?'desc':'asc';sort=key;renderResults();};
 renderGathering(language,{isActive:activeSection==='gather'});
 renderCrafting(language,{isActive:activeSection==='craft'});
 renderEnhancement(language);
 bindSimulationPanel('combat',renderResults,()=>{
  const {enemySelection,simulationHours,hotSetting}=defaults().manual;
  Object.assign(state.manual,{enemySelection,simulationHours,hotSetting});
  save();render();
 });
 mountItemPrices(language);
 mountAppreciation(language);
 renderMastery(language);
 renderForecast(language,esc);
 renderFormulas({isActive:activeSection==='formulas'});
 if(activeSection==='usage')mountUsageDashboard($('#usage-section'),language);
 renderResults();
 setCharacterImportPage(activeSection);
 if(activeSection==='boss-feed')showBossFeed();
 unmountScrollLayout=mountScrollLayout();
 for(const [id,open]of openDetails){const el=document.getElementById(id);if(el)el.open=open;}
}
function renderResults(){const openLevels=new Set([...document.querySelectorAll('#rows details.level-detail[open]')].map(el=>el.closest('tr').dataset.enemy));$('thead tr').innerHTML=enemyHeaders();scheduleSimulation();const r=calculate(state),stats=r.stats;
 const openBosses=new Set([...document.querySelectorAll('#world-bosses details[open]')].map(el=>el.closest('tr').dataset.boss));
 const bosses=calculateWorldBosses(r.player);
 $('#world-bosses').innerHTML=renderWorldBosses(bossSort?sortEnemies(bosses,bossSort,bossSortDirection):bosses,{language,sort:bossSort,direction:bossSortDirection,open:openBosses});
 $('#style-badge').textContent=t(stats.style);$('#stats').innerHTML=[['maxhit',stats.hit],['accuracy',stats.accuracy],['evasion',stats.evasion],['hp',stats.hp],['strength',stats.strength],['speed',`${stats.seconds.toFixed(2)} <small>${t('second')}</small>`]].map(([k,v])=>`<div class="stat ${k==='maxhit'?'primary':''}"><span>${t(k)}</span><strong>${v}</strong></div>`).join('');
 $('#issues').innerHTML=r.issues.length?`<div class="issue-box"><strong>${t('warnings')}</strong>${r.issues.map(i=>`<p>${t(i.slot)}: ${i.kind==='level'?`${t('levelIssue')} ${t(i.skill)} ${i.level}`:t(i.kind==='style'?'styleIssue':i.kind==='twoHanded'?'twoHanded':'missing')}</p>`).join('')}</div>`:'';
 const q=query.trim().toLocaleLowerCase();let rows=r.rows.filter(m=>(!q||`${m.name} ${dict[m.name]||''}`.toLocaleLowerCase().includes(q)));
 rows=sortEnemies(rows,sort,sortDirection,m=>sort==='movingRatio'?(hourly.get(m.key)?.elapsedTicks?hourly.get(m.key).extraTicks/hourly.get(m.key).elapsedTicks:null):simulationSortKeys.has(sort)?valuedResult(hourly.get(m.key))?.[sort]:m[sort]);updateSorting();
 $('#rows').innerHTML=rows.length?rows.map(m=>`<tr data-enemy="${esc(m.key)}"><td class="column-highlight">${levelCell(m,openLevels.has(m.key))}</td>${hourlyCells(m)}</tr>`).join(''):`<tr><td colspan="${visibleEnemyColumns().length}" class="empty-results">${t('emptyResults')}</td></tr>`;
}

Object.assign(copy.zh,{combatMethodNote:'击杀次数、攻击次数、额外耗时、经验及食物消耗来自<strong class="simulation-caveat">原始模拟</strong>；金币、普通与稀有掉落为基于本次模拟机会的<strong class="simulation-caveat">数学期望</strong>；食物成本按模拟消耗、药剂成本按所选时长计算，收入与利润结合物品价格推算。',movingShare:'额外耗时',killsHour:'击杀次数/天',xpHour:'经验/天',coinsHour:'金币/天',normalHour:'普通掉落/天',rareHour:'稀有掉落/天',totalIncomeHour:'收入/天',profitHour:'利润/天',foodHour:'消耗品/天',simulating:'正在逐刻模拟',simulationError:'战斗模拟失败，请刷新重试',deathTrials:'死亡试验'});
Object.assign(copy.en,{combatMethodNote:'Kills, attack attempts, extra time, XP and food consumption come from the <strong class="simulation-caveat">original simulation</strong>; coins, normal and rare drops are <strong class="simulation-caveat">mathematical expectations</strong> based on the opportunities in this run. Food cost uses simulated consumption; potion cost uses the selected duration. Income and profit are derived using item prices.',movingShare:'Extra time',killsHour:'Kills/day',xpHour:'XP/day',coinsHour:'Coins/day',normalHour:'Normal drops/day',rareHour:'Rare drops/day',totalIncomeHour:'Income/day',profitHour:'Profit/day',foodHour:'Consumables/day',simulating:'Simulating combat ticks',simulationError:'Combat simulation failed; refresh to retry',deathTrials:'Trials ending in death'});
let simulationSignature='',simulationWorker=null,simulationTimer=null,simulationError=false,hourly=new Map(),simulationNow=null,simulationSeed=null;
function stopSimulation(){
 clearTimeout(simulationTimer);
 simulationTimer=null;
 simulationWorker?.terminate();
 simulationWorker=null;
}
function scheduleSimulation(force=false){
 const signature=JSON.stringify({...state,masteriesBySkill:undefined,manual:{...state.manual,vendorValues:undefined,valuationMode:undefined}});
 if(force||signature!==simulationSignature){
  stopSimulation();
  simulationSignature=signature;hourly=new Map();simulationError=false;simulationNow=null;simulationSeed=null;
 }
 if(activeSection!=='combat')return;
 simulationNow??=Date.now();
 const monsters=selectedEnemies(state.manual.enemySelection).monsters;
 if(simulationTimer===null&&simulationWorker===null&&!simulationError&&hourly.size<monsters.length){
  simulationTimer=setTimeout(()=>{
   simulationTimer=null;
   try{
    simulationSeed??=randomSimulationSeed();
    const simulationState=JSON.parse(signature);
    const worker=new Worker(new URL('./simulation-worker.js',import.meta.url),{type:'module'});
    simulationWorker=worker;
    worker.onmessage=({data})=>{
     if(worker!==simulationWorker)return;
     if(data.error)simulationError=data.error;
     if(data.result)hourly.set(data.result.key,data.result);
     if(data.done||data.error)stopSimulation();
     renderResults();
    };
    worker.onerror=()=>{
     if(worker!==simulationWorker)return;
     simulationError=true;stopSimulation();renderResults();
    };
    worker.postMessage({state:simulationState,enemySelection:simulationState.manual.enemySelection,now:simulationNow,seed:simulationSeed,completedEnemies:[...hourly.keys()]});
   }catch(error){simulationError=String(error?.message??error);stopSimulation();renderResults();}
  },180);
 }
 const hotPanel=$('#combat-hot-schedule');
 if(hotPanel){try{hotPanel.innerHTML=state.manual.hotSetting==='current'?simulationHotMarkup(simulationNow,state.manual.simulationHours,language,esc):state.manual.hotSetting==='game'?'<p class="micro">'+(language==='zh'?'沿用游戏内置预测的热门加成规则。':'Uses the hot bonus rules of the in-game predictor.')+'</p>':'';}catch(error){hotPanel.textContent=(language==='zh'?'预测失败：':'Forecast failed: ')+(error.message==='invalidTime'?(language==='zh'?'设备时间无效或早于游戏时间纪元。':'Invalid device time or time before the game epoch.'):String(error.message||error));}}
 const status=$('#simulation-status');
 if(status){
  status.hidden=!simulationError&&hourly.size===monsters.length;
  status.textContent=status.hidden?'':simulationError?t('simulationError')+' · '+simulationError:t('simulating')+' · '+hourly.size+'/'+monsters.length+' · '+state.manual.simulationHours+'h · '+(language==='zh'?'按设置选择仓库 · 食物充足':'Configured depot · plentiful food')+' · '+(state.manual.hotSetting==='current'?(language==='zh'?'按当前时间':'Current-time hot bonuses'):state.manual.hotSetting==='game'?(language==='zh'?'沿用游戏设置':'Game hot settings'):(language==='zh'?'不计入热门':'Hot bonuses excluded'));
 }

}
const formatDropQuantity=n=>{const value=rewardAmount(n,'day',state.manual.simulationHours),locale=language==='zh'?'zh-CN':'en';if(value===0)return '0';if(value<0.1)return '1/'+(1/value).toLocaleString(locale,{maximumFractionDigits:0});const digits=value>=10?0:2;return value.toLocaleString(locale,{minimumFractionDigits:digits,maximumFractionDigits:digits});};
const formatRate=(n,metric='count')=>{if(n===null)return language==='zh'?'未完整定价':'Incomplete pricing';const value=rewardAmount(n,'day',state.manual.simulationHours);if(['xp','coins'].includes(metric)){const compact=compactNumber(value);if(compact!==null)return compact;}const digits=['xp','coins','attempts'].includes(metric)?0:1;return value.toLocaleString(language==='zh'?'zh-CN':'en',{minimumFractionDigits:digits,maximumFractionDigits:digits});};
function lootDetails(items,drop=false){return Object.entries(items).sort((a,b)=>b[1]-a[1]).map(([id,qty])=>{const tier=game.itemTier(Number(id)),base=game.item(game.baseItemId(Number(id)));const p=pageValuation('combat',getSnapshot())(id,drop?'drops':'consumables');const note=game.isPet(Number(id))?'':' '+(p.fallback?'<span title="'+(language==='zh'?'部分物品缺价，按 0 估值':'Some items are missing prices and valued at zero')+'">⚠</span> ':'')+formatUnitPrice(p.price,language);return '<div class="loot-line"><span>'+esc(name(base.name))+(tier?' · '+t('rarity')[tier]:'')+note+'</span><span>'+(drop?formatDropQuantity(qty):formatRate(qty))+'</span></div>';}).join('');}

function depotCell(monster){
 const result=hourly.get(monster.key);
 if(!result)return simulationError?'!':'…';
 if(result.homeBank===null)return '—';
 if(game.world.siteById.get(result.homeBank)?.look==='depths-chest')return language==='zh'?'地牢储物箱':'Dungeon storage chest';
 return (language==='zh'?'仓库 ':'Depot ')+result.homeBank;
}
function levelCell(monster,open=false){
 const fields=[['health',monster.hp],['damage',monster.max],['chance',(monster.chance*100).toFixed(2)+'%'],['enemyDamage',monster.enemyMax??'—'],['enemyChance',monster.enemyChance===null?'—':(monster.enemyChance*100).toFixed(2)+'%']];
 return `<details id="enemy-level-${esc(monster.key)}" class="reward-detail level-detail"${open?' open':''}><summary><span class="enemy-name"><span><strong>${esc(name(monster.name))}</strong><small>${esc(t('level'))} ${monster.level}</small></span></span></summary><div>${fields.map(([label,value])=>`<div class="loot-line"><span>${esc(t(label))}</span><span>${esc(value)}</span></div>`).join('')}</div></details>`;
}
function valuedResult(result){try{const snapshot=getSnapshot(),price=pageValuation('combat',snapshot);return valueCombatRewards(result,snapshot,{rewards:id=>price(id,'drops'),consumables:id=>price(id,'consumables')});}catch(error){return result?{...result,normalValue:null,rareValue:null,totalIncome:null,profit:null,foodCost:null,potionCost:null,consumableCost:null,valuationError:error.message}:result;}}
function priceWarning(missing){return missing?.length?'<span title="'+(language==='zh'?'部分物品缺价，按 0 估值':'Some items are missing prices and valued at zero')+'" aria-label="'+(language==='zh'?'缺价':'Unset price')+'">⚠</span> ':'';}
function hourlyCells(monster){
 const arrange=cells=>[cells[2],cells[6],cells[8],cells[1],cells[0],cells[3],cells[4],cells[5],cells[7]].join('');
 const r=valuedResult(hourly.get(monster.key));if(!r)return arrange(Array.from({length:9},(_,i)=>'<td class="hourly-muted'+((i===2||i===6||i===8)?' column-highlight':'')+'">'+(i===1?'<details class="reward-detail"><summary>'+(simulationError?'!':'…')+'</summary><div>'+esc(t('depot')+': '+depotCell(monster))+'</div></details>':(simulationError?'!':'…'))+'</td>'));
 const detail=(value,body,metric='count',missing=[])=>'<details class="reward-detail"><summary>'+priceWarning(missing)+formatRate(value,metric)+'</summary><div>'+body+'</div></details>';
 const runNote=timingDetails(r,language,language==='zh'?'战斗耗时':'Combat time')+'<br>'+esc(t('depot')+': '+depotCell(monster))+'<br>'+esc((language==='zh'?'补给次数：':'Restocks: ')+r.restocks);

 const xp=Object.entries(r.bySkill).map(([skill,value])=>t(skill)+': '+formatRate(value,'xp')).join('<br>');
 const stopNote=r.valuationError?(language==='zh'?'价格估值溢出，无法可靠计算':'Price valuation overflow; cannot calculate reliably'):r.deaths?(language==='zh'?'阵亡，已停止':'Died; stopped'):r.endedEarly?(language==='zh'?'路线提前结束':'Route ended early'):'';
 return arrange(['<td>'+detail(r.kills,(language==='zh'?'攻击次数/天：':'Attack attempts/day: ')+formatRate(r.attacks,'attempts'),'attempts')+'</td>', '<td><details class="reward-detail"><summary>'+(r.elapsedTicks?formatOneDecimal(r.extraTicks/r.elapsedTicks*100,language)+'%':'—')+'</summary><div>'+runNote+'</div></details>'+(stopNote?'<small class="death-note">'+stopNote+'</small>':'')+'</td>', '<td class="column-highlight">'+detail(r.xp,xp||'0','xp')+'</td>', '<td>'+formatRate(r.coins,'coins')+'</td>', '<td>'+detail(r.normalValue,lootDetails(r.normalItems,true)||'0','coins',r.normalMissingPrices)+'</td>', '<td>'+detail(r.rareValue,lootDetails(r.rareItems,true)||'0','coins',r.rareMissingPrices)+'</td>', '<td class="column-highlight">'+priceWarning(r.missingPrices)+formatRate(r.totalIncome,'coins')+'</td>', '<td>'+detail(r.consumableCost,(language==='zh'?'食物成本：':'Food cost: ')+priceWarning(r.foodMissingPrices)+formatRate(r.foodCost,'coins')+'<br>'+(lootDetails(r.foodItems??{})||'0.0')+'<br>'+(language==='zh'?'药剂成本：':'Potion cost: ')+priceWarning(r.potionMissingPrices)+formatRate(r.potionCost,'coins')+'<br>'+(lootDetails(r.potionItems??{})||'0.0'),'coins',r.consumableMissingPrices)+'</td>', '<td class="column-highlight">'+priceWarning(r.profitMissingPrices)+formatRate(r.profit,'coins')+'</td>']);
}
function updateImportStatus(){
 const button=$('#import-character'),status=$('#import-status');if(!button||!status)return;
 button.disabled=importBusy;
 status.textContent=importStatusText(language,importStatus,importBusy);
 if(importBusy||!importStatus||importStatus.error||importStatus.ready)return;
 const warnings=importStatus.warnings??[];
 if(warnings.length){const warning=document.createElement('span');warning.className='import-warning';warning.textContent=importWarningText(language,warnings);status.append(warning);}
 if(!saveOK)status.append(document.createTextNode(' · '+t('saveFail')));
}
function applyCharacterImport(configuration){
 const result=importCharacter(state,configuration);
 state=result.state;save();importStatus={...result,capturedAt:configuration.capturedAt};
 return {...importStatus,saveOK};
}
function runCharacterImport(){return combatUpdater.read();}
const combatUpdater=registerCharacterUpdates('combat',{
 busy:()=>importBusy,revision:()=>JSON.stringify(state),
 onBusy:value=>{importBusy=value;updateImportStatus();},
 apply:snapshot=>{const result=applyCharacterImport(snapshot);render();return result.saveOK;},
 onError:error=>{importStatus={error:error.message};updateImportStatus();},
});
render();
setInterval(()=>updateForecast(esc),1000);
probeCharacter().then(()=>{if(!importStatus){importStatus={ready:true};updateImportStatus();}}).catch(error=>{if(!importStatus){importStatus={error:error.message};updateImportStatus();}});

subscribe(change=>{if(change.prices||change.market)renderResults();});

startAutomaticPriceImport(()=>language);
