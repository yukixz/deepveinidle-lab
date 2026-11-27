import {bindSimulationPanel,pagePriceSettings,selectedUnitPrice,simulationPanel} from './page-prices.js';
import {getSnapshot,subscribe} from './price-service.js';
import {searchSelectMarkup,bindSearchSelect} from './search-select.js';
import * as game from './upstream.js';
import {translatedName} from './i18n.js';
import {enhancementPercentiles} from './enhancement-distribution.js';
import {registerCharacterUpdates,characterImportPanel,probeCharacter,importStatusText} from './import-controls.js';
import {enhancementStorageKey,enhancementDefaults,enhanceableItems,validateEnhancement,calculateEnhancement,enhancementMinimum,enhancementFee,importEnhancement,resolveEnhancementPrices} from './enhancement.js';

let distributionWorker=null,distributionTimer=null,distributionRevision=0;
let probeStarted=false;
let state=enhancementDefaults(),language='zh',busy=false,status=null,saveOK=true;
try{const saved=localStorage.getItem(enhancementStorageKey);if(saved)state=validateEnhancement(JSON.parse(saved),{allowUnsupportedTarget:true});}catch{status={error:'savedInvalid'};}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(zh,en)=>language==='zh'?zh:en;
const name=s=>translatedName(s,language);
const itemLimit=()=>game.itemEnhancementLimit(game.withRarity(state.itemId,state.tier));
const priceLabels={shardPrice:['虚空碎片','Voidshard'],scrollPrice:['保护卷轴','Protection scroll'],essencePrice:['强化精华','Enhance essence'],corePrice:['巨像核心','Colossus core'],basePrice:['底装购置费','Base item purchase']};
const rarities=()=>language==='zh'?['普通','罕见','稀有','史诗','传说']:['Normal','Uncommon','Rare','Epic','Legendary'];
const options=(arr,value)=>arr.map(([v,label])=>`<option value="${v}" ${String(v)===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const errors={
 invalidTaxRate:['市场税率须为 0（含）至 100（不含）之间的数值。','Market tax rate must be at least 0% and less than 100%.'],
 invalidFeeRates:['市场税率与期望利润率之和须小于 100%。','Market tax rate and expected profit margin must add up to less than 100%.'],
 invalidProfitRate:['期望利润率须为 0（含）至 100（不含）之间的数值。','Expected profit margin must be at least 0% and less than 100%.'],
 distributionLimit:['分位数计算未完成：超出资源上限。','Quantile calculation exceeded the resource limit.'],
 distributionPrecision:['分位数计算未完成：金额超出安全精度范围。','Quantile calculation exceeds safe monetary precision.'],
 distributionWorker:['费用分布计算失败，请重新计算或刷新页面。','Cost distribution calculation failed. Change a setting or reload.'],
 invalidConfiguration:['请输入范围内的整数配置。','Enter integer settings within the allowed ranges.'],invalidItem:['请选择可强化的装备及有效稀有度。','Select an enhanceable item and valid rarity.'],invalidPrice:['价格必须为空或非负有限数值。','Prices must be blank or finite nonnegative numbers.'],targetBelowCurrent:['目标强化值不能低于当前值。','Target enhancement cannot be below the current value.'],unreliableCalculation:['无法可靠计算此配置的期望成本。','Expected costs could not be calculated reliably.']};
const errorMessage=code=>code==='targetAboveLimit'?text(`这件装备的新目标最高为 +${itemLimit()}。请调整目标。`,`New targets for this item are capped at +${itemLimit()}. Adjust the target.`):(errors[code]??[code,code])[language==='zh'?0:1];
const format=v=>v>=1e12?v.toExponential(4):v.toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:2});
const formatMoney=value=>Math.ceil(value).toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:0});
const profitText=(cost,rate,tax)=>text('税后利润：','Profit after tax: ')+(cost===null?text('未完整定价','Incomplete pricing'):formatMoney(enhancementFee(cost,rate,tax)*rate/100));
const field=(key,label,min,max,step=1,value=state[key])=>`<label class="number-field"><span>${label}</span><input data-enhance-field="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value??''}"></label>`;
function resetBaseOverride(){const id=game.encode(game.withRarity(state.itemId,state.tier),state.current);if(state.basePriceItem!==null&&state.basePriceItem!==id){state.priceModes.basePrice='global';state.basePrice=null;state.basePriceItem=null;}}
function currentPrices(){
 const snapshot=getSnapshot(),{materials}=pagePriceSettings('enhance').values;
 return resolveEnhancementPrices(state,snapshot,(id,key)=>selectedUnitPrice(snapshot,id,key==='basePrice'?'avg7d':materials),materials==='none');
}
function previewPrices(){try{return currentPrices();}catch{return {};}}
function save(){try{localStorage.setItem(enhancementStorageKey,JSON.stringify(validateEnhancement(state)));saveOK=true;}catch(error){saveOK=false;}}
function renderStatus(){const el=document.getElementById('enhance-import-status');if(!el)return;
 el.textContent=importStatusText(language,status,busy);
 document.getElementById('enhance-import').disabled=busy;
}
function cancelDistribution(){
 clearTimeout(distributionTimer);distributionWorker?.terminate();distributionWorker=null;
 return ++distributionRevision;
}
function startDistribution(priced,result,revision){
 if(result.pricedGold===null)return;
 const update=(values,error,details)=>{
  if(revision!==distributionRevision)return;
  const limitNote=error==='distributionLimit'&&details?details.reason==='memory'?text('内存需求超过上限','Memory requirement exceeds the limit'):text('运算量达到上限','Calculation work limit reached'):'';
  for(const [i,percent]of enhancementPercentiles.entries()){
   const el=document.getElementById(`enhance-q${percent}`),fee=document.getElementById(`enhance-fee-q${percent}`);if(!el||!fee)continue;
   el.querySelector('strong').textContent=error?errorMessage(error):formatMoney(values[i].minPrice);
   el.querySelector('small').textContent=error?limitNote:text(`至少 ${percent}% 的概率不超过此金额`,`At least ${percent}% probability of staying within this amount.`);
   const totalCost=error||priced.basePrice===null?null:values[i].minPrice+priced.basePrice;
   const amount=enhancementFee(totalCost,priced.profitRate,priced.taxRate);
   fee.querySelector('strong').textContent=priced.basePrice===null?text('未完整定价','Incomplete pricing'):error?errorMessage(error):!Number.isFinite(amount)||amount>Number.MAX_SAFE_INTEGER?errorMessage('distributionPrecision'):formatMoney(amount);
   fee.querySelector('small').textContent=error?limitNote:profitText(totalCost,priced.profitRate,priced.taxRate);
  }
 };
 distributionTimer=setTimeout(()=>{
  if(revision!==distributionRevision)return;
  try{
   const worker=new Worker(new URL('./enhancement-distribution-worker.js',import.meta.url),{type:'module'});distributionWorker=worker;
   worker.onmessage=({data})=>{worker.terminate();if(distributionWorker===worker)distributionWorker=null;update(data.result?.quantiles,data.error,data.details);};
   worker.onerror=event=>{event.preventDefault();worker.terminate();if(distributionWorker===worker)distributionWorker=null;update(null,'distributionWorker');};
   worker.postMessage(priced);
  }catch{distributionWorker?.terminate();distributionWorker=null;update(null,'distributionWorker');}
 },150);
}
function renderResults(){const revision=cancelDistribution();const host=document.getElementById('enhance-results');if(!host)return;
 const note=document.getElementById('enhance-save-note');note.textContent=saveOK?text('● 强化配置独立保存在此浏览器','● Enhancement settings saved separately in this browser'):text('配置未保存：请检查输入或浏览器存储。','Settings were not saved. Check inputs or browser storage.');
 let result,priced;try{priced=currentPrices();result=calculateEnhancement(priced);}catch(error){host.innerHTML=`<div class="issue-box" role="alert">${esc(errorMessage(error.message))}</div>`;return;}
 const {totals,steps,pricedGold,purchaseTotal,expectedFee}=result;
 const incomplete=text('未完整定价','Incomplete pricing');
 const money=value=>value===null?incomplete:formatMoney(value);
 const duration=totals.seconds>=3600?`${format(totals.seconds/3600)} ${text('小时','h')}`:totals.seconds>=60?`${format(totals.seconds/60)} ${text('分钟','min')}`:`${format(totals.seconds)} ${text('秒','s')}`;
 const relevantSteps=steps.slice(enhancementMinimum(steps,state.current));
 const hasPity=relevantSteps.some(step=>step.chances.length>1);
 const inputs=[[text('金币','Coins'),totals.gold],[text('碎片','Shards'),totals.shards],[text('保护卷轴','Protection scrolls'),totals.scrolls],[text('精华','Essence'),totals.essence],[text('巨像核心','Colossus cores'),totals.cores],[text('次数','Attempts'),totals.attempts]];
 const headers=[text('步骤','Step'),text('成功率','Success chance'),text('金币','Coins'),text('碎片','Shards'),text('精华','Essence'),text('巨像核心','Colossus cores'),text('失败后','On failure')];
 const rows=relevantSteps.map(s=>{
  const chance=`${format(s.chance*100)}%`+(s.chances.length>1?` → ${format(s.chances.at(-1)*100)}%`:'');
  const fail=s.chance===1?'—':`+${s.failTo}${s.protected?` · ${text('消耗 1 卷轴','1 scroll spent')}`:''}`;
  return `<tr class="${s.from<state.current?'enhance-rebuild':''}"><td>+${s.from} → +${s.to}${s.from<state.current?` <small>${text('重做','Rebuild')}</small>`:''}</td><td>${chance}</td><td>${format(s.gold)}</td><td>${format(s.shards)}</td><td>${format(s.essence)}</td><td>${format(s.core)}</td><td>${fail}</td></tr>`;
 });
 host.innerHTML=`
 <div class="result-heading"><div><span class="eyebrow">ENHANCEMENT ESTIMATE</span><h2>${text('平均强化投入','Average enhancement inputs')}</h2></div><span class="style-badge">+${state.current} → +${state.target}</span></div>
 <div class="stats enhance-stats enhance-inputs">${[...inputs.map(([label,value])=>[label,format(value)]),[text('耗时','Time'),duration]].map(([label,value])=>`<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
 <div class="result-heading"><h2>${text('收费测算','Fee estimates')}</h2></div>
 <p class="table-note">${text('计入强化金币、碎片、卷轴、精华和巨像核心，以及失败后的重做费用。', 'Includes enhancement gold, shards, scrolls, essence and Colossus cores, including rebuilding after failures.')}</p>
 <div class="stats enhance-stats enhance-fees"><div class="stat"><span>${text('平均投入成本','Mean enhancement cost')}</span><strong>${money(pricedGold)}</strong></div>${enhancementPercentiles.map(percent=>`<div class="stat" id="enhance-q${percent}"><span>${text(`${percent}%保本期望`,`${percent}% break-even cost`)}</span><strong>${pricedGold===null?incomplete:text('分位数计算中…','Calculating quantiles…')}</strong><small></small></div>`).join('')}
 </div>
 <p class="table-note">${text('对应强化成本与底装购置费合计后，按市场税率与期望利润率计算收费和税后利润。', 'Calculates fees and profit after tax using the market tax rate and expected profit margin on the combined enhancement cost and base item purchase price.')}</p>
 <div class="stats enhance-stats enhance-fees"><div class="stat"><span>${text('平均收费','Mean fee')}</span><strong>${money(expectedFee)}</strong><small>${profitText(purchaseTotal,priced.profitRate,priced.taxRate)}</small></div>${enhancementPercentiles.map(percent=>`<div class="stat" id="enhance-fee-q${percent}"><span>${text(`${percent}%保本收费`,`${percent}% break-even fee`)}</span><strong>${expectedFee===null?incomplete:text('分位数计算中…','Calculating quantiles…')}</strong><small>${purchaseTotal===null?profitText(null,priced.profitRate,priced.taxRate):''}</small></div>`).join('')}</div>
 <section class="panel enemies"><h3>${text('逐级成功率与单次费用','Step chances and per-attempt costs')}</h3><p class="micro">${text('保护阈值按尝试前 +值判断。','Protection checks the enhancement before the attempt.')} ${hasPity?text('高阶成功率显示零保底至保底上限的范围。本次估算从零保底开始。','High-level chances show the range from zero pity to maximum pity. This estimate starts at zero pity.'):''}</p><div class="table-scroll"><table class="enhance-table"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}">${text('已达到目标，无需强化。','Target already reached; no enhancement needed.')}</td></tr>`}</tbody></table></div></section>

`;
 startDistribution(priced,result,revision);
}
export function applyEnhancementImport(snapshot){
 const {state:imported,...result}=importEnhancement(state,snapshot);
 state=imported;status=result;save();
 return {...status,saveOK};
}
export function renderEnhancement(nextLanguage){
 const openDetails=new Map([...document.querySelectorAll('#enhance-section details[id]')].map(el=>[el.id,el.open]));
 language=nextLanguage;const host=document.getElementById('enhance-content');if(!host)return;
 const prices=previewPrices();
 host.innerHTML=`<div class="config-column"><aside class="panel config enhance-config"><details id="enhance-character-panel" class="configuration-disclosure" open><summary><h1>${text('角色配置','Character build')}</h1></summary><button id="enhance-reset" class="text-button">${text('清空配置','Reset settings')}</button><p class="muted intro">${text('配置角色的强化技能与成功率加成。','Configure enhancing skill and success chance bonuses.')}</p>
 ${characterImportPanel(language,{id:'enhance-import-settings',statusId:'enhance-import-status',buttons:[{id:'enhance-import',label:text('导入配置','Import configuration')}]})}
 <details class="config-detail" id="enhance-skill-settings"><summary>${text('技能','Skills')}</summary><div class="skill-grid">${field('level',text('强化技能等级','Enhancing skill level'),1,game.maxLevel)}</div><p class="micro">${text('强化技能每比 1 级高一级，成功率倍率增加 0.2%。','Each enhancing level above level 1 adds 0.2% to the success chance multiplier.')}</p></details>
 <details class="config-detail" id="enhance-home-settings"><summary>${text('家园','Home')}</summary><div class="skill-grid">${field('lectern',text('符文书台等级','Rune lectern level'),0,game.houseLevelLimit)}</div><p class="micro">${text('符文书台只计已放置的等级，每级将成功率乘以额外 1%。','Only placed rune lectern levels apply; +1% of the chance per level.')}</p></details>
 <details class="config-detail" id="enhance-mastery-settings"><summary>${text('精通','Masteries')}</summary><label class="number-field"><span>${text('强化精通实际加成 (%)','Effective enhance mastery bonus (%)')}</span><input data-enhance-field="mastery" type="number" min="0" max="${game.enhanceMasteryBonusCap*100}" step="0.25" value="${state.mastery===null?'':Math.min(game.enhanceMasteryBonusCap*100,state.mastery*0.25)}"></label></details>
 <p class="save-note" id="enhance-save-note"></p></details></aside>${simulationPanel('enhance',language)}</div><div class="results enhance-workspace"><section class="panel enhance-equipment"><div class="panel-heading"><h2>${text('强化配置','Enhancement settings')}</h2><button id="enhance-equipment-reset" class="text-button">${text('清空配置','Reset settings')}</button></div>
 <div class="enhance-item-row">${searchSelectMarkup('enhance-item-search',text('装备 / 工具','Equipment / tool'))}
 <label class="enhance-select"><span>${text("稀有度",'Rarity')}</span><select data-enhance-field="tier">${options(rarities().map((x,i)=>[i,x]),state.tier)}</select></label></div>
 <div class="enhance-item-row enhance-level-row">${field('current',text('当前强化值','Current enhancement'),0,game.maxEnhancement)}${field('target',text('目标强化值','Target enhancement'),0,Math.max(itemLimit(),state.current??0))}<label class="number-field"><span>${text('使用保护卷轴','Use protection scrolls')}</span><select data-enhance-field="protect">${options([['true',text('使用','Use')],['false',text('不使用','Do not use')]],state.protect)}</select></label>${field('protectFrom',text('保护卷轴起始等级','Protection scroll starting level'),game.protectionMin,game.maxEnhancement)}</div>
 <label class="check"><input type="checkbox" data-enhance-field="useCore" ${state.useCore?'checked':''}>${text('使用巨像核心','Use Colossus cores')}</label>
 <section class="config-detail" id="enhance-price-settings"><h3>${text('价格与收费设置','Prices and fees')}</h3><div class="enhance-item-row enhance-price-row">${Object.entries(priceLabels).map(([key,labels])=>field(key,text(...labels),0,Number.MAX_SAFE_INTEGER,'any',prices[key]??null)).join('')}</div><div class="enhance-item-row">${field('taxRate',text('市场税率 (%)','Market tax rate (%)'),0,100,'any')}${field('profitRate',text('期望利润率 (%)','Expected profit margin (%)'),0,100,'any')}</div></section></section><div id="enhance-results" aria-live="polite"></div></div>`;

 bindSimulationPanel('enhance',refreshPricing);
 host.querySelectorAll('[data-enhance-field]').forEach(el=>{
  const update=()=>{const key=el.dataset.enhanceField;state[key]=key==='useCore'?el.checked:key==='protect'?el.value==='true':el.value===''?null:Number(el.value)/(key==='mastery'?0.25:1);if(key==='mastery'&&Number(el.value)>game.enhanceMasteryBonusCap*100)state.mastery=NaN;if(Object.hasOwn(state.priceModes,key)){state.priceModes[key]='manual';if(key==='basePrice')state.basePriceItem=game.encode(game.withRarity(state.itemId,state.tier),state.current);}if(['current','tier'].includes(key))resetBaseOverride();save();if(['current','tier'].includes(key)&&Number.isInteger(state.current)&&state.current>=0&&state.current<=game.maxEnhancement)renderEnhancement(language);else renderResults();};
  if(el.type==='number'&&el.dataset.enhanceField!=='current')el.oninput=update;else el.onchange=update;
 });
 const itemOptions=()=>enhanceableItems.map(x=>({value:x.id,label:name(x.name),search:`${x.name} ${translatedName(x.name,'zh')}`}));
 bindSearchSelect({id:'enhance-item-search',options:itemOptions(),value:state.itemId,selectedLabel:id=>name(game.item(id).name),onSelect:id=>{state.itemId=id;resetBaseOverride();save();renderEnhancement(language);},emptyText:text('没有匹配的装备或工具','No matching equipment or tools'),countText:count=>text(`${count} 件匹配物品`,`${count} matching items`)});
 document.getElementById('enhance-reset').onclick=()=>{enhancementUpdater.reset();const {guild,level,lectern,mastery}=enhancementDefaults();state={...state,guild,level,lectern,mastery};status=null;save();renderEnhancement(language);};
 document.getElementById('enhance-equipment-reset').onclick=()=>{const {guild,level,lectern,mastery}=state;state={...enhancementDefaults(),guild,level,lectern,mastery};save();renderEnhancement(language);};
 document.getElementById('enhance-import').onclick=()=>enhancementUpdater.read();
 if(!probeStarted){probeStarted=true;probeCharacter().then(()=>{if(!status&&!busy){status={ready:true};renderStatus();}}).catch(error=>{if(!status&&!busy){status={error:error.message};renderStatus();}});}
 renderStatus();refreshPricing();for(const [id,open]of openDetails){const el=document.getElementById(id);if(el)el.open=open;}
}

function refreshPricing(){
 const host=document.getElementById('enhance-content');if(!host)return;
 const priced=previewPrices(),free=pagePriceSettings('enhance').values.materials==='none';
 for(const key of Object.keys(priceLabels)){
  const input=host.querySelector(`[data-enhance-field="${key}"]`);
  if(!input)continue;
  input.disabled=key!=='basePrice'&&free;
  input.value=priced[key]??'';
 }
 renderResults();
}
subscribe(change=>{if(change.prices||change.market)refreshPricing();});

const enhancementUpdater=registerCharacterUpdates('enhance',{
 busy:()=>busy,revision:()=>JSON.stringify(state),
 onBusy:value=>{busy=value;renderStatus();},
 apply:snapshot=>{const result=applyEnhancementImport(snapshot);renderEnhancement(language);return result.saveOK;},
 onError:error=>{status={error:error.message};renderStatus();},
});
