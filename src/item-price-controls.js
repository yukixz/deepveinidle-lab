import {getItem,setAutoUpdate} from './price-service.js';
import * as game from './upstream.js';
import {translatedName} from './i18n.js';
import {priceCategories,itemCategory,validItemId,itemFamily,setItemPrice,lockItemPrices,clearUnlockedPrices} from './item-prices.js';
import {priceState,priceSaveError,updatePrices,subscribePrices,refreshMarketPrices} from './item-price-store.js';
import {marketErrors} from './market-import.js';

let editing=false,opener;
let language='zh',dialog,selected=new Set(),busy=false,status=null,marketError=null,query='',categoryFilter='all',tier='all',plus=0,filter='all';
const text=(zh,en)=>language==='zh'?zh:en;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rarity=()=>text(['普通','罕见','稀有','史诗','传说'],['Normal','Uncommon','Rare','Epic','Legendary']);
const opts=(arr,value)=>arr.map(([v,label])=>`<option value="${v}" ${String(v)===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const number=v=>v.toLocaleString(language==='zh'?'zh-CN':'en',{maximumFractionDigits:6});
const date=v=>new Date(v).toLocaleString(language==='zh'?'zh-CN':'en');
const errors={...marketErrors,invalidPrice:['单价必须为空或范围内的非负数值。','Unit prices must be blank or finite nonnegative numbers within range.'],invalidPriceStorage:['已保存价格格式无效，当前使用空价格表；未自动覆盖原存档。','Saved prices are invalid. An empty table is shown; the saved data has not been overwritten.'],priceReadFailed:['价格存储读取失败，当前设置未恢复。','Could not read saved prices.'],priceSaveFailed:['价格未保存：浏览器存储不可用，当前内存设置仍有效。','Prices were not saved. Browser storage is unavailable; current in-memory settings still apply.']};
const errorText=key=>(errors[key]??[key,key])[language==='zh'?0:1];
const statusError=()=>!busy&&(marketError||status?.error);
function message(){
 if(busy)return text('正在读取官方市场价格…','Reading official market prices…');
 if(statusError())return errorText(statusError());
 if(status?.stats){
  const {count,invalid}=status.stats;
  const message=text(`已刷新 ${count} 个物品变体的行情`,`Refreshed quotes for ${count} item variants`);
  return invalid?message+' · '+text(`异常 ${invalid}`,`Invalid: ${invalid}`):message;
 }
 if(status?.cleared!==undefined)return text(`已清空 ${status.cleared} 件未锁定物品的价格`,`Cleared prices for ${status.cleared} unlocked items`);
 if(status?.changed!==undefined)return text(`已${status.locked?'锁定':'解锁'} ${status.changed} 件物品`,`${status.locked?'Locked':'Unlocked'} ${status.changed} items`);
 const quotes=priceState().quotes,times=Object.values(quotes).flatMap(q=>Object.values(q).map(side=>side.capturedAt));
 if(!times.length)return '';
 const latest=Math.max(...times),count=Object.keys(quotes).length,age=Math.max(0,Math.floor((Date.now()-latest)/60000));
 return text(`已读取 ${count} 个物品变体 · 行情更新于 ${date(latest)} · 距今 ${age} 分钟`,`Read ${count} item variants · Quotes updated: ${date(latest)} · Age ${age} min`);
}
function refreshStatus(){
 const el=dialog.querySelector('#price-status');el.textContent=message();el.className='micro import-status'+(statusError()?' price-market-warning':'');el.setAttribute('role',statusError()?'alert':'status');
}
function hasFilters(){return categoryFilter!=='all'||query.trim()!==''||tier!=='all'||plus!==0||filter!=='all';}
function candidates(){
 if(!hasFilters())return [];
 const s=priceState(),q=query.trim().toLowerCase(),level=plus??0,ids=new Set(game.items.filter(i=>i.id===game.baseItemId(i.id)&&itemFamily(i.id)&&(game.canSell(i.id)||game.canTradeItem(i.id))).map(i=>i.id));
 for(const key of [...Object.keys(s.prices),...Object.keys(s.quotes)])ids.add(Number(key));
 for(const id of [...ids]){
  const base=game.baseItemId(id);for(const t of tier==='all'?[0,1,2,3,4]:[Number(tier)]){
   const encoded=game.encode(game.withRarity(base,t),level);if(validItemId(encoded)&&(level===0||game.canEnhance(encoded)))ids.add(encoded);
  }
 }
 return [...ids].filter(id=>{
  const base=game.item(game.baseItemId(id)),p=s.prices[id];
  if(categoryFilter!=='all'&&itemCategory(id)!==categoryFilter)return false;
  if(tier!=='all'&&game.itemTier(id)!==Number(tier))return false;
  if(plus!==null&&game.itemEnhancement(id)!==plus)return false;
  if(filter==='locked'&&!p?.locked||filter==='unpriced'&&p?.price!=null)return false;
  return !q||`${base.name} ${translatedName(base.name,'zh')} ${id}`.toLowerCase().includes(q);
 }).sort((a,b)=>game.baseItemId(a)-game.baseItemId(b)||a-b);
}
const quoteText=q=>!q?text('未读取','Not read'):`${q.invalid?text('异常','Invalid'):q.value===null?text('无报价','No quote'):number(q.value)}`;
const quantityText=(item,key)=>({unread:text('未读取','Not read'),invalid:text('异常','Invalid')})[item.market.status[key]]??number(item[key]);
function row(id){const s=priceState(),p=s.prices[id],q=s.quotes[id],base=game.item(game.baseItemId(id)),name=translatedName(base.name,language),t=game.itemTier(id),enhance=game.itemEnhancement(id);
 const item=getItem(id);
 const source={manual:text('手动','Manual'),avg7d:text('7天平均成交价格','7-day average trade price'),avg30d:text('30天平均成交价格','30-day average trade price'),ask:text('卖单','Ask'),bid:text('买单','Bid'),vendor:text('商人价','Vendor price')}[p?.source];
 return `<tr><td><input type="checkbox" data-price-select="${id}" aria-label="${esc(text('选择 ','Select ')+name+' · '+rarity()[t]+' +'+enhance)}" ${selected.has(id)?'checked':''}></td><td><strong>${esc(name)}·${rarity()[t]}${enhance?' +'+enhance:''}</strong><small>${id}</small></td><td><input type="number" min="0" max="${Number.MAX_SAFE_INTEGER}" step="any" data-price-value="${id}" aria-label="${esc(name+' '+text('单价','unit price'))}" value="${p?.price??''}" placeholder="${text('未定价','Unpriced')}"><small>${source??'—'}</small></td><td><input type="checkbox" data-price-lock="${id}" aria-label="${esc(text('锁定 ','Lock ')+name)}" ${p?.locked?'checked':''}></td><td>${item.vendorPrice===null?'—':number(item.vendorPrice)}</td><td>${quoteText(q?.ask)}</td><td>${quantityText(item,'sellQuantity')}</td><td>${quoteText(q?.bid)}</td><td>${quantityText(item,'buyQuantity')}</td><td>${quoteText(q?.avg7d)}</td><td>${quoteText(q?.avg30d)}</td></tr>`;
}
function render(){if(!dialog?.open||editing)return;
 const scroll=dialog.querySelector('.price-list')?.scrollTop??0,s=priceState(),rows=candidates();selected=new Set([...selected].filter(id=>rows.includes(id)));
 const saved=priceSaveError();
 dialog.innerHTML=`<div class="price-heading"><h2 id="item-prices-title">${text('全局行情与锁定','Global quotes & locks')}</h2><button id="price-close" class="secondary">${text('关闭','Close')}</button></div>
 <p class="micro">${text('行情与锁定价全站共用。手填价格自动锁定，空值为未定价。','Quotes and locked prices are shared across pages. Manual prices lock automatically. Blank means unpriced.')}</p>
 <div class="price-sync"><div class="price-import-options"><button id="price-import" class="secondary" ${busy?'disabled':''}>${text('更新价格','Update prices')}</button><label class="check"><input id="price-auto-import" type="checkbox" ${s.preferences.autoImport?'checked':''}>${text('自动更新价格','Automatically update prices')}</label></div>
 <span id="price-status" class="micro import-status${statusError()?' price-market-warning':''}" role="${statusError()?'alert':'status'}">${esc(message())}</span></div>
${saved?`<p class="issue-box" role="alert">${esc((errors[saved]??[saved,saved])[language==='zh'?0:1])}</p>`:''}
 <div class="price-filters"><label>${text('分类','Category')}<select id="price-family">${opts([['all',text('全部','All')],...priceCategories.map(category=>[category.key,text(category.zh,category.en)])],categoryFilter)}</select></label><label>${text('搜索','Search')}<input id="price-search" type="search" value="${esc(query)}" placeholder="${text('名称或物品编号','Name or item ID')}"></label><label>${text("稀有度",'Rarity')}<select id="price-tier">${opts([['all',text('全部','All')],...rarity().map((v,i)=>[i,v])],tier)}</select></label><label>${text('强化','Enhancement')}<input id="price-plus" type="number" min="0" max="${game.maxEnhancement}" step="1" value="${plus??''}" placeholder="${text('全部','All')}"></label><label>${text('状态','Status')}<select id="price-filter">${opts([['all',text('全部','All')],['locked',text('已锁定','Locked')],['unpriced',text('未定价','Unpriced')]],filter)}</select></label></div>
 <div class="price-actions"><label class="check"><input id="price-select-all" type="checkbox" ${!rows.length?'disabled':''} ${rows.length&&rows.every(id=>selected.has(id))?'checked':''}>${text('全选当前筛选结果','Select all filtered items')} (${rows.length})</label><span>${text('已选','Selected')} ${selected.size}</span><button id="price-bulk-lock" class="secondary" ${!selected.size?'disabled':''}>${text('批量锁定','Lock selected')}</button><button id="price-bulk-unlock" class="secondary" ${!selected.size?'disabled':''}>${text('批量解锁','Unlock selected')}</button><button id="price-clear" class="secondary" ${busy||!Object.values(s.prices).some(p=>!p.locked&&p.price!==null)?'disabled':''}>${text('清空价格','Clear prices')}</button></div>
 <div class="price-list table-scroll"><table><thead><tr>${['',text('物品','Item'),text('保存单价','Saved unit price'),text('锁定','Locked'),text('商人价格','Vendor price'),text('最低卖单价','Lowest ask'),text('在售数量','Quantity for sale'),text('最高买单价','Highest bid'),text('求购数量','Quantity wanted'),text('7天平均成交价格','7-day average trade price'),text('30天平均成交价格','30-day average trade price')].map(v=>`<th>${v}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row).join(''):`<tr><td colspan="11" class="${hasFilters()?'':'price-filter-prompt'}">${hasFilters()?text('没有匹配物品','No matching items'):text('物品数量较多，请先设置筛选条件','Many items to display; set a filter first')}</td></tr>`}</tbody></table></div>`;
 dialog.querySelector('#price-close').onclick=()=>dialog.close();
 dialog.querySelector('#price-import').onclick=()=>importPrices();
 dialog.querySelector('#price-auto-import').onchange=e=>{setAutoUpdate(e.target.checked);dialog.querySelector('#price-auto-import')?.focus();};
 const filters=[['price-family',v=>categoryFilter=v],['price-search',v=>query=v],['price-tier',v=>tier=v],['price-plus',v=>plus=v===''?null:Math.min(game.maxEnhancement,Math.max(0,Math.floor(Number(v)||0)))],['price-filter',v=>filter=v]];
 for(const [id,assign]of filters){const el=dialog.querySelector('#'+id);el.onchange=()=>{assign(el.value);selected.clear();render();dialog.querySelector('#'+id)?.focus();};}
 for(const el of dialog.querySelectorAll('[data-price-select]'))el.onchange=()=>{const id=Number(el.dataset.priceSelect);el.checked?selected.add(id):selected.delete(id);render();};
 dialog.querySelector('#price-select-all').onchange=e=>{selected=e.target.checked?new Set(rows):new Set();render();};
 const lock=(ids,locked)=>{const result=lockItemPrices(priceState(),ids,locked);status={changed:result.changed,locked};updatePrices(result.state);};
 dialog.querySelector('#price-bulk-lock').onclick=()=>lock([...selected],true);dialog.querySelector('#price-bulk-unlock').onclick=()=>lock([...selected],false);
 dialog.querySelector('#price-clear').onclick=()=>{
  if(busy||!confirm(text('确定清空所有未锁定物品的价格吗？此操作不限当前筛选，已锁定价格将保留。','Clear prices for all unlocked items? This applies beyond the current filter. Locked prices will be kept.')))return;
  const result=clearUnlockedPrices(priceState());status={cleared:result.cleared};selected.clear();updatePrices(result.state);
 };
 for(const el of dialog.querySelectorAll('[data-price-lock]'))el.onchange=()=>lock([Number(el.dataset.priceLock)],el.checked);
 for(const el of dialog.querySelectorAll('[data-price-value]')){
  const edit=()=>{try{const value=el.value===''?null:el.valueAsNumber;if(el.validity.badInput)throw Error('invalidPrice');status=null;editing=true;const id=Number(el.dataset.priceValue);updatePrices(lockItemPrices(setItemPrice(priceState(),id,value),[id],true).state);dialog.querySelector(`[data-price-lock="${id}"]`).checked=true;el.removeAttribute('aria-invalid');el.nextElementSibling.textContent=text('手动','Manual');status=priceSaveError()?{error:priceSaveError()}:null;refreshStatus();}catch(error){el.setAttribute('aria-invalid','true');status={error:error.message};refreshStatus();}finally{editing=false;}};
  el.oninput=edit;el.onchange=edit;
 }
 dialog.querySelector('.price-list').scrollTop=scroll;
}
async function importPrices(){if(busy)return;busy=true;render();
 try{const result=await refreshMarketPrices();marketError=null;status={stats:result.stats};
 }catch(error){marketError=error.message;status=null;}finally{busy=false;render();}
}
export function mountItemPrices(nextLanguage){language=nextLanguage;
 if(!dialog){dialog=document.createElement('dialog');dialog.id='item-prices-dialog';dialog.className='item-prices-dialog';dialog.setAttribute('aria-labelledby','item-prices-title');document.body.append(dialog);dialog.addEventListener('close',()=>{
   const page=opener?.closest('[data-page-prices]')?.dataset.pagePrices;
   if(opener?.isConnected)opener.focus();
   else if(opener?.id)document.getElementById(opener.id)?.focus();
   else if(page)document.querySelector(`[data-page-prices="${page}"] [data-open-global-prices]`)?.focus();
  });
  let outsidePointer=false;
  const outside=event=>{const rect=dialog.getBoundingClientRect();return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;};
  dialog.addEventListener('pointerdown',event=>{outsidePointer=event.target===dialog&&outside(event);});
  dialog.addEventListener('click',event=>{if(outsidePointer&&event.target===dialog&&outside(event))dialog.close();outsidePointer=false;});
  document.getElementById('app').addEventListener('click',event=>{
   const button=event.target.closest('[data-open-global-prices]');
   if(!button||dialog.open)return;
   opener=button;
   dialog.showModal();render();
  });
  subscribePrices(render);}
 render();
}
