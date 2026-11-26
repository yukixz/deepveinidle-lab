import {isPet} from './upstream.js';
import {isMonsterValuable,validPrice} from './item-prices.js';

const groups={
 combat:{drops:['掉落','Drops'],consumables:['消耗品','Consumables'],monsterRare:['怪物的稀有掉落','Monster rare drops']},
 gather:{products:['产物','Products'],consumables:['消耗品','Consumables']},
 craft:{products:['产物','Products'],materials:['材料','Materials']},
 enhance:{materials:['材料','Materials']},
 'boss-feed':{materials:['材料','Materials']}
};
const sourceLabels={avg7d:['成交价（7天）','7-day trade average'],sellPrice:['卖单','Ask'],buyPrice:['买单','Bid'],vendorPrice:['商人价','Vendor price'],none:['无价值','No value']};
const missingPricePages=new Set(['combat','gather','craft']);
const missingLabels={warn:['提示','Warn'],vendorPrice:sourceLabels.vendorPrice,none:sourceLabels.none};
const defaults={drops:'avg7d',consumables:'avg7d',monsterRare:'vendorPrice',products:'avg7d',materials:'avg7d',missing:'warn'};
const settings=new Map();
const storageKey=page=>'dvi-page-prices-'+page;
const optionLabels=key=>key==='missing'?missingLabels:sourceLabels;

export function pagePriceSettings(page){
 if(settings.has(page))return settings.get(page);
 let saved,error=false;
 try{saved=JSON.parse(localStorage.getItem(storageKey(page)));}catch{error=true;}
 const keys=Object.keys(groups[page]);
 if(missingPricePages.has(page))keys.push('missing');
 const values=Object.fromEntries(keys.map(key=>[key,Object.hasOwn(optionLabels(key),saved?.[key])?saved[key]:defaults[key]]));
 const result={values,error};
 settings.set(page,result);
 return result;
}

export function selectedUnitPrice(snapshot,id,source){
 if(source==='none'||isPet(id))return 0;
 const item=snapshot.getItem(id);
 if(item.configured.locked&&validPrice(item.price))return item.price;
 return item[source]??null;
}

function sourceFor(page,values,id,group){
 if(page!=='combat'||group!=='drops')return values[group];
 return values[isMonsterValuable(id)?'monsterRare':'drops'];
}

export function pageIncomeUnitPrice(page,snapshot,id){
 const {values}=pagePriceSettings(page);
 return selectedUnitPrice(snapshot,id,sourceFor(page,values,id,page==='combat'?'drops':'products'));
}

export function pageValuation(page,snapshot){
 const {values}=pagePriceSettings(page);
 return (id,group)=>{
  id=Number(id);
  const price=selectedUnitPrice(snapshot,id,sourceFor(page,values,id,group));
  if(price!==null)return {price,fallback:false};
  if(values.missing==='vendorPrice')return {price:snapshot.getItem(id).vendorPrice??0,fallback:false};
  return {price:0,fallback:values.missing==='warn'};
 };
}

const storageWarning=language=>language==='zh'?'无法读取或保存物品价格设置。':'Could not read or save item price settings.';

export function simulationPanel(page,language,content=''){
 const index=language==='zh'?0:1;
 const {values,error}=pagePriceSettings(page);
 const labels=missingPricePages.has(page)?{...groups[page],missing:['缺价时','When price is missing']}:groups[page];
 return `<section class="panel config simulation-config"><details id="${page}-simulation-panel" class="configuration-disclosure" open><summary><h2>${index===0?'模拟配置':'Simulation settings'}</h2></summary><button id="${page}-simulation-defaults" type="button" class="text-button">${index===0?'重置设置':'Reset settings'}</button>${content}
 <section class="simulation-prices" data-page-prices="${page}"><div class="panel-heading"><h3>${index===0?'物品价格':'Item prices'}</h3><button type="button" class="secondary" data-open-global-prices>${index===0?'全局行情与锁定':'Global quotes & locks'}</button></div>
 ${Object.entries(labels).map(([key,label])=>`<label class="potion"><span>${label[index]}</span><select data-page-price="${key}" aria-label="${label[index]}">${Object.entries(optionLabels(key)).map(([value,name])=>`<option value="${value}" ${values[key]===value?'selected':''}>${name[index]}</option>`).join('')}</select></label>`).join('')}
 <p class="save-note" role="status" data-page-price-status ${error?'':'hidden'}>${storageWarning(language)}</p></section></details></section>`;
}

export function bindSimulationPanel(page,onChange,onReset=onChange){
 const root=document.querySelector(`[data-page-prices="${page}"]`);
 const record=pagePriceSettings(page);
 const save=()=>{
  try{localStorage.setItem(storageKey(page),JSON.stringify(record.values));record.error=false;}catch{record.error=true;}
  root.querySelector('[data-page-price-status]').hidden=!record.error;
 };
 root.onchange=event=>{
  const key=event.target.dataset.pagePrice;
  if(!Object.hasOwn(record.values,key)||!Object.hasOwn(optionLabels(key),event.target.value))return;
  record.values[key]=event.target.value;
  save();onChange();
 };
 document.getElementById(page+'-simulation-defaults').onclick=()=>{
  for(const input of root.querySelectorAll('[data-page-price]')){
   const key=input.dataset.pagePrice;
   input.value=record.values[key]=defaults[key];
  }
  save();onReset();
 };
}
