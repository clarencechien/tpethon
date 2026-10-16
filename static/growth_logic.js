import {runScenario,validate} from './simulation_logic.js';

export function compound(base,rate,years){
 if(!Number.isFinite(base)||base<0||!Number.isFinite(rate)||rate<-.2||rate>.2||!Number.isInteger(years)||years<0||years>20)throw Error('成長率需在 −20%～20%，年數需為 0～20 整數');
 return base*(1+rate)**years;
}

export function profileWeights(profile){
 if(profile?.duration_minutes!==150||profile.step_minutes!==15||!Array.isArray(profile.values)||profile.values.length!==10||profile.values.some(v=>!Number.isFinite(v)||v<0)||!Array.isArray(profile.days)||new Set(profile.days).size<3||![420,1020].includes(profile.start_minute)||profile.values.reduce((s,v)=>s+v,0)<=0)throw Error('實測型態不足三天、缺格或格式不符，不能帶入模型');
 // Holding each sampled weight for 15 minutes is a modeling assumption,
 // NOT reconstruction of actual continuous traffic or interval counts.
 return profile.values.flatMap(v=>Array(15).fill(v));
}

export function projectInputs(base,{demandRate,capacityRate,years}){
 const output={...base,people:Math.round(compound(base.people,demandRate,years)),
  innerCapacity:compound(base.innerCapacity,capacityRate,years),outerCapacity:compound(base.outerCapacity,capacityRate,years)};
 validate(output);return output;
}

export function annualProjection(base,settings,policy){
 compound(1,settings.demandRate,settings.years);compound(1,settings.capacityRate,settings.years);
 return Array.from({length:settings.years+1},(_,years)=>{
  const input=projectInputs(base,{...settings,years});
  const brief=r=>{const {series,...summary}=r;return summary;};
  return {years,people:input.people,innerCapacity:input.innerCapacity,outerCapacity:input.outerCapacity,
   baseline:brief(runScenario(input)),selected:brief(runScenario(input,policy))};
 });
}

export function metroBaseline(data){
 if(!Number.isFinite(data?.total_journeys)||data.total_journeys<0||!Number.isInteger(data.weekdays)||data.weekdays<=0||!Array.isArray(data.dates)||data.dates.length!==data.weekdays)throw Error('捷運基準格式不符');
 return data.total_journeys/data.weekdays;
}
