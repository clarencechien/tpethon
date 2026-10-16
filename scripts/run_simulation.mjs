// Reproduce the illustrative experiment without TDX credentials or packages.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defaults,experiment,runScenario,modelVersion} from '../static/simulation_logic.js';
const results=experiment(defaults);
const report={schema_version:1,model_version:modelVersion,input_type:'assumptions_not_measured_demand',
 calibrated:false,inputs:defaults,units:{queue:'PCU',time_total:'PCU hours',timeline:'minutes after 06:00, illustrative morning'},
 limitations:['Abstract two-channel point queues, not a Neihu road network','No spillback, route choice equilibrium, signals, transit waiting/travel person-hours, or operating cost',
 'Bus fleet assumes fixed cycles; return traffic and background traffic are outside the modeled demand',
 'No calibrated weather or metro spare capacity'],
 results,capacity_sensitivity:[.8,1,1.2].map(scale=>({scale,results:results.map(r=>{
  const {series,...summary}=runScenario({...defaults,innerCapacity:defaults.innerCapacity*scale,outerCapacity:defaults.outerCapacity*scale},r.policy);
  return {id:r.id,...summary};
 })}))};
writeFileSync(fileURLToPath(new URL('../data/simulation/experiment.json',import.meta.url)),JSON.stringify(report)+'\n');
console.table(results.map(({id,carTrips,busDepartures,totalFleet,maxInnerQueue,maxOuterQueue,queuePCUHours,totalPCUHours})=>({id,
 carTrips:Math.round(carTrips),busDepartures,totalFleet,maxInnerQueue:Math.round(maxInnerQueue),maxOuterQueue:Math.round(maxOuterQueue),
 queuePCUHours:Math.round(queuePCUHours),totalPCUHours:Math.round(totalPCUHours)})));
