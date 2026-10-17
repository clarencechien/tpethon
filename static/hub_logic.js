/** E7: synthetic single-occupant car cohort, capacity-constrained hub assignment.
 * No calibrated OD, road routing, modal-choice coefficients, or empirical policy forecast.
 */
export const hubDefaults={people:6000,layer:2,parkingShare:.2,parkingSubsidy:150,poolSubsidy:100,appShare:.6,hov:0,headway:6,busCapacity:80,feederQuota:600,budget:300000,capacityScale:1,parkingPrice:400,valueOfTime:5,smartRouting:true,enabledHubs:null};
const distance=(a,b)=>{const rad=Math.PI/180,dl=(b[0]-a[0])*rad,dp=(b[1]-a[1])*rad;const q=Math.sin(dp/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dl/2)**2;return 6371*2*Math.asin(Math.sqrt(q))*1.4;};
function random(seed){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
export function cohort(data,n,seed=7){
 const r=random(seed),out=[];let weights=data.origins.map(o=>o.weight),sum=weights.reduce((a,b)=>a+b,0);
 if(sum<=0||weights.some(w=>w<0||!Number.isFinite(w)))throw Error('Invalid origin weights');
 for(let i=0;i<n;i++){let x=r()*sum,k=0;while(k<weights.length-1&&x>=weights[k])x-=weights[k++];
  out.push({id:i,origin:k,start:Math.floor((r()+r())*90),app:r(),pool:r(),choice:r(),feeder:r(),exempt:r()<.05});}
 return out;
}
export function simulateHubs(data,options={},seed=7){
 const a={...hubDefaults,...options};
 for(const k of ['people','layer','parkingShare','parkingSubsidy','poolSubsidy','appShare','hov','headway','busCapacity','feederQuota','budget','capacityScale','parkingPrice','valueOfTime'])if(!Number.isFinite(a[k]))throw Error('Non-finite '+k);
 if(!Number.isInteger(a.people)||a.people<0||a.people>30000||![0,1,2,3].includes(a.layer)||![0,2,3].includes(a.hov)||a.parkingShare<0||a.parkingShare>1||a.appShare<0||a.appShare>1||a.headway<1||a.headway>30||a.busCapacity<1||!Number.isInteger(a.busCapacity)||a.capacityScale<=0||a.valueOfTime<=0||['parkingSubsidy','poolSubsidy','feederQuota','budget','parkingPrice'].some(k=>a[k]<0))throw Error('Invalid hub assumptions');
 if(a.enabledHubs!==null&&(!Array.isArray(a.enabledHubs)||a.enabledHubs.some(id=>!data.hubs.some(h=>h.id===id))))throw Error('Unknown hub');
 const people=cohort(data,a.people,seed),hubs=data.hubs.filter(h=>a.layer>0&&h.tier<=Math.min(a.layer,2)&&(a.enabledHubs===null||a.enabledHubs.includes(h.id))).map(h=>({...h,spaces:Math.floor(h.total_car_spaces*a.parkingShare),parked:0,passengers:[],served:0,unserved:0,waits:[],fleet:0,lineMinutes:distance(h.coordinates,data.destination)/25*60+8}));
 const hubDistance=Object.fromEntries(hubs.map(h=>[h.id,data.origins.map(o=>distance(o.coordinates,h.coordinates))]));
 const directDistance=data.origins.map(o=>distance(o.coordinates,data.destination));
 let budget=0,parkingCost=0,poolCost=0,feederUsed=0,carKm=0,unmatched=0,deniedParking=0;
 const assigned=new Set(),vehicles=[],trips=[],groups=new Map();
 // All matches share origin zone, destination and 15-minute departure bin.
 if(a.layer>0&&a.poolSubsidy>0)for(const p of people)if(p.app<a.appShare&&p.pool<Math.min(a.poolSubsidy,120)/300){
  const key=p.origin+':'+Math.floor(p.start/15);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
 }
 const groupSize=a.hov||3;
 for(const group of groups.values()){
  group.sort((x,y)=>x.start-y.start);let i=0;
  for(;i+groupSize<=group.length;i+=groupSize){const ps=group.slice(i,i+groupSize),reward=Math.min(a.poolSubsidy,120);if(budget+reward>a.budget)break;
   const start=Math.max(...ps.map(p=>p.start)),origin=ps[0].origin,drive=directDistance[origin]/25*60+10+8;
   vehicles.push({gate:data.origins[origin].gate,arrival:start+drive,persons:ps,mode:'pool'});ps.forEach(p=>assigned.add(p.id));carKm+=directDistance[origin]*1.15;budget+=reward;poolCost+=reward;
  }
  unmatched+=group.length-i;
 }
 let deferred=0;const histogram=Array(36).fill(0);
 for(const p of [...people].sort((x,y)=>x.start-y.start||x.id-y.id)){
  if(assigned.has(p.id))continue;
  const d=directDistance[p.origin],drive=d/25*60+10;
  let chosen=null,accessMode='park',cost=Infinity;
  if(p.app<a.appShare&&hubs.length){
   const feeder=a.layer===3&&p.origin>=2&&p.origin<=6&&p.feeder<.5&&feederUsed<Math.floor(a.feederQuota);
   let candidates=hubs.map(h=>{const km=hubDistance[h.id][p.origin],access=km/(feeder?35:25)*60+(feeder?12:5),sub=Math.min(a.parkingSubsidy,a.parkingPrice),reward=feeder?0:sub;
    return {h,access,km,feeder,reward,cost:access+h.lineMinutes+4+a.headway/2+((feeder?60:a.parkingPrice-sub)+40)/a.valueOfTime};}).sort((x,y)=>x.cost-y.cost);
   if(!a.smartRouting)candidates=candidates.slice(0,1);
   for(const c of candidates){if(!c.feeder&&c.h.parked>=c.h.spaces){deniedParking++;continue;}if(budget+c.reward>a.budget)continue;
    chosen=c;cost=c.cost;break;}
   if(chosen&&p.choice<1/(1+Math.exp(Math.max(-50,Math.min(50,(cost-(drive+15+200/a.valueOfTime))/10))))){
    accessMode=chosen.feeder?'feeder':'park';chosen.h.passengers.push({...p,arrival:p.start+chosen.access+4,accessMode});
    if(chosen.feeder)feederUsed++;else {chosen.h.parked++;carKm+=chosen.km;budget+=chosen.reward;parkingCost+=chosen.reward;}continue;
   }
  }
  let arrival=p.start+drive;
  if(a.hov>0&&!p.exempt&&arrival<180){arrival=180+(p.id%16);deferred++;}
  vehicles.push({gate:data.origins[p.origin].gate,arrival,persons:[p],mode:'car'});carKm+=d;
 }
 const gateResults=[];
 // Point queues include delayed entrants after 10:00; no finite road storage or spillback.
 for(const g of data.nodes.filter(n=>n.role==='gateway')){
  const vs=vehicles.filter(v=>v.gate===g.id).sort((x,y)=>x.arrival-y.arrival||x.persons[0].id-y.persons[0].id);let available=0,delay=0,peak=0;
  for(const v of vs){const finish=Math.max(v.arrival,available);available=finish+60/(g.capacity_vph_assumption*a.capacityScale);const wait=finish-v.arrival;delay+=Math.min(wait,Math.max(0,540-v.arrival));if(finish<180)peak++;
   if(finish<540)histogram[Math.floor(finish/15)]++;
   for(const p of v.persons)trips.push({id:p.id,mode:v.mode,finished:finish<=540,minutes:Math.min(finish,540)-p.start,queue:wait});
  }
  gateResults.push({id:g.id,name:g.name,vehicles:vs.length,peakVehicles:peak,queueVehicleMinutes:delay,lastEntry:vs.length?available:0});
 }
 for(const h of hubs){
  h.passengers.sort((x,y)=>x.arrival-y.arrival||x.id-y.id);const cycle=2*h.lineMinutes+12;h.fleet=Math.ceil(cycle/a.headway);let i=0;
  for(let t=0;t<=540;t+=a.headway){let seats=a.busCapacity;while(i<h.passengers.length&&h.passengers[i].arrival<=t&&seats-->0){const p=h.passengers[i++],wait=t-p.arrival,finish=t+h.lineMinutes;h.waits.push(wait);h.served+=finish<=540?1:0;h.unserved+=finish>540?1:0;trips.push({id:p.id,mode:p.accessMode,finished:finish<=540,minutes:Math.min(finish,540)-p.start,queue:wait});}}
  for(;i<h.passengers.length;i++){const p=h.passengers[i];h.unserved++;trips.push({id:p.id,mode:p.accessMode,finished:false,minutes:540-p.start,queue:540-p.arrival});}
 }
 const count=m=>trips.filter(t=>t.mode===m).length,finished=trips.filter(t=>t.finished),percentile=vs=>vs.length?[...vs].sort((x,y)=>x-y)[Math.ceil(vs.length*.95)-1]:0;
 if(trips.length!==a.people||new Set(trips.map(t=>t.id)).size!==a.people)throw Error('Lost or duplicate traveler');
 return {options:a,seed,calibrated:false,people:a.people,completed:finished.length,unserved:a.people-finished.length,
  modes:{car:count('car'),pool:count('pool'),park:count('park'),feeder:count('feeder')},carVehicles:vehicles.length,peakCarVehicles:gateResults.reduce((s,g)=>s+g.peakVehicles,0),deferred,unmatchedPoolCandidates:unmatched,
  budgetUsed:budget,parkingCost,poolCost,deniedParkingAttempts:deniedParking,proxyCarKm:carKm,
  meanMinutes:finished.length?finished.reduce((s,p)=>s+p.minutes,0)/finished.length:0,p95Minutes:percentile(finished.map(p=>p.minutes)),
  queueVehicleHours:gateResults.reduce((s,g)=>s+g.queueVehicleMinutes,0)/60,
  fleet:hubs.reduce((s,h)=>s+h.fleet,0),spares:hubs.reduce((s,h)=>s+Math.ceil(h.fleet*.1),0),
  busWaitP95:percentile(hubs.flatMap(h=>h.waits)),histogram,gateResults,
  hubs:hubs.map(h=>({id:h.id,name:h.name,total:h.total_car_spaces,spaces:h.spaces,parked:h.parked,passengers:h.passengers.length,served:h.served,unserved:h.unserved,fleet:h.fleet,spares:Math.ceil(h.fleet*.1),lineMinutes:h.lineMinutes,waitP95:percentile(h.waits)}))};
}
