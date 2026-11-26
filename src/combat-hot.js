import {MAX_SIMULATION_MINUTES} from './manual-settings.js';
import {game} from './model.js';
import {epoch,tickTime} from './hot-forecast.js';
export const DAY_TICKS=24*3600000/game.tickMs;
export function simulationTicks(hours=1){
 if(!Number.isFinite(hours)||hours<1/60||hours>MAX_SIMULATION_MINUTES/60||Math.abs(hours*60-Math.round(hours*60))>1e-6)throw Error('invalidDuration');
 return Math.round(hours*3600000/game.tickMs);
}
export function combatHot(now,hours=1,skill='combat'){
 return hotSchedule(now,simulationTicks(hours),skill);
}
export function hotSchedule(now,durationTicks,skill){
 if(!Number.isFinite(now)||now<epoch)throw Error('invalidTime');
 const start=Math.floor((now-epoch)/game.tickMs),end=start+durationTicks,entries=[];
 for(let tick=start;tick<end;){
  const hot=game.hotSkill(tick),until=Math.min(end,hot.until);
  if(hot.skill===skill)entries.push({...hot,from:tick,until});
  tick=until;
 }
 return {start,end,entries};
}
export function combatHotWindows(schedule,start=game.predictionStartTick){
 return schedule.entries.map(hot=>({
  fromTick:start+(hot.from===schedule.start?0:hot.from-schedule.start+1),
  toTick:start+hot.until-schedule.start,
  xpMult:hot.kind==='xp'?hot.mult:1,rarityMult:hot.kind==='rarity'?hot.mult:1,
 }));
}
export function combatHotMarkup(schedule,language,esc,skillLabel=language==='zh'?'战斗':'Combat'){
 const zh=language==='zh',format=tick=>{
  const d=new Date(tickTime(tick)),pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
 };
 const window=(from,until)=>`${format(from)} – ${format(until)}`;
 return `<p class="micro">${zh?'模拟区间':'Simulation window'}：${window(schedule.start,schedule.end)}<br>${zh?'本地时区':'Local time zone'}：${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</p>`+
 (schedule.entries.length?schedule.entries.map(hot=>`<p class="micro">${window(hot.from,hot.until)}<br>${esc(skillLabel)} · ${hot.kind==='xp'?(zh?'经验':'XP'):(zh?"稀有度":'Rarity')} +${Math.round((hot.mult-1)*100)}%</p>`).join(''):`<p class="micro">${zh?`此模拟区间内无${esc(skillLabel)}热门加成。`:`No ${esc(skillLabel.toLowerCase())} hot bonuses in this simulation window.`}</p>`);
}
export function simulationHotMarkup(now,hours,language,esc,skill,skillLabel){
 const previewHours=Math.min(hours,31*24);
 const schedule=combatHot(now,previewHours,skill);
 const fullWindow={...schedule,end:schedule.start+simulationTicks(hours)};
 const note=previewHours<hours
  ?`<p class="micro">${language==='zh'?'仅列出前 31 天的热门加成。':'Hot bonuses are listed for the first 31 days.'}</p>`:'';
 return combatHotMarkup(fullWindow,language,esc,skillLabel)+note;
}
export const rewardAmount=(total,period,hours=1)=>period==='total'?total:total/(simulationTicks(hours)*game.tickMs/3600000)*(period==='day'?24:1);
