import {pageIncomeUnitPrice} from './page-prices.js';
import {game,calculate} from './model.js';
import {gatheringJobs,gatheringSkills,gatheringStats} from './gathering-model.js';
import {craftingJobs,craftingSkills,craftingTiers,craftingStats} from './crafting-model.js';
import {searchSelectMarkup,bindSearchSelect} from './search-select.js';
import {translatedName} from './i18n.js';
import {getSnapshot} from './price-service.js';
import {optimizerIncomeItems,optimizerPolicy,optimizerInput,checkOptimizerPrices,optimizerEfforts} from './mastery-optimizer.js';

import {masteryPlanMetrics,masteryPlanHistoryNote} from './mastery-plan-view.js';
import {optimizerTaskKey,createMasteryResult,masteryResultEngine} from './mastery-result-store.js';
import {renderSavedMasteryResults,saveAutomaticMasteryResult,saveManualMasteryResult,savedMasteryFeedback,clearSavedMasterySuccess} from './mastery-result-controls.js';

const optimizerRecipes=[...craftingJobs].sort((a,b)=>craftingSkills.indexOf(a.skill)-craftingSkills.indexOf(b.skill)||b.levelReq-a.levelReq);
let recipeId=optimizerRecipes[0].id,tier=0,getCrafting=()=>null;
const optimizerJobs=[...gatheringJobs].sort((a,b)=>gatheringSkills.indexOf(a.skill)-gatheringSkills.indexOf(b.skill)||b.levelReq-a.levelReq);
const optimizerMonsters=[...game.monsters].sort((a,b)=>b.level-a.level);
let language='zh',mastery=null,getCombat=()=>null,getGathering=()=>null,objective='combatIncome',jobId=gatheringJobs[0].id,monsterId=7,effort='deep',allocationMode='reset';
let workMode='fast';
let worker=null,generation=0,result=null,progress=null,notice=null,taskInputKey=null;
let targetRanks=null,onApply=null,resultRequest=null;
const text=(zh,en)=>language==='zh'?zh:en;
const name=s=>translatedName(s,language);
const format=n=>n.toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:2});
const host=()=>document.getElementById('mastery-optimizer');
const currentTaskKey=()=>optimizerTaskKey({...mastery,recipeId,tier,crafting:getCrafting(),objective,jobId,monsterId,effort,allocationMode,workMode,combat:getCombat(),gathering:getGathering()});
const allocationLabel=mode=>mode==='remaining'?text('分配剩余点数','Allocate remaining points'):text('重置后分配','Reallocate all points');
const draftNumber=value=>typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number(value):NaN;
export function setMasteryCombatSource(provider){getCombat=provider;}
export function setMasteryGatheringSource(provider){getGathering=provider;}
export function setMasteryCraftingSource(provider){getCrafting=provider;}
export function invalidateMasteryOptimizer(){
 if(worker&&taskInputKey!==currentTaskKey()){resetTask('changed');paint();}
}
export function leaveMasteryOptimizer(){if(worker){resetTask('cancelled');paint();}}
// Reset only the running task; completed recommendations remain available.
function resetTask(code){clearSavedMasterySuccess();generation++;worker?.terminate();worker=null;progress=null;notice=code?{code}:null;taskInputKey=null;}
const errors=()=>({
 invalidOptimizerPoints:text('请填写有效的非负整数总点数。','Enter valid nonnegative integer total points.'),
 invalidOptimizerRanks:text('请先修正当前精通等级。','Correct current mastery ranks first.'),
 invalidOptimizerMode:text('分配方式无效，请重新选择。','Invalid allocation method. Select a method again.'),
 invalidOptimizerWorkMode:text('请重新选择快速模式或标准模式。','Select Fast or Standard mode again.'),
 optimizerCurrentOverBudget:text('当前精通已投入超过总点数，无法仅分配剩余点数；请修正总点数或当前等级。','Current mastery investment exceeds total points. Correct total points or current ranks before allocating remaining points.'),
 invalidOptimizerGathering:text('无法读取采集配置，请先在采集页配置角色。','Configure your character on the Gathering page first.'),
 invalidOptimizerJob:text('请选择有效采集任务。','Select a valid gathering task.'),
 invalidOptimizerCrafting:text('无法读取制造配置，请先在制造页配置角色。','Configure your character on the Crafting page first.'),
 invalidOptimizerRecipe:text('请选择有效制造配方。','Select a valid crafting recipe.'),
 invalidOptimizerTier:text('请选择有效配方品质。','Select a valid recipe rarity.'),
 levelTooLow:text('技能等级不足，无法执行所选任务。','Skill level is too low for this task.'),
 invalidOptimizerScenario:text('无法读取战斗配置，请先在战斗页配置角色。','Configure your character on the Combat page first.'),
 missingOptimizerPrices:text('以下可能产出缺少有效价格，请在物品价格中设置后重算：','Set valid item prices for these possible rewards before running: '),
 noViableOptimizerPlan:text('本次搜索未找到完成整个时长且战斗无死亡的方案；请检查目标、配装或增加搜索次数。','No searched plan survived the full duration. Check the target and build, or try a deeper search.'),
 workerFailed:text('计算进程失败，请重试。','Calculation process failed. Please retry.'),
 changed:text('输入已更新，本次计算已取消','Inputs updated; calculation cancelled'),
 cancelled:text('计算已取消。','Calculation cancelled.'),
 applied:text('已应用','Applied'),
 applyInvalidSettings:text('目标已填入，请填写有效总点数后保存。','Targets filled. Enter valid total points to save.'),
 applySaveFailed:text('方案已应用，但浏览器存储不可用，无法保存。','Plan applied, but browser storage is unavailable and it could not be saved.'),
 applyFailed:text('方案应用失败，原配置保留。','Could not apply this plan. Existing settings were preserved.'),
});
function message(){
 const messages=[];
 if(progress)messages.push(progress.workMode==='fast'
  ?text(`已估算 ${progress.candidates}/${progress.maxCandidates} 个配置`,`Estimated ${progress.candidates}/${progress.maxCandidates} configurations`)
  :text(`${progress.phase==='review'?'独立种子复核':'搜索方案'} · 已筛查 ${progress.candidates}/${progress.maxCandidates} 个配置 · 已模拟 ${progress.simulations} 次`,`${progress.phase==='review'?'Reviewing with independent seeds':'Searching'} · ${progress.candidates}/${progress.maxCandidates} configurations · ${progress.simulations} simulations`));
 else if(notice)messages.push((errors()[notice.code]??text(`计算失败：${notice.code}`,`Calculation failed: ${notice.code}`))+(notice.itemIds?.length?' '+notice.itemIds.map(id=>name(game.item(id).name)).join('、'):'')+(notice.detail?' '+notice.detail:''));
 const saved=savedMasteryFeedback();if(saved.message)messages.push(saved.message);
 return [...new Set(messages)].join(' · ');
}
function summary(){
 if(optimizerPolicy(objective).gathering||optimizerPolicy(objective).crafting){
  const crafting=optimizerPolicy(objective).crafting;
  const state=crafting?getCrafting():getGathering();if(!state)return crafting?text('请先在制造页配置角色。','Configure your character on the Crafting page first.'):text('请先在采集页配置角色。','Configure your character on the Gathering page first.');
  const job=(crafting?craftingJobs:gatheringJobs).find(j=>j.id===(crafting?recipeId:jobId)),stats=(crafting?craftingStats:gatheringStats)({...state,skill:job.skill});
  const current=Object.fromEntries(game.masteries.map(m=>[m.id,draftNumber(mastery?.current?.[m.id])]));
  const invested=Object.values(current).every(Number.isSafeInteger)?game.masteriesTotalCost(current):NaN;
  return `${name(job.name)}${crafting?' · '+(language==='zh'?['普通','罕见','稀有','史诗','传说']:['Normal','Uncommon','Rare','Epic','Legendary'])[tier]:''} · ${text('等级','Level')} ${stats.level}\n${Object.values(state.gear).filter(v=>v.id).map(v=>name(game.item(v.id).name)+' +'+v.plus).join(' · ')}\n${text('总精通点','Total mastery points')} ${mastery?.totalPoints??'—'} · ${text('当前投入','Current investment')} ${Number.isFinite(invested)?format(invested):'—'} · ${text('本模式可分配点数','Points available in this mode')} ${Number.isFinite(invested)&&Number.isSafeInteger(draftNumber(mastery?.totalPoints))?format(draftNumber(mastery.totalPoints)-(allocationMode==='remaining'?invested:0)):'—'}`;
 }
 const combat=getCombat();if(!combat)return text('请先在战斗页配置角色。','Configure your character on the Combat page first.');
 const {state,issues}=calculate(combat);
 const styles={ranged:text('远程','Ranged'),melee:text('近战','Melee'),magic:text('魔法','Magic')};
 const tiers=language==='zh'?['普通','罕见','稀有','史诗','传说']:['Normal','Uncommon','Rare','Epic','Legendary'];
 const gear=Object.values(state.gear).filter(v=>v.id).map(v=>`${tiers[v.tier]} ${name(game.item(v.id).name)} +${v.plus}`).join(' · ');
 const ranks=Object.fromEntries(game.masteries.map(m=>[m.id,draftNumber(mastery?.current?.[m.id])])),total=draftNumber(mastery?.totalPoints);
 const invested=Object.values(ranks).every(n=>Number.isInteger(n)&&n>=0&&n<=game.masteryRankLimit)?game.masteriesTotalCost(ranks):null;
 const available=Number.isSafeInteger(total)&&total>=0&&(allocationMode==='reset'||invested!==null)?total-(allocationMode==='remaining'?invested:0):null;
 return `${styles[state.style]} · ${text('等级','Level')} ${state.levels[state.style]} · ${text('防御','Defence')} ${state.levels.defence} · ${text('生命','HP')} ${state.levels.hitpoints}\n${gear}\n${text('总精通点','Total mastery points')} ${mastery?.totalPoints??'—'} · ${text('当前投入','Current investment')} ${invested===null?'—':format(invested)} · ${text('本模式可分配点数','Points available in this mode')} ${available===null?'—':format(available)}${issues.length?'\n'+text(`配装提示 ${issues.length} 项，请在战斗页检查（等级不足／流派不匹配等仍按现有规则模拟）。`,`${issues.length} loadout warnings. Review the Combat page; existing simulation rules still apply.`):''}`;
}
function isApplied(plan){
 return game.masteries.every(m=>draftNumber(targetRanks?.[m.id])===plan.ranks[m.id]);
}
function planMarkup(plan,index){
 const record={engine:masteryResultEngine,input:resultRequest,baseline:result.baseline,plan},applied=isApplied(plan);
 return `<article class="optimizer-plan"><div class="optimizer-plan-heading"><h4>${index===0?text('本次搜索最佳方案','Best plan found'):text(`备选 ${index}`,`Alternative ${index}`)}</h4><button class="secondary" data-optimizer-save="${index}">${text('保存','Save')}</button><button class="secondary" data-optimizer-apply="${index}" ${applied?'disabled':''}>${applied?text('已应用','Applied'):text('应用','Apply')}</button></div>${masteryPlanMetrics(record,mastery?.totalPoints,language)}${masteryPlanHistoryNote(record,language)}</article>`;
}
function applyRecommendation(index){
 if(!result||!result.plans[index])return;
 try{
  if(!onApply)throw Error('Application handler unavailable');
  const response=onApply({ranks:{...result.plans[index].ranks}});
  notice={code:response.invalidSettings?'applyInvalidSettings':response.saveOK?'applied':'applySaveFailed'};
 }catch(error){notice={code:'applyFailed',detail:String(error?.message??error)};}
 paint();
}
function paintStatus(){
 const status=host()?.querySelector('#optimizer-status');if(!status)return;
 status.dataset.running=progress?'true':'false';
 status.textContent=message();status.dataset.kind=savedMasteryFeedback().warning||notice&&!['applied','cancelled'].includes(notice.code)?'warning':'normal';
}
function paint(){
 renderSavedMasteryResults(language,{totalPoints:mastery?.totalPoints,onApply,target:targetRanks,onStatus:paintStatus});
 const root=host();if(!root)return;
 paintStatus();
 root.querySelector('#optimizer-start').textContent=worker?text('取消计算','Cancel calculation'):text('开始计算','Start calculation');
 const output=root.querySelector('#optimizer-output');
 if(!result){output.innerHTML='';return;}
 output.innerHTML=result.plans.map(planMarkup).join('');
}
export function renderMasteryOptimizer(nextLanguage,nextMastery,options={}){
 language=nextLanguage;mastery=structuredClone(nextMastery);targetRanks=options.target;onApply=options.onApply;
 const root=host();if(!root)return;
 const explanationOpen=root.querySelector('#optimizer-explanation')?.open??false;
 const policy=optimizerPolicy(objective),work=policy.gathering||policy.crafting;
 const modePicker=work?`<div class="number-field"><label for="optimizer-work-mode">${text('计算模式','Calculation mode')}</label><select id="optimizer-work-mode"><option value="fast" ${workMode==='fast'?'selected':''}>${text('快速模式（静态算法估算）','Fast mode (static estimate)')}</option><option value="standard" ${workMode==='standard'?'selected':''}>${text('标准模式（真实过程模拟）','Standard mode (full simulation)')}</option></select></div>`:'';
 const workDetails=work?text('快速模式采用静态估算算法，按当前技能等级计算 24 小时的预期表现。标准模式重复模拟 24 小时，计入期间升级。<br>','Fast mode uses a static model to estimate 24-hour performance at the current skill level. Standard mode runs repeated 24-hour simulations with level-ups.<br>'):'';
 root.innerHTML=`<summary>${text('计算最优分配方案','Calculate optimal allocation')}</summary><p class="micro"><span class="simulation-caveat">${text('计算结果仅针对当前装备和所选目标，应用于其他目标时效果可能更差。','Results apply only to the current equipment and selected target, and may perform worse for other targets.')}</span> ${text('结果仅供参考，请自行评估分配方案。','Use them as a reference and assess the allocation yourself.')}</p><div class="optimizer-fields"><label class="number-field"><span>${text('分配方式','Allocation method')}</span><select id="optimizer-allocation-mode"><option value="reset" ${allocationMode==='reset'?'selected':''}>${allocationLabel('reset')}</option><option value="remaining" ${allocationMode==='remaining'?'selected':''}>${allocationLabel('remaining')}</option></select></label><label class="number-field"><span>${text('搜索次数','Search allowance')}</span><select id="optimizer-effort">${Object.entries(optimizerEfforts).filter(([id])=>id!=='fast').map(([id,max])=>`<option value="${id}" ${effort===id?'selected':''}>${text({standard:'快速',deep:'标准',comprehensive:'全面'}[id],{standard:'Fast',deep:'Standard',comprehensive:'Comprehensive'}[id])}${text('：最多 ',': up to ')}${max}${text(' 个配置',' configurations')}</option>`).join('')}</select></label><label class="number-field"><span>${text('优化目标','Optimization goal')}</span><select id="optimizer-goal"><option value="combatIncome" ${objective==='combatIncome'?'selected':''}>${text('战斗收入最高','Highest combat income')}</option><option value="gatherIncome" ${objective==='gatherIncome'?'selected':''}>${text('采集收入最高','Highest gathering income')}</option><option value="combatCollection" ${objective==='combatCollection'?'selected':''}>${text('战斗精通点数最高','Highest combat mastery points')}</option><option value="gatherCollection" ${objective==='gatherCollection'?'selected':''}>${text('采集精通点数最高','Highest gathering mastery points')}</option>${[['combatXp','战斗经验最多','Most combat XP'],['gatherXp','采集经验最多','Most gathering XP'],['craftXp','制造经验最多','Most crafting XP']].map(([id,zh,en])=>`<option value="${id}" ${objective===id?'selected':''}>${text(zh,en)}</option>`).join('')}</select></label>${optimizerPolicy(objective).crafting?`${searchSelectMarkup('optimizer-recipe',text('制造配方','Crafting recipe'))}<label class="number-field"><span>${text('品质','Rarity')}</span><select id="optimizer-tier">${craftingTiers(craftingJobs.find(j=>j.id===recipeId)).map(t=>`<option value="${t}" ${tier===t?'selected':''}>${(language==='zh'?['普通','罕见','稀有','史诗','传说']:['Normal','Uncommon','Rare','Epic','Legendary'])[t]}</option>`).join('')}</select></label>`:optimizerPolicy(objective).gathering?searchSelectMarkup('optimizer-job',text('采集任务','Gathering task')):searchSelectMarkup('optimizer-monster',text('目标怪物','Target monster'))}${modePicker}</div><p id="optimizer-scenario" class="micro"></p><details id="optimizer-explanation" class="optimizer-explanation" ${explanationOpen?'open':''}><summary>${text('计算说明','Calculation details')}</summary><p class="micro">${workDetails}${text('使用对应战斗／采集／制造页当前配装，开始时冻结价格、增益与配置。<br>经验目标按 24 小时经验增量评分，战斗计入全部技能经验，采集／制造计入任务技能；不依赖价格。制造选择单个配方及品质，假设材料充足。<br>收入为金币＋掉落估值，未扣食物药水；宠物估值为 0。<br>精通产出评分按各品质首档奖励比例 1／3／10／30／100 加权，金币和宠物不计，不依赖物品价格；不代表实际获得的精通点数。','Uses the current Combat, Gathering or Crafting build. Prices, buffs and settings are captured at start.<br>XP goals use 24-hour XP gains: all combat skills, or the selected work skill; no prices required. Crafting uses one recipe and rarity with sufficient materials.<br>Income is coins + valued drops, before food and potion costs; pets are valued at zero.<br>Mastery yield score weights output qualities by 1/3/10/30/100, excluding coins and pets. It is price-independent and does not represent actual mastery points earned.')}</p></details><div class="optimizer-actions"><button id="optimizer-start" class="secondary">${text('开始计算','Start calculation')}</button><a id="optimizer-edit-combat" href="${optimizerPolicy(objective).crafting?'/craft':optimizerPolicy(objective).gathering?'/gather':'/combat'}">${optimizerPolicy(objective).crafting?text('前往制造页编辑配装','Edit build on Crafting page'):optimizerPolicy(objective).gathering?text('前往采集页编辑配装','Edit build on Gathering page'):text('前往战斗页编辑配装','Edit build on Combat page')}</a></div><p id="optimizer-status" role="status" aria-live="polite"></p><div id="optimizer-results"><div id="optimizer-output"></div><div id="mastery-saved-results" class="mastery-saved-results"></div></div>`;
 root.querySelector('#optimizer-scenario').textContent=summary();
 root.querySelector('#optimizer-start').onclick=()=>{if(worker){resetTask('cancelled');paint();}else start();};
 root.querySelector('#optimizer-output').onclick=async e=>{const button=e.target.closest('[data-optimizer-apply]');if(button&&!button.disabled)applyRecommendation(Number(button.dataset.optimizerApply));const save=e.target.closest('[data-optimizer-save]');if(save&&result&&resultRequest){await saveManualMasteryResult(createMasteryResult(resultRequest,result,Number(save.dataset.optimizerSave)));paint();}};
 root.querySelector('#optimizer-edit-combat').onclick=e=>{if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();document.getElementById(optimizerPolicy(objective).crafting?'craft-nav':optimizerPolicy(objective).gathering?'gather-nav':'combat-nav').click();}};
 const catalog=policy.crafting?optimizerRecipes:policy.gathering?optimizerJobs:optimizerMonsters;
 const selected=policy.crafting?recipeId:policy.gathering?jobId:monsterId,id=policy.crafting?'optimizer-recipe':policy.gathering?'optimizer-job':'optimizer-monster';
 root.querySelector(`#${id}`).placeholder=text('输入名称搜索','Search by name');
 bindSearchSelect({id,
  options:catalog.map(item=>({value:item.id,label:`${name(item.name)} · ${item.levelReq??item.level}`,search:`${translatedName(item.name,'zh')} ${item.name}`})),value:selected,
  emptyText:text('没有匹配的选项','No matching options'),countText:count=>text(`${count} 个匹配选项`,`${count} matching options`),
  onSelect:id=>{
   if(id===selected)return;
   if(policy.crafting){recipeId=id;const tiers=craftingTiers(craftingJobs.find(j=>j.id===recipeId));if(!tiers.includes(tier))tier=tiers[0];}
   else if(policy.gathering)jobId=id;else monsterId=id;
   resetTask();renderMasteryOptimizer(language,mastery,{target:targetRanks,onApply});
  }});
 const tierSelect=root.querySelector('#optimizer-tier');if(tierSelect)tierSelect.onchange=e=>{tier=Number(e.target.value);resetTask();root.querySelector('#optimizer-scenario').textContent=summary();paint();};
 if(work)root.querySelector('#optimizer-work-mode').onchange=e=>{workMode=e.target.value;resetTask(worker?'changed':null);paint();};
 root.querySelector('#optimizer-effort').onchange=e=>{effort=e.target.value;resetTask();paint();};
 root.querySelector('#optimizer-allocation-mode').onchange=e=>{allocationMode=e.target.value;resetTask(worker?'changed':null);renderMasteryOptimizer(language,mastery,{target:targetRanks,onApply});};
 root.querySelector('#optimizer-goal').onchange=e=>{objective=e.target.value;resetTask();renderMasteryOptimizer(language,mastery,{target:targetRanks,onApply});};

 invalidateMasteryOptimizer();paint();
}
function start(){
 resetTask();
 try{
  const totalPoints=draftNumber(mastery?.totalPoints);
  const current=Object.fromEntries(game.masteries.map(m=>[m.id,draftNumber(mastery?.current?.[m.id])]));
  const input=optimizerInput({recipeId,tier,crafting:getCrafting(),objective,allocationMode,totalPoints,current,monsterId,jobId,effort,workMode,combat:getCombat(),gathering:getGathering(),now:Date.now()});
  const snapshot=getSnapshot(),page=optimizerPolicy(input.objective).gathering?'gather':'combat',prices=Object.fromEntries(optimizerIncomeItems(input).map(id=>[id,{price:pageIncomeUnitPrice(page,snapshot,id)}]));
  checkOptimizerPrices(input,prices);const request={...input,prices};taskInputKey=currentTaskKey();
  worker=new Worker(new URL('./mastery-optimizer-worker.js',import.meta.url),{type:'module'});const task=generation,activeWorker=worker;
  progress={phase:'search',candidates:0,maxCandidates:optimizerEfforts[effort],simulations:0,workMode:input.workMode};
  worker.onmessage=async({data})=>{
   if(task!==generation||worker!==activeWorker)return;
   if(data.error){worker.terminate();worker=null;progress=null;notice={code:data.error,itemIds:data.itemIds};}
   else if(data.result){
    if(taskInputKey!==currentTaskKey()){resetTask('changed');paint();return;}
    worker.terminate();worker=null;progress=null;
    try{
     const record=createMasteryResult(request,data.result);
     result=data.result;resultRequest=record.input;notice=null;paint();
     await saveAutomaticMasteryResult(record,()=>task===generation);
     if(task===generation&&taskInputKey===currentTaskKey())applyRecommendation(0);
    }catch(error){if(task===generation)resetTask(error.message);}
   }
   else if(data.progress)progress=data.progress;
   paint();
  };
  worker.onerror=()=>{if(task===generation&&worker===activeWorker){resetTask('workerFailed');paint();}};
  worker.postMessage(request);
 }catch(error){resetTask();notice={code:error.message,itemIds:error.itemIds};}
 paint();
}
