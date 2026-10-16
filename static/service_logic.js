// E2: FIFO shuttle queues, separately operated stations; hourly OD entry cohorts.
// E3: assumed arrivals shaped by native VD passage weights, not a calibrated ramp.
import {queueStep} from './simulation_logic.js';
const EPS=1e-7;
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const valid=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max;
export const serviceDefaults=Object.freeze({share:.2,capacity:60,load:.8,headway:3,fleet:14,
 travelLag:30,roundTrip:30,rest:10,reserve:.1,tail:60});
export function weightedPercentile(events, share=.95){
 const total=sum(events.map(e=>e.people));if(total<EPS)return null;
 let seen=0;for(const e of [...events].sort((a,b)=>a.wait-b.wait)){seen+=e.people;if(seen>=total*share-EPS)return e.wait;}
 return null;
}
export function validateService(a){
 const ranges={share:[0,1],capacity:[1,200],load:[.01,1],headway:[1,15],fleet:[0,100],
 travelLag:[0,120],roundTrip:[1,180],rest:[0,60],reserve:[0,1],tail:[0,180]};
 for(const [key,[lo,hi]] of Object.entries(ranges))if(!valid(a[key],lo,hi))throw Error('接駁參數超出範圍：'+key);
 for(const key of ['capacity','fleet','travelLag','roundTrip','rest','tail'])if(!Number.isInteger(a[key]))throw Error('接駁參數須為整數：'+key);
 if(!Number.isInteger(a.headway*2))throw Error('班距須為半分鐘倍數');
 if(Math.floor(a.capacity*a.load)<1)throw Error('有效容量不足一人');
}
export function simulateStation(station,options={}){
 const a={...serviceDefaults,...options};validateService(a);
 if(!Array.isArray(station.hourly)||station.hourly.length!==3||station.hourly.some(x=>!valid(x,0,1000000)))throw Error('需要三個完整、非負的進站小時人次');
 const demand=sum(station.hourly)*a.share,capacity=Math.floor(a.capacity*a.load),cycle=a.roundTrip+a.rest;
 const requiredFleet=demand>EPS?Math.ceil(cycle/a.headway):0;
 const ready=new Array(a.fleet).fill(0),cohorts=[],waitEvents=[],series=[];
 let waiting=0,boarded=0,cursor=0,waitTotal=0,area=0,departures=0,missed=0,peakWaiting=0,maxLeftBehind=0,peakBusy=0,lastBoarding=null;
 const start=a.travelLag,end=start+180,limit=end+a.tail,dt=.5;
 for(let step=0;step<=limit*2;step++){
  const t=step*dt,hour=Math.floor((t-start)/60);
  if(t>=start&&t<end&&demand>EPS){const people=station.hourly[hour]*a.share/120;if(people>0){cohorts.push({time:t,people});waiting+=people;}}
  peakWaiting=Math.max(peakWaiting,waiting);
  // Fixed schedule: an unavailable fleet misses a departure instead of teleporting a bus.
  const due=t>=start&&Number.isInteger((t-start)/a.headway);
  if(demand>EPS&&due&&(t<end||waiting>EPS)){
   const vehicle=ready.findIndex(r=>r<=t+EPS);
   if(vehicle<0)missed++;
   else{
    let space=capacity,took=0;
    while(space>EPS&&cursor<cohorts.length){
     const c=cohorts[cursor],take=Math.min(space,c.people),wait=t-c.time;
     c.people-=take;space-=take;took+=take;waitTotal+=take*wait;waitEvents.push({wait,people:take});
     if(c.people<EPS)cursor++;
    }
    waiting=Math.max(0,waiting-took);boarded+=took;if(took>EPS)lastBoarding=t;
    departures++;ready[vehicle]=t+cycle;peakBusy=Math.max(peakBusy,ready.filter(r=>r>t).length);
    maxLeftBehind=Math.max(maxLeftBehind,waiting);
   }
  }
  if(step<limit*2)area+=waiting*dt;
  if(step%10===0||step===limit*2)series.push({minute:t,waiting,boarded});
 }
 const spare=demand>EPS?Math.ceil(a.fleet*a.reserve):0;
 return {station:station.name,demand,boarded,unserved:waiting,capacity,cycle,headway:a.headway,activeFleet:demand>EPS?a.fleet:0,
 requiredFleet,reserveFleet:spare,totalFleet:demand>EPS?a.fleet+spare:0,peakBusy,departures,missedDepartures:missed,
 meanWait:boarded>EPS?waitTotal/boarded:null,p95Wait:weightedPercentile(waitEvents),
 passengerWaitHours:area/60,peakWaiting,maxLeftBehind,lastBoarding,arrivalEnd:end,serviceEnd:limit,
 series,waitEvents,calibrated:false};
}
export function simulateShuttles(stations,options={}){
 if(!Array.isArray(stations)||!stations.length||new Set(stations.map(s=>s.name)).size!==stations.length)throw Error('接駁站點需要唯一名稱');
 const results=stations.map(s=>simulateStation(s,options));
 const demand=sum(results.map(r=>r.demand)),boarded=sum(results.map(r=>r.boarded));
 return {results,demand,boarded,unserved:sum(results.map(r=>r.unserved)),
 meanWait:boarded>EPS?sum(results.map(r=>(r.meanWait||0)*r.boarded))/boarded:null,
 p95Wait:weightedPercentile(results.flatMap(r=>r.waitEvents)),
 totalFleet:sum(results.map(r=>r.totalFleet)),activeFleet:sum(results.map(r=>r.activeFleet)),
 reserveFleet:sum(results.map(r=>r.reserveFleet)),passengerWaitHours:sum(results.map(r=>r.passengerWaitHours)),
 missedDepartures:sum(results.map(r=>r.missedDepartures)),calibrated:false};
}
export function recommendShuttles(stations,options={},targetWait=10){
 if(!valid(targetWait,0,120))throw Error('候車目標無效');
 return stations.map(station=>{
  const a={...serviceDefaults,...options};validateService(a);
  if(sum(station.hourly)*a.share<EPS)return {station:station.name,feasible:true,headway:null,activeFleet:0,totalFleet:0,p95Wait:null,unserved:0};
  const choices=[10,5,3,2,1].map(headway=>{
   const fleet=Math.ceil((a.roundTrip+a.rest)/headway);
   if(fleet>100)return null;
   return simulateStation(station,{...a,headway,fleet});
  }).filter(r=>r&&r.unserved<EPS&&r.p95Wait!==null&&r.p95Wait<=targetWait+EPS&&r.missedDepartures===0)
    .sort((a,b)=>a.totalFleet-b.totalFleet||b.headway-a.headway);
  const r=choices[0];
  return r?{station:station.name,feasible:true,headway:r.headway,activeFleet:r.activeFleet,totalFleet:r.totalFleet,
    reserveFleet:r.reserveFleet,p95Wait:r.p95Wait,meanWait:r.meanWait,unserved:r.unserved,lastBoarding:r.lastBoarding}:
    {station:station.name,feasible:false,reason:'測試的 1／2／3／5／10 分班距中，沒有符合候車目標與載完條件的方案。'};
 });
}
export const rampDefaults=Object.freeze({totalDemand:3000,capacity:750,initialQueue:0,removeShare:0,shiftShare:0,delay:60,tail:120});
export function simulateRamp(weights,options={}){
 const a={...rampDefaults,...options};
 const ranges={totalDemand:[0,30000],capacity:[1,10000],initialQueue:[0,10000],removeShare:[0,1],shiftShare:[0,1],delay:[0,120],tail:[0,720]};
 for(const [key,[lo,hi]] of Object.entries(ranges))if(!valid(a[key],lo,hi))throw Error('排隊參數超出範圍：'+key);
 for(const k of ['delay','tail'])if(!Number.isInteger(a[k]))throw Error('延後與模擬尾段需為整數分鐘');
 if(!Array.isArray(weights)||!weights.length||weights.some(x=>!valid(x,0,1e9))||sum(weights)<=0)throw Error('通過型態有缺測或無有效流量，不能補零模擬');
 const normal=sum(weights),arrivals=Array(weights.length+a.delay).fill(0),removed=a.totalDemand*a.removeShare;
 for(let i=0;i<weights.length;i++){
  const amount=a.totalDemand*(1-a.removeShare)*weights[i]/normal;
  arrivals[i]+=amount*(1-a.shiftShare);arrivals[i+a.delay]+=amount*a.shiftShare;
 }
 let queue=a.initialQueue,area=0,served=0,peak=queue,lastNonzero=null;
 const series=[],end=arrivals.length+a.tail;
 for(let t=0;t<end;t++){
  const arrived=arrivals[t]||0;
  const step=queueStep(queue,arrived,a.capacity/60);area+=step.area;served+=step.served;queue=step.queue;peak=Math.max(peak,queue);
  if(queue>EPS)lastNonzero=t+1;
  series.push({minute:t+1,queue,arrivals:arrived});
 }
 const modeled=sum(arrivals);
 return {totalDemand:a.totalDemand,modeledDemand:modeled,removedDemand:removed,shiftedDemand:modeled*a.shiftShare,
 initialQueue:a.initialQueue,served,residual:queue,peakQueue:peak,queueVehicleHours:area/60,
 meanQueueMinutes:queue<EPS&&modeled+a.initialQueue>EPS?area/(modeled+a.initialQueue):null,
 lastQueuedMinute:lastNonzero,series,calibrated:false};
}
export function rampScenarios(weights,options={}){
 const a={...rampDefaults,...options};
 return [
  {label:'假設基準',removeShare:0,shiftShare:0,delay:60},
  ...[.05,.1,.2].map(removeShare=>({label:`需求轉移 ${removeShare*100}%`,removeShare,shiftShare:0,delay:60})),
  {label:'20% 延後 30 分',removeShare:0,shiftShare:.2,delay:30},
  {label:'20% 延後 60 分',removeShare:0,shiftShare:.2,delay:60},
 ].map(p=>({label:p.label,...simulateRamp(weights,{...a,...p})}));
}
