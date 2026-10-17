/** E10: one mapped corridor, paired synthetic travelers, a shared point bottleneck. */
export const trialDefaults=Object.freeze({carPeople:600,transitPeople:120,participation:.5,backgroundVph:600,fleet:4,capacity:60,headway:10,lanes:2,laneCapacity:600,additionalLane:0,parkingShare:.2,busSpeed:25,actualSpeedFactor:1,accessDelay:0,maxExtra:5,deadlineBudget:45,busHourCost:1200,infrastructureCost:12000,parkingSubsidy:150});
const END=300,DISPATCH_END=180,EPS=1e-8;
const sum=x=>x.reduce((a,b)=>a+b,0),mean=x=>x.length?sum(x)/x.length:null,p95=x=>x.length?[...x].sort((a,b)=>a-b)[Math.ceil(x.length*.95)-1]:null;
class Events{constructor(){this.q=[];this.seq=0;}add(t,fn){const x={t,fn,id:this.seq++};this.q.push(x);let i=this.q.length-1;while(i){const p=(i-1)>>1;if(!this.less(x,this.q[p]))break;this.q[i]=this.q[p];i=p;}this.q[i]=x;}less(a,b){return a.t<b.t||a.t===b.t&&a.id<b.id;}pop(){const top=this.q[0],last=this.q.pop();if(this.q.length){let i=0;while(2*i+1<this.q.length){let j=2*i+1;if(j+1<this.q.length&&this.less(this.q[j+1],this.q[j]))j++;if(!this.less(this.q[j],last))break;this.q[i]=this.q[j];i=j;}this.q[i]=last;}return top;}}
export function trialCohort(a,seed=7){let state=seed>>>0;const random=()=>((state=(1664525*state+1013904223)>>>0)/4294967296);const people=[];for(let i=0;i<a.carPeople+a.transitPeople;i++){const start=120*(random()+random())/2;people.push({id:i,original:i<a.carPeople?'car':'transit',start,choice:random(),deadline:start+a.deadlineBudget});}const background=Array.from({length:Math.round(a.backgroundVph*2)},(_,id)=>({id,start:random()*120}));return {people,background};}
function timings(input,a,hub,brt,factor=1){const key=hub?'hub':'direct',out=input.paths[key+'_out'],back=input.paths[key+'_back'],drive=60/(a.busSpeed*factor),stops=brt?.5:2,signals=brt?.5:3;return {pre:out.leg_km[0]*drive+(stops+signals)/2,post:out.leg_km[1]*drive+(stops+signals)/2,back:back.distance_km*drive+stops+signals,km:out.distance_km+back.distance_km,deadheadKm:input.paths['base_'+key].distance_km+input.paths[key+'_base'].distance_km};}
function timetable(a,cycle){const ready=Array(a.fleet).fill(0),out=[];let next=0;while(ready.length){const bus=ready.indexOf(Math.min(...ready)),t=Math.max(next,ready[bus]);if(t>DISPATCH_END)break;out.push({time:t,used:0});ready[bus]=t+cycle;next=t+a.headway;}return out;}
export function simulateCorridor(input,a,cohort,spec,bookings=[]){
 const {id,hub=false,brt=false}=spec,assigned=new Map(bookings.map(b=>[b.id,b])),events=new Events(),records=new Map(),background=[],roadEvents=[];let roadReady=0,brtReady=0;
 const generalLanes=a.lanes-(brt&&!a.additionalLane?1:0),roadCapacity=generalLanes*a.laneCapacity;
 const direct=input.paths.direct_out,carPre=direct.leg_km[0]/25*60+2,carPost=direct.leg_km[1]/25*60+2+8;
 function enter(t,pcu,dedicated,callback){const cap=dedicated?a.laneCapacity:roadCapacity,ready=dedicated?brtReady:roadReady,finish=Math.max(t,ready)+pcu*60/cap;if(dedicated)brtReady=finish;else roadReady=finish;roadEvents.push({arrival:t,finish,pcu,dedicated});callback(finish,finish-t-pcu*60/cap);}
 for(const p of cohort.people){if(p.original==='car'&&!assigned.has(p.id))events.add(p.start+carPre,t=>enter(t,1,false,(finish,wait)=>records.set(p.id,{...p,mode:'car',finish:finish+carPost,wait})));}
 for(const p of cohort.background)events.add(p.start,t=>enter(t,1,false,(finish,wait)=>background.push({id:p.id,wait:Math.min(wait,Math.max(0,END-t)),finish})));
 function line(kind,riders,options){
  const isNew=kind==='new',lineHub=isNew&&hub,timing=timings(input,a,lineHub,brt,a.actualSpeedFactor),fleet=isNew?(riders.length?a.fleet:0):4,headway=isNew?a.headway:10,cap=isNew?a.capacity:60;
  const buses=Array.from({length:fleet},()=>({ready:true,first:null,lastReturn:null,trips:0})),pending=[...riders].sort((x,y)=>x.arrival-y.arrival||x.id-y.id);let index=0,next=0,waiting=false,queued=false,departures=0,boarded=0,maxOnboard=0;
  const stats={kind,fleet,departures:0,boarded:0,km:0,hours:0,actualFleet:0,maxOnboard:0,missed:0,cycles:[]};
  function schedule(t){if(t>DISPATCH_END||queued)return;queued=true;events.add(t,dispatch);}
  function dispatch(t){queued=false;if(t>DISPATCH_END)return;const available=pending.filter(p=>p.arrival<=t+EPS&&(!isNew||(p.trip<=index&&p.plannedDeparture<=t+EPS))).sort((x,y)=>(isNew?Number(y.trip===index)-Number(x.trip===index):0)||x.arrival-y.arrival||x.id-y.id);
   if(!available.length){index++;next=isNew?Math.max(t+headway,spec.plannedTimes[index]??(DISPATCH_END+1)):t+headway;schedule(next);return;}
   const bus=buses.find(b=>b.ready);if(!bus){waiting=true;return;}waiting=false;bus.ready=false;bus.first??=t;bus.trips++;departures++;
   const on=available.slice(0,cap);maxOnboard=Math.max(maxOnboard,on.length);boarded+=on.length;for(const p of on)pending.splice(pending.indexOf(p),1);
   if(isNew)stats.missed+=on.filter(p=>p.arrival>p.plannedDeparture+EPS).length;
   const tripIndex=index++;next=isNew?Math.max(t+headway,spec.plannedTimes[index]??(DISPATCH_END+1)):t+headway;schedule(next);
   events.add(t+timing.pre,at=>enter(at,2.5,brt,(finish,wait)=>{
    const end=finish+timing.post;for(const p of on)records.set(p.id,{...p,mode:isNew?(hub?'hub':'express'):'existingBus',finish:end+5,wait:wait+t-p.arrival});
    const back=end+timing.back+12;bus.lastReturn=back;stats.cycles.push({departure:t,return:back,trip:tripIndex,passengers:on.length});events.add(back,now=>{bus.ready=true;if(waiting)schedule(Math.max(next,now));});
   }));
  }
  schedule(isNew?(spec.plannedTimes?.[0]??(DISPATCH_END+1)):0);
  stats.finalize=()=>{stats.departures=departures;stats.boarded=boarded;stats.maxOnboard=maxOnboard;stats.actualFleet=buses.filter(b=>b.trips).length;stats.km=departures*timing.km+stats.actualFleet*timing.deadheadKm;stats.hours=sum(buses.filter(b=>b.trips).map(b=>Math.max(3,(b.lastReturn+timing.deadheadKm/(a.busSpeed*a.actualSpeedFactor)*60)/60)));stats.spares=fleet?Math.ceil(fleet*.1):0;stats.chargedHours=stats.hours+(fleet-stats.actualFleet)*3+stats.spares*3;delete stats.finalize;};return stats;
 }
 const legacy=line('existing',cohort.people.filter(p=>p.original==='transit').map(p=>({...p,arrival:p.start+6})),{});
 const newService=line('new',bookings.map(b=>({...cohort.people[b.id],...b,arrival:b.plannedArrival+a.accessDelay})),{});
 while(events.q.length){const e=events.pop();if(e.t>END)break;e.fn(e.t);}legacy.finalize();newService.finalize();
 for(const p of cohort.people)if(!records.has(p.id))records.set(p.id,{...p,mode:p.original==='transit'?'existingBus':assigned.has(p.id)?hub?'hub':'express':'car',finish:Infinity,wait:null});
 const all=[...records.values()],completed=all.filter(p=>p.finish<=END),shifted=assigned.size,carKm=(a.carPeople-shifted)*direct.distance_km+(hub?shifted*input.paths.access.distance_km:0),parkingCost=hub?shifted*a.parkingSubsidy:0;
 const metrics={id,label:spec.label,generalLanes,roadCapacity,people:all.length,converted:shifted,willing:cohort.people.filter(p=>p.original==='car'&&p.choice<a.participation).length,completed:completed.length,unserved:all.length-completed.length,late:all.filter(p=>p.finish>p.deadline).length,meanMinutes:mean(completed.map(p=>p.finish-p.start)),p95Minutes:p95(completed.map(p=>p.finish-p.start)),carTrips:a.carPeople,entryCars:a.carPeople-shifted,carKm,parking:hub?shifted:0,newService,legacy,backgroundPeople:cohort.background.length,backgroundCompleted:background.filter(p=>p.finish<=END).length,backgroundDelayMinutes:sum(background.map(p=>p.wait)),backgroundP95:p95(background.map(p=>p.wait)),roadPcu:sum(roadEvents.map(e=>e.pcu)),unpassedPcu:sum(roadEvents.filter(e=>e.finish>END).map(e=>e.pcu)),cost:newService.chargedHours*a.busHourCost+parkingCost+(brt?a.infrastructureCost:0),parkingCost,bookings};
 metrics.carTrips=a.carPeople-shifted+(hub?shifted:0);
 return {metrics,records:all,background,roadEvents};
}
export function runCorridorTrial(input,options={},seed=7){
 const a={...trialDefaults,...options};const bounds={carPeople:[0,3000],transitPeople:[0,2000],participation:[0,1],backgroundVph:[0,2400],fleet:[0,24],capacity:[1,120],headway:[2,30],lanes:[2,4],laneCapacity:[200,1600],additionalLane:[0,1],parkingShare:[0,1],busSpeed:[10,45],actualSpeedFactor:[.5,1],accessDelay:[0,20],maxExtra:[0,15],deadlineBudget:[15,90],busHourCost:[0,5000],infrastructureCost:[0,100000],parkingSubsidy:[0,500]};
 for(const[k,[lo,hi]]of Object.entries(bounds))if(!Number.isFinite(a[k])||a[k]<lo||a[k]>hi)throw Error('Invalid '+k);
 for(const k of ['carPeople','transitPeople','fleet','capacity','lanes','additionalLane'])if(!Number.isInteger(a[k]))throw Error('Integer required: '+k);
 const cohort=trialCohort(a,seed),specs=[{id:'baseline',label:'原方式'},{id:'express',label:'直達專車'},{id:'hub',label:'停車hub＋混流接駁',hub:true},{id:'brt',label:'直達＋BRT條件',brt:true},{id:'brt_hub',label:'停車hub＋BRT條件',hub:true,brt:true}];
 const planning={...a,actualSpeedFactor:1,accessDelay:0},forecast=simulateCorridor(input,planning,cohort,specs[0]),original=new Map(forecast.records.map(p=>[p.id,p])),estimatedWait=mean(forecast.records.filter(p=>p.original==='car'&&p.wait!==null).map(p=>p.wait))||0;
 const base=simulateCorridor(input,a,cohort,specs[0]),actualOriginal=new Map(base.records.map(p=>[p.id,p]));
 const out=[base];
 for(const spec of specs.slice(1)){
  const timing=timings(input,planning,spec.hub,spec.brt),gateWait=spec.brt?0:estimatedWait,serviceTime=timing.pre+timing.post+gateWait+2.5*60/((spec.brt?1:a.lanes)*a.laneCapacity),slots=timetable(a,serviceTime+timing.back+12),bookings=[];
  const access=spec.hub?input.paths.access.distance_km/25*60+8:6,parkingLimit=Math.floor(input.parking_total*a.parkingShare);
  for(const p of [...cohort.people].filter(p=>p.original==='car'&&p.choice<a.participation).sort((x,y)=>x.start-y.start||x.id-y.id)){
   if(spec.hub&&bookings.length>=parkingLimit)continue;const ready=p.start+access,trip=slots.findIndex(s=>s.time>=ready&&s.used<a.capacity);if(trip<0)continue;
   const finish=slots[trip].time+serviceTime+5;if(finish>p.deadline||finish>original.get(p.id).finish+a.maxExtra)continue;
   slots[trip].used++;bookings.push({id:p.id,trip,plannedArrival:ready,plannedDeparture:slots[trip].time,plannedFinish:finish,originalPredictedFinish:original.get(p.id).finish});
  }
  out.push(simulateCorridor(input,a,cohort,{...spec,plannedTimes:slots.map(s=>s.time)},bookings));
 }
 const baseTotal=sum(base.records.map(p=>Math.min(END,p.finish)-p.start))+base.metrics.backgroundDelayMinutes;
 const results=out.map(({metrics:m,records,background})=>{
  const newLate=records.filter(p=>actualOriginal.get(p.id).finish<=p.deadline&&p.finish>p.deadline).length,recovered=records.filter(p=>actualOriginal.get(p.id).finish>p.deadline&&p.finish<=p.deadline).length;
  const observedTotal=sum(records.map(p=>Math.min(END,p.finish)-p.start))+m.backgroundDelayMinutes;
  const target=m.bookings.map(b=>records.find(p=>p.id===b.id)),done=target.filter(p=>p.finish<=END);
  const r={...m,newlyLate:newLate,newlyLateConverted:records.filter(p=>m.bookings.some(b=>b.id===p.id)&&actualOriginal.get(p.id).finish<=p.deadline&&p.finish>p.deadline).length,newlyLateRemainingCars:records.filter(p=>p.mode==='car'&&actualOriginal.get(p.id).finish<=p.deadline&&p.finish>p.deadline).length,newlyLateTransit:records.filter(p=>p.original==='transit'&&actualOriginal.get(p.id).finish<=p.deadline&&p.finish>p.deadline).length,recovered,backgroundExtraDelayMinutes:m.backgroundDelayMinutes-base.metrics.backgroundDelayMinutes,personMinutesChange:observedTotal-baseTotal,convertedCompleted:done.length,convertedOnTime:target.filter(p=>p.finish<=p.deadline).length,costPerConverted:m.converted?m.cost/m.converted:null,costPerOnTime:target.filter(p=>p.finish<=p.deadline).length?m.cost/target.filter(p=>p.finish<=p.deadline).length:null,modeledKmChange:m.carKm-base.metrics.carKm+m.newService.km+m.legacy.km-base.metrics.legacy.km,existingBusExtraMinutes:sum(records.filter(p=>p.original==='transit').map(p=>Math.min(END,p.finish)-Math.min(END,actualOriginal.get(p.id).finish)))};
  r.screenPass=m.id!=='baseline'&&m.converted>=50&&newLate===0&&m.unserved===0&&m.backgroundCompleted===m.backgroundPeople&&r.personMinutesChange<0&&r.modeledKmChange<=0&&r.costPerOnTime<=300;
  return r;
 });
 return {schema_version:1,calibrated:false,seed,options:a,results};
}
