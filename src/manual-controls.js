import {monsterKey} from './enemy-selection.js';
import {combatPerks} from './combat-options.js';
import {simulationHoursField} from './simulation-hours-control.js';
import {game} from './model.js';
export function manualControls(state,{language,number,options,esc,name}){
 const m=state.manual,zh=language==='zh',label=(a,b)=>zh?a:b;
 const n=(path,a,b,max=1e7,min=0,step=1)=>number('manual.'+path,label(a,b),path.split('.').reduce((v,k)=>v[k],m),max,min,step);
 const check=(path,a,b)=>`<label class="check"><span>${esc(label(a,b))}</span><input type="checkbox" data-path="manual.${path}" ${path.split('.').reduce((v,k)=>v[k],m)?'checked':''}></label>`;
 const select=(path,a,b,choices)=>`<label class="potion"><span>${label(a,b)}</span><select data-path="manual.${path}" aria-label="${label(a,b)}">${options(choices,m[path])}</select></label>`;
 const section=(id,a,b,html)=>`<details class="config-detail" id="${id}"><summary>${label(a,b)}</summary>${html}</details>`;
 const food=`<label class="potion"><span>${label('食物稀有度','Food rarity')}</span><select data-path="food.tier">${options(Array.from({length:5},(_,i)=>[i,[label('普通','Normal'),label('罕见','Uncommon'),label('稀有','Rare'),label('史诗','Epic'),label('传说','Legendary')][i]]),state.food.tier)}</select></label>`+select('foodPerTrip','每趟携带','Food per trip',[[5,'5'],[10,'10'],[20,'20'],[-2,label('留一格','Leave one slot')],[-1,label('满包','Full inventory')]])+`<label class="potion"><span>${label('自动进食阈值','Auto-eat threshold')}</span><select data-path="eatAt">${options([25,50,75].map(value=>[value,value+'%']),state.eatAt)}</select></label>`;
 const perks=section('perk-settings','特权','Perks',combatPerks.map(p=>(p.id==='meals'?number('meals',name(p.name),state.meals,p.ranks):n('perks.'+p.id,name(p.name),name(p.name),p.ranks))+`<p class="micro">${esc(name(p.each))}</p>`).join(''));
 const guild=n('guildXp','公会经验 (%)','Guild XP (%)',1e7,0,.1)+n('weeklyXp','世界增益经验 (%)','World buff XP (%)',1e7,0,.1)+`<p class="micro">${label('导入捕获时生效的世界增益，整个模拟周期保持生效。','Imports world buffs active at capture; they remain active throughout the simulation.')}</p>`+n('worldRarity','世界增益稀有发现 (%)','World buff rare finds (%)',1e7,0,.1)+`<p class="micro">${label('导入捕获时生效的世界增益，整个模拟周期保持生效。','Imports world buffs active at capture; they remain active throughout the simulation.')}</p>`+check('blessing','矿脉祝福','Vein Blessing')+`<p class="micro">${label('经验 +5% · 稀有度 +10% · 无限仓库','XP +5% · Rarity +10% · Unlimited storage')}</p>`;
 const hot=`<label class="potion"><span>${label('热门加成','Hot bonuses')}</span><select data-path="manual.hotSetting" aria-label="${label('热门加成','Hot bonuses')}">${options([['game',label('沿用游戏设置','Use game settings')],['current',label('按照当前时间','Use current time')],['off',label('不计入','Exclude')]],m.hotSetting)}</select></label><div id="combat-hot-schedule"></div>`;
 const supply=`<label class="potion"><span>${label('模拟初始仓库位置','Starting depot location')}</span><select data-path="homeBank">${options([[0,label('自动','Automatic')],...game.world.banks.map(b=>[b.id,`${label('仓库','Depot')} ${b.id} (${b.x}, ${b.y})`])],state.homeBank)}</select></label>`+check('ironman','铁人模式（不掉落坐骑）','Ironman (no mount drops)');
 const other=perks+section('other-settings','其它','Other',guild+supply);

 const duration=simulationHoursField(language,m.simulationHours,'data-path','manual.simulationHours');
 const enemies=select('enemySelection','敌人','Enemies',[["all",label('全部','All')],...[...game.monsters].sort((a,b)=>b.level-a.level).map(m=>[monsterKey(m),name(m.name)])]);
 const simulation=`<div id="simulation-settings">${enemies+duration+hot}</div>`;
 return {food,other,simulation};
}
