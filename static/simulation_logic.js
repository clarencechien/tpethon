// Deterministic two-channel fluid point queues. All inputs are assumptions.
// PCU = passenger-car equivalent; no calibrated Neihu network or OD is implied.
export const defaults=Object.freeze({people:10000,occupancy:1.3,peakMinutes:150,
 innerShare:.7,innerCapacity:2000,outerCapacity:1400,freeMinutes:12,detourMinutes:8,
 busShare:.2,staggerShare:.2,shiftMinutes:60,restrictShare:.2,
 busSeats:70,busLoad:.8,busPCU:2.5,cycleMinutes:90,reserve:.1});
export const modelVersion='two-channel-point-queue-v1';

export function validate(a){
 const ranges={people:[0,100000],occupancy:[1,10],peakMinutes:[30,240],innerShare:[0,1],
  innerCapacity:[50,15000],outerCapacity:[50,15000],freeMinutes:[1,120],detourMinutes:[0,120],
  busShare:[0,1],staggerShare:[0,1],shiftMinutes:[0,120],restrictShare:[0,1],
  busSeats:[1,200],busLoad:[.01,1],busPCU:[1,5],cycleMinutes:[1,480],reserve:[0,1]};
 for(const [key,[lo,hi]] of Object.entries(ranges))if(!Number.isFinite(a[key])||a[key]<lo||a[key]>hi)throw Error(`參數超出範圍：${key}`);
 for(const key of ['people','peakMinutes','shiftMinutes','cycleMinutes','busSeats'])if(!Number.isInteger(a[key]))throw Error(`參數需為整數：${key}`);
 if(Math.floor(a.busSeats*a.busLoad)<1)throw Error('巴士有效容量至少需 1 人');
}

