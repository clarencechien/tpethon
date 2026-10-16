import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateStation,simulateShuttles,recommendShuttles,simulateRamp,rampScenarios} from '../static/service_logic.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const one={name:'A',hourly:[60,0,0]};

test('FIFO waiting matches an independent half-minute arrival / ten-minute departure calculation',()=>{
 const r=simulateStation(one,{share:1,capacity:10,load:1,headway:10,fleet:1,travelLag:0,roundTrip:1,rest:0});
 near(r.demand,60);near(r.boarded,60);near(r.unserved,0);near(r.meanWait,4.75);near(r.passengerWaitHours,4.75);
 assert.equal(r.p95Wait,9);assert.equal(r.lastBoarding,60);
});
test('fleet and rest constrain real departures; reserve vehicles do not secretly operate',()=>{
 const stations=[{name:'A',hourly:[600,600,600]}];
 const fast=simulateShuttles(stations,{share:1,headway:5,fleet:1,roundTrip:5,rest:0,reserve:0});
 const rested=simulateShuttles(stations,{share:1,headway:5,fleet:1,roundTrip:5,rest:15,reserve:1});
 assert.ok(rested.missedDepartures>fast.missedDepartures);assert.ok(rested.unserved>fast.unserved);
 assert.equal(rested.totalFleet,2);assert.equal(rested.activeFleet,1);
});
test('two stations keep separate fleets and conserve all passengers including unserved',()=>{
 const stations=[{name:'A',hourly:[0,0,0]},{name:'B',hourly:[4000,4000,4000]}];
 const r=simulateShuttles(stations,{share:1,capacity:20,fleet:1});
 near(r.demand,r.boarded+r.unserved);assert.ok(r.unserved>0);assert.equal(r.results[0].departures,0);
 near(r.results[1].boarded,simulateStation(stations[1],{share:1,capacity:20,fleet:1}).boarded);
});
test('zero demand and no fleet expose unknown wait instead of reassuring zero waits',()=>{
 const z=simulateShuttles([one],{share:0});assert.equal(z.totalFleet,0);assert.equal(z.activeFleet,0);assert.equal(z.meanWait,null);
 const r=simulateShuttles([one],{share:1,fleet:0});near(r.unserved,60);assert.equal(r.meanWait,null);assert.equal(r.p95Wait,null);
});
test('recommendation verifies wait, no missed departures and completion; infeasible stays explicit',()=>{
 const station={name:'A',hourly:[1000,1500,500]};
 const [plan]=recommendShuttles([station],{share:.2});assert.equal(plan.feasible,true);
 const r=simulateStation(station,{share:.2,headway:plan.headway,fleet:plan.activeFleet});
 assert.ok(r.p95Wait<=10);near(r.unserved,0);assert.equal(r.missedDepartures,0);
 assert.equal(recommendShuttles([{name:'A',hourly:[1e6,1e6,1e6]}],{share:1})[0].feasible,false);
});
test('uniform travel lag shifts clock, not demand or waits when dispatch also shifts',()=>{
 const a=simulateStation(one,{share:1,travelLag:0}),b=simulateStation(one,{share:1,travelLag:45});
 near(a.demand,b.demand);near(a.meanWait,b.meanWait);near(a.lastBoarding+45,b.lastBoarding);
});
test('invalid OD, impossible boarding capacity and invalid parameters fail closed',()=>{
 for(const station of [{name:'A',hourly:[1,null,3]},{name:'A',hourly:[1,2]},{name:'A',hourly:[-1,2,3]}])assert.throws(()=>simulateStation(station));
 assert.throws(()=>simulateStation(one,{headway:.1}));assert.throws(()=>simulateStation(one,{capacity:1,load:.1}));
 assert.throws(()=>simulateShuttles([one,one]));
});
test('ramp queue agrees with analytical constant overload and draining tail',()=>{
 const r=simulateRamp([1,1],{totalDemand:4,capacity:60,delay:0,tail:3});
 near(r.peakQueue,2);near(r.queueVehicleHours,4/60);near(r.served,4);near(r.residual,0);near(r.meanQueueMinutes,1);
});
test('ramp alternatives conserve delayed and transferred trips plus initial queue',()=>{
 for(const r of rampScenarios([1,4,3,2],{totalDemand:200,capacity:60,initialQueue:10})){
  near(r.removedDemand+r.served+r.residual,210);near(r.modeledDemand+r.removedDemand,200);
 }
 const delayed=simulateRamp([1,3,2],{totalDemand:100,shiftShare:1,delay:60,capacity:60,tail:200});
 const baseline=simulateRamp([1,3,2],{totalDemand:100,delay:60,capacity:60,tail:200});
 near(delayed.queueVehicleHours,baseline.queueVehicleHours);near(delayed.peakQueue,baseline.peakQueue);
});
test('ramp uncertain units cancel only in normalized shape; missing data cannot be zero-filled',()=>{
 near(simulateRamp([1,2,3]).queueVehicleHours,simulateRamp([60,120,180]).queueVehicleHours);
 assert.throws(()=>simulateRamp([1,null,3]));assert.throws(()=>simulateRamp([0,0]));
 const r=simulateRamp([1],{totalDemand:1000,capacity:1,tail:0});assert.ok(r.residual>0);assert.equal(r.meanQueueMinutes,null);
});
