import test from 'node:test';
import assert from 'node:assert/strict';
import {busPlan} from '../static/plan_logic.js';
const input={people:10000,shift:1,capacity:70,load:.8,peakMinutes:150,cycleMinutes:90,carOccupancy:1.3,reserve:.1};
test('fleet covers the assumed passengers and includes separate reserve',()=>{
 const p=busPlan(input);assert.equal(p.effectiveCapacity,56);assert.equal(p.departuresPerHour,72);assert.equal(p.operatingFleet,108);assert.equal(p.reserveFleet,11);assert.equal(p.totalFleet,119);assert.ok(p.deliveredCapacity>=p.passengers);assert.equal(p.trafficDelayChange,null);
});
test('zero conversion requires no added buses and avoids infinite headway',()=>{
 const p=busPlan({...input,shift:0});assert.equal(p.totalFleet,0);assert.equal(p.minimumDepartures,0);assert.equal(p.headwayMinutes,null);
});
test('slower cycle increases fleet without changing passenger demand',()=>{
 const a=busPlan({...input,cycleMinutes:60}),b=busPlan({...input,cycleMinutes:120});assert.equal(a.passengers,b.passengers);assert.equal(b.operatingFleet,2*a.operatingFleet);
});
test('invalid inputs do not produce optimistic outputs',()=>{
 for(const patch of [{people:-1},{load:0},{load:1.1},{cycleMinutes:0},{peakMinutes:NaN},{carOccupancy:.5},{shift:2},{capacity:1,load:.1}])assert.throws(()=>busPlan({...input,...patch}));
});
