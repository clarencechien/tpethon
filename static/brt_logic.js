import {queueStep} from './simulation_logic.js';
import {compound} from './growth_logic.js';

export const brtVersion='construction-brt-v1';
export const brtDefaults=Object.freeze({people:10000,existingBusPeople:2000,innerShare:.7,occupancy:1.3,
 lanes:3,workLanes:1,laneCapacity:1000,workFactor:1,outerCapacity:1400,conversion:.5,diversion:0,
 seats:120,load:.85,headway:2,existingHeadway:6,fleet:40,reserve:.1,busPCU:2.5,
 distance:8,cruiseSpeed:30,stops:8,dwellSeconds:25,clearanceSeconds:15,signals:6,signalSeconds:20,
 recoveryMinutes:10,restMinutes:10,mixedCycle:90,mixedDwellSeconds:45,
 growth:.02,years:5,year:0,peakMinutes:150});

export function validateBRT(a){
 const bounds={people:[0,100000],existingBusPeople:[0,50000],innerShare:[0,1],occupancy:[1,10],
  lanes:[1,6],workLanes:[0,5],laneCapacity:[200,2500],workFactor:[.3,1],outerCapacity:[50,15000],conversion:[0,1],diversion:[0,.8],
  seats:[10,250],load:[.1,1],headway:[.5,15],existingHeadway:[1,30],fleet:[0,200],reserve:[0,1],busPCU:[1,5],
  distance:[1,30],cruiseSpeed:[10,60],stops:[0,40],dwellSeconds:[5,180],clearanceSeconds:[5,120],signals:[0,50],signalSeconds:[0,120],
  recoveryMinutes:[0,120],restMinutes:[0,120],mixedCycle:[10,480],mixedDwellSeconds:[5,180],growth:[-.1,.1],years:[1,15],year:[0,14],peakMinutes:[30,240]};
 for(const [key,[lo,hi]] of Object.entries(bounds))if(!Number.isFinite(a[key])||a[key]<lo||a[key]>hi)throw Error(`參數超出支援範圍：${key}`);
 for(const key of ['people','existingBusPeople','lanes','workLanes','seats','fleet','stops','signals','years','year','peakMinutes'])if(!Number.isInteger(a[key]))throw Error(`請填整數：${key}`);
 if(a.workLanes>=a.lanes)throw Error('施工占道須保留至少一條一般通道');
 if(a.year>=a.years)throw Error('所選年份須在捷運通車前');
 if(a.demandWeights!==undefined&&(!Array.isArray(a.demandWeights)||a.demandWeights.length!==a.peakMinutes||a.demandWeights.some(v=>!Number.isFinite(v)||v<0)||a.demandWeights.reduce((s,v)=>s+v,0)<=0))throw Error('實測型態不完整');
}

function percentile(events,share){
 const total=events.reduce((s,v)=>s+v.people,0);if(!total)return null;
 let seen=0;for(const event of [...events].sort((a,b)=>a.wait-b.wait)){seen+=event.people;if(seen>=total*share-1e-8)return event.wait;}
 return null;
}

export function servicePlan(a,mode){
 const dedicated=mode==='brt',enhanced=dedicated||mode==='mixed';
 const dwell=dedicated?a.dwellSeconds:a.mixedDwellSeconds;
 const requested=enhanced?a.headway:a.existingHeadway;
 // One effective berth, no overtaking. Round up to the half-minute simulation grid.
 const stationMinimum=(dwell+a.clearanceSeconds)/60;
 const effectiveHeadway=Math.ceil(Math.max(requested,stationMinimum)*2)/2;
 const oneWay=a.distance/a.cruiseSpeed*60+a.stops*a.dwellSeconds/60+a.signals*a.signalSeconds/60;
 const cycle=dedicated?2*oneWay+a.recoveryMinutes+a.restMinutes:a.mixedCycle;
 const seats=Math.floor(a.seats*a.load),requiredFleet=Math.ceil(cycle/effectiveHeadway);
 const spare=Math.ceil(requiredFleet*a.reserve);
 return {requestedHeadway:requested,effectiveHeadway,stationMinimum,oneWayBRTMinutes:dedicated?oneWay:null,cycleMinutes:cycle,
  seats,requiredFleet,reserveFleet:spare,procurementFleet:requiredFleet+spare,
  scheduledSeatsPerHour:seats*60/effectiveHeadway,fleetSeatsPerHour:cycle?seats*a.fleet*60/cycle:0,
  effectiveSeatsPerHour:Math.min(seats*60/effectiveHeadway,seats*a.fleet*60/cycle),
  stationSaturation:dwell/(effectiveHeadway*60)};
}

