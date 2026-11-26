import {importAutomatically} from './price-service.js';
import {marketErrors} from './market-import.js';

export function startAutomaticPriceImport(getLanguage){
 let busy=false;
 const trigger=async()=>{
  if(busy)return;
  busy=true;
  try{await notifyAutomaticPriceImport(getLanguage);}finally{busy=false;}
 };
 window.addEventListener('focus',trigger);
 return trigger();
}

async function notifyAutomaticPriceImport(getLanguage){
 let result,error;
 try{result=await importAutomatically();}catch(cause){error=cause.message;}
 if(!result&&!error)return;
 const zh=getLanguage()==='zh';
 const storageErrors={
  priceAutoImportStorageFailed:['无法读取或保存自动导入时间，本次自动导入已跳过。','Could not read or save the automatic import time. Automatic import was skipped.'],
  invalidPriceStorage:['已保存价格格式无效，自动导入已跳过，原存档保留。','Saved prices are invalid. Automatic import was skipped; saved data was kept.'],
  priceReadFailed:['价格存储读取失败，自动导入已跳过。','Could not read saved prices. Automatic import was skipped.'],
  priceSaveFailed:['自动导入结果未保存：浏览器存储不可用，当前内存价格仍有效。','Imported prices could not be saved. Browser storage is unavailable; prices still apply in memory.'],
 };
 document.getElementById('price-auto-notice')?.click();
 const notification=document.createElement('div');notification.id='price-auto-notice';notification.className='price-auto-notice';
 const message=document.createElement('span');message.setAttribute('role',error?'alert':'status');
 message.textContent=error?(zh?'物品价格自动导入失败：':'Automatic price import failed: ')+(marketErrors[error]??storageErrors[error]??[error,error])[zh?0:1]:(zh?`市场行情自动更新完成，已刷新 ${result.stats.count} 个物品变体。`:`Market quotes refreshed for ${result.stats.count} item variants.`);
 notification.setAttribute('role','button');notification.tabIndex=0;
 notification.setAttribute('aria-label',message.textContent+' '+(zh?'点击关闭':'Click to dismiss'));
 const timeout=setTimeout(()=>notification.remove(),30000);
 const dismiss=()=>{clearTimeout(timeout);notification.remove();};
 notification.onclick=dismiss;
 notification.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();dismiss();}};
 notification.append(message);document.body.append(notification);
}
