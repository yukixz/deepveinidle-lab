import {questlessOffline} from '../scripts/native-questless.mjs';
import * as combatGame from '../src/upstream-combat.js';
import * as workGame from '../src/upstream.js';
import {DAY_TICKS,START_TICK} from '../src/simulation.js';
// Use upstream offline chunk reports independently of the adapter's event totals.
export function nativeDay(player,context,start,durationTicks=DAY_TICKS){
 const game=context.world===combatGame.world?combatGame:workGame;
 let p;game.predict(player,context,prepared=>{p=prepared;return false;});
 if(!start(p))throw Error('No route');
 p.offlineCapTicks=durationTicks*2;
 const result={xpPerHour:0,bySkill:{},ticks:0,deaths:0,itemsGained:{}};
 for(let offset=game.predictionChunkTicks;offset<=durationTicks;offset+=game.predictionChunkTicks){
  const report=questlessOffline(game,p,context,START_TICK+offset);
  result.ticks=offset;result.deaths+=report.deaths;
  for(const [skill,value]of Object.entries(report.skills))if(value.xp)result.bySkill[skill]=(result.bySkill[skill]??0)+value.xp;
  for(const [id,qty]of Object.entries(report.itemsGained))result.itemsGained[id]=(result.itemsGained[id]??0)+qty;
  if(report.deaths||p.route===null)break;
 }
 result.xpPerHour=Object.values(result.bySkill).reduce((sum,xp)=>sum+xp,0);
 return result;
}