// Constant arrival/service rates within one minute; integrate queue exactly,
// including when an existing queue empties part way through the minute.
export function queueStep(queue,arrivals,capacity){
 if([queue,arrivals,capacity].some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid queue input');
 const net=arrivals-capacity,end=Math.max(0,queue+net);
 const area=net<0&&queue+net<0?queue*queue/(-2*net):queue+net/2;
 return {queue:end,served:queue+arrivals-end,area:Math.max(0,area)};
}

function windowMaximum(values,minutes){
 let sum=0,max=0;
 for(let i=0;i<values.length;i++){sum+=values[i];if(i>=minutes)sum-=values[i-minutes];max=Math.max(max,sum);}
 return max;
}

export function runScenario(input,policy={bus:0,stagger:0,restrict:0}){
 const a={...input};validate(a);
 for(const key of ['bus','stagger','restrict'])if(!Number.isFinite(policy[key])||policy[key]<0||policy[key]>1)throw Error('Invalid policy fraction');
 const start=60,lastArrival=start+a.peakMinutes+a.shiftMinutes;
 const inner=new Array(lastArrival+1).fill(0),outer=[...inner],buses=[...inner];
 const passengers=Math.round(a.people*policy.bus),carPeople=a.people-passengers;
 const cars=carPeople/a.occupancy,divertedCars=cars*a.innerShare*policy.restrict;
 const effectiveSeats=Math.floor(a.busSeats*a.busLoad);
 const weights=Array.from({length:a.peakMinutes},(_,i)=>.55+.9*Math.sin(Math.PI*(i+.5)/a.peakMinutes));
 const weightTotal=weights.reduce((x,y)=>x+y,0);
 let waitingPassengers=0,departures=0;
 for(let i=0;i<weights.length;i++){
  const t=start+i,w=weights[i]/weightTotal;
  // Demand-responsive departures: full vehicles, plus a final partial vehicle.
  waitingPassengers+=passengers*w;
  let dispatch=Math.floor((waitingPassengers+1e-9)/effectiveSeats);
  if(i===weights.length-1&&waitingPassengers-dispatch*effectiveSeats>1e-7)dispatch++;
  waitingPassengers=Math.max(0,waitingPassengers-dispatch*effectiveSeats);
  buses[t]=dispatch;departures+=dispatch;inner[t]+=dispatch*a.busPCU;
  // Stagger only remaining private-car trips; every trip stays in the horizon.
  for(const [when,share] of [[t,1-policy.stagger],[t+a.shiftMinutes,policy.stagger]]){
   const vehicles=cars*w*share;
   inner[when]+=vehicles*a.innerShare*(1-policy.restrict);
   outer[when]+=vehicles*(1-a.innerShare+a.innerShare*policy.restrict);
  }
 }
 const demandInner=inner.reduce((x,y)=>x+y,0),demandOuter=outer.reduce((x,y)=>x+y,0);
 let qi=0,qo=0,areaI=0,areaO=0,servedI=0,servedO=0,maxI=0,maxO=0;
 const series=[],minimumEnd=Math.max(360,lastArrival+1),maximumEnd=minimumEnd+720;
 for(let t=0;t<maximumEnd;t++){
  const ai=inner[t]||0,ao=outer[t]||0;
  const si=queueStep(qi,ai,a.innerCapacity/60),so=queueStep(qo,ao,a.outerCapacity/60);
  qi=si.queue;qo=so.queue;areaI+=si.area;areaO+=so.area;servedI+=si.served;servedO+=so.served;
  maxI=Math.max(maxI,qi);maxO=Math.max(maxO,qo);
  series.push({minute:t+1,innerQueue:qi,outerQueue:qo,innerArrivals:ai,outerArrivals:ao,
   innerServed:si.served,outerServed:so.served,busDepartures:buses[t]||0});
  if(t+1>=minimumEnd&&qi+qo<1e-7)break;
 }
 const totalPCU=demandInner+demandOuter,queuePCUHours=(areaI+areaO)/60;
 const lastBusy=series.findLast(row=>row.innerQueue+row.outerQueue>1e-7)?.minute;
 const operatingFleet=windowMaximum(buses,a.cycleMinutes),reserveFleet=Math.ceil(operatingFleet*a.reserve);
 return {modelVersion,calibrated:false,policy,people:a.people,carPeople,busPassengers:passengers,
  carTrips:cars,divertedCars,shiftedCarTrips:cars*policy.stagger,busDepartures:departures,
  effectiveSeats,operatingFleet,reserveFleet,totalFleet:operatingFleet+reserveFleet,
  busiestHourDepartures:windowMaximum(buses,60),busPassengersUnserved:waitingPassengers,
  totalPCU,demandInner,demandOuter,servedPCU:servedI+servedO,residualPCU:qi+qo,
  maxInnerQueue:maxI,maxOuterQueue:maxO,innerQueuePCUHours:areaI/60,outerQueuePCUHours:areaO/60,
  queuePCUHours,meanQueueMinutes:totalPCU?(areaI+areaO)/totalPCU:0,
  freeFlowPCUHours:(demandInner*a.freeMinutes+demandOuter*(a.freeMinutes+a.detourMinutes))/60,
  totalPCUHours:queuePCUHours+(demandInner*a.freeMinutes+demandOuter*(a.freeMinutes+a.detourMinutes))/60,
  addedDetourCarHours:divertedCars*a.detourMinutes/60,
  clearMinute:qi+qo>1e-7?null:(lastBusy?lastBusy+1:null),series};
}

export function experiment(a){
 validate(a);
 const choices=[['baseline','參考情境',{bus:0,stagger:0,restrict:0}],
  ['bus','改搭巴士',{bus:a.busShare,stagger:0,restrict:0}],
  ['stagger','延後出發',{bus:0,stagger:a.staggerShare,restrict:0}],
  ['restrict','主要通道限行／改道',{bus:0,stagger:0,restrict:a.restrictShare}],
  ['combined','巴士＋錯峰＋改道',{bus:a.busShare,stagger:a.staggerShare,restrict:a.restrictShare}],
  ['allbus','本批人次全改巴士',{bus:1,stagger:0,restrict:0}]];
 return choices.map(([id,label,policy])=>({id,label,...runScenario(a,policy)}));
}
