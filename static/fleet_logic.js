// E4: one fixed per-station timetable must pass every observed day and tested phase.
import {simulateStation,serviceDefaults,validateService} from './service_logic.js';
const EPS=1e-7;
export const HEADWAYS=[10,5,3,2,1];
export function arrivalPhases(interval){
 if(![0,3,6].includes(interval))throw Error('Unsupported arrival interval');
 return interval?Array.from({length:interval*2},(_,i)=>i/2):[0];
}
export function assessFleet(days,plan,options={}){
 const a={...serviceDefaults,...options};validateService(a);
 if(!days.length||!plan.length)throw Error('需要日期與逐站班表');
 const names=plan.map(p=>p.station);
 if(new Set(names).size!==names.length||days.some(d=>d.stations.length!==names.length||new Set(d.stations.map(s=>s.name)).size!==names.length||names.some(n=>!d.stations.find(s=>s.name===n))))throw Error('每日站點必須與班表一致');
 const results=plan.map(p=>({station:p.station,headway:p.headway,activeFleet:p.activeFleet,
  reserveFleet:Math.ceil(p.activeFleet*a.reserve),totalFleet:p.activeFleet+Math.ceil(p.activeFleet*a.reserve),
  worstP95:null,worstP95Case:null,maxUnserved:0,maxMissed:0,maxWaiting:0}));
 const daily=[];
 for(const day of days){
  let passed=true;
  for(const phase of arrivalPhases(a.arrivalInterval))for(const r of results){
   const station=day.stations.find(s=>s.name===r.station);
   const out=simulateStation(station,{...a,arrivalPhase:phase,headway:r.headway,fleet:r.activeFleet});
   if(out.p95Wait!==null&&(r.worstP95===null||out.p95Wait>r.worstP95)){
    r.worstP95=out.p95Wait;r.worstP95Case={day:day.day,phase};
   }
   r.maxUnserved=Math.max(r.maxUnserved,out.unserved);r.maxMissed=Math.max(r.maxMissed,out.missedDepartures);r.maxWaiting=Math.max(r.maxWaiting,out.peakWaiting);
   if(out.unserved>=EPS||out.missedDepartures!==0||(out.demand>EPS&&(out.p95Wait===null||out.p95Wait>10)))passed=false;
  }
  daily.push({day:day.day,passed});
 }
 return {stations:results,days:daily,passedDays:daily.filter(d=>d.passed).length,testedDays:days.length,
  phases:arrivalPhases(a.arrivalInterval),totalFleet:results.reduce((s,r)=>s+r.totalFleet,0),
  activeFleet:results.reduce((s,r)=>s+r.activeFleet,0),reserveFleet:results.reduce((s,r)=>s+r.reserveFleet,0),
  feasible:daily.every(d=>d.passed),calibrated:false};
}
export function robustFleet(days,options={}){
 const a={...serviceDefaults,...options};validateService(a);
 if(!days.length)throw Error('沒有需求資料');
 const selected=[];
 for(const station of days[0].stations){
  const stationDays=days.map(d=>({day:d.day,stations:d.stations.filter(s=>s.name===station.name)}));
  const zero=stationDays.every(d=>d.stations[0]?.hourly.every(v=>v*a.share===0));
  const choices=[];
  for(const headway of HEADWAYS){
   const activeFleet=zero?0:Math.ceil((a.roundTrip+a.rest)/headway);
   if(activeFleet>100)continue;
   const candidate={station:station.name,headway,activeFleet};
   const result=assessFleet(stationDays,[candidate],a);
   if(result.feasible)choices.push({candidate,result});
  }
  choices.sort((x,y)=>x.result.totalFleet-y.result.totalFleet||y.candidate.headway-x.candidate.headway);
  if(!choices.length)return {feasible:false,failedStation:station.name,totalFleet:null,calibrated:false};
  selected.push(choices[0].candidate);
 }
 return assessFleet(days,selected,a);
}
