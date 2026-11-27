import {bindSimulationPanel,pageValuation,simulationPanel} from './page-prices.js';
import {timingDetails} from './activity-timing.js';
import {configuredWorkEquipment,packmasterEffectsNote,workOutfitNote} from './work-config-effects.js';
import {potionEffectNote} from './potion-effects.js';
import {bonusPercent,compactNumber,formatOneDecimal,formatUnitPrice} from './number-format.js';
import {getSnapshot,subscribe} from './price-service.js';
import {valueCombatRewards} from './item-prices.js';
import * as game from './upstream.js';
import {translatedName,translatedItemName} from './i18n.js';
import {masteryValue,masteryRank,sortEnemies} from './model.js';
import {bindSimulationHours,simulationHoursField} from './simulation-hours-control.js';
import {simulationHotMarkup,rewardAmount} from './combat-hot.js';
import {randomSimulationSeed} from './simulation-seed.js';
import {rememberSkillMasteries,switchSkillMasteries} from './character-masteries.js';
import {worldBuffWarningText} from './world-buffs.js';
import {registerCharacterUpdates,characterImportPanel,probeCharacter,importStatusText} from './import-controls.js';
import {workEnhancementLimit,workEquipmentSlots,gatheringStorageKey,gatheringDefaults,normalizeGathering,gatheringSkills,toolSlots,slotItems,gatheringGear,gatheringPotions,gatheringRooms,gatheringMasteries,gatheringPerks,selectedGatheringJobs,gatheringStats,gatheringJobStats,importGathering} from './gathering-model.js';

