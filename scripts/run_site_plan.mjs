import fs from 'node:fs';
import crypto from 'node:crypto';
import {spaceDefaults,assessSpace} from '../static/space_logic.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const raw=read('data/simulation/service-inputs.json'),input=JSON.parse(raw),sitesRaw=read('data/simulation/site-plan.json'),sites=JSON.parse(sitesRaw);
if(!sites.facilities.find(f=>f.id==='TPE1956').fees.includes('15,000'))throw Error('Published parking tariff changed; review the cost scenario before rebuilding');
const cases=[
 {id:'pilot',label:'試辦草案：9 出勤＋1 備車',fleet:9,extra:10,roundTrip:30,share:.05},
 {id:'lean',label:'較小車隊：7 出勤＋1 備車',fleet:7,extra:10,roundTrip:30,share:.05},
 {id:'lean_detour',label:'小車隊遇空駛增加',fleet:7,extra:20,roundTrip:30,share:.05},
 {id:'long_deadhead',label:'原試辦車隊，空駛共 20 分',fleet:9,extra:20,roundTrip:30,share:.05},
 {id:'slow_loop',label:'行車變慢：一圈 45 分＋空駛 20 分',fleet:9,extra:20,roundTrip:45,share:.05},
 {id:'higher_demand',label:'使用人數加倍：10% 接駁',fleet:9,extra:10,roundTrip:30,share:.1}
];
const plans=[];
for(const site of sites.plans){
 const days=input.metro.daily.map(d=>({day:d.day,stations:d.stations.filter(s=>s.name===site.station)}));
 const daily=days.map(d=>({day:d.day,journeys:d.stations[0].hourly.reduce((a,b)=>a+b,0)}));
 const scenarios=cases.map(c=>{
  const options={...spaceDefaults,restSpaces:2,berths:1,reserve:1,...c};
  return {...c,options,result:assessSpace(days,options)};
 });
 plans.push({id:site.id,station:site.station,mean_journeys:daily.reduce((s,d)=>s+d.journeys,0)/days.length,
  max_journeys:Math.max(...daily.map(d=>d.journeys)),daily,scenarios,
  operating_draft:{pickup_bays_requested:1,terminal_alighting_bays_requested:1,rest_bays_requested:2,
   spare_bays_requested:1,overnight_bays_requested:10,verified_available_bays:null,
   monthly_parking_scenario_twd:150000,parking_rate_per_bay_month_twd:15000,
   fee_basis:'行善六場公開大客車月租 15,000 元 × 假設承租 10 格；不是報價或已簽租約。不含車、人力、燃料、設施及其他成本。',
   modeled_time:'07:30–11:30',passenger_arrival_window:'07:30–10:30',stage:'晨間單線試辦草案，尚不可開行'}});
}
const out={schema_version:1,generated_at:new Date().toISOString(),input_sha256:hash(raw),site_input_sha256:hash(sitesRaw),
 model_sha256:Object.fromEntries(['space_logic.js','service_logic.js','fleet_logic.js'].map(n=>[n,hash(read('static/'+n))])),
 calibrated:false,plans,simultaneous_two_lines:{overnight_bays_requested:20,rest_bays_requested:4,spare_bays_requested:2,
 independent_allocation:true,shared_dispatch_simulated:false,monthly_parking_scenario_twd:300000,
 note:'兩線若同時啟動，基地名額分開保留，不把同一批 10 格重複用兩次；未驗證共用入口、轉向與月台干擾。'}};
fs.writeFileSync(new URL('data/simulation/site-service.json',root),JSON.stringify(out)+'\n');
for(const p of plans)console.log(JSON.stringify({station:p.station,mean:p.mean_journeys,cases:p.scenarios.map(c=>({id:c.id,headway:c.result.plan.headway,passed:c.result.passedDays,wait:c.result.stations[0].worstP95}))}));
