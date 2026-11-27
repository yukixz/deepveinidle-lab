import * as game from './upstream.js';
import {translatedName} from './i18n.js';

export function calculateWorldBosses(player){
 const style=game.style(player),seconds=game.attackTicks(player)*game.tickMs/1000;
 return game.bosses.map((boss,index)=>{
  const base=game.bossStats.find(x=>x.id===boss.contentId);
  if(!base)throw new Error(`Missing world boss stats: ${boss.name}`);
  const multiplier=style===boss.fears?game.bossWeakMultiplier:game.bossOtherMultiplier;
  const max=Math.max(1,Math.round(game.maxHit(player)*multiplier));
  const chance=game.hitChance(game.accuracy(player),10+base.defence*game.armourMultiplier(player));
  return {...boss,key:`world-boss-${index}`,level:base.recommendedLevel,max,chance,seconds,dps:(max+1)/2*chance/seconds,
   attack:base.attack,defence:base.defence,enemySeconds:base.speed*game.tickMs/1000,
   enemyMax:Math.max(1,Math.floor(base.maxHit*(1-game.damageReduction(player,player.lastTick)))),
   enemyChance:game.hitChance(10+base.attack,game.evasion(player))};
 });
}

const copy={
 zh:{title:'世界首领',boss:'首领',level:'推荐等级',weakness:'弱点流派',max:'我方最大伤害',chance:'我方命中率',seconds:'攻击间隔',dps:'理论 DPS',enemyMax:'敌方最大伤害',enemyChance:'敌方命中率',attack:'基础攻击',defence:'基础防御',enemySeconds:'敌方攻击间隔',second:'秒',melee:'近战',ranged:'远程',magic:'魔法'},
 en:{title:'World bosses',boss:'Boss',level:'Recommended level',weakness:'Weak style',max:'Your max hit',chance:'Your hit chance',seconds:'Attack interval',dps:'Theoretical DPS',enemyMax:'Enemy max hit',enemyChance:'Enemy hit chance',attack:'Base attack',defence:'Base defence',enemySeconds:'Enemy attack interval',second:'s',melee:'Melee',ranged:'Ranged',magic:'Magic'}
};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const columns=['boss','weakness','dps','max','chance','seconds','enemyMax','enemyChance'];
export function renderWorldBosses(rows,{language='zh',sort=null,direction='desc',open=new Set()}={}){
 const t=copy[language],name=s=>translatedName(s,language);
 const headers=columns.map(key=>{
  const sortKey=key==='boss'?'level':key,sortable=key!=='weakness',active=sort===sortKey;
  return `<th${sortable?` aria-sort="${active?(direction==='asc'?'ascending':'descending'):'none'}"`:''}>${sortable?`<button class="sort-header" data-boss-sort="${sortKey}">${t[key]} <span class="sort-arrow" aria-hidden="true">${active?(direction==='asc'?'↑':'↓'):'↕'}</span></button>`:t[key]}</th>`;
 }).join('');
 const body=rows.map(row=>`<tr data-boss="${row.key}"><td class="column-highlight"><details id="${row.key}-details" class="reward-detail" ${open.has(row.key)?'open':''}><summary><span class="enemy-name"><span><strong>${esc(name(row.name))}</strong><small>${t.level} ${row.level}</small></span></span></summary><div>${t.attack}: ${row.attack}<br>${t.defence}: ${row.defence}<br>${t.enemySeconds}: ${row.enemySeconds.toFixed(2)} ${t.second}</div></details></td><td>${t[row.fears]}</td><td class="column-highlight">${row.dps.toFixed(2)}</td><td>${row.max}</td><td>${(row.chance*100).toFixed(2)}%</td><td>${row.seconds.toFixed(2)} ${t.second}</td><td>${row.enemyMax}</td><td>${(row.enemyChance*100).toFixed(2)}%</td></tr>`).join('');
 return `<div class="enemies-heading"><h2 id="world-boss-title">${t.title}</h2></div><div class="table-scroll"><table aria-labelledby="world-boss-title"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}
