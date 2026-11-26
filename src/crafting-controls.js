import {timingDetails} from './activity-timing.js';
import {configuredWorkEquipment,workOutfitNote} from './work-config-effects.js';
import {potionEffectNote} from './potion-effects.js';
import {bindSimulationHours,simulationHoursField} from './simulation-hours-control.js';
import {simulationHotMarkup} from './combat-hot.js';
import {loadCraftingConfig,saveCraftingConfig,resetCraftingConfig} from './crafting-store.js';
import * as game from './upstream.js';
import {translatedName,translatedItemName} from './i18n.js';
import {masteryValue,masteryRank} from './model.js';
import {slotItems,gatheringGear} from './gathering-model.js';
import {getSnapshot,subscribe} from './price-service.js';
import {valuationPrice} from './item-prices.js';
import {compactNumber,formatOneDecimal,formatUnitPrice} from './number-format.js';
import {registerCharacterUpdates,characterImportPanel,probeCharacter,importStatusText} from './import-controls.js';
import {worldBuffWarningText} from './world-buffs.js';
import {randomSimulationSeed} from './simulation-seed.js';
import {rememberSkillMasteries,switchSkillMasteries} from './character-masteries.js';
import {craftingDefaults,craftingTiers,normalizeCrafting,craftingSkills,craftingToolSlots,craftingJobs,craftingPotions,craftingRooms,craftingMasteries,craftingPerks,recipeKey,craftingMaterials,priceItems,craftingJobStats,craftingStats,importCrafting} from './crafting-model.js';