export function simulateBRT(a,mode='brt'){
 validateBRT(a);
 if(!['before','construction','mixed','brt'].includes(mode))throw Error('Unknown BRT scenario');
 const construction=mode!=='before',dedicated=mode==='brt',enhanced=dedicated||mode==='mixed';
 const generalLanes=a.lanes-(construction?a.workLanes:0)-(dedicated?1:0);
 if(generalLanes<1)return {mode,feasible:false,reason:'施工後無法同時保留一般車道與一條獨立BRT車道；需另設線位或明確改道方案。'};
 const people=Math.round(compound(a.people,a.growth,a.year)),existing=Math.round(compound(a.existingBusPeople,a.growth,a.year));
 const innerPeople=Math.round(people*a.innerShare),outerPeople=people-innerPeople;
 const shifted=enhanced?Math.round(innerPeople*a.conversion):0,passengers=existing+shifted;
 const innerCars=(innerPeople-shifted)/a.occupancy,diverted=enhanced?innerCars*a.diversion:0;
 const carInner=innerCars-diverted,carOuter=outerPeople/a.occupancy+diverted;
 const capacity=generalLanes*a.laneCapacity*(construction?a.workFactor:1),service=servicePlan(a,mode);
 const weights=a.demandWeights||Array.from({length:a.peakMinutes},(_,i)=>.55+.9*Math.sin(Math.PI*(i+.5)/a.peakMinutes));
 const sum=weights.reduce((s,v)=>s+v,0),dt=.5,start=60,end=start+a.peakMinutes,limit=end+480;
 const vehicles=Array(a.fleet).fill(0),cohorts=[],waitEvents=[],series=[];
 let cursor=0,waiting=0,boarded=0,boardedWait=0,totalWait=0,departures=0,peakWaiting=0,peakActive=0,next=start;
 let qi=0,qo=0,areaI=0,areaO=0,maxI=0,maxO=0,arrivals=0,served=0,roadBusPCU=0;
 for(let t=0;t<limit;t+=dt){
  const index=Math.floor(t-start),share=index>=0&&index<a.peakMinutes?weights[index]/sum*dt:0;
  const newPeople=passengers*share;
  if(newPeople>0){cohorts.push({time:t,remaining:newPeople});waiting+=newPeople;}
  peakWaiting=Math.max(peakWaiting,waiting);
  let buses=0,boardedNow=0;
  if(passengers>0&&t>=start&&t>=next-1e-8&&(t<end||waiting>1e-7)){
   const available=vehicles.findIndex(returnTime=>returnTime<=t+1e-8);
   if(available>=0){
    let space=service.seats;
    while(space>1e-7&&cursor<cohorts.length){
     const cohort=cohorts[cursor],take=Math.min(space,cohort.remaining),wait=t-cohort.time;
     space-=take;cohort.remaining-=take;boardedNow+=take;boardedWait+=take*wait;
     waitEvents.push({wait,people:take});if(cohort.remaining<1e-7)cursor++;
    }
    waiting=Math.max(0,waiting-boardedNow);boarded+=boardedNow;departures++;buses=1;
    vehicles[available]=t+service.cycleMinutes;next=t+service.effectiveHeadway;
    peakActive=Math.max(peakActive,vehicles.filter(v=>v>t).length);
   }
  }
  totalWait+=waiting*dt;
  const busRoad=dedicated?0:buses*a.busPCU;roadBusPCU+=busRoad;
  const ai=carInner*share+busRoad,ao=carOuter*share;
  const si=queueStep(qi,ai,capacity*dt/60),so=queueStep(qo,ao,a.outerCapacity*dt/60);
  qi=si.queue;qo=so.queue;areaI+=si.area*dt;areaO+=so.area*dt;maxI=Math.max(maxI,qi);maxO=Math.max(maxO,qo);
  arrivals+=ai+ao;served+=si.served+so.served;
  series.push({minute:t+dt,innerQueue:qi,outerQueue:qo,passengerQueue:waiting,boarded,departures,innerArrivals:ai,outerArrivals:ao});
  if(t+dt>=Math.max(360,end)&&qi+qo+waiting<1e-7)break;
 }
 return {modelVersion:brtVersion,mode,feasible:true,calibrated:false,generalLanes,brtLanes:dedicated?1:0,workLanes:construction?a.workLanes:0,
  year:a.year,privatePeople:people,existingBusPeople:existing,totalPeople:people+existing,shiftedPeople:shifted,passengers,
  carTrips:carInner+carOuter,carInner,carOuter,divertedCarTrips:diverted,capacity,outerCapacity:a.outerCapacity,
  ...service,departures,boardedPassengers:boarded,unservedPassengers:waiting,peakWaiting,
  meanBoardedWaitMinutes:boarded?boardedWait/boarded:null,p95BoardedWaitMinutes:percentile(waitEvents,.95),
  totalPassengerWaitHours:totalWait/60,peakActiveFleet:peakActive,
  roadBusPCU,totalRoadPCU:arrivals,servedRoadPCU:served,residualRoadPCU:qi+qo,
  maxInnerQueue:maxI,maxOuterQueue:maxO,queuePCUHours:(areaI+areaO)/60,
  meanInnerQueueMinutes:carInner+roadBusPCU?areaI/(carInner+roadBusPCU):0,
  meanOuterQueueMinutes:carOuter?areaO/carOuter:0,series};
}

export function brtScenarios(a){return ['before','construction','mixed','brt'].map(mode=>simulateBRT(a,mode));}

export function conversionScan(a){
 const baseline=simulateBRT(a,'construction');
 const rows=Array.from({length:11},(_,i)=>{
  const fraction=i/10,{series,...brt}=simulateBRT({...a,conversion:fraction},'brt');
  const fullyServed=brt.feasible&&brt.residualRoadPCU<1e-7&&brt.unservedPassengers<1e-7;
  return {fraction,...brt,improves:fullyServed&&baseline.residualRoadPCU<1e-7&&baseline.unservedPassengers<1e-7&&brt.queuePCUHours<baseline.queuePCUHours};
 });
 return {baselineQueue:baseline.queuePCUHours,firstTestedImprovement:rows.find(r=>r.improves)?.fraction??null,rows};
}

export function transitionYears(a){
 validateBRT(a);
 return Array.from({length:a.years},(_,year)=>({year,results:['construction','mixed','brt'].map(mode=>{
  const {series,...result}=simulateBRT({...a,year},mode);return result;
 })}));
}
