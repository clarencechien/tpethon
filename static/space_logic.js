// E5: periodic, space-constrained dispatch. No bus is allowed to queue on the road.
// Layover occupancy includes recovery AND timetable padding; spares stay off site.
import {weightedPercentile} from './service_logic.js';
import {arrivalPhases} from './fleet_logic.js';
const EPS=1e-7,ceil=x=>Math.ceil(x-EPS),sum=xs=>xs.reduce((a,b)=>a+b,0);
export const spaceDefaults=Object.freeze({share:.2,fleet:20,reserve:2,berths:1,restSpaces:1,
 dwell:2,roundTrip:30,rest:10,extra:0,desiredHeadway:2,capacity:48,arrivalInterval:6,arrivalPhase:.5,tail:60});
export const spaceCases=Object.freeze([
 {id:'one',label:'站旁 1 停靠＋1 休息',berths:1,restSpaces:1},
 {id:'two',label:'站旁 1 停靠＋2 休息',berths:1,restSpaces:2},
 {id:'two_berths',label:'站旁 2 停靠＋2 休息',berths:2,restSpaces:2},
 {id:'six',label:'站旁 1 停靠＋6 休息',berths:1,restSpaces:6},
 {id:'remote',label:'遠端 6 休息，空駛多 10 分',berths:1,restSpaces:6,extra:10},
 {id:'remote_slow',label:'遠端 6 休息，空駛多 20 分',berths:1,restSpaces:6,extra:20},
 {id:'slow_boarding',label:'上下客 4 分，1 停靠＋6 休息',berths:1,restSpaces:6,dwell:4},
 {id:'slow_two',label:'上下客 4 分，2 停靠＋6 休息',berths:2,restSpaces:6,dwell:4}
]);
export function validateSpace(a){
 const ranges={share:[0,1],fleet:[0,60],reserve:[0,10],berths:[0,4],restSpaces:[0,12],dwell:[.5,10],roundTrip:[5,120],rest:[1,30],extra:[0,60],desiredHeadway:[1,15],capacity:[1,120],tail:[0,180]};
 for(const [k,[lo,hi]] of Object.entries(ranges))if(!Number.isFinite(a[k])||a[k]<lo||a[k]>hi)throw Error('場地參數超出範圍：'+k);
 for(const k of ['fleet','reserve','berths','restSpaces','capacity','tail'])if(!Number.isInteger(a[k]))throw Error('車數、人數與車位須為整數：'+k);
 for(const k of ['dwell','roundTrip','rest','desiredHeadway'])if(!Number.isInteger(a[k]*2))throw Error('時間須為半分鐘倍數：'+k);
 if(!Number.isInteger(a.extra/2))throw Error('遠端往返空駛需為 2 分鐘倍數');
 if(!arrivalPhases(a.arrivalInterval).includes(a.arrivalPhase))throw Error('到站偏移不在測試範圍內');
}
export function requirements(a,h){
 const rawCycle=a.dwell+a.roundTrip+a.rest+a.extra;
 const activeFleet=ceil(rawCycle/h),cycle=activeFleet*h,padding=cycle-rawCycle;
 return {headway:h,activeFleet,cycle,padding,restOccupancy:a.rest+padding,
  peakBerths:ceil(a.dwell/h),peakRest:ceil((a.rest+padding)/h)};
}
export function planSpace(options={}){
 const a={...spaceDefaults,...options};validateSpace(a);
 const requested=requirements(a,a.desiredHeadway);
 for(let h=a.desiredHeadway;h<=60;h+=.5){
  const r=requirements(a,h);
  if(r.activeFleet<=a.fleet&&r.peakBerths<=a.berths&&r.peakRest<=a.restSpaces)return {...r,
   feasible:true,requested,capacityPerHour:60/h*a.capacity,
   unusedFleet:a.fleet-r.activeFleet,offsiteParking:a.fleet-r.activeFleet+a.reserve,
   offeredFleet:a.fleet+a.reserve,spares:a.reserve,calibrated:false};
 }
 return {feasible:false,requested,headway:null,activeFleet:0,offsiteParking:a.fleet+a.reserve,capacityPerHour:0,calibrated:false};
}
export function vehicleState(plan,options,t){
 const a={...spaceDefaults,...options},count={boarding:0,road:0,resting:0};
 if(!plan.feasible)return count;
 for(let i=0;i<plan.activeFleet;i++){
  const phase=((t-i*plan.headway)%plan.cycle+plan.cycle)%plan.cycle;
  const restStart=a.dwell+a.roundTrip+a.extra/2;
  if(phase<a.dwell-EPS)count.boarding++;
  else if(phase>=restStart-EPS&&phase<restStart+plan.restOccupancy-EPS)count.resting++;
  else count.road++;
 }
 return count;
}
export function simulateSpace(station,options={}){
 const a={...spaceDefaults,...options},plan=planSpace(a);
 if(!Array.isArray(station.hourly)||station.hourly.length!==3||station.hourly.some(v=>!Number.isFinite(v)||v<0||v>1e6))throw Error('需要三個完整的非負小時人次');
 const demand=sum(station.hourly)*a.share,cohorts=[],loading=[],events=[],series=[];
 let cursor=0,waiting=0,departed=0,waitTotal=0,peakWaiting=0,starts=0,completed=0;
 const end=180+a.tail;
 for(let tick=0;tick<=end*2;tick++){
  const t=tick/2;
  // Complete boarding first; passengers are not reported served until departure.
  for(let i=loading.length-1;i>=0;i--)if(loading[i].end<=t+EPS){
   const trip=loading.splice(i,1)[0];departed+=trip.people;completed++;
   for(const c of trip.cohorts){const wait=t-c.time;waitTotal+=wait*c.people;events.push({wait,people:c.people});}
  }
  if(t<180){
   const due=a.arrivalInterval===0||t%a.arrivalInterval===a.arrivalPhase;
   const amount=due?station.hourly[Math.floor(t/60)]*a.share*(a.arrivalInterval||.5)/60:0;
   if(amount>0){cohorts.push({time:t,people:amount});waiting+=amount;}
  }
  peakWaiting=Math.max(peakWaiting,waiting);
  if(plan.feasible&&Number.isInteger(t/plan.headway)&&t<end){
   // Only those present when doors open can use this trip; later arrivals wait for the next.
   let room=a.capacity,people=0;const tripCohorts=[];
   while(room>EPS&&cursor<cohorts.length){
    const c=cohorts[cursor],take=Math.min(room,c.people);c.people-=take;room-=take;people+=take;tripCohorts.push({time:c.time,people:take});
    if(c.people<EPS)cursor++;
   }
   waiting=Math.max(0,waiting-people);loading.push({end:t+a.dwell,people,cohorts:tripCohorts});starts++;
  }
  if(tick%2===0||tick===end*2)series.push({minute:t,waiting,loading:sum(loading.map(v=>v.people)),departed,...vehicleState(plan,a,t)});
 }
 const inBoarding=sum(loading.map(v=>v.people));
 return {station:station.name,plan,demand,departed,unserved:waiting+inBoarding,waiting,inBoarding,
  meanWait:departed>EPS?waitTotal/departed:null,p95Wait:weightedPercentile(events),peakWaiting,
  startedTrips:starts,completedTrips:completed,series,calibrated:false};
}
export function assessSpace(days,options={}){
 if(!Array.isArray(days)||!days.length)throw Error('缺少逐日需求');
 const a={...spaceDefaults,...options},plan=planSpace(a);
 const names=days[0].stations.map(s=>s.name);
 if(!names.length||new Set(names).size!==names.length||days.some(d=>d.stations.length!==names.length||new Set(d.stations.map(s=>s.name)).size!==names.length||names.some(n=>!d.stations.find(s=>s.name===n))))throw Error('每日站點不一致');
 const stations=names.map(station=>({station,worstP95:null,p95Case:null,maxUnserved:0,unservedCase:null,maxWaiting:0,minServedFraction:null}));
 const daily=[];
 for(const day of days){let passed=true;
  for(const phase of arrivalPhases(a.arrivalInterval))for(const out of stations){
   const r=simulateSpace(day.stations.find(s=>s.name===out.station),{...a,arrivalPhase:phase});
   if(r.p95Wait!==null&&(out.worstP95===null||r.p95Wait>out.worstP95)){out.worstP95=r.p95Wait;out.p95Case={day:day.day,phase};}
   if(r.unserved>out.maxUnserved){out.maxUnserved=r.unserved;out.unservedCase={day:day.day,phase};}
   out.maxWaiting=Math.max(out.maxWaiting,r.peakWaiting);
   if(r.demand>EPS){out.minServedFraction=Math.min(out.minServedFraction??1,r.departed/r.demand);if(r.unserved>EPS||r.p95Wait===null||r.p95Wait>10+EPS)passed=false;}
  }
  daily.push({day:day.day,passed});
 }
 return {plan,stations,days:daily,passedDays:daily.filter(d=>d.passed).length,testedDays:days.length,
  passed:daily.every(d=>d.passed),calibrated:false};
}
export function serviceEnvelope(days,options={},shares=[.05,.1,.15,.2,.25,.3,.35,.4]){
 const rows=shares.map(share=>({share,...assessSpace(days,{...options,share})}));
 const passing=rows.filter(r=>r.passed);
 return {shares:rows.map(r=>({share:r.share,passedDays:r.passedDays,passed:r.passed})),
  highestTestedShare:passing.length?Math.max(...passing.map(r=>r.share)):null};
}