let state=craftingDefaults(),language='zh',query='',group='',sort='levelReq',direction='desc',notice='',importStatus=null,importBusy=false,saveOK=true,active=false,probeStarted=false;
let worker=null,timer=null,renderTimer=null,generation=0,running=false,progress=null,workerError=null,clock=Date.now(),roundSeed=null;
let storageBlocked=false;
const selectedTiers=new Set([0]);
const rateCache=new Map(),details=new Map();
try{state=loadCraftingConfig(localStorage);}catch(error){if(error.craftingState){state=error.craftingState;notice='saveFailed';}else{notice='savedInvalid';storageBlocked=true;}saveOK=false;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(zh,en)=>language==='zh'?zh:en;
const name=s=>translatedName(s,language);
const skillNames={cooking:'Cooking',smithing:'Smithing',fletching:'Fletching',herblore:'Herblore',crafting:'Crafting'};
const skillName=k=>name(skillNames[k]);
const rarities=()=>text(['普通','罕见','稀有','史诗','传说'],['Normal','Uncommon','Rare','Epic','Legendary']);
const format=(n,digits=0)=>n.toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:digits});
const formatResult=value=>compactNumber(value)??format(value,2);
const options=(values,current)=>values.map(([v,label])=>`<option value="${esc(v)}" ${String(v)===String(current)?'selected':''}>${esc(label)}</option>`).join('');
const errors={saveFailed:['制造配置保存失败，当前内存配置仍可使用。','Crafting settings could not be saved; the in-memory build remains usable.'],invalidTime:['设备时间无效','Invalid device time'],invalidDuration:['模拟时长无效','Invalid duration'],savedInvalid:['已保存的制造配置无法读取，当前使用默认配置。','Saved crafting settings could not be read; defaults are shown.'],invalidQuantity:['配方品质或模拟材料数量无效。','Invalid recipe rarity or simulated material quantity.'],quantityOverflow:['模拟数量超出安全计算范围。','Simulated quantity exceeds the safe calculation range.'],priceOverflow:['金额超出安全计算范围，请检查全局物品价格。','Amount exceeds the safe calculation range; check global item prices.'],timeLimit:['达到计算时长上限，模拟未完成。','Reached the computation time limit; simulation is incomplete.'],levelTooLow:['等级不足','Level too low'],noSites:['没有有效制造点','No valid crafting site'],invalidRoute:['无法建立制造路线','Could not start crafting route'],unreachable:['无法到达制造点或仓库','Unreachable crafting site or depot'],'routeStopped:noMaterials':['材料不足，路线停止','Materials depleted; route stopped'],'routeStopped:storageFull':['仓库已满，路线停止','Storage full; route stopped'],'routeStopped:unreachable':['路线不可达','Route unreachable'],routeStopped:['路线提前停止','Route stopped early'],workerFailed:['制造计算失败，请检查浏览器是否支持 Worker。','Crafting computation failed; check browser Worker support.']};
const errorText=code=>(errors[code]??[code,code])[language==='zh'?0:1];
const warn=missing=>missing?.length?`<span title="${text('部分物品未设置价格，采用商人价格计算','Some items have no configured price; vendor prices are used')}" aria-label="${text('缺价','Unset price')}">⚠</span> `:'';
const itemLabel=id=>`${translatedItemName(id,language)} · ${rarities()[game.itemTier(id)]}`;
function save(){try{if(storageBlocked)throw Error('savedInvalid');saveCraftingConfig(localStorage,state);saveOK=true;if(notice==='saveFailed')notice='';}catch{saveOK=false;}renderNotice();}
function renderNotice(){
 const el=document.getElementById('craft-notice');if(el)el.textContent=notice?(errors[notice]?errorText(notice):notice):'';
 const saveEl=document.getElementById('craft-save');if(saveEl)saveEl.textContent=storageBlocked?text('制造存档无法读取，请重置后恢复保存。','Crafting storage could not be read; reset it to restore saving.'):saveOK?text('● 制造配置独立保存在此浏览器','● Crafting settings saved separately in this browser'):text('浏览器存储不可用，制造配置无法保存','Browser storage unavailable; crafting settings could not be saved');
}
function rememberDetails(root){root?.querySelectorAll('details[id]').forEach(el=>details.set(el.id,el.open));}
function restoreDetails(root){root.querySelectorAll('details[id]').forEach(el=>{if(details.has(el.id))el.open=details.get(el.id);el.ontoggle=()=>{if(el.isConnected)details.set(el.id,el.open);};});}
function replaceSiblings(anchor,nextAnchor){
 const siblings=[...nextAnchor.parentNode.children],index=siblings.indexOf(nextAnchor);
 for(const child of [...anchor.parentElement.children])if(child!==anchor)child.remove();
 anchor.before(...siblings.slice(0,index));
 anchor.after(...siblings.slice(index+1));
}
// Keep the focused search or filter control across result updates.
function replaceResults(host,html,keepToolbar){
 rememberDetails(host);const scrolls=[...host.querySelectorAll('.table-scroll')].map(el=>({left:el.scrollLeft,top:el.scrollTop}));const input=host.contains(document.activeElement)&&document.activeElement.matches('input,select')?document.activeElement:null;
 const fragment=document.createElement('template');fragment.innerHTML=html;
 if(input?.id&&!(keepToolbar&&input.closest('.craft-toolbar'))){const replacement=[...fragment.content.querySelectorAll('[id]')].find(el=>el.id===input.id);if(replacement){replacement.replaceWith(input);}}
 const toolbar=keepToolbar&&host.querySelector('.craft-toolbar');
 if(toolbar){
  // Keep the toolbar and its ancestors attached while replacing surrounding content.
  const nextToolbar=fragment.content.querySelector('.craft-toolbar');
  replaceSiblings(toolbar,nextToolbar);
  replaceSiblings(toolbar.parentElement,nextToolbar.parentElement);
 }else host.replaceChildren(fragment.content);
 host.querySelectorAll('.table-scroll').forEach((el,i)=>{if(scrolls[i]){el.scrollLeft=scrolls[i].left;el.scrollTop=scrolls[i].top;}});restoreDetails(host);if(input?.isConnected&&document.activeElement!==input)input.focus({preventScroll:true});
}
const detailLine=(label,value)=>`<div class="loot-line"><span>${label}</span><span>${value}</span></div>`;
function detail(id,summary,body){return `<details class="reward-detail" id="craft-${id}"><summary>${summary}</summary><div>${body}</div></details>`;}
function itemLines(items,prices){
 return Object.entries(items).map(([key,quantity])=>{
  const id=Number(key);
  const {price,fallback}=valuationPrice(id,prices);
  const unitPrice=game.isPet(id)?'':` ${warn(fallback?[id]:[])}${formatUnitPrice(price,language)}`;
  return `<div class="gather-item"><span>${esc(itemLabel(id))}${unitPrice}</span><span>${format(quantity)}</span></div>`;
 }).join('')||text('无','None');
}
function selectedRateJobs(){
 return craftingJobs.filter(job=>job.skill===state.skill&&(!group||job.group===group))
  .flatMap(job=>craftingTiers(job).filter(tier=>selectedTiers.has(tier))
   .map(tier=>({job,tier,key:recipeKey(job.id,tier)})));
}
function visibleJobs(){
 const search=query.toLowerCase();
 return selectedRateJobs().filter(p=>`${p.job.name} ${translatedName(p.job.name,'zh')}`.toLowerCase().includes(search));
}
function rateFor(recipe){const entry=rateCache.get(recipe.key);return entry?.signature===signature(recipe)?entry:null;}
function methodNote(){return text('制造次数、耗时、移动、回仓、经验及材料消耗来自<strong class="simulation-caveat">原始模拟</strong>；普通制造产物按指定稀有度计算，烹饪产物与稀有掉落为基于本次模拟机会的<strong class="simulation-caveat">数学期望</strong>，活动礼盒仍按原始模拟统计；利润结合产物期望、实际材料消耗及物品价格推算，不扣药水成本与市场手续费。装备升级按原始工位路线计时。','Craft counts, elapsed time, movement, banking, XP and material consumption come from the <strong class="simulation-caveat">original simulation</strong>; ordinary products use the selected rarity, while cooking products and rare drops are <strong class="simulation-caveat">mathematical expectations</strong> based on opportunities in this run. Event boxes still use simulated counts. Profit uses expected products, actual material consumption and item prices, excluding potion costs and market fees. Gear upgrades follow the original station route.');}
function rarityFilters(){return `<div class="presets craft-rarity-filters" role="group" aria-label="${text('稀有度筛选','Rarity filter')}">${rarities().map((r,tier)=>`<button type="button" data-craft-rarity="${tier}" aria-pressed="${selectedTiers.has(tier)}" class="${selectedTiers.has(tier)?'selected':''}">${r}</button>`).join('')}</div>`;}
function signature(recipe){
 const skill=recipe.job.skill;return JSON.stringify({simulationHours:state.simulationHours,tier:recipe.tier,level:state.levels[skill],tool:state.gear[craftingToolSlots[skill]],mount:state.gear.mount,workEquipment:['shield','helmet','body','legs'].map(k=>state.gear[k]),brews:state.brews,house:craftingRooms.filter(r=>r.bonus.skill===skill).map(r=>[r.id,state.house[r.id]]),masteries:state.masteries,perks:{pockets:state.perks.pockets,quick:state.perks.quick,hands:skill==='cooking'?state.perks.hands:0},guildXp:state.guildXp,weeklyXp:state.weeklyXp,ironman:state.ironman,blessing:state.blessing,homeBank:state.homeBank,hotSetting:state.hotSetting,clock:state.hotSetting==='current'?clock:null});
}
function sortedJobs(){
 const metric=p=>{if(sort==='levelReq')return p.job.levelReq;try{const r=rateFor(p)?.result;return {xp:r?.xp,completed:r?.completed,movingRatio:r?.elapsedTicks>0?r.extraTicks/r.elapsedTicks:undefined,materialValue:priceItems(craftingMaterials(p.job,p.tier,1),getSnapshot()).value,outputValue:priceItems({[game.withRarity(p.job.output.itemId,p.tier)]:p.job.output.qty},getSnapshot()).value,profit:r?priceItems(r.items,getSnapshot(),{expected:true}).value-priceItems(r.consumed,getSnapshot()).value:undefined}[sort];}catch{return undefined;}};
 return visibleJobs().sort((a,b)=>{const x=metric(a),y=metric(b);if(x===undefined)return y===undefined?String(a.job.id).localeCompare(String(b.job.id))||a.tier-b.tier:1;if(y===undefined)return -1;return (x-y)*(direction==='asc'?1:-1)||String(a.job.id).localeCompare(String(b.job.id))||a.tier-b.tier;});
}
function headers(){const day=text('天','day');return [[text('配方','Recipe'),'levelReq'],[text('经验','XP')+'/'+day,'xp'],[text('利润','Profit')+'/'+day,'profit'],[text('额外耗时','Extra time'),'movingRatio'],[text('制造次数','Crafts')+'/'+day,'completed'],[text('单次材料成本','Material cost / craft'),'materialValue'],[text('单次产物价值','Product value / craft'),'outputValue']].map(([label,key])=>`<th aria-sort="${sort===key?(direction==='asc'?'ascending':'descending'):'none'}"><button class="sort-header" data-craft-sort="${key}">${label} <span class="sort-arrow">${sort===key?(direction==='asc'?'↑':'↓'):'↕'}</span></button></th>`).join('');}
function recipeRow(recipe){
 const {job,tier,key}=recipe,locked=state.levels[job.skill]<job.levelReq;
 const recipeInfo=[[text('单次产量','Output per craft'),format(job.output.qty)],[text('基础经验 / 次','Base XP / craft'),format(job.xp)],...(job.burn?[[text('安全等级','No-burn level'),job.burn.safeAtLevel]]:[])].map(([label,value])=>detailLine(label,value)).join('');
 const lead=`<tr><td class="column-highlight">${detail(`${key}-recipe`,`<span class="enemy-name"><span><strong>${esc(name(job.name))} · ${rarities()[tier]}</strong><small>${text('所需等级','Level')} ${job.levelReq}${locked?`<span class="craft-level-warning">${errorText('levelTooLow')}</span>`:''}</small></span></span>`,recipeInfo)}</td>`;

 try{
  const prices=getSnapshot();
  const materials=craftingMaterials(job,tier,1),cost=priceItems(materials,prices),products={[game.withRarity(job.output.itemId,tier)]:job.output.qty},value=priceItems(products,prices),entry=rateFor(recipe),r=entry?.result,factor=24/state.simulationHours;
  const preview=craftingJobStats(state,job),workInfo=detailLine(text('平均制造耗时','Average crafting time'),formatOneDecimal(preview.seconds,language)+' '+text('秒','s'))+detailLine(text('每刻完成概率','Completion chance per tick'),preview.chance===null?text('固定耗时，无随机完成判定','Fixed duration; no random completion check'):formatOneDecimal(preview.chance*100,language)+'%');
  const unitValues=`<td>${detail(`${key}-cost`,warn(cost.missing)+formatResult(cost.value),itemLines(materials,prices))}</td><td>${detail(`${key}-value`,warn(value.missing)+formatResult(value.value),itemLines(products,prices))}</td>`;
  const label=locked?errorText('levelTooLow'):entry?.error?errorText(entry.error):r?.error?errorText(r.error):text('计算中…','Calculating…');
  const output=r?priceItems(r.items,prices,{expected:true}):null,consumed=r?priceItems(r.consumed,prices):null;
  const profit=r?output.value-consumed.value:0,missing=r?[...output.missing,...consumed.missing]:[];
  return lead+`<td class="column-highlight">${r&&!r.error?detail(`${key}-xp`,formatResult(r.xp*factor),detailLine(text('平均单次经验','Average XP per action'),r.completed>0?formatOneDecimal(r.xp/r.completed,language):'—')):label}</td><td class="column-highlight">${r&&!r.error?warn(missing)+formatResult(profit*factor):label}</td><td>${r&&!r.error?(r.elapsedTicks>0?detail(`${key}-timing`,formatOneDecimal(r.extraTicks/r.elapsedTicks*100,language)+'%',timingDetails(r,language,text('制造耗时','Crafting time'))+detailLine(text('初始仓库','Starting depot'),r.homeBank)+detailLine(text('回仓次数','Deposits'),format(r.deposits??0))):'—'):label}</td><td>${r&&!r.error?detail(`${key}-completed`,format(r.completed*factor),workInfo):label}</td>`+unitValues+'</tr>';
 }catch(error){return lead+['column-highlight','column-highlight','hourly-muted','hourly-muted','hourly-muted','hourly-muted'].map(style=>`<td class="${style}">${esc(errorText(error.message))}</td>`).join('')+'</tr>';}
}
function craftingProgress(){
 const message=workerError?errorText(workerError):text('正在计算','Calculating')+(progress?` · ${progress.completed}/${progress.total}`:'…');
 return `<div class="simulation-progress craft-progress${!running&&!workerError?' is-idle':''}" role="status" title="${esc(message)}">${esc(message)}</div>`;
}
function renderResults({keepToolbar=false}={}){
 const host=document.getElementById('craft-results');if(!host)return;
 const stats=craftingStats(state),jobs=sortedJobs();
 const groups=[...new Set(craftingJobs.filter(j=>j.skill===state.skill).map(j=>j.group))];if(group&&!groups.includes(group))groups.push(group);
 replaceResults(host,`<div class="result-heading"><div><span class="eyebrow">CRAFTING OVERVIEW</span><h2>${text('制造属性','Crafting stats')}</h2></div><span class="style-badge">${skillName(state.skill)}</span></div><div class="stats gather-stats">${[[text('技能等级','Skill level'),format(stats.level)],[text('制造速度加成','Craft speed bonus'),format(stats.speedBonus*100,2)+'%'],[text('经验加成','XP bonus'),format(stats.xpBonus*100,2)+'%'],[text('移动速度','Movement speed'),format(stats.moveSpeed,2)+'×'],[text("背包格子",'Inventory slots'),format(stats.capacity)]].map(([label,v])=>`<div class="stat"><span>${label}</span><strong>${v}</strong></div>`).join('')}</div><section id="craft-recipes-panel" class="panel enemies"><div class="enemies-heading simulation-heading craft-recipe-heading"><div class="craft-recipe-title"><h2>${text('配方选择','Recipe selection')}</h2></div>${craftingProgress()}</div><div class="toolbar craft-toolbar"><div class="craft-search-filters"><div class="search-wrap"><img class="search-icon" src="/src/assets/search.svg" alt="" width="14" height="14"><input id="craft-search" type="search" value="${esc(query)}" placeholder="${text('搜索配方名称（中 / 英）','Search recipes in English or Chinese')}" aria-label="${text('搜索制造配方','Search crafting recipes')}"></div><select id="craft-group" aria-label="${text('配方分类','Recipe group')}">${options([['',text('全部分类','All groups')],...groups.map(g=>[g,name(g)])],group)}</select></div>${rarityFilters()}<button id="craft-rerun" class="secondary rerun-simulation">${text('重新模拟','Rerun simulation')}</button></div><p id="craft-notice" class="table-note" role="status"></p><div class="table-scroll"><table class="gather-table craft-table"><thead><tr>${headers()}</tr></thead><tbody>${jobs.length?jobs.map(recipeRow).join(''):`<tr><td colspan="7" class="empty-results">${text('没有匹配的配方','No matching recipes')}</td></tr>`}</tbody></table></div><p id="craft-method-note" class="table-note">${methodNote()}</p></section>`,keepToolbar);
 bindResults();renderNotice();
}
function bindResults(){
 document.getElementById('craft-search').oninput=e=>{query=e.target.value;renderResults({keepToolbar:true});};
 document.getElementById('craft-group').onchange=e=>{group=e.target.value;refreshTaskSelection();};
 document.querySelectorAll('[data-craft-rarity]').forEach(el=>el.onclick=()=>{const tier=Number(el.dataset.craftRarity);if(selectedTiers.has(tier))selectedTiers.delete(tier);else selectedTiers.add(tier);refreshTaskSelection();});
 document.getElementById('craft-rerun').onclick=()=>{schedule();renderResults();};
 document.querySelectorAll('[data-craft-sort]').forEach(el=>el.onclick=()=>{const key=el.dataset.craftSort;direction=sort===key&&direction==='asc'?'desc':'asc';sort=key;renderResults();});
}
function stopWorker(){clearTimeout(renderTimer);renderTimer=null;generation++;worker?.terminate();worker=null;running=false;progress=null;}
// Filtering keeps the run's time, seed and completed caches; only unfinished work is cancelled.
function refreshTaskSelection(){
 stopWorker();clearTimeout(timer);
 if(active)timer=setTimeout(()=>{timer=null;startSimulation();},0);
 renderResults();
}
function pendingRecipes(){
 return selectedRateJobs().filter(p=>state.levels[p.job.skill]>=p.job.levelReq&&!rateFor(p));
}
function schedule(){stopWorker();clearTimeout(timer);workerError=null;roundSeed=null;clock=Date.now();renderHot();rateCache.clear();if(active)timer=setTimeout(startSimulation,180);}
function startSimulation(){
 if(workerError)return;
 clearTimeout(timer);timer=null;const recipes=pendingRecipes();
 if(!recipes.length){renderResults({keepToolbar:true});return;}stopWorker();const token=generation,signatures=new Map(recipes.map(p=>[p.key,signature(p)]));running=true;workerError=null;
 try{
  roundSeed??=randomSimulationSeed();
  worker=new Worker(new URL('./crafting-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{if(token!==generation)return;
   if(data.result)rateCache.set(data.result.key,{signature:signatures.get(data.result.key),result:data.result});
   if(data.jobError)rateCache.set(data.jobError.key,{signature:signatures.get(data.jobError.key),error:data.jobError.message});
   if(data.progress)progress=data.progress;
   if(data.error)workerError=data.error;
   if(data.done||data.error){running=false;worker?.terminate();worker=null;}
   if(data.done||data.error){clearTimeout(renderTimer);renderTimer=null;renderResults({keepToolbar:true});if(data.done&&active)startSimulation();}
   else if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;renderResults({keepToolbar:true});},200);
  };
  worker.onerror=()=>{if(token!==generation)return;workerError='workerFailed';stopWorker();renderResults({keepToolbar:true});};
  worker.postMessage({state,now:clock,seed:roundSeed??0,recipes:recipes.map(p=>({jobId:p.job.id,key:p.key,tier:p.tier}))});
 }catch(error){workerError=String(error.message??error);stopWorker();console.error(error);}
 renderResults({keepToolbar:true});
}
const field=(path,label,value,min=0,max=Number.MAX_SAFE_INTEGER,step=1)=>`<label class="number-field"><span>${esc(label)}</span><input type="number" data-craft-field="${path}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(label)}"></label>`;
const select=(path,label,values,value)=>`<label class="potion"><span>${esc(label)}</span><select data-craft-field="${path}" aria-label="${esc(label)}">${options(values,value)}</select></label>`;
const section=(id,label,html)=>`<details class="config-detail" id="craft-${id}"><summary>${esc(label)}</summary>${html}</details>`;
const icons={cooking:'<path d="M3 10h13v5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Zm13 2h5M6 3v4m4-4v4m4-4v4"/>',smithing:'<path d="m5 3 9 3-3 7-9-3Zm5 9 8 9M15 4l5 2-3 7-5-2"/>',fletching:'<path d="m3 21 17-17M13 4h7v7M5 13v6h6M3 15h6v6"/>',herblore:'<path d="M9 3h6m-5 0v7L4 18a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-8V3M7 15h10"/>',crafting:'<path d="m5 21 13-17a2 2 0 0 1 3 2L7 22Zm11-13 3 2M4 5c7 0 2 7 7 7"/>'};
function workEquipmentNote(slot){
 const equipment=configuredWorkEquipment(state.gear);
 return slot==='shield'?text('当前技能速度','Current skill speed')+' +'+format(game.skillOffhandBonus(equipment,state.skill)*100,2)+'%'
  :workOutfitNote(equipment,state.skill,language,slot);
}
function gearRow(slot){const v=state.gear[slot],label=name({pan:'Pan',hammer:'Hammer',knife:'Knife',mortar:'Mortar',needle:'Needle',mount:'Mount',shield:'Off-hand',helmet:'Head',body:'Body',legs:'Legs'}[slot]),g=v.id?gatheringGear(slot,game.encode(game.withRarity(v.id,v.tier),v.plus)):null;return `<div class="gear-row"><label class="gear-name"><span>${esc(label)}</span><select data-craft-field="gear.${slot}.id" aria-label="${esc(label)}">${options([[0,text("无",'None')],...slotItems(slot).map(i=>[i.itemId,name(game.item(i.itemId).name)])],v.id)}</select></label><div class="gear-mods"><select data-craft-field="gear.${slot}.tier" aria-label="${esc(label+' '+text('稀有度','Rarity'))}" ${!v.id||!game.itemSupportsRarity(v.id)?'disabled':''}>${options(rarities().map((r,i)=>[i,r]),v.tier)}</select><label class="enhance"><span>+</span><input type="number" data-craft-field="gear.${slot}.plus" min="0" max="${game.maxEnhancement}" step="1" value="${v.plus}" aria-label="${esc(label+' '+text('强化','Enhance'))}" ${!v.id||!game.canEnhance(v.id)?'disabled':''}></label></div><small class="gear-stats">${g?(['shield','helmet','body','legs'].includes(slot)?workEquipmentNote(slot):text(slot==='mount'?'移动速度':'工具速度',slot==='mount'?'Movement speed':'Tool speed')+' +'+format(g.bonus*100,2)+'%'):'—'}</small></div>`;}
function renderImport(){const worldWarnings=(importStatus?.warnings??[]).filter(w=>w==='worldBuffs.upgrade'||w==='weeklyXp.reset'),warnings=(importStatus?.warnings??[]).filter(w=>!worldWarnings.includes(w));const el=document.getElementById('craft-import-status');if(!el)return;const categories={skills:text('技能','Skills'),equipment:text('工具与装备','Tools & equipment'),brews:text('药水','Potions'),brewBuckets:text('药水','Potions'),brewTier:text('药水','Potions'),house:text('家园','Home'),masteries:text('精通','Masteries'),perks:text('特权','Perks'),guildBonus:text('公会经验','Guild XP'),guild:text('公会','Guild'),weeklyXp:text('世界增益经验','World buff XP'),homeBank:text('仓库','Depot'),blessing:text('祝福','Blessing'),ironman:text('铁人模式','Ironman')};el.textContent=importStatusText(language,importStatus,importBusy)+(warnings.length?'\n'+text('部分配置未导入，已保留原值：','Some settings could not be imported; previous values kept: ')+[...new Set(warnings.map(w=>categories[w.split('.')[0]]??text('角色配置','Character build')))].join(text('、',', ')):'')+worldWarnings.map(w=>'\n'+worldBuffWarningText(language,w,{rarity:false})).join('');document.getElementById('craft-import').disabled=importBusy;}
export function renderCrafting(lang,{isActive=false}={}){
 language=lang;active=isActive;const host=document.getElementById('craft-content');if(!host)return;
 rememberDetails(host);const rooms=craftingRooms.filter(r=>r.bonus.skill===state.skill);
 host.innerHTML=`<aside class="panel config gather-config"><div class="panel-heading"><h1>${text('角色配置','Character build')}</h1><button id="craft-reset" class="text-button">${text('清空配置','Reset settings')}</button></div><p class="muted intro">${text('配置角色，对比各配方的经验与利润。','Configure your character and compare recipe XP and profit.')}</p>${characterImportPanel(language,{id:'craft-import-settings',statusId:'craft-import-status',buttons:[{id:'craft-import',label:text('导入配置','Import configuration')}]})}<div class="presets gather-skills">${craftingSkills.map(k=>`<button data-craft-skill="${k}" aria-pressed="${state.skill===k}" class="${state.skill===k?'selected':''}"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[k]}</svg></span>${skillName(k)}</button>`).join('')}</div>${section('skills',text('技能','Skills'),`<div class="skill-grid">${craftingSkills.map(k=>field(`levels.${k}`,skillName(k),state.levels[k],1,game.maxLevel)).join('')}</div>`)}${section('equipment',text('工具与装备','Tools & equipment'),[craftingToolSlots[state.skill],'mount','shield','helmet','body','legs'].map(gearRow).join('')+`<p class="micro work-outfit-total">${esc(workEquipmentNote())}</p>`)}${section('potions',text('药水','Potions'),craftingPotions.map(p=>select(`brews.${p.kind}`,name(game.item(p.itemId).name),[[-1,text('未启用','Inactive')],...rarities().map((r,i)=>[i,r])],state.brews[p.kind])+`<p class="micro">${esc(potionEffectNote(p.kind,state.brews[p.kind],language))}</p>`).join(''))}${section('home',text('家园','Home'),rooms.map(r=>field(`house.${r.id}`,name(r.name),state.house[r.id],0,game.houseLevelLimit)+`<p class="micro">${text('制造速度 · 每级','Craft speed · per level')} +${format(game.houseBonus(r,1)*100,2)}% · ${text('当前','current')} +${format(game.houseBonus(r,state.house[r.id],0,game.houseLevelLimit)*100,2)}%</p>`).join(''))}${section('masteries',text('精通','Masteries'),craftingMasteries.map(m=>field(`masteries.${m.id}`,name(m.name)+' (%)',masteryValue(m.id,state.masteries[m.id]),0,masteryValue(m.id,game.masteryRankLimit),.5)).join(''))}${section('perks',text('特权','Perks'),craftingPerks.filter(p=>p.id!=='hands'||state.skill==='cooking').map(p=>field(`perks.${p.id}`,name(p.name),state.perks[p.id],0,p.ranks)+`<p class="micro">${esc(name(p.each))}</p>`).join(''))}${section('other',text('其它','Other'),field('guildXp',text('公会经验 (%)','Guild XP (%)'),state.guildXp,0,1e7,.1)+field('weeklyXp',text('世界增益经验 (%)','World buff XP (%)'),state.weeklyXp,0,1e7,.1)+`<p class="micro">${text('导入捕获时生效的世界增益，整个模拟周期保持生效。','Imports world buffs active at capture; they remain active throughout the simulation.')}</p><label class="check"><span>${text('矿脉祝福','Vein Blessing')}</span><input type="checkbox" data-craft-field="blessing" ${state.blessing?'checked':''}></label>`+select('homeBank',text('模拟初始仓库位置','Starting depot location'),[[0,text('自动','Automatic')],...game.world.banks.map(b=>[b.id,`${text('仓库','Depot')} ${b.id} (${b.x}, ${b.y})`])],state.homeBank)+`<label class="check"><span>${text('铁人模式（不掉落坐骑）','Ironman (no mount drops)')}</span><input type="checkbox" data-craft-field="ironman" ${state.ironman?'checked':''}></label>`)}${section('settings',text('模拟配置','Simulation settings'),simulationHoursField(language,state.simulationHours,'data-craft-field','simulationHours')+select('hotSetting',text('热门加成','Hot bonuses'),[['game',text('沿用游戏设置','Use game settings')],['current',text('按照当前时间','Use current time')],['off',text('不计入','Exclude')]],state.hotSetting)+'<div id="craft-hot-schedule"></div>'+`<p class="micro">${text('按原始距离规则选择最近制造点；各配方从相同初始配置独立模拟。','Uses the nearest crafting site by upstream distance rules; each recipe starts independently.')}</p>`)}<p id="craft-save" class="save-note"></p>${storageBlocked?`<button id="craft-reset-storage" class="text-button">${text('重置制造存档','Reset crafting storage')}</button>`:''}</aside><div class="results" id="craft-results"></div>`;
 restoreDetails(host);
 host.querySelectorAll('[data-craft-skill]').forEach(el=>el.onclick=()=>{
  const skill=el.dataset.craftSkill;
  if(state.skill!==skill)craftingUpdater.invalidate();
  switchSkillMasteries(state,state.skill,skill);
  stopWorker();clearTimeout(timer);state.skill=skill;group='';save();renderCrafting(language,{isActive:active});
 });
 bindSimulationHours(host.querySelector('[data-simulation-hours]'),hours=>{
  if(state.simulationHours===hours)return;
  state.simulationHours=hours;save();
  schedule();renderResults({keepToolbar:true});
 });
 host.querySelectorAll('[data-craft-field]:not([data-simulation-hours])').forEach(el=>el.onchange=()=>{
  if(el.type==='number'&&(el.value===''||!(el.dataset.craftField==='weeklyXp'?Number.isFinite(el.valueAsNumber)&&el.valueAsNumber>=0&&el.valueAsNumber<=1e7:el.checkValidity()))){el.setAttribute('aria-invalid','true');el.reportValidity();return;}
  const keys=el.dataset.craftField.split('.'),last=keys.pop(),target=keys.reduce((o,k)=>o[k],state);target[last]=el.type==='checkbox'?el.checked:el.dataset.craftField==='hotSetting'?el.value:keys[0]==='masteries'?masteryRank(last,Number(el.value)):Number(el.value);
  state=normalizeCrafting(state);if(keys[0]==='masteries')rememberSkillMasteries(state,state.skill);clock=Date.now();save();schedule();renderCrafting(language,{isActive:active});
 });
 document.getElementById('craft-reset').onclick=()=>{craftingUpdater.reset();state=craftingDefaults();importStatus=null;save();schedule();renderCrafting(language,{isActive:active});};
 document.getElementById('craft-import').onclick=()=>craftingUpdater.read();
 const reset=document.getElementById('craft-reset-storage');if(reset)reset.onclick=()=>{if(!confirm(text('删除制造存档并恢复默认配置？','Delete crafting storage and restore defaults?')))return;try{resetCraftingConfig(localStorage);}catch{notice='savedInvalid';renderNotice();return;}craftingUpdater.reset();state=craftingDefaults();storageBlocked=false;notice='';importStatus=null;save();schedule();renderCrafting(language,{isActive:active});};
 if(active&&!probeStarted){probeStarted=true;probeCharacter().then(()=>{if(!importStatus)importStatus={ready:true};renderImport();}).catch(error=>{if(!importStatus)importStatus={error:error.message};renderImport();});}
 renderHot();
 renderResults();renderImport();renderNotice();if(active&&!running)startSimulation();
}
subscribe(change=>{if(change.prices)renderResults({keepToolbar:true});});

const craftingUpdater=registerCharacterUpdates('craft',{
 busy:()=>importBusy||storageBlocked,revision:()=>JSON.stringify(state),
 onBusy:value=>{importBusy=value;renderImport();},
 apply:snapshot=>{const {state:imported,...result}=importCrafting(state,snapshot);state=imported;importStatus=result;clock=Date.now();save();schedule();renderCrafting(language,{isActive:active});return saveOK;},
 onError:error=>{importStatus={error:error.message};renderImport();},
});

function renderHot(){
 const hot=document.getElementById('craft-hot-schedule');if(!hot)return;
 try{hot.innerHTML=state.hotSetting==='current'?simulationHotMarkup(clock,state.simulationHours,language,esc,state.skill,skillName(state.skill)):state.hotSetting==='game'?`<p class="micro">${text('沿用游戏内置预测的热门规则。','Uses the in-game predictor hot bonus rules.')}</p>`:'';}catch(error){hot.textContent=errorText(error.message);}
}

export function getCraftingConfig(){return structuredClone(state);}
