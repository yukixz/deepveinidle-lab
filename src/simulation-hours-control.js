import {MAX_SIMULATION_HOURS,normalizeSimulationHours} from './manual-settings.js';

export function simulationHoursField(language,value,attribute,path){
 const label=language==='zh'?'模拟时间（小时）':'Simulation time (hours)';
 return `<label class="number-field"><span>${label}</span><input type="number" ${attribute}="${path}" data-simulation-hours min="1" max="${MAX_SIMULATION_HOURS}" step="1" value="${value}" aria-label="${label}"></label>`;
}

export function bindSimulationHours(input,onChange){
 const update=()=>onChange(normalizeSimulationHours(input.valueAsNumber));
 input.oninput=()=>{if(Number.isFinite(input.valueAsNumber))update();};
 input.onblur=()=>{const hours=normalizeSimulationHours(input.valueAsNumber);input.value=hours;onChange(hours);};
}
