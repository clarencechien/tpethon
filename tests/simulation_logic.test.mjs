import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,queueStep,runScenario,experiment} from '../static/simulation_logic.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('queue integral matches an analytic buildup and fractional-minute drain',()=>{
 const q=queueStep(0,20,10);near(q.queue,10);near(q.area,5);near(q.served,10);
 const drain=queueStep(10,0,20);near(drain.queue,0);near(drain.area,2.5);near(drain.served,10);
 near(queueStep(0,5,10).area,0);
});
test('every scenario conserves people and PCU through the full tail',()=>{
 for(const r of experiment(defaults)){
  near(r.carPeople+r.busPassengers,defaults.people);
  near(r.carTrips*defaults.occupancy+r.busPassengers,defaults.people);
  near(r.totalPCU,r.carTrips+r.busDepartures*defaults.busPCU);
  near(r.servedPCU+r.residualPCU,r.totalPCU);
  near(r.residualPCU,0);near(r.busPassengersUnserved,0);
  assert.ok(r.busDepartures*r.effectiveSeats>=r.busPassengers);
  assert.equal(r.calibrated,false);
 }
});
test('restrictions divert rather than delete vehicle trips and count detour costs',()=>{
 const a=runScenario(defaults),b=runScenario(defaults,{bus:0,stagger:0,restrict:.4});
 near(a.carTrips,b.carTrips);near(a.totalPCU,b.totalPCU);
 near(a.demandInner-b.demandInner,b.divertedCars);
 near(b.demandOuter-a.demandOuter,b.divertedCars);
 near(b.freeFlowPCUHours-a.freeFlowPCUHours,b.addedDetourCarHours);
});
test('a pure time shift preserves trips, queue area, and moves the peak later',()=>{
 const a=runScenario(defaults),b=runScenario(defaults,{bus:0,stagger:1,restrict:0});
 near(a.carTrips,b.carTrips);near(a.queuePCUHours,b.queuePCUHours);
 assert.equal(b.clearMinute-a.clearMinute,defaults.shiftMinutes);
 for(let i=0;i<250;i++)near(a.series[i].innerQueue,b.series[i+defaults.shiftMinutes].innerQueue);
});
test('limiting an inner channel can overload a constrained outer channel',()=>{
 const input={...defaults,innerCapacity:6000,outerCapacity:600};
 const a=runScenario(input),b=runScenario(input,{bus:0,stagger:0,restrict:1});
 assert.ok(b.queuePCUHours>a.queuePCUHours);
 assert.ok(b.maxOuterQueue>a.maxOuterQueue);
});
test('all-bus scenario retains people, adds actual departures, and fleet covers simultaneous cycles',()=>{
 const r=runScenario(defaults,{bus:1,stagger:0,restrict:0});
 near(r.carTrips,0);assert.equal(r.busPassengers,defaults.people);
 assert.equal(r.busDepartures,Math.ceil(defaults.people/r.effectiveSeats));
 for(let t=0;t<r.series.length;t++){
  const active=r.series.slice(Math.max(0,t-defaults.cycleMinutes+1),t+1).reduce((sum,v)=>sum+v.busDepartures,0);
  assert.ok(active<=r.operatingFleet);
 }
 assert.ok(r.totalFleet>=r.operatingFleet);
});
test('zero demand produces zero queue and fleet; unresolved queues remain explicit',()=>{
 const zero=runScenario({...defaults,people:0},{bus:1,stagger:1,restrict:1});
 near(zero.queuePCUHours,0);near(zero.totalFleet,0);near(zero.meanQueueMinutes,0);
 const busy=runScenario({...defaults,people:100000,innerCapacity:50,outerCapacity:50});
 assert.ok(busy.residualPCU>0);assert.equal(busy.clearMinute,null);
 near(busy.servedPCU+busy.residualPCU,busy.totalPCU);
});
test('invalid demand, capacities and fractional time steps fail explicitly',()=>{
 for(const patch of [{people:NaN},{innerCapacity:0},{busShare:1.1},{shiftMinutes:1.5},{busSeats:1,busLoad:.01}])assert.throws(()=>experiment({...defaults,...patch}));
 assert.throws(()=>runScenario(defaults,{bus:1.5,stagger:0,restrict:0}));
});