let state=gatheringDefaults(),language='zh',query='',sort='levelReq',direction='desc',saveOK=true,status=null,busy=false,probeStarted=false,active=false;
let worker=null,timer=null,signature='',current=null;
export const getGatheringConfig=()=>structuredClone(state);
const detailState=new Map();
try{const saved=localStorage.getItem(gatheringStorageKey);if(saved)state=normalizeGathering(JSON.parse(saved));}catch{status={error:'savedGatheringInvalid'};}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(zh,en)=>language==='zh'?zh:en;
const name=s=>translatedName(s,language);
const skillName=k=>name({mining:'Mining',fishing:'Fishing',woodcutting:'Woodcutting',thieving:'Thieving'}[k]);
const skillIcons={
 mining:'<path d="M5 3c7-1 12 4 14 10M9 5l-6 14 3 2 7-14M4 3l3 1"/>',
 fishing:'<path d="M16 12c-3-6-9-6-13 0 4 6 10 6 13 0Zm0 0 5-5v10l-5-5M8 8l3-4 3 4M8 16l3 4 3-4"/><circle cx="6" cy="11" r=".7" fill="currentColor" stroke="none"/>',
 woodcutting:'<path d="m12 8-7 13 3 1 7-13M10 4l6 3 5-2-1 8-9-4Z"/>',
 thieving:'<path d="m8 3 2 5h4l2-5H8Zm2 5C6 11 4 14 4 17c0 3 3 4 8 4s8-1 8-4c0-3-2-6-6-9M9 8h6"/><circle cx="12" cy="15" r="2.5"/>'
};
const skillIcon=k=>`<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${skillIcons[k]}</svg></span>`;
const rarities=()=>text(['普通','罕见','稀有','史诗','传说'],['Normal','Uncommon','Rare','Epic','Legendary']);
const options=(arr,value)=>arr.map(([v,label])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const select=(key,label,choices,value=state[key])=>`<label class="potion"><span>${esc(label)}</span><select data-gather-field="${key}" aria-label="${esc(label)}">${options(choices,value)}</select></label>`;
const field=(key,label,value,min=0,max=Number.MAX_SAFE_INTEGER,step=1)=>`<label class="number-field"><span>${esc(label)}</span><input data-gather-field="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(label)}"></label>`;
// The 0.1 spinner step must not reject captured or manually entered fractions.
const validNumberInput=el=>['weeklyXp','worldRarity'].includes(el.dataset.gatherField)
 ?el.value===''||Number.isFinite(el.valueAsNumber)&&el.valueAsNumber>=0&&el.valueAsNumber<=1e7
 :el.checkValidity();
const check=(key,label)=>`<label class="check"><span>${esc(label)}</span><input type="checkbox" data-gather-field="${key}" ${state[key]?'checked':''}></label>`;
const section=(id,label,html)=>`<details class="config-detail" id="gather-${id}"><summary>${esc(label)}</summary>${html}</details>`;
const format=(value,digits=1)=>value.toLocaleString(language==='zh'?'zh-CN':'en',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const amount=(value,metric='count')=>{if(value===null)return text('未完整定价','Incomplete pricing');const scaled=rewardAmount(value,'day',state.simulationHours);const compact=['xp','coins','value'].includes(metric)?compactNumber(scaled):null;return compact??format(scaled,['xp','coins','value'].includes(metric)?0:1);};
const minutes=ticks=>format(ticks*game.tickMs/60000,2);
const errorText=code=>({invalidTime:text('设备时间无效','Invalid device time'),invalidDuration:text('模拟时长无效','Invalid duration'),noSites:text('没有有效采集点','No valid gathering sites'),invalidSite:text('采集点无效','Invalid gathering site'),invalidRoute:text('无法建立采集路线','Could not start a gathering route'),levelTooLow:text('等级不足','Level too low'),unreachable:text('无法到达采集点或仓库','Unreachable site or depot'),'routeStopped:unreachable':text('路线不可达，未生成结果','Route unreachable; no result was published'),'routeStopped:storageFull':text('仓库已满，路线停止','Storage full; route stopped')}[code]??code);
function save(){try{localStorage.setItem(gatheringStorageKey,JSON.stringify(state));saveOK=true;}catch{saveOK=false;}}
function rememberDetails(root='#gather-section'){document.querySelectorAll(root+' details[id]').forEach(el=>detailState.set(el.id,el.open));}
function restoreDetails(){for(const [id,open]of detailState){const el=document.getElementById(id);if(el)el.open=open;}document.querySelectorAll('#gather-section details[id]').forEach(el=>el.ontoggle=()=>detailState.set(el.id,el.open));}
function workEquipmentNote(slot){
 const equipment=configuredWorkEquipment(state.gear);
 if(slot==='body'&&state.gear.body.id===game.packmasterCoatId)return packmasterEffectsNote(equipment,language);
 if(slot==='earring')return text('钥匙掉率','Key drop chance')+' '+bonusPercent(game.worldEarringBonus(equipment,'keyfinder'),language);
 return slot==='shield'?text('当前技能速度','Current skill speed')+' +'+format(game.skillOffhandBonus(equipment,state.skill)*100,2)+'%'
  :workOutfitNote(equipment,state.skill,language,slot);
}
function gearRow(slot){const v=state.gear[slot],label=name({pickaxe:'Pickaxe',rod:'Fishing rod',axe:'Axe',gloves:'Gloves',amulet:'Amulet',mount:'Mount',shield:'Off-hand',helmet:'Head',body:'Body',legs:'Legs',earring:'Earring'}[slot]);const g=v.id?gatheringGear(slot,game.encode(game.withRarity(v.id,v.tier),v.plus)):null;
 return `<div class="gear-row"><label class="gear-name"><span>${esc(label)}</span><select data-gather-field="gear.${slot}.id" aria-label="${esc(label)}">${options([[0,text("无",'None')],...slotItems(slot).map(x=>[x.itemId,name(game.item(x.itemId).name)])],v.id)}</select></label><div class="gear-mods"><select data-gather-field="gear.${slot}.tier" aria-label="${esc(label)} ${text('稀有度','Rarity')}" ${!v.id||!game.itemSupportsRarity(v.id)?'disabled':''}>${options(rarities().map((x,i)=>[i,x]),v.tier)}</select><label class="enhance"><span>+</span><input data-gather-field="gear.${slot}.plus" type="number" min="0" max="${workEnhancementLimit(v.id)}" step="1" value="${v.plus}" aria-label="${esc(label)} ${text('强化','Enhance')}" ${!v.id||!game.canEnhance(v.id)?'disabled':''}></label></div><small class="gear-stats">${g?esc((workEquipmentSlots.includes(slot)||slot==='earring')?workEquipmentNote(slot):slot==='amulet'?`${text('幸运','Luck')} +${format(g.luck??0,2)}`:`${slot==='mount'?text('移动速度','Movement speed'):text('工具速度','Tool speed')} +${format((g.bonus??0)*100,2)}%`):'—'}</small></div>`;
}
function houseDescription(room){const label=room.bonus.kind==='gatherSpeed'?`${skillName(room.bonus.skill)}${text('速度',' speed')}`:text('稀有掉落概率','Rare-find chance');return `${label} · ${text('每级','per level')} +${format(game.houseBonus(room,1)*100,2)}% · ${text('当前','current')} +${format(game.houseBonus(room,state.house[room.id])*100,2)}%`;}
const detailLine=(label,value)=>`<div class="loot-line"><span>${label}</span><span>${value}</span></div>`;
function detail(id,summary,html){return `<details class="reward-detail" id="gather-${id}"><summary>${summary}</summary><div>${html}</div></details>`;}
function priceWarning(missing){return missing?.length?`<span title="${text('部分物品缺价，按 0 估值','Some items are missing prices and valued at zero')}" aria-label="${text('缺价','Unset price')}">⚠</span> `:'';}
function priceNote(id,group){if(game.isPet(Number(id)))return '';const p=pageValuation('gather',getSnapshot())(id,group);return (p.fallback?`<span title="${text('部分物品缺价，按 0 估值','Some items are missing prices and valued at zero')}">⚠</span> `:'')+formatUnitPrice(p.price,language);}
function expectedQuantity(value){if(value===0)return '0';if(value<.1)return '1/'+format(1/value,0);const digits=value>=10?0:2;return value.toLocaleString(language==='zh'?'zh-CN':'en',{minimumFractionDigits:digits,maximumFractionDigits:digits});}
function methodNote(){return (state.discardGathered?text('已开启丢弃采集物：产物及收入仅计入已存放与期末未丢弃的机会期望，已丢弃部分不估值；特殊奖励按各自规则保留。','Discard gathering is enabled: items and income include only stored and end-of-run retained opportunity expectations. Discarded items have no value; special rewards follow their own rules.')+'<br>':'')+text('采集次数、额外耗时、经验、回仓及偷窃被抓和停顿来自<strong class="simulation-caveat">原始模拟</strong>；金币按本次模拟成功次数计算，主要产物与额外掉落为基于本次模拟机会的<strong class="simulation-caveat">数学期望</strong>，活动礼盒仍按原始模拟统计；收入结合物品价格推算，利润扣除按所选时长计算的药剂成本。','Gather counts, extra time, XP, banking, catches and stuns come from the <strong class="simulation-caveat">original simulation</strong>; coins use successful actions in this run, while main products and extra drops are <strong class="simulation-caveat">mathematical expectations</strong> based on its opportunities. Event boxes still use simulated counts. Income uses item prices; profit deducts potion costs based on the selected duration.');}
function itemDetail(items){return Object.entries(items).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,qty])=>`<div class="gather-item"><span>${esc(translatedItemName(Number(id),language))} · ${rarities()[game.itemTier(Number(id))]} ${priceNote(id,'products')}</span><span>${expectedQuantity(rewardAmount(qty,'day',state.simulationHours))}</span></div>`).join('')||text('无','None');}
function potionDetail(items){return Object.entries(items).map(([id,qty])=>`<div class="loot-line"><span>${esc(translatedItemName(Number(id),language))} · ${rarities()[game.itemTier(Number(id))]} ${priceNote(id,'consumables')}</span><span>${format(rewardAmount(qty,'day',state.simulationHours),1)}</span></div>`).join('')||'0.0';}
function siteDetails(job,result){return result?detailLine(text('初始仓库','Starting depot'),result.homeBank):'';}
const periodSuffix=()=>text('/天','/day');
function headers(){const suffix=periodSuffix(),entries=[[text('任务','Task'),'levelReq'],[text('经验','XP')+suffix,'xp'],[text('收入','Income')+suffix,'totalIncome'],[text('利润','Profit')+suffix,'profit'],[text('额外耗时','Extra time'),'movingRatio'],[text('采集次数','Gathering')+suffix,'completed'],[text('金币','Coins')+suffix,'coins'],[text('主要产物','Main items')+suffix,'normalValue'],[text('额外掉落','Extra drops')+suffix,'rareValue'],[text('消耗品','Consumables')+suffix,'potionCost']];
 return entries.map(([label,key])=>`<th aria-sort="${sort===key?(direction==='asc'?'ascending':'descending'):'none'}"><button class="sort-header" data-gather-sort="${key}">${label} <span class="sort-arrow">${sort===key?(direction==='asc'?'↑':'↓'):'↕'}</span></button></th>`).join('');
}
function renderStatus(){const worldWarnings=(status?.warnings??[]).filter(w=>w==='worldBuffs.upgrade'||w==='weeklyXp.reset'),warnings=(status?.warnings??[]).filter(w=>!worldWarnings.includes(w));const el=document.getElementById('gather-import-status');if(el){el.textContent=importStatusText(language,status,busy)+(warnings.length?`\n${text('以下字段未导入，已保留原值：','These fields were not imported; previous values were kept: ')}${[...new Set(warnings.map(field=>({skills:text('技能','Skills'),equipment:text('工具与装备','Tools & equipment'),brews:text('药水','Potions'),brewBuckets:text('药水','Potions'),brewTier:text('药水','Potions'),house:text('家园','Home'),masteries:text('精通','Masteries'),perks:text('特权','Perks'),guildBonus:text('公会经验','Guild XP'),guild:text('公会','Guild'),blessing:text('祝福','Blessing'),weeklyXp:text('世界增益经验','World buff XP'),homeBank:text('初始仓库','Starting depot'),ironman:text('铁人模式','Ironman')}[field.split('.')[0]]??text('角色配置','Character build'))))].join(text('、',', '))}`:'')+worldWarnings.map(w=>'\n'+worldBuffWarningText(language,w)).join('');document.getElementById('gather-import').disabled=busy;}}
function valuedResult(result){try{const snapshot=getSnapshot(),price=pageValuation('gather',snapshot);return valueCombatRewards(result,snapshot,{rewards:id=>price(id,'products'),consumables:id=>price(id,'consumables')});}catch(error){return result?{...result,normalValue:null,rareValue:null,totalIncome:null,profit:null,potionCost:null,valuationError:error.message}:result;}}
function renderResults({tableOnly=false}={}){const host=document.getElementById('gather-results');if(!host)return;rememberDetails('#gather-results');
 const jobs=selectedGatheringJobs(state).filter(j=>`${j.name} ${translatedName(j.name,'zh')}`.toLowerCase().includes(query.toLowerCase()));
 const rows=sortEnemies(jobs,sort,direction,j=>sort==='levelReq'?j.levelReq:valuedResult(current?.results.get(j.id))?.[sort]);
 const rewardRow=job=>{const r=valuedResult(current?.results.get(job.id)),error=current?.errors.get(job.id),locked=state.levels[job.skill]<job.levelReq,preview=gatheringJobStats(state,job);const workInfo=[[text('平均采集耗时','Average gathering time'),formatOneDecimal(preview.seconds,language)+' '+text('秒','s')],[text('每刻完成概率','Completion chance per tick'),formatOneDecimal(preview.chance*100,language)+'%']].map(([label,value])=>detailLine(label,value)).join('');
 let cells;
 if(locked||!r){const label=locked?text('等级不足','Level too low'):error?esc(errorText(error)):current?.error?esc(errorText(current.error)):'…';cells=`<td class="column-highlight">${label}</td><td class="column-highlight">${label}</td><td class="column-highlight">${label}</td><td class="hourly-muted">${locked?label:detail(`${job.id}-sites`,label,siteDetails(job))}</td>${Array.from({length:5},()=>`<td class="hourly-muted">${label}</td>`).join('')}`;}
 else{
 const timing=timingDetails(r,language,text('采集耗时','Gathering time'))+detailLine(text('回仓次数','Deposits'),format(r.deposits))+(job.caught?detailLine(text('被抓次数','Caught'),format(r.caught)):'')+siteDetails(job,r);
 cells=`<td class="column-highlight">${detail(`${job.id}-xp`,amount(r.xp,'xp'),detailLine(text('平均单次经验','Average XP per action'),r.completed>0?formatOneDecimal(r.xp/r.completed,language):'—'))}</td><td class="column-highlight">${priceWarning(r.missingPrices)}${amount(r.totalIncome,'value')}</td><td class="column-highlight">${priceWarning(r.profitMissingPrices)}${amount(r.profit,'value')}</td><td>${detail(`${job.id}-sites`,r.movingRatio===null?'—':formatOneDecimal(r.movingRatio*100,language)+'%',timing)}${r.endedEarly?`<small class="death-note">${text('提前停止','Stopped early')}</small>`:''}</td><td>${detail(`${job.id}-completed`,format(rewardAmount(r.completed,'day',state.simulationHours),0),workInfo)}</td><td>${amount(r.coins,'coins')}</td><td>${detail(`${job.id}-normal`,priceWarning(r.normalMissingPrices)+amount(r.normalValue,'value'),itemDetail(r.normalItems))}</td><td>${detail(`${job.id}-rare`,priceWarning(r.rareMissingPrices)+amount(r.rareValue,'value'),itemDetail(r.rareItems))}</td><td>${detail(`${job.id}-potions`,priceWarning(r.potionMissingPrices)+amount(r.potionCost,'value'),detailLine(text('药剂成本','Potion cost'),amount(r.potionCost,'value'))+potionDetail(r.potionItems))}</td>`;
 }
 const jobName=`<span class="enemy-name"><span><strong>${esc(name(job.name))}</strong><small>${text('等级','Level')} ${job.levelReq}</small></span></span>`;
 return `<tr><td class="column-highlight">${job.caught?detail(`${job.id}-level`,jobName,detailLine(text('起始被抓概率','Starting catch chance'),format(preview.caught*100,2)+'%')):`<span id="gather-${job.id}-level">${jobName}</span>`}</td>${cells}</tr>`;
 };
 const running=current?.running,progress=current?.progress;
 const status=document.querySelector('#gather-results .gather-progress');
 const statusText=current?.error?esc(errorText(current.error)):text('正在模拟采集任务','Simulating gathering tasks')+' · '+(progress?`${progress.completed}/${progress.total}`:'…')+' · '+state.simulationHours+'h';
 const rowsHtml=rows.length?rows.map(rewardRow).join(''):`<tr><td colspan="10" class="empty-results">${text('没有匹配的任务','No matching tasks')}</td></tr>`;
 if(tableOnly&&status){
  status.hidden=!running&&!current?.error;
  status.innerHTML=statusText;
  host.querySelector('tbody').innerHTML=rowsHtml;
  restoreDetails();
  return;
 }
 const stats=gatheringStats(state);
 host.innerHTML=`<div class="result-heading"><div><span class="eyebrow">GATHERING OVERVIEW</span><h2>${text('采集属性','Gathering stats')}</h2></div><span class="style-badge">${skillName(state.skill)}</span></div><div class="stats gather-stats">${[[text('技能等级','Skill level'),stats.level],[text('采集速度加成','Gather speed bonus'),`${format(stats.speedBonus*100,2)}%`],[text('幸运加成','Luck bonus'),`${format(stats.luckBonus*100,2)}%`],[text('移动速度','Movement speed'),`${format(stats.moveSpeed,2)}×`],[text("背包格子",'Inventory slots'),stats.capacity]].map(([label,value])=>`<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><section class="panel enemies"><div class="enemies-heading simulation-heading"><h2>${text('采集任务','Gathering tasks')}</h2><p class="simulation-progress gather-progress" role="status" ${!running&&!current?.error?'hidden':''}>${statusText}</p></div><div class="toolbar"><div class="search-wrap"><img class="search-icon" src="/src/assets/search.svg" alt="" width="14" height="14"><input id="gather-search" type="search" value="${esc(query)}" placeholder="${text('搜索任务名称（中 / 英）','Search tasks in English or Chinese')}" aria-label="${text('搜索采集任务','Search gathering tasks')}"></div><button id="gather-rerun" class="secondary rerun-simulation">${text('重新模拟','Rerun simulation')}</button></div><div class="table-scroll"><table class="gather-table"><thead><tr>${headers()}</tr></thead><tbody>${rowsHtml}</tbody></table></div><p class="table-note">${text(state.discardGathered?'初始背包为空，仓库无限，满包丢弃当前任务产物，必要时仍回仓；药水和祝福全程生效。未保留实际库存、队列、级内经验、建设进度、增益到期或账号随机种子。':'初始背包为空，仓库无限，满包回仓；药水和祝福全程生效。未保留实际库存、队列、级内经验、建设进度、增益到期或账号随机种子。',state.discardGathered?'Starts with an empty pack and unlimited storage; drops current task products when full and banks if still needed. Potions and blessing stay active. Actual inventory, queues, within-level XP, construction, buff expiry and account seeds are not preserved.':'Starts with an empty pack and unlimited storage; banks when full. Potions and blessing stay active. Actual inventory, queues, within-level XP, construction, buff expiry and account seeds are not preserved.')} <strong class="simulation-caveat">${text('结果可能与游戏内预测及实际情况不同，单次模拟不代表长期随机期望。','Results may differ from in-game predictions and gameplay; one simulation is not a long-run random expectation.')}</strong> ${text('按全局设置价格估价；未设置价格使用商人价；每种启用药剂按每小时 1 个计费，祝福不计费。','Uses configured prices; unset prices use vendor prices. Each enabled potion costs one item per hour; blessing has no cost.')}<br>${methodNote()}</p></section>`;
 document.getElementById('gather-search').oninput=event=>{query=event.target.value;renderResults({tableOnly:true});};
 document.getElementById('gather-rerun').onclick=()=>startSimulation(true);
 host.querySelectorAll('[data-gather-sort]').forEach(el=>el.onclick=()=>{const key=el.dataset.gatherSort;direction=key===sort?(direction==='asc'?'desc':'asc'):'asc';sort=key;renderResults();});
 restoreDetails();
}
function startSimulation(force=false){
 const next=JSON.stringify({...state,vendorValues:undefined,valuationMode:undefined});
 if(!force&&signature===next){renderResults();return;}
 worker?.terminate();worker=null;clearTimeout(timer);signature=next;
 current={results:new Map(),errors:new Map(),sites:new Map(),running:true,now:Date.now()};
 renderHot();
 const run=current,token=next;
 timer=setTimeout(()=>{
  if(current!==run||signature!==token)return;
  try{run.seed=randomSimulationSeed();worker=new Worker(new URL('./gathering-worker.js',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{if(current!==run||signature!==token)return;if(data.progress){run.progress=data.progress;if(data.progress.site){const arr=run.sites.get(data.progress.jobId)??[];arr.push(data.progress.site);run.sites.set(data.progress.jobId,arr);}}
    if(data.result)run.results.set(data.result.jobId,data.result);if(data.jobError)run.errors.set(data.jobError.jobId,data.jobError.message);if(data.error)run.error=data.error;
    if(data.done||data.error){run.running=false;worker?.terminate();worker=null;}renderResults({tableOnly:true});};
   worker.onerror=event=>{if(current!==run||signature!==token)return;run.error=event.message||text('采集模拟失败','Gathering simulation failed');run.running=false;worker?.terminate();worker=null;renderResults({tableOnly:true});};
   worker.postMessage({state:JSON.parse(token),now:run.now,seed:run.seed});
  }catch(error){run.error=String(error.message??error);run.running=false;renderResults({tableOnly:true});}
 },150);
 renderResults();
}
export function renderGathering(nextLanguage,{isActive=active}={}){
 language=nextLanguage;active=isActive;const host=document.getElementById('gather-content');if(!host)return;rememberDetails();
 const rooms=gatheringRooms.filter(r=>!r.bonus.skill||r.bonus.skill===state.skill);
 const simulation=select('jobSelection',text('任务','Task'),[['all',text('全部','All')],...selectedGatheringJobs({...state,jobSelection:'all'}).sort((a,b)=>b.levelReq-a.levelReq).map(j=>[j.id,name(j.name)])])+`<p class="micro">${text('按初始位置选择最近采集点，与游戏客户端规则一致。','Selects the nearest gathering site from the starting position, following the game client.')}</p>`+simulationHoursField(language,state.simulationHours,'data-gather-field','simulationHours')+select('hotSetting',text('热门加成','Hot bonuses'),[['game',text('沿用游戏设置','Use game settings')],['current',text('按照当前时间','Use current time')],['off',text('不计入','Exclude')]])+'<div id="gather-hot-schedule"></div>';
 host.innerHTML=`<div class="config-column"><aside class="panel config gather-config"><details id="gather-character-panel" class="configuration-disclosure" open><summary><h1>${text('角色配置','Character build')}</h1></summary><button id="gather-reset" class="text-button">${text('清空配置','Reset settings')}</button><p class="muted intro">${text('比较各任务在最近采集点的模拟窗口利润。','Compare task rewards over the simulated window at the nearest site.')}</p>${characterImportPanel(language,{id:'gather-import-settings',statusId:'gather-import-status',buttons:[{id:'gather-import',label:text('导入配置','Import configuration')}]})}<div class="presets gather-skills">${gatheringSkills.map(k=>`<button data-gather-skill="${k}" aria-pressed="${state.skill===k}" class="${state.skill===k?'selected':''}">${skillIcon(k)}${skillName(k)}</button>`).join('')}</div>${section('skills',text('技能','Skills'),`<div class="skill-grid">${gatheringSkills.map(k=>field(`levels.${k}`,skillName(k),state.levels[k],1,game.maxLevel)).join('')}</div>`)}${section('equipment',text('工具与装备','Tools & equipment'),[toolSlots[state.skill],'amulet','mount',...workEquipmentSlots,'earring'].map(gearRow).join('')+`<p class="micro work-outfit-total">${esc(workEquipmentNote())}</p>`)}${section('potions',text('药水','Potions'),gatheringPotions.map(p=>select(`brews.${p.kind}`,name(game.item(p.itemId).name),[[-1,text('未启用','Inactive')],...rarities().map((x,i)=>[i,x])],state.brews[p.kind])+`<p class="micro">${esc(potionEffectNote(p.kind,state.brews[p.kind],language))}</p>`).join(''))}${section('home',text('家园','Home'),rooms.map(r=>field(`house.${r.id}`,name(r.name),state.house[r.id],0,game.houseLevelLimit)+`<p class="micro" data-gather-house-description="${r.id}">${esc(houseDescription(r))}</p>`).join(''))}${section('masteries',text('精通','Masteries'),gatheringMasteries.map(m=>field(`masteries.${m.id}`,name(m.name)+' (%)',masteryValue(m.id,state.masteries[m.id]),0,masteryValue(m.id,game.masteryRankLimit),.5)).join(''))}${section('perks',text('特权','Perks'),gatheringPerks.filter(p=>p.id!=='hands'||state.skill==='thieving').map(p=>field(`perks.${p.id}`,name(p.name),state.perks[p.id],0,p.ranks)+`<p class="micro">${esc(name(p.each))}</p>`).join(''))}${section('other',text('其它','Other'),field('guildXp',text('公会经验 (%)','Guild XP (%)'),state.guildXp,0,1e7,.1)+field('weeklyXp',text('世界增益经验 (%)','World buff XP (%)'),state.weeklyXp,0,1e7,.1)+`<p class="micro">${text('导入捕获时生效的世界增益，整个模拟周期保持生效。','Imports world buffs active at capture; they remain active throughout the simulation.')}</p>`+field('worldRarity',text('世界增益稀有发现 (%)','World buff rare finds (%)'),state.worldRarity,0,1e7,.1)+`<p class="micro">${text('导入捕获时生效的世界增益，整个模拟周期保持生效。','Imports world buffs active at capture; they remain active throughout the simulation.')}</p>`+check('blessing',text('矿脉祝福','Vein Blessing'))+select('homeBank',text('模拟初始仓库位置','Starting depot location'),[[0,text('自动（仓库 1）','Automatic (depot 1)')],...game.world.banks.map(b=>[b.id,`${text('仓库','Depot')} ${b.id} (${b.x}, ${b.y})`])])+check('discardGathered',text('丢弃采集物','Drop what I gather'))+`<p class="micro">${text('满包时才会丢弃，模拟结束时背包可能仍有剩余产物。','Items are discarded only when the pack is full; some may remain when the simulation ends.')}</p>`+check('ironman',text('铁人模式（不掉落坐骑）','Ironman (no mount drops)')))}<p class="save-note">${saveOK?text('● 采集配置独立保存在此浏览器','● Gathering settings saved separately in this browser'):text('浏览器存储不可用，配置无法保存','Browser storage unavailable; settings could not be saved')}</p></details></aside>${simulationPanel('gather',language,`<div id="gather-simulation">${simulation}</div>`)}</div><div class="results" id="gather-results"></div>`;
 bindSimulationPanel('gather',renderResults,()=>{
  const {jobSelection,simulationHours,hotSetting}=gatheringDefaults();
  Object.assign(state,{jobSelection,simulationHours,hotSetting});
  save();renderGathering(language,{isActive:active});
 });
 bindSimulationHours(host.querySelector('[data-simulation-hours]'),hours=>{
  if(state.simulationHours===hours)return;
  state.simulationHours=hours;save();
  if(active)startSimulation();
  else {renderHot();renderResults();}
 });
 host.querySelectorAll('[data-gather-field]:not([data-simulation-hours])').forEach(el=>{const update=()=>{
  if(el.type==='number'&&!validNumberInput(el)){el.reportValidity();return;}
  const key=el.dataset.gatherField,value=el.type==='checkbox'?el.checked:el.value;
  const keys=key.split('.'),last=keys.pop(),target=keys.reduce((obj,k)=>obj[k],state);target[last]=el.type==='checkbox'?value:['jobSelection','hotSetting'].includes(key)?value:Number(value);if(keys[0]==='masteries')target[last]=masteryRank(last,Number(value));
  state=normalizeGathering(state);
  if(keys[0]==='masteries')rememberSkillMasteries(state,state.skill);
  save();renderGathering(language,{isActive:active});
 };
 if(el.type==='number'){el.oninput=()=>{if(el.value===''||!validNumberInput(el))return;const keys=el.dataset.gatherField.split('.'),last=keys.pop(),target=keys.reduce((obj,k)=>obj[k],state);target[last]=keys[0]==='masteries'?masteryRank(last,Number(el.value)):Number(el.value);state=normalizeGathering(state);if(keys[0]==='masteries')rememberSkillMasteries(state,state.skill);save();if(keys[0]==='house'){const room=gatheringRooms.find(r=>r.id===last);host.querySelector(`[data-gather-house-description="${last}"]`).textContent=houseDescription(room);}if(active)startSimulation();else renderResults();};el.onchange=update;}else el.onchange=update;
 });
 host.querySelectorAll('[data-gather-skill]').forEach(el=>el.onclick=()=>{
  const skill=el.dataset.gatherSkill;
  if(state.skill!==skill)gatheringUpdater.invalidate();
  switchSkillMasteries(state,state.skill,skill);
  state.skill=skill;state.jobSelection='all';save();renderGathering(language,{isActive:true});
 });
 document.getElementById('gather-reset').onclick=()=>{
  gatheringUpdater.reset();
  const {skill,jobSelection,simulationHours,hotSetting}=state;
  state={...gatheringDefaults(),jobSelection,simulationHours,hotSetting};
  if(jobSelection!=='all')state.skill=skill;
  status=null;save();renderGathering(language,{isActive:active});
 };
 document.getElementById('gather-import').onclick=()=>gatheringUpdater.read();
 if(!probeStarted){probeStarted=true;probeCharacter().then(()=>{if(!status&&!busy){status={ready:true};renderStatus();}}).catch(error=>{if(!status&&!busy){status={error:error.message};renderStatus();}});}
 if(active)startSimulation();else renderResults();
 renderHot();
 renderStatus();restoreDetails();
}

subscribe(change=>{if(change.prices||change.market)renderResults();});

const gatheringUpdater=registerCharacterUpdates('gather',{
 busy:()=>busy,revision:()=>JSON.stringify(state),
 onBusy:value=>{busy=value;renderStatus();},
 apply:snapshot=>{const {state:imported,...result}=importGathering(state,snapshot);state=imported;status=result;save();renderGathering(language,{isActive:active});return saveOK;},
 onError:error=>{status={error:error.message};renderStatus();},
});

function renderHot(){
 const hot=document.getElementById('gather-hot-schedule');if(!hot)return;try{hot.innerHTML=state.hotSetting==='current'?simulationHotMarkup(current?.now??Date.now(),state.simulationHours,language,esc,state.skill,skillName(state.skill)):state.hotSetting==='game'?`<p class="micro">${text('沿用游戏内置预测的热门规则。','Uses the in-game predictor hot bonus rules.')}</p>`:'';}catch(error){hot.textContent=errorText(error.message);}
}
