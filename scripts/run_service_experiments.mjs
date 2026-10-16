// Frozen defaults and stress cases, using the same algorithms as the public page.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {simulateStation,simulateShuttles,recommendShuttles,rampScenarios,serviceDefaults,rampDefaults} from '../static/service_logic.js';
const inputPath=new URL('../data/simulation/service-inputs.json',import.meta.url);
const raw=fs.readFileSync(inputPath),data=JSON.parse(raw);
const summarizeShuttle=r=>({...r,results:r.results.map(({series,waitEvents,...row})=>row)});
const summarizeRamp=rows=>rows.map(({series,...r})=>r);
const stations=data.metro.mean_stations,total=d=>d.stations.reduce((s,r)=>s+r.hourly.reduce((a,b)=>a+b,0),0);
const peak=[...data.metro.daily].sort((a,b)=>total(b)-total(a))[0];
const daily=data.metro.daily.map(d=>({day:d.day,...summarizeShuttle(simulateShuttles(d.stations))}));
const peakPlan=recommendShuttles(peak.stations);
const crossDayPeakPlan=data.metro.daily.map(d=>({day:d.day,stations:d.stations.map((station,i)=>{const plan=peakPlan[i];const r=simulateStation(station,{headway:plan.headway,fleet:plan.activeFleet});return {station:station.name,p95:r.p95Wait,unserved:r.unserved,missed:r.missedDepartures};})}));
const output={schema_version:1,generated_at:new Date().toISOString(),input_sha256:crypto.createHash('sha256').update(raw).digest('hex'),
 model_sha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('../static/service_logic.js',import.meta.url))).digest('hex'),
 calibrated:false,shuttle:{assumptions:serviceDefaults,cases:[
  {label:'月平均需求／預設大巴',...summarizeShuttle(simulateShuttles(stations))},
  {label:'月平均需求／20 人小巴',...summarizeShuttle(simulateShuttles(stations,{capacity:20}))},
  {label:'月平均需求／5 分班距',...summarizeShuttle(simulateShuttles(stations,{headway:5}))},
  {label:'月平均需求／往返增加 20 分',...summarizeShuttle(simulateShuttles(stations,{roundTrip:50}))},
  {label:'本批最高需求日 '+peak.day,...summarizeShuttle(simulateShuttles(peak.stations))}],
  daily_default:daily,cross_day_peak_plan:crossDayPeakPlan,recommendations:{mean:recommendShuttles(stations),peak_day:peak.day,peak:recommendShuttles(peak.stations),small_bus:recommendShuttles(stations,{capacity:20})}},
 ramp:{assumptions:rampDefaults,unit_verified:data.ramp.unit_verified,arrivals_measured:false,days:data.ramp.days.map(d=>({day:d.day,complete:d.complete,
  cases:d.complete&&d.relative_weights?summarizeRamp(rampScenarios(d.relative_weights)):[],
  sensitivity:d.complete&&d.relative_weights?[.8,1,1.2].map(factor=>({capacity:rampDefaults.capacity*factor,cases:summarizeRamp(rampScenarios(d.relative_weights,{capacity:rampDefaults.capacity*factor}))})):[]}))}};
fs.writeFileSync(new URL('../data/simulation/service-experiment.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({shuttle:output.shuttle.cases.map(r=>({label:r.label,demand:r.demand,unserved:r.unserved,p95:r.p95Wait,fleet:r.totalFleet})),ramp:output.ramp.days.map(d=>({day:d.day,complete:d.complete,cases:d.cases.map(r=>({label:r.label,vehicleHours:r.queueVehicleHours,residual:r.residual}))}))},null,2));
