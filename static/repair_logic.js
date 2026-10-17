/** E9: reservation-based repairs to E8, evaluated with out-of-plan service delays. */
import {alternativeCohort, proxyKm} from './alternatives_logic.js';
export const repairDefaults={carPeople:1200,transitPeople:800,participation:.5,fleet:16,capacity:60,headway:10,parkingShare:.2,railQuota:600,busSpeed:25,roadScale:1,subsidy:150,budget:200000,deadline:150,maxExtra:0,parkingRatio:.7,buffer:5,actualSpeedFactor:1,accessDelay:0,eligibilityLeak:0};
const END=300,sum=a=>a.reduce((s,x)=>s+x,0),better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-8)return a[i]>b[i];return false;};
export function departures(km,fleet,a,factor=1,offset=0){
 const ride=km/(a.busSpeed*factor)*60+8,cycle=2*ride+12,ready=Array.from({length:fleet},(_,i)=>offset+i*a.headway),out=[];
 for(let planned=offset;ready.length&&planned<=END;){const at=Math.min(...ready),i=ready.indexOf(at),time=Math.max(at,planned);if(time>END)break;out.push(time);ready[i]=time+cycle;planned=time+a.headway;}
 return {times:out,ride,cycle};
}
function directRecords(people,data,a,km){
 const records=people.filter(p=>p.original==='transit').map(p=>({...p,mode:'originalTransit',finish:p.start+km[p.origin]/35*60+24}));
 for(const g of data.nodes.filter(n=>n.role==='gateway')){let ready=0;const queue=people.filter(p=>p.original==='car'&&data.origins[p.origin].gate===g.id).map(p=>({...p,arrival:p.start+km[p.origin]/25*60+10})).sort((a,b)=>a.arrival-b.arrival||a.id-b.id);
  for(const p of queue){const finish=Math.max(ready,p.arrival);ready=finish+60/(g.capacity_vph_assumption*a.roadScale);records.push({...p,mode:'directCar',finish});}}
 return records;
}
function forecastCost(line,fleet,a){
 const schedule=departures(line.km,fleet,a,1,line.offset||0),slots=schedule.times.map(time=>({time,used:0}));let refused=0,minutes=0;
 for(const p of [...line.demand].sort((x,y)=>x.arrival-y.arrival||x.id-y.id)){
  const slot=slots.find(s=>s.time>=p.arrival&&s.used<a.capacity&&s.time+schedule.ride+5<=p.limit);
  if(slot){slot.used++;minutes+=slot.time+schedule.ride+5-p.start;}else{refused++;minutes+=p.baselineFinish-p.start;}
 }
 return [refused,minutes];
}
export function allocateFleet(lines,a,optimized){
 const active=lines.filter(l=>l.demand.length),counts=Object.fromEntries(lines.map(l=>[l.id,0]));
 if(!optimized){for(let i=0;i<a.fleet&&active.length;i++)counts[active[i%active.length].id]++;return counts;}
 const cache=new Map(),cost=(l,n)=>{const k=l.id+':'+n;if(!cache.has(k))cache.set(k,forecastCost(l,n,a));return cache.get(k);};
 let left=a.fleet;
 while(left>0){let chosen=null,add=0,gain=[0,0];
  for(const l of active)for(let k=1;k<=left;k++){const old=cost(l,counts[l.id]),next=cost(l,counts[l.id]+k),benefit=old.map((v,i)=>(v-next[i])/k);if(better(benefit,gain)){chosen=l;add=k;gain=benefit;}}
  if(!chosen)break;counts[chosen.id]+=add;left-=add;
 }
 return counts;
}
export function runRepairs(data,options={},seed=7){
 const a={...repairDefaults,...options};for(const [k,v]of Object.entries(a))if(!Number.isFinite(v))throw Error('Invalid '+k);
 for(const k of ['carPeople','transitPeople','fleet','capacity','railQuota'])if(!Number.isInteger(a[k])||a[k]<0)throw Error('Invalid '+k);
 if(a.carPeople+a.transitPeople>20000||a.fleet>100||a.capacity<1||a.capacity>100||a.headway<1||a.headway>60||a.busSpeed<5||a.busSpeed>60||a.roadScale<=0||a.roadScale>2||a.actualSpeedFactor<.3||a.actualSpeedFactor>1.5||a.deadline<0||a.deadline>END||a.accessDelay<0||a.accessDelay>60||a.maxExtra<0||a.maxExtra>60||a.buffer<0||a.buffer>30||a.subsidy<0||a.subsidy>400||a.budget<0||['participation','parkingShare','parkingRatio','eligibilityLeak'].some(k=>a[k]<0||a[k]>1))throw Error('Assumption out of bounds');
 const people=alternativeCohort(data,a,seed),km=data.origins.map(o=>proxyKm(o.coordinates,data.destination)),baseline=directRecords(people,data,a,km),original=new Map(baseline.map(p=>[p.id,p]));
 const specs=[['baseline','原方式',false,false],['eligibility','只限原開車者＋平均配車',false,false],['guarded','三種服務＋預約檢查',true,false],['allocated','再依需求與車程配車',true,true],['reserved','再依預約取消空班',true,true],['buffered','再加轉乘與到達緩衝',true,true]];
 const results=specs.map(([id,label,guard,optimized])=>{
  const margin=id==='buffered'?a.buffer:0;
  const lines=[...data.hubs.map(h=>({id:h.id,name:h.name,km:proxyKm(h.coordinates,data.destination),hub:h,kind:'hub',demand:[],passengers:[]})),...data.origins.map((o,i)=>({id:'express_'+o.id,name:o.name+'直達',km:km[i],origin:i,kind:'express',demand:[],passengers:[]}))];
  const byId=new Map(lines.map(l=>[l.id,l])),willing=people.filter(p=>p.original==='car'?p.choice<a.participation:p.choice<a.eligibilityLeak),offers=new Map();
  const choices=p=>{
   let out=[];for(const l of lines){
    if(l.kind==='express'){if(guard&&p.original==='car'&&l.origin===p.origin)out.push({line:l,mode:'express',access:8,carKm:0});continue;}
    const accessKm=proxyKm(data.origins[p.origin].coordinates,l.hub.coordinates);
    if(!guard||accessKm<=km[p.origin]*a.parkingRatio)out.push({line:l,mode:'park',access:accessKm/25*60+10,carKm:accessKm});
    if(guard&&p.original==='car')out.push({line:l,mode:'rail',access:accessKm/35*60+17,carKm:0});
   }
   out=out.map(c=>({...c,estimatedFinish:p.start+c.access+margin+c.line.km/a.busSpeed*60+8+5+margin}));
   if(guard)out=out.filter(c=>c.estimatedFinish<=original.get(p.id).finish+a.maxExtra&&c.estimatedFinish<=a.deadline);
   return out.sort((x,y)=>x.estimatedFinish-y.estimatedFinish||x.line.id.localeCompare(y.line.id)||x.mode.localeCompare(y.mode));
  };
  if(id!=='baseline')for(const p of willing){const cs=choices(p);offers.set(p.id,cs);if(cs.length)cs[0].line.demand.push({...p,arrival:p.start+cs[0].access+margin,baselineFinish:original.get(p.id).finish,limit:Math.min(original.get(p.id).finish+a.maxExtra,a.deadline)-margin});}
  if(optimized)for(const l of lines)l.offset=l.demand.length?Math.ceil(Math.min(...l.demand.map(p=>p.arrival))/a.headway)*a.headway:0;
  const fleet=allocateFleet(lines,a,optimized),slots=new Map(lines.map(l=>[l.id,departures(l.km,fleet[l.id],a,1,l.offset||0).times.map(t=>({time:t,used:0}))]));
  const parking=Object.fromEntries(data.hubs.map(h=>[h.id,0])),assigned=new Set();let budget=0,railUsed=0,induced=0,accessCarKm=0,parked=0,noOffer=0;
  if(id!=='baseline')for(const p of [...willing].sort((x,y)=>x.start-y.start||x.id-y.id)){
   const candidates=[];for(const c of offers.get(p.id)||[]){
    if(c.mode==='park'&&(parking[c.line.id]>=Math.floor(c.line.hub.total_car_spaces*a.parkingShare)||budget+a.subsidy>a.budget))continue;
    if(c.mode==='rail'&&railUsed>=a.railQuota)continue;
    let trip=0,predictedFinish=null;
    if(guard){trip=slots.get(c.line.id).findIndex(s=>s.used<a.capacity&&s.time>=p.start+c.access+margin);if(trip<0)continue;predictedFinish=slots.get(c.line.id)[trip].time+c.line.km/a.busSpeed*60+13;
     if(predictedFinish+margin>original.get(p.id).finish+a.maxExtra||predictedFinish+margin>a.deadline)continue;}
    candidates.push({...c,trip,predictedFinish});
   }
   candidates.sort((x,y)=>(guard?x.predictedFinish-y.predictedFinish:x.estimatedFinish-y.estimatedFinish)||x.line.id.localeCompare(y.line.id));const c=candidates[0];if(!c){noOffer++;continue;}
   if(guard)slots.get(c.line.id)[c.trip].used++;
   if(c.mode==='park'){parking[c.line.id]++;parked++;accessCarKm+=c.carKm;budget+=a.subsidy;if(p.original==='transit')induced++;}
   if(c.mode==='rail')railUsed++;
   c.line.passengers.push({...p,mode:c.mode,arrival:p.start+c.access+a.accessDelay,trip:c.trip,plannedFinish:c.predictedFinish,baselineFinish:original.get(p.id).finish});assigned.add(p.id);
  }
  if(!guard&&id!=='baseline')Object.assign(fleet,allocateFleet(lines.map(l=>({...l,demand:l.passengers})),a,false));
  const records=directRecords(people.filter(p=>!assigned.has(p.id)),data,a,km);let missedReservations=0,busKm=0,busHours=0;
  for(const l of lines){
   const skipEmpty=id==='reserved'||id==='buffered',schedule=departures(l.km,fleet[l.id],a,a.actualSpeedFactor,l.offset||0),pending=[...l.passengers];l.served=0;l.unserved=0;l.departures=0;l.fleet=fleet[l.id];l.operatedBusCount=0;
   const planned=slots.get(l.id).map(s=>s.time),times=skipEmpty?planned:schedule.times,ready=Array.from({length:l.fleet},()=>l.offset||0),usedBuses=new Set();let previous=-a.headway;
   for(let j=0;j<times.length;j++){
    if(!ready.length)break;
    const bus=ready.indexOf(Math.min(...ready)),time=skipEmpty?Math.max(times[j],ready[bus],previous+a.headway):times[j];if(time>END)break;
    if(guard)missedReservations+=pending.filter(p=>p.trip===j&&p.arrival>time).length;
    const available=pending.filter(p=>p.trip<=j&&p.arrival<=time).sort((x,y)=>(guard?Number(y.trip===j)-Number(x.trip===j):0)||x.arrival-y.arrival||x.id-y.id).slice(0,a.capacity);
    if(skipEmpty&&!available.length)continue;
    ready[bus]=time+schedule.cycle;usedBuses.add(bus);previous=time;l.departures++;busKm+=2*l.km;busHours+=schedule.cycle/60;
    for(const p of available){pending.splice(pending.indexOf(p),1);const finish=time+schedule.ride+5;records.push({...p,finish});if(finish<=END)l.served++;else l.unserved++;}
   }
   l.operatedBusCount=usedBuses.size;
   for(const p of pending){records.push({...p,finish:Infinity});l.unserved++;}
  }
  if(records.length!==people.length||new Set(records.map(p=>p.id)).size!==people.length)throw Error('Traveler conservation failed');
  const done=records.filter(p=>p.finish<=END),late=records.filter(p=>p.finish>a.deadline).length,baselineLate=baseline.filter(p=>p.finish>a.deadline).length;
  const directCars=records.filter(p=>p.mode==='directCar'),carKm=sum(directCars.map(p=>km[p.origin]))+accessCarKm,baseKm=sum(baseline.filter(p=>p.original==='car').map(p=>km[p.origin]));
  const newlyLate=records.filter(p=>original.get(p.id).finish<=a.deadline&&p.finish>a.deadline).length,recovered=records.filter(p=>original.get(p.id).finish>a.deadline&&p.finish<=a.deadline).length,convertedCars=records.filter(p=>p.original==='car'&&assigned.has(p.id)).length;
  const result={id,label,people:people.length,completed:done.length,unserved:people.length-done.length,late,baselineLate,newlyLate,recovered,meanMinutes:done.length?sum(done.map(p=>p.finish-p.start))/done.length:null,observedPersonMinutes:sum(records.map(p=>Math.min(END,p.finish)-p.start)),
   directCars:directCars.length,carTrips:directCars.length+parked,proxyCarKm:carKm,carKmChange:carKm-baseKm,inducedCarTrips:induced,convertedCars,accepted:assigned.size,willing:id==='baseline'?0:willing.length,noOffer,railUsed,parked,subsidyCost:budget,missedReservations,
   fleetUsed:sum(Object.values(fleet)),actualFleetUsed:sum(lines.map(l=>l.operatedBusCount)),unusedFleet:a.fleet-sum(Object.values(fleet)),spares:Math.ceil(sum(Object.values(fleet))*.1),proxyBusKm:busKm,busCycleHours:busHours,
   modes:Object.fromEntries(['directCar','originalTransit','rail','express','park'].map(mode=>[mode,records.filter(p=>p.mode===mode).length])),
   lines:lines.filter(l=>l.fleet||l.passengers.length).map(l=>({id:l.id,name:l.name,fleet:l.fleet,actualFleetUsed:l.operatedBusCount,firstPlannedDeparture:l.offset||0,forecastDemand:l.demand.length,booked:l.passengers.length,departures:l.departures,served:l.served,unserved:l.unserved,parked:parking[l.id]||0})),
   bookings:guard?lines.flatMap(l=>l.passengers.map(p=>({id:p.id,line:l.id,mode:p.mode,trip:p.trip,plannedDeparture:slots.get(l.id)[p.trip].time,plannedFinish:p.plannedFinish,baselineFinish:p.baselineFinish}))):[]};
  result.modeledRoadKmChange=carKm-baseKm+busKm;
  result.meetsIllustrativeThreshold=id!=='baseline'&&baseKm>0&&carKm<=baseKm*.95&&newlyLate===0&&result.unserved===0&&induced===0&&convertedCars>=50&&result.modeledRoadKmChange<=0;
  return result;
 });
 return {schema_version:1,options:a,seed,calibrated:false,results};
}
