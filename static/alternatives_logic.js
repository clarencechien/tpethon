/** E8: matched synthetic cohorts, finite fleet, advance parking reservations.
 * Distances/times and willingness are assumptions, not calibrated OD or routes.
 */
export const alternativeDefaults={carPeople:1200,transitPeople:800,participation:.5,leakage:.3,parkingShare:.2,fleet:16,capacity:60,headway:10,railQuota:600,busSpeed:25,roadScale:1,subsidy:150,budget:200000};
const end=300,rest=12;
const sum=xs=>xs.reduce((s,x)=>s+x,0);
export function proxyKm(a,b){const r=Math.PI/180,q=Math.sin((b[1]-a[1])*r/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;return 6371*2*Math.asin(Math.sqrt(q))*1.4;}
export function alternativeCohort(data,a,seed=7){
 let state=seed>>>0;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 return Array.from({length:a.carPeople+a.transitPeople},(_,id)=>({id,original:id<a.carPeople?'car':'transit',origin:Math.floor(rand()*data.origins.length),start:Math.floor((rand()+rand())*90),choice:rand()}));
}
export function compareAlternatives(data,options={},seed=7){
 const a={...alternativeDefaults,...options};
 for(const [key,value]of Object.entries(a))if(!Number.isFinite(value))throw Error('Invalid '+key);
 for(const k of ['carPeople','transitPeople','fleet','capacity','railQuota'])if(!Number.isInteger(a[k])||a[k]<0)throw Error('Invalid '+k);
 if(a.carPeople+a.transitPeople>20000||a.fleet>100||a.capacity<1||a.capacity>100||a.subsidy>400||a.headway<1||a.headway>60||a.busSpeed<5||a.busSpeed>60||a.roadScale<=0||a.roadScale>2||a.subsidy<0||a.budget<0||['participation','leakage','parkingShare'].some(k=>a[k]<0||a[k]>1))throw Error('Assumption out of bounds');
 const people=alternativeCohort(data,a,seed),direct=data.origins.map(o=>proxyKm(o.coordinates,data.destination));
 const access=data.origins.map(o=>data.hubs.map(h=>proxyKm(o.coordinates,h.coordinates)));
 const definitions=[['baseline','維持原運具'],['rail','捷運＋最後一段接駁'],['express','來源地直達快線'],['park','停車轉BRT：補助不分原運具'],['targeted','停車轉BRT：限原開車者']];
 return {options:a,seed,calibrated:false,results:definitions.map(([id,label])=>{
  const isPark=id==='park'||id==='targeted',records=[],cars=[],lines=(id==='express'?data.origins:data.hubs).map((h,i)=>({id:h.id,name:h.name,km:id==='express'?direct[i]:proxyKm(h.coordinates,data.destination),passengers:[],fleet:0,departures:0,served:0,unserved:0,waits:[],spaces:isPark?Math.floor(h.total_car_spaces*a.parkingShare):0,parked:0}));
  let railUsed=0,parkingUsed=0,budgetUsed=0,rejectedParking=0,rejectedRail=0,rejectedBudget=0,induced=0,carKm=0,carTrips=0,busKm=0,busMinutes=0;
  const original=p=>{
   if(p.original==='car'){cars.push({...p,arrival:p.start+direct[p.origin]/25*60+10});carKm+=direct[p.origin];carTrips++;}
   else records.push({...p,mode:'originalTransit',finish:p.start+direct[p.origin]/35*60+12+12,wait:0});
  };
  for(const p of [...people].sort((x,y)=>x.start-y.start||x.id-y.id)){
   const wants=id!=='baseline'&&(p.original==='car'?p.choice<a.participation:isPark?id==='park'&&p.choice<a.leakage:p.choice<a.participation);
   if(!wants){original(p);continue;}
   if(id==='rail'&&p.original==='car'&&railUsed>=a.railQuota){rejectedRail++;original(p);continue;}
   if(isPark&&budgetUsed+a.subsidy>a.budget){rejectedBudget++;original(p);continue;}
   let candidates=id==='express'?[{line:lines[p.origin],km:0,access:8}]:lines.map((line,i)=>({line,km:access[p.origin][i],access:access[p.origin][i]/(isPark?25:35)*60+(isPark?10:17)})).sort((x,y)=>(x.access+x.line.km/a.busSpeed*60)-(y.access+y.line.km/a.busSpeed*60));
   const choice=candidates.find(c=>!isPark||c.line.parked<c.line.spaces);
   if(!choice){rejectedParking++;original(p);continue;}
   if(isPark){choice.line.parked++;parkingUsed++;budgetUsed+=a.subsidy;carKm+=choice.km;carTrips++;if(p.original==='transit')induced++;}
   if(id==='rail'&&p.original==='car')railUsed++;
   choice.line.passengers.push({...p,arrival:p.start+choice.access,mode:id});
  }
  // Independent point queues for direct cars. No signals, finite storage, or bus interaction.
  for(const g of data.nodes.filter(n=>n.role==='gateway')){
   const queue=cars.filter(p=>data.origins[p.origin].gate===g.id).sort((x,y)=>x.arrival-y.arrival||x.id-y.id);let free=0;
   for(const p of queue){const finish=Math.max(free,p.arrival);free=finish+60/(g.capacity_vph_assumption*a.roadScale);records.push({...p,mode:'directCar',finish,wait:finish-p.arrival});}
  }
  const active=lines.filter(l=>l.passengers.length);
  // Fixed total fleet, split evenly across demanded lines in input order. No hidden extra buses.
  for(let i=0;i<a.fleet&&active.length;i++)active[i%active.length].fleet++;
  for(const l of active){
   l.passengers.sort((x,y)=>x.arrival-y.arrival||x.id-y.id);
   const ride=l.km/a.busSpeed*60+8,cycle=2*ride+rest;let i=0;
   const ready=Array.from({length:l.fleet},(_,b)=>b*a.headway);
   for(let planned=0;planned<=end&&ready.length;planned+=a.headway){
    const next=Math.min(...ready),b=ready.indexOf(next),departure=Math.max(planned,next);
    if(departure>end)break;
    ready[b]=departure+cycle;l.departures++;busKm+=2*l.km;busMinutes+=cycle;
    let seats=a.capacity;
    while(i<l.passengers.length&&l.passengers[i].arrival<=departure&&seats-->0){const p=l.passengers[i++],finish=departure+ride+5,wait=departure-p.arrival;l.waits.push(wait);records.push({...p,finish,wait});if(finish<=end)l.served++;else l.unserved++;}
    // Actual departures are at least the requested headway apart when fleet shortages delay service.
    planned=departure;
   }
   for(;i<l.passengers.length;i++){const p=l.passengers[i];l.unserved++;records.push({...p,finish:Infinity,wait:Math.max(0,end-p.arrival)});}
  }
  if(records.length!==people.length||new Set(records.map(r=>r.id)).size!==people.length)throw Error('Traveler conservation failed');
  const done=records.filter(p=>p.finish<=end),times=done.map(p=>p.finish-p.start).sort((a,b)=>a-b),count=mode=>records.filter(r=>r.mode===mode).length;
  const groups=['car','transit'].map(original=>{const rs=records.filter(p=>p.original===original),completed=rs.filter(p=>p.finish<=end);return {original,people:rs.length,completed:completed.length,unserved:rs.length-completed.length,meanMinutes:completed.length?sum(completed.map(p=>p.finish-p.start))/completed.length:null};});
  return {id,label,people:people.length,completed:done.length,unserved:people.length-done.length,meanMinutes:times.length?sum(times)/times.length:null,p95Minutes:times.length?times[Math.ceil(times.length*.95)-1]:null,
   observedPersonMinutes:sum(records.map(p=>Math.max(0,Math.min(end,p.finish)-p.start))),groups,
   directCars:cars.length,carTrips,proxyCarKm:carKm,proxyBusKm:busKm,inducedCarTrips:induced,parkingUsed,parkingQuota:sum(lines.map(l=>l.spaces)),subsidyCost:budgetUsed,
   railUsed,rejectedRail,rejectedParking,rejectedBudget,fleetUsed:sum(active.map(l=>l.fleet)),spares:Math.ceil(sum(active.map(l=>l.fleet))*.1),busCycleHours:busMinutes/60,
   modes:{directCar:count('directCar'),originalTransit:count('originalTransit'),service:records.filter(p=>!['directCar','originalTransit'].includes(p.mode)).length},
   lines:active.map(l=>({id:l.id,name:l.name,km:l.km,fleet:l.fleet,departures:l.departures,passengers:l.passengers.length,served:l.served,unserved:l.unserved,parked:l.parked,spaces:l.spaces,waitP95:l.waits.length?[...l.waits].sort((a,b)=>a-b)[Math.ceil(l.waits.length*.95)-1]:null}))};
 })};
}
