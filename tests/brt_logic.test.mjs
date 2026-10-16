import test from 'node:test';
import assert from 'node:assert/strict';
import {brtDefaults as d,simulateBRT,servicePlan,conversionScan,transitionYears} from '../static/brt_logic.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('all scenarios conserve people, vehicle arrivals, and service including existing bus users',()=>{
 for(const mode of ['before','construction','mixed','brt']){
  const r=simulateBRT(d,mode);near(r.totalPeople,r.carTrips*d.occupancy+r.passengers);
  near(r.passengers,r.boardedPassengers+r.unservedPassengers);near(r.totalRoadPCU,r.servedRoadPCU+r.residualRoadPCU);
  near(r.totalRoadPCU,r.carTrips+r.roadBusPCU);assert.ok(r.passengers>=d.existingBusPeople);
 }
});
test('construction and BRT both consume real lane space; impossible layout fails explicitly',()=>{
 assert.equal(simulateBRT(d,'before').generalLanes,3);assert.equal(simulateBRT(d,'construction').generalLanes,2);assert.equal(simulateBRT(d).generalLanes,1);
 assert.equal(simulateBRT({...d,lanes:2,workLanes:1}).feasible,false);
 assert.throws(()=>simulateBRT({...d,workLanes:3}));
 const b=simulateBRT({...d,conversion:0});assert.ok(b.queuePCUHours>simulateBRT(d,'construction').queuePCUHours);
});
test('bus service follows physical dwell, cycle and fleet constraints',()=>{
 const s=servicePlan({...d,headway:.5,dwellSeconds:90,clearanceSeconds:30},'brt');assert.equal(s.effectiveHeadway,2);assert.equal(s.scheduledSeatsPerHour,3060);
 near(s.oneWayBRTMinutes,16+12+2);near(s.cycleMinutes,80);assert.equal(s.requiredFleet,40);
 const none=simulateBRT({...d,fleet:0});near(none.boardedPassengers,0);near(none.unservedPassengers,none.passengers);assert.equal(none.meanBoardedWaitMinutes,null);assert.equal(none.effectiveSeatsPerHour,0);
 const few=simulateBRT({...d,fleet:1});assert.ok(few.unservedPassengers>0);assert.ok(few.peakActiveFleet<=1);
});
test('FIFO scheduled departures give hand-calculable waiting and station crowding',()=>{
 const a={...d,people:0,existingBusPeople:60,peakMinutes:30,existingHeadway:2,demandWeights:Array(30).fill(1)};
 const r=simulateBRT(a,'construction');near(r.boardedPassengers,60);near(r.meanBoardedWaitMinutes,.75);near(r.p95BoardedWaitMinutes,1.5);near(r.totalPassengerWaitHours,.75);
 assert.ok(r.peakWaiting<=4+1e-6);
});
test('zero demand produces neither ghost departures nor waiting; dedicated buses use their own lane',()=>{
 const z=simulateBRT({...d,people:0,existingBusPeople:0});near(z.departures,0);near(z.queuePCUHours,0);near(z.totalPassengerWaitHours,0);
 const b=simulateBRT(d);assert.ok(b.departures>0);near(b.roadBusPCU,0);
 const m=simulateBRT(d,'mixed');near(m.roadBusPCU,m.departures*d.busPCU);
});
test('turning off conversion keeps existing buses and explicit diversions conserve traffic',()=>{
 const a=simulateBRT({...d,conversion:0},'mixed');near(a.passengers,d.existingBusPeople);near(a.shiftedPeople,0);
 const b=simulateBRT({...d,diversion:.3});near(b.carTrips,simulateBRT(d).carTrips);assert.ok(b.carOuter>simulateBRT(d).carOuter);
});
test('growth is from original baseline, excludes assumed post-opening year, and keeps capacity fixed',()=>{
 const rows=transitionYears({...d,years:3,growth:.1});assert.deepEqual(rows.map(r=>r.year),[0,1,2]);assert.equal(rows[2].results[0].privatePeople,12100);assert.equal(rows[2].results[0].existingBusPeople,2420);assert.equal(rows[2].results[2].capacity,1000);
 assert.throws(()=>simulateBRT({...d,year:5}));
});
test('observed profile weights shape arrivals without redefining total demand; invalid values fail',()=>{
 const weights=Array(150).fill(0).map((_,i)=>i<75?1:2);
 const a=simulateBRT({...d,demandWeights:weights}),b=simulateBRT({...d,demandWeights:weights.map(v=>v*10)});near(a.queuePCUHours,b.queuePCUHours);near(a.totalPeople,b.totalPeople);
 for(const patch of [{demandWeights:[1]},{demandWeights:Array(150).fill(0)},{fleet:NaN},{people:1.5}])assert.throws(()=>simulateBRT({...d,...patch}));
});
test('conversion scan cannot claim improvement with unserved passengers or residual road queues',()=>{
 const scan=conversionScan({...d,fleet:0});assert.equal(scan.firstTestedImprovement,null);assert.ok(scan.rows.every(r=>!r.improves));
 const normal=conversionScan(d);assert.equal(normal.rows.length,11);assert.ok(normal.rows.some(r=>r.improves));
});
